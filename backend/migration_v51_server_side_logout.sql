-- Migration v51: server-side logout (token revocation)
--
-- Logout was client-side only: the frontend deleted the JWT from
-- localStorage but the token stayed valid until expiry (8h staff), so a
-- phone or second tab still holding it kept full access. Auth middleware
-- now rejects staff JWTs issued before users.last_logout_at, making
-- "Logout" revoke every outstanding token for that user.

BEGIN;

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS last_logout_at TIMESTAMPTZ;

COMMIT;
