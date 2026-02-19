-- Migration: Add tables for push notifications, WORCS integration, and caregiver availability
-- Run this against your PostgreSQL database

-- Push notification subscriptions
CREATE TABLE IF NOT EXISTS push_subscriptions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  subscription JSONB NOT NULL,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ,
  UNIQUE (user_id, subscription)
);

CREATE INDEX IF NOT EXISTS idx_push_subscriptions_user_id ON push_subscriptions(user_id);
CREATE INDEX IF NOT EXISTS idx_push_subscriptions_active ON push_subscriptions(is_active);

-- Caregiver availability preferences (for emergency coverage matching)
CREATE TABLE IF NOT EXISTS caregiver_availability (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  caregiver_id UUID NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  status VARCHAR(50) DEFAULT 'available', -- available, unavailable, limited
  max_hours_per_week INTEGER DEFAULT 40,
  weekly_availability JSONB, -- {0: {available: bool, start: '09:00', end: '17:00'}, ...}
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Add WORCS fields to background_checks if not present
ALTER TABLE background_checks 
  ADD COLUMN IF NOT EXISTS worcs_reference_number VARCHAR(255),
  ADD COLUMN IF NOT EXISTS worcs_status VARCHAR(100),
  ADD COLUMN IF NOT EXISTS ssn_encrypted TEXT,
  ADD COLUMN IF NOT EXISTS drivers_license_encrypted TEXT,
  ADD COLUMN IF NOT EXISTS drivers_license_state VARCHAR(2),
  ADD COLUMN IF NOT EXISTS application_id UUID REFERENCES applications(id),
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();

-- Add is_complete to time_entries if not present  
ALTER TABLE time_entries
  ADD COLUMN IF NOT EXISTS is_complete BOOLEAN DEFAULT false;

-- Update existing completed entries
UPDATE time_entries SET is_complete = true WHERE end_time IS NOT NULL;

-- Add indexes for performance
CREATE INDEX IF NOT EXISTS idx_time_entries_caregiver_complete ON time_entries(caregiver_id, is_complete);
CREATE INDEX IF NOT EXISTS idx_gps_tracking_time_entry ON gps_tracking(time_entry_id, timestamp);
