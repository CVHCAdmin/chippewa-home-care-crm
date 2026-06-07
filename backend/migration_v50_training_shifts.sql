-- Migration v50: Training shifts — non-billable schedule flag
--
-- Use case: when training a new caregiver, the trainee shadows an experienced
-- caregiver on the same shift. Both should be paid through payroll, but the
-- client should only be billed once. Marking the trainee's schedule as
-- is_training tells the billing engine to skip it for invoice generation.
-- Payroll's SCHEDULE_EXPANSION_CTE intentionally does NOT filter on this flag,
-- so the trainee still gets paid for the shadow shift.

BEGIN;

ALTER TABLE schedules
  ADD COLUMN IF NOT EXISTS is_training BOOLEAN NOT NULL DEFAULT false;

-- Partial index — only training shifts get indexed, keeps overhead trivial.
CREATE INDEX IF NOT EXISTS idx_schedules_is_training
  ON schedules(is_training)
  WHERE is_training = true;

COMMIT;
