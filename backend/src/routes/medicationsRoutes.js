// routes/medicationsRoutes.js
// Medication Tracking for clients

const express = require('express');
const router = express.Router();
const db = require('../db');
const auth = require('../middleware/auth');

// Get client medications
router.get('/client/:clientId', auth, async (req, res) => {
  const { activeOnly } = req.query;
  try {
    let query = `
      SELECT * FROM client_medications 
      WHERE client_id = $1
    `;
    if (activeOnly === 'true') {
      query += ` AND is_active = true`;
    }
    query += ` ORDER BY medication_name`;
    
    const result = await db.query(query, [req.params.clientId]);
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Add medication
router.post('/', auth, async (req, res) => {
  const { clientId, medicationName, dosage, frequency, route, prescriber, pharmacy, rxNumber, startDate, endDate, instructions, sideEffects, isPrn } = req.body;
  
  try {
    const result = await db.query(`
      INSERT INTO client_medications 
      (client_id, medication_name, dosage, frequency, route, prescriber, pharmacy, rx_number, start_date, end_date, instructions, side_effects, is_prn)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
      RETURNING *
    `, [clientId, medicationName, dosage, frequency, route, prescriber, pharmacy, rxNumber, startDate, endDate, instructions, sideEffects, isPrn]);
    res.json(result.rows[0]);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Update medication
router.put('/:id', auth, async (req, res) => {
  const { medicationName, dosage, frequency, route, prescriber, pharmacy, rxNumber, startDate, endDate, instructions, sideEffects, isPrn, isActive } = req.body;
  
  try {
    const result = await db.query(`
      UPDATE client_medications SET
        medication_name = $1, dosage = $2, frequency = $3, route = $4,
        prescriber = $5, pharmacy = $6, rx_number = $7, start_date = $8, end_date = $9,
        instructions = $10, side_effects = $11, is_prn = $12, is_active = $13, updated_at = NOW()
      WHERE id = $14
      RETURNING *
    `, [medicationName, dosage, frequency, route, prescriber, pharmacy, rxNumber, startDate, endDate, instructions, sideEffects, isPrn, isActive, req.params.id]);
    res.json(result.rows[0]);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Discontinue medication
router.put('/:id/discontinue', auth, async (req, res) => {
  try {
    await db.query(`
      UPDATE client_medications SET is_active = false, end_date = CURRENT_DATE, updated_at = NOW()
      WHERE id = $1
    `, [req.params.id]);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Log medication administration
router.post('/log', auth, async (req, res) => {
  const { clientId, medicationId, caregiverId, timeEntryId, scheduledTime, administeredTime, status, dosageGiven, notes } = req.body;
  
  try {
    const result = await db.query(`
      INSERT INTO medication_logs 
      (client_id, medication_id, caregiver_id, time_entry_id, scheduled_time, administered_time, status, dosage_given, notes)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      RETURNING *
    `, [clientId, medicationId, caregiverId, timeEntryId, scheduledTime, administeredTime || new Date(), status, dosageGiven, notes]);
    res.json(result.rows[0]);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get medication logs for a client
router.get('/logs/client/:clientId', auth, async (req, res) => {
  const { startDate, endDate } = req.query;
  try {
    let query = `
      SELECT ml.*, 
        cm.medication_name, cm.dosage, cm.frequency,
        cp.first_name as caregiver_first, cp.last_name as caregiver_last
      FROM medication_logs ml
      JOIN client_medications cm ON ml.medication_id = cm.id
      LEFT JOIN caregiver_profiles cp ON ml.caregiver_id = cp.id
      WHERE ml.client_id = $1
    `;
    const params = [req.params.clientId];

    if (startDate) {
      params.push(startDate);
      query += ` AND ml.administered_time >= $${params.length}`;
    }
    if (endDate) {
      params.push(endDate);
      query += ` AND ml.administered_time <= $${params.length}`;
    }

    query += ` ORDER BY ml.administered_time DESC`;
    
    const result = await db.query(query, params);
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get medication logs for a time entry (visit)
router.get('/logs/time-entry/:timeEntryId', auth, async (req, res) => {
  try {
    const result = await db.query(`
      SELECT ml.*, cm.medication_name, cm.dosage
      FROM medication_logs ml
      JOIN client_medications cm ON ml.medication_id = cm.id
      WHERE ml.time_entry_id = $1
      ORDER BY ml.administered_time
    `, [req.params.timeEntryId]);
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get medications due for a visit
router.get('/due/:clientId', auth, async (req, res) => {
  try {
    const result = await db.query(`
      SELECT * FROM client_medications
      WHERE client_id = $1 AND is_active = true
      ORDER BY medication_name
    `, [req.params.clientId]);
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Medication adherence report
router.get('/reports/adherence/:clientId', auth, async (req, res) => {
  const { startDate, endDate } = req.query;
  try {
    const result = await db.query(`
      SELECT 
        cm.medication_name,
        COUNT(*) FILTER (WHERE ml.status = 'administered') as administered_count,
        COUNT(*) FILTER (WHERE ml.status = 'refused') as refused_count,
        COUNT(*) FILTER (WHERE ml.status = 'missed') as missed_count,
        COUNT(*) as total_entries
      FROM client_medications cm
      LEFT JOIN medication_logs ml ON ml.medication_id = cm.id
        AND ml.administered_time >= $2 AND ml.administered_time <= $3
      WHERE cm.client_id = $1 AND cm.is_active = true
      GROUP BY cm.id, cm.medication_name
      ORDER BY cm.medication_name
    `, [req.params.clientId, startDate || '1970-01-01', endDate || '2099-12-31']);
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
