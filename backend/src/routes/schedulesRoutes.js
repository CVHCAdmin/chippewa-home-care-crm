// routes/schedulesRoutes.js
// Schedule Management Routes

const express = require('express');
const router = express.Router();
const db = require('../db');
const { v4: uuidv4 } = require('uuid');

// Auth middleware (same as in server.js)
const jwt = require('jsonwebtoken');

const verifyToken = (req, res, next) => {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) {
    return res.status(401).json({ error: 'No token provided' });
  }
  if (!process.env.JWT_SECRET) {
    console.error('FATAL: JWT_SECRET env var not set');
    return res.status(500).json({ error: 'Server configuration error' });
  }
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user = decoded;
    next();
  } catch (error) {
    return res.status(401).json({ error: 'Invalid token' });
  }
};

const requireAdmin = (req, res, next) => {
  if (req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Admin access required' });
  }
  next();
};

// Audit logging helper
const auditLog = async (userId, action, tableName, recordId, oldData, newData) => {
  try {
    if (recordId && typeof recordId === 'string' && !recordId.match(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i)) {
      return;
    }
    await db.query(
      `INSERT INTO audit_logs (user_id, action, table_name, record_id, old_data, new_data, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, NOW())`,
      [userId || '00000000-0000-0000-0000-000000000000', action, tableName, recordId, JSON.stringify(oldData), JSON.stringify(newData)]
    );
  } catch (error) {
    console.error('Audit log error:', error.message);
  }
};

// ==================== SCHEDULES ROUTES ====================

// GET /api/schedules/:caregiverId - Get schedules for a specific caregiver (caregiver dashboard)
router.get('/:caregiverId', verifyToken, async (req, res) => {
  try {
    const result = await db.query(`
      SELECT s.*,
        c.first_name as client_first_name, c.last_name as client_last_name,
        c.address as client_address, c.city as client_city,
        ct.name as care_type_name
      FROM schedules s
      JOIN clients c ON s.client_id = c.id
      LEFT JOIN care_types ct ON c.care_type_id = ct.id
      WHERE s.caregiver_id = $1 AND s.is_active = true
      ORDER BY s.day_of_week, s.date, s.start_time
    `, [req.params.caregiverId]);
    res.json(result.rows);
  } catch (error) { res.status(500).json({ error: error.message }); }
});

// GET /api/schedules/caregiver/:caregiverId - alias used by SchedulingHub
router.get('/caregiver/:caregiverId', verifyToken, async (req, res) => {
  try {
    const result = await db.query(`
      SELECT s.*,
        c.first_name as client_first_name, c.last_name as client_last_name
      FROM schedules s
      JOIN clients c ON s.client_id = c.id
      WHERE s.caregiver_id = $1 AND s.is_active = true
      ORDER BY s.day_of_week, s.date, s.start_time
    `, [req.params.caregiverId]);
    res.json(result.rows);
  } catch (error) { res.status(500).json({ error: error.message }); }
});

// POST /api/schedules - Create new schedule
router.post('/', verifyToken, async (req, res) => {
  try {
    const { caregiverId, clientId, scheduleType, dayOfWeek, date, startTime, endTime, notes } = req.body;
    
    const scheduleId = uuidv4();
    const result = await db.query(
      `INSERT INTO schedules (id, caregiver_id, client_id, schedule_type, day_of_week, date, start_time, end_time, notes)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING *`,
      [scheduleId, caregiverId, clientId, scheduleType, dayOfWeek || null, date || null, startTime, endTime, notes || null]
    );

    await auditLog(req.user.id, 'CREATE', 'schedules', scheduleId, null, result.rows[0]);
    res.status(201).json(result.rows[0]);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// PUT /api/schedules/:id/reassign - Admin reassigns schedule to different caregiver
router.put('/:id/reassign', verifyToken, requireAdmin, async (req, res) => {
  const { newCaregiverId } = req.body;
  const scheduleId = req.params.id;

  try {
    // Validate inputs
    if (!newCaregiverId) {
      return res.status(400).json({ error: 'newCaregiverId is required' });
    }

    // Get current schedule for audit log
    const current = await db.query('SELECT * FROM schedules WHERE id = $1', [scheduleId]);
    if (current.rows.length === 0) {
      return res.status(404).json({ error: 'Schedule not found' });
    }

    const oldData = current.rows[0];

    // Verify the new caregiver exists and is active
    const caregiver = await db.query(
      `SELECT id, first_name, last_name FROM users WHERE id = $1 AND role = 'caregiver' AND is_active = true`,
      [newCaregiverId]
    );
    if (caregiver.rows.length === 0) {
      return res.status(404).json({ error: 'Caregiver not found or inactive' });
    }

    // Check for scheduling conflicts with the new caregiver
    const schedule = oldData;
    if (schedule.date) {
      const conflicts = await db.query(`
        SELECT id FROM schedules 
        WHERE caregiver_id = $1 
          AND is_active = true
          AND id != $2
          AND date = $3
          AND NOT (end_time <= $4 OR start_time >= $5)
      `, [newCaregiverId, scheduleId, schedule.date, schedule.start_time, schedule.end_time]);

      if (conflicts.rows.length > 0) {
        return res.status(400).json({ 
          error: `${caregiver.rows[0].first_name} ${caregiver.rows[0].last_name} has a conflicting schedule at this time` 
        });
      }
    }

    // Update the schedule
    const result = await db.query(`
      UPDATE schedules 
      SET caregiver_id = $1, updated_at = NOW()
      WHERE id = $2
      RETURNING *
    `, [newCaregiverId, scheduleId]);

    // Audit log the change
    await auditLog(req.user.id, 'UPDATE', 'schedules', scheduleId, oldData, result.rows[0]);

    console.log(`Schedule ${scheduleId} reassigned from caregiver ${oldData.caregiver_id} to ${newCaregiverId} by admin ${req.user.id}`);

    res.json({ 
      success: true, 
      schedule: result.rows[0],
      message: `Schedule reassigned to ${caregiver.rows[0].first_name} ${caregiver.rows[0].last_name}`
    });
  } catch (error) {
    console.error('Reassignment failed:', error);
    res.status(500).json({ error: error.message });
  }
});

// NOTE: GET /api/schedules-all and PUT /api/schedules-all/:id are handled
// directly in server.js — do not add them here (Express router path boundaries
// prevent router.get('-all') from ever matching /api/schedules-all).

// DELETE /api/schedules/:scheduleId - Delete a schedule (soft delete)
router.delete('/:scheduleId', verifyToken, async (req, res) => {
  try {
    const result = await db.query(
      `UPDATE schedules SET is_active = false, updated_at = NOW() WHERE id = $1 RETURNING *`,
      [req.params.scheduleId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Schedule not found' });
    }

    await auditLog(req.user.id, 'DELETE', 'schedules', req.params.scheduleId, null, result.rows[0]);
    res.json({ message: 'Schedule deleted' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
