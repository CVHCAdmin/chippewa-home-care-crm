// src/routes/emergencyRoutes.js - Emergency coverage + shift miss reporting
const express = require('express');
const router = express.Router();
const db = require('../db');
const { v4: uuidv4 } = require('uuid');
const auth = require('../middleware/auth');
const requireAdmin = require('../middleware/authorizeAdmin');

// ═══════════════════════════════════════════
// SHIFT MISS REPORTING (caregiver-initiated)
// ═══════════════════════════════════════════

// POST /api/emergency/miss-report - Caregiver reports they can't make a shift
router.post('/miss-report', auth, async (req, res) => {
  try {
    const { scheduleId, date, reason, alternativeContact } = req.body;
    const caregiverId = req.user.id;

    if (!date) return res.status(400).json({ error: 'Date is required' });

    const reportId = uuidv4();

    // Get schedule details if provided
    let scheduleInfo = null;
    if (scheduleId) {
      const sched = await db.query(
        `SELECT s.*, c.first_name as client_first_name, c.last_name as client_last_name,
                u.first_name as caregiver_first_name, u.last_name as caregiver_last_name
         FROM schedules s
         LEFT JOIN clients c ON s.client_id = c.id
         LEFT JOIN users u ON s.caregiver_id = u.id
         WHERE s.id = $1`,
        [scheduleId]
      );
      scheduleInfo = sched.rows[0] || null;
    }

    // Record the miss report as an absence
    const absenceResult = await db.query(`
      INSERT INTO absences (id, caregiver_id, date, type, reason, coverage_needed, created_at)
      VALUES ($1, $2, $3, 'call_out', $4, true, NOW())
      RETURNING *`,
      [reportId, caregiverId, date, reason || 'No reason provided']
    );

    // Create an alert for admins
    const admins = await db.query(
      `SELECT id FROM users WHERE role = 'admin' AND is_active = true`
    );

    const caregiverInfo = await db.query(
      `SELECT first_name, last_name FROM users WHERE id = $1`,
      [caregiverId]
    );
    const cg = caregiverInfo.rows[0];
    const cgName = cg ? `${cg.first_name} ${cg.last_name}` : 'A caregiver';

    const alertMessage = scheduleInfo
      ? `${cgName} cannot make their shift on ${date} with ${scheduleInfo.client_first_name} ${scheduleInfo.client_last_name}. Reason: ${reason || 'None given'}`
      : `${cgName} has reported they cannot work on ${date}. Reason: ${reason || 'None given'}`;

    for (const admin of admins.rows) {
      await db.query(`
        INSERT INTO notifications (id, user_id, type, title, message, is_read, created_at)
        VALUES ($1, $2, 'emergency_coverage', 'Shift Miss Report — Coverage Needed', $3, false, NOW())`,
        [uuidv4(), admin.id, alertMessage]
      );
    }

    // Mark schedule as needing coverage if schedule provided
    if (scheduleId) {
      await db.query(
        `UPDATE absences SET notes = $1 WHERE id = $2`,
        [JSON.stringify({ scheduleId, scheduleInfo: scheduleInfo ? { clientName: `${scheduleInfo.client_first_name} ${scheduleInfo.client_last_name}`, startTime: scheduleInfo.start_time, endTime: scheduleInfo.end_time } : null, alternativeContact }), reportId]
      );
    }

    res.status(201).json({
      id: reportId,
      message: 'Your report has been submitted. The admin team has been notified.',
      date,
      status: 'submitted',
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET /api/emergency/miss-reports - Admin: all pending miss reports
router.get('/miss-reports', auth, requireAdmin, async (req, res) => {
  try {
    const result = await db.query(`
      SELECT 
        a.*,
        u.first_name, u.last_name, u.phone, u.email,
        a.notes::jsonb->>'scheduleId' as schedule_id,
        (a.notes::jsonb->'scheduleInfo'->>'clientName') as client_name,
        (a.notes::jsonb->'scheduleInfo'->>'startTime') as start_time,
        (a.notes::jsonb->'scheduleInfo'->>'endTime') as end_time
      FROM absences a
      JOIN users u ON a.caregiver_id = u.id
      WHERE a.type = 'call_out' 
        AND a.coverage_needed = true
        AND a.coverage_assigned_to IS NULL
        AND a.date >= CURRENT_DATE
      ORDER BY a.date ASC, a.created_at ASC`
    );
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ═══════════════════════════════════════════
// EMERGENCY COVERAGE FINDER
// ═══════════════════════════════════════════

// GET /api/emergency/available-caregivers - Find who can cover a shift
router.get('/available-caregivers', auth, requireAdmin, async (req, res) => {
  try {
    const { date, startTime, endTime, clientId, absenceId } = req.query;

    if (!date || !startTime || !endTime) {
      return res.status(400).json({ error: 'date, startTime, and endTime are required' });
    }

    const dayOfWeek = new Date(date + 'T12:00:00').getDay();

    // Find caregivers who:
    // 1. Are active
    // 2. Have no conflicting schedule on that date/time
    // 3. Have not requested time off that day
    // 4. Are marked available for that day
    const result = await db.query(`
      WITH conflicting_caregivers AS (
        -- Has an existing schedule that overlaps
        SELECT DISTINCT caregiver_id FROM schedules
        WHERE is_active = true
          AND (
            (date = $1)
            OR (day_of_week = $2 AND (date IS NULL OR date = $1))
          )
          AND start_time < $4::time AND end_time > $3::time
      ),
      on_time_off AS (
        -- Has approved time off that day
        SELECT DISTINCT caregiver_id FROM caregiver_time_off
        WHERE status = 'approved'
          AND start_date <= $1::date AND end_date >= $1::date
      ),
      called_out AS (
        -- Already called out this day
        SELECT DISTINCT caregiver_id FROM absences
        WHERE date = $1::date AND type IN ('call_out', 'no_show')
      )
      SELECT 
        u.id, u.first_name, u.last_name, u.phone, u.email,
        u.certifications,
        -- Check if they are available for this day in their availability preferences
        ca.weekly_availability,
        ca.status as availability_status,
        -- Count their hours this week
        COALESCE((
          SELECT SUM(EXTRACT(EPOCH FROM (end_time - start_time)) / 3600)
          FROM schedules s2
          WHERE s2.caregiver_id = u.id 
            AND s2.is_active = true
            AND s2.date >= DATE_TRUNC('week', $1::date)
            AND s2.date < DATE_TRUNC('week', $1::date) + INTERVAL '7 days'
        ), 0) as scheduled_hours_this_week,
        -- Last worked date
        (SELECT MAX(start_time)::date FROM time_entries te WHERE te.caregiver_id = u.id AND te.is_complete = true) as last_worked,
        -- Performance rating
        COALESCE((
          SELECT ROUND(AVG(satisfaction_score)::numeric, 1)
          FROM performance_ratings pr
          WHERE pr.caregiver_id = u.id
        ), 0) as avg_rating,
        -- Client preference match
        CASE WHEN $5::uuid IS NOT NULL AND $5::text != '' AND u.id = ANY(
          SELECT UNNEST(preferred_caregivers) FROM clients WHERE id = $5::uuid
        ) THEN true ELSE false END as is_preferred
      FROM users u
      LEFT JOIN caregiver_availability ca ON ca.caregiver_id = u.id
      WHERE u.role = 'caregiver'
        AND u.is_active = true
        AND u.id NOT IN (SELECT caregiver_id FROM conflicting_caregivers)
        AND u.id NOT IN (SELECT caregiver_id FROM on_time_off)
        AND u.id NOT IN (SELECT caregiver_id FROM called_out)
      ORDER BY is_preferred DESC, avg_rating DESC, scheduled_hours_this_week ASC`,
      [date, dayOfWeek, startTime, endTime, clientId || null]
    );

    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/emergency/assign-coverage - Assign a caregiver to cover a shift
router.post('/assign-coverage', auth, requireAdmin, async (req, res) => {
  try {
    const { absenceId, caregiverId, scheduleId, date, startTime, endTime, clientId, notes } = req.body;

    // Update the absence record
    if (absenceId) {
      await db.query(
        `UPDATE absences SET coverage_assigned_to = $1, coverage_needed = false WHERE id = $2`,
        [caregiverId, absenceId]
      );
    }

    // Create a one-time schedule entry for the covering caregiver
    if (date && startTime && endTime && clientId) {
      const newSchedId = uuidv4();
      await db.query(`
        INSERT INTO schedules (id, caregiver_id, client_id, date, start_time, end_time, notes, is_active, created_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7, true, NOW())`,
        [newSchedId, caregiverId, clientId, date, startTime, endTime,
          `Emergency coverage${notes ? ': ' + notes : ''}. Original absence: ${absenceId || 'N/A'}`]
      );
    }

    // Notify the covering caregiver
    const caregiver = await db.query('SELECT first_name, last_name FROM users WHERE id = $1', [caregiverId]);
    const client = clientId ? await db.query('SELECT first_name, last_name FROM clients WHERE id = $1', [clientId]) : null;
    
    const cg = caregiver.rows[0];
    const cl = client ? client.rows[0] : null;

    await db.query(`
      INSERT INTO notifications (id, user_id, type, title, message, is_read, created_at)
      VALUES ($1, $2, 'emergency_assignment', 'Emergency Coverage Assignment', $3, false, NOW())`,
      [
        uuidv4(),
        caregiverId,
        `You have been assigned emergency coverage on ${date} from ${startTime} to ${endTime}${cl ? ` for ${cl.first_name} ${cl.last_name}` : ''}. Please confirm your availability.`
      ]
    );

    res.json({ success: true, message: `Coverage assigned to ${cg?.first_name} ${cg?.last_name}` });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET /api/emergency/my-shifts - Caregiver: get upcoming shifts for miss-report form
router.get('/my-shifts', auth, async (req, res) => {
  try {
    const today = new Date().toISOString().split('T')[0];
    const result = await db.query(`
      SELECT s.id, s.date, s.day_of_week, s.start_time, s.end_time,
             c.first_name as client_first_name, c.last_name as client_last_name,
             c.address as client_address
      FROM schedules s
      JOIN clients c ON s.client_id = c.id
      WHERE s.caregiver_id = $1
        AND s.is_active = true
        AND (s.date >= $2::date OR (s.date IS NULL AND s.day_of_week IS NOT NULL))
      ORDER BY s.date ASC, s.start_time ASC
      LIMIT 14`,
      [req.user.id, today]
    );
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
