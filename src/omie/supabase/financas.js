const formatPublicError = require("../../lib/public-error");
const { formatDate, runOmieSupabaseSync } = require("./sync");

async function run() {
  return runOmieSupabaseSync({
    label: "contas a receber",
    table: "raw_omie_financas",
    idPrefix: "financas",
    daysEnv: "OMIE_FINANCAS_DAYS",
    endpoint: "/financas/contareceber/",
    call: "ListarContasReceber",
    listKey: "conta_receber_cadastro",
    totalPagesKeys: ["total_de_paginas"],
    buildParams: ({ page, pageSize, startDate, endDate }) => ({
      pagina: page,
      registros_por_pagina: pageSize,
      apenas_importado_api: "N",
      ordenar_por: "DATA_EMISSAO",
      filtrar_por_emissao_de: formatDate(startDate),
      filtrar_por_emissao_ate: formatDate(endDate),
    }),
    getRecordId: (record) => record.codigo_lancamento_omie ?? record.codigo_lancamento,
  });
}

module.exports = run;
if (require.main === module) {
  run().catch((error) => {
    console.error("[raw_omie_financas] Erro:", formatPublicError(error));
    process.exitCode = 1;
  });
}
