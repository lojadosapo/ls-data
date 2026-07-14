const GoogleSheets = require("../../google/sheets");
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

function log(message, isError = false) {
  const line = `[${new Date().toISOString()}] [${isError ? "ERROR" : "INFO"}] ${message}`;
  (isError ? console.error : console.log)(line);
}

function parseBrazilianDateKey(value) {
  const match = String(value || "").match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (!match) return null;
  return `${match[3]}-${match[2].padStart(2, "0")}-${match[1].padStart(2, "0")}`;
}

function shouldReplaceCardRow(row, cardIds, cutoffDay) {
  const createdDay = parseBrazilianDateKey(row[1]);
  return (
    cardIds.has(String(row[14] || "")) ||
    Boolean(createdDay && createdDay >= cutoffDay)
  );
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

    if (!GOOGLE_TOKEN) throw new Error("GOOGLE_TOKEN ausente");
    if (!HABLLA_WORKSPACE_ID) throw new Error("HABLLA_WORKSPACE_ID ausente");
    if (!HABLLA_BOARD_ID) throw new Error("HABLLA_BOARD_ID ausente");
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
    if (sheetIds["Base Hablla Card"] === undefined) {
      throw new Error("Aba Base Hablla Card nao encontrada");
    }
    if (sheetIds["Base Atendente"] === undefined) {
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

    const sevenDays = saoPauloDayRange(7);
    log("Sincronizando cards atualizados nos ultimos 7 dias...");
    const cards = await collectHabllaCards({
      hablla,
      workspaceId: HABLLA_WORKSPACE_ID,
      boardId: HABLLA_BOARD_ID,
      cutoff: sevenDays.start,
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

    const cardIds = new Set(cardRows.map((row) => String(row[14])));
    const cardResult = await sheets.replaceRows({
      sheetTitle: "Base Hablla Card",
      columnRange: "A:R",
      header: CARD_HEADERS,
      newRows: cardRows,
      matchColumnIndexes: [1, 14],
      shouldReplace: (row) =>
        shouldReplaceCardRow(row, cardIds, sevenDays.day),
    });
    log(`${cardResult.removed} cards substituidos por ${cardResult.inserted}.`);

    const yesterday = saoPauloDayRange(1);
    log(`Sincronizando atendentes de ${yesterday.day}...`);
    const attendantsResponse = await hablla.get(
      `/v1/workspaces/${HABLLA_WORKSPACE_ID}/reports/services/summary`,
      {
        params: { start_date: yesterday.start, end_date: yesterday.end },
      },
    );
    const rawAttendantRows = extractAttendants(attendantsResponse.data).map(
      (item) => {
        const user = item.user || {};
        const sector = item.sector || {};
        const connection = item.connection || {};
        return [
          GoogleSheets.dateCell(yesterday.label),
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
      },
    );
    const attendantRows = uniqueAttendantRows(rawAttendantRows);
    assertRowWidth(attendantRows, ATTENDANT_HEADERS.length, "Base Atendente");

    const attendantResult = await sheets.replaceRows({
      sheetTitle: "Base Atendente",
      columnRange: "A:Q",
      header: ATTENDANT_HEADERS,
      newRows: attendantRows,
      matchColumnIndexes: [0],
      shouldReplace: (row) =>
        String(row[0] || "").startsWith(yesterday.label),
    });
    log(
      `${attendantResult.removed} atendentes substituidos por ${attendantResult.inserted}.`,
    );
    log("Sincronizacao Hablla concluida.");
  } catch (error) {
    log(`Falha na sincronizacao: ${formatPublicError(error)}`, true);
    process.exitCode = 1;
  }
}

module.exports = run;
module.exports.uniqueAttendantRows = uniqueAttendantRows;
module.exports._internals = { shouldReplaceCardRow };
if (require.main === module) run();
