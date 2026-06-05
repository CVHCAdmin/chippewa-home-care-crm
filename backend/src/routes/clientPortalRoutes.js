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
const { sendClientPortalInvite } = require('../services/emailService');

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

    // Admin impersonation — skip portal account check, just verify client exists
    if (decoded.impersonation) {
      const client = await db.query(
        'SELECT id, first_name, last_name, is_active FROM clients WHERE id = $1',
        [decoded.clientId]
      );
      if (client.rows.length === 0) {
        return res.status(403).json({ error: 'Client not found' });
      }
      req.clientId   = decoded.clientId;
      req.portalUser = client.rows[0];
      return next();
    }

    // Verify portal is still enabled and client is active
    const result = await db.query(`
      SELECT cpa.*, c.first_name, c.last_name, c.is_active
      FROM client_portal_accounts cpa
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
      FROM client_portal_accounts cpa
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
        UPDATE client_portal_accounts
        SET failed_login_count = $1, locked_until = $2, updated_at = NOW()
        WHERE client_id = $3
      `, [failCount, lockUntil, portal.client_id]);

      return res.status(401).json({ error: 'Invalid credentials' });
    }

    // Successful login — reset fail count, update last_login
    await db.query(`
      UPDATE client_portal_accounts
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
      SELECT * FROM client_portal_accounts
      WHERE invite_token = $1 AND invite_expires_at > NOW()
    `, [token]);

    if (result.rows.length === 0) {
      return res.status(400).json({ error: 'Invalid or expired invite link. Please contact your care coordinator.' });
    }

    const passwordHash = await bcrypt.hash(password, 12);

    await db.query(`
      UPDATE client_portal_accounts
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
      LEFT JOIN client_portal_accounts cpa ON cpa.client_id = c.id
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
//
// Merges two sources:
//  1. scheduled_visits  — one-off visits created by admin via portal
//  2. schedules         — recurring/one-off shifts from the main scheduler
//     Recurring schedules (day_of_week) are expanded into the next 4 weeks.
// ─────────────────────────────────────────────────────────────────────────────
router.get('/portal/visits', clientAuth, async (req, res) => {
  const limit  = Math.min(parseInt(req.query.limit)  || 20, 50);
  const offset = parseInt(req.query.offset) || 0;
  const past   = req.query.past === 'true';

  try {
    // 1. Explicit scheduled_visits (portal-created)
    const svResult = await db.query(`
      SELECT
        sv.id, sv.scheduled_date, sv.start_time::text, sv.end_time::text,
        sv.status, sv.notes, sv.client_notes, sv.cancelled_reason,
        sv.caregiver_id,
        sv.source_schedule_id as schedule_id,
        u.first_name as caregiver_first_name,
        u.last_name  as caregiver_last_name,
        u.phone      as caregiver_phone,
        'scheduled_visit' as source
      FROM scheduled_visits sv
      JOIN users u ON sv.caregiver_id = u.id
      WHERE sv.client_id = $1
        AND sv.scheduled_date ${past ? '<' : '>='} CURRENT_DATE
        AND sv.status != 'cancelled'
    `, [req.clientId]);

    // 2. Active schedules from the main scheduler
    const schResult = await db.query(`
      SELECT
        s.id, s.caregiver_id, s.schedule_type, s.day_of_week, s.date,
        s.start_time::text, s.end_time::text, s.notes,
        u.first_name as caregiver_first_name,
        u.last_name  as caregiver_last_name,
        u.phone      as caregiver_phone
      FROM schedules s
      JOIN users u ON s.caregiver_id = u.id
      WHERE s.client_id = $1
        AND s.is_active = true
        AND (s.status IS NULL OR s.status = 'active')
    `, [req.clientId]);

    // 3. Load schedule exceptions (cancelled/modified occurrences) to skip them
    const scheduleIds = schResult.rows.map(s => s.id);
    let exceptionKeys = new Set();
    if (scheduleIds.length > 0) {
      const exResult = await db.query(`
        SELECT schedule_id, exception_date::text
        FROM schedule_exceptions
        WHERE schedule_id = ANY($1)
      `, [scheduleIds]);
      exResult.rows.forEach(e => exceptionKeys.add(`${e.schedule_id}|${e.exception_date}`));
    }

    // Expand recurring schedules into concrete dates (next 4 weeks / past 4 weeks)
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const weeksOut = 4;
    const expanded = [];

    for (const sch of schResult.rows) {
      if (sch.schedule_type === 'recurring' && sch.day_of_week != null) {
        // Generate dates for the next (or past) 4 weeks matching this day_of_week
        for (let w = 0; w < weeksOut; w++) {
          const d = new Date(today);
          // Find the next occurrence of day_of_week from today + w weeks
          const diff = (sch.day_of_week - d.getDay() + 7) % 7;
          d.setDate(d.getDate() + diff + (w * 7));
          const dateStr = d.toISOString().split('T')[0];

          // Skip if there's an exception for this date
          if (exceptionKeys.has(`${sch.id}|${dateStr}`)) continue;

          const isFuture = d >= today;
          if ((past && !isFuture) || (!past && isFuture)) {
            expanded.push({
              id: `${sch.id}-${dateStr}`,
              scheduled_date: dateStr,
              start_time: sch.start_time,
              end_time: sch.end_time,
              status: 'scheduled',
              notes: sch.notes,
              client_notes: null,
              cancelled_reason: null,
              caregiver_id: sch.caregiver_id,
              schedule_id: sch.id,
              caregiver_first_name: sch.caregiver_first_name,
              caregiver_last_name: sch.caregiver_last_name,
              caregiver_phone: sch.caregiver_phone,
              source: 'schedule',
            });
          }
        }
      } else if (sch.date) {
        // One-off schedule entry
        const schDate = new Date(sch.date + 'T00:00:00');
        const isFuture = schDate >= today;
        if ((past && !isFuture) || (!past && isFuture)) {
          expanded.push({
            id: sch.id,
            scheduled_date: sch.date,
            start_time: sch.start_time,
            end_time: sch.end_time,
            status: 'scheduled',
            notes: sch.notes,
            client_notes: null,
            cancelled_reason: null,
            caregiver_id: sch.caregiver_id,
            schedule_id: sch.id,
            caregiver_first_name: sch.caregiver_first_name,
            caregiver_last_name: sch.caregiver_last_name,
            caregiver_phone: sch.caregiver_phone,
            source: 'schedule',
          });
        }
      }
    }

    // Merge, deduplicate by date+time+caregiver, sort, paginate
    const all = [...svResult.rows, ...expanded];

    // Deduplicate: if a scheduled_visit exists for the same date/time/caregiver, skip the schedule version
    const svKeys = new Set(svResult.rows.map(r =>
      `${r.scheduled_date}|${r.start_time}|${r.caregiver_first_name} ${r.caregiver_last_name}`
    ));
    const deduped = all.filter(r =>
      r.source === 'scheduled_visit' ||
      !svKeys.has(`${r.scheduled_date}|${r.start_time}|${r.caregiver_first_name} ${r.caregiver_last_name}`)
    );

    deduped.sort((a, b) => {
      const dateComp = past
        ? b.scheduled_date.localeCompare(a.scheduled_date)
        : a.scheduled_date.localeCompare(b.scheduled_date);
      if (dateComp !== 0) return dateComp;
      return (a.start_time || '').localeCompare(b.start_time || '');
    });

    res.json(deduped.slice(offset, offset + limit));
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
// PORTAL: GET MY CAREGIVERS (active assignments + active schedules)
// GET /api/client-portal/portal/caregivers
//
// Merges two sources so clients see their caregivers even if
// client_assignments was never populated:
//  1. client_assignments with status 'active'
//  2. Distinct caregivers from active schedules for this client
// ─────────────────────────────────────────────────────────────────────────────
router.get('/portal/caregivers', clientAuth, async (req, res) => {
  try {
    const result = await db.query(`
      SELECT DISTINCT ON (u.id)
        COALESCE(ca.id, s.id)   as assignment_id,
        ca.assignment_date,
        ca.hours_per_week,
        COALESCE(ca.status, 'active') as status,
        u.id  as caregiver_id,
        u.first_name, u.last_name, u.phone,
        u.certifications
      FROM users u
      LEFT JOIN client_assignments ca
        ON ca.caregiver_id = u.id AND ca.client_id = $1 AND ca.status = 'active'
      LEFT JOIN schedules s
        ON s.caregiver_id = u.id AND s.client_id = $1 AND s.is_active = true
        AND (s.status IS NULL OR s.status = 'active')
      WHERE (ca.id IS NOT NULL OR s.id IS NOT NULL)
      ORDER BY u.id, ca.assignment_date DESC NULLS LAST
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
// PORTAL: MARK ALL NOTIFICATIONS READ (must be before /:id/read)
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
      INSERT INTO client_portal_accounts
        (client_id, email, invite_token, invite_expires_at, portal_enabled)
      VALUES ($1, $2, $3, $4, false)
      ON CONFLICT (client_id) DO UPDATE SET
        email             = $2,
        invite_token      = $3,
        invite_expires_at = $4,
        updated_at        = NOW()
    `, [clientId, email, inviteToken, inviteExpires]);

    const inviteUrl = `${process.env.FRONTEND_URL || 'https://app.chippewavalleyhomecare.com'}/portal/setup?token=${inviteToken}`;
    const clientName = `${client.rows[0].first_name} ${client.rows[0].last_name}`;

    // Send invite email. We catch any SendGrid error so the invite record
    // still gets created (admin can fall back to copy/paste the link), but
    // we surface the actual reason so they know whether to fix SendGrid or
    // just deliver the link manually.
    let emailSent = false;
    let emailError = null;
    try {
      emailSent = await sendClientPortalInvite({ to: email, clientName, inviteUrl });
    } catch (sgErr) {
      emailError = sgErr.message || 'SendGrid send failed';
    }

    res.json({
      success:   true,
      inviteUrl,
      emailSent,
      emailError,
      message:   emailSent
        ? `Invite email sent to ${email} for ${clientName}`
        : emailError
          ? `Invite created. Email delivery failed: ${emailError}. Share the link manually.`
          : `Invite created for ${clientName} (email not configured — share link manually)`,
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
      LEFT JOIN client_portal_accounts cpa ON cpa.client_id = c.id
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
      UPDATE client_portal_accounts
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
      JOIN client_portal_accounts cpa ON cpa.client_id = cnp.client_id
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
      JOIN client_portal_accounts cpa ON cpa.client_id = cnp.client_id
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

// ═══════════════════════════════════════════════════════════════════════════════
// CLIENT VISIT ACTIONS — notes, cancel requests, reschedule requests
// ═══════════════════════════════════════════════════════════════════════════════

// Helper: materialize a schedule-sourced virtual visit into a real scheduled_visits row
async function materializeVisit({ scheduleId, visitDate, clientId, caregiverId, startTime, endTime }) {
  const existing = await db.query(
    `SELECT id FROM scheduled_visits
     WHERE source_schedule_id = $1 AND scheduled_date = $2 AND client_id = $3`,
    [scheduleId, visitDate, clientId]
  );
  if (existing.rows.length > 0) return existing.rows[0].id;

  const result = await db.query(
    `INSERT INTO scheduled_visits
       (client_id, caregiver_id, scheduled_date, start_time, end_time, status, source_schedule_id)
     VALUES ($1, $2, $3, $4, $5, 'scheduled', $6) RETURNING id`,
    [clientId, caregiverId, visitDate, startTime, endTime, scheduleId]
  );
  return result.rows[0].id;
}

// Helper: notify all admin users
async function notifyAdmins(type, title, message) {
  try {
    const admins = await db.query("SELECT id FROM users WHERE role = 'admin' AND is_active = true");
    for (const admin of admins.rows) {
      // status column was added in migration_v25; defaulting to 'new' so the
      // notification bell's unread filter (status IN ('new','unread')) sees it.
      // Old code omitted status → defaulted to NULL → invisible to bell count.
      await db.query(
        "INSERT INTO notifications (user_id, type, title, message, status) VALUES ($1, $2, $3, $4, 'new')",
        [admin.id, type, title, message]
      );
    }
  } catch (e) { /* notifications table may not exist — don't fail */ }
}

// Helper: parse visit identity from request body
function parseVisitIdentity(body) {
  return {
    source:      body.source,
    visitId:     body.visitId || null,
    scheduleId:  body.scheduleId || null,
    visitDate:   body.visitDate,
    caregiverId: body.caregiverId,
    startTime:   body.startTime,
    endTime:     body.endTime,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// PORTAL: ADD NOTE TO VISIT
// PUT /api/client-portal/portal/visits/note
// ─────────────────────────────────────────────────────────────────────────────
router.put('/portal/visits/note', clientAuth, async (req, res) => {
  const { note } = req.body;
  const vi = parseVisitIdentity(req.body);

  if (!note || !vi.visitDate || !vi.caregiverId || !vi.startTime || !vi.endTime) {
    return res.status(400).json({ error: 'note, visitDate, caregiverId, startTime, endTime are required' });
  }

  try {
    let visitId = vi.visitId;
    if (vi.source === 'schedule' && vi.scheduleId) {
      visitId = await materializeVisit({
        scheduleId: vi.scheduleId, visitDate: vi.visitDate,
        clientId: req.clientId, caregiverId: vi.caregiverId,
        startTime: vi.startTime, endTime: vi.endTime,
      });
    }

    if (visitId) {
      await db.query(
        `UPDATE scheduled_visits SET client_notes = $1, updated_at = NOW() WHERE id = $2 AND client_id = $3`,
        [note, visitId, req.clientId]
      );
    }

    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// PORTAL: REQUEST CANCELLATION
// POST /api/client-portal/portal/visits/cancel-request
// ─────────────────────────────────────────────────────────────────────────────
router.post('/portal/visits/cancel-request', clientAuth, async (req, res) => {
  const { reason } = req.body;
  const vi = parseVisitIdentity(req.body);

  if (!vi.visitDate || !vi.caregiverId || !vi.startTime || !vi.endTime) {
    return res.status(400).json({ error: 'visitDate, caregiverId, startTime, endTime are required' });
  }

  try {
    // Materialize if needed
    let visitId = vi.visitId;
    if (vi.source === 'schedule' && vi.scheduleId) {
      visitId = await materializeVisit({
        scheduleId: vi.scheduleId, visitDate: vi.visitDate,
        clientId: req.clientId, caregiverId: vi.caregiverId,
        startTime: vi.startTime, endTime: vi.endTime,
      });
    }

    const result = await db.query(`
      INSERT INTO visit_change_requests
        (client_id, caregiver_id, request_type, visit_id, schedule_id,
         visit_date, original_start_time, original_end_time, cancel_reason)
      VALUES ($1, $2, 'cancel', $3, $4, $5, $6, $7, $8)
      RETURNING *
    `, [
      req.clientId, vi.caregiverId, visitId || null, vi.scheduleId || null,
      vi.visitDate, vi.startTime, vi.endTime, reason || null
    ]);

    // Notify caregiver + all admins
    const client = await db.query('SELECT first_name, last_name FROM clients WHERE id = $1', [req.clientId]);
    const cn = client.rows[0];
    const cancelMsg = `${cn?.first_name} ${cn?.last_name} is requesting to cancel their visit on ${vi.visitDate} at ${vi.startTime}.${reason ? ' Reason: ' + reason : ''}`;
    await db.query(
      'INSERT INTO notifications (user_id, type, title, message) VALUES ($1, $2, $3, $4)',
      [vi.caregiverId, 'visit_cancel_request', 'Cancellation Request', cancelMsg]
    ).catch(() => {});
    await notifyAdmins('visit_cancel_request', 'Client Cancellation Request', cancelMsg);

    res.status(201).json(result.rows[0]);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// PORTAL: GET CAREGIVER AVAILABILITY (for reschedule picker)
// GET /api/client-portal/portal/caregivers/:caregiverId/availability
// Query: ?startDate=YYYY-MM-DD&endDate=YYYY-MM-DD
// ─────────────────────────────────────────────────────────────────────────────
router.get('/portal/caregivers/:caregiverId/availability', clientAuth, async (req, res) => {
  const { caregiverId } = req.params;
  const startDate = req.query.startDate || new Date().toISOString().split('T')[0];
  const endDateDefault = new Date(Date.now() + 14 * 86400000).toISOString().split('T')[0];
  const endDate = req.query.endDate || endDateDefault;

  try {
    // 1. Get caregiver availability windows
    const avail = await db.query(`
      SELECT day_of_week, date, start_time::text, end_time::text, is_available
      FROM caregiver_schedules
      WHERE caregiver_id = $1 AND is_available = true
    `, [caregiverId]);

    // 2. Get existing booked visits in the date range
    const booked = await db.query(`
      SELECT scheduled_date, start_time::text, end_time::text
      FROM scheduled_visits
      WHERE caregiver_id = $1
        AND scheduled_date BETWEEN $2 AND $3
        AND status NOT IN ('cancelled')
    `, [caregiverId, startDate, endDate]);

    // 3. Get recurring schedules (other clients) that block time
    const otherSchedules = await db.query(`
      SELECT day_of_week, date, start_time::text, end_time::text
      FROM schedules
      WHERE caregiver_id = $1 AND is_active = true
        AND (status IS NULL OR status = 'active')
        AND client_id != $2
    `, [caregiverId, req.clientId]);

    // 4. Get time off
    const timeOff = await db.query(`
      SELECT start_date, end_date
      FROM caregiver_time_off
      WHERE caregiver_id = $1 AND status = 'approved'
        AND end_date >= $2 AND start_date <= $3
    `, [caregiverId, startDate, endDate]);

    // Build a set of blocked date-time combos
    const timeOffDates = new Set();
    for (const to of timeOff.rows) {
      const s = new Date(to.start_date);
      const e = new Date(to.end_date);
      for (let d = new Date(s); d <= e; d.setDate(d.getDate() + 1)) {
        timeOffDates.add(d.toISOString().split('T')[0]);
      }
    }

    // Expand availability into concrete date slots
    const slots = [];
    const start = new Date(startDate + 'T00:00:00');
    const end = new Date(endDate + 'T00:00:00');

    for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
      const dateStr = d.toISOString().split('T')[0];
      const dow = d.getDay();

      // Skip time-off days
      if (timeOffDates.has(dateStr)) continue;

      // Find matching availability windows
      const windows = avail.rows.filter(a =>
        (a.day_of_week === dow && !a.date) ||
        (a.date && a.date === dateStr)
      );

      for (const win of windows) {
        // Check if this slot overlaps with booked visits
        const isBooked = booked.rows.some(b =>
          b.scheduled_date === dateStr &&
          b.start_time < win.end_time && b.end_time > win.start_time
        );
        // Check if overlaps with other client schedules (recurring)
        const isOtherScheduled = otherSchedules.rows.some(os => {
          if (os.date === dateStr) return os.start_time < win.end_time && os.end_time > win.start_time;
          if (os.day_of_week === dow && !os.date) return os.start_time < win.end_time && os.end_time > win.start_time;
          return false;
        });

        if (!isBooked && !isOtherScheduled) {
          slots.push({
            date: dateStr,
            dayOfWeek: dow,
            startTime: win.start_time,
            endTime: win.end_time,
          });
        }
      }
    }

    res.json(slots);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// PORTAL: REQUEST RESCHEDULE
// POST /api/client-portal/portal/visits/reschedule-request
// ─────────────────────────────────────────────────────────────────────────────
router.post('/portal/visits/reschedule-request', clientAuth, async (req, res) => {
  const { proposedDate, proposedStartTime, proposedEndTime } = req.body;
  const vi = parseVisitIdentity(req.body);

  if (!vi.visitDate || !vi.caregiverId || !vi.startTime || !vi.endTime || !proposedDate || !proposedStartTime || !proposedEndTime) {
    return res.status(400).json({ error: 'Original visit info and proposedDate, proposedStartTime, proposedEndTime are required' });
  }

  try {
    let visitId = vi.visitId;
    if (vi.source === 'schedule' && vi.scheduleId) {
      visitId = await materializeVisit({
        scheduleId: vi.scheduleId, visitDate: vi.visitDate,
        clientId: req.clientId, caregiverId: vi.caregiverId,
        startTime: vi.startTime, endTime: vi.endTime,
      });
    }

    const result = await db.query(`
      INSERT INTO visit_change_requests
        (client_id, caregiver_id, request_type, visit_id, schedule_id,
         visit_date, original_start_time, original_end_time,
         proposed_date, proposed_start_time, proposed_end_time)
      VALUES ($1, $2, 'reschedule', $3, $4, $5, $6, $7, $8, $9, $10)
      RETURNING *
    `, [
      req.clientId, vi.caregiverId, visitId || null, vi.scheduleId || null,
      vi.visitDate, vi.startTime, vi.endTime,
      proposedDate, proposedStartTime, proposedEndTime
    ]);

    // Notify caregiver + all admins
    const client = await db.query('SELECT first_name, last_name FROM clients WHERE id = $1', [req.clientId]);
    const cn = client.rows[0];
    const reschedMsg = `${cn?.first_name} ${cn?.last_name} is requesting to reschedule their visit from ${vi.visitDate} to ${proposedDate} at ${proposedStartTime}.`;
    await db.query(
      'INSERT INTO notifications (user_id, type, title, message) VALUES ($1, $2, $3, $4)',
      [vi.caregiverId, 'visit_reschedule_request', 'Reschedule Request', reschedMsg]
    ).catch(() => {});
    await notifyAdmins('visit_reschedule_request', 'Client Reschedule Request', reschedMsg);

    res.status(201).json(result.rows[0]);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// PORTAL: GET MY CHANGE REQUESTS (pending/counter-offered)
// GET /api/client-portal/portal/change-requests
// ─────────────────────────────────────────────────────────────────────────────
router.get('/portal/change-requests', clientAuth, async (req, res) => {
  try {
    const result = await db.query(`
      SELECT vcr.*,
        u.first_name as caregiver_first_name,
        u.last_name  as caregiver_last_name
      FROM visit_change_requests vcr
      JOIN users u ON vcr.caregiver_id = u.id
      WHERE vcr.client_id = $1
        AND vcr.status IN ('pending', 'counter_offered')
      ORDER BY vcr.created_at DESC
    `, [req.clientId]);

    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// PORTAL: RESPOND TO COUNTER-OFFER
// PUT /api/client-portal/portal/change-requests/:id/respond
// Body: { accept: true|false }
// ─────────────────────────────────────────────────────────────────────────────
router.put('/portal/change-requests/:id/respond', clientAuth, async (req, res) => {
  const { accept } = req.body;

  try {
    const cr = await db.query(
      `SELECT * FROM visit_change_requests WHERE id = $1 AND client_id = $2 AND status = 'counter_offered'`,
      [req.params.id, req.clientId]
    );
    if (cr.rows.length === 0) return res.status(404).json({ error: 'Request not found or not counter-offered' });

    const request = cr.rows[0];
    const newStatus = accept ? 'counter_accepted' : 'counter_declined';

    await db.query(
      `UPDATE visit_change_requests SET status = $1, resolved_at = NOW(), updated_at = NOW() WHERE id = $2`,
      [newStatus, req.params.id]
    );

    // If accepted, apply the reschedule
    if (accept && request.visit_id) {
      await db.query(`
        UPDATE scheduled_visits
        SET scheduled_date = $1, start_time = $2, end_time = $3, status = 'scheduled', updated_at = NOW()
        WHERE id = $4
      `, [request.counter_date, request.counter_start_time, request.counter_end_time, request.visit_id]);

      // If from a recurring schedule, create exception for original date
      if (request.schedule_id) {
        await db.query(`
          INSERT INTO schedule_exceptions (schedule_id, exception_date, exception_type, created_by)
          VALUES ($1, $2, 'modified', $3)
          ON CONFLICT (schedule_id, exception_date) DO NOTHING
        `, [request.schedule_id, request.visit_date, request.caregiver_id]);
      }
    }

    // Notify caregiver + all admins
    const client = await db.query('SELECT first_name, last_name FROM clients WHERE id = $1', [req.clientId]);
    const cn = client.rows[0];
    const counterMsg = `${cn?.first_name} ${cn?.last_name} has ${accept ? 'accepted' : 'declined'} your suggested time.`;
    const counterType = accept ? 'counter_accepted' : 'counter_declined';
    const counterTitle = accept ? 'Counter-Offer Accepted' : 'Counter-Offer Declined';
    await db.query(
      'INSERT INTO notifications (user_id, type, title, message) VALUES ($1, $2, $3, $4)',
      [request.caregiver_id, counterType, counterTitle, counterMsg]
    ).catch(() => {});
    await notifyAdmins(counterType, counterTitle, counterMsg);

    res.json({ success: true, status: newStatus });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// ADMIN / CAREGIVER: MANAGE CHANGE REQUESTS
// ═══════════════════════════════════════════════════════════════════════════════

// ─────────────────────────────────────────────────────────────────────────────
// GET PENDING CHANGE REQUESTS
// GET /api/client-portal/admin/change-requests
// Query: ?status=pending&caregiverId=uuid
// ─────────────────────────────────────────────────────────────────────────────
router.get('/admin/change-requests', auth, async (req, res) => {
  const role = req.user.role;
  if (role !== 'admin' && role !== 'caregiver') {
    return res.status(403).json({ error: 'Access required' });
  }

  try {
    let query = `
      SELECT vcr.*,
        c.first_name as client_first_name, c.last_name as client_last_name,
        u.first_name as caregiver_first_name, u.last_name as caregiver_last_name
      FROM visit_change_requests vcr
      JOIN clients c ON vcr.client_id = c.id
      JOIN users u ON vcr.caregiver_id = u.id
      WHERE 1=1
    `;
    const params = [];

    // Caregivers only see their own
    if (role === 'caregiver') {
      params.push(req.user.id);
      query += ` AND vcr.caregiver_id = $${params.length}`;
    } else if (req.query.caregiverId) {
      params.push(req.query.caregiverId);
      query += ` AND vcr.caregiver_id = $${params.length}`;
    }

    if (req.query.status) {
      params.push(req.query.status);
      query += ` AND vcr.status = $${params.length}`;
    } else {
      query += ` AND vcr.status IN ('pending', 'counter_offered')`;
    }

    query += ` ORDER BY vcr.created_at DESC`;
    const result = await db.query(query, params);
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// RESOLVE CHANGE REQUEST (approve / deny / counter-offer)
// PUT /api/client-portal/admin/change-requests/:id/resolve
// Body: { action: 'approve'|'deny'|'counter', counterDate?, counterStartTime?,
//         counterEndTime?, counterMessage?, adminNotes? }
// ─────────────────────────────────────────────────────────────────────────────
router.put('/admin/change-requests/:id/resolve', auth, async (req, res) => {
  const role = req.user.role;
  if (role !== 'admin' && role !== 'caregiver') {
    return res.status(403).json({ error: 'Access required' });
  }

  const { action, counterDate, counterStartTime, counterEndTime, counterMessage, adminNotes } = req.body;
  if (!['approve', 'deny', 'counter'].includes(action)) {
    return res.status(400).json({ error: 'action must be approve, deny, or counter' });
  }

  try {
    // Fetch the request (caregivers can only resolve their own)
    let fetchQuery = 'SELECT * FROM visit_change_requests WHERE id = $1';
    const fetchParams = [req.params.id];
    if (role === 'caregiver') {
      fetchQuery += ' AND caregiver_id = $2';
      fetchParams.push(req.user.id);
    }

    const cr = await db.query(fetchQuery, fetchParams);
    if (cr.rows.length === 0) return res.status(404).json({ error: 'Request not found' });

    const request = cr.rows[0];

    if (action === 'approve') {
      // Approve cancellation
      if (request.request_type === 'cancel') {
        if (request.visit_id) {
          await db.query(`
            UPDATE scheduled_visits
            SET status = 'cancelled', cancelled_reason = $1, cancelled_by = $2, cancelled_at = NOW(), updated_at = NOW()
            WHERE id = $3
          `, [request.cancel_reason || 'Client requested', req.user.id, request.visit_id]);
        }
        if (request.schedule_id) {
          await db.query(`
            INSERT INTO schedule_exceptions (schedule_id, exception_date, exception_type, created_by)
            VALUES ($1, $2, 'cancelled', $3)
            ON CONFLICT (schedule_id, exception_date) DO NOTHING
          `, [request.schedule_id, request.visit_date, req.user.id]);
        }
      }

      // Approve reschedule
      if (request.request_type === 'reschedule' && request.visit_id) {
        await db.query(`
          UPDATE scheduled_visits
          SET scheduled_date = $1, start_time = $2, end_time = $3, status = 'scheduled', updated_at = NOW()
          WHERE id = $4
        `, [request.proposed_date, request.proposed_start_time, request.proposed_end_time, request.visit_id]);

        if (request.schedule_id) {
          await db.query(`
            INSERT INTO schedule_exceptions (schedule_id, exception_date, exception_type, created_by)
            VALUES ($1, $2, 'modified', $3)
            ON CONFLICT (schedule_id, exception_date) DO NOTHING
          `, [request.schedule_id, request.visit_date, req.user.id]);
        }
      }

      await db.query(`
        UPDATE visit_change_requests
        SET status = 'approved', resolved_at = NOW(), resolved_by = $1, admin_notes = $2, updated_at = NOW()
        WHERE id = $3
      `, [req.user.id, adminNotes || null, req.params.id]);

      // Notify client
      const typeLabel = request.request_type === 'cancel' ? 'Cancellation' : 'Reschedule';
      await db.query(`
        INSERT INTO client_notifications (client_id, type, title, message, related_visit_id)
        VALUES ($1, 'change_request_approved', $2, $3, $4)
      `, [
        request.client_id,
        `${typeLabel} Approved`,
        `Your ${typeLabel.toLowerCase()} request for ${request.visit_date} has been approved.`,
        request.visit_id
      ]);

    } else if (action === 'deny') {
      await db.query(`
        UPDATE visit_change_requests
        SET status = 'denied', resolved_at = NOW(), resolved_by = $1, admin_notes = $2, updated_at = NOW()
        WHERE id = $3
      `, [req.user.id, adminNotes || null, req.params.id]);

      const typeLabel = request.request_type === 'cancel' ? 'Cancellation' : 'Reschedule';
      await db.query(`
        INSERT INTO client_notifications (client_id, type, title, message, related_visit_id)
        VALUES ($1, 'change_request_denied', $2, $3, $4)
      `, [
        request.client_id,
        `${typeLabel} Not Approved`,
        `Your ${typeLabel.toLowerCase()} request for ${request.visit_date} was not approved.${adminNotes ? ' Note: ' + adminNotes : ''}`,
        request.visit_id
      ]);

    } else if (action === 'counter') {
      if (!counterDate || !counterStartTime || !counterEndTime) {
        return res.status(400).json({ error: 'counterDate, counterStartTime, counterEndTime required for counter-offer' });
      }

      await db.query(`
        UPDATE visit_change_requests
        SET status = 'counter_offered',
            counter_date = $1, counter_start_time = $2, counter_end_time = $3,
            counter_message = $4, admin_notes = $5, updated_at = NOW()
        WHERE id = $6
      `, [counterDate, counterStartTime, counterEndTime, counterMessage || null, adminNotes || null, req.params.id]);

      await db.query(`
        INSERT INTO client_notifications (client_id, type, title, message, related_visit_id)
        VALUES ($1, 'change_request_counter', 'Alternative Time Suggested', $2, $3)
      `, [
        request.client_id,
        `Your caregiver suggested ${counterDate} at ${counterStartTime} instead.${counterMessage ? ' "' + counterMessage + '"' : ''}`,
        request.visit_id
      ]);
    }

    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
