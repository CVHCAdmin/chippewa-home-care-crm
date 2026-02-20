-- migration_v5.sql: Complete schema fixes
-- Run with: psql $DATABASE_URL -f migration_v5.sql

CREATE TABLE IF NOT EXISTS caregiver_profiles (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  caregiver_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  notes TEXT,
  capabilities TEXT,
  limitations TEXT,
  preferred_hours TEXT,
  available_mon BOOLEAN DEFAULT true,
  available_tue BOOLEAN DEFAULT true,
  available_wed BOOLEAN DEFAULT true,
  available_thu BOOLEAN DEFAULT true,
  available_fri BOOLEAN DEFAULT true,
  available_sat BOOLEAN DEFAULT false,
  available_sun BOOLEAN DEFAULT false,
  npi_number VARCHAR(20),
  taxonomy_code VARCHAR(20) DEFAULT '374700000X',
  evv_worker_id VARCHAR(100),
  medicaid_provider_id VARCHAR(100),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_caregiver_profiles_caregiver_id ON caregiver_profiles(caregiver_id);

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS address VARCHAR(255),
  ADD COLUMN IF NOT EXISTS city VARCHAR(100),
  ADD COLUMN IF NOT EXISTS state VARCHAR(2),
  ADD COLUMN IF NOT EXISTS zip VARCHAR(10),
  ADD COLUMN IF NOT EXISTS latitude DECIMAL(10,8),
  ADD COLUMN IF NOT EXISTS longitude DECIMAL(11,8),
  ADD COLUMN IF NOT EXISTS default_pay_rate DECIMAL(8,2) DEFAULT 15.00,
  ADD COLUMN IF NOT EXISTS hire_date DATE,
  ADD COLUMN IF NOT EXISTS emergency_contact_name VARCHAR(255),
  ADD COLUMN IF NOT EXISTS emergency_contact_phone VARCHAR(20),
  ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT true;

ALTER TABLE schedules
  ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT true,
  ADD COLUMN IF NOT EXISTS frequency VARCHAR(50) DEFAULT 'weekly',
  ADD COLUMN IF NOT EXISTS effective_date DATE,
  ADD COLUMN IF NOT EXISTS anchor_date DATE,
  ADD COLUMN IF NOT EXISTS schedule_type VARCHAR(50) DEFAULT 'recurring';

ALTER TABLE time_entries
  ADD COLUMN IF NOT EXISTS schedule_id UUID REFERENCES schedules(id),
  ADD COLUMN IF NOT EXISTS allotted_minutes INTEGER,
  ADD COLUMN IF NOT EXISTS billable_minutes INTEGER,
  ADD COLUMN IF NOT EXISTS discrepancy_minutes INTEGER;

CREATE INDEX IF NOT EXISTS idx_time_entries_schedule ON time_entries(schedule_id);

CREATE TABLE IF NOT EXISTS background_checks (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  caregiver_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  check_type VARCHAR(50) DEFAULT 'criminal',
  provider VARCHAR(100),
  cost DECIMAL(8,2),
  status VARCHAR(50) DEFAULT 'pending',
  initiated_date DATE DEFAULT CURRENT_DATE,
  expiration_date DATE,
  notes TEXT,
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_background_checks_caregiver ON background_checks(caregiver_id);

CREATE TABLE IF NOT EXISTS geofence_settings (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  client_id UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  radius_feet INTEGER DEFAULT 300,
  auto_clock_in BOOLEAN DEFAULT true,
  auto_clock_out BOOLEAN DEFAULT true,
  require_gps BOOLEAN DEFAULT true,
  notify_admin_on_override BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_geofence_client ON geofence_settings(client_id);

UPDATE time_entries
  SET billable_minutes = duration_minutes
  WHERE is_complete = true AND billable_minutes IS NULL AND duration_minutes IS NOT NULL;
