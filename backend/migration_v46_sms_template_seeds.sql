-- Migration v46: Seed starter SMS templates
-- Gives admins a working baseline. Each variable is a {{moustache}} that
-- the existing send logic resolves at send time.

BEGIN;

INSERT INTO sms_templates (name, slug, body, category, variables, is_active)
SELECT * FROM (VALUES
  (
    'Shift Reminder (24h)',
    'shift_reminder_24h',
    'Reminder: You have a shift with {{client_first}} {{client_last}} tomorrow at {{start_time}}. Reply STOP to opt out.',
    'reminder',
    'client_first, client_last, start_time, end_time, address',
    true
  ),
  (
    'Shift Reminder (1h)',
    'shift_reminder_1h',
    '{{caregiver_first}}, your shift with {{client_first}} starts in 1 hour ({{start_time}}). Address: {{address}}.',
    'reminder',
    'caregiver_first, client_first, start_time, address',
    true
  ),
  (
    'Open Shift Available',
    'open_shift_available',
    'Open shift: {{client_first}} {{client_last}} on {{shift_date}} {{start_time}}-{{end_time}}. ${{hourly_rate}}/hr. Open app to claim.',
    'shift_offer',
    'client_first, client_last, shift_date, start_time, end_time, hourly_rate',
    true
  ),
  (
    'Schedule Confirmation',
    'schedule_confirmed',
    'You''re scheduled for {{client_first}} {{client_last}} on {{shift_date}} {{start_time}}-{{end_time}}. See you there!',
    'confirmation',
    'client_first, client_last, shift_date, start_time, end_time',
    true
  ),
  (
    'No-Show Alert (admin)',
    'no_show_alert',
    'No-show: {{caregiver_first}} {{caregiver_last}} was scheduled for {{client_first}} {{client_last}} at {{start_time}} but hasn''t clocked in.',
    'alert',
    'caregiver_first, caregiver_last, client_first, client_last, start_time',
    true
  ),
  (
    'Visit Complete (client)',
    'visit_complete_client',
    '{{caregiver_first}} just completed a {{duration}}-hour visit with {{client_first}}. Need anything? Reply here.',
    'notification',
    'caregiver_first, client_first, duration',
    true
  ),
  (
    'Welcome New Caregiver',
    'welcome_caregiver',
    'Welcome to {{agency_name}}, {{first_name}}! Download our app to see your schedule: {{app_url}}',
    'onboarding',
    'first_name, agency_name, app_url',
    true
  ),
  (
    'Payday Notification',
    'payday_notification',
    'Payday: ${{amount}} hits your account on {{pay_date}} for {{hours}} hours worked.',
    'payroll',
    'amount, pay_date, hours',
    true
  )
) AS t(name, slug, body, category, variables, is_active)
WHERE NOT EXISTS (
  SELECT 1 FROM sms_templates WHERE slug = t.slug
);

COMMIT;
