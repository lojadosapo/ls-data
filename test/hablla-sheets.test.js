const test = require('node:test');
const assert = require('node:assert/strict');

const { uniqueAttendantRows } = require('../src/hablla/sheets/sync');
const {
  assertEmptyAttendantDaysAreSafe,
  booleanOption,
  collectCardSnapshots,
  completedDayRanges,
  selectedDatasets,
  shouldReplaceCardRow,
} = require('../src/hablla/sheets/sync')._internals;

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

test('dia vazio de atendentes nunca remove linhas que ja existem', () => {
  assert.doesNotThrow(() =>
    assertEmptyAttendantDaysAreSafe(['12/07/2026'], [['11/07/2026']]),
  );
  assert.throws(
    () => assertEmptyAttendantDaysAreSafe(['12/07/2026'], [['12/07/2026']]),
    /1 dias que ja possuem linhas/,
  );
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
  assert.equal(
    shouldReplaceCardRow(recentlyCreated, new Set(), cutoff, {
      preserveUnfetched: true,
    }),
    false,
  );
});

test('opcoes locais selecionam datasets e dias concluidos com validacao estrita', () => {
  assert.equal(booleanOption('sim', false, 'FLAG'), true);
  assert.equal(booleanOption('false', true, 'FLAG'), false);
  assert.throws(() => booleanOption('talvez', false, 'FLAG'), /true ou false/);
  assert.deepEqual([...selectedDatasets('cards')], ['cards']);
  assert.throws(() => selectedDatasets('clients'), /cards e attendants/);
  const ranges = completedDayRanges(3);
  assert.equal(ranges.length, 3);
  assert.ok(ranges[0].day < ranges[1].day);
  assert.ok(ranges[1].day < ranges[2].day);
});

test('coletas repetidas consolidam a versao mais recente por ID', async () => {
  let call = 0;
  const cards = await collectCardSnapshots({
    hablla: {},
    workspaceId: 'workspace',
    boardId: 'board',
    cutoff: '2026-07-01T03:00:00.000Z',
    exhaustive: true,
    passes: 2,
    attempts: 1,
    collect: async () => {
      call += 1;
      return call === 1
        ? [{ id: 'card-1', updated_at: '2026-07-10T10:00:00.000Z' }]
        : [
            { id: 'card-1', updated_at: '2026-07-10T11:00:00.000Z', status: 'novo' },
            { id: 'card-2', updated_at: '2026-07-10T12:00:00.000Z' },
          ];
    },
  });

  assert.equal(cards.length, 2);
  assert.equal(cards.find(({ id }) => id === 'card-1').status, 'novo');
});
