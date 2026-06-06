-- migration_evv_autosubmit.sql
-- Schema additions for automated Sandata EVV submission queue.
-- Run: psql $DATABASE_URL -f cvhc-agent/migration_evv_autosubmit.sql

-- ═══════════════════════════════════════════════════════════════════════════════
-- 1. SANDATA SUBMISSION QUEUE — serialized processing with retry tracking
-- ═══════════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS sandata_submission_queue (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  evv_visit_id UUID NOT NULL REFERENCES evv_visits(id) ON DELETE CASCADE,
  submission_path VARCHAR(20) NOT NULL DEFAULT 'api', -- 'api' | 'browser'
  status VARCHAR(20) NOT NULL DEFAULT 'queued',
    -- 'queued' | 'processing' | 'completed' | 'failed' | 'cancelled'
  retry_count INTEGER DEFAULT 0,
  last_error TEXT,
  next_retry_at TIMESTAMPTZ,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sandata_queue_status ON sandata_submission_queue(status, created_at ASC);
CREATE INDEX IF NOT EXISTS idx_sandata_queue_evv ON sandata_submission_queue(evv_visit_id);

-- ═══════════════════════════════════════════════════════════════════════════════
-- 2. EVV_VISITS — add 'needs_manual' as valid sandata_status
--    Existing values: 'pending', 'ready', 'submitted', 'accepted', 'exception'
--    New value: 'needs_manual' — auto-submission failed, needs manual entry
-- ═══════════════════════════════════════════════════════════════════════════════
-- No ALTER needed — sandata_status is VARCHAR(30), already accepts any string.
-- Just document the new status value:
-- 'needs_manual' = auto-submission exhausted all retries, Alexis must enter manually

-- ═══════════════════════════════════════════════════════════════════════════════
-- 3. EVV_VISITS — add auto_submit_enabled flag for opt-out per visit
-- ═══════════════════════════════════════════════════════════════════════════════
ALTER TABLE evv_visits ADD COLUMN IF NOT EXISTS auto_submit_enabled BOOLEAN DEFAULT true;
