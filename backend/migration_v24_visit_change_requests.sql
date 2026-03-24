-- Migration v24: Visit change requests (client-initiated cancel/reschedule)
-- Allows portal clients to request cancellation or reschedule of visits,
-- with caregiver approval and counter-offer flow.

BEGIN;

-- 1. Visit change requests table
CREATE TABLE IF NOT EXISTS visit_change_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  caregiver_id UUID NOT NULL REFERENCES users(id),

  request_type VARCHAR(20) NOT NULL CHECK (request_type IN ('cancel', 'reschedule', 'note')),

  -- Original visit identification
  visit_id UUID REFERENCES scheduled_visits(id),
  schedule_id UUID REFERENCES schedules(id),
  visit_date DATE NOT NULL,
  original_start_time TIME NOT NULL,
  original_end_time TIME NOT NULL,

  -- Cancellation fields
  cancel_reason TEXT,

  -- Reschedule fields
  proposed_date DATE,
  proposed_start_time TIME,
  proposed_end_time TIME,

  -- Caregiver counter-offer
  counter_date DATE,
  counter_start_time TIME,
  counter_end_time TIME,
  counter_message TEXT,

  -- Status flow:
  --   cancel:     pending -> approved | denied
  --   reschedule: pending -> approved | denied | counter_offered
  --                          counter_offered -> counter_accepted | counter_declined
  status VARCHAR(30) DEFAULT 'pending' CHECK (status IN (
    'pending', 'approved', 'denied',
    'counter_offered', 'counter_accepted', 'counter_declined'
  )),

  resolved_at TIMESTAMPTZ,
  resolved_by UUID REFERENCES users(id),
  admin_notes TEXT,

  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_vcr_client ON visit_change_requests(client_id);
CREATE INDEX IF NOT EXISTS idx_vcr_caregiver ON visit_change_requests(caregiver_id);
CREATE INDEX IF NOT EXISTS idx_vcr_status ON visit_change_requests(status);
CREATE INDEX IF NOT EXISTS idx_vcr_visit_date ON visit_change_requests(visit_date);

-- 2. Add client_notes and source_schedule_id to scheduled_visits
ALTER TABLE scheduled_visits ADD COLUMN IF NOT EXISTS client_notes TEXT;
ALTER TABLE scheduled_visits ADD COLUMN IF NOT EXISTS source_schedule_id UUID REFERENCES schedules(id);

-- 3. Audit trigger
CREATE TRIGGER audit_visit_change_requests_trigger
  AFTER INSERT OR UPDATE OR DELETE ON visit_change_requests
  FOR EACH ROW EXECUTE FUNCTION audit_log_trigger();

COMMIT;
