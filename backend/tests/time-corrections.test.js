// tests/time-corrections.test.js — caregiver time corrections + the shared visit billing rule
process.env.JWT_SECRET = 'test-secret-time-corrections';
process.env.DATABASE_URL = 'postgresql://fake:fake@localhost/fake';
process.env.NODE_ENV = 'test';

const mockQuery = jest.fn();
const mockClientQuery = jest.fn();
jest.mock('../src/db', () => ({
  query: (...a) => mockQuery(...a),
  pool: { on: jest.fn(), connect: async () => ({ query: (...a) => mockClientQuery(...a), release: () => {} }) },
  auditLog: jest.fn(),
}));
jest.mock('../src/services/tokenRevocation', () => ({ isStaffTokenRevoked: async () => false, markUserLoggedOut: () => {} }), { virtual: false });

const express = require('express');
const request = require('supertest');
const jwt = require('jsonwebtoken');
const { computeVisitBilling } = require('../src/helpers/visitBilling');
const router = require('../src/routes/timeCorrectionsRoutes');

const CG = '22222222-2222-2222-2222-222222222222';
const ADMIN = '33333333-3333-3333-3333-333333333333';
const tok = (id, role) => jwt.sign({ id, role, email: 'x@y.z', name: 'T' }, process.env.JWT_SECRET);
const app = express(); app.use(express.json()); app.use('/api/time-corrections', router);

describe('computeVisitBilling (shared with clock-out)', () => {
  test('payer visit with a schedule bills the schedule; >7 min off is flagged', () => {
    expect(computeVisitBilling({ durationSeconds: 95 * 60, allottedMinutes: 90, isPrivatePay: false }))
      .toMatchObject({ durationMinutes: 95, billableMinutes: 90, needsApproval: false });
    expect(computeVisitBilling({ durationSeconds: 120 * 60, allottedMinutes: 90, isPrivatePay: false }))
      .toMatchObject({ billableMinutes: 90, needsApproval: true, approvalReason: 'time_variance', discrepancyMinutes: 30 });
  });
  test('private pay bills the clock; unscheduled is flagged; < 60s is zero', () => {
    expect(computeVisitBilling({ durationSeconds: 125 * 60, allottedMinutes: 90, isPrivatePay: true }).billableMinutes).toBe(125);
    expect(computeVisitBilling({ durationSeconds: 60 * 60, allottedMinutes: null, isPrivatePay: false }).approvalReason).toBe('unscheduled');
    expect(computeVisitBilling({ durationSeconds: 30, allottedMinutes: 90, isPrivatePay: false })).toMatchObject({ billableMinutes: 0, approvalReason: 'zero_duration' });
  });
  test('over 16 hours is capped at the schedule', () => {
    expect(computeVisitBilling({ durationSeconds: 20 * 3600, allottedMinutes: 120, isPrivatePay: true }))
      .toMatchObject({ billableMinutes: 120, needsApproval: true });
  });
});

// Simple fake DB keyed on the SQL text.
function fakeDb({ entry = null, today = '2026-10-15', windowStart = '2026-10-04', insertRow = {}, overlap = false } = {}) {
  mockQuery.mockImplementation(async (sql, params) => {
    if (/last_logout_at/.test(sql)) return { rows: [] };
    if (/AS start,\s+to_char\(today/.test(sql)) return { rows: [{ start: windowStart, today }] };
    if (/::timestamp AT TIME ZONE 'America\/Chicago'\) AS t/.test(sql)) return { rows: [{ t: new Date(params[0] + ':00-05:00') }] };
    if (/AS d$/.test(sql.trim()) || /'YYYY-MM-DD'\) AS d/.test(sql)) {
      const src = params[0];
      return { rows: [{ d: typeof src === 'string' && /T/.test(src) ? new Date(new Date(src).getTime() - 5 * 3600e3).toISOString().slice(0, 10) : (entry ? '2026-10-14' : today) }] };
    }
    if (/FROM time_entries WHERE id = \$1 AND caregiver_id = \$2/.test(sql)) return { rows: entry ? [entry] : [] };
    if (/FROM time_entries te JOIN clients c ON c.id = te.client_id\s+WHERE te.caregiver_id = \$1 AND/.test(sql)) return { rows: overlap ? [{ client_name: 'Other Client' }] : [] };
    if (/INSERT INTO time_corrections/.test(sql)) return { rows: [{ id: 'tc1', ...insertRow }] };
    if (/u.first_name \|\| ' ' \|\| u.last_name AS cg/.test(sql)) return { rows: [{ cg: 'Pat Care', cl: 'Client One' }] };
    if (/FROM users WHERE role = 'admin'/.test(sql)) return { rows: [{ id: ADMIN }] };
    return { rows: [] };
  });
}

describe('caregiver submits a correction', () => {
  beforeEach(() => { mockQuery.mockReset(); });
  const entry = { id: '44444444-4444-4444-4444-444444444444', caregiver_id: CG, client_id: 'c1', start_time: '2026-10-14T14:00:00Z', end_time: null };

  test('forgot to clock out: accepted and the office is notified', async () => {
    fakeDb({ entry });
    const r = await request(app).post('/api/time-corrections').set('Authorization', `Bearer ${tok(CG, 'caregiver')}`)
      .send({ timeEntryId: entry.id, start: '2026-10-14T09:00', end: '2026-10-14T11:00', reason: 'forgot_clock_out', note: 'Phone died, left at 11' });
    expect(r.status).toBe(201);
    const ins = mockQuery.mock.calls.find(([sql]) => /INSERT INTO time_corrections/.test(sql));
    expect(ins[1][3]).toBe('fix_times');
    expect(mockQuery.mock.calls.some(([sql, p]) => /INSERT INTO notifications/.test(sql) && p[2] === 'time_correction')).toBe(true);
  });

  test('end before start, missing note, and bad reason are refused', async () => {
    fakeDb({ entry });
    const base = { timeEntryId: entry.id, reason: 'forgot_clock_out', note: 'x long enough' };
    let r = await request(app).post('/api/time-corrections').set('Authorization', `Bearer ${tok(CG, 'caregiver')}`).send({ ...base, start: '2026-10-14T11:00', end: '2026-10-14T09:00' });
    expect(r.status).toBe(400); expect(r.body.error).toMatch(/after the start/);
    r = await request(app).post('/api/time-corrections').set('Authorization', `Bearer ${tok(CG, 'caregiver')}`).send({ ...base, note: '', start: '2026-10-14T09:00', end: '2026-10-14T11:00' });
    expect(r.status).toBe(400); expect(r.body.error).toMatch(/note/);
    r = await request(app).post('/api/time-corrections').set('Authorization', `Bearer ${tok(CG, 'caregiver')}`).send({ ...base, reason: 'because', start: '2026-10-14T09:00', end: '2026-10-14T11:00' });
    expect(r.status).toBe(400);
  });

  test('older than last week is refused', async () => {
    fakeDb({ entry });
    const r = await request(app).post('/api/time-corrections').set('Authorization', `Bearer ${tok(CG, 'caregiver')}`)
      .send({ timeEntryId: entry.id, start: '2026-09-28T09:00', end: '2026-09-28T11:00', reason: 'wrong_times', note: 'old one' });
    expect(r.status).toBe(400); expect(r.body.error).toMatch(/this week or last week/);
  });

  test('overlapping another of my visits is refused', async () => {
    fakeDb({ entry, overlap: true });
    const r = await request(app).post('/api/time-corrections').set('Authorization', `Bearer ${tok(CG, 'caregiver')}`)
      .send({ timeEntryId: entry.id, start: '2026-10-14T09:00', end: '2026-10-14T11:00', reason: 'wrong_times', note: 'overlap' });
    expect(r.status).toBe(409); expect(r.body.error).toMatch(/Other Client/);
  });
});

describe('office review', () => {
  beforeEach(() => { mockQuery.mockReset(); mockClientQuery.mockReset(); });

  test('caregivers cannot list or approve', async () => {
    fakeDb();
    expect((await request(app).get('/api/time-corrections').set('Authorization', `Bearer ${tok(CG, 'caregiver')}`)).status).toBe(403);
    expect((await request(app).post('/api/time-corrections/tc1/approve').set('Authorization', `Bearer ${tok(CG, 'caregiver')}`).send({})).status).toBe(403);
  });

  test('approving a "forgot to clock out" rewrites the visit, prices it like a clock-out, and records the EVV change', async () => {
    fakeDb();
    const tc = { id: 'tc1', status: 'pending', kind: 'fix_times', caregiver_id: CG, client_id: 'c1', time_entry_id: 'te1', vd: '2026-10-14',
      requested_start: '2026-10-14T14:00:00Z', requested_end: '2026-10-14T16:00:00Z', original_start: '2026-10-14T14:00:00Z', original_end: null,
      reason: 'forgot_clock_out', note: 'Phone died' };
    const writes = [];
    mockClientQuery.mockImplementation(async (sql, params) => {
      if (/FROM time_corrections WHERE id = \$1 FOR UPDATE/.test(sql)) return { rows: [tc] };
      if (/FROM clients c LEFT JOIN referral_sources/.test(sql)) return { rows: [{ is_private_pay: false, payer_type: 'mco_family_care' }] };
      if (/SELECT \* FROM time_entries WHERE id = \$1 FOR UPDATE/.test(sql)) return { rows: [{ id: 'te1', allotted_minutes: 90, schedule_id: 's1' }] };
      if (/UPDATE time_entries|INSERT INTO visit_time_changes|UPDATE time_corrections/.test(sql)) writes.push([sql, params]);
      return { rows: [] };
    });
    const r = await request(app).post('/api/time-corrections/tc1/approve').set('Authorization', `Bearer ${tok(ADMIN, 'admin')}`).send({ evvReasonCode: '1' });
    expect(r.status).toBe(200);
    expect(r.body.billableMinutes).toBe(90);                               // payer + schedule → scheduled 90, not the 120 requested
    const upd = writes.find(([sql]) => /UPDATE time_entries/.test(sql));
    expect(upd[1].slice(0, 5)).toEqual(['2026-10-14T14:00:00.000Z', '2026-10-14T16:00:00.000Z', 120, 90, 30]);
    const vtc = writes.find(([sql]) => /INSERT INTO visit_time_changes/.test(sql));
    expect(vtc[1][6]).toBe('1');
    expect(mockClientQuery.mock.calls.some(([sql]) => sql === 'COMMIT')).toBe(true);
  });

  test('deny needs a note the caregiver will see', async () => {
    fakeDb();
    const r = await request(app).post('/api/time-corrections/tc1/deny').set('Authorization', `Bearer ${tok(ADMIN, 'admin')}`).send({ note: '' });
    expect(r.status).toBe(400);
  });
});
