/**
 * Runner local para testar as integrações
 * Uso: node run-local.js [nome-do-script]
 *
 * Exemplos:
 *   node run-local.js                     → roda todos
 *   node run-local.js hablla-attendants   → só hablla attendants
 *   node run-local.js hablla-cards
 *   node run-local.js hablla-clients
 *   node run-local.js service-order
 *   node run-local.js service-order-recent
 *   node run-local.js omie-vendas-nfe
 *   node run-local.js omie-servicos-nfse
 *   node run-local.js omie-financas
 */

require('dotenv').config();

const scripts = {
  'hablla-attendants': require('./src/hablla/hablla-attendants'),
  'hablla-cards':   require('./src/hablla/hablla-cards'),
  'hablla-clients': require('./src/hablla/hablla-clients'),
  'service-order': require('./src/zoho/zoho-service-order'),
  'service-order-recent': require('./src/zoho/zoho-service-order-recent'),
  'omie-vendas-nfe': require('./src/omie/omie-vendas-nfe'),
  'omie-servicos-nfse': require('./src/omie/omie-servicos-nfse'),
  'omie-financas': require('./src/omie/omie-financas')
};

async function main() {
  const args = process.argv.slice(2);

  if (args.length === 0) {
    for (const [name, fn] of Object.entries(scripts)) {
      console.log(`\n========== ${name} ==========`);
      await fn();
    }
  } else {
    for (const arg of args) {
      const fn = scripts[arg];
      if (!fn) {
        console.error(`Script desconhecido: "${arg}". Opções: ${Object.keys(scripts).join(', ')}`);
        process.exit(1);
      }
      console.log(`\n========== ${arg} ==========`);
      await fn();
    }
  }

  console.log('\nTodos os scripts finalizados.');
}

main().catch(err => {
  console.error('Erro no runner:', err);
  process.exit(1);
});
