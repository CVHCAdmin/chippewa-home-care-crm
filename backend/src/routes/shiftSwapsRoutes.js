// routes/shiftSwapsRoutes.js
// Shift Swap Requests

const express = require('express');
const router = express.Router();
const db = require('../db');
const auth = require('../middleware/auth');

// Get swap requests
router.get('/', auth, async (req, res) => {
  const { status, caregiverId } = req.query;
  try {
    let query = `
      SELECT ssr.*,
        s.scheduled_date, s.start_time, s.end_time,
        c.first_name as client_first, c.last_name as client_last,
        cp1.first_name as requester_first, cp1.last_name as requester_last,
        cp2.first_name as target_first, cp2.last_name as target_last
      FROM shift_swap_requests ssr
      JOIN schedules s ON ssr.schedule_id = s.id
      JOIN clients c ON s.client_id = c.id
      JOIN caregiver_profiles cp1 ON ssr.requesting_caregiver_id = cp1.id
      LEFT JOIN caregiver_profiles cp2 ON ssr.target_caregiver_id = cp2.id
      WHERE 1=1
    `;
    const params = [];

    if (status) {
      params.push(status);
      query += ` AND ssr.status = $${params.length}`;
    }
    if (caregiverId) {
      params.push(caregiverId);
      query += ` AND (ssr.requesting_caregiver_id = $${params.length} OR ssr.target_caregiver_id = $${params.length})`;
    }

    query += ` ORDER BY ssr.requested_at DESC`;
    
    const result = await db.query(query, params);
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Create swap request
router.post('/', auth, async (req, res) => {
  const { scheduleId, requestingCaregiverId, targetCaregiverId, reason } = req.body;
  
  try {
    // Get shift date
    const schedule = await db.query('SELECT scheduled_date FROM schedules WHERE id = $1', [scheduleId]);
    if (schedule.rows.length === 0) {
      return res.status(404).json({ error: 'Schedule not found' });
    }

    const result = await db.query(`
      INSERT INTO shift_swap_requests (schedule_id, requesting_caregiver_id, target_caregiver_id, shift_date, reason)
      VALUES ($1, $2, $3, $4, $5)
      RETURNING *
    `, [scheduleId, requestingCaregiverId, targetCaregiverId, schedule.rows[0].scheduled_date, reason]);

    res.json(result.rows[0]);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Target caregiver accepts/rejects
router.put('/:id/respond', auth, async (req, res) => {
  const { accepted, notes } = req.body;
  
  try {
    const status = accepted ? 'accepted' : 'rejected';
    await db.query(`
      UPDATE shift_swap_requests 
      SET status = $1, responded_at = NOW(), notes = $2
      WHERE id = $3
    `, [status, notes, req.params.id]);

    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Admin approves swap
router.put('/:id/approve', auth, async (req, res) => {
  try {
    const swap = await db.query('SELECT * FROM shift_swap_requests WHERE id = $1', [req.params.id]);
    if (swap.rows.length === 0) {
      return res.status(404).json({ error: 'Swap request not found' });
    }

    const s = swap.rows[0];
    if (s.status !== 'accepted') {
      return res.status(400).json({ error: 'Swap must be accepted by target caregiver first' });
    }

    // Update schedule with new caregiver
    await db.query(`
      UPDATE schedules SET caregiver_id = $1 WHERE id = $2
    `, [s.target_caregiver_id, s.schedule_id]);

    // Update swap request
    await db.query(`
      UPDATE shift_swap_requests 
      SET status = 'approved', admin_approved_by = $1, admin_approved_at = NOW()
      WHERE id = $2
    `, [req.user.id, req.params.id]);

    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Admin rejects swap
router.put('/:id/reject', auth, async (req, res) => {
  const { reason } = req.body;
  try {
    await db.query(`
      UPDATE shift_swap_requests 
      SET status = 'rejected', notes = $1, admin_approved_by = $2, admin_approved_at = NOW()
      WHERE id = $3
    `, [reason, req.user.id, req.params.id]);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Cancel swap request
router.put('/:id/cancel', auth, async (req, res) => {
  try {
    await db.query(`
      UPDATE shift_swap_requests SET status = 'cancelled' WHERE id = $1
    `, [req.params.id]);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
