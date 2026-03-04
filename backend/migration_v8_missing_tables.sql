-- Migration v8: Create all missing tables referenced by route files
-- Also fixes column mismatches on existing tables
-- All statements use IF NOT EXISTS for safe re-runs

BEGIN;

-- ═══════════════════════════════════════════════════════════════════════════════
-- FIX EXISTING TABLES — add missing columns
-- ═══════════════════════════════════════════════════════════════════════════════

-- audit_logs: code uses created_at (not timestamp) and is_sensitive
ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW();
ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS is_sensitive BOOLEAN DEFAULT false;

-- clients: routes reference these columns
ALTER TABLE clients ADD COLUMN IF NOT EXISTS referral_source_id UUID REFERENCES referral_sources(id);
ALTER TABLE clients ADD COLUMN IF NOT EXISTS care_type_id UUID;
ALTER TABLE clients ADD COLUMN IF NOT EXISTS is_private_pay BOOLEAN DEFAULT false;
ALTER TABLE clients ADD COLUMN IF NOT EXISTS private_pay_rate DECIMAL(10,2);
ALTER TABLE clients ADD COLUMN IF NOT EXISTS private_pay_rate_type VARCHAR(50);
ALTER TABLE clients ADD COLUMN IF NOT EXISTS weekly_authorized_units DECIMAL(10,2);

-- ═══════════════════════════════════════════════════════════════════════════════
-- SCHEDULING & SHIFTS
-- ═══════════════════════════════════════════════════════════════════════════════

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
CREATE INDEX IF NOT EXISTS idx_schedules_caregiver ON schedules(caregiver_id);
CREATE INDEX IF NOT EXISTS idx_schedules_client ON schedules(client_id);
CREATE INDEX IF NOT EXISTS idx_schedules_date ON schedules(date);

CREATE TABLE IF NOT EXISTS open_shifts (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  client_id UUID REFERENCES clients(id) ON DELETE CASCADE,
  schedule_id UUID REFERENCES schedules(id) ON DELETE SET NULL,
  shift_date DATE NOT NULL,
  start_time TIME NOT NULL,
  end_time TIME NOT NULL,
  care_type_id UUID,
  hourly_rate DECIMAL(10,2),
  bonus_amount DECIMAL(10,2) DEFAULT 0,
  notes TEXT,
  urgency VARCHAR(20) DEFAULT 'normal',
  status VARCHAR(50) DEFAULT 'open',
  claimed_by UUID REFERENCES users(id),
  approved_by UUID REFERENCES users(id),
  created_by UUID REFERENCES users(id),
  broadcast_sent BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_open_shifts_status ON open_shifts(status);
CREATE INDEX IF NOT EXISTS idx_open_shifts_date ON open_shifts(shift_date);

CREATE TABLE IF NOT EXISTS open_shift_claims (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  open_shift_id UUID NOT NULL REFERENCES open_shifts(id) ON DELETE CASCADE,
  caregiver_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  notes TEXT,
  status VARCHAR(50) DEFAULT 'pending',
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_open_shift_claims_shift ON open_shift_claims(open_shift_id);

CREATE TABLE IF NOT EXISTS shift_swap_requests (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  schedule_id UUID REFERENCES schedules(id) ON DELETE CASCADE,
  requesting_caregiver_id UUID NOT NULL REFERENCES users(id),
  target_caregiver_id UUID REFERENCES users(id),
  shift_date DATE NOT NULL,
  reason TEXT,
  status VARCHAR(50) DEFAULT 'pending',
  responded_at TIMESTAMPTZ,
  notes TEXT,
  admin_approved_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_shift_swaps_status ON shift_swap_requests(status);

-- ═══════════════════════════════════════════════════════════════════════════════
-- CLINICAL & CARE
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS care_plans (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  client_id UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  service_type VARCHAR(100),
  service_description TEXT,
  frequency VARCHAR(100),
  care_goals TEXT,
  special_instructions TEXT,
  precautions TEXT,
  medication_notes TEXT,
  mobility_notes TEXT,
  dietary_notes TEXT,
  communication_notes TEXT,
  start_date DATE,
  end_date DATE,
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_care_plans_client ON care_plans(client_id);

CREATE TABLE IF NOT EXISTS care_types (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name VARCHAR(255) NOT NULL,
  description TEXT,
  is_active BOOLEAN DEFAULT true,
  default_service_code VARCHAR(50),
  default_modifier VARCHAR(50),
  requires_evv BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Now add the FK on clients.care_type_id if care_types exists
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'fk_clients_care_type'
  ) THEN
    BEGIN
      ALTER TABLE clients ADD CONSTRAINT fk_clients_care_type
        FOREIGN KEY (care_type_id) REFERENCES care_types(id) ON DELETE SET NULL;
    EXCEPTION WHEN others THEN NULL;
    END;
  END IF;
END $$;

-- Also add FK on open_shifts.care_type_id
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'fk_open_shifts_care_type'
  ) THEN
    BEGIN
      ALTER TABLE open_shifts ADD CONSTRAINT fk_open_shifts_care_type
        FOREIGN KEY (care_type_id) REFERENCES care_types(id) ON DELETE SET NULL;
    EXCEPTION WHEN others THEN NULL;
    END;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS client_medications (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  client_id UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  medication_name VARCHAR(255) NOT NULL,
  dosage VARCHAR(100),
  frequency VARCHAR(100),
  route VARCHAR(100),
  prescriber VARCHAR(255),
  pharmacy VARCHAR(255),
  rx_number VARCHAR(100),
  start_date DATE,
  end_date DATE,
  instructions TEXT,
  side_effects TEXT,
  is_prn BOOLEAN DEFAULT false,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_client_medications_client ON client_medications(client_id);

CREATE TABLE IF NOT EXISTS medication_logs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  client_id UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  medication_id UUID REFERENCES client_medications(id) ON DELETE SET NULL,
  caregiver_id UUID REFERENCES users(id),
  time_entry_id UUID REFERENCES time_entries(id) ON DELETE SET NULL,
  scheduled_time TIMESTAMPTZ,
  administered_time TIMESTAMPTZ,
  status VARCHAR(50) DEFAULT 'administered',
  dosage_given VARCHAR(100),
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_medication_logs_client ON medication_logs(client_id);

CREATE TABLE IF NOT EXISTS client_adl_requirements (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  client_id UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  adl_category VARCHAR(100) NOT NULL,
  assistance_level VARCHAR(50),
  frequency VARCHAR(100),
  special_instructions TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_adl_requirements_client ON client_adl_requirements(client_id);

CREATE TABLE IF NOT EXISTS adl_logs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  client_id UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  caregiver_id UUID REFERENCES users(id),
  time_entry_id UUID REFERENCES time_entries(id) ON DELETE SET NULL,
  adl_category VARCHAR(100) NOT NULL,
  status VARCHAR(50) DEFAULT 'completed',
  assistance_level VARCHAR(50),
  performed_at TIMESTAMPTZ DEFAULT NOW(),
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_adl_logs_client ON adl_logs(client_id);

CREATE TABLE IF NOT EXISTS incident_reports (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  client_id UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  caregiver_id UUID REFERENCES users(id),
  incident_type VARCHAR(100) NOT NULL,
  severity VARCHAR(50) DEFAULT 'moderate',
  incident_date DATE,
  incident_time TIME,
  description TEXT NOT NULL,
  witnesses TEXT,
  injuries_or_damage TEXT,
  actions_taken TEXT,
  follow_up_required BOOLEAN DEFAULT false,
  follow_up_notes TEXT,
  reported_by VARCHAR(255),
  reported_date DATE,
  reported_by_user_id UUID REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_incident_reports_client ON incident_reports(client_id);
CREATE INDEX IF NOT EXISTS idx_incident_reports_date ON incident_reports(incident_date);

-- ═══════════════════════════════════════════════════════════════════════════════
-- CAREGIVER MANAGEMENT
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS caregiver_certifications (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  caregiver_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  certification_name VARCHAR(255) NOT NULL,
  certification_number VARCHAR(100),
  certification_type VARCHAR(100),
  issuer VARCHAR(255),
  issued_date DATE,
  expiration_date DATE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_caregiver_certs_caregiver ON caregiver_certifications(caregiver_id);
CREATE INDEX IF NOT EXISTS idx_caregiver_certs_expiry ON caregiver_certifications(expiration_date);

CREATE TABLE IF NOT EXISTS caregiver_blackout_dates (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  caregiver_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  reason TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_blackout_dates_caregiver ON caregiver_blackout_dates(caregiver_id);

CREATE TABLE IF NOT EXISTS caregiver_pay_rates (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  caregiver_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  base_hourly_rate DECIMAL(10,2),
  overtime_rate DECIMAL(10,2),
  premium_rate DECIMAL(10,2),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_pay_rates_caregiver ON caregiver_pay_rates(caregiver_id);

CREATE TABLE IF NOT EXISTS caregiver_care_type_rates (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  caregiver_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  care_type_id UUID REFERENCES care_types(id) ON DELETE CASCADE,
  hourly_rate DECIMAL(10,2) NOT NULL,
  is_active BOOLEAN DEFAULT true,
  start_date DATE,
  end_date DATE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_care_type_rates_caregiver ON caregiver_care_type_rates(caregiver_id);

CREATE TABLE IF NOT EXISTS training_records (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  caregiver_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  training_type VARCHAR(255) NOT NULL,
  completion_date DATE,
  expiration_date DATE,
  certification_number VARCHAR(100),
  provider VARCHAR(255),
  status VARCHAR(50) DEFAULT 'completed',
  recorded_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_training_records_caregiver ON training_records(caregiver_id);
CREATE INDEX IF NOT EXISTS idx_training_records_expiry ON training_records(expiration_date);

CREATE TABLE IF NOT EXISTS compliance_documents (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  caregiver_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  document_type VARCHAR(100) NOT NULL,
  document_name VARCHAR(255),
  expiration_date DATE,
  file_url TEXT,
  notes TEXT,
  uploaded_by UUID REFERENCES users(id),
  upload_date DATE DEFAULT CURRENT_DATE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_compliance_docs_caregiver ON compliance_documents(caregiver_id);
CREATE INDEX IF NOT EXISTS idx_compliance_docs_expiry ON compliance_documents(expiration_date);

CREATE TABLE IF NOT EXISTS performance_reviews (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  caregiver_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  client_id UUID REFERENCES clients(id) ON DELETE SET NULL,
  review_date DATE DEFAULT CURRENT_DATE,
  performance_notes TEXT,
  strengths TEXT,
  areas_for_improvement TEXT,
  overall_assessment VARCHAR(50) DEFAULT 'satisfactory',
  reviewed_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_perf_reviews_caregiver ON performance_reviews(caregiver_id);

CREATE TABLE IF NOT EXISTS background_checks (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  caregiver_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  check_type VARCHAR(100) NOT NULL,
  status VARCHAR(50) DEFAULT 'pending',
  submitted_date DATE,
  completed_date DATE,
  expiration_date DATE,
  result VARCHAR(50),
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_bg_checks_caregiver ON background_checks(caregiver_id);
CREATE INDEX IF NOT EXISTS idx_bg_checks_expiry ON background_checks(expiration_date);

-- ═══════════════════════════════════════════════════════════════════════════════
-- BILLING & FINANCIAL
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS claims (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  invoice_id UUID REFERENCES invoices(id) ON DELETE SET NULL,
  claim_number VARCHAR(100),
  payer_id UUID,
  client_id UUID REFERENCES clients(id) ON DELETE CASCADE,
  service_date_from DATE,
  service_date_to DATE,
  place_of_service VARCHAR(10),
  procedure_code VARCHAR(20),
  modifier VARCHAR(20),
  diagnosis_code VARCHAR(20),
  units DECIMAL(10,2),
  charge_amount DECIMAL(12,2),
  status VARCHAR(50) DEFAULT 'draft',
  submitted_date DATE,
  paid_date DATE,
  paid_amount DECIMAL(12,2),
  denial_reason TEXT,
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_claims_status ON claims(status);
CREATE INDEX IF NOT EXISTS idx_claims_client ON claims(client_id);

CREATE TABLE IF NOT EXISTS claim_status_history (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  claim_id UUID NOT NULL REFERENCES claims(id) ON DELETE CASCADE,
  status VARCHAR(50) NOT NULL,
  notes TEXT,
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_claim_history_claim ON claim_status_history(claim_id);

CREATE TABLE IF NOT EXISTS payroll (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  payroll_number VARCHAR(100),
  pay_period_start DATE NOT NULL,
  pay_period_end DATE NOT NULL,
  total_hours DECIMAL(10,2),
  gross_pay DECIMAL(12,2),
  taxes DECIMAL(12,2) DEFAULT 0,
  net_pay DECIMAL(12,2),
  status VARCHAR(50) DEFAULT 'draft',
  processed_date DATE,
  payment_method VARCHAR(50),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_payroll_status ON payroll(status);
CREATE INDEX IF NOT EXISTS idx_payroll_period ON payroll(pay_period_start, pay_period_end);

CREATE TABLE IF NOT EXISTS payroll_records (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  caregiver_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  period_start DATE NOT NULL,
  period_end DATE NOT NULL,
  status VARCHAR(50) DEFAULT 'pending',
  approved_by UUID REFERENCES users(id),
  check_number VARCHAR(100),
  processed_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_payroll_records_caregiver ON payroll_records(caregiver_id);

CREATE TABLE IF NOT EXISTS payroll_line_items (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  payroll_id UUID NOT NULL REFERENCES payroll(id) ON DELETE CASCADE,
  caregiver_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  description VARCHAR(255),
  total_hours DECIMAL(10,2),
  hourly_rate DECIMAL(10,2),
  gross_amount DECIMAL(12,2),
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_payroll_items_payroll ON payroll_line_items(payroll_id);

CREATE TABLE IF NOT EXISTS expenses (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  expense_date DATE NOT NULL,
  category VARCHAR(100),
  description TEXT,
  amount DECIMAL(12,2) NOT NULL,
  payment_method VARCHAR(50),
  notes TEXT,
  receipt_url TEXT,
  submitted_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_expenses_date ON expenses(expense_date);

CREATE TABLE IF NOT EXISTS mileage (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  caregiver_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  date DATE NOT NULL,
  miles DECIMAL(10,2) NOT NULL,
  from_location VARCHAR(255),
  to_location VARCHAR(255),
  notes TEXT,
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_mileage_caregiver ON mileage(caregiver_id);
CREATE INDEX IF NOT EXISTS idx_mileage_date ON mileage(date);

CREATE TABLE IF NOT EXISTS pto (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  caregiver_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type VARCHAR(50) NOT NULL,
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  hours DECIMAL(10,2),
  notes TEXT,
  status VARCHAR(50) DEFAULT 'pending',
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_pto_caregiver ON pto(caregiver_id);
CREATE INDEX IF NOT EXISTS idx_pto_dates ON pto(start_date, end_date);

CREATE TABLE IF NOT EXISTS invoice_payments (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  invoice_id UUID NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  amount DECIMAL(12,2) NOT NULL,
  payment_date DATE NOT NULL,
  payment_method VARCHAR(50),
  reference_number VARCHAR(100),
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_invoice_payments_invoice ON invoice_payments(invoice_id);

CREATE TABLE IF NOT EXISTS invoice_adjustments (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  invoice_id UUID NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  adjustment_type VARCHAR(50) NOT NULL,
  amount DECIMAL(12,2) NOT NULL,
  reason TEXT,
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_invoice_adjustments_invoice ON invoice_adjustments(invoice_id);

CREATE TABLE IF NOT EXISTS service_pricing (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  service_name VARCHAR(255) NOT NULL,
  description TEXT,
  client_hourly_rate DECIMAL(10,2),
  caregiver_hourly_rate DECIMAL(10,2),
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS referral_source_rates (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  referral_source_id UUID NOT NULL REFERENCES referral_sources(id) ON DELETE CASCADE,
  rate_amount DECIMAL(10,2) NOT NULL,
  effective_date DATE DEFAULT CURRENT_DATE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_referral_rates_source ON referral_source_rates(referral_source_id);

-- ═══════════════════════════════════════════════════════════════════════════════
-- DOCUMENTS & FORMS
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS documents (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  entity_type VARCHAR(50) NOT NULL,
  entity_id UUID NOT NULL,
  document_type VARCHAR(100),
  name VARCHAR(255) NOT NULL,
  description TEXT,
  file_url TEXT,
  file_type VARCHAR(50),
  file_size INTEGER,
  requires_signature BOOLEAN DEFAULT false,
  expiration_date DATE,
  is_confidential BOOLEAN DEFAULT false,
  uploaded_by UUID REFERENCES users(id),
  signed_at TIMESTAMPTZ,
  signed_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_documents_entity ON documents(entity_type, entity_id);

CREATE TABLE IF NOT EXISTS document_acknowledgments (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  document_id UUID NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  ip_address VARCHAR(45),
  signature_data TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_doc_acks_document ON document_acknowledgments(document_id);

-- ═══════════════════════════════════════════════════════════════════════════════
-- COMMUNICATIONS
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS sms_messages (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  recipient_type VARCHAR(50),
  recipient_id UUID,
  to_number VARCHAR(20) NOT NULL,
  from_number VARCHAR(20),
  body TEXT NOT NULL,
  direction VARCHAR(10) DEFAULT 'outbound',
  status VARCHAR(50) DEFAULT 'queued',
  twilio_sid VARCHAR(100),
  sent_at TIMESTAMPTZ,
  error_message TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_sms_messages_recipient ON sms_messages(recipient_type, recipient_id);
CREATE INDEX IF NOT EXISTS idx_sms_messages_status ON sms_messages(status);

CREATE TABLE IF NOT EXISTS sms_templates (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name VARCHAR(255) NOT NULL,
  slug VARCHAR(100) UNIQUE,
  body TEXT NOT NULL,
  category VARCHAR(100),
  variables JSONB,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS family_members (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  client_id UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  user_id UUID REFERENCES users(id),
  first_name VARCHAR(255) NOT NULL,
  last_name VARCHAR(255) NOT NULL,
  email VARCHAR(255),
  phone VARCHAR(20),
  relationship VARCHAR(100),
  can_view_schedule BOOLEAN DEFAULT true,
  can_view_care_plan BOOLEAN DEFAULT true,
  can_view_medications BOOLEAN DEFAULT false,
  can_message BOOLEAN DEFAULT true,
  is_active BOOLEAN DEFAULT true,
  is_primary_contact BOOLEAN DEFAULT false,
  last_login TIMESTAMPTZ,
  password_hash VARCHAR(255),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_family_members_client ON family_members(client_id);

CREATE TABLE IF NOT EXISTS family_messages (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  client_id UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  family_member_id UUID NOT NULL REFERENCES family_members(id) ON DELETE CASCADE,
  direction VARCHAR(10) DEFAULT 'inbound',
  subject VARCHAR(255),
  message TEXT NOT NULL,
  reply TEXT,
  replied_at TIMESTAMPTZ,
  replied_by UUID REFERENCES users(id),
  is_read BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_family_messages_client ON family_messages(client_id);

-- ═══════════════════════════════════════════════════════════════════════════════
-- APPLICATIONS & PROSPECTS
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS job_applications (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  first_name VARCHAR(255) NOT NULL,
  last_name VARCHAR(255) NOT NULL,
  email VARCHAR(255),
  phone VARCHAR(20),
  address TEXT,
  city VARCHAR(100),
  state VARCHAR(2),
  zip VARCHAR(10),
  date_of_birth DATE,
  ssn_last_four VARCHAR(4),
  drivers_license BOOLEAN DEFAULT false,
  reliable_transportation BOOLEAN DEFAULT false,
  years_experience INTEGER DEFAULT 0,
  certifications TEXT[],
  availability TEXT,
  preferred_shift VARCHAR(50),
  can_work_weekends BOOLEAN DEFAULT false,
  can_work_nights BOOLEAN DEFAULT false,
  emergency_contact_name VARCHAR(255),
  emergency_contact_phone VARCHAR(20),
  references_info JSONB,
  education TEXT,
  previous_employment JSONB,
  felony_conviction BOOLEAN DEFAULT false,
  felony_explanation TEXT,
  how_heard VARCHAR(255),
  additional_notes TEXT,
  status VARCHAR(50) DEFAULT 'new',
  interview_date TIMESTAMPTZ,
  interview_notes TEXT,
  hired_caregiver_id UUID REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_job_applications_status ON job_applications(status);

CREATE TABLE IF NOT EXISTS application_status_history (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  application_id UUID NOT NULL REFERENCES job_applications(id) ON DELETE CASCADE,
  status VARCHAR(50) NOT NULL,
  notes TEXT,
  changed_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_app_status_history_app ON application_status_history(application_id);

CREATE TABLE IF NOT EXISTS prospects (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  first_name VARCHAR(255) NOT NULL,
  last_name VARCHAR(255) NOT NULL,
  phone VARCHAR(20),
  email VARCHAR(255),
  address TEXT,
  city VARCHAR(100),
  state VARCHAR(2),
  notes TEXT,
  source VARCHAR(100),
  status VARCHAR(50) DEFAULT 'new',
  converted_client_id UUID REFERENCES clients(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_prospects_status ON prospects(status);

CREATE TABLE IF NOT EXISTS prospect_appointments (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  prospect_id UUID NOT NULL REFERENCES prospects(id) ON DELETE CASCADE,
  caregiver_id UUID REFERENCES users(id),
  appointment_date DATE NOT NULL,
  start_time TIME,
  end_time TIME,
  appointment_type VARCHAR(100),
  location TEXT,
  notes TEXT,
  status VARCHAR(50) DEFAULT 'scheduled',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_prospect_appts_prospect ON prospect_appointments(prospect_id);

-- ═══════════════════════════════════════════════════════════════════════════════
-- ALERTS & NOTIFICATIONS
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS alerts (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  alert_type VARCHAR(100) NOT NULL,
  priority VARCHAR(20) DEFAULT 'medium',
  message TEXT NOT NULL,
  due_date DATE,
  status VARCHAR(50) DEFAULT 'active',
  related_entity_type VARCHAR(50),
  related_entity_id UUID,
  created_by UUID REFERENCES users(id),
  acknowledged_by UUID REFERENCES users(id),
  acknowledged_at TIMESTAMPTZ,
  resolved_by UUID REFERENCES users(id),
  resolved_at TIMESTAMPTZ,
  resolution TEXT,
  dismissed BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_alerts_status ON alerts(status);
CREATE INDEX IF NOT EXISTS idx_alerts_type ON alerts(alert_type);

CREATE TABLE IF NOT EXISTS certification_alerts (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  caregiver_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  certification_id UUID REFERENCES caregiver_certifications(id) ON DELETE CASCADE,
  alert_type VARCHAR(100) NOT NULL,
  acknowledged BOOLEAN DEFAULT false,
  alert_date DATE DEFAULT CURRENT_DATE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_cert_alerts_caregiver ON certification_alerts(caregiver_id);

CREATE TABLE IF NOT EXISTS notification_settings (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  email_enabled BOOLEAN DEFAULT true,
  schedule_alerts BOOLEAN DEFAULT true,
  payroll_alerts BOOLEAN DEFAULT true,
  absence_alerts BOOLEAN DEFAULT true,
  payment_alerts BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ═══════════════════════════════════════════════════════════════════════════════
-- ROUTE OPTIMIZATION
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS route_plans (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  caregiver_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  plan_date DATE NOT NULL,
  total_distance DECIMAL(10,2),
  total_time INTEGER,
  stop_count INTEGER DEFAULT 0,
  status VARCHAR(50) DEFAULT 'draft',
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_route_plans_caregiver ON route_plans(caregiver_id);
CREATE INDEX IF NOT EXISTS idx_route_plans_date ON route_plans(plan_date);

CREATE TABLE IF NOT EXISTS route_plan_stops (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  route_plan_id UUID NOT NULL REFERENCES route_plans(id) ON DELETE CASCADE,
  stop_order INTEGER NOT NULL,
  client_id UUID REFERENCES clients(id),
  scheduled_visit_id UUID,
  arrival_time TIME,
  departure_time TIME,
  distance_from_prev DECIMAL(10,2),
  time_from_prev INTEGER,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_route_stops_plan ON route_plan_stops(route_plan_id);

-- ═══════════════════════════════════════════════════════════════════════════════
-- MATCHING / OPTIMIZATION
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS optimizer_runs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  run_type VARCHAR(100),
  status VARCHAR(50) DEFAULT 'running',
  parameters JSONB,
  results JSONB,
  score DECIMAL(10,4),
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  completed_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS client_service_needs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  client_id UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  service_type VARCHAR(100) NOT NULL,
  priority VARCHAR(20) DEFAULT 'medium',
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_service_needs_client ON client_service_needs(client_id);

CREATE TABLE IF NOT EXISTS client_caregiver_restrictions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  client_id UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  caregiver_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  restriction_type VARCHAR(50) NOT NULL,
  reason TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_restrictions_client ON client_caregiver_restrictions(client_id);
CREATE INDEX IF NOT EXISTS idx_restrictions_caregiver ON client_caregiver_restrictions(caregiver_id);

CREATE TABLE IF NOT EXISTS service_capabilities (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name VARCHAR(255) NOT NULL,
  description TEXT,
  category VARCHAR(100),
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS caregiver_capabilities (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  caregiver_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  capability_id UUID NOT NULL REFERENCES service_capabilities(id) ON DELETE CASCADE,
  proficiency_level VARCHAR(50) DEFAULT 'competent',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(caregiver_id, capability_id)
);
CREATE INDEX IF NOT EXISTS idx_caregiver_caps_caregiver ON caregiver_capabilities(caregiver_id);

-- ═══════════════════════════════════════════════════════════════════════════════
-- AUTHORIZATIONS (referenced by billing routes)
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS authorizations (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  client_id UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  authorization_number VARCHAR(100),
  payer_name VARCHAR(255),
  service_type VARCHAR(100),
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  total_units DECIMAL(10,2),
  used_units DECIMAL(10,2) DEFAULT 0,
  remaining_units DECIMAL(10,2),
  status VARCHAR(50) DEFAULT 'active',
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_authorizations_client ON authorizations(client_id);
CREATE INDEX IF NOT EXISTS idx_authorizations_status ON authorizations(status);

-- ═══════════════════════════════════════════════════════════════════════════════
-- CLIENT PORTAL (referenced by clientPortalRoutes)
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS client_portal_accounts (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  client_id UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  email VARCHAR(255) UNIQUE NOT NULL,
  password_hash VARCHAR(255),
  is_active BOOLEAN DEFAULT true,
  last_login TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_client_portal_client ON client_portal_accounts(client_id);

COMMIT;
