-- Migration v43: Insurance card image storage
--
-- Two columns on clients for front + back of the primary insurance card.
-- Base64 data URIs (consistent with how we store signatures and visit photos).
-- Add CHECK on size to prevent abuse.

BEGIN;

ALTER TABLE clients
  ADD COLUMN IF NOT EXISTS insurance_card_front TEXT,
  ADD COLUMN IF NOT EXISTS insurance_card_back  TEXT,
  ADD COLUMN IF NOT EXISTS insurance_card_uploaded_at TIMESTAMPTZ;

-- Cap each side at ~5MB raw (~6.7MB base64).
DO $$ BEGIN
  ALTER TABLE clients ADD CONSTRAINT clients_insurance_front_size_cap
    CHECK (insurance_card_front IS NULL OR LENGTH(insurance_card_front) <= 7_000_000);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE clients ADD CONSTRAINT clients_insurance_back_size_cap
    CHECK (insurance_card_back IS NULL OR LENGTH(insurance_card_back) <= 7_000_000);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

COMMIT;
