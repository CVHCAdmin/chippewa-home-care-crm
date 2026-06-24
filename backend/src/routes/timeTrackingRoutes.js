// routes/timeTrackingRoutes.js
const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const db = require('../db');
const { verifyToken, requireAdmin, auditLog } = require('../middleware/shared');

// A single shift longer than this is almost certainly a missed clock-out, not
// real worked time. Past this ceiling we refuse to silently auto-bill the full
// duration: the entry is flagged for admin review and its billable time is
// capped (to the scheduled allotment when known, otherwise to the ceiling).
// This matters most for private-pay clients, which otherwise bill actual
// duration with no cap and no approval gate — the failure mode that let one
// caregiver's forgotten clock-outs accrue 200+ phantom billable hours.
const MAX_SHIFT_MINUTES = 16 * 60; // 16h

// Apply the excessive-duration guard to a computed billing decision. Mutates
// nothing; returns the (possibly adjusted) values. `base` is whatever the
// payer-specific rules already decided.
function applyExcessiveDurationGuard({ durationMinutes, allottedMinutes, billableMinutes, needsApproval, approvalReason }) {
  if (durationMinutes <= MAX_SHIFT_MINUTES) {
    return { billableMinutes, needsApproval, approvalReason };
  }
  const cap = allottedMinutes != null ? allottedMinutes : MAX_SHIFT_MINUTES;
  return {
    billableMinutes: Math.min(billableMinutes, cap),
    needsApproval: true,
    approvalReason: approvalReason ? `${approvalReason},excessive_duration` : 'excessive_duration',
  };
}

// Lazy-load sendPushToUser to avoid circular require with pushNotificationRoutes.
// Gracefully no-ops when VAPID keys aren't configured in env.
let _sendPush = null;
const sendPush = (...args) => {
  if (!_sendPush) {
    try { _sendPush = require('./pushNotificationRoutes').sendPushToUser; } catch { _sendPush = async () => {}; }
  }
  return _sendPush(...args);
};

// GET /api/time-entries/active
router.get('/active', verifyToken, async (req, res) => {
  try {
    const result = await db.query(
      `SELECT te.*, c.first_name as client_first_name, c.last_name as client_last_name
       FROM time_entries te JOIN clients c ON te.client_id = c.id
       WHERE te.caregiver_id = $1 AND te.end_time IS NULL ORDER BY te.start_time DESC LIMIT 1`,
      [req.user.id]
    );
    if (result.rows.length === 0) return res.json(null);
    const entry = result.rows[0];
    res.json({ id: entry.id, client_id: entry.client_id, start_time: entry.start_time, client_name: `${entry.client_first_name} ${entry.client_last_name}` });
  } catch (error) { res.status(500).json({ error: error.message }); }
});

// GET /api/time-entries/recent
router.get('/recent', verifyToken, async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 10;
    const result = await db.query(
      `SELECT te.*, c.first_name as client_first_name, c.last_name as client_last_name
       FROM time_entries te JOIN clients c ON te.client_id = c.id
       WHERE te.caregiver_id = $1 AND te.end_time IS NOT NULL ORDER BY te.start_time DESC LIMIT $2`,
      [req.user.id, limit]
    );
    res.json(result.rows.map(e => ({
      id: e.id, client_id: e.client_id, start_time: e.start_time, end_time: e.end_time, notes: e.notes,
      hours_worked: e.duration_minutes ? (e.duration_minutes / 60).toFixed(2) : null,
      client_name: `${e.client_first_name} ${e.client_last_name}`
    })));
  } catch (error) { res.status(500).json({ error: error.message }); }
});

// GET /api/time-entries/check-warnings
router.post('/check-warnings', verifyToken, async (req, res) => {
  try {
    const { timeEntryId } = req.body;
    const entry = await db.query(`
      SELECT te.*, te.allotted_minutes, te.start_time, c.first_name as client_first, c.last_name as client_last
      FROM time_entries te JOIN clients c ON te.client_id = c.id
      WHERE te.id = $1 AND te.caregiver_id = $2 AND te.is_complete = false
    `, [timeEntryId, req.user.id]);
    if (!entry.rows[0] || !entry.rows[0].allotted_minutes) return res.json({ warning: false });
    const te = entry.rows[0];
    const minutesElapsed = (new Date() - new Date(te.start_time)) / 60000;
    const minutesRemaining = te.allotted_minutes - minutesElapsed;
    if (minutesRemaining >= 14 && minutesRemaining <= 16) {
      try {
        const { sendPushToUser } = require('./pushNotificationRoutes');
        const scheduledEnd = new Date(new Date(te.start_time).getTime() + te.allotted_minutes * 60000);
        const endTime = scheduledEnd.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
        sendPushToUser(req.user.id, { title: '⏰ 15-Minute Warning', body: `Shift with ${te.client_first} ${te.client_last} ends at ${endTime}. Start wrapping up!`, icon: '/icon-192.png', tag: 'shift-warning-15min', data: { type: 'shift_warning', timeEntryId } }).catch(e => console.error('[Push 15min warning]', e.message));
      } catch(e) { console.error('[Push setup]', e.message); }
      return res.json({ warning: true, minutesRemaining: Math.round(minutesRemaining), message: '15 minutes remaining — start wrapping up' });
    }
    if (minutesElapsed > te.allotted_minutes + 5) {
      return res.json({ warning: true, overTime: true, minutesOver: Math.round(minutesElapsed - te.allotted_minutes), message: 'Over scheduled time — please clock out' });
    }
    res.json({ warning: false, minutesRemaining: Math.round(minutesRemaining), minutesElapsed: Math.round(minutesElapsed) });
  } catch (error) { res.status(500).json({ error: error.message }); }
});

// GET /api/time-entries/caregiver-history/:caregiverId
router.get('/caregiver-history/:caregiverId', verifyToken, async (req, res) => {
  try {
    const { startDate, endDate, limit = 50 } = req.query;
    const params = [req.params.caregiverId, limit];
    let dateFilters = '';
    if (startDate) { params.push(startDate); dateFilters += ` AND te.start_time >= $${params.length}::timestamptz`; }
    if (endDate) { params.push(endDate); dateFilters += ` AND te.start_time <= $${params.length}::timestamptz`; }
    const result = await db.query(
      `SELECT te.*,
        CASE WHEN te.end_time IS NOT NULL
          THEN ROUND((EXTRACT(EPOCH FROM (te.end_time - te.start_time)) / 3600.0)::numeric, 2)
          ELSE NULL END as hours,
        CASE WHEN te.end_time IS NOT NULL
          THEN ROUND((EXTRACT(EPOCH FROM (te.end_time - te.start_time)) / 3600.0)::numeric, 2)
          ELSE NULL END as duration_hours,
        CASE WHEN te.billable_minutes IS NOT NULL
          THEN ROUND((te.billable_minutes / 60.0)::numeric, 2)
          ELSE NULL END as billable_hours,
        c.first_name as client_first_name, c.last_name as client_last_name,
        c.address as client_address, c.city as client_city,
        (SELECT COUNT(*) FROM gps_tracking gt WHERE gt.time_entry_id = te.id) as gps_point_count
       FROM time_entries te LEFT JOIN clients c ON te.client_id = c.id
       WHERE te.caregiver_id = $1${dateFilters}
       ORDER BY te.start_time DESC LIMIT $2`,
      params
    );
    res.json(result.rows);
  } catch (error) { res.status(500).json({ error: error.message }); }
});

// GET /api/time-entries/caregiver/:caregiverId
router.get('/caregiver/:caregiverId', verifyToken, async (req, res) => {
  try {
    const result = await db.query(
      `SELECT te.*,
        CASE WHEN te.end_time IS NOT NULL
          THEN ROUND((EXTRACT(EPOCH FROM (te.end_time - te.start_time)) / 3600.0)::numeric, 2)
          ELSE NULL END as hours,
        c.first_name as client_first_name, c.last_name as client_last_name
       FROM time_entries te JOIN clients c ON te.client_id = c.id
       WHERE te.caregiver_id = $1 ORDER BY te.start_time DESC`, [req.params.caregiverId]
    );
    res.json(result.rows);
  } catch (error) { res.status(500).json({ error: error.message }); }
});

// GET /api/time-entries/discrepancies (mounted under /api/payroll in server)
// — kept here as /api/time-entries/discrepancies
router.get('/discrepancies', verifyToken, requireAdmin, async (req, res) => {
  try {
    const { startDate, endDate, minDiscrepancy = 5 } = req.query;
    const start = startDate || new Date(Date.now() - 30*86400000).toISOString().split('T')[0];
    const end = endDate || new Date().toISOString().split('T')[0];
    const result = await db.query(`
      SELECT te.id, te.start_time, te.end_time, te.duration_minutes, te.allotted_minutes, te.billable_minutes, te.discrepancy_minutes,
        ROUND(te.duration_minutes::numeric/60,2) as actual_hours,
        ROUND(COALESCE(te.allotted_minutes,te.duration_minutes)::numeric/60,2) as allotted_hours,
        ROUND(te.billable_minutes::numeric/60,2) as billable_hours,
        ROUND((te.duration_minutes-COALESCE(te.allotted_minutes,te.duration_minutes))::numeric/60,2) as discrepancy_hours,
        u.first_name as caregiver_first, u.last_name as caregiver_last, u.default_pay_rate,
        ROUND(te.billable_minutes::numeric/60*u.default_pay_rate,2) as billable_pay,
        ROUND(te.duration_minutes::numeric/60*u.default_pay_rate,2) as actual_pay,
        ROUND((te.duration_minutes-COALESCE(te.allotted_minutes,te.duration_minutes))::numeric/60*u.default_pay_rate,2) as overage_cost,
        c.first_name as client_first, c.last_name as client_last
      FROM time_entries te JOIN users u ON te.caregiver_id=u.id JOIN clients c ON te.client_id=c.id
      WHERE te.is_complete=true AND te.start_time>=$1::date AND te.start_time<$2::date+INTERVAL '1 day'
        AND te.allotted_minutes IS NOT NULL AND ABS(COALESCE(te.discrepancy_minutes,0))>=$3
      ORDER BY ABS(COALESCE(te.discrepancy_minutes,0)) DESC
    `, [start, end, parseInt(minDiscrepancy)]);
    const totals = result.rows.reduce((acc, r) => {
      acc.totalShifts++;
      acc.totalActualHours += parseFloat(r.actual_hours||0);
      acc.totalAllottedHours += parseFloat(r.allotted_hours||0);
      acc.totalBillableHours += parseFloat(r.billable_hours||0);
      acc.totalOverageCost += parseFloat(r.overage_cost||0);
      if (parseFloat(r.discrepancy_hours) > 0) acc.overageCount++;
      if (parseFloat(r.discrepancy_hours) < 0) acc.underageCount++;
      return acc;
    }, { totalShifts:0, totalActualHours:0, totalAllottedHours:0, totalBillableHours:0, totalOverageCost:0, overageCount:0, underageCount:0 });
    res.json({ discrepancies: result.rows, totals, period: { start, end } });
  } catch (error) { res.status(500).json({ error: error.message }); }
});

// GET /api/time-entries
router.get('/', verifyToken, async (req, res) => {
  try {
    const result = await db.query(
      `SELECT te.*,
        CASE WHEN te.end_time IS NOT NULL
          THEN ROUND((EXTRACT(EPOCH FROM (te.end_time - te.start_time)) / 3600.0)::numeric, 2)
          ELSE NULL END as hours,
        u.first_name, u.last_name, c.first_name as client_first_name, c.last_name as client_last_name
       FROM time_entries te JOIN users u ON te.caregiver_id=u.id JOIN clients c ON te.client_id=c.id
       ORDER BY te.start_time DESC`
    );
    res.json(result.rows);
  } catch (error) { res.status(500).json({ error: error.message }); }
});

// POST /api/time-entries/clock-in
router.post('/clock-in', verifyToken, async (req, res) => {
  try {
    const { clientId, latitude, longitude, scheduleId, autoTransition } = req.body;
    const entryId = uuidv4();
    let allottedMinutes = null, linkedScheduleId = scheduleId || null;

    // Fetch existing open entries (if any) for this caregiver, joined with
    // client/referral-source so we can apply the correct billing rule when
    // auto-closing (see clock-out for the rule).
    const openEntries = await db.query(
      `SELECT te.id, te.start_time, te.client_id, te.allotted_minutes,
        EXTRACT(EPOCH FROM (NOW() - te.start_time)) as seconds_elapsed,
        c.is_private_pay,
        rs.payer_type as referral_payer_type
       FROM time_entries te
       LEFT JOIN clients c ON te.client_id = c.id
       LEFT JOIN referral_sources rs ON c.referral_source_id = rs.id
       WHERE te.caregiver_id = $1 AND te.end_time IS NULL`,
      [req.user.id]
    );

    // Idempotent clock-in: if there's an open entry for the same client
    // started in the last 30 seconds, treat this as a duplicate submit and
    // return the existing entry instead of auto-closing + recreating.
    const DUPLICATE_WINDOW_SECONDS = 30;
    const MICRO_DURATION_SECONDS = 10;
    const dupe = openEntries.rows.find(e =>
      e.client_id === clientId && Number(e.seconds_elapsed) < DUPLICATE_WINDOW_SECONDS
    );
    if (dupe) {
      const existing = await db.query(
        `SELECT id, client_id, start_time FROM time_entries WHERE id = $1`, [dupe.id]
      );
      return res.status(200).json({ ...existing.rows[0], duplicate: true });
    }

    for (const openEntry of openEntries.rows) {
      const secondsElapsed = Number(openEntry.seconds_elapsed) || 0;

      // Drop micro-duration auto-closes: if the caregiver is switching
      // clients within MICRO_DURATION_SECONDS of clocking in, the first
      // clock-in was almost certainly a mistake (wrong client tap, double
      // tap, etc.). Delete the spurious entry instead of leaving a
      // zero-minute junk row.
      if (secondsElapsed < MICRO_DURATION_SECONDS) {
        await db.query(`DELETE FROM gps_tracking WHERE time_entry_id = $1`, [openEntry.id]);
        await db.query(`DELETE FROM time_entries WHERE id = $1`, [openEntry.id]);
        await auditLog(req.user.id, 'DELETE', 'time_entries', openEntry.id, null, { reason: 'spurious_auto_close', seconds_elapsed: secondsElapsed });
        continue;
      }

      const VARIANCE_GRACE_MINUTES = 7;
      const durationMinutes = Math.round((new Date() - new Date(openEntry.start_time)) / 60000);
      const allottedMinutes = openEntry.allotted_minutes;
      const isPrivatePay = openEntry.is_private_pay === true || openEntry.referral_payer_type === 'private_pay';

      let billableMinutes;
      let needsApproval = false;
      let approvalReason = null;
      if (isPrivatePay) {
        billableMinutes = durationMinutes;
      } else if (allottedMinutes == null) {
        billableMinutes = durationMinutes;
        needsApproval = true;
        approvalReason = 'unscheduled';
      } else {
        billableMinutes = allottedMinutes;
        if (Math.abs(durationMinutes - allottedMinutes) > VARIANCE_GRACE_MINUTES) {
          needsApproval = true;
          approvalReason = 'time_variance';
        }
      }

      // Auto-close happens when the caregiver forgot to clock out, so this is
      // the most likely path to an inflated duration — guard it.
      ({ billableMinutes, needsApproval, approvalReason } = applyExcessiveDurationGuard({
        durationMinutes, allottedMinutes, billableMinutes, needsApproval, approvalReason,
      }));

      const discrepancyMinutes = allottedMinutes != null ? durationMinutes - allottedMinutes : null;

      await db.query(
        `UPDATE time_entries SET end_time = NOW(), duration_minutes = $1, is_complete = true,
          discrepancy_minutes = $2, billable_minutes = $3,
          needs_approval = $6, approval_reason = $7,
          notes = CASE WHEN notes IS NULL OR notes = '' THEN $5
                       ELSE notes || ' | ' || $5 END,
          updated_at = NOW()
         WHERE id = $4`,
        [durationMinutes, discrepancyMinutes, billableMinutes, openEntry.id,
          autoTransition ? '(Auto-transition: schedule shift change)' : '(Auto-closed: caregiver clocked into new client)',
          needsApproval, approvalReason]
      );
      await auditLog(req.user.id, 'UPDATE', 'time_entries', openEntry.id, null, { auto_closed: true, duration_minutes: durationMinutes });
      // Generate EVV for auto-closed entry
      try { const { createEVVFromTimeEntry } = require('./sandataRoutes'); createEVVFromTimeEntry(openEntry.id).catch(e => console.error('[EVV auto-close]', e.message)); } catch(e) {}
    }
    try {
      const today = new Date();
      const sched = await db.query(`
        SELECT id, start_time, end_time FROM schedules
        WHERE caregiver_id=$1 AND client_id=$2 AND is_active=true
          AND (day_of_week=$3 OR (date IS NOT NULL AND date::date=$4::date))
        ORDER BY date DESC NULLS LAST LIMIT 1
      `, [req.user.id, clientId, today.getDay(), today.toISOString().split('T')[0]]);
      if (sched.rows[0]) {
        linkedScheduleId = linkedScheduleId || sched.rows[0].id;
        if (sched.rows[0].start_time && sched.rows[0].end_time) {
          const [sh, sm] = sched.rows[0].start_time.split(':').map(Number);
          const [eh, em] = sched.rows[0].end_time.split(':').map(Number);
          allottedMinutes = (eh*60+em) - (sh*60+sm);
        }
      }
    } catch(e) {}
    const result = await db.query(
      `INSERT INTO time_entries (id, caregiver_id, client_id, start_time, clock_in_location, schedule_id, allotted_minutes)
       VALUES ($1,$2,$3,NOW(),$4,$5,$6) RETURNING *`,
      [entryId, req.user.id, clientId, latitude && longitude ? JSON.stringify({ lat: latitude, lng: longitude }) : null, linkedScheduleId, allottedMinutes]
    );
    await auditLog(req.user.id, 'CREATE', 'time_entries', entryId, null, result.rows[0]);
    try {
      const { sendPushToUser } = require('./pushNotificationRoutes');
      let clientName = null;
      if (clientId) { const cl = await db.query('SELECT first_name, last_name FROM clients WHERE id=$1', [clientId]); if (cl.rows[0]) clientName = `${cl.rows[0].first_name} ${cl.rows[0].last_name}`; }
      const startTimeFormatted = new Date(result.rows[0].start_time).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
      sendPushToUser(req.user.id, { title: '✅ Clocked In', body: `You are clocked in${clientName ? ` for ${clientName}` : ''}. Started at ${startTimeFormatted}.`, icon: '/icon-192.png', tag: `clock-in-${entryId}`, data: { type: 'clock_in', timeEntryId: entryId } }).catch(e => console.error('[Push clock-in]', e.message));
    } catch(e) { console.error('[Push setup]', e.message); }
    res.status(201).json({ id: result.rows[0].id, client_id: result.rows[0].client_id, start_time: result.rows[0].start_time });
  } catch (error) { res.status(500).json({ error: error.message }); }
});

// POST /api/time-entries/:id/clock-out
//
// Billing rule:
//   - Private pay clients: billable = actual duration (open/flexible)
//   - All other payers (Medicaid, MCO, VA, etc.): billable = scheduled
//     (allotted_minutes); time variance is tracked but never changes pay
//   - Flag for admin approval when:
//       a) no schedule linked (unscheduled visit), OR
//       b) |actual - allotted| > 7 minutes (Medicaid grace window)
router.post('/:id/clock-out', verifyToken, async (req, res) => {
  try {
    const VARIANCE_GRACE_MINUTES = 7;
    const { latitude, longitude, notes } = req.body;
    const timeEntry = await db.query(
      `SELECT te.*,
        c.first_name as client_first_name, c.last_name as client_last_name,
        c.is_private_pay, c.referral_source_id,
        rs.payer_type as referral_payer_type
       FROM time_entries te
       LEFT JOIN clients c ON te.client_id=c.id
       LEFT JOIN referral_sources rs ON c.referral_source_id = rs.id
       WHERE te.id=$1`, [req.params.id]
    );
    if (timeEntry.rows.length === 0) return res.status(404).json({ error: 'Time entry not found' });
    const entry = timeEntry.rows[0];

    const durationSeconds = (new Date() - new Date(entry.start_time)) / 1000;
    const durationMinutes = Math.round(durationSeconds / 60);
    const allottedMinutes = entry.allotted_minutes;
    const isPrivatePay = entry.is_private_pay === true || entry.referral_payer_type === 'private_pay';

    let billableMinutes;
    let needsApproval = false;
    let approvalReason = null;

    // Zero-duration guard: clock-in then immediately clock-out (< 60s) is
    // almost always an accidental double-tap or wrong-client tap. Mark for
    // admin review and pay 0 until reviewed — never silently complete a
    // 0-hour shift as if it counted.
    if (durationSeconds < 60) {
      billableMinutes = 0;
      needsApproval = true;
      approvalReason = 'zero_duration';
    } else if (isPrivatePay) {
      // Private pay: caregiver is paid for actual time, no schedule constraint
      billableMinutes = durationMinutes;
    } else if (allottedMinutes == null) {
      // Non-private, no schedule linked: park billable at actual duration but
      // flag for admin review — payroll should not auto-process until approved
      billableMinutes = durationMinutes;
      needsApproval = true;
      approvalReason = 'unscheduled';
    } else {
      // Non-private with a schedule: pay the scheduled amount, no more, no less
      billableMinutes = allottedMinutes;
      const variance = Math.abs(durationMinutes - allottedMinutes);
      if (variance > VARIANCE_GRACE_MINUTES) {
        needsApproval = true;
        approvalReason = 'time_variance';
      }
    }

    // Backstop: an implausibly long shift (missed clock-out) must not silently
    // auto-bill its full duration — flag it and cap the billable time.
    ({ billableMinutes, needsApproval, approvalReason } = applyExcessiveDurationGuard({
      durationMinutes, allottedMinutes, billableMinutes, needsApproval, approvalReason,
    }));

    const discrepancyMinutes = allottedMinutes != null ? durationMinutes - allottedMinutes : null;

    const result = await db.query(
      `UPDATE time_entries SET end_time=NOW(), clock_out_location=$1, duration_minutes=$2, is_complete=true,
        notes=$3, discrepancy_minutes=$4, billable_minutes=$5,
        needs_approval=$7, approval_reason=$8,
        updated_at=NOW() WHERE id=$6 RETURNING *`,
      [latitude && longitude ? JSON.stringify({ lat: latitude, lng: longitude }) : null,
       durationMinutes, notes || null, discrepancyMinutes, billableMinutes, req.params.id,
       needsApproval, approvalReason]
    );
    await auditLog(req.user.id, 'UPDATE', 'time_entries', req.params.id, null, result.rows[0]);
    try {
      const { sendPushToUser } = require('./pushNotificationRoutes');
      const clientName = timeEntry.rows[0].client_first_name ? `${timeEntry.rows[0].client_first_name} ${timeEntry.rows[0].client_last_name}` : null;
      const durationStr = durationMinutes >= 60 ? `${Math.floor(durationMinutes/60)}h ${durationMinutes%60}m` : `${durationMinutes}m`;
      sendPushToUser(req.user.id, { title: '🕐 Clocked Out', body: `Shift complete${clientName ? ` — ${clientName}` : ''}. Duration: ${durationStr}.`, icon: '/icon-192.png', tag: `clock-out-${req.params.id}`, data: { type: 'clock_out' } }).catch(e => console.error('[Push clock-out]', e.message));
    } catch(e) { console.error('[Push setup]', e.message); }
    try { const { createEVVFromTimeEntry } = require('./sandataRoutes'); createEVVFromTimeEntry(req.params.id).catch(e => console.error('[EVV auto-create]', e.message)); } catch(e) { console.error('[EVV require]', e.message); }
    res.json(result.rows[0]);
  } catch (error) { res.status(500).json({ error: error.message }); }
});

// GET /api/time-entries/gps-failures-recent
// Admin-only: list recent GPS block events (last hour by default) so the
// admin dashboard can surface a banner showing who's currently stuck.
router.get('/gps-failures-recent', verifyToken, requireAdmin, async (req, res) => {
  try {
    const minutes = Math.max(1, Math.min(parseInt(req.query.minutes) || 60, 240));
    const result = await db.query(
      `SELECT id, title, message, created_at
       FROM notifications
       WHERE user_id = $1
         AND type = 'gps_failure'
         AND COALESCE(status, 'new') = 'new'
         AND created_at > NOW() - ($2 || ' minutes')::interval
       ORDER BY created_at DESC
       LIMIT 50`,
      [req.user.id, String(minutes)]
    );
    res.json({ count: result.rows.length, failures: result.rows, windowMinutes: minutes });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/time-entries/gps-failure
// Logged by the caregiver dashboard when a clock-in/out is blocked because
// GPS is unavailable. Notifies every active admin so they can help.
router.post('/gps-failure', verifyToken, async (req, res) => {
  const { action, errorCode, clientId } = req.body || {};
  try {
    const me = await db.query('SELECT first_name, last_name FROM users WHERE id = $1', [req.user.id]);
    const caregiverName = me.rows[0]
      ? `${me.rows[0].first_name || ''} ${me.rows[0].last_name || ''}`.trim() || 'A caregiver'
      : 'A caregiver';

    let clientName = '';
    if (clientId) {
      const c = await db.query('SELECT first_name, last_name FROM clients WHERE id = $1', [clientId]);
      if (c.rows[0]) clientName = ` (client: ${c.rows[0].first_name} ${c.rows[0].last_name})`;
    }

    const codeNames = { 1: 'location permission denied', 2: 'no GPS signal', 3: 'GPS timeout' };
    const reason = codeNames[errorCode] || 'unknown GPS error';
    const actionName = action === 'clock-out' ? 'clock out' : 'clock in';

    const title = `📍 GPS blocked: ${caregiverName}`;
    const message = `${caregiverName} tried to ${actionName}${clientName} but GPS failed (${reason}). Check their phone's Location settings.`;

    const admins = await db.query(`SELECT id FROM users WHERE role = 'admin' AND is_active = true`);
    for (const admin of admins.rows) {
      try {
        await db.query(`
          INSERT INTO notifications (user_id, type, title, message)
          VALUES ($1, 'gps_failure', $2, $3)
        `, [admin.id, title, message]);

        sendPush(admin.id, {
          title,
          body: message,
          icon: '/icon-192.png',
          badge: '/badge-72.png',
          tag: `gps-failure-${req.user.id}`,
          data: { type: 'gps_failure', caregiverId: req.user.id }
        }).catch(() => {});
      } catch (innerErr) {
        console.error(`gps-failure notify admin ${admin.id}:`, innerErr.message);
      }
    }

    res.json({ success: true, alerted: admins.rows.length });
  } catch (error) {
    console.error('GPS failure log error:', error);
    res.status(500).json({ error: error.message });
  }
});

// POST /api/time-entries/:id/admin-force-clockout
// Admin-only: close an active time entry when the caregiver can't clock out
// themselves (GPS failure, dead phone, etc.). Records the admin as the
// actor in audit_log and flags the entry for approval.
router.post('/:id/admin-force-clockout', verifyToken, requireAdmin, async (req, res) => {
  try {
    const { reason, endTime, scheduled } = req.body || {};
    const entry = await db.query(
      `SELECT te.*, c.is_private_pay, c.referral_source_id, rs.payer_type as referral_payer_type
       FROM time_entries te
       LEFT JOIN clients c ON te.client_id = c.id
       LEFT JOIN referral_sources rs ON c.referral_source_id = rs.id
       WHERE te.id = $1`,
      [req.params.id]
    );
    if (entry.rows.length === 0) return res.status(404).json({ error: 'Time entry not found' });
    const e = entry.rows[0];
    if (e.end_time) return res.status(400).json({ error: 'Time entry is already closed' });

    const start = new Date(e.start_time);
    const allottedMinutes = e.allotted_minutes;
    const isPrivatePay = e.is_private_pay === true || e.referral_payer_type === 'private_pay';

    // Closing time: scheduled allotment, an explicit time the admin picked, or now.
    let end = new Date();
    if (scheduled) {
      if (allottedMinutes == null) {
        return res.status(400).json({ error: 'This shift has no scheduled amount — pick an end time or use Now.' });
      }
      end = new Date(start.getTime() + allottedMinutes * 60000);
    } else if (endTime) {
      end = new Date(endTime);
      if (isNaN(end.getTime())) return res.status(400).json({ error: 'Invalid end time.' });
      if (end <= start) return res.status(400).json({ error: 'End time must be after the clock-in time.' });
    }

    const durationMinutes = Math.round((end - start) / 60000);

    let billableMinutes;
    if (scheduled && allottedMinutes != null) billableMinutes = allottedMinutes; // close at scheduled amount
    else if (isPrivatePay) billableMinutes = durationMinutes;
    else if (allottedMinutes == null) billableMinutes = durationMinutes;
    else billableMinutes = allottedMinutes;

    const discrepancyMinutes = allottedMinutes != null ? durationMinutes - allottedMinutes : null;
    const how = scheduled ? 'scheduled amount' : (endTime ? `ended ${end.toLocaleString('en-US', { timeZone: 'America/Chicago' })}` : 'now');
    const adminTag = `[Admin force clock-out by ${req.user.email || req.user.id} (${how})${reason ? `: ${reason}` : ''}]`;
    const combinedNotes = e.notes ? `${e.notes}\n${adminTag}` : adminTag;

    const result = await db.query(
      `UPDATE time_entries SET
         end_time = $6,
         clock_out_location = NULL,
         duration_minutes = $1,
         is_complete = true,
         notes = $2,
         discrepancy_minutes = $3,
         billable_minutes = $4,
         needs_approval = true,
         approval_reason = COALESCE(approval_reason, 'admin_force_clockout'),
         updated_at = NOW()
       WHERE id = $5 AND end_time IS NULL
       RETURNING *`,
      [durationMinutes, combinedNotes, discrepancyMinutes, billableMinutes, req.params.id, end.toISOString()]
    );
    if (result.rows.length === 0) return res.status(409).json({ error: 'This shift is already clocked out.' });

    await auditLog(req.user.id, 'UPDATE', 'time_entries', req.params.id, null, {
      action: 'admin_force_clockout',
      reason: reason || null,
      caregiver_id: e.caregiver_id,
      duration_minutes: durationMinutes
    });

    // Auto-resolve any open GPS-failure banners for this caregiver
    try {
      const cg = await db.query('SELECT first_name, last_name FROM users WHERE id = $1', [e.caregiver_id]);
      if (cg.rows[0]) {
        const fullName = `${cg.rows[0].first_name || ''} ${cg.rows[0].last_name || ''}`.trim();
        if (fullName) {
          await db.query(
            `UPDATE notifications
             SET is_read = true, status = 'handled', handled_at = NOW()
             WHERE type = 'gps_failure'
               AND title LIKE $1
               AND COALESCE(status, 'new') = 'new'
               AND created_at > NOW() - INTERVAL '6 hours'`,
            [`%${fullName}%`]
          );
        }
      }
    } catch (resolveErr) {
      console.error('GPS banner auto-resolve error:', resolveErr.message);
    }

    res.json({ success: true, entry: result.rows[0] });
  } catch (error) {
    console.error('Admin force clock-out error:', error);
    res.status(500).json({ error: error.message });
  }
});

// POST /api/time-entries/:id/gps
router.post('/:id/gps', verifyToken, async (req, res) => {
  try {
    const { latitude, longitude, accuracy, speed, heading } = req.body;
    const entryCheck = await db.query(`SELECT id FROM time_entries WHERE id=$1 AND caregiver_id=$2 AND end_time IS NULL`, [req.params.id, req.user.id]);
    if (entryCheck.rows.length === 0) return res.status(404).json({ error: 'Active time entry not found' });
    await db.query(`INSERT INTO gps_tracking (caregiver_id, time_entry_id, latitude, longitude, accuracy, speed, heading, timestamp) VALUES ($1,$2,$3,$4,$5,$6,$7,NOW())`,
      [req.user.id, req.params.id, latitude, longitude, accuracy||null, speed||null, heading||null]);
    res.json({ success: true });
  } catch (error) { res.status(500).json({ error: error.message }); }
});

// GET /api/time-entries/:id/gps
router.get('/:id/gps', verifyToken, async (req, res) => {
  try {
    const result = await db.query(`SELECT latitude, longitude, accuracy, speed, heading, timestamp FROM gps_tracking WHERE time_entry_id=$1 ORDER BY timestamp ASC`, [req.params.id]);
    res.json(result.rows);
  } catch (error) { res.status(500).json({ error: error.message }); }
});


// GET /api/time-entries/caregiver-gps/:caregiverId
// Returns recent shifts with clock-in/out GPS + full GPS trail per shift
router.get('/caregiver-gps/:caregiverId', verifyToken, async (req, res) => {
  try {
    const { caregiverId } = req.params;
    const limit = parseInt(req.query.limit) || 20;

    // Get recent time entries with clock in/out locations
    const entries = await db.query(
      `SELECT te.id, te.start_time, te.end_time, te.is_complete,
              te.clock_in_location, te.clock_out_location,
              ROUND(EXTRACT(EPOCH FROM (COALESCE(te.end_time, NOW()) - te.start_time))/3600.0::numeric, 2) as hours,
              c.first_name as client_first, c.last_name as client_last,
              c.address as client_address, c.city as client_city,
              c.address as client_address
       FROM time_entries te
       LEFT JOIN clients c ON te.client_id = c.id
       WHERE te.caregiver_id = $1
       ORDER BY te.start_time DESC
       LIMIT $2`,
      [caregiverId, limit]
    );

    // For each entry, fetch GPS trail
    const results = await Promise.all(entries.rows.map(async (entry) => {
      const gps = await db.query(
        `SELECT latitude, longitude, accuracy, speed, timestamp
         FROM gps_tracking
         WHERE time_entry_id = $1
         ORDER BY timestamp ASC`,
        [entry.id]
      );
      return { ...entry, gpsTrail: gps.rows };
    }));

    res.json(results);
  } catch (err) {
    console.error('caregiver-gps error:', err);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/time-entries/pending-approval — admin queue of flagged time entries
router.get('/pending-approval', verifyToken, requireAdmin, async (req, res) => {
  try {
    const result = await db.query(`
      SELECT te.id, te.caregiver_id, te.client_id, te.start_time, te.end_time,
        te.duration_minutes, te.allotted_minutes, te.billable_minutes,
        te.discrepancy_minutes, te.needs_approval, te.approval_reason, te.notes,
        CASE WHEN te.end_time IS NOT NULL
          THEN ROUND((EXTRACT(EPOCH FROM (te.end_time - te.start_time)) / 3600.0)::numeric, 2)
          ELSE NULL END as hours,
        ROUND((te.billable_minutes / 60.0)::numeric, 2) as billable_hours,
        ROUND((te.allotted_minutes / 60.0)::numeric, 2) as allotted_hours,
        u.first_name as caregiver_first_name, u.last_name as caregiver_last_name,
        u.default_pay_rate,
        c.first_name as client_first_name, c.last_name as client_last_name,
        c.is_private_pay,
        rs.payer_type as referral_payer_type, rs.name as referral_source_name
      FROM time_entries te
      JOIN users u ON te.caregiver_id = u.id
      LEFT JOIN clients c ON te.client_id = c.id
      LEFT JOIN referral_sources rs ON c.referral_source_id = rs.id
      WHERE te.needs_approval = true AND te.is_complete = true
      ORDER BY te.start_time DESC
    `);
    res.json(result.rows);
  } catch (err) {
    console.error('pending-approval error:', err);
    res.status(500).json({ error: err.message });
  }
});

// PATCH /api/time-entries/:id/approve — admin resolves a flagged entry
// Body: { billable_minutes?: number, notes?: string, reject?: boolean }
//   - If reject=true, sets billable_minutes=0 (shift is not paid)
//   - If billable_minutes provided, overrides the computed value
//   - Otherwise accepts the current billable_minutes as-is
router.patch('/:id/approve', verifyToken, requireAdmin, async (req, res) => {
  try {
    const { billable_minutes, notes, reject } = req.body;
    const existing = await db.query(`SELECT * FROM time_entries WHERE id = $1`, [req.params.id]);
    if (existing.rows.length === 0) return res.status(404).json({ error: 'Time entry not found' });

    let newBillable;
    if (reject === true) {
      newBillable = 0;
    } else if (billable_minutes != null) {
      newBillable = parseInt(billable_minutes, 10);
      if (Number.isNaN(newBillable) || newBillable < 0) {
        return res.status(400).json({ error: 'billable_minutes must be a non-negative integer' });
      }
    } else {
      newBillable = existing.rows[0].billable_minutes;
    }

    const result = await db.query(
      `UPDATE time_entries
       SET billable_minutes = $1,
           approved_billable_minutes = $1,
           approved_by = $2,
           approved_at = NOW(),
           approval_notes = $3,
           needs_approval = false,
           updated_at = NOW()
       WHERE id = $4
       RETURNING *`,
      [newBillable, req.user.id, notes || null, req.params.id]
    );
    await auditLog(req.user.id, 'APPROVE', 'time_entries', req.params.id, existing.rows[0], result.rows[0]);
    res.json(result.rows[0]);
  } catch (err) {
    console.error('approve error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ─── VISIT PHOTOS (proof-of-care) ────────────────────────────────────────────

// POST /api/time-entries/:id/photos — attach a photo to a time entry
// Body: { imageBase64 (data URI), caption?, category? }
router.post(':id/photos', verifyToken, async (req, res) => {
  const { imageBase64, caption, category } = req.body;
  if (!imageBase64 || !imageBase64.startsWith('data:image')) {
    return res.status(400).json({ error: 'imageBase64 (data URI) is required' });
  }
  // ~6.6MB encoded == ~5MB raw — CHECK constraint catches anything bigger
  if (imageBase64.length > 7_000_000) {
    return res.status(400).json({ error: 'Photo too large — keep under ~5MB raw' });
  }
  try {
    // Only the caregiver who owns this time entry, or admin, can upload
    const te = await db.query(`SELECT caregiver_id, client_id FROM time_entries WHERE id = $1`, [req.params.id]);
    if (te.rows.length === 0) return res.status(404).json({ error: 'Time entry not found' });
    if (req.user?.role !== 'admin' && req.user?.id !== te.rows[0].caregiver_id) {
      return res.status(403).json({ error: 'Only the assigned caregiver or an admin can upload visit photos' });
    }

    const result = await db.query(
      `INSERT INTO visit_photos
       (time_entry_id, caregiver_id, client_id, caption, category, image_base64, image_size)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id, caption, category, taken_at, image_size`,
      [req.params.id, te.rows[0].caregiver_id, te.rows[0].client_id,
       caption || null, category || null, imageBase64, Math.floor(imageBase64.length * 0.75)]
    );
    res.status(201).json(result.rows[0]);
  } catch (error) {
    if (error.message.includes('visit_photo_size_cap')) {
      return res.status(400).json({ error: 'Photo exceeds size limit (5MB)' });
    }
    res.status(500).json({ error: error.message });
  }
});

// GET /api/time-entries/:id/photos — list photos for a time entry
router.get(':id/photos', verifyToken, async (req, res) => {
  try {
    const te = await db.query(`SELECT caregiver_id, client_id FROM time_entries WHERE id = $1`, [req.params.id]);
    if (te.rows.length === 0) return res.status(404).json({ error: 'Time entry not found' });
    if (req.user?.role !== 'admin' && req.user?.id !== te.rows[0].caregiver_id) {
      return res.status(403).json({ error: 'Not allowed' });
    }
    const result = await db.query(
      `SELECT vp.id, vp.caption, vp.category, vp.image_base64, vp.image_size, vp.taken_at, vp.uploaded_at,
              u.first_name, u.last_name
         FROM visit_photos vp
         LEFT JOIN users u ON vp.caregiver_id = u.id
        WHERE vp.time_entry_id = $1
        ORDER BY vp.taken_at`,
      [req.params.id]
    );
    res.json(result.rows);
  } catch (error) { res.status(500).json({ error: error.message }); }
});

// GET /api/time-entries/photos/client/:clientId — recent photos for a client (admin)
router.get('/photos/client/:clientId', verifyToken, requireAdmin, async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit) || 30, 200);
    const result = await db.query(
      `SELECT vp.id, vp.caption, vp.category, vp.taken_at, vp.image_size,
              vp.time_entry_id, u.first_name, u.last_name
         FROM visit_photos vp
         LEFT JOIN users u ON vp.caregiver_id = u.id
        WHERE vp.client_id = $1
        ORDER BY vp.taken_at DESC
        LIMIT $2`,
      [req.params.clientId, limit]
    );
    // Note: omits image_base64 from list view for bandwidth; fetch individually via /photo/:id
    res.json(result.rows);
  } catch (error) { res.status(500).json({ error: error.message }); }
});

// GET /api/time-entries/photo/:photoId — fetch a single photo (with image)
router.get('/photo/:photoId', verifyToken, async (req, res) => {
  try {
    const r = await db.query(
      `SELECT vp.*, te.caregiver_id FROM visit_photos vp
         JOIN time_entries te ON vp.time_entry_id = te.id
        WHERE vp.id = $1`, [req.params.photoId]);
    if (r.rows.length === 0) return res.status(404).json({ error: 'Photo not found' });
    if (req.user?.role !== 'admin' && req.user?.id !== r.rows[0].caregiver_id) {
      return res.status(403).json({ error: 'Not allowed' });
    }
    res.json(r.rows[0]);
  } catch (error) { res.status(500).json({ error: error.message }); }
});

// DELETE /api/time-entries/photo/:photoId — admin only
router.delete('/photo/:photoId', verifyToken, requireAdmin, async (req, res) => {
  try {
    const r = await db.query(`DELETE FROM visit_photos WHERE id = $1 RETURNING id`, [req.params.photoId]);
    if (r.rows.length === 0) return res.status(404).json({ error: 'Photo not found' });
    res.json({ deleted: r.rows[0].id });
  } catch (error) { res.status(500).json({ error: error.message }); }
});

module.exports = router;
// Exposed for unit tests; not part of the HTTP surface.
module.exports.applyExcessiveDurationGuard = applyExcessiveDurationGuard;
module.exports.MAX_SHIFT_MINUTES = MAX_SHIFT_MINUTES;
