-- Migration v30: Caregiver payday verification
-- Caregivers confirm or dispute their pay-period hours before payroll processes.
-- One row per (caregiver, pay_period). Either verified_at or disputed_at is set.

CREATE TABLE IF NOT EXISTS payroll_period_verifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  caregiver_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  pay_period_start DATE NOT NULL,
  pay_period_end DATE NOT NULL,
  verified_at TIMESTAMPTZ,
  disputed_at TIMESTAMPTZ,
  dispute_reason TEXT,
  reported_total_hours NUMERIC(10, 2),
  reported_gross_pay NUMERIC(10, 2),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (caregiver_id, pay_period_start, pay_period_end)
);

CREATE INDEX IF NOT EXISTS idx_ppv_caregiver_period
  ON payroll_period_verifications (caregiver_id, pay_period_start, pay_period_end);
