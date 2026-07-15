// END-TO-END TEST of the scope-aware schedule edit.
//
// The question this has to answer is NOT "did the row change." It is:
//   when the back office corrects last week's shift at payday, does PAYROLL see it?
// Payroll reconciles against `scheduled_minutes`, which now comes from the one shared
// engine (helpers/scheduleOccurrences.js) — the same engine reports, billing, reminders
// and clock-in read. So asserting on the engine IS asserting on payroll.
//
// Imports the express app directly (no listener, no cron jobs fire). Creates throwaway
// caregiver/client/schedule rows, exercises the real endpoint, asserts on the real
// expansion, then deletes everything it made.
//
// Run it twice:
//   node audits/test_schedule_edit_scope.js              — normal
//   CLAMP_SIM=1 node audits/test_schedule_edit_scope.js  — with the DB session pinned
//     ahead of Chicago, reproducing prod (UTC Postgres) from 19:00 Chicago onward, where
//     the v36 trigger clamps a new pattern's effective_date forward and can open a
//     one-day hole that silently deletes a shift.
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

// Must happen BEFORE src/db is required — it reads DATABASE_URL at import time.
if (process.env.CLAMP_SIM) {
  const u = new URL(process.env.DATABASE_URL);
  u.searchParams.set('options', '-c timezone=Pacific/Auckland');
  process.env.DATABASE_URL = u.toString();
  console.log('CLAMP_SIM: DB session pinned to Pacific/Auckland (CURRENT_DATE = Chicago tomorrow)');
}

const request = require('supertest');
const jwt = require('jsonwebtoken');
const app = require('../src/server');
const db = require('../src/db');
const { SCHEDULE_OCCURRENCES_CTE } = require('../src/helpers/scheduleOccurrences');

const TODAY     = '2026-07-14';  // Tuesday
const YESTERDAY = '2026-07-13';
const PAST_MON  = '2026-07-06';  // already happened — the day the back office corrects
const PRIOR_MON = '2026-06-29';  // an even earlier week — must stay untouched
const NEXT_MON  = '2026-07-20';  // future
const EFF       = '2026-06-15';  // pattern started a month ago

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { console.log(`  OK   ${m}`); pass++; } else { console.log(`  FAIL ${m}`); fail++; } };
const d = (v) => (v ? String(new Date(v).toISOString()).slice(0, 10) : null);

// What payroll/reports/billing actually see on a given date.
async function occ(cgId, date) {
  const r = await db.query(
    `WITH ${SCHEDULE_OCCURRENCES_CTE('o')}
     SELECT o.start_time, o.end_time, o.minutes, o.caregiver_id
     FROM o WHERE o.caregiver_id = $3 AND o.occ_date = $1::date`,
    [date, date, cgId]
  );
  return r.rows.map(x => `${String(x.start_time).slice(0, 5)}-${String(x.end_time).slice(0, 5)}`);
}
// The exact number payroll reconciles against.
async function payrollMinutes(cgId, date) {
  const r = await db.query(
    `WITH ${SCHEDULE_OCCURRENCES_CTE('o')}
     SELECT COALESCE(SUM(o.minutes),0) AS m FROM o
     WHERE o.caregiver_id = $3 AND o.occ_date = $1::date`,
    [date, date, cgId]
  );
  return Number(r.rows[0].m);
}

async function mkSchedule(cg, cl, { start = '09:00', end = '11:00', endDate = null, dow = 1 } = {}) {
  // INSERT then UPDATE: the v36 trigger clamps a past effective_date forward, but only on
  // INSERT (`TG_OP = 'INSERT'`), so the UPDATE is what actually backdates the row.
  const r = await db.query(
    `INSERT INTO schedules (caregiver_id, client_id, schedule_type, day_of_week, start_time, end_time, frequency, effective_date, is_active)
     VALUES ($1,$2,'recurring',$6,$3,$4,'weekly',$5,true) RETURNING id`, [cg, cl, start, end, TODAY, dow]);
  await db.query(`UPDATE schedules SET effective_date=$2, end_date=$3 WHERE id=$1`, [r.rows[0].id, EFF, endDate]);
  return r.rows[0].id;
}

(async () => {
  const cg = (await db.query(
    `INSERT INTO users (email,password_hash,first_name,last_name,role,is_active)
     VALUES ('zz-sched-test@cvhc.test','x','ZZ','SchedTest','caregiver',true) RETURNING id`)).rows[0].id;
  const cg2 = (await db.query(
    `INSERT INTO users (email,password_hash,first_name,last_name,role,is_active)
     VALUES ('zz-sched-test2@cvhc.test','x','ZZ','CoverCaregiver','caregiver',true) RETURNING id`)).rows[0].id;
  const cl = (await db.query(
    `INSERT INTO clients (first_name,last_name) VALUES ('ZZ','SchedClient') RETURNING id`)).rows[0].id;
  const token = jwt.sign({ id: cg, email: 'zz-sched-test@cvhc.test', role: 'admin', name: 'ZZ SchedTest' }, process.env.JWT_SECRET, { expiresIn: '1h' });
  const PUT = (id, body) => request(app).put(`/api/schedules-all/${id}`).set('Authorization', `Bearer ${token}`).send(body);

  try {
    // ── TEST 1: a repeating edit with no scope must be REFUSED, not guessed at.
    console.log('\nTEST 1 — a repeating shift edited with NO scope is rejected (never silently guessed)');
    const s1 = await mkSchedule(cg, cl);
    const r1 = await PUT(s1, { clientId: cl, dayOfWeek: 1, startTime: '10:00', endTime: '12:00' });
    ok(r1.status === 400, `rejected with 400 (got ${r1.status})`);
    ok(r1.body.code === 'scope_required', `told the caller a scope is required (got '${r1.body.code}')`);
    ok((await occ(cg, PAST_MON))[0] === '09:00-11:00', `and the past was NOT touched (got ${await occ(cg, PAST_MON)})`);

    // ── TEST 2: THE PAYDAY WORKFLOW. Correct one past day; payroll must see it.
    console.log("\nTEST 2 — 'just this day' on a PAST date: the correction reaches PAYROLL");
    ok(await payrollMinutes(cg, PAST_MON) === 120, `before: payroll sees 120 min for ${PAST_MON}`);
    const r2 = await PUT(s1, { scope: 'this', editDate: PAST_MON, startTime: '09:00', endTime: '10:30' });
    ok(r2.status === 200, `PUT 200 — correcting a past day is ALLOWED (got ${r2.status})`);
    ok(await payrollMinutes(cg, PAST_MON) === 90, `payroll now sees 90 min for that day (got ${await payrollMinutes(cg, PAST_MON)})`);
    ok((await occ(cg, PAST_MON))[0] === '09:00-10:30', `that day reads 09:00-10:30 (got ${await occ(cg, PAST_MON)})`);
    ok((await occ(cg, PRIOR_MON))[0] === '09:00-11:00', `the week BEFORE it is untouched (got ${await occ(cg, PRIOR_MON)})`);
    ok((await occ(cg, NEXT_MON))[0] === '09:00-11:00', `and next week is untouched (got ${await occ(cg, NEXT_MON)})`);

    // ── TEST 3: 'following' from a PAST date — an effective-dated correction.
    console.log("\nTEST 3 — 'from this day on' starting in the PAST: earlier weeks survive");
    await db.query('DELETE FROM schedule_exceptions WHERE schedule_id=$1', [s1]);
    const r3 = await PUT(s1, { scope: 'following', editDate: PAST_MON, startTime: '13:00', endTime: '15:00' });
    ok(r3.status === 200, `PUT 200 — a past 'following' date is allowed (got ${r3.status})`);
    ok((await occ(cg, PRIOR_MON))[0] === '09:00-11:00', `week BEFORE the change: still 09:00-11:00 (got ${await occ(cg, PRIOR_MON)})`);
    ok((await occ(cg, PAST_MON))[0] === '13:00-15:00', `the change week: now 13:00-15:00 (got ${await occ(cg, PAST_MON)})`);
    ok((await occ(cg, NEXT_MON))[0] === '13:00-15:00', `and every week after (got ${await occ(cg, NEXT_MON)})`);
    const noGap = await db.query(
      `WITH ${SCHEDULE_OCCURRENCES_CTE('o')} SELECT COUNT(*) n FROM o WHERE o.caregiver_id=$3 AND o.occ_date=$1::date`,
      [PAST_MON, PAST_MON, cg]);
    ok(Number(noGap.rows[0].n) === 1, `exactly ONE occurrence that day — no gap, no duplicate (got ${noGap.rows[0].n})`);

    // ── TEST 4: reassigning the caregiver actually reassigns them.
    console.log('\nTEST 4 — changing the caregiver on a repeating shift actually takes effect');
    await db.query('DELETE FROM schedules WHERE caregiver_id=$1 OR caregiver_id=$2', [cg, cg2]);
    const s4 = await mkSchedule(cg, cl);
    const r4 = await PUT(s4, { scope: 'following', editDate: TODAY, caregiverId: cg2, startTime: '09:00', endTime: '11:00' });
    ok(r4.status === 200, `PUT 200 (got ${r4.status})`);
    ok(r4.body.caregiver_id === cg2, `the live pattern now belongs to the new caregiver (got ${r4.body.caregiver_id === cg2 ? 'new' : 'OLD — reassign silently failed'})`);
    ok((await occ(cg2, NEXT_MON)).length === 1, `new caregiver has next Monday's shift`);
    ok((await occ(cg, PAST_MON)).length === 1, `old caregiver keeps the weeks they already worked`);

    // ── TEST 5: scope=all still rewrites history — but only when asked by name.
    console.log("\nTEST 5 — 'every occurrence' still rewrites history (explicit opt-in)");
    await db.query('DELETE FROM schedules WHERE caregiver_id=$1 OR caregiver_id=$2', [cg, cg2]);
    const s5 = await mkSchedule(cg, cl);
    const r5 = await PUT(s5, { scope: 'all', clientId: cl, dayOfWeek: 1, startTime: '07:00', endTime: '08:00' });
    ok(r5.status === 200, `PUT 200 (got ${r5.status})`);
    ok((await occ(cg, PAST_MON))[0] === '07:00-08:00', `the past DID change, as requested (got ${await occ(cg, PAST_MON)})`);

    // ── TEST 6: an edit must not resurrect a deleted (end-dated) pattern.
    console.log('\nTEST 6 — editing must NOT clear end_date (no resurrecting deleted shifts)');
    await db.query('DELETE FROM schedules WHERE caregiver_id=$1', [cg]);
    const s6 = await mkSchedule(cg, cl, { endDate: '2026-07-31' });
    const r6 = await PUT(s6, { scope: 'all', clientId: cl, dayOfWeek: 1, startTime: '10:00', endTime: '12:00' });
    ok(r6.status === 200, `PUT 200 (got ${r6.status})`);
    ok(d(r6.body.end_date) === '2026-07-31', `end_date PRESERVED (got ${d(r6.body.end_date)})`);

    // ── TEST 7: editing a shift that falls on TODAY must not delete today's occurrence.
    // This is the one the v36 clamp eats (see CLAMP_SIM): the old pattern ends yesterday and
    // the clamp pushes the new pattern to tomorrow, so today belongs to neither.
    console.log("\nTEST 7 — editing a shift scheduled for TODAY keeps today's occurrence");
    await db.query('DELETE FROM schedules WHERE caregiver_id=$1', [cg]);
    const todayDow = new Date(`${TODAY}T12:00:00Z`).getUTCDay();
    const s7 = await mkSchedule(cg, cl, { dow: todayDow });
    ok(await payrollMinutes(cg, TODAY) === 120, `before: today's shift exists (120 min)`);
    const r7 = await PUT(s7, { scope: 'following', editDate: TODAY, startTime: '10:00', endTime: '12:00' });
    ok(r7.status === 200, `PUT 200 (got ${r7.status})`);
    ok(d(r7.body.effective_date) === TODAY, `new pattern effective TODAY, not clamped forward (got ${d(r7.body.effective_date)})`);
    const t7 = await occ(cg, TODAY);
    ok(t7.length === 1, `today's shift SURVIVED (got ${t7.length} occurrence(s) — 0 means it vanished)`);
    ok(t7[0] === '10:00-12:00', `and carries the NEW time (got ${t7})`);

    // ── TEST 8: every edit is audit-logged.
    console.log('\nTEST 8 — every edit is audit-logged');
    await new Promise(r => setTimeout(r, 800)); // auditLog is fire-and-forget
    const a = await db.query(`SELECT COUNT(*) n FROM audit_logs WHERE table_name='schedules' AND user_id=$1`, [cg]);
    ok(parseInt(a.rows[0].n) >= 5, `audit_logs rows written: ${a.rows[0].n} (was 0 before — endpoint had no logging)`);
  } catch (e) {
    console.error('\nTEST ERROR:', e.message, e.stack);
    fail++;
  } finally {
    const ids = (await db.query('SELECT id FROM schedules WHERE caregiver_id=$1 OR caregiver_id=$2', [cg, cg2])).rows.map(r => r.id);
    if (ids.length) await db.query('DELETE FROM schedule_exceptions WHERE schedule_id = ANY($1)', [ids]);
    await db.query('DELETE FROM schedules WHERE caregiver_id=$1 OR caregiver_id=$2', [cg, cg2]);
    await db.query(`DELETE FROM audit_logs WHERE user_id=$1`, [cg]);
    await db.query('DELETE FROM clients WHERE id=$1', [cl]);
    await db.query('DELETE FROM users WHERE id=$1 OR id=$2', [cg, cg2]);
    console.log('\ncleanup done (all temp rows removed)');
    console.log(`\n${'='.repeat(52)}\nPASS: ${pass}   FAIL: ${fail}\n${'='.repeat(52)}`);
    process.exit(fail ? 1 : 0);
  }
})();
