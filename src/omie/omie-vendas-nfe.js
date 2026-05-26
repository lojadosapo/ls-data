const callOmieAPI = require('./omie-auth');
const supabase = require('../lib/supabase');
const formatPublicError = require('../lib/public-error');

/**
 * Sincroniza Vendas e NF-e (Produtos) do Omie para Supabase
 * Campos mapeados:
 * - Data de Emissão
 * - Pedido (Número do pedido/venda)
 * - Vendedor (Nome do colaborador responsável)
 * - Cliente (Razão Social)
 * - Total da Nota Fiscal / Valor
 * - Tipo do Produto / Serviço
 * - Minha Empresa (Nome Fantasia)
 * - Nota Fiscal (Número da NF)
 */
async function run() {
  try {
    console.log('[raw_omie_vendas_nfe] Sincronizando Vendas e NF-e...');

    const days = Number(process.env.OMIE_VENDAS_DAYS || 30);
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
        ordenar_por: 'DATA_PREVISAO'
      };

      const response = await callOmieAPI('/produtos/pedido/', 'ListarPedidos', [params]);

      if (response.pedido_venda_produto) {
        for (const pedido of response.pedido_venda_produto) {
          // Extrair os campos principais conforme especificado
          const mappedData = {
            data_emissao: pedido.cabecalho?.data_previsao || pedido.cabecalho?.dDataPrevisao || null,
            pedido_numero: pedido.cabecalho?.numero_pedido || pedido.cabecalho?.codigo_pedido || null,
            vendedor: pedido.cabecalho?.vendedor || null,
            cliente_razao_social: pedido.cabecalho?.nome_cliente || pedido.cliente?.razao_social || null,
            total_nota_fiscal: pedido.total_pedido?.valor_total_pedido || pedido.total_pedido?.vTotPed || 0,
            tipo_produto_servico: 'Produto',
            minha_empresa: pedido.cabecalho?.nome_fantasia || pedido.informacoes_adicionais?.nomeFantasia || null,
            nota_fiscal_numero: pedido.nota_fiscal?.numero || pedido.nota_fiscal?.nNF || null
          };

          allRecords.push({
            external_id: `vendas-nfe-${pedido.cabecalho?.codigo_pedido || pedido.codigo_pedido}`,
            payload: {
              ...pedido,
              _mapped: mappedData
            }
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
      return;
    }

    // Inserir no Supabase
    const { error } = await supabase
      .from('raw_omie_vendas_nfe')
      .upsert(allRecords, { onConflict: 'external_id' });

    if (error) throw error;

    console.log(`[raw_omie_vendas_nfe] ${allRecords.length} registros enviados ao Supabase.`);
  } catch (err) {
    console.error('[raw_omie_vendas_nfe] Erro:', formatPublicError(err));
    process.exit(1);
  }
}

module.exports = run;
if (require.main === module) run();
