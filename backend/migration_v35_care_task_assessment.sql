-- migration_v35_care_task_assessment.sql
-- Extends client_task_templates with the weekly-assessment fields that come
-- off a MIDAS SHC Homemaking assessment: how often per week (x/wk), which
-- days / AM-PM the client prefers, and where the task was sourced from.
--
-- allotted_minutes (from v34) holds the per-task minutes (min/task).
-- mins/week is intentionally NOT stored — it is always weekly_frequency
-- * allotted_minutes, derived on read and used for MIDAS reconciliation.

ALTER TABLE client_task_templates
  ADD COLUMN IF NOT EXISTS weekly_frequency INTEGER DEFAULT 1;

ALTER TABLE client_task_templates
  ADD COLUMN IF NOT EXISTS days_of_week TEXT;          -- e.g. 'Mon,Wed,Fri' or 'Daily' (free text, optional)

ALTER TABLE client_task_templates
  ADD COLUMN IF NOT EXISTS time_of_day VARCHAR(10) DEFAULT 'any';  -- 'AM' | 'PM' | 'any'

ALTER TABLE client_task_templates
  ADD COLUMN IF NOT EXISTS assessment_source VARCHAR(60);  -- e.g. 'midas_shc_homemaking'

-- Backfill existing Phase 1 rows to a sane default (1x/week, any time).
UPDATE client_task_templates
  SET weekly_frequency = 1
  WHERE weekly_frequency IS NULL;
