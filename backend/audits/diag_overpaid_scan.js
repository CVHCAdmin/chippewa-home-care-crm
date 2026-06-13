// READ-ONLY: system-wide scan for the overpayment pattern.
// 1) invoices where amount_paid + amount_adjusted > total (impossible real-world)
// 2) invoices with multiple invoice_payments rows of identical amount (likely dup entry)
require('dotenv').config();
const db = require('../src/db');

(async () => {
  try {
    const over = await db.query(`
      SELECT i.invoice_number, i.total, i.amount_paid, i.amount_adjusted,
             (i.amount_paid + COALESCE(i.amount_adjusted,0) - i.total) AS overpay,
             i.payment_status, c.first_name, c.last_name
        FROM invoices i JOIN clients c ON c.id = i.client_id
       WHERE i.amount_paid + COALESCE(i.amount_adjusted,0) > i.total + 0.001
       ORDER BY overpay DESC`);
    console.log(`=== Invoices overpaid (amount_paid+adjusted > total): ${over.rows.length} ===`);
    console.dir(over.rows, { depth: null });

    const dupPays = await db.query(`
      SELECT invoice_id, amount, COUNT(*) n
        FROM invoice_payments
       GROUP BY invoice_id, amount
      HAVING COUNT(*) > 1
       ORDER BY n DESC`);
    console.log(`\n=== (invoice, amount) pairs with >1 identical payment row: ${dupPays.rows.length} ===`);
    console.dir(dupPays.rows, { depth: null });

    const tot = await db.query(`SELECT COUNT(*)::int n FROM invoices`);
    console.log(`\nTotal invoices in system: ${tot.rows[0].n}`);
  } catch (e) {
    console.error('FAILED:', e.message);
    process.exitCode = 1;
  } finally {
    await db.end?.();
    process.exit();
  }
})();
