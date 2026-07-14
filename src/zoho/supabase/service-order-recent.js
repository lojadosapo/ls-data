const runZohoServiceOrderSync = require('./service-order-sync');
const formatPublicError = require('../../lib/public-error');

async function run() {
	try {
		await runZohoServiceOrderSync({ days: 7, label: 'últimos 7 dias' });
	} catch (e) {
		console.error('[contact_site] Erro:', formatPublicError(e));
		process.exit(1);
	}
}

module.exports = run;
if (require.main === module) run();
