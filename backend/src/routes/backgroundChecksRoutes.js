// routes/backgroundChecksRoutes.js
// Background Check Tracking

const express = require('express');
const router = express.Router();
const db = require('../db');
const auth = require('../middleware/auth');

// Get all background checks (with optional filters)
router.get('/', auth, async (req, res) => {
  const { status, type, caregiverId } = req.query;
  try {
    let query = `
      SELECT bc.*, 
        cp.first_name as caregiver_first, cp.last_name as caregiver_last
      FROM background_checks bc
      JOIN caregiver_profiles cp ON bc.caregiver_id = cp.id
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

    query += ` ORDER BY bc.request_date DESC`;
    
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
      ORDER BY request_date DESC
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
      SELECT bc.*, cp.first_name, cp.last_name, cp.phone, cp.email
      FROM background_checks bc
      JOIN caregiver_profiles cp ON bc.caregiver_id = cp.id
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
      SELECT cp.id, cp.first_name, cp.last_name,
        ARRAY_AGG(DISTINCT bc.check_type) FILTER (WHERE bc.status = 'completed' AND bc.result = 'clear' AND (bc.expiration_date IS NULL OR bc.expiration_date > CURRENT_DATE)) as passed_checks,
        ARRAY_AGG(DISTINCT bc.check_type) FILTER (WHERE bc.result = 'disqualifying') as failed_checks,
        ARRAY_AGG(DISTINCT bc.check_type) FILTER (WHERE bc.status = 'pending' OR bc.status = 'in_progress') as pending_checks
      FROM caregiver_profiles cp
      LEFT JOIN background_checks bc ON bc.caregiver_id = cp.id
      WHERE cp.status = 'active'
      GROUP BY cp.id, cp.first_name, cp.last_name
      ORDER BY cp.last_name
    `);
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
