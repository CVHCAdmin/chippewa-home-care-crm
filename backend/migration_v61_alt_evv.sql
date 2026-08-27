-- migration_v61_alt_evv.sql
-- Alternate EVV certification build (ALT-EVV-BUILD-PLAN.md, phase C1).
-- STRICTLY ADDITIVE: new columns and one new table only. No existing column,
-- constraint, or default is altered — every current query keeps working.

-- ── Sandata payer codes (WI Addendum v2.6 Appendix 1) ────────────────────────
ALTER TABLE referral_sources
  ADD COLUMN IF NOT EXISTS sandata_payer_id VARCHAR(20),
  ADD COLUMN IF NOT EXISTS sandata_payer_program VARCHAR(10);

UPDATE referral_sources SET sandata_payer_id = 'MCFC-CW',  sandata_payer_program = 'WIMCO'
 WHERE name ILIKE '%my choice%'  AND sandata_payer_id IS NULL;
UPDATE referral_sources SET sandata_payer_id = 'INCLUSA',  sandata_payer_program = 'WIMCO'
 WHERE name ILIKE '%inclusa%'    AND sandata_payer_id IS NULL;
UPDATE referral_sources SET sandata_payer_id = 'LAKELAND', sandata_payer_program = 'WIMCO'
 WHERE name ILIKE '%lakeland%'   AND sandata_payer_id IS NULL;
UPDATE referral_sources SET sandata_payer_id = 'WIMOLINA', sandata_payer_program = 'WIHMO'
 WHERE name ILIKE '%molina%'     AND sandata_payer_id IS NULL;
UPDATE referral_sources SET sandata_payer_id = 'WIFFS',    sandata_payer_program = 'FFS'
 WHERE name ILIKE '%forwardhealth%' AND sandata_payer_id IS NULL;

-- ── Client sync state (Sandata requires client accepted before its visits) ───
ALTER TABLE clients
  ADD COLUMN IF NOT EXISTS sandata_sequence BIGINT DEFAULT 0,
  ADD COLUMN IF NOT EXISTS sandata_synced_at TIMESTAMPTZ;

-- ── Visit submission state ───────────────────────────────────────────────────
ALTER TABLE evv_visits
  ADD COLUMN IF NOT EXISTS sandata_sequence BIGINT DEFAULT 0,
  ADD COLUMN IF NOT EXISTS sandata_uuid VARCHAR(64),
  ADD COLUMN IF NOT EXISTS needs_resubmit BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS exception_ack BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS exception_ack_by UUID REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS exception_ack_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS exception_ack_reason VARCHAR(2),
  ADD COLUMN IF NOT EXISTS exception_ack_memo VARCHAR(256);

-- ── IVR caller number (spec: OriginatingPhoneNumber required for Telephony) ──
ALTER TABLE time_entries
  ADD COLUMN IF NOT EXISTS origin_phone VARCHAR(20);

-- ── Structured time-change log (spec section 3.9 VisitChanges) ───────────────
-- WI reason codes: 1 Caregiver Error, 2 Member Unavailable, 3 Mobile Device
-- Issue, 4 Telephony Issue, 5 Member Refused Verification (memo required),
-- 7 Missing in System, 8 Other (memo required). Resolution 1 = Written
-- Documentation Maintained.
CREATE TABLE IF NOT EXISTS visit_time_changes (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  time_entry_id UUID NOT NULL REFERENCES time_entries(id) ON DELETE CASCADE,
  changed_by UUID REFERENCES users(id),
  changed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  old_start TIMESTAMPTZ,
  new_start TIMESTAMPTZ,
  old_end TIMESTAMPTZ,
  new_end TIMESTAMPTZ,
  reason_code VARCHAR(2) NOT NULL CHECK (reason_code IN ('1','2','3','4','5','7','8')),
  memo VARCHAR(256),
  resolution_code VARCHAR(4) DEFAULT '1',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_visit_time_changes_entry ON visit_time_changes(time_entry_id);
