const test = require('node:test');
const assert = require('node:assert/strict');

process.env.SUPABASE_URL ||= 'http://localhost:54321';
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'test-service-role-key';

const { addDays, isoDay, today } = require('../src/lib/sao-paulo-date');
const {
  formatZohoDay,
  serviceOrderDateRange,
} = require('../src/zoho/supabase/service-order-sync')._internals;

test('dia de negocio de Sao Paulo nao avanca entre 01:xx e 02:xx UTC', () => {
  assert.equal(isoDay(today(new Date('2026-07-14T01:30:00.000Z'))), '2026-07-13');
  assert.equal(isoDay(today(new Date('2026-07-14T02:59:59.999Z'))), '2026-07-13');
  assert.equal(isoDay(today(new Date('2026-07-14T03:00:00.000Z'))), '2026-07-14');
});

test('janela Zoho LS preserva sete dias e o formato esperado pelo Creator', () => {
  const { startDate, endDate } = serviceOrderDateRange(
    7,
    new Date('2026-07-14T01:30:00.000Z'),
  );

  assert.equal(isoDay(startDate), '2026-07-07');
  assert.equal(isoDay(endDate), '2026-07-13');
  assert.equal(formatZohoDay(startDate), '07-Jul-2026');
  assert.equal(formatZohoDay(endDate), '13-Jul-2026');
  assert.equal(isoDay(addDays(endDate, 1)), '2026-07-14');
});
