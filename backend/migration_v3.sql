-- Migration v3: Company Message Board + Miss Report → Open Shift auto-creation
-- Run with: psql $DATABASE_URL -f migration_v3.sql

-- ─── MESSAGE BOARD ────────────────────────────────────────────────────────────

-- Message threads (one thread per conversation)
CREATE TABLE IF NOT EXISTS message_threads (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  subject VARCHAR(255) NOT NULL,
  created_by UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  thread_type VARCHAR(20) DEFAULT 'direct', -- 'direct', 'group', 'broadcast'
  is_broadcast BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Thread participants (who is in this thread)
CREATE TABLE IF NOT EXISTS message_thread_participants (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  thread_id UUID NOT NULL REFERENCES message_threads(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  last_read_at TIMESTAMPTZ,
  joined_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(thread_id, user_id)
);

-- Messages within threads
CREATE TABLE IF NOT EXISTS messages (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  thread_id UUID NOT NULL REFERENCES message_threads(id) ON DELETE CASCADE,
  sender_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  body TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  is_deleted BOOLEAN DEFAULT false
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_messages_thread ON messages(thread_id, created_at);
CREATE INDEX IF NOT EXISTS idx_thread_participants_user ON message_thread_participants(user_id);
CREATE INDEX IF NOT EXISTS idx_thread_participants_thread ON message_thread_participants(thread_id);
CREATE INDEX IF NOT EXISTS idx_threads_updated ON message_threads(updated_at DESC);

-- ─── MISS REPORT IMPROVEMENTS ─────────────────────────────────────────────────

-- Add source_absence_id to open_shifts to link back to the miss report that created it
ALTER TABLE open_shifts
  ADD COLUMN IF NOT EXISTS source_absence_id UUID REFERENCES absences(id),
  ADD COLUMN IF NOT EXISTS notified_caregiver_count INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS auto_created BOOLEAN DEFAULT false;

-- Track which caregivers were notified about an open shift
CREATE TABLE IF NOT EXISTS open_shift_notifications (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  open_shift_id UUID NOT NULL REFERENCES open_shifts(id) ON DELETE CASCADE,
  caregiver_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  notified_at TIMESTAMPTZ DEFAULT NOW(),
  notification_type VARCHAR(20) DEFAULT 'push', -- 'push', 'sms', 'both'
  UNIQUE(open_shift_id, caregiver_id)
);

CREATE INDEX IF NOT EXISTS idx_open_shift_notifications ON open_shift_notifications(open_shift_id);
