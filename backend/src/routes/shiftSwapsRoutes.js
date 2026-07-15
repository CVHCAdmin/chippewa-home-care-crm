// routes/shiftSwapsRoutes.js
// Shift Swap Requests

const express = require('express');
const router = express.Router();
const db = require('../db');
const { SCHEDULE_OCCURRENCES_CTE } = require('../helpers/scheduleOccurrences');
const auth = require('../middleware/auth');

// Get swap requests
router.get('/', auth, async (req, res) => {
  const { status, caregiverId } = req.query;
  try {
    let query = `
      SELECT ssr.*,
        s.date as shift_date, s.start_time, s.end_time,
        c.first_name as client_first, c.last_name as client_last,
        u1.first_name as requester_first, u1.last_name as requester_last,
        u2.first_name as target_first, u2.last_name as target_last
      FROM shift_swap_requests ssr
      JOIN schedules s ON ssr.schedule_id = s.id
      JOIN clients c ON s.client_id = c.id
      JOIN users u1 ON ssr.requesting_caregiver_id = u1.id
      LEFT JOIN users u2 ON ssr.target_caregiver_id = u2.id
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
    const schedule = await db.query(
      'SELECT id, date, day_of_week FROM schedules WHERE id = $1 AND is_active = true', [scheduleId]);
    if (schedule.rows.length === 0) {
      return res.status(404).json({ error: 'Schedule not found' });
    }
    const sch = schedule.rows[0];
    const isRecurring = sch.day_of_week !== null && sch.day_of_week !== undefined;

    // A swap is always about ONE day. For a one-time shift that's the shift's own date.
    // For a RECURRING shift `schedules.date` is NULL — so this used to store shift_date =
    // NULL, and approval had no idea which occurrence was meant (it then reassigned the
    // whole pattern; see /approve below).
    //
    // The caregiver app ships as a frozen APK and posts only a scheduleId, so it cannot
    // tell us the date. Resolve the NEXT upcoming occurrence of the pattern — which is the
    // one the caregiver is looking at when they tap "swap" — and pin the request to it.
    // A caller that knows better can pass shiftDate explicitly.
    let shiftDate = req.body.shiftDate || sch.date || null;
    if (isRecurring && !shiftDate) {
      const win = await db.query(
        `SELECT to_char((NOW() AT TIME ZONE 'America/Chicago')::date, 'YYYY-MM-DD') AS from_d,
                to_char(((NOW() AT TIME ZONE 'America/Chicago')::date + 90), 'YYYY-MM-DD') AS to_d`
      );
      const next = await db.query(
        `WITH ${SCHEDULE_OCCURRENCES_CTE('occ')}
         SELECT to_char(occ.occ_date, 'YYYY-MM-DD') AS d
         FROM occ WHERE occ.schedule_id = $3
         ORDER BY occ.occ_date ASC LIMIT 1`,
        [win.rows[0].from_d, win.rows[0].to_d, scheduleId]
      );
      if (next.rows.length === 0) {
        return res.status(400).json({ error: 'This shift has no upcoming occurrences to swap.' });
      }
      shiftDate = next.rows[0].d;
    }

    const result = await db.query(`
      INSERT INTO shift_swap_requests (schedule_id, requesting_caregiver_id, target_caregiver_id, shift_date, reason)
      VALUES ($1, $2, $3, $4, $5)
      RETURNING *
    `, [scheduleId, requestingCaregiverId, targetCaregiverId, shiftDate, reason]);

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

    // Race guard: verify the schedule still exists and is active before
    // mutating. Old code would happily UPDATE a deleted schedule (no-op)
    // and then mark the swap 'approved', leaving a dangling swap row with
    // no real schedule attached.
    const sched = await db.query(
      `SELECT id, caregiver_id, is_active, day_of_week FROM schedules WHERE id = $1`,
      [s.schedule_id]
    );
    if (sched.rows.length === 0 || sched.rows[0].is_active === false) {
      return res.status(409).json({ error: 'The original schedule was deleted or modified; swap can no longer be approved.' });
    }
    if (sched.rows[0].caregiver_id !== s.requesting_caregiver_id && sched.rows[0].caregiver_id !== s.target_caregiver_id) {
      return res.status(409).json({ error: 'The schedule was reassigned to a different caregiver; swap can no longer be approved.' });
    }

    const isRecurring = sched.rows[0].day_of_week !== null && sched.rows[0].day_of_week !== undefined;

    if (isRecurring) {
      // A swap covers ONE day. This used to run
      //   UPDATE schedules SET caregiver_id = <target> WHERE id = <pattern>
      // on the recurring PATTERN — so approving a swap for a single Tuesday silently
      // handed EVERY future Tuesday to the other caregiver, permanently, with no undo and
      // no audit trail. Write a per-date override instead; the pattern is untouched and
      // the following week goes back to its normal caregiver.
      if (!s.shift_date) {
        return res.status(400).json({
          error: 'This swap request has no shift date, so it cannot be applied to a single occurrence. Ask the caregiver to resubmit it.',
        });
      }
      await db.query(`
        INSERT INTO schedule_exceptions (schedule_id, exception_date, exception_type, override_caregiver_id, created_by)
        VALUES ($1, $2, 'modified', $3, $4)
        ON CONFLICT (schedule_id, exception_date) DO UPDATE SET
          exception_type = 'modified',
          override_caregiver_id = EXCLUDED.override_caregiver_id
      `, [s.schedule_id, s.shift_date, s.target_caregiver_id, req.user.id]);
    } else {
      // One-time shift: the row IS the single occurrence, so reassigning it is correct.
      const upd = await db.query(`
        UPDATE schedules SET caregiver_id = $1, updated_at = NOW() WHERE id = $2 AND is_active = true RETURNING id
      `, [s.target_caregiver_id, s.schedule_id]);
      if (upd.rowCount === 0) {
        return res.status(409).json({ error: 'Schedule changed during approval. Try again.' });
      }
    }

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