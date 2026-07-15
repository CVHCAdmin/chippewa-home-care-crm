// Verifies the display-tier edits made right before the login outage interrupted, which
// had never been run: dashboard (today counts + live board on the shared engine), the
// call-out flow (miss-report must CANCEL the occurrence), and the open-shift double-booking
// guard. Hits the real endpoints via supertest where possible.
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const request = require('supertest');
const jwt = require('jsonwebtoken');
const app = require('../src/server');
const db = require('../src/db');
const { SCHEDULE_OCCURRENCES_CTE } = require('../src/helpers/scheduleOccurrences');

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { console.log(`  OK   ${m}`); pass++; } else { console.log(`  FAIL ${m}`); fail++; } };

// Remove all test rows in FK-safe order. open_shifts references BOTH clients and absences
// (source_absence_id), so it must be deleted before either. Used for both the idempotent
// pre-scrub and the final cleanup.
async function purge() {
  const u = await db.query(`SELECT id FROM users WHERE email LIKE 'zz-display-%@cvhc.test'`);
  const ids = u.rows.map(r => r.id);
  // open_shifts first — it FK-references clients, schedules, absences, users.
  await db.query(`DELETE FROM open_shifts WHERE client_id IN (SELECT id FROM clients WHERE first_name='ZZ' AND last_name='DispClient')`);
  if (ids.length) {
    await db.query(`DELETE FROM open_shifts WHERE created_by = ANY($1) OR claimed_by = ANY($1)`, [ids]);
    const s = await db.query(`SELECT id FROM schedules WHERE caregiver_id = ANY($1)`, [ids]);
    const sids = s.rows.map(r => r.id);
    if (sids.length) await db.query(`DELETE FROM schedule_exceptions WHERE schedule_id = ANY($1)`, [sids]);
    await db.query(`DELETE FROM schedules WHERE caregiver_id = ANY($1)`, [ids]);
    await db.query(`DELETE FROM absences WHERE caregiver_id = ANY($1)`, [ids]);
    await db.query(`DELETE FROM notifications WHERE user_id = ANY($1)`, [ids]);
  }
  await db.query(`DELETE FROM clients WHERE first_name='ZZ' AND last_name='DispClient'`);
  await db.query(`DELETE FROM users WHERE email LIKE 'zz-display-%@cvhc.test'`);
}

(async () => {
  await purge();
  const admin = (await db.query(
    `INSERT INTO users (email,password_hash,first_name,last_name,role,is_active)
     VALUES ('zz-display-admin@cvhc.test','x','ZZ','DispAdmin','admin',true) RETURNING id`)).rows[0].id;
  const cg = (await db.query(
    `INSERT INTO users (email,password_hash,first_name,last_name,role,is_active)
     VALUES ('zz-display-cg@cvhc.test','x','ZZ','DispCg','caregiver',true) RETURNING id`)).rows[0].id;
  const cl = (await db.query(
    `INSERT INTO clients (first_name,last_name,is_active) VALUES ('ZZ','DispClient',true) RETURNING id`)).rows[0].id;
  const token = jwt.sign({ id: admin, email: 'zz-display-admin@cvhc.test', role: 'admin', name: 'ZZ DispAdmin' }, process.env.JWT_SECRET, { expiresIn: '1h' });
  const auth = (r) => r.set('Authorization', `Bearer ${token}`);

  // today's Chicago date + weekday
  const t = (await db.query(
    `SELECT to_char((NOW() AT TIME ZONE 'America/Chicago')::date,'YYYY-MM-DD') AS d,
            EXTRACT(DOW FROM (NOW() AT TIME ZONE 'America/Chicago'))::int AS dow`)).rows[0];
  const TODAY = t.d, DOW = t.dow;

  const occToday = async () => {
    const r = await db.query(
      `WITH ${SCHEDULE_OCCURRENCES_CTE('o')} SELECT COUNT(*) n FROM o WHERE o.caregiver_id=$3 AND o.client_id=$4`,
      [TODAY, TODAY, cg, cl]);
    return Number(r.rows[0].n);
  };

  try {
    // ── Dashboard: the big rewrite must actually execute and return sane shapes ──
    console.log('\nDashboard summary + live board run on the shared engine (no SQL errors)');
    const sum = await auth(request(app).get('/api/dashboard/summary'));
    ok(sum.status === 200, `GET /dashboard/summary 200 (got ${sum.status})`);
    ok(typeof sum.body.todayShifts === 'number', `todayShifts is a number (got ${sum.body.todayShifts})`);
    ok(typeof sum.body.remainingShifts === 'number', `remainingShifts is a number (got ${sum.body.remainingShifts})`);
    const board = await auth(request(app).get('/api/dashboard/live-board'));
    ok(board.status === 200, `GET /dashboard/live-board 200 (got ${board.status})`);
    ok(Array.isArray(board.body.shifts), `live-board returns { shifts: [...] } (got ${typeof board.body.shifts})`);

    // ── Dashboard must EXCLUDE a cancelled visit from today's board ──
    console.log("\nA cancelled visit today drops off the live board");
    const sToday = (await db.query(
      `INSERT INTO schedules (caregiver_id,client_id,schedule_type,day_of_week,start_time,end_time,frequency,effective_date,is_active)
       VALUES ($1,$2,'recurring',$3,'09:00','11:00','weekly',($4::date - 30),true) RETURNING id`,
      [cg, cl, DOW, TODAY])).rows[0].id;
    const boardWith = await auth(request(app).get('/api/dashboard/live-board'));
    const onBoard = (r) => (r.body.shifts || []).some(x => x.schedule_id === sToday);
    ok(onBoard(boardWith), `the live shift shows on the board before cancelling`);
    await db.query(`INSERT INTO schedule_exceptions (schedule_id,exception_date,exception_type) VALUES ($1,$2,'cancelled')`, [sToday, TODAY]);
    const boardAfter = await auth(request(app).get('/api/dashboard/live-board'));
    ok(!onBoard(boardAfter), `after cancelling, it's GONE from the board (was shown as "not clocked in" before the fix)`);
    await db.query('DELETE FROM schedule_exceptions WHERE schedule_id=$1', [sToday]);
    await db.query('DELETE FROM schedules WHERE id=$1', [sToday]);

    // ── Call-out: miss-report must CANCEL the occurrence ──
    console.log('\nReporting a call-out cancels that day\'s occurrence (stops reminders/no-show/pay)');
    const sCall = (await db.query(
      `INSERT INTO schedules (caregiver_id,client_id,schedule_type,day_of_week,start_time,end_time,frequency,effective_date,is_active)
       VALUES ($1,$2,'recurring',$3,'10:00','12:00','weekly',($4::date - 30),true) RETURNING id`,
      [cg, cl, DOW, TODAY])).rows[0].id;
    ok(await occToday() === 1, `before: the occurrence exists today`);
    const cgToken = jwt.sign({ id: cg, email: 'zz-display-cg@cvhc.test', role: 'caregiver', name: 'ZZ DispCg' }, process.env.JWT_SECRET, { expiresIn: '1h' });
    const miss = await request(app).post('/api/emergency/miss-report')
      .set('Authorization', `Bearer ${cgToken}`)
      .send({ scheduleId: sCall, date: TODAY, reason: 'sick' });
    ok(miss.status === 200 || miss.status === 201, `miss-report accepted (got ${miss.status})`);
    const exc = await db.query(
      `SELECT exception_type FROM schedule_exceptions WHERE schedule_id=$1 AND exception_date=$2`, [sCall, TODAY]);
    ok(exc.rows[0]?.exception_type === 'cancelled', `a 'cancelled' exception was written (got ${exc.rows[0]?.exception_type})`);
    ok(await occToday() === 0, `the occurrence is now GONE — nothing will remind/alert/pay it (got ${await occToday()})`);
    await db.query('DELETE FROM schedule_exceptions WHERE schedule_id=$1', [sCall]);
    await db.query('DELETE FROM schedules WHERE id=$1', [sCall]);

    // ── Open-shift double-booking guard: a recurring shift must block a conflicting claim ──
    console.log('\nA recurring shift blocks a conflicting open-shift claim (was invisible before)');
    const sBusy = (await db.query(
      `INSERT INTO schedules (caregiver_id,client_id,schedule_type,day_of_week,start_time,end_time,frequency,effective_date,is_active)
       VALUES ($1,$2,'recurring',$3,'09:00','11:00','weekly',($4::date - 30),true) RETURNING id`,
      [cg, cl, DOW, TODAY])).rows[0].id;
    // The exact conflict query from openShiftsRoutes, overlapping 09:00-11:00.
    const conflict = await db.query(
      `WITH ${SCHEDULE_OCCURRENCES_CTE('occ')}
       SELECT occ.schedule_id FROM occ JOIN schedules s ON s.id=occ.schedule_id
       WHERE occ.caregiver_id=$3 AND (occ.start_time,occ.end_time) OVERLAPS ($4::time,$5::time)
         AND COALESCE(s.status,'') != 'cancelled'`,
      [TODAY, TODAY, cg, '10:00', '12:00']);
    ok(conflict.rows.length > 0, `overlapping recurring shift is detected as a conflict (found ${conflict.rows.length})`);
    // And a NON-overlapping time is clear.
    const clear = await db.query(
      `WITH ${SCHEDULE_OCCURRENCES_CTE('occ')}
       SELECT occ.schedule_id FROM occ JOIN schedules s ON s.id=occ.schedule_id
       WHERE occ.caregiver_id=$3 AND (occ.start_time,occ.end_time) OVERLAPS ($4::time,$5::time)`,
      [TODAY, TODAY, cg, '14:00', '15:00']);
    ok(clear.rows.length === 0, `a non-overlapping time is NOT a conflict (found ${clear.rows.length})`);
    await db.query('DELETE FROM schedules WHERE id=$1', [sBusy]);
  } catch (e) {
    console.error('\nTEST ERROR:', e.message, e.stack); fail++;
  } finally {
    await purge();
    console.log('\ncleanup done');
    console.log(`\n${'='.repeat(50)}\nPASS: ${pass}   FAIL: ${fail}\n${'='.repeat(50)}`);
    process.exit(fail ? 1 : 0);
  }
})();
