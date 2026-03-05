// routes/forecastRoutes.js
// Revenue forecasting based on authorizations, schedules, and billing history

const express = require('express');
const router = express.Router();
const db = require('../db');
const auth = require('../middleware/auth');

// GET revenue forecast — projected vs actual by week/month
router.get('/revenue', auth, async (req, res) => {
  const { period = 'month', months = 3 } = req.query;
  try {
    // Actual billed revenue last N months
    const actual = await db.query(`
      SELECT
        DATE_TRUNC('month', service_date_from) AS period,
        SUM(charge_amount) AS billed,
        SUM(paid_amount) AS collected,
        COUNT(*) AS claim_count
      FROM claims
      WHERE service_date_from >= CURRENT_DATE - ($1 * INTERVAL '1 month')
        AND status NOT IN ('voided','rejected')
      GROUP BY 1 ORDER BY 1
    `, [months]);

    // Projected revenue from active authorizations + scheduled hours
    const projected = await db.query(`
      SELECT
        a.client_id,
        c.first_name || ' ' || c.last_name AS client_name,
        a.service_type,
        COALESCE(a.authorized_units, 0) AS authorized_hours,
        COALESCE(a.used_units, 0) AS used_hours,
        (COALESCE(a.authorized_units, 0) - COALESCE(a.used_units, 0)) AS remaining_hours,
        18.50 AS hourly_rate,
        ((COALESCE(a.authorized_units, 0) - COALESCE(a.used_units, 0)) * 18.50) AS projected_remaining_revenue,
        a.end_date
      FROM authorizations a
      JOIN clients c ON a.client_id = c.id
      WHERE a.status = 'active'
        AND a.end_date >= CURRENT_DATE
        AND (COALESCE(a.authorized_units, 0) - COALESCE(a.used_units, 0)) > 0
      ORDER BY projected_remaining_revenue DESC
    `);

    // Weekly scheduled hours (current + next 4 weeks)
    const weekly = await db.query(`
      SELECT
        DATE_TRUNC('week', gs.dt) AS week_start,
        COUNT(DISTINCT s.caregiver_id) AS caregiver_count,
        COUNT(*) AS shift_count,
        SUM(
          EXTRACT(EPOCH FROM (s.end_time::time - s.start_time::time)) / 3600.0
        ) AS scheduled_hours,
        SUM(
          EXTRACT(EPOCH FROM (s.end_time::time - s.start_time::time)) / 3600.0
        ) * 18.50 AS estimated_revenue
      FROM schedules s
      CROSS JOIN LATERAL generate_series(CURRENT_DATE, CURRENT_DATE + 27, '1 day') AS gs(dt)
      WHERE s.is_active = TRUE
        AND (
          (s.schedule_type = 'recurring' AND s.day_of_week = EXTRACT(DOW FROM gs.dt)::int)
          OR (s.schedule_type = 'one-time' AND s.date = gs.dt)
          OR (s.schedule_type = 'bi-weekly' AND s.day_of_week = EXTRACT(DOW FROM gs.dt)::int)
        )
      GROUP BY 1 ORDER BY 1
    `);

    // Top clients by revenue (last 90 days)
    const topClients = await db.query(`
      SELECT
        cl.client_id,
        c.first_name || ' ' || c.last_name AS client_name,
        SUM(cl.charge_amount) AS total_billed,
        SUM(cl.paid_amount) AS total_collected,
        COUNT(*) AS claim_count,
        AVG(cl.charge_amount) AS avg_claim
      FROM claims cl
      JOIN clients c ON cl.client_id = c.id
      WHERE cl.service_date_from >= CURRENT_DATE - INTERVAL '90 days'
        AND cl.status NOT IN ('voided','rejected')
      GROUP BY 1,2 ORDER BY 3 DESC LIMIT 10
    `);

    // Auth utilization summary
    const authSummary = await db.query(`
      SELECT
        COUNT(*) AS total_active_auths,
        SUM(COALESCE(authorized_units, 0)) AS total_auth_hours,
        SUM(COALESCE(used_units, 0)) AS total_used_hours,
        ROUND(AVG(COALESCE(used_units,0)::numeric / NULLIF(COALESCE(authorized_units,0),0) * 100), 1) AS avg_utilization_pct,
        SUM((COALESCE(authorized_units,0) - COALESCE(used_units,0)) * 18.50) AS total_projected_remaining
      FROM authorizations
      WHERE status = 'active' AND end_date >= CURRENT_DATE
    `);

    res.json({
      actual: actual.rows,
      projected: projected.rows,
      weekly: weekly.rows,
      topClients: topClients.rows,
      authSummary: authSummary.rows[0] || {}
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// GET caregiver utilization
router.get('/caregiver-utilization', auth, async (req, res) => {
  try {
    const result = await db.query(`
      SELECT
        u.id,
        u.first_name || ' ' || u.last_name AS caregiver_name,
        COUNT(DISTINCT s.client_id) AS client_count,
        SUM(
          EXTRACT(EPOCH FROM (s.end_time::time - s.start_time::time)) / 3600.0
        ) AS weekly_hours,
        SUM(
          EXTRACT(EPOCH FROM (s.end_time::time - s.start_time::time)) / 3600.0
        ) * 18.50 AS weekly_revenue,
        u.employment_type
      FROM users u
      LEFT JOIN schedules s ON s.caregiver_id = u.id AND s.is_active = TRUE
        AND s.day_of_week IN (
          SELECT EXTRACT(DOW FROM CURRENT_DATE - i)::int FROM generate_series(0,6) i
        )
      WHERE u.role = 'caregiver' AND u.is_active = TRUE
      GROUP BY u.id, u.first_name, u.last_name, u.employment_type
      ORDER BY weekly_hours DESC NULLS LAST
    `);
    res.json(result.rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
