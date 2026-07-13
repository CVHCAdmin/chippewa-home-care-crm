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
      COALESCE(se.override_start_time, s.start_time) AS scheduled_start,
      COALESCE(se.override_end_time, s.end_time) AS scheduled_end,
      (ROUND(EXTRACT(EPOCH FROM (COALESCE(se.override_end_time, s.end_time) - COALESCE(se.override_start_time, s.start_time))) / 60)::int
        + CASE WHEN COALESCE(se.override_end_time, s.end_time) < COALESCE(se.override_start_time, s.start_time) THEN 1440 ELSE 0 END) AS scheduled_minutes
    FROM schedules s
    CROSS JOIN generate_series($1::date, $2::date, '1 day'::interval) AS d(dt)
    LEFT JOIN schedule_exceptions se
      ON se.schedule_id = s.id AND se.exception_date = d.dt::date
    WHERE s.is_active = true
      AND (
        (s.schedule_type = 'one-time' AND s.date = d.dt::date)
        OR (s.schedule_type = 'recurring' AND s.day_of_week = EXTRACT(DOW FROM d.dt)::int)
        OR (s.schedule_type = 'bi-weekly' AND s.day_of_week = EXTRACT(DOW FROM d.dt)::int
            AND MOD(((d.dt::date - COALESCE(s.anchor_date, s.effective_date, s.created_at::date))::int / 7), 2) = 0)
        OR (s.schedule_type = 'multi-day' AND s.date IS NOT NULL AND s.date = d.dt::date)
      )
      -- Hard lower bound: never expand a recurring shift backwards past the
      -- date it was actually entered. effective_date is authoritative; we
      -- fall back to created_at for any legacy row that escaped the v36
      -- backfill. Anything without either is refused.
      AND d.dt::date >= COALESCE(s.effective_date, s.created_at::date)
      AND (s.end_date IS NULL OR d.dt::date <= s.end_date)
      AND (se.id IS NULL OR se.exception_type != 'cancelled')
  )
`;

// ==================== SHIFT RECONCILIATION ====================
// POST /api/payroll/generate-shifts
// Expands schedules for the pay period, matches to time entries, creates shift review records

router.post('/generate-shifts', auth, async (req, res) => {
  const { startDate, endDate, force } = req.body;
  if (!startDate || !endDate) return res.status(400).json({ error: 'startDate and endDate are required' });

  try {
    // ── Overlap guard ──────────────────────────────────────────────────────
    // Without this, running /generate-shifts on a date range that overlaps an
    // existing pay-period produces a NEW review row per overlapping period
    // (the unique index keys on pay_period_start/end), and the same shift gets
    // paid multiple times. Pass ?force=true OR { force: true } in the body to
    // override (e.g., regenerating after corrections — caller is responsible
    // for cleaning up old reviews first).
    if (!force && req.query.force !== 'true') {
      const overlap = await db.query(
        // Re-running the EXACT same period is fine — the ON CONFLICT upsert keys
        // on the same (period, caregiver, date, schedule) and updates in place
        // (preserving approved/manual rows). Only block a DIFFERENT range that
        // overlaps, which would create duplicate rows for the shared shifts.
        `SELECT DISTINCT pay_period_start, pay_period_end
         FROM payroll_shift_reviews
         WHERE pay_period_start <= $2::date
           AND pay_period_end   >= $1::date
           AND NOT (pay_period_start = $1::date AND pay_period_end = $2::date)
         ORDER BY pay_period_start
         LIMIT 10`,
        [startDate, endDate]
      );
      if (overlap.rows.length > 0) {
        const periods = overlap.rows.map(r =>
          `${r.pay_period_start.toISOString().slice(0,10)}..${r.pay_period_end.toISOString().slice(0,10)}`
        );
        return res.status(409).json({
          error: 'This date range overlaps existing payroll review(s). Regenerating would create duplicate paid rows for the same shifts.',
          overlapping_periods: periods,
          hint: 'Either pick a non-overlapping range, or pass force=true after deleting the old review rows for this range.',
        });
      }
    }

    // Step 1: Expand all schedule occurrences and match to time entries
    // Tight pass: each punch picks closest shift within 2 hours, each shift picks best remaining punch.
    // Loose pass: any leftover shift + leftover punch on same caregiver/client/date get paired,
    //   regardless of time distance — prevents double-payment when a caregiver clocks the right shift
    //   but logs their time >2hrs off the scheduled start.
    const matchResult = await db.query(`
      WITH ${SCHEDULE_EXPANSION_CTE},

      -- Tight candidates: (shift, punch) pairs within 2 hours of each other
      tight_candidates AS (
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
          ROUND(EXTRACT(EPOCH FROM (te.end_time - te.start_time)) / 60)::int AS actual_minutes,
          ABS(EXTRACT(EPOCH FROM ((te.start_time AT TIME ZONE 'America/Chicago')::time - so.scheduled_start))) AS time_diff_secs,
          CASE WHEN te.schedule_id = so.schedule_id THEN 0 ELSE 1 END AS sched_rank
        FROM shift_occurrences so
        INNER JOIN time_entries te
          ON te.caregiver_id = so.caregiver_id
          AND te.client_id = so.client_id
          AND DATE(te.start_time AT TIME ZONE 'America/Chicago') = so.shift_date
          AND ABS(EXTRACT(EPOCH FROM ((te.start_time AT TIME ZONE 'America/Chicago')::time - so.scheduled_start))) <= 7200
      ),

      tight_punch_best AS (
        SELECT *,
          ROW_NUMBER() OVER (
            PARTITION BY time_entry_id
            ORDER BY sched_rank, time_diff_secs
          ) AS punch_rn
        FROM tight_candidates
      ),

      tight_shift_best AS (
        SELECT * FROM (
          SELECT *,
            ROW_NUMBER() OVER (
              PARTITION BY schedule_id, shift_date
              ORDER BY sched_rank, time_diff_secs
            ) AS shift_rn
          FROM tight_punch_best
          WHERE punch_rn = 1
        ) t WHERE shift_rn = 1
      ),

      -- Loose candidates: same caregiver/client/date, any time gap,
      -- only for shifts and punches not already tight-matched.
      loose_candidates AS (
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
          ROUND(EXTRACT(EPOCH FROM (te.end_time - te.start_time)) / 60)::int AS actual_minutes,
          ABS(EXTRACT(EPOCH FROM ((te.start_time AT TIME ZONE 'America/Chicago')::time - so.scheduled_start))) AS time_diff_secs
        FROM shift_occurrences so
        INNER JOIN time_entries te
          ON te.caregiver_id = so.caregiver_id
          AND te.client_id = so.client_id
          AND DATE(te.start_time AT TIME ZONE 'America/Chicago') = so.shift_date
        WHERE NOT EXISTS (
            SELECT 1 FROM tight_shift_best tsb
            WHERE tsb.schedule_id = so.schedule_id AND tsb.shift_date = so.shift_date
          )
          AND NOT EXISTS (
            SELECT 1 FROM tight_shift_best tsb WHERE tsb.time_entry_id = te.id
          )
      ),

      loose_punch_best AS (
        SELECT *,
          ROW_NUMBER() OVER (
            PARTITION BY time_entry_id ORDER BY time_diff_secs
          ) AS punch_rn
        FROM loose_candidates
      ),

      loose_shift_best AS (
        SELECT * FROM (
          SELECT *,
            ROW_NUMBER() OVER (
              PARTITION BY schedule_id, shift_date ORDER BY time_diff_secs
            ) AS shift_rn
          FROM loose_punch_best WHERE punch_rn = 1
        ) t WHERE shift_rn = 1
      ),

      all_matches AS (
        SELECT schedule_id, shift_date, time_entry_id, actual_start, actual_end, actual_minutes
        FROM tight_shift_best
        UNION ALL
        SELECT schedule_id, shift_date, time_entry_id, actual_start, actual_end, actual_minutes
        FROM loose_shift_best
      ),

      -- Final: all shifts with their matched punch (or NULL for missing)
      matched AS (
        SELECT
          so.schedule_id, so.caregiver_id, so.client_id, so.shift_date,
          so.scheduled_start, so.scheduled_end, so.scheduled_minutes,
          am.time_entry_id, am.actual_start, am.actual_end, am.actual_minutes,
          CASE
            -- Never auto-verify a punch the time system already flagged for
            -- review (time_variance, zero_duration, excessive_duration, missed
            -- clock-out, etc.) — surface it as pending instead.
            WHEN am.time_entry_id IS NOT NULL AND te2.needs_approval
              THEN 'pending'
            -- Verified only when the RAW clocked duration (end−start, no longer
            -- the clamped billable_minutes) is within 15 min of scheduled.
            WHEN am.time_entry_id IS NOT NULL AND ABS(COALESCE(am.actual_minutes, 0) - so.scheduled_minutes) <= 15
              THEN 'verified'
            WHEN am.time_entry_id IS NOT NULL
              THEN 'pending'
            ELSE 'missing_punch'
          END AS auto_status
        FROM shift_occurrences so
        LEFT JOIN all_matches am
          ON am.schedule_id = so.schedule_id
          AND am.shift_date = so.shift_date
        LEFT JOIN time_entries te2 ON te2.id = am.time_entry_id

        UNION ALL

        -- Truly unscheduled clock-ins: punches that didn't match any shift (tight or loose)
        SELECT
          NULL AS schedule_id,
          te.caregiver_id,
          te.client_id,
          DATE(te.start_time AT TIME ZONE 'America/Chicago') AS shift_date,
          NULL AS scheduled_start,
          NULL AS scheduled_end,
          NULL AS scheduled_minutes,
          te.id AS time_entry_id,
          te.start_time AS actual_start,
          te.end_time AS actual_end,
          ROUND(EXTRACT(EPOCH FROM (te.end_time - te.start_time)) / 60)::int AS actual_minutes,
          'pending' AS auto_status
        FROM time_entries te
        WHERE DATE(te.start_time AT TIME ZONE 'America/Chicago') >= $1::date
          AND DATE(te.start_time AT TIME ZONE 'America/Chicago') <= $2::date
          AND NOT EXISTS (
            SELECT 1 FROM all_matches am WHERE am.time_entry_id = te.id
          )
      )
      SELECT * FROM matched
      ORDER BY caregiver_id, shift_date, scheduled_start
    `, [startDate, endDate]);

    // Step 2: Upsert into payroll_shift_reviews
    // Payable rule: caregivers are paid their SCHEDULED hours; the clock-in is verification
    // that they were actually there. Unscheduled clock-ins have no schedule to pay against,
    // so payable defaults to actual — admin must review and resolve.
    // Professional exception-based pay rule: pay ACTUAL clocked time, never more
    // than scheduled (cap prevents missed-clock-out inflation), with a 7-minute
    // grace — if they worked within 7 min of the full scheduled length (or more),
    // round up to scheduled instead of docking a few minutes.
    //   - matched + scheduled  -> LEAST(actual, scheduled) with 7-min grace
    //   - unscheduled clock-in -> actual (flagged for review; no schedule to cap)
    //   - missing punch        -> scheduled kept ONLY as a fallback for a manual
    //                             approval; status stays 'missing_punch' so it is
    //                             NOT auto-paid (flagged for review per policy).
    const PAY_GRACE_MIN = 7;
    let created = 0, updated = 0;
    for (const row of matchResult.rows) {
      let payableMinutes;
      if (row.time_entry_id != null && row.actual_minutes != null && row.scheduled_minutes != null) {
        payableMinutes = (row.actual_minutes >= row.scheduled_minutes - PAY_GRACE_MIN)
          ? row.scheduled_minutes
          : row.actual_minutes;
      } else if (row.time_entry_id != null && row.actual_minutes != null) {
        payableMinutes = row.actual_minutes;
      } else {
        payableMinutes = row.scheduled_minutes;
      }

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
            WHEN payroll_shift_reviews.status IN ('manual_entry', 'excused')
            THEN payroll_shift_reviews.payable_minutes
            ELSE EXCLUDED.payable_minutes
          END,
          status = CASE
            WHEN payroll_shift_reviews.status IN ('manual_entry', 'excused')
            THEN payroll_shift_reviews.status
            WHEN payroll_shift_reviews.status = 'approved'
            THEN 'approved'
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

    // Cleanup: remove orphan "unscheduled clock-in" rows whose punch is now linked
    // to a scheduled shift via the new loose-match pass. Without this, old rows
    // created by a previous run (with only tight matching) double-count the hours.
    // Skip manual_entry / excused rows — those were individually reviewed.
    const cleanup = await db.query(`
      DELETE FROM payroll_shift_reviews psr
      WHERE psr.pay_period_start = $1 AND psr.pay_period_end = $2
        AND psr.schedule_id IS NULL
        AND psr.time_entry_id IS NOT NULL
        AND psr.status IN ('pending', 'verified', 'approved')
        AND EXISTS (
          SELECT 1 FROM payroll_shift_reviews other
          WHERE other.pay_period_start = psr.pay_period_start
            AND other.pay_period_end = psr.pay_period_end
            AND other.schedule_id IS NOT NULL
            AND other.time_entry_id = psr.time_entry_id
            AND other.id <> psr.id
        )
    `, [startDate, endDate]);

    res.json({
      success: true,
      created,
      updated,
      orphansRemoved: cleanup.rowCount,
      totalShifts: matchResult.rows.length
    });
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
        COALESCE(u.default_pay_rate, u.hourly_rate, ${parseFloat(process.env.DEFAULT_HOURLY_RATE) || 15}) AS hourly_rate,
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

// ==================== PAYROLL ANALYTICS ====================
// GET /api/payroll/analytics?startDate=&endDate=
// Per-caregiver punctuality + hours report for the pay period, computed from the
// reconciled shift reviews. Read-only. Times compared in America/Chicago with a
// 7-minute grace, matching the pay rule. (Overnight shifts — scheduled_end <
// scheduled_start — are excluded from the late/early tallies to avoid time-of-day
// wraparound; they still count in the hour totals.)
router.get('/analytics', auth, async (req, res) => {
  const { startDate, endDate } = req.query;
  if (!startDate || !endDate) return res.status(400).json({ error: 'startDate and endDate required' });
  try {
    const result = await db.query(`
      SELECT
        u.id, u.first_name, u.last_name,
        ROUND(COALESCE(SUM(psr.scheduled_minutes),0)::numeric/60, 1) AS scheduled_hours,
        ROUND(COALESCE(SUM(psr.actual_minutes) FILTER (WHERE psr.time_entry_id IS NOT NULL),0)::numeric/60, 1) AS clocked_hours,
        ROUND(COALESCE(SUM(psr.payable_minutes) FILTER (WHERE psr.status IN ('verified','approved','manual_entry')),0)::numeric/60, 1) AS payable_hours,
        COUNT(*) FILTER (WHERE psr.schedule_id IS NOT NULL) AS shifts_scheduled,
        COUNT(*) FILTER (WHERE psr.schedule_id IS NOT NULL AND psr.time_entry_id IS NOT NULL) AS shifts_worked,
        COUNT(*) FILTER (WHERE psr.status = 'missing_punch') AS missing_punches,
        COUNT(*) FILTER (WHERE psr.schedule_id IS NULL AND psr.time_entry_id IS NOT NULL) AS unscheduled_punches,
        COUNT(*) FILTER (
          WHERE psr.time_entry_id IS NOT NULL AND psr.actual_start IS NOT NULL AND psr.scheduled_start IS NOT NULL
            AND psr.scheduled_end > psr.scheduled_start
            AND (psr.actual_start AT TIME ZONE 'America/Chicago')::time > psr.scheduled_start + interval '7 minutes'
        ) AS late_arrivals,
        COUNT(*) FILTER (
          WHERE psr.time_entry_id IS NOT NULL AND psr.actual_end IS NOT NULL AND psr.scheduled_end IS NOT NULL
            AND psr.scheduled_end > psr.scheduled_start
            AND (psr.actual_end AT TIME ZONE 'America/Chicago')::time < psr.scheduled_end - interval '7 minutes'
        ) AS early_departures,
        COUNT(*) FILTER (
          WHERE psr.time_entry_id IS NOT NULL AND psr.actual_end IS NOT NULL AND psr.scheduled_end IS NOT NULL
            AND psr.scheduled_end > psr.scheduled_start
            AND (psr.actual_end AT TIME ZONE 'America/Chicago')::time > psr.scheduled_end + interval '7 minutes'
        ) AS late_departures,
        ROUND(AVG(EXTRACT(EPOCH FROM ((psr.actual_start AT TIME ZONE 'America/Chicago')::time - psr.scheduled_start))/60)
          FILTER (WHERE psr.time_entry_id IS NOT NULL AND psr.actual_start IS NOT NULL AND psr.scheduled_start IS NOT NULL
            AND psr.scheduled_end > psr.scheduled_start
            AND (psr.actual_start AT TIME ZONE 'America/Chicago')::time > psr.scheduled_start + interval '7 minutes')::numeric, 0) AS avg_late_minutes
      FROM payroll_shift_reviews psr
      JOIN users u ON u.id = psr.caregiver_id
      WHERE psr.pay_period_start = $1 AND psr.pay_period_end = $2
      GROUP BY u.id, u.first_name, u.last_name
      HAVING COUNT(*) FILTER (WHERE psr.schedule_id IS NOT NULL) > 0 OR COUNT(*) > 0
      ORDER BY u.last_name, u.first_name
    `, [startDate, endDate]);

    const rows = result.rows.map(r => {
      const sched = parseInt(r.shifts_scheduled) || 0;
      const worked = parseInt(r.shifts_worked) || 0;
      return { ...r, reliability_pct: sched > 0 ? Math.round((worked / sched) * 100) : null };
    });

    const totals = {
      scheduled_hours: rows.reduce((s, r) => s + parseFloat(r.scheduled_hours || 0), 0).toFixed(1),
      clocked_hours:   rows.reduce((s, r) => s + parseFloat(r.clocked_hours || 0), 0).toFixed(1),
      payable_hours:   rows.reduce((s, r) => s + parseFloat(r.payable_hours || 0), 0).toFixed(1),
      missing_punches: rows.reduce((s, r) => s + parseInt(r.missing_punches || 0), 0),
      late_arrivals:   rows.reduce((s, r) => s + parseInt(r.late_arrivals || 0), 0),
      early_departures: rows.reduce((s, r) => s + parseInt(r.early_departures || 0), 0),
    };
    res.json({ analytics: rows, totals });
  } catch (error) {
    console.error('Payroll analytics error:', error);
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

    // Step 1: Approve SCHEDULED shifts that have a clock-in as proof of attendance.
    // payable_minutes is already = scheduled_minutes from generate-shifts (we pay scheduled, not clocked).
    // Unscheduled clock-ins (schedule_id IS NULL) are left as 'pending' — admin must resolve
    // manually since we don't pay work that wasn't on the schedule.
    let clockedQuery = `
      UPDATE payroll_shift_reviews SET
        status = 'approved',
        reviewed_by = $1,
        reviewed_at = NOW(),
        updated_at = NOW()
      WHERE pay_period_start = $2 AND pay_period_end = $3
        AND status IN ('verified', 'pending')
        AND time_entry_id IS NOT NULL
        AND schedule_id IS NOT NULL
    `;
    if (caregiverId) { params.push(caregiverId); clockedQuery += ` AND caregiver_id = $${params.length}`; }
    const clockedResult = await db.query(clockedQuery + ' RETURNING id', params);
    approvedClocked = clockedResult.rows.length;

    // Step 2: If mode is 'all', also approve missing punches (admin trusts caregiver was there).
    if (mode === 'all') {
      const schedParams = [req.user.id, startDate, endDate];
      let schedQuery = `
        UPDATE payroll_shift_reviews SET
          status = 'approved',
          resolution_notes = 'Bulk approved — no clock-in on record',
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
        COALESCE(u.default_pay_rate, u.hourly_rate, $3::numeric)   AS hourly_rate,

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

        -- Payable hours: only SCHEDULED shifts that were verified/approved.
        -- Unscheduled clock-ins don't count — per business rule, we only pay
        -- scheduled hours (caregivers must be on the schedule to be paid).
        COALESCE((
          SELECT ROUND(SUM(psr2.payable_minutes)::numeric / 60, 2)
          FROM payroll_shift_reviews psr2
          WHERE psr2.caregiver_id = u.id
            AND psr2.pay_period_start = $1 AND psr2.pay_period_end = $2
            AND psr2.status IN ('verified', 'approved', 'manual_entry')
            AND psr2.payable_minutes IS NOT NULL
            AND psr2.schedule_id IS NOT NULL
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

        -- Weekend hours (from approved SCHEDULED shifts only)
        COALESCE((
          SELECT ROUND(SUM(psr2.payable_minutes)::numeric / 60, 2)
          FROM payroll_shift_reviews psr2
          WHERE psr2.caregiver_id = u.id
            AND psr2.pay_period_start = $1 AND psr2.pay_period_end = $2
            AND psr2.status IN ('verified', 'approved', 'manual_entry')
            AND psr2.schedule_id IS NOT NULL
            AND EXTRACT(DOW FROM psr2.shift_date) IN (0, 6)
        ), 0)                                                      AS weekend_hours,

        -- Night hours (from approved SCHEDULED shifts only)
        COALESCE((
          SELECT ROUND(SUM(psr2.payable_minutes)::numeric / 60, 2)
          FROM payroll_shift_reviews psr2
          WHERE psr2.caregiver_id = u.id
            AND psr2.pay_period_start = $1 AND psr2.pay_period_end = $2
            AND psr2.status IN ('verified', 'approved', 'manual_entry')
            AND psr2.schedule_id IS NOT NULL
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

        -- PTO: prorate any approved PTO that OVERLAPS the period (not just
        -- PTO that fits entirely within it). A PTO entry spanning a period
        -- boundary previously fell through both periods and never got paid.
        -- We assume hours are spread evenly across the PTO's date range and
        -- charge only the portion of days that intersect this pay period.
        COALESCE((
          SELECT SUM(
            p.hours
              * (LEAST(p.end_date, $2::date) - GREATEST(p.start_date, $1::date) + 1)::numeric
              / NULLIF((p.end_date - p.start_date + 1)::numeric, 0)
          )
          FROM pto p
          WHERE p.caregiver_id = u.id
            AND p.status = 'approved' AND p.type != 'unpaid'
            AND p.start_date <= $2::date AND p.end_date >= $1::date
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
  const { caregiverId, date, miles, fromLocation, toLocation, notes, force } = req.body;
  if (!caregiverId || !date || miles == null) {
    return res.status(400).json({ error: 'caregiverId, date, and miles are required' });
  }
  try {
    // Duplicate detection: same caregiver + same date + same from/to + same
    // miles is almost always an accidental re-submit. Refuse unless force=true.
    const dup = await db.query(
      `SELECT id, miles, from_location, to_location, created_at
         FROM mileage
        WHERE caregiver_id = $1 AND date = $2
          AND COALESCE(from_location, '') = COALESCE($3, '')
          AND COALESCE(to_location, '')   = COALESCE($4, '')
          AND miles = $5
        LIMIT 1`,
      [caregiverId, date, fromLocation || null, toLocation || null, miles]
    );
    if (dup.rows.length > 0 && !force) {
      return res.status(409).json({
        error: 'Looks like a duplicate mileage entry',
        existing: dup.rows[0],
        hint: 'Resubmit with force=true if this really is a separate trip.',
      });
    }

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
        COALESCE(u.default_pay_rate, u.hourly_rate, $3::numeric) AS hourly_rate,
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

// ==================== CAREGIVER PAYDAY VERIFICATION ====================
// Caregivers log in and verify (or dispute) their prior pay-period hours.
// Pay cycle: Sun–Sat, paid the following Friday (period_end + 6 days).

// Helper: compute the most recent pay period whose pay date has passed.
// Returns { start: 'YYYY-MM-DD', end: 'YYYY-MM-DD', payDate: 'YYYY-MM-DD' }
// or null if no pay period is due yet.
function getCurrentPayPeriod(today = new Date()) {
  const d = new Date(today);
  d.setHours(0, 0, 0, 0);
  // DOW: 0=Sun ... 6=Sat. Last Saturday:
  const daysSinceSat = (d.getDay() + 1) % 7;
  const periodEnd = new Date(d);
  periodEnd.setDate(d.getDate() - daysSinceSat);
  const periodStart = new Date(periodEnd);
  periodStart.setDate(periodEnd.getDate() - 6);
  const payDate = new Date(periodEnd);
  payDate.setDate(periodEnd.getDate() + 6); // Friday after period end
  if (d < payDate) {
    // This week's period isn't due yet — fall back to the prior period
    periodEnd.setDate(periodEnd.getDate() - 7);
    periodStart.setDate(periodStart.getDate() - 7);
    payDate.setDate(payDate.getDate() - 7);
    if (d < payDate) return null;
  }
  const fmt = (dt) => dt.toISOString().split('T')[0];
  return { start: fmt(periodStart), end: fmt(periodEnd), payDate: fmt(payDate) };
}

// GET /api/payroll/caregiver/me/pending-verification
// Returns { pending: {...} } if the caregiver has an unverified pay period, else { pending: null }.
router.get('/caregiver/me/pending-verification', auth, async (req, res) => {
  try {
    // DISABLED (per request): the payday "confirm your hours" modal is persistent
    // until the caregiver confirms/disputes, and it was blocking people from
    // clocking in/out. Always return nothing-pending so the modal never appears.
    // The caregiver app is a frozen bundle that calls this endpoint, so disabling
    // it here is what actually removes the requirement on their phones. Payroll
    // calculation and the /verify endpoint are untouched; remove this early
    // return to re-enable the prompt.
    return res.json({ pending: null });

    if (req.user.role !== 'caregiver') return res.json({ pending: null });
    const period = getCurrentPayPeriod();
    if (!period) return res.json({ pending: null });

    const existing = await db.query(
      `SELECT verified_at, disputed_at FROM payroll_period_verifications
       WHERE caregiver_id = $1 AND pay_period_start = $2 AND pay_period_end = $3`,
      [req.user.id, period.start, period.end]
    );
    if (existing.rows.length > 0 && (existing.rows[0].verified_at || existing.rows[0].disputed_at)) {
      return res.json({ pending: null });
    }

    const shiftsResult = await db.query(`
      SELECT psr.id, psr.shift_date, psr.scheduled_start, psr.scheduled_end,
             psr.scheduled_minutes, psr.actual_start, psr.actual_end,
             psr.actual_minutes, psr.payable_minutes, psr.status,
             c.first_name AS client_first, c.last_name AS client_last
      FROM payroll_shift_reviews psr
      LEFT JOIN clients c ON psr.client_id = c.id
      WHERE psr.caregiver_id = $1
        AND psr.pay_period_start = $2 AND psr.pay_period_end = $3
        AND psr.status IN ('verified', 'approved', 'manual_entry')
        AND psr.schedule_id IS NOT NULL
      ORDER BY psr.shift_date, psr.scheduled_start
    `, [req.user.id, period.start, period.end]);

    if (shiftsResult.rows.length === 0) return res.json({ pending: null });

    const userResult = await db.query(
      `SELECT COALESCE(default_pay_rate, hourly_rate, $2::numeric) AS rate
       FROM users WHERE id = $1`,
      [req.user.id, parseFloat(process.env.DEFAULT_HOURLY_RATE) || 15]
    );
    const rate = parseFloat(userResult.rows[0].rate);
    const totalMinutes = shiftsResult.rows.reduce((s, r) => s + (parseInt(r.payable_minutes) || 0), 0);
    const totalHours = totalMinutes / 60;
    const grossPay = totalHours * rate;

    res.json({
      pending: {
        payPeriodStart: period.start,
        payPeriodEnd: period.end,
        payDate: period.payDate,
        shifts: shiftsResult.rows,
        totalHours: parseFloat(totalHours.toFixed(2)),
        hourlyRate: rate,
        grossPay: parseFloat(grossPay.toFixed(2))
      }
    });
  } catch (error) {
    console.error('Pending verification error:', error);
    res.status(500).json({ error: error.message });
  }
});

// POST /api/payroll/caregiver/me/verify
// Body: { payPeriodStart, payPeriodEnd, confirmed: bool, disputeReason?, reportedGrossPay?, reportedTotalHours? }
router.post('/caregiver/me/verify', auth, async (req, res) => {
  try {
    if (req.user.role !== 'caregiver') return res.status(403).json({ error: 'Caregivers only' });
    const { payPeriodStart, payPeriodEnd, confirmed, disputeReason, reportedGrossPay, reportedTotalHours } = req.body;
    if (!payPeriodStart || !payPeriodEnd) {
      return res.status(400).json({ error: 'payPeriodStart and payPeriodEnd are required' });
    }

    if (confirmed) {
      await db.query(`
        INSERT INTO payroll_period_verifications
          (caregiver_id, pay_period_start, pay_period_end, verified_at,
           reported_total_hours, reported_gross_pay)
        VALUES ($1, $2, $3, NOW(), $4, $5)
        ON CONFLICT (caregiver_id, pay_period_start, pay_period_end) DO UPDATE SET
          verified_at = NOW(), disputed_at = NULL, dispute_reason = NULL,
          reported_total_hours = EXCLUDED.reported_total_hours,
          reported_gross_pay = EXCLUDED.reported_gross_pay,
          updated_at = NOW()
      `, [req.user.id, payPeriodStart, payPeriodEnd, reportedTotalHours ?? null, reportedGrossPay ?? null]);
      return res.json({ success: true, status: 'verified' });
    }

    if (!disputeReason || !disputeReason.trim()) {
      return res.status(400).json({ error: 'disputeReason is required when disputing' });
    }

    await db.query(`
      INSERT INTO payroll_period_verifications
        (caregiver_id, pay_period_start, pay_period_end, disputed_at, dispute_reason,
         reported_total_hours, reported_gross_pay)
      VALUES ($1, $2, $3, NOW(), $4, $5, $6)
      ON CONFLICT (caregiver_id, pay_period_start, pay_period_end) DO UPDATE SET
        disputed_at = NOW(), dispute_reason = EXCLUDED.dispute_reason, verified_at = NULL,
        reported_total_hours = EXCLUDED.reported_total_hours,
        reported_gross_pay = EXCLUDED.reported_gross_pay,
        updated_at = NOW()
    `, [req.user.id, payPeriodStart, payPeriodEnd, disputeReason.trim(),
        reportedTotalHours ?? null, reportedGrossPay ?? null]);

    // Notify admins so they can investigate
    try {
      const userInfo = await db.query('SELECT first_name, last_name FROM users WHERE id = $1', [req.user.id]);
      const u = userInfo.rows[0];
      const caregiverName = u ? `${u.first_name} ${u.last_name}` : 'A caregiver';
      const admins = await db.query(`SELECT id FROM users WHERE role = 'admin' AND is_active = true`);
      for (const admin of admins.rows) {
        await db.query(
          `INSERT INTO notifications (id, user_id, type, title, message, status)
           VALUES ($1, $2, $3, $4, $5, 'new')`,
          [
            uuidv4(), admin.id, 'payroll_dispute',
            'Payroll Dispute Filed',
            `${caregiverName} disputed ${payPeriodStart} to ${payPeriodEnd}: "${disputeReason.trim()}"`
          ]
        );
      }
    } catch (e) {
      console.error('Failed to notify admins of payroll dispute:', e.message);
    }

    res.json({ success: true, status: 'disputed' });
  } catch (error) {
    console.error('Verify payroll error:', error);
    res.status(500).json({ error: error.message });
  }
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
