-- migration_v16_claims_billing_engine.sql
-- Complete Claims & Billing Engine: EVV-to-claim pipeline, payer routing,
-- payment reconciliation, denial management

-- ═══════════════════════════════════════════════════════════════════════════════
-- 1. CLAIMS TABLE — add missing columns for full billing engine
-- ═══════════════════════════════════════════════════════════════════════════════
ALTER TABLE claims ADD COLUMN IF NOT EXISTS caregiver_id UUID REFERENCES users(id);
ALTER TABLE claims ADD COLUMN IF NOT EXISTS submission_method VARCHAR(50);
ALTER TABLE claims ADD COLUMN IF NOT EXISTS edi_file_path VARCHAR(500);
ALTER TABLE claims ADD COLUMN IF NOT EXISTS clearinghouse_id VARCHAR(100);
ALTER TABLE claims ADD COLUMN IF NOT EXISTS denial_code VARCHAR(50);
ALTER TABLE claims ADD COLUMN IF NOT EXISTS eob_notes TEXT;
ALTER TABLE claims ADD COLUMN IF NOT EXISTS check_number VARCHAR(100);
ALTER TABLE claims ADD COLUMN IF NOT EXISTS units_billed DECIMAL(10,2);
ALTER TABLE claims ADD COLUMN IF NOT EXISTS payer_type VARCHAR(50);
ALTER TABLE claims ADD COLUMN IF NOT EXISTS resubmitted_from UUID REFERENCES claims(id);
ALTER TABLE claims ADD COLUMN IF NOT EXISTS voided_at TIMESTAMPTZ;
ALTER TABLE claims ADD COLUMN IF NOT EXISTS voided_by UUID REFERENCES users(id);

-- Backfill units_billed from units if not set
UPDATE claims SET units_billed = units WHERE units_billed IS NULL AND units IS NOT NULL;

-- Index for denial queue
CREATE INDEX IF NOT EXISTS idx_claims_denial ON claims(status, created_at DESC) WHERE status = 'denied';
CREATE INDEX IF NOT EXISTS idx_claims_payer_status ON claims(payer_id, status);
CREATE INDEX IF NOT EXISTS idx_claims_caregiver ON claims(caregiver_id);
CREATE INDEX IF NOT EXISTS idx_claims_service_date ON claims(service_date);

-- ═══════════════════════════════════════════════════════════════════════════════
-- 2. PAYMENTS TABLE — check scanning, payment reconciliation
-- ═══════════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS payments (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  payer_id UUID REFERENCES referral_sources(id),
  payer_name VARCHAR(255),
  check_number VARCHAR(100),
  check_date DATE,
  check_amount DECIMAL(12,2) NOT NULL,
  payment_date DATE DEFAULT CURRENT_DATE,
  payment_method VARCHAR(50) DEFAULT 'check',
  scan_image_path VARCHAR(500),
  ai_extracted_data JSONB,
  reconciliation_status VARCHAR(30) DEFAULT 'unreconciled',
  reconciliation_notes TEXT,
  total_matched DECIMAL(12,2) DEFAULT 0,
  underpayment_amount DECIMAL(12,2) DEFAULT 0,
  overpayment_amount DECIMAL(12,2) DEFAULT 0,
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_payments_payer ON payments(payer_id);
CREATE INDEX IF NOT EXISTS idx_payments_status ON payments(reconciliation_status);
CREATE INDEX IF NOT EXISTS idx_payments_date ON payments(payment_date DESC);

-- ═══════════════════════════════════════════════════════════════════════════════
-- 3. PAYMENT_CLAIM_MATCHES — links payments to claims
-- ═══════════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS payment_claim_matches (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  payment_id UUID NOT NULL REFERENCES payments(id) ON DELETE CASCADE,
  claim_id UUID NOT NULL REFERENCES claims(id),
  matched_amount DECIMAL(12,2) NOT NULL,
  match_type VARCHAR(30) DEFAULT 'auto',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_pcm_payment ON payment_claim_matches(payment_id);
CREATE INDEX IF NOT EXISTS idx_pcm_claim ON payment_claim_matches(claim_id);

-- ═══════════════════════════════════════════════════════════════════════════════
-- 4. DENIAL CODES reference table
-- ═══════════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS denial_code_lookup (
  code VARCHAR(10) PRIMARY KEY,
  description TEXT NOT NULL,
  category VARCHAR(50),
  common_fix TEXT
);

INSERT INTO denial_code_lookup (code, description, category, common_fix) VALUES
  ('CO-4', 'Procedure code inconsistent with modifier or missing modifier', 'coding', 'Verify procedure code and modifier match authorization'),
  ('CO-16', 'Claim/service lacks information needed for adjudication', 'missing_info', 'Resubmit with complete claim information'),
  ('CO-18', 'Exact duplicate claim/service', 'duplicate', 'Verify this is not a duplicate before resubmitting'),
  ('CO-22', 'Care may be covered by another payer', 'coordination', 'Verify coordination of benefits and primary payer'),
  ('CO-27', 'Expenses incurred after coverage terminated', 'eligibility', 'Verify member eligibility dates'),
  ('CO-29', 'Time limit for filing has expired', 'timely_filing', 'File appeal with proof of timely submission'),
  ('CO-45', 'Charges exceed fee schedule/max allowable', 'pricing', 'Adjust charges to fee schedule rates'),
  ('CO-50', 'Non-covered services (not deemed medically necessary)', 'medical_necessity', 'Submit with supporting documentation'),
  ('CO-96', 'Non-covered charge(s)', 'coverage', 'Verify service is covered under member plan'),
  ('CO-97', 'Payment adjusted: benefit for this service is in another claim', 'bundling', 'Check for bundled services'),
  ('CO-109', 'Claim not covered by this payer', 'wrong_payer', 'Route to correct payer'),
  ('CO-197', 'Precertification/authorization absent', 'auth', 'Obtain and attach prior authorization number'),
  ('CO-252', 'Service not authorized on date(s) of service', 'auth', 'Verify authorization covers the service dates'),
  ('PR-1', 'Deductible amount', 'patient_resp', 'Bill patient for deductible amount'),
  ('PR-2', 'Coinsurance amount', 'patient_resp', 'Bill patient for coinsurance'),
  ('PR-3', 'Co-payment amount', 'patient_resp', 'Collect co-payment from patient')
ON CONFLICT (code) DO NOTHING;

-- ═══════════════════════════════════════════════════════════════════════════════
-- 5. AUTHORIZATIONS — add columns for enhanced burn-down tracking
-- ═══════════════════════════════════════════════════════════════════════════════
ALTER TABLE authorizations ADD COLUMN IF NOT EXISTS authorized_units DECIMAL(10,2);
ALTER TABLE authorizations ADD COLUMN IF NOT EXISTS unit_type VARCHAR(20) DEFAULT '15min';
ALTER TABLE authorizations ADD COLUMN IF NOT EXISTS renewal_requested BOOLEAN DEFAULT false;
ALTER TABLE authorizations ADD COLUMN IF NOT EXISTS renewal_requested_at TIMESTAMPTZ;
ALTER TABLE authorizations ADD COLUMN IF NOT EXISTS renewal_requested_by UUID REFERENCES users(id);

-- ═══════════════════════════════════════════════════════════════════════════════
-- 6. REFERRAL_SOURCES — add FEA org field for IRIS routing
-- ═══════════════════════════════════════════════════════════════════════════════
ALTER TABLE referral_sources ADD COLUMN IF NOT EXISTS fea_organization VARCHAR(100);
ALTER TABLE referral_sources ADD COLUMN IF NOT EXISTS payer_id_number VARCHAR(100);

-- ═══════════════════════════════════════════════════════════════════════════════
-- 7. EDI_BATCHES — add file path column
-- ═══════════════════════════════════════════════════════════════════════════════
ALTER TABLE edi_batches ADD COLUMN IF NOT EXISTS file_path VARCHAR(500);
