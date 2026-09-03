-- migration_v62_billing_schedule.sql
-- Per-client automatic invoice cadence ("Create Due Invoices" button).
-- ADDITIVE ONLY: two new columns on clients, backfilled from existing invoices.

-- How often this client gets invoiced, in weeks (1, 2, 4...). NULL = not
-- auto-billed (generate manually with dates, as before).
ALTER TABLE clients
  ADD COLUMN IF NOT EXISTS billing_frequency_weeks INTEGER
    CHECK (billing_frequency_weeks IS NULL OR billing_frequency_weeks BETWEEN 1 AND 8),
  ADD COLUMN IF NOT EXISTS billed_through DATE;

-- Anchor: the last day already covered by an invoice. Auto-generation resumes
-- the day after and never regenerates covered ground.
-- The dob guard on both UPDATEs: clients_dob_not_future is NOT VALID, so any
-- row with a bad stored DOB rejects ALL updates until the DOB is fixed
-- (Dorothy Zwiefelhofer, dob typo'd as 2026). Skip such rows rather than fail
-- the whole migration; they join auto-billing once their DOB is corrected.
UPDATE clients c SET billed_through = i.max_end
  FROM (SELECT client_id, MAX(billing_period_end)::date AS max_end
          FROM invoices GROUP BY client_id) i
 WHERE i.client_id = c.id AND c.billed_through IS NULL
   AND (c.date_of_birth IS NULL OR c.date_of_birth <= CURRENT_DATE);

-- Default cadence: every 2 weeks, ONLY for clients who already get invoices
-- (owner-stated default 2026-09-08: "we just do two week period for each
-- client"). Everyone else stays NULL until a cadence is picked in Billing.
UPDATE clients c SET billing_frequency_weeks = 2
 WHERE c.billing_frequency_weeks IS NULL
   AND COALESCE(c.status, 'active') = 'active'
   AND (c.date_of_birth IS NULL OR c.date_of_birth <= CURRENT_DATE)
   AND EXISTS (SELECT 1 FROM invoices i WHERE i.client_id = c.id);
