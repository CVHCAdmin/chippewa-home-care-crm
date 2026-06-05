-- Migration v40: eSignature on documents
--
-- documents already has requires_signature + signed_at columns. We add the
-- actual signature payload (base64 PNG of the canvas drawing), the signer's
-- user id, IP, user agent, and a one-row-per-signature history table for
-- documents that need multiple signatures (e.g., I-9 has employee + employer).

BEGIN;

-- Add columns to documents for the most recent signature (quick read)
ALTER TABLE documents
  ADD COLUMN IF NOT EXISTS signed_by UUID REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS signature_image_base64 TEXT,
  ADD COLUMN IF NOT EXISTS signature_ip VARCHAR(45),
  ADD COLUMN IF NOT EXISTS signature_user_agent VARCHAR(300),
  ADD COLUMN IF NOT EXISTS signature_typed_name VARCHAR(200);

-- Per-signature history (multi-signer documents)
CREATE TABLE IF NOT EXISTS document_signatures (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  document_id UUID NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  signed_by UUID NOT NULL REFERENCES users(id),
  signer_role VARCHAR(40),
  signer_typed_name VARCHAR(200),
  signature_image_base64 TEXT NOT NULL,
  signed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ip_address VARCHAR(45),
  user_agent VARCHAR(300)
);

CREATE INDEX IF NOT EXISTS idx_document_signatures_document ON document_signatures(document_id);
CREATE INDEX IF NOT EXISTS idx_document_signatures_signer ON document_signatures(signed_by);

COMMIT;
