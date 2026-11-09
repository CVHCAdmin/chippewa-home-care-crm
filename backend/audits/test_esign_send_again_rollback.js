// Tests E-Signatures "Send again" (POST /api/sign-requests/send { again: true }) and the people
// list over real HTTP, every write inside ONE transaction that is ROLLED BACK (db.query and
// db.pool.connect both routed to it — memory feedback_testing_against_prod). Email is stubbed.
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
process.env.TWILIO_ACCOUNT_SID = ''; process.env.TWILIO_AUTH_TOKEN = '';
const express = require('express');
const jwt = require('jsonwebtoken');
const db = require('../src/db');
const emailService = require('../src/services/emailService');
let emails = 0;
emailService.sendSignRequest = async () => { emails++; return true; };

(async () => {
  const client = await db.pool.connect();
  const realQuery = db.query, realConnect = db.pool.connect;
  let fail = 0, server;
  const check = (n, ok, x) => { if (!ok) fail++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${x !== undefined ? ' — ' + JSON.stringify(x) : ''}`); };
  try {
    await client.query('BEGIN');
    db.query = (t, p) => client.query(t, p);
    db.pool.connect = async () => ({ query: (t, p) => {
      const s = typeof t === 'string' ? t.trim().toUpperCase() : '';
      if (s === 'BEGIN') return client.query('SAVEPOINT h');
      if (s === 'COMMIT') return client.query('RELEASE SAVEPOINT h');
      if (s === 'ROLLBACK') return client.query('ROLLBACK TO SAVEPOINT h');
      return client.query(t, p); }, release: () => {} });

    const admin = (await client.query(`SELECT id, email, role FROM users WHERE role='admin' AND is_active LIMIT 1`)).rows[0];
    const tpl = (await client.query(`SELECT id FROM sign_templates WHERE kind='bid' AND is_active`)).rows[0];
    // someone who signed the BID and has nothing open
    const signer = (await client.query(`
      SELECT u.id, u.first_name FROM users u WHERE u.is_active AND u.email ~ '@'
        AND EXISTS (SELECT 1 FROM sign_requests s WHERE s.template_id=$1 AND s.user_id=u.id AND s.status='signed')
        AND NOT EXISTS (SELECT 1 FROM sign_requests s WHERE s.template_id=$1 AND s.user_id=u.id AND s.status IN ('sent','opened'))
      LIMIT 1`, [tpl.id])).rows[0];
    const unsent = (await client.query(`
      SELECT u.id FROM users u WHERE u.is_active AND u.role IN ('caregiver','admin') AND u.email ~ '@'
        AND NOT EXISTS (SELECT 1 FROM sign_requests s WHERE s.template_id=$1 AND s.user_id=u.id AND s.status <> 'cancelled') LIMIT 1`, [tpl.id])).rows[0];
    console.log('signer:', signer?.first_name, ' unsent person found:', !!unsent);

    const tok = jwt.sign({ id: admin.id, email: admin.email, role: admin.role }, process.env.JWT_SECRET, { expiresIn: '5m' });
    const app = express(); app.use(express.json()); app.use('/api/sign-requests', require('../src/routes/signRequestsRoutes'));
    server = app.listen(0);
    const base = `http://127.0.0.1:${server.address().port}/api/sign-requests`;
    const call = async (m, u, b) => { const r = await fetch(base + u, { method: m, headers: { Authorization: `Bearer ${tok}`, ...(b ? { 'Content-Type': 'application/json' } : {}) }, body: b ? JSON.stringify(b) : undefined }); return { status: r.status, json: await r.json().catch(() => null) }; };
    const person = async (id) => (await call('GET', `/templates/${tpl.id}/people`)).json.find(p => p.user_id === id);
    const counts = async () => (await call('GET', '/templates')).json.find(t => t.id === tpl.id);

    const before = await person(signer.id), c0 = await counts();
    check('people: signer shows signed', before.status === 'signed' && before.last_signed_request_id === before.request_id);

    let r = await call('POST', '/send', { templateId: tpl.id, userIds: [signer.id] });
    check('plain send to a signer is still skipped', r.status === 200 && r.json.results[0].skipped === 'already signed', r.json.results[0]);

    r = await call('POST', '/send', { templateId: tpl.id, userIds: [signer.id], again: true });
    const res = r.json.results[0];
    check('send again creates a new request + emails it', r.status === 200 && res.requestId && res.emailSent === true && emails === 1, res);

    const after = await person(signer.id);
    check('people: now shows the new request as sent', after.request_id === res.requestId && after.status === 'sent');
    check('people: previous signed copy still linked', after.last_signed_request_id === before.request_id && !!after.last_signed_at);
    const old = (await client.query(`SELECT status FROM sign_requests WHERE id=$1`, [before.request_id])).rows[0];
    check('old signed request untouched', old.status === 'signed');

    const c1 = await counts();
    check('counts are per person (sent/signed unchanged)', c1.signed === c0.signed && c1.sent === c0.sent, { c0, c1 });

    r = await call('POST', '/send', { templateId: tpl.id, userIds: [signer.id], again: true });
    check('send again while one is open → skipped, no 500', r.status === 200 && r.json.results[0].skipped === 'already sent — use Remind', r.json.results[0]);

    r = await call('POST', `/requests/${res.requestId}/remind`);
    check('remind works on the new request', r.status === 200 && r.json.emailSent === true);

    r = await call('GET', `/requests/${before.request_id}/signed.pdf`);
    check('last signed copy still downloadable', r.status === 200 || r.status === null);

    if (unsent) {
      r = await call('POST', '/send', { templateId: tpl.id, userIds: [unsent.id], again: true });
      check('again:true for a never-sent person = normal send', !!r.json.results[0].requestId);
    }
  } catch (e) { fail++; console.error('ERROR', e); }
  finally {
    await client.query('ROLLBACK').catch(() => {});
    db.query = realQuery; db.pool.connect = realConnect;
    client.release(); if (server) server.close(); await db.pool.end();
    console.log(fail ? `\n${fail} FAILED (rolled back)` : '\nALL PASS (rolled back — nothing saved)');
    process.exitCode = fail ? 1 : 0;
  }
})();
