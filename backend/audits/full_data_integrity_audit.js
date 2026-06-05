// Production data-integrity audit. Read-only. Looks for stuck states,
// orphans, duplicates, and other "did the data drift?" red flags across
// every major table.

require('dotenv').config();
const db = require('../src/db');

const checks = [
  // ── SCHEDULING ──────────────────────────────────────────────────
  { name: 'schedules: active rows pointing at deleted/inactive caregivers',
    sql: `SELECT COUNT(*)::int AS n FROM schedules s
          LEFT JOIN users u ON s.caregiver_id = u.id
          WHERE s.is_active = true AND (u.id IS NULL OR u.is_active = false)` },
  { name: 'schedules: active rows pointing at deleted/inactive clients',
    sql: `SELECT COUNT(*)::int AS n FROM schedules s
          LEFT JOIN clients c ON s.client_id = c.id
          WHERE s.is_active = true AND (c.id IS NULL OR c.is_active = false)` },
  { name: 'schedules: recurring with end_date in the past but still active',
    sql: `SELECT COUNT(*)::int AS n FROM schedules
          WHERE is_active = true AND day_of_week IS NOT NULL
            AND end_date IS NOT NULL AND end_date < CURRENT_DATE` },
  { name: 'schedules: end_time <= start_time (impossible shift)',
    sql: `SELECT COUNT(*)::int AS n FROM schedules WHERE is_active = true AND end_time <= start_time` },
  { name: 'schedule_exceptions: orphans (schedule deleted/missing)',
    sql: `SELECT COUNT(*)::int AS n FROM schedule_exceptions se
          LEFT JOIN schedules s ON se.schedule_id = s.id WHERE s.id IS NULL` },

  // ── TIME ENTRIES / EVV ──────────────────────────────────────────
  { name: 'time_entries: complete=true but no end_time',
    sql: `SELECT COUNT(*)::int AS n FROM time_entries WHERE is_complete = true AND end_time IS NULL` },
  { name: 'time_entries: end_time before start_time',
    sql: `SELECT COUNT(*)::int AS n FROM time_entries WHERE end_time IS NOT NULL AND end_time < start_time` },
  { name: 'time_entries: orphaned caregiver',
    sql: `SELECT COUNT(*)::int AS n FROM time_entries te LEFT JOIN users u ON te.caregiver_id = u.id WHERE u.id IS NULL` },
  { name: 'time_entries: orphaned client',
    sql: `SELECT COUNT(*)::int AS n FROM time_entries te LEFT JOIN clients c ON te.client_id = c.id WHERE c.id IS NULL` },
  { name: 'time_entries: open punches > 24 hours old (probably forgot to clock out)',
    sql: `SELECT COUNT(*)::int AS n FROM time_entries
          WHERE is_complete = false AND start_time < NOW() - INTERVAL '24 hours'` },

  // ── PAYROLL ─────────────────────────────────────────────────────
  { name: 'payroll_shift_reviews: pending review > 30 days old',
    sql: `SELECT COUNT(*)::int AS n FROM payroll_shift_reviews
          WHERE status = 'pending' AND created_at < NOW() - INTERVAL '30 days'` },
  { name: 'payroll_shift_reviews: same (caregiver, shift_date, schedule_id) in 2+ overlapping pay periods',
    sql: `SELECT COUNT(*)::int AS n FROM (
            SELECT caregiver_id, shift_date, schedule_id, COUNT(DISTINCT (pay_period_start, pay_period_end)) AS periods
            FROM payroll_shift_reviews WHERE schedule_id IS NOT NULL
            GROUP BY caregiver_id, shift_date, schedule_id HAVING COUNT(DISTINCT (pay_period_start, pay_period_end)) > 1
          ) x` },
  { name: 'payroll_shift_reviews: missing_punch status with payable_minutes > 0 (paid for non-existent work)',
    sql: `SELECT COUNT(*)::int AS n FROM payroll_shift_reviews WHERE status = 'missing_punch' AND payable_minutes > 0` },
  { name: 'payroll_shift_reviews: approved but no time_entry AND no payable_minutes (no work, no pay, why is it approved?)',
    sql: `SELECT COUNT(*)::int AS n FROM payroll_shift_reviews WHERE status = 'approved' AND time_entry_id IS NULL AND COALESCE(payable_minutes,0) = 0` },

  // ── BILLING / INVOICING ─────────────────────────────────────────
  { name: 'invoices: total ≠ subtotal + tax (math error)',
    sql: `SELECT COUNT(*)::int AS n FROM invoices WHERE ROUND(total::numeric, 2) <> ROUND((COALESCE(subtotal,0) + COALESCE(tax,0))::numeric, 2)` },
  { name: 'invoice_line_items: amount ≠ hours * rate (line math error)',
    sql: `SELECT COUNT(*)::int AS n FROM invoice_line_items
          WHERE ROUND(amount::numeric, 2) <> ROUND((hours * rate)::numeric, 2)` },
  { name: 'invoice_line_items: pointing at a time_entry that has been deleted',
    sql: `SELECT COUNT(*)::int AS n FROM invoice_line_items ili
          WHERE ili.time_entry_id IS NOT NULL
            AND NOT EXISTS (SELECT 1 FROM time_entries te WHERE te.id = ili.time_entry_id)` },
  { name: 'invoices: orphaned client',
    sql: `SELECT COUNT(*)::int AS n FROM invoices i LEFT JOIN clients c ON i.client_id = c.id WHERE c.id IS NULL` },
  { name: 'claims: stuck in submitted/pending > 60 days',
    sql: `SELECT COUNT(*)::int AS n FROM claims
          WHERE status IN ('submitted','pending') AND created_at < NOW() - INTERVAL '60 days'` },

  // ── AUTHORIZATIONS ──────────────────────────────────────────────
  { name: 'authorizations: end_date < start_date',
    sql: `SELECT COUNT(*)::int AS n FROM authorizations WHERE end_date IS NOT NULL AND end_date < start_date` },
  { name: 'authorizations: expired (end_date passed) but still active',
    sql: `SELECT COUNT(*)::int AS n FROM authorizations
          WHERE end_date IS NOT NULL AND end_date < CURRENT_DATE
            AND COALESCE(is_active, true) = true` },

  // ── AUDIT LOGS (known broken — blank IDs / data changes stuck) ──
  { name: 'audit_logs: rows with NULL record_id (HIPAA gap)',
    sql: `SELECT COUNT(*)::int AS n FROM audit_logs WHERE record_id IS NULL` },
  { name: 'audit_logs: rows from last 7 days',
    sql: `SELECT COUNT(*)::int AS n FROM audit_logs WHERE created_at > NOW() - INTERVAL '7 days'` },
  { name: 'audit_logs: distinct actions in last 30 days',
    sql: `SELECT array_agg(DISTINCT action) AS actions FROM audit_logs WHERE created_at > NOW() - INTERVAL '30 days'` },

  // ── USERS / CAREGIVERS ──────────────────────────────────────────
  { name: 'users: caregivers with no certifications recorded',
    sql: `SELECT COUNT(*)::int AS n FROM users u
          WHERE u.role = 'caregiver' AND u.is_active = true
            AND NOT EXISTS (SELECT 1 FROM caregiver_certifications cc WHERE cc.caregiver_id = u.id)` },
  { name: 'caregiver_certifications: expired but no expiration alert',
    sql: `SELECT COUNT(*)::int AS n FROM caregiver_certifications cc
          WHERE cc.expiration_date IS NOT NULL AND cc.expiration_date < CURRENT_DATE
            AND NOT EXISTS (SELECT 1 FROM certification_alerts ca WHERE ca.caregiver_id = cc.caregiver_id)` },

  // ── CLIENTS ─────────────────────────────────────────────────────
  { name: 'clients: active but no care_type_id set',
    sql: `SELECT COUNT(*)::int AS n FROM clients WHERE is_active = true AND care_type_id IS NULL` },
  { name: 'clients: missing GPS coordinates (route-optimizer broken without these)',
    sql: `SELECT COUNT(*)::int AS n FROM clients WHERE is_active = true AND (latitude IS NULL OR longitude IS NULL)` },

  // ── NOTIFICATIONS ───────────────────────────────────────────────
  { name: 'notifications: stuck in pending > 24 hours',
    sql: `SELECT COUNT(*)::int AS n FROM notifications WHERE status = 'pending' AND created_at < NOW() - INTERVAL '24 hours'` },
  { name: 'notifications: failed in last 7 days',
    sql: `SELECT COUNT(*)::int AS n FROM notifications WHERE status = 'failed' AND created_at > NOW() - INTERVAL '7 days'` },

  // ── SANDATA EVV ─────────────────────────────────────────────────
  { name: 'time_entries: complete shifts in last 30 days with no Sandata submission',
    sql: `SELECT COUNT(*)::int AS n FROM time_entries te
          WHERE te.is_complete = true AND te.start_time > NOW() - INTERVAL '30 days'
            AND NOT EXISTS (
              SELECT 1 FROM information_schema.tables WHERE table_name = 'sandata_submissions'
            )` },
];

(async () => {
  console.log('═══════════════════════════════════════════════════════════════════════════════');
  console.log('PRODUCTION DATA INTEGRITY AUDIT');
  console.log('═══════════════════════════════════════════════════════════════════════════════\n');

  for (const c of checks) {
    try {
      const { rows } = await db.query(c.sql);
      const r = rows[0];
      // pretty-print depending on shape
      let val;
      if ('n' in r) val = r.n;
      else val = JSON.stringify(r);

      const flag = (typeof val === 'number' && val > 0) ? '⚠️ ' : '✓ ';
      console.log(`${flag} ${c.name}: ${val}`);
    } catch (e) {
      // Tables that might not exist — show error briefly
      console.log(`?  ${c.name}: error (${e.message.split('\n')[0]})`);
    }
  }
  console.log('\n═══════════════════════════════════════════════════════════════════════════════');
  console.log('Done. ⚠️  = needs investigation. ? = table/column missing.');
  console.log('═══════════════════════════════════════════════════════════════════════════════');
  await db.end?.();
  process.exit();
})();
