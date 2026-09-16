// Tests background check document upload (migration v67 + /api/background-checks/:id/documents)
// over real HTTP against a local testApp, with the migration and every write inside ONE
// transaction that is ROLLED BACK. db.query and db.pool.connect both route to that one
// transaction client, so nothing can commit to prod (memory feedback_testing_against_prod).
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
process.env.TWILIO_ACCOUNT_SID = ''; process.env.TWILIO_AUTH_TOKEN = '';
const fs = require('fs');
const path = require('path');
const jwt = require('jsonwebtoken');
const db = require('../src/db');

const NEUGENE_CHECK = '255682cf-006b-452c-83e7-7eeba602e956';

(async () => {
  const client = await db.pool.connect();
  const realQuery = db.query, realConnect = db.pool.connect;
  let fail = 0;
  const check = (n, ok, x) => { if (!ok) fail++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${x !== undefined ? ' — ' + JSON.stringify(x) : ''}`); };
  let server;
  try {
    await client.query('BEGIN');
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
    const sql = fs.readFileSync(path.join(__dirname, '..', 'migration_v67_background_check_documents.sql'), 'utf8')
      .replace(/^\s*BEGIN;\s*$/m, '').replace(/^\s*COMMIT;\s*$/m, '');
    await client.query(sql);
    check('migration v67 applies', true);

    const admin = (await client.query(`SELECT id, email, role FROM users WHERE role='admin' AND is_active LIMIT 1`)).rows[0];
    const cg = (await client.query(`SELECT id, email, role FROM users WHERE role='caregiver' AND is_active LIMIT 1`)).rows[0];
    const tok = (u) => jwt.sign({ id: u.id, email: u.email, role: u.role }, process.env.JWT_SECRET, { expiresIn: '5m' });
    const app = require('../src/testApp');
    server = app.listen(0);
    const base = `http://127.0.0.1:${server.address().port}/api/background-checks`;
    const call = async (method, url, token, body) => {
      const r = await fetch(base + url, {
        method, headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) },
        body: body ? JSON.stringify(body) : undefined,
      });
      const buf = Buffer.from(await r.arrayBuffer());
      let json = null; try { json = JSON.parse(buf.toString()); } catch (_) {}
      return { status: r.status, json, buf, type: r.headers.get('content-type') };
    };

    const pdfBytes = Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n');
    const dataUri = 'data:application/pdf;base64,' + pdfBytes.toString('base64');

    let r = await call('GET', '', tok(admin));
    const row = r.json?.find(x => x.id === NEUGENE_CHECK);
    check('list still works and shows document_count 0', r.status === 200 && row && row.document_count === 0, row?.document_count);

    r = await call('POST', `/${NEUGENE_CHECK}/documents`, tok(cg), { fileName: 'doj.pdf', dataUri });
    check('caregiver cannot upload (403)', r.status === 403, r.status);
    r = await call('POST', `/${NEUGENE_CHECK}/documents`, null, { fileName: 'doj.pdf', dataUri });
    check('no login cannot upload (401)', r.status === 401, r.status);
    r = await call('POST', `/${NEUGENE_CHECK}/documents`, tok(admin), { fileName: 'x.txt', dataUri: 'data:text/plain;base64,aGk=' });
    check('non-PDF/image refused (400)', r.status === 400, r.json);
    r = await call('POST', `/${NEUGENE_CHECK}/documents`, tok(admin), { fileName: 'big.pdf', dataUri: 'data:application/pdf;base64,' + 'A'.repeat(9_600_000) });
    check('over 7 MB refused (400)', r.status === 400, r.json);
    r = await call('POST', `/00000000-0000-0000-0000-000000000009/documents`, tok(admin), { fileName: 'doj.pdf', dataUri });
    check('unknown check 404', r.status === 404, r.status);

    r = await call('POST', `/${NEUGENE_CHECK}/documents`, tok(admin), { fileName: 'DOJ WORCS result/letter.pdf', dataUri });
    check('admin uploads PDF (201)', r.status === 201 && r.json.mime_type === 'application/pdf', r.json);
    const docId = r.json.id;
    check('file name made safe', r.json.file_name === 'DOJ WORCS result_letter.pdf', r.json.file_name);

    r = await call('GET', '', tok(admin));
    check('list shows document_count 1', r.json.find(x => x.id === NEUGENE_CHECK).document_count === 1);
    r = await call('GET', `/${NEUGENE_CHECK}/documents`, tok(admin));
    check('documents list has the file with uploader name', r.status === 200 && r.json.length === 1 && r.json[0].uploaded_by_first, r.json);
    r = await call('GET', `/${NEUGENE_CHECK}/documents`, tok(cg));
    check('caregiver cannot list documents (403)', r.status === 403);
    r = await call('GET', `/${NEUGENE_CHECK}/documents/${docId}`, tok(admin));
    check('view returns the exact PDF bytes', r.status === 200 && r.type === 'application/pdf' && r.buf.equals(pdfBytes), r.type);
    r = await call('GET', `/${NEUGENE_CHECK}/documents/${docId}`, tok(cg));
    check('caregiver cannot view (403)', r.status === 403);

    const audit = (await client.query(`SELECT action FROM audit_logs WHERE table_name='background_check_documents' AND record_id=$1`, [docId])).rows;
    check('upload audited', audit.some(a => a.action === 'CREATE'));

    r = await call('DELETE', `/${NEUGENE_CHECK}/documents/${docId}`, tok(admin));
    check('delete (200)', r.status === 200);
    r = await call('GET', `/${NEUGENE_CHECK}/documents/${docId}`, tok(admin));
    check('deleted file is gone (404)', r.status === 404);
  } catch (e) { fail++; console.error('ERROR', e); }
  finally {
    if (server) server.close();
    await client.query('ROLLBACK');
    client.release();
    db.query = realQuery; db.pool.connect = realConnect;
    const t = (await db.pool.query(`SELECT to_regclass('public.background_check_documents') AS t`)).rows[0].t;
    check('rolled back: table not left in prod', t === null, t);
    console.log(fail ? `\n${fail} FAILED` : '\nALL PASS');
    process.exit(fail ? 1 : 0);
  }
})();
