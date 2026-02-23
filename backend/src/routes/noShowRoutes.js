// routes/noShowRoutes.js
// Automated no-show detection + SMS alerts

const express = require('express');
const router = express.Router();
const db = require('../db');
const auth = require('../middleware/auth');

let twilioClient = null;
if (process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN) {
  const twilio = require('twilio');
  twilioClient = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
}

const sendSMS = async (to, body) => {
  if (!twilioClient || !to) return false;
  try {
    await twilioClient.messages.create({ body, from: process.env.TWILIO_PHONE_NUMBER, to });
    return true;
  } catch (e) { console.error('SMS failed:', e.message); return false; }
};

// GET alert config
router.get('/config', auth, async (req, res) => {
  try {
    const result = await db.query('SELECT * FROM noshow_alert_config LIMIT 1');
    res.json(result.rows[0] || {});
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// PUT update config
router.put('/config', auth, async (req, res) => {
  const { graceMinutes, notifyAdmin, notifyCaregiver, notifyClientFamily, adminPhone, adminEmail, isActive } = req.body;
  try {
    const result = await db.query(`
      UPDATE noshow_alert_config SET
        grace_minutes = COALESCE($1, grace_minutes),
        notify_admin = COALESCE($2, notify_admin),
        notify_caregiver = COALESCE($3, notify_caregiver),
        notify_client_family = COALESCE($4, notify_client_family),
        admin_phone = COALESCE($5, admin_phone),
        admin_email = COALESCE($6, admin_email),
        is_active = COALESCE($7, is_active),
        updated_at = NOW()
      RETURNING *
    `, [graceMinutes, notifyAdmin, notifyCaregiver, notifyClientFamily, adminPhone, adminEmail, isActive]);
    res.json(result.rows[0]);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// GET active no-show alerts
router.get('/alerts', auth, async (req, res) => {
  const { status = 'open', limit = 50 } = req.query;
  try {
    const result = await db.query(`
      SELECT na.*,
        u.first_name || ' ' || u.last_name AS caregiver_name,
        u.phone AS caregiver_phone,
        c.first_name || ' ' || c.last_name AS client_name
      FROM noshow_alerts na
      LEFT JOIN users u ON na.caregiver_id = u.id
      LEFT JOIN clients c ON na.client_id = c.id
      WHERE ($1 = '' OR na.status = $1)
      ORDER BY na.shift_date DESC, na.expected_start DESC
      LIMIT $2
    `, [status === 'all' ? '' : status, limit]);
    res.json(result.rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST resolve alert
router.put('/alerts/:id/resolve', auth, async (req, res) => {
  const { resolutionNote, status = 'resolved' } = req.body;
  try {
    const result = await db.query(`
      UPDATE noshow_alerts SET
        status = $1, resolved_at = NOW(), resolved_by = $2, resolution_note = $3
      WHERE id = $4 RETURNING *
    `, [status, req.user.id, resolutionNote || null, req.params.id]);
    res.json(result.rows[0]);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST run check — called by cron or manually from admin
// Finds any schedules that should have started > grace_minutes ago with no EVV clock-in
router.post('/run-check', auth, async (req, res) => {
  try {
    const configRes = await db.query('SELECT * FROM noshow_alert_config WHERE is_active = TRUE LIMIT 1');
    if (!configRes.rows.length) return res.json({ checked: 0, alerts: 0 });
    const config = configRes.rows[0];
    const grace = config.grace_minutes || 15;

    // Find schedules that started more than grace_minutes ago today with no time_tracking entry
    const overdue = await db.query(`
      SELECT
        s.id AS schedule_id,
        s.caregiver_id,
        s.client_id,
        CURRENT_DATE AS shift_date,
        s.start_time AS expected_start,
        u.first_name || ' ' || u.last_name AS caregiver_name,
        u.phone AS caregiver_phone,
        c.first_name || ' ' || c.last_name AS client_name
      FROM schedules s
      JOIN users u ON s.caregiver_id = u.id
      JOIN clients c ON s.client_id = c.id
      WHERE s.is_active = TRUE
        AND (
          -- recurring: day_of_week matches today
          (s.day_of_week = EXTRACT(DOW FROM CURRENT_DATE)::int AND s.schedule_type = 'recurring')
          OR
          -- one-time: date is today
          (s.schedule_type = 'one-time' AND s.date = CURRENT_DATE)
        )
        -- started more than grace_minutes ago
        AND (CURRENT_TIME - s.start_time) > ($1 * INTERVAL '1 minute')
        AND (CURRENT_TIME - s.start_time) < INTERVAL '4 hours'
        -- no clock-in today
        AND NOT EXISTS (
          SELECT 1 FROM time_tracking tt
          WHERE tt.caregiver_id = s.caregiver_id
            AND tt.client_id = s.client_id
            AND DATE(tt.clock_in) = CURRENT_DATE
            AND ABS(EXTRACT(EPOCH FROM (tt.clock_in::time - s.start_time)) / 60) < 120
        )
        -- not already alerted today
        AND NOT EXISTS (
          SELECT 1 FROM noshow_alerts na
          WHERE na.caregiver_id = s.caregiver_id
            AND na.client_id = s.client_id
            AND na.shift_date = CURRENT_DATE
            AND na.status = 'open'
        )
    `, [grace]);

    let alertsCreated = 0;
    for (const row of overdue.rows) {
      // Create alert record
      await db.query(`
        INSERT INTO noshow_alerts (schedule_id, caregiver_id, client_id, shift_date, expected_start, sms_sent)
        VALUES ($1,$2,$3,$4,$5, FALSE)
        ON CONFLICT DO NOTHING
      `, [row.schedule_id, row.caregiver_id, row.client_id, row.shift_date, row.expected_start]);

      let smsSent = false;

      // SMS caregiver
      if (config.notify_caregiver && row.caregiver_phone) {
        smsSent = await sendSMS(row.caregiver_phone,
          `CVHC Alert: You were scheduled to start with ${row.client_name} at ${row.expected_start}. Please clock in or contact the office immediately.`
        );
      }

      // SMS admin
      if (config.notify_admin && config.admin_phone) {
        await sendSMS(config.admin_phone,
          `CVHC No-Show Alert: ${row.caregiver_name} has not clocked in for ${row.client_name} (scheduled ${row.expected_start}). Please follow up.`
        );
      }

      if (smsSent) {
        await db.query(`UPDATE noshow_alerts SET sms_sent = TRUE WHERE caregiver_id=$1 AND client_id=$2 AND shift_date=$3`,
          [row.caregiver_id, row.client_id, row.shift_date]);
      }

      alertsCreated++;
    }

    res.json({ checked: overdue.rows.length, alerts: alertsCreated, grace_minutes: grace });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// GET today's summary stats
router.get('/stats', auth, async (req, res) => {
  try {
    const result = await db.query(`
      SELECT
        COUNT(*) FILTER (WHERE status = 'open') AS open_count,
        COUNT(*) FILTER (WHERE status = 'resolved') AS resolved_count,
        COUNT(*) FILTER (WHERE status = 'false_alarm') AS false_alarm_count,
        COUNT(*) FILTER (WHERE shift_date = CURRENT_DATE) AS today_count,
        COUNT(*) FILTER (WHERE shift_date >= CURRENT_DATE - 7) AS week_count
      FROM noshow_alerts
    `);
    res.json(result.rows[0]);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
