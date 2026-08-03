// APPLY: fix the 2026-07-28 twin-punch double-bill on Linda Wright's invoice
// INV-MSD8GCOH-CE70 (pending, unpaid).
//
// The clock-in double-insert race created two entries 1ms apart for Patricia
// Wittmann's Tue 8-12 shift. Entry 6ccb4312 matched the schedule and billed
// the correct 4.00h line; twin 4f4f4e34 billed a second, phantom
// "unscheduled" 4.35h / $134.85 line.
//
// This script, in one transaction:
//  1. deletes the phantom line item (time_entry_id = 4f4f4e34, 'unscheduled'),
//  2. recomputes the invoice subtotal/total from the remaining lines,
//  3. zeroes billable_minutes on the twin entry and marks it as a duplicate so
//     no future regeneration or payroll review pays it (the care note stays).
const TWIN_ID   = '4f4f4e34-2912-4eb8-8607-f85e402c2853';
const KEPT_ID   = '6ccb4312-96dc-4005-b723-31a6973c67fd';
const INVOICE_NO = 'INV-MSD8GCOH-CE70';

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const db = require('../src/db');

(async () => {
  const client = await db.pool.connect();
  try {
    const inv = await client.query(
      `SELECT id, invoice_number, subtotal, tax, total, payment_status, amount_paid
         FROM invoices WHERE invoice_number = $1`, [INVOICE_NO]);
    if (inv.rows.length !== 1) throw new Error(`invoice lookup returned ${inv.rows.length} rows`);
    const invoice = inv.rows[0];
    console.log('Before:', invoice);
    if (parseFloat(invoice.amount_paid || 0) > 0 || invoice.payment_status === 'paid') {
      throw new Error('invoice has payments — aborting, needs manual handling');
    }

    const line = await client.query(
      `SELECT id, description, hours, amount FROM invoice_line_items
        WHERE invoice_id = $1 AND time_entry_id = $2 AND description ILIKE '%unscheduled%'`,
      [invoice.id, TWIN_ID]);
    if (line.rows.length !== 1) throw new Error(`phantom line lookup returned ${line.rows.length} rows`);
    console.log('Deleting line:', line.rows[0]);

    await client.query('BEGIN');
    await client.query(`DELETE FROM invoice_line_items WHERE id = $1`, [line.rows[0].id]);
    const upd = await client.query(`
      UPDATE invoices SET
        subtotal = (SELECT COALESCE(SUM(amount), 0) FROM invoice_line_items WHERE invoice_id = $1),
        total    = (SELECT COALESCE(SUM(amount), 0) FROM invoice_line_items WHERE invoice_id = $1) + COALESCE(tax, 0),
        updated_at = NOW()
      WHERE id = $1
      RETURNING subtotal, tax, total`, [invoice.id]);
    console.log('After totals:', upd.rows[0]);

    const twin = await client.query(`
      UPDATE time_entries SET
        billable_minutes = 0,
        needs_approval = true,
        approval_reason = 'duplicate_entry',
        notes = COALESCE(notes, '') || ' [Duplicate clock-in artifact of ${KEPT_ID} — created same millisecond by double-submit race; excluded from billing/payroll 2026-08-03]',
        updated_at = NOW()
      WHERE id = $1
      RETURNING id, billable_minutes, needs_approval, approval_reason`, [TWIN_ID]);
    console.log('Twin neutralized:', twin.rows[0]);
    await client.query('COMMIT');
    console.log('DONE — invoice corrected.');
  } catch (e) {
    try { await client.query('ROLLBACK'); } catch {}
    console.error('FAILED (rolled back):', e.message);
    process.exitCode = 1;
  } finally {
    client.release();
    try { await db.pool.end(); } catch {}
  }
})();
