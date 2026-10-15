-- v73: emailed e-signature requests (BID form, policy acknowledgements).
--
-- The office sends a document to staff; each person gets their own private emailed link
-- (no login), fills/reads it, draws a signature, and the signed PDF is stored here —
-- one record PER PERSON (documents.signed_at was one flag for the whole company, so the
-- first signature hid it from everyone). Files live in the database, never on the server
-- disk (Render wipes the disk on every deploy).
--
-- sign_templates  what can be sent. kind 'bid' = the official DHS F-82064 Background
--                 Information Disclosure, filled from the signer's answers (built in, PDF
--                 ships with the code). kind 'acknowledge' = an uploaded PDF (a policy) the
--                 signer reads and signs; a signature page is appended.
-- sign_requests   one per person per document send. signed_pdf_encrypted holds the signed
--                 PDF (base64), AES-256-GCM encrypted — a signed BID contains an SSN.

CREATE TABLE IF NOT EXISTS sign_templates (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  kind          VARCHAR(20)  NOT NULL CHECK (kind IN ('bid', 'acknowledge')),
  title         VARCHAR(200) NOT NULL,
  version       VARCHAR(40),
  description   TEXT,
  pdf_base64    TEXT,               -- 'acknowledge' only; NULL for the built-in BID
  is_active     BOOLEAN NOT NULL DEFAULT true,
  created_by    UUID REFERENCES users(id),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS sign_requests (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  template_id           UUID NOT NULL REFERENCES sign_templates(id) ON DELETE CASCADE,
  user_id               UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token                 VARCHAR(128) NOT NULL UNIQUE,
  status                VARCHAR(20) NOT NULL DEFAULT 'sent'
                          CHECK (status IN ('sent', 'opened', 'signed', 'cancelled')),
  email_to              VARCHAR(255),
  sent_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  opened_at             TIMESTAMPTZ,
  signed_at             TIMESTAMPTZ,
  reminder_count        INTEGER NOT NULL DEFAULT 0,
  last_reminded_at      TIMESTAMPTZ,
  expires_at            TIMESTAMPTZ NOT NULL,
  signer_typed_name     VARCHAR(200),
  signature_ip          VARCHAR(45),
  signature_user_agent  VARCHAR(300),
  signed_pdf_encrypted  TEXT,
  disclosures_yes       BOOLEAN,   -- BID: any disclosure answered Yes (office must review)
  created_by            UUID REFERENCES users(id),
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sign_requests_template ON sign_requests (template_id);
CREATE INDEX IF NOT EXISTS idx_sign_requests_user ON sign_requests (user_id);
-- At most one live (unsigned, uncancelled) request per person per document.
CREATE UNIQUE INDEX IF NOT EXISTS uq_sign_requests_open
  ON sign_requests (template_id, user_id) WHERE status IN ('sent', 'opened');

INSERT INTO sign_templates (kind, title, version, description)
SELECT 'bid', 'Background Information Disclosure (BID) — DHS F-82064', 'F-82064 (07/2026)',
       'Wisconsin caregiver background check self-disclosure, required for all staff (Wis. Stat. § 50.065).'
WHERE NOT EXISTS (SELECT 1 FROM sign_templates WHERE kind = 'bid');
