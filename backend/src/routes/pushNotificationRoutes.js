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
    'mailto:admin@chippewahomecare.com',
    VAPID_PUBLIC_KEY,
    VAPID_PRIVATE_KEY
  );
}

// Helper: send push to a user
const sendPushToUser = async (userId, payload) => {
  try {
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
  res.json({ publicKey: VAPID_PUBLIC_KEY });
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
router.get('/unread-count', auth, async (req, res) => {
  try {
    const result = await db.query(
      `SELECT COUNT(*) as count FROM notifications WHERE user_id = $1 AND is_read = false`,
      [req.user.id]
    );
    res.json({ count: parseInt(result.rows[0].count) });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/push/mark-read - Mark notifications as read
router.post('/mark-read', auth, async (req, res) => {
  try {
    const { ids } = req.body; // array of notification ids, or 'all'
    if (ids === 'all') {
      await db.query(`UPDATE notifications SET is_read = true WHERE user_id = $1`, [req.user.id]);
    } else if (Array.isArray(ids)) {
      await db.query(`UPDATE notifications SET is_read = true WHERE user_id = $1 AND id = ANY($2)`, [req.user.id, ids]);
    }
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = { router, sendPushToUser };
