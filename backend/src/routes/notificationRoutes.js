// routes/notificationRoutes.js — mounted at /api via app.use('/api', notificationRoutes)
const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const db = require('../db');
const { verifyToken, requireAdmin, auditLog } = require('../middleware/shared');
// ─── HELPER: notify all admins ──────────────────────────────────────────────
async function notifyAdmins(type, title, message) {
  try {
    const admins = await db.query(`SELECT id FROM users WHERE role = 'admin' AND is_active = true`);
    for (const admin of admins.rows) {
      await db.query(
        `INSERT INTO notifications (id, user_id, type, title, message, status) VALUES ($1,$2,$3,$4,$5,'new')`,
        [uuidv4(), admin.id, type, title, message]
      );
    }
  } catch (e) { console.error('[notifyAdmins error]', e.message); }
}

// Export for use in other route files
router.notifyAdmins = notifyAdmins;

// ─── NOTIFICATIONS ───────────────────────────────────────────────────────────

router.get('/notifications', verifyToken, async (req, res) => {
  try {
    const { status } = req.query;
    let query = `SELECT * FROM notifications WHERE user_id=$1`;
    const params = [req.user.id];
    if (status && ['new', 'handled', 'archived'].includes(status)) {
      params.push(status);
      query += ` AND status = $${params.length}`;
    }
    query += ` ORDER BY created_at DESC LIMIT 100`;
    const result = await db.query(query, params);
    res.json(result.rows);
  } catch (error) { res.status(500).json({ error: error.message }); }
});

router.get('/notification-settings', verifyToken, async (req, res) => {
  try {
    let result = await db.query(`SELECT * FROM notification_settings WHERE user_id=$1`, [req.user.id]);
    if (result.rows.length === 0) {
      await db.query(`INSERT INTO notification_settings (user_id, email_enabled, schedule_alerts, payroll_alerts, absence_alerts, payment_alerts) VALUES ($1,true,true,true,true,true)`, [req.user.id]);
      result = await db.query(`SELECT * FROM notification_settings WHERE user_id=$1`, [req.user.id]);
    }
    res.json(result.rows[0]);
  } catch (error) { res.status(500).json({ error: error.message }); }
});

router.put('/notification-settings', verifyToken, async (req, res) => {
  try {
    const { emailEnabled, scheduleAlerts, payrollAlerts, absenceAlerts, paymentAlerts } = req.body;
    const result = await db.query(
      `UPDATE notification_settings SET email_enabled=COALESCE($1,email_enabled), schedule_alerts=COALESCE($2,schedule_alerts),
        payroll_alerts=COALESCE($3,payroll_alerts), absence_alerts=COALESCE($4,absence_alerts),
        payment_alerts=COALESCE($5,payment_alerts), updated_at=NOW() WHERE user_id=$6 RETURNING *`,
      [emailEnabled, scheduleAlerts, payrollAlerts, absenceAlerts, paymentAlerts, req.user.id]
    );
    res.json(result.rows[0] || {});
  } catch (error) { res.status(500).json({ error: error.message }); }
});

router.post('/notifications/send', verifyToken, requireAdmin, async (req, res) => {
  try {
    const { recipientType, recipientId, notificationType, subject, message } = req.body;
    if (!recipientId || !subject || !message) return res.status(400).json({ error: 'recipientId, subject, and message are required' });
    const notificationId = uuidv4();
    const result = await db.query(
      `INSERT INTO notifications (id, user_id, type, title, message) VALUES ($1,$2,$3,$4,$5) RETURNING *`,
      [notificationId, recipientId, notificationType||'general', subject, message]
    );
    await auditLog(req.user.id, 'CREATE', 'notifications', notificationId, null, result.rows[0]);
    res.status(201).json(result.rows[0]);
  } catch (error) { res.status(500).json({ error: error.message }); }
});

router.post('/notifications/send-bulk', verifyToken, requireAdmin, async (req, res) => {
  try {
    const { recipientIds, notificationType, subject, message } = req.body;
    if (!recipientIds?.length || !subject || !message) return res.status(400).json({ error: 'recipientIds, subject, and message are required' });
    const sent = [];
    for (const recipientId of recipientIds) {
      const notificationId = uuidv4();
      const result = await db.query(
        `INSERT INTO notifications (id, user_id, type, title, message) VALUES ($1,$2,$3,$4,$5) RETURNING *`,
        [notificationId, recipientId, notificationType||'general', subject, message]
      );
      sent.push(result.rows[0]);
    }
    await auditLog(req.user.id, 'CREATE', 'notifications', 'bulk', null, { count: sent.length });
    res.status(201).json({ sent: sent.length, notifications: sent });
  } catch (error) { res.status(500).json({ error: error.message }); }
});

router.patch('/notifications/:id/read', verifyToken, async (req, res) => {
  try {
    const result = await db.query(`UPDATE notifications SET is_read=true WHERE id=$1 RETURNING *`, [req.params.id]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'Notification not found' });
    res.json(result.rows[0]);
  } catch (error) { res.status(500).json({ error: error.message }); }
});

// PATCH /notifications/:id/status — mark as handled or archived
router.patch('/notifications/:id/status', verifyToken, async (req, res) => {
  try {
    const { status } = req.body;
    if (!['new', 'handled', 'archived'].includes(status)) return res.status(400).json({ error: 'Status must be new, handled, or archived' });
    const updates = status === 'handled'
      ? `status='handled', is_read=true, handled_at=NOW(), handled_by=$2`
      : status === 'archived'
        ? `status='archived', is_read=true`
        : `status='new', is_read=false, handled_at=NULL, handled_by=NULL`;
    const params = status === 'handled' ? [req.params.id, req.user.id] : [req.params.id];
    const result = await db.query(`UPDATE notifications SET ${updates} WHERE id=$1 RETURNING *`, params);
    if (result.rows.length === 0) return res.status(404).json({ error: 'Notification not found' });
    res.json(result.rows[0]);
  } catch (error) { res.status(500).json({ error: error.message }); }
});

// POST /notifications/bulk-status — bulk update status
router.post('/notifications/bulk-status', verifyToken, async (req, res) => {
  try {
    const { ids, status } = req.body;
    if (!ids?.length || !['handled', 'archived', 'new'].includes(status)) return res.status(400).json({ error: 'ids and valid status required' });
    let updated = 0;
    for (const id of ids) {
      const updates = status === 'handled'
        ? `status='handled', is_read=true, handled_at=NOW(), handled_by='${req.user.id}'`
        : status === 'archived'
          ? `status='archived', is_read=true`
          : `status='new', is_read=false, handled_at=NULL, handled_by=NULL`;
      const r = await db.query(`UPDATE notifications SET ${updates} WHERE id=$1 AND user_id=$2 RETURNING id`, [id, req.user.id]);
      if (r.rows.length) updated++;
    }
    res.json({ updated });
  } catch (error) { res.status(500).json({ error: error.message }); }
});

router.delete('/notifications/:id', verifyToken, async (req, res) => {
  try {
    const result = await db.query(`DELETE FROM notifications WHERE id=$1 AND user_id=$2 RETURNING *`, [req.params.id, req.user.id]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'Notification not found' });
    res.json({ message: 'Notification deleted' });
  } catch (error) { res.status(500).json({ error: error.message }); }
});

router.get('/notifications/summary', verifyToken, requireAdmin, async (req, res) => {
  try {
    const result = await db.query(
      `SELECT COUNT(*) as total_notifications, COUNT(CASE WHEN is_read=false THEN 1 END) as unread_count,
        COUNT(DISTINCT user_id) as unique_recipients FROM notifications`
    );
    res.json(result.rows[0]);
  } catch (error) { res.status(500).json({ error: error.message }); }
});

router.post('/notifications/subscribe', verifyToken, async (req, res) => {
  res.json({ success: true });
});

router.put('/notifications/preferences', verifyToken, async (req, res) => {
  try {
    const { emailEnabled, pushEnabled, scheduleAlerts, absenceAlerts, billingAlerts } = req.body;
    const result = await db.query(
      `INSERT INTO notification_preferences (user_id, email_enabled, push_enabled, schedule_alerts, absence_alerts, billing_alerts)
       VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (user_id) DO UPDATE SET email_enabled=$2, push_enabled=$3, schedule_alerts=$4, absence_alerts=$5, billing_alerts=$6 RETURNING *`,
      [req.user.id, emailEnabled, pushEnabled, scheduleAlerts, absenceAlerts, billingAlerts]
    );
    res.json(result.rows[0]);
  } catch (error) { res.status(500).json({ error: error.message }); }
});

module.exports = router;
