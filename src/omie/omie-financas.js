const callOmieAPI = require('./omie-auth');
const supabase = require('../lib/supabase');
const formatPublicError = require('../lib/public-error');

/**
 * Sincroniza registros de Finanças (Contas a Receber) do Omie para Supabase
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
    console.log('[raw_omie_financas] Sincronizando registros de Finanças...');

    const days = Number(process.env.OMIE_FINANCAS_DAYS || 30);
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
        apenas_importado_api: 'N'
      };

      const response = await callOmieAPI('/financas/contareceber/', 'ListarContasReceber', [params]);

      if (response.conta_receber_cadastro) {
        for (const conta of response.conta_receber_cadastro) {
          // Extrair os campos principais conforme especificado
          const mappedData = {
            data_emissao: conta.data_emissao || conta.dDtEmissao || null,
            pedido_numero: conta.numero_pedido || conta.numero_documento || conta.codigo_lancamento || null,
            vendedor: conta.vendedor || null,
            cliente_razao_social: conta.razao_social || conta.nome_cliente || null,
            total_nota_fiscal: conta.valor_documento || conta.valor || 0,
            tipo_produto_servico: conta.tipo_documento || 'Financeiro',
            minha_empresa: conta.nome_empresa || null,
            nota_fiscal_numero: conta.numero_nota_fiscal || conta.numero_documento_fiscal || null
          };

          allRecords.push({
            external_id: `financas-${conta.codigo_lancamento_omie || conta.codigo_lancamento}`,
            payload: {
              ...conta,
              _mapped: mappedData
            }
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
      return;
    }

    // Inserir no Supabase
    const { error } = await supabase
      .from('raw_omie_financas')
      .upsert(allRecords, { onConflict: 'external_id' });

    if (error) throw error;

    console.log(`[raw_omie_financas] ${allRecords.length} registros enviados ao Supabase.`);
  } catch (err) {
    console.error('[raw_omie_financas] Erro:', formatPublicError(err));
    process.exit(1);
  }
}

module.exports = run;
if (require.main === module) run();
