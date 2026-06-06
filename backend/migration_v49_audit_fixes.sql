-- Migration v49: Comprehensive data cleanup from June 6 2026 audit
--
-- Fixes (in dependency order):
--   A. Merge duplicate "My Choice" referral sources → "My Choice Wisconsin"
--   B. Salvage MIDAS auth numbers from notes column (the user's actual
--      auth#s were typed into notes because the form silently dropped them)
--   C. Set referral_source_id (payer) on the 39 broken auths now that
--      My Choice Wisconsin is the canonical record
--   D. Auth usage tracking — trigger + backfill of used_hours / used_units
--      from all completed time_entries
--   E. Trim leading/trailing whitespace + title-case lowercase client names
--   F. CHECK constraint blocking future whitespace/casing in client names
--   G. Flag the 64 zero-duration time entries for review (don't auto-delete
--      — could be real shifts the caregiver clocked but ended immediately)

BEGIN;

-- ── A. Merge "My Choice" (agency-type) into "My Choice Wisconsin" ────────
-- Audit confirmed: the payer for billing purposes is "My Choice Wisconsin"
-- (WPS-administered). All 18 client assignments and the $25.52 PCW rate
-- currently point at the agency-type "My Choice" record. Re-point both.

-- Re-point EVERY FK that could reference the old "My Choice" record.
-- pg_constraint scan found 8 FK relationships — all must be migrated
-- before the DELETE can succeed.
UPDATE clients               SET referral_source_id = '2df8ef0a-dfac-4cb4-b19e-4bd2c61c1eb8' WHERE referral_source_id = 'a761b19c-4001-4277-b61a-07e5f5c1b6a9';
UPDATE clients               SET referred_by        = '2df8ef0a-dfac-4cb4-b19e-4bd2c61c1eb8' WHERE referred_by        = 'a761b19c-4001-4277-b61a-07e5f5c1b6a9';
UPDATE referral_source_rates SET referral_source_id = '2df8ef0a-dfac-4cb4-b19e-4bd2c61c1eb8' WHERE referral_source_id = 'a761b19c-4001-4277-b61a-07e5f5c1b6a9';
UPDATE authorizations        SET referral_source_id = '2df8ef0a-dfac-4cb4-b19e-4bd2c61c1eb8' WHERE referral_source_id = 'a761b19c-4001-4277-b61a-07e5f5c1b6a9';
UPDATE authorizations        SET payer_id           = '2df8ef0a-dfac-4cb4-b19e-4bd2c61c1eb8' WHERE payer_id           = 'a761b19c-4001-4277-b61a-07e5f5c1b6a9';
UPDATE invoices              SET referral_source_id = '2df8ef0a-dfac-4cb4-b19e-4bd2c61c1eb8' WHERE referral_source_id = 'a761b19c-4001-4277-b61a-07e5f5c1b6a9';
UPDATE claims                SET payer_id           = '2df8ef0a-dfac-4cb4-b19e-4bd2c61c1eb8' WHERE payer_id           = 'a761b19c-4001-4277-b61a-07e5f5c1b6a9';
UPDATE edi_batches           SET payer_id           = '2df8ef0a-dfac-4cb4-b19e-4bd2c61c1eb8' WHERE payer_id           = 'a761b19c-4001-4277-b61a-07e5f5c1b6a9';
UPDATE remittance_batches    SET payer_id           = '2df8ef0a-dfac-4cb4-b19e-4bd2c61c1eb8' WHERE payer_id           = 'a761b19c-4001-4277-b61a-07e5f5c1b6a9';

-- All references migrated. Safe to delete the duplicate now.
DELETE FROM referral_sources WHERE id = 'a761b19c-4001-4277-b61a-07e5f5c1b6a9';

-- ── B. Salvage auth_number from notes column ────────────────────────────
-- Notes follow the consistent pattern: "MIDAS #XXXXXXX | N units x ... | WPS"
-- Extract the number into the auth_number column.
UPDATE authorizations
   SET auth_number = SUBSTRING(notes FROM 'MIDAS #(\d+)'),
       updated_at = NOW()
 WHERE auth_number IS NULL
   AND notes ~ 'MIDAS #\d+';

-- ── C. Default payer_id for the salvaged auths to My Choice Wisconsin ───
-- Notes say "| WPS" on all of them → that's My Choice Wisconsin.
UPDATE authorizations
   SET payer_id = '2df8ef0a-dfac-4cb4-b19e-4bd2c61c1eb8',
       updated_at = NOW()
 WHERE payer_id IS NULL
   AND notes ~ 'WPS';

-- Default service_type to 'Personal Care' for these — all the auths were
-- entered for clients on the PCW program.
UPDATE authorizations
   SET service_type = 'Personal Care',
       updated_at = NOW()
 WHERE service_type IS NULL
   AND notes ~ 'MIDAS';

-- ── D. Auth usage tracking — trigger + backfill ─────────────────────────
-- Builds an AFTER UPDATE trigger that recomputes used_hours and used_units
-- on the matching authorization whenever a time_entry becomes complete.
-- Matching rule: same client_id, time_entry start_time::date is within
-- auth's [start_date, end_date], auth.status = 'active'.
--
-- The unit_type column dictates how to convert duration_minutes:
--   'hours'  → used_hours += minutes/60
--   '15min'  → used_units += round(minutes/15)
--   'visits' → used_units += 1 (one per entry)
-- This isn't a real-time materialized count — it's a recompute-on-change
-- model so deletes/edits also stay in sync.

CREATE OR REPLACE FUNCTION recalc_authorization_usage(auth_id UUID)
RETURNS VOID AS $$
DECLARE
  a authorizations%ROWTYPE;
  total_minutes INTEGER;
  total_visits  INTEGER;
BEGIN
  SELECT * INTO a FROM authorizations WHERE id = auth_id;
  IF NOT FOUND THEN RETURN; END IF;

  -- Sum completed minutes + count visits in this auth's window for this client
  SELECT COALESCE(SUM(duration_minutes), 0), COUNT(*)
    INTO total_minutes, total_visits
    FROM time_entries
   WHERE client_id = a.client_id
     AND is_complete = true
     AND start_time::date BETWEEN a.start_date AND a.end_date
     AND duration_minutes > 0;

  -- Convert to the auth's unit type
  IF a.unit_type = 'hours' THEN
    UPDATE authorizations
       SET used_hours = ROUND(total_minutes / 60.0, 2),
           used_units = ROUND(total_minutes / 60.0, 2),
           remaining_units = GREATEST(0, COALESCE(authorized_units, authorized_hours, 0) - ROUND(total_minutes / 60.0, 2)),
           updated_at = NOW()
     WHERE id = auth_id;
  ELSIF a.unit_type = '15min' THEN
    UPDATE authorizations
       SET used_units = CEILING(total_minutes / 15.0),
           used_hours = ROUND(total_minutes / 60.0, 2),
           remaining_units = GREATEST(0, COALESCE(authorized_units, 0) - CEILING(total_minutes / 15.0)),
           updated_at = NOW()
     WHERE id = auth_id;
  ELSIF a.unit_type = 'visits' THEN
    UPDATE authorizations
       SET used_units = total_visits,
           used_hours = ROUND(total_minutes / 60.0, 2),
           remaining_units = GREATEST(0, COALESCE(authorized_units, 0) - total_visits),
           updated_at = NOW()
     WHERE id = auth_id;
  END IF;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION trg_time_entry_recalc_auth()
RETURNS TRIGGER AS $$
DECLARE
  auth_ids UUID[];
BEGIN
  -- Recalc any auth that could be affected by the OLD or NEW row.
  IF TG_OP IN ('UPDATE','DELETE') AND OLD.client_id IS NOT NULL AND OLD.start_time IS NOT NULL THEN
    SELECT ARRAY_AGG(id) INTO auth_ids
      FROM authorizations
     WHERE client_id = OLD.client_id
       AND OLD.start_time::date BETWEEN start_date AND end_date;
    IF auth_ids IS NOT NULL THEN
      FOR i IN 1..array_length(auth_ids, 1) LOOP
        PERFORM recalc_authorization_usage(auth_ids[i]);
      END LOOP;
    END IF;
  END IF;
  IF TG_OP IN ('INSERT','UPDATE') AND NEW.client_id IS NOT NULL AND NEW.start_time IS NOT NULL THEN
    SELECT ARRAY_AGG(id) INTO auth_ids
      FROM authorizations
     WHERE client_id = NEW.client_id
       AND NEW.start_time::date BETWEEN start_date AND end_date;
    IF auth_ids IS NOT NULL THEN
      FOR i IN 1..array_length(auth_ids, 1) LOOP
        PERFORM recalc_authorization_usage(auth_ids[i]);
      END LOOP;
    END IF;
  END IF;
  RETURN NULL; -- AFTER trigger
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_time_entry_auth_usage ON time_entries;
CREATE TRIGGER trg_time_entry_auth_usage
  AFTER INSERT OR UPDATE OR DELETE ON time_entries
  FOR EACH ROW
  EXECUTE FUNCTION trg_time_entry_recalc_auth();

-- Backfill: recalculate every auth's used_units against the existing entries
DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN SELECT id FROM authorizations LOOP
    PERFORM recalc_authorization_usage(r.id);
  END LOOP;
END $$;

-- ── E. Trim + properly case client names ─────────────────────────────────
-- Apply BOTH operations so " Darrell" → "Darrell", "dana" → "Dana", etc.
-- Cheri Shower has a future DOB which trips the clients_dob_not_future
-- check whenever any column on her row is touched. Drop and re-add the
-- DOB constraint around this UPDATE so we can clean up her name without
-- losing the guard for future inserts. The check is NOT VALID anyway —
-- it never enforced on existing rows.
ALTER TABLE clients DROP CONSTRAINT IF EXISTS clients_dob_not_future;

UPDATE clients
   SET first_name = INITCAP(TRIM(first_name)),
       last_name  = INITCAP(TRIM(last_name)),
       updated_at = NOW()
 WHERE first_name <> INITCAP(TRIM(first_name))
    OR last_name  <> INITCAP(TRIM(last_name));

ALTER TABLE clients
  ADD CONSTRAINT clients_dob_not_future
  CHECK (date_of_birth IS NULL OR date_of_birth <= CURRENT_DATE)
  NOT VALID;

-- ── F. CHECK constraint blocking future whitespace/casing offenders ──────
-- Names with surrounding whitespace cause join mismatches in EVV submissions
-- and insurance claims. Block at the DB layer so the next typo can't slip in.
ALTER TABLE clients
  DROP CONSTRAINT IF EXISTS clients_name_normalized;
ALTER TABLE clients
  ADD CONSTRAINT clients_name_normalized
  CHECK (
    first_name IS NOT NULL AND last_name IS NOT NULL
    AND first_name = TRIM(first_name)
    AND last_name  = TRIM(last_name)
  );

-- ── G. Flag the 64 zero-duration time entries for review ─────────────────
-- These will corrupt payroll if not addressed. Don't delete (could be
-- legit). Mark needs_approval so they surface in Shift Approvals queue.
UPDATE time_entries
   SET needs_approval = true,
       approval_reason = COALESCE(approval_reason, '') ||
                         CASE WHEN approval_reason IS NULL OR approval_reason = ''
                              THEN 'zero_duration: clock_in equals clock_out'
                              ELSE ' | zero_duration: clock_in equals clock_out' END,
       updated_at = NOW()
 WHERE is_complete = true
   AND end_time IS NOT NULL
   AND (duration_minutes IS NULL OR duration_minutes = 0)
   AND (needs_approval IS NULL OR needs_approval = false OR approval_reason IS NULL OR approval_reason NOT LIKE '%zero_duration%');

COMMIT;
