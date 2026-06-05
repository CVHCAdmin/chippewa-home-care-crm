-- Migration v39: Vitals tracking + MAR enhancements
--
-- 1. New client_vitals table for blood pressure, pulse, temp, weight, glucose,
--    O2 sat, pain scale, respirations. Captured per-visit by caregiver.
-- 2. Add 'refused' / 'held' / 'self_administered' to medication_logs valid
--    statuses (was implicit). Add 'witnessed_by' for controlled substances.

BEGIN;

CREATE TABLE IF NOT EXISTS client_vitals (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  client_id UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  caregiver_id UUID REFERENCES users(id),
  time_entry_id UUID REFERENCES time_entries(id) ON DELETE SET NULL,
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Cardiopulmonary
  systolic_bp INTEGER,       -- 60-250 plausible
  diastolic_bp INTEGER,      -- 30-150 plausible
  pulse INTEGER,             -- 30-200
  respirations INTEGER,      -- 5-60
  oxygen_saturation INTEGER, -- 0-100, %

  -- Metabolic
  temperature_f NUMERIC(4,1),     -- 90.0 - 110.0
  blood_glucose INTEGER,          -- mg/dL
  weight_lbs NUMERIC(5,1),

  -- Other
  pain_scale SMALLINT,            -- 0-10 NRS
  pain_location VARCHAR(120),
  notes TEXT,

  created_at TIMESTAMPTZ DEFAULT NOW(),

  -- Sanity bounds — reject obvious mis-entries early
  CONSTRAINT vitals_systolic_range  CHECK (systolic_bp  IS NULL OR systolic_bp  BETWEEN 50  AND 260),
  CONSTRAINT vitals_diastolic_range CHECK (diastolic_bp IS NULL OR diastolic_bp BETWEEN 25  AND 160),
  CONSTRAINT vitals_pulse_range     CHECK (pulse        IS NULL OR pulse        BETWEEN 25  AND 220),
  CONSTRAINT vitals_resp_range      CHECK (respirations IS NULL OR respirations BETWEEN 4   AND 70),
  CONSTRAINT vitals_o2_range        CHECK (oxygen_saturation IS NULL OR oxygen_saturation BETWEEN 50 AND 100),
  CONSTRAINT vitals_temp_range      CHECK (temperature_f IS NULL OR temperature_f BETWEEN 85.0 AND 112.0),
  CONSTRAINT vitals_glucose_range   CHECK (blood_glucose IS NULL OR blood_glucose BETWEEN 20 AND 800),
  CONSTRAINT vitals_weight_range    CHECK (weight_lbs    IS NULL OR weight_lbs    BETWEEN 30 AND 800),
  CONSTRAINT vitals_pain_range      CHECK (pain_scale    IS NULL OR pain_scale    BETWEEN 0  AND 10)
);

CREATE INDEX IF NOT EXISTS idx_client_vitals_client ON client_vitals(client_id);
CREATE INDEX IF NOT EXISTS idx_client_vitals_recorded ON client_vitals(recorded_at DESC);
CREATE INDEX IF NOT EXISTS idx_client_vitals_caregiver ON client_vitals(caregiver_id);

-- Add witnessed_by for controlled substances. Caregiver enters whose presence
-- witnessed administration (e.g., another caregiver or family member).
ALTER TABLE medication_logs
  ADD COLUMN IF NOT EXISTS witnessed_by VARCHAR(120),
  ADD COLUMN IF NOT EXISTS effective_status VARCHAR(30); -- given|refused|held|self_administered|missed

-- Backfill effective_status from existing status column
UPDATE medication_logs SET effective_status = COALESCE(status, 'given') WHERE effective_status IS NULL;

COMMIT;
