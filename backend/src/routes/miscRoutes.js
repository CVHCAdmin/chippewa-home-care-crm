// routes/miscRoutes.js
// Catch-all for smaller inline route groups that don't warrant their own file:
//   referral sources, notifications, prospects, service pricing, care types,
//   caregiver care type rates, compliance summary, caregiver profiles,
//   user admin endpoints, payroll inline, blackout dates, training/compliance docs
const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const db = require('../db');
const { verifyToken, requireAdmin, auditLog } = require('../middleware/shared');

// ─── REFERRAL SOURCES ───────────────────────────────────────────────────────

router.get('/referral-sources', verifyToken, async (req, res) => {
  try {
    const result = await db.query(
      `SELECT rs.*, COUNT(c.id) as referral_count FROM referral_sources rs
       LEFT JOIN clients c ON rs.id = c.referred_by AND c.is_active = true
       WHERE rs.is_active = true GROUP BY rs.id ORDER BY referral_count DESC`
    );
    res.json(result.rows);
  } catch (error) { res.status(500).json({ error: error.message }); }
});

router.post('/referral-sources', verifyToken, requireAdmin, async (req, res) => {
  try {
    const { name, type, contactName, email, phone, address, city, state, zip } = req.body;
    if (!name || !type) return res.status(400).json({ error: 'Name and type are required' });
    const sourceId = uuidv4();
    const result = await db.query(
      `INSERT INTO referral_sources (id, name, type, contact_name, email, phone, address, city, state, zip, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
      [sourceId, name, type, contactName||null, email||null, phone||null, address||null, city||null, state||process.env.AGENCY_STATE||null, zip||null, req.user.id]
    );
    await auditLog(req.user.id, 'CREATE', 'referral_sources', sourceId, null, result.rows[0]);
    res.status(201).json(result.rows[0]);
  } catch (error) { res.status(500).json({ error: error.message }); }
});

router.put('/referral-sources/:id', verifyToken, requireAdmin, async (req, res) => {
  try {
    const { name, type, contactName, email, phone, address, city, state, zip } = req.body;
    const result = await db.query(
      `UPDATE referral_sources SET name=COALESCE($1,name), type=COALESCE($2,type), contact_name=COALESCE($3,contact_name),
        email=COALESCE($4,email), phone=COALESCE($5,phone), address=COALESCE($6,address),
        city=COALESCE($7,city), state=COALESCE($8,state), zip=COALESCE($9,zip), updated_at=NOW()
       WHERE id=$10 RETURNING *`,
      [name, type, contactName, email, phone, address, city, state, zip, req.params.id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Referral source not found' });
    await auditLog(req.user.id, 'UPDATE', 'referral_sources', req.params.id, null, result.rows[0]);
    res.json(result.rows[0]);
  } catch (error) { res.status(500).json({ error: error.message }); }
});

router.delete('/referral-sources/:id', verifyToken, requireAdmin, async (req, res) => {
  try {
    const result = await db.query(`DELETE FROM referral_sources WHERE id=$1 RETURNING *`, [req.params.id]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'Referral source not found' });
    await auditLog(req.user.id, 'DELETE', 'referral_sources', req.params.id, null, result.rows[0]);
    res.json({ message: 'Referral source deleted' });
  } catch (error) { res.status(500).json({ error: error.message }); }
});

router.get('/referral-sources/stats', verifyToken, requireAdmin, async (req, res) => {
  try {
    const [totalResult, byTypeResult, topSources] = await Promise.all([
      db.query(`SELECT COUNT(*) as total FROM referral_sources`),
      db.query(`SELECT type, COUNT(*) as count FROM referral_sources GROUP BY type ORDER BY count DESC`),
      db.query(`SELECT rs.id, rs.name, COUNT(c.id) as client_count FROM referral_sources rs LEFT JOIN clients c ON rs.id = c.referral_source_id WHERE c.id IS NOT NULL GROUP BY rs.id, rs.name ORDER BY client_count DESC`),
    ]);
    res.json({ total: totalResult.rows[0].total, byType: byTypeResult.rows, topSources: topSources.rows });
  } catch (error) { res.status(500).json({ error: error.message }); }
});

// ─── NOTIFICATIONS ───────────────────────────────────────────────────────────

router.get('/notifications', verifyToken, async (req, res) => {
  try {
    const result = await db.query(
      `SELECT * FROM notifications WHERE recipient_id=$1 OR (recipient_type='admin' AND $2='admin') ORDER BY created_at DESC LIMIT 50`,
      [req.user.id, req.user.role]
    );
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
    res.json(result.rows[0]);
  } catch (error) { res.status(500).json({ error: error.message }); }
});

router.post('/notifications/send', verifyToken, requireAdmin, async (req, res) => {
  try {
    const { recipientType, recipientId, notificationType, subject, message } = req.body;
    if (!recipientId || !subject || !message) return res.status(400).json({ error: 'recipientId, subject, and message are required' });
    const notificationId = uuidv4();
    const result = await db.query(
      `INSERT INTO notifications (id, recipient_type, recipient_id, notification_type, subject, message, status, sent_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
      [notificationId, recipientType, recipientId, notificationType||'general', subject, message, 'sent', req.user.id]
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
        `INSERT INTO notifications (id, recipient_type, recipient_id, notification_type, subject, message, status, sent_by) VALUES ($1,'caregiver',$2,$3,$4,$5,'sent',$6) RETURNING *`,
        [notificationId, recipientId, notificationType||'general', subject, message, req.user.id]
      );
      sent.push(result.rows[0]);
    }
    await auditLog(req.user.id, 'CREATE', 'notifications', 'bulk', null, { count: sent.length });
    res.status(201).json({ sent: sent.length, notifications: sent });
  } catch (error) { res.status(500).json({ error: error.message }); }
});

router.patch('/notifications/:id/read', verifyToken, async (req, res) => {
  try {
    const result = await db.query(`UPDATE notifications SET is_read=true, updated_at=NOW() WHERE id=$1 RETURNING *`, [req.params.id]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'Notification not found' });
    res.json(result.rows[0]);
  } catch (error) { res.status(500).json({ error: error.message }); }
});

router.delete('/notifications/:id', verifyToken, async (req, res) => {
  try {
    const result = await db.query(`DELETE FROM notifications WHERE id=$1 AND recipient_id=$2 RETURNING *`, [req.params.id, req.user.id]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'Notification not found' });
    res.json({ message: 'Notification deleted' });
  } catch (error) { res.status(500).json({ error: error.message }); }
});

router.get('/notifications/summary', verifyToken, requireAdmin, async (req, res) => {
  try {
    const result = await db.query(
      `SELECT COUNT(*) as total_notifications, COUNT(CASE WHEN is_read=false THEN 1 END) as unread_count,
        COUNT(CASE WHEN status='sent' THEN 1 END) as sent_count, COUNT(CASE WHEN status='pending' THEN 1 END) as pending_count,
        COUNT(CASE WHEN status='failed' THEN 1 END) as failed_count, COUNT(DISTINCT recipient_id) as unique_recipients FROM notifications`
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

// ─── PROSPECTS ───────────────────────────────────────────────────────────────

router.get('/prospects', verifyToken, async (req, res) => {
  try {
    const result = await db.query(`SELECT * FROM prospects WHERE status != 'inactive' ORDER BY created_at DESC`);
    res.json(result.rows);
  } catch (error) { res.status(500).json({ error: error.message }); }
});

router.post('/prospects', verifyToken, async (req, res) => {
  try {
    const { firstName, lastName, phone, email, address, city, state, notes, source } = req.body;
    if (!firstName || !lastName) return res.status(400).json({ error: 'First and last name required' });
    const result = await db.query(
      `INSERT INTO prospects (first_name, last_name, phone, email, address, city, state, notes, source) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
      [firstName, lastName, phone||null, email||null, address||null, city||null, state||process.env.AGENCY_STATE||null, notes||null, source||null]
    );
    res.status(201).json(result.rows[0]);
  } catch (error) { res.status(500).json({ error: error.message }); }
});

router.put('/prospects/:id', verifyToken, async (req, res) => {
  try {
    const { firstName, lastName, phone, email, address, city, state, notes, source, status } = req.body;
    const result = await db.query(
      `UPDATE prospects SET first_name=COALESCE($1,first_name), last_name=COALESCE($2,last_name),
        phone=$3, email=$4, address=$5, city=$6, state=COALESCE($7,state), notes=$8, source=$9,
        status=COALESCE($10,status), updated_at=NOW() WHERE id=$11 RETURNING *`,
      [firstName, lastName, phone, email, address, city, state, notes, source, status, req.params.id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Prospect not found' });
    res.json(result.rows[0]);
  } catch (error) { res.status(500).json({ error: error.message }); }
});

router.delete('/prospects/:id', verifyToken, async (req, res) => {
  try {
    await db.query(`UPDATE prospects SET status='inactive' WHERE id=$1`, [req.params.id]);
    res.json({ success: true });
  } catch (error) { res.status(500).json({ error: error.message }); }
});

router.post('/prospects/:id/convert', verifyToken, requireAdmin, async (req, res) => {
  try {
    const prospect = await db.query(`SELECT * FROM prospects WHERE id=$1`, [req.params.id]);
    if (prospect.rows.length === 0) return res.status(404).json({ error: 'Prospect not found' });
    const p = prospect.rows[0];
    const clientResult = await db.query(
      `INSERT INTO clients (first_name, last_name, phone, email, address, city, state, status) VALUES ($1,$2,$3,$4,$5,$6,$7,'active') RETURNING *`,
      [p.first_name, p.last_name, p.phone, p.email, p.address, p.city, p.state]
    );
    await db.query(`UPDATE prospects SET status='converted', converted_client_id=$1, updated_at=NOW() WHERE id=$2`, [clientResult.rows[0].id, req.params.id]);
    res.json({ client: clientResult.rows[0], message: 'Prospect converted to client' });
  } catch (error) { res.status(500).json({ error: error.message }); }
});

router.get('/prospect-appointments', verifyToken, async (req, res) => {
  try {
    const { month, year } = req.query;
    let query = `SELECT pa.*, p.first_name as prospect_first_name, p.last_name as prospect_last_name,
      u.first_name as caregiver_first_name, u.last_name as caregiver_last_name
      FROM prospect_appointments pa JOIN prospects p ON pa.prospect_id=p.id LEFT JOIN users u ON pa.caregiver_id=u.id
      WHERE pa.status != 'cancelled'`;
    const params = [];
    if (month && year) { query += ` AND EXTRACT(MONTH FROM pa.appointment_date)=$1 AND EXTRACT(YEAR FROM pa.appointment_date)=$2`; params.push(month, year); }
    query += ` ORDER BY pa.appointment_date, pa.start_time`;
    res.json((await db.query(query, params)).rows);
  } catch (error) { res.status(500).json({ error: error.message }); }
});

router.post('/prospect-appointments', verifyToken, async (req, res) => {
  try {
    const { prospectId, caregiverId, appointmentDate, startTime, endTime, appointmentType, location, notes } = req.body;
    if (!prospectId || !appointmentDate || !startTime || !endTime) return res.status(400).json({ error: 'Prospect, date, and times required' });
    const result = await db.query(
      `INSERT INTO prospect_appointments (prospect_id, caregiver_id, appointment_date, start_time, end_time, appointment_type, location, notes) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
      [prospectId, caregiverId||null, appointmentDate, startTime, endTime, appointmentType||'assessment', location||null, notes||null]
    );
    res.status(201).json(result.rows[0]);
  } catch (error) { res.status(500).json({ error: error.message }); }
});

router.put('/prospect-appointments/:id', verifyToken, async (req, res) => {
  try {
    const { caregiverId, appointmentDate, startTime, endTime, appointmentType, location, notes, status } = req.body;
    const result = await db.query(
      `UPDATE prospect_appointments SET caregiver_id=$1, appointment_date=COALESCE($2,appointment_date),
        start_time=COALESCE($3,start_time), end_time=COALESCE($4,end_time),
        appointment_type=COALESCE($5,appointment_type), location=$6, notes=$7, status=COALESCE($8,status)
       WHERE id=$9 RETURNING *`,
      [caregiverId||null, appointmentDate, startTime, endTime, appointmentType, location||null, notes||null, status, req.params.id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Appointment not found' });
    res.json(result.rows[0]);
  } catch (error) { res.status(500).json({ error: error.message }); }
});

router.delete('/prospect-appointments/:id', verifyToken, async (req, res) => {
  try {
    await db.query(`UPDATE prospect_appointments SET status='cancelled' WHERE id=$1`, [req.params.id]);
    res.json({ success: true });
  } catch (error) { res.status(500).json({ error: error.message }); }
});

// ─── SERVICE PRICING ─────────────────────────────────────────────────────────

router.get('/service-pricing/margins', verifyToken, requireAdmin, async (req, res) => {
  try {
    const result = await db.query(
      `SELECT id, service_name, client_hourly_rate, caregiver_hourly_rate,
        (client_hourly_rate-caregiver_hourly_rate) as margin_per_hour,
        ROUND((((client_hourly_rate-caregiver_hourly_rate)/client_hourly_rate)*100)::numeric,1) as margin_percentage
       FROM service_pricing WHERE is_active=true ORDER BY margin_per_hour DESC`
    );
    res.json(result.rows);
  } catch (error) { res.status(500).json({ error: error.message }); }
});

router.get('/service-pricing', verifyToken, async (req, res) => {
  try {
    res.json((await db.query(`SELECT * FROM service_pricing WHERE is_active=true ORDER BY service_name`)).rows);
  } catch (error) { res.status(500).json({ error: error.message }); }
});

router.post('/service-pricing', verifyToken, requireAdmin, async (req, res) => {
  try {
    const { serviceName, description, clientHourlyRate, caregiverHourlyRate } = req.body;
    if (!serviceName || !clientHourlyRate || !caregiverHourlyRate) return res.status(400).json({ error: 'serviceName, clientHourlyRate, and caregiverHourlyRate are required' });
    const serviceId = uuidv4();
    const result = await db.query(
      `INSERT INTO service_pricing (id, service_name, description, client_hourly_rate, caregiver_hourly_rate) VALUES ($1,$2,$3,$4,$5) RETURNING *`,
      [serviceId, serviceName, description||null, clientHourlyRate, caregiverHourlyRate]
    );
    await auditLog(req.user.id, 'CREATE', 'service_pricing', serviceId, null, result.rows[0]);
    res.status(201).json(result.rows[0]);
  } catch (error) { res.status(500).json({ error: error.message }); }
});

router.put('/service-pricing/:id', verifyToken, requireAdmin, async (req, res) => {
  try {
    const { serviceName, description, clientHourlyRate, caregiverHourlyRate } = req.body;
    const result = await db.query(
      `UPDATE service_pricing SET service_name=COALESCE($1,service_name), description=COALESCE($2,description),
        client_hourly_rate=COALESCE($3,client_hourly_rate), caregiver_hourly_rate=COALESCE($4,caregiver_hourly_rate), updated_at=NOW()
       WHERE id=$5 RETURNING *`,
      [serviceName, description, clientHourlyRate, caregiverHourlyRate, req.params.id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Service not found' });
    await auditLog(req.user.id, 'UPDATE', 'service_pricing', req.params.id, null, result.rows[0]);
    res.json(result.rows[0]);
  } catch (error) { res.status(500).json({ error: error.message }); }
});

router.delete('/service-pricing/:id', verifyToken, requireAdmin, async (req, res) => {
  try {
    const result = await db.query(`UPDATE service_pricing SET is_active=false, updated_at=NOW() WHERE id=$1 RETURNING *`, [req.params.id]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'Service not found' });
    await auditLog(req.user.id, 'DELETE', 'service_pricing', req.params.id, null, result.rows[0]);
    res.json({ message: 'Service deactivated' });
  } catch (error) { res.status(500).json({ error: error.message }); }
});

// ─── CARE TYPES ──────────────────────────────────────────────────────────────

router.get('/care-types', verifyToken, async (req, res) => {
  try {
    res.json((await db.query(`SELECT * FROM care_types WHERE is_active=true ORDER BY name`)).rows);
  } catch (error) { res.status(500).json({ error: error.message }); }
});

router.post('/care-types', verifyToken, requireAdmin, async (req, res) => {
  try {
    const { name, description } = req.body;
    const id = uuidv4();
    const result = await db.query(`INSERT INTO care_types (id, name, description) VALUES ($1,$2,$3) RETURNING *`, [id, name, description]);
    await auditLog(req.user.id, 'CREATE', 'care_types', id, null, result.rows[0]);
    res.status(201).json(result.rows[0]);
  } catch (error) { res.status(500).json({ error: error.message }); }
});

router.put('/care-types/:id', verifyToken, requireAdmin, async (req, res) => {
  try {
    const { name, description } = req.body;
    const result = await db.query(`UPDATE care_types SET name=$1, description=$2, updated_at=NOW() WHERE id=$3 RETURNING *`, [name, description, req.params.id]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'Care type not found' });
    await auditLog(req.user.id, 'UPDATE', 'care_types', req.params.id, null, result.rows[0]);
    res.json(result.rows[0]);
  } catch (error) { res.status(500).json({ error: error.message }); }
});

// ─── CAREGIVER CARE TYPE RATES ────────────────────────────────────────────────

router.get('/caregiver-care-type-rates', verifyToken, async (req, res) => {
  try {
    const { caregiverId } = req.query;
    let query = `SELECT cctr.*, u.first_name as caregiver_first_name, u.last_name as caregiver_last_name, ct.name as care_type_name
      FROM caregiver_care_type_rates cctr JOIN users u ON cctr.caregiver_id=u.id JOIN care_types ct ON cctr.care_type_id=ct.id
      WHERE cctr.is_active=true AND (cctr.end_date IS NULL OR cctr.end_date>=CURRENT_DATE)`;
    const params = [];
    if (caregiverId) { params.push(caregiverId); query += ` AND cctr.caregiver_id=$${params.length}`; }
    query += ` ORDER BY u.last_name, ct.name`;
    res.json((await db.query(query, params)).rows);
  } catch (error) { res.status(500).json({ error: error.message }); }
});

router.post('/caregiver-care-type-rates', verifyToken, requireAdmin, async (req, res) => {
  try {
    const { caregiverId, careTypeId, hourlyRate } = req.body;
    const id = uuidv4();
    await db.query(`UPDATE caregiver_care_type_rates SET is_active=false, end_date=CURRENT_DATE, updated_at=NOW() WHERE caregiver_id=$1 AND care_type_id=$2 AND is_active=true`, [caregiverId, careTypeId]);
    const result = await db.query(`INSERT INTO caregiver_care_type_rates (id, caregiver_id, care_type_id, hourly_rate) VALUES ($1,$2,$3,$4) RETURNING *`, [id, caregiverId, careTypeId, hourlyRate]);
    await auditLog(req.user.id, 'CREATE', 'caregiver_care_type_rates', id, null, result.rows[0]);
    res.status(201).json(result.rows[0]);
  } catch (error) { res.status(500).json({ error: error.message }); }
});

router.put('/caregiver-care-type-rates/:id', verifyToken, requireAdmin, async (req, res) => {
  try {
    const result = await db.query(`UPDATE caregiver_care_type_rates SET hourly_rate=$1, updated_at=NOW() WHERE id=$2 RETURNING *`, [req.body.hourlyRate, req.params.id]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'Rate not found' });
    await auditLog(req.user.id, 'UPDATE', 'caregiver_care_type_rates', req.params.id, null, result.rows[0]);
    res.json(result.rows[0]);
  } catch (error) { res.status(500).json({ error: error.message }); }
});

router.delete('/caregiver-care-type-rates/:id', verifyToken, requireAdmin, async (req, res) => {
  try {
    const result = await db.query(`UPDATE caregiver_care_type_rates SET is_active=false, end_date=CURRENT_DATE, updated_at=NOW() WHERE id=$1 RETURNING *`, [req.params.id]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'Rate not found' });
    await auditLog(req.user.id, 'DELETE', 'caregiver_care_type_rates', req.params.id, null, result.rows[0]);
    res.json({ message: 'Rate ended' });
  } catch (error) { res.status(500).json({ error: error.message }); }
});

// ─── CAREGIVER RATES ─────────────────────────────────────────────────────────

router.get('/caregiver-rates/:caregiverId', verifyToken, async (req, res) => {
  try {
    let result = await db.query(`SELECT * FROM caregiver_rates WHERE caregiver_id=$1`, [req.params.caregiverId]);
    if (result.rows.length === 0) {
      await db.query(`INSERT INTO caregiver_rates (caregiver_id, base_hourly_rate) VALUES ($1, $2)`, [req.params.caregiverId, 18.50]);
      result = await db.query(`SELECT * FROM caregiver_rates WHERE caregiver_id=$1`, [req.params.caregiverId]);
    }
    res.json(result.rows[0]);
  } catch (error) { res.status(500).json({ error: error.message }); }
});

router.put('/caregiver-rates/:caregiverId', verifyToken, requireAdmin, async (req, res) => {
  try {
    const { baseHourlyRate, overtimeRate, premiumRate } = req.body;
    const result = await db.query(
      `UPDATE caregiver_rates SET base_hourly_rate=COALESCE($1,base_hourly_rate), overtime_rate=COALESCE($2,overtime_rate), premium_rate=COALESCE($3,premium_rate), updated_at=NOW() WHERE caregiver_id=$4 RETURNING *`,
      [baseHourlyRate, overtimeRate, premiumRate, req.params.caregiverId]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Caregiver rate not found' });
    await auditLog(req.user.id, 'UPDATE', 'caregiver_rates', req.params.caregiverId, null, result.rows[0]);
    res.json(result.rows[0]);
  } catch (error) { res.status(500).json({ error: error.message }); }
});

// ─── CAREGIVER PROFILES ───────────────────────────────────────────────────────

router.get('/caregiver-profile/:caregiverId', verifyToken, async (req, res) => {
  try {
    let result = await db.query(`SELECT * FROM caregiver_profiles WHERE caregiver_id=$1`, [req.params.caregiverId]);
    if (result.rows.length === 0) {
      await db.query(`INSERT INTO caregiver_profiles (caregiver_id) VALUES ($1)`, [req.params.caregiverId]);
      result = await db.query(`SELECT * FROM caregiver_profiles WHERE caregiver_id=$1`, [req.params.caregiverId]);
    }
    res.json(result.rows[0]);
  } catch (error) { res.status(500).json({ error: error.message }); }
});

router.put('/caregiver-profile/:caregiverId', verifyToken, async (req, res) => {
  try {
    const { notes, capabilities, limitations, preferredHours, availableMon, availableTue, availableWed, availableThu, availableFri, availableSat, availableSun } = req.body;
    const result = await db.query(
      `UPDATE caregiver_profiles SET notes=COALESCE($1,notes), capabilities=COALESCE($2,capabilities), limitations=COALESCE($3,limitations),
        preferred_hours=COALESCE($4,preferred_hours), available_mon=COALESCE($5,available_mon), available_tue=COALESCE($6,available_tue),
        available_wed=COALESCE($7,available_wed), available_thu=COALESCE($8,available_thu), available_fri=COALESCE($9,available_fri),
        available_sat=COALESCE($10,available_sat), available_sun=COALESCE($11,available_sun), updated_at=NOW()
       WHERE caregiver_id=$12 RETURNING *`,
      [notes, capabilities, limitations, preferredHours, availableMon, availableTue, availableWed, availableThu, availableFri, availableSat, availableSun, req.params.caregiverId]
    );
    await auditLog(req.user.id, 'UPDATE', 'caregiver_profiles', req.params.caregiverId, null, result.rows[0]);
    res.json(result.rows[0]);
  } catch (error) { res.status(500).json({ error: error.message }); }
});

// ─── USER ADMIN ───────────────────────────────────────────────────────────────

router.get('/users', verifyToken, requireAdmin, async (req, res) => {
  try {
    const { role } = req.query;
    let query = `SELECT id, email, first_name, last_name, phone, role, is_active, hire_date, default_pay_rate FROM users WHERE 1=1`;
    const params = [];
    if (role) { params.push(role); query += ` AND role=$${params.length}`; }
    query += ` ORDER BY first_name, last_name`;
    res.json((await db.query(query, params)).rows);
  } catch (error) { res.status(500).json({ error: error.message }); }
});

router.get('/users/caregivers', verifyToken, requireAdmin, async (req, res) => {
  try {
    res.json((await db.query(`SELECT id, email, first_name, last_name, phone, hire_date, is_active, certifications, role, default_pay_rate FROM users WHERE role='caregiver' ORDER BY first_name`)).rows);
  } catch (error) { res.status(500).json({ error: error.message }); }
});

router.get('/users/caregivers/:caregiverId', verifyToken, async (req, res) => {
  try {
    const result = await db.query(`SELECT * FROM users WHERE id=$1 AND role='caregiver'`, [req.params.caregiverId]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'Caregiver not found' });
    res.json(result.rows[0]);
  } catch (error) { res.status(500).json({ error: error.message }); }
});

router.get('/users/admins', verifyToken, requireAdmin, async (req, res) => {
  try {
    res.json((await db.query(`SELECT id, email, first_name, last_name, phone, hire_date, is_active, role FROM users WHERE role='admin' ORDER BY first_name`)).rows);
  } catch (error) { res.status(500).json({ error: error.message }); }
});

router.post('/users/convert-to-admin', verifyToken, requireAdmin, async (req, res) => {
  try {
    const { userId } = req.body;
    const result = await db.query(`UPDATE users SET role='admin', updated_at=NOW() WHERE id=$1 RETURNING *`, [userId]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'User not found' });
    await auditLog(req.user.id, 'UPDATE', 'users', userId, null, result.rows[0]);
    res.json(result.rows[0]);
  } catch (error) { res.status(500).json({ error: error.message }); }
});

// ─── PAYROLL INLINE ───────────────────────────────────────────────────────────

router.post('/payroll/run', verifyToken, requireAdmin, async (req, res) => {
  try {
    const { payPeriodStart, payPeriodEnd } = req.body;
    if (!payPeriodStart || !payPeriodEnd) return res.status(400).json({ error: 'payPeriodStart and payPeriodEnd are required' });
    const payrollId = uuidv4();
    const payrollNumber = `PR-${Date.now()}`;
    const timeEntriesResult = await db.query(
      `SELECT te.*, u.first_name, u.last_name, cr.base_hourly_rate FROM time_entries te
       JOIN users u ON te.caregiver_id=u.id LEFT JOIN caregiver_rates cr ON te.caregiver_id=cr.caregiver_id
       WHERE te.start_time>=$1 AND te.start_time<=$2 AND te.duration_minutes>0 ORDER BY te.caregiver_id`,
      [payPeriodStart, payPeriodEnd]
    );
    const caregiverPayroll = {};
    let totalGrossPay = 0;
    for (const entry of timeEntriesResult.rows) {
      if (!caregiverPayroll[entry.caregiver_id]) {
        caregiverPayroll[entry.caregiver_id] = { caregiverId: entry.caregiver_id, caregiverName: `${entry.first_name} ${entry.last_name}`, totalHours: 0, hourlyRate: entry.base_hourly_rate||18.50, grossPay: 0, lineItems: [] };
      }
      caregiverPayroll[entry.caregiver_id].totalHours += parseFloat(entry.billable_minutes||entry.duration_minutes||0)/60;
      caregiverPayroll[entry.caregiver_id].lineItems.push({ timeEntryId: entry.id, date: entry.start_time, hours: ((entry.billable_minutes||entry.duration_minutes||0)/60).toFixed(2), rate: entry.base_hourly_rate||18.50 });
    }
    const lineItems = [];
    for (const caregiverId in caregiverPayroll) {
      const payData = caregiverPayroll[caregiverId];
      payData.grossPay = (payData.totalHours * payData.hourlyRate).toFixed(2);
      totalGrossPay += parseFloat(payData.grossPay);
      lineItems.push({ caregiverId, description: `Hours: ${payData.totalHours.toFixed(2)} × $${payData.hourlyRate.toFixed(2)}/hr`, totalHours: payData.totalHours.toFixed(2), hourlyRate: payData.hourlyRate, grossAmount: payData.grossPay });
    }
    const totalTaxes = (totalGrossPay * 0.0765).toFixed(2);
    const totalNetPay = (totalGrossPay - parseFloat(totalTaxes)).toFixed(2);
    const payrollResult = await db.query(
      `INSERT INTO payroll (id, payroll_number, pay_period_start, pay_period_end, total_hours, gross_pay, taxes, net_pay, status) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
      [payrollId, payrollNumber, payPeriodStart, payPeriodEnd, Object.values(caregiverPayroll).reduce((s,p)=>s+p.totalHours,0).toFixed(2), totalGrossPay, totalTaxes, totalNetPay, 'pending']
    );
    for (const item of lineItems) {
      await db.query(`INSERT INTO payroll_line_items (payroll_id, caregiver_id, description, total_hours, hourly_rate, gross_amount) VALUES ($1,$2,$3,$4,$5,$6)`, [payrollId, item.caregiverId, item.description, item.totalHours, item.hourlyRate, item.grossAmount]);
    }
    await auditLog(req.user.id, 'CREATE', 'payroll', payrollId, null, payrollResult.rows[0]);
    res.status(201).json({ ...payrollResult.rows[0], lineItems, caregiverCount: lineItems.length });
  } catch (error) { res.status(500).json({ error: error.message }); }
});

router.get('/payroll/caregiver/:caregiverId', verifyToken, async (req, res) => {
  try {
    const result = await db.query(`SELECT pli.*, p.payroll_number, p.pay_period_start, p.pay_period_end, p.status FROM payroll_line_items pli JOIN payroll p ON pli.payroll_id=p.id WHERE pli.caregiver_id=$1 ORDER BY p.pay_period_end DESC`, [req.params.caregiverId]);
    res.json(result.rows);
  } catch (error) { res.status(500).json({ error: error.message }); }
});

router.get('/payroll/summary', verifyToken, requireAdmin, async (req, res) => {
  try {
    const [summary, caregiverStats] = await Promise.all([
      db.query(`SELECT COUNT(DISTINCT id) as total_payrolls, COUNT(DISTINCT CASE WHEN status='pending' THEN id END) as pending_payrolls, COUNT(DISTINCT CASE WHEN status='processed' THEN id END) as processed_payrolls, COUNT(DISTINCT CASE WHEN status='paid' THEN id END) as paid_payrolls, SUM(gross_pay) as total_gross_pay, SUM(taxes) as total_taxes, SUM(net_pay) as total_net_pay, AVG(total_hours) as average_hours_per_payroll, MAX(pay_period_end) as latest_payroll_date FROM payroll`),
      db.query(`SELECT u.id, u.first_name, u.last_name, COUNT(pli.id) as payroll_count, SUM(pli.total_hours) as total_hours_paid, SUM(pli.gross_amount) as total_earned FROM users u LEFT JOIN payroll_line_items pli ON u.id=pli.caregiver_id WHERE u.role='caregiver' GROUP BY u.id, u.first_name, u.last_name ORDER BY total_earned DESC NULLS LAST`),
    ]);
    res.json({ summary: summary.rows[0], caregiverStats: caregiverStats.rows });
  } catch (error) { res.status(500).json({ error: error.message }); }
});

router.get('/payroll', verifyToken, requireAdmin, async (req, res) => {
  try {
    res.json((await db.query(`SELECT * FROM payroll ORDER BY pay_period_end DESC`)).rows);
  } catch (error) { res.status(500).json({ error: error.message }); }
});

router.get('/payroll/:payrollId', verifyToken, requireAdmin, async (req, res) => {
  try {
    const payrollResult = await db.query(`SELECT * FROM payroll WHERE id=$1`, [req.params.payrollId]);
    if (payrollResult.rows.length === 0) return res.status(404).json({ error: 'Payroll not found' });
    const lineItemsResult = await db.query(`SELECT pli.*, u.first_name, u.last_name FROM payroll_line_items pli JOIN users u ON pli.caregiver_id=u.id WHERE pli.payroll_id=$1 ORDER BY u.first_name, u.last_name`, [req.params.payrollId]);
    res.json({ ...payrollResult.rows[0], lineItems: lineItemsResult.rows });
  } catch (error) { res.status(500).json({ error: error.message }); }
});

router.patch('/payroll/:payrollId/status', verifyToken, requireAdmin, async (req, res) => {
  try {
    const { status, processedDate, paymentMethod } = req.body;
    if (!status) return res.status(400).json({ error: 'status is required' });
    const result = await db.query(
      `UPDATE payroll SET status=$1, processed_date=CASE WHEN $1='processed' THEN COALESCE($2,NOW()) ELSE processed_date END, payment_method=COALESCE($3,payment_method), updated_at=NOW() WHERE id=$4 RETURNING *`,
      [status, processedDate, paymentMethod, req.params.payrollId]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Payroll not found' });
    await auditLog(req.user.id, 'UPDATE', 'payroll', req.params.payrollId, null, result.rows[0]);
    res.json(result.rows[0]);
  } catch (error) { res.status(500).json({ error: error.message }); }
});

router.get('/payroll-periods', verifyToken, requireAdmin, async (req, res) => {
  try {
    res.json((await db.query(`SELECT DISTINCT pay_period_start, pay_period_end FROM payroll ORDER BY pay_period_end DESC`)).rows);
  } catch (error) { res.status(500).json({ error: error.message }); }
});

// ─── ABSENCES ─────────────────────────────────────────────────────────────────

router.post('/absences', verifyToken, async (req, res) => {
  try {
    const { caregiverId, date, type, reason } = req.body;
    if (!caregiverId || !date || !type) return res.status(400).json({ error: 'caregiverId, date, and type are required' });
    const absenceId = uuidv4();
    const result = await db.query(`INSERT INTO absences (id, caregiver_id, date, type, reason, reported_by, coverage_needed, created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,NOW()) RETURNING *`, [absenceId, caregiverId, date, type, reason||null, req.user.id, true]);
    await auditLog(req.user.id, 'CREATE', 'absences', absenceId, null, result.rows[0]);
    res.status(201).json(result.rows[0]);
  } catch (error) { res.status(500).json({ error: error.message }); }
});

router.get('/absences/summary', verifyToken, requireAdmin, async (req, res) => {
  try {
    res.json((await db.query(`SELECT type, COUNT(*) as count, DATE_TRUNC('month', date)::DATE as month FROM absences GROUP BY type, DATE_TRUNC('month', date) ORDER BY month DESC, type`)).rows);
  } catch (error) { res.status(500).json({ error: error.message }); }
});

router.get('/absences/caregiver/:caregiverId', verifyToken, async (req, res) => {
  try {
    res.json((await db.query(`SELECT * FROM absences WHERE caregiver_id=$1 ORDER BY date DESC`, [req.params.caregiverId])).rows);
  } catch (error) { res.status(500).json({ error: error.message }); }
});

router.get('/absences', verifyToken, requireAdmin, async (req, res) => {
  try {
    const { type, startDate, endDate } = req.query;
    let query = `SELECT a.*, u.first_name, u.last_name FROM absences a JOIN users u ON a.caregiver_id=u.id WHERE 1=1`;
    const params = [];
    if (type) { params.push(type); query += ` AND a.type=$${params.length}`; }
    if (startDate) { params.push(startDate); query += ` AND a.date>=$${params.length}`; }
    if (endDate) { params.push(endDate); query += ` AND a.date<=$${params.length}`; }
    query += ` ORDER BY a.date DESC`;
    res.json((await db.query(query, params)).rows);
  } catch (error) { res.status(500).json({ error: error.message }); }
});

router.patch('/absences/:id', verifyToken, requireAdmin, async (req, res) => {
  try {
    const { date, type, reason, coverageAssignedTo } = req.body;
    const updates = [], params = [];
    let i = 1;
    if (date) { updates.push(`date=$${i++}`); params.push(date); }
    if (type) { updates.push(`type=$${i++}`); params.push(type); }
    if (reason) { updates.push(`reason=$${i++}`); params.push(reason); }
    if (coverageAssignedTo) { updates.push(`coverage_assigned_to=$${i++}`); params.push(coverageAssignedTo); }
    if (updates.length === 0) return res.status(400).json({ error: 'No fields to update' });
    params.push(req.params.id);
    const result = await db.query(`UPDATE absences SET ${updates.join(', ')} WHERE id=$${i} RETURNING *`, params);
    if (result.rows.length === 0) return res.status(404).json({ error: 'Absence not found' });
    await auditLog(req.user.id, 'UPDATE', 'absences', req.params.id, null, result.rows[0]);
    res.json(result.rows[0]);
  } catch (error) { res.status(500).json({ error: error.message }); }
});

router.delete('/absences/:id', verifyToken, requireAdmin, async (req, res) => {
  try {
    const result = await db.query(`DELETE FROM absences WHERE id=$1 RETURNING *`, [req.params.id]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'Absence not found' });
    await auditLog(req.user.id, 'DELETE', 'absences', req.params.id, null, result.rows[0]);
    res.json({ message: 'Absence deleted' });
  } catch (error) { res.status(500).json({ error: error.message }); }
});

// ─── EXPENSES ─────────────────────────────────────────────────────────────────

router.get('/expenses/summary', verifyToken, requireAdmin, async (req, res) => {
  try {
    const [total, byCategory, byMonth] = await Promise.all([
      db.query(`SELECT SUM(amount) as total_expenses, COUNT(*) as expense_count, AVG(amount) as average_expense FROM expenses`),
      db.query(`SELECT category, COUNT(*) as count, SUM(amount) as total, AVG(amount) as average FROM expenses GROUP BY category ORDER BY total DESC`),
      db.query(`SELECT DATE_TRUNC('month', expense_date)::DATE as month, SUM(amount) as total FROM expenses GROUP BY DATE_TRUNC('month', expense_date) ORDER BY month DESC LIMIT 12`),
    ]);
    res.json({ total: total.rows[0], byCategory: byCategory.rows, byMonth: byMonth.rows });
  } catch (error) { res.status(500).json({ error: error.message }); }
});

router.get('/expenses/:id', verifyToken, requireAdmin, async (req, res) => {
  try {
    const result = await db.query(`SELECT * FROM expenses WHERE id=$1`, [req.params.id]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'Expense not found' });
    res.json(result.rows[0]);
  } catch (error) { res.status(500).json({ error: error.message }); }
});

router.get('/expenses', verifyToken, requireAdmin, async (req, res) => {
  try {
    const { category, startDate, endDate, paymentMethod } = req.query;
    let query = `SELECT * FROM expenses WHERE 1=1`;
    const params = [];
    let i = 1;
    if (category) { query += ` AND category=$${i++}`; params.push(category); }
    if (startDate) { query += ` AND expense_date>=$${i++}`; params.push(startDate); }
    if (endDate) { query += ` AND expense_date<=$${i++}`; params.push(endDate); }
    if (paymentMethod) { query += ` AND payment_method=$${i++}`; params.push(paymentMethod); }
    query += ` ORDER BY expense_date DESC`;
    res.json((await db.query(query, params)).rows);
  } catch (error) { res.status(500).json({ error: error.message }); }
});

router.post('/expenses', verifyToken, requireAdmin, async (req, res) => {
  try {
    const { expenseDate, category, description, amount, paymentMethod, notes, receiptUrl } = req.body;
    if (!expenseDate || !category || !amount) return res.status(400).json({ error: 'expenseDate, category, and amount are required' });
    const expenseId = uuidv4();
    const result = await db.query(
      `INSERT INTO expenses (id, expense_date, category, description, amount, payment_method, notes, receipt_url, submitted_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
      [expenseId, expenseDate, category, description||null, amount, paymentMethod||null, notes||null, receiptUrl||null, req.user.id]
    );
    await auditLog(req.user.id, 'CREATE', 'expenses', expenseId, null, result.rows[0]);
    res.status(201).json(result.rows[0]);
  } catch (error) { res.status(500).json({ error: error.message }); }
});

router.put('/expenses/:id', verifyToken, requireAdmin, async (req, res) => {
  try {
    const { expenseDate, category, description, amount, paymentMethod, notes, receiptUrl } = req.body;
    const result = await db.query(
      `UPDATE expenses SET expense_date=COALESCE($1,expense_date), category=COALESCE($2,category), description=COALESCE($3,description),
        amount=COALESCE($4,amount), payment_method=COALESCE($5,payment_method), notes=COALESCE($6,notes), receipt_url=COALESCE($7,receipt_url), updated_at=NOW()
       WHERE id=$8 RETURNING *`,
      [expenseDate, category, description, amount, paymentMethod, notes, receiptUrl, req.params.id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Expense not found' });
    await auditLog(req.user.id, 'UPDATE', 'expenses', req.params.id, null, result.rows[0]);
    res.json(result.rows[0]);
  } catch (error) { res.status(500).json({ error: error.message }); }
});

router.delete('/expenses/:id', verifyToken, requireAdmin, async (req, res) => {
  try {
    const result = await db.query(`DELETE FROM expenses WHERE id=$1 RETURNING *`, [req.params.id]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'Expense not found' });
    await auditLog(req.user.id, 'DELETE', 'expenses', req.params.id, null, result.rows[0]);
    res.json({ message: 'Expense deleted' });
  } catch (error) { res.status(500).json({ error: error.message }); }
});

// ─── COMPLIANCE ───────────────────────────────────────────────────────────────

router.get('/compliance/summary', verifyToken, requireAdmin, async (req, res) => {
  try {
    const [expiredBg, expiredTraining, trainingByType, bgStatus] = await Promise.all([
      db.query(`SELECT COUNT(*) as expired_bg FROM background_checks WHERE expiration_date < CURRENT_DATE`),
      db.query(`SELECT COUNT(*) as expired_training FROM training_records WHERE expiration_date < CURRENT_DATE AND status != 'expired'`),
      db.query(`SELECT training_type, COUNT(*) as count FROM training_records WHERE status='completed' GROUP BY training_type ORDER BY count DESC`),
      db.query(`SELECT status, COUNT(*) as count FROM background_checks GROUP BY status`),
    ]);
    res.json({ expiredBackgroundChecks: expiredBg.rows[0].expired_bg, expiredTraining: expiredTraining.rows[0].expired_training, trainingByType: trainingByType.rows, backgroundCheckStatus: bgStatus.rows });
  } catch (error) { res.status(500).json({ error: error.message }); }
});

router.delete('/training-records/:id', verifyToken, requireAdmin, async (req, res) => {
  try {
    const result = await db.query(`DELETE FROM training_records WHERE id=$1 RETURNING *`, [req.params.id]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'Training record not found' });
    await auditLog(req.user.id, 'DELETE', 'training_records', req.params.id, null, result.rows[0]);
    res.json({ message: 'Training record deleted' });
  } catch (error) { res.status(500).json({ error: error.message }); }
});

router.delete('/compliance-documents/:id', verifyToken, requireAdmin, async (req, res) => {
  try {
    const result = await db.query(`DELETE FROM compliance_documents WHERE id=$1 RETURNING *`, [req.params.id]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'Document not found' });
    await auditLog(req.user.id, 'DELETE', 'compliance_documents', req.params.id, null, result.rows[0]);
    res.json({ message: 'Document deleted' });
  } catch (error) { res.status(500).json({ error: error.message }); }
});

router.delete('/blackout-dates/:dateId', verifyToken, async (req, res) => {
  try {
    const result = await db.query(`DELETE FROM caregiver_blackout_dates WHERE id=$1 RETURNING *`, [req.params.dateId]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'Blackout date not found' });
    await auditLog(req.user.id, 'DELETE', 'caregiver_blackout_dates', req.params.dateId, null, result.rows[0]);
    res.json({ message: 'Blackout date deleted' });
  } catch (error) { res.status(500).json({ error: error.message }); }
});

// ─── CARE PLANS ───────────────────────────────────────────────────────────────

router.get('/care-plans/summary', verifyToken, requireAdmin, async (req, res) => {
  try {
    const [total, active, byServiceType, byClient] = await Promise.all([
      db.query(`SELECT COUNT(*) as total_plans FROM care_plans`),
      db.query(`SELECT COUNT(*) as active_plans FROM care_plans WHERE (start_date IS NULL OR start_date<=CURRENT_DATE) AND (end_date IS NULL OR end_date>=CURRENT_DATE)`),
      db.query(`SELECT service_type, COUNT(*) as count FROM care_plans GROUP BY service_type ORDER BY count DESC`),
      db.query(`SELECT c.id, c.first_name||' '||c.last_name as client_name, COUNT(cp.id) as plan_count FROM clients c LEFT JOIN care_plans cp ON c.id=cp.client_id GROUP BY c.id, c.first_name, c.last_name HAVING COUNT(cp.id)>0 ORDER BY plan_count DESC`),
    ]);
    res.json({ total: total.rows[0].total_plans, active: active.rows[0].active_plans, byServiceType: byServiceType.rows, byClient: byClient.rows });
  } catch (error) { res.status(500).json({ error: error.message }); }
});

router.get('/care-plans/:clientId', verifyToken, async (req, res) => {
  try {
    res.json((await db.query(`SELECT * FROM care_plans WHERE client_id=$1 ORDER BY start_date DESC`, [req.params.clientId])).rows);
  } catch (error) { res.status(500).json({ error: error.message }); }
});

router.get('/care-plans', verifyToken, async (req, res) => {
  try {
    res.json((await db.query(`SELECT cp.*, c.first_name||' '||c.last_name as client_name FROM care_plans cp JOIN clients c ON cp.client_id=c.id ORDER BY cp.created_at DESC`)).rows);
  } catch (error) { res.status(500).json({ error: error.message }); }
});

router.post('/care-plans', verifyToken, requireAdmin, async (req, res) => {
  try {
    const { clientId, serviceType, serviceDescription, frequency, careGoals, specialInstructions, precautions, medicationNotes, mobilityNotes, dietaryNotes, communicationNotes, startDate, endDate } = req.body;
    if (!clientId || !serviceType) return res.status(400).json({ error: 'clientId and serviceType are required' });
    const planId = uuidv4();
    const result = await db.query(
      `INSERT INTO care_plans (id, client_id, service_type, service_description, frequency, care_goals, special_instructions, precautions, medication_notes, mobility_notes, dietary_notes, communication_notes, start_date, end_date, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) RETURNING *`,
      [planId, clientId, serviceType, serviceDescription||null, frequency||null, careGoals||null, specialInstructions||null, precautions||null, medicationNotes||null, mobilityNotes||null, dietaryNotes||null, communicationNotes||null, startDate||null, endDate||null, req.user.id]
    );
    await auditLog(req.user.id, 'CREATE', 'care_plans', planId, null, result.rows[0]);
    res.status(201).json(result.rows[0]);
  } catch (error) { res.status(500).json({ error: error.message }); }
});

router.put('/care-plans/:id', verifyToken, requireAdmin, async (req, res) => {
  try {
    const { serviceType, serviceDescription, frequency, careGoals, specialInstructions, precautions, medicationNotes, mobilityNotes, dietaryNotes, communicationNotes, startDate, endDate } = req.body;
    const result = await db.query(
      `UPDATE care_plans SET service_type=COALESCE($1,service_type), service_description=COALESCE($2,service_description), frequency=COALESCE($3,frequency), care_goals=COALESCE($4,care_goals), special_instructions=COALESCE($5,special_instructions), precautions=COALESCE($6,precautions), medication_notes=COALESCE($7,medication_notes), mobility_notes=COALESCE($8,mobility_notes), dietary_notes=COALESCE($9,dietary_notes), communication_notes=COALESCE($10,communication_notes), start_date=COALESCE($11,start_date), end_date=COALESCE($12,end_date), updated_at=NOW() WHERE id=$13 RETURNING *`,
      [serviceType, serviceDescription, frequency, careGoals, specialInstructions, precautions, medicationNotes, mobilityNotes, dietaryNotes, communicationNotes, startDate, endDate, req.params.id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Care plan not found' });
    await auditLog(req.user.id, 'UPDATE', 'care_plans', req.params.id, null, result.rows[0]);
    res.json(result.rows[0]);
  } catch (error) { res.status(500).json({ error: error.message }); }
});

router.delete('/care-plans/:id', verifyToken, requireAdmin, async (req, res) => {
  try {
    const result = await db.query(`DELETE FROM care_plans WHERE id=$1 RETURNING *`, [req.params.id]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'Care plan not found' });
    await auditLog(req.user.id, 'DELETE', 'care_plans', req.params.id, null, result.rows[0]);
    res.json({ message: 'Care plan deleted' });
  } catch (error) { res.status(500).json({ error: error.message }); }
});

// ─── INCIDENTS ────────────────────────────────────────────────────────────────

router.get('/incidents/summary', verifyToken, requireAdmin, async (req, res) => {
  try {
    const [total, bySeverity, byType, followUp, monthly, byClient] = await Promise.all([
      db.query(`SELECT COUNT(*) as total FROM incident_reports`),
      db.query(`SELECT severity, COUNT(*) as count FROM incident_reports GROUP BY severity ORDER BY CASE severity WHEN 'critical' THEN 1 WHEN 'severe' THEN 2 WHEN 'moderate' THEN 3 WHEN 'minor' THEN 4 END`),
      db.query(`SELECT incident_type, COUNT(*) as count FROM incident_reports GROUP BY incident_type ORDER BY count DESC`),
      db.query(`SELECT COUNT(*) as pending_followup FROM incident_reports WHERE follow_up_required=true`),
      db.query(`SELECT DATE_TRUNC('month', incident_date)::DATE as month, COUNT(*) as count, COUNT(CASE WHEN severity IN ('critical','severe') THEN 1 END) as serious_count FROM incident_reports GROUP BY DATE_TRUNC('month', incident_date) ORDER BY month DESC LIMIT 12`),
      db.query(`SELECT c.id, c.first_name||' '||c.last_name as client_name, COUNT(ir.id) as incident_count FROM clients c LEFT JOIN incident_reports ir ON c.id=ir.client_id WHERE ir.id IS NOT NULL GROUP BY c.id, c.first_name, c.last_name ORDER BY incident_count DESC LIMIT 10`),
    ]);
    res.json({ total: total.rows[0].total, bySeverity: bySeverity.rows, byType: byType.rows, pendingFollowUp: followUp.rows[0].pending_followup, monthlyTrend: monthly.rows, topClients: byClient.rows });
  } catch (error) { res.status(500).json({ error: error.message }); }
});

router.get('/incidents/:id', verifyToken, async (req, res) => {
  try {
    const result = await db.query(`SELECT ir.*, c.first_name||' '||c.last_name as client_name, u.first_name||' '||u.last_name as caregiver_name FROM incident_reports ir LEFT JOIN clients c ON ir.client_id=c.id LEFT JOIN users u ON ir.caregiver_id=u.id WHERE ir.id=$1`, [req.params.id]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'Incident not found' });
    res.json(result.rows[0]);
  } catch (error) { res.status(500).json({ error: error.message }); }
});

router.get('/incidents', verifyToken, async (req, res) => {
  try {
    res.json((await db.query(`SELECT ir.*, c.first_name||' '||c.last_name as client_name, u.first_name||' '||u.last_name as caregiver_name FROM incident_reports ir LEFT JOIN clients c ON ir.client_id=c.id LEFT JOIN users u ON ir.caregiver_id=u.id ORDER BY ir.incident_date DESC, ir.incident_time DESC`)).rows);
  } catch (error) { res.status(500).json({ error: error.message }); }
});

router.post('/incidents', verifyToken, async (req, res) => {
  try {
    const { clientId, caregiverId, incidentType, severity, incidentDate, incidentTime, description, witnesses, injuriesOrDamage, actionsTaken, followUpRequired, followUpNotes, reportedBy, reportedDate } = req.body;
    if (!clientId || !incidentType || !description) return res.status(400).json({ error: 'Client, incident type, and description are required' });
    const incidentId = uuidv4();
    const result = await db.query(
      `INSERT INTO incident_reports (id, client_id, caregiver_id, incident_type, severity, incident_date, incident_time, description, witnesses, injuries_or_damage, actions_taken, follow_up_required, follow_up_notes, reported_by, reported_date, reported_by_user_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16) RETURNING *`,
      [incidentId, clientId, caregiverId||null, incidentType, severity||'moderate', incidentDate, incidentTime||null, description, witnesses||null, injuriesOrDamage||null, actionsTaken||null, followUpRequired||false, followUpNotes||null, reportedBy||null, reportedDate||null, req.user.id]
    );
    await auditLog(req.user.id, 'CREATE', 'incident_reports', incidentId, null, result.rows[0]);
    res.status(201).json(result.rows[0]);
  } catch (error) { res.status(500).json({ error: error.message }); }
});

router.patch('/incidents/:id', verifyToken, async (req, res) => {
  try {
    const { severity, injuriesOrDamage, actionsTaken, followUpRequired, followUpNotes } = req.body;
    const result = await db.query(
      `UPDATE incident_reports SET severity=COALESCE($1,severity), injuries_or_damage=COALESCE($2,injuries_or_damage), actions_taken=COALESCE($3,actions_taken), follow_up_required=COALESCE($4,follow_up_required), follow_up_notes=COALESCE($5,follow_up_notes), updated_at=NOW() WHERE id=$6 RETURNING *`,
      [severity, injuriesOrDamage, actionsTaken, followUpRequired, followUpNotes, req.params.id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Incident not found' });
    await auditLog(req.user.id, 'UPDATE', 'incident_reports', req.params.id, null, result.rows[0]);
    res.json(result.rows[0]);
  } catch (error) { res.status(500).json({ error: error.message }); }
});

router.delete('/incidents/:id', verifyToken, requireAdmin, async (req, res) => {
  try {
    const result = await db.query(`DELETE FROM incident_reports WHERE id=$1 RETURNING *`, [req.params.id]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'Incident not found' });
    await auditLog(req.user.id, 'DELETE', 'incident_reports', req.params.id, null, result.rows[0]);
    res.json({ message: 'Incident report deleted' });
  } catch (error) { res.status(500).json({ error: error.message }); }
});

// ─── PERFORMANCE REVIEWS ──────────────────────────────────────────────────────

router.get('/performance-reviews/summary/:caregiverId', verifyToken, async (req, res) => {
  try {
    res.json((await db.query(`SELECT COUNT(*) as total_reviews, AVG(CASE WHEN overall_assessment='excellent' THEN 3 WHEN overall_assessment='satisfactory' THEN 2 WHEN overall_assessment='needs_improvement' THEN 1 ELSE 0 END) as avg_score, COUNT(CASE WHEN overall_assessment='excellent' THEN 1 END) as excellent_count, COUNT(CASE WHEN overall_assessment='satisfactory' THEN 1 END) as satisfactory_count, COUNT(CASE WHEN overall_assessment='needs_improvement' THEN 1 END) as needs_improvement_count, MAX(review_date) as last_review_date FROM performance_reviews WHERE caregiver_id=$1`, [req.params.caregiverId])).rows[0]);
  } catch (error) { res.status(500).json({ error: error.message }); }
});

router.get('/performance-reviews/:caregiverId', verifyToken, async (req, res) => {
  try {
    res.json((await db.query(`SELECT pr.*, cl.first_name||' '||cl.last_name as client_name FROM performance_reviews pr LEFT JOIN clients cl ON pr.client_id=cl.id WHERE pr.caregiver_id=$1 ORDER BY pr.review_date DESC`, [req.params.caregiverId])).rows);
  } catch (error) { res.status(500).json({ error: error.message }); }
});

router.get('/performance-reviews', verifyToken, async (req, res) => {
  try {
    res.json((await db.query(`SELECT pr.*, c.first_name||' '||c.last_name as caregiver_name, cl.first_name||' '||cl.last_name as client_name FROM performance_reviews pr LEFT JOIN users c ON pr.caregiver_id=c.id LEFT JOIN clients cl ON pr.client_id=cl.id ORDER BY pr.review_date DESC`)).rows);
  } catch (error) { res.status(500).json({ error: error.message }); }
});

router.post('/performance-reviews', verifyToken, requireAdmin, async (req, res) => {
  try {
    const { caregiverId, clientId, reviewDate, performanceNotes, strengths, areasForImprovement, overallAssessment } = req.body;
    if (!caregiverId || !clientId || !performanceNotes) return res.status(400).json({ error: 'Caregiver, client, and performance notes are required' });
    const reviewId = uuidv4();
    const result = await db.query(
      `INSERT INTO performance_reviews (id, caregiver_id, client_id, review_date, performance_notes, strengths, areas_for_improvement, overall_assessment, reviewed_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
      [reviewId, caregiverId, clientId, reviewDate, performanceNotes, strengths||null, areasForImprovement||null, overallAssessment||'satisfactory', req.user.id]
    );
    await auditLog(req.user.id, 'CREATE', 'performance_reviews', reviewId, null, result.rows[0]);
    res.status(201).json(result.rows[0]);
  } catch (error) { res.status(500).json({ error: error.message }); }
});

router.delete('/performance-reviews/:id', verifyToken, requireAdmin, async (req, res) => {
  try {
    const result = await db.query(`DELETE FROM performance_reviews WHERE id=$1 RETURNING *`, [req.params.id]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'Review not found' });
    await auditLog(req.user.id, 'DELETE', 'performance_reviews', req.params.id, null, result.rows[0]);
    res.json({ message: 'Review deleted' });
  } catch (error) { res.status(500).json({ error: error.message }); }
});

// ─── SCHEDULES ENHANCED ───────────────────────────────────────────────────────

router.post('/schedules-enhanced', verifyToken, async (req, res) => {
  try {
    const { caregiverId, clientId, scheduleType, dayOfWeek, date, startTime, endTime, notes, frequency, effectiveDate, anchorDate } = req.body;
    if (!caregiverId || !clientId || !startTime || !endTime) return res.status(400).json({ error: 'Missing required fields' });
    const id = uuidv4();
    const result = await db.query(
      `INSERT INTO schedules (id, caregiver_id, client_id, schedule_type, day_of_week, date, start_time, end_time, notes, frequency, effective_date, anchor_date)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`,
      [id, caregiverId, clientId, scheduleType||'recurring', dayOfWeek!=null?dayOfWeek:null, date||null, startTime, endTime, notes||null, frequency||'weekly', effectiveDate||null, anchorDate||null]
    );
    res.status(201).json(result.rows[0]);
  } catch (error) { res.status(500).json({ error: error.message }); }
});

module.exports = router;
