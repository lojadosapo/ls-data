const callOmieAPI = require('./omie-auth');
const supabase = require('../lib/supabase');
const formatPublicError = require('../lib/public-error');
const fs = require('fs');
const path = require('path');

/**
 * Sincroniza Vendas e NF-e (Produtos) do Omie para Supabase
 * Retorna todos os dados brutos da API Omie sem mapeamento adicional
 */
async function run() {
  try {
    console.log('[raw_omie_vendas_nfe] Sincronizando Vendas e NF-e...');

    const days = Number(process.env.OMIE_VENDAS_DAYS || 15);
    if (!Number.isInteger(days) || days < 1) {
      throw new Error('OMIE_VENDAS_DAYS precisa ser inteiro >= 1');
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

    console.log(`[raw_omie_vendas_nfe] Buscando pedidos de ${formatDate(dataInicial)} até ${formatDate(dataFinal)}...`);

    const allRecords = [];
    let pagina = 1;
    const registrosPorPagina = 50;
    let totalPaginas = 1;

    // Paginar através de todos os pedidos
    while (pagina <= totalPaginas) {
      const params = {
        pagina,
        registros_por_pagina: registrosPorPagina,
        apenas_importado_api: 'N',
        data_faturamento_de: formatDate(dataInicial),
        data_faturamento_ate: formatDate(dataFinal),
        status_pedido: 'FATURADO'
      };

      const response = await callOmieAPI('/produtos/pedido/', 'ListarPedidos', [params]);

      if (response.pedido_venda_produto) {
        for (const pedido of response.pedido_venda_produto) {
          allRecords.push({
            external_id: `vendas-nfe-${pedido.cabecalho?.codigo_pedido || pedido.codigo_pedido}`,
            payload: pedido
          });
        }
      }

      // Atualizar total de páginas
      if (response.total_de_paginas) {
        totalPaginas = response.total_de_paginas;
      }

      console.log(`[raw_omie_vendas_nfe] Página ${pagina}/${totalPaginas} processada. Registros encontrados: ${allRecords.length}`);
      pagina++;
    }

    if (!allRecords.length) {
      console.log('[raw_omie_vendas_nfe] Nenhum registro encontrado.');
      fs.writeFileSync(path.join(__dirname, '../../output/omie-vendas-nfe.json'), '[]');
      return [];
    }

    // Salvar localmente
    const outputDir = path.join(__dirname, '../../output');
    fs.mkdirSync(outputDir, { recursive: true });
    fs.writeFileSync(path.join(outputDir, 'omie-vendas-nfe.json'), JSON.stringify(allRecords, null, 2));
    console.log(`[raw_omie_vendas_nfe] JSON salvo em output/omie-vendas-nfe.json`);

    // Tentar salvar no Supabase, mas não abortar se falhar
    try {
      const { error } = await supabase
        .from('raw_omie_vendas_nfe')
        .upsert(allRecords, { onConflict: 'external_id' });

      if (error) {
        console.error('[raw_omie_vendas_nfe] Aviso: erro ao salvar no Supabase:', formatPublicError(error));
        console.log('[raw_omie_vendas_nfe] Dados retornados mesmo assim para validação.');
      } else {
        console.log(`[raw_omie_vendas_nfe] ${allRecords.length} registros enviados ao Supabase.`);
      }
    } catch (supaErr) {
      console.error('[raw_omie_vendas_nfe] Aviso: exceção ao salvar no Supabase:', supaErr.message);
      console.log('[raw_omie_vendas_nfe] Dados retornados mesmo assim para validação.');
    }

    return allRecords;
  } catch (err) {
    console.error('[raw_omie_vendas_nfe] Erro:', formatPublicError(err));
    process.exit(1);
  }
}

module.exports = run;
if (require.main === module) run();
