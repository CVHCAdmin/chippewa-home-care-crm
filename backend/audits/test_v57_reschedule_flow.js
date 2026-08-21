// END-TO-END TEST of the caregiver reschedule flow, run against the real prod
// schema inside a single transaction that is ALWAYS rolled back — every write
// below disappears when the script exits, so this leaves no trace in prod.
//
// It runs the real router (real auth middleware, real handlers, real SQL); only
// db.query is redirected onto the transaction's client.
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const db = require('../src/db');          // must be required BEFORE the routes
const jwt = require('jsonwebtoken');
const express = require('express');

const MAGGIE = 'f7520d68-7a3c-4538-892c-ca69f286a370';

let client;              // the one transaction client every query runs on
const origQuery = db.query;

const ok = [];
const bad = [];
const check = (name, pass, detail) => {
  (pass ? ok : bad).push(name + (detail ? ` — ${detail}` : ''));
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
};

(async () => {
  let server;
  try {
    client = await db.pool.connect();
    await client.query('BEGIN');
    db.query = (text, params) => client.query(text, params);

    // ── pick real fixtures ───────────────────────────────────────────────────
    const admin = (await db.query(
      `SELECT id, email, role FROM users WHERE role='admin' AND is_active=true ORDER BY created_at LIMIT 1`)).rows[0];
    if (!admin) throw new Error('no admin user to act as');

    // A future recurring shift of Maggie's. Friday = 5.
    const sched = (await db.query(`
      SELECT s.id, s.client_id, s.day_of_week, s.start_time, s.end_time,
             c.first_name || ' ' || c.last_name AS client
        FROM schedules s JOIN clients c ON c.id = s.client_id
       WHERE s.caregiver_id = $1 AND s.is_active = true AND s.day_of_week = 5
         AND s.end_date IS NULL
       ORDER BY s.start_time LIMIT 1`, [MAGGIE])).rows[0];
    if (!sched) throw new Error('no Friday recurring shift for Maggie');

    // Next Friday from today, as a local calendar date.
    const t = new Date(); t.setHours(0, 0, 0, 0);
    const d = new Date(t);
    while (d.getDay() !== 5 || d <= t) d.setDate(d.getDate() + 1);
    const ymd = (x) => `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`;
    const VISIT_DATE = ymd(d);
    const NEW_DATE   = ymd(new Date(d.getTime() + 86400000)); // Saturday

    console.log(`fixture: schedule ${sched.id} (${sched.client}) ${sched.start_time}-${sched.end_time} on ${VISIT_DATE} -> ${NEW_DATE}\n`);

    // ── boot the real router ─────────────────────────────────────────────────
    const routes = require('../src/routes/clientPortalRoutes');
    const app = express();
    app.use(express.json());
    app.use('/api/client-portal', routes);
    server = app.listen(0);
    const port = server.address().port;
    const base = `http://127.0.0.1:${port}/api/client-portal`;

    const tok = (u) => jwt.sign({ id: u.id, email: u.email, role: u.role }, process.env.JWT_SECRET, { expiresIn: '1h' });
    const cgTok = tok({ id: MAGGIE, email: 'maggie@test', role: 'caregiver' });
    const adTok = tok(admin);

    const call = async (method, path, token, body) => {
      const r = await fetch(base + path, {
        method,
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: body ? JSON.stringify(body) : undefined,
      });
      let json = null;
      try { json = await r.json(); } catch { /* empty body */ }
      return { status: r.status, body: json };
    };

    const REQ = {
      scheduleId: sched.id,
      visitDate: VISIT_DATE,
      startTime: sched.start_time,
      endTime: sched.end_time,
      proposedDate: NEW_DATE,
      proposedStartTime: '10:00:00',
      proposedEndTime: '12:15:00',
      reason: 'v57 automated test',
    };

    // ── 1. caregiver files the request ───────────────────────────────────────
    const created = await call('POST', '/caregiver/reschedule-request', cgTok, REQ);
    check('caregiver can file a reschedule request', created.status === 201,
      created.status !== 201 ? JSON.stringify(created.body) : `id ${created.body.id}`);
    const crId = created.body?.id;
    check('request is tagged as caregiver-originated', created.body?.requested_by === 'caregiver', String(created.body?.requested_by));

    // ── 2. guards ────────────────────────────────────────────────────────────
    const dup = await call('POST', '/caregiver/reschedule-request', cgTok, REQ);
    check('second request for the same visit is refused', dup.status === 409, `${dup.status} ${dup.body?.error || ''}`);

    const noop = await call('POST', '/caregiver/reschedule-request', cgTok, {
      ...REQ, proposedDate: VISIT_DATE, proposedStartTime: sched.start_time, proposedEndTime: sched.end_time });
    check('asking for the time it already has is refused', noop.status === 400, String(noop.status));

    const other = (await db.query(
      `SELECT id FROM users WHERE role='caregiver' AND id <> $1 AND is_active=true LIMIT 1`, [MAGGIE])).rows[0];
    const foreign = await call('POST', '/caregiver/reschedule-request',
      tok({ id: other.id, email: 'other@test', role: 'caregiver' }), { ...REQ, visitDate: VISIT_DATE });
    check("a caregiver cannot move someone else's shift", foreign.status === 403, `${foreign.status} ${foreign.body?.error || ''}`);

    const selfApprove = await call('PUT', `/admin/change-requests/${crId}/resolve`, cgTok, { action: 'approve' });
    check('caregiver cannot approve their own request', selfApprove.status === 403, `${selfApprove.status} ${selfApprove.body?.error || ''}`);

    // ── 3. it reaches the office queue ───────────────────────────────────────
    const queue = await call('GET', '/admin/change-requests?status=pending', adTok);
    const mine = (queue.body || []).find(r => r.id === crId);
    check('request shows in the admin queue the Hub reads', !!mine,
      mine ? `client ${mine.client_first_name} ${mine.client_last_name}` : 'not found');

    // ── 4. approve, and check the SCHEDULE actually moved ────────────────────
    const approved = await call('PUT', `/admin/change-requests/${crId}/resolve`, adTok, { action: 'approve' });
    check('admin can approve', approved.status === 200, JSON.stringify(approved.body));

    const exc = (await db.query(
      `SELECT exception_type FROM schedule_exceptions WHERE schedule_id=$1 AND exception_date=$2::date`,
      [sched.id, VISIT_DATE])).rows[0];
    check('original occurrence is cancelled', exc?.exception_type === 'cancelled', String(exc?.exception_type));

    const moved = (await db.query(`
      SELECT id, date, start_time, end_time, day_of_week, schedule_type, notes
        FROM schedules
       WHERE caregiver_id=$1 AND client_id=$2 AND date=$3::date AND is_active=true`,
      [MAGGIE, sched.client_id, NEW_DATE])).rows[0];
    check('a real shift exists on the new date', !!moved,
      moved ? `${moved.start_time}-${moved.end_time} "${moved.notes}"` : 'missing');
    check('new shift is one-time, not a new recurring pattern',
      moved && moved.day_of_week === null, String(moved?.day_of_week));

    const vcr = (await db.query('SELECT status, applied_schedule_id FROM visit_change_requests WHERE id=$1', [crId])).rows[0];
    check('request records where the move landed',
      vcr?.status === 'approved' && vcr?.applied_schedule_id === moved?.id, JSON.stringify(vcr));

    // ── 5. the real engine agrees (this is what phone/Hub/payroll/billing read)
    const { SCHEDULE_OCCURRENCES_CTE } = require('../src/helpers/scheduleOccurrences');
    const occ = await db.query(`
      WITH ${SCHEDULE_OCCURRENCES_CTE()}
      SELECT schedule_id, occ_date, start_time, end_time, client_id
        FROM schedule_occurrences
       WHERE caregiver_id = $3 AND client_id = $4
       ORDER BY occ_date`, [VISIT_DATE, NEW_DATE, MAGGIE, sched.client_id]);
    // The new date may already carry unrelated shifts for this pair, so assert on
    // THIS move: the old occurrence of THIS pattern is gone, and the row the move
    // created generates exactly one occurrence, on the new date, at the new time.
    const onOld  = occ.rows.filter(r => ymd(r.occ_date) === VISIT_DATE && r.schedule_id === sched.id);
    const fromNew = occ.rows.filter(r => r.schedule_id === moved?.id);
    check('engine no longer generates the old occurrence', onOld.length === 0, `${onOld.length} found`);
    check('engine generates the moved shift once, on the new date, at the new time',
      fromNew.length === 1 && ymd(fromNew[0].occ_date) === NEW_DATE && fromNew[0].start_time === '10:00:00',
      JSON.stringify(fromNew));

    // ── 6. same-day time change takes the exception path ─────────────────────
    const sched2 = (await db.query(`
      SELECT id, client_id, start_time, end_time FROM schedules
       WHERE caregiver_id=$1 AND is_active=true AND day_of_week=1 AND end_date IS NULL
       LIMIT 1`, [MAGGIE])).rows[0];
    const mon = new Date(t);
    while (mon.getDay() !== 1 || mon <= t) mon.setDate(mon.getDate() + 1);
    const MON = ymd(mon);
    const timeOnly = await call('POST', '/caregiver/reschedule-request', cgTok, {
      scheduleId: sched2.id, visitDate: MON, startTime: sched2.start_time, endTime: sched2.end_time,
      proposedDate: MON, proposedStartTime: '15:30:00', proposedEndTime: '17:00:00', reason: 'v57 time-only',
    });
    check('time-only move accepted', timeOnly.status === 201, String(timeOnly.status));
    const appr2 = await call('PUT', `/admin/change-requests/${timeOnly.body?.id}/resolve`, adTok, { action: 'approve' });
    check('time-only move approved', appr2.status === 200, JSON.stringify(appr2.body));

    const exc2 = (await db.query(
      `SELECT exception_type, override_start_time, override_end_time FROM schedule_exceptions
        WHERE schedule_id=$1 AND exception_date=$2::date`, [sched2.id, MON])).rows[0];
    check('time-only move writes a modified exception WITH the new times',
      exc2?.exception_type === 'modified' && exc2?.override_start_time === '15:30:00',
      JSON.stringify(exc2));

    const occ2 = await db.query(`
      WITH ${SCHEDULE_OCCURRENCES_CTE()}
      SELECT occ_date, start_time, end_time FROM schedule_occurrences
       WHERE caregiver_id=$3 AND client_id=$4`, [MON, MON, MAGGIE, sched2.client_id]);
    check('engine reports the new times on the same day',
      occ2.rows.length === 1 && occ2.rows[0].start_time === '15:30:00', JSON.stringify(occ2.rows));

    // ── 7. denial leaves the schedule untouched ──────────────────────────────
    const sched3 = (await db.query(`
      SELECT id, client_id, start_time, end_time FROM schedules
       WHERE caregiver_id=$1 AND is_active=true AND day_of_week=3 AND end_date IS NULL LIMIT 1`, [MAGGIE])).rows[0];
    const wed = new Date(t);
    while (wed.getDay() !== 3 || wed <= t) wed.setDate(wed.getDate() + 1);
    const WED = ymd(wed);
    const toDeny = await call('POST', '/caregiver/reschedule-request', cgTok, {
      scheduleId: sched3.id, visitDate: WED, startTime: sched3.start_time, endTime: sched3.end_time,
      proposedDate: WED, proposedStartTime: '19:00:00', proposedEndTime: '20:00:00', reason: 'v57 deny path',
    });
    const denied = await call('PUT', `/admin/change-requests/${toDeny.body?.id}/resolve`, adTok,
      { action: 'deny', adminNotes: 'client needs the morning' });
    check('admin can deny', denied.status === 200, JSON.stringify(denied.body));
    const exc3 = (await db.query(
      `SELECT 1 FROM schedule_exceptions WHERE schedule_id=$1 AND exception_date=$2::date`, [sched3.id, WED])).rowCount;
    check('denial writes no exception — the shift stays put', exc3 === 0, `${exc3} exceptions`);
    const cgNote = (await db.query(
      `SELECT title FROM notifications WHERE user_id=$1 AND type='reschedule_denied'`, [MAGGIE])).rows[0];
    check('caregiver is told it was denied', !!cgNote, cgNote?.title);
    const clientNote = (await db.query(
      `SELECT 1 FROM client_notifications WHERE client_id=$1 AND type='change_request_denied'`, [sched3.client_id])).rowCount;
    check('client is NOT told about a request they never made', clientNote === 0, `${clientNote} client notifications`);

    // ── 8. an already-worked visit must not be movable ───────────────────────
    // Cancelling the occurrence behind a real punch drops it into payroll's
    // uncapped "unscheduled clock-in" branch and out of billing.
    const worked = (await db.query(`
      SELECT te.id, te.caregiver_id, te.client_id,
             DATE(te.start_time AT TIME ZONE 'America/Chicago') AS d
        FROM time_entries te
       WHERE te.caregiver_id = $1
       ORDER BY te.start_time DESC LIMIT 1`, [MAGGIE])).rows[0];
    const workedSched = (await db.query(`
      SELECT id, start_time, end_time FROM schedules
       WHERE caregiver_id=$1 AND client_id=$2 AND is_active=true LIMIT 1`,
      [MAGGIE, worked.client_id])).rows[0];
    const onWorked = await call('POST', '/caregiver/reschedule-request', cgTok, {
      scheduleId: workedSched.id, visitDate: ymd(worked.d),
      startTime: workedSched.start_time, endTime: workedSched.end_time,
      proposedDate: NEW_DATE, proposedStartTime: '08:00:00', proposedEndTime: '09:00:00',
      reason: 'v57 already-worked guard',
    });
    check('cannot file a move for a visit already worked', onWorked.status === 409,
      `${onWorked.status} ${onWorked.body?.error || ''}`);

    // And the guard holds at approval time, for a request filed before the punch.
    const preFiled = (await db.query(`
      INSERT INTO visit_change_requests
        (client_id, caregiver_id, request_type, schedule_id, visit_date,
         original_start_time, original_end_time, proposed_date, proposed_start_time,
         proposed_end_time, requested_by, request_reason)
      VALUES ($1,$2,'reschedule',$3,$4::date,$5,$6,$7::date,'08:00:00','09:00:00','caregiver','v57 pre-filed')
      RETURNING id`,
      [worked.client_id, MAGGIE, workedSched.id, ymd(worked.d),
       workedSched.start_time, workedSched.end_time, NEW_DATE])).rows[0];
    const lateApprove = await call('PUT', `/admin/change-requests/${preFiled.id}/resolve`, adTok, { action: 'approve' });
    check('cannot approve a move for a visit worked in the meantime', lateApprove.status === 409,
      `${lateApprove.status} ${lateApprove.body?.error || ''}`);
    const stillThere = (await db.query(
      `SELECT 1 FROM schedule_exceptions WHERE schedule_id=$1 AND exception_date=$2::date AND exception_type='cancelled'`,
      [workedSched.id, ymd(worked.d)])).rowCount;
    check('blocked approval left the worked day untouched', stillThere === 0, `${stillThere} cancellations`);

    // ── 9. clock-in access for moved-in coverage ─────────────────────────────
    const covered = (await db.query(`
      SELECT count(*)::int AS n FROM clients c
       WHERE c.is_active = true
         AND EXISTS (SELECT 1 FROM schedules s2
                      WHERE s2.client_id=c.id AND s2.caregiver_id=$1 AND s2.is_active=true)`, [MAGGIE])).rows[0].n;
    check('Maggie still sees her own clients in the clock-in list', covered > 0, `${covered} clients`);

  } catch (e) {
    console.error('\nHARNESS ERROR:', e.message);
    console.error(e.stack);
    bad.push('harness: ' + e.message);
  } finally {
    try { await client.query('ROLLBACK'); console.log('\nrolled back — prod is unchanged'); } catch (e) { console.error('ROLLBACK FAILED:', e.message); }
    db.query = origQuery;
    try { client.release(); } catch {}
    try { if (server) server.close(); } catch {}
    try { await db.pool.end(); } catch {}
    console.log(`\n${ok.length} passed, ${bad.length} failed`);
    if (bad.length) { console.log('failures:'); bad.forEach(b => console.log('  - ' + b)); process.exitCode = 1; }
  }
})();
