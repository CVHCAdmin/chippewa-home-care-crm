// routes/reportsRoutes.js
// Reports & Analytics API - Matches frontend ReportsAnalytics.jsx

const express = require('express');
const router = express.Router();
const db = require('../db');
const auth = require('../middleware/auth');

// ==================== OVERVIEW REPORT ====================
// POST /api/reports/overview
router.post('/overview', auth, async (req, res) => {
  const { startDate, endDate, caregiverId, clientId } = req.body;

  try {
    // Build WHERE clauses for filters
    let caregiverWhere = '';
    let clientWhere = '';
    const params = [startDate, endDate];
    let paramIndex = 3;

    if (caregiverId) {
      caregiverWhere = ` AND te.caregiver_id = $${paramIndex}`;
      params.push(caregiverId);
      paramIndex++;
    }
    if (clientId) {
      clientWhere = ` AND te.client_id = $${paramIndex}`;
      params.push(clientId);
      paramIndex++;
    }

    // Summary stats
    const summaryQuery = await db.query(`
      SELECT 
        COALESCE(SUM(te.hours), 0) as "totalHours",
        COUNT(DISTINCT te.id) as "totalShifts",
        COALESCE(AVG(pr.rating), 0) as "avgSatisfaction"
      FROM time_entries te
      LEFT JOIN performance_ratings pr ON pr.caregiver_id = te.caregiver_id 
        AND pr.created_at >= $1 AND pr.created_at <= $2
      WHERE te.clock_in >= $1 AND te.clock_in <= $2
        AND te.status = 'approved'
        ${caregiverWhere}
        ${clientWhere}
    `, params);

    // Calculate revenue from invoices or estimate from hours
    const revenueQuery = await db.query(`
      SELECT COALESCE(SUM(i.total), 0) as "totalRevenue"
      FROM invoices i
      WHERE i.billing_period_start >= $1 AND i.billing_period_end <= $2
    `, [startDate, endDate]);

    // Top caregivers
    const topCaregiversQuery = await db.query(`
      SELECT 
        cp.id,
        cp.first_name,
        cp.last_name,
        COALESCE(SUM(te.hours), 0) as total_hours,
        COALESCE(SUM(te.hours * COALESCE(cp.hourly_rate, 25)), 0) as total_revenue,
        COALESCE(AVG(pr.rating), 0) as avg_satisfaction,
        COUNT(DISTINCT te.client_id) as clients_served
      FROM caregiver_profiles cp
      LEFT JOIN time_entries te ON te.caregiver_id = cp.id 
        AND te.clock_in >= $1 AND te.clock_in <= $2
        AND te.status = 'approved'
      LEFT JOIN performance_ratings pr ON pr.caregiver_id = cp.id
        AND pr.created_at >= $1 AND pr.created_at <= $2
      WHERE cp.status = 'active'
      GROUP BY cp.id, cp.first_name, cp.last_name, cp.hourly_rate
      ORDER BY total_hours DESC
      LIMIT 10
    `, [startDate, endDate]);

    // Top clients
    const topClientsQuery = await db.query(`
      SELECT 
        c.id,
        c.first_name,
        c.last_name,
        c.service_type,
        COALESCE(SUM(te.hours), 0) as total_hours,
        COALESCE(SUM(te.hours * 25), 0) as total_cost,
        COUNT(DISTINCT te.caregiver_id) as caregiver_count
      FROM clients c
      LEFT JOIN time_entries te ON te.client_id = c.id 
        AND te.clock_in >= $1 AND te.clock_in <= $2
        AND te.status = 'approved'
      WHERE c.status = 'active'
      GROUP BY c.id, c.first_name, c.last_name, c.service_type
      ORDER BY total_hours DESC
      LIMIT 10
    `, [startDate, endDate]);

    res.json({
      summary: {
        totalHours: summaryQuery.rows[0]?.totalHours || 0,
        totalRevenue: revenueQuery.rows[0]?.totalRevenue || 0,
        totalShifts: summaryQuery.rows[0]?.totalShifts || 0,
        avgSatisfaction: summaryQuery.rows[0]?.avgSatisfaction || null
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
    // Hours by week
    const hoursByWeekQuery = await db.query(`
      SELECT 
        DATE_TRUNC('week', te.clock_in) as week_start,
        COALESCE(SUM(te.hours), 0) as hours
      FROM time_entries te
      WHERE te.clock_in >= $1 AND te.clock_in <= $2
        AND te.status = 'approved'
        ${caregiverId ? 'AND te.caregiver_id = $3' : ''}
        ${clientId ? `AND te.client_id = $${caregiverId ? 4 : 3}` : ''}
      GROUP BY DATE_TRUNC('week', te.clock_in)
      ORDER BY week_start
    `, caregiverId ? (clientId ? [startDate, endDate, caregiverId, clientId] : [startDate, endDate, caregiverId]) : (clientId ? [startDate, endDate, clientId] : [startDate, endDate]));

    // Hours by service type
    const hoursByTypeQuery = await db.query(`
      SELECT 
        c.service_type,
        COALESCE(SUM(te.hours), 0) as hours
      FROM time_entries te
      JOIN clients c ON te.client_id = c.id
      WHERE te.clock_in >= $1 AND te.clock_in <= $2
        AND te.status = 'approved'
      GROUP BY c.service_type
      ORDER BY hours DESC
    `, [startDate, endDate]);

    // Calculate total for percentages
    const totalHours = hoursByTypeQuery.rows.reduce((sum, row) => sum + parseFloat(row.hours || 0), 0);

    // Caregiver breakdown
    const caregiverBreakdownQuery = await db.query(`
      SELECT 
        cp.id,
        cp.first_name,
        cp.last_name,
        COALESCE(SUM(te.hours), 0) as total_hours,
        COUNT(DISTINCT te.client_id) as client_count,
        COALESCE(AVG(te.hours), 0) as avg_shift_hours
      FROM caregiver_profiles cp
      LEFT JOIN time_entries te ON te.caregiver_id = cp.id
        AND te.clock_in >= $1 AND te.clock_in <= $2
        AND te.status = 'approved'
      WHERE cp.status = 'active'
      GROUP BY cp.id, cp.first_name, cp.last_name
      HAVING SUM(te.hours) > 0
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
  const { startDate, endDate, caregiverId, clientId } = req.body;

  try {
    // Performance by caregiver
    const performanceQuery = await db.query(`
      SELECT 
        cp.id,
        cp.first_name,
        cp.last_name,
        COALESCE(AVG(pr.rating), 0) as avg_rating,
        COUNT(pr.id) as rating_count,
        COALESCE(SUM(te.hours), 0) as total_hours,
        COUNT(DISTINCT te.client_id) as clients_served,
        COALESCE(
          (SELECT COUNT(*) FROM incidents i WHERE i.caregiver_id = cp.id AND i.created_at >= $1 AND i.created_at <= $2),
          0
        ) as incident_count
      FROM caregiver_profiles cp
      LEFT JOIN performance_ratings pr ON pr.caregiver_id = cp.id
        AND pr.created_at >= $1 AND pr.created_at <= $2
      LEFT JOIN time_entries te ON te.caregiver_id = cp.id
        AND te.clock_in >= $1 AND te.clock_in <= $2
        AND te.status = 'approved'
      WHERE cp.status = 'active'
        ${caregiverId ? 'AND cp.id = $3' : ''}
      GROUP BY cp.id, cp.first_name, cp.last_name
      ORDER BY avg_rating DESC, total_hours DESC
    `, caregiverId ? [startDate, endDate, caregiverId] : [startDate, endDate]);

    // Rating distribution
    const ratingDistributionQuery = await db.query(`
      SELECT 
        pr.rating,
        COUNT(*) as count
      FROM performance_ratings pr
      WHERE pr.created_at >= $1 AND pr.created_at <= $2
      GROUP BY pr.rating
      ORDER BY pr.rating DESC
    `, [startDate, endDate]);

    // On-time metrics (from time entries)
    const punctualityQuery = await db.query(`
      SELECT 
        cp.id,
        cp.first_name,
        cp.last_name,
        COUNT(*) as total_shifts,
        COUNT(CASE WHEN te.clock_in <= s.start_time::time + INTERVAL '5 minutes' THEN 1 END) as on_time_count
      FROM time_entries te
      JOIN caregiver_profiles cp ON te.caregiver_id = cp.id
      LEFT JOIN schedules s ON te.schedule_id = s.id
      WHERE te.clock_in >= $1 AND te.clock_in <= $2
        AND te.status = 'approved'
      GROUP BY cp.id, cp.first_name, cp.last_name
      HAVING COUNT(*) > 0
      ORDER BY (COUNT(CASE WHEN te.clock_in <= s.start_time::time + INTERVAL '5 minutes' THEN 1 END)::float / COUNT(*)) DESC
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
  const { startDate, endDate, caregiverId, clientId } = req.body;

  try {
    // Overall satisfaction metrics
    const satisfactionQuery = await db.query(`
      SELECT 
        COALESCE(AVG(pr.rating), 0) as avg_rating,
        COUNT(pr.id) as total_ratings,
        COUNT(CASE WHEN pr.rating >= 4 THEN 1 END) as positive_count,
        COUNT(CASE WHEN pr.rating = 3 THEN 1 END) as neutral_count,
        COUNT(CASE WHEN pr.rating < 3 THEN 1 END) as negative_count
      FROM performance_ratings pr
      WHERE pr.created_at >= $1 AND pr.created_at <= $2
        ${caregiverId ? 'AND pr.caregiver_id = $3' : ''}
    `, caregiverId ? [startDate, endDate, caregiverId] : [startDate, endDate]);

    // Satisfaction trend by week
    const trendQuery = await db.query(`
      SELECT 
        DATE_TRUNC('week', pr.created_at) as week_start,
        COALESCE(AVG(pr.rating), 0) as avg_rating,
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
        COALESCE(AVG(pr.rating), 0) as avg_rating,
        COUNT(pr.id) as rating_count
      FROM clients c
      LEFT JOIN performance_ratings pr ON pr.client_id = c.id
        AND pr.created_at >= $1 AND pr.created_at <= $2
      WHERE c.status = 'active'
      GROUP BY c.id, c.first_name, c.last_name
      HAVING COUNT(pr.id) > 0
      ORDER BY avg_rating DESC
    `, [startDate, endDate]);

    // Feedback themes (from notes if available)
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
        avg_rating: satisfactionQuery.rows[0]?.avg_rating || 0,
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
  const { startDate, endDate, caregiverId, clientId } = req.body;

  try {
    // Overall revenue
    const revenueQuery = await db.query(`
      SELECT 
        COALESCE(SUM(i.total), 0) as total,
        COALESCE(SUM(i.amount_paid), 0) as collected,
        COUNT(i.id) as invoice_count
      FROM invoices i
      WHERE i.billing_period_start >= $1 AND i.billing_period_end <= $2
        ${clientId ? 'AND i.client_id = $3' : ''}
    `, clientId ? [startDate, endDate, clientId] : [startDate, endDate]);

    // Get billable hours
    const hoursQuery = await db.query(`
      SELECT COALESCE(SUM(te.hours), 0) as billable_hours
      FROM time_entries te
      WHERE te.clock_in >= $1 AND te.clock_in <= $2
        AND te.status = 'approved'
    `, [startDate, endDate]);

    const totalRevenue = parseFloat(revenueQuery.rows[0]?.total) || 0;
    const billableHours = parseFloat(hoursQuery.rows[0]?.billable_hours) || 0;

    // Revenue by service type
    const byServiceTypeQuery = await db.query(`
      SELECT 
        c.service_type,
        COALESCE(SUM(te.hours), 0) as hours,
        COALESCE(SUM(te.hours * 25), 0) as revenue
      FROM time_entries te
      JOIN clients c ON te.client_id = c.id
      WHERE te.clock_in >= $1 AND te.clock_in <= $2
        AND te.status = 'approved'
      GROUP BY c.service_type
      ORDER BY revenue DESC
    `, [startDate, endDate]);

    // Revenue by client
    const byClientQuery = await db.query(`
      SELECT 
        c.id,
        c.first_name,
        c.last_name,
        COALESCE(SUM(i.total), 0) as revenue
      FROM clients c
      LEFT JOIN invoices i ON i.client_id = c.id
        AND i.billing_period_start >= $1 AND i.billing_period_end <= $2
      WHERE c.status = 'active'
      GROUP BY c.id, c.first_name, c.last_name
      HAVING SUM(i.total) > 0
      ORDER BY revenue DESC
      LIMIT 15
    `, [startDate, endDate]);

    res.json({
      revenue: {
        total: totalRevenue,
        collected: revenueQuery.rows[0]?.collected || 0,
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
  const { startDate, endDate, caregiverId, clientId, format } = req.body;

  try {
    // For now, return a simple CSV
    // In production, you'd use a library like json2csv or pdfkit
    
    let data = [];
    let filename = `report-${type}-${new Date().toISOString().split('T')[0]}`;

    // Fetch the same data as the report type
    if (type === 'overview') {
      const result = await db.query(`
        SELECT 
          cp.first_name || ' ' || cp.last_name as caregiver,
          COALESCE(SUM(te.hours), 0) as hours,
          COUNT(DISTINCT te.client_id) as clients
        FROM caregiver_profiles cp
        LEFT JOIN time_entries te ON te.caregiver_id = cp.id
          AND te.clock_in >= $1 AND te.clock_in <= $2
          AND te.status = 'approved'
        GROUP BY cp.id, cp.first_name, cp.last_name
        ORDER BY hours DESC
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
      // For PDF, you'd use pdfkit or similar
      res.status(400).json({ error: 'PDF export not yet implemented' });
    }
  } catch (error) {
    console.error('Export error:', error);
    res.status(500).json({ error: error.message });
  }
});

// ==================== LEGACY ENDPOINTS (keep for backwards compatibility) ====================

// GET /api/reports/pnl - P&L Dashboard
router.get('/pnl', auth, async (req, res) => {
  const { startDate, endDate } = req.query;
  const start = startDate || new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().split('T')[0];
  const end = endDate || new Date().toISOString().split('T')[0];

  try {
    const revenue = await db.query(`
      SELECT 
        COALESCE(SUM(total), 0) as total_billed,
        COALESCE(SUM(amount_paid), 0) as total_collected,
        COALESCE(SUM(total) - SUM(COALESCE(amount_paid, 0)), 0) as outstanding
      FROM invoices
      WHERE billing_period_start >= $1 AND billing_period_end <= $2
    `, [start, end]);

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

    const expenses = await db.query(`
      SELECT 
        COALESCE(SUM(amount), 0) as total_expenses,
        category,
        COALESCE(SUM(amount), 0) as category_total
      FROM expenses
      WHERE expense_date >= $1 AND expense_date <= $2
      GROUP BY category
      ORDER BY category_total DESC
    `, [start, end]);

    const totalExpenses = expenses.rows.reduce((sum, e) => sum + parseFloat(e.category_total || 0), 0);

    const payroll = await db.query(`
      SELECT 
        COALESCE(SUM(te.hours * cp.hourly_rate), 0) as gross_payroll
      FROM time_entries te
      JOIN caregiver_profiles cp ON te.caregiver_id = cp.id
      WHERE te.clock_in >= $1 AND te.clock_in <= $2
      AND te.status = 'approved'
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
    res.status(500).json({ error: error.message });
  }
});

// GET /api/reports/caregiver-productivity
router.get('/caregiver-productivity', auth, async (req, res) => {
  const { startDate, endDate } = req.query;
  const start = startDate || new Date(new Date().setDate(new Date().getDate() - 30)).toISOString().split('T')[0];
  const end = endDate || new Date().toISOString().split('T')[0];

  try {
    const result = await db.query(`
      SELECT 
        cp.id,
        cp.first_name,
        cp.last_name,
        COUNT(DISTINCT te.id) as visit_count,
        COUNT(DISTINCT te.client_id) as client_count,
        COALESCE(SUM(te.hours), 0) as total_hours,
        COALESCE(AVG(te.hours), 0) as avg_hours_per_visit,
        cp.hourly_rate,
        COALESCE(SUM(te.hours), 0) * cp.hourly_rate as total_pay
      FROM caregiver_profiles cp
      LEFT JOIN time_entries te ON te.caregiver_id = cp.id
        AND te.clock_in >= $1 AND te.clock_in <= $2
        AND te.status = 'approved'
      WHERE cp.status = 'active'
      GROUP BY cp.id, cp.first_name, cp.last_name, cp.hourly_rate
      ORDER BY total_hours DESC
    `, [start, end]);
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
