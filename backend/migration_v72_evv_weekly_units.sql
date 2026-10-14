-- v72: weekly EVV allowance per client + per-visit "sent to Sandata" decision.
--
-- My Choice authorizes two kinds of weekly units: S5125 attendant care (EVV required —
-- must be checked in/out on Sandata) and S5130 homemaker (no Sandata). Once a client's
-- S5125 minutes for the Sun–Sat week are used up, the rest of the week's visits are
-- homemaker time and the caregiver app must stop sending caregivers to Sandata.
--
-- clients.evv_weekly_units      S5125 units per Sun–Sat week (1 unit = 15 min).
--                                NULL = not entered yet → app keeps prompting every visit
--                                (the behavior before v72). 0 = no EVV hours, never prompt.
-- time_entries.sandata_required  decided at clock-in: true = this visit was sent to
--                                Sandata (counts toward the week), false = not sent.
--                                NULL = visit predates v72 / decision unknown.

ALTER TABLE clients ADD COLUMN IF NOT EXISTS evv_weekly_units INTEGER;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_clients_evv_weekly_units') THEN
    ALTER TABLE clients ADD CONSTRAINT chk_clients_evv_weekly_units
      CHECK (evv_weekly_units IS NULL OR evv_weekly_units BETWEEN 0 AND 672) NOT VALID;
  END IF;
END $$;

ALTER TABLE time_entries ADD COLUMN IF NOT EXISTS sandata_required BOOLEAN;

CREATE INDEX IF NOT EXISTS idx_time_entries_client_start ON time_entries (client_id, start_time);
