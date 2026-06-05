// src/routes/pushNotificationRoutes.js - Web push notification system
const express = require('express');
const router = express.Router();
const db = require('../db');
const { v4: uuidv4 } = require('uuid');
let webpush;
try { webpush = require('web-push'); } catch (e) {
  console.warn('[Push] web-push not installed — push notifications disabled.');
  webpush = null;
}
const auth = require('../middleware/auth');
const requireAdmin = require('../middleware/authorizeAdmin');

// Configure web-push with VAPID keys
// Generate once with: npx web-push generate-vapid-keys
const VAPID_PUBLIC_KEY = process.env.VAPID_PUBLIC_KEY || 'PLACEHOLDER_REPLACE_WITH_REAL_KEY';
const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY || 'PLACEHOLDER_REPLACE_WITH_REAL_KEY';

if (webpush && VAPID_PUBLIC_KEY !== 'PLACEHOLDER_REPLACE_WITH_REAL_KEY') {
  webpush.setVapidDetails(
    'mailto:admin@chippewavalleyhomecare.com',
    VAPID_PUBLIC_KEY,
    VAPID_PRIVATE_KEY
  );
}

// Helper: send push to a user
// payload may include { eventType, urgent } so the prefs gate can honor
// channel toggle + event opt-out + quiet hours. If omitted, allowed by default.
const sendPushToUser = async (userId, payload) => {
  try {
    // Respect user notification preferences
    try {
      const { shouldNotify } = require('../helpers/notificationPrefs');
      const evt = payload?.data?.eventType || payload?.eventType;
      const urgent = !!(payload?.data?.urgent || payload?.urgent);
      const ok = await shouldNotify(userId, 'push', evt || null, { urgent });
      if (!ok) {
        console.log(`[PUSH] skipped for ${userId} — user prefs (event=${evt}, urgent=${urgent})`);
        return;
      }
    } catch (e) { /* prefs helper failure → don't block notifications */ }

    const subs = await db.query(
      `SELECT subscription FROM push_subscriptions WHERE user_id = $1 AND is_active = true`,
      [userId]
    );

    for (const row of subs.rows) {
      try {
        if (!webpush) throw new Error('web-push not available');
        await webpush.sendNotification(
          row.subscription,
          JSON.stringify(payload)
        );
      } catch (e) {
        if (e.statusCode === 410 || e.statusCode === 404) {
          // Subscription expired — deactivate it
          await db.query(
            `UPDATE push_subscriptions SET is_active = false WHERE user_id = $1 AND subscription = $2`,
            [userId, row.subscription]
          );
        }
      }
    }
  } catch (error) {
    console.error('[PUSH] sendPushToUser error:', error.message);
  }
};

// GET /api/push/vapid-key - Return public key for client subscription setup
router.get('/vapid-key', (req, res) => {
  // If the placeholder is still in place, push is unconfigured. Return a
  // 503 instead of handing the client a string it'll try to subscribe with
  // (which silently breaks registration).
  if (!VAPID_PUBLIC_KEY || VAPID_PUBLIC_KEY === 'PLACEHOLDER_REPLACE_WITH_REAL_KEY') {
    return res.status(503).json({ error: 'Push notifications not configured', configured: false });
  }
  res.json({ publicKey: VAPID_PUBLIC_KEY, configured: true });
});

// POST /api/push/subscribe - Register a push subscription
router.post('/subscribe', auth, async (req, res) => {
  try {
    const { subscription } = req.body;
    if (!subscription) return res.status(400).json({ error: 'subscription is required' });

    const subStr = JSON.stringify(subscription);

    // Upsert subscription
    await db.query(`
      INSERT INTO push_subscriptions (id, user_id, subscription, is_active, created_at)
      VALUES ($1, $2, $3, true, NOW())
      ON CONFLICT (user_id, subscription) DO UPDATE SET is_active = true, updated_at = NOW()`,
      [uuidv4(), req.user.id, subStr]
    );

    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/push/unsubscribe - Remove a push subscription
router.post('/unsubscribe', auth, async (req, res) => {
  try {
    const { subscription } = req.body;
    const subStr = JSON.stringify(subscription);
    
    await db.query(
      `UPDATE push_subscriptions SET is_active = false WHERE user_id = $1 AND subscription = $2`,
      [req.user.id, subStr]
    );

    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/push/send-clock-in-confirm - Called by clock-in endpoint
router.post('/send-clock-in-confirm', auth, async (req, res) => {
  try {
    const { caregiverId, clientName, startTime, timeEntryId } = req.body;

    const payload = {
      title: '✅ Clocked In',
      body: `You are clocked in${clientName ? ` for ${clientName}` : ''}. Started at ${startTime}.`,
      icon: '/icon-192.png',
      badge: '/badge-72.png',
      tag: `clock-in-${timeEntryId}`,
      data: { type: 'clock_in', timeEntryId },
    };

    await sendPushToUser(caregiverId, payload);

    // Also store in-app notification
    await db.query(`
      INSERT INTO notifications (id, user_id, type, title, message, is_read, created_at)
      VALUES ($1, $2, 'clock_in_confirm', 'Clocked In', $3, true, NOW())`,
      [uuidv4(), caregiverId, payload.body]
    );

    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/push/send-clock-out-confirm - Called by clock-out endpoint
router.post('/send-clock-out-confirm', auth, async (req, res) => {
  try {
    const { caregiverId, clientName, duration, totalHours } = req.body;

    const payload = {
      title: '🕐 Clocked Out',
      body: `Shift complete${clientName ? ` — ${clientName}` : ''}. Duration: ${duration}. Total today: ${totalHours}h.`,
      icon: '/icon-192.png',
      badge: '/badge-72.png',
      tag: `clock-out-${Date.now()}`,
      data: { type: 'clock_out' },
    };

    await sendPushToUser(caregiverId, payload);

    await db.query(`
      INSERT INTO notifications (id, user_id, type, title, message, is_read, created_at)
      VALUES ($1, $2, 'clock_out_confirm', 'Clocked Out', $3, true, NOW())`,
      [uuidv4(), caregiverId, payload.body]
    );

    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/push/send-to-caregiver - Admin sends custom notification
router.post('/send-to-caregiver', auth, requireAdmin, async (req, res) => {
  try {
    const { caregiverId, title, message, type = 'admin_message' } = req.body;

    await sendPushToUser(caregiverId, { title, body: message, icon: '/icon-192.png', tag: type });

    await db.query(`
      INSERT INTO notifications (id, user_id, type, title, message, is_read, created_at)
      VALUES ($1, $2, $3, $4, $5, false, NOW())`,
      [uuidv4(), caregiverId, type, title, message]
    );

    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET /api/push/unread-count - Get unread notification count for user
// Uses `status` (post-migration-v25 source of truth) to match the bell with
// the NotificationCenter 'New' tab. Prior bug: bell queried is_read, page
// queried status — they drifted out of sync, showing phantom unread counts.
router.get('/unread-count', auth, async (req, res) => {
  try {
    const result = await db.query(
      `SELECT COUNT(*) as count FROM notifications WHERE user_id = $1 AND status = 'new'`,
      [req.user.id]
    );
    res.json({ count: parseInt(result.rows[0]?.count || 0) });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/push/mark-read - Mark notifications as read
// Updates both is_read and status='handled' to keep them in sync; prior bug
// was updating only is_read, leaving stale status='new' rows.
router.post('/mark-read', auth, async (req, res) => {
  try {
    const { ids } = req.body; // array of notification ids, or 'all'
    if (ids === 'all') {
      await db.query(
        `UPDATE notifications SET is_read = true, status = 'handled', handled_at = NOW()
         WHERE user_id = $1 AND (is_read = false OR status = 'new')`,
        [req.user.id]
      );
    } else if (Array.isArray(ids) && ids.length > 0) {
      await db.query(
        `UPDATE notifications SET is_read = true, status = 'handled', handled_at = NOW()
         WHERE user_id = $1 AND id = ANY($2)`,
        [req.user.id, ids]
      );
    }
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/push/shift-reminder-1hr — Send push reminders for shifts starting in ~1 hour
// Designed to be called by external cron every 15 minutes
router.post('/shift-reminder-1hr', auth, async (req, res) => {
  try {
    // Find shifts starting in 45-75 minutes from now
    const result = await db.query(`
      WITH upcoming AS (
        SELECT s.id, s.caregiver_id, s.client_id, s.start_time, s.end_time,
          c.first_name AS client_first, c.last_name AS client_last,
          u.first_name AS cg_first, u.last_name AS cg_last
        FROM schedules s
        JOIN clients c ON s.client_id = c.id
        JOIN users u ON s.caregiver_id = u.id
        WHERE s.is_active = true
          AND (
            (s.date = CURRENT_DATE AND s.start_time BETWEEN (NOW()::time + INTERVAL '45 minutes') AND (NOW()::time + INTERVAL '75 minutes'))
            OR (s.day_of_week = EXTRACT(DOW FROM NOW())::int AND s.date IS NULL
                AND s.start_time BETWEEN (NOW()::time + INTERVAL '45 minutes') AND (NOW()::time + INTERVAL '75 minutes'))
          )
      )
      SELECT * FROM upcoming
      WHERE NOT EXISTS (
        SELECT 1 FROM notifications n
        WHERE n.user_id = upcoming.caregiver_id
          AND n.type = 'shift_reminder_1hr'
          AND n.created_at::date = CURRENT_DATE
          AND n.message LIKE '%' || upcoming.client_first || ' ' || upcoming.client_last || '%'
      )
    `);

    let sent = 0;
    for (const shift of result.rows) {
      const startFormatted = shift.start_time.substring(0, 5);
      await sendPushToUser(shift.caregiver_id, {
        title: 'Upcoming Shift - 1 Hour',
        body: `You have a shift with ${shift.client_first} ${shift.client_last} at ${startFormatted}`,
        icon: '/icon-192.png',
        tag: `shift-reminder-${shift.id}-${new Date().toISOString().split('T')[0]}`,
        data: { type: 'shift_reminder', scheduleId: shift.id }
      });

      // Also create in-app notification
      await db.query(
        `INSERT INTO notifications (id, user_id, type, title, message) VALUES ($1, $2, $3, $4, $5)`,
        [uuidv4(), shift.caregiver_id, 'shift_reminder_1hr',
         'Upcoming Shift',
         `Shift with ${shift.client_first} ${shift.client_last} starts at ${startFormatted}`]
      );
      sent++;
    }

    res.json({ success: true, sent, total: result.rows.length });
  } catch (error) {
    console.error('Shift reminder error:', error);
    res.status(500).json({ error: error.message });
  }
});

module.exports = { router, sendPushToUser };
