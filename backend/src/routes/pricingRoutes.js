// routes/pricingRoutes.js — mounted at /api via app.use('/api', pricingRoutes)
// Covers: service pricing, care types, caregiver care type rates, caregiver rates, caregiver profiles
const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const db = require('../db');
const { verifyToken, requireAdmin, auditLog } = require('../middleware/shared');
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

module.exports = router;
