-- migration_v64_incident_case_file.sql
-- Incident case file: status, payer response tracking, investigation timeline,
-- attachments, a signed training acknowledgement, and a reversible
-- "caregiver removed from this client pending investigation".
-- ADDITIVE ONLY: new nullable/defaulted columns on incident_reports and two new
-- tables. No existing column, constraint, or default is altered — every current
-- incident query (clinicalRoutes, reports.js client report + client-incidents)
-- keeps working.

-- ── Case status + payer response ─────────────────────────────────────────────
-- incident_date stays "when it happened"; reported_date stays "when it was
-- reported". reported_by stays the free-text reporter (e.g. "My Choice").
ALTER TABLE incident_reports
  ADD COLUMN IF NOT EXISTS status VARCHAR(20) DEFAULT 'open'
    CHECK (status IS NULL OR status IN ('open', 'investigating', 'closed')),
  ADD COLUMN IF NOT EXISTS reporter_contact_name VARCHAR(255),
  ADD COLUMN IF NOT EXISTS reporter_phone VARCHAR(50),
  ADD COLUMN IF NOT EXISTS reporter_email VARCHAR(255),
  ADD COLUMN IF NOT EXISTS response_due_date DATE,
  ADD COLUMN IF NOT EXISTS response_sent_date DATE,
  ADD COLUMN IF NOT EXISTS disposition VARCHAR(20)
    CHECK (disposition IS NULL OR disposition IN ('substantiated', 'unsubstantiated', 'inconclusive')),
  ADD COLUMN IF NOT EXISTS findings TEXT,
  ADD COLUMN IF NOT EXISTS mandatory_report_status VARCHAR(20)
    CHECK (mandatory_report_status IS NULL OR mandatory_report_status IN ('not_required', 'pending', 'reported')),
  ADD COLUMN IF NOT EXISTS mandatory_report_details TEXT,
  ADD COLUMN IF NOT EXISTS closed_date DATE;

-- ── Caregiver removed from this client pending investigation ────────────────
-- Uses the existing schedules.suspended_from mechanism (v54). caregiver_removal
-- records exactly which schedule rows were changed and each row's PRIOR
-- suspended_from, so "return to schedule" restores them precisely and never
-- clears a client-level service suspension that was already there.
--   { "schedules": [{ "schedule_id": "...", "prior_suspended_from": null|"YYYY-MM-DD" }],
--     "open_shift_ids": ["..."] }
ALTER TABLE incident_reports
  ADD COLUMN IF NOT EXISTS caregiver_removed_from DATE,
  ADD COLUMN IF NOT EXISTS caregiver_returned_on DATE,
  ADD COLUMN IF NOT EXISTS caregiver_removal JSONB;

-- ── Signed training acknowledgement (medication handling + misappropriation) ─
-- One per incident. Signing also writes training_records rows on the
-- caregiver's file (training_type medication_reminders + misappropriation_policy).
ALTER TABLE incident_reports
  ADD COLUMN IF NOT EXISTS training_ack_signed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS training_ack_signer_name VARCHAR(255),
  ADD COLUMN IF NOT EXISTS training_ack_signature TEXT,
  ADD COLUMN IF NOT EXISTS training_ack_supervisor VARCHAR(255),
  ADD COLUMN IF NOT EXISTS training_ack_method VARCHAR(20)
    CHECK (training_ack_method IS NULL OR training_ack_method IN ('in_person', 'phone', 'video'));

-- ── Stable printed number: IR-<year>-<nnn> ──────────────────────────────────
-- Assigned once on create (clinicalRoutes) and never recomputed, so a deleted
-- incident can't renumber the ones already sent to a payer. Backfill existing
-- rows in creation order within each incident year.
ALTER TABLE incident_reports
  ADD COLUMN IF NOT EXISTS incident_number VARCHAR(20);

UPDATE incident_reports ir
   SET incident_number = n.num
  FROM (SELECT id,
               'IR-' || EXTRACT(YEAR FROM COALESCE(incident_date, created_at::date))::int || '-' ||
               lpad(ROW_NUMBER() OVER (PARTITION BY EXTRACT(YEAR FROM COALESCE(incident_date, created_at::date))
                                       ORDER BY created_at, id)::text, 3, '0') AS num
          FROM incident_reports) n
 WHERE n.id = ir.id AND ir.incident_number IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uniq_incident_reports_incident_number
  ON incident_reports(incident_number) WHERE incident_number IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_incident_reports_status ON incident_reports(status);
CREATE INDEX IF NOT EXISTS idx_incident_reports_response_due
  ON incident_reports(response_due_date)
  WHERE response_due_date IS NOT NULL AND response_sent_date IS NULL;

-- ── Investigation timeline ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS incident_investigation_notes (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  incident_id UUID NOT NULL REFERENCES incident_reports(id) ON DELETE CASCADE,
  entry_date DATE NOT NULL,
  entry_type VARCHAR(20) NOT NULL DEFAULT 'note'
    CHECK (entry_type IN ('call', 'interview', 'document', 'action', 'schedule', 'note')),
  summary TEXT NOT NULL,
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_incident_investigation_notes_incident
  ON incident_investigation_notes(incident_id, entry_date);

-- ── Attachments ─────────────────────────────────────────────────────────────
-- Stored in the database as a data URI (same approach as clients.insurance_card_*),
-- because the documents module writes to the server's local disk, which does
-- not survive a deploy.
CREATE TABLE IF NOT EXISTS incident_attachments (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  incident_id UUID NOT NULL REFERENCES incident_reports(id) ON DELETE CASCADE,
  category VARCHAR(30) NOT NULL DEFAULT 'other'
    CHECK (category IN ('payer_notice', 'statement', 'background_check', 'training', 'signed_response', 'photo', 'other')),
  file_name VARCHAR(255) NOT NULL,
  mime_type VARCHAR(100) NOT NULL,
  file_size INTEGER,
  file_data TEXT NOT NULL,
  description TEXT,
  uploaded_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_incident_attachments_incident
  ON incident_attachments(incident_id, created_at);
