-- migration_v32_onboarding_packets.sql
-- Post-hire onboarding packet: tokenized link emailed to new hire. Captures
-- BGC consent (FCRA-style standalone disclosure + signature), deeper info,
-- and triggers the WORCS background check once consent is signed.
-- Run with: psql "$DATABASE_URL" -f migration_v32_onboarding_packets.sql

-- ─── Packets ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS onboarding_packets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  caregiver_id  UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  application_id UUID REFERENCES job_applications(id) ON DELETE SET NULL,

  -- Tokenized access (single-use-able, but we don't enforce single-use —
  -- caregivers may need to revisit). Token is hex-random and is the only
  -- credential required to view/fill the packet.
  token         VARCHAR(128) NOT NULL UNIQUE,
  expires_at    TIMESTAMPTZ NOT NULL,

  status        VARCHAR(30) NOT NULL DEFAULT 'sent'
                CHECK (status IN ('sent','opened','in_progress','submitted','expired','cancelled')),

  -- Contact / emergency (not collected on the initial job app, or re-confirmed)
  preferred_name         VARCHAR(120),
  legal_first_name       VARCHAR(120),
  legal_middle_name      VARCHAR(120),
  legal_last_name        VARCHAR(120),
  pronouns               VARCHAR(40),
  address                VARCHAR(255),
  city                   VARCHAR(120),
  state                  VARCHAR(2),
  zip                    VARCHAR(10),
  date_of_birth          DATE,                -- required by WORCS
  drivers_license_number VARCHAR(40),
  drivers_license_state  VARCHAR(2),

  emergency_contact_name         VARCHAR(180),
  emergency_contact_relationship VARCHAR(100),
  emergency_contact_phone        VARCHAR(30),
  emergency_contact_email        VARCHAR(255),

  -- Background check consent (FCRA-style standalone)
  bgc_consent_signed_at TIMESTAMPTZ,
  bgc_consent_signature VARCHAR(180),        -- typed full legal name
  bgc_consent_ip        VARCHAR(45),         -- supports IPv6
  bgc_consent_user_agent TEXT,
  bgc_consent_version   VARCHAR(20),         -- which disclosure text version
  bgc_consent_disclosure_text TEXT,          -- captured verbatim for audit
  -- SSN captured ONLY for the WORCS submit; we nullify once submit succeeds.
  ssn_transient_encrypted TEXT,

  -- Audit
  opened_at      TIMESTAMPTZ,
  submitted_at   TIMESTAMPTZ,
  created_by     UUID REFERENCES users(id),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_onboarding_packets_caregiver ON onboarding_packets(caregiver_id);
CREATE INDEX IF NOT EXISTS idx_onboarding_packets_status    ON onboarding_packets(status);
CREATE INDEX IF NOT EXISTS idx_onboarding_packets_expires   ON onboarding_packets(expires_at)
  WHERE status IN ('sent','opened','in_progress');

-- ─── Consent audit log ──────────────────────────────────────────────────
-- Every view / sign / background-check submission against a packet gets a
-- row here. Never updated, never deleted (append-only).
CREATE TABLE IF NOT EXISTS onboarding_packet_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  packet_id UUID NOT NULL REFERENCES onboarding_packets(id) ON DELETE CASCADE,
  event_type VARCHAR(40) NOT NULL
    CHECK (event_type IN (
      'created','emailed','opened','saved_draft','consent_signed',
      'submitted','bgc_requested','bgc_completed','expired','cancelled','resent'
    )),
  ip_address VARCHAR(45),
  user_agent TEXT,
  metadata JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_onboarding_packet_events_packet
  ON onboarding_packet_events(packet_id, created_at);

-- ─── Gusto sync tracking ────────────────────────────────────────────────
-- Gusto doesn't offer customer API access. We track when Alexis has copied
-- the caregiver into Gusto so onboarding has a clear "done" signal.
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS gusto_employee_id VARCHAR(100),
  ADD COLUMN IF NOT EXISTS gusto_synced_at   TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS gusto_synced_by   UUID REFERENCES users(id);
