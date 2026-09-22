-- Migration v69: visit documentation
--
-- One care note per visit, entered by the office (for caregivers who don't use the
-- app — Deb Phillips has no smartphone and never clocks in). A visit is identified by
-- client + date + scheduled start + caregiver, the same way invoice_line_items already
-- identifies a visit (service_date + start_time + caregiver_id), so a VA invoice can
-- be matched back to the notes for exactly the visits it bills.
--
-- tasks is a snapshot: [{ "taskId": uuid, "taskName": text, "done": bool }]. Names are
-- copied so renaming a care task later never rewrites what a past note said.
-- Additive only: one new table.

BEGIN;

CREATE TABLE IF NOT EXISTS visit_documentation (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id     UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  caregiver_id  UUID NOT NULL REFERENCES users(id),
  visit_date    DATE NOT NULL,
  start_time    TIME NOT NULL,
  end_time      TIME NOT NULL,
  schedule_id   UUID REFERENCES schedules(id) ON DELETE SET NULL,
  tasks         JSONB NOT NULL DEFAULT '[]'::jsonb,
  note          TEXT,
  entered_by    UUID REFERENCES users(id),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (client_id, visit_date, start_time, caregiver_id)
);

CREATE INDEX IF NOT EXISTS idx_visit_documentation_client_date
  ON visit_documentation (client_id, visit_date);

COMMIT;
