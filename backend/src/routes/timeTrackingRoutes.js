// routes/timeTrackingRoutes.js
const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const db = require('../db');
const { verifyToken, requireAdmin, auditLog } = require('../middleware/shared');

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
        sendPushToUser(req.user.id, { title: '⏰ 15-Minute Warning', body: `Shift with ${te.client_first} ${te.client_last} ends at ${endTime}. Start wrapping up!`, icon: '/icon-192.png', tag: 'shift-warning-15min', data: { type: 'shift_warning', timeEntryId } });
      } catch {}
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
    if (startDate) params.push(startDate);
    if (endDate) params.push(endDate);
    const result = await db.query(
      `SELECT te.*, c.first_name as client_first_name, c.last_name as client_last_name,
        c.address as client_address, c.city as client_city,
        (SELECT COUNT(*) FROM gps_tracking gt WHERE gt.time_entry_id = te.id) as gps_point_count
       FROM time_entries te LEFT JOIN clients c ON te.client_id = c.id
       WHERE te.caregiver_id = $1
         ${startDate ? `AND te.start_time >= $${params.indexOf(startDate) + 1}::timestamptz` : ''}
         ${endDate ? `AND te.start_time <= $${params.indexOf(endDate) + 1}::timestamptz` : ''}
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
      `SELECT te.*, c.first_name as client_first_name, c.last_name as client_last_name
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
      `SELECT te.*, u.first_name, u.last_name, c.first_name as client_first_name, c.last_name as client_last_name
       FROM time_entries te JOIN users u ON te.caregiver_id=u.id JOIN clients c ON te.client_id=c.id
       ORDER BY te.start_time DESC`
    );
    res.json(result.rows);
  } catch (error) { res.status(500).json({ error: error.message }); }
});

// POST /api/time-entries/clock-in
router.post('/clock-in', verifyToken, async (req, res) => {
  try {
    const { clientId, latitude, longitude, scheduleId } = req.body;
    const entryId = uuidv4();
    let allottedMinutes = null, linkedScheduleId = scheduleId || null;
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
      [entryId, req.user.id, clientId, JSON.stringify({ lat: latitude, lng: longitude }), linkedScheduleId, allottedMinutes]
    );
    await auditLog(req.user.id, 'CREATE', 'time_entries', entryId, null, result.rows[0]);
    try {
      const { sendPushToUser } = require('./pushNotificationRoutes');
      let clientName = null;
      if (clientId) { const cl = await db.query('SELECT first_name, last_name FROM clients WHERE id=$1', [clientId]); if (cl.rows[0]) clientName = `${cl.rows[0].first_name} ${cl.rows[0].last_name}`; }
      const startTimeFormatted = new Date(result.rows[0].start_time).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
      sendPushToUser(req.user.id, { title: '✅ Clocked In', body: `You are clocked in${clientName ? ` for ${clientName}` : ''}. Started at ${startTimeFormatted}.`, icon: '/icon-192.png', tag: `clock-in-${entryId}`, data: { type: 'clock_in', timeEntryId: entryId } });
    } catch {}
    res.status(201).json({ id: result.rows[0].id, client_id: result.rows[0].client_id, start_time: result.rows[0].start_time });
  } catch (error) { res.status(500).json({ error: error.message }); }
});

// POST /api/time-entries/:id/clock-out
router.post('/:id/clock-out', verifyToken, async (req, res) => {
  try {
    const { latitude, longitude, notes } = req.body;
    const timeEntry = await db.query(
      `SELECT te.*, c.first_name as client_first_name, c.last_name as client_last_name
       FROM time_entries te LEFT JOIN clients c ON te.client_id=c.id WHERE te.id=$1`, [req.params.id]
    );
    if (timeEntry.rows.length === 0) return res.status(404).json({ error: 'Time entry not found' });
    const durationMinutes = Math.round((new Date() - new Date(timeEntry.rows[0].start_time)) / 60000);
    const allottedMinutes = timeEntry.rows[0].allotted_minutes;
    const discrepancyMinutes = allottedMinutes ? durationMinutes - allottedMinutes : null;
    const billableMinutes = allottedMinutes ? Math.min(durationMinutes, allottedMinutes) : durationMinutes;
    const result = await db.query(
      `UPDATE time_entries SET end_time=NOW(), clock_out_location=$1, duration_minutes=$2, is_complete=true,
        notes=$3, discrepancy_minutes=$4, billable_minutes=$5, updated_at=NOW() WHERE id=$6 RETURNING *`,
      [latitude && longitude ? JSON.stringify({ lat: latitude, lng: longitude }) : null, durationMinutes, notes || null, discrepancyMinutes, billableMinutes, req.params.id]
    );
    await auditLog(req.user.id, 'UPDATE', 'time_entries', req.params.id, null, result.rows[0]);
    try {
      const { sendPushToUser } = require('./pushNotificationRoutes');
      const clientName = timeEntry.rows[0].client_first_name ? `${timeEntry.rows[0].client_first_name} ${timeEntry.rows[0].client_last_name}` : null;
      const durationStr = durationMinutes >= 60 ? `${Math.floor(durationMinutes/60)}h ${durationMinutes%60}m` : `${durationMinutes}m`;
      sendPushToUser(req.user.id, { title: '🕐 Clocked Out', body: `Shift complete${clientName ? ` — ${clientName}` : ''}. Duration: ${durationStr}.`, icon: '/icon-192.png', tag: `clock-out-${req.params.id}`, data: { type: 'clock_out' } });
    } catch {}
    try { const { createEVVFromTimeEntry } = require('./sandataRoutes'); createEVVFromTimeEntry(req.params.id).catch(e => console.error('[EVV auto-create]', e.message)); } catch(e) {}
    res.json(result.rows[0]);
  } catch (error) { res.status(500).json({ error: error.message }); }
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

module.exports = router;
