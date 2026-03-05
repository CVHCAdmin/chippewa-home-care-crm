-- migration_v14_schema_fixes.sql
-- Round 7 deep scan: Add missing columns, constraints, and fix table structures

-- ═══════════════════════════════════════════════════════════════════════════════
-- 1. clients — missing columns for emergency contact, medical, scheduling
-- ═══════════════════════════════════════════════════════════════════════════════
ALTER TABLE clients ADD COLUMN IF NOT EXISTS emergency_contact_name VARCHAR(255);
ALTER TABLE clients ADD COLUMN IF NOT EXISTS emergency_contact_phone VARCHAR(50);
ALTER TABLE clients ADD COLUMN IF NOT EXISTS emergency_contact_relationship VARCHAR(100);
ALTER TABLE clients ADD COLUMN IF NOT EXISTS medical_notes TEXT;
ALTER TABLE clients ADD COLUMN IF NOT EXISTS care_preferences TEXT;
ALTER TABLE clients ADD COLUMN IF NOT EXISTS mobility_assistance_needs TEXT;
ALTER TABLE clients ADD COLUMN IF NOT EXISTS billing_notes TEXT;
ALTER TABLE clients ADD COLUMN IF NOT EXISTS service_days_per_week INTEGER DEFAULT 5;
ALTER TABLE clients ADD COLUMN IF NOT EXISTS service_allowed_days JSONB DEFAULT '[1,2,3,4,5]';

-- ═══════════════════════════════════════════════════════════════════════════════
-- 2. client_services — add notes column
-- ═══════════════════════════════════════════════════════════════════════════════
ALTER TABLE client_services ADD COLUMN IF NOT EXISTS notes TEXT;

-- ═══════════════════════════════════════════════════════════════════════════════
-- 3. client_portal_accounts — login tracking and invite columns
-- ═══════════════════════════════════════════════════════════════════════════════
ALTER TABLE client_portal_accounts ADD COLUMN IF NOT EXISTS portal_enabled BOOLEAN DEFAULT true;
ALTER TABLE client_portal_accounts ADD COLUMN IF NOT EXISTS failed_login_count INTEGER DEFAULT 0;
ALTER TABLE client_portal_accounts ADD COLUMN IF NOT EXISTS locked_until TIMESTAMPTZ;
ALTER TABLE client_portal_accounts ADD COLUMN IF NOT EXISTS invite_token VARCHAR(255);
ALTER TABLE client_portal_accounts ADD COLUMN IF NOT EXISTS invite_expires_at TIMESTAMPTZ;

-- ═══════════════════════════════════════════════════════════════════════════════
-- 4. scheduled_visits — rename visit_date to scheduled_date + add cancel columns
-- ═══════════════════════════════════════════════════════════════════════════════
-- Add scheduled_date as alias (keep visit_date for backward compat)
ALTER TABLE scheduled_visits ADD COLUMN IF NOT EXISTS scheduled_date DATE;
-- Copy existing visit_date data to scheduled_date
UPDATE scheduled_visits SET scheduled_date = visit_date WHERE scheduled_date IS NULL AND visit_date IS NOT NULL;

ALTER TABLE scheduled_visits ADD COLUMN IF NOT EXISTS cancelled_reason TEXT;
ALTER TABLE scheduled_visits ADD COLUMN IF NOT EXISTS cancelled_by UUID REFERENCES users(id);
ALTER TABLE scheduled_visits ADD COLUMN IF NOT EXISTS cancelled_at TIMESTAMPTZ;
ALTER TABLE scheduled_visits ADD COLUMN IF NOT EXISTS assignment_id UUID;
ALTER TABLE scheduled_visits ADD COLUMN IF NOT EXISTS created_by UUID REFERENCES users(id);

-- ═══════════════════════════════════════════════════════════════════════════════
-- 5. client_notification_preferences — restructure from key-value to boolean columns
--    Drop and recreate with boolean columns to match code expectations
-- ═══════════════════════════════════════════════════════════════════════════════
DROP TABLE IF EXISTS client_notification_preferences CASCADE;
CREATE TABLE IF NOT EXISTS client_notification_preferences (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  client_id UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  email_enabled BOOLEAN DEFAULT true,
  portal_enabled BOOLEAN DEFAULT true,
  caregiver_alerts BOOLEAN DEFAULT true,
  schedule_alerts BOOLEAN DEFAULT true,
  billing_alerts BOOLEAN DEFAULT true,
  assignment_alerts BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(client_id)
);

-- ═══════════════════════════════════════════════════════════════════════════════
-- 6. noshow_alerts — add unique constraint for ON CONFLICT
-- ═══════════════════════════════════════════════════════════════════════════════
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'noshow_alerts_schedule_shift_unique'
  ) THEN
    ALTER TABLE noshow_alerts
      ADD CONSTRAINT noshow_alerts_schedule_shift_unique
      UNIQUE (schedule_id, shift_date);
  END IF;
EXCEPTION WHEN others THEN
  RAISE NOTICE 'noshow_alerts unique constraint already exists or could not be created';
END $$;

-- ═══════════════════════════════════════════════════════════════════════════════
-- 7. notifications — add missing columns used by miscRoutes
-- ═══════════════════════════════════════════════════════════════════════════════
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS recipient_type VARCHAR(50);
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS recipient_id UUID;
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS notification_type VARCHAR(100);
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS subject VARCHAR(255);
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS status VARCHAR(50) DEFAULT 'sent';
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS sent_by UUID;
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();

-- Backfill: copy user_id to recipient_id for existing rows
UPDATE notifications SET recipient_id = user_id WHERE recipient_id IS NULL;
