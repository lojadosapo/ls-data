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

  async request(config, { maxAttempts = 4, operation = config.url } = {}) {
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      try {
        return await this.http.request(config);
      } catch (error) {
        const status = error.response?.status;
        const retryable =
          status === 429 ||
          status >= 500 ||
          ['ECONNABORTED', 'ECONNRESET', 'ETIMEDOUT'].includes(error.code);
        if (retryable && attempt < maxAttempts - 1) {
          await sleep((attempt + 1) * 2000);
          continue;
        }

        throw new Error(
          `Google Sheets API falhou em ${operation}: ` +
          `status=${status || 'network'} code=${error.code || 'unknown'}`
        );
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

  async getValuesBatch(ranges, {
    valueRenderOption = 'FORMATTED_VALUE',
    dateTimeRenderOption = 'FORMATTED_STRING'
  } = {}) {
    const params = new URLSearchParams({
      valueRenderOption,
      dateTimeRenderOption
    });
    for (const range of ranges) params.append('ranges', range);

    const response = await this.request(
      {
        method: 'get',
        url: '/values:batchGet',
        params
      },
      {
        operation: `batchGet(${ranges.join(', ')})`
      }
    );
    return (response.data.valueRanges || []).map((item) => item.values || []);
  }

  async batchUpdate(requests, { idempotent = false } = {}) {
    if (!requests.length) return { skipped: true };
    const response = await this.request(
      {
        method: 'post',
        url: ':batchUpdate',
        timeout: 240000,
        data: { requests }
      },
      {
        // Only absolute-value rewrites are safe to retry after an ambiguous timeout.
        maxAttempts: idempotent ? 2 : 1,
        operation: 'spreadsheets.batchUpdate'
      }
    );
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
