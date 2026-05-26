const axios = require('axios');
const formatPublicError = require('../lib/public-error');

async function getZohoToken() {
    const {
        ZOHO_REFRESH_TOKEN,
        ZOHO_CLIENT_ID,
        ZOHO_CLIENT_SECRET
    } = process.env;

    try {
        const authRes = await axios.post(
            'https://accounts.zoho.com/oauth/v2/token',
            null,
            {
                params: {
                    refresh_token: ZOHO_REFRESH_TOKEN,
                    client_id: ZOHO_CLIENT_ID,
                    client_secret: ZOHO_CLIENT_SECRET,
                    grant_type: 'refresh_token'
                }
            }
        );

        return authRes.data.access_token;
    } catch (error) {
        // Sanitize error to avoid leaking credentials in logs
        throw new Error('Zoho auth failed: ' + formatPublicError(error));
    }
}

module.exports = getZohoToken;