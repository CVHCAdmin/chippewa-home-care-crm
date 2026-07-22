// Verifies: deactivating a caregiver ends their schedules (the July 2026 orphaned-
// schedule bug can't recur). Running recurring rows get end_date=today, future shifts
// deactivate, past one-time rows are untouched, and reactivating the caregiver does
// NOT resurrect the ended schedules. Also: the billing substitute-caregiver de-dupe.
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const request = require('supertest');
const jwt = require('jsonwebtoken');
const app = require('../src/server');
const db = require('../src/db');

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { console.log(`  OK   ${m}`); pass++; } else { console.log(`  FAIL ${m}`); fail++; } };

async function purge() {
  const u = await db.query(`SELECT id FROM users WHERE email LIKE 'zz-deact-%@cvhc.test'`);
  const ids = u.rows.map(r => r.id);
  if (ids.length) {
    await db.query(`DELETE FROM time_entries WHERE caregiver_id = ANY($1)`, [ids]);
    await db.query(`DELETE FROM schedules WHERE caregiver_id = ANY($1)`, [ids]);
  }
  await db.query(`DELETE FROM clients WHERE first_name='ZZ' AND last_name='DeactClient'`);
  await db.query(`DELETE FROM users WHERE email LIKE 'zz-deact-%@cvhc.test'`);
}

(async () => {
  await purge();
  const cg = (await db.query(
    `INSERT INTO users (email,password_hash,first_name,last_name,role,is_active)
     VALUES ('zz-deact-cg@cvhc.test','x','ZZ','DeactCg','caregiver',true) RETURNING id`)).rows[0].id;
  const sub = (await db.query(
    `INSERT INTO users (email,password_hash,first_name,last_name,role,is_active)
     VALUES ('zz-deact-sub@cvhc.test','x','ZZ','DeactSub','caregiver',true) RETURNING id`)).rows[0].id;
  const admin = (await db.query(
    `INSERT INTO users (email,password_hash,first_name,last_name,role,is_active)
     VALUES ('zz-deact-admin@cvhc.test','x','ZZ','DeactAdmin','admin',true) RETURNING id`)).rows[0].id;
  const adminTok = jwt.sign({ id: admin, role: 'admin' }, process.env.JWT_SECRET, { expiresIn: '1h' });
  const cl = (await db.query(
    `INSERT INTO clients (first_name,last_name,is_active,is_private_pay,private_pay_rate)
     VALUES ('ZZ','DeactClient',true,true,30) RETURNING id`)).rows[0].id;

  const today = (await db.query(`SELECT (NOW() AT TIME ZONE 'America/Chicago')::date d`)).rows[0].d;
  const iso = (dt) => new Date(dt).toISOString().slice(0, 10);
  const plus = (days) => { const d = new Date(today); d.setDate(d.getDate() + days); return d.toISOString().slice(0, 10); };

  // running recurring row (open-ended), future recurring row, future one-time, past one-time
  const mk = async (sql, params) => (await db.query(sql, params)).rows[0].id;
  const running = await mk(`INSERT INTO schedules (client_id,caregiver_id,day_of_week,start_time,end_time,frequency,is_active,effective_date)
    VALUES ($1,$2,1,'09:00','12:00','weekly',true,'2026-05-01') RETURNING id`, [cl, cg]);
  await db.query(`UPDATE schedules SET effective_date='2026-05-01' WHERE id=$1`, [running]);
  const future = await mk(`INSERT INTO schedules (client_id,caregiver_id,day_of_week,start_time,end_time,frequency,is_active,effective_date)
    VALUES ($1,$2,3,'09:00','12:00','weekly',true,$3) RETURNING id`, [cl, cg, plus(10)]);
  const futOne = await mk(`INSERT INTO schedules (client_id,caregiver_id,day_of_week,date,start_time,end_time,is_active)
    VALUES ($1,$2,NULL,$3,'13:00','15:00',true) RETURNING id`, [cl, cg, plus(5)]);
  const pastOne = await mk(`INSERT INTO schedules (client_id,caregiver_id,day_of_week,date,start_time,end_time,is_active)
    VALUES ($1,$2,NULL,'2026-06-10','13:00','15:00',true) RETURNING id`, [cl, cg]);

  console.log('Deactivate the caregiver via PUT /api/caregivers/:id');
  const res = await request(app).put(`/api/caregivers/${cg}`)
    .set('Authorization', `Bearer ${adminTok}`).send({ isActive: false });
  ok(res.status === 200 && res.body.is_active === false, `deactivated (got ${res.status})`);

  const row = async (id) => (await db.query(`SELECT is_active, end_date FROM schedules WHERE id=$1`, [id])).rows[0];
  const r1 = await row(running), r2 = await row(future), r3 = await row(futOne), r4 = await row(pastOne);
  ok(r1.is_active === true && r1.end_date && iso(r1.end_date) === iso(today), `running recurring row end-dated today (${iso(r1.end_date)}) — history kept`);
  ok(r2.is_active === false, 'future recurring row deactivated');
  ok(r3.is_active === false, 'future one-time shift deactivated');
  ok(r4.is_active === true && !r4.end_date, 'past one-time row untouched (history)');

  console.log('\nReactivate the caregiver — schedules must NOT resurrect');
  const rev = await request(app).put(`/api/caregivers/${cg}`)
    .set('Authorization', `Bearer ${adminTok}`).send({ isActive: true });
  ok(rev.status === 200 && rev.body.is_active === true, 'caregiver reactivated');
  const r1b = await row(running), r2b = await row(future);
  ok(r1b.end_date && iso(r1b.end_date) === iso(today), 'ended recurring row stays ended');
  ok(r2b.is_active === false, 'deactivated future row stays inactive');

  console.log('\nBilling substitute de-dupe: a punch covering >50% of another caregiver\'s scheduled window suppresses that line');
  // schedule: cg2=assigned Mon 9-12 (never clocks); sub actually works 9:05-11:55 (punch)
  const { generateLineItems } = require('../src/routes/billingRoutes');
  // reuse the still-ended `running` row's client; create a fresh assigned row for sub-test
  const assigned = await mk(`INSERT INTO schedules (client_id,caregiver_id,day_of_week,start_time,end_time,frequency,is_active,effective_date)
    VALUES ($1,$2,2,'09:00','12:00','weekly',true,'2026-07-01') RETURNING id`, [cl, cg]);
  await db.query(`UPDATE schedules SET effective_date='2026-07-01' WHERE id=$1`, [assigned]);
  // Tue 2026-07-14: sub clocks 9:05-11:55 (170 min, >50% of 9-12)
  await db.query(
    `INSERT INTO time_entries (caregiver_id, client_id, start_time, end_time, duration_minutes, is_complete)
     VALUES ($1,$2,'2026-07-14T14:05:00Z','2026-07-14T16:55:00Z',170,true)`, [sub, cl]);
  const gen = await generateLineItems(cl, null, null, '2026-07-14', '2026-07-14');
  const schedLines = gen.lineItems.filter(li => li.source === 'scheduled');
  const evvLines = gen.lineItems.filter(li => li.source === 'unscheduled_evv' || li.source === 'evv_confirmed');
  ok(evvLines.length === 1, `substitute's real punch bills once (${evvLines.length} worked line)`);
  ok(schedLines.length === 0, `assigned caregiver's covered scheduled line suppressed (${schedLines.length} scheduled lines)`);

  console.log('\nSmall handoff overlap must NOT suppress: punch covering <50% leaves the scheduled line alone');
  // Wed row 12-15 for cg (never clocks); sub's Wed punch 9:00-12:20 covers only 20/180 min
  const wedRow = await mk(`INSERT INTO schedules (client_id,caregiver_id,day_of_week,start_time,end_time,frequency,is_active,effective_date)
    VALUES ($1,$2,3,'12:00','15:00','weekly',true,'2026-07-01') RETURNING id`, [cl, cg]);
  await db.query(`UPDATE schedules SET effective_date='2026-07-01' WHERE id=$1`, [wedRow]);
  await db.query(
    `INSERT INTO time_entries (caregiver_id, client_id, start_time, end_time, duration_minutes, is_complete)
     VALUES ($1,$2,'2026-07-15T14:00:00Z','2026-07-15T17:20:00Z',200,true)`, [sub, cl]);
  const gen2 = await generateLineItems(cl, null, null, '2026-07-15', '2026-07-15');
  const wedSched = gen2.lineItems.filter(li => li.source === 'scheduled' && li.time_range.includes('12:00'));
  ok(wedSched.length === 1, `12-3 scheduled line survives a 20-min handoff overlap (${wedSched.length})`);

  await purge();
  console.log('\ncleanup done');
  console.log('\n==================================================');
  console.log(`PASS: ${pass}   FAIL: ${fail}`);
  console.log('==================================================');
  await db.pool.end();
  process.exit(fail ? 1 : 0);
})().catch(async e => { console.error('FATAL:', e.message); try { await purge(); await db.pool.end(); } catch {} process.exit(1); });
