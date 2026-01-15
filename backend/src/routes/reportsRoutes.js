// routes/reportsRoutes.js
// Financial Reports & P&L Dashboard

const express = require('express');
const router = express.Router();
const db = require('../db');
const auth = require('../middleware/auth');

// ==================== P&L DASHBOARD ====================

router.get('/pnl', auth, async (req, res) => {
  const { startDate, endDate } = req.query;
  const start = startDate || new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().split('T')[0];
  const end = endDate || new Date().toISOString().split('T')[0];

  try {
    // Revenue
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
        COALESCE(SUM(amount), 0) as total_expenses,
        category,
        COALESCE(SUM(amount), 0) as category_total
      FROM expenses
      WHERE expense_date >= $1 AND expense_date <= $2
      GROUP BY category
      ORDER BY category_total DESC
    `, [start, end]);

    const totalExpenses = expenses.rows.reduce((sum, e) => sum + parseFloat(e.category_total || 0), 0);

    // Payroll (estimate from time entries)
    const payroll = await db.query(`
      SELECT 
        COALESCE(SUM(te.hours * cp.hourly_rate), 0) as gross_payroll
      FROM time_entries te
      JOIN caregiver_profiles cp ON te.caregiver_id = cp.id
      WHERE te.clock_in >= $1 AND te.clock_in <= $2
      AND te.status = 'approved'
    `, [start, end]);

    // Calculate net income
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
        estimated_taxes: grossPayroll * 0.0765, // Employer FICA
        total: grossPayroll * 1.0765
      },
      netIncome,
      margin: totalRevenue > 0 ? ((netIncome / totalRevenue) * 100).toFixed(2) : 0
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ==================== REVENUE REPORTS ====================

router.get('/revenue/monthly', auth, async (req, res) => {
  const { year } = req.query;
  const targetYear = year || new Date().getFullYear();

  try {
    const result = await db.query(`
      SELECT 
        EXTRACT(MONTH FROM billing_period_start) as month,
        COUNT(*) as invoice_count,
        SUM(total) as billed,
        SUM(COALESCE(amount_paid, 0)) as collected
      FROM invoices
      WHERE EXTRACT(YEAR FROM billing_period_start) = $1
      GROUP BY EXTRACT(MONTH FROM billing_period_start)
      ORDER BY month
    `, [targetYear]);
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ==================== CAREGIVER PRODUCTIVITY ====================

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

// ==================== CLIENT UTILIZATION ====================

router.get('/client-utilization', auth, async (req, res) => {
  const { startDate, endDate } = req.query;
  const start = startDate || new Date(new Date().setDate(new Date().getDate() - 30)).toISOString().split('T')[0];
  const end = endDate || new Date().toISOString().split('T')[0];

  try {
    const result = await db.query(`
      SELECT 
        c.id,
        c.first_name,
        c.last_name,
        rs.name as payer_name,
        COALESCE(a.authorized_units, 0) as authorized_hours,
        COALESCE(SUM(te.hours), 0) as used_hours,
        COALESCE(a.authorized_units, 0) - COALESCE(SUM(te.hours), 0) as remaining_hours,
        CASE WHEN COALESCE(a.authorized_units, 0) > 0 
          THEN (COALESCE(SUM(te.hours), 0) / a.authorized_units * 100)
          ELSE 0 
        END as utilization_pct
      FROM clients c
      LEFT JOIN referral_sources rs ON c.referral_source_id = rs.id
      LEFT JOIN authorizations a ON a.client_id = c.id 
        AND a.start_date <= $2 AND a.end_date >= $1
      LEFT JOIN time_entries te ON te.client_id = c.id
        AND te.clock_in >= $1 AND te.clock_in <= $2
        AND te.status = 'approved'
      WHERE c.status = 'active'
      GROUP BY c.id, c.first_name, c.last_name, rs.name, a.authorized_units
      ORDER BY c.last_name
    `, [start, end]);
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
