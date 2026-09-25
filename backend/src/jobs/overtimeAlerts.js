// Over-scheduled-time alerts — texts a caregiver who is still clocked in past the
// LENGTH of their scheduled visit, measured from when they actually clocked in
// (clocked in 9:05 for a 1-hour visit → "over" at 10:05, not 10:00).
//
//   +5 min  → text the caregiver
//   +30 min → text the caregiver again
//   +60 min → text the caregiver AND the office (admins' phones + in-app notification)
//
// Why SMS and not push: push_subscriptions is empty on prod (0 subscribers), so a
// web push reaches nobody. The in-app toast from /check-warnings only shows while
// the app is open. This runs server-side, so it works with the app closed.
//
// The scheduled length is time_entries.allotted_minutes, set at clock-in from the
// matched occurrence. Entries without one (unscheduled visits) are skipped — there
// is nothing to measure against.
//
// Each threshold fires at most once per time entry (overtime_alert_log PK). If the
// scan was delayed (deploy/restart) and an entry has already crossed several
// thresholds, only the HIGHEST is sent; the lower ones are marked done silently.
//
// Entries whose scheduled end is more than STALE_HOURS ago are ignored: those are
// days-old stuck punches (e.g. one open since 9/13) that need Force Clock Out, not
// a text. Without this, the first scan after deploy would text about them.

const db = require('../db');

const THRESHOLDS = [5, 30, 60];           // minutes past the scheduled length
const OFFICE_THRESHOLD = 60;
const STALE_HOURS = 12;
let timer = null;

// Sender is swappable so tests never hit Twilio.
let sendSmsImpl = async (to, body) => {
  if (!process.env.TWILIO_ACCOUNT_SID || !process.env.TWILIO_AUTH_TOKEN || !process.env.TWILIO_PHONE_NUMBER) {
    return { status: 'logged', sid: null, error: 'Twilio not configured' };
  }
  const twilio = require('twilio')(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
  const m = await twilio.messages.create({ body, from: process.env.TWILIO_PHONE_NUMBER, to });
  return { status: 'sent', sid: m.sid, error: null };
};
function _setSender(fn) { sendSmsImpl = fn; }

// Stored phones are mixed: '7158645052', '(715) 829-3135', '715-944-4597'.
// Twilio wants E.164.
function toE164(phone) {
  const d = String(phone || '').replace(/\D/g, '');
  if (d.length === 10) return `+1${d}`;
  if (d.length === 11 && d.startsWith('1')) return `+${d}`;
  return null;
}

// Send one text and record it in sms_messages so the office can see delivery status.
async function sendText({ phone, body, recipientType, recipientId }) {
  const to = toE164(phone);
  if (!to) return false;
  // Honor an explicit "texts off"; urgent skips quiet hours — they're on the clock now.
  const { shouldNotify } = require('../helpers/notificationPrefs');
  if (!(await shouldNotify(recipientId, 'sms', null, { urgent: true }))) return false;
  const rec = await db.query(
    `INSERT INTO sms_messages (recipient_type, recipient_id, to_number, from_number, body, direction, status)
     VALUES ($1, $2, $3, $4, $5, 'outbound', 'pending') RETURNING id`,
    [recipientType, recipientId, to, process.env.TWILIO_PHONE_NUMBER || null, body]
  );
  try {
    const r = await sendSmsImpl(to, body);
    await db.query(
      `UPDATE sms_messages SET status = $1::varchar, twilio_sid = $2, error_message = $3,
              sent_at = CASE WHEN $1::varchar = 'sent' THEN NOW() ELSE sent_at END
       WHERE id = $4`,
      [r.status, r.sid, r.error, rec.rows[0].id]
    );
    return r.status === 'sent';
  } catch (e) {
    await db.query(`UPDATE sms_messages SET status = 'failed', error_message = $1 WHERE id = $2`, [e.message, rec.rows[0].id]);
    console.error('[overtime-alerts] SMS failed:', e.message);
    return false;
  }
}

function fmtDuration(min) {
  const h = Math.floor(min / 60), m = min % 60;
  if (h && m) return `${h} hr ${m} min`;
  return h ? `${h} hr` : `${m} min`;
}

async function ensureTable() {
  try {
    await db.query(`
      CREATE TABLE IF NOT EXISTS overtime_alert_log (
        time_entry_id UUID NOT NULL,
        threshold_min INTEGER NOT NULL,
        sent          BOOLEAN NOT NULL DEFAULT TRUE,  -- false = skipped by catch-up
        created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        PRIMARY KEY (time_entry_id, threshold_min)
      )
    `);
  } catch (e) { console.error('[overtime-alerts] migration:', e.message); }
}

async function scanOnce() {
  let sentCount = 0;
  try {
    const open = await db.query(`
      SELECT te.id, te.caregiver_id, te.client_id, te.allotted_minutes,
             FLOOR(EXTRACT(EPOCH FROM (NOW() - te.start_time)) / 60)::int - te.allotted_minutes AS minutes_over,
             to_char(te.start_time AT TIME ZONE 'America/Chicago', 'FMHH12:MI AM') AS clock_in_ct,
             u.first_name AS cg_first, u.last_name AS cg_last, u.phone AS cg_phone,
             c.first_name AS cl_first, c.last_name AS cl_last,
             COALESCE((SELECT MAX(l.threshold_min) FROM overtime_alert_log l WHERE l.time_entry_id = te.id), 0) AS last_threshold
      FROM time_entries te
      JOIN users u   ON u.id = te.caregiver_id
      JOIN clients c ON c.id = te.client_id
      WHERE te.end_time IS NULL
        AND te.allotted_minutes > 0
        AND NOW() > te.start_time + (te.allotted_minutes + $1) * INTERVAL '1 minute'
        AND NOW() < te.start_time + te.allotted_minutes * INTERVAL '1 minute' + $2 * INTERVAL '1 hour'
    `, [THRESHOLDS[0], STALE_HOURS]);

    for (const e of open.rows) {
      try {
        const crossed = THRESHOLDS.filter(t => e.minutes_over >= t);
        const top = crossed[crossed.length - 1];
        if (!top || top <= e.last_threshold) continue;

        // Claim the threshold atomically — if another instance already did, stop.
        const claim = await db.query(
          `INSERT INTO overtime_alert_log (time_entry_id, threshold_min, sent) VALUES ($1, $2, TRUE)
           ON CONFLICT DO NOTHING RETURNING 1`,
          [e.id, top]
        );
        if (!claim.rows.length) continue;
        // Lower thresholds that were skipped over by a delayed scan.
        for (const t of crossed.slice(0, -1)) {
          await db.query(
            `INSERT INTO overtime_alert_log (time_entry_id, threshold_min, sent) VALUES ($1, $2, FALSE)
             ON CONFLICT DO NOTHING`,
            [e.id, t]
          );
        }

        const client = `${e.cl_first} ${String(e.cl_last || '').charAt(0)}.`.trim();
        const scheduled = fmtDuration(e.allotted_minutes);
        const over = fmtDuration(e.minutes_over);

        await sendText({
          phone: e.cg_phone, recipientType: 'caregiver', recipientId: e.caregiver_id,
          body: `CVHC: You're still clocked in with ${client} — ${over} past your ${scheduled} visit (clocked in ${e.clock_in_ct}). Please clock out if you're done.`,
        }) && sentCount++;

        if (top === OFFICE_THRESHOLD) {
          const msg = `${e.cg_first} ${e.cg_last} is still clocked in with ${client} — ${over} past a ${scheduled} visit (clocked in ${e.clock_in_ct}).`;
          const admins = await db.query(`SELECT id, phone FROM users WHERE role = 'admin' AND is_active = true`);
          for (const a of admins.rows) {
            await db.query(
              `INSERT INTO notifications (user_id, type, title, message, status) VALUES ($1, 'overtime_alert', $2, $3, 'new')`,
              [a.id, 'Still clocked in past scheduled time', msg]
            );
            if (a.phone) await sendText({ phone: a.phone, recipientType: 'admin', recipientId: a.id, body: `CVHC: ${msg}` }) && sentCount++;
          }
        }
      } catch (err) { console.error('[overtime-alerts] one entry:', err.message); }
    }
    if (open.rows.length) console.log(`[overtime-alerts] ${open.rows.length} over-time entr(ies), ${sentCount} text(s) sent`);
  } catch (e) {
    console.error('[overtime-alerts] scan failed:', e.message);
  }
  return sentCount;
}

function startCron() {
  ensureTable().then(() => {
    setTimeout(scanOnce, 90_000);
    timer = setInterval(scanOnce, 5 * 60 * 1000);
    console.log('[overtime-alerts] cron started (every 5 min)');
  });
}

function stopCron() { if (timer) clearInterval(timer); timer = null; }

module.exports = { startCron, stopCron, scanOnce, ensureTable, toE164, _setSender, THRESHOLDS };
