-- migration_v15_schema_fixes.sql
-- Round 8 deep scan: Add missing columns, constraints, fix table references

-- ═══════════════════════════════════════════════════════════════════════════════
-- 1. client_notifications — add relational FK columns used by clientPortalRoutes
-- ═══════════════════════════════════════════════════════════════════════════════
ALTER TABLE client_notifications ADD COLUMN IF NOT EXISTS related_visit_id UUID;
ALTER TABLE client_notifications ADD COLUMN IF NOT EXISTS related_invoice_id UUID;
ALTER TABLE client_notifications ADD COLUMN IF NOT EXISTS related_caregiver_id UUID;

-- ═══════════════════════════════════════════════════════════════════════════════
-- 2. care_plans — add status column used by familyPortalRoutes
-- ═══════════════════════════════════════════════════════════════════════════════
ALTER TABLE care_plans ADD COLUMN IF NOT EXISTS status VARCHAR(50) DEFAULT 'active';

-- ═══════════════════════════════════════════════════════════════════════════════
-- 3. invoice_adjustments — add notes column used by billingRoutes
-- ═══════════════════════════════════════════════════════════════════════════════
ALTER TABLE invoice_adjustments ADD COLUMN IF NOT EXISTS notes TEXT;

-- ═══════════════════════════════════════════════════════════════════════════════
-- 4. payroll_records — add unique constraint for ON CONFLICT
-- ═══════════════════════════════════════════════════════════════════════════════
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'payroll_records_caregiver_period_unique'
  ) THEN
    ALTER TABLE payroll_records
      ADD CONSTRAINT payroll_records_caregiver_period_unique
      UNIQUE (caregiver_id, period_start, period_end);
  END IF;
EXCEPTION WHEN others THEN
  RAISE NOTICE 'payroll_records unique constraint already exists or could not be created';
END $$;
