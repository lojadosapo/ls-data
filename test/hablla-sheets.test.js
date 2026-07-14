const test = require('node:test');
const assert = require('node:assert/strict');

const { uniqueAttendantRows } = require('../src/hablla/sheets/sync');
const { shouldReplaceCardRow } = require('../src/hablla/sheets/sync')._internals;

function row({ date = '13/07/2026', sector = 'sector', user = 'user', connection = 'connection', total = 1 }) {
  const values = Array(17).fill('');
  values[0] = date;
  values[2] = sector;
  values[4] = user;
  values[7] = total;
  values[10] = connection;
  return values;
}

test('atendentes repetidos conservam somente a leitura mais recente', () => {
  const result = uniqueAttendantRows([row({ total: 1 }), row({ total: 2 })]);
  assert.equal(result.length, 1);
  assert.equal(result[0][7], 2);
});

test('linha sem identidade estável só é removida quando é cópia exata', () => {
  const first = row({ user: '', total: 1 });
  const changed = row({ user: '', total: 2 });
  assert.equal(uniqueAttendantRows([first, changed, [...changed]]).length, 2);
});

test('janela de cards usa created_at e preserva card antigo atualizado recentemente', () => {
  const cutoff = '2026-07-07';
  const oldCreatedRecentlyUpdated = Array(18).fill('');
  oldCreatedRecentlyUpdated[0] = '14/07/2026 10:00:00';
  oldCreatedRecentlyUpdated[1] = '01/06/2026 10:00:00';
  oldCreatedRecentlyUpdated[14] = 'old-card';

  const recentlyCreated = [...oldCreatedRecentlyUpdated];
  recentlyCreated[0] = '01/06/2026 10:00:00';
  recentlyCreated[1] = '14/07/2026 10:00:00';
  recentlyCreated[14] = 'new-card';

  assert.equal(
    shouldReplaceCardRow(oldCreatedRecentlyUpdated, new Set(), cutoff),
    false,
  );
  assert.equal(shouldReplaceCardRow(recentlyCreated, new Set(), cutoff), true);
  assert.equal(
    shouldReplaceCardRow(oldCreatedRecentlyUpdated, new Set(['old-card']), cutoff),
    true,
  );
});
