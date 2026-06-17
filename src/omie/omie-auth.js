const axios = require('axios');

function getOmieCredentials() {
  const { OMIE_APP_KEY, OMIE_APP_SECRET } = process.env;

  if (OMIE_APP_KEY && OMIE_APP_SECRET) {
    return { appKey: OMIE_APP_KEY, appSecret: OMIE_APP_SECRET };
  }

  if (process.env.OMIE_CREDENTIALS) {
    try {
      const credentials = JSON.parse(process.env.OMIE_CREDENTIALS);
      const entries = Array.isArray(credentials)
        ? credentials
        : Object.values(credentials);
      const first = entries.find((item) => item && (item.appKey || item.app_key) && (item.appSecret || item.app_secret));

      if (first) {
        return {
          appKey: first.appKey || first.app_key,
          appSecret: first.appSecret || first.app_secret
        };
      }
    } catch (err) {
      throw new Error('OMIE_CREDENTIALS precisa ser um JSON valido');
    }
  }

  throw new Error('OMIE_APP_KEY/OMIE_APP_SECRET ou OMIE_CREDENTIALS sao obrigatorios');
}

/**
 * Cria uma chamada autenticada para a API Omie.
 * @param {string} endpoint Endpoint da API, como '/produtos/pedido/'.
 * @param {string} call Nome do metodo da API, como 'ListarPedidos'.
 * @param {object[]} param Parametros da chamada.
 * @returns {Promise<object>} Resposta da API.
 */
async function callOmieAPI(endpoint, call, param = []) {
  const { appKey, appSecret } = getOmieCredentials();
  const url = `https://app.omie.com.br/api/v1${endpoint}`;

  const payload = {
    call,
    app_key: appKey,
    app_secret: appSecret,
    param
  };

  try {
    const response = await axios.post(url, payload, {
      headers: {
        'Content-Type': 'application/json'
      }
    });
    return response.data;
  } catch (error) {
    if (error.response?.data) {
      throw new Error(`Omie API Error: ${JSON.stringify(error.response.data)}`);
    }
    throw error;
  }
}

module.exports = callOmieAPI;
