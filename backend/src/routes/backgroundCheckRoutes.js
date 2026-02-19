// src/routes/backgroundCheckRoutes.js - WORCS integration + encrypted PII
const express = require('express');
const router = express.Router();
const db = require('../db');
const { v4: uuidv4 } = require('uuid');
const { submitBackgroundCheck, getCheckResults } = require('../services/worcsService');
const { encrypt, decrypt, maskSSN, validateSSN, normalizeSSN } = require('../services/encryptionService');
const auth = require('../middleware/auth');
const requireAdmin = require('../middleware/authorizeAdmin');

// Audit log helper
const auditLog = async (userId, action, table, recordId, oldData, newData) => {
  try {
    await db.query(
      `INSERT INTO audit_logs (user_id, action, table_name, record_id, old_data, new_data, timestamp)
       VALUES ($1, $2, $3, $4, $5, $6, NOW())`,
      [userId, action, table, recordId, JSON.stringify(oldData), JSON.stringify(newData)]
    );
  } catch (e) { console.error('Audit log error:', e.message); }
};

// GET /api/background-checks - List all (admin only, no SSN shown)
router.get('/', auth, requireAdmin, async (req, res) => {
  try {
    const result = await db.query(`
      SELECT 
        bc.*,
        u.first_name, u.last_name, u.email,
        a.first_name as app_first_name, a.last_name as app_last_name
      FROM background_checks bc
      LEFT JOIN users u ON bc.caregiver_id = u.id
      LEFT JOIN applications a ON bc.application_id = a.id
      ORDER BY bc.created_at DESC
    `);
    
    // Mask SSNs before returning
    const rows = result.rows.map(row => ({
      ...row,
      ssn_last4: row.ssn_encrypted ? maskSSN(decrypt(row.ssn_encrypted) || '') : null,
      ssn_encrypted: undefined, // Never send encrypted value to frontend
    }));
    
    res.json(rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET /api/background-checks/:id - Get single check
router.get('/:id', auth, requireAdmin, async (req, res) => {
  try {
    const result = await db.query(
      `SELECT bc.*, u.first_name, u.last_name
       FROM background_checks bc
       LEFT JOIN users u ON bc.caregiver_id = u.id
       WHERE bc.id = $1`,
      [req.params.id]
    );
    
    if (result.rows.length === 0) return res.status(404).json({ error: 'Not found' });
    
    const row = result.rows[0];
    await auditLog(req.user.id, 'READ', 'background_checks', req.params.id, null, { action: 'viewed_record' });
    
    res.json({
      ...row,
      ssn_last4: row.ssn_encrypted ? maskSSN(decrypt(row.ssn_encrypted) || '') : null,
      ssn_encrypted: undefined,
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/background-checks/reveal-ssn/:id - Reveal full SSN (logged action)
router.post('/reveal-ssn/:id', auth, requireAdmin, async (req, res) => {
  try {
    const result = await db.query(
      `SELECT ssn_encrypted FROM background_checks WHERE id = $1`,
      [req.params.id]
    );
    
    if (result.rows.length === 0) return res.status(404).json({ error: 'Not found' });
    
    const decrypted = decrypt(result.rows[0].ssn_encrypted);
    
    // Log this sensitive access
    await auditLog(req.user.id, 'REVEAL_SSN', 'background_checks', req.params.id, null, {
      action: 'ssn_revealed',
      admin_id: req.user.id,
      timestamp: new Date().toISOString()
    });
    
    if (!decrypted) return res.status(500).json({ error: 'Failed to decrypt SSN' });
    
    // Format as XXX-XX-XXXX
    const formatted = decrypted.replace(/^(\d{3})(\d{2})(\d{4})$/, '$1-$2-$3');
    res.json({ ssn: formatted });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/background-checks - Submit new check from application
router.post('/', auth, requireAdmin, async (req, res) => {
  try {
    const {
      applicationId, caregiverId,
      firstName, lastName, dateOfBirth, ssn,
      driversLicense, driversLicenseState
    } = req.body;

    if (!firstName || !lastName || !dateOfBirth || !ssn) {
      return res.status(400).json({ error: 'firstName, lastName, dateOfBirth, and ssn are required' });
    }

    if (!validateSSN(ssn)) {
      return res.status(400).json({ error: 'Invalid SSN format. Must be 9 digits.' });
    }

    const normalizedSSN = normalizeSSN(ssn);
    const encryptedSSN = encrypt(normalizedSSN);
    const encryptedDL = driversLicense ? encrypt(driversLicense) : null;

    // Submit to WORCS
    let worcsResult;
    try {
      worcsResult = await submitBackgroundCheck({
        firstName,
        lastName,
        dateOfBirth,
        ssn: normalizedSSN,
        requestPurpose: 'Caregiver-General',
      });
    } catch (worcsError) {
      // Log the error but still create the record as "error" status
      console.error('[WORCS] Submission failed:', worcsError.message);
      worcsResult = { success: false, referenceNumber: null, status: 'error', error: worcsError.message };
    }

    const checkId = uuidv4();
    const result = await db.query(`
      INSERT INTO background_checks (
        id, application_id, caregiver_id,
        check_date, status, clearance_number,
        ssn_encrypted, drivers_license_encrypted, drivers_license_state,
        worcs_reference_number, worcs_status, notes, expiration_date
      ) VALUES ($1, $2, $3, CURRENT_DATE, $4, $5, $6, $7, $8, $9, $10, $11, 
        CURRENT_DATE + INTERVAL '4 years')
      RETURNING id, status, worcs_reference_number, worcs_status, check_date`,
      [
        checkId,
        applicationId || null,
        caregiverId || null,
        worcsResult.status === 'pending' ? 'pending' : 'error',
        worcsResult.referenceNumber || null,
        encryptedSSN,
        encryptedDL,
        driversLicenseState || null,
        worcsResult.referenceNumber || null,
        worcsResult.status,
        worcsResult.error ? `WORCS Error: ${worcsResult.error}` : (worcsResult.mock ? 'Mock response - no WORCS credentials configured' : null),
      ]
    );

    await auditLog(req.user.id, 'CREATE', 'background_checks', checkId, null, {
      action: 'background_check_submitted',
      applicationId,
      caregiverId,
      worcsReference: worcsResult.referenceNumber
    });

    res.status(201).json({
      ...result.rows[0],
      ssnLast4: maskSSN(normalizedSSN),
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/background-checks/:id/poll - Poll WORCS for updated results
router.post('/:id/poll', auth, requireAdmin, async (req, res) => {
  try {
    const check = await db.query(
      `SELECT * FROM background_checks WHERE id = $1`,
      [req.params.id]
    );
    
    if (check.rows.length === 0) return res.status(404).json({ error: 'Not found' });
    
    const record = check.rows[0];
    if (!record.worcs_reference_number) {
      return res.status(400).json({ error: 'No WORCS reference number — check was not submitted successfully' });
    }

    const worcsResult = await getCheckResults(record.worcs_reference_number);

    let newStatus = record.status;
    let newClearance = record.clearance_number;
    
    if (worcsResult.status === 'completed') {
      newStatus = worcsResult.result === 'cleared' ? 'cleared' : 
                  worcsResult.result === 'record_found' ? 'conditional' : 'error';
      newClearance = worcsResult.referenceNumber;
    }

    const updated = await db.query(`
      UPDATE background_checks SET
        status = $1,
        clearance_number = $2,
        worcs_status = $3,
        notes = COALESCE(notes, '') || CASE WHEN $4 THEN '' ELSE ' | WORCS result: ' || $5 END,
        updated_at = NOW()
      WHERE id = $6
      RETURNING *`,
      [
        newStatus,
        newClearance,
        worcsResult.status,
        worcsResult.status !== 'completed',
        worcsResult.result || 'pending',
        req.params.id
      ]
    );

    await auditLog(req.user.id, 'UPDATE', 'background_checks', req.params.id, record, updated.rows[0]);

    res.json({
      id: req.params.id,
      status: newStatus,
      worcsStatus: worcsResult.status,
      result: worcsResult.result,
      polledAt: new Date().toISOString(),
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// PUT /api/background-checks/:id - Manually update a check (override)
router.put('/:id', auth, requireAdmin, async (req, res) => {
  try {
    const { status, notes, expirationDate, clearanceNumber } = req.body;
    
    const old = await db.query('SELECT * FROM background_checks WHERE id = $1', [req.params.id]);
    if (old.rows.length === 0) return res.status(404).json({ error: 'Not found' });

    const result = await db.query(`
      UPDATE background_checks SET
        status = COALESCE($1, status),
        notes = COALESCE($2, notes),
        expiration_date = COALESCE($3, expiration_date),
        clearance_number = COALESCE($4, clearance_number),
        updated_at = NOW()
      WHERE id = $5
      RETURNING *`,
      [status, notes, expirationDate, clearanceNumber, req.params.id]
    );

    await auditLog(req.user.id, 'UPDATE', 'background_checks', req.params.id, old.rows[0], result.rows[0]);
    res.json(result.rows[0]);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET /api/background-checks/compliance-overview - All caregivers expiry status
router.get('/overview/expiring', auth, requireAdmin, async (req, res) => {
  try {
    const days = parseInt(req.query.days) || 60;
    const result = await db.query(`
      SELECT 
        u.id as caregiver_id,
        u.first_name, u.last_name, u.email, u.phone,
        bc.id as check_id,
        bc.status, bc.check_date, bc.expiration_date,
        bc.worcs_reference_number,
        CASE 
          WHEN bc.expiration_date IS NULL THEN 'no_check'
          WHEN bc.expiration_date < CURRENT_DATE THEN 'expired'
          WHEN bc.expiration_date < CURRENT_DATE + INTERVAL '1 day' * $1 THEN 'expiring_soon'
          ELSE 'current'
        END as expiry_status,
        bc.expiration_date - CURRENT_DATE as days_until_expiry
      FROM users u
      LEFT JOIN background_checks bc ON u.id = bc.caregiver_id
        AND bc.id = (
          SELECT id FROM background_checks bc2 
          WHERE bc2.caregiver_id = u.id 
          ORDER BY check_date DESC LIMIT 1
        )
      WHERE u.role = 'caregiver' AND u.is_active = true
      ORDER BY bc.expiration_date ASC NULLS FIRST`,
      [days]
    );
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
