const axios = require('axios');
const supabase = require('../lib/supabase');
const getZohoToken = require('./zoho-auth');

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function formatZohoDay(date) {
	return `${String(date.getDate()).padStart(2, '0')}-${MONTHS[date.getMonth()]}-${date.getFullYear()}`;
}

async function runZohoServiceOrderSync({ days, label }) {
	console.log(`[raw_events_ordem_de_servico] Sincronizando ordens de serviço (${label})...`);

	const {
		ZOHO_ACCOUNT_OWNER,
		ZOHO_APP_NAME,
		ZOHO_LEADS_APP_NAME,
		ZOHO_SERVICE_ORDER_REPORT_NAME
	} = process.env;
	const zohoAppName = ZOHO_APP_NAME || ZOHO_LEADS_APP_NAME;
	if (!ZOHO_ACCOUNT_OWNER || !zohoAppName || !ZOHO_SERVICE_ORDER_REPORT_NAME) {
		throw new Error('Variáveis Zoho ausentes: ZOHO_ACCOUNT_OWNER, ZOHO_APP_NAME/ZOHO_LEADS_APP_NAME e ZOHO_SERVICE_ORDER_REPORT_NAME são obrigatórias');
	}
	const zohoToken = await getZohoToken();

	const today = new Date();
	const startDate = new Date(today);
	startDate.setDate(today.getDate() - (days - 1));

	const finalRows = [];

	for (let date = new Date(startDate); date <= today; date.setDate(date.getDate() + 1)) {
		const formattedDate = formatZohoDay(date);
		let from = 1;
		const limit = 200;

		while (true) {
			const criteria = `(dh_inicio_da_ordem_de_servico >= "${formattedDate} 00:00:00" && dh_inicio_da_ordem_de_servico <= "${formattedDate} 23:59:59")`;
			const url = `https://creator.zoho.com/api/v2/${ZOHO_ACCOUNT_OWNER}/${zohoAppName}/report/${ZOHO_SERVICE_ORDER_REPORT_NAME}`;

			let resp;
			try {
				resp = await axios.get(url, {
					params: { from, limit, criteria },
					headers: { Authorization: `Zoho-oauthtoken ${zohoToken}` }
				});
			} catch (e) {
				if (e.response?.status === 404) {
					console.log(`[raw_events_ordem_de_servico] ${formattedDate}: sem dados (404).`);
					break;
				}
				throw e;
			}

			const data = resp.data.data || [];
			if (!data.length) break;

			for (const record of data) {
				finalRows.push({ external_id: `service-order-${record.ID}`, payload: record });
			}

			if (data.length < limit) break;
			from += limit;
		}
	}

	if (finalRows.length > 0) {
		const { error } = await supabase.from('raw_events_ordem_de_servico').upsert(finalRows, { onConflict: 'external_id' });
		if (error) throw error;
	}
}

module.exports = runZohoServiceOrderSync;
