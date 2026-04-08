-- migration_v25_notification_status.sql
-- Add status management to notifications for admin workflow (new/handled/archived)

ALTER TABLE notifications ADD COLUMN IF NOT EXISTS status VARCHAR(20) DEFAULT 'new';
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS handled_at TIMESTAMPTZ;
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS handled_by UUID REFERENCES users(id);

CREATE INDEX IF NOT EXISTS idx_notifications_status ON notifications(status);

-- Update existing notifications: mark read ones as 'handled', unread as 'new'
UPDATE notifications SET status = 'handled' WHERE is_read = true AND status IS NULL;
UPDATE notifications SET status = 'new' WHERE is_read = false AND (status IS NULL OR status = 'new');
