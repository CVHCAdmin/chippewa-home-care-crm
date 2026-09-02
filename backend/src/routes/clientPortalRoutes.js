// routes/clientPortalRoutes.js
// Client Patient Portal — allows clients to view their own visits, caregivers,
// invoices, and notifications. Separate auth from users/family tables.

const express = require('express');
const router  = express.Router();
const db      = require('../db');
const { SCHEDULE_OCCURRENCES_CTE } = require('../helpers/scheduleOccurrences');
const auth    = require('../middleware/auth');
const bcrypt  = require('bcryptjs');
const jwt     = require('jsonwebtoken');
const crypto  = require('crypto');
const rateLimit = require('express-rate-limit');
const { clientIp } = require('../helpers/clientIp');
const { sendClientPortalInvite, sendClientPortalPasswordReset } = require('../services/emailService');

// Rate limiter for the public forgot-password endpoint. keyGenerator: without it this keys
// on req.ip, which behind Render's proxy is the same for everyone — so 10 reset requests
// company-wide would lock the endpoint for all client-portal users at once.
const forgotLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: clientIp,
});

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
    req.portalEmail = decoded.accountEmail || null; // which relative (multi-account)

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

      // Target THIS account only — a client can have several relative accounts
      // and one person's typos must not lock the others out.
      await db.query(`
        UPDATE client_portal_accounts
        SET failed_login_count = $1, locked_until = $2, updated_at = NOW()
        WHERE id = $3
      `, [failCount, lockUntil, portal.id]);

      return res.status(401).json({ error: 'Invalid credentials' });
    }

    // Successful login — reset fail count, update last_login
    await db.query(`
      UPDATE client_portal_accounts
      SET failed_login_count = 0, locked_until = NULL, last_login = NOW(), updated_at = NOW()
      WHERE id = $1
    `, [portal.id]);

    // accountEmail identifies WHICH relative is logged in (audit + /portal/me);
    // clientId stays the authorization scope.
    const token = jwt.sign(
      { role: 'client', clientId: portal.client_id, accountEmail: portal.email },
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
      WHERE id = $2
    `, [passwordHash, result.rows[0].id]);

    res.json({ success: true, message: 'Password set. You can now log in.' });
  } catch (error) {
    console.error('[ClientPortal] set-password error:', error.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// PUBLIC: FORGOT PASSWORD (self-service)
// POST /api/client-portal/forgot-password
// Body: { email }
//
// Reuses the invite token + /portal/setup + /set-password flow with a 1-hour
// expiry. Always responds with the same message so account existence can't be
// probed.
// ─────────────────────────────────────────────────────────────────────────────
router.post('/forgot-password', forgotLimiter, async (req, res) => {
  const { email } = req.body;
  if (!email) return res.status(400).json({ error: 'Email is required' });

  const genericResponse = {
    success: true,
    message: 'If an account exists with that email, a password reset link has been sent. Please check your inbox.',
  };

  try {
    const result = await db.query(`
      SELECT cpa.id, cpa.client_id, cpa.email, c.first_name, c.last_name
      FROM client_portal_accounts cpa
      JOIN clients c ON cpa.client_id = c.id
      WHERE LOWER(cpa.email) = LOWER($1) AND cpa.portal_enabled = true AND c.is_active = true
    `, [email]);

    if (result.rows.length === 0) return res.json(genericResponse);

    const account = result.rows[0];
    const resetToken   = crypto.randomBytes(32).toString('hex');
    const resetExpires = new Date(Date.now() + 60 * 60 * 1000); // 1 hour

    await db.query(`
      UPDATE client_portal_accounts
      SET invite_token = $1, invite_expires_at = $2, updated_at = NOW()
      WHERE id = $3
    `, [resetToken, resetExpires, account.id]);

    const resetUrl = `${process.env.FRONTEND_URL || 'https://app.chippewavalleyhomecare.com'}/portal/setup?token=${resetToken}`;

    try {
      await sendClientPortalPasswordReset({
        to: account.email,
        clientName: `${account.first_name} ${account.last_name}`,
        resetUrl,
      });
    } catch (emailErr) {
      console.error('[ClientPortal] forgot-password email failed:', emailErr.message);
    }

    res.json(genericResponse);
  } catch (error) {
    console.error('[ClientPortal] forgot-password error:', error.message);
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
      LEFT JOIN client_portal_accounts cpa
        ON cpa.client_id = c.id AND ($2::text IS NULL OR LOWER(cpa.email) = LOWER($2))
      WHERE c.id = $1
      LIMIT 1
    `, [req.clientId, req.portalEmail]);

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

    // 2. Expand the client's schedule into concrete visits (4 weeks back / 4 weeks out).
    //
    // This was a hand-rolled loop with three bugs the family could see:
    //  - it collected EVERY exception key without reading `exception_type`, then skipped
    //    that date — so a RESCHEDULED ('modified') visit DISAPPEARED from the portal
    //    instead of moving to its new time. Families rang the office to ask why their
    //    visit had been cancelled when it hadn't.
    //  - it never checked effective_date/end_date, so a terminated pattern kept showing
    //    four weeks of phantom future visits.
    //  - it expanded bi-weekly patterns every week.
    //
    // The shared engine resolves all three, and resolves the caregiver through
    // override_caregiver_id so a covered visit shows who is ACTUALLY coming.
    const win = await db.query(
      `SELECT to_char(((NOW() AT TIME ZONE 'America/Chicago')::date - 28), 'YYYY-MM-DD') AS from_d,
              to_char(((NOW() AT TIME ZONE 'America/Chicago')::date + 28), 'YYYY-MM-DD') AS to_d,
              to_char((NOW() AT TIME ZONE 'America/Chicago')::date, 'YYYY-MM-DD')        AS today`
    );
    const { from_d, to_d, today: todayStr } = win.rows[0];

    const occResult = await db.query(`
      WITH ${SCHEDULE_OCCURRENCES_CTE('occ')}
      SELECT occ.schedule_id, occ.caregiver_id,
             to_char(occ.occ_date, 'YYYY-MM-DD') AS scheduled_date,
             occ.start_time::text AS start_time,
             occ.end_time::text   AS end_time,
             s.notes,
             u.first_name AS caregiver_first_name,
             u.last_name  AS caregiver_last_name,
             u.phone      AS caregiver_phone
      FROM occ
      JOIN schedules s ON s.id = occ.schedule_id
      JOIN users u     ON u.id = occ.caregiver_id
      WHERE occ.client_id = $3
        AND (s.status IS NULL OR s.status = 'active')
        AND ( ($4::boolean IS TRUE  AND occ.occ_date <  $5::date)
           OR ($4::boolean IS FALSE AND occ.occ_date >= $5::date) )
      ORDER BY occ.occ_date, occ.start_time
    `, [from_d, to_d, req.clientId, !!past, todayStr]);

    const expanded = occResult.rows.map(r => ({
      id: `${r.schedule_id}-${r.scheduled_date}`,
      scheduled_date: r.scheduled_date,
      start_time: r.start_time,
      end_time: r.end_time,
      status: 'scheduled',
      notes: r.notes,
      client_notes: null,
      cancelled_reason: null,
      caregiver_id: r.caregiver_id,
      schedule_id: r.schedule_id,
      caregiver_first_name: r.caregiver_first_name,
      caregiver_last_name: r.caregiver_last_name,
      caregiver_phone: r.caregiver_phone,
      source: 'schedule',
    }));

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
// PORTAL: GET A CAREGIVER'S BACKGROUND CHECK SUMMARY
// GET /api/client-portal/portal/caregivers/:caregiverId/background-checks
//
// Clients may only view checks for caregivers actively assigned or scheduled
// with them. Returns summary fields only — never findings, notes, cost,
// reference numbers, or identifiers.
// ─────────────────────────────────────────────────────────────────────────────
router.get('/portal/caregivers/:caregiverId/background-checks', clientAuth, async (req, res) => {
  const { caregiverId } = req.params;

  try {
    // Verify this caregiver actually serves this client (same sources as the
    // /portal/caregivers list: active assignments OR active schedules)
    const linked = await db.query(`
      SELECT 1 FROM client_assignments
      WHERE caregiver_id = $1 AND client_id = $2 AND status = 'active'
      UNION
      SELECT 1 FROM schedules
      WHERE caregiver_id = $1 AND client_id = $2 AND is_active = true
        AND (status IS NULL OR status = 'active')
      LIMIT 1
    `, [caregiverId, req.clientId]);

    if (linked.rows.length === 0) {
      return res.status(403).json({ error: 'This caregiver is not assigned to you' });
    }

    const result = await db.query(`
      SELECT id, check_type, provider, status, result,
             initiated_date, completed_date, expiration_date
      FROM background_checks
      WHERE caregiver_id = $1
      ORDER BY completed_date DESC NULLS LAST, initiated_date DESC NULLS LAST
    `, [caregiverId]);

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
        i.payment_due_date, i.payment_date, i.created_at,
        COALESCE((
          SELECT json_agg(json_build_object(
            'service_date', ili.service_date,
            'description', ili.description,
            'hours', ili.hours,
            'amount', ili.amount
          ) ORDER BY ili.service_date NULLS LAST, ili.created_at)
          FROM invoice_line_items ili
          WHERE ili.invoice_id = i.id
        ), '[]'::json) AS line_items
      FROM invoices i
      WHERE i.client_id = $1
        -- Drafts stay invisible until the admin sends or releases the invoice
        -- (v55). Invoices with a recorded payment always show — paid history
        -- must never disappear from the family's view.
        AND (i.sent_at IS NOT NULL OR i.payment_status IN ('paid', 'partial'))
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

  // Accepts either the legacy single { email } or { invitees: [{ email, name }] }.
  // Each email becomes its OWN portal account (one login per relative).
  const { clientId, email, name } = req.body;
  const invitees = Array.isArray(req.body.invitees) && req.body.invitees.length
    ? req.body.invitees
    : (email ? [{ email, name }] : []);
  if (!clientId || invitees.length === 0) {
    return res.status(400).json({ error: 'clientId and at least one email are required' });
  }
  const emailRe = /^\S+@\S+\.\S+$/;
  for (const inv of invitees) {
    if (!inv.email || !emailRe.test(String(inv.email).trim())) {
      return res.status(400).json({ error: `Invalid email address: ${inv.email || '(blank)'}` });
    }
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

    const clientName = `${client.rows[0].first_name} ${client.rows[0].last_name}`;
    const results = [];

    for (const inv of invitees) {
      const invEmail = String(inv.email).trim();
      const invName  = inv.name ? String(inv.name).trim() : null;

      // Same email can't belong to two different clients — email is the login key.
      const existing = await db.query(
        'SELECT client_id FROM client_portal_accounts WHERE LOWER(email) = LOWER($1)', [invEmail]);
      if (existing.rows.length && existing.rows[0].client_id !== clientId) {
        results.push({ email: invEmail, error: 'This email already has a portal account for a different client.' });
        continue;
      }

      // Fresh secure invite token (48hr expiry) per account. Re-inviting an
      // existing account regenerates its token (password reset / lost invite).
      const inviteToken   = crypto.randomBytes(32).toString('hex');
      const inviteExpires = new Date(Date.now() + 48 * 60 * 60 * 1000);

      await db.query(`
        INSERT INTO client_portal_accounts
          (client_id, email, display_name, invite_token, invite_expires_at, portal_enabled)
        VALUES ($1, $2, $3, $4, $5, false)
        ON CONFLICT (email) DO UPDATE SET
          display_name      = COALESCE($3, client_portal_accounts.display_name),
          invite_token      = $4,
          invite_expires_at = $5,
          updated_at        = NOW()
      `, [clientId, invEmail, invName, inviteToken, inviteExpires]);

      const inviteUrl = `${process.env.FRONTEND_URL || 'https://app.chippewavalleyhomecare.com'}/portal/setup?token=${inviteToken}`;

      // Send invite email. Any send error is caught so the invite record still
      // exists (admin can copy/paste the link), with the reason surfaced.
      let emailSent = false;
      let emailError = null;
      try {
        emailSent = await sendClientPortalInvite({ to: invEmail, clientName, inviteUrl });
      } catch (sgErr) {
        emailError = sgErr.message || 'Email send failed';
      }
      results.push({ email: invEmail, name: invName, inviteUrl, emailSent, emailError, expiresAt: inviteExpires });
    }

    const ok = results.filter(r => !r.error);
    const failed = results.filter(r => r.error);
    res.json({
      success:   ok.length > 0,
      results,
      // Back-compat fields for the single-invite shape
      inviteUrl: ok[0]?.inviteUrl || null,
      emailSent: ok.every(r => r.emailSent) && ok.length > 0,
      emailError: ok.find(r => r.emailError)?.emailError || null,
      message: [
        ok.length ? `Invites created for ${ok.map(r => r.email).join(', ')} (${clientName}).` : null,
        ok.some(r => !r.emailSent) ? 'Some emails could not be sent — share those links manually.' : null,
        failed.length ? `Skipped: ${failed.map(r => `${r.email} (${r.error})`).join('; ')}` : null,
      ].filter(Boolean).join(' '),
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// ADMIN: LIST PORTAL ACCOUNTS FOR A CLIENT (one row per relative)
// GET /api/client-portal/admin/clients/:clientId/accounts
// ─────────────────────────────────────────────────────────────────────────────
router.get('/admin/clients/:clientId/accounts', auth, async (req, res) => {
  if (req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Admin access required' });
  }
  try {
    const result = await db.query(`
      SELECT id, email, display_name, portal_enabled, last_login,
        CASE
          WHEN invite_token IS NOT NULL AND invite_expires_at > NOW() THEN 'invite_pending'
          WHEN invite_token IS NOT NULL AND invite_expires_at <= NOW() THEN 'invite_expired'
          WHEN portal_enabled = true THEN 'active'
          ELSE 'disabled'
        END AS status
      FROM client_portal_accounts
      WHERE client_id = $1
      ORDER BY created_at
    `, [req.params.clientId]);
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// ADMIN: REMOVE ONE PORTAL ACCOUNT (revoke a single relative's access)
// DELETE /api/client-portal/admin/accounts/:accountId
// ─────────────────────────────────────────────────────────────────────────────
router.delete('/admin/accounts/:accountId', auth, async (req, res) => {
  if (req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Admin access required' });
  }
  try {
    const result = await db.query(
      'DELETE FROM client_portal_accounts WHERE id = $1 RETURNING email', [req.params.accountId]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'Account not found' });
    res.json({ success: true, removed: result.rows[0].email });
  } catch (error) {
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
        agg.portal_enabled,
        agg.portal_email,
        agg.last_login,
        agg.invite_expires_at,
        agg.account_count,
        COALESCE(agg.portal_status, 'not_invited') as portal_status
      FROM clients c
      LEFT JOIN LATERAL (
        SELECT
          bool_or(cpa.portal_enabled)                          AS portal_enabled,
          string_agg(cpa.email, ', ' ORDER BY cpa.created_at)  AS portal_email,
          MAX(cpa.last_login)                                  AS last_login,
          MAX(cpa.invite_expires_at)                           AS invite_expires_at,
          COUNT(*)                                             AS account_count,
          CASE
            WHEN bool_or(cpa.portal_enabled) THEN 'active'
            WHEN bool_or(cpa.invite_token IS NOT NULL AND cpa.invite_expires_at > NOW()) THEN 'invite_pending'
            WHEN bool_or(cpa.invite_token IS NOT NULL AND cpa.invite_expires_at <= NOW()) THEN 'invite_expired'
            ELSE 'disabled'
          END AS portal_status
        FROM client_portal_accounts cpa
        WHERE cpa.client_id = c.id
        HAVING COUNT(*) > 0
      ) agg ON true
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

// Helper: a DATE column comes back from pg as a JS Date at local midnight, and
// String(thatDate) is "Wed Aug 20 2026 …" — slicing it gives "Wed Aug 20", not a
// date. Format the calendar day off the local parts (never toISOString, which
// shifts the day for anyone east of UTC).
const ymd = (d) => {
  if (!d) return null;
  if (d instanceof Date) {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }
  return String(d).slice(0, 10);
};

// Helper: a visit that has already been worked must not be moved.
//
// Moving one writes a 'cancelled' exception on the original date, which deletes
// that occurrence for the whole system — and payroll's matcher then finds a punch
// with no shift behind it. That punch falls into the "unscheduled clock-in"
// branch, which pays ACTUAL time with NO cap (payrollRoutes: "no schedule to cap"),
// so a missed clock-out on that day would pay out in full instead of being capped
// at the scheduled length. Billing expands the same occurrences, so the day could
// also drop out of an invoice. Fix the time entry instead — never the schedule.
async function workedVisitBlocker({ caregiverId, clientId, visitDate }) {
  const r = await db.query(`
    SELECT id FROM time_entries
     WHERE caregiver_id = $1 AND client_id = $2
       AND DATE(start_time AT TIME ZONE 'America/Chicago') = $3::date
     LIMIT 1`, [caregiverId, clientId, ymd(visitDate)]);
  if (r.rows.length === 0) return null;
  return `That visit was already worked — there is a time entry on ${ymd(visitDate)}. Moving it now would pull the punch out of payroll's cap and out of billing. Correct the time entry instead.`;
}

// Helper: make an approved reschedule real on the SCHEDULE, not just on
// scheduled_visits.
//
// This used to update scheduled_visits and insert a bare 'modified' exception
// with no override times. Nothing outside this file reads scheduled_visits, and
// the schedule engine resolves times as COALESCE(override, original) — so an
// approved reschedule left the shift sitting at its OLD time on its OLD day on
// the caregiver's phone, the Schedule Hub, payroll and billing, while the office
// believed it had been moved.
//
// Everything downstream expands schedules through helpers/scheduleOccurrences.js,
// so writing the move into `schedules` / `schedule_exceptions` is what makes it
// show up everywhere at once. Returns the schedule id the move landed on.
async function applyRescheduleToSchedule({ scheduleId, caregiverId, clientId, visitDate, newDate, newStart, newEnd, userId }) {
  const r = await db.query('SELECT * FROM schedules WHERE id = $1 AND is_active = true', [scheduleId]);
  if (r.rows.length === 0) return null;
  const s = r.rows[0];

  const origDay = ymd(visitDate);
  const newDay  = ymd(newDate);

  // A one-time row IS its own occurrence — no pattern to preserve, so move it in
  // place. (Recurring-ness is day_of_week IS NOT NULL, never schedule_type: rows
  // created as emergency coverage carry a date AND the default type 'recurring'.)
  if (s.day_of_week === null || s.day_of_week === undefined) {
    await db.query(
      'UPDATE schedules SET date = $1::date, start_time = $2, end_time = $3, updated_at = NOW() WHERE id = $4',
      [newDay, newStart, newEnd, scheduleId]
    );
    return scheduleId;
  }

  // Recurring, same day, new times: one 'modified' exception carrying the times.
  if (origDay === newDay) {
    await db.query(`
      INSERT INTO schedule_exceptions
        (schedule_id, exception_date, exception_type, override_start_time, override_end_time, created_by)
      VALUES ($1, $2::date, 'modified', $3, $4, $5)
      ON CONFLICT (schedule_id, exception_date) DO UPDATE
        SET exception_type       = 'modified',
            override_start_time  = EXCLUDED.override_start_time,
            override_end_time    = EXCLUDED.override_end_time
    `, [scheduleId, origDay, newStart, newEnd, userId]);
    return scheduleId;
  }

  // Recurring, moved to a different date. An exception is keyed to
  // (schedule_id, exception_date), so it can express "not that day" but never
  // "that day instead" — the move is a cancel on the old date plus a real
  // one-time shift on the new one.
  await db.query(`
    INSERT INTO schedule_exceptions (schedule_id, exception_date, exception_type, created_by)
    VALUES ($1, $2::date, 'cancelled', $3)
    ON CONFLICT (schedule_id, exception_date) DO UPDATE
      SET exception_type      = 'cancelled',
          override_start_time = NULL,
          override_end_time   = NULL
  `, [scheduleId, origDay, userId]);

  // Same duplicate guard the schedule POST uses: the v53 unique index only covers
  // recurring rows, so a retried approval could otherwise insert the moved shift
  // twice — and each occurrence bills.
  const dup = await db.query(`
    SELECT id FROM schedules
     WHERE is_active = true AND day_of_week IS NULL
       AND caregiver_id = $1 AND client_id = $2 AND date = $3::date
       AND start_time = $4 AND end_time = $5
     LIMIT 1
  `, [caregiverId, clientId, newDay, newStart, newEnd]);
  if (dup.rows.length > 0) return dup.rows[0].id;

  const ins = await db.query(`
    INSERT INTO schedules
      (caregiver_id, client_id, schedule_type, day_of_week, date, start_time, end_time, notes, is_training)
    VALUES ($1, $2, 'one-time', NULL, $3::date, $4, $5, $6, $7)
    RETURNING id
  `, [caregiverId, clientId, newDay, newStart, newEnd,
      `Rescheduled from ${origDay}`, s.is_training === true]);
  return ins.rows[0].id;
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

    // A client cancelling their own visit takes effect IMMEDIATELY — it used to
    // create a request that waited on office approval, and those sat unreviewed
    // (one from June was still 'pending' in September) while the caregiver's
    // schedule kept showing the visit. Auto-apply unless:
    //   - the visit was already worked (a punch exists — cancelling can't unwork
    //     it; that's a billing correction, not a schedule change), or
    //   - the date is in the past, or
    //   - we have nothing to write the cancellation onto.
    // Those rare cases fall back to the old pending-request flow for the office.
    const todayCt = (await db.query(
      `SELECT (now() AT TIME ZONE 'America/Chicago')::date::text AS d`)).rows[0].d;
    const worked = await workedVisitBlocker({
      caregiverId: vi.caregiverId, clientId: req.clientId, visitDate: vi.visitDate });
    const autoApply = !worked
      && String(vi.visitDate) >= todayCt
      && !!(vi.scheduleId || visitId);

    const result = await db.query(`
      INSERT INTO visit_change_requests
        (client_id, caregiver_id, request_type, visit_id, schedule_id,
         visit_date, original_start_time, original_end_time, cancel_reason,
         status, resolved_at, admin_notes)
      VALUES ($1, $2, 'cancel', $3, $4, $5, $6, $7, $8, $9, $10, $11)
      RETURNING *
    `, [
      req.clientId, vi.caregiverId, visitId || null, vi.scheduleId || null,
      vi.visitDate, vi.startTime, vi.endTime, reason || null,
      autoApply ? 'approved' : 'pending',
      autoApply ? new Date() : null,
      autoApply ? 'Auto-applied: cancelled by client via portal' : null,
    ]);

    if (autoApply) {
      // Same writes the admin approve path does — the schedule engine (caregiver
      // phone, Schedule Hub, payroll, billing) reads schedule_exceptions.
      if (visitId) {
        await db.query(`
          UPDATE scheduled_visits
          SET status = 'cancelled', cancelled_reason = $1, cancelled_at = NOW(), updated_at = NOW()
          WHERE id = $2 AND client_id = $3
        `, [reason || 'Cancelled by client via portal', visitId, req.clientId]);
      }
      if (vi.scheduleId) {
        await db.query(`
          INSERT INTO schedule_exceptions (schedule_id, exception_date, exception_type)
          VALUES ($1, $2, 'cancelled')
          ON CONFLICT (schedule_id, exception_date) DO NOTHING
        `, [vi.scheduleId, vi.visitDate]);
      }
    }

    // Notify caregiver + all admins
    const client = await db.query('SELECT first_name, last_name FROM clients WHERE id = $1', [req.clientId]);
    const cn = client.rows[0];
    const cancelMsg = autoApply
      ? `${cn?.first_name} ${cn?.last_name} cancelled their visit on ${vi.visitDate} at ${vi.startTime}.${reason ? ' Reason: ' + reason : ''} The shift has been removed from the schedule.`
      : `${cn?.first_name} ${cn?.last_name} is requesting to cancel their visit on ${vi.visitDate} at ${vi.startTime}.${reason ? ' Reason: ' + reason : ''}${worked ? ' (Not auto-applied: a time entry already exists for that day.)' : ''}`;
    await db.query(
      'INSERT INTO notifications (user_id, type, title, message) VALUES ($1, $2, $3, $4)',
      [vi.caregiverId, autoApply ? 'visit_cancelled' : 'visit_cancel_request',
       autoApply ? 'Visit Cancelled' : 'Cancellation Request', cancelMsg]
    ).catch(() => {});
    await notifyAdmins(autoApply ? 'visit_cancelled' : 'visit_cancel_request',
      autoApply ? 'Client Cancelled Visit' : 'Client Cancellation Request', cancelMsg);

    res.status(201).json({ ...result.rows[0], auto_applied: autoApply });
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
// CAREGIVER: REQUEST RESCHEDULE
// POST /api/client-portal/caregiver/reschedule-request
// Body: { scheduleId, visitDate, startTime, endTime,
//         proposedDate, proposedStartTime, proposedEndTime, reason? }
//
// The caregiver-side twin of the portal endpoint above. Caregivers could already
// hand a shift to a coworker (shift swaps) but had no way to say "same shift,
// different time" — so those moves happened by text message and never reached the
// schedule. This files a request; the office approves it in the Schedule Hub and
// applyRescheduleToSchedule() writes it into the schedule. Nothing moves on a
// caregiver's say-so alone: the visit is billed and EVV'd against that time.
// ─────────────────────────────────────────────────────────────────────────────
router.post('/caregiver/reschedule-request', auth, async (req, res) => {
  const role = req.user.role;
  if (role !== 'caregiver' && role !== 'admin') {
    return res.status(403).json({ error: 'Access required' });
  }

  const { scheduleId, visitDate, startTime, endTime,
          proposedDate, proposedStartTime, proposedEndTime, reason } = req.body;

  if (!scheduleId || !visitDate || !startTime || !endTime ||
      !proposedDate || !proposedStartTime || !proposedEndTime) {
    return res.status(400).json({
      error: 'scheduleId, visitDate, startTime, endTime, proposedDate, proposedStartTime and proposedEndTime are required'
    });
  }
  if (proposedDate === visitDate && proposedStartTime === startTime && proposedEndTime === endTime) {
    return res.status(400).json({ error: 'Pick a different day or time than the one already scheduled' });
  }

  try {
    // Resolve the occurrence through its exception, so a caregiver covering a
    // moved-in shift (override_caregiver_id) can ask to move it too — the
    // pattern's caregiver_id is somebody else on that date.
    const sr = await db.query(`
      SELECT s.id, s.caregiver_id AS pattern_caregiver_id, s.client_id AS pattern_client_id,
             COALESCE(se.override_caregiver_id, s.caregiver_id) AS caregiver_id,
             COALESCE(se.override_client_id,    s.client_id)    AS client_id,
             se.exception_type
        FROM schedules s
        LEFT JOIN schedule_exceptions se
          ON se.schedule_id = s.id AND se.exception_date = $2::date
       WHERE s.id = $1 AND s.is_active = true
    `, [scheduleId, visitDate]);

    if (sr.rows.length === 0) return res.status(404).json({ error: 'Shift not found' });
    const occ = sr.rows[0];

    if (occ.exception_type === 'cancelled') {
      return res.status(400).json({ error: 'That visit is already cancelled' });
    }
    if (role === 'caregiver' && occ.caregiver_id !== req.user.id) {
      return res.status(403).json({ error: 'You can only reschedule your own shifts' });
    }

    const worked = await workedVisitBlocker({
      caregiverId: occ.caregiver_id, clientId: occ.client_id, visitDate });
    if (worked) return res.status(409).json({ error: worked });

    // One open request per occurrence — otherwise two approvals move the same
    // shift twice and the second one lands on a date the first already vacated.
    const open = await db.query(`
      SELECT id FROM visit_change_requests
       WHERE schedule_id = $1 AND visit_date = $2::date
         AND request_type = 'reschedule'
         AND status IN ('pending', 'counter_offered')
       LIMIT 1
    `, [scheduleId, visitDate]);
    if (open.rows.length > 0) {
      return res.status(409).json({ error: 'A reschedule request for this visit is already waiting on the office' });
    }

    const result = await db.query(`
      INSERT INTO visit_change_requests
        (client_id, caregiver_id, request_type, schedule_id,
         visit_date, original_start_time, original_end_time,
         proposed_date, proposed_start_time, proposed_end_time,
         requested_by, request_reason)
      VALUES ($1, $2, 'reschedule', $3, $4::date, $5, $6, $7::date, $8, $9, $10, $11)
      RETURNING *
    `, [
      occ.client_id, occ.caregiver_id, scheduleId,
      visitDate, startTime, endTime,
      proposedDate, proposedStartTime, proposedEndTime,
      role === 'admin' ? 'admin' : 'caregiver', reason || null
    ]);

    const who = await db.query(
      `SELECT (SELECT first_name || ' ' || last_name FROM users   WHERE id = $1) AS caregiver,
              (SELECT first_name || ' ' || last_name FROM clients WHERE id = $2) AS client`,
      [occ.caregiver_id, occ.client_id]
    );
    const { caregiver, client } = who.rows[0] || {};
    const msg = `${caregiver} is asking to move the ${client} visit on ${visitDate} (${startTime}) to ${proposedDate} at ${proposedStartTime}.${reason ? ' Reason: ' + reason : ''}`;
    await notifyAdmins('caregiver_reschedule_request', 'Caregiver Reschedule Request', msg);

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

    // If accepted, apply the reschedule — same defect as the approve path: this
    // used to touch scheduled_visits and drop a bare 'modified' exception with no
    // override times, so an accepted counter-offer never reached the schedule.
    if (accept) {
      const worked = await workedVisitBlocker({
        caregiverId: request.caregiver_id, clientId: request.client_id, visitDate: request.visit_date });
      if (worked) return res.status(409).json({ error: worked });

      if (request.visit_id) {
        await db.query(`
          UPDATE scheduled_visits
          SET scheduled_date = $1, start_time = $2, end_time = $3, status = 'scheduled', updated_at = NOW()
          WHERE id = $4
        `, [request.counter_date, request.counter_start_time, request.counter_end_time, request.visit_id]);
      }

      if (request.schedule_id) {
        const appliedTo = await applyRescheduleToSchedule({
          scheduleId:  request.schedule_id,
          caregiverId: request.caregiver_id,
          clientId:    request.client_id,
          visitDate:   request.visit_date,
          newDate:     request.counter_date,
          newStart:    request.counter_start_time,
          newEnd:      request.counter_end_time,
          userId:      request.caregiver_id,
        });
        if (appliedTo) {
          await db.query(
            'UPDATE visit_change_requests SET applied_schedule_id = $1 WHERE id = $2',
            [appliedTo, req.params.id]
          );
        }
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

    // A caregiver may answer a request a CLIENT made about their visit, but must
    // never rubber-stamp their own — the office decides whether a shift moves.
    if (role === 'caregiver' && request.requested_by === 'caregiver') {
      return res.status(403).json({ error: 'The office has to approve a reschedule you requested' });
    }

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
      if (request.request_type === 'reschedule') {
        // Re-checked at approval, not just at request time: the visit may have
        // been worked in the days between asking and answering.
        const worked = await workedVisitBlocker({
          caregiverId: request.caregiver_id, clientId: request.client_id, visitDate: request.visit_date });
        if (worked) return res.status(409).json({ error: worked });

        if (request.visit_id) {
          await db.query(`
            UPDATE scheduled_visits
            SET scheduled_date = $1, start_time = $2, end_time = $3, status = 'scheduled', updated_at = NOW()
            WHERE id = $4
          `, [request.proposed_date, request.proposed_start_time, request.proposed_end_time, request.visit_id]);
        }

        // The part that actually moves the shift for the phone, the Hub, payroll
        // and billing. scheduled_visits above only feeds the client portal.
        if (request.schedule_id) {
          const appliedTo = await applyRescheduleToSchedule({
            scheduleId:  request.schedule_id,
            caregiverId: request.caregiver_id,
            clientId:    request.client_id,
            visitDate:   request.visit_date,
            newDate:     request.proposed_date,
            newStart:    request.proposed_start_time,
            newEnd:      request.proposed_end_time,
            userId:      req.user.id,
          });
          if (appliedTo) {
            await db.query(
              'UPDATE visit_change_requests SET applied_schedule_id = $1 WHERE id = $2',
              [appliedTo, req.params.id]
            );
          }
        }

        // Tell the caregiver too — for a caregiver-originated request this is the
        // answer they have been waiting on, and for a client-originated one their
        // day just changed.
        await db.query(
          "INSERT INTO notifications (user_id, type, title, message, status) VALUES ($1, $2, $3, $4, 'new')",
          [request.caregiver_id, 'visit_rescheduled', 'Shift Rescheduled',
           `Your visit on ${ymd(request.visit_date)} has been moved to ${ymd(request.proposed_date)} at ${request.proposed_start_time}.`]
        ).catch(() => {});
      }

      await db.query(`
        UPDATE visit_change_requests
        SET status = 'approved', resolved_at = NOW(), resolved_by = $1, admin_notes = $2, updated_at = NOW()
        WHERE id = $3
      `, [req.user.id, adminNotes || null, req.params.id]);

      // Notify client. "Your request was approved" is only true when the client
      // made the request — for a caregiver-initiated move the client is being
      // told their visit changed, which is a different sentence.
      const typeLabel = request.request_type === 'cancel' ? 'Cancellation' : 'Reschedule';
      const clientMsg = request.requested_by === 'client'
        ? `Your ${typeLabel.toLowerCase()} request for ${ymd(request.visit_date)} has been approved.`
        : `Your visit on ${ymd(request.visit_date)} has been moved to ${ymd(request.proposed_date)} at ${request.proposed_start_time}.`;
      await db.query(`
        INSERT INTO client_notifications (client_id, type, title, message, related_visit_id)
        VALUES ($1, 'change_request_approved', $2, $3, $4)
      `, [
        request.client_id,
        request.requested_by === 'client' ? `${typeLabel} Approved` : 'Visit Rescheduled',
        clientMsg,
        request.visit_id
      ]);

    } else if (action === 'deny') {
      await db.query(`
        UPDATE visit_change_requests
        SET status = 'denied', resolved_at = NOW(), resolved_by = $1, admin_notes = $2, updated_at = NOW()
        WHERE id = $3
      `, [req.user.id, adminNotes || null, req.params.id]);

      const typeLabel = request.request_type === 'cancel' ? 'Cancellation' : 'Reschedule';
      if (request.requested_by === 'client') {
        await db.query(`
          INSERT INTO client_notifications (client_id, type, title, message, related_visit_id)
          VALUES ($1, 'change_request_denied', $2, $3, $4)
        `, [
          request.client_id,
          `${typeLabel} Not Approved`,
          `Your ${typeLabel.toLowerCase()} request for ${ymd(request.visit_date)} was not approved.${adminNotes ? ' Note: ' + adminNotes : ''}`,
          request.visit_id
        ]);
      } else {
        // Caregiver asked, office said no — the client never knew, so telling them
        // a request of theirs was declined would be nonsense. Answer the caregiver.
        await db.query(
          "INSERT INTO notifications (user_id, type, title, message, status) VALUES ($1, $2, $3, $4, 'new')",
          [request.caregiver_id, 'reschedule_denied', 'Reschedule Not Approved',
           `Your request to move the ${ymd(request.visit_date)} visit was not approved.${adminNotes ? ' Note: ' + adminNotes : ''} The shift stays as scheduled.`]
        ).catch(() => {});
      }

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

      // The counter goes back to whoever asked. Only the client portal can accept
      // one (PUT /portal/change-requests/:id/respond), so a counter on a
      // caregiver's request is the office proposing a time — send it to them and
      // leave the client out of a conversation they were never in.
      if (request.requested_by === 'client') {
        await db.query(`
          INSERT INTO client_notifications (client_id, type, title, message, related_visit_id)
          VALUES ($1, 'change_request_counter', 'Alternative Time Suggested', $2, $3)
        `, [
          request.client_id,
          `Your caregiver suggested ${counterDate} at ${counterStartTime} instead.${counterMessage ? ' "' + counterMessage + '"' : ''}`,
          request.visit_id
        ]);
      } else {
        await db.query(
          "INSERT INTO notifications (user_id, type, title, message, status) VALUES ($1, $2, $3, $4, 'new')",
          [request.caregiver_id, 'change_request_counter', 'Alternative Time Suggested',
           `The office suggested ${counterDate} at ${counterStartTime} instead.${counterMessage ? ' "' + counterMessage + '"' : ''} Talk to the office to confirm.`]
        ).catch(() => {});
      }
    }

    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
