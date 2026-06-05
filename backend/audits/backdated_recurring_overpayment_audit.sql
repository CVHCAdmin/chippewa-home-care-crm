-- ─────────────────────────────────────────────────────────────────────────────
-- Back-dated recurring schedule audit
--
-- Finds every place the back-dating bug already cost money: payroll shift
-- reviews and invoice line items whose shift_date is BEFORE the recurring
-- schedule that produced them was actually entered into the system.
--
-- A row in any result set = a phantom visit. Use these to refund/clawback.
--
-- Run with:
--   psql $DATABASE_URL -f backend/audits/backdated_recurring_overpayment_audit.sql
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 1. Payroll shift reviews tied to back-dated recurring expansions ────────
--      (these are what got paid out to caregivers)
\echo '=== PAYROLL: shifts paid for dates BEFORE the schedule was entered ==='
SELECT
  psr.pay_period_start,
  psr.pay_period_end,
  psr.shift_date,
  s.created_at::date          AS schedule_entered_on,
  (s.created_at::date - psr.shift_date) AS days_backdated,
  u.first_name || ' ' || u.last_name AS caregiver,
  c.first_name || ' ' || c.last_name AS client,
  psr.payable_minutes,
  ROUND(psr.payable_minutes / 60.0, 2) AS payable_hours,
  psr.status,
  psr.schedule_id,
  psr.id AS shift_review_id
FROM payroll_shift_reviews psr
JOIN schedules s   ON psr.schedule_id = s.id
JOIN users u       ON psr.caregiver_id = u.id
LEFT JOIN clients c ON psr.client_id  = c.id
WHERE s.day_of_week IS NOT NULL                  -- recurring only
  AND psr.shift_date < s.created_at::date        -- phantom past visit
ORDER BY psr.shift_date DESC, caregiver;

-- ── 2. Summary by caregiver (total over-paid hours) ─────────────────────────
\echo ''
\echo '=== PAYROLL: total over-paid hours per caregiver ==='
SELECT
  u.first_name || ' ' || u.last_name AS caregiver,
  COUNT(*)                                                 AS phantom_shifts,
  ROUND(SUM(psr.payable_minutes) / 60.0, 2)                AS overpaid_hours,
  MIN(psr.shift_date)                                      AS earliest_phantom,
  MAX(psr.shift_date)                                      AS latest_phantom
FROM payroll_shift_reviews psr
JOIN schedules s ON psr.schedule_id = s.id
JOIN users u     ON psr.caregiver_id = u.id
WHERE s.day_of_week IS NOT NULL
  AND psr.shift_date < s.created_at::date
GROUP BY u.first_name, u.last_name
ORDER BY overpaid_hours DESC;

-- ── 3. Invoice line items billed from back-dated schedule expansions ────────
--      (these are what got billed to clients/payers)
--      Joins through time_entries when present; flags line items with no
--      time_entry (pure schedule-generated bills) as the most suspect.
\echo ''
\echo '=== BILLING: invoice line items for dates BEFORE the schedule existed ==='
SELECT
  i.invoice_number,
  i.billing_period_start,
  i.billing_period_end,
  DATE(te.start_time)          AS service_date,
  s.created_at::date           AS schedule_entered_on,
  (s.created_at::date - DATE(te.start_time)) AS days_backdated,
  ili.hours,
  ili.amount,
  i.payment_status,
  c.first_name || ' ' || c.last_name AS client,
  ili.id AS line_item_id
FROM invoice_line_items ili
JOIN invoices i       ON ili.invoice_id = i.id
JOIN clients c        ON i.client_id    = c.id
JOIN time_entries te  ON ili.time_entry_id = te.id
JOIN schedules s      ON te.schedule_id = s.id
WHERE s.day_of_week IS NOT NULL
  AND DATE(te.start_time) < s.created_at::date
ORDER BY i.billing_period_start DESC, client;

-- ── 4. Recurring schedules whose effective_date is missing (about to be
--      backfilled by migration v36, so this is your last chance to spot
--      anything weird before the backfill runs).
\echo ''
\echo '=== SCHEDULES: recurring rows with no effective_date (will backfill to created_at) ==='
SELECT
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
ORDER BY s.created_at DESC;
