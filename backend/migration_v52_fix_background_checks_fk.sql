-- migration_v52: repoint background_checks foreign keys at the live tables.
--
-- The production background_checks table predates the v5/v8 migrations
-- (CREATE TABLE IF NOT EXISTS never touched it) and still carries FKs from a
-- legacy schema:
--   caregiver_id   -> caregiver_profiles(id)   (should be users.id)
--   application_id -> applications(id)         (should be job_applications.id)
--
-- Every INSERT from the onboarding WORCS flow has been failing with
-- "background_checks_caregiver_id_fkey" violations because hired caregivers
-- live in users, not caregiver_profiles. The table is empty in production,
-- so repointing is safe — there are no rows to validate.

BEGIN;

ALTER TABLE background_checks
  DROP CONSTRAINT IF EXISTS background_checks_caregiver_id_fkey;

ALTER TABLE background_checks
  ADD CONSTRAINT background_checks_caregiver_id_fkey
  FOREIGN KEY (caregiver_id) REFERENCES users(id) ON DELETE CASCADE;

ALTER TABLE background_checks
  DROP CONSTRAINT IF EXISTS background_checks_application_id_fkey;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'job_applications') THEN
    ALTER TABLE background_checks
      ADD CONSTRAINT background_checks_application_id_fkey
      FOREIGN KEY (application_id) REFERENCES job_applications(id) ON DELETE SET NULL;
  END IF;
END $$;

COMMIT;
