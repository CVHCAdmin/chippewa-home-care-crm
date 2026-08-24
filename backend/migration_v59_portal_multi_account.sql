-- v59: multiple portal accounts per client (one login per relative).
--
-- Before this, client_portal_accounts had a UNIQUE index on client_id — one
-- account per client, so families shared a single email+password. Each relative
-- now gets their own account: individual audit trail (who viewed what), per-
-- person revocation, and one person's lockout/password reset not affecting the
-- others. Email stays globally unique (login is by email).

-- Who this account belongs to ("Tyler — son"), shown in the admin UI.
ALTER TABLE client_portal_accounts ADD COLUMN IF NOT EXISTS display_name TEXT;

-- Drop the one-account-per-client constraint. The non-unique idx_client_portal_client
-- on client_id already exists for lookups, so no replacement index is needed.
DROP INDEX IF EXISTS idx_client_portal_accounts_client_id;
