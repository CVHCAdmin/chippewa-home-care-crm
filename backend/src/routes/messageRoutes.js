// routes/messageRoutes.js - Company Message Board
const express = require('express');
const router = express.Router();
const db = require('../db');
const auth = require('../middleware/auth');
const requireAdmin = require('../middleware/authorizeAdmin');
const { v4: uuidv4 } = require('uuid');

// ─── GET INBOX ────────────────────────────────────────────────────────────────
// Returns all threads the current user participates in, with unread counts
router.get('/inbox', auth, async (req, res) => {
  try {
    const userId = req.user.id;
    const result = await db.query(`
      SELECT 
        mt.*,
        mtp.last_read_at,
        u.first_name as sender_first, u.last_name as sender_last,
        u.role as sender_role,
        (
          SELECT body FROM messages m
          WHERE m.thread_id = mt.id AND m.is_deleted = false
          ORDER BY m.created_at DESC LIMIT 1
        ) as last_message,
        (
          SELECT created_at FROM messages m
          WHERE m.thread_id = mt.id AND m.is_deleted = false
          ORDER BY m.created_at DESC LIMIT 1
        ) as last_message_at,
        (
          SELECT COUNT(*) FROM messages m
          WHERE m.thread_id = mt.id 
            AND m.is_deleted = false
            AND m.created_at > COALESCE(mtp.last_read_at, '1970-01-01')
            AND m.sender_id != $1
        ) as unread_count,
        (
          SELECT json_agg(json_build_object(
            'id', p.user_id,
            'first_name', pu.first_name,
            'last_name', pu.last_name,
            'role', pu.role
          ))
          FROM message_thread_participants p
          JOIN users pu ON p.user_id = pu.id
          WHERE p.thread_id = mt.id AND p.user_id != $1
        ) as other_participants
      FROM message_threads mt
      JOIN message_thread_participants mtp ON mt.id = mtp.thread_id AND mtp.user_id = $1
      JOIN users u ON mt.created_by = u.id
      ORDER BY COALESCE(
        (SELECT created_at FROM messages WHERE thread_id = mt.id ORDER BY created_at DESC LIMIT 1),
        mt.created_at
      ) DESC
    `, [userId]);

    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ─── GET UNREAD COUNT ─────────────────────────────────────────────────────────
router.get('/unread-count', auth, async (req, res) => {
  try {
    const userId = req.user.id;
    const result = await db.query(`
      SELECT COUNT(*) as count
      FROM messages m
      JOIN message_thread_participants mtp ON m.thread_id = mtp.thread_id AND mtp.user_id = $1
      WHERE m.is_deleted = false
        AND m.sender_id != $1
        AND m.created_at > COALESCE(mtp.last_read_at, '1970-01-01')
    `, [userId]);

    res.json({ count: parseInt(result.rows[0].count) });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ─── GET THREAD MESSAGES ──────────────────────────────────────────────────────
router.get('/thread/:threadId', auth, async (req, res) => {
  try {
    const { threadId } = req.params;
    const userId = req.user.id;

    // Verify user is a participant
    const participant = await db.query(
      'SELECT * FROM message_thread_participants WHERE thread_id = $1 AND user_id = $2',
      [threadId, userId]
    );
    if (!participant.rows.length && req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Not a participant in this thread' });
    }

    // Get thread info
    const thread = await db.query(`
      SELECT mt.*, 
        json_agg(json_build_object(
          'id', p.user_id,
          'first_name', pu.first_name,
          'last_name', pu.last_name,
          'role', pu.role
        )) as participants
      FROM message_threads mt
      JOIN message_thread_participants p ON mt.id = p.thread_id
      JOIN users pu ON p.user_id = pu.id
      WHERE mt.id = $1
      GROUP BY mt.id
    `, [threadId]);

    // Get messages
    const messages = await db.query(`
      SELECT m.*, u.first_name, u.last_name, u.role
      FROM messages m
      JOIN users u ON m.sender_id = u.id
      WHERE m.thread_id = $1 AND m.is_deleted = false
      ORDER BY m.created_at ASC
    `, [threadId]);

    // Mark thread as read
    await db.query(
      `UPDATE message_thread_participants SET last_read_at = NOW() WHERE thread_id = $1 AND user_id = $2`,
      [threadId, userId]
    );

    res.json({ thread: thread.rows[0], messages: messages.rows });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ─── CREATE THREAD & SEND FIRST MESSAGE ───────────────────────────────────────
// recipientIds: array of user IDs, or 'all' for broadcast
router.post('/send', auth, async (req, res) => {
  try {
    const { subject, body, recipientIds } = req.body;
    const senderId = req.user.id;

    if (!body?.trim()) return res.status(400).json({ error: 'Message body is required' });

    const isBroadcast = recipientIds === 'all';
    const threadType = isBroadcast ? 'broadcast' : (Array.isArray(recipientIds) && recipientIds.length > 1 ? 'group' : 'direct');

    // Create thread
    const thread = await db.query(`
      INSERT INTO message_threads (subject, created_by, thread_type, is_broadcast)
      VALUES ($1, $2, $3, $4)
      RETURNING *
    `, [subject || 'New Message', senderId, threadType, isBroadcast]);

    const threadId = thread.rows[0].id;

    // Determine recipients
    let allRecipientIds = [];
    if (isBroadcast) {
      const allUsers = await db.query(`SELECT id FROM users WHERE is_active = true AND id != $1`, [senderId]);
      allRecipientIds = allUsers.rows.map(r => r.id);
    } else {
      allRecipientIds = Array.isArray(recipientIds) ? recipientIds.filter(id => id !== senderId) : [recipientIds];
    }

    // Add sender as participant
    await db.query(
      `INSERT INTO message_thread_participants (thread_id, user_id, last_read_at) VALUES ($1, $2, NOW()) ON CONFLICT DO NOTHING`,
      [threadId, senderId]
    );

    // Add all recipients as participants
    for (const recipientId of allRecipientIds) {
      await db.query(
        `INSERT INTO message_thread_participants (thread_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
        [threadId, recipientId]
      );
    }

    // Create the message
    const message = await db.query(`
      INSERT INTO messages (thread_id, sender_id, body)
      VALUES ($1, $2, $3)
      RETURNING *
    `, [threadId, senderId, body.trim()]);

    // Send push notifications to recipients
    try {
      const senderName = req.user.first_name + ' ' + req.user.last_name;
      const notifTitle = isBroadcast ? `📢 ${senderName}` : `💬 ${senderName}`;
      const notifBody = body.length > 80 ? body.slice(0, 77) + '...' : body;

      const subscriptions = await db.query(`
        SELECT ps.subscription FROM push_subscriptions ps
        WHERE ps.user_id = ANY($1) AND ps.is_active = true
      `, [allRecipientIds]);

      let webpush;
      try { webpush = require('web-push'); } catch (e) { webpush = null; }

      if (webpush && process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PUBLIC_KEY !== 'PLACEHOLDER_REPLACE_WITH_REAL_KEY') {
        webpush.setVapidDetails('mailto:admin@chippewahomecare.com', process.env.VAPID_PUBLIC_KEY, process.env.VAPID_PRIVATE_KEY);
        for (const row of subscriptions.rows) {
          try {
            await webpush.sendNotification(row.subscription, JSON.stringify({ title: notifTitle, body: notifBody, data: { type: 'message', threadId } }));
          } catch (e) { /* ignore individual failures */ }
        }
      }
    } catch (e) { /* push failure doesn't break send */ }

    res.json({ thread: thread.rows[0], message: message.rows[0], recipientCount: allRecipientIds.length });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ─── REPLY TO THREAD ──────────────────────────────────────────────────────────
router.post('/thread/:threadId/reply', auth, async (req, res) => {
  try {
    const { threadId } = req.params;
    const { body } = req.body;
    const senderId = req.user.id;

    if (!body?.trim()) return res.status(400).json({ error: 'Message body is required' });

    // Ensure user is a participant (admins can always reply)
    await db.query(
      `INSERT INTO message_thread_participants (thread_id, user_id, last_read_at) VALUES ($1, $2, NOW()) ON CONFLICT (thread_id, user_id) DO UPDATE SET last_read_at = NOW()`,
      [threadId, senderId]
    );

    const message = await db.query(`
      INSERT INTO messages (thread_id, sender_id, body)
      VALUES ($1, $2, $3)
      RETURNING *
    `, [threadId, senderId, body.trim()]);

    // Update thread updated_at
    await db.query(`UPDATE message_threads SET updated_at = NOW() WHERE id = $1`, [threadId]);

    // Get sender info
    const sender = await db.query(`SELECT first_name, last_name, role FROM users WHERE id = $1`, [senderId]);

    // Notify other participants
    try {
      const participants = await db.query(`
        SELECT ps.subscription FROM message_thread_participants mtp
        JOIN push_subscriptions ps ON mtp.user_id = ps.user_id
        WHERE mtp.thread_id = $1 AND mtp.user_id != $2 AND ps.is_active = true
      `, [threadId, senderId]);

      let webpush;
      try { webpush = require('web-push'); } catch (e) { webpush = null; }

      if (webpush && process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PUBLIC_KEY !== 'PLACEHOLDER_REPLACE_WITH_REAL_KEY') {
        webpush.setVapidDetails('mailto:admin@chippewahomecare.com', process.env.VAPID_PUBLIC_KEY, process.env.VAPID_PRIVATE_KEY);
        const senderName = `${sender.rows[0].first_name} ${sender.rows[0].last_name}`;
        for (const row of participants.rows) {
          try {
            await webpush.sendNotification(row.subscription, JSON.stringify({
              title: `💬 ${senderName}`,
              body: body.length > 80 ? body.slice(0, 77) + '...' : body,
              data: { type: 'message', threadId }
            }));
          } catch (e) { /* ignore */ }
        }
      }
    } catch (e) { /* push failure doesn't break reply */ }

    res.json({ ...message.rows[0], first_name: sender.rows[0].first_name, last_name: sender.rows[0].last_name, role: sender.rows[0].role });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ─── GET ALL USERS (for recipient picker) ────────────────────────────────────
router.get('/users', auth, async (req, res) => {
  try {
    const result = await db.query(`
      SELECT id, first_name, last_name, role, phone, email
      FROM users
      WHERE is_active = true AND id != $1
      ORDER BY role DESC, first_name ASC
    `, [req.user.id]);
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ─── DELETE MESSAGE (admin or sender) ────────────────────────────────────────
router.delete('/message/:messageId', auth, async (req, res) => {
  try {
    const { messageId } = req.params;
    const msg = await db.query('SELECT * FROM messages WHERE id = $1', [messageId]);
    if (!msg.rows.length) return res.status(404).json({ error: 'Message not found' });

    if (msg.rows[0].sender_id !== req.user.id && req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Cannot delete this message' });
    }

    await db.query('UPDATE messages SET is_deleted = true WHERE id = $1', [messageId]);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
