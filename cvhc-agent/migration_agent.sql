-- migration_agent.sql
-- Schema additions for the CVHC automated claims processing agent.
-- Run: psql $DATABASE_URL -f cvhc-agent/migration_agent.sql

-- ═══════════════════════════════════════════════════════════════════════════════
-- 1. AGENT RUN LOG — tracks each pipeline execution
-- ═══════════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS agent_claim_runs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  started_at TIMESTAMPTZ DEFAULT NOW(),
  finished_at TIMESTAMPTZ,
  mode VARCHAR(20) NOT NULL DEFAULT 'live', -- 'live' | 'dry-run'
  total_visits_scanned INTEGER DEFAULT 0,
  claims_created INTEGER DEFAULT 0,
  claims_submitted INTEGER DEFAULT 0,
  claims_denied INTEGER DEFAULT 0,
  claims_auto_corrected INTEGER DEFAULT 0,
  claims_escalated INTEGER DEFAULT 0,
  claims_paid INTEGER DEFAULT 0,
  errors JSONB DEFAULT '[]',
  summary TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_agent_runs_started ON agent_claim_runs(started_at DESC);

-- ═══════════════════════════════════════════════════════════════════════════════
-- 2. CLAIMS — add columns the agent needs for retry tracking
-- ═══════════════════════════════════════════════════════════════════════════════
ALTER TABLE claims ADD COLUMN IF NOT EXISTS agent_run_id UUID REFERENCES agent_claim_runs(id);
ALTER TABLE claims ADD COLUMN IF NOT EXISTS resubmit_count INTEGER DEFAULT 0;
ALTER TABLE claims ADD COLUMN IF NOT EXISTS escalated BOOLEAN DEFAULT false;
ALTER TABLE claims ADD COLUMN IF NOT EXISTS escalated_reason TEXT;
ALTER TABLE claims ADD COLUMN IF NOT EXISTS portal_response JSONB;
ALTER TABLE claims ADD COLUMN IF NOT EXISTS portal_tracking_id VARCHAR(200);

-- ═══════════════════════════════════════════════════════════════════════════════
-- 3. AUTHORIZATIONS — add budget tracking columns for IRIS
-- ═══════════════════════════════════════════════════════════════════════════════
ALTER TABLE authorizations ADD COLUMN IF NOT EXISTS budget_amount DECIMAL(12,2);
ALTER TABLE authorizations ADD COLUMN IF NOT EXISTS budget_used DECIMAL(12,2) DEFAULT 0;
ALTER TABLE authorizations ADD COLUMN IF NOT EXISTS budget_type VARCHAR(30); -- 'units' | 'dollars'
ALTER TABLE authorizations ADD COLUMN IF NOT EXISTS payer_source VARCHAR(50); -- 'forwardhealth' | 'icare' | 'inclusa' | 'lakeland' | 'fcp' | 'iris'

-- ═══════════════════════════════════════════════════════════════════════════════
-- 4. REFERRAL_SOURCES — add clearinghouse and timely filing info
-- ═══════════════════════════════════════════════════════════════════════════════
ALTER TABLE referral_sources ADD COLUMN IF NOT EXISTS clearinghouse VARCHAR(100);
ALTER TABLE referral_sources ADD COLUMN IF NOT EXISTS timely_filing_days INTEGER;
ALTER TABLE referral_sources ADD COLUMN IF NOT EXISTS timely_filing_warn_days INTEGER;
ALTER TABLE referral_sources ADD COLUMN IF NOT EXISTS requires_medicare_primary BOOLEAN DEFAULT false;

-- Seed accurate payer routing data for the MCOs
UPDATE referral_sources SET
  clearinghouse = 'Availity',
  timely_filing_days = 90,
  timely_filing_warn_days = 75
WHERE LOWER(name) LIKE '%icare%' OR LOWER(name) LIKE '%my choice%';

UPDATE referral_sources SET
  clearinghouse = 'Change Healthcare',
  timely_filing_days = 180,
  timely_filing_warn_days = 150
WHERE LOWER(name) LIKE '%inclusa%';

UPDATE referral_sources SET
  clearinghouse = 'Availity',
  timely_filing_days = 90,
  timely_filing_warn_days = 75
WHERE LOWER(name) LIKE '%lakeland%';

UPDATE referral_sources SET
  clearinghouse = 'Change Healthcare',
  timely_filing_days = 90,
  timely_filing_warn_days = 75,
  requires_medicare_primary = true
WHERE LOWER(name) LIKE '%family care partnership%' OR LOWER(name) LIKE '%fcp%';

UPDATE referral_sources SET
  timely_filing_days = 365,
  timely_filing_warn_days = 330
WHERE LOWER(name) LIKE '%forwardhealth%' OR payer_type = 'medicaid';

UPDATE referral_sources SET
  timely_filing_days = 90,
  timely_filing_warn_days = 75
WHERE payer_type = 'IRIS' OR LOWER(name) LIKE '%iris%';
