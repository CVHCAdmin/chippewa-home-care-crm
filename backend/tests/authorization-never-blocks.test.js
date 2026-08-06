// tests/authorization-never-blocks.test.js
// Authorization is ADVICE, not a gate. Commit 1df6a2c (March 2026) hard-blocked
// schedule creation when a client's authorized units ran out; by 2026-08-06 that
// silently 400'd scheduling for 8 of 25 active payer clients, because MIDAS
// imports a WEEKLY allowance into authorized_units while used_units accumulates
// across the whole period — so the balance reads hugely negative for everyone.
//
// These tests exist to stop the block coming back. A client needs care whether or
// not the payer paperwork is in order; the shortfall belongs in a warning.

process.env.JWT_SECRET = 'test-secret-auth-advisory';
process.env.DATABASE_URL = 'postgresql://fake:fake@localhost/fake';
process.env.NODE_ENV = 'test';

const mockQuery = jest.fn();
jest.mock('../src/db', () => ({ query: (...a) => mockQuery(...a), pool: { on: jest.fn() }, auditLog: jest.fn() }));

const { checkAuthorizationBalance } = require('../src/helpers/authorizationCheck');

const authRow = (over) => ({
  rows: [{
    id: 'a1', auth_number: '7150425', unit_type: '15min', end_date: '2026-09-19',
    authorized_units: '17.00', used_units: '221.00', remaining_units: '-204.00',
    low_units_alert_threshold: 20, health_status: 'low', pct_used: '1300.0', ...over,
  }],
});

beforeEach(() => mockQuery.mockReset());

describe('checkAuthorizationBalance never blocks', () => {
  test('Becky Tharp\'s real numbers: massively over, still allowed', async () => {
    mockQuery.mockResolvedValueOnce(authRow());
    const r = await checkAuthorizationBalance('client-1', 1);
    expect(r.allowed).toBe(true);
    expect(r.error).toBeNull();
    expect(r.warnings.join(' ')).toMatch(/balance looks short/i);
  });

  test('an expired authorization warns instead of refusing', async () => {
    mockQuery.mockResolvedValueOnce(authRow({ health_status: 'expired', end_date: '2026-01-01' }));
    const r = await checkAuthorizationBalance('client-1', 2);
    expect(r.allowed).toBe(true);
    expect(r.error).toBeNull();
    expect(r.warnings.join(' ')).toMatch(/expired/i);
  });

  // remaining_units is what the helper reads — the SQL aliases it to
  // (authorized_units - used_units), so fixtures must set it explicitly.
  test('exactly zero remaining still allows the shift', async () => {
    mockQuery.mockResolvedValueOnce(authRow({ authorized_units: '10.00', used_units: '10.00', remaining_units: '0.00', health_status: 'low' }));
    const r = await checkAuthorizationBalance('client-1', 1);
    expect(r.allowed).toBe(true);
    expect(r.error).toBeNull();
  });

  test('a healthy balance produces no shortfall warning', async () => {
    mockQuery.mockResolvedValueOnce(authRow({ authorized_units: '400.00', used_units: '4.00', remaining_units: '396.00', health_status: 'ok' }));
    const r = await checkAuthorizationBalance('client-1', 1);
    expect(r.allowed).toBe(true);
    expect(r.warnings.join(' ')).not.toMatch(/balance looks short/i);
  });

  test('no authorization on file is allowed with a warning', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });          // no active auth
    mockQuery.mockResolvedValueOnce({ rows: [{ is_private_pay: false }] });
    const r = await checkAuthorizationBalance('client-1', 1);
    expect(r.allowed).toBe(true);
    expect(r.warnings.join(' ')).toMatch(/no active authorization/i);
  });

  test('private pay needs no authorization at all', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    mockQuery.mockResolvedValueOnce({ rows: [{ is_private_pay: true }] });
    const r = await checkAuthorizationBalance('client-1', 1);
    expect(r.allowed).toBe(true);
    expect(r.warnings).toEqual([]);
  });

  test('allowed is true for every shift length, however large', async () => {
    for (const hours of [0.25, 1, 4, 8, 24]) {
      mockQuery.mockResolvedValueOnce(authRow());
      const r = await checkAuthorizationBalance('client-1', hours);
      expect(r.allowed).toBe(true);
      expect(r.error).toBeNull();
    }
  });
});
