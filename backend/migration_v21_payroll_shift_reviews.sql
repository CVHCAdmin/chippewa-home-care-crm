-- Migration v21: Payroll Shift Reviews
-- Professional shift-level reconciliation for payroll processing.
-- Each scheduled shift occurrence gets matched to its time_entry (clock-in/out),
-- reviewed individually, then approved shifts roll up into payroll.

CREATE TABLE IF NOT EXISTS payroll_shift_reviews (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  pay_period_start DATE NOT NULL,
  pay_period_end DATE NOT NULL,
  caregiver_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  client_id UUID REFERENCES clients(id) ON DELETE SET NULL,
  schedule_id UUID REFERENCES schedules(id) ON DELETE SET NULL,
  time_entry_id UUID REFERENCES time_entries(id) ON DELETE SET NULL,
  shift_date DATE NOT NULL,

  -- Scheduled shift info (from schedule)
  scheduled_start TIME,
  scheduled_end TIME,
  scheduled_minutes INTEGER,

  -- Actual clock-in/out info (from time_entry)
  actual_start TIMESTAMPTZ,
  actual_end TIMESTAMPTZ,
  actual_minutes INTEGER,

  -- What gets paid
  payable_minutes INTEGER,

  -- Review workflow
  -- pending: needs review
  -- verified: clock-in matches schedule, auto-approved
  -- approved: manually approved by admin
  -- flagged: discrepancy or issue needs attention
  -- missing_punch: scheduled but no clock-in
  -- excused: approved absence (not paid unless PTO covers it)
  -- manual_entry: admin manually entered hours (no clock-in existed)
  status VARCHAR(30) NOT NULL DEFAULT 'pending',

  flag_reason TEXT,
  resolution_notes TEXT,
  reviewed_by UUID REFERENCES users(id),
  reviewed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- One review per shift per caregiver per pay period
CREATE UNIQUE INDEX IF NOT EXISTS idx_psr_unique_shift
  ON payroll_shift_reviews (pay_period_start, pay_period_end, caregiver_id, shift_date, COALESCE(schedule_id, '00000000-0000-0000-0000-000000000000'));

CREATE INDEX IF NOT EXISTS idx_psr_period ON payroll_shift_reviews (pay_period_start, pay_period_end);
CREATE INDEX IF NOT EXISTS idx_psr_caregiver ON payroll_shift_reviews (caregiver_id);
CREATE INDEX IF NOT EXISTS idx_psr_status ON payroll_shift_reviews (status);
