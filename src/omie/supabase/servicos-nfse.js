const formatPublicError = require("../../lib/public-error");
const { formatDate, runOmieSupabaseSync } = require("./sync");

async function run() {
  return runOmieSupabaseSync({
    label: "ordens de servico e NFS-e",
    table: "raw_omie_servicos_nfse",
    idPrefix: "servicos-nfse",
    daysEnv: "OMIE_SERVICOS_DAYS",
    endpoint: "/servicos/os/",
    call: "ListarOS",
    listKey: "osCadastro",
    totalPagesKeys: ["nTotPaginas", "total_de_paginas"],
    buildParams: ({ page, pageSize, startDate, endDate }) => ({
      pagina: page,
      registros_por_pagina: pageSize,
      apenas_importado_api: "N",
      filtrar_por_data_faturamento_de: formatDate(startDate),
      filtrar_por_data_faturamento_ate: formatDate(endDate),
      filtrar_por_status: "F",
    }),
    getRecordId: (record) => record.Cabecalho?.nCodOS ?? record.nCodOS,
  });
}

module.exports = run;
if (require.main === module) {
  run().catch((error) => {
    console.error("[raw_omie_servicos_nfse] Erro:", formatPublicError(error));
    process.exitCode = 1;
  });
}
