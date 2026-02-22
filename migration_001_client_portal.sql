-- ============================================================
-- MIGRATION 001: Client Patient Portal
-- Chippewa Valley Home Care CRM
-- ============================================================
-- Run with: psql $DATABASE_URL < migration_001_client_portal.sql
-- ============================================================

BEGIN;

-- ============================================================
-- 1. CLIENT PORTAL AUTHENTICATION
--    Separate from users table intentionally.
--    clients.email exists but has no auth — this adds it.
-- ============================================================
CREATE TABLE client_portal_auth (
  id                 UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  client_id          UUID NOT NULL UNIQUE REFERENCES clients(id) ON DELETE CASCADE,
  email              VARCHAR(255) UNIQUE NOT NULL,
  password_hash      VARCHAR(255),                    -- NULL until invite is accepted
  portal_enabled     BOOLEAN DEFAULT false,
  invite_token       VARCHAR(255),                    -- bcrypt'd random token
  invite_expires_at  TIMESTAMPTZ,                     -- 48hr window
  failed_login_count INTEGER DEFAULT 0,               -- lockout support
  locked_until       TIMESTAMPTZ,                     -- NULL = not locked
  last_login         TIMESTAMPTZ,
  created_at         TIMESTAMPTZ DEFAULT NOW(),
  updated_at         TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_client_portal_auth_client_id    ON client_portal_auth(client_id);
CREATE INDEX idx_client_portal_auth_email        ON client_portal_auth(email);
CREATE INDEX idx_client_portal_auth_invite_token ON client_portal_auth(invite_token);

-- ============================================================
-- 2. SCHEDULED VISITS
--    Currently missing from schema entirely.
--    time_entries = completed visits. This = future/planned visits.
--    When caregiver clocks in, time_entry_id gets populated.
-- ============================================================
CREATE TABLE scheduled_visits (
  id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  client_id        UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  caregiver_id     UUID NOT NULL REFERENCES users(id),
  assignment_id    UUID REFERENCES client_assignments(id),
  scheduled_date   DATE NOT NULL,
  start_time       TIME NOT NULL,
  end_time         TIME NOT NULL,
  status           VARCHAR(50) NOT NULL DEFAULT 'scheduled',
                   -- 'scheduled' | 'in_progress' | 'completed' | 'cancelled' | 'no_show'
  cancelled_reason TEXT,
  cancelled_by     UUID REFERENCES users(id),         -- which admin cancelled
  cancelled_at     TIMESTAMPTZ,
  time_entry_id    UUID REFERENCES time_entries(id),  -- linked on clock-in
  notes            TEXT,
  created_by       UUID REFERENCES users(id),
  created_at       TIMESTAMPTZ DEFAULT NOW(),
  updated_at       TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_scheduled_visits_client_id   ON scheduled_visits(client_id);
CREATE INDEX idx_scheduled_visits_caregiver_id ON scheduled_visits(caregiver_id);
CREATE INDEX idx_scheduled_visits_date         ON scheduled_visits(scheduled_date);
CREATE INDEX idx_scheduled_visits_status       ON scheduled_visits(status);

-- ============================================================
-- 3. CLIENT NOTIFICATIONS
--    Separate table from notifications (which references users).
--    related_* fields allow deep-linking from notification to record.
-- ============================================================
CREATE TABLE client_notifications (
  id                   UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  client_id            UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  type                 VARCHAR(100) NOT NULL,
                       -- 'caregiver_late'
                       -- 'caregiver_no_show'
                       -- 'visit_cancelled'
                       -- 'visit_rescheduled'
                       -- 'invoice_ready'
                       -- 'payment_due'
                       -- 'payment_received'
                       -- 'caregiver_assigned'
                       -- 'caregiver_removed'
  title                VARCHAR(255) NOT NULL,
  message              TEXT,
  related_visit_id     UUID REFERENCES scheduled_visits(id) ON DELETE SET NULL,
  related_invoice_id   UUID REFERENCES invoices(id) ON DELETE SET NULL,
  related_caregiver_id UUID REFERENCES users(id) ON DELETE SET NULL,
  is_read              BOOLEAN DEFAULT false,
  email_sent           BOOLEAN DEFAULT false,
  created_at           TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_client_notifications_client_id   ON client_notifications(client_id);
CREATE INDEX idx_client_notifications_is_read     ON client_notifications(is_read);
CREATE INDEX idx_client_notifications_created_at  ON client_notifications(created_at);
CREATE INDEX idx_client_notifications_type        ON client_notifications(type);

-- ============================================================
-- 4. CLIENT NOTIFICATION PREFERENCES
--    Mirrors notification_preferences for users.
--    One row per client, created when portal is enabled.
-- ============================================================
CREATE TABLE client_notification_preferences (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  client_id         UUID NOT NULL UNIQUE REFERENCES clients(id) ON DELETE CASCADE,
  email_enabled     BOOLEAN DEFAULT true,
  portal_enabled    BOOLEAN DEFAULT true,
  caregiver_alerts  BOOLEAN DEFAULT true,   -- late / no-show
  schedule_alerts   BOOLEAN DEFAULT true,   -- cancellations / reschedules
  billing_alerts    BOOLEAN DEFAULT true,   -- invoices / payments
  assignment_alerts BOOLEAN DEFAULT true,   -- caregiver changes
  created_at        TIMESTAMPTZ DEFAULT NOW(),
  updated_at        TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- 5. HIPAA AUDIT TRIGGERS
--    Reuses existing audit_log_trigger() function.
--    Every insert/update/delete on sensitive portal tables is logged.
-- ============================================================
CREATE TRIGGER audit_client_portal_auth_trigger
  AFTER INSERT OR UPDATE OR DELETE ON client_portal_auth
  FOR EACH ROW EXECUTE FUNCTION audit_log_trigger();

CREATE TRIGGER audit_scheduled_visits_trigger
  AFTER INSERT OR UPDATE OR DELETE ON scheduled_visits
  FOR EACH ROW EXECUTE FUNCTION audit_log_trigger();

CREATE TRIGGER audit_client_notifications_trigger
  AFTER INSERT OR UPDATE OR DELETE ON client_notifications
  FOR EACH ROW EXECUTE FUNCTION audit_log_trigger();

-- ============================================================
-- 6. AUTO-MARK VISIT COMPLETED WHEN TIME ENTRY IS LINKED
--    When a caregiver clocks out and time_entry_id is set,
--    automatically flip scheduled_visit status to 'completed'.
-- ============================================================
CREATE OR REPLACE FUNCTION sync_visit_status_on_time_entry()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.time_entry_id IS NOT NULL AND OLD.time_entry_id IS NULL THEN
    UPDATE scheduled_visits
    SET status = 'in_progress', updated_at = NOW()
    WHERE id = NEW.id AND status = 'scheduled';
  END IF;

  IF NEW.status = 'completed' AND OLD.status != 'completed' THEN
    UPDATE scheduled_visits
    SET status = 'completed', updated_at = NOW()
    WHERE time_entry_id = NEW.time_entry_id;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER sync_visit_status_trigger
  AFTER UPDATE ON scheduled_visits
  FOR EACH ROW EXECUTE FUNCTION sync_visit_status_on_time_entry();

-- ============================================================
-- 7. AUTO-CREATE NOTIFICATION PREFERENCES ON PORTAL ENABLE
--    When client_portal_auth is inserted, create default prefs.
-- ============================================================
CREATE OR REPLACE FUNCTION create_client_notification_prefs()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO client_notification_preferences (client_id)
  VALUES (NEW.client_id)
  ON CONFLICT (client_id) DO NOTHING;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER auto_create_client_notif_prefs_trigger
  AFTER INSERT ON client_portal_auth
  FOR EACH ROW EXECUTE FUNCTION create_client_notification_prefs();

-- ============================================================
-- VERIFY: Quick sanity check queries (comment out if needed)
-- ============================================================
-- SELECT table_name FROM information_schema.tables
-- WHERE table_schema = 'public'
-- AND table_name IN (
--   'client_portal_auth',
--   'scheduled_visits',
--   'client_notifications',
--   'client_notification_preferences'
-- );

COMMIT;
