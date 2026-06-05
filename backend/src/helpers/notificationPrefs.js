// Notification preferences helper — single gate that every send path calls
// to decide whether THIS user wants THIS event type on THIS channel right now.
//
// Channels:  'email' | 'sms' | 'push'
// Event types match the boolean columns added in migration v44:
//   'schedule' | 'shift_reminder' | 'absence' | 'payroll' | 'payment'
//   | 'billing' | 'low_auth' | 'expiring_cert' | 'message'
//
// Behavior:
//   - No preferences row → default to allowing everything (opt-in by silence).
//   - Channel disabled → block.
//   - Event-type opt-out → block.
//   - Quiet hours in effect AND not flagged urgent → block.
//   - Otherwise → allow.
//
// Usage:
//   const { shouldNotify } = require('../helpers/notificationPrefs');
//   if (await shouldNotify(userId, 'sms', 'shift_reminder')) await twilio.send(...);

const db = require('../db');

// Map our event-type slug → the corresponding DB column on notification_settings
const EVENT_COLUMN = {
  schedule:        'schedule_alerts',
  shift_reminder:  'shift_reminder_alerts',
  absence:         'absence_alerts',
  payroll:         'payroll_alerts',
  payment:         'payment_alerts',
  billing:         'billing_alerts',
  low_auth:        'low_auth_alerts',
  expiring_cert:   'expiring_cert_alerts',
  message:         'message_alerts',
};

const CHANNEL_COLUMN = {
  email: 'email_enabled',
  sms:   'sms_enabled',
  push:  'push_enabled',
};

// Small cache (60s) keyed by userId to avoid hammering DB on burst sends
const CACHE_MS = 60_000;
const cache = new Map();

async function getPrefs(userId) {
  if (!userId) return null;
  const hit = cache.get(userId);
  if (hit && hit.ts > Date.now() - CACHE_MS) return hit.row;
  try {
    const r = await db.query(`SELECT * FROM notification_settings WHERE user_id = $1`, [userId]);
    const row = r.rows[0] || null;
    cache.set(userId, { row, ts: Date.now() });
    return row;
  } catch (e) {
    console.error('[notificationPrefs] read failed:', e.message);
    return null;
  }
}

function inQuietHours(prefs, now = new Date()) {
  if (!prefs || !prefs.quiet_hours_start || !prefs.quiet_hours_end) return false;
  // PG TIME values come back as strings 'HH:MM:SS'
  const parseHm = (t) => {
    const [h, m] = String(t).split(':').map(Number);
    return h * 60 + (m || 0);
  };
  const start = parseHm(prefs.quiet_hours_start);
  const end   = parseHm(prefs.quiet_hours_end);
  const cur   = now.getHours() * 60 + now.getMinutes();
  // Same-day window vs overnight-wrap window
  return start <= end
    ? (cur >= start && cur < end)
    : (cur >= start || cur < end);   // e.g. 21:00 → 07:00
}

/**
 * @param {string} userId
 * @param {'email'|'sms'|'push'} channel
 * @param {string} [eventType] — slug from EVENT_COLUMN, or null/undefined to skip event-type check
 * @param {object} [opts] — { urgent?: bool } urgent bypasses quiet hours when user has skip_emergency enabled
 * @returns {Promise<boolean>}
 */
async function shouldNotify(userId, channel, eventType, opts = {}) {
  const channelCol = CHANNEL_COLUMN[channel];
  if (!channelCol) return false;  // unknown channel
  const prefs = await getPrefs(userId);
  if (!prefs) return true;        // no row → allow (default)

  if (prefs[channelCol] === false) return false;

  if (eventType) {
    const evtCol = EVENT_COLUMN[eventType];
    if (evtCol && prefs[evtCol] === false) return false;
  }

  if (inQuietHours(prefs)) {
    const urgent = !!opts.urgent;
    const allowUrgent = prefs.quiet_hours_skip_emergency !== false;
    if (!(urgent && allowUrgent)) return false;
  }

  return true;
}

// Invalidate cache when the user changes their prefs (call from PUT route)
function invalidate(userId) {
  if (userId) cache.delete(userId);
  else cache.clear();
}

module.exports = { shouldNotify, getPrefs, inQuietHours, invalidate, EVENT_COLUMN, CHANNEL_COLUMN };
