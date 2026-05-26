const callOmieAPI = require('./omie-auth');
const supabase = require('../lib/supabase');
const formatPublicError = require('../lib/public-error');
const fs = require('fs');
const path = require('path');

/**
 * Sincroniza registros de Finanças (Contas a Receber) do Omie para Supabase
 * Retorna todos os dados brutos da API Omie sem mapeamento adicional
 */
async function run() {
  try {
    console.log('[raw_omie_financas] Sincronizando registros de Finanças...');

    const days = Number(process.env.OMIE_FINANCAS_DAYS || 15);
    if (!Number.isInteger(days) || days < 1) {
      throw new Error('OMIE_FINANCAS_DAYS precisa ser inteiro >= 1');
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

    console.log(`[raw_omie_financas] Buscando contas a receber de ${formatDate(dataInicial)} até ${formatDate(dataFinal)}...`);

    const allRecords = [];
    let pagina = 1;
    const registrosPorPagina = 50;
    let totalPaginas = 1;

    // Paginar através de todas as contas a receber
    while (pagina <= totalPaginas) {
      const params = {
        pagina,
        registros_por_pagina: registrosPorPagina,
        apenas_importado_api: 'N',
        filtrar_por_data_de: formatDate(dataInicial),
        filtrar_por_data_ate: formatDate(dataFinal)
      };

      const response = await callOmieAPI('/financas/contareceber/', 'ListarContasReceber', [params]);

      if (response.conta_receber_cadastro) {
        for (const conta of response.conta_receber_cadastro) {
          allRecords.push({
            external_id: `financas-${conta.codigo_lancamento_omie || conta.codigo_lancamento}`,
            payload: conta
          });
        }
      }

      // Atualizar total de páginas
      if (response.total_de_paginas) {
        totalPaginas = response.total_de_paginas;
      }

      console.log(`[raw_omie_financas] Página ${pagina}/${totalPaginas} processada. Registros encontrados: ${allRecords.length}`);
      pagina++;
    }

    if (!allRecords.length) {
      console.log('[raw_omie_financas] Nenhum registro encontrado.');
      fs.writeFileSync(path.join(__dirname, '../../output/omie-financas.json'), '[]');
      return [];
    }

    // Salvar localmente
    const outputDir = path.join(__dirname, '../../output');
    fs.mkdirSync(outputDir, { recursive: true });
    fs.writeFileSync(path.join(outputDir, 'omie-financas.json'), JSON.stringify(allRecords, null, 2));
    console.log(`[raw_omie_financas] JSON salvo em output/omie-financas.json`);

    // Tentar salvar no Supabase, mas não abortar se falhar
    try {
      const { error } = await supabase
        .from('raw_omie_financas')
        .upsert(allRecords, { onConflict: 'external_id' });

      if (error) {
        console.error('[raw_omie_financas] Aviso: erro ao salvar no Supabase:', formatPublicError(error));
        console.log('[raw_omie_financas] Dados retornados mesmo assim para validação.');
      } else {
        console.log(`[raw_omie_financas] ${allRecords.length} registros enviados ao Supabase.`);
      }
    } catch (supaErr) {
      console.error('[raw_omie_financas] Aviso: exceção ao salvar no Supabase:', supaErr.message);
      console.log('[raw_omie_financas] Dados retornados mesmo assim para validação.');
    }

    return allRecords;
  } catch (err) {
    console.error('[raw_omie_financas] Erro:', formatPublicError(err));
    process.exit(1);
  }
}

module.exports = run;
if (require.main === module) run();