// routes/timeOffRoutes.js — mounted at /api/time-off
const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const db = require('../db');
const { requireAdmin, auditLog } = require('../middleware/shared');
// Helper: notify all admin users (local copy to avoid import issues)
async function notifyAdmins(type, title, message) {
  try {
    const admins = await db.query(`SELECT id FROM users WHERE role = 'admin' AND is_active = true`);
    for (const admin of admins.rows) {
      await db.query(
        `INSERT INTO notifications (id, user_id, type, title, message, is_read) VALUES ($1,$2,$3,$4,$5,false)`,
        [uuidv4(), admin.id, type, title, message]
      );
    }
  } catch (e) { console.error('[notifyAdmins error]', e.message); }
}

// ─── POST / — Caregiver submits a time-off request ─────────────────────────
router.post('/', async (req, res) => {
  try {
    const { startDate, endDate, type, reason } = req.body;
    if (!startDate || !endDate) return res.status(400).json({ error: 'startDate and endDate are required' });

    const id = uuidv4();
    const result = await db.query(
      `INSERT INTO caregiver_time_off (id, caregiver_id, start_date, end_date, type, reason, status, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, 'pending', NOW()) RETURNING *`,
      [id, req.user.id, startDate, endDate, type || 'other', reason || null]
    );
    await auditLog(req.user.id, 'CREATE', 'caregiver_time_off', id, null, result.rows[0]);

    // Send response first, then notify admins (non-blocking)
    res.status(201).json(result.rows[0]);

    // Auto-notify admins about the new time-off request (after response sent)
    try {
      const user = await db.query(`SELECT first_name, last_name FROM users WHERE id = $1`, [req.user.id]);
      const name = user.rows[0] ? `${user.rows[0].first_name} ${user.rows[0].last_name}` : 'A caregiver';
      const typeLabel = { vacation: 'Vacation', sick: 'Sick Leave', personal: 'Personal', other: 'Other' }[type] || type || 'Other';
      const startStr = startDate.split('T')[0];
      const endStr = endDate.split('T')[0];
      await notifyAdmins(
        'time_off_request',
        `Time Off Request: ${name}`,
        `${name} has requested ${typeLabel} from ${startStr} to ${endStr}.${reason ? ' Reason: ' + reason : ''}`
      );
    } catch (e) { console.error('[time-off notify error]', e.message); }
  } catch (error) { res.status(500).json({ error: error.message }); }
});

// ─── GET /my — Caregiver's own requests ─────────────────────────────────────
router.get('/my', async (req, res) => {
  try {
    const result = await db.query(
      `SELECT * FROM caregiver_time_off WHERE caregiver_id = $1 ORDER BY created_at DESC`,
      [req.user.id]
    );
    res.json(result.rows);
  } catch (error) { res.status(500).json({ error: error.message }); }
});

// ─── DELETE /:id — Caregiver cancels their own pending request ──────────────
router.delete('/:id', async (req, res) => {
  try {
    const result = await db.query(
      `DELETE FROM caregiver_time_off WHERE id = $1 AND caregiver_id = $2 AND status = 'pending' RETURNING *`,
      [req.params.id, req.user.id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Request not found or already processed' });
    await auditLog(req.user.id, 'DELETE', 'caregiver_time_off', req.params.id, result.rows[0], null);
    res.json({ message: 'Request cancelled' });
  } catch (error) { res.status(500).json({ error: error.message }); }
});

// ─── GET / — Admin: all time-off requests ───────────────────────────────────
router.get('/', requireAdmin, async (req, res) => {
  try {
    const { status, startDate, endDate } = req.query;
    let query = `
      SELECT t.*, u.first_name, u.last_name, u.phone,
             a.first_name as approved_by_first, a.last_name as approved_by_last
      FROM caregiver_time_off t
      JOIN users u ON t.caregiver_id = u.id
      LEFT JOIN users a ON t.approved_by = a.id
      WHERE 1=1
    `;
    const params = [];
    if (status) { params.push(status); query += ` AND t.status = $${params.length}`; }
    if (startDate) { params.push(startDate); query += ` AND t.end_date >= $${params.length}`; }
    if (endDate) { params.push(endDate); query += ` AND t.start_date <= $${params.length}`; }
    query += ` ORDER BY t.created_at DESC`;
    res.json((await db.query(query, params)).rows);
  } catch (error) { res.status(500).json({ error: error.message }); }
});

// ─── PATCH /:id — Admin approves or denies a request ────────────────────────
router.patch('/:id', requireAdmin, async (req, res) => {
  try {
    const { status } = req.body;
    if (!['approved', 'denied'].includes(status)) return res.status(400).json({ error: 'Status must be approved or denied' });

    const prev = await db.query(`SELECT * FROM caregiver_time_off WHERE id = $1`, [req.params.id]);
    if (prev.rows.length === 0) return res.status(404).json({ error: 'Request not found' });

    const result = await db.query(
      `UPDATE caregiver_time_off SET status = $1, approved_by = $2 WHERE id = $3 RETURNING *`,
      [status, req.user.id, req.params.id]
    );

    // When approved, also create blackout dates so the scheduler excludes this caregiver
    if (status === 'approved') {
      const r = result.rows[0];
      const existingBlackout = await db.query(
        `SELECT id FROM caregiver_blackout_dates WHERE caregiver_id = $1 AND start_date = $2 AND end_date = $3`,
        [r.caregiver_id, r.start_date, r.end_date]
      );
      if (existingBlackout.rows.length === 0) {
        await db.query(
          `INSERT INTO caregiver_blackout_dates (id, caregiver_id, start_date, end_date, reason, created_at)
           VALUES ($1, $2, $3, $4, $5, NOW())`,
          [uuidv4(), r.caregiver_id, r.start_date, r.end_date, r.reason || 'Approved time off']
        );
      }
    }

    await auditLog(req.user.id, 'UPDATE', 'caregiver_time_off', req.params.id, prev.rows[0], result.rows[0]);
    res.json(result.rows[0]);
  } catch (error) { res.status(500).json({ error: error.message }); }
});

// ─── GET /:id/affected-shifts — Shifts during the time-off period ───────────
router.get('/:id/affected-shifts', requireAdmin, async (req, res) => {
  try {
    const timeOff = await db.query(`SELECT * FROM caregiver_time_off WHERE id = $1`, [req.params.id]);
    if (timeOff.rows.length === 0) return res.status(404).json({ error: 'Request not found' });

    const { caregiver_id, start_date, end_date } = timeOff.rows[0];

    // One-time schedules in the date range
    const oneTime = await db.query(
      `SELECT s.*, c.first_name as client_first, c.last_name as client_last
       FROM schedules s
       JOIN clients c ON s.client_id = c.id
       WHERE s.caregiver_id = $1 AND s.is_active = true
         AND s.schedule_type = 'one-time' AND s.date >= $2 AND s.date <= $3
       ORDER BY s.date, s.start_time`,
      [caregiver_id, start_date, end_date]
    );

    // Recurring schedules that overlap the period
    const recurring = await db.query(
      `SELECT s.*, c.first_name as client_first, c.last_name as client_last
       FROM schedules s
       JOIN clients c ON s.client_id = c.id
       WHERE s.caregiver_id = $1 AND s.is_active = true
         AND s.schedule_type = 'recurring'
         AND (s.effective_date IS NULL OR s.effective_date <= $3)
         AND (s.end_date IS NULL OR s.end_date >= $2)
       ORDER BY s.day_of_week, s.start_time`,
      [caregiver_id, start_date, end_date]
    );

    // Expand recurring schedules into concrete dates within the range
    const shifts = [...oneTime.rows];
    const startStr = typeof start_date === 'string' ? start_date.split('T')[0] : start_date;
    const endStr = typeof end_date === 'string' ? end_date.split('T')[0] : end_date;
    const startD = new Date(startStr + 'T12:00:00');
    const endD = new Date(endStr + 'T12:00:00');

    for (const sched of recurring.rows) {
      const dow = parseInt(sched.day_of_week);
      const d = new Date(startD);
      while (d <= endD) {
        if (d.getDay() === dow) {
          const dateStr = d.toISOString().split('T')[0];
          shifts.push({
            ...sched,
            date: dateStr,
            is_recurring: true
          });
        }
        d.setDate(d.getDate() + 1);
      }
    }

    // Sort by date then start_time
    shifts.sort((a, b) => (a.date + a.start_time).localeCompare(b.date + b.start_time));

    res.json(shifts);
  } catch (error) { res.status(500).json({ error: error.message }); }
});

// ─── GET /:id/available-coverage — Caregivers available to cover ────────────
router.get('/:id/available-coverage', requireAdmin, async (req, res) => {
  try {
    const timeOff = await db.query(`SELECT * FROM caregiver_time_off WHERE id = $1`, [req.params.id]);
    if (timeOff.rows.length === 0) return res.status(404).json({ error: 'Request not found' });

    const { caregiver_id, start_date, end_date } = timeOff.rows[0];
    const { date, startTime, endTime } = req.query;

    // If a specific date is requested, find caregivers available that day/time
    if (date && startTime && endTime) {
      const dayOfWeek = new Date(date + 'T12:00:00').getDay();
      const dayMap = { 0: 'sunday', 1: 'monday', 2: 'tuesday', 3: 'wednesday', 4: 'thursday', 5: 'friday', 6: 'saturday' };
      const dayName = dayMap[dayOfWeek];

      const result = await db.query(`
        SELECT u.id, u.first_name, u.last_name, u.phone, u.certifications,
               ca.${dayName}_available as is_available,
               ca.${dayName}_start_time as avail_start,
               ca.${dayName}_end_time as avail_end,
               ca.max_hours_per_week
        FROM users u
        LEFT JOIN caregiver_availability ca ON u.id = ca.caregiver_id
        WHERE u.role = 'caregiver' AND u.is_active = true
          AND u.id != $1
          AND ca.${dayName}_available = true
          AND ca.${dayName}_start_time <= $2
          AND ca.${dayName}_end_time >= $3
          -- Exclude caregivers who have blackout dates on this date
          AND NOT EXISTS (
            SELECT 1 FROM caregiver_blackout_dates bd
            WHERE bd.caregiver_id = u.id AND bd.start_date <= $4 AND bd.end_date >= $4
          )
          -- Exclude caregivers who already have a conflicting shift
          AND NOT EXISTS (
            SELECT 1 FROM schedules sc
            WHERE sc.caregiver_id = u.id AND sc.is_active = true
              AND (
                (sc.schedule_type = 'one-time' AND sc.date = $4 AND sc.start_time < $3 AND sc.end_time > $2)
                OR (sc.schedule_type = 'recurring' AND sc.day_of_week = $5 AND sc.start_time < $3 AND sc.end_time > $2
                    AND (sc.effective_date IS NULL OR sc.effective_date <= $4)
                    AND (sc.end_date IS NULL OR sc.end_date >= $4))
              )
          )
        ORDER BY u.first_name, u.last_name
      `, [caregiver_id, startTime, endTime, date, dayOfWeek]);

      // Also get current weekly hours for each available caregiver
      const weekStart = getWeekStart(date);
      const weekEnd = getWeekEnd(date);
      for (const cg of result.rows) {
        const hoursResult = await db.query(
          `SELECT COALESCE(SUM(duration_minutes), 0) / 60.0 as weekly_hours
           FROM time_entries WHERE caregiver_id = $1 AND start_time >= $2 AND start_time <= $3`,
          [cg.id, weekStart, weekEnd]
        );
        cg.weekly_hours = parseFloat(hoursResult.rows[0]?.weekly_hours || 0).toFixed(1);
      }

      return res.json(result.rows);
    }

    // Otherwise return a general summary — all caregivers not on time off during this period
    const result = await db.query(`
      SELECT u.id, u.first_name, u.last_name, u.phone, u.certifications,
             ca.status as availability_status, ca.max_hours_per_week
      FROM users u
      LEFT JOIN caregiver_availability ca ON u.id = ca.caregiver_id
      WHERE u.role = 'caregiver' AND u.is_active = true
        AND u.id != $1
        AND (ca.status IS NULL OR ca.status != 'unavailable')
        AND NOT EXISTS (
          SELECT 1 FROM caregiver_blackout_dates bd
          WHERE bd.caregiver_id = u.id AND bd.start_date <= $3 AND bd.end_date >= $2
        )
      ORDER BY u.first_name, u.last_name
    `, [caregiver_id, start_date, end_date]);

    res.json(result.rows);
  } catch (error) { res.status(500).json({ error: error.message }); }
});

function getWeekStart(dateStr) {
  const d = new Date(dateStr + 'T00:00:00');
  const day = d.getDay();
  d.setDate(d.getDate() - day);
  return d.toISOString().split('T')[0];
}

function getWeekEnd(dateStr) {
  const d = new Date(dateStr + 'T00:00:00');
  const day = d.getDay();
  d.setDate(d.getDate() + (6 - day));
  return d.toISOString().split('T')[0];
}

module.exports = router;
