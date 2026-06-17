const axios = require('axios');

const SHEETS_BASE_URL = 'https://sheets.googleapis.com/v4/spreadsheets';

function encodeRange(range) {
  return encodeURIComponent(range).replace(/%21/g, '!');
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

class SheetsClient {
  constructor({ spreadsheetId, accessToken }) {
    if (!spreadsheetId) throw new Error('spreadsheetId obrigatorio');
    if (!accessToken) throw new Error('accessToken obrigatorio');

    this.spreadsheetId = spreadsheetId;
    this.http = axios.create({
      baseURL: `${SHEETS_BASE_URL}/${spreadsheetId}`,
      timeout: 60000,
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json'
      }
    });
  }

  async request(config) {
    for (let attempt = 0; attempt < 4; attempt++) {
      try {
        return await this.http.request(config);
      } catch (error) {
        const status = error.response?.status;
        const retryable = status === 429 || status >= 500 || ['ECONNRESET', 'ETIMEDOUT'].includes(error.code);
        if (retryable && attempt < 3) {
          await sleep((attempt + 1) * 2000);
          continue;
        }

        throw new Error(`Google Sheets API falhou: status=${status || 'network'}`);
      }
    }

    throw new Error('Google Sheets API falhou apos retries');
  }

  async getSpreadsheet() {
    const response = await this.request({
      method: 'get',
      url: '',
      params: {
        fields: 'sheets.properties(sheetId,title,gridProperties(rowCount,columnCount))'
      }
    });
    return response.data;
  }

  async getSheetIdByTitle() {
    const spreadsheet = await this.getSpreadsheet();
    const result = {};
    for (const sheet of spreadsheet.sheets || []) {
      result[sheet.properties.title] = sheet.properties.sheetId;
    }
    return result;
  }

  async getValues(range) {
    const response = await this.request({
      method: 'get',
      url: `/values/${encodeRange(range)}`,
      params: {
        valueRenderOption: 'FORMATTED_VALUE',
        dateTimeRenderOption: 'FORMATTED_STRING'
      }
    });
    return response.data.values || [];
  }

  async batchUpdate(requests) {
    if (!requests.length) return { skipped: true };
    const response = await this.request({
      method: 'post',
      url: ':batchUpdate',
      data: { requests }
    });
    return response.data;
  }

  async appendValues(range, values) {
    if (!values.length) return { skipped: true };
    const response = await this.request({
      method: 'post',
      url: `/values/${encodeRange(range)}:append`,
      params: {
        valueInputOption: 'USER_ENTERED',
        insertDataOption: 'INSERT_ROWS'
      },
      data: { values }
    });
    return response.data;
  }
}

module.exports = SheetsClient;
