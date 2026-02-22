// routes/clientPortalRoutes.js
// Client Patient Portal — allows clients to view their own visits, caregivers,
// invoices, and notifications. Separate auth from users/family tables.

const express = require('express');
const router  = express.Router();
const db      = require('../db');
const auth    = require('../middleware/auth');
const bcrypt  = require('bcryptjs');
const jwt     = require('jsonwebtoken');
const crypto  = require('crypto');

// ─────────────────────────────────────────────────────────────────────────────
// CLIENT PORTAL AUTH MIDDLEWARE
// JWT must carry { role: 'client', clientId: uuid }
// ─────────────────────────────────────────────────────────────────────────────
const clientAuth = async (req, res, next) => {
  try {
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) return res.status(401).json({ error: 'No token provided' });

    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    if (decoded.role !== 'client') {
      return res.status(403).json({ error: 'Client access required' });
    }

    // Verify portal is still enabled and client is active
    const result = await db.query(`
      SELECT cpa.*, c.first_name, c.last_name, c.is_active
      FROM client_portal_auth cpa
      JOIN clients c ON cpa.client_id = c.id
      WHERE cpa.client_id = $1 AND cpa.portal_enabled = true AND c.is_active = true
    `, [decoded.clientId]);

    if (result.rows.length === 0) {
      return res.status(403).json({ error: 'Portal access revoked or client inactive' });
    }

    req.clientId   = decoded.clientId;
    req.portalUser = result.rows[0];
    next();
  } catch (error) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// PUBLIC: CLIENT LOGIN
// POST /api/client-portal/login
// ─────────────────────────────────────────────────────────────────────────────
router.post('/login', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password are required' });
  }

  try {
    const result = await db.query(`
      SELECT cpa.*, c.first_name, c.last_name, c.is_active
      FROM client_portal_auth cpa
      JOIN clients c ON cpa.client_id = c.id
      WHERE LOWER(cpa.email) = LOWER($1) AND cpa.portal_enabled = true
    `, [email]);

    if (result.rows.length === 0) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const portal = result.rows[0];

    // Account lockout check
    if (portal.locked_until && new Date(portal.locked_until) > new Date()) {
      return res.status(423).json({ error: 'Account temporarily locked. Please try again later.' });
    }

    if (!portal.password_hash) {
      return res.status(401).json({ error: 'Account setup not complete. Please check your invite email.' });
    }

    const valid = await bcrypt.compare(password, portal.password_hash);

    if (!valid) {
      // Increment failed login count, lock after 5 attempts
      const failCount = portal.failed_login_count + 1;
      const lockUntil = failCount >= 5 ? new Date(Date.now() + 15 * 60 * 1000) : null;

      await db.query(`
        UPDATE client_portal_auth
        SET failed_login_count = $1, locked_until = $2, updated_at = NOW()
        WHERE client_id = $3
      `, [failCount, lockUntil, portal.client_id]);

      return res.status(401).json({ error: 'Invalid credentials' });
    }

    // Successful login — reset fail count, update last_login
    await db.query(`
      UPDATE client_portal_auth
      SET failed_login_count = 0, locked_until = NULL, last_login = NOW(), updated_at = NOW()
      WHERE client_id = $1
    `, [portal.client_id]);

    const token = jwt.sign(
      { role: 'client', clientId: portal.client_id },
      process.env.JWT_SECRET,
      { expiresIn: '8h' }
    );

    res.json({
      token,
      client: {
        id:        portal.client_id,
        firstName: portal.first_name,
        lastName:  portal.last_name,
        email:     portal.email,
      }
    });
  } catch (error) {
    console.error('[ClientPortal] login error:', error.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// PUBLIC: ACCEPT INVITE & SET PASSWORD
// POST /api/client-portal/set-password
// Body: { token, password }
// ─────────────────────────────────────────────────────────────────────────────
router.post('/set-password', async (req, res) => {
  const { token, password } = req.body;
  if (!token || !password) {
    return res.status(400).json({ error: 'Token and password are required' });
  }
  if (password.length < 8) {
    return res.status(400).json({ error: 'Password must be at least 8 characters' });
  }

  try {
    const result = await db.query(`
      SELECT * FROM client_portal_auth
      WHERE invite_token = $1 AND invite_expires_at > NOW()
    `, [token]);

    if (result.rows.length === 0) {
      return res.status(400).json({ error: 'Invalid or expired invite link. Please contact your care coordinator.' });
    }

    const passwordHash = await bcrypt.hash(password, 12);

    await db.query(`
      UPDATE client_portal_auth
      SET password_hash  = $1,
          invite_token   = NULL,
          invite_expires_at = NULL,
          portal_enabled = true,
          updated_at     = NOW()
      WHERE client_id = $2
    `, [passwordHash, result.rows[0].client_id]);

    res.json({ success: true, message: 'Password set. You can now log in.' });
  } catch (error) {
    console.error('[ClientPortal] set-password error:', error.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// PORTAL: GET MY PROFILE
// GET /api/client-portal/portal/me
// ─────────────────────────────────────────────────────────────────────────────
router.get('/portal/me', clientAuth, async (req, res) => {
  try {
    const result = await db.query(`
      SELECT
        c.id, c.first_name, c.last_name, c.date_of_birth,
        c.phone, c.email, c.address, c.city, c.state, c.zip,
        c.service_type, c.start_date,
        cpa.email as portal_email, cpa.last_login
      FROM clients c
      JOIN client_portal_auth cpa ON cpa.client_id = c.id
      WHERE c.id = $1
    `, [req.clientId]);

    res.json(result.rows[0] || null);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// PORTAL: GET UPCOMING SCHEDULED VISITS
// GET /api/client-portal/portal/visits
// Query: ?limit=20&offset=0&past=false
// ─────────────────────────────────────────────────────────────────────────────
router.get('/portal/visits', clientAuth, async (req, res) => {
  const limit  = Math.min(parseInt(req.query.limit)  || 20, 50);
  const offset = parseInt(req.query.offset) || 0;
  const past   = req.query.past === 'true';

  try {
    const result = await db.query(`
      SELECT
        sv.id, sv.scheduled_date, sv.start_time, sv.end_time, sv.status, sv.notes,
        sv.cancelled_reason,
        u.first_name as caregiver_first_name,
        u.last_name  as caregiver_last_name,
        u.phone      as caregiver_phone
      FROM scheduled_visits sv
      JOIN users u ON sv.caregiver_id = u.id
      WHERE sv.client_id = $1
        AND sv.scheduled_date ${past ? '<' : '>='} CURRENT_DATE
        AND sv.status != 'cancelled'
      ORDER BY sv.scheduled_date ${past ? 'DESC' : 'ASC'}, sv.start_time ASC
      LIMIT $2 OFFSET $3
    `, [req.clientId, limit, offset]);

    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// PORTAL: GET VISIT HISTORY (completed time entries)
// GET /api/client-portal/portal/history
// ─────────────────────────────────────────────────────────────────────────────
router.get('/portal/history', clientAuth, async (req, res) => {
  const limit  = Math.min(parseInt(req.query.limit) || 20, 50);
  const offset = parseInt(req.query.offset) || 0;

  try {
    const result = await db.query(`
      SELECT
        te.id, te.start_time, te.end_time, te.duration_minutes, te.notes,
        u.first_name as caregiver_first_name,
        u.last_name  as caregiver_last_name
      FROM time_entries te
      JOIN users u ON te.caregiver_id = u.id
      WHERE te.client_id = $1 AND te.is_complete = true
      ORDER BY te.start_time DESC
      LIMIT $2 OFFSET $3
    `, [req.clientId, limit, offset]);

    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// PORTAL: GET MY CAREGIVERS (active assignments)
// GET /api/client-portal/portal/caregivers
// ─────────────────────────────────────────────────────────────────────────────
router.get('/portal/caregivers', clientAuth, async (req, res) => {
  try {
    const result = await db.query(`
      SELECT
        ca.id as assignment_id, ca.assignment_date, ca.hours_per_week, ca.status,
        u.id  as caregiver_id,
        u.first_name, u.last_name, u.phone,
        u.certifications
      FROM client_assignments ca
      JOIN users u ON ca.caregiver_id = u.id
      WHERE ca.client_id = $1 AND ca.status = 'active'
      ORDER BY ca.assignment_date DESC
    `, [req.clientId]);

    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// PORTAL: GET MY INVOICES
// GET /api/client-portal/portal/invoices
// ─────────────────────────────────────────────────────────────────────────────
router.get('/portal/invoices', clientAuth, async (req, res) => {
  try {
    const result = await db.query(`
      SELECT
        i.id, i.invoice_number, i.billing_period_start, i.billing_period_end,
        i.subtotal, i.tax, i.total, i.payment_status,
        i.payment_due_date, i.payment_date, i.created_at
      FROM invoices i
      WHERE i.client_id = $1
      ORDER BY i.created_at DESC
      LIMIT 24
    `, [req.clientId]);

    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// PORTAL: GET MY NOTIFICATIONS
// GET /api/client-portal/portal/notifications
// ─────────────────────────────────────────────────────────────────────────────
router.get('/portal/notifications', clientAuth, async (req, res) => {
  try {
    const result = await db.query(`
      SELECT
        cn.id, cn.type, cn.title, cn.message, cn.is_read, cn.created_at,
        cn.related_visit_id, cn.related_invoice_id, cn.related_caregiver_id
      FROM client_notifications cn
      WHERE cn.client_id = $1
      ORDER BY cn.created_at DESC
      LIMIT 50
    `, [req.clientId]);

    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// PORTAL: MARK NOTIFICATION READ
// PUT /api/client-portal/portal/notifications/:id/read
// ─────────────────────────────────────────────────────────────────────────────
router.put('/portal/notifications/:id/read', clientAuth, async (req, res) => {
  try {
    await db.query(`
      UPDATE client_notifications
      SET is_read = true
      WHERE id = $1 AND client_id = $2
    `, [req.params.id, req.clientId]);

    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// PORTAL: MARK ALL NOTIFICATIONS READ
// PUT /api/client-portal/portal/notifications/read-all
// ─────────────────────────────────────────────────────────────────────────────
router.put('/portal/notifications/read-all', clientAuth, async (req, res) => {
  try {
    await db.query(`
      UPDATE client_notifications
      SET is_read = true
      WHERE client_id = $1 AND is_read = false
    `, [req.clientId]);

    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// PORTAL: UPDATE NOTIFICATION PREFERENCES
// PUT /api/client-portal/portal/preferences
// ─────────────────────────────────────────────────────────────────────────────
router.put('/portal/preferences', clientAuth, async (req, res) => {
  const { emailEnabled, portalEnabled, caregiverAlerts, scheduleAlerts, billingAlerts, assignmentAlerts } = req.body;

  try {
    await db.query(`
      INSERT INTO client_notification_preferences
        (client_id, email_enabled, portal_enabled, caregiver_alerts, schedule_alerts, billing_alerts, assignment_alerts)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      ON CONFLICT (client_id) DO UPDATE SET
        email_enabled     = COALESCE($2, client_notification_preferences.email_enabled),
        portal_enabled    = COALESCE($3, client_notification_preferences.portal_enabled),
        caregiver_alerts  = COALESCE($4, client_notification_preferences.caregiver_alerts),
        schedule_alerts   = COALESCE($5, client_notification_preferences.schedule_alerts),
        billing_alerts    = COALESCE($6, client_notification_preferences.billing_alerts),
        assignment_alerts = COALESCE($7, client_notification_preferences.assignment_alerts),
        updated_at        = NOW()
    `, [req.clientId, emailEnabled, portalEnabled, caregiverAlerts, scheduleAlerts, billingAlerts, assignmentAlerts]);

    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// ADMIN: INVITE CLIENT TO PORTAL
// POST /api/client-portal/admin/invite
// Body: { clientId, email }
// Requires admin JWT
// ─────────────────────────────────────────────────────────────────────────────
router.post('/admin/invite', auth, async (req, res) => {
  if (req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Admin access required' });
  }

  const { clientId, email } = req.body;
  if (!clientId || !email) {
    return res.status(400).json({ error: 'clientId and email are required' });
  }

  try {
    // Verify client exists and is active
    const client = await db.query(
      'SELECT id, first_name, last_name FROM clients WHERE id = $1 AND is_active = true',
      [clientId]
    );
    if (client.rows.length === 0) {
      return res.status(404).json({ error: 'Client not found or inactive' });
    }

    // Generate secure invite token (48hr expiry)
    const inviteToken   = crypto.randomBytes(32).toString('hex');
    const inviteExpires = new Date(Date.now() + 48 * 60 * 60 * 1000);

    await db.query(`
      INSERT INTO client_portal_auth
        (client_id, email, invite_token, invite_expires_at, portal_enabled)
      VALUES ($1, $2, $3, $4, false)
      ON CONFLICT (client_id) DO UPDATE SET
        email             = $2,
        invite_token      = $3,
        invite_expires_at = $4,
        updated_at        = NOW()
    `, [clientId, email, inviteToken, inviteExpires]);

    // TODO: Send invite email via your email service
    // The invite URL would be: https://your-app.com/portal/setup?token=<inviteToken>
    const inviteUrl = `${process.env.FRONTEND_URL || 'https://chippewa-home-care.netlify.app'}/portal/setup?token=${inviteToken}`;

    res.json({
      success:   true,
      inviteUrl, // Return URL so admin can manually share if email isn't configured
      message:   `Invite created for ${client.rows[0].first_name} ${client.rows[0].last_name}`,
      expiresAt: inviteExpires,
    });
  } catch (error) {
    if (error.code === '23505') {
      return res.status(400).json({ error: 'A portal account already exists with this email' });
    }
    res.status(500).json({ error: error.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// ADMIN: GET PORTAL STATUS FOR ALL CLIENTS
// GET /api/client-portal/admin/clients
// ─────────────────────────────────────────────────────────────────────────────
router.get('/admin/clients', auth, async (req, res) => {
  if (req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Admin access required' });
  }

  try {
    const result = await db.query(`
      SELECT
        c.id, c.first_name, c.last_name, c.phone, c.email, c.is_active,
        cpa.portal_enabled,
        cpa.email      as portal_email,
        cpa.last_login,
        cpa.invite_expires_at,
        CASE
          WHEN cpa.invite_token IS NOT NULL AND cpa.invite_expires_at > NOW() THEN 'invite_pending'
          WHEN cpa.invite_token IS NOT NULL AND cpa.invite_expires_at <= NOW() THEN 'invite_expired'
          WHEN cpa.portal_enabled = true THEN 'active'
          WHEN cpa.id IS NOT NULL THEN 'disabled'
          ELSE 'not_invited'
        END as portal_status
      FROM clients c
      LEFT JOIN client_portal_auth cpa ON cpa.client_id = c.id
      WHERE c.is_active = true
      ORDER BY c.last_name, c.first_name
    `);

    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// ADMIN: TOGGLE PORTAL ACCESS ON/OFF
// PUT /api/client-portal/admin/clients/:clientId/toggle
// ─────────────────────────────────────────────────────────────────────────────
router.put('/admin/clients/:clientId/toggle', auth, async (req, res) => {
  if (req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Admin access required' });
  }

  const { enabled } = req.body;

  try {
    await db.query(`
      UPDATE client_portal_auth
      SET portal_enabled = $1, updated_at = NOW()
      WHERE client_id = $2
    `, [enabled, req.params.clientId]);

    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// ADMIN: CREATE SCHEDULED VISIT
// POST /api/client-portal/admin/scheduled-visits
// ─────────────────────────────────────────────────────────────────────────────
router.post('/admin/scheduled-visits', auth, async (req, res) => {
  if (req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Admin access required' });
  }

  const { clientId, caregiverId, assignmentId, scheduledDate, startTime, endTime, notes } = req.body;
  if (!clientId || !caregiverId || !scheduledDate || !startTime || !endTime) {
    return res.status(400).json({ error: 'clientId, caregiverId, scheduledDate, startTime, endTime are required' });
  }

  try {
    const result = await db.query(`
      INSERT INTO scheduled_visits
        (client_id, caregiver_id, assignment_id, scheduled_date, start_time, end_time, notes, created_by)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      RETURNING *
    `, [clientId, caregiverId, assignmentId || null, scheduledDate, startTime, endTime, notes || null, req.user.id]);

    // Notify client if they have portal access and schedule alerts enabled
    const prefs = await db.query(`
      SELECT cnp.schedule_alerts, cpa.portal_enabled
      FROM client_notification_preferences cnp
      JOIN client_portal_auth cpa ON cpa.client_id = cnp.client_id
      WHERE cnp.client_id = $1
    `, [clientId]);

    if (prefs.rows[0]?.portal_enabled && prefs.rows[0]?.schedule_alerts) {
      const caregiver = await db.query(
        'SELECT first_name, last_name FROM users WHERE id = $1',
        [caregiverId]
      );
      const cg = caregiver.rows[0];
      await db.query(`
        INSERT INTO client_notifications
          (client_id, type, title, message, related_visit_id)
        VALUES ($1, 'visit_scheduled', 'Visit Scheduled', $2, $3)
      `, [
        clientId,
        `A visit has been scheduled for ${scheduledDate} at ${startTime} with ${cg?.first_name} ${cg?.last_name}.`,
        result.rows[0].id
      ]);
    }

    res.status(201).json(result.rows[0]);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// ADMIN: GET ALL SCHEDULED VISITS
// GET /api/client-portal/admin/scheduled-visits
// Query: ?clientId=uuid&caregiverId=uuid&date=YYYY-MM-DD&status=scheduled
// ─────────────────────────────────────────────────────────────────────────────
router.get('/admin/scheduled-visits', auth, async (req, res) => {
  if (req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Admin access required' });
  }

  const { clientId, caregiverId, date, status } = req.query;

  try {
    let query = `
      SELECT
        sv.*,
        c.first_name  as client_first_name,  c.last_name  as client_last_name,
        u.first_name  as caregiver_first_name, u.last_name as caregiver_last_name
      FROM scheduled_visits sv
      JOIN clients c ON sv.client_id = c.id
      JOIN users   u ON sv.caregiver_id = u.id
      WHERE 1=1
    `;
    const params = [];

    if (clientId)   { params.push(clientId);   query += ` AND sv.client_id = $${params.length}`; }
    if (caregiverId){ params.push(caregiverId); query += ` AND sv.caregiver_id = $${params.length}`; }
    if (date)       { params.push(date);        query += ` AND sv.scheduled_date = $${params.length}`; }
    if (status)     { params.push(status);      query += ` AND sv.status = $${params.length}`; }

    query += ` ORDER BY sv.scheduled_date ASC, sv.start_time ASC`;

    const result = await db.query(query, params);
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// ADMIN: CANCEL SCHEDULED VISIT
// PUT /api/client-portal/admin/scheduled-visits/:id/cancel
// ─────────────────────────────────────────────────────────────────────────────
router.put('/admin/scheduled-visits/:id/cancel', auth, async (req, res) => {
  if (req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Admin access required' });
  }

  const { reason } = req.body;

  try {
    const result = await db.query(`
      UPDATE scheduled_visits
      SET status           = 'cancelled',
          cancelled_reason = $1,
          cancelled_by     = $2,
          cancelled_at     = NOW(),
          updated_at       = NOW()
      WHERE id = $3
      RETURNING client_id, scheduled_date, start_time
    `, [reason || null, req.user.id, req.params.id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Visit not found' });
    }

    const visit = result.rows[0];

    // Notify client
    const prefs = await db.query(`
      SELECT cnp.schedule_alerts, cpa.portal_enabled
      FROM client_notification_preferences cnp
      JOIN client_portal_auth cpa ON cpa.client_id = cnp.client_id
      WHERE cnp.client_id = $1
    `, [visit.client_id]);

    if (prefs.rows[0]?.portal_enabled && prefs.rows[0]?.schedule_alerts) {
      await db.query(`
        INSERT INTO client_notifications
          (client_id, type, title, message, related_visit_id)
        VALUES ($1, 'visit_cancelled', 'Visit Cancelled', $2, $3)
      `, [
        visit.client_id,
        `Your visit on ${visit.scheduled_date} at ${visit.start_time} has been cancelled.${reason ? ' Reason: ' + reason : ''}`,
        req.params.id
      ]);
    }

    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// ADMIN: SEND NOTIFICATION TO CLIENT
// POST /api/client-portal/admin/notify
// Body: { clientId, type, title, message, relatedVisitId?, relatedInvoiceId? }
// ─────────────────────────────────────────────────────────────────────────────
router.post('/admin/notify', auth, async (req, res) => {
  if (req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Admin access required' });
  }

  const { clientId, type, title, message, relatedVisitId, relatedInvoiceId, relatedCaregiverId } = req.body;
  if (!clientId || !type || !title) {
    return res.status(400).json({ error: 'clientId, type, and title are required' });
  }

  try {
    const result = await db.query(`
      INSERT INTO client_notifications
        (client_id, type, title, message, related_visit_id, related_invoice_id, related_caregiver_id)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      RETURNING *
    `, [clientId, type, title, message || null, relatedVisitId || null, relatedInvoiceId || null, relatedCaregiverId || null]);

    res.status(201).json(result.rows[0]);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
