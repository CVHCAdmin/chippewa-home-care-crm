-- v56: at most ONE open time entry per caregiver, enforced by the database.
--
-- The clock-in endpoint checks for open entries before inserting, but two
-- concurrent submits of the same tap both pass that check and both insert —
-- on 2026-07-28 Patricia Wittmann's clock-in created two entries 1 millisecond
-- apart, and the twin billed Linda Wright's invoice a second time as an
-- "unscheduled" visit ($134.85). A sweep found 19 such twin pairs since
-- February; only that one was ever invoiced.
--
-- The code already treats "one open entry per caregiver" as an invariant (the
-- clock-in path auto-closes every open entry before inserting a new one), and
-- live data satisfies it (verified 2026-08-03: zero caregivers with more than
-- one open entry). This index makes the race lose: the second concurrent
-- insert hits 23505 and the endpoint returns the first entry instead.

CREATE UNIQUE INDEX IF NOT EXISTS uniq_open_time_entry_per_caregiver
  ON time_entries (caregiver_id)
  WHERE end_time IS NULL;
