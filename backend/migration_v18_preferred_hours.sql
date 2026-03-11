-- Migration V18: Add preferred working hours per day to caregiver_availability
-- Preferred hours are a subset of the availability window.
-- The optimizer will try to schedule within preferred hours first,
-- then fall back to the full availability window if no slot fits.

ALTER TABLE caregiver_availability
  ADD COLUMN IF NOT EXISTS monday_preferred_start TIME,
  ADD COLUMN IF NOT EXISTS monday_preferred_end TIME,
  ADD COLUMN IF NOT EXISTS tuesday_preferred_start TIME,
  ADD COLUMN IF NOT EXISTS tuesday_preferred_end TIME,
  ADD COLUMN IF NOT EXISTS wednesday_preferred_start TIME,
  ADD COLUMN IF NOT EXISTS wednesday_preferred_end TIME,
  ADD COLUMN IF NOT EXISTS thursday_preferred_start TIME,
  ADD COLUMN IF NOT EXISTS thursday_preferred_end TIME,
  ADD COLUMN IF NOT EXISTS friday_preferred_start TIME,
  ADD COLUMN IF NOT EXISTS friday_preferred_end TIME,
  ADD COLUMN IF NOT EXISTS saturday_preferred_start TIME,
  ADD COLUMN IF NOT EXISTS saturday_preferred_end TIME,
  ADD COLUMN IF NOT EXISTS sunday_preferred_start TIME,
  ADD COLUMN IF NOT EXISTS sunday_preferred_end TIME;

-- When preferred times are NULL, the optimizer treats the full availability window as the preference.
-- This keeps existing data working without any backfill.
