// routes/scheduleExceptionsRoutes.js
// Per-occurrence cancel/modify for recurring schedules
const express = require('express');
const router = express.Router();
const db = require('../db');
const { auditLog } = require('../middleware/shared');

// GET /api/schedule-exceptions — all exceptions (optionally filtered by schedule_id or date range)
router.get('/', async (req, res) => {
  try {
    const { schedule_id, from, to } = req.query;
    let sql = `SELECT * FROM schedule_exceptions WHERE 1=1`;
    const params = [];
    if (schedule_id) { params.push(schedule_id); sql += ` AND schedule_id = $${params.length}`; }
    if (from) { params.push(from); sql += ` AND exception_date >= $${params.length}`; }
    if (to) { params.push(to); sql += ` AND exception_date <= $${params.length}`; }
    sql += ` ORDER BY exception_date`;
    const result = await db.query(sql, params);
    res.json(result.rows);
  } catch (error) { res.status(500).json({ error: error.message }); }
});

// GET /api/schedule-exceptions/by-schedules — bulk fetch for a list of schedule IDs
router.post('/by-schedules', async (req, res) => {
  try {
    const { scheduleIds } = req.body;
    if (!Array.isArray(scheduleIds) || scheduleIds.length === 0) return res.json([]);
    const result = await db.query(
      `SELECT * FROM schedule_exceptions WHERE schedule_id = ANY($1) ORDER BY exception_date`,
      [scheduleIds]
    );
    res.json(result.rows);
  } catch (error) { res.status(500).json({ error: error.message }); }
});

// POST /api/schedule-exceptions — create an exception (cancel or modify one occurrence)
router.post('/', async (req, res) => {
  try {
    const { scheduleId, exceptionDate, exceptionType, overrideStartTime, overrideEndTime,
            overrideCaregiverId, overrideClientId, overrideNotes } = req.body;

    if (!scheduleId || !exceptionDate || !exceptionType) {
      return res.status(400).json({ error: 'scheduleId, exceptionDate, and exceptionType are required' });
    }
    if (!['cancelled', 'modified'].includes(exceptionType)) {
      return res.status(400).json({ error: 'exceptionType must be cancelled or modified' });
    }

    // Verify the schedule exists and is recurring
    const sched = await db.query('SELECT * FROM schedules WHERE id = $1 AND is_active = true', [scheduleId]);
    if (sched.rows.length === 0) return res.status(404).json({ error: 'Schedule not found' });
    if (sched.rows[0].day_of_week === null && sched.rows[0].day_of_week === undefined) {
      return res.status(400).json({ error: 'Exceptions only apply to recurring schedules' });
    }

    const result = await db.query(
      `INSERT INTO schedule_exceptions
        (schedule_id, exception_date, exception_type, override_start_time, override_end_time,
         override_caregiver_id, override_client_id, override_notes, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       ON CONFLICT (schedule_id, exception_date) DO UPDATE SET
         exception_type = EXCLUDED.exception_type,
         override_start_time = EXCLUDED.override_start_time,
         override_end_time = EXCLUDED.override_end_time,
         override_caregiver_id = EXCLUDED.override_caregiver_id,
         override_client_id = EXCLUDED.override_client_id,
         override_notes = EXCLUDED.override_notes
       RETURNING *`,
      [scheduleId, exceptionDate, exceptionType,
       overrideStartTime || null, overrideEndTime || null,
       overrideCaregiverId || null, overrideClientId || null,
       overrideNotes || null, req.user.id]
    );

    await auditLog(req.user.id, 'CREATE', 'schedule_exceptions', result.rows[0].id, null, result.rows[0]);
    res.status(201).json(result.rows[0]);
  } catch (error) { res.status(500).json({ error: error.message }); }
});

// DELETE /api/schedule-exceptions/:id — remove an exception (restore original occurrence)
router.delete('/:id', async (req, res) => {
  try {
    const result = await db.query('DELETE FROM schedule_exceptions WHERE id = $1 RETURNING *', [req.params.id]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'Exception not found' });
    await auditLog(req.user.id, 'DELETE', 'schedule_exceptions', req.params.id, result.rows[0], null);
    res.json({ message: 'Exception removed' });
  } catch (error) { res.status(500).json({ error: error.message }); }
});

module.exports = router;
