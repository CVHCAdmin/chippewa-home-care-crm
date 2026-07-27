-- v55: invoices get a released/draft state.
--
-- The family portal listed every invoice the moment it was generated
-- (clientPortalRoutes filtered on client_id only) — so "generate" was
-- effectively "send", before the admin ever reviewed it. sent_at is stamped by
-- the explicit outbound actions (invoice email, reminder email, Stripe pay
-- link, or the Release to Portal button); the portal only shows invoices with
-- sent_at set (or with a recorded payment, so paid history never disappears).
--
-- Existing invoices were already visible to families, so they are
-- grandfathered in — only invoices generated after this migration start as
-- drafts.

ALTER TABLE invoices ADD COLUMN IF NOT EXISTS sent_at TIMESTAMPTZ;

UPDATE invoices SET sent_at = created_at WHERE sent_at IS NULL;
