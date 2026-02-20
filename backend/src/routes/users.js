// routes/users.js — mounted at /api/users
const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const db = require('../db');
const { verifyToken, requireAdmin, auditLog } = require('../middleware/shared');

// GET /api/users?role=caregiver
router.get('/', verifyToken, requireAdmin, async (req, res) => {
  try {
    const { role } = req.query;
    let query = `SELECT id, email, first_name, last_name, phone, role, is_active, hire_date, default_pay_rate FROM users WHERE 1=1`;
    const params = [];
    if (role) { params.push(role); query += ` AND role = $${params.length}`; }
    query += ` ORDER BY first_name, last_name`;
    res.json((await db.query(query, params)).rows);
  } catch (error) { res.status(500).json({ error: error.message }); }
});

// GET /api/users/caregivers
router.get('/caregivers', verifyToken, requireAdmin, async (req, res) => {
  try {
    res.json((await db.query(
      `SELECT id, email, first_name, last_name, phone, hire_date, is_active, certifications, role, default_pay_rate
       FROM users WHERE role = 'caregiver' ORDER BY first_name`
    )).rows);
  } catch (error) { res.status(500).json({ error: error.message }); }
});

// GET /api/users/caregivers/:caregiverId
router.get('/caregivers/:caregiverId', verifyToken, async (req, res) => {
  try {
    const result = await db.query(`SELECT * FROM users WHERE id = $1 AND role = 'caregiver'`, [req.params.caregiverId]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'Caregiver not found' });
    res.json(result.rows[0]);
  } catch (error) { res.status(500).json({ error: error.message }); }
});

// GET /api/users/admins
router.get('/admins', verifyToken, requireAdmin, async (req, res) => {
  try {
    res.json((await db.query(
      `SELECT id, email, first_name, last_name, phone, hire_date, is_active, role FROM users WHERE role = 'admin' ORDER BY first_name`
    )).rows);
  } catch (error) { res.status(500).json({ error: error.message }); }
});

// GET /api/users/all
router.get('/all', verifyToken, requireAdmin, async (req, res) => {
  try {
    res.json((await db.query(
      `SELECT id, email, first_name, last_name, phone, role, is_active, hire_date, default_pay_rate FROM users ORDER BY first_name, last_name`
    )).rows);
  } catch (error) { res.status(500).json({ error: error.message }); }
});

// POST /api/users/convert-to-admin
router.post('/convert-to-admin', verifyToken, requireAdmin, async (req, res) => {
  try {
    const { userId } = req.body;
    const result = await db.query(`UPDATE users SET role = 'admin', updated_at = NOW() WHERE id = $1 RETURNING *`, [userId]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'User not found' });
    await auditLog(req.user.id, 'UPDATE', 'users', userId, null, result.rows[0]);
    res.json(result.rows[0]);
  } catch (error) { res.status(500).json({ error: error.message }); }
});

// PUT /api/users/:caregiverId/reset-password
router.put('/:caregiverId/reset-password', verifyToken, requireAdmin, async (req, res) => {
  try {
    const { newPassword } = req.body;
    if (!newPassword || newPassword.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters' });
    const hashed = await bcrypt.hash(newPassword, 10);
    const result = await db.query(`UPDATE users SET password_hash = $1, updated_at = NOW() WHERE id = $2 RETURNING id, email, first_name, last_name`, [hashed, req.params.caregiverId]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'User not found' });
    await auditLog(req.user.id, 'UPDATE', 'users', req.params.caregiverId, null, { action: 'password_reset' });
    res.json({ success: true, user: result.rows[0] });
  } catch (error) { res.status(500).json({ error: error.message }); }
});

module.exports = router;
