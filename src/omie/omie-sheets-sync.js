const axios = require("axios");
const { getGoogleAccessToken } = require("../google/google-auth");
const GoogleSheets = require("../google/google-sheets");

const OMIE_BASE_URL = "https://app.omie.com.br/api/v1";
const TZ = "America/Sao_Paulo";
const PAGE_SIZE_VARIATION = Date.now() % 7;

const PRODUCT_SHEET = "Produtos e Servicos";
const VENDOR_SHEET = "Vendedor";

function secureLog(message, isError = false) {
  const level = isError ? "ERROR" : "INFO";
  console.log(`[${new Date().toISOString()}] [${level}] ${message}`);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizeText(value) {
  return String(value || "")
    .normalize("NFC")
    .trim()
    .toLocaleLowerCase("pt-BR");
}

function todayInSaoPaulo() {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());

  const get = (type) => Number(parts.find((part) => part.type === type)?.value);
  return new Date(Date.UTC(get("year"), get("month") - 1, get("day")));
}

function addDays(date, days) {
  const result = new Date(date.getTime());
  result.setUTCDate(result.getUTCDate() + days);
  return result;
}

function dateKey(date) {
  return date.toISOString().slice(0, 10);
}

function formatDateBR(date) {
  const day = String(date.getUTCDate()).padStart(2, "0");
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const year = date.getUTCFullYear();
  return `${day}/${month}/${year}`;
}

function parseDateValue(value) {
  if (value == null || value === "") return null;

  if (typeof value === "number") {
    const millis = Math.round((value - 25569) * 86400000);
    return new Date(millis).toISOString().slice(0, 10);
  }

  const text = String(value).trim();
  const br = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (br) {
    return `${br[3]}-${String(br[2]).padStart(2, "0")}-${String(br[1]).padStart(2, "0")}`;
  }

  const iso = text.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;

  const parsed = new Date(text);
  if (!Number.isNaN(parsed.getTime())) return parsed.toISOString().slice(0, 10);
  return null;
}

function parseOmieDate(value) {
  const key = parseDateValue(value);
  return key ? new Date(`${key}T00:00:00.000Z`) : null;
}

function toNumber(value) {
  if (value == null || value === "") return 0;
  if (typeof value === "number") return value;
  let normalized = String(value).replace("R$", "").trim();
  if (normalized.includes(",") && normalized.includes(".")) {
    normalized = normalized.replace(/\./g, "").replace(",", ".");
  } else if (normalized.includes(",")) {
    normalized = normalized.replace(",", ".");
  }
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : 0;
}

function cleanNumber(value) {
  const rounded = Math.round(toNumber(value) * 100) / 100;
  return Number.isInteger(rounded) ? rounded : Number(rounded.toFixed(2));
}

function numericDoc(value) {
  if (value == null || value === "") return "N/D";
  const digits = String(value).replace(/\D/g, "");
  return digits ? Number(digits) : String(value).trim();
}

function documentRoot(value) {
  if (value == null || value === "") return "N/D";
  const left = String(value).split("/")[0];
  const leftDigits = left.replace(/\D/g, "");
  if (leftDigits) return Number(leftDigits);
  const digits = String(value).replace(/\D/g, "");
  if (digits.length > 3 && digits.endsWith("001"))
    return Number(digits.slice(0, -3));
  return digits ? Number(digits) : String(value).trim();
}

function financialDocumentNumber(value) {
  return documentRoot(value);
}

function documentDisplay(value) {
  if (value == null || value === "") return "N/D";
  const text = String(value).trim();
  if (text.includes("/")) return text;
  const digits = text.replace(/\D/g, "");
  if (digits.length > 3 && digits.endsWith("001")) {
    const core = digits.slice(0, -3);
    return `${core.padStart(9, "0")}/001`;
  }
  return text;
}

function paddedDoc(value, size) {
  if (value == null || value === "") return "N/D";
  const digits = String(value).replace(/\D/g, "");
  return digits ? digits.padStart(size, "0") : String(value).trim();
}

function cleanDescription(value) {
  let text = String(value || "")
    .replace(/&quot;/g, '"')
    .trim();
  if (!text) return "";
  const letters = [...text].filter((char) => /\p{L}/u.test(char));
  if (
    letters.length &&
    letters.every((char) => char === char.toLocaleUpperCase("pt-BR"))
  ) {
    text = text
      .toLocaleLowerCase("pt-BR")
      .replace(/(^|\s|\/|-)(\p{L})/gu, (match) =>
        match.toLocaleUpperCase("pt-BR"),
      );
    const replacements = {
      Usb: "USB",
      Hdmi: "HDMI",
      Iphone: "iPhone",
      Ipad: "iPad",
      Imac: "iMac",
      Nmve: "NMVE",
      Ssd: "SSD",
    };
    for (const [from, to] of Object.entries(replacements)) {
      text = text.replaceAll(from, to);
    }
  }
  return text;
}

function parseAccountsFromEnv() {
  const accounts = [];

  if (process.env.OMIE_CREDENTIALS) {
    const credentials = JSON.parse(process.env.OMIE_CREDENTIALS);
    const entries = Array.isArray(credentials)
      ? credentials.map((item, idx) => [
          item.name || `OMIE_CREDENTIALS_${idx + 1}`,
          item,
        ])
      : Object.entries(credentials);

    for (const [name, item] of entries) {
      const appKey = item.appKey || item.app_key || item.OMIE_APP_KEY;
      const appSecret =
        item.appSecret || item.app_secret || item.OMIE_APP_SECRET;
      if (appKey && appSecret) accounts.push({ name, appKey, appSecret });
    }
  }

  if (process.env.OMIE_APP_KEY && process.env.OMIE_APP_SECRET) {
    accounts.push({
      name: process.env.OMIE_ACCOUNT_NAME || "OMIE_APP_KEY",
      appKey: process.env.OMIE_APP_KEY,
      appSecret: process.env.OMIE_APP_SECRET,
    });
  }

  for (let i = 1; i <= 50; i++) {
    const appKey = process.env[`OMIE_APP_KEY_${i}`];
    const appSecret = process.env[`OMIE_APP_SECRET_${i}`];
    if (appKey && appSecret) {
      accounts.push({
        name: process.env[`OMIE_ACCOUNT_NAME_${i}`] || `OMIE_APP_KEY_${i}`,
        appKey,
        appSecret,
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

async function callOmie(account, endpoint, call, param = {}) {
  const body = {
    call,
    app_key: account.appKey,
    app_secret: account.appSecret,
    param: [param],
  };

  for (let attempt = 0; attempt < 4; attempt++) {
    const response = await axios.post(`${OMIE_BASE_URL}${endpoint}`, body, {
      headers: { "Content-Type": "application/json" },
      timeout: 60000,
      validateStatus: () => true,
    });

    if (response.status < 400 && !response.data?.faultstring)
      return response.data;

    const message =
      response.data?.faultstring ||
      response.data?.message ||
      `HTTP ${response.status}`;
    if (message.includes("Consumo redundante") && attempt < 3) {
      const wait =
        Number(message.match(/Aguarde\s+(\d+)\s+segundos/)?.[1] || 10) + 1;
      secureLog(`${call}: aguardando para repetir a chamada`);
      await sleep(Math.min(wait, 60) * 1000);
      continue;
    }
    if (
      message.includes("Nao existem registros") ||
      message.includes("Não existem registros")
    ) {
      return {};
    }
    if (
      attempt < 3 &&
      (response.status >= 500 ||
        message.includes("Broken response") ||
        message.includes("temporariamente") ||
        message.includes("timeout"))
    ) {
      secureLog(`${call}: repetindo chamada temporariamente indisponivel`);
      await sleep((attempt + 1) * 3000);
      continue;
    }
    throw new Error(`${call} falhou na API Omie`);
  }

  throw new Error(`${call} falhou na API Omie`);
}

async function listAll(
  account,
  endpoint,
  call,
  listKey,
  params = {},
  pageSize = 100,
) {
  const rows = [];
  let page = 1;
  let totalPages = 1;
  const effectivePageSize = Math.max(10, pageSize - PAGE_SIZE_VARIATION);
  while (page <= totalPages) {
    const response = await callOmie(account, endpoint, call, {
      pagina: page,
      registros_por_pagina: effectivePageSize,
      apenas_importado_api: "N",
      ...params,
    });
    rows.push(...(response[listKey] || []));
    totalPages = Number(response.total_de_paginas || response.nTotPaginas || 1);
    page++;
  }
  return rows;
}

async function listAllNumbered(
  account,
  endpoint,
  call,
  listKey,
  params = {},
  pageSize = 100,
) {
  const rows = [];
  let page = 1;
  let totalPages = 1;
  const effectivePageSize = Math.max(10, pageSize - PAGE_SIZE_VARIATION);
  while (page <= totalPages) {
    const response = await callOmie(account, endpoint, call, {
      nPagina: page,
      nRegPorPagina: effectivePageSize,
      ...params,
    });
    rows.push(...(response[listKey] || []));
    totalPages = Number(response.nTotPaginas || 1);
    page++;
  }
  return rows;
}

async function collectAccountContext(account) {
  const empresas = await listAll(
    account,
    "/geral/empresas/",
    "ListarEmpresas",
    "empresas_cadastro",
    {},
    100,
  );
  const company = empresas[0] || {};
  const vendedores = await listAll(
    account,
    "/geral/vendedores/",
    "ListarVendedores",
    "cadastro",
    {},
    100,
  );

  return {
    account,
    companyName: company.nome_fantasia || company.razao_social || account.name,
    companyCnpj: company.cnpj || "",
    vendors: new Map(
      vendedores
        .filter((row) => row.codigo != null)
        .map((row) => [Number(row.codigo), row.nome || ""]),
    ),
    clients: new Map(),
  };
}

async function getClientName(ctx, code) {
  if (code == null || code === "") return "";
  const numericCode = Number(code);
  if (!Number.isFinite(numericCode)) return String(code);
  if (ctx.clients.has(numericCode)) return ctx.clients.get(numericCode);

  try {
    const response = await callOmie(
      ctx.account,
      "/geral/clientes/",
      "ConsultarCliente",
      {
        codigo_cliente_omie: numericCode,
      },
    );
    const name =
      response.razao_social || response.nome_fantasia || String(numericCode);
    ctx.clients.set(numericCode, name);
    return name;
  } catch (err) {
    ctx.clients.set(numericCode, String(numericCode));
    return String(numericCode);
  }
}

function getVendorName(ctx, code) {
  const numericCode = Number(code);
  if (!Number.isFinite(numericCode)) return String(code || "");
  return ctx.vendors.get(numericCode) || String(numericCode);
}

async function productNfeNumber(ctx, pedido) {
  const codigoPedido = pedido.cabecalho?.codigo_pedido;
  if (!codigoPedido) return { number: "N/D", date: "" };

  const status = await callOmie(
    ctx.account,
    "/produtos/pedido/",
    "StatusPedido",
    {
      codigo_pedido: codigoPedido,
    },
  );
  const nfe = (status.ListaNfe || [])[0];
  return {
    number: nfe?.numero_nfe || "N/D",
    date: nfe?.data_emissao || "",
  };
}

function collapseProductRows(rows) {
  const grouped = new Map();
  for (const row of rows) {
    const key = [
      row.dateKey,
      normalizeText(row.company),
      row.invoice,
      normalizeText(row.description),
      normalizeText(row.vendor),
    ].join("|");

    if (!grouped.has(key)) {
      grouped.set(key, { ...row, amount: toNumber(row.amount) });
    } else {
      grouped.get(key).amount += toNumber(row.amount);
    }
  }
  return [...grouped.values()].map((row) => ({
    ...row,
    amount: cleanNumber(row.amount),
  }));
}

function buildVendorRowFromAccount(ctx, conta, client, startDate) {
  const rowDate = parseOmieDate(conta.data_emissao) || startDate;
  const document = conta.numero_documento_fiscal || conta.numero_documento;
  return {
    date: rowDate,
    dateKey: dateKey(rowDate),
    document: documentDisplay(document),
    documentNumber: financialDocumentNumber(document),
    vendor: getVendorName(ctx, conta.codigo_vendedor),
    client,
    amount: cleanNumber(conta.valor_documento),
    type: "1. Contas a Receber",
    company: ctx.companyName,
  };
}

async function fetchAccountWindowRows(ctx, startDate, endDate) {
  const dataStart = formatDateBR(startDate);
  const dataEnd = formatDateBR(endDate);
  const productRows = [];
  const serviceRows = [];
  const vendorRows = [];

  const pedidos = await listAll(
    ctx.account,
    "/produtos/pedido/",
    "ListarPedidos",
    "pedido_venda_produto",
    {
      data_faturamento_de: dataStart,
      data_faturamento_ate: dataEnd,
      status_pedido: "FATURADO",
    },
    50,
  );

  const cupons = await listAllNumbered(
    ctx.account,
    "/produtos/cupomfiscalconsultar/",
    "CuponsFiscais",
    "cupons",
    {
      dDtEmissaoDe: dataStart,
      dDtEmissaoAte: dataEnd,
    },
    50,
  );

  const ordens = await listAll(
    ctx.account,
    "/servicos/os/",
    "ListarOS",
    "osCadastro",
    {
      filtrar_por_data_faturamento_de: dataStart,
      filtrar_por_data_faturamento_ate: dataEnd,
      filtrar_por_status: "F",
    },
    50,
  );

  const contas = await listAll(
    ctx.account,
    "/financas/contareceber/",
    "ListarContasReceber",
    "conta_receber_cadastro",
    {
      ordenar_por: "DATA_EMISSAO",
      filtrar_por_emissao_de: dataStart,
      filtrar_por_emissao_ate: dataEnd,
    },
    100,
  );

  const financeByOs = new Map();
  const financeByPedidoCode = new Map();
  const financeByPedidoNumber = new Map();
  for (const conta of contas) {
    if (conta.nCodOS != null) financeByOs.set(Number(conta.nCodOS), conta);
    if (
      conta.nCodPedido != null &&
      !financeByPedidoCode.has(Number(conta.nCodPedido))
    ) {
      financeByPedidoCode.set(Number(conta.nCodPedido), conta);
    }
    if (conta.numero_pedido != null) {
      const orderNumber = documentRoot(conta.numero_pedido);
      if (!financeByPedidoNumber.has(orderNumber))
        financeByPedidoNumber.set(orderNumber, conta);
    }
  }

  for (const pedido of pedidos) {
    const pedidoCode = Number(pedido.cabecalho?.codigo_pedido);
    const pedidoNumber = documentRoot(pedido.cabecalho?.numero_pedido);
    const conta =
      financeByPedidoCode.get(pedidoCode) ||
      financeByPedidoNumber.get(pedidoNumber);
    const nfe = conta
      ? {
          number: conta.numero_documento_fiscal || "N/D",
          date: conta.data_emissao || pedido.infoCadastro?.dFat || "",
        }
      : await productNfeNumber(ctx, pedido);
    const invoiceDate =
      parseOmieDate(nfe.date) ||
      parseOmieDate(pedido.infoCadastro?.dFat) ||
      startDate;
    const vendor = getVendorName(ctx, pedido.informacoes_adicionais?.codVend);

    for (const item of pedido.det || []) {
      const produto = item.produto || {};
      const codigo = String(produto.codigo || "").trim();
      const descricao = cleanDescription(produto.descricao);
      productRows.push({
        date: invoiceDate,
        dateKey: dateKey(invoiceDate),
        company: ctx.companyName,
        invoice: numericDoc(nfe.number),
        invoiceRaw: paddedDoc(nfe.number, 8),
        description:
          codigo && descricao
            ? `${codigo} - ${descricao}`
            : descricao || codigo,
        vendor,
        amount: cleanNumber(produto.valor_total),
      });
    }
  }

  const canceledCouponDocs = new Set();
  for (const cupom of cupons) {
    const header = cupom.cabecalhoCupom || {};
    const info = header.info || {};
    if (info.cCupomCancelado === "S" || info.cCupomDevolvido === "S") {
      canceledCouponDocs.add(documentRoot(header.nNumCupom));
      continue;
    }

    const cupomDate = parseOmieDate(header.dDtEmissaoCupom) || startDate;
    const vendor = getVendorName(ctx, header.idVendedor);
    const invoice = numericDoc(header.nNumCupom);
    const invoiceRaw = paddedDoc(header.nNumCupom, 8);

    for (const item of cupom.itensCupom || []) {
      if (item.cItemCancelado === "S" || item.cItemDevolvido === "S") continue;
      const codigo = String(item.cCodigo || item.emiProduto || "").trim();
      const descricao = cleanDescription(item.xProd);
      productRows.push({
        date: cupomDate,
        dateKey: dateKey(cupomDate),
        company: ctx.companyName,
        invoice,
        invoiceRaw,
        description:
          codigo && descricao
            ? `${codigo} - ${descricao}`
            : descricao || codigo,
        vendor,
        amount: cleanNumber(item.vItem),
      });
    }
  }

  for (const ordem of ordens) {
    const osCode = Number(ordem.Cabecalho?.nCodOS);
    const conta = financeByOs.get(osCode);
    const serviceDate = parseOmieDate(ordem.InfoCadastro?.dDtFat) || startDate;
    const vendor = getVendorName(ctx, ordem.Cabecalho?.nCodVend);
    const client = await getClientName(
      ctx,
      conta?.codigo_cliente_fornecedor || ordem.Cabecalho?.nCodCli,
    );
    const nfs = conta?.numero_documento_fiscal || "N/D";

    for (const servico of [...(ordem.ServicosPrestados || [])].sort((a, b) =>
      String(a.cDescServ || "").localeCompare(
        String(b.cDescServ || ""),
        "pt-BR",
      ),
    )) {
      const quantity = toNumber(servico.nQtde || 1);
      const unit = toNumber(servico.nValUnit);
      const discount = toNumber(servico.nValorDesconto);
      const additions = toNumber(servico.nValorAcrescimos);
      const total = cleanNumber(quantity * unit + additions - discount);
      serviceRows.push({
        date: serviceDate,
        dateKey: dateKey(serviceDate),
        company: ctx.companyName,
        companyCnpj: ctx.companyCnpj,
        nfs: numericDoc(nfs),
        nfsRaw: paddedDoc(nfs, 13),
        receipt: "N/D",
        vendor,
        client,
        description: cleanDescription(servico.cDescServ),
        amount: cleanNumber(quantity * unit),
        discount: cleanNumber(discount),
        total,
        liquid: total,
        categoryCode: servico.cCodCategItem || "",
      });
    }
  }

  for (const conta of contas) {
    const docRoot = documentRoot(
      conta.numero_documento_fiscal || conta.numero_documento,
    );
    if (canceledCouponDocs.has(docRoot)) continue;

    vendorRows.push(
      buildVendorRowFromAccount(
        ctx,
        conta,
        await getClientName(ctx, conta.codigo_cliente_fornecedor),
        startDate,
      ),
    );
  }

  return {
    productRows: collapseProductRows(productRows),
    serviceRows,
    vendorRows,
    rawCounts: {
      pedidos: pedidos.length,
      cupons: cupons.length,
      ordens: ordens.length,
      contas: contas.length,
    },
  };
}

function rowsToMap(rows) {
  const map = new Map();
  for (const row of rows.slice(1)) {
    if (row[0]) map.set(normalizeText(row[0]), row);
  }
  return map;
}

function classify(description, terms) {
  const normalized = normalizeText(description);
  for (const row of terms.slice(1)) {
    const needle = normalizeText(row[0]);
    if (needle && normalized.includes(needle)) return row[1] || "";
  }
  return "";
}

async function loadLookups(sheets) {
  const [productTerms, deviceTerms, typeRows, collaboratorRows, employeeRows] =
    await sheets.getValuesBatch([
      "class_produto!A:B",
      "class_device!A:B",
      "class_Tipo!A:B",
      "_Colaborador!A:B",
      "Colaboradores!A:D",
    ]);

  const typeByCategory = rowsToMap(typeRows);
  const accessByVendor = rowsToMap(collaboratorRows);
  const sectorByVendor = new Map();
  for (const row of employeeRows.slice(1)) {
    if (row[0]) sectorByVendor.set(normalizeText(row[0]), row[3] || "");
  }

  return {
    productTerms,
    deviceTerms,
    typeByCategory,
    accessByVendor,
    sectorByVendor,
  };
}

function prepareFinalRows(productRows, serviceRows, vendorRows, lookups) {
  const finalProductRows = [];

  for (const row of productRows) {
    const category = classify(row.description, lookups.productTerms);
    const productType =
      lookups.typeByCategory.get(normalizeText(category))?.[1] || "";
    const device = classify(row.description, lookups.deviceTerms);
    finalProductRows.push({
      ...row,
      category,
      productType,
      device,
      finalInvoice: row.invoice,
    });
  }

  for (const row of serviceRows) {
    const category = classify(row.description, lookups.productTerms);
    const productType =
      lookups.typeByCategory.get(normalizeText(category))?.[1] || "Serviço";
    const device = classify(row.description, lookups.deviceTerms);
    finalProductRows.push({
      ...row,
      invoice: "N/D",
      finalInvoice: "N/D",
      amount: row.total,
      category,
      productType,
      device,
    });
  }

  const assistanceByDoc = new Map();
  for (const row of finalProductRows) {
    const key = `${normalizeText(row.company)}|${row.finalInvoice}`;
    if (!assistanceByDoc.has(key)) assistanceByDoc.set(key, "Não");
    if (row.productType === "Serviço") assistanceByDoc.set(key, "Sim");
  }

  const productValues = finalProductRows
    .sort((a, b) =>
      `${a.dateKey}|${a.company}|${a.finalInvoice}|${a.description}`.localeCompare(
        `${b.dateKey}|${b.company}|${b.finalInvoice}|${b.description}`,
        "pt-BR",
      ),
    )
    .map((row) => [
      formatDateBR(row.date),
      row.company,
      row.finalInvoice,
      row.description,
      row.vendor,
      row.amount,
      assistanceByDoc.get(
        `${normalizeText(row.company)}|${row.finalInvoice}`,
      ) || "Não",
      row.productType,
      row.category,
      row.device,
      lookups.accessByVendor.get(normalizeText(row.vendor))?.[1] || "#N/A",
    ]);

  const vendorValues = vendorRows
    .sort((a, b) =>
      `${a.dateKey}|${a.company}|${a.documentNumber}|${a.vendor}|${a.amount}`.localeCompare(
        `${b.dateKey}|${b.company}|${b.documentNumber}|${b.vendor}|${b.amount}`,
        "pt-BR",
      ),
    )
    .map((row) => {
      const sector =
        lookups.sectorByVendor.get(normalizeText(row.vendor)) || row.company;
      const category = sector.includes("Comercial - Sede")
        ? "comercial"
        : "unidades";
      return [
        formatDateBR(row.date),
        row.document,
        row.vendor,
        row.client,
        row.amount,
        row.type,
        row.company,
        row.documentNumber,
        assistanceByDoc.get(
          `${normalizeText(row.company)}|${row.documentNumber}`,
        ) || "Não",
        sector,
        category,
        lookups.accessByVendor.get(normalizeText(row.vendor))?.[1] || "#N/A",
      ];
    });

  return { productValues, vendorValues };
}

function rowIndexesForWindow(
  rows,
  { startKey, endKey, companyColumnIndex, companies },
) {
  const indexes = [];
  for (let i = 1; i < rows.length; i++) {
    const key = parseDateValue(rows[i][0]);
    const company = normalizeText(rows[i][companyColumnIndex]);
    if (key && key >= startKey && key <= endKey && companies.has(company)) {
      indexes.push(i);
    }
  }
  return indexes;
}

function googleDateSerial(value) {
  const match = String(value || "").match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!match) return null;
  const timestamp = Date.UTC(
    Number(match[3]),
    Number(match[2]) - 1,
    Number(match[1]),
  );
  return timestamp / 86400000 + 25569;
}

function cellData(value, columnIndex, { allowFormula = false } = {}) {
  if (columnIndex === 0) {
    const serial = googleDateSerial(value);
    if (serial != null) {
      return { userEnteredValue: { numberValue: serial } };
    }
  }

  if (typeof value === "number" && Number.isFinite(value)) {
    return { userEnteredValue: { numberValue: value } };
  }
  if (typeof value === "boolean") {
    return { userEnteredValue: { boolValue: value } };
  }
  if (value == null) {
    return {};
  }
  if (allowFormula && typeof value === "string" && value.startsWith("=")) {
    return { userEnteredValue: { formulaValue: value } };
  }
  return { userEnteredValue: { stringValue: String(value) } };
}

function replacementRequests({
  sheetId,
  gridRowCount,
  columnCount,
  currentRows,
  deleteIndexes,
  newRows,
}) {
  const indexes = new Set(deleteIndexes);
  const preservedRows = currentRows.filter((row, index) => !indexes.has(index));
  const finalRows = [...preservedRows, ...newRows];
  const requiredRowCount = Math.max(currentRows.length, finalRows.length);
  const requests = [];

  if (requiredRowCount > gridRowCount) {
    requests.push({
      appendDimension: {
        sheetId,
        dimension: "ROWS",
        length: requiredRowCount - gridRowCount,
      },
    });
  }

  requests.push({
    updateCells: {
      range: {
        sheetId,
        startRowIndex: 0,
        endRowIndex: requiredRowCount,
        startColumnIndex: 0,
        endColumnIndex: columnCount,
      },
      rows: [
        ...preservedRows.map((row) => ({
          values: row.map((value, columnIndex) =>
            cellData(value, columnIndex, { allowFormula: true }),
          ),
        })),
        ...newRows.map((row) => ({
          values: row.map((value, columnIndex) => cellData(value, columnIndex)),
        })),
      ],
      fields: "userEnteredValue",
    },
  });

  if (finalRows.length > 1) {
    requests.push({
      repeatCell: {
        range: {
          sheetId,
          startRowIndex: 1,
          endRowIndex: finalRows.length,
          startColumnIndex: 0,
          endColumnIndex: 1,
        },
        cell: {
          userEnteredFormat: {
            numberFormat: { type: "DATE", pattern: "dd/MM/yyyy" },
          },
        },
        fields: "userEnteredFormat.numberFormat",
      },
    });
  }

  return requests;
}

function atomicReplacementRequests({
  productSheet,
  vendorSheet,
  currentProductRows,
  currentVendorRows,
  productDeleteIndexes,
  vendorDeleteIndexes,
  productValues,
  vendorValues,
}) {
  return [
    ...replacementRequests({
      sheetId: productSheet.sheetId,
      gridRowCount: productSheet.gridProperties.rowCount,
      columnCount: 11,
      currentRows: currentProductRows,
      deleteIndexes: productDeleteIndexes,
      newRows: productValues,
    }),
    ...replacementRequests({
      sheetId: vendorSheet.sheetId,
      gridRowCount: vendorSheet.gridProperties.rowCount,
      columnCount: 12,
      currentRows: currentVendorRows,
      deleteIndexes: vendorDeleteIndexes,
      newRows: vendorValues,
    }),
  ];
}

async function buildRowsForWindow(accounts, startDate, endDate) {
  const contexts = [];
  for (const account of accounts) {
    const ctx = await collectAccountContext(account);
    contexts.push(ctx);
  }

  const productRows = [];
  const serviceRows = [];
  const vendorRows = [];
  const rawTotals = { pedidos: 0, cupons: 0, ordens: 0, contas: 0 };

  secureLog(
    `Coletando Omie por intervalo: ${formatDateBR(startDate)} ate ${formatDateBR(endDate)}`,
  );
  for (let index = 0; index < contexts.length; index++) {
    const ctx = contexts[index];
    const rows = await fetchAccountWindowRows(ctx, startDate, endDate);
    productRows.push(...rows.productRows);
    serviceRows.push(...rows.serviceRows);
    vendorRows.push(...rows.vendorRows);
    rawTotals.pedidos += rows.rawCounts.pedidos;
    rawTotals.cupons += rows.rawCounts.cupons;
    rawTotals.ordens += rows.rawCounts.ordens;
    rawTotals.contas += rows.rawCounts.contas;
    secureLog(`Fonte Omie ${index + 1}/${contexts.length} processada`);
  }

  secureLog(
    `Coleta concluida: pedidos=${rawTotals.pedidos}, cupons=${rawTotals.cupons}, ` +
      `ordens=${rawTotals.ordens}, contas=${rawTotals.contas}`,
  );
  return { contexts, productRows, serviceRows, vendorRows };
}

async function run() {
  const days = Number(process.env.OMIE_SHEETS_DAYS || 7);
  if (!Number.isInteger(days) || days < 1)
    throw new Error("OMIE_SHEETS_DAYS precisa ser inteiro >= 1");

  const spreadsheetId = process.env.OMIE_SHEETS_SPREADSHEET_ID;
  if (!spreadsheetId) throw new Error("Identificador do Google Sheets ausente");
  const today = todayInSaoPaulo();
  const endDate = today;
  const startDate = addDays(endDate, -(days - 1));

  const accounts = parseAccountsFromEnv();
  if (!accounts.length) throw new Error("Nenhuma credencial Omie configurada");

  secureLog(
    `Janela Omie->Sheets: ${formatDateBR(startDate)} ate ${formatDateBR(endDate)} (${days} dias)`,
  );
  secureLog(`Contas Omie configuradas: ${accounts.length}`);

  const accessToken =
    process.env.GOOGLE_TOKEN || (await getGoogleAccessToken());
  const sheets = new GoogleSheets({ spreadsheetId, accessToken });
  const lookups = await loadLookups(sheets);
  const spreadsheet = await sheets.getSpreadsheet();
  const sheetsByTitle = Object.fromEntries(
    (spreadsheet.sheets || []).map((sheet) => [
      sheet.properties.title,
      sheet.properties,
    ]),
  );

  if (!sheetsByTitle[VENDOR_SHEET] || !sheetsByTitle[PRODUCT_SHEET]) {
    throw new Error(
      `Abas obrigatorias nao encontradas: ${VENDOR_SHEET}, ${PRODUCT_SHEET}`,
    );
  }

  const { contexts, productRows, serviceRows, vendorRows } =
    await buildRowsForWindow(accounts, startDate, endDate);
  const { productValues, vendorValues } = prepareFinalRows(
    productRows,
    serviceRows,
    vendorRows,
    lookups,
  );
  const companies = new Set(
    contexts.map((ctx) => normalizeText(ctx.companyName)),
  );

  secureLog(
    `Linhas novas: ${PRODUCT_SHEET}=${productValues.length}; ${VENDOR_SHEET}=${vendorValues.length}`,
  );

  const [currentProductRows, currentVendorRows] = await sheets.getValuesBatch(
    [`${PRODUCT_SHEET}!A:K`, `${VENDOR_SHEET}!A:L`],
    {
      valueRenderOption: "FORMULA",
      dateTimeRenderOption: "SERIAL_NUMBER",
    },
  );

  const startKey = dateKey(startDate);
  const endKey = dateKey(endDate);
  const productDeleteIndexes = rowIndexesForWindow(currentProductRows, {
    startKey,
    endKey,
    companyColumnIndex: 1,
    companies,
  });
  const vendorDeleteIndexes = rowIndexesForWindow(currentVendorRows, {
    startKey,
    endKey,
    companyColumnIndex: 6,
    companies,
  });

  secureLog(
    `Linhas a remover: ${PRODUCT_SHEET}=${productDeleteIndexes.length}; ${VENDOR_SHEET}=${vendorDeleteIndexes.length}`,
  );

  const requests = atomicReplacementRequests({
    productSheet: sheetsByTitle[PRODUCT_SHEET],
    vendorSheet: sheetsByTitle[VENDOR_SHEET],
    currentProductRows,
    currentVendorRows,
    productDeleteIndexes,
    vendorDeleteIndexes,
    productValues,
    vendorValues,
  });
  secureLog(
    `Aplicando lote atomico no Google Sheets: requests=${requests.length}`,
  );
  await sheets.batchUpdate(requests, { idempotent: true });

  secureLog(
    `Atualizacao atomica confirmada pela API: ` +
      `${PRODUCT_SHEET}=${productValues.length}; ${VENDOR_SHEET}=${vendorValues.length}`,
  );
  return {
    productDeleteCount: productDeleteIndexes.length,
    vendorDeleteCount: vendorDeleteIndexes.length,
    productAppendCount: productValues.length,
    vendorAppendCount: vendorValues.length,
  };
}

module.exports = run;
module.exports._internals = {
  atomicReplacementRequests,
  buildVendorRowFromAccount,
  cellData,
  googleDateSerial,
  replacementRequests,
};

if (require.main === module) {
  run().catch((err) => {
    secureLog(err.message, true);
    process.exit(1);
  });
}
