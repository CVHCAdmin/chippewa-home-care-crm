// routes/payrollRoutes.js
// Enhanced payroll: Mileage, PTO, Overtime, QuickBooks Export
// FIXED: Uses caregiver_profiles instead of caregivers

const express = require('express');
const router = express.Router();
const db = require('../db');
const auth = require('../middleware/auth');

// ==================== MILEAGE ====================

router.get('/mileage', auth, async (req, res) => {
  const { caregiverId, startDate, endDate } = req.query;
  try {
    let query = `
      SELECT m.*, cp.first_name, cp.last_name
      FROM mileage m
      JOIN caregiver_profiles cp ON m.caregiver_id = cp.id
      WHERE 1=1
    `;
    const params = [];

    if (caregiverId) {
      params.push(caregiverId);
      query += ` AND m.caregiver_id = $${params.length}`;
    }
    if (startDate) {
      params.push(startDate);
      query += ` AND m.date >= $${params.length}`;
    }
    if (endDate) {
      params.push(endDate);
      query += ` AND m.date <= $${params.length}`;
    }

    query += ` ORDER BY m.date DESC`;
    const result = await db.query(query, params);
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching mileage:', error);
    res.status(500).json({ error: error.message });
  }
});

router.post('/mileage', auth, async (req, res) => {
  const { caregiverId, date, miles, fromLocation, toLocation, notes } = req.body;
  try {
    const result = await db.query(`
      INSERT INTO mileage (caregiver_id, date, miles, from_location, to_location, notes, created_by)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      RETURNING *
    `, [caregiverId, date, miles, fromLocation, toLocation, notes, req.user.id]);
    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error adding mileage:', error);
    res.status(500).json({ error: error.message });
  }
});

// ==================== PTO ====================

router.get('/pto', auth, async (req, res) => {
  const { caregiverId, startDate, endDate } = req.query;
  try {
    let query = `
      SELECT p.*, cp.first_name, cp.last_name
      FROM pto p
      JOIN caregiver_profiles cp ON p.caregiver_id = cp.id
      WHERE 1=1
    `;
    const params = [];

    if (caregiverId) {
      params.push(caregiverId);
      query += ` AND p.caregiver_id = $${params.length}`;
    }
    if (startDate) {
      params.push(startDate);
      query += ` AND p.start_date >= $${params.length}`;
    }
    if (endDate) {
      params.push(endDate);
      query += ` AND p.end_date <= $${params.length}`;
    }

    query += ` ORDER BY p.start_date DESC`;
    const result = await db.query(query, params);
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching PTO:', error);
    res.status(500).json({ error: error.message });
  }
});

router.post('/pto', auth, async (req, res) => {
  const { caregiverId, type, startDate, endDate, hours, notes } = req.body;
  try {
    const result = await db.query(`
      INSERT INTO pto (caregiver_id, type, start_date, end_date, hours, notes, status, created_by)
      VALUES ($1, $2, $3, $4, $5, $6, 'approved', $7)
      RETURNING *
    `, [caregiverId, type, startDate, endDate, hours, notes, req.user.id]);
    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error adding PTO:', error);
    res.status(500).json({ error: error.message });
  }
});

// ==================== PAYROLL CALCULATE ====================

router.post('/payroll/calculate', auth, async (req, res) => {
  const { startDate, endDate, settings } = req.body;
  
  try {
    const result = await db.query(`
      SELECT 
        cp.id as caregiver_id,
        cp.first_name,
        cp.last_name,
        cp.hourly_rate,
        COALESCE(SUM(te.hours), 0) as total_hours,
        COALESCE(SUM(CASE WHEN EXTRACT(DOW FROM te.clock_in) IN (0, 6) THEN te.hours ELSE 0 END), 0) as weekend_hours,
        COALESCE(SUM(CASE WHEN EXTRACT(HOUR FROM te.clock_in) >= 18 OR EXTRACT(HOUR FROM te.clock_in) < 6 THEN te.hours ELSE 0 END), 0) as night_hours,
        COALESCE((SELECT SUM(m.miles) FROM mileage m WHERE m.caregiver_id = cp.id AND m.date >= $1 AND m.date <= $2), 0) as total_miles,
        COALESCE((SELECT SUM(p.hours) FROM pto p WHERE p.caregiver_id = cp.id AND p.start_date >= $1 AND p.end_date <= $2 AND p.status = 'approved' AND p.type != 'unpaid'), 0) as pto_hours,
        COALESCE(pr.status, 'draft') as status,
        pr.check_number
      FROM caregiver_profiles cp
      LEFT JOIN time_entries te ON te.caregiver_id = cp.id 
        AND te.clock_in >= $1 AND te.clock_in <= $2
        AND te.status = 'approved'
      LEFT JOIN payroll_records pr ON pr.caregiver_id = cp.id 
        AND pr.period_start = $1 AND pr.period_end = $2
      WHERE cp.status = 'active'
      GROUP BY cp.id, cp.first_name, cp.last_name, cp.hourly_rate, pr.status, pr.check_number
      HAVING COALESCE(SUM(te.hours), 0) > 0 OR COALESCE((SELECT SUM(p.hours) FROM pto p WHERE p.caregiver_id = cp.id AND p.start_date >= $1 AND p.end_date <= $2 AND p.status = 'approved'), 0) > 0
      ORDER BY cp.last_name, cp.first_name
    `, [startDate, endDate]);

    res.json({ payrollData: result.rows, status: 'calculated' });
  } catch (error) {
    console.error('Error calculating payroll:', error);
    res.status(500).json({ error: error.message });
  }
});

// ==================== PAYROLL APPROVE ====================

router.post('/payroll/:caregiverId/approve', auth, async (req, res) => {
  const { caregiverId } = req.params;
  const { startDate, endDate } = req.body;
  
  try {
    await db.query(`
      INSERT INTO payroll_records (caregiver_id, period_start, period_end, status, approved_by, approved_at)
      VALUES ($1, $2, $3, 'approved', $4, NOW())
      ON CONFLICT (caregiver_id, period_start, period_end) 
      DO UPDATE SET status = 'approved', approved_by = $4, approved_at = NOW()
    `, [caregiverId, startDate || req.body.payPeriod?.startDate, endDate || req.body.payPeriod?.endDate, req.user.id]);

    res.json({ success: true });
  } catch (error) {
    console.error('Error approving payroll:', error);
    res.status(500).json({ error: error.message });
  }
});

// ==================== PAYROLL PROCESS ====================

router.post('/payroll/:caregiverId/process', auth, async (req, res) => {
  const { caregiverId } = req.params;
  
  try {
    const checkResult = await db.query(`
      SELECT COALESCE(MAX(check_number), 1000) + 1 as next_check
      FROM payroll_records
      WHERE check_number IS NOT NULL
    `);
    const checkNumber = checkResult.rows[0].next_check;

    await db.query(`
      UPDATE payroll_records 
      SET status = 'processed', check_number = $1, processed_by = $2, processed_at = NOW()
      WHERE caregiver_id = $3 AND status = 'approved'
    `, [checkNumber, req.user.id, caregiverId]);

    res.json({ success: true, checkNumber });
  } catch (error) {
    console.error('Error processing payroll:', error);
    res.status(500).json({ error: error.message });
  }
});

// ==================== QUICKBOOKS EXPORT ====================

router.post('/payroll/export/quickbooks', auth, async (req, res) => {
  const { startDate, endDate, payrollData } = req.body;
  
  try {
    let iif = `!TIMEACT\tDATE\tJOB\tEMP\tITEM\tDURATION\tNOTE\n`;
    
    for (const p of payrollData) {
      iif += `TIMEACT\t${startDate}\t\t${p.first_name} ${p.last_name}\tRegular\t${p.regular_hours || 0}\tPayroll ${startDate} to ${endDate}\n`;
      if (p.overtime_hours > 0) {
        iif += `TIMEACT\t${startDate}\t\t${p.first_name} ${p.last_name}\tOvertime\t${p.overtime_hours}\tOvertime\n`;
      }
    }

    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('Content-Disposition', `attachment; filename=quickbooks-payroll-${startDate}.iif`);
    res.send(iif);
  } catch (error) {
    console.error('Error exporting to QuickBooks:', error);
    res.status(500).json({ error: error.message });
  }
});

// ==================== PAYROLL CSV EXPORT ====================

router.post('/payroll/export', auth, async (req, res) => {
  const { startDate, endDate, format } = req.body;
  
  try {
    const result = await db.query(`
      SELECT 
        cp.first_name,
        cp.last_name,
        cp.hourly_rate,
        COALESCE(SUM(te.hours), 0) as total_hours
      FROM caregiver_profiles cp
      LEFT JOIN time_entries te ON te.caregiver_id = cp.id 
        AND te.clock_in >= $1 AND te.clock_in <= $2
        AND te.status = 'approved'
      WHERE cp.status = 'active'
      GROUP BY cp.id, cp.first_name, cp.last_name, cp.hourly_rate
      HAVING COALESCE(SUM(te.hours), 0) > 0
      ORDER BY cp.last_name
    `, [startDate, endDate]);

    if (format === 'csv') {
      const headers = ['First Name', 'Last Name', 'Hourly Rate', 'Total Hours', 'Gross Pay'];
      const rows = result.rows.map(r => [
        r.first_name,
        r.last_name,
        r.hourly_rate,
        r.total_hours,
        (parseFloat(r.hourly_rate) * parseFloat(r.total_hours)).toFixed(2)
      ]);

      const csv = [headers.join(','), ...rows.map(r => r.join(','))].join('\n');

      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', `attachment; filename=payroll-${startDate}-to-${endDate}.csv`);
      res.send(csv);
    } else {
      res.json(result.rows);
    }
  } catch (error) {
    console.error('Error exporting payroll:', error);
    res.status(500).json({ error: error.message });
  }
});

// ==================== GET CAREGIVERS FOR DROPDOWNS ====================

router.get('/caregivers', auth, async (req, res) => {
  try {
    const result = await db.query(`
      SELECT id, first_name, last_name, hourly_rate, status
      FROM caregiver_profiles
      WHERE status = 'active'
      ORDER BY last_name, first_name
    `);
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching caregivers:', error);
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
