const assert = require("node:assert/strict");
const test = require("node:test");

const GoogleSheets = require("../src/google/sheets");
const {
  RateGate,
  backoffMs,
  isRetryableNetworkError,
  isRetryableStatus,
} = require("../src/lib/http-retry");

function responseError(status, { headers = {}, data } = {}) {
  const error = new Error(`HTTP ${status}`);
  error.response = { status, headers, data };
  return error;
}

function networkError(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}

async function withoutRealDelays(action) {
  const originalSetTimeout = global.setTimeout;
  global.setTimeout = (callback, _delay, ...args) => {
    callback(...args);
    return 0;
  };
  try {
    return await action();
  } finally {
    global.setTimeout = originalSetTimeout;
  }
}

function createSheets(overrides = {}) {
  return new GoogleSheets({
    spreadsheetId: "spreadsheet-for-tests",
    accessToken: "initial-token",
    tokenExpiresAt: Date.now() + 3_600_000,
    refreshAccessToken: async () => "refreshed-token",
    ...overrides,
  });
}

test("http-retry classifica apenas falhas transitórias conhecidas", () => {
  for (const status of [408, 429, 500, 502, 503, 504])
    assert.equal(isRetryableStatus(status), true, `status ${status}`);

  for (const status of [400, 401, 403, 404, 425])
    assert.equal(isRetryableStatus(status), false, `status ${status}`);

  for (const code of ["ECONNRESET", "EAI_AGAIN", "ERR_NETWORK", "ETIMEDOUT"])
    assert.equal(isRetryableNetworkError({ code }), true, code);

  assert.equal(isRetryableNetworkError({ code: "ERR_BAD_REQUEST" }), false);
  assert.equal(isRetryableNetworkError(), false);
});

test("backoff respeita teto exponencial e Retry-After", () => {
  const originalRandom = Math.random;
  Math.random = () => 0;
  try {
    assert.equal(backoffMs(3, { baseMs: 100, maxMs: 500 }), 500);
    assert.equal(
      backoffMs(0, { baseMs: 100, maxMs: 500, headers: { "retry-after": "2" } }),
      2_000,
    );
    assert.equal(
      backoffMs(0, {
        baseMs: 100,
        maxMs: 500,
        maxRetryAfterMs: 700,
        headers: { "retry-after": "2" },
      }),
      700,
    );
  } finally {
    Math.random = originalRandom;
  }
});

test("RateGate espaça chamadas consecutivas", async () => {
  const originalNow = Date.now;
  const waits = [];
  Date.now = () => 1_000;
  try {
    const gate = new RateGate(275);
    await gate.wait();
    await withoutRealDelays(async () => {
      const originalSetTimeout = global.setTimeout;
      global.setTimeout = (callback, delay) => {
        waits.push(delay);
        callback();
        return 0;
      };
      try {
        await gate.wait();
      } finally {
        global.setTimeout = originalSetTimeout;
      }
    });
    assert.deepEqual(waits, [275]);
  } finally {
    Date.now = originalNow;
  }
});

test("Google Sheets atualiza o token uma vez após 401 e repete a leitura", async () => {
  let requestCount = 0;
  let refreshCount = 0;
  const sentAuthorizations = [];
  const sheets = createSheets({
    refreshAccessToken: async () => {
      refreshCount++;
      return { accessToken: "token-after-401", expiresAt: Date.now() + 3_600_000 };
    },
  });
  sheets.http.defaults.adapter = async (config) => {
    requestCount++;
    sentAuthorizations.push(config.headers.get("Authorization"));
    if (requestCount === 1) {
      const error = responseError(401);
      error.config = config;
      throw error;
    }
    return {
      config,
      data: { values: [["ok"]] },
      headers: {},
      status: 200,
      statusText: "OK",
    };
  };

  const response = await sheets.request({ method: "get", url: "/values/Teste!A:A" });

  assert.deepEqual(response.data.values, [["ok"]]);
  assert.equal(requestCount, 2);
  assert.equal(refreshCount, 1);
  assert.deepEqual(sentAuthorizations, ["Bearer initial-token", "Bearer token-after-401"]);
});

test("refresh preventivo é compartilhado entre operações concorrentes", async () => {
  let refreshCount = 0;
  const sheets = createSheets({
    tokenExpiresAt: Date.now() + 60_000,
    refreshAccessToken: async () => {
      refreshCount++;
      await Promise.resolve();
      return { accessToken: "shared-token", expiresAt: Date.now() + 3_600_000 };
    },
  });

  await Promise.all([
    sheets.ensureFreshToken(),
    sheets.ensureFreshToken(),
    sheets.ensureFreshToken(),
  ]);

  assert.equal(refreshCount, 1);
  assert.ok(sheets.tokenExpiresAt - Date.now() > 3_500_000);
});

test("Google Sheets repete 429 e erro de rede antes de retornar sucesso", async () => {
  let requestCount = 0;
  const sheets = createSheets();
  sheets.http.request = async () => {
    requestCount++;
    if (requestCount === 1) throw responseError(429, { headers: { "retry-after": "0" } });
    if (requestCount === 2) throw networkError("ECONNRESET");
    return { data: { ok: true } };
  };

  const response = await withoutRealDelays(() =>
    sheets.request({ method: "get", url: "/values/Teste!A:A" }, { maxAttempts: 3 }),
  );

  assert.deepEqual(response.data, { ok: true });
  assert.equal(requestCount, 3);
});

test("appendValues não repete escrita quando a resposta é ambígua", async () => {
  let requestCount = 0;
  const sheets = createSheets();
  sheets.http.request = async () => {
    requestCount++;
    throw networkError("ECONNRESET");
  };

  await assert.rejects(
    () => sheets.appendValues("Teste!A:B", [["a", "b"]]),
    /status=network code=ECONNRESET/,
  );
  assert.equal(requestCount, 1);
});

function attachReplaceRowsSheet(
  sheets,
  { header, initialRows, selectorIndexes, beforeSelectorRead, onWrite },
) {
  const state = { rows: initialRows.map((row) => [...row]) };
  const selectorReads = [];
  const fullReads = [];
  let update;
  let writeCalls = 0;

  sheets.getValuesBatch = async (ranges, options = {}) => {
    if (options.valueRenderOption === "UNFORMATTED_VALUE") {
      fullReads.push(ranges);
      return ranges.map((range) => {
        const match = range.match(/![A-Z]+(\d+):[A-Z]+(\d+)$/);
        assert.ok(match, `range completa inesperada: ${range}`);
        const startIndex = Number(match[1]) - 2;
        const endIndex = Number(match[2]) - 2;
        return state.rows.slice(startIndex, endIndex + 1).map((row) => [...row]);
      });
    }

    selectorReads.push(ranges);
    if (beforeSelectorRead) {
      await beforeSelectorRead({ count: selectorReads.length, state });
    }
    return [
      [header],
      ...selectorIndexes.map((index) => [
        [header[index]],
        ...state.rows.map((row) => [row[index] ?? ""]),
      ]),
    ];
  };
  sheets.getSheetIdByTitle = async () => ({ "Base Dados": 321 });
  sheets.batchUpdate = async (requests, options) => {
    writeCalls++;
    update = { requests, options };
    if (onWrite) return onWrite({ state, requests, options });
    return { ok: true };
  };

  return {
    fullReads,
    selectorReads,
    get update() {
      return update;
    },
    get writeCalls() {
      return writeCalls;
    },
  };
}

test("replaceRows relê seletoras, exclui de baixo para cima e valida linhas completas", async () => {
  const sheets = createSheets();
  const header = ["Data", "Nome", "Valor", "Empresa"];
  const newRow = ["2026-07-05", "Novo", 10, "E"];
  const harness = attachReplaceRowsSheet(sheets, {
    header,
    initialRows: [
      ["2026-07-01", "Um", 1, "A"],
      ["2026-07-02", "Dois", 2, "B"],
      ["2026-07-03", "Tres", 3, "C"],
      ["2026-07-04", "Quatro", 4, "D"],
    ],
    selectorIndexes: [0, 3],
    onWrite: ({ state }) => {
      state.rows = [state.rows[1], state.rows[3], newRow];
      return { ok: true };
    },
  });

  const shouldReplace = (row) =>
    row[0] === "2026-07-01" ||
    row[0] === "2026-07-03" ||
    row[0] === "2026-07-05";
  const result = await sheets.replaceRows({
    sheetTitle: "Base Dados",
    columnRange: "A:D",
    header,
    newRows: [newRow],
    matchColumnIndexes: [0, 3],
    shouldReplace,
  });

  assert.deepEqual(harness.selectorReads[0], [
    "'Base Dados'!A1:D1",
    "'Base Dados'!A:A",
    "'Base Dados'!D:D",
  ]);
  assert.equal(harness.selectorReads.length, 4);
  assert.deepEqual(harness.update.options, { idempotent: false });
  assert.deepEqual(harness.fullReads, [
    ["'Base Dados'!A4:D4"],
    ["'Base Dados'!A4:D4"],
  ]);

  const deletions = harness.update.requests
    .filter((request) => request.deleteDimension)
    .map((request) => request.deleteDimension.range);
  assert.deepEqual(deletions, [
    { sheetId: 321, dimension: "ROWS", startIndex: 3, endIndex: 4 },
    { sheetId: 321, dimension: "ROWS", startIndex: 1, endIndex: 2 },
  ]);
  assert.equal(
    harness.update.requests.some((request) => request.insertDimension),
    false,
  );
  assert.deepEqual(result, { previous: 4, removed: 2, inserted: 1, final: 3 });
});

test("replaceRows não oculta HTTP 403 quando seletora coincide mas valor completo ficou velho", async () => {
  const sheets = createSheets();
  const header = ["Data", "Valor"];
  const harness = attachReplaceRowsSheet(sheets, {
    header,
    initialRows: [["14/07/2026", "VELHO"]],
    selectorIndexes: [0],
    onWrite: () => {
      throw new Error("HTTP 403");
    },
  });

  await assert.rejects(
    () =>
      sheets.replaceRows({
        sheetTitle: "Base Dados",
        columnRange: "A:B",
        header,
        newRows: [["14/07/2026", "NOVO"]],
        matchColumnIndexes: [0],
        shouldReplace: (row) => row[0] === "14/07/2026",
      }),
    /HTTP 403/,
  );
  assert.equal(harness.writeCalls, 1);
});

test("replaceRows aceita resposta ambígua somente quando estado completo foi aplicado", async () => {
  const sheets = createSheets();
  const header = ["Data", "Valor"];
  const newRow = ["14/07/2026", "NOVO"];
  attachReplaceRowsSheet(sheets, {
    header,
    initialRows: [["14/07/2026", "VELHO"]],
    selectorIndexes: [0],
    onWrite: ({ state }) => {
      state.rows = [newRow];
      const error = new Error("resposta perdida");
      error.code = "ECONNRESET";
      throw error;
    },
  });

  const result = await sheets.replaceRows({
    sheetTitle: "Base Dados",
    columnRange: "A:B",
    header,
    newRows: [newRow],
    matchColumnIndexes: [0],
    shouldReplace: (row) => row[0] === "14/07/2026",
  });
  assert.deepEqual(result, { previous: 1, removed: 1, inserted: 1, final: 1 });
});

test("replaceRows aborta se seletoras mudarem na releitura anterior ao batch", async () => {
  const sheets = createSheets();
  const header = ["Data", "Valor"];
  const harness = attachReplaceRowsSheet(sheets, {
    header,
    initialRows: [
      ["14/07/2026", "VELHO"],
      ["NAO-ALVO", "PRESERVAR"],
    ],
    selectorIndexes: [0],
    beforeSelectorRead: ({ count, state }) => {
      if (count === 2) state.rows[1][0] = "MUDOU-CONCORRENTEMENTE";
    },
  });

  await assert.rejects(
    () =>
      sheets.replaceRows({
        sheetTitle: "Base Dados",
        columnRange: "A:B",
        header,
        newRows: [["14/07/2026", "NOVO"]],
        matchColumnIndexes: [0],
        shouldReplace: (row) => row[0] === "14/07/2026",
      }),
    /Estado da planilha mudou antes da escrita/,
  );
  assert.equal(harness.writeCalls, 0);
});

test("replaceRows detecta exclusão concorrente de linha não alvo após o batch", async () => {
  const sheets = createSheets();
  const header = ["Data", "Valor"];
  const newRow = ["14/07/2026", "NOVO"];
  attachReplaceRowsSheet(sheets, {
    header,
    initialRows: [
      ["14/07/2026", "VELHO"],
      ["NAO-ALVO", "PRESERVAR"],
    ],
    selectorIndexes: [0],
    onWrite: ({ state }) => {
      state.rows = [newRow];
      return { ok: true };
    },
  });

  await assert.rejects(
    () =>
      sheets.replaceRows({
        sheetTitle: "Base Dados",
        columnRange: "A:B",
        header,
        newRows: [newRow],
        matchColumnIndexes: [0],
        shouldReplace: (row) => row[0] === "14/07/2026",
      }),
    /Validacao completa apos escrita falhou/,
  );
});

test("caracteres de formula permanecem texto literal sem apostrofo", () => {
  for (const value of ["=SUM(A1:A2)", "+5511999999999", "-texto", "@usuario"]) {
    assert.deepEqual(GoogleSheets.literalCell(value), {
      userEnteredValue: { stringValue: value },
    });
  }
});
