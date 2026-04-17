-- migration_v26_cleanup_zero_duration_shifts.sql
-- Run with: psql $DATABASE_URL -f migration_v26_cleanup_zero_duration_shifts.sql
--
-- Background: before the clock-in idempotency fix, double-tapped /clock-in
-- requests caused the prior open entry to be auto-closed with end_time ≈
-- start_time, leaving zero-duration "Complete" rows in time_entries. Those
-- rows skew hour totals, payroll, and the Shifts tab.
--
-- This migration:
--   1) Audits rows that will be affected (SELECT output for sanity check).
--   2) Deletes any associated gps_tracking rows (FK safety).
--   3) Deletes complete time_entries with duration < 30 seconds.
--
-- Threshold is 30s to catch the double-tap/rapid-retry pattern while
-- preserving legitimately short visits (anything > 30s is kept).

BEGIN;

-- 1. Preview what will be deleted (no changes yet)
SELECT
  te.id,
  te.caregiver_id,
  te.client_id,
  te.start_time,
  te.end_time,
  EXTRACT(EPOCH FROM (te.end_time - te.start_time)) AS duration_seconds,
  te.duration_minutes
FROM time_entries te
WHERE te.is_complete = true
  AND te.end_time IS NOT NULL
  AND EXTRACT(EPOCH FROM (te.end_time - te.start_time)) < 30
ORDER BY te.start_time DESC;

-- 2. Clean up dependent rows in gps_tracking
DELETE FROM gps_tracking
WHERE time_entry_id IN (
  SELECT id FROM time_entries
  WHERE is_complete = true
    AND end_time IS NOT NULL
    AND EXTRACT(EPOCH FROM (end_time - start_time)) < 30
);

-- 3. Delete the zero/near-zero duration shifts
DELETE FROM time_entries
WHERE is_complete = true
  AND end_time IS NOT NULL
  AND EXTRACT(EPOCH FROM (end_time - start_time)) < 30;

COMMIT;
