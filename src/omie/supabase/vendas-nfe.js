const formatPublicError = require("../../lib/public-error");
const { formatDate, runOmieSupabaseSync } = require("./sync");

async function run() {
  return runOmieSupabaseSync({
    label: "pedidos de venda e NF-e",
    table: "raw_omie_vendas_nfe",
    idPrefix: "vendas-nfe",
    daysEnv: "OMIE_VENDAS_DAYS",
    endpoint: "/produtos/pedido/",
    call: "ListarPedidos",
    listKey: "pedido_venda_produto",
    totalPagesKeys: ["total_de_paginas"],
    buildParams: ({ page, pageSize, startDate, endDate }) => ({
      pagina: page,
      registros_por_pagina: pageSize,
      apenas_importado_api: "N",
      data_faturamento_de: formatDate(startDate),
      data_faturamento_ate: formatDate(endDate),
      status_pedido: "FATURADO",
    }),
    getRecordId: (record) => record.cabecalho?.codigo_pedido ?? record.codigo_pedido,
  });
}

module.exports = run;
if (require.main === module) {
  run().catch((error) => {
    console.error("[raw_omie_vendas_nfe] Erro:", formatPublicError(error));
    process.exitCode = 1;
  });
}
