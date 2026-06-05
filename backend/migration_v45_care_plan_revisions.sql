-- Migration v45: Care plan revision history
--
-- Every UPDATE to care_plans snapshots the OLD row into care_plan_revisions
-- so admins can show "what changed when, by whom" — critical for regulator
-- audits and clinical defense. Trigger handles it server-side so any update
-- path (PUT, from-template, generate-schedule sub-updates) is covered.

BEGIN;

CREATE TABLE IF NOT EXISTS care_plan_revisions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  care_plan_id UUID NOT NULL REFERENCES care_plans(id) ON DELETE CASCADE,
  revision_number INTEGER NOT NULL,
  changed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  changed_by UUID REFERENCES users(id),
  -- snapshot of the prior values
  service_type TEXT, service_description TEXT, frequency TEXT,
  care_goals TEXT, special_instructions TEXT, precautions TEXT,
  medication_notes TEXT, mobility_notes TEXT, dietary_notes TEXT,
  communication_notes TEXT, start_date DATE, end_date DATE, status TEXT,
  UNIQUE (care_plan_id, revision_number)
);

CREATE INDEX IF NOT EXISTS idx_care_plan_revisions_plan ON care_plan_revisions(care_plan_id, revision_number DESC);

-- Trigger: snapshot the OLD row to care_plan_revisions on every UPDATE.
-- changed_by pulled from a session GUC if the app sets it (CRM helper below).
CREATE OR REPLACE FUNCTION snapshot_care_plan_on_update()
RETURNS TRIGGER AS $$
DECLARE
  next_rev INTEGER;
  by_uuid UUID;
BEGIN
  SELECT COALESCE(MAX(revision_number), 0) + 1 INTO next_rev
    FROM care_plan_revisions WHERE care_plan_id = OLD.id;

  BEGIN
    by_uuid := current_setting('crm.user_id', true)::uuid;
  EXCEPTION WHEN OTHERS THEN
    by_uuid := NULL;
  END;

  INSERT INTO care_plan_revisions (
    care_plan_id, revision_number, changed_by,
    service_type, service_description, frequency,
    care_goals, special_instructions, precautions,
    medication_notes, mobility_notes, dietary_notes,
    communication_notes, start_date, end_date, status
  ) VALUES (
    OLD.id, next_rev, by_uuid,
    OLD.service_type, OLD.service_description, OLD.frequency,
    OLD.care_goals, OLD.special_instructions, OLD.precautions,
    OLD.medication_notes, OLD.mobility_notes, OLD.dietary_notes,
    OLD.communication_notes, OLD.start_date, OLD.end_date, OLD.status
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_snapshot_care_plan ON care_plans;
CREATE TRIGGER trg_snapshot_care_plan
  BEFORE UPDATE ON care_plans
  FOR EACH ROW
  WHEN (
    OLD.service_description IS DISTINCT FROM NEW.service_description
    OR OLD.frequency IS DISTINCT FROM NEW.frequency
    OR OLD.care_goals IS DISTINCT FROM NEW.care_goals
    OR OLD.special_instructions IS DISTINCT FROM NEW.special_instructions
    OR OLD.precautions IS DISTINCT FROM NEW.precautions
    OR OLD.medication_notes IS DISTINCT FROM NEW.medication_notes
    OR OLD.mobility_notes IS DISTINCT FROM NEW.mobility_notes
    OR OLD.dietary_notes IS DISTINCT FROM NEW.dietary_notes
    OR OLD.communication_notes IS DISTINCT FROM NEW.communication_notes
    OR OLD.start_date IS DISTINCT FROM NEW.start_date
    OR OLD.end_date IS DISTINCT FROM NEW.end_date
    OR OLD.status IS DISTINCT FROM NEW.status
  )
  EXECUTE FUNCTION snapshot_care_plan_on_update();

COMMIT;
