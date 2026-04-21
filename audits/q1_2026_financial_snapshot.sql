-- ============================================================================
-- Q1 2026 Financial Snapshot — Chippewa Valley Home Care (CVHC tenant DB)
-- ----------------------------------------------------------------------------
-- READ-ONLY. No INSERT/UPDATE/DELETE/ALTER. Safe to run repeatedly.
--
-- Run against the CVHC tenant database (the same one backend/src/db.js
-- connects to via DATABASE_URL). Each section prints one result set; run the
-- whole file via `psql "$DATABASE_URL" -f q1_2026_financial_snapshot.sql`
-- or paste sections into a SQL client.
--
-- Period: 2026-01-01 .. 2026-03-31 inclusive.
-- Payer focus: Molina Healthcare of Wisconsin + My Choice Wisconsin.
--   Adjust the name LIKE list in section 0 if the negotiation scope changes.
--
-- NULL handling: every aggregation wraps in COALESCE(...,0). Sections whose
-- source tables are empty return zero rows with a header, not an error.
-- ============================================================================

-- Section 0 — Parameters (edit dates or payer list here) ---------------------
WITH params AS (
  SELECT DATE '2026-01-01' AS q1_start,
         DATE '2026-03-31' AS q1_end,
         ARRAY['molina','my choice']::text[] AS payer_name_fragments
)
SELECT * FROM params;

-- ============================================================================
-- Section 1 — DATA AVAILABILITY SANITY CHECK
-- Are the tables the rest of this script queries even populated for Q1?
-- If a row shows q1_rows = 0, downstream sections will be empty too.
-- ============================================================================
SELECT 'claims'                 AS table_name, COUNT(*) AS total_rows,
       COUNT(*) FILTER (WHERE service_date BETWEEN '2026-01-01' AND '2026-03-31') AS q1_rows
  FROM claims
UNION ALL SELECT 'evv_visits', COUNT(*),
       COUNT(*) FILTER (WHERE service_date BETWEEN '2026-01-01' AND '2026-03-31') FROM evv_visits
UNION ALL SELECT 'time_entries', COUNT(*),
       COUNT(*) FILTER (WHERE start_time::date BETWEEN '2026-01-01' AND '2026-03-31') FROM time_entries
UNION ALL SELECT 'schedules', COUNT(*), NULL FROM schedules
UNION ALL SELECT 'payroll_shift_reviews', COUNT(*),
       COUNT(*) FILTER (WHERE shift_date BETWEEN '2026-01-01' AND '2026-03-31') FROM payroll_shift_reviews
UNION ALL SELECT 'payments', COUNT(*),
       COUNT(*) FILTER (WHERE payment_date BETWEEN '2026-01-01' AND '2026-03-31') FROM payments
UNION ALL SELECT 'remittance_line_items', COUNT(*),
       COUNT(*) FILTER (WHERE created_at::date BETWEEN '2026-01-01' AND '2026-03-31') FROM remittance_line_items
UNION ALL SELECT 'authorizations', COUNT(*),
       COUNT(*) FILTER (WHERE end_date >= '2026-01-01' AND start_date <= '2026-03-31') FROM authorizations
UNION ALL SELECT 'mileage', COUNT(*),
       COUNT(*) FILTER (WHERE date BETWEEN '2026-01-01' AND '2026-03-31') FROM mileage
UNION ALL SELECT 'expenses', COUNT(*),
       COUNT(*) FILTER (WHERE expense_date BETWEEN '2026-01-01' AND '2026-03-31') FROM expenses
UNION ALL SELECT 'invoices', COUNT(*),
       COUNT(*) FILTER (WHERE billing_period_start <= '2026-03-31' AND billing_period_end >= '2026-01-01') FROM invoices
UNION ALL SELECT 'referral_source_rates', COUNT(*), NULL FROM referral_source_rates
ORDER BY table_name;

-- ============================================================================
-- Section 2 — PAYER REGISTRY
-- Which referral_sources rows will we treat as "Molina / My Choice"?
-- ============================================================================
SELECT id, name, payer_type, edi_payer_id, is_active_payer, submission_method,
       expected_pay_days
  FROM referral_sources
 WHERE LOWER(name) LIKE '%molina%'
    OR LOWER(name) LIKE '%my choice%'
 ORDER BY name;

-- ============================================================================
-- Section 3 — MEMBER ROSTER (Molina / My Choice clients)
-- Three identification paths; UNION shows how each path resolves.
-- ============================================================================
-- 3a. Via authorizations.payer_id (most reliable for billable members)
SELECT DISTINCT
       c.id            AS client_id,
       c.first_name || ' ' || c.last_name AS client_name,
       c.zip,
       rs.name         AS payer_name,
       rs.payer_type,
       'via_authorization' AS match_path
  FROM clients c
  JOIN authorizations a ON a.client_id = c.id
  JOIN referral_sources rs ON rs.id = a.payer_id
 WHERE (LOWER(rs.name) LIKE '%molina%' OR LOWER(rs.name) LIKE '%my choice%')
   AND a.start_date <= DATE '2026-03-31'
   AND (a.end_date  IS NULL OR a.end_date >= DATE '2026-01-01')
UNION
-- 3b. Via clients.referral_source_id (client was referred by the payer)
SELECT DISTINCT c.id, c.first_name||' '||c.last_name, c.zip,
       rs.name, rs.payer_type, 'via_referral_source'
  FROM clients c
  JOIN referral_sources rs ON rs.id = c.referral_source_id
 WHERE (LOWER(rs.name) LIKE '%molina%' OR LOWER(rs.name) LIKE '%my choice%')
UNION
-- 3c. Via free-text insurance_provider (legacy / manual entry)
SELECT DISTINCT c.id, c.first_name||' '||c.last_name, c.zip,
       c.insurance_provider, NULL, 'via_insurance_provider_text'
  FROM clients c
 WHERE LOWER(COALESCE(c.insurance_provider,'')) LIKE '%molina%'
    OR LOWER(COALESCE(c.insurance_provider,'')) LIKE '%my choice%'
 ORDER BY client_name, match_path;

-- ============================================================================
-- Section 4 — COUNT OF ACTIVE Q1 MEMBERS (data point 11)
-- "Active" = had at least one scheduled or completed visit in Q1.
-- ============================================================================
WITH molina_clients AS (
  SELECT DISTINCT c.id
    FROM clients c
    LEFT JOIN authorizations a ON a.client_id = c.id
    LEFT JOIN referral_sources rs_a ON rs_a.id = a.payer_id
    LEFT JOIN referral_sources rs_r ON rs_r.id = c.referral_source_id
   WHERE LOWER(COALESCE(rs_a.name,'')) LIKE '%molina%'
      OR LOWER(COALESCE(rs_a.name,'')) LIKE '%my choice%'
      OR LOWER(COALESCE(rs_r.name,'')) LIKE '%molina%'
      OR LOWER(COALESCE(rs_r.name,'')) LIKE '%my choice%'
      OR LOWER(COALESCE(c.insurance_provider,'')) LIKE '%molina%'
      OR LOWER(COALESCE(c.insurance_provider,'')) LIKE '%my choice%'
)
SELECT
  COUNT(DISTINCT mc.id)                            AS molina_members_total,
  COUNT(DISTINCT te.client_id)                     AS members_with_q1_visit,
  COUNT(DISTINCT CASE WHEN c.zip IN ('54768','54726','54771') THEN c.id END)
                                                   AS members_in_stanley_boyd_thorp
FROM molina_clients mc
LEFT JOIN clients c      ON c.id = mc.id
LEFT JOIN time_entries te ON te.client_id = mc.id
     AND te.start_time::date BETWEEN '2026-01-01' AND '2026-03-31';

-- ============================================================================
-- Section 5 — REVENUE SIDE: CLAIMS SUBMITTED (data points 1–5)
-- Honest reality: claims only exist if the EVV→claim pipeline ran. If
-- Section 1 showed 0 rows in claims, Alexis's Q1 revenue was manually billed
-- through Midas/ForwardHealth portals and is NOT in this DB.
-- ============================================================================
-- 5a. Claim counts and dollars by service code (Molina / My Choice only)
SELECT
  cl.procedure_code,
  COUNT(*)                                          AS claims_count,
  COALESCE(SUM(cl.units_billed), 0)                 AS total_units,
  COALESCE(SUM(cl.units_billed) / 4.0, 0)           AS approx_hours_if_15min_units,
  COALESCE(SUM(cl.charge_amount), 0)                AS billed_usd,
  COALESCE(SUM(cl.paid_amount), 0)                  AS paid_usd,
  COUNT(*) FILTER (WHERE cl.status = 'paid')        AS paid_claims,
  COUNT(*) FILTER (WHERE cl.status = 'denied')      AS denied_claims,
  COUNT(*) FILTER (WHERE cl.status IN ('pending','submitted','accepted'))
                                                    AS in_flight_claims
FROM claims cl
JOIN referral_sources rs ON rs.id = cl.payer_id
WHERE cl.service_date BETWEEN '2026-01-01' AND '2026-03-31'
  AND (LOWER(rs.name) LIKE '%molina%' OR LOWER(rs.name) LIKE '%my choice%')
GROUP BY cl.procedure_code
ORDER BY billed_usd DESC;

-- 5b. Q1 claims paid, by date paid (cash basis)
SELECT
  DATE_TRUNC('month', cl.paid_date)::date AS paid_month,
  rs.name                                 AS payer,
  COUNT(*)                                AS claims_paid,
  COALESCE(SUM(cl.paid_amount), 0)        AS paid_usd
FROM claims cl
JOIN referral_sources rs ON rs.id = cl.payer_id
WHERE cl.paid_date BETWEEN '2026-01-01' AND '2026-03-31'
  AND (LOWER(rs.name) LIKE '%molina%' OR LOWER(rs.name) LIKE '%my choice%')
GROUP BY 1, rs.name
ORDER BY 1, rs.name;

-- 5c. Denied / pending claims (dollars at risk)
SELECT
  cl.status,
  cl.denial_code,
  dcl.description                         AS denial_description,
  COUNT(*)                                AS claim_count,
  COALESCE(SUM(cl.charge_amount), 0)      AS dollars_at_risk
FROM claims cl
JOIN referral_sources rs ON rs.id = cl.payer_id
LEFT JOIN denial_code_lookup dcl ON dcl.code = cl.denial_code
WHERE cl.service_date BETWEEN '2026-01-01' AND '2026-03-31'
  AND (LOWER(rs.name) LIKE '%molina%' OR LOWER(rs.name) LIKE '%my choice%')
  AND cl.status IN ('denied','pending','submitted','draft')
GROUP BY cl.status, cl.denial_code, dcl.description
ORDER BY dollars_at_risk DESC;

-- 5d. Current Molina/MyChoice fee schedule on file (data point 4)
SELECT rs.name           AS payer,
       rsr.rate_amount   AS rate_per_unit,
       rsr.rate_type,
       rsr.effective_date,
       rsr.end_date,
       rsr.is_active
FROM referral_source_rates rsr
JOIN referral_sources rs ON rs.id = rsr.referral_source_id
WHERE LOWER(rs.name) LIKE '%molina%' OR LOWER(rs.name) LIKE '%my choice%'
ORDER BY rs.name, rsr.effective_date DESC;

-- NOTE on data point 4: the rates table is a single rate_amount per
-- referral_source row with no service_code column (see migration_v11:37,
-- rate_type is just 'hourly' or similar — not a CPT code). A per-service-code
-- fee schedule (S5125 vs S5130 vs S5135) is NOT modelled in this DB.
-- service_codes.rate_per_unit exists but is a global fallback, not payer-
-- specific. Treat this as a GAP.

-- ============================================================================
-- Section 6 — SERVICE HOURS DELIVERED (data point 1, from the supply side)
-- Derived from time_entries (actual clock in/out) because claims may not
-- exist. Split by Molina vs all other clients.
-- ============================================================================
-- 6a. Actual clocked hours Q1, Molina/MyChoice members only
WITH molina_clients AS (
  SELECT DISTINCT c.id
    FROM clients c
    LEFT JOIN authorizations a ON a.client_id = c.id
    LEFT JOIN referral_sources rs_a ON rs_a.id = a.payer_id
    LEFT JOIN referral_sources rs_r ON rs_r.id = c.referral_source_id
   WHERE LOWER(COALESCE(rs_a.name,'')) LIKE '%molina%'
      OR LOWER(COALESCE(rs_a.name,'')) LIKE '%my choice%'
      OR LOWER(COALESCE(rs_r.name,'')) LIKE '%molina%'
      OR LOWER(COALESCE(rs_r.name,'')) LIKE '%my choice%'
      OR LOWER(COALESCE(c.insurance_provider,'')) LIKE '%molina%'
      OR LOWER(COALESCE(c.insurance_provider,'')) LIKE '%my choice%'
)
SELECT
  COUNT(*)                                                       AS visits_clocked,
  COALESCE(SUM(te.duration_minutes), 0) / 60.0                   AS actual_hours,
  COALESCE(SUM(COALESCE(te.approved_billable_minutes,
                        te.billable_minutes,
                        te.duration_minutes)), 0) / 60.0         AS billable_hours,
  COUNT(DISTINCT te.client_id)                                   AS distinct_members,
  COUNT(DISTINCT te.caregiver_id)                                AS distinct_caregivers
FROM time_entries te
JOIN molina_clients mc ON mc.id = te.client_id
WHERE te.start_time::date BETWEEN '2026-01-01' AND '2026-03-31'
  AND te.is_complete = true;

-- 6b. By authorization service_code (the code that WOULD bill, if claim ran)
WITH molina_clients AS (
  SELECT DISTINCT c.id FROM clients c
   LEFT JOIN authorizations a ON a.client_id = c.id
   LEFT JOIN referral_sources rs_a ON rs_a.id = a.payer_id
   LEFT JOIN referral_sources rs_r ON rs_r.id = c.referral_source_id
   WHERE LOWER(COALESCE(rs_a.name,'')) LIKE '%molina%'
      OR LOWER(COALESCE(rs_a.name,'')) LIKE '%my choice%'
      OR LOWER(COALESCE(rs_r.name,'')) LIKE '%molina%'
      OR LOWER(COALESCE(rs_r.name,'')) LIKE '%my choice%'
)
SELECT
  a.procedure_code,
  COUNT(DISTINCT te.id)                                          AS visits,
  COALESCE(SUM(te.duration_minutes),0) / 60.0                    AS actual_hours,
  COALESCE(SUM(COALESCE(te.approved_billable_minutes,
                        te.billable_minutes,
                        te.duration_minutes)),0) / 60.0          AS billable_hours
FROM time_entries te
JOIN molina_clients mc ON mc.id = te.client_id
LEFT JOIN authorizations a
       ON a.client_id = te.client_id
      AND te.start_time::date BETWEEN a.start_date
                                  AND COALESCE(a.end_date, DATE '9999-12-31')
WHERE te.start_time::date BETWEEN '2026-01-01' AND '2026-03-31'
  AND te.is_complete = true
GROUP BY a.procedure_code
ORDER BY actual_hours DESC;

-- ============================================================================
-- Section 7 — SCHEDULED vs COMPLETED (data point 14 show-up rate)
-- Recurring schedules store day_of_week with date=NULL; must enumerate
-- occurrences between Q1 dates. One-off schedules have date populated.
-- ============================================================================
WITH cal AS (
  SELECT generate_series(DATE '2026-01-01', DATE '2026-03-31', INTERVAL '1 day')::date AS d
),
molina_clients AS (
  SELECT DISTINCT c.id FROM clients c
   LEFT JOIN authorizations a ON a.client_id = c.id
   LEFT JOIN referral_sources rs_a ON rs_a.id = a.payer_id
   LEFT JOIN referral_sources rs_r ON rs_r.id = c.referral_source_id
   WHERE LOWER(COALESCE(rs_a.name,'')) LIKE '%molina%'
      OR LOWER(COALESCE(rs_a.name,'')) LIKE '%my choice%'
      OR LOWER(COALESCE(rs_r.name,'')) LIKE '%molina%'
      OR LOWER(COALESCE(rs_r.name,'')) LIKE '%my choice%'
),
expected AS (
  -- one-off schedules dated inside Q1
  SELECT s.id AS schedule_id, s.client_id, s.caregiver_id, s.date AS occurrence_date,
         EXTRACT(EPOCH FROM (s.end_time - s.start_time))/3600.0 AS planned_hours
    FROM schedules s
   WHERE s.is_active = true
     AND s.date BETWEEN '2026-01-01' AND '2026-03-31'
  UNION ALL
  -- recurring schedules: expand by day_of_week across Q1
  SELECT s.id, s.client_id, s.caregiver_id, cal.d,
         EXTRACT(EPOCH FROM (s.end_time - s.start_time))/3600.0
    FROM schedules s
   CROSS JOIN cal
   WHERE s.is_active = true
     AND s.date IS NULL
     AND s.day_of_week = EXTRACT(DOW FROM cal.d)::int
     AND cal.d >= COALESCE(s.effective_date, '2026-01-01')
     AND cal.d <= COALESCE(s.end_date,       '2026-03-31')
)
SELECT
  CASE WHEN mc.id IS NULL THEN 'other_clients' ELSE 'molina_mychoice' END AS segment,
  COUNT(*)                                         AS expected_visits,
  COALESCE(SUM(e.planned_hours),0)                 AS planned_hours,
  COUNT(te.id)                                     AS completed_visits,
  COALESCE(SUM(te.duration_minutes),0)/60.0        AS actual_hours,
  CASE WHEN COUNT(*) = 0 THEN NULL
       ELSE ROUND(100.0 * COUNT(te.id) / COUNT(*), 1)
  END                                              AS show_up_rate_pct
FROM expected e
LEFT JOIN molina_clients mc ON mc.id = e.client_id
LEFT JOIN time_entries te
       ON te.client_id = e.client_id
      AND te.caregiver_id = e.caregiver_id
      AND te.start_time::date = e.occurrence_date
      AND te.is_complete = true
GROUP BY 1
ORDER BY 1;

-- ============================================================================
-- Section 8 — COST SIDE: CAREGIVER WAGES (data point 6)
-- Rate hierarchy: client_assignments.pay_rate -> users.hourly_rate
--                                             -> users.default_pay_rate
-- Hours source: COALESCE(approved_billable_minutes, billable_minutes,
--                        duration_minutes) to respect v27 approval rule.
-- ============================================================================
WITH molina_clients AS (
  SELECT DISTINCT c.id FROM clients c
   LEFT JOIN authorizations a ON a.client_id = c.id
   LEFT JOIN referral_sources rs_a ON rs_a.id = a.payer_id
   LEFT JOIN referral_sources rs_r ON rs_r.id = c.referral_source_id
   WHERE LOWER(COALESCE(rs_a.name,'')) LIKE '%molina%'
      OR LOWER(COALESCE(rs_a.name,'')) LIKE '%my choice%'
      OR LOWER(COALESCE(rs_r.name,'')) LIKE '%molina%'
      OR LOWER(COALESCE(rs_r.name,'')) LIKE '%my choice%'
)
SELECT
  COUNT(*)                                                         AS visits,
  COALESCE(SUM(COALESCE(te.approved_billable_minutes,
                        te.billable_minutes,
                        te.duration_minutes)),0)/60.0              AS paid_hours,
  COALESCE(SUM(
    (COALESCE(te.approved_billable_minutes,
              te.billable_minutes,
              te.duration_minutes)/60.0)
    * COALESCE(ca.pay_rate, u.hourly_rate, u.default_pay_rate, 0)
  ),0)                                                             AS wages_usd,
  COALESCE(AVG(COALESCE(ca.pay_rate, u.hourly_rate, u.default_pay_rate)),0)
                                                                   AS avg_hourly_rate
FROM time_entries te
JOIN molina_clients mc ON mc.id = te.client_id
JOIN users u           ON u.id  = te.caregiver_id
LEFT JOIN client_assignments ca
       ON ca.client_id = te.client_id
      AND ca.caregiver_id = te.caregiver_id
      AND ca.status = 'active'
WHERE te.start_time::date BETWEEN '2026-01-01' AND '2026-03-31'
  AND te.is_complete = true;

-- ============================================================================
-- Section 9 — MILEAGE (data point 7)
-- No rate column exists on the mileage table. Total miles only; apply
-- reimbursement rate externally (IRS 2026 rate or agency policy).
-- ============================================================================
WITH molina_caregivers AS (
  SELECT DISTINCT te.caregiver_id
    FROM time_entries te
    JOIN clients c ON c.id = te.client_id
    LEFT JOIN authorizations a ON a.client_id = c.id
    LEFT JOIN referral_sources rs_a ON rs_a.id = a.payer_id
    LEFT JOIN referral_sources rs_r ON rs_r.id = c.referral_source_id
   WHERE te.start_time::date BETWEEN '2026-01-01' AND '2026-03-31'
     AND (LOWER(COALESCE(rs_a.name,'')) LIKE '%molina%'
       OR LOWER(COALESCE(rs_a.name,'')) LIKE '%my choice%'
       OR LOWER(COALESCE(rs_r.name,'')) LIKE '%molina%'
       OR LOWER(COALESCE(rs_r.name,'')) LIKE '%my choice%')
)
SELECT
  COUNT(*)                    AS mileage_entries,
  COALESCE(SUM(m.miles),0)    AS total_miles,
  COUNT(DISTINCT m.caregiver_id) AS caregivers_with_mileage
FROM mileage m
WHERE m.date BETWEEN '2026-01-01' AND '2026-03-31'
  AND m.caregiver_id IN (SELECT caregiver_id FROM molina_caregivers);

-- ============================================================================
-- Section 10 — AVG HOURS PER MEMBER PER WEEK (data point 13)
-- ============================================================================
WITH molina_clients AS (
  SELECT DISTINCT c.id FROM clients c
   LEFT JOIN authorizations a ON a.client_id = c.id
   LEFT JOIN referral_sources rs_a ON rs_a.id = a.payer_id
   LEFT JOIN referral_sources rs_r ON rs_r.id = c.referral_source_id
   WHERE LOWER(COALESCE(rs_a.name,'')) LIKE '%molina%'
      OR LOWER(COALESCE(rs_a.name,'')) LIKE '%my choice%'
      OR LOWER(COALESCE(rs_r.name,'')) LIKE '%molina%'
      OR LOWER(COALESCE(rs_r.name,'')) LIKE '%my choice%'
),
per_member AS (
  SELECT te.client_id,
         SUM(te.duration_minutes)/60.0 AS total_hours
    FROM time_entries te
    JOIN molina_clients mc ON mc.id = te.client_id
   WHERE te.start_time::date BETWEEN '2026-01-01' AND '2026-03-31'
     AND te.is_complete = true
   GROUP BY te.client_id
)
SELECT
  COUNT(*)                                              AS members_with_hours,
  COALESCE(AVG(total_hours),0)                          AS avg_q1_hours_per_member,
  COALESCE(AVG(total_hours) / 13.0, 0)                  AS avg_hours_per_week_per_member
FROM per_member;

-- ============================================================================
-- Section 11 — GEOGRAPHIC BREAKDOWN: Stanley / Boyd / Thorp (data point 12)
-- ZIPs: 54768 Stanley, 54726 Boyd, 54771 Thorp
-- Client zip is NULLABLE and often unpopulated — see gap analysis.
-- ============================================================================
WITH molina_clients AS (
  SELECT DISTINCT c.id, c.zip FROM clients c
   LEFT JOIN authorizations a ON a.client_id = c.id
   LEFT JOIN referral_sources rs_a ON rs_a.id = a.payer_id
   LEFT JOIN referral_sources rs_r ON rs_r.id = c.referral_source_id
   WHERE LOWER(COALESCE(rs_a.name,'')) LIKE '%molina%'
      OR LOWER(COALESCE(rs_a.name,'')) LIKE '%my choice%'
      OR LOWER(COALESCE(rs_r.name,'')) LIKE '%molina%'
      OR LOWER(COALESCE(rs_r.name,'')) LIKE '%my choice%'
)
SELECT
  CASE mc.zip
    WHEN '54768' THEN 'Stanley'
    WHEN '54726' THEN 'Boyd'
    WHEN '54771' THEN 'Thorp'
    WHEN NULL     THEN '(zip missing)'
    ELSE              'other'
  END                              AS town,
  mc.zip,
  COUNT(*)                         AS member_count,
  COALESCE(SUM(te_sum.hours),0)    AS q1_hours
FROM molina_clients mc
LEFT JOIN (
  SELECT client_id, SUM(duration_minutes)/60.0 AS hours
    FROM time_entries
   WHERE start_time::date BETWEEN '2026-01-01' AND '2026-03-31'
     AND is_complete = true
   GROUP BY client_id
) te_sum ON te_sum.client_id = mc.id
GROUP BY mc.zip
ORDER BY member_count DESC;

-- ============================================================================
-- Section 12 — AUTHORIZATION BURN-DOWN (context for negotiation)
-- How much authorized capacity is still on the table from Molina/MyChoice?
-- ============================================================================
SELECT
  rs.name                                         AS payer,
  a.procedure_code,
  COUNT(*)                                        AS active_auths,
  COALESCE(SUM(a.authorized_units), 0)            AS authorized_units_total,
  COALESCE(SUM(a.used_units), 0)                  AS used_units_total,
  COALESCE(SUM(a.authorized_units - COALESCE(a.used_units,0)), 0)
                                                  AS remaining_units
FROM authorizations a
JOIN referral_sources rs ON rs.id = a.payer_id
WHERE (LOWER(rs.name) LIKE '%molina%' OR LOWER(rs.name) LIKE '%my choice%')
  AND a.end_date   >= DATE '2026-01-01'
  AND a.start_date <= DATE '2026-03-31'
GROUP BY rs.name, a.procedure_code
ORDER BY remaining_units DESC;

-- ============================================================================
-- Section 13 — INVOICES SANITY (the UI "Revenue" source)
-- The Revenue Dashboard reads invoices.total, not claims. Document what's
-- actually in invoices for Q1 so the numbers reconcile.
-- ============================================================================
SELECT
  i.payment_status,
  COUNT(*)                                  AS invoice_count,
  COALESCE(SUM(i.total), 0)                 AS total_usd,
  COALESCE(SUM(CASE WHEN i.payment_date IS NOT NULL THEN i.total END), 0)
                                            AS paid_usd,
  MIN(i.billing_period_start)               AS earliest_period,
  MAX(i.billing_period_end)                 AS latest_period
FROM invoices i
WHERE i.billing_period_start <= '2026-03-31'
  AND i.billing_period_end   >= '2026-01-01'
GROUP BY i.payment_status
ORDER BY total_usd DESC;

-- ============================================================================
-- Section 14 — HEADLINE SUMMARY (one row: everything available at a glance)
-- Use this as the top-of-report number set for the Molina negotiation.
-- ============================================================================
WITH molina_clients AS (
  SELECT DISTINCT c.id, c.zip FROM clients c
   LEFT JOIN authorizations a ON a.client_id = c.id
   LEFT JOIN referral_sources rs_a ON rs_a.id = a.payer_id
   LEFT JOIN referral_sources rs_r ON rs_r.id = c.referral_source_id
   WHERE LOWER(COALESCE(rs_a.name,'')) LIKE '%molina%'
      OR LOWER(COALESCE(rs_a.name,'')) LIKE '%my choice%'
      OR LOWER(COALESCE(rs_r.name,'')) LIKE '%molina%'
      OR LOWER(COALESCE(rs_r.name,'')) LIKE '%my choice%'
),
hours AS (
  SELECT COUNT(*)                               AS visits,
         COALESCE(SUM(te.duration_minutes),0)/60.0
                                                AS actual_hours,
         COALESCE(SUM(
           (COALESCE(te.approved_billable_minutes,
                     te.billable_minutes,
                     te.duration_minutes)/60.0)
           * COALESCE(ca.pay_rate, u.hourly_rate, u.default_pay_rate, 0)
         ),0)                                   AS wages_usd
    FROM time_entries te
    JOIN molina_clients mc ON mc.id = te.client_id
    JOIN users u           ON u.id  = te.caregiver_id
    LEFT JOIN client_assignments ca
           ON ca.client_id = te.client_id
          AND ca.caregiver_id = te.caregiver_id
          AND ca.status = 'active'
   WHERE te.start_time::date BETWEEN '2026-01-01' AND '2026-03-31'
     AND te.is_complete = true
),
claims_rev AS (
  SELECT COALESCE(SUM(cl.charge_amount),0) AS billed_usd,
         COALESCE(SUM(cl.paid_amount),0)   AS paid_usd,
         COUNT(*) FILTER (WHERE cl.status='denied')            AS denied_claims,
         COALESCE(SUM(cl.charge_amount) FILTER (WHERE cl.status IN ('denied','pending','submitted')),0)
                                                               AS at_risk_usd
    FROM claims cl
    JOIN referral_sources rs ON rs.id = cl.payer_id
   WHERE cl.service_date BETWEEN '2026-01-01' AND '2026-03-31'
     AND (LOWER(rs.name) LIKE '%molina%' OR LOWER(rs.name) LIKE '%my choice%')
),
mileage_sum AS (
  SELECT COALESCE(SUM(m.miles),0) AS miles
    FROM mileage m
   WHERE m.date BETWEEN '2026-01-01' AND '2026-03-31'
     AND m.caregiver_id IN (
       SELECT DISTINCT te.caregiver_id FROM time_entries te
        JOIN molina_clients mc ON mc.id = te.client_id
       WHERE te.start_time::date BETWEEN '2026-01-01' AND '2026-03-31'
     )
)
SELECT
  (SELECT COUNT(*)              FROM molina_clients)                     AS molina_members,
  (SELECT COUNT(*)              FROM molina_clients WHERE zip IN ('54768','54726','54771'))
                                                                         AS members_stanley_boyd_thorp,
  (SELECT visits                FROM hours)                              AS visits_completed,
  (SELECT actual_hours          FROM hours)                              AS service_hours_delivered,
  (SELECT wages_usd             FROM hours)                              AS caregiver_wages_usd,
  (SELECT billed_usd            FROM claims_rev)                         AS claims_billed_usd,
  (SELECT paid_usd              FROM claims_rev)                         AS claims_paid_usd,
  (SELECT denied_claims         FROM claims_rev)                         AS claims_denied_count,
  (SELECT at_risk_usd           FROM claims_rev)                         AS dollars_at_risk_usd,
  (SELECT miles                 FROM mileage_sum)                        AS mileage_miles,
  -- Simple cost-per-hour (wages only; excludes mileage reimb, burden, overhead)
  CASE WHEN (SELECT actual_hours FROM hours) > 0
       THEN ROUND((SELECT wages_usd FROM hours)::numeric
                  / (SELECT actual_hours FROM hours)::numeric, 2)
       ELSE NULL
  END                                                                    AS wages_cost_per_hour_usd;

-- ============================================================================
-- END OF SNAPSHOT.
-- Cost-per-service-hour in section 14 is WAGES ONLY. To reach true fully-
-- loaded cost for negotiation, add outside the CRM:
--   + employer burden (FICA 7.65% + WC + WI UI) — NOT in DB
--   + mileage reimbursement dollars (miles * rate) — miles in DB, rate is not
--   + RN/supervisory time — NOT separated in DB
--   + overhead allocation                           — NOT in DB
-- See q1_2026_gap_analysis.md for the full list.
-- ============================================================================
