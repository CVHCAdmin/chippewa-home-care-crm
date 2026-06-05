// Daily scan for authorizations that are running low or expiring soon and
// drop a notification into the admin notification queue. Previously there
// was no proactive alert — alerts only fired *after* a claim consumed units,
// so a slow-burning client could expire silently.

const db = require('../db');

const DAY_MS = 24 * 60 * 60 * 1000;
let timer = null;

async function scanOnce() {
  try {
    // Low units: remaining <= threshold, still active, no alert sent today
    const low = await db.query(`
      SELECT a.id, a.auth_number, a.authorized_units, a.used_units,
        a.low_units_alert_threshold,
        (a.authorized_units - a.used_units) AS remaining_units,
        a.end_date,
        c.first_name AS client_first, c.last_name AS client_last
      FROM authorizations a
      JOIN clients c ON a.client_id = c.id
      WHERE a.status = 'active'
        AND (a.authorized_units - a.used_units) <= a.low_units_alert_threshold
        AND (a.last_low_alert_at IS NULL OR a.last_low_alert_at < NOW() - INTERVAL '24 hours')
    `);

    const expiring = await db.query(`
      SELECT a.id, a.auth_number, a.end_date,
        c.first_name AS client_first, c.last_name AS client_last
      FROM authorizations a
      JOIN clients c ON a.client_id = c.id
      WHERE a.status = 'active'
        AND a.end_date BETWEEN CURRENT_DATE AND CURRENT_DATE + INTERVAL '14 days'
        AND (a.last_expiring_alert_at IS NULL OR a.last_expiring_alert_at < NOW() - INTERVAL '24 hours')
    `);

    if (low.rows.length === 0 && expiring.rows.length === 0) {
      console.log('[Auth Alerts] No new alerts to send');
      return;
    }

    const admins = await db.query(`SELECT id FROM users WHERE role = 'admin' AND is_active = true`);
    if (admins.rows.length === 0) return;

    const { shouldNotify } = require('../helpers/notificationPrefs');
    // For each admin, determine once whether they want low_auth / expiring_cert
    // in-app notifications. low_units and expiring use the same event categories.
    const wantLowAuth   = {};
    const wantExpiring  = {};
    for (const adm of admins.rows) {
      wantLowAuth[adm.id]  = await shouldNotify(adm.id, 'push', 'low_auth');
      wantExpiring[adm.id] = await shouldNotify(adm.id, 'push', 'expiring_cert');
    }

    for (const a of low.rows) {
      const title = `Authorization running low: ${a.client_first} ${a.client_last}`;
      const message = `Auth ${a.auth_number || ''} has ${a.remaining_units} units remaining (threshold ${a.low_units_alert_threshold}). Expires ${a.end_date}.`;
      for (const adm of admins.rows) {
        if (!wantLowAuth[adm.id]) continue;
        await db.query(
          `INSERT INTO notifications (user_id, type, title, message, status)
           VALUES ($1, 'auth_low_units', $2, $3, 'new')`,
          [adm.id, title, message]
        );
      }
      await db.query(`UPDATE authorizations SET last_low_alert_at = NOW() WHERE id = $1`, [a.id]);
    }

    for (const a of expiring.rows) {
      const days = Math.ceil((new Date(a.end_date) - Date.now()) / DAY_MS);
      const title = `Authorization expiring in ${days} day(s): ${a.client_first} ${a.client_last}`;
      const message = `Auth ${a.auth_number || ''} ends ${a.end_date}. Schedule renewal now to avoid coverage gap.`;
      for (const adm of admins.rows) {
        if (!wantExpiring[adm.id]) continue;
        await db.query(
          `INSERT INTO notifications (user_id, type, title, message, status)
           VALUES ($1, 'auth_expiring', $2, $3, 'new')`,
          [adm.id, title, message]
        );
      }
      await db.query(`UPDATE authorizations SET last_expiring_alert_at = NOW() WHERE id = $1`, [a.id]);
    }

    console.log(`[Auth Alerts] Sent ${low.rows.length} low-units + ${expiring.rows.length} expiring alerts to ${admins.rows.length} admins`);
  } catch (e) {
    console.error('[Auth Alerts] scan failed:', e.message);
  }
}

async function ensureColumns() {
  try {
    await db.query(`
      ALTER TABLE authorizations
        ADD COLUMN IF NOT EXISTS last_low_alert_at TIMESTAMPTZ,
        ADD COLUMN IF NOT EXISTS last_expiring_alert_at TIMESTAMPTZ
    `);
  } catch (e) {
    console.error('[Auth Alerts] migration failed:', e.message);
  }
}

function startCron() {
  ensureColumns().then(() => {
    // Run once 60s after startup, then every 24 hours
    setTimeout(scanOnce, 60_000);
    timer = setInterval(scanOnce, 24 * 60 * 60 * 1000);
    console.log('[Auth Alerts] cron started (every 24h)');
  });
}

function stopCron() {
  if (timer) clearInterval(timer);
  timer = null;
}

module.exports = { startCron, stopCron, scanOnce };
