const axios = require('axios');
const formatPublicError = require('../lib/public-error');

async function getHabllaHeaders() {
  let token = process.env.HABLLA_TOKEN;
  let isWorkspaceToken = false;

  if (!token) {
    try {
      const login = await axios.post(
        'https://api.hablla.com/v1/authentication/login',
        {
          email: process.env.HABLLA_EMAIL,
          password: process.env.HABLLA_PASSWORD
        }
      );
      token = login.data.accessToken;
    } catch (error) {
      // Sanitize error to avoid leaking credentials in logs
      throw new Error('Hablla auth failed: ' + formatPublicError(error));
    }
  }

  if (!token.startsWith('ey')) {
    isWorkspaceToken = true;
  }

  return {
    Authorization: isWorkspaceToken ? token : 'Bearer ' + token,
    accept: 'application/json'
  };
}

module.exports = getHabllaHeaders;
