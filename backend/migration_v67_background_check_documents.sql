-- Migration v67: background check documents
--
-- The DOJ/DHS/BID result letters for a caregiver's background check. Stored in the
-- database as data URIs (same approach as incident_attachments, v64) because the
-- documents module writes to local disk, which does not survive a deploy.
-- Additive only.

BEGIN;

CREATE TABLE IF NOT EXISTS background_check_documents (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  background_check_id UUID NOT NULL REFERENCES background_checks(id) ON DELETE CASCADE,
  file_name VARCHAR(255) NOT NULL,
  mime_type VARCHAR(100) NOT NULL,
  file_size INTEGER,
  file_data TEXT NOT NULL,
  uploaded_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_background_check_documents_check
  ON background_check_documents(background_check_id, created_at);

COMMIT;
