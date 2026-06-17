const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const axios = require('axios');

const GOOGLE_TOKEN_URI = 'https://oauth2.googleapis.com/token';
const GOOGLE_SHEETS_SCOPE = 'https://www.googleapis.com/auth/spreadsheets';

function base64url(value) {
  return Buffer.from(value)
    .toString('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

function readMultilinePrivateKeyFromEnvFile() {
  const envPath = path.resolve(process.cwd(), '.env');
  if (!fs.existsSync(envPath)) return '';

  const lines = fs.readFileSync(envPath, 'utf8').split(/\r?\n/);
  const start = lines.findIndex((line) => line.startsWith('GOOGLE_PRIVATE_KEY='));
  if (start < 0) return '';

  const firstValue = lines[start].split('=', 2)[1] || '';
  const keyLines = [firstValue];

  for (let i = start + 1; i < lines.length; i++) {
    const line = lines[i];
    if (/^[A-Z][A-Z0-9_]*=/.test(line)) break;
    if (!line.trim()) break;
    keyLines.push(line);
    if (line.includes('END PRIVATE KEY')) break;
  }

  return keyLines.join('\n');
}

function normalizePrivateKey(value) {
  let key = value || readMultilinePrivateKeyFromEnvFile();
  key = String(key || '').trim().replace(/^["']|["']$/g, '').replace(/\\n/g, '\n');

  if (key.includes('BEGIN PRIVATE KEY') && !key.includes('END PRIVATE KEY')) {
    const fileKey = readMultilinePrivateKeyFromEnvFile();
    if (fileKey.length > key.length) {
      key = fileKey.trim().replace(/^["']|["']$/g, '').replace(/\\n/g, '\n');
    }
  }

  if (key.includes('BEGIN PRIVATE KEY') && !key.includes('END PRIVATE KEY')) {
    key = `${key}\n-----END PRIVATE KEY-----`;
  }

  return key;
}

async function getGoogleAccessToken() {
  const clientEmail = process.env.GOOGLE_CLIENT_EMAIL;
  const privateKey = normalizePrivateKey(process.env.GOOGLE_PRIVATE_KEY);

  if (!clientEmail || !privateKey) {
    if (process.env.GOOGLE_TOKEN) {
      return process.env.GOOGLE_TOKEN;
    }
    throw new Error('GOOGLE_CLIENT_EMAIL/GOOGLE_PRIVATE_KEY ou GOOGLE_TOKEN sao obrigatorios');
  }

  const now = Math.floor(Date.now() / 1000);
  const header = { alg: 'RS256', typ: 'JWT' };
  const claim = {
    iss: clientEmail,
    scope: GOOGLE_SHEETS_SCOPE,
    aud: GOOGLE_TOKEN_URI,
    exp: now + 3600,
    iat: now
  };

  const tokenToSign = `${base64url(JSON.stringify(header))}.${base64url(JSON.stringify(claim))}`;
  const signature = crypto
    .createSign('RSA-SHA256')
    .update(tokenToSign)
    .sign(privateKey, 'base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');

  const assertion = `${tokenToSign}.${signature}`;
  const body = new URLSearchParams({
    grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
    assertion
  });

  const response = await axios.post(GOOGLE_TOKEN_URI, body.toString(), {
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
  });

  if (!response.data?.access_token) {
    throw new Error('Google OAuth nao retornou access_token');
  }

  return response.data.access_token;
}

module.exports = {
  getGoogleAccessToken,
  normalizePrivateKey
};
