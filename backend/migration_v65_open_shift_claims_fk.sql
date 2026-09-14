-- migration_v65_open_shift_claims_fk.sql
-- Repoint the open-shift claim foreign keys at users(id).
--
-- Production still carries legacy FKs from a pre-v8 schema (same drift v52 fixed on
-- background_checks):
--   open_shifts.claimed_by          -> caregiver_profiles(id)   (should be users.id)
--   open_shift_claims.caregiver_id  -> caregiver_profiles(id)   (should be users.id)
--
-- Caregivers live in users; caregiver_profiles links to them through its own
-- caregiver_id column, so no caregiver_profiles.id ever equals a user id. Every claim
-- (POST /api/open-shifts/:id/claim) and every admin assignment (smart-fill) has failed
-- with a foreign-key violation: open_shift_claims has never held a row and no open shift
-- has ever had claimed_by set. Verified 2026-09-14 in a rolled-back transaction.
-- Both columns are empty in production, so repointing validates nothing.

BEGIN;

ALTER TABLE open_shifts
  DROP CONSTRAINT IF EXISTS open_shifts_claimed_by_fkey;
ALTER TABLE open_shifts
  ADD CONSTRAINT open_shifts_claimed_by_fkey
  FOREIGN KEY (claimed_by) REFERENCES users(id) ON DELETE SET NULL;

ALTER TABLE open_shift_claims
  DROP CONSTRAINT IF EXISTS open_shift_claims_caregiver_id_fkey;
ALTER TABLE open_shift_claims
  ADD CONSTRAINT open_shift_claims_caregiver_id_fkey
  FOREIGN KEY (caregiver_id) REFERENCES users(id) ON DELETE CASCADE;

COMMIT;
