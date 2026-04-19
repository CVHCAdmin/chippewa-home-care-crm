-- migration_v29_drop_application_email_unique.sql
-- Run with: psql $DATABASE_URL -f migration_v29_drop_application_email_unique.sql
--
-- The UNIQUE constraint on job_applications.email was blocking legitimate
-- re-applications (candidate updates info, family member shares email,
-- duplicate test submissions). Admin triages duplicates in the queue.
-- Keep the column indexed for lookup speed, just drop the uniqueness.

ALTER TABLE job_applications
  DROP CONSTRAINT IF EXISTS job_applications_email_key;

CREATE INDEX IF NOT EXISTS idx_job_applications_email
  ON job_applications(email);
