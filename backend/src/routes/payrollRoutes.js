// routes/payrollRoutes.js
// Mounted at /api/payroll — so routes here are /calculate, /mileage, etc. (no /payroll/ prefix)
// Professional shift-level reconciliation: schedule -> clock-in match -> review -> approve -> payroll

const express = require('express');
const router  = express.Router();
const db      = require('../db');
const auth    = require('../middleware/auth');
const { v4: uuidv4 } = require('uuid');
const { verifyToken, requireAdmin, auditLog } = require('../middleware/shared');

// ==================== SCHEDULE EXPANSION HELPER ====================
// Shared SQL fragment to expand schedules into individual shift occurrences

const SCHEDULE_EXPANSION_CTE = `
  shift_occurrences AS (
    SELECT
      s.id AS schedule_id,
      s.caregiver_id,
      s.client_id,
      d.dt::date AS shift_date,
      s.start_time AS scheduled_start,
      s.end_time AS scheduled_end,
      ROUND(EXTRACT(EPOCH FROM (s.end_time - s.start_time)) / 60)::int AS scheduled_minutes
    FROM schedules s
    CROSS JOIN generate_series($1::date, $2::date, '1 day'::interval) AS d(dt)
    WHERE s.is_active = true
      AND (
        (s.schedule_type = 'one-time' AND s.date = d.dt::date)
        OR (s.schedule_type = 'recurring' AND s.day_of_week = EXTRACT(DOW FROM d.dt)::int)
        OR (s.schedule_type = 'bi-weekly' AND s.day_of_week = EXTRACT(DOW FROM d.dt)::int
            AND MOD(((d.dt::date - COALESCE(s.anchor_date, s.effective_date, s.created_at::date))::int / 7), 2) = 0)
        OR (s.schedule_type = 'multi-day' AND s.date IS NOT NULL AND s.date = d.dt::date)
      )
      AND (s.effective_date IS NULL OR d.dt::date >= s.effective_date)
  )
`;

// ==================== SHIFT RECONCILIATION ====================
// POST /api/payroll/generate-shifts
// Expands schedules for the pay period, matches to time entries, creates shift review records

router.post('/generate-shifts', auth, async (req, res) => {
  const { startDate, endDate } = req.body;
  if (!startDate || !endDate) return res.status(400).json({ error: 'startDate and endDate are required' });

  try {
    // Step 1: Expand all schedule occurrences and match to time entries
    const matchResult = await db.query(`
      WITH ${SCHEDULE_EXPANSION_CTE},
      -- Rank time entries per shift by best match: schedule_id first, then closest start time
      ranked_matches AS (
        SELECT
          so.schedule_id,
          so.caregiver_id,
          so.client_id,
          so.shift_date,
          so.scheduled_start,
          so.scheduled_end,
          so.scheduled_minutes,
          te.id AS time_entry_id,
          te.start_time AS actual_start,
          te.end_time AS actual_end,
          COALESCE(te.billable_minutes, te.duration_minutes) AS actual_minutes,
          ROW_NUMBER() OVER (
            PARTITION BY so.schedule_id, so.shift_date
            ORDER BY
              -- Prefer exact schedule_id match
              CASE WHEN te.schedule_id = so.schedule_id THEN 0 ELSE 1 END,
              -- Then prefer closest start time to scheduled start
              ABS(EXTRACT(EPOCH FROM (te.start_time::time - so.scheduled_start)))
          ) AS rn
        FROM shift_occurrences so
        LEFT JOIN time_entries te
          ON te.caregiver_id = so.caregiver_id
          AND te.client_id = so.client_id
          AND DATE(te.start_time) = so.shift_date
      ),
      matched AS (
        -- Scheduled shifts matched to best clock-in
        SELECT
          schedule_id, caregiver_id, client_id, shift_date,
          scheduled_start, scheduled_end, scheduled_minutes,
          time_entry_id, actual_start, actual_end, actual_minutes,
          CASE
            WHEN time_entry_id IS NOT NULL AND ABS(COALESCE(actual_minutes, 0) - scheduled_minutes) <= 15
              THEN 'verified'
            WHEN time_entry_id IS NOT NULL
              THEN 'pending'
            ELSE 'missing_punch'
          END AS auto_status
        FROM ranked_matches
        WHERE rn = 1

        UNION ALL

        -- Unscheduled clock-ins (clock-in exists but no matching schedule)
        SELECT
          NULL AS schedule_id,
          te.caregiver_id,
          te.client_id,
          DATE(te.start_time) AS shift_date,
          NULL AS scheduled_start,
          NULL AS scheduled_end,
          NULL AS scheduled_minutes,
          te.id AS time_entry_id,
          te.start_time AS actual_start,
          te.end_time AS actual_end,
          COALESCE(te.billable_minutes, te.duration_minutes) AS actual_minutes,
          'pending' AS auto_status
        FROM time_entries te
        WHERE DATE(te.start_time) >= $1::date
          AND DATE(te.start_time) <= $2::date
          AND NOT EXISTS (
            SELECT 1 FROM shift_occurrences so
            WHERE so.caregiver_id = te.caregiver_id
              AND so.client_id = te.client_id
              AND so.shift_date = DATE(te.start_time)
          )
      )
      SELECT * FROM matched
      ORDER BY caregiver_id, shift_date, scheduled_start
    `, [startDate, endDate]);

    // Step 2: Upsert into payroll_shift_reviews
    let created = 0, updated = 0;
    for (const row of matchResult.rows) {
      const payableMinutes = row.actual_minutes != null
        ? (row.scheduled_minutes != null ? Math.min(row.actual_minutes, row.scheduled_minutes) : row.actual_minutes)
        : (row.auto_status === 'missing_punch' ? null : row.scheduled_minutes);

      const result = await db.query(`
        INSERT INTO payroll_shift_reviews (
          id, pay_period_start, pay_period_end, caregiver_id, client_id,
          schedule_id, time_entry_id, shift_date,
          scheduled_start, scheduled_end, scheduled_minutes,
          actual_start, actual_end, actual_minutes,
          payable_minutes, status
        ) VALUES (
          $1, $2, $3, $4, $5,
          $6, $7, $8,
          $9, $10, $11,
          $12, $13, $14,
          $15, $16
        )
        ON CONFLICT (pay_period_start, pay_period_end, caregiver_id, shift_date,
          COALESCE(schedule_id, '00000000-0000-0000-0000-000000000000'))
        DO UPDATE SET
          time_entry_id = EXCLUDED.time_entry_id,
          actual_start = EXCLUDED.actual_start,
          actual_end = EXCLUDED.actual_end,
          actual_minutes = EXCLUDED.actual_minutes,
          payable_minutes = CASE
            WHEN payroll_shift_reviews.status IN ('approved', 'manual_entry', 'excused')
            THEN payroll_shift_reviews.payable_minutes
            ELSE EXCLUDED.payable_minutes
          END,
          status = CASE
            WHEN payroll_shift_reviews.status IN ('approved', 'manual_entry', 'excused')
            THEN payroll_shift_reviews.status
            ELSE EXCLUDED.status
          END,
          updated_at = NOW()
        RETURNING (xmax = 0) AS is_insert
      `, [
        uuidv4(), startDate, endDate, row.caregiver_id, row.client_id,
        row.schedule_id, row.time_entry_id, row.shift_date,
        row.scheduled_start, row.scheduled_end, row.scheduled_minutes,
        row.actual_start, row.actual_end, row.actual_minutes,
        payableMinutes, row.auto_status
      ]);

      if (result.rows[0]?.is_insert) created++;
      else updated++;
    }

    res.json({ success: true, created, updated, totalShifts: matchResult.rows.length });
  } catch (error) {
    console.error('Generate shifts error:', error);
    res.status(500).json({ error: error.message });
  }
});

// ==================== GET SHIFT REVIEWS ====================
// GET /api/payroll/shifts?startDate=&endDate=&caregiverId=&status=

router.get('/shifts', auth, async (req, res) => {
  const { startDate, endDate, caregiverId, status } = req.query;
  if (!startDate || !endDate) return res.status(400).json({ error: 'startDate and endDate required' });

  try {
    let query = `
      SELECT
        psr.*,
        u.first_name AS caregiver_first,
        u.last_name AS caregiver_last,
        COALESCE(u.hourly_rate, ${parseFloat(process.env.DEFAULT_HOURLY_RATE) || 15}) AS hourly_rate,
        c.first_name AS client_first,
        c.last_name AS client_last,
        reviewer.first_name AS reviewer_first,
        reviewer.last_name AS reviewer_last
      FROM payroll_shift_reviews psr
      JOIN users u ON psr.caregiver_id = u.id
      LEFT JOIN clients c ON psr.client_id = c.id
      LEFT JOIN users reviewer ON psr.reviewed_by = reviewer.id
      WHERE psr.pay_period_start = $1 AND psr.pay_period_end = $2
    `;
    const params = [startDate, endDate];

    if (caregiverId) { params.push(caregiverId); query += ` AND psr.caregiver_id = $${params.length}`; }
    if (status) { params.push(status); query += ` AND psr.status = $${params.length}`; }

    query += ` ORDER BY u.last_name, u.first_name, psr.shift_date, psr.scheduled_start`;
    const result = await db.query(query, params);

    // Compute summary stats
    const stats = {
      total: result.rows.length,
      verified: result.rows.filter(r => r.status === 'verified').length,
      approved: result.rows.filter(r => r.status === 'approved').length,
      pending: result.rows.filter(r => r.status === 'pending').length,
      missing_punch: result.rows.filter(r => r.status === 'missing_punch').length,
      flagged: result.rows.filter(r => r.status === 'flagged').length,
      excused: result.rows.filter(r => r.status === 'excused').length,
      manual_entry: result.rows.filter(r => r.status === 'manual_entry').length,
      totalScheduledMinutes: result.rows.reduce((s, r) => s + (r.scheduled_minutes || 0), 0),
      totalActualMinutes: result.rows.reduce((s, r) => s + (r.actual_minutes || 0), 0),
      totalPayableMinutes: result.rows.filter(r => ['verified','approved','manual_entry'].includes(r.status))
        .reduce((s, r) => s + (r.payable_minutes || 0), 0),
      readyForPayroll: 0
    };
    stats.readyForPayroll = stats.verified + stats.approved + stats.manual_entry;
    stats.needsAttention = stats.pending + stats.missing_punch + stats.flagged;

    res.json({ shifts: result.rows, stats });
  } catch (error) {
    console.error('Get shifts error:', error);
    res.status(500).json({ error: error.message });
  }
});

// ==================== UPDATE SHIFT REVIEW ====================
// PATCH /api/payroll/shifts/:id
// Approve, flag, resolve, or set manual hours on a single shift

router.patch('/shifts/:id', auth, async (req, res) => {
  const { status, payableMinutes, flagReason, resolutionNotes } = req.body;
  if (!status) return res.status(400).json({ error: 'status is required' });

  const allowed = ['pending', 'verified', 'approved', 'flagged', 'missing_punch', 'excused', 'manual_entry'];
  if (!allowed.includes(status)) return res.status(400).json({ error: `Invalid status. Must be one of: ${allowed.join(', ')}` });

  try {
    const result = await db.query(`
      UPDATE payroll_shift_reviews SET
        status = $1,
        payable_minutes = COALESCE($2, payable_minutes),
        flag_reason = COALESCE($3, flag_reason),
        resolution_notes = COALESCE($4, resolution_notes),
        reviewed_by = $5,
        reviewed_at = NOW(),
        updated_at = NOW()
      WHERE id = $6
      RETURNING *
    `, [status, payableMinutes ?? null, flagReason ?? null, resolutionNotes ?? null, req.user.id, req.params.id]);

    if (result.rows.length === 0) return res.status(404).json({ error: 'Shift review not found' });
    res.json(result.rows[0]);
  } catch (error) {
    console.error('Update shift error:', error);
    res.status(500).json({ error: error.message });
  }
});

// ==================== BULK APPROVE SHIFTS ====================
// POST /api/payroll/shifts/approve-all
// mode: 'clocked' (default) — only shifts with clock-ins
//        'all' — all shifts including missing punches (uses scheduled hours)

router.post('/shifts/approve-all', auth, async (req, res) => {
  const { startDate, endDate, caregiverId, mode = 'clocked' } = req.body;
  if (!startDate || !endDate) return res.status(400).json({ error: 'startDate and endDate are required' });

  try {
    const params = [req.user.id, startDate, endDate];
    let approvedClocked = 0, approvedScheduled = 0;

    // Step 1: Approve clocked shifts (discard junk <2 min clock-ins by using scheduled hours instead)
    let clockedQuery = `
      UPDATE payroll_shift_reviews SET
        status = 'approved',
        payable_minutes = CASE
          WHEN actual_minutes IS NOT NULL AND actual_minutes >= 2 THEN payable_minutes
          WHEN scheduled_minutes IS NOT NULL THEN scheduled_minutes
          ELSE payable_minutes
        END,
        reviewed_by = $1,
        reviewed_at = NOW(),
        updated_at = NOW()
      WHERE pay_period_start = $2 AND pay_period_end = $3
        AND status IN ('verified', 'pending')
        AND time_entry_id IS NOT NULL
    `;
    if (caregiverId) { params.push(caregiverId); clockedQuery += ` AND caregiver_id = $${params.length}`; }
    const clockedResult = await db.query(clockedQuery + ' RETURNING id', params);
    approvedClocked = clockedResult.rows.length;

    // Step 2: If mode is 'all', also approve missing punches using scheduled hours
    if (mode === 'all') {
      const schedParams = [req.user.id, startDate, endDate];
      let schedQuery = `
        UPDATE payroll_shift_reviews SET
          status = 'approved',
          payable_minutes = scheduled_minutes,
          resolution_notes = 'Bulk approved at scheduled hours',
          reviewed_by = $1,
          reviewed_at = NOW(),
          updated_at = NOW()
        WHERE pay_period_start = $2 AND pay_period_end = $3
          AND status = 'missing_punch'
          AND scheduled_minutes IS NOT NULL
      `;
      if (caregiverId) { schedParams.push(caregiverId); schedQuery += ` AND caregiver_id = $${schedParams.length}`; }
      const schedResult = await db.query(schedQuery + ' RETURNING id', schedParams);
      approvedScheduled = schedResult.rows.length;
    }

    res.json({ success: true, approvedCount: approvedClocked + approvedScheduled, approvedClocked, approvedScheduled });
  } catch (error) {
    console.error('Bulk approve error:', error);
    res.status(500).json({ error: error.message });
  }
});

// ==================== PAYROLL CALCULATE ====================
// POST /api/payroll/calculate
// Now driven by approved shift reviews, not raw time entries

router.post('/calculate', auth, async (req, res) => {
  const { startDate, endDate } = req.body;
  if (!startDate || !endDate) return res.status(400).json({ error: 'startDate and endDate are required' });

  try {
    const result = await db.query(`
      SELECT
        u.id                                                        AS caregiver_id,
        u.first_name,
        u.last_name,
        COALESCE(u.hourly_rate, $3::numeric)                       AS hourly_rate,

        -- Scheduled hours (all shifts in period)
        COALESCE((
          SELECT ROUND(SUM(psr2.scheduled_minutes)::numeric / 60, 2)
          FROM payroll_shift_reviews psr2
          WHERE psr2.caregiver_id = u.id
            AND psr2.pay_period_start = $1 AND psr2.pay_period_end = $2
            AND psr2.scheduled_minutes IS NOT NULL
        ), 0)                                                      AS scheduled_hours,

        -- Clocked-in hours (actual time from GPS clock-in/out)
        COALESCE((
          SELECT ROUND(SUM(psr2.actual_minutes)::numeric / 60, 2)
          FROM payroll_shift_reviews psr2
          WHERE psr2.caregiver_id = u.id
            AND psr2.pay_period_start = $1 AND psr2.pay_period_end = $2
            AND psr2.actual_minutes IS NOT NULL
        ), 0)                                                      AS clocked_hours,

        -- Payable hours (only from approved/verified/manual shifts)
        COALESCE((
          SELECT ROUND(SUM(psr2.payable_minutes)::numeric / 60, 2)
          FROM payroll_shift_reviews psr2
          WHERE psr2.caregiver_id = u.id
            AND psr2.pay_period_start = $1 AND psr2.pay_period_end = $2
            AND psr2.status IN ('verified', 'approved', 'manual_entry')
            AND psr2.payable_minutes IS NOT NULL
        ), 0)                                                      AS total_hours,

        -- Shift counts
        COALESCE((
          SELECT COUNT(*) FROM payroll_shift_reviews psr2
          WHERE psr2.caregiver_id = u.id
            AND psr2.pay_period_start = $1 AND psr2.pay_period_end = $2
            AND psr2.scheduled_minutes IS NOT NULL
        ), 0)                                                      AS scheduled_shifts,
        COALESCE((
          SELECT COUNT(*) FROM payroll_shift_reviews psr2
          WHERE psr2.caregiver_id = u.id
            AND psr2.pay_period_start = $1 AND psr2.pay_period_end = $2
            AND psr2.time_entry_id IS NOT NULL
        ), 0)                                                      AS clocked_shifts,
        COALESCE((
          SELECT COUNT(*) FROM payroll_shift_reviews psr2
          WHERE psr2.caregiver_id = u.id
            AND psr2.pay_period_start = $1 AND psr2.pay_period_end = $2
            AND psr2.status IN ('verified', 'approved', 'manual_entry')
        ), 0)                                                      AS approved_shifts,
        COALESCE((
          SELECT COUNT(*) FROM payroll_shift_reviews psr2
          WHERE psr2.caregiver_id = u.id
            AND psr2.pay_period_start = $1 AND psr2.pay_period_end = $2
            AND psr2.status IN ('pending', 'missing_punch', 'flagged')
        ), 0)                                                      AS unresolved_shifts,

        -- Weekend hours (from approved shifts only)
        COALESCE((
          SELECT ROUND(SUM(psr2.payable_minutes)::numeric / 60, 2)
          FROM payroll_shift_reviews psr2
          WHERE psr2.caregiver_id = u.id
            AND psr2.pay_period_start = $1 AND psr2.pay_period_end = $2
            AND psr2.status IN ('verified', 'approved', 'manual_entry')
            AND EXTRACT(DOW FROM psr2.shift_date) IN (0, 6)
        ), 0)                                                      AS weekend_hours,

        -- Night hours (from approved shifts only)
        COALESCE((
          SELECT ROUND(SUM(psr2.payable_minutes)::numeric / 60, 2)
          FROM payroll_shift_reviews psr2
          WHERE psr2.caregiver_id = u.id
            AND psr2.pay_period_start = $1 AND psr2.pay_period_end = $2
            AND psr2.status IN ('verified', 'approved', 'manual_entry')
            AND (psr2.scheduled_start >= '18:00' OR psr2.scheduled_start < '06:00'
                 OR psr2.actual_start IS NOT NULL AND (
                   EXTRACT(HOUR FROM psr2.actual_start) >= 18
                   OR EXTRACT(HOUR FROM psr2.actual_start) < 6
                 ))
        ), 0)                                                      AS night_hours,

        -- Mileage
        COALESCE((
          SELECT SUM(m.miles) FROM mileage m
          WHERE m.caregiver_id = u.id AND m.date >= $1 AND m.date <= $2
        ), 0)                                                      AS total_miles,

        -- PTO
        COALESCE((
          SELECT SUM(p.hours) FROM pto p
          WHERE p.caregiver_id = u.id
            AND p.start_date >= $1 AND p.end_date <= $2
            AND p.status = 'approved' AND p.type != 'unpaid'
        ), 0)                                                      AS pto_hours,

        COALESCE(pr.status, 'draft')                               AS payroll_status,
        pr.check_number
      FROM users u
      LEFT JOIN payroll_records pr
        ON pr.caregiver_id = u.id
        AND pr.period_start = $1 AND pr.period_end = $2
      WHERE u.role = 'caregiver' AND u.is_active = true
        AND EXISTS (
          SELECT 1 FROM payroll_shift_reviews psr2
          WHERE psr2.caregiver_id = u.id
            AND psr2.pay_period_start = $1 AND psr2.pay_period_end = $2
        )
      GROUP BY u.id, u.first_name, u.last_name, u.hourly_rate, pr.status, pr.check_number
      ORDER BY u.last_name, u.first_name
    `, [startDate, endDate, process.env.DEFAULT_HOURLY_RATE || 15]);

    res.json({ payrollData: result.rows, status: 'calculated' });
  } catch (error) {
    console.error('Payroll calculate error:', error);
    res.status(500).json({ error: error.message });
  }
});

// ==================== PAYROLL APPROVE (per caregiver) ====================
// POST /api/payroll/:caregiverId/approve

router.post('/:caregiverId/approve', auth, async (req, res) => {
  const { caregiverId } = req.params;
  const { startDate, endDate } = req.body;
  if (!startDate || !endDate) return res.status(400).json({ error: 'startDate and endDate are required' });

  try {
    // Check for unresolved shifts
    const unresolved = await db.query(`
      SELECT COUNT(*) AS cnt FROM payroll_shift_reviews
      WHERE caregiver_id = $1 AND pay_period_start = $2 AND pay_period_end = $3
        AND status IN ('pending', 'missing_punch', 'flagged')
    `, [caregiverId, startDate, endDate]);

    if (parseInt(unresolved.rows[0].cnt) > 0) {
      return res.status(400).json({
        error: `Cannot approve payroll: ${unresolved.rows[0].cnt} shift(s) still need review`,
        unresolvedCount: parseInt(unresolved.rows[0].cnt)
      });
    }

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

    // Default: CSV — use approved shift data
    const result = await db.query(`
      SELECT
        u.first_name, u.last_name,
        COALESCE(u.hourly_rate, $3::numeric) AS hourly_rate,
        ROUND(COALESCE(SUM(psr.payable_minutes), 0)::numeric / 60, 2) AS total_hours
      FROM users u
      JOIN payroll_shift_reviews psr ON psr.caregiver_id = u.id
      WHERE u.role = 'caregiver' AND u.is_active = true
        AND psr.pay_period_start = $1 AND psr.pay_period_end = $2
        AND psr.status IN ('verified', 'approved', 'manual_entry')
      GROUP BY u.id, u.first_name, u.last_name, u.hourly_rate
      HAVING COALESCE(SUM(psr.payable_minutes), 0) > 0
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
