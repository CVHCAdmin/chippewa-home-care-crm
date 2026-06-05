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
          (SELECT COUNT(*) FROM incident_reports i WHERE i.reported_by = u.id AND i.created_at >= $1 AND i.created_at <= $2),
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
          WHEN LOWER(pr.comments) LIKE '%excellent%' OR LOWER(pr.comments) LIKE '%great%' OR LOWER(pr.comments) LIKE '%amazing%' THEN 'Excellent Service'
          WHEN LOWER(pr.comments) LIKE '%punctual%' OR LOWER(pr.comments) LIKE '%on time%' THEN 'Punctuality'
          WHEN LOWER(pr.comments) LIKE '%friendly%' OR LOWER(pr.comments) LIKE '%kind%' OR LOWER(pr.comments) LIKE '%caring%' THEN 'Friendly & Caring'
          WHEN LOWER(pr.comments) LIKE '%professional%' THEN 'Professionalism'
          WHEN LOWER(pr.comments) LIKE '%late%' OR LOWER(pr.comments) LIKE '%missed%' THEN 'Timeliness Issues'
          WHEN LOWER(pr.comments) LIKE '%communication%' THEN 'Communication'
          ELSE 'General Feedback'
        END as theme,
        COUNT(*) as count
      FROM performance_ratings pr
      WHERE pr.created_at >= $1 AND pr.created_at <= $2
        AND pr.comments IS NOT NULL AND pr.comments != ''
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
  const reportType = type; // for PDF title

  try {
    let data = [];
    let filename = `report-${type}-${new Date().toISOString().split('T')[0]}`;
    const sd = startDate || new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().split('T')[0];
    const ed = endDate || new Date().toISOString().split('T')[0];

    if (type === 'overview' || type === 'caregiver_hours' || type === 'caregiver-hours') {
      const result = await db.query(`
        SELECT 
          u.first_name || ' ' || u.last_name as caregiver,
          COALESCE(SUM(te.duration_minutes) / 60.0, 0) as actual_hours,
          COUNT(te.id) as shifts,
          COUNT(DISTINCT te.client_id) as unique_clients
        FROM users u
        LEFT JOIN time_entries te ON te.caregiver_id = u.id
          AND te.start_time >= $1::timestamptz
          AND te.start_time < ($2::date + INTERVAL '1 day')::timestamptz
          AND te.is_complete = true
        WHERE u.role = 'caregiver'
        GROUP BY u.id, u.first_name, u.last_name
        ORDER BY actual_hours DESC
      `, [sd, ed]);
      data = result.rows;
    } else if (type === 'billing' || type === 'revenue') {
      const result = await db.query(`
        SELECT
          c.first_name || ' ' || c.last_name as client,
          i.invoice_number, i.billing_period_start, i.billing_period_end,
          i.total, i.amount_paid, i.payment_status,
          COALESCE(rs.name, 'Private Pay') as payer
        FROM invoices i
        JOIN clients c ON i.client_id = c.id
        LEFT JOIN referral_sources rs ON c.referral_source_id = rs.id
        WHERE i.billing_period_start >= $1 AND i.billing_period_end <= $2
        ORDER BY i.billing_period_start DESC, c.last_name
      `, [sd, ed]);
      data = result.rows;
    } else if (type === 'compliance') {
      const result = await db.query(`
        SELECT
          u.first_name || ' ' || u.last_name as caregiver,
          bc.status as background_check_status,
          bc.initiated_date, bc.expiration_date,
          CASE WHEN bc.expiration_date < CURRENT_DATE THEN 'EXPIRED'
               WHEN bc.expiration_date < CURRENT_DATE + INTERVAL '60 days' THEN 'Expiring Soon'
               WHEN bc.expiration_date IS NULL THEN 'No Check on File'
               ELSE 'Current' END as expiry_status,
          u.certifications
        FROM users u
        LEFT JOIN background_checks bc ON bc.caregiver_id = u.id
          AND bc.id = (SELECT id FROM background_checks bc2 WHERE bc2.caregiver_id = u.id ORDER BY initiated_date DESC NULLS LAST LIMIT 1)
        WHERE u.role = 'caregiver' AND u.is_active = true
        ORDER BY bc.expiration_date ASC NULLS FIRST, u.last_name
      `, []);
      data = result.rows;
    } else if (type === 'clients') {
      const result = await db.query(`
        SELECT
          c.first_name || ' ' || c.last_name as client,
          c.email, c.phone, c.city, c.state,
          c.service_type, CASE WHEN c.is_active THEN 'active' ELSE 'inactive' END as status, c.created_at::date as enrolled_date,
          COALESCE(rs.name, 'Unknown') as referral_source,
          COUNT(DISTINCT s.caregiver_id) as assigned_caregivers
        FROM clients c
        LEFT JOIN referral_sources rs ON c.referral_source_id = rs.id
        LEFT JOIN schedules s ON s.client_id = c.id AND s.is_active = true
        WHERE c.is_active = true
        GROUP BY c.id, c.first_name, c.last_name, c.email, c.phone, c.city, c.state, c.service_type, c.is_active, c.created_at, rs.name
        ORDER BY c.last_name
      `, []);
      data = result.rows;
    } else if (type === 'payroll') {
      const result = await db.query(`
        SELECT
          u.first_name || ' ' || u.last_name as caregiver,
          COALESCE(SUM(te.duration_minutes) / 60.0, 0) as hours_worked,
          COALESCE(u.default_pay_rate, 18.00) as hourly_rate,
          COALESCE(SUM(te.duration_minutes) / 60.0 * COALESCE(u.default_pay_rate, 18.00), 0) as gross_pay,
          COUNT(te.id) as shifts
        FROM users u
        LEFT JOIN time_entries te ON te.caregiver_id = u.id
          AND te.start_time >= $1::timestamptz
          AND te.start_time < ($2::date + INTERVAL '1 day')::timestamptz
          AND te.is_complete = true
        WHERE u.role = 'caregiver'
        GROUP BY u.id, u.first_name, u.last_name, u.default_pay_rate
        ORDER BY gross_pay DESC
      `, [sd, ed]);
      data = result.rows;
    } else {
      // Fallback: overview
      const result = await db.query(`
        SELECT u.first_name || ' ' || u.last_name as caregiver,
          COALESCE(SUM(te.duration_minutes) / 60.0, 0) as hours
        FROM users u
        LEFT JOIN time_entries te ON te.caregiver_id = u.id
          AND te.start_time >= $1::timestamptz AND te.is_complete = true
        WHERE u.role = 'caregiver'
        GROUP BY u.id, u.first_name, u.last_name
        ORDER BY hours DESC
      `, [sd]);
      data = result.rows;
    }

    if (format === 'csv') {
      const headers = data.length > 0 ? Object.keys(data[0]).join(',') : '';
      const rows = data.map(row => Object.values(row).map(v => `"${String(v).replace(/"/g, '""')}"`).join(','));
      const csv = [headers, ...rows].join('\n');
      
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}.csv"`);
      res.send(csv);
    } else if (format === 'pdf') {
      const PDFDocument = require('pdfkit');
      const doc = new PDFDocument({ margin: 50, size: 'LETTER' });

      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}.pdf"`);
      doc.pipe(res);

      // Header
      doc.fontSize(18).fillColor('#2ABBA7').text('Chippewa Valley Home Care', 50, 50);
      doc.fontSize(13).fillColor('#333').text(`${reportType.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())} Report`, 50, 75);
      doc.fontSize(10).fillColor('#666').text(`Period: ${startDate} – ${endDate}`, 50, 95);
      doc.text(`Generated: ${new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}`, 50, 110);
      doc.moveTo(50, 130).lineTo(562, 130).strokeColor('#2ABBA7').stroke();

      if (data.length === 0) {
        doc.fontSize(12).fillColor('#666').text('No data found for the selected period.', 50, 150);
      } else {
        const keys = Object.keys(data[0]);
        const colWidth = Math.min(Math.floor(512 / keys.length), 120);
        let y = 150;

        // Table header
        doc.fontSize(9).fillColor('#fff');
        doc.rect(50, y, 512, 18).fill('#2ABBA7');
        keys.forEach((key, i) => {
          doc.fillColor('#fff').text(key.replace(/_/g, ' ').toUpperCase(), 53 + i * colWidth, y + 4, { width: colWidth - 4, ellipsis: true });
        });
        y += 20;

        // Table rows
        data.forEach((row, rowIdx) => {
          if (y > 700) {
            doc.addPage();
            y = 50;
          }
          if (rowIdx % 2 === 0) {
            doc.rect(50, y, 512, 16).fill('#F9FAFB');
          }
          doc.fontSize(8).fillColor('#333');
          keys.forEach((key, i) => {
            const val = row[key] !== null && row[key] !== undefined ? String(row[key]) : '—';
            doc.text(val, 53 + i * colWidth, y + 3, { width: colWidth - 4, ellipsis: true });
          });
          y += 18;
        });

        // Summary
        y += 10;
        doc.fontSize(10).fillColor('#333').text(`Total Records: ${data.length}`, 50, y);
      }

      doc.end();
    } else {
      res.status(400).json({ error: `Unsupported format: ${format}` });
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

// ==================== CLIENT COMPREHENSIVE REPORT ====================
// Aggregates every record tied to a client within a date range.
// Designed as a single source of truth for audits, surveyor visits,
// family requests, incident investigations, and legal/compliance.

const ALL_CLIENT_REPORT_SECTIONS = [
  'demographics', 'care_plan', 'medications', 'adls',
  'visits', 'incidents', 'communications', 'documents',
  'authorizations', 'billing', 'audit'
];

async function fetchClientReportData(clientId, from, to, sections) {
  const wants = new Set(sections);
  const data = {
    clientId,
    period: { from, to },
    sections: Array.from(wants),
    generatedAt: new Date().toISOString()
  };

  // Demographics, emergency contacts, onboarding, current assignments — always include.
  const clientQ = await db.query(`
    SELECT c.*,
      rs.name AS referral_source_name,
      ct.name AS care_type_name
    FROM clients c
    LEFT JOIN referral_sources rs ON rs.id = c.referral_source_id
    LEFT JOIN care_types ct ON ct.id = c.care_type_id
    WHERE c.id = $1
  `, [clientId]);
  if (clientQ.rows.length === 0) return null;
  data.client = clientQ.rows[0];

  const [ecQ, onboardQ, assignQ] = await Promise.all([
    db.query(`SELECT name, relationship, phone, email, is_primary FROM client_emergency_contacts WHERE client_id = $1 ORDER BY is_primary DESC, name`, [clientId]),
    db.query(`SELECT * FROM client_onboarding WHERE client_id = $1`, [clientId]),
    db.query(`SELECT ca.*, u.first_name||' '||u.last_name AS caregiver_name
              FROM client_assignments ca
              LEFT JOIN users u ON u.id = ca.caregiver_id
              WHERE ca.client_id = $1
              ORDER BY ca.status = 'active' DESC, ca.assignment_date DESC`, [clientId])
  ]);
  data.emergencyContacts = ecQ.rows;
  data.onboarding = onboardQ.rows[0] || null;
  data.assignments = assignQ.rows;

  if (wants.has('care_plan')) {
    const [plansQ, adlReqQ] = await Promise.all([
      db.query(`SELECT * FROM care_plans WHERE client_id = $1 ORDER BY start_date DESC NULLS LAST, created_at DESC`, [clientId]),
      db.query(`SELECT * FROM client_adl_requirements WHERE client_id = $1 ORDER BY adl_category`, [clientId])
    ]);
    data.carePlans = plansQ.rows;
    data.adlRequirements = adlReqQ.rows;
  }

  if (wants.has('medications')) {
    const [medsQ, medLogQ] = await Promise.all([
      db.query(`SELECT * FROM client_medications WHERE client_id = $1 ORDER BY is_active DESC, medication_name`, [clientId]),
      db.query(`SELECT ml.*, cm.medication_name, u.first_name||' '||u.last_name AS caregiver_name
                FROM medication_logs ml
                LEFT JOIN client_medications cm ON cm.id = ml.medication_id
                LEFT JOIN users u ON u.id = ml.caregiver_id
                WHERE ml.client_id = $1
                  AND ml.administered_time >= $2::timestamptz
                  AND ml.administered_time < ($3::date + INTERVAL '1 day')::timestamptz
                ORDER BY ml.administered_time DESC`, [clientId, from, to])
    ]);
    data.medications = medsQ.rows;
    data.medicationLogs = medLogQ.rows;
  }

  if (wants.has('adls')) {
    const adlQ = await db.query(`
      SELECT al.*, u.first_name||' '||u.last_name AS caregiver_name
      FROM adl_logs al
      LEFT JOIN users u ON u.id = al.caregiver_id
      WHERE al.client_id = $1
        AND al.performed_at >= $2::timestamptz
        AND al.performed_at < ($3::date + INTERVAL '1 day')::timestamptz
      ORDER BY al.performed_at DESC
    `, [clientId, from, to]);
    data.adlLogs = adlQ.rows;
  }

  if (wants.has('visits')) {
    const visitsQ = await db.query(`
      SELECT te.id, te.start_time, te.end_time, te.duration_minutes,
             te.clock_in_location, te.clock_out_location,
             te.notes, te.is_complete,
             u.first_name||' '||u.last_name AS caregiver_name,
             ev.service_code, ev.modifier, ev.units_of_service,
             ev.sandata_status, ev.sandata_visit_id,
             ev.gps_in_lat, ev.gps_in_lng, ev.gps_out_lat, ev.gps_out_lng,
             ev.is_verified AS evv_verified,
             ev.sandata_exception_code, ev.sandata_exception_desc
      FROM time_entries te
      LEFT JOIN users u ON u.id = te.caregiver_id
      LEFT JOIN evv_visits ev ON ev.time_entry_id = te.id
      WHERE te.client_id = $1
        AND te.start_time >= $2::timestamptz
        AND te.start_time < ($3::date + INTERVAL '1 day')::timestamptz
      ORDER BY te.start_time DESC
    `, [clientId, from, to]);
    data.visits = visitsQ.rows;

    const notesQ = await db.query(`
      SELECT cvn.*, u.first_name||' '||u.last_name AS caregiver_name
      FROM client_visit_notes cvn
      LEFT JOIN users u ON u.id = cvn.caregiver_id
      WHERE cvn.client_id = $1
        AND cvn.created_at >= $2::timestamptz
        AND cvn.created_at < ($3::date + INTERVAL '1 day')::timestamptz
      ORDER BY cvn.created_at DESC
    `, [clientId, from, to]);
    data.visitNotes = notesQ.rows;
  }

  if (wants.has('incidents')) {
    const incQ = await db.query(`
      SELECT ir.*, u.first_name||' '||u.last_name AS caregiver_name
      FROM incident_reports ir
      LEFT JOIN users u ON u.id = ir.caregiver_id
      WHERE ir.client_id = $1
        AND COALESCE(ir.incident_date, ir.created_at::date) BETWEEN $2::date AND $3::date
      ORDER BY ir.incident_date DESC NULLS LAST, ir.incident_time DESC NULLS LAST
    `, [clientId, from, to]);
    data.incidents = incQ.rows;
  }

  if (wants.has('communications')) {
    const commQ = await db.query(`
      SELECT cl.*
      FROM communication_log cl
      WHERE cl.entity_type = 'client' AND cl.entity_id = $1
        AND cl.created_at >= $2::timestamptz
        AND cl.created_at < ($3::date + INTERVAL '1 day')::timestamptz
      ORDER BY cl.is_pinned DESC, cl.created_at DESC
    `, [clientId, from, to]);
    data.communications = commQ.rows;
  }

  if (wants.has('documents')) {
    const docsQ = await db.query(`
      SELECT id, document_type, name, description, file_type, requires_signature,
             expiration_date, is_confidential, signed_at, created_at
      FROM documents
      WHERE entity_type = 'client' AND entity_id = $1
      ORDER BY created_at DESC
    `, [clientId]);
    data.documents = docsQ.rows;
  }

  if (wants.has('authorizations')) {
    // Schema drift: newer migration added authorization_number/total_units aliases.
    // Use COALESCE so this works whichever columns are present.
    const authQ = await db.query(`
      SELECT a.id,
             COALESCE(a.auth_number, a.authorization_number) AS auth_number,
             a.midas_auth_id,
             a.procedure_code, a.modifier,
             COALESCE(a.authorized_units, a.total_units) AS authorized_units,
             a.used_units,
             (COALESCE(a.authorized_units, a.total_units) - COALESCE(a.used_units, 0)) AS remaining_units,
             a.unit_type, a.start_date, a.end_date, a.status,
             COALESCE(rs.name, a.payer_name) AS payer_name
      FROM authorizations a
      LEFT JOIN referral_sources rs ON rs.id = a.payer_id
      WHERE a.client_id = $1
      ORDER BY a.end_date DESC NULLS LAST
    `, [clientId]);
    data.authorizations = authQ.rows;
  }

  if (wants.has('billing')) {
    const invQ = await db.query(`
      SELECT id, invoice_number, billing_period_start, billing_period_end,
             subtotal, tax, total, payment_status, payment_due_date,
             payment_date, payment_method
      FROM invoices
      WHERE client_id = $1
        AND billing_period_end >= $2::date
        AND billing_period_start <= $3::date
      ORDER BY billing_period_start DESC
    `, [clientId, from, to]);
    data.invoices = invQ.rows;
  }

  if (wants.has('audit')) {
    // audit_logs records changes to the client row itself (record_id = clientId).
    const auditQ = await db.query(`
      SELECT al.action, al.table_name, al.timestamp, al.ip_address,
             u.first_name||' '||u.last_name AS user_name, u.email AS user_email
      FROM audit_logs al
      LEFT JOIN users u ON u.id = al.user_id
      WHERE al.record_id = $1
        AND al.timestamp >= $2::timestamptz
        AND al.timestamp < ($3::date + INTERVAL '1 day')::timestamptz
      ORDER BY al.timestamp DESC
      LIMIT 500
    `, [clientId, from, to]);
    data.auditLog = auditQ.rows;
  }

  return data;
}

function parseClientReportParams(req) {
  const today = new Date().toISOString().slice(0, 10);
  const defaultFrom = new Date(Date.now() - 90 * 86400 * 1000).toISOString().slice(0, 10);
  const from = req.query.from || defaultFrom;
  const to = req.query.to || today;
  const sectionsParam = (req.query.sections || '').trim();
  const sections = sectionsParam
    ? sectionsParam.split(',').map(s => s.trim()).filter(s => ALL_CLIENT_REPORT_SECTIONS.includes(s))
    : ALL_CLIENT_REPORT_SECTIONS;
  return { from, to, sections };
}

async function logReportGeneration(userId, clientId, from, to, sections, format) {
  try {
    await db.query(
      `INSERT INTO audit_logs (user_id, action, table_name, record_id, new_data)
       VALUES ($1, $2, $3, $4, $5)`,
      [userId, `REPORT_GENERATED_${format.toUpperCase()}`, 'clients', clientId,
       JSON.stringify({ from, to, sections })]
    );
  } catch (e) {
    // Don't block the report on audit-log write failure.
    console.error('Failed to log report generation:', e.message);
  }
}

// GET /api/reports/client/:id  — JSON preview for the UI
router.get('/client/:id', auth, async (req, res) => {
  try {
    const { from, to, sections } = parseClientReportParams(req);
    const data = await fetchClientReportData(req.params.id, from, to, sections);
    if (!data) return res.status(404).json({ error: 'Client not found' });
    await logReportGeneration(req.user.id, req.params.id, from, to, sections, 'json');
    res.json(data);
  } catch (err) {
    console.error('Client report error:', err);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/reports/client/:id/pdf  — downloadable PDF
router.get('/client/:id/pdf', auth, async (req, res) => {
  try {
    const { from, to, sections } = parseClientReportParams(req);
    const data = await fetchClientReportData(req.params.id, from, to, sections);
    if (!data) return res.status(404).json({ error: 'Client not found' });
    await logReportGeneration(req.user.id, req.params.id, from, to, sections, 'pdf');

    const PDFDocument = require('pdfkit');
    const doc = new PDFDocument({ margin: 50, size: 'LETTER', bufferPages: true });
    const name = `${data.client.first_name}-${data.client.last_name}`.replace(/[^A-Za-z0-9-]/g, '');
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="client-report-${name}-${from}-to-${to}.pdf"`);
    doc.pipe(res);
    renderClientReportPdf(doc, data);
    doc.end();
  } catch (err) {
    console.error('Client PDF report error:', err);
    if (!res.headersSent) res.status(500).json({ error: err.message });
  }
});

// ==================== PDF RENDERING HELPERS ====================
function renderClientReportPdf(doc, data) {
  const TEAL = '#2ABBA7';
  const INK = '#111827';
  const MUTED = '#6B7280';
  const RULE = '#E5E7EB';

  const fmtDate = (v) => {
    if (!v) return '—';
    const d = typeof v === 'string' ? new Date(v) : v;
    if (isNaN(d)) return String(v);
    return d.toLocaleDateString('en-US');
  };
  const fmtDateTime = (v) => {
    if (!v) return '—';
    const d = typeof v === 'string' ? new Date(v) : v;
    if (isNaN(d)) return String(v);
    return d.toLocaleString('en-US');
  };
  const fmtMoney = (v) => {
    const n = parseFloat(v);
    return isNaN(n) ? '—' : `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  };
  const safe = (v) => (v === null || v === undefined || v === '') ? '—' : String(v);
  const minutesToHours = (m) => (m == null) ? '—' : (Number(m) / 60).toFixed(2) + ' h';

  const ensureSpace = (needed) => {
    if (doc.y + needed > doc.page.height - 60) doc.addPage();
  };

  const sectionHeader = (title) => {
    ensureSpace(40);
    doc.moveDown(0.75);
    doc.fillColor(TEAL).fontSize(13).font('Helvetica-Bold').text(title, { paragraphGap: 2 });
    const y = doc.y;
    doc.moveTo(50, y).lineTo(562, y).strokeColor(TEAL).lineWidth(1.2).stroke();
    doc.moveDown(0.4);
    doc.fillColor(INK).fontSize(10).font('Helvetica');
  };

  const kv = (label, value) => {
    ensureSpace(14);
    doc.fontSize(9).fillColor(MUTED).font('Helvetica').text(label, 50, doc.y, { width: 140, continued: true });
    doc.fillColor(INK).font('Helvetica').text(safe(value), { width: 370 });
  };

  const paragraph = (text) => {
    ensureSpace(20);
    doc.fontSize(10).fillColor(INK).font('Helvetica').text(safe(text), { width: 512 });
    doc.moveDown(0.3);
  };

  const emptyNote = (msg) => {
    doc.fontSize(10).fillColor(MUTED).font('Helvetica-Oblique').text(msg);
    doc.fillColor(INK).font('Helvetica');
  };

  // Simple table row renderer with wrap + zebra striping.
  const renderTable = (columns, rows) => {
    if (!rows || rows.length === 0) { emptyNote('No records in this period.'); return; }
    const totalWidth = 512;
    const colWidths = columns.map(c => Math.floor(totalWidth * c.w));
    const startX = 50;

    // Header row
    ensureSpace(24);
    let y = doc.y;
    doc.rect(startX, y, totalWidth, 18).fill(TEAL);
    doc.fillColor('#fff').fontSize(9).font('Helvetica-Bold');
    let x = startX;
    columns.forEach((c, i) => {
      doc.text(c.label, x + 4, y + 5, { width: colWidths[i] - 8, ellipsis: true });
      x += colWidths[i];
    });
    doc.fillColor(INK).font('Helvetica');
    y += 18;
    doc.y = y;

    rows.forEach((row, idx) => {
      const cellTexts = columns.map(c => {
        const raw = typeof c.get === 'function' ? c.get(row) : row[c.key];
        return safe(raw);
      });
      // Measure tallest cell to size the row
      doc.fontSize(8.5).font('Helvetica');
      let maxH = 12;
      cellTexts.forEach((t, i) => {
        const h = doc.heightOfString(t, { width: colWidths[i] - 8 });
        if (h > maxH) maxH = h;
      });
      const rowH = maxH + 6;
      ensureSpace(rowH + 2);
      y = doc.y;
      if (idx % 2 === 0) {
        doc.rect(startX, y, totalWidth, rowH).fill('#F9FAFB');
      }
      doc.fillColor(INK);
      x = startX;
      cellTexts.forEach((t, i) => {
        doc.text(t, x + 4, y + 3, { width: colWidths[i] - 8, height: rowH });
        x += colWidths[i];
      });
      // Bottom rule
      doc.moveTo(startX, y + rowH).lineTo(startX + totalWidth, y + rowH).strokeColor(RULE).lineWidth(0.5).stroke();
      doc.y = y + rowH;
    });
    doc.moveDown(0.3);
  };

  // ─── HEADER ──────────────────────────────────────────────────────────────────
  doc.rect(0, 0, doc.page.width, 72).fill(TEAL);
  doc.fillColor('#fff').fontSize(18).font('Helvetica-Bold').text('Chippewa Valley Home Care', 50, 18);
  doc.fontSize(12).font('Helvetica').text('Client Comprehensive Report', 50, 42);
  doc.fillColor(INK);

  doc.y = 90;
  const c = data.client;
  doc.fontSize(20).font('Helvetica-Bold').text(`${c.first_name} ${c.last_name}`, 50, doc.y);
  doc.moveDown(0.2);
  doc.fontSize(10).fillColor(MUTED).font('Helvetica')
     .text(`Report Period: ${fmtDate(data.period.from)} – ${fmtDate(data.period.to)}    •    Generated ${fmtDateTime(data.generatedAt)}`);
  doc.fillColor(INK);
  doc.moveDown(0.8);

  // ─── DEMOGRAPHICS (always) ───────────────────────────────────────────────────
  sectionHeader('Client Information');
  kv('Date of Birth', c.date_of_birth ? fmtDate(c.date_of_birth) : null);
  kv('Gender', c.gender);
  kv('Phone', c.phone);
  kv('Email', c.email);
  const addr = [c.address, c.city, c.state, c.zip].filter(Boolean).join(', ');
  kv('Address', addr);
  kv('Service Start', c.start_date ? fmtDate(c.start_date) : null);
  kv('Service Type', c.service_type);
  kv('Care Type', c.care_type_name);
  kv('Referral Source', c.referral_source_name);
  kv('Status', c.is_active ? 'Active' : 'Inactive');

  sectionHeader('Insurance & Identifiers');
  kv('Primary Insurance', c.insurance_provider);
  kv('Insurance ID', c.insurance_id);
  kv('Medicaid ID', c.medicaid_id);
  kv('MCO Member ID', c.mco_member_id);
  kv('Primary Diagnosis', c.primary_diagnosis_code);
  kv('Secondary Diagnosis', c.secondary_diagnosis_code);
  if (c.is_private_pay) {
    kv('Private Pay Rate', c.private_pay_rate ? `$${c.private_pay_rate} / ${c.private_pay_rate_type || 'hourly'}` : null);
  }

  if (c.medical_conditions?.length || c.allergies?.length || c.medications?.length) {
    sectionHeader('Medical Overview');
    if (c.medical_conditions?.length) { kv('Conditions', c.medical_conditions.join(', ')); }
    if (c.allergies?.length) { kv('Allergies', c.allergies.join(', ')); }
    if (c.medications?.length) { kv('Medications (summary)', c.medications.join(', ')); }
  }

  sectionHeader('Emergency Contacts');
  if (data.emergencyContacts.length === 0) { emptyNote('No emergency contacts on file.'); }
  else {
    renderTable([
      { label: 'Name', w: 0.28, key: 'name' },
      { label: 'Relationship', w: 0.20, key: 'relationship' },
      { label: 'Phone', w: 0.22, key: 'phone' },
      { label: 'Email', w: 0.22, key: 'email' },
      { label: 'Primary', w: 0.08, get: r => r.is_primary ? 'Yes' : '' }
    ], data.emergencyContacts);
  }

  sectionHeader('Caregiver Assignments');
  if (data.assignments.length === 0) { emptyNote('No caregiver assignments on record.'); }
  else {
    renderTable([
      { label: 'Caregiver', w: 0.32, key: 'caregiver_name' },
      { label: 'Assigned', w: 0.18, get: r => fmtDate(r.assignment_date) },
      { label: 'Hrs/Wk', w: 0.12, key: 'hours_per_week' },
      { label: 'Status', w: 0.18, key: 'status' },
      { label: 'Notes', w: 0.20, key: 'notes' }
    ], data.assignments);
  }

  // ─── CARE PLAN ───────────────────────────────────────────────────────────────
  if (data.carePlans) {
    sectionHeader('Care Plan');
    if (data.carePlans.length === 0) { emptyNote('No care plan on file.'); }
    data.carePlans.forEach(cp => {
      ensureSpace(60);
      doc.fontSize(10).font('Helvetica-Bold').fillColor(INK)
         .text(`${safe(cp.service_type)} — ${fmtDate(cp.start_date)} to ${fmtDate(cp.end_date)}`);
      doc.font('Helvetica').fontSize(9);
      if (cp.service_description) paragraph(`Service: ${cp.service_description}`);
      if (cp.frequency) paragraph(`Frequency: ${cp.frequency}`);
      if (cp.care_goals) paragraph(`Goals: ${cp.care_goals}`);
      if (cp.special_instructions) paragraph(`Special Instructions: ${cp.special_instructions}`);
      if (cp.precautions) paragraph(`Precautions: ${cp.precautions}`);
      if (cp.medication_notes) paragraph(`Medication Notes: ${cp.medication_notes}`);
      if (cp.mobility_notes) paragraph(`Mobility: ${cp.mobility_notes}`);
      if (cp.dietary_notes) paragraph(`Diet: ${cp.dietary_notes}`);
      if (cp.communication_notes) paragraph(`Communication: ${cp.communication_notes}`);
      doc.moveDown(0.3);
    });

    if (data.adlRequirements?.length) {
      doc.moveDown(0.2);
      doc.fontSize(11).font('Helvetica-Bold').fillColor(INK).text('ADL Requirements');
      doc.moveDown(0.2);
      renderTable([
        { label: 'Category', w: 0.22, key: 'adl_category' },
        { label: 'Assistance', w: 0.18, key: 'assistance_level' },
        { label: 'Frequency', w: 0.18, key: 'frequency' },
        { label: 'Instructions', w: 0.42, key: 'special_instructions' }
      ], data.adlRequirements);
    }
  }

  // ─── MEDICATIONS ─────────────────────────────────────────────────────────────
  if (data.medications) {
    sectionHeader('Medications');
    if (data.medications.length === 0) { emptyNote('No medications on file.'); }
    else {
      renderTable([
        { label: 'Medication', w: 0.26, key: 'medication_name' },
        { label: 'Dosage', w: 0.12, key: 'dosage' },
        { label: 'Frequency', w: 0.15, key: 'frequency' },
        { label: 'Route', w: 0.10, key: 'route' },
        { label: 'Prescriber', w: 0.20, key: 'prescriber' },
        { label: 'Active', w: 0.09, get: r => r.is_active ? 'Yes' : 'No' },
        { label: 'PRN', w: 0.08, get: r => r.is_prn ? 'Yes' : '' }
      ], data.medications);
    }

    if (data.medicationLogs) {
      doc.moveDown(0.3);
      doc.fontSize(11).font('Helvetica-Bold').fillColor(INK).text('Medication Administration (period)');
      doc.moveDown(0.2);
      renderTable([
        { label: 'Administered', w: 0.22, get: r => fmtDateTime(r.administered_time) },
        { label: 'Medication', w: 0.22, key: 'medication_name' },
        { label: 'Dose Given', w: 0.12, key: 'dosage_given' },
        { label: 'Status', w: 0.10, key: 'status' },
        { label: 'Caregiver', w: 0.18, key: 'caregiver_name' },
        { label: 'Notes', w: 0.16, key: 'notes' }
      ], data.medicationLogs);
    }
  }

  // ─── ADL LOGS ────────────────────────────────────────────────────────────────
  if (data.adlLogs) {
    sectionHeader('ADL Activity Log');
    renderTable([
      { label: 'When', w: 0.20, get: r => fmtDateTime(r.performed_at) },
      { label: 'Category', w: 0.20, key: 'adl_category' },
      { label: 'Status', w: 0.12, key: 'status' },
      { label: 'Assistance', w: 0.15, key: 'assistance_level' },
      { label: 'Caregiver', w: 0.18, key: 'caregiver_name' },
      { label: 'Notes', w: 0.15, key: 'notes' }
    ], data.adlLogs);
  }

  // ─── VISITS ──────────────────────────────────────────────────────────────────
  if (data.visits) {
    const visits = data.visits;
    const totalMinutes = visits.reduce((s, v) => s + (v.duration_minutes || 0), 0);
    sectionHeader(`Visit / EVV History  (${visits.length} visits • ${(totalMinutes / 60).toFixed(2)} hours)`);
    renderTable([
      { label: 'Start', w: 0.16, get: r => fmtDateTime(r.start_time) },
      { label: 'End', w: 0.16, get: r => fmtDateTime(r.end_time) },
      { label: 'Dur.', w: 0.08, get: r => minutesToHours(r.duration_minutes) },
      { label: 'Caregiver', w: 0.18, key: 'caregiver_name' },
      { label: 'EVV / Sandata', w: 0.20, get: r => r.sandata_status ? `${r.sandata_status}${r.sandata_visit_id ? ' #' + r.sandata_visit_id : ''}` : (r.is_complete ? 'complete' : 'open') },
      { label: 'Service', w: 0.10, get: r => [r.service_code, r.modifier].filter(Boolean).join(' ') },
      { label: 'GPS', w: 0.12, get: r => (r.gps_in_lat ? `${Number(r.gps_in_lat).toFixed(4)},${Number(r.gps_in_lng).toFixed(4)}` : (r.clock_in_location && r.clock_in_location.lat ? `${Number(r.clock_in_location.lat).toFixed(4)},${Number(r.clock_in_location.lng).toFixed(4)}` : '—')) }
    ], visits);

    if (data.visitNotes?.length) {
      doc.moveDown(0.3);
      doc.fontSize(11).font('Helvetica-Bold').fillColor(INK).text('Visit Notes');
      doc.moveDown(0.2);
      data.visitNotes.forEach(n => {
        ensureSpace(30);
        doc.fontSize(9).fillColor(MUTED).font('Helvetica')
           .text(`${fmtDateTime(n.created_at)} — ${safe(n.caregiver_name)}`);
        doc.fontSize(10).fillColor(INK).font('Helvetica').text(safe(n.note), { width: 512 });
        doc.moveDown(0.3);
      });
    }
  }

  // ─── INCIDENTS ───────────────────────────────────────────────────────────────
  if (data.incidents) {
    sectionHeader(`Incident Reports (${data.incidents.length})`);
    if (data.incidents.length === 0) { emptyNote('No incidents reported in this period.'); }
    data.incidents.forEach(ir => {
      ensureSpace(80);
      doc.fontSize(10).font('Helvetica-Bold').fillColor(INK)
         .text(`${safe(ir.incident_type).toUpperCase()} — ${fmtDate(ir.incident_date)} ${safe(ir.incident_time)}`);
      doc.fontSize(9).fillColor(MUTED).font('Helvetica')
         .text(`Severity: ${safe(ir.severity)}    Caregiver: ${safe(ir.caregiver_name)}    Reported by: ${safe(ir.reported_by)}`);
      doc.fillColor(INK).fontSize(10);
      if (ir.description) paragraph(`Description: ${ir.description}`);
      if (ir.witnesses) paragraph(`Witnesses: ${ir.witnesses}`);
      if (ir.injuries_or_damage) paragraph(`Injuries/Damage: ${ir.injuries_or_damage}`);
      if (ir.actions_taken) paragraph(`Actions Taken: ${ir.actions_taken}`);
      if (ir.follow_up_required) paragraph(`Follow-up: ${safe(ir.follow_up_notes)}`);
      doc.moveDown(0.2);
    });
  }

  // ─── COMMUNICATIONS ──────────────────────────────────────────────────────────
  if (data.communications) {
    sectionHeader(`Communication Log (${data.communications.length})`);
    if (data.communications.length === 0) { emptyNote('No communications logged in this period.'); }
    data.communications.forEach(cm => {
      ensureSpace(36);
      const tag = [cm.log_type, cm.direction, cm.is_pinned ? 'pinned' : null].filter(Boolean).join(' • ');
      doc.fontSize(9).fillColor(MUTED).font('Helvetica')
         .text(`${fmtDateTime(cm.created_at)} — ${tag} — by ${safe(cm.logged_by_name)}`);
      if (cm.subject) {
        doc.fontSize(10).fillColor(INK).font('Helvetica-Bold').text(safe(cm.subject), { width: 512 });
      }
      doc.fontSize(10).fillColor(INK).font('Helvetica').text(safe(cm.body), { width: 512 });
      if (cm.follow_up_date) {
        doc.fontSize(9).fillColor(MUTED).text(`Follow-up by ${fmtDate(cm.follow_up_date)} — ${cm.follow_up_done ? 'done' : 'open'}`);
      }
      doc.fillColor(INK);
      doc.moveDown(0.3);
    });
  }

  // ─── DOCUMENTS ───────────────────────────────────────────────────────────────
  if (data.documents) {
    sectionHeader(`Documents on File (${data.documents.length})`);
    if (data.documents.length === 0) { emptyNote('No documents uploaded.'); }
    else {
      renderTable([
        { label: 'Name', w: 0.30, key: 'name' },
        { label: 'Type', w: 0.15, key: 'document_type' },
        { label: 'Uploaded', w: 0.15, get: r => fmtDate(r.created_at) },
        { label: 'Expires', w: 0.12, get: r => fmtDate(r.expiration_date) },
        { label: 'Signed', w: 0.14, get: r => r.signed_at ? fmtDate(r.signed_at) : (r.requires_signature ? 'REQUIRED' : '—') },
        { label: 'Confid.', w: 0.14, get: r => r.is_confidential ? 'Yes' : 'No' }
      ], data.documents);
    }
  }

  // ─── AUTHORIZATIONS ──────────────────────────────────────────────────────────
  if (data.authorizations) {
    sectionHeader(`Authorizations (${data.authorizations.length})`);
    if (data.authorizations.length === 0) { emptyNote('No authorizations on file.'); }
    else {
      renderTable([
        { label: 'Auth #', w: 0.14, key: 'auth_number' },
        { label: 'Payer', w: 0.18, key: 'payer_name' },
        { label: 'Code', w: 0.10, get: r => [r.procedure_code, r.modifier].filter(Boolean).join(' ') },
        { label: 'Period', w: 0.20, get: r => `${fmtDate(r.start_date)} – ${fmtDate(r.end_date)}` },
        { label: 'Authorized', w: 0.10, key: 'authorized_units' },
        { label: 'Used', w: 0.08, key: 'used_units' },
        { label: 'Remaining', w: 0.10, key: 'remaining_units' },
        { label: 'Status', w: 0.10, key: 'status' }
      ], data.authorizations);
    }
  }

  // ─── BILLING ─────────────────────────────────────────────────────────────────
  if (data.invoices) {
    const total = data.invoices.reduce((s, i) => s + parseFloat(i.total || 0), 0);
    sectionHeader(`Invoices in Period (${data.invoices.length} • ${fmtMoney(total)} total)`);
    if (data.invoices.length === 0) { emptyNote('No invoices in this period.'); }
    else {
      renderTable([
        { label: 'Invoice #', w: 0.18, key: 'invoice_number' },
        { label: 'Period', w: 0.26, get: r => `${fmtDate(r.billing_period_start)} – ${fmtDate(r.billing_period_end)}` },
        { label: 'Total', w: 0.14, get: r => fmtMoney(r.total) },
        { label: 'Status', w: 0.14, key: 'payment_status' },
        { label: 'Due', w: 0.14, get: r => fmtDate(r.payment_due_date) },
        { label: 'Paid', w: 0.14, get: r => fmtDate(r.payment_date) }
      ], data.invoices);
    }
  }

  // ─── AUDIT TRAIL ─────────────────────────────────────────────────────────────
  if (data.auditLog) {
    sectionHeader(`Access / Change Audit Trail (${data.auditLog.length})`);
    if (data.auditLog.length === 0) { emptyNote('No audit events in this period.'); }
    else {
      renderTable([
        { label: 'When', w: 0.26, get: r => fmtDateTime(r.timestamp) },
        { label: 'User', w: 0.26, key: 'user_name' },
        { label: 'Action', w: 0.26, key: 'action' },
        { label: 'Table', w: 0.14, key: 'table_name' },
        { label: 'IP', w: 0.08, key: 'ip_address' }
      ], data.auditLog);
    }
  }

  // ─── FOOTER (page numbers) ───────────────────────────────────────────────────
  const range = doc.bufferedPageRange();
  for (let i = 0; i < range.count; i++) {
    doc.switchToPage(range.start + i);
    doc.fontSize(8).fillColor(MUTED).font('Helvetica').text(
      `Chippewa Valley Home Care • Confidential Client Record • Page ${i + 1} of ${range.count}`,
      50, doc.page.height - 40, { width: 512, align: 'center' }
    );
  }
}

// CSV serializer: handles commas, quotes, newlines per RFC 4180
const csvCell = (v) => {
  if (v == null) return '';
  const s = (v instanceof Date) ? v.toISOString().slice(0,10) : String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
const toCSV = (rows, columns) => {
  const header = columns.map(c => csvCell(c.label || c.key)).join(',');
  const body = rows.map(r => columns.map(c => csvCell(r[c.key])).join(',')).join('\n');
  return header + '\n' + body + '\n';
};
const sendCSV = (res, filename, rows, columns) => {
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.send(toCSV(rows, columns));
};

// ─── HOURS BY PAYER ─────────────────────────────────────────────────────────
// Aggregates clocked hours per referral_source / payer over a date range.
// Useful for: contract performance, identifying under-served payers, MCO QA.
router.get('/hours-by-payer', auth, async (req, res) => {
  const { startDate, endDate } = req.query;
  if (!startDate || !endDate) return res.status(400).json({ error: 'startDate + endDate required' });
  try {
    const result = await db.query(`
      SELECT
        COALESCE(rs.id::text, CASE WHEN c.is_private_pay THEN 'private' ELSE 'unknown' END) AS payer_key,
        COALESCE(rs.name, CASE WHEN c.is_private_pay THEN 'Private Pay' ELSE 'Unknown' END) AS payer_name,
        COALESCE(rs.payer_type, CASE WHEN c.is_private_pay THEN 'private_pay' ELSE 'unknown' END) AS payer_type,
        COUNT(DISTINCT c.id)                AS active_clients,
        COUNT(te.id)                         AS visits,
        ROUND(SUM(te.duration_minutes) / 60.0, 2) AS total_hours,
        ROUND(SUM(COALESCE(te.billable_minutes, te.duration_minutes)) / 60.0, 2) AS billable_hours,
        ROUND(AVG(te.duration_minutes) / 60.0, 2) AS avg_visit_hours,
        MIN(te.start_time::date) AS first_visit,
        MAX(te.start_time::date) AS last_visit
      FROM time_entries te
      JOIN clients c ON te.client_id = c.id
      LEFT JOIN referral_sources rs ON c.referral_source_id = rs.id
      WHERE te.is_complete = true
        AND te.start_time >= $1::date
        AND te.start_time <  ($2::date + INTERVAL '1 day')
      GROUP BY payer_key, payer_name, payer_type
      ORDER BY billable_hours DESC NULLS LAST
    `, [startDate, endDate]);
    if (req.query.format === 'csv') {
      return sendCSV(res, `hours-by-payer-${startDate}-to-${endDate}.csv`, result.rows, [
        { key: 'payer_name', label: 'Payer' }, { key: 'payer_type', label: 'Type' },
        { key: 'active_clients', label: 'Clients' }, { key: 'visits', label: 'Visits' },
        { key: 'total_hours', label: 'Total Hours' }, { key: 'billable_hours', label: 'Billable Hours' },
        { key: 'avg_visit_hours', label: 'Avg Visit Hours' },
        { key: 'first_visit', label: 'First Visit' }, { key: 'last_visit', label: 'Last Visit' },
      ]);
    }
    res.json({ rows: result.rows, period: { startDate, endDate } });
  } catch (error) {
    console.error('[reports/hours-by-payer]', error);
    res.status(500).json({ error: error.message });
  }
});

// ─── CAREGIVER UTILIZATION ───────────────────────────────────────────────────
// scheduled hours vs actual hours vs capacity per caregiver over a window.
// Identifies under-utilized caregivers (capacity not booked) and OT risk.
router.get('/caregiver-utilization', auth, async (req, res) => {
  const { startDate, endDate } = req.query;
  if (!startDate || !endDate) return res.status(400).json({ error: 'startDate + endDate required' });
  try {
    const result = await db.query(`
      WITH actuals AS (
        SELECT caregiver_id,
          ROUND(SUM(duration_minutes) / 60.0, 2) AS actual_hours,
          COUNT(*) AS visits
        FROM time_entries
        WHERE is_complete = true
          AND start_time >= $1::date AND start_time < ($2::date + INTERVAL '1 day')
        GROUP BY caregiver_id
      ),
      weeks AS (
        SELECT GREATEST(1, CEIL(($2::date - $1::date + 1)::numeric / 7))::int AS n
      )
      SELECT
        u.id, u.first_name, u.last_name, u.is_active,
        COALESCE(ca.max_hours_per_week, 40) AS max_hours_per_week,
        (SELECT n FROM weeks) AS weeks_in_period,
        COALESCE(ca.max_hours_per_week, 40) * (SELECT n FROM weeks) AS capacity_hours,
        COALESCE(a.actual_hours, 0) AS actual_hours,
        COALESCE(a.visits, 0) AS visits,
        CASE
          WHEN COALESCE(ca.max_hours_per_week, 40) * (SELECT n FROM weeks) > 0
          THEN ROUND(COALESCE(a.actual_hours, 0) / (COALESCE(ca.max_hours_per_week, 40) * (SELECT n FROM weeks)) * 100, 1)
          ELSE 0
        END AS utilization_pct
      FROM users u
      LEFT JOIN caregiver_availability ca ON ca.caregiver_id = u.id
      LEFT JOIN actuals a ON a.caregiver_id = u.id
      WHERE u.role = 'caregiver' AND u.is_active = true
      ORDER BY utilization_pct DESC NULLS LAST, u.last_name
    `, [startDate, endDate]);
    if (req.query.format === 'csv') {
      return sendCSV(res, `caregiver-utilization-${startDate}-to-${endDate}.csv`, result.rows, [
        { key: 'first_name', label: 'First' }, { key: 'last_name', label: 'Last' },
        { key: 'max_hours_per_week', label: 'Max Hrs/Week' },
        { key: 'capacity_hours', label: 'Period Capacity (hrs)' },
        { key: 'actual_hours', label: 'Actual (hrs)' },
        { key: 'visits', label: 'Visits' },
        { key: 'utilization_pct', label: 'Utilization %' },
      ]);
    }
    res.json({ rows: result.rows, period: { startDate, endDate } });
  } catch (error) {
    console.error('[reports/caregiver-utilization]', error);
    res.status(500).json({ error: error.message });
  }
});

// ─── CLIENT REVENUE BY MONTH ────────────────────────────────────────────────
// Per-client invoice totals + collected vs outstanding aging buckets,
// grouped by billing month over the date range. Useful for spotting clients
// who consistently pay late and for monthly P&L per client.
router.get('/client-revenue-by-month', auth, async (req, res) => {
  const { startDate, endDate } = req.query;
  if (!startDate || !endDate) return res.status(400).json({ error: 'startDate + endDate required' });
  try {
    const result = await db.query(`
      SELECT
        c.id AS client_id,
        c.first_name, c.last_name,
        TO_CHAR(date_trunc('month', i.billing_period_start), 'YYYY-MM') AS month,
        COUNT(i.id)                                       AS invoice_count,
        ROUND(SUM(i.total)::numeric, 2)                   AS total_billed,
        ROUND(SUM(COALESCE(i.amount_paid, 0))::numeric, 2) AS total_paid,
        ROUND(SUM(i.total - COALESCE(i.amount_paid, 0))::numeric, 2) AS outstanding,
        COUNT(*) FILTER (WHERE i.payment_status = 'paid') AS paid_count,
        COUNT(*) FILTER (WHERE i.payment_status = 'pending' AND i.payment_due_date < CURRENT_DATE) AS overdue_count,
        MAX(i.billing_period_end) AS last_billed
      FROM invoices i
      JOIN clients c ON i.client_id = c.id
      WHERE i.billing_period_start >= $1::date
        AND i.billing_period_start <= $2::date
      GROUP BY c.id, c.first_name, c.last_name, date_trunc('month', i.billing_period_start)
      ORDER BY month DESC, total_billed DESC
    `, [startDate, endDate]);

    if (req.query.format === 'csv') {
      return sendCSV(res, `client-revenue-by-month-${startDate}-to-${endDate}.csv`, result.rows, [
        { key: 'month',         label: 'Month' },
        { key: 'first_name',    label: 'First' },
        { key: 'last_name',     label: 'Last' },
        { key: 'invoice_count', label: 'Invoices' },
        { key: 'total_billed',  label: 'Billed' },
        { key: 'total_paid',    label: 'Paid' },
        { key: 'outstanding',   label: 'Outstanding' },
        { key: 'paid_count',    label: 'Paid Invoices' },
        { key: 'overdue_count', label: 'Overdue Invoices' },
        { key: 'last_billed',   label: 'Last Billed' },
      ]);
    }
    res.json({ rows: result.rows, period: { startDate, endDate } });
  } catch (error) {
    console.error('[reports/client-revenue-by-month]', error);
    res.status(500).json({ error: error.message });
  }
});

// ─── CLIENT VISITS SUMMARY ──────────────────────────────────────────────────
// Per-client visit count + hours over a window. Useful for invoice prep.
router.get('/client-visits-summary', auth, async (req, res) => {
  const { startDate, endDate } = req.query;
  if (!startDate || !endDate) return res.status(400).json({ error: 'startDate + endDate required' });
  try {
    const result = await db.query(`
      SELECT
        c.id AS client_id, c.first_name, c.last_name,
        rs.name AS payer_name,
        ct.name AS care_type_name,
        COUNT(te.id) AS visits,
        COUNT(DISTINCT te.caregiver_id) AS distinct_caregivers,
        ROUND(SUM(te.duration_minutes) / 60.0, 2) AS total_hours,
        ROUND(SUM(COALESCE(te.billable_minutes, te.duration_minutes)) / 60.0, 2) AS billable_hours,
        MIN(te.start_time::date) AS first_visit,
        MAX(te.start_time::date) AS last_visit
      FROM clients c
      LEFT JOIN time_entries te
        ON te.client_id = c.id
        AND te.is_complete = true
        AND te.start_time >= $1::date
        AND te.start_time <  ($2::date + INTERVAL '1 day')
      LEFT JOIN referral_sources rs ON c.referral_source_id = rs.id
      LEFT JOIN care_types ct ON c.care_type_id = ct.id
      WHERE c.is_active = true
      GROUP BY c.id, c.first_name, c.last_name, rs.name, ct.name
      HAVING COUNT(te.id) > 0
      ORDER BY total_hours DESC NULLS LAST
    `, [startDate, endDate]);
    if (req.query.format === 'csv') {
      return sendCSV(res, `client-visits-summary-${startDate}-to-${endDate}.csv`, result.rows, [
        { key: 'first_name', label: 'First' }, { key: 'last_name', label: 'Last' },
        { key: 'payer_name', label: 'Payer' }, { key: 'care_type_name', label: 'Care Type' },
        { key: 'visits', label: 'Visits' }, { key: 'distinct_caregivers', label: 'Distinct Caregivers' },
        { key: 'total_hours', label: 'Total Hours' }, { key: 'billable_hours', label: 'Billable Hours' },
        { key: 'first_visit', label: 'First Visit' }, { key: 'last_visit', label: 'Last Visit' },
      ]);
    }
    res.json({ rows: result.rows, period: { startDate, endDate } });
  } catch (error) {
    console.error('[reports/client-visits-summary]', error);
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;

// ==================== PDF EXPORT ====================
// POST /api/reports/:type/export-pdf
const PDFDocument = require('pdfkit');

router.post('/:type/export-pdf', auth, async (req, res) => {
  const { type } = req.params;
  const { startDate, endDate } = req.body;

  try {
    // Fetch the data for this report type
    let reportData = {};
    const HOURS_CALC = `EXTRACT(EPOCH FROM (s.end_time::time - s.start_time::time)) / 3600`;

    if (type === 'overview' || type === 'hours') {
      const [summary, caregivers] = await Promise.all([
        db.query(`SELECT COALESCE(SUM(${HOURS_CALC}), 0) as total_hours, COUNT(DISTINCT s.id) as total_shifts
          FROM schedules s WHERE s.is_active = true
          AND ((s.date >= $1 AND s.date <= $2) OR (s.day_of_week IS NOT NULL AND s.date IS NULL))`, [startDate, endDate]),
        db.query(`SELECT u.first_name || ' ' || u.last_name as name,
            COALESCE(SUM(${HOURS_CALC}), 0) as hours, COUNT(DISTINCT s.client_id) as clients
          FROM users u LEFT JOIN schedules s ON s.caregiver_id = u.id AND s.is_active = true
            AND ((s.date >= $1 AND s.date <= $2) OR s.day_of_week IS NOT NULL)
          WHERE u.role = 'caregiver' AND u.is_active = true
          GROUP BY u.id, u.first_name, u.last_name ORDER BY hours DESC LIMIT 20`, [startDate, endDate])
      ]);
      reportData = { summary: summary.rows[0], caregivers: caregivers.rows };
    } else if (type === 'performance') {
      const result = await db.query(`SELECT u.first_name || ' ' || u.last_name as name,
          COALESCE(AVG(pr.satisfaction_score), 0) as avg_rating,
          COUNT(DISTINCT pr.id) as ratings, COUNT(DISTINCT s.client_id) as clients
        FROM users u LEFT JOIN performance_ratings pr ON pr.caregiver_id = u.id AND pr.created_at >= $1 AND pr.created_at <= $2
        LEFT JOIN schedules s ON s.caregiver_id = u.id AND s.is_active = true
        WHERE u.role = 'caregiver' AND u.is_active = true
        GROUP BY u.id, u.first_name, u.last_name ORDER BY avg_rating DESC`, [startDate, endDate]);
      reportData = { caregivers: result.rows };
    } else if (type === 'revenue') {
      const result = await db.query(`SELECT COALESCE(SUM(total), 0) as total_billed,
          COALESCE(SUM(amount_paid), 0) as collected, COUNT(*) as invoice_count
        FROM invoices WHERE billing_period_start >= $1 AND billing_period_end <= $2`, [startDate, endDate]);
      reportData = { revenue: result.rows[0] };
    }

    // Build PDF
    const doc = new PDFDocument({ margin: 50, size: 'LETTER' });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="cvhc-${type}-report-${startDate}-to-${endDate}.pdf"`);
    doc.pipe(res);

    // Header
    doc.rect(0, 0, doc.page.width, 80).fill('#2ABBA7');
    doc.fillColor('#fff').fontSize(22).font('Helvetica-Bold')
      .text('Chippewa Valley Home Care', 50, 22);
    doc.fontSize(12).font('Helvetica')
      .text(`${type.charAt(0).toUpperCase() + type.slice(1)} Report  •  ${startDate} to ${endDate}`, 50, 50);

    doc.fillColor('#111827').moveDown(3);

    // Content based on type
    if (type === 'overview' || type === 'hours') {
      const { summary, caregivers } = reportData;
      doc.fontSize(16).font('Helvetica-Bold').text('Summary', { underline: true });
      doc.moveDown(0.5);
      doc.fontSize(12).font('Helvetica');
      doc.text(`Total Scheduled Hours: ${parseFloat(summary?.total_hours || 0).toFixed(2)}`);
      doc.text(`Total Shifts: ${summary?.total_shifts || 0}`);
      doc.moveDown(1.5);

      doc.fontSize(14).font('Helvetica-Bold').text('Caregiver Breakdown', { underline: true });
      doc.moveDown(0.5);
      // Table header
      doc.fontSize(10).font('Helvetica-Bold');
      doc.text('Caregiver', 50, doc.y, { width: 200, continued: true });
      doc.text('Hours', 250, doc.y, { width: 80, continued: true });
      doc.text('Clients', 330, doc.y);
      doc.moveTo(50, doc.y).lineTo(480, doc.y).stroke('#E5E7EB');
      doc.moveDown(0.3);

      doc.font('Helvetica').fontSize(10);
      (caregivers || []).forEach((cg, i) => {
        if (doc.y > 680) { doc.addPage(); }
        const bg = i % 2 === 0 ? '#F9FAFB' : '#fff';
        doc.rect(48, doc.y - 2, 434, 16).fill(bg);
        doc.fillColor('#111827');
        doc.text(cg.name, 50, doc.y, { width: 200, continued: true });
        doc.text(parseFloat(cg.hours).toFixed(2), 250, doc.y, { width: 80, continued: true });
        doc.text(String(cg.clients || 0), 330, doc.y);
        doc.moveDown(0.15);
      });
    } else if (type === 'performance') {
      doc.fontSize(16).font('Helvetica-Bold').text('Caregiver Performance', { underline: true });
      doc.moveDown(0.5);
      doc.fontSize(10).font('Helvetica-Bold');
      doc.text('Caregiver', 50, doc.y, { width: 200, continued: true });
      doc.text('Avg Rating', 250, doc.y, { width: 100, continued: true });
      doc.text('Reviews', 350, doc.y);
      doc.moveTo(50, doc.y).lineTo(480, doc.y).stroke('#E5E7EB');
      doc.moveDown(0.3);
      doc.font('Helvetica');
      (reportData.caregivers || []).forEach(cg => {
        if (doc.y > 680) doc.addPage();
        doc.text(cg.name, 50, doc.y, { width: 200, continued: true });
        doc.text(parseFloat(cg.avg_rating).toFixed(1) + ' / 5', 250, doc.y, { width: 100, continued: true });
        doc.text(String(cg.ratings || 0), 350, doc.y);
        doc.moveDown(0.15);
      });
    } else if (type === 'revenue') {
      const { revenue } = reportData;
      doc.fontSize(16).font('Helvetica-Bold').text('Revenue Summary', { underline: true });
      doc.moveDown(0.5);
      doc.fontSize(12).font('Helvetica');
      doc.text(`Total Billed: $${parseFloat(revenue?.total_billed || 0).toLocaleString('en-US', { minimumFractionDigits: 2 })}`);
      doc.text(`Total Collected: $${parseFloat(revenue?.collected || 0).toLocaleString('en-US', { minimumFractionDigits: 2 })}`);
      doc.text(`Total Invoices: ${revenue?.invoice_count || 0}`);
      const outstanding = parseFloat(revenue?.total_billed || 0) - parseFloat(revenue?.collected || 0);
      doc.text(`Outstanding: $${outstanding.toLocaleString('en-US', { minimumFractionDigits: 2 })}`);
    }

    // Footer
    doc.fontSize(8).fillColor('#9CA3AF')
      .text(`Generated ${new Date().toLocaleDateString()} by CVHC CRM`, 50, doc.page.height - 40);

    doc.end();
  } catch (error) {
    console.error('PDF export error:', error);
    if (!res.headersSent) res.status(500).json({ error: error.message });
  }
});
