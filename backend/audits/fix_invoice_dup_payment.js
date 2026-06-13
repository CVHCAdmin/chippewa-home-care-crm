// One-off data correction for invoice INV-MPH8VCCT-BBD6 (Dianne Oas).
// A $412 check was entered twice, doubling amount_paid to $824.
// Fix (in one transaction):
//   1. delete the duplicate invoice_payments row (the one entered 2026-06-13)
//   2. set amount_paid = sum of remaining real payments ($412)
//   3. write off the residual $0.50 (412 check vs 412.50 total) as an adjustment
//   4. mark the invoice paid, payment_date = the real check date
// Idempotent-ish: re-running after the dup is gone makes no further payment deletes.

require('dotenv').config();
const db = require('../src/db');

const INVOICE_ID = '17989769-0452-46f1-8a71-8d26497ac2d9';
const SYSTEM_USER = '00000000-0000-0000-0000-000000000000';

(async () => {
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');

    const before = await client.query(
      'SELECT total, amount_paid, amount_adjusted, payment_status FROM invoices WHERE id = $1 FOR UPDATE',
      [INVOICE_ID]
    );
    if (!before.rows.length) throw new Error('Invoice not found');
    console.log('BEFORE:', before.rows[0]);

    // 1) Drop the duplicate payment row entered today. Keep the earliest one.
    const dupDel = await client.query(`
      DELETE FROM invoice_payments
       WHERE ctid IN (
         SELECT ctid FROM invoice_payments
          WHERE invoice_id = $1 AND amount = 412.00
          ORDER BY created_at DESC
          LIMIT 1
       )
       AND (SELECT COUNT(*) FROM invoice_payments WHERE invoice_id = $1 AND amount = 412.00) > 1
      RETURNING *`, [INVOICE_ID]);
    console.log(`Deleted duplicate payment rows: ${dupDel.rows.length}`);

    // 2) Recompute amount_paid from the surviving real payments.
    const sumRes = await client.query(
      'SELECT COALESCE(SUM(amount), 0) AS paid FROM invoice_payments WHERE invoice_id = $1',
      [INVOICE_ID]
    );
    const realPaid = parseFloat(sumRes.rows[0].paid);
    const total = parseFloat(before.rows[0].total);
    const residual = +(total - realPaid).toFixed(2); // 0.50

    // 3) Record the write-off adjustment (only if there's a residual and none exists yet).
    let adjusted = parseFloat(before.rows[0].amount_adjusted) || 0;
    if (residual > 0 && adjusted === 0) {
      await client.query(`
        INSERT INTO invoice_adjustments (invoice_id, amount, adjustment_type, reason, notes)
        VALUES ($1, $2, 'write_off', 'Rounding write-off: $412.00 check against $412.50 total', 'Applied during duplicate-payment cleanup 2026-06-13')
      `, [INVOICE_ID, residual]);
      adjusted = residual;
      console.log(`Recorded write-off adjustment: $${residual.toFixed(2)}`);
    }

    // 4) Settle the invoice: amount_paid = real cash, status paid (paid + adjusted == total).
    const upd = await client.query(`
      UPDATE invoices
         SET amount_paid = $1::numeric,
             amount_adjusted = $2::numeric,
             payment_status = CASE WHEN $1::numeric + $2::numeric >= total THEN 'paid' WHEN $1::numeric > 0 THEN 'partial' ELSE 'pending' END,
             payment_date = COALESCE((SELECT MIN(payment_date) FROM invoice_payments WHERE invoice_id = $3), payment_date),
             paid_at = CASE WHEN $1::numeric + $2::numeric >= total THEN NOW() ELSE paid_at END,
             updated_at = NOW()
       WHERE id = $3
      RETURNING total, amount_paid, amount_adjusted, payment_status, payment_date`,
      [realPaid, adjusted, INVOICE_ID]);
    console.log('AFTER:', upd.rows[0]);

    await db.auditLog(SYSTEM_USER, 'UPDATE', 'invoices', INVOICE_ID,
      before.rows[0],
      { action: 'duplicate_payment_cleanup', removed_payment: 412.00, amount_paid: realPaid, write_off: residual });

    await client.query('COMMIT');
    console.log('\n✓ Correction committed.');
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('FAILED (rolled back):', e.message);
    process.exitCode = 1;
  } finally {
    client.release();
    await db.pool.end();
    process.exit();
  }
})();
