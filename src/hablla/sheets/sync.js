const GoogleSheets = require("../../google/sheets");
const { backoffMs, sleep } = require("../../lib/http-retry");
const formatPublicError = require("../../lib/public-error");
const getHabllaClient = require("../api");
const collectHabllaCards = require("../card-collector");
const { extractAttendants } = require("../response-contracts");
const saoPauloDayRange = require("../date-range");

const CARD_HEADERS = [
  "updated_at",
  "created_at",
  "workspace",
  "board",
  "list",
  "custom_field_1",
  "custom_field_2",
  "custom_field_3",
  "name",
  "description",
  "source",
  "status",
  "user",
  "finished_at",
  "id",
  "Atendente",
  "Motivo de Contato",
  "Tags",
];

const PHONE_HEADERS = ["Telefone", "Telefone (Campo)"];
const PHONE_CUSTOM_FIELD_ID = "69e8d49592607a5877e699d5";
const CUSTOM_FIELD_DISPLAY_NAMES = Object.freeze({
  "67ca3b1b2a2005b0e7c0b67f": "utm_medium",
  "67ca3ad19698c9a231679c09": "utm_source",
  "67ca3d7709af47405f94b336": "Página de Conversão",
  "6a341e0a9794a6f45768e4c8": "Cidade",
  "6a34243f43dae636168814f5": "Browser",
  "6a34240d54956e3f17031590": "CEP_Conversao",
  "6a342421be3df912c7e28014": "Device Mobile",
  "6a342458ddddb2628027186c": "Data/Hora de Entrada no Site",
  "6a34244898b6bf2dfd2796b2": "Dimensões da Tela",
  "6a342434c2e6bd1fdedab9ca": "Sistema Operacional do Device",
  "6a3424608582742305e4af34": "Origin",
  "6a341b60fbf9c9ef3b3bff65": "ID da Conversão no Site",
  "67ca3b3bfa1aacf9258e4dbb": "utm_campaign",
  "67ca3cc6abf8dede928b7f07": "utm_content",
  "67ca3c4d75a80329df8eeff5": "utm_term",
  "6a1494ab3dae0a68cd239a93": "Cidade - Preferência",
  "6a14950aa329fb75151f7dae": "Unidade - Preferência",
  "67b5fd0a6ee6fcbb66ae93c2": "Loja de agendamento",
  "67b5fc4b9d6e187ed4fa31fa": "Motivo do não agendamento?",
  "67b5fd5e5f04cc2397fc2fd3": "Observação do não agendamento",
  "67b5fbad827b187ab70ab641": "Agendamento realizado?",
  [PHONE_CUSTOM_FIELD_ID]: "Telefone (Campo)",
});
const BASE_CARD_KEYS = new Set([
  "updated_at", "created_at", "workspace", "board", "list", "name",
  "description", "source", "status", "finished_at", "id", "phone",
  "tags", "user", "custom_fields",
]);
const BASE_CUSTOM_FIELD_IDS = new Set([
  "67b39131ee792966f3fba492",
  "67b608470787782ce7acafba",
  "67dc6a0a17925c23d8365708",
  "679120ec177ff6d2c7597156",
]);

const ATTENDANT_HEADERS = [
  "Data",
  "Workspace ID",
  "Setor ID",
  "Setor",
  "Usuário ID",
  "Atendente",
  "E-mail",
  "Total de atendimentos",
  "TME",
  "TMA",
  "Conexão ID",
  "Conexão",
  "Tipo de conexão",
  "Total CSAT",
  "CSAT maior que 4",
  "CSAT",
  "Total FCR",
];

function positiveInteger(value, fallback, name) {
  const selected = value === undefined || value === null || value === ""
    ? fallback
    : value;
  const number = Number(selected);
  if (!Number.isInteger(number) || number < 1) {
    throw new Error(`${name} precisa ser inteiro >= 1`);
  }
  return number;
}

function booleanOption(value, fallback, name) {
  if (value === undefined || value === null || value === "") return fallback;
  const normalized = String(value).trim().toLowerCase();
  if (["1", "true", "yes", "sim"].includes(normalized)) return true;
  if (["0", "false", "no", "nao", "não"].includes(normalized)) return false;
  throw new Error(`${name} precisa ser true ou false`);
}

function selectedDatasets(value) {
  const allowed = new Set(["cards", "attendants"]);
  const selected = String(value || "cards,attendants")
    .split(",")
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);
  if (!selected.length || selected.some((item) => !allowed.has(item))) {
    throw new Error("HABLLA_SHEETS_DATASETS aceita cards e attendants");
  }
  return new Set(selected);
}

function completedDayRanges(days) {
  const safeDays = positiveInteger(
    days,
    1,
    "Quantidade de dias concluidos do Hablla Sheets",
  );
  return Array.from({ length: safeDays }, (_, index) =>
    saoPauloDayRange(safeDays - index),
  );
}

function log(message, isError = false) {
  const line = `[${new Date().toISOString()}] [${isError ? "ERROR" : "INFO"}] ${message}`;
  (isError ? console.error : console.log)(line);
}

function parseBrazilianDateKey(value) {
  const match = String(value || "").match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (!match) return null;
  return `${match[3]}-${match[2].padStart(2, "0")}-${match[1].padStart(2, "0")}`;
}

function shouldReplaceCardRow(
  row,
  cardIds,
  cutoffDay,
  { preserveUnfetched = false } = {},
) {
  const createdDay = parseBrazilianDateKey(row[1]);
  return (
    cardIds.has(String(row[14] || "")) ||
    (!preserveUnfetched && Boolean(createdDay && createdDay >= cutoffDay))
  );
}

function mergeCardSnapshots(cardsById, cards) {
  for (const card of cards) {
    const id = String(card.id || "");
    const updatedAt = new Date(card.updated_at).getTime();
    if (!id || !Number.isFinite(updatedAt)) {
      throw new Error("Hablla retornou card invalido ao consolidar coletas");
    }
    const current = cardsById.get(id);
    if (!current || updatedAt >= current.updatedAt) {
      cardsById.set(id, { card, updatedAt });
    }
  }
}

async function collectCardSnapshots({
  hablla,
  workspaceId,
  boardId,
  cutoff,
  exhaustive,
  passes,
  attempts,
  collect = collectHabllaCards,
  wait = sleep,
}) {
  const cardsById = new Map();
  for (let pass = 1; pass <= passes; pass += 1) {
    let cards;
    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      try {
        log(`Coleta de cards ${pass}/${passes}, tentativa ${attempt}/${attempts}`);
        cards = await collect({
          hablla,
          workspaceId,
          boardId,
          cutoff,
          exhaustive,
        });
        break;
      } catch (error) {
        if (attempt === attempts) throw error;
        const waitMs = backoffMs(attempt - 1, {
          baseMs: 5000,
          maxMs: 30000,
        });
        log(`Coleta inconsistente; reiniciando em ${Math.ceil(waitMs / 1000)}s`);
        await wait(waitMs);
      }
    }
    mergeCardSnapshots(cardsById, cards);
    log(`Coleta ${pass}/${passes} concluida; ${cardsById.size} cards unicos`);
  }
  return [...cardsById.values()].map(({ card }) => card);
}

function uniqueAttendantRows(rows) {
  const value = (row, index) => String(row[index] || "").trim();
  const byKey = new Map();
  for (const row of rows) {
    const sector = value(row, 2) || value(row, 3);
    const user = value(row, 4) || value(row, 6) || value(row, 5);
    const connection = value(row, 10) || `${value(row, 11)}|${value(row, 12)}`;
    const hasStableKey = sector && user && connection !== "|";
    const key = hasStableKey
      ? JSON.stringify([value(row, 0), sector, user, connection])
      : `row:${JSON.stringify(row)}`;
    byKey.set(key, row);
  }
  return [...byKey.values()];
}

function assertEmptyAttendantDaysAreSafe(emptyLabels, existingValues) {
  const existingLabels = new Set(
    (Array.isArray(existingValues) ? existingValues : []).map((row) =>
      String(row?.[0] || "").split(" ")[0],
    ),
  );
  const protectedLabels = emptyLabels.filter((label) =>
    existingLabels.has(label),
  );
  if (protectedLabels.length) {
    throw new Error(
      `Hablla retornou zero atendentes em ${protectedLabels.length} dias que ja possuem linhas; substituicao cancelada`,
    );
  }
}

function formatBrazilianDateTime(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date
    .toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })
    .replace(",", "");
}

function assertRowWidth(rows, width, dataset) {
  const invalidIndex = rows.findIndex((row) => row.length !== width);
  if (invalidIndex !== -1) {
    throw new Error(
      `${dataset} gerou largura ${rows[invalidIndex].length}; esperado ${width}`,
    );
  }
}

function customFieldHeader(id) {
  return CUSTOM_FIELD_DISPLAY_NAMES[id] || `custom_field.${id}`;
}

function customFieldIdForHeader(header) {
  if (header.startsWith("custom_field.")) {
    return header.slice("custom_field.".length);
  }
  return Object.entries(CUSTOM_FIELD_DISPLAY_NAMES)
    .find(([, display]) => display === header)?.[0] || "";
}

function cellValue(value) {
  if (value === null || value === undefined || value === "") return "";
  return typeof value === "object" ? JSON.stringify(value) : value;
}

function columnLetter(index) {
  let value = index + 1;
  let result = "";
  while (value > 0) {
    value -= 1;
    result = String.fromCharCode(65 + (value % 26)) + result;
    value = Math.floor(value / 26);
  }
  return result;
}

function discoverCardHeaders(cards, currentHeader = CARD_HEADERS) {
  const header = [...currentHeader].map((value) => String(value || "").trim());
  if (!header.length || header.every((value) => !value)) header.push(...CARD_HEADERS);
  if (header.length < CARD_HEADERS.length ||
      CARD_HEADERS.some((value, index) => header[index] !== value)) {
    throw new Error("Cabecalho existente da Base Hablla Card nao corresponde as colunas atuais; escrita cancelada");
  }
  if (header.some((value) => !value) || new Set(header).size !== header.length) {
    throw new Error("Cabecalho existente da Base Hablla Card possui coluna vazia ou duplicada");
  }

  const known = new Set(header);
  for (const phoneHeader of PHONE_HEADERS) {
    if (!known.has(phoneHeader)) {
      header.push(phoneHeader);
      known.add(phoneHeader);
    }
  }

  const discovered = new Set();
  for (const card of cards) {
    for (const key of Object.keys(card)) {
      if (!BASE_CARD_KEYS.has(key)) discovered.add(`card.${key}`);
    }
    for (const field of Array.isArray(card.custom_fields) ? card.custom_fields : []) {
      const id = field?.custom_field == null ? "" : String(field.custom_field);
      if (id && !BASE_CUSTOM_FIELD_IDS.has(id) && id !== PHONE_CUSTOM_FIELD_ID) {
        discovered.add(customFieldHeader(id));
      }
    }
  }

  const knownCustomIds = new Set(header.map(customFieldIdForHeader).filter(Boolean));
  const additions = [...discovered]
    .filter((value) => !known.has(value) && !knownCustomIds.has(customFieldIdForHeader(value)))
    .sort((left, right) => left.localeCompare(right, "en"));
  return [...header, ...additions];
}

function buildCardSheet(cards, currentHeader, collaboratorNames = {}) {
  const header = discoverCardHeaders(cards, currentHeader);
  const rows = cards.map((card) => {
    const fields = new Map();
    for (const field of Array.isArray(card.custom_fields) ? card.custom_fields : []) {
      const id = field?.custom_field == null ? "" : String(field.custom_field);
      if (id) fields.set(id, field.value);
    }
    const customFields = [
      "67b39131ee792966f3fba492",
      "67b608470787782ce7acafba",
      "67dc6a0a17925c23d8365708",
      "679120ec177ff6d2c7597156",
    ].map((id) => fields.get(id) ?? "");
    const userId = card.user && typeof card.user === "object"
      ? card.user.id || ""
      : card.user || "";
    const base = [
      GoogleSheets.dateTimeCell(formatBrazilianDateTime(card.updated_at)),
      GoogleSheets.dateTimeCell(formatBrazilianDateTime(card.created_at)),
      card.workspace || "", card.board || "", card.list || "",
      ...customFields.slice(0, 3),
      card.name || "", card.description || "", card.source || "",
      card.status || "", userId,
      GoogleSheets.dateTimeCell(formatBrazilianDateTime(card.finished_at)),
      card.id, collaboratorNames[userId] || "", customFields[3],
      (card.tags || []).map((tag) => tag.name).join(", "),
    ];
    return header.map((name, index) => {
      if (index < CARD_HEADERS.length) return base[index];
      if (name === "Telefone") return cellValue(card.phone);
      if (name === "Telefone (Campo)") return cellValue(fields.get(PHONE_CUSTOM_FIELD_ID));
      const id = customFieldIdForHeader(name);
      if (id) return cellValue(fields.get(id));
      if (name.startsWith("card.")) return cellValue(card[name.slice(5)]);
      return "";
    });
  });
  assertRowWidth(rows, header.length, "Base Hablla Card");
  return { header, rows };
}

async function run() {
  try {
    const {
      GOOGLE_TOKEN,
      HABLLA_WORKSPACE_ID,
      HABLLA_BOARD_ID,
      HABLLA_SPREADSHEET_ID,
      HABLLA_COLLABORATORS_SPREADSHEET_ID,
    } = process.env;
    const datasets = selectedDatasets(process.env.HABLLA_SHEETS_DATASETS);
    const allowEmpty = booleanOption(
      process.env.HABLLA_SHEETS_ALLOW_EMPTY_REPLACEMENT,
      false,
      "HABLLA_SHEETS_ALLOW_EMPTY_REPLACEMENT",
    );

    if (!GOOGLE_TOKEN) throw new Error("GOOGLE_TOKEN ausente");
    if (!HABLLA_WORKSPACE_ID) throw new Error("HABLLA_WORKSPACE_ID ausente");
    if (datasets.has("cards") && !HABLLA_BOARD_ID) {
      throw new Error("HABLLA_BOARD_ID ausente");
    }
    if (!HABLLA_SPREADSHEET_ID) {
      throw new Error("HABLLA_SPREADSHEET_ID ausente");
    }
    if (!HABLLA_COLLABORATORS_SPREADSHEET_ID) {
      throw new Error("HABLLA_COLLABORATORS_SPREADSHEET_ID ausente");
    }

    const sheets = new GoogleSheets({
      spreadsheetId: HABLLA_SPREADSHEET_ID,
      accessToken: GOOGLE_TOKEN,
    });
    const collaboratorsSheets = new GoogleSheets({
      spreadsheetId: HABLLA_COLLABORATORS_SPREADSHEET_ID,
      accessToken: GOOGLE_TOKEN,
    });
    const hablla = await getHabllaClient();

    log("Validando abas no Google Sheets...");
    const sheetIds = await sheets.getSheetIdByTitle();
    if (datasets.has("cards") && sheetIds["Base Hablla Card"] === undefined) {
      throw new Error("Aba Base Hablla Card nao encontrada");
    }
    if (
      datasets.has("attendants") &&
      sheetIds["Base Atendente"] === undefined
    ) {
      throw new Error("Aba Base Atendente nao encontrada");
    }

    log("Mapeando colaboradores...");
    const collaboratorRows = await collaboratorsSheets.getValues(
      "'Base_de_Colaboradores'!A:M",
    );
    const collaboratorNames = {};
    for (const row of collaboratorRows) {
      if (row[12]) collaboratorNames[row[12]] = row[0] || "";
    }

    if (datasets.has("cards")) {
      const cardDays = positiveInteger(
        process.env.HABLLA_CARDS_DAYS,
        7,
        "HABLLA_CARDS_DAYS",
      );
      const cardRange = saoPauloDayRange(cardDays);
      const exhaustive = booleanOption(
        process.env.HABLLA_CARDS_EXHAUSTIVE,
        false,
        "HABLLA_CARDS_EXHAUSTIVE",
      );
      const passes = positiveInteger(
        process.env.HABLLA_CARDS_CRAWL_PASSES,
        1,
        "HABLLA_CARDS_CRAWL_PASSES",
      );
      const attempts = positiveInteger(
        process.env.HABLLA_CARDS_CRAWL_ATTEMPTS,
        1,
        "HABLLA_CARDS_CRAWL_ATTEMPTS",
      );
      const preserveUnfetched = booleanOption(
        process.env.HABLLA_CARDS_PRESERVE_UNFETCHED,
        true,
        "HABLLA_CARDS_PRESERVE_UNFETCHED",
      );
      log(`Sincronizando cards da janela de ${cardDays} dias...`);
      const cards = await collectCardSnapshots({
        hablla,
        workspaceId: HABLLA_WORKSPACE_ID,
        boardId: HABLLA_BOARD_ID,
        cutoff: cardRange.start,
        exhaustive,
        passes,
        attempts,
      });
      const existingHeaderRows = await sheets.getValues(
        "'Base Hablla Card'!A1:ZZ1",
      );
      const existingHeader = existingHeaderRows.find((row) =>
        row.some((value) => String(value || "").trim()),
      ) || CARD_HEADERS;
      const { header: cardHeader, rows: cardRows } = buildCardSheet(
        cards,
        existingHeader,
        collaboratorNames,
      );
      const columnRange = `A:${columnLetter(cardHeader.length - 1)}`;
      const addedColumns = cardHeader.length - existingHeader.length;
      if (addedColumns > 0) {
        log(`Adicionando ${addedColumns} colunas novas a direita; Telefone e Telefone (Campo) tem prioridade.`);
      }
      if (!cardRows.length && !allowEmpty) {
        throw new Error("Hablla retornou zero cards; substituicao cancelada");
      }

      const cardIds = new Set(cardRows.map((row) => String(row[14])));
      const cardResult = await sheets.replaceRows({
        sheetTitle: "Base Hablla Card",
        columnRange,
        header: cardHeader,
        newRows: cardRows,
        matchColumnIndexes: [1, 14],
        shouldReplace: (row) =>
          shouldReplaceCardRow(row, cardIds, cardRange.day, {
            preserveUnfetched,
          }),
      });
      log(`${cardResult.removed} cards substituidos por ${cardResult.inserted}.`);
    }

    if (datasets.has("attendants")) {
      const attendantRanges = completedDayRanges(
        process.env.HABLLA_SHEETS_ATTENDANTS_DAYS || 1,
      );
      log(
        `Sincronizando atendentes de ${attendantRanges.length} dias concluidos...`,
      );
      const rawAttendantRows = [];
      const attendantLabels = new Set();
      const emptyAttendantLabels = [];
      for (const range of attendantRanges) {
        const attendantsResponse = await hablla.get(
          `/v1/workspaces/${HABLLA_WORKSPACE_ID}/reports/services/summary`,
          {
            params: { start_date: range.start, end_date: range.end },
          },
        );
        const rangeRows = extractAttendants(attendantsResponse.data).map((item) => {
            const user = item.user || {};
            const sector = item.sector || {};
            const connection = item.connection || {};
            return [
              GoogleSheets.dateCell(range.label),
              HABLLA_WORKSPACE_ID,
              sector.id || "",
              sector.name || "",
              user.id || "",
              collaboratorNames[user.id] || "",
              user.email || "",
              item.total_services ?? 0,
              item.tme ?? 0,
              item.tma ?? 0,
              connection.id || "",
              connection.name || "",
              connection.type || "",
              item.total_csat ?? 0,
              item.total_csat_greater_4 ?? 0,
              item.csat ?? 0,
              item.total_fcr ?? 0,
            ];
          });
        rawAttendantRows.push(...rangeRows);
        if (rangeRows.length || allowEmpty) {
          attendantLabels.add(range.label);
        } else {
          emptyAttendantLabels.push(range.label);
        }
      }
      if (emptyAttendantLabels.length) {
        const existingDates = await sheets.getValues("'Base Atendente'!A2:A");
        assertEmptyAttendantDaysAreSafe(emptyAttendantLabels, existingDates);
        log(
          `${emptyAttendantLabels.length} dias sem atendentes foram preservados sem remocao.`,
        );
      }
      const attendantRows = uniqueAttendantRows(rawAttendantRows);
      assertRowWidth(attendantRows, ATTENDANT_HEADERS.length, "Base Atendente");
      if (!attendantRows.length && !allowEmpty) {
        throw new Error("Hablla retornou zero atendentes; substituicao cancelada");
      }
      const attendantResult = await sheets.replaceRows({
        sheetTitle: "Base Atendente",
        columnRange: "A:Q",
        header: ATTENDANT_HEADERS,
        newRows: attendantRows,
        matchColumnIndexes: [0],
        shouldReplace: (row) =>
          attendantLabels.has(String(row[0] || "").split(" ")[0]),
      });
      log(
        `${attendantResult.removed} atendentes substituidos por ${attendantResult.inserted}.`,
      );
    }
    log("Sincronizacao Hablla concluida.");
  } catch (error) {
    log(`Falha na sincronizacao: ${formatPublicError(error)}`, true);
    process.exitCode = 1;
  }
}

module.exports = run;
module.exports.uniqueAttendantRows = uniqueAttendantRows;
module.exports._internals = {
  CARD_HEADERS,
  PHONE_HEADERS,
  assertEmptyAttendantDaysAreSafe,
  booleanOption,
  buildCardSheet,
  collectCardSnapshots,
  completedDayRanges,
  discoverCardHeaders,
  selectedDatasets,
  shouldReplaceCardRow,
};
if (require.main === module) run();
