// Shift-reminder cron — pushes "your shift starts in 1 hour" to caregivers.
// Honors per-caregiver notification preferences (shift_reminder event-type
// + push channel + quiet hours) via the shouldNotify helper, with a
// shift_reminder_sent_at column on schedules to prevent duplicates.

const db = require('../db');

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
    const now = new Date();
    const dow = now.getDay();
    const todayStr = now.toISOString().slice(0, 10);
    // Window: shifts starting between 55 and 65 minutes from now, today.
    // The cron runs every 5 min so any given shift gets exactly one chance.
    const upcoming = await db.query(`
      SELECT s.id, s.caregiver_id, s.client_id, s.start_time, s.end_time, s.date,
        c.first_name AS client_first, c.last_name AS client_last
      FROM schedules s
      JOIN clients c ON s.client_id = c.id
      WHERE s.is_active = true
        AND (
          (s.date IS NOT NULL AND s.date = CURRENT_DATE)
          OR (s.day_of_week = $1 AND (s.effective_date IS NULL OR s.effective_date <= CURRENT_DATE)
              AND (s.end_date IS NULL OR s.end_date >= CURRENT_DATE))
        )
        AND s.start_time::time BETWEEN (CURRENT_TIME + INTERVAL '55 minutes')::time AND (CURRENT_TIME + INTERVAL '65 minutes')::time
    `, [dow]);

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
