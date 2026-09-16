-- Migration v66: care plan visit schedule snapshot
--
-- A care plan records the client's recurring visit schedule as it stood when the plan
-- was saved (copied from the live schedule by "Fill from current schedule"), so the
-- plan in effect on any past date can be produced with its schedule. The revision
-- trigger is extended so every change to the saved schedule is snapshotted with who
-- made it. Additive only: two nullable columns on each table, trigger/function replaced
-- with the same behavior plus the new columns.

BEGIN;

ALTER TABLE care_plans
  ADD COLUMN IF NOT EXISTS visit_schedule TEXT,
  ADD COLUMN IF NOT EXISTS visit_schedule_as_of DATE;

ALTER TABLE care_plan_revisions
  ADD COLUMN IF NOT EXISTS visit_schedule TEXT,
  ADD COLUMN IF NOT EXISTS visit_schedule_as_of DATE;

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
    communication_notes, start_date, end_date, status,
    visit_schedule, visit_schedule_as_of
  ) VALUES (
    OLD.id, next_rev, by_uuid,
    OLD.service_type, OLD.service_description, OLD.frequency,
    OLD.care_goals, OLD.special_instructions, OLD.precautions,
    OLD.medication_notes, OLD.mobility_notes, OLD.dietary_notes,
    OLD.communication_notes, OLD.start_date, OLD.end_date, OLD.status,
    OLD.visit_schedule, OLD.visit_schedule_as_of
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
    OR OLD.visit_schedule IS DISTINCT FROM NEW.visit_schedule
    OR OLD.visit_schedule_as_of IS DISTINCT FROM NEW.visit_schedule_as_of
  )
  EXECUTE FUNCTION snapshot_care_plan_on_update();

COMMIT;
