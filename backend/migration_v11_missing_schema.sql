-- Migration v11: Add missing tables and columns discovered during code review
-- Fixes runtime 500 errors from queries referencing non-existent schema objects

-- ═══════════════════════════════════════════════════════════════════════════════
-- CAREGIVER_RATES — referenced by miscRoutes, payrollRoutes, pricingRoutes
-- ═══════════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS caregiver_rates (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  caregiver_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  base_hourly_rate DECIMAL(10,2),
  overtime_rate DECIMAL(10,2),
  premium_rate DECIMAL(10,2),
  effective_date DATE DEFAULT CURRENT_DATE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_caregiver_rates_caregiver ON caregiver_rates(caregiver_id);

-- ═══════════════════════════════════════════════════════════════════════════════
-- CLIENTS — add medicaid_id and mco_member_id used by claims, EDI, Sandata
-- ═══════════════════════════════════════════════════════════════════════════════
ALTER TABLE clients ADD COLUMN IF NOT EXISTS medicaid_id VARCHAR(100);
ALTER TABLE clients ADD COLUMN IF NOT EXISTS mco_member_id VARCHAR(100);

-- ═══════════════════════════════════════════════════════════════════════════════
-- INVOICES — add columns used by billingRoutes
-- ═══════════════════════════════════════════════════════════════════════════════
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS referral_source_id UUID REFERENCES referral_sources(id);
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS invoice_type VARCHAR(50);
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS paid_at TIMESTAMPTZ;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS amount_paid DECIMAL(12,2) DEFAULT 0;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS amount_adjusted DECIMAL(12,2) DEFAULT 0;

-- ═══════════════════════════════════════════════════════════════════════════════
-- REFERRAL_SOURCE_RATES — add columns used by billingRoutes rate management
-- ═══════════════════════════════════════════════════════════════════════════════
ALTER TABLE referral_source_rates ADD COLUMN IF NOT EXISTS care_type_id UUID;
ALTER TABLE referral_source_rates ADD COLUMN IF NOT EXISTS rate_type VARCHAR(50) DEFAULT 'hourly';
ALTER TABLE referral_source_rates ADD COLUMN IF NOT EXISTS end_date DATE;
ALTER TABLE referral_source_rates ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT true;

-- ═══════════════════════════════════════════════════════════════════════════════
-- INVOICE_LINE_ITEMS — add service_date used by billingRoutes
-- ═══════════════════════════════════════════════════════════════════════════════
ALTER TABLE invoice_line_items ADD COLUMN IF NOT EXISTS service_date DATE;

-- ═══════════════════════════════════════════════════════════════════════════════
-- PAYROLL_RECORDS — add timestamp columns used by payrollRoutes
-- ═══════════════════════════════════════════════════════════════════════════════
ALTER TABLE payroll_records ADD COLUMN IF NOT EXISTS approved_at TIMESTAMPTZ;
ALTER TABLE payroll_records ADD COLUMN IF NOT EXISTS processed_at TIMESTAMPTZ;
