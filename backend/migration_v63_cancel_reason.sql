-- Migration v63: why was this occurrence cancelled?
--
-- A cancelled schedule_exception already removes the visit from billing, payroll,
-- reminders and no-show alerts (helpers/scheduleOccurrences.js). What it could not
-- say was WHY — a client who refused care, a client who was in the hospital, a
-- caregiver who called out and an office correction all looked identical, so the
-- billing review had no way to list "these days were not billed because the client
-- was unavailable".
--
-- Values (see emergencyRoutes.js CLIENT_UNAVAILABLE_REASONS):
--   client_refused    client_not_home    client_hospital    client_cancelled
--   caregiver_callout admin_cancelled    other
-- NULL = a legacy cancellation with no recorded reason.
ALTER TABLE schedule_exceptions ADD COLUMN IF NOT EXISTS cancel_reason VARCHAR(40);

CREATE INDEX IF NOT EXISTS idx_schedule_exceptions_cancel_reason
  ON schedule_exceptions (exception_date)
  WHERE exception_type = 'cancelled' AND cancel_reason IS NOT NULL;
