/**
 * Runner local para testar as integrações
 * Uso: node run-local.js [nome-do-script]
 *
 * Exemplos:
 *   node run-local.js                         → roda todo o Omie Supabase
 *   node run-local.js hablla-cards            → roda um coletor específico
 *   node run-local.js zoho-service-order
 *   node run-local.js omie-vendas-nfe
 */

require('dotenv').config();
const formatPublicError = require('./src/lib/public-error');

const scripts = {
  omie: require('./src/omie/supabase/run'),
  'hablla-attendants': require('./src/hablla/supabase/attendants'),
  'hablla-cards': require('./src/hablla/supabase/cards'),
  'hablla-clients': require('./src/hablla/supabase/clients'),
  'zoho-service-order': require('./src/zoho/supabase/service-order'),
  'zoho-service-order-recent': require('./src/zoho/supabase/service-order-recent'),
  'omie-vendas-nfe': require('./src/omie/supabase/vendas-nfe'),
  'omie-servicos-nfse': require('./src/omie/supabase/servicos-nfse'),
  'omie-financas': require('./src/omie/supabase/financas')
};

async function main() {
  const args = process.argv.slice(2);

  if (args.length === 0) {
    console.log('\n========== omie ==========');
    await scripts.omie();
    console.log('omie concluido.');
  } else {
    for (const arg of args) {
      const fn = scripts[arg];
      if (!fn) {
        console.error(`Script desconhecido: "${arg}". Opções: ${Object.keys(scripts).join(', ')}`);
        process.exit(1);
      }
      console.log(`\n========== ${arg} ==========`);
      await fn();
      console.log(`${arg} concluido.`);
    }
  }

  console.log('\nTodos os scripts finalizados.');
}

main().catch(err => {
  console.error('Erro no runner:', formatPublicError(err));
  process.exit(1);
});
