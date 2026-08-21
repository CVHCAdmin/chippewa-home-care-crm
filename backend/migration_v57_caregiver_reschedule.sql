-- migration_v57_caregiver_reschedule.sql
-- Caregiver-initiated reschedule requests.
--
-- visit_change_requests already carried client-originated cancel/reschedule
-- requests (v24). A caregiver asking to move one of their own shifts is the same
-- record with a different origin, so we tag the origin instead of building a
-- second table: one queue, one resolve endpoint, one place in the Schedule Hub.
--
--  requested_by         'client' (portal) or 'caregiver' (their phone). Existing
--                       rows are all portal rows, hence the default.
--  request_reason       why the caregiver needs the move. cancel_reason is named
--                       for the cancel flow; keeping them separate stops a
--                       reschedule reason showing up as a cancellation reason.
--  applied_schedule_id  the schedule row the approval actually landed on (the
--                       original row for a time-only change, or the new one-time
--                       row when the shift moved to another date). Without it an
--                       approved move leaves no trail back to the shift it made.

ALTER TABLE visit_change_requests
  ADD COLUMN IF NOT EXISTS requested_by VARCHAR(20) NOT NULL DEFAULT 'client',
  ADD COLUMN IF NOT EXISTS request_reason TEXT,
  ADD COLUMN IF NOT EXISTS applied_schedule_id UUID REFERENCES schedules(id);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'visit_change_requests'::regclass
       AND conname  = 'visit_change_requests_requested_by_check'
  ) THEN
    ALTER TABLE visit_change_requests
      ADD CONSTRAINT visit_change_requests_requested_by_check
      CHECK (requested_by IN ('client', 'caregiver', 'admin'));
  END IF;
END $$;

-- The Hub polls pending requests on every Staffing tab open.
CREATE INDEX IF NOT EXISTS idx_vcr_status_created
  ON visit_change_requests (status, created_at DESC);
