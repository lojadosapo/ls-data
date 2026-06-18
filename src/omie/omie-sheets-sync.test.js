const test = require('node:test');
const assert = require('node:assert/strict');

const {
  atomicReplacementRequests,
  cellData,
  googleDateSerial
} = require('./omie-sheets-sync')._internals;

test('encodes dates and untrusted text as literal cell values', () => {
  assert.deepEqual(cellData('18/06/2026', 0), {
    userEnteredValue: { numberValue: googleDateSerial('18/06/2026') },
    userEnteredFormat: {
      numberFormat: { type: 'DATE', pattern: 'dd/MM/yyyy' }
    }
  });
  assert.deepEqual(cellData('=IMPORTXML("https://example.com")', 3), {
    userEnteredValue: { stringValue: '=IMPORTXML("https://example.com")' }
  });
});

test('builds one ordered batch for deletes and appends on both sheets', () => {
  const requests = atomicReplacementRequests({
    productSheetId: 10,
    vendorSheetId: 20,
    productDeleteIndexes: [2, 3, 8],
    vendorDeleteIndexes: [4],
    productValues: [['18/06/2026', 'Empresa', 123]],
    vendorValues: [['18/06/2026', '00000001', 'Vendedor']]
  });

  assert.equal(requests.length, 5);
  assert.deepEqual(
    requests.slice(0, 3).map((request) => request.deleteDimension.range.sheetId),
    [10, 10, 20]
  );
  assert.equal(requests[3].appendCells.sheetId, 10);
  assert.equal(requests[4].appendCells.sheetId, 20);
  assert.equal(requests[3].appendCells.rows.length, 1);
  assert.equal(requests[4].appendCells.rows.length, 1);
});
