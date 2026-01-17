// routes/reportsRoutes.js
// Reports & Analytics API
// 
// IMPORTANT BUSINESS LOGIC:
// - Client hours = from SCHEDULES table (planned/authorized service hours)
// - Caregiver payroll hours = from TIME_ENTRIES table (actual clock in/out for payroll)
//
// Column names:
// - schedules: start_time, end_time, date, day_of_week, is_active
// - time_entries: start_time, end_time, duration_minutes
// - users (caregivers): role = 'caregiver', default_pay_rate
// - clients: is_active, service_type

const express = require('express');
const router = express.Router();
const db = require('../db');
const auth = require('../middleware/auth');

// Helper to calculate hours from schedule time range
const SCHEDULE_HOURS_CALC = `EXTRACT(EPOCH FROM (s.end_time::time - s.start_time::time)) / 3600`;

// ==================== OVERVIEW REPORT ====================
// POST /api/reports/overview
router.post('/overview', auth, async (req, res) => {
  const { startDate, endDate, caregiverId, clientId } = req.body;

  try {
    // Build filter clauses
    let scheduleFilters = '';
    const params = [startDate, endDate];
    let paramIndex = 3;

    if (caregiverId) {
      scheduleFilters += ` AND s.caregiver_id = $${paramIndex}`;
      params.push(caregiverId);
      paramIndex++;
    }
    if (clientId) {
      scheduleFilters += ` AND s.client_id = $${paramIndex}`;
      params.push(clientId);
      paramIndex++;
    }

    // Summary stats - CLIENT HOURS from schedules
    const summaryQuery = await db.query(`
      SELECT 
        COALESCE(SUM(${SCHEDULE_HOURS_CALC}), 0) as "totalHours",
        COUNT(DISTINCT s.id) as "totalShifts"
      FROM schedules s
      WHERE s.is_active = true
        AND (
          (s.date >= $1 AND s.date <= $2)
          OR (s.day_of_week IS NOT NULL AND s.date IS NULL)
        )
        ${scheduleFilters}
    `, params);

    // Average satisfaction from performance ratings
    const satisfactionQuery = await db.query(`
      SELECT COALESCE(AVG(pr.satisfaction_score), 0) as "avgSatisfaction"
      FROM performance_ratings pr
      WHERE pr.created_at >= $1 AND pr.created_at <= $2
    `, [startDate, endDate]);

    // Revenue from invoices
    const revenueQuery = await db.query(`
      SELECT COALESCE(SUM(i.total), 0) as "totalRevenue"
      FROM invoices i
      WHERE i.billing_period_start >= $1 AND i.billing_period_end <= $2
    `, [startDate, endDate]);

    // Top caregivers - by SCHEDULED hours with clients
    const topCaregiversQuery = await db.query(`
      SELECT 
        u.id,
        u.first_name,
        u.last_name,
        COALESCE(SUM(${SCHEDULE_HOURS_CALC}), 0) as total_hours,
        COALESCE(SUM(${SCHEDULE_HOURS_CALC}) * COALESCE(u.default_pay_rate, 25), 0) as total_revenue,
        COALESCE(AVG(pr.satisfaction_score), 0) as avg_satisfaction,
        COUNT(DISTINCT s.client_id) as clients_served
      FROM users u
      LEFT JOIN schedules s ON s.caregiver_id = u.id 
        AND s.is_active = true
        AND (
          (s.date >= $1 AND s.date <= $2)
          OR (s.day_of_week IS NOT NULL AND s.date IS NULL)
        )
      LEFT JOIN performance_ratings pr ON pr.caregiver_id = u.id
        AND pr.created_at >= $1 AND pr.created_at <= $2
      WHERE u.role = 'caregiver' AND u.is_active = true
      GROUP BY u.id, u.first_name, u.last_name, u.default_pay_rate
      ORDER BY total_hours DESC
      LIMIT 10
    `, [startDate, endDate]);

    // Top clients - by SCHEDULED hours
    const topClientsQuery = await db.query(`
      SELECT 
        c.id,
        c.first_name,
        c.last_name,
        c.service_type,
        COALESCE(SUM(${SCHEDULE_HOURS_CALC}), 0) as total_hours,
        COALESCE(SUM(${SCHEDULE_HOURS_CALC}) * 25, 0) as total_cost,
        COUNT(DISTINCT s.caregiver_id) as caregiver_count
      FROM clients c
      LEFT JOIN schedules s ON s.client_id = c.id 
        AND s.is_active = true
        AND (
          (s.date >= $1 AND s.date <= $2)
          OR (s.day_of_week IS NOT NULL AND s.date IS NULL)
        )
      WHERE c.is_active = true
      GROUP BY c.id, c.first_name, c.last_name, c.service_type
      ORDER BY total_hours DESC
      LIMIT 10
    `, [startDate, endDate]);

    res.json({
      summary: {
        totalHours: parseFloat(summaryQuery.rows[0]?.totalHours) || 0,
        totalRevenue: parseFloat(revenueQuery.rows[0]?.totalRevenue) || 0,
        totalShifts: parseInt(summaryQuery.rows[0]?.totalShifts) || 0,
        avgSatisfaction: parseFloat(satisfactionQuery.rows[0]?.avgSatisfaction) || null
      },
      topCaregivers: topCaregiversQuery.rows,
      topClients: topClientsQuery.rows
    });
  } catch (error) {
    console.error('Overview report error:', error);
    res.status(500).json({ error: error.message });
  }
});

// ==================== HOURS REPORT ====================
// POST /api/reports/hours
router.post('/hours', auth, async (req, res) => {
  const { startDate, endDate, caregiverId, clientId } = req.body;

  try {
    let params = [startDate, endDate];
    let filterClause = '';
    
    if (caregiverId) {
      filterClause += ` AND s.caregiver_id = $${params.length + 1}`;
      params.push(caregiverId);
    }
    if (clientId) {
      filterClause += ` AND s.client_id = $${params.length + 1}`;
      params.push(clientId);
    }

    // Hours by week - from SCHEDULES
    const hoursByWeekQuery = await db.query(`
      SELECT 
        DATE_TRUNC('week', COALESCE(s.date, CURRENT_DATE)) as week_start,
        COALESCE(SUM(${SCHEDULE_HOURS_CALC}), 0) as hours
      FROM schedules s
      WHERE s.is_active = true
        AND (
          (s.date >= $1 AND s.date <= $2)
          OR (s.day_of_week IS NOT NULL AND s.date IS NULL)
        )
        ${filterClause}
      GROUP BY DATE_TRUNC('week', COALESCE(s.date, CURRENT_DATE))
      ORDER BY week_start
    `, params);

    // Hours by service type - from SCHEDULES joined with clients
    const hoursByTypeQuery = await db.query(`
      SELECT 
        COALESCE(c.service_type, 'unspecified') as service_type,
        COALESCE(SUM(${SCHEDULE_HOURS_CALC}), 0) as hours
      FROM schedules s
      JOIN clients c ON s.client_id = c.id
      WHERE s.is_active = true
        AND (
          (s.date >= $1 AND s.date <= $2)
          OR (s.day_of_week IS NOT NULL AND s.date IS NULL)
        )
      GROUP BY c.service_type
      ORDER BY hours DESC
    `, [startDate, endDate]);

    // Calculate total for percentages
    const totalHours = hoursByTypeQuery.rows.reduce((sum, row) => sum + parseFloat(row.hours || 0), 0);

    // Caregiver breakdown - SCHEDULED hours
    const caregiverBreakdownQuery = await db.query(`
      SELECT 
        u.id,
        u.first_name,
        u.last_name,
        COALESCE(SUM(${SCHEDULE_HOURS_CALC}), 0) as total_hours,
        COUNT(DISTINCT s.client_id) as client_count,
        COALESCE(AVG(${SCHEDULE_HOURS_CALC}), 0) as avg_shift_hours
      FROM users u
      LEFT JOIN schedules s ON s.caregiver_id = u.id
        AND s.is_active = true
        AND (
          (s.date >= $1 AND s.date <= $2)
          OR (s.day_of_week IS NOT NULL AND s.date IS NULL)
        )
      WHERE u.role = 'caregiver' AND u.is_active = true
      GROUP BY u.id, u.first_name, u.last_name
      HAVING SUM(${SCHEDULE_HOURS_CALC}) > 0
      ORDER BY total_hours DESC
    `, [startDate, endDate]);

    res.json({
      hoursByWeek: hoursByWeekQuery.rows,
      hoursByType: hoursByTypeQuery.rows.map(row => ({
        ...row,
        percentage: totalHours > 0 ? ((parseFloat(row.hours) / totalHours) * 100).toFixed(1) : 0
      })),
      caregiverBreakdown: caregiverBreakdownQuery.rows,
      totalHours
    });
  } catch (error) {
    console.error('Hours report error:', error);
    res.status(500).json({ error: error.message });
  }
});

// ==================== PERFORMANCE REPORT ====================
// POST /api/reports/performance
router.post('/performance', auth, async (req, res) => {
  const { startDate, endDate, caregiverId } = req.body;

  try {
    // Performance by caregiver - scheduled hours + ratings
    const performanceQuery = await db.query(`
      SELECT 
        u.id,
        u.first_name,
        u.last_name,
        COALESCE(AVG(pr.satisfaction_score), 0) as avg_rating,
        COUNT(DISTINCT pr.id) as rating_count,
        COALESCE(SUM(${SCHEDULE_HOURS_CALC}), 0) as total_hours,
        COUNT(DISTINCT s.client_id) as clients_served,
        COALESCE(
          (SELECT COUNT(*) FROM incidents i WHERE i.reported_by = u.id AND i.created_at >= $1 AND i.created_at <= $2),
          0
        ) as incident_count
      FROM users u
      LEFT JOIN performance_ratings pr ON pr.caregiver_id = u.id
        AND pr.created_at >= $1 AND pr.created_at <= $2
      LEFT JOIN schedules s ON s.caregiver_id = u.id
        AND s.is_active = true
        AND (
          (s.date >= $1 AND s.date <= $2)
          OR (s.day_of_week IS NOT NULL AND s.date IS NULL)
        )
      WHERE u.role = 'caregiver' AND u.is_active = true
        ${caregiverId ? 'AND u.id = $3' : ''}
      GROUP BY u.id, u.first_name, u.last_name
      ORDER BY avg_rating DESC, total_hours DESC
    `, caregiverId ? [startDate, endDate, caregiverId] : [startDate, endDate]);

    // Rating distribution
    const ratingDistributionQuery = await db.query(`
      SELECT 
        pr.satisfaction_score as rating,
        COUNT(*) as count
      FROM performance_ratings pr
      WHERE pr.created_at >= $1 AND pr.created_at <= $2
      GROUP BY pr.satisfaction_score
      ORDER BY pr.satisfaction_score DESC
    `, [startDate, endDate]);

    // Punctuality - from TIME_ENTRIES (actual clock-ins vs scheduled)
    const punctualityQuery = await db.query(`
      SELECT 
        u.id,
        u.first_name,
        u.last_name,
        COUNT(te.id) as total_shifts,
        COUNT(CASE WHEN te.start_time::time <= sch.start_time::time + INTERVAL '5 minutes' THEN 1 END) as on_time_count
      FROM users u
      LEFT JOIN time_entries te ON te.caregiver_id = u.id
        AND te.start_time >= $1 AND te.start_time <= ($2::date + interval '1 day')
        AND te.end_time IS NOT NULL
      LEFT JOIN schedules sch ON te.schedule_id = sch.id
      WHERE u.role = 'caregiver' AND u.is_active = true
      GROUP BY u.id, u.first_name, u.last_name
      HAVING COUNT(te.id) > 0
      ORDER BY (COUNT(CASE WHEN te.start_time::time <= sch.start_time::time + INTERVAL '5 minutes' THEN 1 END)::float / NULLIF(COUNT(te.id), 0)) DESC
    `, [startDate, endDate]);

    res.json({
      caregiverPerformance: performanceQuery.rows,
      ratingDistribution: ratingDistributionQuery.rows,
      punctuality: punctualityQuery.rows.map(row => ({
        ...row,
        on_time_percentage: row.total_shifts > 0 ? ((row.on_time_count / row.total_shifts) * 100).toFixed(1) : 0
      }))
    });
  } catch (error) {
    console.error('Performance report error:', error);
    res.status(500).json({ error: error.message });
  }
});

// ==================== SATISFACTION REPORT ====================
// POST /api/reports/satisfaction
router.post('/satisfaction', auth, async (req, res) => {
  const { startDate, endDate, caregiverId } = req.body;

  try {
    // Overall satisfaction metrics
    const satisfactionQuery = await db.query(`
      SELECT 
        COALESCE(AVG(pr.satisfaction_score), 0) as avg_rating,
        COUNT(pr.id) as total_ratings,
        COUNT(CASE WHEN pr.satisfaction_score >= 4 THEN 1 END) as positive_count,
        COUNT(CASE WHEN pr.satisfaction_score = 3 THEN 1 END) as neutral_count,
        COUNT(CASE WHEN pr.satisfaction_score < 3 THEN 1 END) as negative_count
      FROM performance_ratings pr
      WHERE pr.created_at >= $1 AND pr.created_at <= $2
        ${caregiverId ? 'AND pr.caregiver_id = $3' : ''}
    `, caregiverId ? [startDate, endDate, caregiverId] : [startDate, endDate]);

    // Satisfaction trend by week
    const trendQuery = await db.query(`
      SELECT 
        DATE_TRUNC('week', pr.created_at) as week_start,
        COALESCE(AVG(pr.satisfaction_score), 0) as avg_rating,
        COUNT(*) as count
      FROM performance_ratings pr
      WHERE pr.created_at >= $1 AND pr.created_at <= $2
      GROUP BY DATE_TRUNC('week', pr.created_at)
      ORDER BY week_start
    `, [startDate, endDate]);

    // By client
    const byClientQuery = await db.query(`
      SELECT 
        c.id,
        c.first_name,
        c.last_name,
        COALESCE(AVG(pr.satisfaction_score), 0) as avg_rating,
        COUNT(pr.id) as rating_count
      FROM clients c
      LEFT JOIN performance_ratings pr ON pr.client_id = c.id
        AND pr.created_at >= $1 AND pr.created_at <= $2
      WHERE c.is_active = true
      GROUP BY c.id, c.first_name, c.last_name
      HAVING COUNT(pr.id) > 0
      ORDER BY avg_rating DESC
    `, [startDate, endDate]);

    // Feedback themes (from notes)
    const feedbackQuery = await db.query(`
      SELECT 
        CASE 
          WHEN LOWER(pr.notes) LIKE '%excellent%' OR LOWER(pr.notes) LIKE '%great%' OR LOWER(pr.notes) LIKE '%amazing%' THEN 'Excellent Service'
          WHEN LOWER(pr.notes) LIKE '%punctual%' OR LOWER(pr.notes) LIKE '%on time%' THEN 'Punctuality'
          WHEN LOWER(pr.notes) LIKE '%friendly%' OR LOWER(pr.notes) LIKE '%kind%' OR LOWER(pr.notes) LIKE '%caring%' THEN 'Friendly & Caring'
          WHEN LOWER(pr.notes) LIKE '%professional%' THEN 'Professionalism'
          WHEN LOWER(pr.notes) LIKE '%late%' OR LOWER(pr.notes) LIKE '%missed%' THEN 'Timeliness Issues'
          WHEN LOWER(pr.notes) LIKE '%communication%' THEN 'Communication'
          ELSE 'General Feedback'
        END as theme,
        COUNT(*) as count
      FROM performance_ratings pr
      WHERE pr.created_at >= $1 AND pr.created_at <= $2
        AND pr.notes IS NOT NULL AND pr.notes != ''
      GROUP BY theme
      ORDER BY count DESC
      LIMIT 6
    `, [startDate, endDate]);

    const totalRatings = parseInt(satisfactionQuery.rows[0]?.total_ratings) || 0;

    res.json({
      satisfaction: {
        avg_rating: parseFloat(satisfactionQuery.rows[0]?.avg_rating) || 0,
        total_ratings: totalRatings,
        positive_percentage: totalRatings > 0 ? ((satisfactionQuery.rows[0]?.positive_count / totalRatings) * 100).toFixed(1) : 0,
        neutral_percentage: totalRatings > 0 ? ((satisfactionQuery.rows[0]?.neutral_count / totalRatings) * 100).toFixed(1) : 0,
        negative_percentage: totalRatings > 0 ? ((satisfactionQuery.rows[0]?.negative_count / totalRatings) * 100).toFixed(1) : 0,
        trend: trendQuery.rows,
        feedback_themes: feedbackQuery.rows
      },
      byClient: byClientQuery.rows
    });
  } catch (error) {
    console.error('Satisfaction report error:', error);
    res.status(500).json({ error: error.message });
  }
});

// ==================== REVENUE REPORT ====================
// POST /api/reports/revenue
router.post('/revenue', auth, async (req, res) => {
  const { startDate, endDate, clientId } = req.body;

  try {
    // Overall revenue from invoices
    const revenueQuery = await db.query(`
      SELECT 
        COALESCE(SUM(i.total), 0) as total,
        COALESCE(SUM(i.amount_paid), 0) as collected,
        COUNT(i.id) as invoice_count
      FROM invoices i
      WHERE i.billing_period_start >= $1 AND i.billing_period_end <= $2
        ${clientId ? 'AND i.client_id = $3' : ''}
    `, clientId ? [startDate, endDate, clientId] : [startDate, endDate]);

    // Get billable hours from SCHEDULES (client hours)
    const hoursQuery = await db.query(`
      SELECT COALESCE(SUM(${SCHEDULE_HOURS_CALC}), 0) as billable_hours
      FROM schedules s
      WHERE s.is_active = true
        AND (
          (s.date >= $1 AND s.date <= $2)
          OR (s.day_of_week IS NOT NULL AND s.date IS NULL)
        )
    `, [startDate, endDate]);

    const totalRevenue = parseFloat(revenueQuery.rows[0]?.total) || 0;
    const billableHours = parseFloat(hoursQuery.rows[0]?.billable_hours) || 0;

    // Revenue by service type - from SCHEDULES
    const byServiceTypeQuery = await db.query(`
      SELECT 
        COALESCE(c.service_type, 'unspecified') as service_type,
        COALESCE(SUM(${SCHEDULE_HOURS_CALC}), 0) as hours,
        COALESCE(SUM(${SCHEDULE_HOURS_CALC}) * 25, 0) as revenue
      FROM schedules s
      JOIN clients c ON s.client_id = c.id
      WHERE s.is_active = true
        AND (
          (s.date >= $1 AND s.date <= $2)
          OR (s.day_of_week IS NOT NULL AND s.date IS NULL)
        )
      GROUP BY c.service_type
      ORDER BY revenue DESC
    `, [startDate, endDate]);

    // Revenue by client - from invoices
    const byClientQuery = await db.query(`
      SELECT 
        c.id,
        c.first_name,
        c.last_name,
        COALESCE(SUM(i.total), 0) as revenue
      FROM clients c
      LEFT JOIN invoices i ON i.client_id = c.id
        AND i.billing_period_start >= $1 AND i.billing_period_end <= $2
      WHERE c.is_active = true
      GROUP BY c.id, c.first_name, c.last_name
      HAVING SUM(i.total) > 0
      ORDER BY revenue DESC
      LIMIT 15
    `, [startDate, endDate]);

    res.json({
      revenue: {
        total: totalRevenue,
        collected: parseFloat(revenueQuery.rows[0]?.collected) || 0,
        avgPerHour: billableHours > 0 ? (totalRevenue / billableHours).toFixed(2) : 0,
        billableHours
      },
      byServiceType: byServiceTypeQuery.rows,
      byClient: byClientQuery.rows
    });
  } catch (error) {
    console.error('Revenue report error:', error);
    res.status(500).json({ error: error.message });
  }
});

// ==================== EXPORT ENDPOINTS ====================
// POST /api/reports/:type/export
router.post('/:type/export', auth, async (req, res) => {
  const { type } = req.params;
  const { startDate, endDate, format } = req.body;

  try {
    let data = [];
    let filename = `report-${type}-${new Date().toISOString().split('T')[0]}`;

    if (type === 'overview') {
      const result = await db.query(`
        SELECT 
          u.first_name || ' ' || u.last_name as caregiver,
          COALESCE(SUM(${SCHEDULE_HOURS_CALC}), 0) as scheduled_hours,
          COUNT(DISTINCT s.client_id) as clients
        FROM users u
        LEFT JOIN schedules s ON s.caregiver_id = u.id
          AND s.is_active = true
          AND (s.date >= $1 AND s.date <= $2)
        WHERE u.role = 'caregiver'
        GROUP BY u.id, u.first_name, u.last_name
        ORDER BY scheduled_hours DESC
      `, [startDate, endDate]);
      data = result.rows;
    }

    if (format === 'csv') {
      const headers = data.length > 0 ? Object.keys(data[0]).join(',') : '';
      const rows = data.map(row => Object.values(row).join(','));
      const csv = [headers, ...rows].join('\n');
      
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}.csv"`);
      res.send(csv);
    } else {
      res.status(400).json({ error: 'PDF export not yet implemented' });
    }
  } catch (error) {
    console.error('Export error:', error);
    res.status(500).json({ error: error.message });
  }
});

// ==================== P&L REPORT (LEGACY) ====================
// GET /api/reports/pnl
router.get('/pnl', auth, async (req, res) => {
  const { startDate, endDate } = req.query;
  const start = startDate || new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().split('T')[0];
  const end = endDate || new Date().toISOString().split('T')[0];

  try {
    // Revenue from invoices
    const revenue = await db.query(`
      SELECT 
        COALESCE(SUM(total), 0) as total_billed,
        COALESCE(SUM(amount_paid), 0) as total_collected,
        COALESCE(SUM(total) - SUM(COALESCE(amount_paid, 0)), 0) as outstanding
      FROM invoices
      WHERE billing_period_start >= $1 AND billing_period_end <= $2
    `, [start, end]);

    // Revenue by payer
    const revenueByPayer = await db.query(`
      SELECT 
        COALESCE(rs.name, 'Private Pay') as payer_name,
        COUNT(*) as invoice_count,
        COALESCE(SUM(i.total), 0) as billed,
        COALESCE(SUM(i.amount_paid), 0) as collected
      FROM invoices i
      LEFT JOIN clients c ON i.client_id = c.id
      LEFT JOIN referral_sources rs ON c.referral_source_id = rs.id
      WHERE i.billing_period_start >= $1 AND i.billing_period_end <= $2
      GROUP BY rs.id, rs.name
      ORDER BY billed DESC
    `, [start, end]);

    // Expenses
    const expenses = await db.query(`
      SELECT 
        category,
        COALESCE(SUM(amount), 0) as category_total
      FROM expenses
      WHERE expense_date >= $1 AND expense_date <= $2
      GROUP BY category
      ORDER BY category_total DESC
    `, [start, end]);

    const totalExpenses = expenses.rows.reduce((sum, e) => sum + parseFloat(e.category_total || 0), 0);

    // Payroll from TIME_ENTRIES (actual worked hours for caregiver pay)
    const payroll = await db.query(`
      SELECT 
        COALESCE(SUM(te.duration_minutes / 60.0 * COALESCE(u.default_pay_rate, 15)), 0) as gross_payroll
      FROM time_entries te
      JOIN users u ON te.caregiver_id = u.id
      WHERE te.start_time >= $1 AND te.start_time <= ($2::date + interval '1 day')
        AND te.end_time IS NOT NULL
    `, [start, end]);

    const totalRevenue = parseFloat(revenue.rows[0]?.total_collected || 0);
    const grossPayroll = parseFloat(payroll.rows[0]?.gross_payroll || 0);
    const netIncome = totalRevenue - totalExpenses - grossPayroll;

    res.json({
      period: { start, end },
      revenue: revenue.rows[0],
      revenueByPayer: revenueByPayer.rows,
      expenses: {
        total: totalExpenses,
        byCategory: expenses.rows
      },
      payroll: {
        gross: grossPayroll,
        estimated_taxes: grossPayroll * 0.0765,
        total: grossPayroll * 1.0765
      },
      netIncome,
      margin: totalRevenue > 0 ? ((netIncome / totalRevenue) * 100).toFixed(2) : 0
    });
  } catch (error) {
    console.error('P&L report error:', error);
    res.status(500).json({ error: error.message });
  }
});

// ==================== CAREGIVER PRODUCTIVITY (LEGACY) ====================
// GET /api/reports/caregiver-productivity
router.get('/caregiver-productivity', auth, async (req, res) => {
  const { startDate, endDate } = req.query;
  const start = startDate || new Date(new Date().setDate(new Date().getDate() - 30)).toISOString().split('T')[0];
  const end = endDate || new Date().toISOString().split('T')[0];

  try {
    const result = await db.query(`
      SELECT 
        u.id,
        u.first_name,
        u.last_name,
        COUNT(DISTINCT s.id) as visit_count,
        COUNT(DISTINCT s.client_id) as client_count,
        COALESCE(SUM(${SCHEDULE_HOURS_CALC}), 0) as total_hours,
        COALESCE(AVG(${SCHEDULE_HOURS_CALC}), 0) as avg_hours_per_visit,
        u.default_pay_rate as hourly_rate,
        COALESCE(SUM(${SCHEDULE_HOURS_CALC}), 0) * COALESCE(u.default_pay_rate, 0) as total_pay
      FROM users u
      LEFT JOIN schedules s ON s.caregiver_id = u.id
        AND s.is_active = true
        AND (s.date >= $1 AND s.date <= $2)
      WHERE u.role = 'caregiver' AND u.is_active = true
      GROUP BY u.id, u.first_name, u.last_name, u.default_pay_rate
      ORDER BY total_hours DESC
    `, [start, end]);
    res.json(result.rows);
  } catch (error) {
    console.error('Caregiver productivity error:', error);
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
