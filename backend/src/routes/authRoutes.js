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

// ─── CHANGE OWN PASSWORD ──────────────────────────────────────────────────────
// Any logged-in user can change their own password
router.put('/change-password', verifyToken, async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;
    if (!currentPassword || !newPassword) return res.status(400).json({ error: 'Current password and new password are required' });
    if (newPassword.length < 8) return res.status(400).json({ error: 'New password must be at least 8 characters' });

    const result = await db.query('SELECT password_hash FROM users WHERE id = $1', [req.user.id]);
    if (!result.rows.length) return res.status(404).json({ error: 'User not found' });

    const match = await bcrypt.compare(currentPassword, result.rows[0].password_hash);
    if (!match) return res.status(401).json({ error: 'Current password is incorrect' });

    const hashed = await bcrypt.hash(newPassword, 10);
    await db.query('UPDATE users SET password_hash = $1, updated_at = NOW() WHERE id = $2', [hashed, req.user.id]);
    await auditLog(req.user.id, 'UPDATE', 'users', req.user.id, null, { action: 'password_changed_self' });

    res.json({ success: true, message: 'Password changed successfully' });
  } catch (error) {
    console.error('Change password error:', error);
    res.status(500).json({ error: 'Failed to change password' });
  }
});

// ─── FORGOT PASSWORD (REQUEST RESET) ─────────────────────────────────────────
// Public endpoint — sends a reset link via email
router.post('/forgot-password', async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) return res.status(400).json({ error: 'Email is required' });

    const result = await db.query('SELECT id, email, first_name FROM users WHERE email = $1 AND is_active = true', [email.toLowerCase().trim()]);

    // Always return success to prevent email enumeration
    if (!result.rows.length) return res.json({ success: true, message: 'If an account exists with that email, a reset link has been sent.' });

    const user = result.rows[0];
    const resetToken = uuidv4();
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000); // 1 hour

    await db.query(
      `UPDATE users SET reset_token = $1, reset_token_expires = $2, updated_at = NOW() WHERE id = $3`,
      [resetToken, expiresAt, user.id]
    );

    // Send reset email
    const { sendPasswordReset } = require('../services/emailService');
    const frontendUrl = process.env.FRONTEND_URL || 'https://cvhc-crm.netlify.app';
    const resetUrl = `${frontendUrl}/reset-password?token=${resetToken}`;

    await sendPasswordReset({ to: user.email, userName: user.first_name, resetUrl });

    res.json({ success: true, message: 'If an account exists with that email, a reset link has been sent.' });
  } catch (error) {
    console.error('Forgot password error:', error);
    res.status(500).json({ error: 'Failed to process request' });
  }
});

// ─── RESET PASSWORD (WITH TOKEN) ─────────────────────────────────────────────
// Public endpoint — resets password using the emailed token
router.post('/reset-password', async (req, res) => {
  try {
    const { token, newPassword } = req.body;
    if (!token || !newPassword) return res.status(400).json({ error: 'Token and new password are required' });
    if (newPassword.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters' });

    const result = await db.query(
      `SELECT id, email FROM users WHERE reset_token = $1 AND reset_token_expires > NOW()`,
      [token]
    );

    if (!result.rows.length) return res.status(400).json({ error: 'Invalid or expired reset link. Please request a new one.' });

    const user = result.rows[0];
    const hashed = await bcrypt.hash(newPassword, 10);

    await db.query(
      `UPDATE users SET password_hash = $1, reset_token = NULL, reset_token_expires = NULL, updated_at = NOW() WHERE id = $2`,
      [hashed, user.id]
    );

    await auditLog(user.id, 'UPDATE', 'users', user.id, null, { action: 'password_reset_via_email' });

    res.json({ success: true, message: 'Password has been reset. You can now sign in.' });
  } catch (error) {
    console.error('Reset password error:', error);
    res.status(500).json({ error: 'Failed to reset password' });
  }
});

module.exports = router;
