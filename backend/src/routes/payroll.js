// src/routes/payroll.js
const express = require('express');
const router = express.Router();
const db = require('../db');

/**
 * POST /api/payroll/calculate
 * Calculate payroll for a given date range from actual clock-in/out records
 */
router.post('/calculate', async (req, res) => {
  try {
    const { startDate, endDate } = req.body;

    if (!startDate || !endDate) {
      return res.status(400).json({ error: 'startDate and endDate are required' });
    }

    // Pull all completed time entries in the pay period
    const result = await db.query(`
      SELECT
        u.id as caregiver_id,
        u.first_name, u.last_name, u.email,
        COALESCE(u.default_pay_rate, 18.00) as pay_rate,
        COUNT(te.id) as shift_count,
        SUM(te.duration_minutes) as total_minutes,
        SUM(CASE WHEN EXTRACT(DOW FROM te.start_time) IN (0,6) THEN te.duration_minutes ELSE 0 END) as weekend_minutes,
        SUM(CASE WHEN EXTRACT(HOUR FROM te.start_time) >= 22 OR EXTRACT(HOUR FROM te.start_time) < 6
                 THEN te.duration_minutes ELSE 0 END) as night_minutes
      FROM users u
      LEFT JOIN time_entries te ON te.caregiver_id = u.id
        AND te.start_time >= $1::timestamptz
        AND te.start_time < ($2::date + INTERVAL '1 day')::timestamptz
        AND te.is_complete = true
        AND te.duration_minutes IS NOT NULL
      WHERE u.role = 'caregiver' AND u.is_active = true
      GROUP BY u.id, u.first_name, u.last_name, u.email, u.default_pay_rate
      ORDER BY u.last_name, u.first_name`,
      [startDate, endDate]
    );

    const payrollData = result.rows.map(p => {
      const totalHours = (parseInt(p.total_minutes) || 0) / 60;
      const weekendHours = (parseInt(p.weekend_minutes) || 0) / 60;
      const nightHours = (parseInt(p.night_minutes) || 0) / 60;
      const payRate = parseFloat(p.pay_rate) || 18.00;
      return {
        caregiver_id: p.caregiver_id,
        first_name: p.first_name,
        last_name: p.last_name,
        email: p.email,
        pay_rate: payRate,
        shift_count: parseInt(p.shift_count) || 0,
        total_hours: parseFloat(totalHours.toFixed(2)),
        weekend_hours: parseFloat(weekendHours.toFixed(2)),
        night_hours: parseFloat(nightHours.toFixed(2)),
        pto_hours: 0,
      };
    });

    const totalHours = payrollData.reduce((s, p) => s + p.total_hours, 0);
    const totalGrossPay = payrollData.reduce((s, p) => s + (p.total_hours * p.pay_rate), 0);

    res.json({
      success: true,
      payrollData,
      status: 'draft',
      period: { start: startDate, end: endDate },
      caregiverCount: payrollData.filter(p => p.total_hours > 0).length,
      summary: {
        totalHours: parseFloat(totalHours.toFixed(2)),
        totalGrossPay: parseFloat(totalGrossPay.toFixed(2)),
        totalNetPay: parseFloat((totalGrossPay * 0.85).toFixed(2)), // approximate
      }
    });
  } catch (error) {
    console.error('Error calculating payroll:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/payroll
 * Get payroll records with filtering
 */
router.get('/', async (req, res) => {
  try {
    const { status, caregiverId, startDate, endDate, page = 1, limit = 50 } = req.query;

    res.json({
      success: true,
      payroll: [],
      pagination: {
        total: 0,
        pages: 0,
        currentPage: parseInt(page)
      }
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/payroll/:id
 * Get a specific payroll record
 */
router.get('/:id', async (req, res) => {
  try {
    res.status(404).json({ error: 'Payroll record not found' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/payroll/:id/approve
 * Approve a payroll record
 */
router.post('/:id/approve', async (req, res) => {
  try {
    res.json({
      success: true,
      message: 'Payroll approved'
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/payroll/:id/process
 * Process payroll and generate check number
 */
router.post('/:id/process', async (req, res) => {
  try {
    res.json({
      success: true,
      message: 'Paycheck processed',
      checkNumber: `CHK-${Date.now()}`
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/payroll/:id/mark-paid
 * Mark paycheck as paid
 */
router.post('/:id/mark-paid', async (req, res) => {
  try {
    res.json({
      success: true,
      message: 'Payroll marked as paid'
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * PUT /api/payroll/:id
 * Update payroll record
 */
router.put('/:id', async (req, res) => {
  try {
    res.json({
      success: true,
      message: 'Payroll updated'
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/payroll/export
 * Export payroll data
 */
router.post('/export', async (req, res) => {
  try {
    res.json({
      success: true,
      message: 'Payroll export'
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
