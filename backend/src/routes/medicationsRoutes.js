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
  const { clientId, medicationId, caregiverId, timeEntryId, scheduledTime, administeredTime, status, dosageGiven, notes, witnessedBy } = req.body;

  // Validate status. 'given' is the historical default; the v39 migration
  // added a stricter effective_status column for new entries.
  const ALLOWED = ['given', 'refused', 'held', 'self_administered', 'missed'];
  const effStatus = ALLOWED.includes(status) ? status : 'given';

  try {
    const result = await db.query(`
      INSERT INTO medication_logs
      (client_id, medication_id, caregiver_id, time_entry_id, scheduled_time, administered_time,
       status, effective_status, dosage_given, notes, witnessed_by)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $7, $8, $9, $10)
      RETURNING *
    `, [clientId, medicationId, caregiverId, timeEntryId, scheduledTime,
        administeredTime || new Date(), effStatus, dosageGiven, notes, witnessedBy || null]);
    res.json(result.rows[0]);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ─── VITALS ─────────────────────────────────────────────────────────────────
// POST /api/medications/vitals — record a vitals snapshot
router.post('/vitals', auth, async (req, res) => {
  const {
    clientId, caregiverId, timeEntryId,
    systolicBp, diastolicBp, pulse, respirations, oxygenSaturation,
    temperatureF, bloodGlucose, weightLbs,
    painScale, painLocation, notes,
  } = req.body;
  if (!clientId) return res.status(400).json({ error: 'clientId is required' });
  // At least one vital must be present — empty submissions are useless
  const anyVital = [systolicBp, diastolicBp, pulse, respirations, oxygenSaturation,
    temperatureF, bloodGlucose, weightLbs, painScale].some(v => v != null && v !== '');
  if (!anyVital) return res.status(400).json({ error: 'At least one vital measurement is required' });

  try {
    const result = await db.query(
      `INSERT INTO client_vitals
       (client_id, caregiver_id, time_entry_id, systolic_bp, diastolic_bp, pulse, respirations,
        oxygen_saturation, temperature_f, blood_glucose, weight_lbs, pain_scale, pain_location, notes)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING *`,
      [clientId, caregiverId || req.user?.id || null, timeEntryId || null,
       systolicBp || null, diastolicBp || null, pulse || null, respirations || null,
       oxygenSaturation || null, temperatureF || null, bloodGlucose || null, weightLbs || null,
       painScale != null && painScale !== '' ? parseInt(painScale) : null, painLocation || null, notes || null]
    );
    res.status(201).json(result.rows[0]);
  } catch (error) {
    // CHECK constraint failures bubble up as friendly 400s
    if (error.message.includes('vitals_')) {
      return res.status(400).json({ error: 'One or more values out of plausible range: ' + error.message });
    }
    res.status(500).json({ error: error.message });
  }
});

// GET /api/medications/vitals/client/:clientId — list a client's vitals
router.get('/vitals/client/:clientId', auth, async (req, res) => {
  const { limit = 50, startDate, endDate } = req.query;
  const params = [req.params.clientId];
  let where = 'cv.client_id = $1';
  if (startDate) { params.push(startDate); where += ` AND cv.recorded_at >= $${params.length}::timestamptz`; }
  if (endDate)   { params.push(endDate);   where += ` AND cv.recorded_at <= $${params.length}::timestamptz`; }
  params.push(Math.min(parseInt(limit) || 50, 500));
  try {
    const result = await db.query(`
      SELECT cv.*, u.first_name AS caregiver_first, u.last_name AS caregiver_last
        FROM client_vitals cv
        LEFT JOIN users u ON cv.caregiver_id = u.id
       WHERE ${where}
       ORDER BY cv.recorded_at DESC
       LIMIT $${params.length}
    `, params);
    res.json(result.rows);
  } catch (error) { res.status(500).json({ error: error.message }); }
});

// GET /api/medications/vitals/latest/:clientId — latest single snapshot
router.get('/vitals/latest/:clientId', auth, async (req, res) => {
  try {
    const result = await db.query(
      `SELECT cv.*, u.first_name AS caregiver_first, u.last_name AS caregiver_last
         FROM client_vitals cv
         LEFT JOIN users u ON cv.caregiver_id = u.id
        WHERE cv.client_id = $1
        ORDER BY cv.recorded_at DESC LIMIT 1`,
      [req.params.clientId]
    );
    res.json(result.rows[0] || null);
  } catch (error) { res.status(500).json({ error: error.message }); }
});

// Get medication logs for a client
router.get('/logs/client/:clientId', auth, async (req, res) => {
  const { startDate, endDate } = req.query;
  try {
    let query = `
      SELECT ml.*, 
        cm.medication_name, cm.dosage, cm.frequency,
        u.first_name as caregiver_first, u.last_name as caregiver_last
      FROM medication_logs ml
      JOIN client_medications cm ON ml.medication_id = cm.id
      LEFT JOIN users u ON ml.caregiver_id = u.id
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
