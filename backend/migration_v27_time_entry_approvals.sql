-- migration_v27_time_entry_approvals.sql
-- Run with: psql $DATABASE_URL -f migration_v27_time_entry_approvals.sql
--
-- Adds approval workflow to time_entries. Business rule:
--   - For Medicaid / non-private-pay clients, billable_minutes MUST equal
--     the scheduled (allotted) minutes. Actual clock-in/out can differ
--     but pay does not.
--   - For private pay clients, billable_minutes = actual duration (open).
--   - Any unscheduled visit OR variance > 7 min between actual and
--     scheduled is flagged for admin approval.

ALTER TABLE time_entries
  ADD COLUMN IF NOT EXISTS needs_approval BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS approval_reason TEXT,
  ADD COLUMN IF NOT EXISTS approved_by UUID REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS approved_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS approved_billable_minutes INTEGER,
  ADD COLUMN IF NOT EXISTS approval_notes TEXT;

CREATE INDEX IF NOT EXISTS idx_time_entries_needs_approval
  ON time_entries(needs_approval) WHERE needs_approval = true;
