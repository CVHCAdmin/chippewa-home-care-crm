// routes/authRoutes.js
const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const db = require('../db');
const { verifyToken, requireAdmin, auditLog } = require('../middleware/shared');

// Helper: log a login attempt (fire-and-forget, never blocks the response)
async function logLoginAttempt({ email, userId, success, failReason, req }) {
  try {
    const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.ip || 'unknown';
    const userAgent = req.headers['user-agent'] || null;
    await db.query(
      `INSERT INTO login_activity (email, user_id, success, ip_address, user_agent, fail_reason)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [email, userId || null, success, ip, userAgent, failReason || null]
    );
  } catch (err) {
    console.error('Failed to log login activity:', err.message);
  }
}

// POST /api/auth/login
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    const result = await db.query('SELECT * FROM users WHERE email = $1', [email]);
    const user = result.rows[0];

    if (!user) {
      logLoginAttempt({ email, userId: null, success: false, failReason: 'user_not_found', req });
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const passwordMatch = await bcrypt.compare(password, user.password_hash);
    if (!passwordMatch) {
      logLoginAttempt({ email, userId: user.id, success: false, failReason: 'invalid_password', req });
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    if (user.is_active === false) {
      logLoginAttempt({ email, userId: user.id, success: false, failReason: 'account_inactive', req });
      return res.status(401).json({ error: 'Account is inactive' });
    }

    logLoginAttempt({ email, userId: user.id, success: true, failReason: null, req });

    const token = jwt.sign(
      { id: user.id, email: user.email, role: user.role, name: `${user.first_name} ${user.last_name}` },
      process.env.JWT_SECRET,
      { expiresIn: '8h' }
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

// POST /api/auth/impersonate/:userId
// Admin only — generates a short-lived token to view the app as another user
router.post('/impersonate/:userId', verifyToken, requireAdmin, async (req, res) => {
  try {
    const { userId } = req.params;

    const result = await db.query('SELECT * FROM users WHERE id = $1', [userId]);
    const targetUser = result.rows[0];
    if (!targetUser) return res.status(404).json({ error: 'User not found' });

    // Log the impersonation action
    await auditLog(req.user.id, 'ADMIN_IMPERSONATE', 'users', userId, null, {
      impersonating: targetUser.email,
      impersonatedBy: req.user.email
    });

    const token = jwt.sign(
      {
        id: targetUser.id,
        email: targetUser.email,
        role: targetUser.role,
        name: `${targetUser.first_name} ${targetUser.last_name}`,
        impersonatedBy: req.user.email,
        impersonation: true
      },
      process.env.JWT_SECRET,
      { expiresIn: '2h' }
    );

    res.json({
      token,
      user: {
        id: targetUser.id,
        email: targetUser.email,
        name: `${targetUser.first_name} ${targetUser.last_name}`,
        role: targetUser.role,
        impersonatedBy: req.user.email
      }
    });
  } catch (error) {
    console.error('Impersonation error:', error);
    res.status(500).json({ error: 'Impersonation failed' });
  }
});

// GET /api/auth/users — admin only, returns list of users to impersonate
router.get('/users', verifyToken, requireAdmin, async (req, res) => {
  try {
    const result = await db.query(
      `SELECT id, email, first_name, last_name, role, is_active
       FROM users
       ORDER BY role, last_name, first_name`
    );
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching users:', error);
    res.status(500).json({ error: 'Failed to fetch users' });
  }
});

// GET /api/auth/login-activity — admin only
router.get('/login-activity', verifyToken, requireAdmin, async (req, res) => {
  try {
    const { page = 1, limit = 50, email, success } = req.query;
    const offset = (parseInt(page) - 1) * parseInt(limit);

    const conditions = [];
    const params = [];

    if (email) {
      params.push(`%${email.toLowerCase()}%`);
      conditions.push(`la.email ILIKE $${params.length}`);
    }
    if (success !== undefined && success !== '') {
      params.push(success === 'true');
      conditions.push(`la.success = $${params.length}`);
    }

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

    const dataParams = [...params, parseInt(limit), offset];
    const rows = await db.query(
      `SELECT
         la.id,
         la.email,
         la.success,
         la.ip_address,
         la.user_agent,
         la.fail_reason,
         la.created_at,
         u.first_name,
         u.last_name,
         u.role
       FROM login_activity la
       LEFT JOIN users u ON u.id = la.user_id
       ${where}
       ORDER BY la.created_at DESC
       LIMIT $${dataParams.length - 1} OFFSET $${dataParams.length}`,
      dataParams
    );

    const countResult = await db.query(
      `SELECT COUNT(*) FROM login_activity la ${where}`,
      params
    );

    res.json({
      success: true,
      activity: rows.rows,
      pagination: {
        total: parseInt(countResult.rows[0].count),
        page: parseInt(page),
        pages: Math.ceil(parseInt(countResult.rows[0].count) / parseInt(limit))
      }
    });
  } catch (error) {
    console.error('Login activity fetch error:', error);
    res.status(500).json({ error: 'Failed to fetch login activity' });
  }
});

module.exports = router;
