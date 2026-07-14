const formatPublicError = require('../../lib/public-error');
const vendas = require('./vendas-nfe');
const servicos = require('./servicos-nfse');
const financas = require('./financas');

const tasks = [
  ['vendas e NF-e', vendas],
  ['serviços e NFS-e', servicos],
  ['finanças', financas],
];

async function run() {
  for (const [name, task] of tasks) {
    console.log(`[omie_supabase] Iniciando ${name}`);
    await task();
  }
  console.log('[omie_supabase] Todas as coletas foram concluídas');
}

module.exports = run;

if (require.main === module) {
  run().catch((error) => {
    console.error('[omie_supabase] Erro:', formatPublicError(error));
    process.exitCode = 1;
  });
}
