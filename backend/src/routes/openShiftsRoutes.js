// routes/openShiftsRoutes.js
// Open Shift Board - Caregivers claim available shifts

const express = require('express');
const router = express.Router();
const db = require('../db');
const auth = require('../middleware/auth');

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
router.get('/:id/smart-fill-suggestions', auth, async (req, res) => {
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
router.post('/:id/smart-fill', auth, async (req, res) => {
  const { caregiverId } = req.body;
  if (!caregiverId) return res.status(400).json({ error: 'caregiverId required' });
  try {
    const shift = await db.query(`SELECT * FROM open_shifts WHERE id = $1`, [req.params.id]);
    if (shift.rows.length === 0) return res.status(404).json({ error: 'Open shift not found' });
    const s = shift.rows[0];
    if (s.status !== 'open') return res.status(409).json({ error: `Shift is ${s.status}, not open` });

    // Auth balance re-check (same shape as approve endpoint)
    try {
      const { checkAuthorizationBalance } = require('../helpers/authorizationCheck');
      const startStr = typeof s.start_time === 'string' ? s.start_time : s.start_time.toISOString().slice(11,16);
      const endStr   = typeof s.end_time   === 'string' ? s.end_time   : s.end_time.toISOString().slice(11,16);
      const shiftHours = (new Date(`2000-01-01T${endStr}`) - new Date(`2000-01-01T${startStr}`)) / 3600000;
      const authCheck = await checkAuthorizationBalance(s.client_id, shiftHours);
      if (!authCheck.allowed && req.query.force !== 'true') {
        return res.status(400).json({
          error: authCheck.error || 'Authorization exhausted',
          authorization: authCheck.authorization, type: 'authorization',
          hint: 'Pass ?force=true to assign anyway',
        });
      }
    } catch (e) { console.error('[openShifts smart-fill] auth recheck failed:', e.message); }

    // Same as approve: update existing schedule or create one
    if (s.schedule_id) {
      await db.query(`UPDATE schedules SET caregiver_id = $1, status = 'scheduled', updated_at = NOW() WHERE id = $2`,
        [caregiverId, s.schedule_id]);
    } else {
      await db.query(`
        INSERT INTO schedules (client_id, caregiver_id, date, start_time, end_time, care_type_id, status, schedule_type)
        VALUES ($1, $2, $3, $4, $5, $6, 'scheduled', 'one-time')
      `, [s.client_id, caregiverId, s.shift_date, s.start_time, s.end_time, s.care_type_id]);
    }
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

    res.json({ success: true, openShiftId: s.id, assignedTo: caregiverId });
  } catch (error) {
    console.error('[openShifts smart-fill]', error);
    res.status(500).json({ error: error.message });
  }
});

// Get all open shifts
router.get('/available', auth, async (req, res) => {
  try {
    const result = await db.query(`
      SELECT os.*, c.first_name as client_first_name, c.last_name as client_last_name
      FROM open_shifts os
      LEFT JOIN clients c ON os.client_id = c.id
      WHERE os.status = 'open' 
        AND (os.shift_date >= CURRENT_DATE OR os.shift_date IS NULL)
      ORDER BY os.shift_date, os.start_time
    `);
    res.json(result.rows);
  } catch (error) {
    console.error('Get available shifts error:', error);
    res.status(500).json({ error: error.message });
  }
});

router.get('/', auth, async (req, res) => {
  const { status, startDate, endDate, urgency } = req.query;
  try {
    let query = `
      SELECT os.*, 
        c.first_name as client_first_name, c.last_name as client_last_name,
        c.address as client_address, c.city as client_city,
        ct.name as care_type_name,
        u.first_name as claimed_by_first, u.last_name as claimed_by_last
      FROM open_shifts os
      JOIN clients c ON os.client_id = c.id
      LEFT JOIN care_types ct ON os.care_type_id = ct.id
      LEFT JOIN users u ON os.claimed_by = u.id
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
    `, [s.client_id, scheduleId, s.date, s.start_time, s.end_time, s.care_type_id, rate.rows[0]?.rate_amount || 20, bonusAmount || 0, urgency || 'normal', req.user.id]);

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

    // Check caregiver availability — must also filter is_active = true so
    // soft-deleted schedules don't falsely block a legitimate claim.
    const conflicts = await db.query(`
      SELECT id FROM schedules
      WHERE caregiver_id = $1
      AND date = $2
      AND ((start_time, end_time) OVERLAPS ($3::time, $4::time))
      AND is_active = true
      AND COALESCE(status, '') != 'cancelled'
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

    // Re-check authorization at approval time. Auth could have been consumed
    // between claim creation and approval; without this re-check, an approved
    // shift could push the client over their authorized units.
    try {
      const { checkAuthorizationBalance } = require('../helpers/authorizationCheck');
      const startStr = typeof s.start_time === 'string' ? s.start_time : s.start_time.toISOString().slice(11,16);
      const endStr   = typeof s.end_time   === 'string' ? s.end_time   : s.end_time.toISOString().slice(11,16);
      const shiftHours = (new Date(`2000-01-01T${endStr}`) - new Date(`2000-01-01T${startStr}`)) / 3600000;
      const authCheck = await checkAuthorizationBalance(s.client_id, shiftHours);
      if (!authCheck.allowed && req.query.force !== 'true') {
        return res.status(400).json({
          error: authCheck.error || 'Authorization exhausted',
          authorization: authCheck.authorization,
          type: 'authorization',
          hint: 'Pass ?force=true to approve anyway',
        });
      }
    } catch (e) {
      console.error('[openShifts approve] auth recheck failed:', e.message);
    }

    // Create or update schedule
    if (s.schedule_id) {
      await db.query(`
        UPDATE schedules SET caregiver_id = $1, status = 'scheduled' WHERE id = $2
      `, [s.claimed_by, s.schedule_id]);
    } else {
      await db.query(`
        INSERT INTO schedules (client_id, caregiver_id, date, start_time, end_time, care_type_id, status)
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
router.get('/caregivers-available', auth, async (req, res) => {
  const { date, startTime, endTime, excludeScheduleId } = req.query;
  if (!date || !startTime || !endTime) {
    return res.status(400).json({ error: 'date, startTime, and endTime are required' });
  }
  try {
    const result = await db.query(`
      SELECT
        u.id, u.first_name, u.last_name, u.phone, u.email,
        EXISTS(
          SELECT 1 FROM schedules sc
          WHERE sc.caregiver_id = u.id
            AND sc.date = $1
            AND ((sc.start_time, sc.end_time) OVERLAPS ($2::time, $3::time))
            AND COALESCE(sc.status, 'active') NOT IN ('cancelled')
            AND (sc.id IS DISTINCT FROM $4)
        ) AS has_conflict
      FROM users u
      WHERE u.role = 'caregiver' AND u.is_active = true
      ORDER BY u.first_name, u.last_name
    `, [date, startTime, endTime, excludeScheduleId || null]);

    res.json(result.rows.map(r => ({
      id: r.id,
      firstName: r.first_name,
      lastName: r.last_name,
      phone: r.phone,
      email: r.email,
      available: !r.has_conflict,
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
router.get('/:id/eligible-caregivers', auth, async (req, res) => {
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
// Body: { caregiverIds: [...], customMessage?: string }
// Creates an in-app notification for each, records the open_shift_notification, and (best-effort) sends push.
router.post('/:id/notify', auth, async (req, res) => {
  const { caregiverIds, customMessage } = req.body;
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

    let notified = 0;
    for (const cgId of caregiverIds) {
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

    res.json({ success: true, notified, total: caregiverIds.length });
  } catch (error) {
    console.error('Notify error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Cancel an open shift posting (admin changed their mind).
// If linked to a source schedule, the schedule remains assigned to its original caregiver.
router.post('/:id/cancel', auth, async (req, res) => {
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
router.get('/:id/claims', auth, async (req, res) => {
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
