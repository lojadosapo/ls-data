const axios = require('axios');

/**
 * Cria uma chamada autenticada para a API Omie
 * @param {string} endpoint - Endpoint da API (ex: '/produtos/pedido/')
 * @param {string} call - Nome do método da API (ex: 'ListarPedidos')
 * @param {object} param - Parâmetros da chamada
 * @returns {Promise<object>} Resposta da API
 */
async function callOmieAPI(endpoint, call, param = []) {
  const { OMIE_APP_KEY, OMIE_APP_SECRET } = process.env;

  if (!OMIE_APP_KEY || !OMIE_APP_SECRET) {
    throw new Error('OMIE_APP_KEY e OMIE_APP_SECRET são obrigatórios');
  }

  const url = `https://app.omie.com.br/api/v1${endpoint}`;
  
  const payload = {
    call,
    app_key: OMIE_APP_KEY,
    app_secret: OMIE_APP_SECRET,
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
