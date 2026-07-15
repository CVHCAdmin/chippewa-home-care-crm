// Verifies the VA-client clock-out note rule: VA clients REQUIRE a note to clock out;
// everyone else stays optional; admin force-clock-out is never blocked. Enforced
// server-side so it reaches the frozen caregiver APK.
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const request = require('supertest');
const jwt = require('jsonwebtoken');
const { v4: uuid } = require('uuid');
const app = require('../src/server');
const db = require('../src/db');

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { console.log(`  OK   ${m}`); pass++; } else { console.log(`  FAIL ${m}`); fail++; } };

async function purge() {
  const u = await db.query(`SELECT id FROM users WHERE email LIKE 'zz-va-%@cvhc.test'`);
  const ids = u.rows.map(r => r.id);
  if (ids.length) await db.query(`DELETE FROM time_entries WHERE caregiver_id = ANY($1)`, [ids]);
  await db.query(`DELETE FROM clients WHERE last_name IN ('VAClient','NonVAClient') AND first_name='ZZ'`);
  await db.query(`DELETE FROM referral_sources WHERE name='ZZ VA Test Source'`);
  await db.query(`DELETE FROM users WHERE email LIKE 'zz-va-%@cvhc.test'`);
}

async function clockedInEntry(cg, cl) {
  const id = uuid();
  await db.query(
    `INSERT INTO time_entries (id, caregiver_id, client_id, start_time)
     VALUES ($1,$2,$3, NOW() - INTERVAL '60 minutes')`, [id, cg, cl]);
  return id;
}

(async () => {
  await purge();
  const cg = (await db.query(
    `INSERT INTO users (email,password_hash,first_name,last_name,role,is_active)
     VALUES ('zz-va-cg@cvhc.test','x','ZZ','VaCg','caregiver',true) RETURNING id`)).rows[0].id;
  const admin = (await db.query(
    `INSERT INTO users (email,password_hash,first_name,last_name,role,is_active)
     VALUES ('zz-va-admin@cvhc.test','x','ZZ','VaAdmin','admin',true) RETURNING id`)).rows[0].id;
  const rs = (await db.query(
    `INSERT INTO referral_sources (name, payer_type, is_active) VALUES ('ZZ VA Test Source','va',true) RETURNING id`)).rows[0].id;
  const vaCl = (await db.query(
    `INSERT INTO clients (first_name,last_name,is_active,referral_source_id) VALUES ('ZZ','VAClient',true,$1) RETURNING id`, [rs])).rows[0].id;
  const nonVaCl = (await db.query(
    `INSERT INTO clients (first_name,last_name,is_active) VALUES ('ZZ','NonVAClient',true) RETURNING id`)).rows[0].id;

  const cgToken = jwt.sign({ id: cg, email: 'zz-va-cg@cvhc.test', role: 'caregiver', name: 'ZZ VaCg' }, process.env.JWT_SECRET, { expiresIn: '1h' });
  const adminToken = jwt.sign({ id: admin, email: 'zz-va-admin@cvhc.test', role: 'admin', name: 'ZZ VaAdmin' }, process.env.JWT_SECRET, { expiresIn: '1h' });
  const clockOut = (id, body, tok = cgToken) => request(app).post(`/api/time-entries/${id}/clock-out`).set('Authorization', `Bearer ${tok}`).send(body);

  try {
    console.log('\nVA client: no note is REJECTED');
    let e = await clockedInEntry(cg, vaCl);
    const r1 = await clockOut(e, { notes: '' });
    ok(r1.status === 400, `no note -> 400 (got ${r1.status})`);
    ok(r1.body.code === 'va_note_required', `code va_note_required (got ${r1.body.code})`);
    const stillOpen = await db.query(`SELECT end_time FROM time_entries WHERE id=$1`, [e]);
    ok(stillOpen.rows[0].end_time === null, `the entry stays OPEN — not half-closed on rejection`);

    console.log('\nVA client: whitespace-only note is also rejected');
    const r2 = await clockOut(e, { notes: '   ' });
    ok(r2.status === 400 && r2.body.code === 'va_note_required', `whitespace -> 400 va_note_required (got ${r2.status}/${r2.body.code})`);

    console.log('\nVA client: WITH a note succeeds');
    const r3 = await clockOut(e, { notes: 'Client was in good spirits; assisted with meds and lunch.' });
    ok(r3.status === 200, `with note -> 200 (got ${r3.status})`);
    const closed = await db.query(`SELECT end_time, notes FROM time_entries WHERE id=$1`, [e]);
    ok(closed.rows[0].end_time !== null, `entry is now closed`);
    ok((closed.rows[0].notes || '').includes('good spirits'), `the note was saved`);

    console.log('\nNon-VA client: no note still succeeds (unchanged for everyone else)');
    let e2 = await clockedInEntry(cg, nonVaCl);
    const r4 = await clockOut(e2, { notes: '' });
    ok(r4.status === 200, `non-VA, no note -> 200 (got ${r4.status})`);

    console.log('\nAdmin force-clock-out of a VA entry is NOT blocked (escape hatch)');
    let e3 = await clockedInEntry(cg, vaCl);
    const r5 = await request(app).post(`/api/time-entries/${e3}/admin-force-clockout`)
      .set('Authorization', `Bearer ${adminToken}`).send({ reason: 'caregiver could not add note' });
    ok(r5.status === 200, `admin force-out of VA entry -> 200, no note needed (got ${r5.status})`);
  } catch (e) {
    console.error('\nTEST ERROR:', e.message, e.stack); fail++;
  } finally {
    await purge();
    console.log('\ncleanup done');
    console.log(`\n${'='.repeat(50)}\nPASS: ${pass}   FAIL: ${fail}\n${'='.repeat(50)}`);
    process.exit(fail ? 1 : 0);
  }
})();
