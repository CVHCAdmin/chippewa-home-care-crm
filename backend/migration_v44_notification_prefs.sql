-- Migration v44: Per-user notification preferences
--
-- Extends notification_settings with SMS + push channel toggles and a few
-- more event-type opt-outs. Quiet hours window so caregivers don't get
-- pinged at 3am unless it's an emergency.

BEGIN;

ALTER TABLE notification_settings
  ADD COLUMN IF NOT EXISTS sms_enabled BOOLEAN DEFAULT true,
  ADD COLUMN IF NOT EXISTS push_enabled BOOLEAN DEFAULT true,
  ADD COLUMN IF NOT EXISTS shift_reminder_alerts BOOLEAN DEFAULT true,
  ADD COLUMN IF NOT EXISTS billing_alerts BOOLEAN DEFAULT true,
  ADD COLUMN IF NOT EXISTS low_auth_alerts BOOLEAN DEFAULT true,
  ADD COLUMN IF NOT EXISTS expiring_cert_alerts BOOLEAN DEFAULT true,
  ADD COLUMN IF NOT EXISTS message_alerts BOOLEAN DEFAULT true,
  ADD COLUMN IF NOT EXISTS quiet_hours_start TIME,        -- e.g., '21:00'
  ADD COLUMN IF NOT EXISTS quiet_hours_end   TIME,        -- e.g., '07:00'
  ADD COLUMN IF NOT EXISTS quiet_hours_skip_emergency BOOLEAN DEFAULT true;

CREATE UNIQUE INDEX IF NOT EXISTS idx_notification_settings_user ON notification_settings(user_id);

COMMIT;
