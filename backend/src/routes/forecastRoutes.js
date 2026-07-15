// routes/forecastRoutes.js
// Revenue forecasting based on authorizations, schedules, and billing history

const express = require('express');
const router = express.Router();
const db = require('../db');
const auth = require('../middleware/auth');
const { SCHEDULE_OCCURRENCES_CTE } = require('../helpers/scheduleOccurrences');

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

    // Weekly scheduled hours (current + next 4 weeks). Via the shared engine, so the
    // forecast matches what payroll/billing actually see: the old query had no
    // effective_date/end_date bound (it forecast revenue for terminated clients forever),
    // no cancellations, and expanded bi-weekly EVERY week (double revenue).
    const win = await db.query(
      `SELECT to_char((NOW() AT TIME ZONE 'America/Chicago')::date, 'YYYY-MM-DD') AS a,
              to_char(((NOW() AT TIME ZONE 'America/Chicago')::date + 27), 'YYYY-MM-DD') AS b`
    );
    const weekly = await db.query(`
      WITH ${SCHEDULE_OCCURRENCES_CTE('occ')}
      SELECT
        DATE_TRUNC('week', occ.occ_date) AS week_start,
        COUNT(DISTINCT occ.caregiver_id) AS caregiver_count,
        COUNT(*) AS shift_count,
        SUM(occ.hours) AS scheduled_hours,
        SUM(occ.hours) * 18.50 AS estimated_revenue
      FROM occ
      GROUP BY 1 ORDER BY 1
    `, [win.rows[0].a, win.rows[0].b]);

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
    // Each caregiver's actual scheduled hours over the next 7 days, via the shared engine.
    // The old query matched "any of the last 7 weekdays" — i.e. every recurring shift once,
    // with no effective/end/exception/bi-weekly handling — so ended patterns and cancelled
    // days inflated the numbers and bi-weekly shifts were counted as weekly.
    const win = await db.query(
      `SELECT to_char((NOW() AT TIME ZONE 'America/Chicago')::date, 'YYYY-MM-DD') AS a,
              to_char(((NOW() AT TIME ZONE 'America/Chicago')::date + 6), 'YYYY-MM-DD') AS b`
    );
    const result = await db.query(`
      WITH ${SCHEDULE_OCCURRENCES_CTE('occ')}
      SELECT
        u.id,
        u.first_name || ' ' || u.last_name AS caregiver_name,
        COUNT(DISTINCT occ.client_id) AS client_count,
        COALESCE(SUM(occ.hours), 0) AS weekly_hours,
        COALESCE(SUM(occ.hours), 0) * 18.50 AS weekly_revenue,
        u.employment_type
      FROM users u
      LEFT JOIN occ ON occ.caregiver_id = u.id
      WHERE u.role = 'caregiver' AND u.is_active = TRUE
      GROUP BY u.id, u.first_name, u.last_name, u.employment_type
      ORDER BY weekly_hours DESC NULLS LAST
    `, [win.rows[0].a, win.rows[0].b]);
    res.json(result.rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
