// routes/absenceRoutes.js — mounted at /api via app.use('/api', absenceRoutes)
const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const db = require('../db');
const { verifyToken, requireAdmin, auditLog } = require('../middleware/shared');
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

module.exports = router;
