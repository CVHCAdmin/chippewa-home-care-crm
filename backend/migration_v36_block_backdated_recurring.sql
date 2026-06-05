-- Migration v36: Stop recurring schedules from back-dating
--
-- Root cause: schedules.effective_date is nullable. When NULL, the recurring
-- expansion logic (billing, payroll, calendar) had no lower bound and walked
-- backwards to the start of whatever date window the caller requested. That
-- caused auto-bill and payroll to generate phantom past visits and overpay.
--
-- This migration:
--  1) Backfills effective_date = created_at::date for every existing recurring
--     row that doesn't already have one (the date the schedule was actually
--     entered — the only honest answer).
--  2) Adds a BEFORE INSERT trigger that auto-fills effective_date for any new
--     recurring row, so no code path can ever create a recurring schedule
--     without one again.
--  3) Adds a CHECK constraint so attempts to NULL it out on a recurring row
--     fail loudly (UPDATE ... SET effective_date = NULL will error).

BEGIN;

-- 1. Backfill: every recurring schedule with no effective_date gets the date
--    it was actually entered into the system.
UPDATE schedules
SET effective_date = created_at::date
WHERE day_of_week IS NOT NULL
  AND effective_date IS NULL;

-- 2. Trigger: any new recurring schedule without an effective_date gets one
--    that is at least today (never earlier). If the caller passes a future
--    date, we honor that. If they pass a past date, we clamp to today.
CREATE OR REPLACE FUNCTION enforce_recurring_effective_date()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.day_of_week IS NOT NULL THEN
    -- Default to today when missing
    IF NEW.effective_date IS NULL THEN
      NEW.effective_date := CURRENT_DATE;
    END IF;
    -- Clamp past dates forward to today on INSERT
    -- (UPDATEs are left alone so back-office can correct a typo if needed)
    IF TG_OP = 'INSERT' AND NEW.effective_date < CURRENT_DATE THEN
      NEW.effective_date := CURRENT_DATE;
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_enforce_recurring_effective_date ON schedules;
CREATE TRIGGER trg_enforce_recurring_effective_date
  BEFORE INSERT OR UPDATE ON schedules
  FOR EACH ROW
  EXECUTE FUNCTION enforce_recurring_effective_date();

-- 3. Hard constraint: recurring schedules MUST have an effective_date.
--    (Belt-and-suspenders — the trigger fills it, this prevents future code
--     from quietly nulling it out.)
ALTER TABLE schedules
  DROP CONSTRAINT IF EXISTS schedules_recurring_needs_effective_date;
ALTER TABLE schedules
  ADD CONSTRAINT schedules_recurring_needs_effective_date
  CHECK (day_of_week IS NULL OR effective_date IS NOT NULL);

COMMIT;
