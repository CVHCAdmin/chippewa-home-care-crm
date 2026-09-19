-- Migration v68: free-text note that prints in the payer response letter.
--
-- Payers ask things the case file has no field for (IR-2026-001: "did the employee ever
-- contact management about controlled medications?"). This holds the agency's answer so
-- the letter states it instead of the office writing a separate note. Additive only.

BEGIN;

ALTER TABLE incident_reports
  ADD COLUMN IF NOT EXISTS payer_response_notes TEXT;

COMMIT;
