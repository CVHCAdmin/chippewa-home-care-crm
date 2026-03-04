-- Migration v6: Login Activity Monitor
-- Tracks all login attempts for admin visibility (no passwords stored)

CREATE TABLE IF NOT EXISTS login_activity (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  email        VARCHAR(255) NOT NULL,
  user_id      UUID REFERENCES users(id) ON DELETE SET NULL,
  success      BOOLEAN NOT NULL DEFAULT false,
  ip_address   VARCHAR(45),
  user_agent   TEXT,
  fail_reason  VARCHAR(100),   -- 'invalid_password', 'user_not_found', 'account_inactive'
  created_at   TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_login_activity_email      ON login_activity(email);
CREATE INDEX IF NOT EXISTS idx_login_activity_user_id    ON login_activity(user_id);
CREATE INDEX IF NOT EXISTS idx_login_activity_created_at ON login_activity(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_login_activity_success    ON login_activity(success);
