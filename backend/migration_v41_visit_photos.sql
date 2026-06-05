-- Migration v41: Visit photos (proof-of-care)
--
-- Caregivers can attach photos to a time_entry at clock-out — e.g., before/
-- after meal, completed task, vitals reading. Stored as base64 in DB for
-- simplicity (we already accept base64 signatures); switch to S3 if volume grows.
-- Photos are PHI-adjacent so admin/self ACL applies on read.

BEGIN;

CREATE TABLE IF NOT EXISTS visit_photos (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  time_entry_id UUID NOT NULL REFERENCES time_entries(id) ON DELETE CASCADE,
  caregiver_id UUID REFERENCES users(id) ON DELETE SET NULL,
  client_id UUID REFERENCES clients(id) ON DELETE SET NULL,
  caption VARCHAR(200),
  category VARCHAR(40),           -- meal | task | vitals | environment | other
  image_base64 TEXT NOT NULL,     -- data URI
  image_size INTEGER,             -- bytes (rough; for moderation/quotas)
  taken_at TIMESTAMPTZ DEFAULT NOW(),
  uploaded_at TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT visit_photo_size_cap CHECK (image_size IS NULL OR image_size <= 5_000_000) -- ~5MB pre-base64
);

CREATE INDEX IF NOT EXISTS idx_visit_photos_time_entry ON visit_photos(time_entry_id);
CREATE INDEX IF NOT EXISTS idx_visit_photos_client ON visit_photos(client_id);
CREATE INDEX IF NOT EXISTS idx_visit_photos_caregiver ON visit_photos(caregiver_id);
CREATE INDEX IF NOT EXISTS idx_visit_photos_taken_at ON visit_photos(taken_at DESC);

COMMIT;
