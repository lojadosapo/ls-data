const assert = require("node:assert/strict");
const test = require("node:test");

const axios = require("axios");
const originalGlobalInterval = process.env.OMIE_GLOBAL_MIN_INTERVAL_MS;
process.env.OMIE_GLOBAL_MIN_INTERVAL_MS = "0";
const { callOmieForAccount } = require("../src/omie/api");
if (originalGlobalInterval === undefined) delete process.env.OMIE_GLOBAL_MIN_INTERVAL_MS;
else process.env.OMIE_GLOBAL_MIN_INTERVAL_MS = originalGlobalInterval;

const ACCOUNT = Object.freeze({
  appKey: "app-key-for-tests",
  appSecret: "app-secret-for-tests",
});

function omieResponse(status, data = {}, headers = {}) {
  return { status, data, headers };
}

function networkError(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}

async function withOmieTestEnvironment(post, action) {
  const originalPost = axios.post;
  const originalInterval = process.env.OMIE_MIN_INTERVAL_MS;
  const originalCooldown = process.env.OMIE_425_COOLDOWN_MS;
  const originalMax425Attempts = process.env.OMIE_425_MAX_ATTEMPTS;
  const originalCacheTtl = process.env.OMIE_READ_CACHE_MS;
  const originalRandom = Math.random;

  axios.post = post;
  process.env.OMIE_MIN_INTERVAL_MS = "0";
  Math.random = () => 0;

  try {
    return await action();
  } finally {
    axios.post = originalPost;
    Math.random = originalRandom;
    if (originalInterval === undefined) delete process.env.OMIE_MIN_INTERVAL_MS;
    else process.env.OMIE_MIN_INTERVAL_MS = originalInterval;
    if (originalCooldown === undefined) delete process.env.OMIE_425_COOLDOWN_MS;
    else process.env.OMIE_425_COOLDOWN_MS = originalCooldown;
    if (originalMax425Attempts === undefined) delete process.env.OMIE_425_MAX_ATTEMPTS;
    else process.env.OMIE_425_MAX_ATTEMPTS = originalMax425Attempts;
    if (originalCacheTtl === undefined) delete process.env.OMIE_READ_CACHE_MS;
    else process.env.OMIE_READ_CACHE_MS = originalCacheTtl;
  }
}

async function waitUntil(predicate, attempts = 20) {
  for (let attempt = 0; attempt < attempts; attempt++) {
    if (predicate()) return;
    await new Promise((resolve) => setImmediate(resolve));
  }
  assert.fail("condicao assincrona nao foi atingida a tempo");
}

async function withImmediateTimers(action) {
  const originalSetTimeout = global.setTimeout;
  const waits = [];
  global.setTimeout = (callback, delay, ...args) => {
    waits.push(Number(delay));
    callback(...args);
    return 0;
  };

  try {
    return { result: await action(), waits };
  } finally {
    global.setTimeout = originalSetTimeout;
  }
}

test("Omie respeita Retry-After no 429 antes de tentar novamente", async () => {
  let requests = 0;

  await withOmieTestEnvironment(
    async () => {
      requests++;
      if (requests === 1) {
        return omieResponse(429, { faultstring: "Limite temporario" }, { "retry-after": "7" });
      }
      return omieResponse(200, { pagina: 1 });
    },
    async () => {
      const { result, waits } = await withImmediateTimers(() =>
        callOmieForAccount(ACCOUNT, "/geral/clientes/", "ListarClientes429", [{ pagina: 1 }]),
      );

      assert.deepEqual(result, { pagina: 1 });
      assert.equal(requests, 2);
      assert.ok(waits.includes(7_000), `esperas observadas: ${waits.join(", ")}`);
    },
  );
});

test("Omie repete uma falha de rede transitoria sem expor credenciais", async () => {
  let requests = 0;

  await withOmieTestEnvironment(
    async () => {
      requests++;
      if (requests === 1) throw networkError("ECONNRESET");
      return omieResponse(200, { pedido: "ok" });
    },
    async () => {
      const { result, waits } = await withImmediateTimers(() =>
        callOmieForAccount(ACCOUNT, "/produtos/pedido/", "ListarPedidosNetwork", [{ pagina: 1 }]),
      );

      assert.deepEqual(result, { pedido: "ok" });
      assert.equal(requests, 2);
      assert.ok(waits.includes(2_000), `esperas observadas: ${waits.join(", ")}`);
    },
  );
});

test("Omie compartilha a requisicao in-flight e usa cache de leitura temporario", async () => {
  let requests = 0;
  let releaseFirstRequest;
  const firstRequest = new Promise((resolve) => {
    releaseFirstRequest = resolve;
  });

  await withOmieTestEnvironment(
    async () => {
      requests++;
      if (requests === 1) return firstRequest;
      return omieResponse(200, { origem: "nova-requisicao" });
    },
    async () => {
      process.env.OMIE_READ_CACHE_MS = "30";
      const params = [{ pagina: 3, registros_por_pagina: 50 }];
      const calls = [
        callOmieForAccount(ACCOUNT, "/produtos/pedido/", "ListarPedidosDedupe", params),
        callOmieForAccount(ACCOUNT, "/produtos/pedido/", "ListarPedidosDedupe", params),
        callOmieForAccount(ACCOUNT, "/produtos/pedido/", "ListarPedidosDedupe", params),
      ];

      let preflightError;
      try {
        await waitUntil(() => requests === 1);
        assert.equal(requests, 1);
      } catch (error) {
        preflightError = error;
      } finally {
        releaseFirstRequest(omieResponse(200, { origem: "compartilhada" }));
      }

      const results = await Promise.all(calls);
      if (preflightError) throw preflightError;
      assert.deepEqual(results, [
        { origem: "compartilhada" },
        { origem: "compartilhada" },
        { origem: "compartilhada" },
      ]);
      assert.equal(requests, 1);

      const cached = await callOmieForAccount(
        ACCOUNT,
        "/produtos/pedido/",
        "ListarPedidosDedupe",
        params,
      );
      assert.deepEqual(cached, { origem: "compartilhada" });
      assert.equal(requests, 1);

      await new Promise((resolve) => setTimeout(resolve, 45));
      const afterExpiry = await callOmieForAccount(
        ACCOUNT,
        "/produtos/pedido/",
        "ListarPedidosDedupe",
        params,
      );
      assert.deepEqual(afterExpiry, { origem: "nova-requisicao" });
      assert.equal(requests, 2);
    },
  );
});

test("HTTP 425 abre cooldown por conta e metodo, sem retry imediato", async () => {
  const cooldownMs = 30;
  const requestTimes = [];

  await withOmieTestEnvironment(
    async () => {
      requestTimes.push(Date.now());
      if (requestTimes.length === 1) {
        return omieResponse(425, { faultstring: "Consumo bloqueado temporariamente" });
      }
      return omieResponse(200, { retomado: true });
    },
    async () => {
      process.env.OMIE_425_COOLDOWN_MS = String(cooldownMs);
      const first = callOmieForAccount(
        ACCOUNT,
        "/produtos/pedido/",
        "ListarPedidosCooldown",
        [{ pagina: 1 }],
      );

      const concurrent = (async () => {
        // Deixa a primeira resposta 425 abrir o circuito antes da chamada concorrente.
        await new Promise((resolve) => setImmediate(resolve));
        return callOmieForAccount(
          ACCOUNT,
          "/produtos/pedido/",
          "ListarPedidosCooldown",
          [{ pagina: 2 }],
        );
      })();

      const results = await Promise.all([first, concurrent]);
      assert.deepEqual(results, [{ retomado: true }, { retomado: true }]);
      assert.equal(requestTimes.length, 3);

      const earliestRetryMs = requestTimes[0] + cooldownMs - 5;
      assert.ok(requestTimes[1] >= earliestRetryMs, `retry ocorreu apos ${requestTimes[1] - requestTimes[0]}ms`);
      assert.ok(requestTimes[2] >= earliestRetryMs, `concorrente ocorreu apos ${requestTimes[2] - requestTimes[0]}ms`);
    },
  );
});

test("HTTP 425 persistente termina de forma controlada antes do timeout do workflow", async () => {
  let requests = 0;

  await withOmieTestEnvironment(
    async () => {
      requests++;
      return omieResponse(425, { faultstring: "Consumo bloqueado temporariamente" });
    },
    async () => {
      process.env.OMIE_425_COOLDOWN_MS = "0";
      process.env.OMIE_425_MAX_ATTEMPTS = "3";
      await assert.rejects(
        callOmieForAccount(
          ACCOUNT,
          "/produtos/pedido/",
          "ListarPedidos425Persistente",
          [{ pagina: 1 }],
        ),
        /permaneceu bloqueado.*HTTP 425/,
      );
      assert.equal(requests, 3);
    },
  );
});

test("cliente Omie de coleta rejeita metodos mutaveis antes do HTTP", async () => {
  await assert.rejects(
    callOmieForAccount(
      ACCOUNT,
      "/geral/clientes/",
      "IncluirCliente",
      [{ razao_social: "nao enviar" }],
    ),
    /somente leitura/,
  );
});
