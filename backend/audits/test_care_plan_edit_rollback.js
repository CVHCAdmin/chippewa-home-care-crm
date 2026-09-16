// Tests PUT /api/care-plans/:id (edit button) against the LIVE schema inside ONE
// transaction that is ROLLED BACK. db.query AND db.pool.connect are patched (the handler
// opens its own transaction) — see memory feedback_testing_against_prod.
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const db = require('../src/db');

function handler(router, method, p) {
  const layer = router.stack.find(l => l.route && l.route.path === p && l.route.methods[method]);
  if (!layer) throw new Error(`route not found: ${method.toUpperCase()} ${p}`);
  const st = layer.route.stack;
  return st[st.length - 1].handle;
}
function fakeRes() {
  const r = { statusCode: 200, body: undefined };
  r.status = (c) => { r.statusCode = c; return r; };
  r.json = (b) => { r.body = b; return r; };
  return r;
}

(async () => {
  const client = await db.pool.connect();
  const before = (await db.pool.query(`SELECT (SELECT count(*) FROM care_plans) p, (SELECT count(*) FROM care_plan_revisions) r`)).rows[0];
  db.query = (t, p) => client.query(t, p);
  const realConnect = db.pool.connect.bind(db.pool);
  db.pool.connect = async () => ({
    query: (t, p) => {
      const s = typeof t === 'string' ? t.trim().toUpperCase() : '';
      if (s === 'BEGIN') return client.query('SAVEPOINT handler_tx');
      if (s === 'COMMIT') return client.query('RELEASE SAVEPOINT handler_tx');
      if (s === 'ROLLBACK') return client.query('ROLLBACK TO SAVEPOINT handler_tx');
      return client.query(t, p);
    },
    release: () => {},
  });
  let fail = 0;
  const check = (n, ok, x) => { if (!ok) fail++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${x !== undefined ? ' — ' + JSON.stringify(x) : ''}`); };

  try {
    await client.query('BEGIN');
    const router = require('../src/routes/clinicalRoutes');
    const post = handler(router, 'post', '/care-plans');
    const put = handler(router, 'put', '/care-plans/:id');
    const admin = (await client.query(`SELECT id FROM users WHERE role='admin' AND is_active LIMIT 1`)).rows[0];
    const cl = (await client.query(`SELECT id FROM clients WHERE is_active LIMIT 1`)).rows[0];
    const user = { id: admin.id };

    let r = fakeRes();
    await post({ user, body: { clientId: cl.id, serviceType: 'personal_care', careGoals: 'Initial goals', frequency: '3x week', startDate: '2026-09-16', endDate: '2026-12-31' } }, r);
    check('create plan', r.statusCode === 201, r.body?.error);
    const id = r.body.id;

    // Edit form sends every field (clientId too, which must be ignored)
    r = fakeRes();
    await put({ user, params: { id }, body: { clientId: 'ignored', serviceType: 'personal_care', serviceDescription: 'Desc', frequency: 'Mon/Wed/Fri', careGoals: 'Revised goals', specialInstructions: '', precautions: 'Fall risk', medicationNotes: 'Reminders only', mobilityNotes: '', dietaryNotes: 'Eggs', communicationNotes: '', startDate: '2026-09-16', endDate: '' } }, r);
    check('edit returns 200', r.statusCode === 200, r.body?.error);
    const row = (await client.query(`SELECT * FROM care_plans WHERE id=$1`, [id])).rows[0];
    check('goals updated', row.care_goals === 'Revised goals');
    check('frequency updated', row.frequency === 'Mon/Wed/Fri');
    check('end date cleared to NULL', row.end_date === null, row.end_date);
    check('blank text cleared to NULL', row.special_instructions === null);
    check('start date kept', row.start_date && String(row.start_date.toISOString?.() || row.start_date).startsWith('2026-09-16'), row.start_date);
    check('client unchanged', row.client_id === cl.id);

    const revs = (await client.query(`SELECT * FROM care_plan_revisions WHERE care_plan_id=$1`, [id])).rows;
    check('one revision snapshotted', revs.length === 1, revs.length);
    check('revision holds OLD goals', revs[0]?.care_goals === 'Initial goals');
    check('revision records who changed it', revs[0]?.changed_by === admin.id, revs[0]?.changed_by);

    // Partial body: only fields present change
    r = fakeRes();
    await put({ user, params: { id }, body: { dietaryNotes: 'Coffee' } }, r);
    const row2 = (await client.query(`SELECT * FROM care_plans WHERE id=$1`, [id])).rows[0];
    check('partial update leaves other fields', r.statusCode === 200 && row2.dietary_notes === 'Coffee' && row2.care_goals === 'Revised goals');

    r = fakeRes();
    await put({ user, params: { id }, body: { serviceType: '' } }, r);
    check('blank serviceType rejected', r.statusCode === 400);

    r = fakeRes();
    await put({ user, params: { id: '00000000-0000-0000-0000-000000000001' }, body: { careGoals: 'x' } }, r);
    check('unknown plan 404', r.statusCode === 404, r.statusCode);

    r = fakeRes();
    await put({ user, params: { id }, body: { startDate: 'not-a-date' } }, r);
    check('bad date returns 500 and outer tx still usable', r.statusCode === 500 && (await client.query('SELECT 1 x')).rows[0].x === 1);
  } catch (e) { fail++; console.error('ERROR', e); }
  finally {
    await client.query('ROLLBACK');
    client.release();
    db.pool.connect = realConnect;
    const after = (await db.pool.query(`SELECT (SELECT count(*) FROM care_plans) p, (SELECT count(*) FROM care_plan_revisions) r`)).rows[0];
    check('rolled back: prod counts unchanged', before.p === after.p && before.r === after.r, { before, after });
    console.log(fail ? `\n${fail} FAILED` : '\nALL PASS');
    process.exit(fail ? 1 : 0);
  }
})();
