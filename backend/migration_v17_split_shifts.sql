-- Migration v17: Split Shift Support
-- Adds columns to link two shift segments as a single split shift

ALTER TABLE schedules ADD COLUMN IF NOT EXISTS is_split_shift BOOLEAN DEFAULT FALSE;
ALTER TABLE schedules ADD COLUMN IF NOT EXISTS split_shift_group_id UUID;
ALTER TABLE schedules ADD COLUMN IF NOT EXISTS split_segment INTEGER;

-- Index for quickly finding the partner segment of a split shift
CREATE INDEX IF NOT EXISTS idx_schedules_split_group ON schedules(split_shift_group_id) WHERE split_shift_group_id IS NOT NULL;

-- Constraint: split_segment must be 1 or 2 when set
ALTER TABLE schedules ADD CONSTRAINT chk_split_segment CHECK (split_segment IS NULL OR split_segment IN (1, 2));
