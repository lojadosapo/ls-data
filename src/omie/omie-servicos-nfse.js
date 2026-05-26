const callOmieAPI = require('./omie-auth');
const supabase = require('../lib/supabase');
const formatPublicError = require('../lib/public-error');

/**
 * Sincroniza Serviços e NFS-e do Omie para Supabase
 * Retorna todos os dados brutos da API Omie sem mapeamento adicional
 */
async function run() {
  try {
    console.log('[raw_omie_servicos_nfse] Sincronizando Serviços e NFS-e...');

    const days = Number(process.env.OMIE_SERVICOS_DAYS || 30);
    if (!Number.isInteger(days) || days < 1) {
      throw new Error('OMIE_SERVICOS_DAYS precisa ser inteiro >= 1');
    }

    // Calcular data inicial
    const dataFinal = new Date();
    const dataInicial = new Date();
    dataInicial.setDate(dataFinal.getDate() - days);

    const formatDate = (date) => {
      const day = String(date.getDate()).padStart(2, '0');
      const month = String(date.getMonth() + 1).padStart(2, '0');
      const year = date.getFullYear();
      return `${day}/${month}/${year}`;
    };

    console.log(`[raw_omie_servicos_nfse] Buscando ordens de serviço de ${formatDate(dataInicial)} até ${formatDate(dataFinal)}...`);

    const allRecords = [];
    let pagina = 1;
    const registrosPorPagina = 50;
    let totalPaginas = 1;

    // Paginar através de todas as ordens de serviço
    while (pagina <= totalPaginas) {
      const params = {
        nPagina: pagina,
        nRegPorPagina: registrosPorPagina
      };

      const response = await callOmieAPI('/servicos/os/', 'ListarOS', [params]);

      if (response.osLista) {
        for (const os of response.osLista) {
          allRecords.push({
            external_id: `servicos-nfse-${os.Cabecalho?.nCodOS || os.nCodOS}`,
            payload: os
          });
        }
      }

      // Atualizar total de páginas
      if (response.nTotPaginas) {
        totalPaginas = response.nTotPaginas;
      }

      console.log(`[raw_omie_servicos_nfse] Página ${pagina}/${totalPaginas} processada. Registros encontrados: ${allRecords.length}`);
      pagina++;
    }

    if (!allRecords.length) {
      console.log('[raw_omie_servicos_nfse] Nenhum registro encontrado.');
      return;
    }

    // Inserir no Supabase
    const { error } = await supabase
      .from('raw_omie_servicos_nfse')
      .upsert(allRecords, { onConflict: 'external_id' });

    if (error) throw error;

    console.log(`[raw_omie_servicos_nfse] ${allRecords.length} registros enviados ao Supabase.`);
  } catch (err) {
    console.error('[raw_omie_servicos_nfse] Erro:', formatPublicError(err));
    process.exit(1);
  }
}

module.exports = run;
if (require.main === module) run();
