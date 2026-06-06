// routes/dashboardRoutes.js
const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const db = require('../db');
const { verifyToken, requireAdmin, auditLog } = require('../middleware/shared');

// GET /api/dashboard/summary
router.get('/summary', verifyToken, requireAdmin, async (req, res) => {
  try {
    const [totalClients, activeCaregivers, pendingInvoices, thisMonthRevenue, clockedInNow, todayShifts, remainingShifts] = await Promise.all([
      db.query('SELECT COUNT(*) as count FROM clients WHERE is_active = true'),
      db.query("SELECT COUNT(*) as count FROM users WHERE role = 'caregiver' AND is_active = true"),
      db.query("SELECT COUNT(*) as count, SUM(total) as amount FROM invoices WHERE payment_status = 'pending'"),
      // "This Month Revenue" = actual cash received this calendar month, by
      // payment_date — NOT by billing period start. The old query asked
      // "how much have we collected on invoices whose billing period began
      // this month", which excluded any prior-month invoice paid in June.
      // The correct definition for a cash-collected report is payment_date.
      db.query(`SELECT COALESCE(SUM(amount), 0) as amount
                  FROM invoice_payments
                 WHERE payment_date >= date_trunc('month', CURRENT_DATE)
                   AND payment_date <  date_trunc('month', CURRENT_DATE) + INTERVAL '1 month'`),
      // Caregivers currently clocked in (open time entry today)
      db.query(`SELECT COUNT(DISTINCT caregiver_id) as count FROM time_entries WHERE end_time IS NULL AND DATE(start_time) = CURRENT_DATE`),
      // Shifts today
      db.query(`SELECT COUNT(*) as count FROM schedules WHERE is_active = true AND
        (date = CURRENT_DATE OR 
         (day_of_week = EXTRACT(DOW FROM CURRENT_DATE)::integer AND
          (effective_date IS NULL OR effective_date <= CURRENT_DATE)))`),
      // Remaining shifts today (not yet clocked in)
      db.query(`SELECT COUNT(*) as count FROM schedules s WHERE s.is_active = true AND
        (s.date = CURRENT_DATE OR (s.day_of_week = EXTRACT(DOW FROM CURRENT_DATE)::integer AND (s.effective_date IS NULL OR s.effective_date <= CURRENT_DATE)))
        AND NOT EXISTS (SELECT 1 FROM time_entries te WHERE te.caregiver_id = s.caregiver_id AND DATE(te.start_time) = CURRENT_DATE AND te.end_time IS NULL)`),
    ]);
    res.json({
      totalClients: parseInt(totalClients.rows[0].count),
      activeCaregivers: parseInt(activeCaregivers.rows[0].count),
      pendingInvoices: { count: parseInt(pendingInvoices.rows[0].count), amount: parseFloat(pendingInvoices.rows[0].amount || 0) },
      thisMonthRevenue: parseFloat(thisMonthRevenue.rows[0].amount || 0),
      clockedInNow: parseInt(clockedInNow.rows[0].count || 0),
      todayShifts: parseInt(todayShifts.rows[0].count || 0),
      remainingShifts: parseInt(remainingShifts.rows[0].count || 0),
      coverageGaps: 0,
    });
  } catch (error) { res.status(500).json({ error: error.message }); }
});

// GET /api/dashboard/action-items
// Operational to-do list for admin. Each entry has count + link target.
router.get('/action-items', verifyToken, requireAdmin, async (req, res) => {
  const safe = async (q, params = []) => {
    try { return (await db.query(q, params)).rows[0] || {}; }
    catch (e) { console.error('[action-items]', e.message); return {}; }
  };
  try {
    const [pendingApprovals, openShiftsCount, lowAuths, expiringAuths, expiringCerts, stuckPunches, pendingPayrollReviews] = await Promise.all([
      safe(`SELECT COUNT(*)::int AS n FROM time_entries WHERE needs_approval = true AND is_complete = true`),
      safe(`SELECT COUNT(*)::int AS n FROM open_shifts WHERE status = 'open' AND shift_date >= CURRENT_DATE AND shift_date <= CURRENT_DATE + INTERVAL '7 days'`),
      safe(`SELECT COUNT(*)::int AS n FROM authorizations WHERE status = 'active' AND (authorized_units - used_units) <= low_units_alert_threshold`),
      safe(`SELECT COUNT(*)::int AS n FROM authorizations WHERE status = 'active' AND end_date BETWEEN CURRENT_DATE AND CURRENT_DATE + INTERVAL '14 days'`),
      safe(`SELECT COUNT(*)::int AS n FROM caregiver_certifications WHERE expiration_date BETWEEN CURRENT_DATE AND CURRENT_DATE + INTERVAL '30 days'`),
      safe(`SELECT COUNT(*)::int AS n FROM time_entries WHERE is_complete = false AND start_time < NOW() - INTERVAL '24 hours'`),
      safe(`SELECT COUNT(*)::int AS n FROM payroll_shift_reviews WHERE status IN ('pending','flagged','missing_punch') AND created_at > NOW() - INTERVAL '30 days'`),
    ]);
    const items = [
      { key: 'shift_approvals',  label: 'Time entries awaiting approval', count: pendingApprovals.n || 0, page: 'shift-approvals',  severity: 'high' },
      { key: 'stuck_punches',    label: 'Open clock-ins more than 24h old', count: stuckPunches.n || 0,  page: 'live-board',       severity: 'high' },
      { key: 'open_shifts',      label: 'Open shifts in next 7 days',     count: openShiftsCount.n || 0, page: 'scheduling',       severity: 'med' },
      { key: 'low_auths',        label: 'Authorizations running low',     count: lowAuths.n || 0,        page: 'billing-engine',   severity: 'high' },
      { key: 'expiring_auths',   label: 'Authorizations expiring within 14 days', count: expiringAuths.n || 0, page: 'billing-engine', severity: 'high' },
      { key: 'expiring_certs',   label: 'Caregiver certifications expiring within 30 days', count: expiringCerts.n || 0, page: 'compliance',  severity: 'med' },
      { key: 'payroll_reviews',  label: 'Payroll shift reviews still pending', count: pendingPayrollReviews.n || 0, page: 'payroll',     severity: 'med' },
    ].filter(item => item.count > 0);
    res.json({ items, totalCount: items.reduce((s, i) => s + i.count, 0) });
  } catch (error) { res.status(500).json({ error: error.message }); }
});

// GET /api/dashboard/referrals
router.get('/referrals', verifyToken, requireAdmin, async (req, res) => {
  try {
    const result = await db.query(
      `SELECT rs.name, rs.type, COUNT(c.id) as referral_count,
        SUM(CASE WHEN i.payment_status = 'paid' THEN i.total ELSE 0 END) as total_revenue
       FROM referral_sources rs
       LEFT JOIN clients c ON rs.id = c.referral_source_id
       LEFT JOIN invoices i ON c.id = i.client_id
       WHERE rs.is_active = true
       GROUP BY rs.id, rs.name, rs.type ORDER BY referral_count DESC`
    );
    res.json(result.rows);
  } catch (error) { res.status(500).json({ error: error.message }); }
});

// GET /api/dashboard/caregiver-hours
router.get('/caregiver-hours', verifyToken, requireAdmin, async (req, res) => {
  try {
    const result = await db.query(
      `SELECT u.id, u.first_name, u.last_name, COUNT(te.id) as shifts,
        COALESCE(SUM(te.duration_minutes)::integer/60, 0) as total_hours,
        COALESCE(AVG(pr.satisfaction_score), 0) as avg_satisfaction
       FROM users u
       LEFT JOIN time_entries te ON u.id = te.caregiver_id AND te.end_time IS NOT NULL
       LEFT JOIN performance_ratings pr ON u.id = pr.caregiver_id
       WHERE u.role = 'caregiver' AND u.is_active = true
       GROUP BY u.id, u.first_name, u.last_name ORDER BY total_hours DESC NULLS LAST`
    );
    res.json(result.rows);
  } catch (error) { res.status(500).json({ error: error.message }); }
});

// GET /api/dashboard/live-board — Real-time shift status for today
router.get('/live-board', verifyToken, requireAdmin, async (req, res) => {
  try {
    const result = await db.query(`
      SELECT
        s.id AS schedule_id,
        s.caregiver_id,
        s.client_id,
        s.start_time AS scheduled_start,
        s.end_time AS scheduled_end,
        u.first_name AS caregiver_first,
        u.last_name AS caregiver_last,
        u.phone AS caregiver_phone,
        u.latitude AS caregiver_lat,
        u.longitude AS caregiver_lng,
        c.first_name AS client_first,
        c.last_name AS client_last,
        c.address AS client_address,
        c.city AS client_city,
        c.latitude AS client_lat,
        c.longitude AS client_lng,
        te.id AS time_entry_id,
        te.start_time AS clock_in_time,
        te.end_time AS clock_out_time,
        te.clock_in_location,
        te.clock_out_location,
        te.duration_minutes,
        CASE
          WHEN te.end_time IS NOT NULL THEN 'completed'
          WHEN te.start_time IS NOT NULL AND te.end_time IS NULL THEN 'clocked_in'
          WHEN s.start_time <= NOW()::time AND (NOW()::time - s.start_time) > INTERVAL '15 minutes' AND te.id IS NULL THEN 'late'
          WHEN s.start_time <= NOW()::time AND te.id IS NULL THEN 'starting'
          ELSE 'upcoming'
        END AS shift_status,
        CASE
          WHEN te.start_time IS NOT NULL AND te.end_time IS NULL
          THEN ROUND(EXTRACT(EPOCH FROM (NOW() - te.start_time)) / 60)
          ELSE NULL
        END AS minutes_elapsed,
        (
          SELECT jsonb_agg(jsonb_build_object('lat', gt.latitude, 'lng', gt.longitude, 'ts', gt.timestamp))
          FROM gps_tracking gt
          WHERE gt.time_entry_id = te.id
          ORDER BY gt.timestamp DESC
          LIMIT 20
        ) AS gps_trail
      FROM schedules s
      JOIN users u ON s.caregiver_id = u.id
      JOIN clients c ON s.client_id = c.id
      LEFT JOIN time_entries te
        ON te.caregiver_id = s.caregiver_id
        AND te.client_id = s.client_id
        AND DATE(te.start_time) = CURRENT_DATE
      WHERE s.is_active = true
        AND u.is_active = true
        AND (
          s.date = CURRENT_DATE
          OR (s.day_of_week = EXTRACT(DOW FROM CURRENT_DATE)::int
              AND s.date IS NULL
              AND (s.effective_date IS NULL OR s.effective_date <= CURRENT_DATE))
        )
      ORDER BY s.start_time ASC
    `);

    const shifts = result.rows;
    const stats = {
      total: shifts.length,
      clocked_in: shifts.filter(s => s.shift_status === 'clocked_in').length,
      completed: shifts.filter(s => s.shift_status === 'completed').length,
      late: shifts.filter(s => s.shift_status === 'late').length,
      upcoming: shifts.filter(s => s.shift_status === 'upcoming').length,
      starting: shifts.filter(s => s.shift_status === 'starting').length,
    };

    res.json({ shifts, stats, asOf: new Date().toISOString() });
  } catch (error) {
    console.error('Live board error:', error);
    res.status(500).json({ error: error.message });
  }
});

// GET /api/dashboard/caregiver-patterns/:caregiverId — Predictive scheduling data
router.get('/caregiver-patterns/:caregiverId', verifyToken, requireAdmin, async (req, res) => {
  try {
    const { caregiverId } = req.params;
    const months = parseInt(req.query.months) || 6;

    const [absences, noShows, lateClockIns, totalShifts] = await Promise.all([
      // Absences by day of week
      db.query(`
        SELECT EXTRACT(DOW FROM date)::int AS day_of_week, type, COUNT(*) AS count
        FROM absences WHERE caregiver_id = $1 AND date >= CURRENT_DATE - ($2 || ' months')::interval
        GROUP BY day_of_week, type ORDER BY day_of_week
      `, [caregiverId, months]),

      // No-shows by day of week
      db.query(`
        SELECT EXTRACT(DOW FROM shift_date)::int AS day_of_week, COUNT(*) AS count
        FROM noshow_alerts WHERE caregiver_id = $1 AND shift_date >= CURRENT_DATE - ($2 || ' months')::interval
        GROUP BY day_of_week ORDER BY day_of_week
      `, [caregiverId, months]),

      // Late clock-ins (>15 min after scheduled start) by day of week
      db.query(`
        SELECT EXTRACT(DOW FROM DATE(te.start_time))::int AS day_of_week, COUNT(*) AS count,
          ROUND(AVG(EXTRACT(EPOCH FROM (te.start_time::time - s.start_time)) / 60)) AS avg_minutes_late
        FROM time_entries te
        JOIN schedules s ON te.schedule_id = s.id
        WHERE te.caregiver_id = $1
          AND te.is_complete = true
          AND DATE(te.start_time) >= CURRENT_DATE - ($2 || ' months')::interval
          AND (te.start_time::time - s.start_time) > INTERVAL '15 minutes'
        GROUP BY day_of_week ORDER BY day_of_week
      `, [caregiverId, months]),

      // Total shifts by day of week (for percentages)
      db.query(`
        SELECT EXTRACT(DOW FROM DATE(te.start_time))::int AS day_of_week, COUNT(*) AS count
        FROM time_entries te
        WHERE te.caregiver_id = $1 AND te.is_complete = true
          AND DATE(te.start_time) >= CURRENT_DATE - ($2 || ' months')::interval
        GROUP BY day_of_week ORDER BY day_of_week
      `, [caregiverId, months]),
    ]);

    // Build day-of-week reliability map
    const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const patterns = dayNames.map((name, dow) => {
      const total = totalShifts.rows.find(r => r.day_of_week === dow)?.count || 0;
      const absent = absences.rows.filter(r => r.day_of_week === dow).reduce((s, r) => s + parseInt(r.count), 0);
      const noShow = noShows.rows.find(r => r.day_of_week === dow)?.count || 0;
      const late = lateClockIns.rows.find(r => r.day_of_week === dow)?.count || 0;
      const avgLate = lateClockIns.rows.find(r => r.day_of_week === dow)?.avg_minutes_late || 0;
      const issues = absent + noShow + late;
      const reliability = total > 0 ? Math.round(((total - issues) / total) * 100) : 100;

      return { day: name, dayOfWeek: dow, totalShifts: parseInt(total), absences: parseInt(absent), noShows: parseInt(noShow), lateArrivals: parseInt(late), avgMinutesLate: parseInt(avgLate), reliabilityPct: reliability };
    });

    // Flag problematic days
    const riskDays = patterns.filter(p => p.totalShifts >= 3 && p.reliabilityPct < 80);

    res.json({
      caregiverId,
      periodMonths: months,
      patterns,
      riskDays,
      overallReliability: patterns.reduce((s, p) => s + p.totalShifts, 0) > 0
        ? Math.round(patterns.reduce((s, p) => s + (p.reliabilityPct * p.totalShifts), 0) / Math.max(1, patterns.reduce((s, p) => s + p.totalShifts, 0)))
        : 100
    });
  } catch (error) {
    console.error('Caregiver patterns error:', error);
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
