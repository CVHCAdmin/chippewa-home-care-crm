-- Migration v48: Data fixes from June 2026 audit
--   1. Sally Bandoli's 50-unit auth: unit_type was entered as "visits" but
--      MIDAS authorization #6989810 is 50 hours. Fix to match payer reality.
--   2. Add NOT-FUTURE check on clients.date_of_birth. 3 existing rows
--      (Carol Thompson 2026-06-13, Cheri Shower 2046-03-29,
--      Dorothy Zwiefelhofer 2026-09-30) are future-dated — data entry
--      errors. Constraint added NOT VALID so existing rows stay readable;
--      user must fix the 3 then re-validate.

BEGIN;

-- 1. Sally Bandoli unit_type fix
UPDATE authorizations
   SET unit_type = 'hours',
       updated_at = NOW()
 WHERE id = 'b1518ebb-768c-4009-bb59-662572f0df41'
   AND unit_type = 'visits'
   AND authorized_units = 50;

-- 2. DOB future-date guard
ALTER TABLE clients
  DROP CONSTRAINT IF EXISTS clients_dob_not_future;

ALTER TABLE clients
  ADD CONSTRAINT clients_dob_not_future
  CHECK (date_of_birth IS NULL OR date_of_birth <= CURRENT_DATE)
  NOT VALID;

COMMIT;
