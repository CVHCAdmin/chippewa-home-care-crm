-- migration_v5.sql: Schedule linking, allotted hours, payroll discrepancy tracking

ALTER TABLE time_entries
  ADD COLUMN IF NOT EXISTS schedule_id UUID REFERENCES schedules(id),
  ADD COLUMN IF NOT EXISTS allotted_minutes INTEGER,
  ADD COLUMN IF NOT EXISTS billable_minutes INTEGER,
  ADD COLUMN IF NOT EXISTS discrepancy_minutes INTEGER;

CREATE INDEX IF NOT EXISTS idx_time_entries_schedule ON time_entries(schedule_id);
CREATE INDEX IF NOT EXISTS idx_time_entries_discrepancy ON time_entries(discrepancy_minutes) WHERE discrepancy_minutes IS NOT NULL;

-- Backfill billable_minutes for existing completed entries (assume billable = actual)
UPDATE time_entries SET billable_minutes = duration_minutes WHERE is_complete = true AND billable_minutes IS NULL;

