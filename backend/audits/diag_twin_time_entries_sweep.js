// READ-ONLY: sweep for "twin" time entries — same caregiver+client, complete,
// starting within seconds of each other (the double-insert clock-in race that
// double-billed Linda Wright on 2026-07-28). For each pair, also report
// whether each twin landed on an invoice line item.
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const db = require('../src/db');

const chi = (ts) => ts ? new Date(ts).toLocaleString('en-US', { timeZone: 'America/Chicago', year: 'numeric', month: '2-digit', day: '2-digit', hour: 'numeric', minute: '2-digit', hour12: true }) : 'null';

(async () => {
  try {
    const r = await db.query(`
      SELECT a.id AS a_id, b.id AS b_id,
             a.caregiver_id, a.client_id,
             a.start_time AS a_start, a.end_time AS a_end, a.billable_minutes AS a_bill,
             b.start_time AS b_start, b.end_time AS b_end, b.billable_minutes AS b_bill,
             u.first_name AS cg_first, u.last_name AS cg_last,
             c.first_name AS cl_first, c.last_name AS cl_last,
             ila.invoice_id AS a_invoice, ilb.invoice_id AS b_invoice,
             inva.invoice_number AS a_inv_no, invb.invoice_number AS b_inv_no,
             inva.payment_status AS a_inv_status, invb.payment_status AS b_inv_status
        FROM time_entries a
        JOIN time_entries b
          ON b.caregiver_id = a.caregiver_id
         AND b.client_id = a.client_id
         AND b.id > a.id
         AND ABS(EXTRACT(EPOCH FROM (b.start_time - a.start_time))) <= 120
        JOIN users u   ON u.id = a.caregiver_id
        JOIN clients c ON c.id = a.client_id
        LEFT JOIN invoice_line_items ila ON ila.time_entry_id = a.id
        LEFT JOIN invoice_line_items ilb ON ilb.time_entry_id = b.id
        LEFT JOIN invoices inva ON inva.id = ila.invoice_id
        LEFT JOIN invoices invb ON invb.id = ilb.invoice_id
       WHERE a.is_complete = true AND b.is_complete = true
       ORDER BY a.start_time
    `);
    if (r.rows.length === 0) { console.log('No twin pairs found.'); return; }
    console.log(`${r.rows.length} twin pair(s):\n`);
    for (const p of r.rows) {
      console.log(`${p.cg_first} ${p.cg_last} @ ${p.cl_first} ${p.cl_last}`);
      console.log(`  A ${p.a_id}  ${chi(p.a_start)} -> ${chi(p.a_end)}  bill=${p.a_bill}m  invoice=${p.a_inv_no || '-'}${p.a_inv_status ? ' (' + p.a_inv_status + ')' : ''}`);
      console.log(`  B ${p.b_id}  ${chi(p.b_start)} -> ${chi(p.b_end)}  bill=${p.b_bill}m  invoice=${p.b_inv_no || '-'}${p.b_inv_status ? ' (' + p.b_inv_status + ')' : ''}`);
      console.log('');
    }
  } catch (e) {
    console.error('FAILED:', e.message);
    process.exitCode = 1;
  } finally {
    await db.pool.end();
    process.exit();
  }
})();
