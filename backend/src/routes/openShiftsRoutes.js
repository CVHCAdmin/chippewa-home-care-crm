// routes/openShiftsRoutes.js
// Open Shift Board - Caregivers claim available shifts

const express = require('express');
const router = express.Router();
const db = require('../db');
const { SCHEDULE_OCCURRENCES_CTE } = require('../helpers/scheduleOccurrences');
const auth = require('../middleware/auth');
const { requireAdmin } = require('../middleware/shared');

// Office-posted shifts (v71): `visible_to` = the caregivers the office picked to see
// and accept it (NULL = everyone, as before); `auto_assign` = the first of them to
// accept gets it with no approval step. Ensured lazily so a deploy never waits on a
// manual migration; migration_v71_open_shift_visibility.sql records the same DDL.
let columnsReady = null;
function ensureColumns() {
  if (!columnsReady) {
    columnsReady = db.query(`
      ALTER TABLE open_shifts
        ADD COLUMN IF NOT EXISTS visible_to UUID[],
        ADD COLUMN IF NOT EXISTS auto_assign BOOLEAN NOT NULL DEFAULT false
    `).catch(e => { columnsReady = null; throw e; });
  }
  return columnsReady;
}

const ymd = (d) => (typeof d === 'string' ? d : d.toISOString()).slice(0, 10);

// Put the open shift's ONE visit on `caregiverId`. Shared by approve, smart-fill and
// the accept-means-it's-yours claim, so all three fill a shift the same way.
//
// RECURRING pattern: a per-occurrence 'modified' exception with override_caregiver_id —
// reassigning schedules.caregiver_id would move every past and future occurrence (the
// recurring-edit history-rewrite trap). A one-time row IS the occurrence.
//
// A caregiver call-out (emergencyRoutes miss-report) CANCELS the day and posts it as an
// open shift. Filling it must bring the visit back on the new caregiver: the old upsert
// refused to touch a cancelled day, so a "filled" call-out stayed cancelled and never
// reached the substitute's schedule, payroll or the invoice. Any OTHER cancellation
// (client refused, in hospital…) means there is no visit to fill — refuse instead of
// reporting a fill that didn't happen.
async function assignShift(s, caregiverId, actorId) {
  const day = ymd(s.shift_date);
  if (!s.schedule_id) {
    // No schedule behind it (e.g. coverage after a caregiver was removed from a client —
    // an override on a suspended pattern never generates): the fill is its own visit.
    await db.query(`
      INSERT INTO schedules (client_id, caregiver_id, schedule_type, date, start_time, end_time, notes, status)
      VALUES ($1, $2, 'one-time', $3, $4, $5, $6, 'scheduled')
    `, [s.client_id, caregiverId, day, s.start_time, s.end_time, s.notes || null]);
    return;
  }
  const sched = await db.query(`SELECT day_of_week FROM schedules WHERE id = $1`, [s.schedule_id]);
  const isRecurring = sched.rows.length > 0 && sched.rows[0].day_of_week !== null;
  const exc = (await db.query(
    `SELECT id, exception_type, cancel_reason FROM schedule_exceptions WHERE schedule_id = $1 AND exception_date = $2`,
    [s.schedule_id, day])).rows[0];
  const isCallout = exc && exc.exception_type === 'cancelled' && exc.cancel_reason === 'caregiver_callout';
  if (exc && exc.exception_type === 'cancelled' && !isCallout) {
    const err = new Error('This visit was cancelled on the schedule — there is no visit to fill.');
    err.status = 409;
    throw err;
  }
  if (isRecurring) {
    if (isCallout) {
      await db.query(
        `UPDATE schedule_exceptions SET exception_type = 'modified', override_caregiver_id = $1, cancel_reason = NULL WHERE id = $2`,
        [caregiverId, exc.id]);
    } else {
      await db.query(`
        INSERT INTO schedule_exceptions (schedule_id, exception_date, exception_type, override_caregiver_id, created_by)
        VALUES ($1, $2, 'modified', $3, $4)
        ON CONFLICT (schedule_id, exception_date)
        DO UPDATE SET override_caregiver_id = EXCLUDED.override_caregiver_id
        WHERE schedule_exceptions.exception_type <> 'cancelled'
      `, [s.schedule_id, day, caregiverId, actorId]);
    }
  } else {
    if (isCallout) await db.query(`DELETE FROM schedule_exceptions WHERE id = $1`, [exc.id]);
    await db.query(`UPDATE schedules SET caregiver_id = $1, status = 'scheduled', updated_at = NOW() WHERE id = $2`,
      [caregiverId, s.schedule_id]);
  }
}

const clientShort = (first, last) => `${first || ''} ${String(last || '').charAt(0)}.`.trim();
const fmtHm = (t) => { const [h, m] = String(t).split(':').map(Number); return `${h % 12 === 0 ? 12 : h % 12}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`; };
const fmtDay = (d) => new Date(`${ymd(d)}T12:00:00Z`).toLocaleDateString('en-US', { weekday: 'short', month: 'numeric', day: 'numeric', timeZone: 'UTC' });

async function notifyAdmins(type, title, message) {
  try {
    const admins = await db.query(`SELECT id FROM users WHERE role = 'admin' AND is_active = true`);
    for (const a of admins.rows) {
      await db.query(`INSERT INTO notifications (user_id, type, title, message) VALUES ($1, $2, $3, $4)`, [a.id, type, title, message]);
    }
  } catch (e) { console.error('[open-shifts] admin notify:', e.message); }
}

// Lazy-load to avoid circular requires; sendPushToUser is exported from
// pushNotificationRoutes and gracefully no-ops when VAPID isn't configured.
let _sendPush = null;
const sendPush = (...args) => {
  if (!_sendPush) {
    try { _sendPush = require('./pushNotificationRoutes').sendPushToUser; } catch { _sendPush = async () => {}; }
  }
  return _sendPush(...args);
};

// GET /api/open-shifts/:id/smart-fill-suggestions  (admin)
// Returns the same suggest-caregivers ranking but scoped to this open shift's
// client/date/time. Used by the one-click smart-fill UI.
router.get('/:id/smart-fill-suggestions', auth, requireAdmin, async (req, res) => {
  try {
    const shift = await db.query(
      `SELECT id, client_id, shift_date, start_time, end_time, status FROM open_shifts WHERE id = $1`,
      [req.params.id]
    );
    if (shift.rows.length === 0) return res.status(404).json({ error: 'Open shift not found' });
    const s = shift.rows[0];
    if (s.status !== 'open') return res.status(409).json({ error: `Shift is ${s.status}, not open` });

    // Just call the suggest-caregivers route handler internally by re-using the
    // same DB query patterns. To keep this small we forward to /api/scheduling
    // — but here we just emit the params the frontend should re-pass through it.
    res.json({
      forwardTo: '/api/scheduling/suggest-caregivers',
      params: {
        clientId:  s.client_id,
        date:      typeof s.shift_date === 'string' ? s.shift_date : s.shift_date.toISOString().slice(0, 10),
        startTime: s.start_time,
        endTime:   s.end_time,
      },
    });
  } catch (error) { res.status(500).json({ error: error.message }); }
});

// POST /api/open-shifts/:id/smart-fill  body: { caregiverId }  (admin)
// Assigns the open shift directly to a chosen caregiver, skipping the
// caregiver-claim → admin-approve workflow. Re-checks auth balance.
router.post('/:id/smart-fill', auth, requireAdmin, async (req, res) => {
  const { caregiverId } = req.body;
  if (!caregiverId) return res.status(400).json({ error: 'caregiverId required' });
  try {
    const shift = await db.query(`SELECT * FROM open_shifts WHERE id = $1`, [req.params.id]);
    if (shift.rows.length === 0) return res.status(404).json({ error: 'Open shift not found' });
    const s = shift.rows[0];
    if (s.status !== 'open') return res.status(409).json({ error: `Shift is ${s.status}, not open` });

    // Auth balance is advisory — see helpers/authorizationCheck.js. Filling an
    // uncovered shift must never be refused over paperwork; the client still
    // needs the visit and someone just volunteered to take it.
    let authWarnings = [];
    try {
      const { checkAuthorizationBalance } = require('../helpers/authorizationCheck');
      const startStr = typeof s.start_time === 'string' ? s.start_time : s.start_time.toISOString().slice(11,16);
      const endStr   = typeof s.end_time   === 'string' ? s.end_time   : s.end_time.toISOString().slice(11,16);
      const shiftHours = (new Date(`2000-01-01T${endStr}`) - new Date(`2000-01-01T${startStr}`)) / 3600000;
      const authCheck = await checkAuthorizationBalance(s.client_id, shiftHours);
      authWarnings = authCheck.warnings || [];
    } catch (e) { console.error('[openShifts smart-fill] auth recheck failed:', e.message); }

    await assignShift(s, caregiverId, req.user.id);
    await db.query(`
      UPDATE open_shifts
        SET status = 'filled', claimed_by = $1, claimed_at = NOW(),
            approved_by = $2, approved_at = NOW()
      WHERE id = $3
    `, [caregiverId, req.user.id, req.params.id]);

    // Notify the assigned caregiver
    try {
      sendPush(caregiverId, {
        title: '📋 New shift assigned',
        body:  `You've been assigned to ${typeof s.shift_date === 'string' ? s.shift_date : s.shift_date.toISOString().slice(0,10)} ${s.start_time}-${s.end_time}.`,
        data:  { type: 'shift_assigned', eventType: 'schedule', shiftId: s.id },
      }).catch(() => {});
    } catch {}

    res.json({ success: true, openShiftId: s.id, assignedTo: caregiverId, authWarnings });
  } catch (error) {
    console.error('[openShifts smart-fill]', error);
    res.status(error.status || 500).json({ error: error.message });
  }
});

// Get all open shifts
// A shift the office offered to chosen caregivers is visible only to them.
router.get('/available', auth, async (req, res) => {
  try {
    await ensureColumns();
    const result = await db.query(`
      SELECT os.*, c.first_name as client_first_name, c.last_name as client_last_name
      FROM open_shifts os
      LEFT JOIN clients c ON os.client_id = c.id
      WHERE os.status = 'open'
        AND (os.shift_date >= CURRENT_DATE OR os.shift_date IS NULL)
        AND (os.visible_to IS NULL OR $1::uuid = ANY(os.visible_to) OR $2 = 'admin')
      ORDER BY os.shift_date, os.start_time
    `, [req.user.id, req.user.role]);
    res.json(result.rows);
  } catch (error) {
    console.error('Get available shifts error:', error);
    res.status(500).json({ error: error.message });
  }
});

router.get('/', auth, requireAdmin, async (req, res) => {
  const { status, startDate, endDate, urgency } = req.query;
  try {
    await ensureColumns();
    let query = `
      SELECT os.*,
        c.first_name as client_first_name, c.last_name as client_last_name,
        c.address as client_address, c.city as client_city,
        ct.name as care_type_name,
        u.first_name as claimed_by_first, u.last_name as claimed_by_last,
        (SELECT string_agg(v.first_name || ' ' || v.last_name, ', ' ORDER BY v.first_name)
           FROM users v WHERE v.id = ANY(os.visible_to)) AS offered_to
      FROM open_shifts os
      JOIN clients c ON os.client_id = c.id
      LEFT JOIN care_types ct ON os.care_type_id = ct.id
      LEFT JOIN users u ON os.claimed_by = u.id
      WHERE 1=1
    `;
    const params = [];

    // 'active' = still needs the office (open, or accepted and waiting for approval);
    // 'all' = no filter. Asking for nothing at all still means open, as before.
    if (status === 'active') {
      query += ` AND os.status IN ('open', 'claimed')`;
    } else if (status === 'all') {
      // no filter
    } else if (status) {
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
router.post('/', auth, requireAdmin, async (req, res) => {
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

// Post ONE visit of a schedule as an open shift.
// Body: { date: 'YYYY-MM-DD', visibleTo?: [caregiverId…], autoAssign?: bool, bonusAmount?, urgency? }
//
// This used to take the date from schedules.date, which a REPEATING shift doesn't
// have — the insert hit open_shifts.shift_date NOT NULL and failed, so "Mark
// Available" never worked for a weekly visit. The office now says which day.
router.post('/from-schedule/:scheduleId', auth, requireAdmin, async (req, res) => {
  const { scheduleId } = req.params;
  const { bonusAmount, urgency, date, visibleTo, autoAssign } = req.body || {};

  try {
    await ensureColumns();
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
    const day = date || (s.date ? ymd(s.date) : null);
    if (!day || !/^\d{4}-\d{2}-\d{2}$/.test(day)) {
      return res.status(400).json({ error: 'Pick the date of the visit to post.' });
    }

    // The visit must really happen that day (not cancelled, not off-pattern), and its
    // times may be overridden for that day — take them from the shared engine.
    const occ = await db.query(`
      WITH ${SCHEDULE_OCCURRENCES_CTE('occ')}
      SELECT occ.start_time::text AS start_time, occ.end_time::text AS end_time FROM occ WHERE occ.schedule_id = $3
    `, [day, day, scheduleId]);
    if (occ.rows.length === 0) {
      return res.status(400).json({ error: 'That shift has no visit on that date (it may be cancelled or not scheduled that day).' });
    }

    const dup = await db.query(
      `SELECT * FROM open_shifts WHERE schedule_id = $1 AND shift_date = $2 AND status IN ('open', 'claimed')`,
      [scheduleId, day]);
    if (dup.rows.length) {
      return res.status(409).json({ error: 'This visit is already posted as an open shift.', openShift: dup.rows[0] });
    }

    // Get rate
    const rate = await db.query(`
      SELECT rate_amount FROM referral_source_rates
      WHERE referral_source_id = $1
      ORDER BY effective_date DESC LIMIT 1
    `, [s.referral_source_id]);

    const visible = Array.isArray(visibleTo) && visibleTo.length ? visibleTo : null;
    const result = await db.query(`
      INSERT INTO open_shifts (client_id, schedule_id, shift_date, start_time, end_time, hourly_rate, bonus_amount, urgency, created_by,
                               visible_to, auto_assign, notes)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::uuid[], $11, $12)
      RETURNING *
    `, [s.client_id, scheduleId, day, occ.rows[0].start_time, occ.rows[0].end_time, rate.rows[0]?.rate_amount || 20,
        bonusAmount || 0, urgency || 'normal', req.user.id, visible, !!autoAssign, 'Posted by the office']);

    res.json(result.rows[0]);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Caregiver claims a shift
router.post('/:id/claim', auth, async (req, res) => {
  const { id } = req.params;
  const { notes } = req.body || {};
  // The caregiver app (CaregiverDashboard handlePickupShift) posts no body, so a
  // caregiver always claims for themselves. Only an admin may name someone else.
  const caregiverId = (req.user.role === 'admin' && req.body?.caregiverId) ? req.body.caregiverId : req.user.id;

  try {
    await ensureColumns();
    // Check shift is still open
    const shift = await db.query('SELECT * FROM open_shifts WHERE id = $1 AND status = $2', [id, 'open']);
    if (shift.rows.length === 0) {
      return res.status(400).json({ error: 'Shift is no longer available' });
    }
    const os = shift.rows[0];
    if (Array.isArray(os.visible_to) && !os.visible_to.includes(caregiverId)) {
      return res.status(403).json({ error: 'This shift was not offered to you' });
    }

    // Does the caregiver already have a visit at this time?
    //
    // This used to read `FROM schedules WHERE date = $2`, which only ever matches ONE-TIME
    // rows — a recurring shift has a NULL date. So the caregiver's regular weekly visits
    // did not block a claim at all, and they could be double-booked onto an open shift they
    // were already working. Expanding through the shared engine checks the occurrences that
    // actually fall on that date, recurring ones included, and skips cancelled ones (which
    // must NOT block a legitimate claim).
    const shiftDate = shift.rows[0].shift_date;
    const conflicts = await db.query(`
      WITH ${SCHEDULE_OCCURRENCES_CTE('occ')}
      SELECT occ.schedule_id
      FROM occ
      JOIN schedules s ON s.id = occ.schedule_id
      WHERE occ.caregiver_id = $3
        AND (occ.start_time, occ.end_time) OVERLAPS ($4::time, $5::time)
        AND COALESCE(s.status, '') != 'cancelled'
    `, [shiftDate, shiftDate, caregiverId, shift.rows[0].start_time, shift.rows[0].end_time]);

    if (conflicts.rows.length > 0) {
      return res.status(400).json({ error: 'You have a conflicting shift at this time' });
    }

    // Take it — only if still open. Two caregivers tapping at once used to both "claim"
    // it; now the first one wins and the other is told it's gone.
    const took = await db.query(`
      UPDATE open_shifts SET status = 'claimed', claimed_by = $1, claimed_at = NOW()
      WHERE id = $2 AND status = 'open'
      RETURNING id
    `, [caregiverId, id]);
    if (took.rows.length === 0) {
      return res.status(409).json({ error: 'Someone else just took this shift' });
    }

    // Create claim
    await db.query(`
      INSERT INTO open_shift_claims (open_shift_id, caregiver_id, notes)
      VALUES ($1, $2, $3)
    `, [id, caregiverId, notes]);

    const who = (await db.query(`SELECT first_name, last_name FROM users WHERE id = $1`, [caregiverId])).rows[0] || {};
    const cl = (await db.query(`SELECT first_name, last_name FROM clients WHERE id = $1`, [os.client_id])).rows[0] || {};
    const what = `${fmtDay(os.shift_date)} ${fmtHm(os.start_time)}–${fmtHm(os.end_time)} with ${clientShort(cl.first_name, cl.last_name)}`;
    const name = `${who.first_name || ''} ${who.last_name || ''}`.trim() || 'A caregiver';

    // The office offered it on "first to accept gets it": put it on her schedule now.
    if (os.auto_assign) {
      try {
        await assignShift(os, caregiverId, os.created_by || caregiverId);
        await db.query(`UPDATE open_shifts SET status = 'filled', approved_by = $1, approved_at = NOW() WHERE id = $2`,
          [os.created_by || null, id]);
        await db.query(`UPDATE open_shift_claims SET status = 'approved' WHERE open_shift_id = $1 AND caregiver_id = $2`, [id, caregiverId]);
        await notifyAdmins('open_shift_filled', `Open shift filled: ${name}`, `${name} accepted the open shift ${what}. It is on their schedule now.`);
        return res.json({ success: true, assigned: true, message: `It's yours — ${what} is on your schedule.` });
      } catch (e) {
        // Couldn't place it (e.g. the visit was cancelled meanwhile) — leave it claimed
        // for the office to sort out rather than lose the acceptance.
        console.error('[open-shifts] auto-assign failed:', e.message);
        await notifyAdmins('open_shift_claimed', `Open shift needs you: ${name}`,
          `${name} accepted ${what}, but it couldn't be put on their schedule automatically (${e.message}). Check Open Shifts.`);
        return res.json({ success: true, assigned: false, message: 'Shift accepted — the office will confirm it.' });
      }
    }

    await notifyAdmins('open_shift_claimed', `Open shift accepted: ${name}`, `${name} wants the open shift ${what}. Approve it in Schedule Hub → Staffing → Open Shifts.`);
    res.json({ success: true, assigned: false, message: 'Shift claimed - pending approval' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Admin approves claim
router.post('/:id/approve', auth, requireAdmin, async (req, res) => {
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

    // Authorization is advisory at approval time too — see
    // helpers/authorizationCheck.js. Report the balance, never withhold approval
    // from a caregiver who has already claimed the shift.
    let approveAuthWarnings = [];
    try {
      const { checkAuthorizationBalance } = require('../helpers/authorizationCheck');
      const startStr = typeof s.start_time === 'string' ? s.start_time : s.start_time.toISOString().slice(11,16);
      const endStr   = typeof s.end_time   === 'string' ? s.end_time   : s.end_time.toISOString().slice(11,16);
      const shiftHours = (new Date(`2000-01-01T${endStr}`) - new Date(`2000-01-01T${startStr}`)) / 3600000;
      const authCheck = await checkAuthorizationBalance(s.client_id, shiftHours);
      approveAuthWarnings = authCheck.warnings || [];
    } catch (e) {
      console.error('[openShifts approve] auth recheck failed:', e.message);
    }

    // Put the one visit on the claimer (see assignShift: per-occurrence for a recurring
    // pattern, and a called-out day comes back on the new caregiver).
    await assignShift(s, s.claimed_by, req.user.id);

    // Update open shift
    await db.query(`
      UPDATE open_shifts SET status = 'filled', approved_by = $1, approved_at = NOW()
      WHERE id = $2
    `, [req.user.id, id]);

    // Update claim
    await db.query(`
      UPDATE open_shift_claims SET status = 'approved' WHERE open_shift_id = $1 AND caregiver_id = $2
    `, [id, s.claimed_by]);

    res.json({ success: true, authWarnings: approveAuthWarnings });
  } catch (error) {
    res.status(error.status || 500).json({ error: error.message });
  }
});

// Reject claim
router.post('/:id/reject', auth, requireAdmin, async (req, res) => {
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
router.post('/:id/broadcast', auth, requireAdmin, async (req, res) => {
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
      SELECT u.id, u.phone 
      FROM users u
      LEFT JOIN caregiver_profiles cp ON cp.caregiver_id = u.id
      WHERE u.role = 'caregiver' AND u.is_active = true 
        AND (cp.sms_enabled = true OR cp.sms_enabled IS NULL)
        AND (cp.sms_open_shifts = true OR cp.sms_open_shifts IS NULL)
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

// Get caregivers available for a raw date/time slot, BEFORE an open_shift exists.
// Used by the SchedulingHub "Mark Available" flow to populate the caregiver picker
// before posting the open shift.
// Query: ?date=YYYY-MM-DD&startTime=HH:MM&endTime=HH:MM&excludeScheduleId=UUID
//
// Busy = a visit that day overlapping the slot, read through the shared engine. This
// used to check `schedules.date`, which only one-time rows have, so a caregiver's
// regular weekly visit at that hour never showed as a conflict. Approved time off
// (blackout dates) also counts as not available.
router.get('/caregivers-available', auth, requireAdmin, async (req, res) => {
  const { date, startTime, endTime, excludeScheduleId } = req.query;
  if (!date || !startTime || !endTime) {
    return res.status(400).json({ error: 'date, startTime, and endTime are required' });
  }
  try {
    const result = await db.query(`
      WITH ${SCHEDULE_OCCURRENCES_CTE('occ')}
      SELECT
        u.id, u.first_name, u.last_name, u.phone, u.email,
        EXISTS(
          SELECT 1 FROM occ
          WHERE occ.caregiver_id = u.id
            AND ((occ.start_time, occ.end_time) OVERLAPS ($3::time, $4::time))
            AND (occ.schedule_id IS DISTINCT FROM $5::uuid)
        ) AS has_conflict,
        EXISTS(
          SELECT 1 FROM caregiver_blackout_dates b
          WHERE b.caregiver_id = u.id AND $1::date BETWEEN b.start_date AND b.end_date
        ) AS time_off
      FROM users u
      WHERE u.role = 'caregiver' AND u.is_active = true
      ORDER BY u.first_name, u.last_name
    `, [date, date, startTime, endTime, excludeScheduleId || null]);

    res.json(result.rows.map(r => ({
      id: r.id,
      firstName: r.first_name,
      lastName: r.last_name,
      phone: r.phone,
      email: r.email,
      available: !r.has_conflict && !r.time_off,
      busy: r.has_conflict,
      timeOff: r.time_off,
      notified: false
    })));
  } catch (error) {
    console.error('Caregivers available error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get caregivers eligible for a specific open shift's time slot.
// Returns every active caregiver, marked with availability (no conflicting schedule)
// and whether they've already been notified about this shift.
router.get('/:id/eligible-caregivers', auth, requireAdmin, async (req, res) => {
  try {
    const shift = await db.query('SELECT * FROM open_shifts WHERE id = $1', [req.params.id]);
    if (shift.rows.length === 0) return res.status(404).json({ error: 'Shift not found' });
    const s = shift.rows[0];

    const result = await db.query(`
      SELECT
        u.id, u.first_name, u.last_name, u.phone, u.email,
        EXISTS(
          SELECT 1 FROM schedules sc
          WHERE sc.caregiver_id = u.id
            AND sc.date = $1
            AND ((sc.start_time, sc.end_time) OVERLAPS ($2::time, $3::time))
            AND COALESCE(sc.status, 'active') NOT IN ('cancelled')
            AND (sc.id IS DISTINCT FROM $5)
        ) AS has_conflict,
        EXISTS(
          SELECT 1 FROM open_shift_notifications osn
          WHERE osn.open_shift_id = $4 AND osn.caregiver_id = u.id
        ) AS already_notified
      FROM users u
      WHERE u.role = 'caregiver' AND u.is_active = true
      ORDER BY u.first_name, u.last_name
    `, [s.shift_date, s.start_time, s.end_time, s.id, s.schedule_id || null]);

    res.json(result.rows.map(r => ({
      id: r.id,
      firstName: r.first_name,
      lastName: r.last_name,
      phone: r.phone,
      email: r.email,
      available: !r.has_conflict,
      notified: r.already_notified
    })));
  } catch (error) {
    console.error('Eligible caregivers error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Notify a specific list of caregivers about an open shift.
// Body: { caregiverIds: [...], customMessage?: string, sms?: boolean }
// Creates an in-app notification for each, records the open_shift_notification, and
// (best-effort) sends push. With sms:true it also texts them — push reaches nobody
// today (no subscriptions on prod), so a text is how they actually find out.
router.post('/:id/notify', auth, requireAdmin, async (req, res) => {
  const { caregiverIds, customMessage, sms } = req.body;
  if (!Array.isArray(caregiverIds) || caregiverIds.length === 0) {
    return res.status(400).json({ error: 'caregiverIds is required and must be a non-empty array' });
  }

  try {
    const shift = await db.query(`
      SELECT os.*, c.first_name AS client_first, c.last_name AS client_last
      FROM open_shifts os
      JOIN clients c ON os.client_id = c.id
      WHERE os.id = $1
    `, [req.params.id]);
    if (shift.rows.length === 0) return res.status(404).json({ error: 'Shift not found' });
    const s = shift.rows[0];

    const dateStr = new Date(s.shift_date).toLocaleDateString('en-US', {
      weekday: 'short', month: 'short', day: 'numeric'
    });
    const timeStr = `${(s.start_time || '').slice(0, 5)}–${(s.end_time || '').slice(0, 5)}`;
    const bonusStr = parseFloat(s.bonus_amount) > 0 ? ` (+$${s.bonus_amount} bonus)` : '';
    const title = `Open Shift: ${s.client_first} ${s.client_last}`;
    const baseMessage = `${dateStr} ${timeStr}${bonusStr}. Open the app to claim it.`;
    const message = customMessage ? `${customMessage}\n\n${baseMessage}` : baseMessage;

    let notified = 0, texted = 0;
    const { sendText } = require('../jobs/overtimeAlerts');
    const smsBody = `CVHC: Open shift ${fmtDay(s.shift_date)} ${fmtHm(s.start_time)}-${fmtHm(s.end_time)} with ${clientShort(s.client_first, s.client_last)} Open the CVHC app > Open Shifts to accept.${customMessage ? ' ' + customMessage : ''}`;
    for (const cgId of caregiverIds) {
      if (sms) {
        try {
          const ph = (await db.query(`SELECT phone FROM users WHERE id = $1`, [cgId])).rows[0];
          if (ph && ph.phone && await sendText({ phone: ph.phone, body: smsBody, recipientType: 'caregiver', recipientId: cgId })) texted++;
        } catch (e) { console.error(`[open-shifts] text ${cgId}:`, e.message); }
      }
      try {
        await db.query(`
          INSERT INTO notifications (user_id, type, title, message)
          VALUES ($1, 'open_shift_offer', $2, $3)
        `, [cgId, title, message]);

        await db.query(`
          INSERT INTO open_shift_notifications (open_shift_id, caregiver_id, notification_type)
          VALUES ($1, $2, 'in_app')
          ON CONFLICT (open_shift_id, caregiver_id) DO NOTHING
        `, [req.params.id, cgId]);

        sendPush(cgId, {
          title,
          body: message,
          icon: '/icon-192.png',
          badge: '/badge-72.png',
          tag: `open-shift-${req.params.id}`,
          data: { type: 'open_shift_offer', openShiftId: req.params.id }
        }).catch(() => {});

        notified++;
      } catch (innerErr) {
        console.error(`Failed to notify caregiver ${cgId}:`, innerErr.message);
      }
    }

    await db.query(`UPDATE open_shifts SET broadcast_sent = true WHERE id = $1`, [req.params.id]);

    res.json({ success: true, notified, texted, total: caregiverIds.length });
  } catch (error) {
    console.error('Notify error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Cancel an open shift posting (admin changed their mind).
// If linked to a source schedule, the schedule remains assigned to its original caregiver.
router.post('/:id/cancel', auth, requireAdmin, async (req, res) => {
  try {
    const result = await db.query(`
      UPDATE open_shifts SET status = 'cancelled' WHERE id = $1 AND status IN ('open', 'claimed')
      RETURNING id, schedule_id
    `, [req.params.id]);
    if (result.rows.length === 0) {
      return res.status(400).json({ error: 'Shift cannot be cancelled (already filled or already cancelled)' });
    }
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get claims for a shift
router.get('/:id/claims', auth, requireAdmin, async (req, res) => {
  try {
    const result = await db.query(`
      SELECT osc.*, u.first_name, u.last_name, u.phone
      FROM open_shift_claims osc
      JOIN users u ON osc.caregiver_id = u.id
      WHERE osc.open_shift_id = $1
      ORDER BY osc.created_at
    `, [req.params.id]);
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
