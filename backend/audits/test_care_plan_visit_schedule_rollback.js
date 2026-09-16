// Tests migration v66 + care plan visit schedule (Fill from current schedule, drift,
// revision history, PDF) + the Generate Schedule double-booking guard, against the LIVE
// schema with the migration and every write inside ONE transaction that is ROLLED BACK.
// db.query and db.pool.connect are both patched (see memory feedback_testing_against_prod).
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
process.env.TWILIO_ACCOUNT_SID = ''; process.env.TWILIO_AUTH_TOKEN = '';
const fs = require('fs');
const path = require('path');
const { PassThrough } = require('stream');
const db = require('../src/db');

const DARRELL = '54c3dca8-4c3b-4518-8108-28e7ff2b73a8';   // Mon/Wed/Fri with Neugene
const GIL = 'e39b70a0-de44-40db-aeb7-d14ceb781e6e';       // no upcoming visits

function handler(router, method, p) {
  const layer = router.stack.find(l => l.route && l.route.path === p && l.route.methods[method]);
  if (!layer) throw new Error(`route not found: ${method} ${p}`);
  return layer.route.stack[layer.route.stack.length - 1].handle;
}
const fakeRes = () => { const r = { statusCode: 200 }; r.status = c => (r.statusCode = c, r); r.json = b => (r.body = b, r); return r; };

(async () => {
  const client = await db.pool.connect();
  const realQuery = db.query, realConnect = db.pool.connect;
  const counts = `SELECT (SELECT count(*) FROM care_plans)::int p, (SELECT count(*) FROM care_plan_revisions)::int r, (SELECT count(*) FROM schedules)::int s`;
  const before = (await db.pool.query(counts)).rows[0];
  db.query = (t, p) => client.query(t, p);
  db.pool.connect = async () => ({
    query: (t, p) => {
      const s = typeof t === 'string' ? t.trim().toUpperCase() : '';
      if (s === 'BEGIN') return client.query('SAVEPOINT h');
      if (s === 'COMMIT') return client.query('RELEASE SAVEPOINT h');
      if (s === 'ROLLBACK') return client.query('ROLLBACK TO SAVEPOINT h');
      return client.query(t, p);
    },
    release: () => {},
  });
  let fail = 0;
  const check = (n, ok, x) => { if (!ok) fail++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${x !== undefined ? ' — ' + JSON.stringify(x) : ''}`); };

  try {
    await client.query('BEGIN');
    const sql = fs.readFileSync(path.join(__dirname, '..', 'migration_v66_care_plan_visit_schedule.sql'), 'utf8')
      .replace(/^\s*BEGIN;\s*$/m, '').replace(/^\s*COMMIT;\s*$/m, '');
    await client.query(sql);
    check('migration v66 applies', true);

    const router = require('../src/routes/clinicalRoutes');
    const post = handler(router, 'post', '/care-plans');
    const put = handler(router, 'put', '/care-plans/:id');
    const getSched = handler(router, 'get', '/care-plans/visit-schedule/:clientId');
    const gen = handler(router, 'post', '/care-plans/:id/generate-schedule');
    const pdf = handler(router, 'get', '/care-plans/:id/pdf');
    const admin = (await client.query(`SELECT id, email FROM users WHERE role='admin' AND is_active LIMIT 1`)).rows[0];
    const user = { id: admin.id, email: admin.email, role: 'admin' };
    const today = (await client.query(`SELECT ((NOW() AT TIME ZONE 'America/Chicago')::date)::text d`)).rows[0].d;

    let r = fakeRes(); await getSched({ user, params: { clientId: DARRELL } }, r);
    const live = r.body;
    check('live schedule for Darrell', r.statusCode === 200 && live.lines.length === 3 && live.upcomingVisits > 0, live.lines);

    r = fakeRes(); await post({ user, body: { clientId: DARRELL, serviceType: 'personal_care', careGoals: 'g', startDate: today, visitSchedule: 'current' } }, r);
    check('create with Fill from schedule', r.statusCode === 201, r.body?.error);
    const id = r.body.id;
    let row = (await client.query(`SELECT visit_schedule, visit_schedule_as_of::text AS as_of FROM care_plans WHERE id=$1`, [id])).rows[0];
    check('saved schedule = live schedule text', row.visit_schedule === live.text);
    check('as-of date is today (Chicago)', row.as_of === today, row.as_of);

    r = fakeRes(); await post({ user, body: { clientId: DARRELL, serviceType: 'personal_care', visitSchedule: 'Mon 9-5 made up' } }, r);
    check('typed schedule text refused (400)', r.statusCode === 400, r.body);
    r = fakeRes(); await post({ user, body: { clientId: GIL, serviceType: 'personal_care', visitSchedule: 'current' } }, r);
    check('fill for client with no visits refused (400)', r.statusCode === 400, r.body);
    r = fakeRes(); await post({ user, body: { clientId: GIL, serviceType: 'personal_care' } }, r);
    check('create without schedule still works', r.statusCode === 201 && r.body.visit_schedule === null);
    const gilPlan = r.body.id;

    r = fakeRes(); await put({ user, params: { id }, body: { careGoals: 'edited goals' } }, r);
    row = (await client.query(`SELECT visit_schedule FROM care_plans WHERE id=$1`, [id])).rows[0];
    check('unrelated edit leaves saved schedule alone', r.statusCode === 200 && row.visit_schedule === live.text);

    // Change the live schedule: move Darrell's Monday shift to 10:00.
    await client.query(`UPDATE schedules SET start_time='10:00' WHERE client_id=$1 AND day_of_week=1 AND is_active`, [DARRELL]);
    r = fakeRes(); await getSched({ user, params: { clientId: DARRELL } }, r);
    check('drift detected after a shift changes', r.body.text !== live.text && /Monday 10:00 AM/.test(r.body.text), r.body.lines[0]);

    r = fakeRes(); await put({ user, params: { id }, body: { visitSchedule: 'current' } }, r);
    check('refill updates the plan', r.statusCode === 200 && /Monday 10:00 AM/.test(r.body.visit_schedule), r.body?.error);
    const revs = (await client.query(`SELECT revision_number, visit_schedule, changed_by FROM care_plan_revisions WHERE care_plan_id=$1 ORDER BY revision_number`, [id])).rows;
    check('history keeps the old schedule with who changed it', revs.length === 2 && revs[1].visit_schedule === live.text && revs[1].changed_by === admin.id, revs.map(x => x.revision_number));

    r = fakeRes(); await put({ user, params: { id }, body: { visitSchedule: 'bogus' } }, r);
    check('PUT typed text refused (400)', r.statusCode === 400);
    r = fakeRes(); await put({ user, params: { id: '00000000-0000-0000-0000-000000000001' }, body: { visitSchedule: 'current' } }, r);
    check('PUT unknown plan 404', r.statusCode === 404);

    // PDF renders with the schedule section
    const out = new PassThrough(); const chunks = []; out.on('data', c => chunks.push(c));
    out.statusCode = 200; out.setHeader = () => {}; out.status = c => (out.statusCode = c, out); out.json = b => (out.body = b, out.end(), out);
    const done = new Promise(res => out.on('finish', res));
    await pdf({ user, params: { id } }, out); await done;
    const buf = Buffer.concat(chunks);
    if (process.argv[2]) fs.writeFileSync(path.join(process.argv[2], 'care-plan-visit-schedule-test.pdf'), buf);
    check('PDF renders', out.statusCode === 200 && buf.slice(0, 4).toString() === '%PDF' && buf.length > 1000, buf.length);

    r = fakeRes(); await put({ user, params: { id }, body: { visitSchedule: '' } }, r);
    check('clear removes schedule', r.statusCode === 200 && r.body.visit_schedule === null && r.body.visit_schedule_as_of === null);

    // Generate Schedule guard
    const schedBefore = (await client.query(`SELECT count(*)::int n FROM schedules`)).rows[0].n;
    r = fakeRes(); await gen({ user, params: { id }, body: { caregiverId: admin.id, startTime: '09:00', endTime: '10:00', daysOfWeek: [2] } }, r);
    const schedAfter = (await client.query(`SELECT count(*)::int n FROM schedules`)).rows[0].n;
    check('generate refused for scheduled client (409), nothing created', r.statusCode === 409 && schedAfter === schedBefore, r.body);
    const cg = (await client.query(`SELECT id FROM users WHERE role='caregiver' AND is_active LIMIT 1`)).rows[0];
    r = fakeRes(); await gen({ user, params: { id: gilPlan }, body: { caregiverId: cg.id, startTime: '09:00', endTime: '10:00', daysOfWeek: [2] } }, r);
    check('generate still works for unscheduled client', r.statusCode === 201 && r.body.created === 1, r.body?.error);
  } catch (e) { fail++; console.error('ERROR', e); }
  finally {
    await client.query('ROLLBACK');
    client.release();
    db.query = realQuery; db.pool.connect = realConnect;
    const after = (await db.pool.query(counts)).rows[0];
    const col = (await db.pool.query(`SELECT count(*)::int n FROM information_schema.columns WHERE table_name='care_plans' AND column_name='visit_schedule'`)).rows[0].n;
    const mon = (await db.pool.query(`SELECT start_time::text t FROM schedules WHERE client_id=$1 AND day_of_week=1 AND is_active`, [DARRELL])).rows.map(x => x.t);
    check('rolled back: counts unchanged', JSON.stringify(before) === JSON.stringify(after), { before, after });
    console.log(`      (visit_schedule column present after rollback: ${col}; Darrell Monday start: ${mon})`);
    console.log(fail ? `\n${fail} FAILED` : '\nALL PASS');
    process.exit(fail ? 1 : 0);
  }
})();
