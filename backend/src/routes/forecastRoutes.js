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
    // Actual billed revenue last N months. Date matches reports.js:
    // service_date with service_date_from fallback, so a claim shows up in
    // both Forecast and Reports or in neither.
    const actual = await db.query(`
      SELECT
        DATE_TRUNC('month', COALESCE(service_date, service_date_from)) AS period,
        SUM(charge_amount) AS billed,
        SUM(paid_amount) AS collected,
        COUNT(*) AS claim_count
      FROM claims
      WHERE COALESCE(service_date, service_date_from) >= CURRENT_DATE - ($1 * INTERVAL '1 month')
        AND status NOT IN ('voided','rejected')
      GROUP BY 1 ORDER BY 1
    `, [months]);

    // Weekly authorization vs schedule, per client. Authorized units are
    // WEEKLY hours (they line up with each client's weekly schedule almost
    // exactly), and per the owner's direction the stale start/end dates are
    // IGNORED — a client with an active schedule is live. Rates come from the
    // client's own private_pay_rate or the payer rate table (effective today);
    // no rate on file means no dollar value is invented.
    const projWin = await db.query(
      `SELECT to_char((NOW() AT TIME ZONE 'America/Chicago')::date, 'YYYY-MM-DD') AS a,
              to_char(((NOW() AT TIME ZONE 'America/Chicago')::date + 6), 'YYYY-MM-DD') AS b`
    );
    const projected = await db.query(`
      WITH ${SCHEDULE_OCCURRENCES_CTE('occ')},
      sched AS (SELECT client_id, SUM(hours) AS hrs FROM occ GROUP BY client_id),
      auths AS (
        SELECT client_id,
          SUM(CASE WHEN unit_type = '15min' THEN COALESCE(authorized_units, 0) / 4.0 ELSE COALESCE(authorized_units, 0) END) AS weekly_hours,
          MAX(service_type) AS service_type,
          MAX(end_date) AS end_date
        FROM authorizations WHERE status = 'active'
        GROUP BY client_id
      )
      SELECT
        c.id AS client_id,
        c.first_name || ' ' || c.last_name AS client_name,
        a.service_type,
        a.weekly_hours AS authorized_hours,
        COALESCE(s.hrs, 0) AS used_hours,
        GREATEST(a.weekly_hours - COALESCE(s.hrs, 0), 0) AS remaining_hours,
        CASE WHEN c.is_private_pay THEN c.private_pay_rate ELSE prate.hourly END AS hourly_rate,
        GREATEST(a.weekly_hours - COALESCE(s.hrs, 0), 0)
          * COALESCE(CASE WHEN c.is_private_pay THEN c.private_pay_rate ELSE prate.hourly END, 0) AS projected_remaining_revenue,
        a.end_date
      FROM auths a
      JOIN clients c ON c.id = a.client_id AND c.is_active = true
      LEFT JOIN sched s ON s.client_id = c.id
      LEFT JOIN LATERAL (
        SELECT CASE WHEN r.rate_type = '15min' THEN r.rate_amount * 4 ELSE r.rate_amount END AS hourly
        FROM referral_source_rates r
        WHERE r.referral_source_id = c.referral_source_id AND r.care_type_id = c.care_type_id
          AND r.is_active = true AND r.effective_date <= CURRENT_DATE
          AND (r.end_date IS NULL OR r.end_date >= CURRENT_DATE)
        ORDER BY r.effective_date DESC LIMIT 1
      ) prate ON true
      ORDER BY projected_remaining_revenue DESC, authorized_hours DESC
    `, [projWin.rows[0].a, projWin.rows[0].b]);

    // Weekly scheduled hours (current + next 4 weeks). Via the shared engine, so the
    // forecast matches what payroll/billing actually see: the old query had no
    // effective_date/end_date bound (it forecast revenue for terminated clients forever),
    // no cancellations, and expanded bi-weekly EVERY week (double revenue).
    const win = await db.query(
      `SELECT to_char((NOW() AT TIME ZONE 'America/Chicago')::date, 'YYYY-MM-DD') AS a,
              to_char(((NOW() AT TIME ZONE 'America/Chicago')::date + 27), 'YYYY-MM-DD') AS b`
    );
    // Weekly revenue valued at each client's real rate (private-pay rate or
    // payer rate effective that day); $18.50 only when no rate is on file.
    const weekly = await db.query(`
      WITH ${SCHEDULE_OCCURRENCES_CTE('occ')}
      SELECT
        DATE_TRUNC('week', occ.occ_date) AS week_start,
        COUNT(DISTINCT occ.caregiver_id) AS caregiver_count,
        COUNT(*) AS shift_count,
        SUM(occ.hours) AS scheduled_hours,
        SUM(occ.hours * COALESCE(
          CASE WHEN c.is_private_pay THEN c.private_pay_rate ELSE prate.hourly END, 18.50)) AS estimated_revenue
      FROM occ
      JOIN clients c ON c.id = occ.client_id
      LEFT JOIN LATERAL (
        SELECT CASE WHEN r.rate_type = '15min' THEN r.rate_amount * 4 ELSE r.rate_amount END AS hourly
        FROM referral_source_rates r
        WHERE r.referral_source_id = c.referral_source_id AND r.care_type_id = c.care_type_id
          AND r.is_active = true AND r.effective_date <= occ.occ_date
          AND (r.end_date IS NULL OR r.end_date >= occ.occ_date)
        ORDER BY r.effective_date DESC LIMIT 1
      ) prate ON true
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
      WHERE COALESCE(cl.service_date, cl.service_date_from) >= CURRENT_DATE - INTERVAL '90 days'
        AND cl.status NOT IN ('voided','rejected')
      GROUP BY 1,2 ORDER BY 3 DESC LIMIT 10
    `);

    // Summary derived from the same per-client weekly rows above, so the KPI
    // tiles can never disagree with the table under them.
    const pRows = projected.rows;
    const totAuth = pRows.reduce((s, r) => s + parseFloat(r.authorized_hours || 0), 0);
    const totSched = pRows.reduce((s, r) => s + parseFloat(r.used_hours || 0), 0);
    const authSummary = {
      total_active_auths: pRows.length,
      total_auth_hours: totAuth,
      total_used_hours: totSched,
      avg_utilization_pct: totAuth > 0 ? Math.round((totSched / totAuth) * 1000) / 10 : 0,
      total_projected_remaining: pRows.reduce((s, r) => s + parseFloat(r.projected_remaining_revenue || 0), 0),
      unvalued_clients: pRows.filter(r => r.hourly_rate == null && parseFloat(r.remaining_hours) > 0).length,
    };

    res.json({
      actual: actual.rows,
      projected: pRows,
      weekly: weekly.rows,
      topClients: topClients.rows,
      authSummary
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
        COALESCE(SUM(occ.hours * COALESCE(
          CASE WHEN c.is_private_pay THEN c.private_pay_rate ELSE prate.hourly END, 18.50)), 0) AS weekly_revenue,
        u.employment_type
      FROM users u
      LEFT JOIN occ ON occ.caregiver_id = u.id
      LEFT JOIN clients c ON c.id = occ.client_id
      LEFT JOIN LATERAL (
        SELECT CASE WHEN r.rate_type = '15min' THEN r.rate_amount * 4 ELSE r.rate_amount END AS hourly
        FROM referral_source_rates r
        WHERE r.referral_source_id = c.referral_source_id AND r.care_type_id = c.care_type_id
          AND r.is_active = true AND r.effective_date <= occ.occ_date
          AND (r.end_date IS NULL OR r.end_date >= occ.occ_date)
        ORDER BY r.effective_date DESC LIMIT 1
      ) prate ON true
      WHERE u.role = 'caregiver' AND u.is_active = TRUE
      GROUP BY u.id, u.first_name, u.last_name, u.employment_type
      ORDER BY weekly_hours DESC NULLS LAST
    `, [win.rows[0].a, win.rows[0].b]);
    res.json(result.rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
