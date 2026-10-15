-- v74: caregiver time corrections ("I forgot to clock out", "I never clocked in").
--
-- A caregiver submits the times they actually worked for a past visit (current or last
-- Sun–Sat pay week). Nothing changes until the office approves; approval rewrites the
-- visit's times (or creates the missed visit), recalculates billable minutes with the
-- clock-out rule, records the change for EVV (visit_time_changes) and keeps the original
-- clock times here. The office fixes Sandata itself.

CREATE TABLE IF NOT EXISTS time_corrections (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  caregiver_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  client_id        UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  time_entry_id    UUID REFERENCES time_entries(id) ON DELETE SET NULL,  -- NULL = missed visit (never clocked in)
  kind             VARCHAR(20) NOT NULL CHECK (kind IN ('fix_times', 'missed_visit')),
  visit_date       DATE NOT NULL,                 -- America/Chicago date of the requested start
  requested_start  TIMESTAMPTZ NOT NULL,
  requested_end    TIMESTAMPTZ NOT NULL,
  original_start   TIMESTAMPTZ,                   -- snapshot of the clock times when submitted
  original_end     TIMESTAMPTZ,
  reason           VARCHAR(30) NOT NULL CHECK (reason IN
                     ('forgot_clock_in', 'forgot_clock_out', 'app_problem', 'wrong_times', 'other')),
  note             TEXT NOT NULL,
  submit_lat       NUMERIC(10, 7),
  submit_lng       NUMERIC(10, 7),
  submit_accuracy  INTEGER,
  status           VARCHAR(20) NOT NULL DEFAULT 'pending'
                     CHECK (status IN ('pending', 'approved', 'denied', 'cancelled')),
  reviewed_by      UUID REFERENCES users(id),
  reviewed_at      TIMESTAMPTZ,
  review_note      TEXT,
  evv_reason_code  VARCHAR(2),
  applied_time_entry_id UUID REFERENCES time_entries(id) ON DELETE SET NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_time_corrections_status ON time_corrections (status, created_at);
CREATE INDEX IF NOT EXISTS idx_time_corrections_caregiver ON time_corrections (caregiver_id, visit_date);
-- One open request per visit, and one open "missed visit" per caregiver/client/day.
CREATE UNIQUE INDEX IF NOT EXISTS uq_time_corrections_pending_entry
  ON time_corrections (time_entry_id) WHERE status = 'pending' AND time_entry_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_time_corrections_pending_missed
  ON time_corrections (caregiver_id, client_id, visit_date) WHERE status = 'pending' AND kind = 'missed_visit';
