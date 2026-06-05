// Read-only audit of back-dated recurring schedules and the overpayments
// they caused. Mirrors backend/audits/backdated_recurring_overpayment_audit.sql
// but runs through the project's existing pg pool so we don't need psql.

require('dotenv').config();
const db = require('../src/db');

function table(rows) {
  if (!rows.length) return '  (none)';
  const cols = Object.keys(rows[0]);
  const widths = cols.map(c => Math.max(c.length, ...rows.map(r => String(r[c] ?? '').length)));
  const sep   = '  ' + widths.map(w => '─'.repeat(w)).join('  ');
  const head  = '  ' + cols.map((c, i) => c.padEnd(widths[i])).join('  ');
  const body  = rows.map(r => '  ' + cols.map((c, i) => String(r[c] ?? '').padEnd(widths[i])).join('  ')).join('\n');
  return [head, sep, body].join('\n');
}

async function section(title, sql) {
  console.log('');
  console.log('═'.repeat(78));
  console.log(title);
  console.log('═'.repeat(78));
  try {
    const { rows } = await db.query(sql);
    console.log(`  ${rows.length} row(s)`);
    if (rows.length) console.log(table(rows));
  } catch (e) {
    console.log(`  ERROR: ${e.message}`);
  }
}

(async () => {
  try {
    await section(
      '1. PAYROLL: shifts paid for dates BEFORE the schedule was entered',
      `SELECT
         psr.shift_date,
         s.created_at::date AS schedule_entered_on,
         (s.created_at::date - psr.shift_date) AS days_backdated,
         u.first_name || ' ' || u.last_name AS caregiver,
         c.first_name || ' ' || c.last_name AS client,
         ROUND(psr.payable_minutes / 60.0, 2) AS payable_hours,
         psr.status,
         psr.pay_period_start,
         psr.pay_period_end
       FROM payroll_shift_reviews psr
       JOIN schedules s ON psr.schedule_id = s.id
       JOIN users u ON psr.caregiver_id = u.id
       LEFT JOIN clients c ON psr.client_id = c.id
       WHERE s.day_of_week IS NOT NULL
         AND psr.shift_date < s.created_at::date
       ORDER BY psr.shift_date DESC
       LIMIT 200`
    );

    await section(
      '2. PAYROLL: total over-paid hours per caregiver',
      `SELECT
         u.first_name || ' ' || u.last_name AS caregiver,
         COUNT(*) AS phantom_shifts,
         ROUND(SUM(psr.payable_minutes) / 60.0, 2) AS overpaid_hours,
         MIN(psr.shift_date) AS earliest_phantom,
         MAX(psr.shift_date) AS latest_phantom
       FROM payroll_shift_reviews psr
       JOIN schedules s ON psr.schedule_id = s.id
       JOIN users u ON psr.caregiver_id = u.id
       WHERE s.day_of_week IS NOT NULL
         AND psr.shift_date < s.created_at::date
       GROUP BY u.first_name, u.last_name
       ORDER BY overpaid_hours DESC`
    );

    await section(
      '3. BILLING: invoice line items for service dates BEFORE the schedule existed',
      `SELECT
         i.invoice_number,
         DATE(te.start_time) AS service_date,
         s.created_at::date  AS schedule_entered_on,
         (s.created_at::date - DATE(te.start_time)) AS days_backdated,
         ili.hours,
         ili.amount,
         i.payment_status,
         c.first_name || ' ' || c.last_name AS client
       FROM invoice_line_items ili
       JOIN invoices i      ON ili.invoice_id = i.id
       JOIN clients c       ON i.client_id    = c.id
       JOIN time_entries te ON ili.time_entry_id = te.id
       JOIN schedules s     ON te.schedule_id = s.id
       WHERE s.day_of_week IS NOT NULL
         AND DATE(te.start_time) < s.created_at::date
       ORDER BY i.billing_period_start DESC
       LIMIT 200`
    );

    await section(
      '4. SCHEDULES: recurring rows with no effective_date (about to be backfilled by v36)',
      `SELECT
         s.id,
         s.created_at::date AS will_become_effective_date,
         s.day_of_week,
         s.start_time,
         s.end_time,
         u.first_name || ' ' || u.last_name AS caregiver,
         c.first_name || ' ' || c.last_name AS client,
         s.is_active
       FROM schedules s
       LEFT JOIN users u   ON s.caregiver_id = u.id
       LEFT JOIN clients c ON s.client_id    = c.id
       WHERE s.day_of_week IS NOT NULL
         AND s.effective_date IS NULL
       ORDER BY s.created_at DESC
       LIMIT 200`
    );

    console.log('');
    console.log('═'.repeat(78));
    console.log('Audit complete.');
    console.log('═'.repeat(78));
  } catch (e) {
    console.error('FATAL:', e.message);
    process.exitCode = 1;
  } finally {
    await db.end?.();
    process.exit();
  }
})();
