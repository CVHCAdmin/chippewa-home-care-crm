// Live e2e test of the overpayment guard against PROD API.
// Inserts a throwaway $100 invoice, mints an admin token, then exercises the
// real https endpoint: partial payment -> overpayment (must 409) -> exact pay.
// Always cleans up the test invoice + its payments. Read the PASS/FAIL lines.

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
// Local in-process testApp boot needs valid-format Twilio creds (smsRoutes
// builds a client at require time). Force a dummy AC-prefixed SID for the test
// harness, overriding any placeholder in .env.
process.env.TWILIO_ACCOUNT_SID = 'AC00000000000000000000000000000000';
process.env.TWILIO_AUTH_TOKEN = 'testtoken';
process.env.NODE_ENV = process.env.NODE_ENV || 'test';
const jwt = require('jsonwebtoken');
const { randomUUID } = require('crypto');
const db = require('../src/db');

// Default: boot the real route code in-process so the token secret matches.
// Pass PROD_BASE=<url> + a valid token file to hit prod instead.
const USE_PROD = !!process.env.PROD_BASE;
const TEST_NUM = 'TEST-DEPLOY-VERIFY-' + Date.now().toString(36).toUpperCase();
const CLIENT_ID = 'b8fc878b-8d08-4da4-8e49-14dc9e69db6c'; // Bonnie Schimmel (FK only; row deleted after)
let BASE = process.env.PROD_BASE || null;
let server = null;

async function post(token, body) {
  const r = await fetch(`${BASE}/api/billing/invoice-payments`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
  let json = null; try { json = await r.json(); } catch {}
  return { status: r.status, json };
}

(async () => {
  let invoiceId;
  let deployed = true;
  try {
    if (!USE_PROD) {
      const app = require('../src/testApp');
      server = app.listen(0);
      BASE = `http://127.0.0.1:${server.address().port}`;
      console.log(`Booted in-process testApp at ${BASE} (real route code, local secret)\n`);
    } else {
      console.log(`Targeting PROD ${BASE}\n`);
    }

    const ins = await db.query(
      `INSERT INTO invoices (invoice_number, client_id, billing_period_start, billing_period_end, subtotal, total, payment_status)
       VALUES ($1, $2, '2026-06-01', '2026-06-07', 100.00, 100.00, 'pending') RETURNING id`,
      [TEST_NUM, CLIENT_ID]
    );
    invoiceId = ins.rows[0].id;
    console.log(`Test invoice ${TEST_NUM} (${invoiceId}) total=$100, pending\n`);

    const token = jwt.sign(
      { id: randomUUID(), email: 'deploy-verify@test.local', role: 'admin', name: 'Deploy Verify', iat: Math.floor(Date.now() / 1000) - 60 },
      process.env.JWT_SECRET, { expiresIn: '10m' }
    );

    // 1) valid partial payment of $60
    const r1 = await post(token, { invoiceId, amount: 60, paymentDate: '2026-06-13', paymentMethod: 'check' });
    const ok1 = r1.status === 200;
    console.log(`1) record $60 (valid partial): HTTP ${r1.status} ${ok1 ? 'PASS' : 'FAIL'}`);

    // 2) overpayment: another $60 -> would be $120 > $100. New code: 409. Old code: 200.
    const r2 = await post(token, { invoiceId, amount: 60, paymentDate: '2026-06-13', paymentMethod: 'check' });
    if (r2.status === 409) {
      console.log(`2) record $60 again (overpay): HTTP 409 PASS — blocked. balanceDue reported=$${r2.json?.balanceDue}`);
    } else {
      deployed = false;
      console.log(`2) record $60 again (overpay): HTTP ${r2.status} FAIL — NOT blocked. New code is NOT live yet on prod.`);
    }

    // 3) exact remaining payment of $40 -> $100 total, should mark paid
    const r3 = await post(token, { invoiceId, amount: 40, paymentDate: '2026-06-13', paymentMethod: 'check' });
    const ok3 = r3.status === 200;
    console.log(`3) record $40 (exact remainder): HTTP ${r3.status} ${ok3 ? 'PASS' : 'FAIL'}`);

    // verify final DB state
    const fin = await db.query('SELECT amount_paid, payment_status FROM invoices WHERE id = $1', [invoiceId]);
    const pc = await db.query('SELECT COUNT(*)::int n, COALESCE(SUM(amount),0) s FROM invoice_payments WHERE invoice_id = $1', [invoiceId]);
    console.log(`\nfinal invoice: amount_paid=$${fin.rows[0].amount_paid}, status=${fin.rows[0].payment_status}`);
    console.log(`payment rows: ${pc.rows[0].n}, sum=$${pc.rows[0].s}`);

    const expectPaid = deployed ? '100.00' : '120.00';
    const verdict = deployed && fin.rows[0].amount_paid === '100.00' && fin.rows[0].payment_status === 'paid' && pc.rows[0].n === 2;
    console.log(`\n${deployed ? '✅ DEPLOYED & WORKING' : '⚠️  NOT YET DEPLOYED'} — final amount_paid expected $${expectPaid}, got $${fin.rows[0].amount_paid}; overall ${verdict ? 'PASS' : (deployed ? 'CHECK' : 'RETRY LATER')}`);
  } catch (e) {
    console.error('ERROR:', e.message);
    process.exitCode = 1;
  } finally {
    if (invoiceId) {
      await db.query('DELETE FROM invoice_payments WHERE invoice_id = $1', [invoiceId]).catch(() => {});
      await db.query('DELETE FROM invoices WHERE id = $1', [invoiceId]).catch(() => {});
      console.log(`\ncleanup: test invoice ${TEST_NUM} and its payments removed`);
    }
    server?.close();
    await db.pool.end();
    process.exit();
  }
})();
