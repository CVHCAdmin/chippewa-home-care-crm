// routes/adlRoutes.js
// ADL (Activities of Daily Living) Tracking

const express = require('express');
const router = express.Router();
const db = require('../db');
const auth = require('../middleware/auth');

// ==================== REQUIREMENTS ====================

// Get client's ADL requirements
router.get('/client/:clientId/requirements', auth, async (req, res) => {
  try {
    const result = await db.query(`
      SELECT * FROM client_adl_requirements
      WHERE client_id = $1
      ORDER BY adl_category
    `, [req.params.clientId]);
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Add ADL requirement
router.post('/requirements', auth, async (req, res) => {
  const { clientId, adlCategory, assistanceLevel, frequency, specialInstructions } = req.body;
  
  try {
    const result = await db.query(`
      INSERT INTO client_adl_requirements (client_id, adl_category, assistance_level, frequency, special_instructions)
      VALUES ($1, $2, $3, $4, $5)
      RETURNING *
    `, [clientId, adlCategory, assistanceLevel, frequency, specialInstructions]);
    res.json(result.rows[0]);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Update ADL requirement
router.put('/requirements/:id', auth, async (req, res) => {
  const { assistanceLevel, frequency, specialInstructions } = req.body;
  
  try {
    const result = await db.query(`
      UPDATE client_adl_requirements SET
        assistance_level = COALESCE($1, assistance_level),
        frequency = COALESCE($2, frequency),
        special_instructions = COALESCE($3, special_instructions),
        updated_at = NOW()
      WHERE id = $4
      RETURNING *
    `, [assistanceLevel, frequency, specialInstructions, req.params.id]);
    res.json(result.rows[0]);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Delete ADL requirement
router.delete('/requirements/:id', auth, async (req, res) => {
  try {
    await db.query('DELETE FROM client_adl_requirements WHERE id = $1', [req.params.id]);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ==================== LOGS ====================

// Get ADL logs for a client (with date range)
router.get('/client/:clientId/logs', auth, async (req, res) => {
  const { startDate, endDate } = req.query;
  try {
    let query = `
      SELECT al.*,
        u.first_name as caregiver_first, u.last_name as caregiver_last
      FROM adl_logs al
      LEFT JOIN users u ON al.caregiver_id = u.id
      WHERE al.client_id = $1
    `;
    const params = [req.params.clientId];

    if (startDate) {
      params.push(startDate);
      query += ` AND al.performed_at >= $${params.length}::date`;
    }
    if (endDate) {
      params.push(endDate);
      query += ` AND al.performed_at <= ($${params.length}::date + INTERVAL '1 day')`;
    }

    query += ` ORDER BY al.performed_at DESC`;
    
    const result = await db.query(query, params);
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Log ADL activity
router.post('/log', auth, async (req, res) => {
  const { clientId, adlCategory, status, assistanceLevel, performedAt, notes } = req.body;
  
  try {
    const result = await db.query(`
      INSERT INTO adl_logs (client_id, caregiver_id, adl_category, status, assistance_level, performed_at, notes)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      RETURNING *
    `, [clientId, req.user.caregiverId || req.user.id, adlCategory, status, assistanceLevel, performedAt || new Date(), notes]);
    res.json(result.rows[0]);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get ADL logs for a time entry (visit)
router.get('/logs/time-entry/:timeEntryId', auth, async (req, res) => {
  try {
    const result = await db.query(`
      SELECT al.*, u.first_name as caregiver_first, u.last_name as caregiver_last
      FROM adl_logs al
      LEFT JOIN users u ON al.caregiver_id = u.id
      WHERE al.time_entry_id = $1
      ORDER BY al.performed_at
    `, [req.params.timeEntryId]);
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ==================== REPORTS ====================

// ADL completion report for a client
router.get('/reports/completion/:clientId', auth, async (req, res) => {
  const { startDate, endDate } = req.query;
  try {
    const result = await db.query(`
      SELECT 
        al.adl_category,
        COUNT(*) as total_entries,
        COUNT(*) FILTER (WHERE al.status = 'completed') as completed_count,
        COUNT(*) FILTER (WHERE al.status = 'partial') as partial_count,
        COUNT(*) FILTER (WHERE al.status = 'refused') as refused_count,
        COUNT(*) FILTER (WHERE al.status = 'not_needed') as not_needed_count
      FROM adl_logs al
      WHERE al.client_id = $1
      AND al.performed_at >= COALESCE($2::date, CURRENT_DATE - INTERVAL '30 days')
      AND al.performed_at <= COALESCE($3::date, CURRENT_DATE) + INTERVAL '1 day'
      GROUP BY al.adl_category
      ORDER BY al.adl_category
    `, [req.params.clientId, startDate, endDate]);
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ==================== LEGACY ENDPOINTS ====================

// Get ADL categories (static list since frontend has them)
router.get('/categories', auth, async (req, res) => {
  res.json([
    { id: 'bathing', name: 'Bathing', icon: '🛁' },
    { id: 'dressing', name: 'Dressing', icon: '👕' },
    { id: 'grooming', name: 'Grooming', icon: '💇' },
    { id: 'feeding', name: 'Feeding/Eating', icon: '🍽️' },
    { id: 'toileting', name: 'Toileting', icon: '🚽' },
    { id: 'transferring', name: 'Transferring', icon: '🧑‍🦽' },
    { id: 'mobility', name: 'Mobility', icon: '🚶' },
    { id: 'medication', name: 'Medication Reminders', icon: '💊' },
    { id: 'housekeeping', name: 'Light Housekeeping', icon: '🧹' },
    { id: 'laundry', name: 'Laundry', icon: '🧺' },
    { id: 'meal_prep', name: 'Meal Preparation', icon: '👨‍🍳' },
    { id: 'companionship', name: 'Companionship', icon: '💬' },
    { id: 'errands', name: 'Errands/Shopping', icon: '🛒' },
    { id: 'transportation', name: 'Transportation', icon: '🚗' }
  ]);
});

module.exports = router;
