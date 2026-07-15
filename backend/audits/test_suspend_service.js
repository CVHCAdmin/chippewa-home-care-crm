// Verifies suspend/resume service. Because every money + ops path reads the shared engine,
// asserting on the engine's occurrences IS asserting that billing, payroll, reminders and
// no-show all stop for a suspended shift.
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const request = require('supertest');
const jwt = require('jsonwebtoken');
const app = require('../src/server');
const db = require('../src/db');
const { SCHEDULE_OCCURRENCES_CTE } = require('../src/helpers/scheduleOccurrences');

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { console.log(`  OK   ${m}`); pass++; } else { console.log(`  FAIL ${m}`); fail++; } };

async function purge() {
  const u = await db.query(`SELECT id FROM users WHERE email LIKE 'zz-susp-%@cvhc.test'`);
  const ids = u.rows.map(r => r.id);
  if (ids.length) await db.query(`DELETE FROM schedules WHERE caregiver_id = ANY($1)`, [ids]);
  await db.query(`DELETE FROM clients WHERE first_name='ZZ' AND last_name='SuspClient'`);
  await db.query(`DELETE FROM users WHERE email LIKE 'zz-susp-%@cvhc.test'`);
}

// count occurrences of a schedule between two dates (inclusive)
async function occCount(schedId, from, to) {
  const r = await db.query(
    `WITH ${SCHEDULE_OCCURRENCES_CTE('o')} SELECT COUNT(*) n FROM o WHERE o.schedule_id=$3`,
    [from, to, schedId]);
  return Number(r.rows[0].n);
}

(async () => {
  await purge();
  const cg = (await db.query(
    `INSERT INTO users (email,password_hash,first_name,last_name,role,is_active)
     VALUES ('zz-susp-cg@cvhc.test','x','ZZ','SuspCg','caregiver',true) RETURNING id`)).rows[0].id;
  const admin = (await db.query(
    `INSERT INTO users (email,password_hash,first_name,last_name,role,is_active)
     VALUES ('zz-susp-admin@cvhc.test','x','ZZ','SuspAdmin','admin',true) RETURNING id`)).rows[0].id;
  const cl = (await db.query(
    `INSERT INTO clients (first_name,last_name,is_active) VALUES ('ZZ','SuspClient',true) RETURNING id`)).rows[0].id;

  // Two recurring shifts for the same client: Monday (s1) and Wednesday (s2).
  const mk = async (dow) => {
    // INSERT then UPDATE: the v36 trigger clamps a past effective_date forward on INSERT
    // only, so the UPDATE is what actually backdates the pattern into the past.
    const r = await db.query(
      `INSERT INTO schedules (caregiver_id,client_id,schedule_type,day_of_week,start_time,end_time,frequency,effective_date,is_active)
       VALUES ($1,$2,'recurring',$3,'09:00','11:00','weekly',CURRENT_DATE,true) RETURNING id`, [cg, cl, dow]);
    await db.query(`UPDATE schedules SET effective_date='2026-06-01' WHERE id=$1`, [r.rows[0].id]);
    return r.rows[0].id;
  };
  const s1 = await mk(1); // Monday
  const s2 = await mk(3); // Wednesday

  const adminTok = jwt.sign({ id: admin, email: 'zz-susp-admin@cvhc.test', role: 'admin', name: 'ZZ SuspAdmin' }, process.env.JWT_SECRET, { expiresIn: '1h' });
  const cgTok = jwt.sign({ id: cg, email: 'zz-susp-cg@cvhc.test', role: 'caregiver', name: 'ZZ SuspCg' }, process.env.JWT_SECRET, { expiresIn: '1h' });
  const suspend = (id, body, tok = adminTok) => request(app).post(`/api/schedules/${id}/suspend`).set('Authorization', `Bearer ${tok}`).send(body);
  const resume = (id, body, tok = adminTok) => request(app).post(`/api/schedules/${id}/resume`).set('Authorization', `Bearer ${tok}`).send(body);

  // Window: 4 past weeks + 4 future weeks around a suspend date.
  const PAST = '2026-06-15', SUSPEND_FROM = '2026-07-20', FUTURE_END = '2026-08-17';

  try {
    console.log('\nBaseline: both shifts generate weekly across the window');
    const s1Before = await occCount(s1, PAST, FUTURE_END);
    const s2Before = await occCount(s2, PAST, FUTURE_END);
    ok(s1Before >= 8, `Monday shift has ${s1Before} occurrences`);
    ok(s2Before >= 8, `Wednesday shift has ${s2Before} occurrences`);

    console.log("\nSuspend 'this' (just Mondays) from 2026-07-20");
    const r1 = await suspend(s1, { scope: 'this', fromDate: SUSPEND_FROM });
    ok(r1.status === 200 && r1.body.suspended === 1, `suspended 1 schedule (got ${r1.status}/${r1.body.suspended})`);
    ok(await occCount(s1, SUSPEND_FROM, FUTURE_END) === 0, `NO Monday occurrences on/after the suspend date`);
    ok(await occCount(s1, PAST, '2026-07-19') > 0, `Mondays BEFORE the suspend date still generate (history kept)`);
    ok(await occCount(s2, SUSPEND_FROM, FUTURE_END) > 0, `Wednesdays are UNAFFECTED ('this' scope)`);

    console.log('\nResume it → Mondays come back');
    const r2 = await resume(s1, { scope: 'this' });
    ok(r2.status === 200 && r2.body.resumed === 1, `resumed 1 (got ${r2.status}/${r2.body.resumed})`);
    ok(await occCount(s1, SUSPEND_FROM, FUTURE_END) > 0, `Monday occurrences are back after resume`);

    console.log("\nSuspend 'client' (all days) from 2026-07-20 → BOTH shifts stop");
    const r3 = await suspend(s1, { scope: 'client', fromDate: SUSPEND_FROM });
    ok(r3.status === 200 && r3.body.suspended === 2, `suspended BOTH client schedules (got ${r3.body.suspended})`);
    ok(await occCount(s1, SUSPEND_FROM, FUTURE_END) === 0, `no Mondays on/after`);
    ok(await occCount(s2, SUSPEND_FROM, FUTURE_END) === 0, `no Wednesdays on/after either`);
    ok(await occCount(s1, PAST, '2026-07-19') > 0 && await occCount(s2, PAST, '2026-07-19') > 0, `both keep their pre-suspend history`);

    console.log("\nResume 'client' → both come back");
    const r4 = await resume(s2, { scope: 'client' });
    ok(r4.status === 200 && r4.body.resumed === 2, `resumed both (got ${r4.body.resumed})`);
    ok(await occCount(s1, SUSPEND_FROM, FUTURE_END) > 0 && await occCount(s2, SUSPEND_FROM, FUTURE_END) > 0, `both generating again`);

    console.log('\nSuspend is admin-only');
    const r5 = await suspend(s1, { scope: 'this' }, cgTok);
    ok(r5.status === 403, `a caregiver cannot suspend (got ${r5.status})`);
  } catch (e) {
    console.error('\nTEST ERROR:', e.message, e.stack); fail++;
  } finally {
    await purge();
    console.log('\ncleanup done');
    console.log(`\n${'='.repeat(50)}\nPASS: ${pass}   FAIL: ${fail}\n${'='.repeat(50)}`);
    process.exit(fail ? 1 : 0);
  }
})();
