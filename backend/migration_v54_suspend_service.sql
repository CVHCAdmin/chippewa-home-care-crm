-- Migration v54: suspend service (reversible, per-schedule)
--
-- Lets a client's service — or one recurring shift — be PAUSED without deleting the
-- schedule. `suspended_from` is the date the pause starts:
--   * the occurrence expansion (helpers/scheduleOccurrences.js) skips any occurrence on
--     or after this date, so future visits stop generating — and because billing,
--     payroll, reminders and no-show all read that one engine, they all stop too;
--   * occurrences BEFORE this date (already-worked visits) still generate, so payroll
--     and history are untouched.
-- Resume = set it back to NULL. Nothing is destroyed, so the schedule returns exactly
-- as it was. NULL = active (the default for every existing and new row).

BEGIN;

ALTER TABLE schedules ADD COLUMN IF NOT EXISTS suspended_from DATE;

-- Partial index: the engine filters on this only for the (few) suspended rows.
CREATE INDEX IF NOT EXISTS idx_schedules_suspended_from
  ON schedules (suspended_from)
  WHERE suspended_from IS NOT NULL;

COMMIT;
