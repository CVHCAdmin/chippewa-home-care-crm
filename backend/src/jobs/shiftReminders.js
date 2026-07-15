// Shift-reminder cron — pushes "your shift starts in 1 hour" to caregivers.
// Honors per-caregiver notification preferences (shift_reminder event-type
// + push channel + quiet hours) via the shouldNotify helper, with a
// shift_reminder_sent_at column on schedules to prevent duplicates.

const db = require('../db');
const { SCHEDULE_OCCURRENCES_CTE } = require('../helpers/scheduleOccurrences');

const DAY_MS = 24 * 60 * 60 * 1000;
let timer = null;

async function ensureColumn() {
  try {
    // Per-occurrence dedupe: for one-time schedules this stores the last
    // send time; for recurring patterns we add a per-date check via the
    // sent log table to allow daily reminders.
    await db.query(`
      CREATE TABLE IF NOT EXISTS shift_reminder_log (
        schedule_id UUID NOT NULL,
        shift_date  DATE NOT NULL,
        sent_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        PRIMARY KEY (schedule_id, shift_date)
      )
    `);
  } catch (e) { console.error('[shift-reminders] migration:', e.message); }
}

async function scanOnce() {
  try {
    // Two bugs lived in the old version of this query:
    //
    //  1. It never looked at schedule_exceptions, so a CANCELLED visit still pushed
    //     "Shift in 1 hour" to the caregiver, and a RESCHEDULED visit was announced at
    //     its old time and never at its new one. It now expands through the shared
    //     engine, which drops cancellations and applies per-day overrides.
    //
    //  2. It compared `start_time` — a Chicago wall-clock time — against CURRENT_TIME,
    //     which is UTC on this server. A 09:00 shift was therefore "one hour away" when
    //     the UTC clock read 08:00, i.e. 03:00 in Chicago. Reminders fired five hours
    //     early, in the middle of the night, where quiet-hours almost certainly swallowed
    //     them — so caregivers got no reminder at all. Both the date and the clock now
    //     come from the database in America/Chicago.
    const nowCt = await db.query(
      `SELECT to_char((NOW() AT TIME ZONE 'America/Chicago')::date, 'YYYY-MM-DD') AS d,
              to_char((NOW() AT TIME ZONE 'America/Chicago')::time, 'HH24:MI:SS') AS t`
    );
    const todayStr = nowCt.rows[0].d;
    const nowTime = nowCt.rows[0].t;

    // Window: occurrences starting between 55 and 65 minutes from now, today.
    // The cron runs every 5 min so any given shift gets exactly one chance.
    const upcoming = await db.query(`
      WITH ${SCHEDULE_OCCURRENCES_CTE('occ')}
      SELECT occ.schedule_id AS id, occ.caregiver_id, occ.client_id,
             occ.start_time, occ.end_time, occ.occ_date AS date,
             c.first_name AS client_first, c.last_name AS client_last
      FROM occ
      JOIN clients c ON c.id = occ.client_id
      WHERE occ.start_time >= ($3::time + INTERVAL '55 minutes')::time
        AND occ.start_time <= ($3::time + INTERVAL '65 minutes')::time
    `, [todayStr, todayStr, nowTime]);

    if (upcoming.rows.length === 0) return;

    const { sendPushToUser } = require('../routes/pushNotificationRoutes');

    for (const s of upcoming.rows) {
      try {
        // Dedupe: skip if we already sent for this schedule on this date
        const dup = await db.query(
          `SELECT 1 FROM shift_reminder_log WHERE schedule_id = $1 AND shift_date = $2`,
          [s.id, todayStr]
        );
        if (dup.rows.length > 0) continue;
        await db.query(
          `INSERT INTO shift_reminder_log (schedule_id, shift_date) VALUES ($1, $2)
           ON CONFLICT (schedule_id, shift_date) DO NOTHING`,
          [s.id, todayStr]
        );

        const startHm = String(s.start_time).slice(0, 5);
        const endHm   = String(s.end_time).slice(0, 5);
        // sendPushToUser already checks notif prefs (push + shift_reminder + quiet hours)
        await sendPushToUser(s.caregiver_id, {
          title: '⏰ Shift in 1 hour',
          body:  `${s.client_first} ${s.client_last} · ${startHm}–${endHm}`,
          tag:   `shift-reminder-${s.id}-${todayStr}`,
          data:  { type: 'shift_reminder', eventType: 'shift_reminder', urgent: false, scheduleId: s.id },
        });
      } catch (e) { console.error('[shift-reminders] one shift:', e.message); }
    }
    console.log(`[shift-reminders] scanned ${upcoming.rows.length} upcoming shift(s)`);
  } catch (e) {
    console.error('[shift-reminders] scan failed:', e.message);
  }
}

function startCron() {
  ensureColumn().then(() => {
    // Run every 5 minutes; first run 60s after startup
    setTimeout(scanOnce, 60_000);
    timer = setInterval(scanOnce, 5 * 60 * 1000);
    console.log('[shift-reminders] cron started (every 5 min)');
  });
}

function stopCron() { if (timer) clearInterval(timer); timer = null; }

module.exports = { startCron, stopCron, scanOnce };
