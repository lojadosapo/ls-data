const crypto = require("crypto");
const supabase = require("../../lib/supabase");
const { upsertRows } = require("../../lib/supabase-upsert");
const {
  callOmieForAccount,
  getOmieAccounts,
  isOmieNoRecords,
} = require("../api");

const TIME_ZONE = "America/Sao_Paulo";

function localDate(daysAgo = 0) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const get = (type) => Number(parts.find((part) => part.type === type)?.value);
  const value = new Date(Date.UTC(get("year"), get("month") - 1, get("day")));
  value.setUTCDate(value.getUTCDate() - daysAgo);
  return value;
}

function formatDate(date) {
  return `${String(date.getUTCDate()).padStart(2, "0")}/${String(date.getUTCMonth() + 1).padStart(2, "0")}/${date.getUTCFullYear()}`;
}

function positiveInteger(value, fallback, name) {
  const parsed = Number(value ?? fallback);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error(`${name} precisa ser inteiro >= 1`);
  }
  return parsed;
}

function accountReference(appKey) {
  return crypto.createHash("sha256").update(String(appKey)).digest("hex").slice(0, 12);
}

async function upsertInBatches(table, rows) {
  await upsertRows({ client: supabase, table, rows });
}

async function runOmieSupabaseSync({
  label,
  table,
  idPrefix,
  daysEnv,
  endpoint,
  call,
  listKey,
  totalPagesKeys,
  responsePageKeys = ["pagina", "nPagina"],
  buildParams,
  getRecordId,
}) {
  const days = positiveInteger(process.env[daysEnv], 15, daysEnv);
  const endDate = localDate(0);
  const startDate = localDate(days - 1);
  const accounts = getOmieAccounts();
  if (!accounts.length) throw new Error("Nenhuma credencial Omie configurada");

  console.log(`[${table}] Sincronizando ${label}: contas=${accounts.length}; dias=${days}`);
  const rowsById = new Map();
  const collectedAt = new Date().toISOString();
  const maxPages = positiveInteger(process.env.OMIE_MAX_PAGES, 10000, "OMIE_MAX_PAGES");

  for (let accountIndex = 0; accountIndex < accounts.length; accountIndex++) {
    const account = accounts[accountIndex];
    const accountId = accountReference(account.appKey);
    const seenPages = new Set();
    let page = 1;
    let totalPages = 1;

    while (page <= totalPages) {
      if (page > maxPages) throw new Error(`${call} excedeu o limite seguro de paginas`);
      const response = await callOmieForAccount(
        account,
        endpoint,
        call,
        buildParams({ page, pageSize: 100, startDate, endDate }),
      );
      if (isOmieNoRecords(response)) break;
      const records = response[listKey];
      if (!Array.isArray(records)) throw new Error(`${call} retornou lista invalida`);

      for (const record of records) {
        const recordId = getRecordId(record);
        if (recordId === undefined || recordId === null || recordId === "") {
          throw new Error(`${call} retornou registro sem identificador`);
        }
        const externalId = `${idPrefix}-${accountId}-${recordId}`;
        rowsById.set(externalId, {
          external_id: externalId,
          payload: record,
          updated_at: collectedAt,
        });
      }

      const responsePage = Number(responsePageKeys.map((key) => response[key]).find((value) => value != null) || page);
      if (!Number.isInteger(responsePage) || responsePage < 1 || seenPages.has(responsePage)) {
        throw new Error(`${call} retornou paginacao invalida ou repetida`);
      }
      seenPages.add(responsePage);
      totalPages = Number(totalPagesKeys.map((key) => response[key]).find((value) => value != null) || 1);
      if (!Number.isInteger(totalPages) || totalPages < page || totalPages > maxPages) {
        throw new Error(`${call} retornou total de paginas invalido`);
      }
      page++;
    }
    console.log(`[${table}] Fonte Omie ${accountIndex + 1}/${accounts.length} processada`);
  }

  const rows = [...rowsById.values()];
  if (rows.length) await upsertInBatches(table, rows);
  console.log(`[${table}] Sincronizacao concluida: registros=${rows.length}`);
  return { accounts: accounts.length, records: rows.length };
}

module.exports = { formatDate, runOmieSupabaseSync };
