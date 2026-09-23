// Tests migration v69 + visit documentation routes (list visits, save a note, invoice
// picked visits, packet PDF) against the LIVE schema with Clarence Rubenzer's real
// schedule. The migration, a temporary VA rate and every write run inside ONE
// transaction that is ROLLED BACK. db.query and db.pool.connect are both patched
// (see memory feedback_testing_against_prod). Pass a path to also save the packet PDF.
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
process.env.TWILIO_ACCOUNT_SID = ''; process.env.TWILIO_AUTH_TOKEN = '';
const fs = require('fs');
const path = require('path');
const { PassThrough } = require('stream');
const db = require('../src/db');

const CLARENCE = '1a7148f4-d0aa-459b-9dfc-d57334f931b2';
const DEB = '14f2894d-f2ed-472d-99a1-5735cde35372';
const VA = 'cb0d6d7e-d716-4a0d-8407-4d9aada1537e';

function handler(router, method, p) {
  const layer = router.stack.find(l => l.route && l.route.path === p && l.route.methods[method]);
  if (!layer) throw new Error(`route not found: ${method} ${p}`);
  return layer.route.stack[layer.route.stack.length - 1].handle;
}
const fakeRes = () => { const r = { statusCode: 200 }; r.status = c => (r.statusCode = c, r); r.json = b => (r.body = b, r); return r; };

(async () => {
  const client = await db.pool.connect();
  const realQuery = db.query, realConnect = db.pool.connect;
  const counts = `SELECT (SELECT count(*) FROM invoices)::int i, (SELECT count(*) FROM invoice_line_items)::int l,
                         (SELECT count(*) FROM referral_source_rates)::int r,
                         (SELECT count(*) FROM information_schema.tables WHERE table_name='visit_documentation')::int t`;
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
    const sql = fs.readFileSync(path.join(__dirname, '..', 'migration_v69_visit_documentation.sql'), 'utf8')
      .replace(/^\s*BEGIN;\s*$/m, '').replace(/^\s*COMMIT;\s*$/m, '');
    await client.query(sql);
    check('migration v69 applies', true);

    const router = require('../src/routes/visitDocumentationRoutes');
    const list = handler(router, 'get', '/clients/:clientId');
    const save = handler(router, 'put', '/clients/:clientId/visits');
    const invoice = handler(router, 'post', '/clients/:clientId/invoice');
    const packet = handler(router, 'get', '/invoices/:invoiceId/packet.pdf');
    const admin = (await client.query(`SELECT id, email FROM users WHERE role='admin' AND is_active LIMIT 1`)).rows[0];
    const user = { id: admin.id, email: admin.email, role: 'admin' };
    const range = { from: '2026-06-02', to: '2026-09-22' };

    let r = fakeRes(); await list({ user, params: { clientId: CLARENCE }, query: range }, r);
    check('list visits 200', r.statusCode === 200, r.body?.error);
    const visits = r.body.visits;
    console.log(`      ${visits.length} visits; first ${visits[0]?.visit_date}, last ${visits.at(-1)?.visit_date}; rate before:`, r.body.rate);
    check('9/21 (cancelled, Deb sick) is not listed', !visits.some(v => v.visit_date === '2026-09-21'));
    const deb = visits.filter(v => v.caregiver_id === DEB && v.minutes === 120);
    check('a 2-hour Deb visit splits 100 aide / 20 homemaking',
      deb.length > 0 && deb.every(v => v.split.length === 2 && v.split[0].minutes === 100 && v.split[1].minutes === 20), deb[0]?.split);
    const odd = visits.filter(v => v.minutes !== 120).map(v => `${v.visit_date} ${v.start_time}-${v.end_time} ${v.caregiver_name}`);
    console.log('      visits not 2 hours long:', odd);
    check('nothing marked invoiced yet', visits.every(v => !v.invoiced));

    const [a, b, c] = deb.slice(-3);
    const pick = (v) => ({ visitDate: v.visit_date, startTime: v.start_time, caregiverId: v.caregiver_id });

    // Real notes exist in prod now (the office bulk-filled Clarence). Clear them
    // inside this rolled-back transaction so the save/bulk checks start from a
    // known state without depending on — or touching — live documentation.
    const wiped = (await client.query(`DELETE FROM visit_documentation WHERE client_id=$1 RETURNING 1`, [CLARENCE])).rowCount;
    console.log(`      cleared ${wiped} existing notes in-transaction (rolled back)`);

    // The live VA rate is removed inside this (rolled-back) transaction so the
    // no-rate path is still exercised, then put back for the invoicing checks.
    const liveRates = (await client.query(`DELETE FROM referral_source_rates WHERE referral_source_id=$1 RETURNING *`, [VA])).rows;
    r = fakeRes(); await invoice({ user, params: { clientId: CLARENCE }, body: { visits: [pick(a)] } }, r);
    check('invoice refused with no VA rate (400)', r.statusCode === 400, r.body?.error);

    if (liveRates.length) {
      for (const rt of liveRates) {
        await client.query(`INSERT INTO referral_source_rates (id, referral_source_id, care_type_id, rate_amount, rate_type, effective_date, end_date, is_active)
                            VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
          [rt.id, rt.referral_source_id, rt.care_type_id, rt.rate_amount, rt.rate_type, rt.effective_date, rt.end_date, rt.is_active]);
      }
      check('live VA rate restored in-transaction', true, liveRates.map(rt => `${rt.rate_amount}/${rt.rate_type}`));
    } else {
      await client.query(`INSERT INTO referral_source_rates (referral_source_id, care_type_id, rate_amount, rate_type, effective_date)
                          SELECT $1, care_type_id, 35.00, 'hourly', '2026-06-01' FROM clients WHERE id=$2`, [VA, CLARENCE]);
    }

    const tasks = [{ taskId: 't1', taskName: 'Home health aide: personal care and walking hallways', done: true },
                   { taskId: 't2', taskName: 'Homemaking: vacuum and dust', done: true }];
    r = fakeRes(); await save({ user, params: { clientId: CLARENCE }, body: { ...pick(a), tasks, note: 'Walked the hallway twice. Vacuumed and dusted the living room.' } }, r);
    check('save note on a scheduled visit', r.statusCode === 200 && r.body.end_time === a.end_time, r.body?.error);
    r = fakeRes(); await save({ user, params: { clientId: CLARENCE }, body: { ...pick(a), tasks, note: 'Edited note.' } }, r);
    const n = (await client.query(`SELECT count(*)::int n, max(note) note FROM visit_documentation WHERE client_id=$1`, [CLARENCE])).rows[0];
    check('saving again updates the same row', n.n === 1 && n.note === 'Edited note.', n);
    r = fakeRes(); await save({ user, params: { clientId: CLARENCE }, body: { visitDate: '2026-09-21', startTime: '10:00:00', caregiverId: DEB, note: 'x' } }, r);
    check('note on the cancelled 9/21 visit refused (404)', r.statusCode === 404, r.body);

    const bulk = handler(router, 'post', '/clients/:clientId/visits/bulk');
    r = fakeRes(); await bulk({ user, params: { clientId: CLARENCE }, body: { ...range, note: 'Standard visit note.' } }, r);
    check('bulk fill writes every visit without a note, skips the one with', r.statusCode === 200 && r.body.written === visits.length - 1 && r.body.skipped === 1, r.body);
    const kept = (await client.query(`SELECT note FROM visit_documentation WHERE client_id=$1 AND visit_date=$2 AND start_time=$3`, [CLARENCE, a.visit_date, a.start_time])).rows[0];
    check('bulk fill did NOT overwrite the existing note', kept.note === 'Edited note.', kept);
    const filled = (await client.query(`SELECT count(*)::int n, count(*) FILTER (WHERE jsonb_array_length(tasks) = 2 AND tasks->0->>'done' = 'true')::int tasked FROM visit_documentation WHERE client_id=$1 AND note='Standard visit note.'`, [CLARENCE])).rows[0];
    check('bulk-filled rows carry both care tasks, ticked', filled.n === visits.length - 1 && filled.tasked === filled.n, filled);
    r = fakeRes(); await bulk({ user, params: { clientId: CLARENCE }, body: { ...range, note: '' } }, r);
    check('bulk fill with an empty note refused (400)', r.statusCode === 400, r.body);

    r = fakeRes(); await invoice({ user, params: { clientId: CLARENCE }, body: { visits: [pick(a), pick(b), pick(c)] } }, r);
    check('invoice 3 picked visits (201)', r.statusCode === 201, r.body?.error);
    const inv = r.body;
    check('total = 3 × $70.00 = $210.00', Number(inv.total) === 210, inv.total);
    const lines = (await client.query(`SELECT description, hours::float, rate::float, amount::float, service_date::text, start_time::text FROM invoice_line_items WHERE invoice_id=$1 ORDER BY service_date, description`, [inv.id])).rows;
    check('6 lines: 1.67 h aide ($58.45) + 0.33 h homemaking ($11.55) per visit',
      lines.length === 6 && lines.every(l => (l.hours === 1.67 && l.amount === 58.45) || (l.hours === 0.33 && l.amount === 11.55)), lines.slice(0, 2));
    check('lines carry the visit start time', lines.every(l => l.start_time === a.start_time || l.start_time === b.start_time || l.start_time === c.start_time));
    const invRow = (await client.query(`SELECT sent_at, invoice_type, referral_source_id, billing_period_start::text s, billing_period_end::text e FROM invoices WHERE id=$1`, [inv.id])).rows[0];
    check('draft (not sent), insurance, billed to VA, period = first..last picked visit',
      invRow.sent_at === null && invRow.invoice_type === 'insurance' && invRow.referral_source_id === VA && invRow.s === a.visit_date && invRow.e === c.visit_date, invRow);

    r = fakeRes(); await invoice({ user, params: { clientId: CLARENCE }, body: { visits: [pick(b)] } }, r);
    check('re-billing an invoiced visit refused (409)', r.statusCode === 409, r.body?.error);
    r = fakeRes(); await invoice({ user, params: { clientId: CLARENCE }, body: { visits: [{ visitDate: '2026-09-21', startTime: '10:00:00', caregiverId: DEB }] } }, r);
    check('billing the cancelled 9/21 visit refused (400)', r.statusCode === 400, r.body?.error);

    r = fakeRes(); await list({ user, params: { clientId: CLARENCE }, query: range }, r);
    const inv3 = r.body.visits.filter(v => v.invoiced?.invoiceNumber === inv.invoice_number);
    check('list shows the 3 visits as invoiced', inv3.length === 3, inv3.length);
    check('list shows the saved note', r.body.visits.find(v => v.visit_date === a.visit_date && v.start_time === a.start_time)?.doc?.note === 'Edited note.');

    const out = process.argv[2];
    const pdfRes = new PassThrough();
    const chunks = [];
    pdfRes.on('data', d => chunks.push(d));
    Object.assign(pdfRes, { setHeader() {}, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; }, headersSent: false });
    const done = new Promise(res => pdfRes.on('end', res));
    await packet({ user, params: { invoiceId: inv.id } }, pdfRes);
    await done;
    const buf = Buffer.concat(chunks);
    check('packet PDF generated', buf.slice(0, 4).toString() === '%PDF', buf.length);
    if (out) { fs.writeFileSync(out, buf); console.log('      saved', out); }
  } catch (e) {
    fail++;
    console.error('ERROR', e);
  } finally {
    await client.query('ROLLBACK').catch(() => {});
    db.query = realQuery; db.pool.connect = realConnect;
    client.release();
    const after = (await db.pool.query(counts)).rows[0];
    check('rolled back: invoices / lines / rates / table unchanged', JSON.stringify(before) === JSON.stringify(after), { before, after });
    console.log(fail ? `\n${fail} FAILED` : '\nALL PASS');
    process.exit(fail ? 1 : 0);
  }
})();
