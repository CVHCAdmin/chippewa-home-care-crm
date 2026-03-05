-- migration_v13_schema_fixes.sql
-- Adds missing columns and tables referenced by route handlers

-- ═══════════════════════════════════════════════════════════════════════════════
-- FIX 1: Add missing columns to background_checks
-- ═══════════════════════════════════════════════════════════════════════════════
ALTER TABLE background_checks ADD COLUMN IF NOT EXISTS reference_number VARCHAR(255);
ALTER TABLE background_checks ADD COLUMN IF NOT EXISTS findings TEXT;

-- ═══════════════════════════════════════════════════════════════════════════════
-- FIX 2: Add missing timestamp columns to open_shifts
-- ═══════════════════════════════════════════════════════════════════════════════
ALTER TABLE open_shifts ADD COLUMN IF NOT EXISTS claimed_at TIMESTAMPTZ;
ALTER TABLE open_shifts ADD COLUMN IF NOT EXISTS approved_at TIMESTAMPTZ;
ALTER TABLE open_shifts ADD COLUMN IF NOT EXISTS approved_by UUID REFERENCES users(id);
ALTER TABLE open_shifts ADD COLUMN IF NOT EXISTS claimed_by UUID REFERENCES users(id);
ALTER TABLE open_shifts ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();

-- ═══════════════════════════════════════════════════════════════════════════════
-- FIX 3: Add missing columns to shift_swap_requests
-- ═══════════════════════════════════════════════════════════════════════════════
ALTER TABLE shift_swap_requests ADD COLUMN IF NOT EXISTS admin_approved_at TIMESTAMPTZ;

-- ═══════════════════════════════════════════════════════════════════════════════
-- FIX 4: Add accepted_date to claims
-- ═══════════════════════════════════════════════════════════════════════════════
ALTER TABLE claims ADD COLUMN IF NOT EXISTS accepted_date DATE;

-- ═══════════════════════════════════════════════════════════════════════════════
-- FIX 5: Add missing columns to certification_alerts
-- ═══════════════════════════════════════════════════════════════════════════════
ALTER TABLE certification_alerts ADD COLUMN IF NOT EXISTS acknowledged_at TIMESTAMPTZ;
ALTER TABLE certification_alerts ADD COLUMN IF NOT EXISTS acknowledged_by UUID REFERENCES users(id);
ALTER TABLE certification_alerts ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();

-- ═══════════════════════════════════════════════════════════════════════════════
-- FIX 6: Add care_type_id to schedules (referenced by open shifts approve flow)
-- ═══════════════════════════════════════════════════════════════════════════════
ALTER TABLE schedules ADD COLUMN IF NOT EXISTS care_type_id UUID;

-- ═══════════════════════════════════════════════════════════════════════════════
-- FIX 7: Add day-specific availability columns to caregiver_availability
-- (Code references monday_available, monday_start_time, etc. instead of JSONB)
-- ═══════════════════════════════════════════════════════════════════════════════
ALTER TABLE caregiver_availability ADD COLUMN IF NOT EXISTS sunday_available BOOLEAN DEFAULT false;
ALTER TABLE caregiver_availability ADD COLUMN IF NOT EXISTS sunday_start_time TIME;
ALTER TABLE caregiver_availability ADD COLUMN IF NOT EXISTS sunday_end_time TIME;
ALTER TABLE caregiver_availability ADD COLUMN IF NOT EXISTS monday_available BOOLEAN DEFAULT false;
ALTER TABLE caregiver_availability ADD COLUMN IF NOT EXISTS monday_start_time TIME;
ALTER TABLE caregiver_availability ADD COLUMN IF NOT EXISTS monday_end_time TIME;
ALTER TABLE caregiver_availability ADD COLUMN IF NOT EXISTS tuesday_available BOOLEAN DEFAULT false;
ALTER TABLE caregiver_availability ADD COLUMN IF NOT EXISTS tuesday_start_time TIME;
ALTER TABLE caregiver_availability ADD COLUMN IF NOT EXISTS tuesday_end_time TIME;
ALTER TABLE caregiver_availability ADD COLUMN IF NOT EXISTS wednesday_available BOOLEAN DEFAULT false;
ALTER TABLE caregiver_availability ADD COLUMN IF NOT EXISTS wednesday_start_time TIME;
ALTER TABLE caregiver_availability ADD COLUMN IF NOT EXISTS wednesday_end_time TIME;
ALTER TABLE caregiver_availability ADD COLUMN IF NOT EXISTS thursday_available BOOLEAN DEFAULT false;
ALTER TABLE caregiver_availability ADD COLUMN IF NOT EXISTS thursday_start_time TIME;
ALTER TABLE caregiver_availability ADD COLUMN IF NOT EXISTS thursday_end_time TIME;
ALTER TABLE caregiver_availability ADD COLUMN IF NOT EXISTS friday_available BOOLEAN DEFAULT false;
ALTER TABLE caregiver_availability ADD COLUMN IF NOT EXISTS friday_start_time TIME;
ALTER TABLE caregiver_availability ADD COLUMN IF NOT EXISTS friday_end_time TIME;
ALTER TABLE caregiver_availability ADD COLUMN IF NOT EXISTS saturday_available BOOLEAN DEFAULT false;
ALTER TABLE caregiver_availability ADD COLUMN IF NOT EXISTS saturday_start_time TIME;
ALTER TABLE caregiver_availability ADD COLUMN IF NOT EXISTS saturday_end_time TIME;

-- ═══════════════════════════════════════════════════════════════════════════════
-- FIX 7b: Add required_certifications to care_types
-- ═══════════════════════════════════════════════════════════════════════════════
ALTER TABLE care_types ADD COLUMN IF NOT EXISTS required_certifications JSONB DEFAULT '[]';

-- ═══════════════════════════════════════════════════════════════════════════════
-- FIX 8: Create client_visit_notes table (referenced by clientsRoutes)
-- ═══════════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS client_visit_notes (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  client_id UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  caregiver_id UUID REFERENCES users(id),
  note TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_visit_notes_client ON client_visit_notes(client_id);

-- ═══════════════════════════════════════════════════════════════════════════════
-- FIX 9: Create client_services table (referenced by clientsRoutes)
-- ═══════════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS client_services (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  client_id UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  service_pricing_id UUID NOT NULL,
  is_primary BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_client_services_client ON client_services(client_id);

-- ═══════════════════════════════════════════════════════════════════════════════
-- FIX 10: Create client portal tables (referenced by clientPortalRoutes)
-- ═══════════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS scheduled_visits (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  client_id UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  caregiver_id UUID REFERENCES users(id),
  visit_date DATE NOT NULL,
  start_time TIME,
  end_time TIME,
  status VARCHAR(50) DEFAULT 'scheduled',
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_scheduled_visits_client ON scheduled_visits(client_id);

CREATE TABLE IF NOT EXISTS client_notifications (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  client_id UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  type VARCHAR(100) NOT NULL,
  title VARCHAR(255),
  message TEXT,
  is_read BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_client_notifications_client ON client_notifications(client_id);

CREATE TABLE IF NOT EXISTS client_notification_preferences (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  client_id UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  notification_type VARCHAR(100) NOT NULL,
  enabled BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(client_id, notification_type)
);

-- ═══════════════════════════════════════════════════════════════════════════════
-- FIX 11: Add billing columns to referral_sources
-- ═══════════════════════════════════════════════════════════════════════════════
ALTER TABLE referral_sources ADD COLUMN IF NOT EXISTS billing_address TEXT;
ALTER TABLE referral_sources ADD COLUMN IF NOT EXISTS billing_contact VARCHAR(255);

-- ═══════════════════════════════════════════════════════════════════════════════
-- FIX 12: Add status column to users (for family portal status tracking)
-- ═══════════════════════════════════════════════════════════════════════════════
ALTER TABLE users ADD COLUMN IF NOT EXISTS status VARCHAR(50) DEFAULT 'active';
-- Backfill status from is_active
UPDATE users SET status = CASE WHEN is_active THEN 'active' ELSE 'inactive' END WHERE status IS NULL;

-- ═══════════════════════════════════════════════════════════════════════════════
-- FIX 13: Add status column to clients (for reports/exports)
-- ═══════════════════════════════════════════════════════════════════════════════
ALTER TABLE clients ADD COLUMN IF NOT EXISTS status VARCHAR(50) DEFAULT 'active';
UPDATE clients SET status = CASE WHEN is_active THEN 'active' ELSE 'inactive' END WHERE status IS NULL;

-- ═══════════════════════════════════════════════════════════════════════════════
-- FIX 14: Add SMS preference columns to caregiver_profiles
-- ═══════════════════════════════════════════════════════════════════════════════
ALTER TABLE caregiver_profiles ADD COLUMN IF NOT EXISTS sms_enabled BOOLEAN DEFAULT true;
ALTER TABLE caregiver_profiles ADD COLUMN IF NOT EXISTS sms_open_shifts BOOLEAN DEFAULT true;

-- ═══════════════════════════════════════════════════════════════════════════════
-- FIX 15: Add broadcast_sent to open_shifts
-- ═══════════════════════════════════════════════════════════════════════════════
ALTER TABLE open_shifts ADD COLUMN IF NOT EXISTS broadcast_sent BOOLEAN DEFAULT false;
