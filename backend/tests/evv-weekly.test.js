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

// MIDAS claim days: S5125 from Sandata visits (capped at the weekly allowance), the rest S5130.
const { allocateEvvWeek } = require('../src/helpers/evvWeekly');
const v = (date, hhmm, minutes, sentToSandata) => ({ date, start: `${date}T${hhmm}`, minutes, sentToSandata });

describe('allocateEvvWeek (MIDAS claim days)', () => {
  test('Sandata visits are EVV until the allowance; the overshoot and later visits are homemaker', () => {
    // 8 EVV units (120 min). Mon 90 Sandata, Wed 90 Sandata (only 30 left), Fri 90 not sent.
    const r = allocateEvvWeek(8, [v('2026-10-16', '09:00', 90, false), v('2026-10-12', '09:00', 90, true), v('2026-10-14', '09:00', 90, true)]);
    expect(r.days.map(d => [d.date, d.evvUnits, d.homemakerUnits])).toEqual([
      ['2026-10-12', 6, 0], ['2026-10-14', 2, 4], ['2026-10-16', 0, 6],
    ]);
    expect(r.totals).toEqual({ evvUnits: 8, homemakerUnits: 10, evvAuthorizedUnits: 8 });
  });

  test('homemaker-only client (0 EVV units): everything is S5130', () => {
    const r = allocateEvvWeek(0, [v('2026-10-12', '09:00', 60, false)]);
    expect(r.totals).toEqual({ evvUnits: 0, homemakerUnits: 4, evvAuthorizedUnits: 0 });
  });

  test('no allowance entered: every Sandata minute is EVV', () => {
    const r = allocateEvvWeek(null, [v('2026-10-12', '09:00', 120, true), v('2026-10-13', '09:00', 120, true)]);
    expect(r.totals.evvUnits).toBe(16);
    expect(r.totals.homemakerUnits).toBe(0);
  });

  test('rounding never claims more EVV than authorized', () => {
    // 3 units (45 min) spread 22 + 23 → rounds 1 + 2? per-day rounding could exceed; trimmed to 3.
    const r = allocateEvvWeek(3, [v('2026-10-12', '09:00', 23, true), v('2026-10-13', '09:00', 23, true)]);
    expect(r.totals.evvUnits).toBeLessThanOrEqual(3);
    expect(r.totals.evvUnits + r.totals.homemakerUnits).toBe(3); // 46 min ≈ 3 units total
  });

  test('two visits on one day add up before rounding', () => {
    const r = allocateEvvWeek(null, [v('2026-10-12', '09:00', 52, true), v('2026-10-12', '14:00', 53, true)]);
    expect(r.days).toHaveLength(1);
    expect(r.days[0].evvUnits).toBe(7); // 105 min
  });
});
