-- Migration v76: remember what filling an open shift changed, so it can be unfilled
--
-- fill_undo — written when a shift is filled (approve / smart-fill / first-to-accept):
--             which schedule exception or visit the fill touched and what it held
--             before. POST /api/open-shifts/:id/unfill reverses exactly that.
--             NULL for shifts filled before this column existed (unfill matches
--             those by what a fill is known to write).
--
-- openShiftsRoutes.js applies the same DDL on first use (ensureColumns), so a deploy
-- doesn't depend on running this by hand. Additive and re-runnable.

ALTER TABLE open_shifts
  ADD COLUMN IF NOT EXISTS fill_undo JSONB;
