// Tests the "family cancelled a one-time shift in the portal, office then re-timed the same
// row" bug (Gerald Thronton / Ericka, 11/21/2026) against the real app + live schema.
// EVERY write runs inside ONE transaction that is ROLLED BACK: db.query, db.pool.query,
// db.pool.connect and db.auditLog are all routed to it (memory feedback_testing_against_prod).
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
process.env.TWILIO_ACCOUNT_SID = ''; process.env.TWILIO_AUTH_TOKEN = '';
const request = require('supertest');
const jwt = require('jsonwebtoken');
const db = require('../src/db');
const { SCHEDULE_OCCURRENCES_CTE } = require('../src/helpers/scheduleOccurrences');

const CG = 'a27b3e86-9dec-4643-81f4-7dad0c5325e3';   // Ericka Schmitt
const CL = 'b9ccd0a5-72f3-48ed-9d4f-cc62d2e18f36';   // Gerald Thronton
const DATE = '2027-03-06';                            // far-future Saturday, nothing else there

(async () => {
  const client = await db.pool.connect();
  const real = { query: db.query, connect: db.pool.connect, poolQuery: db.pool.query, audit: db.auditLog };
  let fail = 0;
  const check = (n, ok, x) => { if (!ok) fail++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${x !== undefined ? ' — ' + JSON.stringify(x) : ''}`); };
  try {
    await client.query('BEGIN');
    db.query = (t, p) => client.query(t, p);
    db.pool.query = (t, p, cb) => (typeof p === 'function' ? client.query(t, p) : client.query(t, p, cb));
    db.auditLog = async () => {};
    db.pool.connect = async () => ({ query: (t, p) => {
      const s = typeof t === 'string' ? t.trim().toUpperCase() : '';
      if (s === 'BEGIN') return client.query('SAVEPOINT h');
      if (s === 'COMMIT') return client.query('RELEASE SAVEPOINT h');
      if (s === 'ROLLBACK') return client.query('ROLLBACK TO SAVEPOINT h').catch(() => {});
      return client.query(t, p); }, release: () => {} });

    const app = require('../src/server');
    const admin = (await client.query(`SELECT id, email, role FROM users WHERE role='admin' AND is_active LIMIT 1`)).rows[0];
    const tok = jwt.sign({ id: admin.id, email: admin.email, role: admin.role }, process.env.JWT_SECRET, { expiresIn: '5m' });
    const auth = { Authorization: `Bearer ${tok}` };

    const engine = async (sid) => (await client.query(
      `WITH ${SCHEDULE_OCCURRENCES_CTE('o')}
       SELECT o.start_time::text s, o.end_time::text e FROM o WHERE o.schedule_id=$3 AND o.occ_date=$1::date`,
      [DATE, DATE, sid])).rows;
    const excCount = async (sid) => (await client.query(
      `SELECT count(*)::int n FROM schedule_exceptions WHERE schedule_id=$1`, [sid])).rows[0].n;

    // The exact starting state: one-time 12pm-8pm, then cancelled by the family in the portal.
    const sid = (await client.query(
      `INSERT INTO schedules (caregiver_id, client_id, schedule_type, date, start_time, end_time, frequency, is_active, status)
       VALUES ($1,$2,'one-time',$3,'12:00','20:00','weekly',true,'active') RETURNING id`, [CG, CL, DATE])).rows[0].id;
    await client.query(
      `INSERT INTO schedule_exceptions (schedule_id, exception_date, exception_type) VALUES ($1,$2,'cancelled')`, [sid, DATE]);
    check('setup: engine drops the cancelled one-time shift', (await engine(sid)).length === 0);

    // ── B: the Hub and the caregiver app now RECEIVE the cancellation ──
    let r = await request(app).get('/api/schedules-all').set(auth);
    let row = r.body.find(s => s.id === sid);
    check('GET /api/schedules-all attaches the exception to a one-time row',
      r.status === 200 && row && row.exceptions.length === 1 && row.exceptions[0].exception_type === 'cancelled',
      row && row.exceptions.map(e => e.exception_type));
    const recurringWithExc = r.body.filter(s => s.day_of_week !== null && s.exceptions.length > 0).length;
    check('recurring rows still get their exceptions', recurringWithExc > 0, recurringWithExc);

    r = await request(app).get(`/api/schedules/${CG}`).set(auth);
    row = Array.isArray(r.body) ? r.body.find(s => s.id === sid) : null;
    check('GET /api/schedules/:caregiverId (caregiver app) attaches it too',
      r.status === 200 && row && row.exceptions.length === 1, r.status);
    r = await request(app).get(`/api/schedules/caregiver/${CG}`).set(auth);
    row = Array.isArray(r.body) ? r.body.find(s => s.id === sid) : null;
    check('GET /api/schedules/caregiver/:id attaches it too', r.status === 200 && row && row.exceptions.length === 1, r.status);

    // ── A: editing something that is NOT a reschedule leaves the cancellation alone ──
    r = await request(app).put(`/api/schedules-all/${sid}`).set(auth)
      .send({ clientId: CL, caregiverId: CG, dayOfWeek: null, date: DATE, startTime: '12:00', endTime: '20:00', notes: 'note only', frequency: 'weekly' });
    check('notes-only edit keeps the cancellation', r.status === 200 && r.body._clearedCancellation === false && (await excCount(sid)) === 1,
      { status: r.status, cleared: r.body._clearedCancellation, err: r.body.error });
    check('…and the shift is still cancelled to the engine', (await engine(sid)).length === 0);

    // ── A: the real-world edit — office re-times the cancelled row to 8pm-8am ──
    r = await request(app).put(`/api/schedules-all/${sid}`).set(auth)
      .send({ clientId: CL, caregiverId: CG, dayOfWeek: null, date: DATE, startTime: '20:00', endTime: '08:00', notes: '', frequency: 'weekly' });
    check('re-timing the shift clears the stale cancellation', r.status === 200 && r.body._clearedCancellation === true && (await excCount(sid)) === 0,
      { status: r.status, cleared: r.body._clearedCancellation, err: r.body.error });
    const occ = await engine(sid);
    check('engine (portal/billing/payroll) now sees 8pm-8am', occ.length === 1 && occ[0].s === '20:00:00' && occ[0].e === '08:00:00', occ);

    // ── the client portal's own query shows it ──
    const portal = await client.query(`
      WITH ${SCHEDULE_OCCURRENCES_CTE('occ')}
      SELECT 1 FROM occ JOIN schedules s ON s.id = occ.schedule_id JOIN users u ON u.id = occ.caregiver_id
       WHERE occ.client_id = $3 AND (s.status IS NULL OR s.status = 'active') AND occ.schedule_id = $4`,
      [DATE, DATE, CL, sid]);
    check('client-portal visits query returns the shift', portal.rows.length === 1);

    // ── a date move also clears it; a 'modified' exception is never touched ──
    await client.query(`INSERT INTO schedule_exceptions (schedule_id, exception_date, exception_type) VALUES ($1,$2,'cancelled')`, [sid, DATE]);
    await client.query(`INSERT INTO schedule_exceptions (schedule_id, exception_date, exception_type, override_start_time) VALUES ($1,'2027-03-13','modified','21:00')`, [sid]);
    r = await request(app).put(`/api/schedules-all/${sid}`).set(auth)
      .send({ clientId: CL, caregiverId: CG, dayOfWeek: null, date: '2027-03-07', startTime: '20:00', endTime: '08:00', notes: '', frequency: 'weekly' });
    const left = (await client.query(`SELECT exception_type FROM schedule_exceptions WHERE schedule_id=$1`, [sid])).rows.map(x => x.exception_type);
    check('moving the date clears the cancellation but keeps other exceptions', r.status === 200 && left.length === 1 && left[0] === 'modified', left);
  } catch (e) {
    console.error('ERROR:', e.message, e.stack); fail++;
  } finally {
    try { await client.query('ROLLBACK'); console.log('ROLLED BACK — no prod changes'); } catch (e) { console.error('rollback failed', e.message); }
    db.query = real.query; db.pool.connect = real.connect; db.pool.query = real.poolQuery; db.auditLog = real.audit;
    const stray = await db.query(`SELECT count(*)::int n FROM schedules WHERE client_id=$1 AND date IN ('2027-03-06','2027-03-07')`, [CL]);
    console.log('test rows left in prod after rollback:', stray.rows[0].n);
    client.release();
    await db.pool.end();
    console.log(fail ? `\n${fail} FAILURE(S)` : '\nALL PASS');
    process.exit(fail ? 1 : 0);
  }
})();
