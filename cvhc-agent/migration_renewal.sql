-- migration_renewal.sql
-- Schema additions for the authorization renewal monitoring agent.
-- Run: psql $DATABASE_URL -f cvhc-agent/migration_renewal.sql

-- ═══════════════════════════════════════════════════════════════════════════════
-- 1. RENEWAL_NOTICES — tracks every renewal notice sent or action taken
-- ═══════════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS renewal_notices (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  auth_id UUID NOT NULL REFERENCES authorizations(id) ON DELETE CASCADE,
  notice_type VARCHAR(20) NOT NULL, -- 'warning' | 'urgent' | 'critical'
  payer_source VARCHAR(50),         -- 'forwardhealth' | 'icare' | 'inclusa' | 'lakeland' | 'fcp' | 'iris'
  days_until_expiry INTEGER,
  units_remaining_pct DECIMAL(5,2), -- 0.00 to 100.00
  budget_remaining_pct DECIMAL(5,2), -- for IRIS dollar budgets
  action_taken TEXT NOT NULL,        -- what the agent did
  consultant_notified BOOLEAN DEFAULT false, -- for IRIS
  consultant_email VARCHAR(255),     -- for IRIS consultant contact
  notified_at TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_renewal_notices_auth ON renewal_notices(auth_id);
CREATE INDEX IF NOT EXISTS idx_renewal_notices_date ON renewal_notices(notified_at DESC);
CREATE INDEX IF NOT EXISTS idx_renewal_notices_type ON renewal_notices(notice_type);

-- ═══════════════════════════════════════════════════════════════════════════════
-- 2. AUTHORIZATIONS — add IRIS consultant contact and renewal tracking fields
-- ═══════════════════════════════════════════════════════════════════════════════
ALTER TABLE authorizations ADD COLUMN IF NOT EXISTS iris_consultant_name VARCHAR(255);
ALTER TABLE authorizations ADD COLUMN IF NOT EXISTS iris_consultant_email VARCHAR(255);
ALTER TABLE authorizations ADD COLUMN IF NOT EXISTS iris_consultant_agency VARCHAR(255);
ALTER TABLE authorizations ADD COLUMN IF NOT EXISTS renewal_status VARCHAR(30) DEFAULT 'none';
  -- 'none' | 'notice_sent' | 'renewal_requested' | 'renewed' | 'expired'
ALTER TABLE authorizations ADD COLUMN IF NOT EXISTS renewal_requested_at TIMESTAMPTZ;
ALTER TABLE authorizations ADD COLUMN IF NOT EXISTS plan_year_end DATE; -- for IRIS plan year tracking

-- ═══════════════════════════════════════════════════════════════════════════════
-- 3. AGENT_RENEWAL_RUNS — tracks each renewal agent execution
-- ═══════════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS agent_renewal_runs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  started_at TIMESTAMPTZ DEFAULT NOW(),
  finished_at TIMESTAMPTZ,
  mode VARCHAR(20) NOT NULL DEFAULT 'live', -- 'live' | 'dry-run'
  auths_scanned INTEGER DEFAULT 0,
  warnings_sent INTEGER DEFAULT 0,
  urgents_sent INTEGER DEFAULT 0,
  criticals_sent INTEGER DEFAULT 0,
  renewals_initiated INTEGER DEFAULT 0,
  iris_consultants_notified INTEGER DEFAULT 0,
  errors JSONB DEFAULT '[]',
  summary TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_renewal_runs_started ON agent_renewal_runs(started_at DESC);
