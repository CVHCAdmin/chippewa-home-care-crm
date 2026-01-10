-- Chippewa Valley Home Care CRM - PostgreSQL Schema
-- HIPAA-compliant database structure

-- Enable extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- Audit log table (HIPAA requirement)
CREATE TABLE audit_logs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL,
  action VARCHAR(255) NOT NULL,
  table_name VARCHAR(255),
  record_id UUID,
  old_data JSONB,
  new_data JSONB,
  ip_address VARCHAR(45),
  timestamp TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_audit_logs_user_id ON audit_logs(user_id);
CREATE INDEX idx_audit_logs_timestamp ON audit_logs(timestamp);

-- Users table (Admins & Caregivers)
CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  email VARCHAR(255) UNIQUE NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  first_name VARCHAR(255) NOT NULL,
  last_name VARCHAR(255) NOT NULL,
  phone VARCHAR(20),
  role VARCHAR(50) NOT NULL DEFAULT 'caregiver', -- 'admin' or 'caregiver'
  is_active BOOLEAN DEFAULT true,
  certifications TEXT[], -- Array of cert names
  certifications_expiry DATE[],
  emergency_contact_name VARCHAR(255),
  emergency_contact_phone VARCHAR(20),
  hire_date DATE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_users_email ON users(email);
CREATE INDEX idx_users_role ON users(role);
CREATE INDEX idx_users_is_active ON users(is_active);

-- Caregiver Availability/Schedule
CREATE TABLE caregiver_schedules (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  caregiver_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  day_of_week INTEGER, -- 0-6 (Sunday-Saturday) for recurring, NULL for specific dates
  date DATE, -- For one-off schedules
  start_time TIME,
  end_time TIME,
  is_available BOOLEAN DEFAULT true,
  max_hours_per_week INTEGER DEFAULT 40,
  overtime_approved BOOLEAN DEFAULT false,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_caregiver_schedules_caregiver_id ON caregiver_schedules(caregiver_id);
CREATE INDEX idx_caregiver_schedules_date ON caregiver_schedules(date);

-- Time Off/Vacation/Sick
CREATE TABLE caregiver_time_off (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  caregiver_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  type VARCHAR(50) NOT NULL, -- 'vacation', 'sick', 'other'
  reason TEXT,
  approved_by UUID REFERENCES users(id),
  status VARCHAR(50) DEFAULT 'pending', -- 'pending', 'approved', 'rejected'
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_caregiver_time_off_caregiver_id ON caregiver_time_off(caregiver_id);
CREATE INDEX idx_caregiver_time_off_dates ON caregiver_time_off(start_date, end_date);

-- Referral Sources
CREATE TABLE referral_sources (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name VARCHAR(255) NOT NULL,
  type VARCHAR(50), -- 'hospital', 'doctor', 'agency', 'social_services', 'family'
  contact_name VARCHAR(255),
  email VARCHAR(255),
  phone VARCHAR(20),
  address TEXT,
  city VARCHAR(100),
  state VARCHAR(2),
  zip VARCHAR(10),
  notes TEXT,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_referral_sources_type ON referral_sources(type);
CREATE INDEX idx_referral_sources_is_active ON referral_sources(is_active);

-- Clients
CREATE TABLE clients (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  first_name VARCHAR(255) NOT NULL,
  last_name VARCHAR(255) NOT NULL,
  date_of_birth DATE,
  ssn_encrypted VARCHAR(255), -- Encrypted
  gender VARCHAR(20),
  address TEXT,
  city VARCHAR(100),
  state VARCHAR(2),
  zip VARCHAR(10),
  phone VARCHAR(20),
  email VARCHAR(255),
  referred_by UUID REFERENCES referral_sources(id),
  referral_date DATE,
  start_date DATE,
  is_active BOOLEAN DEFAULT true,
  service_type VARCHAR(100), -- 'personal_care', 'companionship', 'respite_care', etc.
  insurance_provider VARCHAR(255),
  insurance_id VARCHAR(255),
  insurance_group VARCHAR(255),
  medical_conditions TEXT[],
  allergies TEXT[],
  medications TEXT[],
  preferred_caregivers UUID[],
  do_not_use_caregivers UUID[],
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_clients_is_active ON clients(is_active);
CREATE INDEX idx_clients_referred_by ON clients(referred_by);
CREATE INDEX idx_clients_start_date ON clients(start_date);

-- Emergency Contacts for Clients
CREATE TABLE client_emergency_contacts (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  client_id UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  name VARCHAR(255) NOT NULL,
  relationship VARCHAR(100),
  phone VARCHAR(20) NOT NULL,
  email VARCHAR(255),
  is_primary BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_client_emergency_contacts_client_id ON client_emergency_contacts(client_id);

-- Client Onboarding Checklist
CREATE TABLE client_onboarding (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  client_id UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  emergency_contacts_completed BOOLEAN DEFAULT false,
  medical_history_completed BOOLEAN DEFAULT false,
  insurance_info_completed BOOLEAN DEFAULT false,
  care_preferences_completed BOOLEAN DEFAULT false,
  family_communication_plan_completed BOOLEAN DEFAULT false,
  initial_assessment_completed BOOLEAN DEFAULT false,
  all_completed BOOLEAN DEFAULT false,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_client_onboarding_client_id ON client_onboarding(client_id);

-- Client-Caregiver Assignments
CREATE TABLE client_assignments (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  client_id UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  caregiver_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  assignment_date DATE NOT NULL,
  hours_per_week DECIMAL(5,2),
  pay_rate DECIMAL(10,2),
  status VARCHAR(50) DEFAULT 'active', -- 'active', 'paused', 'completed'
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_client_assignments_client_id ON client_assignments(client_id);
CREATE INDEX idx_client_assignments_caregiver_id ON client_assignments(caregiver_id);
CREATE INDEX idx_client_assignments_status ON client_assignments(status);

-- Time Tracking (with GPS)
CREATE TABLE time_entries (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  caregiver_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  client_id UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  assignment_id UUID REFERENCES client_assignments(id),
  start_time TIMESTAMPTZ NOT NULL,
  end_time TIMESTAMPTZ,
  duration_minutes INTEGER,
  clock_in_location JSONB, -- {lat, lng, accuracy}
  clock_out_location JSONB,
  is_complete BOOLEAN DEFAULT false,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_time_entries_caregiver_id ON time_entries(caregiver_id);
CREATE INDEX idx_time_entries_client_id ON time_entries(client_id);
CREATE INDEX idx_time_entries_start_time ON time_entries(start_time);

-- GPS Tracking (continuous location during shift)
CREATE TABLE gps_tracking (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  caregiver_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  time_entry_id UUID REFERENCES time_entries(id),
  latitude DECIMAL(10,8) NOT NULL,
  longitude DECIMAL(11,8) NOT NULL,
  accuracy INTEGER, -- meters
  speed DECIMAL(6,2),
  heading INTEGER,
  timestamp TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_gps_tracking_caregiver_id ON gps_tracking(caregiver_id);
CREATE INDEX idx_gps_tracking_time_entry_id ON gps_tracking(time_entry_id);
CREATE INDEX idx_gps_tracking_timestamp ON gps_tracking(timestamp);

-- Invoices
CREATE TABLE invoices (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  invoice_number VARCHAR(50) UNIQUE NOT NULL,
  client_id UUID NOT NULL REFERENCES clients(id),
  billing_period_start DATE NOT NULL,
  billing_period_end DATE NOT NULL,
  subtotal DECIMAL(12,2) NOT NULL,
  tax DECIMAL(12,2) DEFAULT 0,
  total DECIMAL(12,2) NOT NULL,
  payment_status VARCHAR(50) DEFAULT 'pending', -- 'pending', 'paid', 'overdue', 'partial'
  payment_due_date DATE,
  payment_date DATE,
  payment_method VARCHAR(100),
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_invoices_client_id ON invoices(client_id);
CREATE INDEX idx_invoices_payment_status ON invoices(payment_status);
CREATE INDEX idx_invoices_billing_period ON invoices(billing_period_start, billing_period_end);

-- Invoice Line Items
CREATE TABLE invoice_line_items (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  invoice_id UUID NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  time_entry_id UUID REFERENCES time_entries(id),
  caregiver_id UUID NOT NULL REFERENCES users(id),
  description VARCHAR(255) NOT NULL,
  hours DECIMAL(6,2) NOT NULL,
  rate DECIMAL(10,2) NOT NULL,
  amount DECIMAL(12,2) NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_invoice_line_items_invoice_id ON invoice_line_items(invoice_id);

-- Caregiver Performance Ratings
CREATE TABLE performance_ratings (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  caregiver_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  client_id UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  rating_date DATE DEFAULT TODAY(),
  satisfaction_score INTEGER CHECK (satisfaction_score >= 1 AND satisfaction_score <= 5),
  punctuality_score INTEGER CHECK (punctuality_score >= 1 AND punctuality_score <= 5),
  professionalism_score INTEGER CHECK (professionalism_score >= 1 AND professionalism_score <= 5),
  care_quality_score INTEGER CHECK (care_quality_score >= 1 AND care_quality_score <= 5),
  comments TEXT,
  no_shows INTEGER DEFAULT 0,
  late_arrivals INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_performance_ratings_caregiver_id ON performance_ratings(caregiver_id);
CREATE INDEX idx_performance_ratings_client_id ON performance_ratings(client_id);

-- Notifications
CREATE TABLE notifications (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type VARCHAR(100), -- 'schedule_alert', 'absence_alert', 'billing_alert', etc.
  title VARCHAR(255) NOT NULL,
  message TEXT,
  is_read BOOLEAN DEFAULT false,
  email_sent BOOLEAN DEFAULT false,
  push_sent BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_notifications_user_id ON notifications(user_id);
CREATE INDEX idx_notifications_is_read ON notifications(is_read);

-- User Notification Preferences
CREATE TABLE notification_preferences (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  email_enabled BOOLEAN DEFAULT true,
  push_enabled BOOLEAN DEFAULT true,
  schedule_alerts BOOLEAN DEFAULT true,
  absence_alerts BOOLEAN DEFAULT true,
  billing_alerts BOOLEAN DEFAULT true,
  rating_alerts BOOLEAN DEFAULT true,
  daily_digest BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Absence Management
CREATE TABLE absences (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  caregiver_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  date DATE NOT NULL,
  type VARCHAR(50) NOT NULL, -- 'callout', 'no_show', 'scheduled'
  reason TEXT,
  reported_by UUID REFERENCES users(id),
  coverage_needed BOOLEAN DEFAULT true,
  coverage_assigned_to UUID REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_absences_caregiver_id ON absences(caregiver_id);
CREATE INDEX idx_absences_date ON absences(date);
CREATE INDEX idx_absences_coverage_needed ON absences(coverage_needed);

-- Service Locations (for multi-location support)
CREATE TABLE service_locations (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name VARCHAR(255) NOT NULL,
  address TEXT,
  city VARCHAR(100),
  state VARCHAR(2),
  zip VARCHAR(10),
  latitude DECIMAL(10,8),
  longitude DECIMAL(11,8),
  service_radius_miles INTEGER DEFAULT 5,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Analytics/Dashboard Cache
CREATE TABLE dashboard_cache (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  cache_key VARCHAR(255) UNIQUE NOT NULL,
  data JSONB,
  expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Triggers for audit logging
CREATE OR REPLACE FUNCTION audit_log_trigger()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO audit_logs (user_id, action, table_name, record_id, old_data, new_data, timestamp)
  VALUES (
    COALESCE(current_setting('app.current_user_id')::UUID, '00000000-0000-0000-0000-000000000000'),
    TG_OP,
    TG_TABLE_NAME,
    COALESCE(NEW.id, OLD.id),
    to_jsonb(OLD),
    to_jsonb(NEW),
    NOW()
  );
  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

-- Attach audit trigger to sensitive tables
CREATE TRIGGER audit_users_trigger AFTER INSERT OR UPDATE OR DELETE ON users
FOR EACH ROW EXECUTE FUNCTION audit_log_trigger();

CREATE TRIGGER audit_clients_trigger AFTER INSERT OR UPDATE OR DELETE ON clients
FOR EACH ROW EXECUTE FUNCTION audit_log_trigger();

CREATE TRIGGER audit_invoices_trigger AFTER INSERT OR UPDATE OR DELETE ON invoices
FOR EACH ROW EXECUTE FUNCTION audit_log_trigger();

CREATE TRIGGER audit_time_entries_trigger AFTER INSERT OR UPDATE OR DELETE ON time_entries
FOR EACH ROW EXECUTE FUNCTION audit_log_trigger();

-- Indexes for common queries
CREATE INDEX idx_referral_sources_active_type ON referral_sources(is_active, type);
CREATE INDEX idx_clients_active_service ON clients(is_active, service_type);
CREATE INDEX idx_invoices_period_status ON invoices(billing_period_start, payment_status);
CREATE INDEX idx_time_entries_period ON time_entries(start_time, end_time);
