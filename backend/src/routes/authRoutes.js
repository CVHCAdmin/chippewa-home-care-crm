// routes/authRoutes.js
const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const db = require('../db');
const { verifyToken, requireAdmin, auditLog } = require('../middleware/shared');

// POST /api/auth/login
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    const result = await db.query('SELECT * FROM users WHERE email = $1', [email]);
    const user = result.rows[0];
    if (!user) return res.status(401).json({ error: 'Invalid credentials' });

    const passwordMatch = await bcrypt.compare(password, user.password_hash);
    if (!passwordMatch) return res.status(401).json({ error: 'Invalid credentials' });

    const token = jwt.sign(
      { id: user.id, email: user.email, role: user.role, name: `${user.first_name} ${user.last_name}` },
      process.env.JWT_SECRET
    );
    res.json({
      token,
      user: { id: user.id, email: user.email, name: `${user.first_name} ${user.last_name}`, role: user.role }
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ error: 'Login failed' });
  }
});

// POST /api/auth/register-caregiver
router.post('/register-caregiver', verifyToken, requireAdmin, async (req, res) => {
  try {
    const { email, password, firstName, lastName, phone, payRate } = req.body;
    const hashedPassword = await bcrypt.hash(password, 10);
    const userId = uuidv4();
    await db.query("SELECT set_config('app.current_user_id', $1, false)", [req.user.id]);
    const result = await db.query(
      `INSERT INTO users (id, email, password_hash, first_name, last_name, phone, role, default_pay_rate)
       VALUES ($1, $2, $3, $4, $5, $6, 'caregiver', $7)
       RETURNING id, email, first_name, last_name, role, default_pay_rate`,
      [userId, email, hashedPassword, firstName, lastName, phone, payRate || 15.00]
    );
    res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error('Caregiver registration error:', error);
    if (error.code === '23505') return res.status(409).json({ error: 'Email already exists' });
    res.status(500).json({ error: 'Registration failed' });
  }
});

// POST /api/auth/register-admin
router.post('/register-admin', verifyToken, requireAdmin, async (req, res) => {
  try {
    const { email, password, firstName, lastName, phone } = req.body;
    const hashedPassword = await bcrypt.hash(password, 10);
    const userId = uuidv4();
    await db.query("SELECT set_config('app.current_user_id', $1, false)", [req.user.id]);
    const result = await db.query(
      `INSERT INTO users (id, email, password_hash, first_name, last_name, phone, role)
       VALUES ($1, $2, $3, $4, $5, $6, 'admin')
       RETURNING id, email, first_name, last_name, role`,
      [userId, email, hashedPassword, firstName, lastName, phone]
    );
    res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error('Admin registration error:', error);
    if (error.code === '23505') return res.status(409).json({ error: 'Email already exists' });
    res.status(500).json({ error: 'Registration failed' });
  }
});

module.exports = router;
