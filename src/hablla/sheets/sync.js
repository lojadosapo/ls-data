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
      const customFieldIds = [
        "67b39131ee792966f3fba492",
        "67b608470787782ce7acafba",
        "67dc6a0a17925c23d8365708",
        "679120ec177ff6d2c7597156",
      ];
      const cardRows = cards.map((card) => {
        const customFields = ["", "", "", ""];
        for (const field of card.custom_fields || []) {
          const index = customFieldIds.indexOf(field.custom_field);
          if (index !== -1) customFields[index] = field.value;
        }
        const userId =
          card.user && typeof card.user === "object"
            ? card.user.id || ""
            : card.user || "";
        return [
          GoogleSheets.dateTimeCell(formatBrazilianDateTime(card.updated_at)),
          GoogleSheets.dateTimeCell(formatBrazilianDateTime(card.created_at)),
          card.workspace || "",
          card.board || "",
          card.list || "",
          customFields[0],
          customFields[1],
          customFields[2],
          card.name || "",
          card.description || "",
          card.source || "",
          card.status || "",
          userId,
          GoogleSheets.dateTimeCell(formatBrazilianDateTime(card.finished_at)),
          card.id,
          collaboratorNames[userId] || "",
          customFields[3],
          (card.tags || []).map((tag) => tag.name).join(", "),
        ];
      });
      assertRowWidth(cardRows, CARD_HEADERS.length, "Base Hablla Card");
      if (!cardRows.length && !allowEmpty) {
        throw new Error("Hablla retornou zero cards; substituicao cancelada");
      }

      const cardIds = new Set(cardRows.map((row) => String(row[14])));
      const cardResult = await sheets.replaceRows({
        sheetTitle: "Base Hablla Card",
        columnRange: "A:R",
        header: CARD_HEADERS,
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
  assertEmptyAttendantDaysAreSafe,
  booleanOption,
  collectCardSnapshots,
  completedDayRanges,
  selectedDatasets,
  shouldReplaceCardRow,
};
if (require.main === module) run();
