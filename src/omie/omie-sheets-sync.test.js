const test = require('node:test');
const assert = require('node:assert/strict');

const {
  appendedRange,
  atomicReplacementRequests,
  cellData,
  googleDateSerial
} = require('./omie-sheets-sync')._internals;

test('encodes dates and untrusted text as literal cell values', () => {
  assert.deepEqual(cellData('18/06/2026', 0), {
    userEnteredValue: { numberValue: googleDateSerial('18/06/2026') }
  });
  assert.deepEqual(cellData('=IMPORTXML("https://example.com")', 3), {
    userEnteredValue: { stringValue: '=IMPORTXML("https://example.com")' }
  });
  assert.deepEqual(cellData('=A1', 3, { allowFormula: true }), {
    userEnteredValue: { formulaValue: '=A1' }
  });
});

test('builds one idempotent atomic rewrite for both sheets', () => {
  const requests = atomicReplacementRequests({
    productSheet: { sheetId: 10, gridProperties: { rowCount: 100 } },
    vendorSheet: { sheetId: 20, gridProperties: { rowCount: 100 } },
    currentProductRows: [
      ['Data', 'Empresa', '=A1'],
      [46290, 'Empresa antiga', 100],
      [46291, 'Empresa mantida', 200]
    ],
    currentVendorRows: [
      ['Data', 'Documento', 'Vendedor'],
      [46290, '1', 'Vendedor antigo']
    ],
    productDeleteIndexes: [1],
    vendorDeleteIndexes: [1],
    productValues: [['18/06/2026', 'Empresa nova', '=texto literal']],
    vendorValues: [['18/06/2026', '00000001', 'Vendedor novo']]
  });

  assert.equal(requests.length, 4);
  assert.deepEqual(
    requests.filter((request) => request.updateCells).map((request) => request.updateCells.range.sheetId),
    [10, 20]
  );
  assert.equal(requests.some((request) => request.deleteDimension || request.appendCells), false);

  const productRows = requests[0].updateCells.rows;
  assert.equal(productRows.length, 3);
  assert.deepEqual(productRows[0].values[2], {
    userEnteredValue: { formulaValue: '=A1' }
  });
  assert.deepEqual(productRows[2].values[2], {
    userEnteredValue: { stringValue: '=texto literal' }
  });
});

test('limits post-write validation to the newly appended rows', () => {
  assert.equal(
    appendedRange('Produtos e Servicos', 'K', new Array(100), [2, 3, 8], new Array(5)),
    'Produtos e Servicos!A98:K102'
  );
  assert.equal(appendedRange('Vendedor', 'L', new Array(10), [4], []), null);
});
