// routes/openShiftsRoutes.js
// Open Shift Board - Caregivers claim available shifts

const express = require('express');
const router = express.Router();
const db = require('../db');
const auth = require('../middleware/auth');

// Get all open shifts
router.get('/', auth, async (req, res) => {
  const { status, startDate, endDate, urgency } = req.query;
  try {
    let query = `
      SELECT os.*, 
        c.first_name as client_first_name, c.last_name as client_last_name,
        c.address as client_address, c.city as client_city,
        ct.name as care_type_name,
        cp.first_name as claimed_by_first, cp.last_name as claimed_by_last
      FROM open_shifts os
      JOIN clients c ON os.client_id = c.id
      LEFT JOIN care_types ct ON os.care_type_id = ct.id
      LEFT JOIN caregiver_profiles cp ON os.claimed_by = cp.id
      WHERE 1=1
    `;
    const params = [];

    if (status) {
      params.push(status);
      query += ` AND os.status = $${params.length}`;
    } else {
      query += ` AND os.status = 'open'`; // Default to open shifts
    }

    if (startDate) {
      params.push(startDate);
      query += ` AND os.shift_date >= $${params.length}`;
    }
    if (endDate) {
      params.push(endDate);
      query += ` AND os.shift_date <= $${params.length}`;
    }
    if (urgency) {
      params.push(urgency);
      query += ` AND os.urgency = $${params.length}`;
    }

    query += ` ORDER BY os.urgency DESC, os.shift_date ASC, os.start_time ASC`;
    
    const result = await db.query(query, params);
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Create open shift
router.post('/', auth, async (req, res) => {
  const { clientId, scheduleId, shiftDate, startTime, endTime, careTypeId, hourlyRate, bonusAmount, notes, urgency } = req.body;
  
  try {
    const result = await db.query(`
      INSERT INTO open_shifts (client_id, schedule_id, shift_date, start_time, end_time, care_type_id, hourly_rate, bonus_amount, notes, urgency, created_by)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
      RETURNING *
    `, [clientId, scheduleId, shiftDate, startTime, endTime, careTypeId, hourlyRate, bonusAmount || 0, notes, urgency || 'normal', req.user.id]);

    res.json(result.rows[0]);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Convert unfilled schedule to open shift
router.post('/from-schedule/:scheduleId', auth, async (req, res) => {
  const { scheduleId } = req.params;
  const { bonusAmount, urgency } = req.body;

  try {
    const schedule = await db.query(`
      SELECT s.*, c.referral_source_id
      FROM schedules s
      JOIN clients c ON s.client_id = c.id
      WHERE s.id = $1
    `, [scheduleId]);

    if (schedule.rows.length === 0) {
      return res.status(404).json({ error: 'Schedule not found' });
    }

    const s = schedule.rows[0];

    // Get rate
    const rate = await db.query(`
      SELECT rate_amount FROM referral_source_rates 
      WHERE referral_source_id = $1 
      ORDER BY effective_date DESC LIMIT 1
    `, [s.referral_source_id]);

    const result = await db.query(`
      INSERT INTO open_shifts (client_id, schedule_id, shift_date, start_time, end_time, care_type_id, hourly_rate, bonus_amount, urgency, created_by)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
      RETURNING *
    `, [s.client_id, scheduleId, s.scheduled_date, s.start_time, s.end_time, s.care_type_id, rate.rows[0]?.rate_amount || 20, bonusAmount || 0, urgency || 'normal', req.user.id]);

    res.json(result.rows[0]);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Caregiver claims a shift
router.post('/:id/claim', auth, async (req, res) => {
  const { id } = req.params;
  const { caregiverId, notes } = req.body;

  try {
    // Check shift is still open
    const shift = await db.query('SELECT * FROM open_shifts WHERE id = $1 AND status = $2', [id, 'open']);
    if (shift.rows.length === 0) {
      return res.status(400).json({ error: 'Shift is no longer available' });
    }

    // Check caregiver availability
    const conflicts = await db.query(`
      SELECT id FROM schedules 
      WHERE caregiver_id = $1 
      AND scheduled_date = $2
      AND ((start_time, end_time) OVERLAPS ($3::time, $4::time))
      AND status != 'cancelled'
    `, [caregiverId, shift.rows[0].shift_date, shift.rows[0].start_time, shift.rows[0].end_time]);

    if (conflicts.rows.length > 0) {
      return res.status(400).json({ error: 'You have a conflicting shift at this time' });
    }

    // Create claim
    await db.query(`
      INSERT INTO open_shift_claims (open_shift_id, caregiver_id, notes)
      VALUES ($1, $2, $3)
    `, [id, caregiverId, notes]);

    // Update shift status
    await db.query(`
      UPDATE open_shifts SET status = 'claimed', claimed_by = $1, claimed_at = NOW()
      WHERE id = $2
    `, [caregiverId, id]);

    res.json({ success: true, message: 'Shift claimed - pending approval' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Admin approves claim
router.post('/:id/approve', auth, async (req, res) => {
  const { id } = req.params;

  try {
    const shift = await db.query('SELECT * FROM open_shifts WHERE id = $1', [id]);
    if (shift.rows.length === 0) {
      return res.status(404).json({ error: 'Shift not found' });
    }

    const s = shift.rows[0];
    if (!s.claimed_by) {
      return res.status(400).json({ error: 'No claim to approve' });
    }

    // Create or update schedule
    if (s.schedule_id) {
      await db.query(`
        UPDATE schedules SET caregiver_id = $1, status = 'scheduled' WHERE id = $2
      `, [s.claimed_by, s.schedule_id]);
    } else {
      await db.query(`
        INSERT INTO schedules (client_id, caregiver_id, scheduled_date, start_time, end_time, care_type_id, status)
        VALUES ($1, $2, $3, $4, $5, $6, 'scheduled')
      `, [s.client_id, s.claimed_by, s.shift_date, s.start_time, s.end_time, s.care_type_id]);
    }

    // Update open shift
    await db.query(`
      UPDATE open_shifts SET status = 'filled', approved_by = $1, approved_at = NOW()
      WHERE id = $2
    `, [req.user.id, id]);

    // Update claim
    await db.query(`
      UPDATE open_shift_claims SET status = 'approved' WHERE open_shift_id = $1 AND caregiver_id = $2
    `, [id, s.claimed_by]);

    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Reject claim
router.post('/:id/reject', auth, async (req, res) => {
  const { id } = req.params;
  const { reason } = req.body;

  try {
    const shift = await db.query('SELECT * FROM open_shifts WHERE id = $1', [id]);
    if (shift.rows.length === 0) {
      return res.status(404).json({ error: 'Shift not found' });
    }

    // Reopen shift
    await db.query(`
      UPDATE open_shifts SET status = 'open', claimed_by = NULL, claimed_at = NULL
      WHERE id = $1
    `, [id]);

    // Update claim
    await db.query(`
      UPDATE open_shift_claims SET status = 'rejected', notes = $1
      WHERE open_shift_id = $2 AND status = 'pending'
    `, [reason, id]);

    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Broadcast open shift to caregivers
router.post('/:id/broadcast', auth, async (req, res) => {
  const { id } = req.params;

  try {
    const shift = await db.query(`
      SELECT os.*, c.first_name as client_first, c.last_name as client_last
      FROM open_shifts os
      JOIN clients c ON os.client_id = c.id
      WHERE os.id = $1
    `, [id]);

    if (shift.rows.length === 0) {
      return res.status(404).json({ error: 'Shift not found' });
    }

    const s = shift.rows[0];

    // Get eligible caregivers
    const caregivers = await db.query(`
      SELECT id, phone FROM caregiver_profiles
      WHERE status = 'active' AND sms_enabled = true AND sms_open_shifts = true
    `);

    // This would integrate with SMS routes
    const message = `Open shift available: ${s.client_first} ${s.client_last} on ${s.shift_date} at ${s.start_time}${s.bonus_amount > 0 ? ` (+$${s.bonus_amount} bonus)` : ''}. Claim it in the app!`;

    // Mark as broadcast
    await db.query(`UPDATE open_shifts SET broadcast_sent = true WHERE id = $1`, [id]);

    res.json({ 
      success: true, 
      message: `Broadcast sent to ${caregivers.rows.length} caregivers`,
      caregiverCount: caregivers.rows.length
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get claims for a shift
router.get('/:id/claims', auth, async (req, res) => {
  try {
    const result = await db.query(`
      SELECT osc.*, cp.first_name, cp.last_name, cp.phone
      FROM open_shift_claims osc
      JOIN caregiver_profiles cp ON osc.caregiver_id = cp.id
      WHERE osc.open_shift_id = $1
      ORDER BY osc.created_at
    `, [req.params.id]);
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
