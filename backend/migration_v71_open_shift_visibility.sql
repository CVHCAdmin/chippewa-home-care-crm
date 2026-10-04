-- Migration v71: open shifts the office offers to chosen caregivers
--
-- visible_to  — the caregivers who may see and accept the shift (NULL = everyone,
--               which is how every existing open shift keeps behaving)
-- auto_assign — the first of them to accept gets it, no approval step
--
-- openShiftsRoutes.js applies the same DDL on first use (ensureColumns), so a deploy
-- doesn't depend on running this by hand. Additive and re-runnable.

ALTER TABLE open_shifts
  ADD COLUMN IF NOT EXISTS visible_to UUID[],
  ADD COLUMN IF NOT EXISTS auto_assign BOOLEAN NOT NULL DEFAULT false;
