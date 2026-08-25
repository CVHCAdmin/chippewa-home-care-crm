-- Migration v60: emails stored lowercase, enforced unique case-insensitively
--
-- Root incident 2026-08-24: a caregiver created as Winechic2013@yahoo.com
-- could neither log in nor get a reset email — login compared the raw stored
-- string and forgot-password lowercases only its input, then reports success
-- either way (anti-enumeration). Creation paths now lowercase+trim in code;
-- this migration normalizes any stragglers and makes case-duplicates
-- impossible at the DB level.

BEGIN;

-- Normalize anything mixed-case/whitespace that predates the code fix.
-- (Safe re: uniqueness only because the index below hasn't existed yet; if
-- two rows collided case-insensitively this UPDATE would abort the whole
-- transaction on the existing exact-match unique constraint — resolve those
-- rows by hand first. Checked 2026-08-24: zero collisions.)
UPDATE users
   SET email = LOWER(TRIM(email)), updated_at = NOW()
 WHERE email <> LOWER(TRIM(email));

CREATE UNIQUE INDEX IF NOT EXISTS uq_users_email_lower
  ON users (LOWER(email));

COMMIT;
