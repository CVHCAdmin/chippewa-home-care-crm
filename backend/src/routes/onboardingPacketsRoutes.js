// routes/onboardingPacketsRoutes.js
// Post-hire onboarding packet with tokenized public access.
// Public routes (no auth): GET /public/:token, PUT /public/:token, POST /public/:token/submit
// Admin routes (token auth): everything else. Token auth is applied at mount time
// in server.js using a path-based middleware, NOT a blanket verifyToken, so we
// can keep /public/* unauthenticated.
//
// Mount:
//   app.use('/api/onboarding-packets', (req, res, next) => {
//     if (req.path.startsWith('/public')) return next();
//     return verifyToken(req, res, next);
//   }, require('./routes/onboardingPacketsRoutes'));

const express = require('express');
const crypto = require('crypto');
const rateLimit = require('express-rate-limit');
const router = express.Router();
const db = require('../db');
const { encrypt, normalizeSSN, validateSSN } = require('../services/encryptionService');
const { submitBackgroundCheck } = require('../services/worcsService');
const { sendOnboardingPacketInvite } = require('../services/emailService');

// Current BGC consent version — bump when the disclosure text changes.
const BGC_CONSENT_VERSION = '2026-04-v1';
const BGC_CONSENT_TEXT = `
BACKGROUND CHECK DISCLOSURE AND AUTHORIZATION (Wisconsin Caregiver)

In connection with my application or continued engagement with Chippewa Valley
Home Care LLC ("CVHC"), I understand that CVHC will request a consumer report
and/or investigative consumer report about me in accordance with the federal
Fair Credit Reporting Act (15 U.S.C. § 1681 et seq.) and applicable Wisconsin
law including the Wisconsin Caregiver Law (Wis. Stat. §§ 50.065 and 48.685).

The report may include information from the Wisconsin Department of Justice
Online Record Check System (WORCS), the Wisconsin Caregiver Program Misconduct
Registry, the Nurse Aide Registry, the federal OIG exclusion list, and the
sex-offender registry. The information may concern my character, general
reputation, criminal history, driving record, professional licensure,
education, and employment.

I hereby authorize CVHC and its authorized agents to obtain such reports. I
understand I have the right, upon written request within a reasonable time,
to request disclosure of the nature and scope of any investigative consumer
report. I understand that if adverse action is taken against me wholly or
partly on the basis of the report, I will receive a copy of the report and a
summary of my rights under the FCRA before final action is taken.

By signing below I certify that all information I have provided in this
packet is true and complete.
`.trim();

// Rate limiter for unauthenticated public access
const publicLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
});

const newToken = () => crypto.randomBytes(48).toString('hex'); // 96 chars
const clientIp = (req) => (req.headers['x-forwarded-for'] || req.ip || '').split(',')[0].trim();
const logEvent = async (packetId, eventType, req, metadata = null) => {
  try {
    await db.query(
      `INSERT INTO onboarding_packet_events (packet_id, event_type, ip_address, user_agent, metadata)
       VALUES ($1, $2, $3, $4, $5)`,
      [packetId, eventType, clientIp(req), req.headers['user-agent'] || null, metadata ? JSON.stringify(metadata) : null]
    );
  } catch (err) {
    console.error('[onboarding] event log error:', err.message);
  }
};

// ═══════════════════════════════════════════════════════════════════════════
// PUBLIC ENDPOINTS — tokenized access only
// ═══════════════════════════════════════════════════════════════════════════

// GET /api/onboarding-packets/public/:token — load packet state for the new hire.
router.get('/public/:token', publicLimiter, async (req, res) => {
  try {
    const r = await db.query(
      `SELECT op.*, u.first_name, u.last_name, u.email
         FROM onboarding_packets op
         JOIN users u ON u.id = op.caregiver_id
        WHERE op.token = $1`,
      [req.params.token]
    );
    if (!r.rows.length) return res.status(404).json({ error: 'Packet not found or already processed.' });

    const packet = r.rows[0];
    if (new Date(packet.expires_at) < new Date()) {
      if (packet.status !== 'submitted') {
        await db.query(`UPDATE onboarding_packets SET status='expired' WHERE id=$1 AND status <> 'submitted'`, [packet.id]);
      }
      return res.status(410).json({ error: 'This link has expired. Please contact the office for a new one.' });
    }

    // Mark as opened the first time (but don't overwrite later statuses)
    if (packet.status === 'sent') {
      await db.query(`UPDATE onboarding_packets SET status='opened', opened_at = NOW() WHERE id=$1`, [packet.id]);
      await logEvent(packet.id, 'opened', req);
    }

    // Return only what the packet page needs — never the ssn_transient_encrypted.
    res.json({
      id: packet.id,
      status: packet.status,
      firstName: packet.first_name,
      lastName:  packet.last_name,
      email:     packet.email,
      expiresAt: packet.expires_at,
      preferredName:  packet.preferred_name,
      legalFirstName: packet.legal_first_name,
      legalMiddleName: packet.legal_middle_name,
      legalLastName:  packet.legal_last_name,
      pronouns:       packet.pronouns,
      address:        packet.address,
      city:           packet.city,
      state:          packet.state,
      zip:            packet.zip,
      dateOfBirth:    packet.date_of_birth,
      driversLicenseNumber: packet.drivers_license_number,
      driversLicenseState:  packet.drivers_license_state,
      emergencyContactName:         packet.emergency_contact_name,
      emergencyContactRelationship: packet.emergency_contact_relationship,
      emergencyContactPhone:        packet.emergency_contact_phone,
      emergencyContactEmail:        packet.emergency_contact_email,
      bgcConsentSignedAt: packet.bgc_consent_signed_at,
      bgcConsentVersion:  BGC_CONSENT_VERSION,
      bgcDisclosureText:  BGC_CONSENT_TEXT,
      submittedAt: packet.submitted_at,
    });
  } catch (err) {
    console.error('[onboarding] public GET error:', err.message);
    res.status(500).json({ error: 'Unable to load packet.' });
  }
});

// PUT /api/onboarding-packets/public/:token — save draft (no SSN/consent yet)
router.put('/public/:token', publicLimiter, async (req, res) => {
  const { token } = req.params;
  const {
    preferredName, legalFirstName, legalMiddleName, legalLastName, pronouns,
    address, city, state, zip, dateOfBirth,
    driversLicenseNumber, driversLicenseState,
    emergencyContactName, emergencyContactRelationship,
    emergencyContactPhone, emergencyContactEmail,
  } = req.body;

  try {
    const r = await db.query(
      `SELECT id, status, expires_at FROM onboarding_packets WHERE token = $1`, [token]
    );
    if (!r.rows.length) return res.status(404).json({ error: 'Packet not found.' });
    const p = r.rows[0];
    if (new Date(p.expires_at) < new Date()) return res.status(410).json({ error: 'This link has expired.' });
    if (p.status === 'submitted') return res.status(409).json({ error: 'This packet has already been submitted.' });

    await db.query(`
      UPDATE onboarding_packets SET
        preferred_name = $2,
        legal_first_name = $3,
        legal_middle_name = $4,
        legal_last_name = $5,
        pronouns = $6,
        address = $7,
        city = $8,
        state = $9,
        zip = $10,
        date_of_birth = $11,
        drivers_license_number = $12,
        drivers_license_state  = $13,
        emergency_contact_name         = $14,
        emergency_contact_relationship = $15,
        emergency_contact_phone        = $16,
        emergency_contact_email        = $17,
        status = CASE WHEN status = 'opened' THEN 'in_progress' ELSE status END,
        updated_at = NOW()
      WHERE id = $1
    `, [
      p.id,
      preferredName || null, legalFirstName || null, legalMiddleName || null, legalLastName || null, pronouns || null,
      address || null, city || null, state || null, zip || null, dateOfBirth || null,
      driversLicenseNumber || null, driversLicenseState || null,
      emergencyContactName || null, emergencyContactRelationship || null,
      emergencyContactPhone || null, emergencyContactEmail || null,
    ]);

    await logEvent(p.id, 'saved_draft', req);
    res.json({ success: true });
  } catch (err) {
    console.error('[onboarding] public PUT error:', err.message);
    res.status(500).json({ error: 'Save failed.' });
  }
});

// POST /api/onboarding-packets/public/:token/submit — final submit with consent + SSN
router.post('/public/:token/submit', publicLimiter, async (req, res) => {
  const {
    preferredName, legalFirstName, legalMiddleName, legalLastName, pronouns,
    address, city, state, zip, dateOfBirth,
    driversLicenseNumber, driversLicenseState,
    emergencyContactName, emergencyContactRelationship, emergencyContactPhone, emergencyContactEmail,
    bgcConsentSignature, ssn,
  } = req.body;

  if (!bgcConsentSignature || !bgcConsentSignature.trim()) {
    return res.status(400).json({ error: 'Electronic signature is required to consent to the background check.' });
  }
  if (!dateOfBirth) {
    return res.status(400).json({ error: 'Date of birth is required to run the background check.' });
  }
  if (!validateSSN(ssn)) {
    return res.status(400).json({ error: 'A valid 9-digit Social Security Number is required.' });
  }
  if (!legalFirstName || !legalLastName) {
    return res.status(400).json({ error: 'Legal first and last name are required.' });
  }

  try {
    const r = await db.query(
      `SELECT op.*, u.first_name AS user_first, u.last_name AS user_last
         FROM onboarding_packets op JOIN users u ON u.id = op.caregiver_id
        WHERE op.token = $1`,
      [req.params.token]
    );
    if (!r.rows.length) return res.status(404).json({ error: 'Packet not found.' });
    const p = r.rows[0];
    if (new Date(p.expires_at) < new Date()) return res.status(410).json({ error: 'This link has expired.' });
    if (p.status === 'submitted') return res.status(409).json({ error: 'This packet has already been submitted.' });

    const normalizedSsn = normalizeSSN(ssn);
    const encryptedSsn  = encrypt(normalizedSsn);

    await db.query(`
      UPDATE onboarding_packets SET
        preferred_name = $2, legal_first_name = $3, legal_middle_name = $4, legal_last_name = $5, pronouns = $6,
        address = $7, city = $8, state = $9, zip = $10, date_of_birth = $11,
        drivers_license_number = $12, drivers_license_state = $13,
        emergency_contact_name = $14, emergency_contact_relationship = $15,
        emergency_contact_phone = $16, emergency_contact_email = $17,
        bgc_consent_signed_at = NOW(),
        bgc_consent_signature = $18,
        bgc_consent_ip = $19,
        bgc_consent_user_agent = $20,
        bgc_consent_version = $21,
        bgc_consent_disclosure_text = $22,
        ssn_transient_encrypted = $23,
        status = 'submitted',
        submitted_at = NOW(),
        updated_at = NOW()
      WHERE id = $1
    `, [
      p.id,
      preferredName || null, legalFirstName.trim(), legalMiddleName || null, legalLastName.trim(), pronouns || null,
      address || null, city || null, state || null, zip || null, dateOfBirth,
      driversLicenseNumber || null, driversLicenseState || null,
      emergencyContactName || null, emergencyContactRelationship || null,
      emergencyContactPhone || null, emergencyContactEmail || null,
      bgcConsentSignature.trim(), clientIp(req), req.headers['user-agent'] || null,
      BGC_CONSENT_VERSION, BGC_CONSENT_TEXT, encryptedSsn,
    ]);

    await logEvent(p.id, 'consent_signed', req, { consent_version: BGC_CONSENT_VERSION });
    await logEvent(p.id, 'submitted', req);

    // ── Fire-and-forget: kick off WORCS and (later) eligibility. Never block
    // the response on external-service health; the scheduled poll will catch
    // up if anything fails here.
    (async () => {
      try {
        const worcsResult = await submitBackgroundCheck({
          firstName: legalFirstName.trim(),
          lastName:  legalLastName.trim(),
          dateOfBirth,
          ssn: normalizedSsn,
          requestPurpose: 'Caregiver-General',
        });

        // Create a background_checks row tied to this caregiver
        await db.query(`
          INSERT INTO background_checks (caregiver_id, check_type, provider, status, initiated_date, reference_number, notes)
          VALUES ($1, 'worcs', 'WI DOJ WORCS', $2, CURRENT_DATE, $3, $4)
        `, [
          p.caregiver_id,
          worcsResult.mock ? 'pending' : (worcsResult.status || 'pending'),
          worcsResult.referenceNumber || null,
          worcsResult.mock ? 'Mock submission — WORCS credentials not configured in this environment.' : 'Submitted automatically after caregiver signed BGC consent.',
        ]);

        await logEvent(p.id, 'bgc_requested', req, {
          reference_number: worcsResult.referenceNumber, mock: !!worcsResult.mock,
        });

        // Scrub the transient SSN — WORCS has it now; we don't need it.
        await db.query(
          `UPDATE onboarding_packets SET ssn_transient_encrypted = NULL WHERE id = $1`,
          [p.id]
        );
      } catch (err) {
        console.error('[onboarding] WORCS submission failed (will retry via admin action):', err.message);
        // Don't scrub the SSN — the admin can retry from the packet view.
      }
    })();

    res.json({ success: true, message: 'Thank you — your onboarding packet has been submitted.' });
  } catch (err) {
    console.error('[onboarding] submit error:', err.message);
    res.status(500).json({ error: 'Submission failed. Please try again or contact the office.' });
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// ADMIN ENDPOINTS (token-authenticated at mount point)
// ═══════════════════════════════════════════════════════════════════════════

// GET /api/onboarding-packets — list all packets
router.get('/', async (req, res) => {
  const { status } = req.query;
  try {
    const params = [];
    let where = '1=1';
    if (status) { params.push(status); where += ` AND op.status = $${params.length}`; }
    const r = await db.query(`
      SELECT op.id, op.status, op.expires_at, op.opened_at,
             op.submitted_at, op.bgc_consent_signed_at,
             op.preferred_name, op.legal_first_name, op.legal_last_name,
             op.created_at, op.updated_at,
             u.id AS caregiver_id, u.first_name, u.last_name, u.email,
             u.gusto_employee_id, u.gusto_synced_at
        FROM onboarding_packets op
        JOIN users u ON u.id = op.caregiver_id
       WHERE ${where}
       ORDER BY op.created_at DESC
    `, params);
    res.json(r.rows);
  } catch (err) {
    console.error('[onboarding] list error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/onboarding-packets/:id — full detail for admin review
router.get('/:id', async (req, res) => {
  try {
    const r = await db.query(`
      SELECT op.*, u.first_name, u.last_name, u.email, u.phone,
             u.gusto_employee_id, u.gusto_synced_at
        FROM onboarding_packets op
        JOIN users u ON u.id = op.caregiver_id
       WHERE op.id = $1
    `, [req.params.id]);
    if (!r.rows.length) return res.status(404).json({ error: 'Not found' });

    const events = await db.query(
      `SELECT * FROM onboarding_packet_events WHERE packet_id = $1 ORDER BY created_at DESC`,
      [req.params.id]
    );

    // Never return the encrypted SSN — that's WORCS-bound, not admin-visible.
    const { ssn_transient_encrypted, ...safe } = r.rows[0];
    res.json({ ...safe, events: events.rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/onboarding-packets/:id/resend — regenerate token + email
router.post('/:id/resend', async (req, res) => {
  try {
    const r = await db.query(
      `SELECT op.*, u.email, u.first_name, u.last_name
         FROM onboarding_packets op JOIN users u ON u.id = op.caregiver_id
        WHERE op.id = $1`, [req.params.id]
    );
    if (!r.rows.length) return res.status(404).json({ error: 'Not found' });
    const p = r.rows[0];
    if (p.status === 'submitted') return res.status(409).json({ error: 'Already submitted' });

    const token = newToken();
    const expiresAt = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000);
    await db.query(
      `UPDATE onboarding_packets
          SET token = $1, expires_at = $2, status = 'sent', updated_at = NOW()
        WHERE id = $3`,
      [token, expiresAt, p.id]
    );
    await logEvent(p.id, 'resent', req);

    // Fire email (best effort)
    sendOnboardingPacketInvite({
      to: p.email,
      firstName: p.first_name,
      packetUrl: `${process.env.FRONTEND_URL || 'https://app.chippewavalleyhomecare.com'}/onboarding/${token}`,
      expiresAt,
    }).catch(err => console.error('[onboarding resend] email error:', err.message));

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/onboarding-packets/:id/mark-gusto-synced — Alexis clicks after
// copying caregiver into Gusto manually.
router.post('/:id/mark-gusto-synced', async (req, res) => {
  const { gustoEmployeeId } = req.body;
  try {
    const r = await db.query(
      `SELECT caregiver_id FROM onboarding_packets WHERE id = $1`, [req.params.id]
    );
    if (!r.rows.length) return res.status(404).json({ error: 'Not found' });

    await db.query(
      `UPDATE users SET gusto_employee_id = $1, gusto_synced_at = NOW(), gusto_synced_by = $2 WHERE id = $3`,
      [gustoEmployeeId || null, req.user?.id || null, r.rows[0].caregiver_id]
    );
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/onboarding-packets/:id/gusto-export.csv — official Gusto bulk-
// import template prefilled for this caregiver. Matches Gusto's public
// import spec (headers only — Alexis uploads in her Gusto admin console).
router.get('/:id/gusto-export.csv', async (req, res) => {
  try {
    const r = await db.query(`
      SELECT op.*, u.first_name, u.last_name, u.email, u.phone, u.hourly_rate, u.default_pay_rate, u.hire_date
        FROM onboarding_packets op JOIN users u ON u.id = op.caregiver_id
       WHERE op.id = $1
    `, [req.params.id]);
    if (!r.rows.length) return res.status(404).json({ error: 'Not found' });
    const p = r.rows[0];

    const fld = (v) => {
      if (v === null || v === undefined) return '';
      const s = String(v);
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };

    const headers = [
      'First Name','Middle Initial','Last Name','Email','Phone',
      'Street 1','City','State','Zip',
      'Date of Birth','Work Start Date','Employment Type',
      'Pay Type','Pay Rate','Compensation Currency',
    ];
    const row = [
      p.legal_first_name || p.first_name,
      (p.legal_middle_name || '').slice(0, 1),
      p.legal_last_name || p.last_name,
      p.email,
      p.phone,
      p.address,
      p.city,
      p.state,
      p.zip,
      p.date_of_birth,
      p.hire_date,
      'Employee',                 // Gusto default; Alexis can change in Gusto UI
      'Hourly',
      (p.hourly_rate ?? p.default_pay_rate ?? ''),
      'USD',
    ];

    const csv = headers.map(fld).join(',') + '\n' + row.map(fld).join(',') + '\n';
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="gusto-import-${(p.legal_last_name || p.last_name || 'caregiver').toLowerCase()}.csv"`);
    res.send(csv);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
