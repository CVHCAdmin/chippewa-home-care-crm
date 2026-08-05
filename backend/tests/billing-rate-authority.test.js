// tests/billing-rate-authority.test.js
// The rate on an invoice line comes from the CLIENT RECORD, never from the
// request. Before this, the manual invoice form sent a per-line rate typed into
// a number spinner, and a stray arrow/scroll billed a cent off silently —
// invoice #67 (Diane Shantz) went out at $33.02/$33.03 against her $33.00, and
// invoice #44 (Mike Mattson) at $33.03. Pure functions — no DB, no HTTP.

process.env.JWT_SECRET = 'test-secret-rate-authority';
process.env.DATABASE_URL = 'postgresql://fake:fake@localhost/fake';
process.env.NODE_ENV = 'test';

jest.mock('../src/db', () => ({ query: jest.fn(), pool: { on: jest.fn() }, auditLog: jest.fn() }));

const { applyRate, resolveClientRate } = require('../src/routes/billingRoutes');

const RATE_33 = { rate: 33.0, rateType: 'hourly', source: 'client_private_pay_rate' };

describe('applyRate — the request cannot set the rate', () => {
  test('overrides a spinner-nudged rate with the client rate (invoice #67, 7/7)', () => {
    expect(applyRate({ hours: 2, rate: '33.03' }, RATE_33)).toEqual({ hours: 2, rate: 33.0, amount: 66.0 });
  });

  test('overrides the half-hour case too (invoice #67, 7/15)', () => {
    expect(applyRate({ hours: 1.5, rate: '33.02' }, RATE_33)).toEqual({ hours: 1.5, rate: 33.0, amount: 49.5 });
  });

  test('ignores a wildly wrong rate the old ±50% guard would also have caught', () => {
    expect(applyRate({ hours: 2, rate: '330' }, RATE_33).amount).toBe(66.0);
  });

  test('ignores a rate the old guard would have let through (within 50-200%)', () => {
    expect(applyRate({ hours: 4, rate: '45.00' }, RATE_33).amount).toBe(132.0);
  });

  test('a missing rate is filled in, not treated as free', () => {
    expect(applyRate({ hours: 3 }, RATE_33)).toEqual({ hours: 3, rate: 33.0, amount: 99.0 });
    expect(applyRate({ hours: 3, rate: '' }, RATE_33).amount).toBe(99.0);
    expect(applyRate({ hours: 3, rate: null }, RATE_33).amount).toBe(99.0);
  });

  test('an explicit zero stays a write-off', () => {
    expect(applyRate({ hours: 2, rate: 0 }, RATE_33)).toEqual({ hours: 2, rate: 0, amount: 0 });
  });

  test('rounds to cents rather than carrying float dust', () => {
    const { amount } = applyRate({ hours: 1.7, rate: '99' }, { rate: 33.33 });
    expect(amount).toBe(56.66);
    expect(Number.isInteger(amount * 100)).toBe(true);
  });
});

describe('resolveClientRate — where the rate comes from', () => {
  const dbc = { query: jest.fn() };
  beforeEach(() => dbc.query.mockReset());

  test('private pay uses the client rate and never queries the payer table', async () => {
    const out = await resolveClientRate(dbc,
      { is_private_pay: true, private_pay_rate: '33.00', referral_source_id: 'rs-1' }, '2026-07-01', '2026-07-31');
    expect(out).toEqual({ rate: 33.0, rateType: 'hourly', source: 'client_private_pay_rate' });
    expect(dbc.query).not.toHaveBeenCalled(); // private pay wins over a lingering referral source
  });

  test('a payer client uses the referral-source contract rate', async () => {
    dbc.query.mockResolvedValue({ rows: [{ rate_amount: '27.50', rate_type: 'hourly' }] });
    const out = await resolveClientRate(dbc,
      { is_private_pay: false, referral_source_id: 'rs-1', care_type_id: 'ct-1' }, '2026-07-01', '2026-07-31');
    expect(out.rate).toBe(27.5);
    expect(out.source).toBe('referral_source_rate');
  });

  test('falls back to the private-pay rate when the payer has no contract rate', async () => {
    dbc.query.mockResolvedValue({ rows: [] });
    const out = await resolveClientRate(dbc,
      { is_private_pay: false, referral_source_id: 'rs-1', private_pay_rate: '30.00' }, '2026-07-01', '2026-07-31');
    expect(out.rate).toBe(30.0);
  });

  test('returns null when nothing is configured, so the caller fails loudly', async () => {
    dbc.query.mockResolvedValue({ rows: [] });
    expect(await resolveClientRate(dbc, { is_private_pay: true }, '2026-07-01', '2026-07-31')).toBeNull();
    expect(await resolveClientRate(dbc, { is_private_pay: false }, '2026-07-01', '2026-07-31')).toBeNull();
  });
});
