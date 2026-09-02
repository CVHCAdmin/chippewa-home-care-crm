// routes/timeOffRoutes.js — mounted at /api/time-off
const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const db = require('../db');
const { requireAdmin, auditLog } = require('../middleware/shared');
const { SCHEDULE_OCCURRENCES_CTE } = require('../helpers/scheduleOccurrences');
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
    let coverage = null;
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

      // Approval must also DO something about the shifts in the window: expand
      // the caregiver's real occurrences through the shared engine (recurring,
      // bi-weekly, exceptions — the same answer the phone/payroll/billing get)
      // and post each one as an auto-created open shift, so the office has a
      // concrete needs-coverage list instead of a blackout row nobody reads.
      try {
        coverage = await postCoverageOpenShifts(r, req.user.id);
      } catch (e) { console.error('[time-off coverage]', e.message); }
    }

    await auditLog(req.user.id, 'UPDATE', 'caregiver_time_off', req.params.id, prev.rows[0], result.rows[0]);

    // Tell the caregiver their request was answered (this never notified them).
    try {
      const r = result.rows[0];
      const range = `${String(r.start_date).slice(0, 10)} – ${String(r.end_date).slice(0, 10)}`;
      await db.query(
        `INSERT INTO notifications (id, user_id, type, title, message, is_read) VALUES ($1,$2,$3,$4,$5,false)`,
        [uuidv4(), r.caregiver_id,
         status === 'approved' ? 'time_off_approved' : 'time_off_denied',
         status === 'approved' ? 'Time Off Approved' : 'Time Off Not Approved',
         status === 'approved'
           ? `Your time off ${range} is approved. Your shifts in that window are being covered — you don't need to do anything.`
           : `Your time off request for ${range} was not approved. Please talk to the office.`]
      );
    } catch (e) { console.error('[time-off caregiver notify]', e.message); }

    res.json({ ...result.rows[0], coverage });
  } catch (error) { res.status(500).json({ error: error.message }); }
});

// ─── Coverage: post the absent caregiver's occurrences as open shifts ────────
// Expands [max(start, today), end] through the shared schedule engine — only
// occurrences that would actually happen (bi-weekly honored, cancelled skipped,
// moved-away visits excluded because occ.caregiver_id is override-resolved).
// De-dupes against open shifts already posted for the same schedule+date.
// Returns { shiftsNeedingCoverage, posted } and sends the admin summary.
async function postCoverageOpenShifts(timeOff, actingUserId) {
  const win = await db.query(
    `SELECT GREATEST($1::date, (NOW() AT TIME ZONE 'America/Chicago')::date)::text AS from_d,
            $2::date::text AS to_d`,
    [timeOff.start_date, timeOff.end_date]);
  const { from_d, to_d } = win.rows[0];
  if (from_d > to_d) return { shiftsNeedingCoverage: 0, posted: 0 };

  const occ = await db.query(`
    WITH ${SCHEDULE_OCCURRENCES_CTE('occ')}
    SELECT occ.schedule_id, occ.occ_date::text AS shift_date,
           occ.start_time::text AS start_time, occ.end_time::text AS end_time,
           occ.client_id, s.care_type_id,
           c.first_name AS client_first, c.last_name AS client_last
      FROM occ
      JOIN schedules s ON s.id = occ.schedule_id
      JOIN clients c ON c.id = occ.client_id
     WHERE occ.caregiver_id = $3
       AND s.is_training IS NOT TRUE
     ORDER BY occ.occ_date, occ.start_time
  `, [from_d, to_d, timeOff.caregiver_id]);

  let posted = 0;
  for (const o of occ.rows) {
    const dup = await db.query(
      `SELECT id FROM open_shifts
        WHERE schedule_id = $1 AND shift_date = $2 AND status IN ('open','claimed','filled') LIMIT 1`,
      [o.schedule_id, o.shift_date]);
    if (dup.rows.length) continue;
    await db.query(`
      INSERT INTO open_shifts (client_id, schedule_id, shift_date, start_time, end_time,
                               care_type_id, urgency, notes, auto_created, source_absence_id, created_by)
      VALUES ($1, $2, $3, $4, $5, $6, 'high', $7, true, $8, $9)
    `, [o.client_id, o.schedule_id, o.shift_date, o.start_time, o.end_time,
        o.care_type_id, `Coverage needed: approved time off`, timeOff.id, actingUserId]);
    posted++;
  }

  // Admin summary — the "we need to find coverage" part.
  const cg = await db.query(`SELECT first_name, last_name FROM users WHERE id = $1`, [timeOff.caregiver_id]);
  const name = cg.rows[0] ? `${cg.rows[0].first_name} ${cg.rows[0].last_name}` : 'Caregiver';
  const range = `${String(timeOff.start_date).slice(0, 10)} – ${String(timeOff.end_date).slice(0, 10)}`;
  if (occ.rows.length === 0) {
    await notifyAdmins('time_off_coverage', `Time Off Approved: ${name}`,
      `${name} is off ${range}. No scheduled visits fall in that window — nothing to cover.`);
  } else {
    const preview = occ.rows.slice(0, 8)
      .map(o => `• ${o.shift_date} ${String(o.start_time).slice(0, 5)}–${String(o.end_time).slice(0, 5)} ${o.client_first} ${o.client_last}`)
      .join('\n');
    const more = occ.rows.length > 8 ? `\n…and ${occ.rows.length - 8} more` : '';
    await notifyAdmins('time_off_coverage', `⚠️ Coverage Needed: ${name} off ${range}`,
      `${name}'s approved time off leaves ${occ.rows.length} visit(s) needing coverage:\n${preview}${more}\n\n${posted} posted to Open Shifts — assign or broadcast them from the Scheduling Hub.`);
  }

  return { shiftsNeedingCoverage: occ.rows.length, posted };
}

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

    // Expand recurring schedules into concrete dates within the range.
    // Anchor everything to UTC so a server in UTC vs caregivers in Central
    // can't produce off-by-one dates around DST or day boundaries (old code
    // used new Date('YYYY-MM-DD' + 'T12:00:00') which is local-time and
    // breaks when server TZ != caregiver TZ).
    const shifts = [...oneTime.rows];
    const startStr = typeof start_date === 'string' ? start_date.split('T')[0] : start_date;
    const endStr = typeof end_date === 'string' ? end_date.split('T')[0] : end_date;
    const startD = new Date(startStr + 'T12:00:00Z');
    const endD = new Date(endStr + 'T12:00:00Z');

    for (const sched of recurring.rows) {
      const dow = parseInt(sched.day_of_week);
      const d = new Date(startD);
      while (d <= endD) {
        if (d.getUTCDay() === dow) {
          const dateStr = d.toISOString().split('T')[0];
          shifts.push({
            ...sched,
            date: dateStr,
            is_recurring: true
          });
        }
        d.setUTCDate(d.getUTCDate() + 1);
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
