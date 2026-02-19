-- ============================================================
-- Migration v4: Full Billing Integration
-- Sandata EVV + MIDAS Authorizations + EDI 837 + Remittance + Gusto
-- Run: psql $DATABASE_URL -f migration_v4.sql
-- ============================================================

-- ─── PAYER ENHANCEMENTS ───────────────────────────────────────────────────────
ALTER TABLE referral_sources
  ADD COLUMN IF NOT EXISTS payer_type VARCHAR(50) DEFAULT 'other',
  ADD COLUMN IF NOT EXISTS payer_id_number VARCHAR(100),
  ADD COLUMN IF NOT EXISTS npi VARCHAR(20),
  ADD COLUMN IF NOT EXISTS expected_pay_days INTEGER DEFAULT 30,
  ADD COLUMN IF NOT EXISTS is_active_payer BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS edi_payer_id VARCHAR(50),
  ADD COLUMN IF NOT EXISTS submission_method VARCHAR(30) DEFAULT 'manual';

UPDATE referral_sources SET payer_type='mco_family_care', is_active_payer=true WHERE LOWER(name) LIKE '%my choice%';
UPDATE referral_sources SET payer_type='mco_family_care', is_active_payer=true WHERE LOWER(name) LIKE '%inclusa%';
UPDATE referral_sources SET payer_type='mco_family_care', is_active_payer=true WHERE LOWER(name) LIKE '%lakeland%';
UPDATE referral_sources SET payer_type='managed_care', is_active_payer=true WHERE LOWER(name) LIKE '%molina%';
UPDATE referral_sources SET payer_type='medicaid', is_active_payer=true WHERE LOWER(name) LIKE '%forwardhealth%' OR LOWER(name) LIKE '%medicaid%';
UPDATE referral_sources SET payer_type='va', is_active_payer=true WHERE LOWER(name) LIKE '%veteran%';
UPDATE referral_sources SET payer_type='private_pay', is_active_payer=true WHERE type='private_pay' OR type='self_pay';

INSERT INTO referral_sources (id, name, type, payer_type, is_active_payer, edi_payer_id, expected_pay_days, state, submission_method) VALUES
  (uuid_generate_v4(),'My Choice Wisconsin','insurance','mco_family_care',true,'MYCWI',30,'WI','edi'),
  (uuid_generate_v4(),'Inclusa','insurance','mco_family_care',true,'INCWI',30,'WI','edi'),
  (uuid_generate_v4(),'Lakeland Care','insurance','mco_family_care',true,'LKWI',30,'WI','edi'),
  (uuid_generate_v4(),'Molina Healthcare of Wisconsin','insurance','managed_care',true,'MOLWI',30,'WI','edi'),
  (uuid_generate_v4(),'Wisconsin ForwardHealth (Medicaid)','insurance','medicaid',true,'WIMED',30,'WI','edi'),
  (uuid_generate_v4(),'Veterans Affairs (VA)','insurance','va',true,'USVHA',45,'WI','edi'),
  (uuid_generate_v4(),'Private Pay','private_pay','private_pay',true,null,14,'WI','manual')
ON CONFLICT DO NOTHING;

-- ─── CLIENT BILLING FIELDS ────────────────────────────────────────────────────
ALTER TABLE clients
  ADD COLUMN IF NOT EXISTS date_of_birth DATE,
  ADD COLUMN IF NOT EXISTS gender VARCHAR(10),
  ADD COLUMN IF NOT EXISTS evv_client_id VARCHAR(100),
  ADD COLUMN IF NOT EXISTS mco_member_id VARCHAR(100),
  ADD COLUMN IF NOT EXISTS primary_diagnosis_code VARCHAR(20),
  ADD COLUMN IF NOT EXISTS secondary_diagnosis_code VARCHAR(20);

-- ─── CAREGIVER BILLING FIELDS ─────────────────────────────────────────────────
ALTER TABLE caregiver_profiles
  ADD COLUMN IF NOT EXISTS taxonomy_code VARCHAR(20) DEFAULT '374700000X',
  ADD COLUMN IF NOT EXISTS evv_worker_id VARCHAR(100),
  ADD COLUMN IF NOT EXISTS medicaid_provider_id VARCHAR(100);

-- ─── SERVICE CODE MAPPING ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS service_codes (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  code VARCHAR(20) NOT NULL,
  modifier1 VARCHAR(10),
  modifier2 VARCHAR(10),
  description TEXT NOT NULL,
  service_category VARCHAR(50),
  payer_type VARCHAR(50) DEFAULT 'all',
  unit_type VARCHAR(20) DEFAULT '15min',
  rate_per_unit DECIMAL(8,4),
  requires_evv BOOLEAN DEFAULT true,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

INSERT INTO service_codes (code, modifier1, description, service_category, payer_type, unit_type, requires_evv) VALUES
  ('T1019',NULL,'Personal Care Services - per 15 min','personal_care','all','15min',true),
  ('T1019','U1','Personal Care - Supportive Home Care','personal_care','mco_family_care','15min',true),
  ('T1019','U2','Personal Care - Consumer Directed','personal_care','mco_family_care','15min',true),
  ('S5125',NULL,'Attendant Care Services - per 15 min','personal_care','all','15min',true),
  ('S5126',NULL,'Attendant Care Services - per diem','personal_care','all','day',true),
  ('S5130',NULL,'Homemaker Services - per 15 min','homemaker','all','15min',true),
  ('S5130','U1','Homemaker - Light Housekeeping','homemaker','mco_family_care','15min',true),
  ('S5135',NULL,'Companion Services - per 15 min','companion','all','15min',true),
  ('T1005',NULL,'Respite Care Services - per 15 min','respite','all','15min',true),
  ('T1005','HQ','Respite Care - Group Setting','respite','all','15min',true),
  ('G0299',NULL,'Direct Skilled Nursing - per visit','skilled_nursing','medicaid','visit',true),
  ('G0300',NULL,'Direct Skilled Nursing - per 15 min','skilled_nursing','medicaid','15min',true),
  ('99509',NULL,'Home Visit - Assistance with ADLs','personal_care','all','visit',true),
  ('T2025',NULL,'Waiver Services - Hourly','personal_care','mco_family_care','hour',true)
ON CONFLICT DO NOTHING;

ALTER TABLE care_types
  ADD COLUMN IF NOT EXISTS default_service_code VARCHAR(20),
  ADD COLUMN IF NOT EXISTS default_modifier VARCHAR(10),
  ADD COLUMN IF NOT EXISTS requires_evv BOOLEAN DEFAULT true;

-- ─── MIDAS AUTHORIZATIONS ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS authorizations (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  client_id UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  payer_id UUID REFERENCES referral_sources(id),
  auth_number VARCHAR(100),
  midas_auth_id VARCHAR(100),
  procedure_code VARCHAR(20),
  modifier VARCHAR(10),
  authorized_units DECIMAL(10,2) NOT NULL,
  unit_type VARCHAR(20) DEFAULT '15min',
  used_units DECIMAL(10,2) DEFAULT 0,
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  status VARCHAR(20) DEFAULT 'active',
  low_units_alert_threshold DECIMAL(10,2) DEFAULT 20,
  notes TEXT,
  imported_from VARCHAR(30) DEFAULT 'manual',
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_auth_client ON authorizations(client_id);
CREATE INDEX IF NOT EXISTS idx_auth_dates ON authorizations(start_date, end_date);
CREATE INDEX IF NOT EXISTS idx_auth_status ON authorizations(status);

-- ─── EVV VISITS ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS evv_visits (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  time_entry_id UUID NOT NULL REFERENCES time_entries(id) ON DELETE CASCADE,
  client_id UUID NOT NULL REFERENCES clients(id),
  caregiver_id UUID NOT NULL REFERENCES users(id),
  authorization_id UUID REFERENCES authorizations(id),
  service_code VARCHAR(20),
  modifier VARCHAR(10),
  service_date DATE NOT NULL,
  actual_start TIMESTAMPTZ NOT NULL,
  actual_end TIMESTAMPTZ,
  units_of_service DECIMAL(8,2),
  gps_in_lat DECIMAL(10,7),
  gps_in_lng DECIMAL(10,7),
  gps_out_lat DECIMAL(10,7),
  gps_out_lng DECIMAL(10,7),
  sandata_status VARCHAR(30) DEFAULT 'pending',
  sandata_visit_id VARCHAR(100),
  sandata_submitted_at TIMESTAMPTZ,
  sandata_response JSONB,
  sandata_exception_code VARCHAR(20),
  sandata_exception_desc TEXT,
  evv_method VARCHAR(20) DEFAULT 'gps',
  is_verified BOOLEAN DEFAULT false,
  verification_issues JSONB DEFAULT '[]',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(time_entry_id)
);

CREATE INDEX IF NOT EXISTS idx_evv_client_date ON evv_visits(client_id, service_date);
CREATE INDEX IF NOT EXISTS idx_evv_caregiver ON evv_visits(caregiver_id);
CREATE INDEX IF NOT EXISTS idx_evv_sandata ON evv_visits(sandata_status);

-- ─── FAILSAFE VALIDATION LOG ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS validation_log (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  entity_type VARCHAR(30) NOT NULL,
  entity_id UUID NOT NULL,
  validation_type VARCHAR(50) NOT NULL,
  status VARCHAR(20) NOT NULL,
  message TEXT,
  details JSONB,
  resolved_at TIMESTAMPTZ,
  resolved_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_validation_entity ON validation_log(entity_id, entity_type);
CREATE INDEX IF NOT EXISTS idx_validation_unresolved ON validation_log(status, created_at DESC) WHERE resolved_at IS NULL;

-- ─── EDI 837 BATCHES ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS edi_batches (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  payer_id UUID REFERENCES referral_sources(id),
  batch_number VARCHAR(50) UNIQUE NOT NULL,
  status VARCHAR(30) DEFAULT 'draft',
  claim_count INTEGER DEFAULT 0,
  total_billed DECIMAL(10,2) DEFAULT 0,
  edi_content TEXT,
  submitted_at TIMESTAMPTZ,
  response_code VARCHAR(20),
  response_message TEXT,
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE claims
  ADD COLUMN IF NOT EXISTS edi_batch_id UUID REFERENCES edi_batches(id),
  ADD COLUMN IF NOT EXISTS evv_visit_id UUID REFERENCES evv_visits(id),
  ADD COLUMN IF NOT EXISTS authorization_id UUID REFERENCES authorizations(id),
  ADD COLUMN IF NOT EXISTS allowed_amount DECIMAL(10,2),
  ADD COLUMN IF NOT EXISTS paid_amount DECIMAL(10,2),
  ADD COLUMN IF NOT EXISTS denial_code VARCHAR(50),
  ADD COLUMN IF NOT EXISTS denial_reason TEXT,
  ADD COLUMN IF NOT EXISTS submission_date DATE,
  ADD COLUMN IF NOT EXISTS paid_date DATE;

-- ─── REMITTANCE ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS remittance_batches (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  payer_id UUID REFERENCES referral_sources(id),
  payer_name VARCHAR(255) NOT NULL,
  payer_type VARCHAR(50) DEFAULT 'other',
  check_number VARCHAR(100),
  check_date DATE,
  payment_date DATE,
  total_amount DECIMAL(10,2) NOT NULL,
  raw_ocr_text TEXT,
  status VARCHAR(30) DEFAULT 'pending_match',
  notes TEXT,
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS remittance_line_items (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  batch_id UUID NOT NULL REFERENCES remittance_batches(id) ON DELETE CASCADE,
  client_id UUID REFERENCES clients(id),
  invoice_id UUID REFERENCES invoices(id),
  claim_id UUID REFERENCES claims(id),
  claim_number VARCHAR(100),
  service_date_from DATE,
  service_date_to DATE,
  billed_amount DECIMAL(10,2),
  allowed_amount DECIMAL(10,2),
  paid_amount DECIMAL(10,2) NOT NULL,
  adjustment_amount DECIMAL(10,2) DEFAULT 0,
  denial_code VARCHAR(50),
  denial_reason TEXT,
  match_status VARCHAR(30) DEFAULT 'unmatched',
  matched_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ─── GUSTO PAYROLL ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS gusto_sync_log (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  sync_type VARCHAR(30) NOT NULL,
  status VARCHAR(20) NOT NULL,
  pay_period_start DATE,
  pay_period_end DATE,
  records_exported INTEGER DEFAULT 0,
  gusto_response JSONB,
  error_message TEXT,
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS gusto_employee_map (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  gusto_employee_id VARCHAR(100),
  gusto_uuid VARCHAR(100),
  is_synced BOOLEAN DEFAULT false,
  last_synced_at TIMESTAMPTZ,
  UNIQUE(user_id)
);

-- ─── FINAL INDEXES ────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_remittance_payer ON remittance_batches(payer_id);
CREATE INDEX IF NOT EXISTS idx_remittance_lines_batch ON remittance_line_items(batch_id);
CREATE INDEX IF NOT EXISTS idx_edi_batches_status ON edi_batches(status);
CREATE INDEX IF NOT EXISTS idx_claims_edi ON claims(edi_batch_id);
CREATE INDEX IF NOT EXISTS idx_claims_evv ON claims(evv_visit_id);
CREATE INDEX IF NOT EXISTS idx_claims_auth ON claims(authorization_id);
