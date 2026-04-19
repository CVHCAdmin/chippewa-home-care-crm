-- migration_v30_align_notifications_status.sql
-- Run with: psql $DATABASE_URL -f migration_v30_align_notifications_status.sql
--
-- Background: since migration_v25, notifications have both is_read and
-- status columns, and they're supposed to mirror (is_read=false ↔
-- status='new'; is_read=true ↔ status IN ('handled','archived')).
-- Two prior bugs let them drift:
--   1) mark-read set is_read but not status
--   2) updateStatus set status but not is_read
-- This caused the bell badge (which counted is_read=false) to show
-- unread counts for rows the admin had already resolved via the page.
--
-- This migration realigns the two columns for existing data. Going
-- forward the app updates both together.

-- Rows marked handled/archived via the page: clear is_read
UPDATE notifications SET is_read = true
  WHERE status IN ('handled', 'archived') AND is_read = false;

-- Rows the bell "read" via mark-read: move status to 'handled'
UPDATE notifications SET status = 'handled', handled_at = COALESCE(handled_at, NOW())
  WHERE is_read = true AND status = 'new';

-- Anything left with no status set gets 'new' (shouldn't happen post-v25)
UPDATE notifications SET status = 'new'
  WHERE status IS NULL;
