-- migration_v12_schema_fixes.sql
-- Fixes schema ordering issues and conflicts from previous migrations
-- Safe to run on both fresh and existing databases

-- ═══════════════════════════════════════════════════════════════════════════════
-- FIX 1: migration_v2 references non-existent 'applications' table
-- The FK should reference job_applications, not applications
-- ═══════════════════════════════════════════════════════════════════════════════
DO $$ BEGIN
  -- Drop the bad FK constraint if it exists
  IF EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name LIKE '%application_id%' AND table_name = 'background_checks'
  ) THEN
    ALTER TABLE background_checks DROP CONSTRAINT IF EXISTS background_checks_application_id_fkey;
  END IF;
  -- Re-add with correct reference if job_applications exists
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'job_applications') THEN
    BEGIN
      ALTER TABLE background_checks
        ADD COLUMN IF NOT EXISTS application_id UUID;
      ALTER TABLE background_checks
        ADD CONSTRAINT background_checks_application_id_fkey
        FOREIGN KEY (application_id) REFERENCES job_applications(id);
    EXCEPTION WHEN duplicate_object THEN NULL;
    END;
  END IF;
END $$;

-- ═══════════════════════════════════════════════════════════════════════════════
-- FIX 2: Ensure tables exist before ALTER TABLE statements from v3/v4/v5
-- These CREATE TABLE IF NOT EXISTS are defined in v8 but ALTER'd in earlier migrations
-- ═══════════════════════════════════════════════════════════════════════════════

-- Ensure caregiver_profiles exists (needed by v4 ALTER)
CREATE TABLE IF NOT EXISTS caregiver_profiles (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  bio TEXT,
  certifications JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE caregiver_profiles ADD COLUMN IF NOT EXISTS taxonomy_code VARCHAR(20) DEFAULT '374700000X';
ALTER TABLE caregiver_profiles ADD COLUMN IF NOT EXISTS evv_worker_id VARCHAR(100);
ALTER TABLE caregiver_profiles ADD COLUMN IF NOT EXISTS medicaid_provider_id VARCHAR(100);

-- Ensure care_types exists (needed by v4 ALTER)
CREATE TABLE IF NOT EXISTS care_types (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name VARCHAR(255) NOT NULL,
  description TEXT,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE care_types ADD COLUMN IF NOT EXISTS default_service_code VARCHAR(20);
ALTER TABLE care_types ADD COLUMN IF NOT EXISTS default_modifier VARCHAR(10);
ALTER TABLE care_types ADD COLUMN IF NOT EXISTS requires_evv BOOLEAN DEFAULT true;

-- Ensure schedules exists (needed by v5 ALTER)
CREATE TABLE IF NOT EXISTS schedules (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  caregiver_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  client_id UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  schedule_type VARCHAR(50) DEFAULT 'recurring',
  day_of_week INTEGER,
  date DATE,
  start_time TIME NOT NULL,
  end_time TIME NOT NULL,
  notes TEXT,
  is_active BOOLEAN DEFAULT true,
  status VARCHAR(50) DEFAULT 'active',
  frequency VARCHAR(50) DEFAULT 'weekly',
  effective_date DATE,
  anchor_date DATE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Ensure open_shifts exists (needed by v3 ALTER)
CREATE TABLE IF NOT EXISTS open_shifts (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  client_id UUID REFERENCES clients(id) ON DELETE CASCADE,
  shift_date DATE NOT NULL,
  start_time TIME NOT NULL,
  end_time TIME NOT NULL,
  status VARCHAR(50) DEFAULT 'open',
  created_at TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE open_shifts ADD COLUMN IF NOT EXISTS source_absence_id UUID;
ALTER TABLE open_shifts ADD COLUMN IF NOT EXISTS notified_caregiver_count INTEGER DEFAULT 0;
ALTER TABLE open_shifts ADD COLUMN IF NOT EXISTS auto_created BOOLEAN DEFAULT false;

-- Ensure claims exists (needed by v4 ALTER)
CREATE TABLE IF NOT EXISTS claims (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  client_id UUID REFERENCES clients(id),
  service_date DATE,
  total_amount DECIMAL(10,2),
  paid_amount DECIMAL(10,2),
  status VARCHAR(50) DEFAULT 'pending',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ═══════════════════════════════════════════════════════════════════════════════
-- FIX 3: login_activity PK type conflict (SERIAL in schema.sql vs UUID in v6)
-- Standardize on UUID to match the rest of the app
-- ═══════════════════════════════════════════════════════════════════════════════
DO $$ BEGIN
  -- If login_activity has a SERIAL PK, recreate with UUID
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'login_activity' AND column_name = 'id' AND data_type = 'integer'
  ) THEN
    ALTER TABLE login_activity ALTER COLUMN id SET DATA TYPE UUID USING uuid_generate_v4();
    ALTER TABLE login_activity ALTER COLUMN id SET DEFAULT uuid_generate_v4();
  END IF;
END $$;

-- ═══════════════════════════════════════════════════════════════════════════════
-- FIX 4: migration_v10 references authorizations.referral_source_id (doesn't exist)
-- Add the column so the backfill can work
-- ═══════════════════════════════════════════════════════════════════════════════
ALTER TABLE authorizations ADD COLUMN IF NOT EXISTS referral_source_id UUID;

-- Now the v10 backfill can succeed:
UPDATE authorizations SET payer_id = referral_source_id
WHERE payer_id IS NULL AND referral_source_id IS NOT NULL;

-- ═══════════════════════════════════════════════════════════════════════════════
-- FIX 5: Ensure background_checks has all columns from both v5 and v8 definitions
-- ═══════════════════════════════════════════════════════════════════════════════
ALTER TABLE background_checks ADD COLUMN IF NOT EXISTS check_type VARCHAR(100);
ALTER TABLE background_checks ADD COLUMN IF NOT EXISTS provider VARCHAR(100);
ALTER TABLE background_checks ADD COLUMN IF NOT EXISTS cost DECIMAL(8,2);
ALTER TABLE background_checks ADD COLUMN IF NOT EXISTS initiated_date DATE;
ALTER TABLE background_checks ADD COLUMN IF NOT EXISTS expiration_date DATE;
ALTER TABLE background_checks ADD COLUMN IF NOT EXISTS notes TEXT;
ALTER TABLE background_checks ADD COLUMN IF NOT EXISTS created_by UUID;
ALTER TABLE background_checks ADD COLUMN IF NOT EXISTS submitted_date DATE;
ALTER TABLE background_checks ADD COLUMN IF NOT EXISTS completed_date DATE;
ALTER TABLE background_checks ADD COLUMN IF NOT EXISTS result VARCHAR(50);

-- ═══════════════════════════════════════════════════════════════════════════════
-- FIX 6: Ensure audit_logs has all columns referenced by code
-- ═══════════════════════════════════════════════════════════════════════════════
ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW();
ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS is_sensitive BOOLEAN DEFAULT false;
