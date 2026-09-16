// routes/backgroundChecksRoutes.js
// Background Check Tracking

const express = require('express');
const router = express.Router();
const db = require('../db');
const auth = require('../middleware/auth');
const { requireAdmin } = require('../middleware/auth');
const { auditLog } = require('../middleware/shared');
const { ATTACHMENT_ALLOWED_MIME, ATTACHMENT_MAX_DATA_URI_LENGTH } = require('../helpers/incidentOptions');
const { runEligibilityForCaregiver } = require('../services/eligibilityEngine');
const { runPollCycle } = require('../jobs/worcsPoll');

// Get all background checks (with optional filters)
router.get('/', auth, async (req, res) => {
  const { status, type, caregiverId } = req.query;
  try {
    let query = `
      SELECT bc.*,
        u.first_name as caregiver_first, u.last_name as caregiver_last,
        (SELECT COUNT(*)::int FROM background_check_documents d WHERE d.background_check_id = bc.id) AS document_count
      FROM background_checks bc
      JOIN users u ON bc.caregiver_id = u.id
      WHERE 1=1
    `;
    const params = [];

    if (status) {
      params.push(status);
      query += ` AND bc.status = $${params.length}`;
    }
    if (type) {
      params.push(type);
      query += ` AND bc.check_type = $${params.length}`;
    }
    if (caregiverId) {
      params.push(caregiverId);
      query += ` AND bc.caregiver_id = $${params.length}`;
    }

    query += ` ORDER BY bc.created_at DESC`;

    const result = await db.query(query, params);
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get background checks for a specific caregiver
router.get('/caregiver/:caregiverId', auth, async (req, res) => {
  try {
    const result = await db.query(`
      SELECT * FROM background_checks
      WHERE caregiver_id = $1
      ORDER BY created_at DESC
    `, [req.params.caregiverId]);
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Add background check
router.post('/', auth, async (req, res) => {
  const { caregiverId, checkType, provider, cost, notes } = req.body;
  try {
    const result = await db.query(`
      INSERT INTO background_checks (caregiver_id, check_type, provider, cost, status, initiated_date, notes, created_by)
      VALUES ($1, $2, $3, $4, 'pending', CURRENT_DATE, $5, $6)
      RETURNING *
    `, [caregiverId, checkType, provider, cost || null, notes, req.user.id]);
    res.json(result.rows[0]);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Update background check
router.put('/:id', auth, async (req, res) => {
  const { status, result, completedDate, expirationDate, referenceNumber, findings, notes } = req.body;
  try {
    const dbResult = await db.query(`
      UPDATE background_checks SET
        status = COALESCE($1, status),
        result = COALESCE($2, result),
        completed_date = COALESCE($3, completed_date),
        expiration_date = COALESCE($4, expiration_date),
        reference_number = COALESCE($5, reference_number),
        findings = COALESCE($6, findings),
        notes = COALESCE($7, notes),
        updated_at = NOW()
      WHERE id = $8
      RETURNING *
    `, [status, result, completedDate, expirationDate, referenceNumber, findings, notes, req.params.id]);
    res.json(dbResult.rows[0]);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Delete background check
router.delete('/:id', auth, async (req, res) => {
  try {
    await db.query('DELETE FROM background_checks WHERE id = $1', [req.params.id]);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get expiring background checks
router.get('/reports/expiring', auth, async (req, res) => {
  const { days = 30 } = req.query;
  try {
    const result = await db.query(`
      SELECT bc.*, u.first_name, u.last_name, u.phone, u.email
      FROM background_checks bc
      JOIN users u ON bc.caregiver_id = u.id
      WHERE bc.expiration_date IS NOT NULL
      AND bc.expiration_date <= CURRENT_DATE + $1::integer
      AND bc.status = 'completed'
      AND bc.result = 'clear'
      ORDER BY bc.expiration_date ASC
    `, [days]);
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get caregivers with missing/failed checks
router.get('/reports/compliance', auth, async (req, res) => {
  try {
    const result = await db.query(`
      SELECT u.id, u.first_name, u.last_name,
        ARRAY_AGG(DISTINCT bc.check_type) FILTER (WHERE bc.status = 'completed' AND bc.result = 'clear' AND (bc.expiration_date IS NULL OR bc.expiration_date > CURRENT_DATE)) as passed_checks,
        ARRAY_AGG(DISTINCT bc.check_type) FILTER (WHERE bc.result = 'disqualifying') as failed_checks,
        ARRAY_AGG(DISTINCT bc.check_type) FILTER (WHERE bc.status = 'pending' OR bc.status = 'in_progress') as pending_checks
      FROM users u
      LEFT JOIN background_checks bc ON bc.caregiver_id = u.id
      WHERE u.role = 'caregiver' AND u.is_active = true
      GROUP BY u.id, u.first_name, u.last_name
      ORDER BY u.last_name
    `);
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ── GET /api/background-checks/caregiver/:caregiverId/eligibility ──────
// Runs the Wisconsin caregiver eligibility engine against the most recent
// WORCS background check for this caregiver. Does NOT persist a decision —
// the admin is the legal decision-maker.
router.get('/caregiver/:caregiverId/eligibility', auth, async (req, res) => {
  try {
    const result = await runEligibilityForCaregiver(req.params.caregiverId);
    res.json(result);
  } catch (err) {
    console.error('[bgc] eligibility error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/background-checks/poll-now ───────────────────────────────
// Manual "poll WORCS now" trigger — bypasses the 30-minute cron for admins
// who want results faster. Returns poll-cycle summary.
router.post('/poll-now', auth, async (req, res) => {
  try {
    const summary = await runPollCycle();
    res.json({ success: true, ...summary });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Documents (the DOJ / DHS / BID result letters) ─────────────────────────────
// Stored in the database as data URIs (migration v67), like incident attachments.
// Admin only: these letters carry personal identifying information.
const parseDataUri = (uri) => {
  const m = /^data:([a-z0-9.+\/-]+);base64,([A-Za-z0-9+/=\r\n]+)$/i.exec(String(uri || ''));
  return m ? { mime: m[1].toLowerCase(), base64: m[2] } : null;
};
const safeFileName = (name) => String(name || 'file').replace(/[^A-Za-z0-9._ -]/g, '_').slice(0, 200) || 'file';

router.get('/:id/documents', auth, requireAdmin, async (req, res) => {
  try {
    const r = await db.query(`
      SELECT d.id, d.file_name, d.mime_type, d.file_size, d.created_at,
             u.first_name AS uploaded_by_first, u.last_name AS uploaded_by_last
        FROM background_check_documents d
        LEFT JOIN users u ON u.id = d.uploaded_by
       WHERE d.background_check_id = $1
       ORDER BY d.created_at`, [req.params.id]);
    res.json(r.rows);
  } catch (error) { res.status(500).json({ error: error.message }); }
});

router.get('/:id/documents/:docId', auth, requireAdmin, async (req, res) => {
  try {
    const r = await db.query(
      `SELECT file_name, mime_type, file_data FROM background_check_documents WHERE id = $1 AND background_check_id = $2`,
      [req.params.docId, req.params.id]);
    if (r.rows.length === 0) return res.status(404).json({ error: 'Document not found' });
    const parsed = parseDataUri(r.rows[0].file_data);
    if (!parsed) return res.status(500).json({ error: 'Stored file is unreadable' });
    res.setHeader('Content-Type', r.rows[0].mime_type);
    res.setHeader('Content-Disposition', `inline; filename="${safeFileName(r.rows[0].file_name)}"`);
    res.send(Buffer.from(parsed.base64, 'base64'));
  } catch (error) { res.status(500).json({ error: error.message }); }
});

router.post('/:id/documents', auth, requireAdmin, async (req, res) => {
  try {
    const { fileName, dataUri } = req.body || {};
    if (!fileName || !String(fileName).trim()) return res.status(400).json({ error: 'File name is required' });
    const parsed = parseDataUri(dataUri);
    if (!parsed) return res.status(400).json({ error: 'The file could not be read' });
    if (!ATTACHMENT_ALLOWED_MIME.includes(parsed.mime)) return res.status(400).json({ error: 'Only PDF and image files can be uploaded' });
    if (dataUri.length > ATTACHMENT_MAX_DATA_URI_LENGTH) return res.status(400).json({ error: 'File is too large (7 MB max)' });
    const check = await db.query(`SELECT id FROM background_checks WHERE id = $1`, [req.params.id]);
    if (check.rows.length === 0) return res.status(404).json({ error: 'Background check not found' });
    const r = await db.query(
      `INSERT INTO background_check_documents (background_check_id, file_name, mime_type, file_size, file_data, uploaded_by)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id, background_check_id, file_name, mime_type, file_size, created_at`,
      [req.params.id, safeFileName(fileName), parsed.mime, Math.floor(parsed.base64.length * 3 / 4), dataUri, req.user.id]);
    await auditLog(req.user.id, 'CREATE', 'background_check_documents', r.rows[0].id, null, r.rows[0]);
    res.status(201).json(r.rows[0]);
  } catch (error) { res.status(500).json({ error: error.message }); }
});

router.delete('/:id/documents/:docId', auth, requireAdmin, async (req, res) => {
  try {
    const r = await db.query(
      `DELETE FROM background_check_documents WHERE id = $1 AND background_check_id = $2
       RETURNING id, background_check_id, file_name, mime_type, file_size, created_at`,
      [req.params.docId, req.params.id]);
    if (r.rows.length === 0) return res.status(404).json({ error: 'Document not found' });
    await auditLog(req.user.id, 'DELETE', 'background_check_documents', req.params.docId, r.rows[0], null);
    res.json({ message: 'Document deleted' });
  } catch (error) { res.status(500).json({ error: error.message }); }
});

module.exports = router;
