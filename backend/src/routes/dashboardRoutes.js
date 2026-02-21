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
      db.query(`SELECT SUM(total) as amount FROM invoices WHERE billing_period_start >= date_trunc('month', CURRENT_DATE) AND payment_status = 'paid'`),
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

// GET /api/dashboard/referrals
router.get('/referrals', verifyToken, requireAdmin, async (req, res) => {
  try {
    const result = await db.query(
      `SELECT rs.name, rs.type, COUNT(c.id) as referral_count,
        SUM(CASE WHEN i.payment_status = 'paid' THEN i.total ELSE 0 END) as total_revenue
       FROM referral_sources rs
       LEFT JOIN clients c ON rs.id = c.referred_by
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

module.exports = router;
