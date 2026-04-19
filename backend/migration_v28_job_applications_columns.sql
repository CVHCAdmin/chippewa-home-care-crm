-- migration_v28_job_applications_columns.sql
-- Run with: psql $DATABASE_URL -f migration_v28_job_applications_columns.sql
--
-- The public POST /api/applications endpoint was expanded (new website form)
-- but the job_applications table (from migration_v8) never got the new
-- columns. Every submission 500s with "column does not exist".
-- This migration adds the 21 missing columns so the INSERT succeeds.
-- All new columns are nullable since the form is not guaranteed to submit
-- every field.

ALTER TABLE job_applications
  ADD COLUMN IF NOT EXISTS has_drivers_license BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS has_transportation BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS legal_to_work BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS willing_background_check BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS cna_license VARCHAR(100),
  ADD COLUMN IF NOT EXISTS previous_employer TEXT,
  ADD COLUMN IF NOT EXISTS reason_for_leaving TEXT,
  ADD COLUMN IF NOT EXISTS availability_days TEXT,
  ADD COLUMN IF NOT EXISTS availability_shifts TEXT,
  ADD COLUMN IF NOT EXISTS hours_desired VARCHAR(100),
  ADD COLUMN IF NOT EXISTS earliest_start_date DATE,
  ADD COLUMN IF NOT EXISTS ref1_name VARCHAR(255),
  ADD COLUMN IF NOT EXISTS ref1_relationship VARCHAR(100),
  ADD COLUMN IF NOT EXISTS ref1_phone VARCHAR(20),
  ADD COLUMN IF NOT EXISTS ref1_email VARCHAR(255),
  ADD COLUMN IF NOT EXISTS ref2_name VARCHAR(255),
  ADD COLUMN IF NOT EXISTS ref2_relationship VARCHAR(100),
  ADD COLUMN IF NOT EXISTS ref2_phone VARCHAR(20),
  ADD COLUMN IF NOT EXISTS ref2_email VARCHAR(255),
  ADD COLUMN IF NOT EXISTS why_interested TEXT,
  ADD COLUMN IF NOT EXISTS additional_info TEXT;
