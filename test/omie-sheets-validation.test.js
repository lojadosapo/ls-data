const assert = require("node:assert/strict");
const test = require("node:test");

const {
  appendedRange,
  indexesOutside,
  orderedRowsFingerprint,
  rowsFingerprint,
} = require("../src/omie/sheets/sync")._internals;

const fullConfig = {
  dateColumnIndex: 0,
  amountColumnIndex: 5,
  keyColumnIndexes: Array.from({ length: 11 }, (_, index) => index),
};

test("fingerprint Omie confirma todas as colunas, nao apenas a chave", () => {
  const oldRows = [["14/07/2026", "Empresa", "NF-1", "Produto", "Setor antigo", 10, "", "", "", "", ""]];
  const newRows = [["14/07/2026", "Empresa", "NF-1", "Produto", "Setor novo", 10, "", "", "", "", ""]];

  assert.notEqual(
    rowsFingerprint(oldRows, [0], fullConfig),
    rowsFingerprint(newRows, [0], fullConfig),
  );
});

test("precondition Omie detecta reordenacao que invalidaria indices fisicos", () => {
  const config = {
    dateColumnIndex: 0,
    amountColumnIndex: 1,
    keyColumnIndexes: [0, 1],
  };
  const rows = [["cabecalho", ""], ["14/07/2026", 1], ["13/07/2026", 2]];
  const reordered = [rows[0], rows[2], rows[1]];

  assert.notEqual(
    orderedRowsFingerprint(rows, config),
    orderedRowsFingerprint(reordered, config),
  );
  assert.deepEqual(indexesOutside(rows.length, [1]), [0, 2]);
});

test("faixa de confirmacao aponta somente para as linhas anexadas", () => {
  assert.equal(appendedRange("Aba", 100, 12, 7, "K"), "Aba!A89:K95");
  assert.equal(appendedRange("Aba", 100, 12, 0, "K"), null);
});
