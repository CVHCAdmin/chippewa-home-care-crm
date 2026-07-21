// Verifies the CLIENT-scoped suspend/resume endpoints used by the Clients screen:
//   POST /api/schedules/client/:clientId/suspend  and  /resume
// and that GET /api/clients surfaces service_suspended_from for the list badge.
// Self-contained: creates and purges its own 'ZZ ClSusp' fixtures.
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const request = require('supertest');
const jwt = require('jsonwebtoken');
const app = require('../src/server');
const db = require('../src/db');
const { SCHEDULE_OCCURRENCES_CTE } = require('../src/helpers/scheduleOccurrences');

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { console.log(`  OK   ${m}`); pass++; } else { console.log(`  FAIL ${m}`); fail++; } };

async function purge() {
  const u = await db.query(`SELECT id FROM users WHERE email LIKE 'zz-clsusp-%@cvhc.test'`);
  const ids = u.rows.map(r => r.id);
  if (ids.length) await db.query(`DELETE FROM schedules WHERE caregiver_id = ANY($1)`, [ids]);
  await db.query(`DELETE FROM clients WHERE first_name='ZZ' AND last_name='ClSusp'`);
  await db.query(`DELETE FROM users WHERE email LIKE 'zz-clsusp-%@cvhc.test'`);
}

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
     VALUES ('zz-clsusp-cg@cvhc.test','x','ZZ','ClSuspCg','caregiver',true) RETURNING id`)).rows[0].id;
  const admin = (await db.query(
    `INSERT INTO users (email,password_hash,first_name,last_name,role,is_active)
     VALUES ('zz-clsusp-admin@cvhc.test','x','ZZ','ClSuspAdmin','admin',true) RETURNING id`)).rows[0].id;
  const caregiverTok = jwt.sign({ id: cg, role: 'caregiver' }, process.env.JWT_SECRET, { expiresIn: '1h' });
  const adminTok = jwt.sign({ id: admin, role: 'admin' }, process.env.JWT_SECRET, { expiresIn: '1h' });
  const cl = (await db.query(
    `INSERT INTO clients (first_name,last_name,is_active) VALUES ('ZZ','ClSusp',true) RETURNING id`)).rows[0].id;

  // Two recurring shifts (Mon + Wed) for this client, backdated so they have history.
  const mk = async (dow) => {
    const r = await db.query(
      `INSERT INTO schedules (client_id,caregiver_id,day_of_week,start_time,end_time,frequency,is_active,effective_date)
       VALUES ($1,$2,$3,'09:00','13:00','weekly',true,'2026-05-01') RETURNING id`, [cl, cg, dow]);
    await db.query(`UPDATE schedules SET effective_date='2026-05-01' WHERE id=$1`, [r.rows[0].id]);
    return r.rows[0].id;
  };
  const sMon = await mk(1);
  const sWed = await mk(3);

  const WIN = ['2026-05-01', '2026-09-30'];
  const monBefore = await occCount(sMon, ...WIN);
  const wedBefore = await occCount(sWed, ...WIN);
  ok(monBefore > 0 && wedBefore > 0, `baseline occurrences exist (Mon ${monBefore}, Wed ${wedBefore})`);

  console.log('\nClient-scoped suspend from 2026-07-20 → BOTH schedules pause');
  const susp = await request(app).post(`/api/schedules/client/${cl}/suspend`)
    .set('Authorization', `Bearer ${adminTok}`).send({ fromDate: '2026-07-20' });
  ok(susp.status === 200 && susp.body.suspended === 2, `suspended both (got ${susp.status}/${susp.body.suspended})`);
  ok(await occCount(sMon, '2026-07-20', '2026-09-30') === 0, 'no Monday visits on/after suspend date');
  ok(await occCount(sWed, '2026-07-20', '2026-09-30') === 0, 'no Wednesday visits on/after suspend date');
  ok(await occCount(sMon, '2026-05-01', '2026-07-19') > 0, 'Monday history before suspend date kept');

  console.log('\nGET /api/clients surfaces service_suspended_from for the badge');
  const list = await request(app).get('/api/clients').set('Authorization', `Bearer ${adminTok}`);
  const row = list.body.find(c => c.id === cl);
  ok(row && row.service_suspended_from && row.service_suspended_from.slice(0, 10) === '2026-07-20',
    `list shows service_suspended_from=${row && row.service_suspended_from && row.service_suspended_from.slice(0,10)}`);

  console.log('\nClient-scoped resume → both come back');
  const res = await request(app).post(`/api/schedules/client/${cl}/resume`)
    .set('Authorization', `Bearer ${adminTok}`).send({});
  ok(res.status === 200 && res.body.resumed === 2, `resumed both (got ${res.status}/${res.body.resumed})`);
  ok(await occCount(sMon, ...WIN) === monBefore, 'Monday occurrences fully restored');
  ok(await occCount(sWed, ...WIN) === wedBefore, 'Wednesday occurrences fully restored');

  const list2 = await request(app).get('/api/clients').set('Authorization', `Bearer ${adminTok}`);
  const row2 = list2.body.find(c => c.id === cl);
  ok(row2 && row2.service_suspended_from === null, 'list badge cleared after resume');

  console.log('\nAuth: a caregiver cannot suspend');
  const forbidden = await request(app).post(`/api/schedules/client/${cl}/suspend`)
    .set('Authorization', `Bearer ${caregiverTok}`).send({ fromDate: '2026-07-20' });
  ok(forbidden.status === 403, `caregiver blocked (got ${forbidden.status})`);

  console.log('\nBad date is rejected');
  const badDate = await request(app).post(`/api/schedules/client/${cl}/suspend`)
    .set('Authorization', `Bearer ${adminTok}`).send({ fromDate: '07/20/2026' });
  ok(badDate.status === 400, `malformed fromDate rejected (got ${badDate.status})`);

  await purge();
  console.log('\ncleanup done');
  console.log('\n==================================================');
  console.log(`PASS: ${pass}   FAIL: ${fail}`);
  console.log('==================================================');
  await db.pool.end();
  process.exit(fail ? 1 : 0);
})().catch(async e => { console.error('FATAL:', e.message); try { await db.pool.end(); } catch {} process.exit(1); });
