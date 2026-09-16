// End-to-end test of the MIDAS assessment PDF upload (Care Tasks → Upload assessment PDF).
// 1) Real HTTP multipart upload to the parse route on a local testApp (reads prod DB only).
// 2) Imports the parsed tasks through the existing import route inside ONE transaction
//    that is ROLLED BACK (db.query and db.pool.connect both patched).
// usage: node audits/test_midas_pdf_import.js <summary.pdf> <clientId> [otherPdfThatMustBeRejected]
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
process.env.TWILIO_ACCOUNT_SID = ''; process.env.TWILIO_AUTH_TOKEN = '';
const fs = require('fs');
const jwt = require('jsonwebtoken');
const db = require('../src/db');
const app = require('../src/testApp');

const [PDF, CLIENT, BAD_PDF] = process.argv.slice(2);
let fail = 0;
const check = (n, ok, x) => { if (!ok) fail++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${x !== undefined ? ' — ' + JSON.stringify(x) : ''}`); };

(async () => {
  const admin = (await db.query(`SELECT id, email, role FROM users WHERE role='admin' AND is_active LIMIT 1`)).rows[0];
  const caregiver = (await db.query(`SELECT id, email, role FROM users WHERE role='caregiver' AND is_active LIMIT 1`)).rows[0];
  const tok = (u) => jwt.sign({ id: u.id, email: u.email, role: u.role }, process.env.JWT_SECRET, { expiresIn: '5m' });
  const other = (await db.query(`SELECT id FROM clients WHERE id <> $1 AND last_name <> (SELECT last_name FROM clients WHERE id=$1) LIMIT 1`, [CLIENT])).rows[0];

  const server = app.listen(0);
  const base = `http://127.0.0.1:${server.address().port}/api/clients`;
  const upload = async (clientId, buf, token, name = 'a.pdf') => {
    const fd = new FormData();
    if (buf) fd.append('file', new Blob([buf], { type: 'application/pdf' }), name);
    const r = await fetch(`${base}/${clientId}/care-tasks/parse-assessment-pdf`, { method: 'POST', headers: token ? { Authorization: `Bearer ${token}` } : {}, body: fd });
    return { status: r.status, body: await r.json().catch(() => null) };
  };

  try {
    const pdf = fs.readFileSync(PDF);
    let r = await upload(CLIENT, pdf, tok(admin));
    check('admin upload parses (200)', r.status === 200, r.body?.error);
    const parsed = r.body;
    const sum = parsed.tasks.reduce((a, t) => a + t.weeklyFrequency * t.allottedMinutes, 0);
    check('tasks reconcile to sheet total', sum === parsed.assessmentTotals.minsPerWeek, { sum, total: parsed.assessmentTotals.minsPerWeek });
    check('name matches the client', parsed.clientNameMatch === true);
    console.log('      ', parsed.member, parsed.sections);

    r = await upload(other.id, pdf, tok(admin));
    check('different client flagged as name mismatch', r.status === 200 && r.body.clientNameMatch === false);
    r = await upload(CLIENT, pdf, null);
    check('no token rejected (401)', r.status === 401, r.status);
    r = await upload(CLIENT, pdf, tok(caregiver));
    check('caregiver rejected (403)', r.status === 403, r.status);
    r = await upload(CLIENT, null, tok(admin));
    check('no file → 400', r.status === 400, r.body);
    r = await upload('00000000-0000-0000-0000-000000000009', pdf, tok(admin));
    check('unknown client → 404', r.status === 404, r.status);
    r = await upload(CLIENT, Buffer.from('not a pdf'), tok(admin));
    check('non-PDF → 422 with message', r.status === 422, r.body);
    r = await upload(CLIENT, Buffer.alloc(6 * 1024 * 1024, 1), tok(admin));
    check('over 5 MB → 400', r.status === 400, r.body);
    if (BAD_PDF) {
      r = await upload(CLIENT, fs.readFileSync(BAD_PDF), tok(admin));
      check('full browser-printed assessment → 422', r.status === 422, r.body);
    }
    server.close();

    // Import through the existing route, rolled back.
    const client = await db.pool.connect();
    const before = (await db.pool.query(`SELECT count(*)::int n FROM client_task_templates WHERE client_id=$1 AND is_active`, [CLIENT])).rows[0].n;
    const realQuery = db.query, realConnect = db.pool.connect;
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
    try {
      await client.query('BEGIN');
      const router = require('../src/routes/clientTasksRoutes');
      const layer = router.stack.find(l => l.route && l.route.path === '/clients/:clientId/care-tasks/import' && l.route.methods.post);
      const h = layer.route.stack[layer.route.stack.length - 1].handle;
      const res = { statusCode: 200 }; res.status = c => (res.statusCode = c, res); res.json = b => (res.body = b, res);
      await h({ user: { id: admin.id }, params: { clientId: CLIENT }, body: { tasks: parsed.tasks, replaceExisting: true, source: parsed.source, assessmentTotals: parsed.assessmentTotals } }, res);
      check('import succeeds', res.statusCode === 200 && res.body.imported === parsed.tasks.length, res.body);
      check('import reconciliation matches', res.body.reconciliation?.match === true, res.body.reconciliation);
      const rows = (await client.query(`SELECT task_name, category, weekly_frequency, allotted_minutes, description, assessment_source FROM client_task_templates WHERE client_id=$1 AND is_active ORDER BY sort_order`, [CLIENT])).rows;
      check('rows written as parsed', rows.length === parsed.tasks.length && rows.every((x, i) => x.task_name === parsed.tasks[i].taskName && x.category === parsed.tasks[i].category && x.weekly_frequency === parsed.tasks[i].weeklyFrequency && x.allotted_minutes === parsed.tasks[i].allottedMinutes));
      check('source recorded', rows.every(x => x.assessment_source === 'midas_shc_pc_summary'));
    } finally {
      await client.query('ROLLBACK');
      client.release();
      db.query = realQuery; db.pool.connect = realConnect;
    }
    const after = (await db.pool.query(`SELECT count(*)::int n FROM client_task_templates WHERE client_id=$1 AND is_active`, [CLIENT])).rows[0].n;
    check('rolled back: client task count unchanged', before === after, { before, after });
  } catch (e) { fail++; console.error('ERROR', e); }
  console.log(fail ? `\n${fail} FAILED` : '\nALL PASS');
  process.exit(fail ? 1 : 0);
})();
