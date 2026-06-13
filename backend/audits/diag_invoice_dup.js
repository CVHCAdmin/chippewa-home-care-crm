// READ-ONLY diagnostic for the Dianne Oas double-payment / duplicate-invoice report.
// Invoice ref INV-MPH8VCCT-BBD6 (#5). Looks at the invoice, all of the client's
// invoices, the payment rows, and recent billing audit logs. No writes.

require('dotenv').config();
const db = require('../src/db');

(async () => {
  try {
    const ref = 'INV-MPH8VCCT-BBD6';
    const inv = await db.query(
      `SELECT id, invoice_number, client_id, total, amount_paid, amount_adjusted,
              payment_status, payment_date, paid_at, stripe_session_id, stripe_payment_id,
              billing_period_start, billing_period_end, created_at, updated_at
         FROM invoices WHERE invoice_number = $1 OR id::text = $1`, [ref]);
    console.log('=== Invoice by ref', ref, '===');
    console.dir(inv.rows, { depth: null });
    if (!inv.rows.length) { console.log('No invoice found by that ref.'); }

    const clientId = inv.rows[0]?.client_id;
    if (clientId) {
      const all = await db.query(
        `SELECT id, invoice_number, total, amount_paid, amount_adjusted, payment_status,
                billing_period_start, billing_period_end, created_at
           FROM invoices WHERE client_id = $1 ORDER BY created_at`, [clientId]);
      console.log(`\n=== All invoices for client ${clientId} (${all.rows.length}) ===`);
      console.dir(all.rows, { depth: null });

      // duplicate periods?
      const dups = await db.query(
        `SELECT billing_period_start, billing_period_end, COUNT(*) n,
                ARRAY_AGG(invoice_number) nums, SUM(total) total_sum
           FROM invoices WHERE client_id = $1
          GROUP BY billing_period_start, billing_period_end HAVING COUNT(*) > 1`, [clientId]);
      console.log(`\n=== Duplicate billing periods for this client ===`);
      console.dir(dups.rows, { depth: null });

      const ids = all.rows.map(r => r.id);
      const pays = await db.query(
        `SELECT invoice_id, amount, payment_date, payment_method, reference_number, notes, created_at
           FROM invoice_payments WHERE invoice_id = ANY($1) ORDER BY created_at`, [ids]);
      console.log(`\n=== invoice_payments rows for this client's invoices (${pays.rows.length}) ===`);
      console.dir(pays.rows, { depth: null });
    }

    if (inv.rows[0]?.id) {
      const audit = await db.query(
        `SELECT action, table_name, record_id, new_data, created_at
           FROM audit_logs WHERE record_id = $1 ORDER BY created_at`, [inv.rows[0].id]);
      console.log(`\n=== audit_logs for invoice ${inv.rows[0].id} (${audit.rows.length}) ===`);
      console.dir(audit.rows, { depth: null });
    }
  } catch (e) {
    console.error('FAILED:', e.message);
    process.exitCode = 1;
  } finally {
    await db.end?.();
    process.exit();
  }
})();
