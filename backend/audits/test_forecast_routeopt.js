// Verifies the forecast + route-optimizer endpoints after migrating them to the shared
// engine: they must run without SQL error, and a cancelled visit must drop out of the
// day's route plan and the caregiver's stop list (the whole point — no routing someone to
// a visit that isn't happening).
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const request = require('supertest');
const jwt = require('jsonwebtoken');
const app = require('../src/server');
const db = require('../src/db');

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { console.log(`  OK   ${m}`); pass++; } else { console.log(`  FAIL ${m}`); fail++; } };

async function purge() {
  const u = await db.query(`SELECT id FROM users WHERE email LIKE 'zz-fro-%@cvhc.test'`);
  const ids = u.rows.map(r => r.id);
  if (ids.length) {
    const s = await db.query(`SELECT id FROM schedules WHERE caregiver_id = ANY($1)`, [ids]);
    const sids = s.rows.map(r => r.id);
    if (sids.length) await db.query(`DELETE FROM schedule_exceptions WHERE schedule_id = ANY($1)`, [sids]);
    await db.query(`DELETE FROM schedules WHERE caregiver_id = ANY($1)`, [ids]);
  }
  await db.query(`DELETE FROM clients WHERE first_name='ZZ' AND last_name='FroClient'`);
  await db.query(`DELETE FROM users WHERE email LIKE 'zz-fro-%@cvhc.test'`);
}

(async () => {
  await purge();
  const admin = (await db.query(
    `INSERT INTO users (email,password_hash,first_name,last_name,role,is_active)
     VALUES ('zz-fro-admin@cvhc.test','x','ZZ','FroAdmin','admin',true) RETURNING id`)).rows[0].id;
  const cg = (await db.query(
    `INSERT INTO users (email,password_hash,first_name,last_name,role,is_active,latitude,longitude)
     VALUES ('zz-fro-cg@cvhc.test','x','ZZ','FroCg','caregiver',true,44.8,-91.5) RETURNING id`)).rows[0].id;
  const cl = (await db.query(
    `INSERT INTO clients (first_name,last_name,is_active,latitude,longitude)
     VALUES ('ZZ','FroClient',true,44.81,-91.49) RETURNING id`)).rows[0].id;
  const token = jwt.sign({ id: admin, email: 'zz-fro-admin@cvhc.test', role: 'admin', name: 'ZZ FroAdmin' }, process.env.JWT_SECRET, { expiresIn: '1h' });
  const get = (p) => request(app).get(p).set('Authorization', `Bearer ${token}`);

  // A fixed future date + its weekday. 2026-08-05 is a Wednesday.
  const DATE = '2026-08-05';
  const DOW = new Date(DATE + 'T12:00:00Z').getUTCDay();

  try {
    const s = (await db.query(
      `INSERT INTO schedules (caregiver_id,client_id,schedule_type,day_of_week,start_time,end_time,frequency,effective_date,is_active)
       VALUES ($1,$2,'recurring',$3,'09:00','11:00','weekly','2026-06-01',true) RETURNING id`,
      [cg, cl, DOW])).rows[0].id;

    console.log('\nForecast endpoints run on the engine (no SQL errors)');
    const rev = await get('/api/forecast/revenue');
    ok(rev.status === 200, `GET /forecast/revenue 200 (got ${rev.status})`);
    ok(Array.isArray(rev.body.weekly), `weekly forecast is an array (got ${typeof rev.body.weekly})`);
    const util = await get('/api/forecast/caregiver-utilization');
    ok(util.status === 200, `GET /forecast/caregiver-utilization 200 (got ${util.status})`);
    ok(Array.isArray(util.body), `utilization is an array (got ${typeof util.body})`);

    console.log('\nRoute optimizer: the day plan and stop list run and include the visit');
    const day = await get(`/api/route-optimizer/daily/${DATE}`);
    ok(day.status === 200, `GET /route-optimizer/daily/:date 200 (got ${day.status})`);
    const dayHasVisit = JSON.stringify(day.body).includes(s);
    ok(dayHasVisit, `the day plan includes the scheduled visit`);
    const stops = await get(`/api/route-optimizer/load-schedule/${cg}/${DATE}`);
    ok(stops.status === 200, `GET /route-optimizer/load-schedule/:cg/:date 200 (got ${stops.status})`);
    ok(JSON.stringify(stops.body).includes(cl), `stop list includes the client`);

    console.log('\nCancel that day → it drops out of BOTH the plan and the stop list');
    await db.query(`INSERT INTO schedule_exceptions (schedule_id,exception_date,exception_type) VALUES ($1,$2,'cancelled')`, [s, DATE]);
    const day2 = await get(`/api/route-optimizer/daily/${DATE}`);
    ok(day2.status === 200 && !JSON.stringify(day2.body).includes(s), `cancelled visit is GONE from the day plan (no routing to a cancelled visit)`);
    const stops2 = await get(`/api/route-optimizer/load-schedule/${cg}/${DATE}`);
    ok(stops2.status === 200 && !JSON.stringify(stops2.body).includes(cl), `cancelled visit is GONE from the stop list`);
  } catch (e) {
    console.error('\nTEST ERROR:', e.message, e.stack); fail++;
  } finally {
    await purge();
    console.log('\ncleanup done');
    console.log(`\n${'='.repeat(50)}\nPASS: ${pass}   FAIL: ${fail}\n${'='.repeat(50)}`);
    process.exit(fail ? 1 : 0);
  }
})();
