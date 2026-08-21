// END-TO-END: the reconcile step and the new billing rule, run through the real
// router against prod data inside a transaction that is always rolled back.
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const db = require('../src/db');
const jwt = require('jsonwebtoken');
const express = require('express');

const LINDA  = 'e5f39b7d-2929-4e9f-9dd3-81bdf806aee1';
const START  = '2026-07-09';
const END    = '2026-08-18';

const d10 = (x) => {
  if (!x) return '';
  if (x instanceof Date) return `${x.getFullYear()}-${String(x.getMonth()+1).padStart(2,'0')}-${String(x.getDate()).padStart(2,'0')}`;
  return String(x).slice(0, 10);
};
let client;
const origQuery = db.query;
const origConnect = db.pool.connect.bind(db.pool);
const ok = [], bad = [];
const check = (name, pass, detail) => {
  (pass ? ok : bad).push(name);
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? ` - ${detail}` : ''}`);
};

(async () => {
  let server;
  try {
    client = await db.pool.connect();
    await client.query('BEGIN');
    db.query = (t, p) => client.query(t, p);

    // Some handlers (generate-with-rates, batch-generate) check out their OWN
    // pool connection for their transaction. Left alone they run outside this
    // one and commit to prod for real — that is exactly how an earlier run of
    // this test created four live invoices. Hand them the same client, and
    // neutralise their BEGIN/COMMIT so the outer rollback still owns everything.
    const savepointed = {
      query: async (t, p) => {
        const sql = String(t).trim().toUpperCase();
        if (sql === 'BEGIN' || sql === 'COMMIT') return { rows: [] };
        if (sql === 'ROLLBACK') return client.query('ROLLBACK TO SAVEPOINT harness_sp');
        return client.query(t, p);
      },
      release: () => {},
    };
    await client.query('SAVEPOINT harness_sp');
    db.pool.connect = async () => savepointed;

    const admin = (await db.query(
      `SELECT id, email FROM users WHERE role='admin' AND is_active=true ORDER BY created_at LIMIT 1`)).rows[0];
    const tok = jwt.sign({ id: admin.id, email: admin.email, role: 'admin' }, process.env.JWT_SECRET, { expiresIn: '1h' });

    const routes = require('../src/routes/billingRoutes');
    const app = express();
    app.use(express.json());
    app.use('/api/billing', routes);
    server = app.listen(0);
    const base = `http://127.0.0.1:${server.address().port}/api/billing`;
    const call = async (path, body) => {
      const r = await fetch(base + path, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tok}` },
        body: JSON.stringify(body),
      });
      return { status: r.status, body: await r.json().catch(() => null) };
    };

    // The existing invoice for this period would block regeneration.
    await db.query(`DELETE FROM invoice_line_items WHERE invoice_id IN (SELECT id FROM invoices WHERE seq_number = 84)`);
    await db.query(`DELETE FROM invoices WHERE seq_number = 84`);

    // ── 1. reconcile ────────────────────────────────────────────────────────
    const rec = await call('/invoices/reconcile', { clientId: LINDA, billingPeriodStart: START, billingPeriodEnd: END });
    check('reconcile returns rows', rec.status === 200 && rec.body?.reconcile?.length > 0,
      `${rec.status} ${rec.body?.reconcile?.length} days`);
    console.log('   counts:', JSON.stringify(rec.body.counts));

    const rows = rec.body.reconcile;
    const short = rows.find(r => r.status === 'short');
    check('the 13-minute mis-punch is flagged, not silently billed',
      !!short && short.needs_choice === true,
      short ? `${short.service_date} sched ${short.scheduled_minutes}m ($${short.scheduled_amount}) vs clocked ${short.clocked_minutes}m ($${short.clocked_amount})` : 'not found');
    check('its default is the scheduled amount', short?.default_basis === 'scheduled', short?.default_basis);

    check('days that match are settled, not asked about',
      rows.filter(r => r.status === 'match').every(r => !r.needs_choice),
      `${rows.filter(r => r.status === 'match').length} matching`);
    check('days with no clock-in are settled as scheduled',
      rows.filter(r => r.status === 'no_punch').every(r => !r.needs_choice && r.chosen_basis === 'scheduled'),
      `${rows.filter(r => r.status === 'no_punch').length} no-punch`);

    // ── 2. generate on the defaults ─────────────────────────────────────────
    const gen = await call('/invoices/generate-with-rates', {
      clientId: LINDA, billingPeriodStart: START, billingPeriodEnd: END });
    check('invoice generates', gen.status === 201 || gen.status === 200, `${gen.status} ${gen.body?.error || ''}`);

    const li = (await db.query(`
      SELECT service_date, hours, amount, billed_basis, scheduled_minutes, clocked_minutes
        FROM invoice_line_items WHERE invoice_id = $1 ORDER BY service_date`, [gen.body.id])).rows;
    const sliver = li.filter(r => Number(r.hours) < 1);
    check('no sliver lines on the invoice any more', sliver.length === 0,
      sliver.map(r => `${d10(r.service_date)} ${r.hours}h`).join(', ') || 'none');

    const jul21 = li.find(r => d10(r.service_date) === '2026-07-21');
    check('the 13-minute day now bills the scheduled 2 hours',
      jul21 && Number(jul21.hours) === 2 && Number(jul21.amount) === 66,
      jul21 ? `${jul21.hours}h $${jul21.amount} basis=${jul21.billed_basis} sched=${jul21.scheduled_minutes}m clocked=${jul21.clocked_minutes}m` : 'missing');

    check('every line records why it is that number',
      li.every(r => !!r.billed_basis), `${li.filter(r => r.billed_basis).length}/${li.length}`);

    const newTotal = li.reduce((a, r) => a + Number(r.amount), 0);
    console.log(`\n   invoice was $1004.85 before, $${newTotal.toFixed(2)} now (+$${(newTotal - 1004.85).toFixed(2)})`);

    // ── 3. same period, but choose "clocked" for the short day ──────────────
    await db.query(`DELETE FROM invoice_line_items WHERE invoice_id = $1`, [gen.body.id]);
    await db.query(`DELETE FROM invoices WHERE id = $1`, [gen.body.id]);
    const gen2 = await call('/invoices/generate-with-rates', {
      clientId: LINDA, billingPeriodStart: START, billingPeriodEnd: END,
      choices: { [short.key]: 'clocked' } });
    const li2 = (await db.query(
      `SELECT service_date, hours, amount, billed_basis FROM invoice_line_items WHERE invoice_id = $1`, [gen2.body.id])).rows;
    const chosen = li2.find(r => d10(r.service_date) === short.service_date);
    check('choosing "clocked" bills the punch instead',
      chosen && Number(chosen.hours) < 1 && chosen.billed_basis === 'clocked',
      chosen ? `${chosen.hours}h $${chosen.amount} basis=${chosen.billed_basis}` : 'missing');

    // ── 4. batch skips a client with unresolved days ────────────────────────
    await db.query(`DELETE FROM invoice_line_items WHERE invoice_id = $1`, [gen2.body.id]);
    await db.query(`DELETE FROM invoices WHERE id = $1`, [gen2.body.id]);
    const batch = await call('/invoices/batch-generate', { billingPeriodStart: START, billingPeriodEnd: END });
    const skipped = (batch.body?.skippedClients || []).find(s => /Deetz/.test(s.name));
    check('batch skips the client instead of guessing', !!skipped && skipped.needsReview === true,
      skipped ? skipped.reason : `not skipped (status ${batch.status})`);

  } catch (e) {
    console.error('\nHARNESS ERROR:', e.message, '\n', e.stack);
    bad.push('harness');
  } finally {
    try { await client.query('ROLLBACK'); console.log('\nrolled back - prod unchanged'); } catch (e) { console.error('ROLLBACK FAILED', e.message); }
    db.query = origQuery;
    db.pool.connect = origConnect;
    try { client.release(); } catch {}
    try { if (server) server.close(); } catch {}
    try { await db.pool.end(); } catch {}
    console.log(`\n${ok.length} passed, ${bad.length} failed`);
    if (bad.length) process.exitCode = 1;
  }
})();
