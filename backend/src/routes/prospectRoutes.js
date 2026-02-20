// routes/prospectRoutes.js — mounted at /api via app.use('/api', prospectRoutes)
const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const db = require('../db');
const { verifyToken, requireAdmin, auditLog } = require('../middleware/shared');
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

module.exports = router;
