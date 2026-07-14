const assert = require("node:assert/strict");
const test = require("node:test");

const GoogleSheets = require("../src/google/sheets");

function createSheets() {
  return new GoogleSheets({
    spreadsheetId: "typed-date-tests",
    accessToken: "test-token",
  });
}

test("células de data e data/hora usam serial e formato explícitos", () => {
  const date = GoogleSheets.dateCell("14/07/2026");
  const dateTime = GoogleSheets.dateTimeCell("14/07/2026 07:47:13");

  assert.equal(String(date), "14/07/2026");
  assert.equal(Number(date), 46217);
  assert.deepEqual(GoogleSheets.literalCell(date), {
    userEnteredValue: { numberValue: 46217 },
    userEnteredFormat: {
      numberFormat: { type: "DATE", pattern: "dd/mm/yyyy" },
    },
  });

  assert.equal(String(dateTime), "14/07/2026 07:47:13");
  assert.equal(Number(dateTime), 46217.32445601852);
  assert.deepEqual(GoogleSheets.literalCell(dateTime), {
    userEnteredValue: { numberValue: 46217.32445601852 },
    userEnteredFormat: {
      numberFormat: {
        type: "DATE_TIME",
        pattern: "dd/mm/yyyy hh:mm:ss",
      },
    },
  });
});

test("células tipadas rejeitam datas ambíguas ou impossíveis", () => {
  assert.equal(GoogleSheets.dateCell(""), "");
  assert.equal(GoogleSheets.dateTimeCell(null), "");
  assert.throws(() => GoogleSheets.dateCell("2026-07-14"), /Data invalida/);
  assert.throws(() => GoogleSheets.dateCell("31/02/2026"), /Data invalida/);
  assert.throws(
    () => GoogleSheets.dateTimeCell("14/07/2026 24:00:00"),
    /Data invalida/,
  );
});

test("hora, mês e texto literal preservam tipo e representação", () => {
  const time = GoogleSheets.timeCell("07:47:13", { pattern: "HH:mm:ss" });
  const month = GoogleSheets.monthCell("07/2026");

  assert.equal(String(time), "07:47:13");
  assert.deepEqual(GoogleSheets.literalCell(time), {
    userEnteredValue: { numberValue: Number(time) },
    userEnteredFormat: {
      numberFormat: { type: "TIME", pattern: "HH:mm:ss" },
    },
  });
  assert.equal(String(month), "07/2026");
  assert.equal(Number(month), 46204);
  assert.deepEqual(GoogleSheets.literalCell(month), {
    userEnteredValue: { numberValue: 46204 },
    userEnteredFormat: {
      numberFormat: { type: "DATE", pattern: "mm/yyyy" },
    },
  });
  assert.deepEqual(GoogleSheets.literalCell(GoogleSheets.textCell(12345)), {
    userEnteredValue: { stringValue: "12345" },
  });

  assert.throws(() => GoogleSheets.timeCell("24:00:00"), /Hora invalida/);
  assert.throws(() => GoogleSheets.monthCell("13/2026"), /Mes invalido/);
});

test("replaceRows confirma formato antes de aceitar resposta ambigua", async () => {
  const sheets = createSheets();
  const header = ["Data/Hora", "Valor"];
  const typedDateTime = GoogleSheets.dateTimeCell("14/07/2026 07:47:13");
  const newRows = [[typedDateTime, "NOVO"]];
  const formattedBefore = "14/07/2026 06:00:00";
  const writtenUpdates = [];
  const selectedValues = [];
  let applied = false;

  sheets.getSheetPropertiesByTitle = async () => ({
    Chamadas: {
      sheetId: 17,
      gridProperties: { rowCount: 1_000, columnCount: 2 },
    },
  });
  sheets.getValuesBatch = async (_ranges, options = {}) => {
    if (options.valueRenderOption === "FORMULA") {
      return [[
        header,
        [applied ? Number(typedDateTime) : Number(typedDateTime) - 1 / 24, applied ? "NOVO" : "VELHO"],
      ]];
    }
    if (options.valueRenderOption === "UNFORMATTED_VALUE") {
      return [[[Number(typedDateTime), "NOVO"]]];
    }
    const formatted = applied ? String(typedDateTime) : formattedBefore;
    return [[header], [[header[0]], [formatted]]];
  };
  sheets.batchUpdate = async (requests, options) => {
    writtenUpdates.push({ requests, options });
    applied = true;
    const error = new Error("resposta atomica perdida");
    error.code = "ECONNRESET";
    throw error;
  };
  sheets.numberFormatsMatch = async (sheetTitle, blocks) => {
    assert.equal(sheetTitle, "Chamadas");
    assert.deepEqual(blocks, [
      {
        startRowIndex: 1,
        endRowIndex: 2,
        columnIndex: 0,
        numberFormat: {
          type: "DATE_TIME",
          pattern: "dd/mm/yyyy hh:mm:ss",
        },
      },
    ]);
    return true;
  };

  const result = await sheets.replaceRows({
    sheetTitle: "Chamadas",
    columnRange: "A:B",
    header,
    newRows,
    matchColumnIndexes: [0],
    shouldReplace: (row) => {
      const value = String(row[0] ?? "");
      selectedValues.push(value);
      return value.startsWith("14/07/2026");
    },
  });

  assert.deepEqual(result, { previous: 1, removed: 1, inserted: 1, final: 1 });
  assert.ok(selectedValues.includes("14/07/2026 07:47:13"));
  assert.equal(writtenUpdates.length, 1);
  assert.deepEqual(writtenUpdates[0].options, { idempotent: false });
  const write = writtenUpdates[0].requests.find(
    (request) => request.updateCells?.range?.startRowIndex === 1,
  ).updateCells;
  assert.equal(write.fields, "userEnteredValue");
  assert.deepEqual(
    write.rows[0].values[0],
    { userEnteredValue: { numberValue: Number(typedDateTime) } },
  );
  assert.equal(write.rows[0].values[0].userEnteredFormat, undefined);
  assert.deepEqual(
    writtenUpdates[0].requests.find((request) => request.repeatCell),
    {
      repeatCell: {
        range: {
          sheetId: 17,
          startRowIndex: 1,
          endRowIndex: 2,
          startColumnIndex: 0,
          endColumnIndex: 1,
        },
        cell: {
          userEnteredFormat: {
            numberFormat: {
              type: "DATE_TIME",
              pattern: "dd/mm/yyyy hh:mm:ss",
            },
          },
        },
        fields: "userEnteredFormat.numberFormat",
      },
    },
  );
});

test("replaceRows rejeita resposta ambigua quando o formato nao foi confirmado", async () => {
  const sheets = createSheets();
  const header = ["Data/Hora", "Valor"];
  const typedDateTime = GoogleSheets.dateTimeCell("14/07/2026 07:47:13");
  let applied = false;

  sheets.getSheetPropertiesByTitle = async () => ({
    Chamadas: {
      sheetId: 17,
      gridProperties: { rowCount: 1_000, columnCount: 2 },
    },
  });
  sheets.getValuesBatch = async (_ranges, options = {}) => {
    if (options.valueRenderOption === "FORMULA") {
      return [[
        header,
        [applied ? Number(typedDateTime) : Number(typedDateTime) - 1 / 24, applied ? "NOVO" : "VELHO"],
      ]];
    }
    if (options.valueRenderOption === "UNFORMATTED_VALUE") {
      return [[[Number(typedDateTime), "NOVO"]]];
    }
    const value = applied
      ? String(typedDateTime)
      : "14/07/2026 06:00:00";
    return [[header], [[header[0]], [value]]];
  };
  sheets.batchUpdate = async () => {
    applied = true;
    const error = new Error("resposta atomica perdida");
    error.code = "ECONNRESET";
    throw error;
  };
  sheets.numberFormatsMatch = async () => false;

  await assert.rejects(
    () =>
      sheets.replaceRows({
        sheetTitle: "Chamadas",
        columnRange: "A:B",
        header,
        newRows: [[typedDateTime, "NOVO"]],
        matchColumnIndexes: [0],
        shouldReplace: (row) =>
          String(row[0] ?? "").startsWith("14/07/2026"),
      }),
    /resposta atomica perdida/,
  );
});

test("formatos sao confirmados por spreadsheets.get com includeGridData", async () => {
  const sheets = createSheets();
  let captured;
  sheets.request = async (config, options) => {
    captured = { config, options };
    return {
      data: {
        sheets: [
          {
            properties: { sheetId: 17, title: "Chamadas" },
            data: [
              {
                startRow: 1,
                startColumn: 0,
                rowData: [
                  {
                    values: [
                      {
                        userEnteredFormat: {
                          numberFormat: {
                            type: "DATE_TIME",
                            pattern: "dd/mm/yyyy HH:mm:ss",
                          },
                        },
                      },
                    ],
                  },
                ],
              },
            ],
          },
        ],
      },
    };
  };

  const block = {
    columnIndex: 0,
    startRowIndex: 1,
    endRowIndex: 2,
    numberFormat: {
      type: "DATE_TIME",
      pattern: "dd/mm/yyyy HH:mm:ss",
    },
  };

  assert.equal(await sheets.numberFormatsMatch("Chamadas", [block]), true);

  assert.equal(captured.config.method, "get");
  assert.equal(captured.config.url, "");
  assert.equal(captured.config.params.get("includeGridData"), "true");
  assert.deepEqual(captured.config.params.getAll("ranges"), [
    "'Chamadas'!A2:A2",
  ]);
  assert.match(captured.config.params.get("fields"), /numberFormat/);

  block.numberFormat.pattern = "dd/mm/yyyy hh:mm:ss";
  assert.equal(await sheets.numberFormatsMatch("Chamadas", [block]), false);
});
