const axios = require('axios');
const {
  RateGate,
  Semaphore,
  backoffMs,
  isRetryableNetworkError,
  isRetryableStatus,
  retryAfterMs,
  sleep
} = require('../lib/http-retry');

const OMIE_BASE_URL = 'https://app.omie.com.br/api/v1';
const NO_RECORDS = Symbol('omie-no-records');
const gates = new Map();
const methodLocks = new Map();
const inFlight = new Map();
const responseCache = new Map();
const blockedUntil = new Map();
const globalGate = new RateGate(process.env.OMIE_GLOBAL_MIN_INTERVAL_MS || 70);
const concurrency = new Semaphore(process.env.OMIE_MAX_CONCURRENCY || 3);

function secureLog(message) {
  console.log(`[${new Date().toISOString()}] [INFO] ${message}`);
}

function envMilliseconds(name, fallback) {
  if (process.env[name] === undefined) return fallback;
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value >= 0 ? value : fallback;
}

function envPositiveInteger(name, fallback) {
  if (process.env[name] === undefined) return fallback;
  const value = Number(process.env[name]);
  return Number.isInteger(value) && value > 0 ? value : fallback;
}

function isReadMethod(call) {
  return /^(Listar|Consultar|Pesquisar|Status|Cupons|ListarNF)/.test(call);
}

async function waitForCircuit(circuitKey) {
  const waitMs = Math.max(0, (blockedUntil.get(circuitKey) || 0) - Date.now());
  if (!waitMs) return;
  secureLog(`Circuito Omie em espera para o metodo; retomada em ${Math.ceil(waitMs / 1000)}s`);
  await sleep(waitMs);
}

function getOmieAccounts() {
  const { OMIE_APP_KEY, OMIE_APP_SECRET } = process.env;
  const accounts = [];

  if (OMIE_APP_KEY && OMIE_APP_SECRET) {
    accounts.push({
      name: process.env.OMIE_ACCOUNT_NAME || 'OMIE_APP_KEY',
      appKey: OMIE_APP_KEY,
      appSecret: OMIE_APP_SECRET
    });
  }

  if (process.env.OMIE_CREDENTIALS) {
    try {
      const credentials = JSON.parse(process.env.OMIE_CREDENTIALS);
      const entries = Array.isArray(credentials)
        ? credentials.map((item, index) => [item?.name || `OMIE_CREDENTIALS_${index + 1}`, item])
        : Object.entries(credentials);
      for (const [name, item] of entries) {
        const appKey = item?.appKey || item?.app_key || item?.OMIE_APP_KEY;
        const appSecret = item?.appSecret || item?.app_secret || item?.OMIE_APP_SECRET;
        if (appKey && appSecret) {
          accounts.push({ name, appKey, appSecret });
        }
      }
    } catch (err) {
      throw new Error('OMIE_CREDENTIALS precisa ser um JSON valido');
    }
  }

  for (let index = 1; index <= 50; index++) {
    const appKey = process.env[`OMIE_APP_KEY_${index}`];
    const appSecret = process.env[`OMIE_APP_SECRET_${index}`];
    if (appKey && appSecret) {
      accounts.push({
        name: process.env[`OMIE_ACCOUNT_NAME_${index}`] || `OMIE_APP_KEY_${index}`,
        appKey,
        appSecret
      });
    }
  }

  const seen = new Set();
  return accounts.filter((account) => {
    const key = `${account.appKey}:${account.appSecret}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function getOmieCredentials() {
  const first = getOmieAccounts()[0];
  if (first) return first;
  throw new Error('OMIE_APP_KEY/OMIE_APP_SECRET ou OMIE_CREDENTIALS sao obrigatorios');
}

/**
 * Cria uma chamada autenticada para a API Omie.
 * @param {string} endpoint Endpoint da API, como '/produtos/pedido/'.
 * @param {string} call Nome do metodo da API, como 'ListarPedidos'.
 * @param {object[]} param Parametros da chamada.
 * @returns {Promise<object>} Resposta da API.
 */
async function callOmieForAccount(account, endpoint, call, param = []) {
  const appKey = account.appKey || account.app_key;
  const appSecret = account.appSecret || account.app_secret;
  if (!appKey || !appSecret) throw new Error('Credencial Omie incompleta');
  if (!isReadMethod(call)) {
    throw new Error(`Metodo Omie nao autorizado para coleta somente leitura: ${call}`);
  }
  const payload = {
    call,
    app_key: appKey,
    app_secret: appSecret,
    param: Array.isArray(param) ? param : [param]
  };
  const requestKey = `${appKey}:${call}:${JSON.stringify(payload.param)}`;
  const cacheTtlMs = envMilliseconds('OMIE_READ_CACHE_MS', 65000);
  const cached = isReadMethod(call) ? responseCache.get(requestKey) : null;
  if (cached?.expiresAt > Date.now()) return cached.data;
  if (cached) responseCache.delete(requestKey);
  if (inFlight.has(requestKey)) return inFlight.get(requestKey);

  const request = (async () => {
    const gateKey = `${appKey}:${call}`;
    if (!gates.has(gateKey)) gates.set(gateKey, new RateGate(process.env.OMIE_MIN_INTERVAL_MS || 275));
    if (!methodLocks.has(gateKey)) methodLocks.set(gateKey, new Semaphore(1));
    const gate = gates.get(gateKey);
    const methodLock = methodLocks.get(gateKey);

    const maxAttempts = 5;
    const max425Attempts = envPositiveInteger("OMIE_425_MAX_ATTEMPTS", 3);
    let attempts425 = 0;
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      let response;
      try {
        // Calls for the same account+method are serialized. The circuit is checked
        // again at the actual send point so queued work cannot bypass a new 425.
        response = await methodLock.use(() =>
          concurrency.use(async () => {
            await waitForCircuit(gateKey);
            await globalGate.wait();
            await gate.wait();
            await waitForCircuit(gateKey);
            const nextResponse = await axios.post(`${OMIE_BASE_URL}${endpoint}`, payload, {
              headers: { 'Content-Type': 'application/json' },
              timeout: Number(process.env.OMIE_REQUEST_TIMEOUT_MS || 60000),
              validateStatus: () => true
            });
            if (nextResponse.status === 425) {
              const cooldownMs = Math.max(
                retryAfterMs(nextResponse.headers),
                envMilliseconds('OMIE_425_COOLDOWN_MS', 30 * 60 * 1000)
              );
              blockedUntil.set(gateKey, Date.now() + cooldownMs);
            }
            return nextResponse;
          })
        );
      } catch (error) {
        if (!isRetryableNetworkError(error) || attempt === 4) {
          throw new Error(`${call} falhou na API Omie: status=network code=${error.code || 'unknown'}`);
        }
        const waitMs = backoffMs(attempt, { baseMs: 2000 });
        secureLog(`${call}: falha transitoria; tentativa ${attempt + 2}/5 em ${Math.ceil(waitMs / 1000)}s`);
        await sleep(waitMs);
        continue;
      }

      const message = String(response.data?.faultstring || response.data?.message || '');
      if (response.status < 400 && !message) {
        if (!response.data || typeof response.data !== 'object') throw new Error(`${call} retornou resposta invalida`);
        if (isReadMethod(call) && cacheTtlMs > 0) {
          responseCache.set(requestKey, { data: response.data, expiresAt: Date.now() + cacheTtlMs });
        }
        return response.data;
      }
      if (message.includes('Nao existem registros') || message.includes('Não existem registros')) {
        return { [NO_RECORDS]: true };
      }
      if (response.status === 425) {
        const cooldownMs = Math.max(
          retryAfterMs(response.headers),
          envMilliseconds('OMIE_425_COOLDOWN_MS', 30 * 60 * 1000)
        );
        blockedUntil.set(gateKey, Date.now() + cooldownMs);
        attempts425++;
        if (attempts425 >= max425Attempts || attempt === maxAttempts - 1) {
          throw new Error(`${call} permaneceu bloqueado pela API Omie (HTTP 425)`);
        }
        secureLog(`${call}: HTTP 425; circuito pausado por ${Math.ceil(cooldownMs / 1000)}s`);
        continue;
      }

      const redundant = message.includes('Consumo redundante');
      const retryable = redundant || isRetryableStatus(response.status) || /temporariamente|timeout|broken response/i.test(message);
      if (!retryable || attempt === 4) {
        throw new Error(`${call} falhou na API Omie: status=${response.status || 'unknown'}`);
      }
      const instructedSeconds = Number(message.match(/Aguarde\s+(\d+)\s+segundos/i)?.[1] || 0);
      const waitMs = Math.max((instructedSeconds + (instructedSeconds ? 1 : 0)) * 1000, backoffMs(attempt, { baseMs: 2000, headers: response.headers }));
      secureLog(`${call}: limite transitorio; tentativa ${attempt + 2}/5 em ${Math.ceil(waitMs / 1000)}s`);
      await sleep(waitMs);
    }
    throw new Error(`${call} falhou na API Omie apos retries`);
  })();

  inFlight.set(requestKey, request);
  try {
    return await request;
  } finally {
    inFlight.delete(requestKey);
  }
}

async function callOmieAPI(endpoint, call, param = []) {
  return callOmieForAccount(getOmieCredentials(), endpoint, call, param);
}

module.exports = callOmieAPI;
module.exports.callOmieForAccount = callOmieForAccount;
module.exports.getOmieAccounts = getOmieAccounts;
module.exports.getOmieCredentials = getOmieCredentials;
module.exports.isOmieNoRecords = (response) => Boolean(response?.[NO_RECORDS]);
