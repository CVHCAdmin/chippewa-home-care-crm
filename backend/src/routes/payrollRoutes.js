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
          ROUND(SUM(COALESCE(te.duration_minutes, 0))::numeric / 60, 2),
          0
        )                                                          AS total_hours,
        COALESCE(
          ROUND(SUM(
            CASE WHEN EXTRACT(DOW FROM te.start_time) IN (0,6)
                 THEN COALESCE(te.duration_minutes, 0)
                 ELSE 0 END
          )::numeric / 60, 2),
          0
        )                                                          AS weekend_hours,
        COALESCE(
          ROUND(SUM(
            CASE WHEN EXTRACT(HOUR FROM te.start_time) >= 18
                   OR EXTRACT(HOUR FROM te.start_time) < 6
                 THEN COALESCE(te.duration_minutes, 0)
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
        AND DATE(te.start_time) >= $1::date
        AND DATE(te.start_time) <= $2::date
        AND te.is_complete = true
      LEFT JOIN payroll_records pr
        ON pr.caregiver_id = u.id
        AND pr.period_start = $1 AND pr.period_end = $2
      WHERE u.role = 'caregiver' AND u.is_active = true
      GROUP BY u.id, u.first_name, u.last_name, u.hourly_rate, pr.status, pr.check_number
      HAVING
        COALESCE(SUM(COALESCE(te.duration_minutes, 0)), 0) > 0
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
        ROUND(COALESCE(SUM(COALESCE(te.duration_minutes, 0))::numeric / 60, 0), 2) AS total_hours
      FROM users u
      LEFT JOIN time_entries te
        ON te.caregiver_id = u.id
        AND DATE(te.start_time) >= $1::date
        AND DATE(te.start_time) <= $2::date
        AND te.is_complete = true
      WHERE u.role = 'caregiver' AND u.is_active = true
      GROUP BY u.id, u.first_name, u.last_name, u.hourly_rate
      HAVING COALESCE(SUM(COALESCE(te.duration_minutes, 0)), 0) > 0
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

// ==================== PAYROLL CRUD (migrated from miscRoutes) ====================
// These were shadowed by miscRoutes — now live here exclusively

const { v4: uuidv4 } = require('uuid');
const { verifyToken, requireAdmin, auditLog } = require('../middleware/shared');

// POST /api/payroll/run
router.post('/run', verifyToken, requireAdmin, async (req, res) => {
  try {
    const { payPeriodStart, payPeriodEnd } = req.body;
    if (!payPeriodStart || !payPeriodEnd) return res.status(400).json({ error: 'payPeriodStart and payPeriodEnd are required' });
    const payrollId = uuidv4();
    const payrollNumber = `PR-${Date.now()}`;
    const timeEntriesResult = await db.query(
      `SELECT te.*, u.first_name, u.last_name, cr.base_hourly_rate FROM time_entries te
       JOIN users u ON te.caregiver_id = u.id LEFT JOIN caregiver_rates cr ON te.caregiver_id = cr.caregiver_id
       WHERE te.start_time >= $1 AND te.start_time <= $2 AND te.duration_minutes > 0 ORDER BY te.caregiver_id`,
      [payPeriodStart, payPeriodEnd]
    );
    const caregiverPayroll = {};
    let totalGrossPay = 0;
    for (const entry of timeEntriesResult.rows) {
      if (!caregiverPayroll[entry.caregiver_id]) {
        caregiverPayroll[entry.caregiver_id] = { caregiverId: entry.caregiver_id, caregiverName: `${entry.first_name} ${entry.last_name}`, totalHours: 0, hourlyRate: entry.base_hourly_rate || 18.50, grossPay: 0, lineItems: [] };
      }
      caregiverPayroll[entry.caregiver_id].totalHours += parseFloat(entry.billable_minutes || entry.duration_minutes || 0) / 60;
    }
    const lineItems = [];
    for (const caregiverId in caregiverPayroll) {
      const p = caregiverPayroll[caregiverId];
      p.grossPay = (p.totalHours * p.hourlyRate).toFixed(2);
      totalGrossPay += parseFloat(p.grossPay);
      lineItems.push({ caregiverId, description: `Hours: ${p.totalHours.toFixed(2)} × $${p.hourlyRate.toFixed(2)}/hr`, totalHours: p.totalHours.toFixed(2), hourlyRate: p.hourlyRate, grossAmount: p.grossPay });
    }
    const totalTaxes = (totalGrossPay * 0.0765).toFixed(2);
    const totalNetPay = (totalGrossPay - parseFloat(totalTaxes)).toFixed(2);
    const payrollResult = await db.query(
      `INSERT INTO payroll (id, payroll_number, pay_period_start, pay_period_end, total_hours, gross_pay, taxes, net_pay, status) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'pending') RETURNING *`,
      [payrollId, payrollNumber, payPeriodStart, payPeriodEnd, Object.values(caregiverPayroll).reduce((s, p) => s + p.totalHours, 0).toFixed(2), totalGrossPay, totalTaxes, totalNetPay]
    );
    for (const item of lineItems) {
      await db.query(`INSERT INTO payroll_line_items (payroll_id, caregiver_id, description, total_hours, hourly_rate, gross_amount) VALUES ($1,$2,$3,$4,$5,$6)`, [payrollId, item.caregiverId, item.description, item.totalHours, item.hourlyRate, item.grossAmount]);
    }
    await auditLog(req.user.id, 'CREATE', 'payroll', payrollId, null, payrollResult.rows[0]);
    res.status(201).json({ ...payrollResult.rows[0], lineItems, caregiverCount: lineItems.length });
  } catch (error) { res.status(500).json({ error: error.message }); }
});

// GET /api/payroll/summary
router.get('/summary', auth, async (req, res) => {
  try {
    const [summary, caregiverStats] = await Promise.all([
      db.query(`SELECT COUNT(DISTINCT id) as total_payrolls, COUNT(DISTINCT CASE WHEN status='pending' THEN id END) as pending_payrolls, COUNT(DISTINCT CASE WHEN status='processed' THEN id END) as processed_payrolls, COUNT(DISTINCT CASE WHEN status='paid' THEN id END) as paid_payrolls, SUM(gross_pay) as total_gross_pay, SUM(taxes) as total_taxes, SUM(net_pay) as total_net_pay, AVG(total_hours) as average_hours_per_payroll, MAX(pay_period_end) as latest_payroll_date FROM payroll`),
      db.query(`SELECT u.id, u.first_name, u.last_name, COUNT(pli.id) as payroll_count, SUM(pli.total_hours) as total_hours_paid, SUM(pli.gross_amount) as total_earned FROM users u LEFT JOIN payroll_line_items pli ON u.id = pli.caregiver_id WHERE u.role = 'caregiver' GROUP BY u.id, u.first_name, u.last_name ORDER BY total_earned DESC NULLS LAST`),
    ]);
    res.json({ summary: summary.rows[0], caregiverStats: caregiverStats.rows });
  } catch (error) { res.status(500).json({ error: error.message }); }
});

// GET /api/payroll/caregiver/:caregiverId
router.get('/caregiver/:caregiverId', auth, async (req, res) => {
  try {
    res.json((await db.query(`SELECT pli.*, p.payroll_number, p.pay_period_start, p.pay_period_end, p.status FROM payroll_line_items pli JOIN payroll p ON pli.payroll_id = p.id WHERE pli.caregiver_id = $1 ORDER BY p.pay_period_end DESC`, [req.params.caregiverId])).rows);
  } catch (error) { res.status(500).json({ error: error.message }); }
});

// GET /api/payroll/periods
router.get('/periods', auth, async (req, res) => {
  try {
    res.json((await db.query(`SELECT DISTINCT pay_period_start, pay_period_end FROM payroll ORDER BY pay_period_end DESC`)).rows);
  } catch (error) { res.status(500).json({ error: error.message }); }
});

// GET /api/payroll/discrepancies
router.get('/discrepancies', auth, async (req, res) => {
  try {
    const { startDate, endDate, minDiscrepancy = 5 } = req.query;
    const start = startDate || new Date(Date.now() - 30 * 86400000).toISOString().split('T')[0];
    const end = endDate || new Date().toISOString().split('T')[0];
    const result = await db.query(`
      SELECT te.id, te.start_time, te.end_time, te.duration_minutes, te.allotted_minutes, te.billable_minutes,
        ROUND(te.duration_minutes::numeric/60,2) as actual_hours,
        ROUND(COALESCE(te.allotted_minutes,te.duration_minutes)::numeric/60,2) as allotted_hours,
        ROUND(te.billable_minutes::numeric/60,2) as billable_hours,
        ROUND((te.duration_minutes-COALESCE(te.allotted_minutes,te.duration_minutes))::numeric/60,2) as discrepancy_hours,
        u.first_name as caregiver_first, u.last_name as caregiver_last, u.default_pay_rate,
        ROUND(te.billable_minutes::numeric/60*u.default_pay_rate,2) as billable_pay,
        ROUND(te.duration_minutes::numeric/60*u.default_pay_rate,2) as actual_pay,
        ROUND((te.duration_minutes-COALESCE(te.allotted_minutes,te.duration_minutes))::numeric/60*u.default_pay_rate,2) as overage_cost,
        c.first_name as client_first, c.last_name as client_last
      FROM time_entries te JOIN users u ON te.caregiver_id=u.id JOIN clients c ON te.client_id=c.id
      WHERE te.is_complete=true AND te.start_time>=$1::date AND te.start_time<$2::date+INTERVAL '1 day'
        AND te.allotted_minutes IS NOT NULL AND ABS(COALESCE(te.duration_minutes-te.allotted_minutes,0))>=$3
      ORDER BY ABS(COALESCE(te.duration_minutes-te.allotted_minutes,0)) DESC
    `, [start, end, parseInt(minDiscrepancy)]);
    const totals = result.rows.reduce((acc, r) => {
      acc.totalShifts++;
      acc.totalActualHours += parseFloat(r.actual_hours || 0);
      acc.totalAllottedHours += parseFloat(r.allotted_hours || 0);
      acc.totalBillableHours += parseFloat(r.billable_hours || 0);
      acc.totalOverageCost += parseFloat(r.overage_cost || 0);
      if (parseFloat(r.discrepancy_hours) > 0) acc.overageCount++;
      if (parseFloat(r.discrepancy_hours) < 0) acc.underageCount++;
      return acc;
    }, { totalShifts: 0, totalActualHours: 0, totalAllottedHours: 0, totalBillableHours: 0, totalOverageCost: 0, overageCount: 0, underageCount: 0 });
    res.json({ discrepancies: result.rows, totals, period: { start, end } });
  } catch (error) { res.status(500).json({ error: error.message }); }
});

// GET /api/payroll (list all)
router.get('/', auth, async (req, res) => {
  try {
    res.json((await db.query(`SELECT * FROM payroll ORDER BY pay_period_end DESC`)).rows);
  } catch (error) { res.status(500).json({ error: error.message }); }
});

// GET /api/payroll/:payrollId
router.get('/:payrollId', auth, async (req, res) => {
  try {
    const payrollResult = await db.query(`SELECT * FROM payroll WHERE id = $1`, [req.params.payrollId]);
    if (payrollResult.rows.length === 0) return res.status(404).json({ error: 'Payroll not found' });
    const lineItemsResult = await db.query(`SELECT pli.*, u.first_name, u.last_name FROM payroll_line_items pli JOIN users u ON pli.caregiver_id = u.id WHERE pli.payroll_id = $1 ORDER BY u.first_name, u.last_name`, [req.params.payrollId]);
    res.json({ ...payrollResult.rows[0], lineItems: lineItemsResult.rows });
  } catch (error) { res.status(500).json({ error: error.message }); }
});

// PATCH /api/payroll/:payrollId/status
router.patch('/:payrollId/status', auth, async (req, res) => {
  try {
    const { status, processedDate, paymentMethod } = req.body;
    if (!status) return res.status(400).json({ error: 'status is required' });
    const result = await db.query(
      `UPDATE payroll SET status=$1, processed_date=CASE WHEN $1='processed' THEN COALESCE($2,NOW()) ELSE processed_date END, payment_method=COALESCE($3,payment_method), updated_at=NOW() WHERE id=$4 RETURNING *`,
      [status, processedDate, paymentMethod, req.params.payrollId]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Payroll not found' });
    await auditLog(req.user.id, 'UPDATE', 'payroll', req.params.payrollId, null, result.rows[0]);
    res.json(result.rows[0]);
  } catch (error) { res.status(500).json({ error: error.message }); }
});
