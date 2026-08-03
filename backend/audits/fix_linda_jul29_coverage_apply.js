// APPLY: correct the 2026-07-29 undercharge on Linda Wright's invoice
// INV-MSD8GCOH-CE70 (owner confirmed 2026-08-03: Patricia covered Sue's 10-1
// shift — she clocked out herself at 1:10 PM with GPS, and her note covers
// lunch + the PT visit).
//
// Patricia punched 8:01 AM-1:10 PM (309 min) but billed only her own 8-10
// schedule (2h). With Sue's absorbed 10-1 window the combined scheduled block
// is 300 min; 309 >= 300-7 grace -> bill 5.00h. Matches what the fixed
// generator now produces for this period ($2,046.00 total, verified read-only).
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const db = require('../src/db');

const INVOICE_NO = 'INV-MSD8GCOH-CE70';
const ENTRY_ID = 'a3eeff4c-dbf7-4e6e-ab76-b2345f1e908d';

(async () => {
  const client = await db.pool.connect();
  try {
    const inv = await client.query(
      `SELECT id, subtotal, tax, total, payment_status, amount_paid
         FROM invoices WHERE invoice_number = $1`, [INVOICE_NO]);
    if (inv.rows.length !== 1) throw new Error(`invoice lookup returned ${inv.rows.length} rows`);
    const invoice = inv.rows[0];
    console.log('Before:', invoice);
    if (parseFloat(invoice.amount_paid || 0) > 0 || invoice.payment_status === 'paid') {
      throw new Error('invoice has payments — aborting');
    }

    const line = await client.query(
      `SELECT id, description, hours, rate, amount FROM invoice_line_items
        WHERE invoice_id = $1 AND time_entry_id = $2`, [invoice.id, ENTRY_ID]);
    if (line.rows.length !== 1) throw new Error(`line lookup returned ${line.rows.length} rows`);
    console.log('Line before:', line.rows[0]);
    if (parseFloat(line.rows[0].hours) !== 2) throw new Error('expected a 2.00h line — already fixed?');

    await client.query('BEGIN');
    const rate = parseFloat(line.rows[0].rate);
    await client.query(
      `UPDATE invoice_line_items SET hours = 5.00, amount = $2 WHERE id = $1`,
      [line.rows[0].id, (5 * rate).toFixed(2)]);
    const upd = await client.query(`
      UPDATE invoices SET
        subtotal = (SELECT COALESCE(SUM(amount), 0) FROM invoice_line_items WHERE invoice_id = $1),
        total    = (SELECT COALESCE(SUM(amount), 0) FROM invoice_line_items WHERE invoice_id = $1) + COALESCE(tax, 0),
        updated_at = NOW()
      WHERE id = $1
      RETURNING subtotal, tax, total`, [invoice.id]);
    console.log('After totals:', upd.rows[0]);
    await client.query('COMMIT');
    console.log('DONE — Jul 29 now bills 5.00h.');
  } catch (e) {
    try { await client.query('ROLLBACK'); } catch {}
    console.error('FAILED (rolled back):', e.message);
    process.exitCode = 1;
  } finally {
    client.release();
    try { await db.pool.end(); } catch {}
  }
})();
