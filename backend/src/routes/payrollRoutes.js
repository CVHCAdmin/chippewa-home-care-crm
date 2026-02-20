// routes/payrollRoutes.js
// Mounted at /api/payroll — so routes here are /calculate, /mileage, etc. (no /payroll/ prefix)

const express = require('express');
const router  = express.Router();
const db      = require('../db');
const auth    = require('../middleware/auth');

// ==================== PAYROLL CALCULATE ====================
// POST /api/payroll/calculate

router.post('/calculate', auth, async (req, res) => {
  const { startDate, endDate } = req.body;

  if (!startDate || !endDate) {
    return res.status(400).json({ error: 'startDate and endDate are required' });
  }

  try {
    const result = await db.query(`
      SELECT
        u.id                                                        AS caregiver_id,
        u.first_name,
        u.last_name,
        COALESCE(u.hourly_rate, $3::numeric)                       AS hourly_rate,
        COALESCE(
          ROUND(SUM(COALESCE(te.billable_minutes, te.duration_minutes, 0))::numeric / 60, 2),
          0
        )                                                          AS total_hours,
        COALESCE(
          ROUND(SUM(
            CASE WHEN EXTRACT(DOW FROM te.clock_in_time) IN (0,6)
                 THEN COALESCE(te.billable_minutes, te.duration_minutes, 0)
                 ELSE 0 END
          )::numeric / 60, 2),
          0
        )                                                          AS weekend_hours,
        COALESCE(
          ROUND(SUM(
            CASE WHEN EXTRACT(HOUR FROM te.clock_in_time) >= 18
                   OR EXTRACT(HOUR FROM te.clock_in_time) < 6
                 THEN COALESCE(te.billable_minutes, te.duration_minutes, 0)
                 ELSE 0 END
          )::numeric / 60, 2),
          0
        )                                                          AS night_hours,
        COALESCE((
          SELECT SUM(m.miles)
          FROM mileage m
          WHERE m.caregiver_id = u.id
            AND m.date >= $1 AND m.date <= $2
        ), 0)                                                      AS total_miles,
        COALESCE((
          SELECT SUM(p.hours)
          FROM pto p
          WHERE p.caregiver_id = u.id
            AND p.start_date >= $1 AND p.end_date <= $2
            AND p.status = 'approved' AND p.type != 'unpaid'
        ), 0)                                                      AS pto_hours,
        COALESCE(pr.status, 'draft')                               AS status,
        pr.check_number
      FROM users u
      LEFT JOIN time_entries te
        ON te.caregiver_id = u.id
        AND DATE(te.clock_in_time) >= $1::date
        AND DATE(te.clock_in_time) <= $2::date
        AND te.is_complete = true
      LEFT JOIN payroll_records pr
        ON pr.caregiver_id = u.id
        AND pr.period_start = $1 AND pr.period_end = $2
      WHERE u.role = 'caregiver' AND u.is_active = true
      GROUP BY u.id, u.first_name, u.last_name, u.hourly_rate, pr.status, pr.check_number
      HAVING
        COALESCE(SUM(COALESCE(te.billable_minutes, te.duration_minutes, 0)), 0) > 0
        OR COALESCE((
          SELECT SUM(p.hours) FROM pto p
          WHERE p.caregiver_id = u.id
            AND p.start_date >= $1 AND p.end_date <= $2
            AND p.status = 'approved'
        ), 0) > 0
      ORDER BY u.last_name, u.first_name
    `, [startDate, endDate, process.env.DEFAULT_HOURLY_RATE || 15]);

    res.json({ payrollData: result.rows, status: 'calculated' });
  } catch (error) {
    console.error('Payroll calculate error:', error);
    res.status(500).json({ error: error.message });
  }
});

// ==================== PAYROLL APPROVE ====================
// POST /api/payroll/:caregiverId/approve

router.post('/:caregiverId/approve', auth, async (req, res) => {
  const { caregiverId } = req.params;
  const { startDate, endDate } = req.body;

  try {
    await db.query(`
      INSERT INTO payroll_records (caregiver_id, period_start, period_end, status, approved_by, approved_at)
      VALUES ($1, $2, $3, 'approved', $4, NOW())
      ON CONFLICT (caregiver_id, period_start, period_end)
      DO UPDATE SET status = 'approved', approved_by = $4, approved_at = NOW()
    `, [caregiverId, startDate, endDate, req.user.id]);

    res.json({ success: true });
  } catch (error) {
    console.error('Payroll approve error:', error);
    res.status(500).json({ error: error.message });
  }
});

// ==================== PAYROLL PROCESS ====================
// POST /api/payroll/:caregiverId/process

router.post('/:caregiverId/process', auth, async (req, res) => {
  const { caregiverId } = req.params;

  try {
    const checkResult = await db.query(`
      SELECT COALESCE(MAX(check_number), 1000) + 1 AS next_check
      FROM payroll_records WHERE check_number IS NOT NULL
    `);
    const checkNumber = checkResult.rows[0].next_check;

    await db.query(`
      UPDATE payroll_records
      SET status = 'processed', check_number = $1, processed_by = $2, processed_at = NOW()
      WHERE caregiver_id = $3 AND status = 'approved'
    `, [checkNumber, req.user.id, caregiverId]);

    res.json({ success: true, checkNumber });
  } catch (error) {
    console.error('Payroll process error:', error);
    res.status(500).json({ error: error.message });
  }
});

// ==================== MILEAGE ====================
// GET /api/payroll/mileage

router.get('/mileage', auth, async (req, res) => {
  const { caregiverId, startDate, endDate } = req.query;
  try {
    let query = `
      SELECT m.*, u.first_name, u.last_name
      FROM mileage m
      JOIN users u ON m.caregiver_id = u.id
      WHERE 1=1
    `;
    const params = [];

    if (caregiverId) { params.push(caregiverId); query += ` AND m.caregiver_id = $${params.length}`; }
    if (startDate)   { params.push(startDate);   query += ` AND m.date >= $${params.length}`; }
    if (endDate)     { params.push(endDate);     query += ` AND m.date <= $${params.length}`; }

    query += ` ORDER BY m.date DESC`;
    const result = await db.query(query, params);
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/payroll/mileage

router.post('/mileage', auth, async (req, res) => {
  const { caregiverId, date, miles, fromLocation, toLocation, notes } = req.body;
  try {
    const result = await db.query(`
      INSERT INTO mileage (caregiver_id, date, miles, from_location, to_location, notes, created_by)
      VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *
    `, [caregiverId, date, miles, fromLocation, toLocation, notes, req.user.id]);
    res.json(result.rows[0]);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ==================== PTO ====================
// GET /api/payroll/pto

router.get('/pto', auth, async (req, res) => {
  const { caregiverId, startDate, endDate } = req.query;
  try {
    let query = `
      SELECT p.*, u.first_name, u.last_name
      FROM pto p
      JOIN users u ON p.caregiver_id = u.id
      WHERE 1=1
    `;
    const params = [];

    if (caregiverId) { params.push(caregiverId); query += ` AND p.caregiver_id = $${params.length}`; }
    if (startDate)   { params.push(startDate);   query += ` AND p.start_date >= $${params.length}`; }
    if (endDate)     { params.push(endDate);     query += ` AND p.end_date <= $${params.length}`; }

    query += ` ORDER BY p.start_date DESC`;
    const result = await db.query(query, params);
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/payroll/pto

router.post('/pto', auth, async (req, res) => {
  const { caregiverId, type, startDate, endDate, hours, notes } = req.body;
  try {
    const result = await db.query(`
      INSERT INTO pto (caregiver_id, type, start_date, end_date, hours, notes, status, created_by)
      VALUES ($1, $2, $3, $4, $5, $6, 'approved', $7) RETURNING *
    `, [caregiverId, type, startDate, endDate, hours, notes, req.user.id]);
    res.json(result.rows[0]);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ==================== CSV EXPORT ====================
// POST /api/payroll/export

router.post('/export', auth, async (req, res) => {
  const { startDate, endDate, format, payrollData } = req.body;

  try {
    if (format === 'quickbooks') {
      // QuickBooks IIF format
      let iif = `!TIMEACT\tDATE\tJOB\tEMP\tITEM\tDURATION\tNOTE\n`;
      for (const p of (payrollData || [])) {
        iif += `TIMEACT\t${startDate}\t\t${p.first_name} ${p.last_name}\tRegular\t${p.regular_hours || 0}\tPayroll ${startDate} to ${endDate}\n`;
        if (parseFloat(p.overtime_hours) > 0) {
          iif += `TIMEACT\t${startDate}\t\t${p.first_name} ${p.last_name}\tOvertime\t${p.overtime_hours}\tOvertime\n`;
        }
      }
      res.setHeader('Content-Type', 'application/octet-stream');
      res.setHeader('Content-Disposition', `attachment; filename=quickbooks-payroll-${startDate}.iif`);
      return res.send(iif);
    }

    // Default: CSV
    const result = await db.query(`
      SELECT
        u.first_name, u.last_name,
        COALESCE(u.hourly_rate, $3::numeric) AS hourly_rate,
        ROUND(COALESCE(SUM(COALESCE(te.billable_minutes, te.duration_minutes, 0))::numeric / 60, 0), 2) AS total_hours
      FROM users u
      LEFT JOIN time_entries te
        ON te.caregiver_id = u.id
        AND DATE(te.clock_in_time) >= $1::date
        AND DATE(te.clock_in_time) <= $2::date
        AND te.is_complete = true
      WHERE u.role = 'caregiver' AND u.is_active = true
      GROUP BY u.id, u.first_name, u.last_name, u.hourly_rate
      HAVING COALESCE(SUM(COALESCE(te.billable_minutes, te.duration_minutes, 0)), 0) > 0
      ORDER BY u.last_name
    `, [startDate, endDate, process.env.DEFAULT_HOURLY_RATE || 15]);

    const headers = ['First Name', 'Last Name', 'Hourly Rate', 'Total Hours', 'Gross Pay'];
    const rows = result.rows.map(r => [
      r.first_name, r.last_name, r.hourly_rate, r.total_hours,
      (parseFloat(r.hourly_rate) * parseFloat(r.total_hours)).toFixed(2)
    ]);

    const csv = [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename=payroll-${startDate}-to-${endDate}.csv`);
    res.send(csv);
  } catch (error) {
    console.error('Payroll export error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Keep old /export/quickbooks endpoint for backward compat
router.post('/export/quickbooks', auth, async (req, res) => {
  req.body.format = 'quickbooks';
  // Re-use the export handler logic inline
  const { startDate, endDate, payrollData } = req.body;
  let iif = `!TIMEACT\tDATE\tJOB\tEMP\tITEM\tDURATION\tNOTE\n`;
  for (const p of (payrollData || [])) {
    iif += `TIMEACT\t${startDate}\t\t${p.first_name} ${p.last_name}\tRegular\t${p.regular_hours || 0}\tPayroll ${startDate} to ${endDate}\n`;
    if (parseFloat(p.overtime_hours) > 0) {
      iif += `TIMEACT\t${startDate}\t\t${p.first_name} ${p.last_name}\tOvertime\t${p.overtime_hours}\tOvertime\n`;
    }
  }
  res.setHeader('Content-Type', 'application/octet-stream');
  res.setHeader('Content-Disposition', `attachment; filename=quickbooks-payroll-${startDate}.iif`);
  res.send(iif);
});

module.exports = router;
