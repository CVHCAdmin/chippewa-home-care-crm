-- Migration v37: Human-readable sequential invoice numbers
--
-- Adds invoices.seq_number — a monotonic per-row counter that's far easier
-- to read aloud on the phone than the random INV-MPH8VCCT-BBD6 codes.
-- The random invoice_number stays as the durable unique key; seq_number is
-- the friendly label shown alongside.

BEGIN;

-- 1. Add the sequence + column if they don't already exist
CREATE SEQUENCE IF NOT EXISTS invoice_seq_number_seq START WITH 1;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS seq_number INTEGER UNIQUE;

-- 2. Backfill existing rows in creation order, so the oldest invoice = #1
WITH ordered AS (
  SELECT id, ROW_NUMBER() OVER (ORDER BY created_at, id) AS rn
  FROM invoices
  WHERE seq_number IS NULL
)
UPDATE invoices i
   SET seq_number = ordered.rn
  FROM ordered
 WHERE i.id = ordered.id;

-- 3. Bump the sequence past the highest used number so new inserts don't collide
SELECT setval('invoice_seq_number_seq', GREATEST((SELECT COALESCE(MAX(seq_number), 0) FROM invoices), 1));

-- 4. Default new inserts to nextval — the app doesn't have to know about it
ALTER TABLE invoices ALTER COLUMN seq_number SET DEFAULT nextval('invoice_seq_number_seq');

COMMIT;
