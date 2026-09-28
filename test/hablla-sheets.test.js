const test = require('node:test');
const assert = require('node:assert/strict');

const { uniqueAttendantRows } = require('../src/hablla/sheets/sync');
const {
  assertEmptyAttendantDaysAreSafe,
  booleanOption,
  buildCardSheet,
  collectCardSnapshots,
  completedDayRanges,
  discoverCardHeaders,
  selectedDatasets,
  shouldReplaceCardRow,
  CARD_HEADERS,
  PHONE_HEADERS,
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

test('telefone vem primeiro entre colunas novas e os campos extras sao descobertos', () => {
  const cards = [{
    id: 'card-1',
    updated_at: '2026-09-28T12:00:00.000Z',
    created_at: '2026-09-01T12:00:00.000Z',
    phone: '+5531999998888',
    custom_fields: [
      { custom_field: '69e8d49592607a5877e699d5', value: '31988887777' },
      { custom_field: 'custom-extra-id', value: 'extra-value' },
    ],
    source_detail: 'landing page',
  }];
  const currentHeader = [...CARD_HEADERS, 'existing-extra'];
  const discovered = discoverCardHeaders(cards, currentHeader);

  assert.deepEqual(discovered.slice(0, currentHeader.length), currentHeader);
  assert.deepEqual(discovered.slice(currentHeader.length, currentHeader.length + 2), PHONE_HEADERS);
  assert.ok(discovered.includes('card.source_detail'));
  assert.ok(discovered.includes('custom_field.custom-extra-id'));
});

test('linhas escrevem os dois telefones e preservam o cabecalho existente', () => {
  const cards = [{
    id: 'card-2',
    updated_at: '2026-09-28T12:00:00.000Z',
    created_at: '2026-09-01T12:00:00.000Z',
    phone: '+5531999998888',
    custom_fields: [
      { custom_field: '69e8d49592607a5877e699d5', value: '31988887777' },
      { custom_field: 'custom-extra-id', value: 'extra-value' },
    ],
    source_detail: 'landing page',
  }];
  const currentHeader = [...CARD_HEADERS, 'existing-extra'];
  const { header, rows } = buildCardSheet(cards, currentHeader);

  assert.deepEqual(header.slice(0, currentHeader.length), currentHeader);
  assert.equal(rows[0][currentHeader.length], '+5531999998888');
  assert.equal(rows[0][currentHeader.length + 1], '31988887777');
  assert.equal(rows[0][header.indexOf('card.source_detail')], 'landing page');
  assert.equal(rows[0][header.indexOf('custom_field.custom-extra-id')], 'extra-value');
  assert.equal(rows[0].length, header.length);
});
