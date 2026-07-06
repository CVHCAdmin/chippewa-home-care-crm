-- migration_v53: prevent duplicate ACTIVE recurring schedules at the DB level.
--
-- A recurring shift is uniquely identified by
-- (caregiver_id, client_id, day_of_week, start_time, end_time). Two active,
-- not-yet-ended rows for the same tuple are an accidental duplicate (a double
-- add / retry / re-applied optimizer proposal). This partial UNIQUE index makes
-- the database reject the second one, so NO create path — the scheduling UI,
-- the drag-drop grid, care-plan generation, or the optimizer — can produce a
-- duplicate, including under races or network retries.
--
-- Scoped to `end_date IS NULL` on purpose: deleting a recurring shift ENDS it by
-- setting end_date (while keeping is_active = true so past occurrences stay
-- billable). An ended pattern therefore leaves this index, so the exact same
-- shift can be re-added later without a false "duplicate" collision.
--
-- Split shifts are unaffected: their two segments have different start/end times,
-- so they never collide with each other.

CREATE UNIQUE INDEX IF NOT EXISTS uniq_active_recurring_schedule
  ON schedules (caregiver_id, client_id, day_of_week, start_time, end_time)
  WHERE is_active = true AND day_of_week IS NOT NULL AND end_date IS NULL;
