// tests/evv-weekly.test.js
// Weekly EVV allowance: My Choice authorizes S5125 attendant care (EVV, Sandata) and
// S5130 homemaker (no Sandata) per Sun–Sat week. Once the client's Sandata minutes for
// the week reach clients.evv_weekly_units × 15, the caregiver app must stop sending
// caregivers to Sandata until Sunday.

process.env.JWT_SECRET = 'test-secret-evv-weekly';
process.env.DATABASE_URL = 'postgresql://fake:fake@localhost/fake';
process.env.NODE_ENV = 'test';

const mockQuery = jest.fn();
jest.mock('../src/db', () => ({ query: (...a) => mockQuery(...a), pool: { on: jest.fn() }, auditLog: jest.fn() }));

const { decideSandataRequired, clientInSandata, withTimeout } = require('../src/helpers/evvWeekly');

const myChoice = (over = {}) => ({
  rows: [{ is_private_pay: false, medicaid_id: '3886255573', evv_weekly_units: 12, payer_type: 'mco_family_care', ...over }],
});
const usage = (usedMinutes) => ({ rows: [{ week_start: '2026-10-11', week_end: '2026-10-17', used_minutes: usedMinutes }] });

beforeEach(() => mockQuery.mockReset());

describe('decideSandataRequired', () => {
  test('EVV minutes left this week → send to Sandata', async () => {
    mockQuery.mockResolvedValueOnce(myChoice()).mockResolvedValueOnce(usage(90)); // 12u = 180 min
    const d = await decideSandataRequired('c1');
    expect(d.required).toBe(true);
    expect(d.allowanceMinutes).toBe(180);
    expect(d.usedMinutes).toBe(90);
  });

  test('allowance used up → no Sandata (homemaker time)', async () => {
    mockQuery.mockResolvedValueOnce(myChoice()).mockResolvedValueOnce(usage(180));
    const d = await decideSandataRequired('c1');
    expect(d.required).toBe(false);
    expect(d.reason).toBe('evv_week_met');
  });

  test('a little left still sends the whole visit (overshoot is fine)', async () => {
    mockQuery.mockResolvedValueOnce(myChoice()).mockResolvedValueOnce(usage(179));
    expect((await decideSandataRequired('c1')).required).toBe(true);
  });

  test('no allowance entered → keep prompting every visit (old behavior)', async () => {
    mockQuery.mockResolvedValueOnce(myChoice({ evv_weekly_units: null }));
    const d = await decideSandataRequired('c1');
    expect(d.required).toBe(true);
    expect(mockQuery).toHaveBeenCalledTimes(1); // no usage query needed
  });

  test('0 EVV units (homemaker-only client) → never Sandata', async () => {
    mockQuery.mockResolvedValueOnce(myChoice({ evv_weekly_units: 0 }));
    expect((await decideSandataRequired('c1')).required).toBe(false);
  });

  test('private pay, VA, or no Medicaid ID → never Sandata', async () => {
    mockQuery.mockResolvedValueOnce(myChoice({ is_private_pay: true }));
    expect((await decideSandataRequired('c1')).required).toBe(false);
    mockQuery.mockResolvedValueOnce(myChoice({ payer_type: 'va' }));
    expect((await decideSandataRequired('c1')).required).toBe(false);
    mockQuery.mockResolvedValueOnce(myChoice({ medicaid_id: '' }));
    expect((await decideSandataRequired('c1')).required).toBe(false);
  });

  test('usage query is scoped to the client, the punch time, and excludes the new visit', async () => {
    mockQuery.mockResolvedValueOnce(myChoice()).mockResolvedValueOnce(usage(0));
    await decideSandataRequired('c1', '2026-10-14T15:00:00.000Z', { excludeEntryId: 'e1' });
    const [sql, params] = mockQuery.mock.calls[1];
    expect(params).toEqual(['c1', '2026-10-14T15:00:00.000Z', 'e1']);
    expect(sql).toMatch(/America\/Chicago/);
    expect(sql).toMatch(/EXTRACT\(DOW FROM day\)/); // Sunday-start week
    expect(sql).toMatch(/COALESCE\(te\.sandata_required, true\) = true/);
    // A missed clock-out (23h punch on a 2¼h visit) must not use up the week:
    // finished visits count billable minutes, open visits are capped at their schedule.
    expect(sql).toMatch(/COALESCE\(te\.billable_minutes, te\.duration_minutes/);
    expect(sql).toMatch(/COALESCE\(te\.allotted_minutes, 960\)/);
  });
});

describe('clientInSandata', () => {
  test('matches the app rule: My Choice + 10–12 digit Medicaid ID, not private pay', () => {
    expect(clientInSandata({ payer_type: 'mco_family_care', medicaid_id: ' 3886255573 ' })).toBe(true);
    expect(clientInSandata({ payer_type: 'mco_family_care', medicaid_id: '123' })).toBe(false);
    expect(clientInSandata(null)).toBe(false);
  });
});

describe('withTimeout', () => {
  test('a slow decision yields null instead of holding up the clock-in', async () => {
    const slow = new Promise(r => setTimeout(() => r({ required: false }), 200));
    expect(await withTimeout(slow, 10)).toBeNull();
  });
  test('a fast decision passes through', async () => {
    expect(await withTimeout(Promise.resolve({ required: true }), 1000)).toEqual({ required: true });
  });
});
