-- Migration v20: Schedule exceptions + end_date for recurring patterns
-- Enables per-occurrence cancel/modify without destroying the recurring pattern

-- 1. Add end_date to schedules so recurring patterns can have a termination date
ALTER TABLE schedules ADD COLUMN IF NOT EXISTS end_date DATE;

-- 2. Schedule exceptions table — stores per-occurrence overrides
CREATE TABLE IF NOT EXISTS schedule_exceptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  schedule_id UUID NOT NULL REFERENCES schedules(id) ON DELETE CASCADE,
  exception_date DATE NOT NULL,
  exception_type VARCHAR(20) NOT NULL CHECK (exception_type IN ('cancelled', 'modified')),
  -- Override fields (only used when exception_type = 'modified')
  override_start_time TIME,
  override_end_time TIME,
  override_caregiver_id UUID REFERENCES users(id),
  override_client_id UUID REFERENCES clients(id),
  override_notes TEXT,
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  -- Prevent duplicate exceptions for same schedule+date
  UNIQUE(schedule_id, exception_date)
);

CREATE INDEX IF NOT EXISTS idx_schedule_exceptions_schedule ON schedule_exceptions(schedule_id);
CREATE INDEX IF NOT EXISTS idx_schedule_exceptions_date ON schedule_exceptions(exception_date);
