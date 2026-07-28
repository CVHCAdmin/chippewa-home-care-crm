// routes/gustoRoutes.js
// Gusto payroll integration - export verified hours
// Gusto API key set via: GUSTO_API_KEY, GUSTO_COMPANY_ID

const express = require('express');
const router = express.Router();
const db = require('../db');
const auth = require('../middleware/auth');
const requireAdmin = require('../middleware/authorizeAdmin');
const { v4: uuidv4 } = require('uuid');

function getGustoConfig() {
  return {
    apiKey: process.env.GUSTO_API_KEY,
    companyId: process.env.GUSTO_COMPANY_ID,
    isConfigured: !!(process.env.GUSTO_API_KEY && process.env.GUSTO_COMPANY_ID),
    baseUrl: 'https://api.gusto.com/v1'
  };
}

async function gustoRequest(method, endpoint, body = null) {
  const cfg = getGustoConfig();
  if (!cfg.isConfigured) throw new Error('Gusto not configured. Set GUSTO_API_KEY and GUSTO_COMPANY_ID.');
  const options = {
    method,
    headers: { 'Authorization': `Token ${cfg.apiKey}`, 'Content-Type': 'application/json' }
  };
  if (body) options.body = JSON.stringify(body);
  const res = await fetch(`${cfg.baseUrl}${endpoint}`, options);
  return { ok: res.ok, status: res.status, data: await res.json() };
}

// ─── CONFIG STATUS ────────────────────────────────────────────────────────────
router.get('/config', auth, requireAdmin, async (req, res) => {
  const cfg = getGustoConfig();
  res.json({
    isConfigured: cfg.isConfigured,
    setupInstructions: cfg.isConfigured ? null : {
      step1: 'Sign up at gusto.com and create your company',
      step2: 'Go to Settings → Integrations → API → Create API Key',
      step3: 'Add to Render env vars: GUSTO_API_KEY and GUSTO_COMPANY_ID',
      note: 'Gusto starts at $40/mo + $6/employee/mo — worth it when you have 10+ caregivers'
    }
  });
});

// ─── GET EMPLOYEE MAPPING STATUS ─────────────────────────────────────────────
router.get('/employees', auth, requireAdmin, async (req, res) => {
  try {
    const result = await db.query(`
      SELECT u.id, u.first_name, u.last_name, u.email, u.phone,
        gem.gusto_employee_id, gem.gusto_uuid, gem.is_synced, gem.last_synced_at
      FROM users u
      LEFT JOIN gusto_employee_map gem ON gem.user_id = u.id
      WHERE u.role = 'caregiver' AND u.is_active = true
      ORDER BY u.last_name, u.first_name
    `);
    res.json(result.rows);
  } catch(error) { res.status(500).json({ error: error.message }); }
});

// ─── SYNC EMPLOYEES TO GUSTO ─────────────────────────────────────────────────
router.post('/sync-employees', auth, requireAdmin, async (req, res) => {
  const cfg = getGustoConfig();
  if (!cfg.isConfigured) return res.status(400).json({ error: 'Gusto not configured', setup: true });
  try {
    // Get Gusto employees
    const gustoEmployees = await gustoRequest('GET', `/companies/${cfg.companyId}/employees`);
    if (!gustoEmployees.ok) return res.status(400).json({ error: 'Could not fetch Gusto employees', details: gustoEmployees.data });

    const gusto = gustoEmployees.data || [];
    let matched = 0, unmatched = 0;

    for (const ge of gusto) {
      // Try to match by email first, then name
      const user = await db.query(`
        SELECT id FROM users WHERE LOWER(email)=LOWER($1) OR (LOWER(first_name)=LOWER($2) AND LOWER(last_name)=LOWER($3))
        LIMIT 1
      `, [ge.email||'', ge.first_name||'', ge.last_name||'']);

      if (user.rows.length) {
        await db.query(`
          INSERT INTO gusto_employee_map (id, user_id, gusto_employee_id, gusto_uuid, is_synced, last_synced_at)
          VALUES ($1,$2,$3,$4,true,NOW())
          ON CONFLICT (user_id) DO UPDATE SET gusto_employee_id=$3, gusto_uuid=$4, is_synced=true, last_synced_at=NOW()
        `, [uuidv4(), user.rows[0].id, ge.id, ge.uuid]);
        matched++;
      } else { unmatched++; }
    }

    await db.query(`INSERT INTO gusto_sync_log (id,sync_type,status,records_exported,created_by) VALUES ($1,'employees','success',$2,$3)`,
      [uuidv4(), matched, req.user.id]);

    res.json({ matched, unmatched, total: gusto.length });
  } catch(error) {
    await db.query(`INSERT INTO gusto_sync_log (id,sync_type,status,error_message,created_by) VALUES ($1,'employees','failed',$2,$3)`,
      [uuidv4(), error.message, req.user.id]);
    res.status(500).json({ error: error.message });
  }
});

// ─── PREVIEW PAYROLL EXPORT ───────────────────────────────────────────────────
// Hours come from APPROVED payroll shift reviews (payable_minutes) — the same
// number payroll actually pays. Roughly half the staff never clocks in, so the
// old raw-clock version missed most paid hours and priced everyone off an
// empty rates table. OT = payable over 40h per Sun–Sat week; rates from
// users.default_pay_rate; OT priced at 1.5x.
const GUSTO_WEEKLY_CTE = `weekly AS (
  SELECT psr.caregiver_id,
    (psr.shift_date - EXTRACT(DOW FROM psr.shift_date)::int) AS week_start,
    SUM(psr.payable_minutes) / 60.0 AS week_hours,
    COALESCE(SUM(psr.payable_minutes) FILTER (WHERE EXTRACT(DOW FROM psr.shift_date) IN (0, 6)), 0) / 60.0 AS weekend_hours,
    COUNT(*) AS shifts
  FROM payroll_shift_reviews psr
  WHERE psr.shift_date BETWEEN $1::date AND $2::date
    AND psr.status IN ('verified', 'approved', 'manual_entry')
    AND psr.payable_minutes > 0
  GROUP BY psr.caregiver_id, (psr.shift_date - EXTRACT(DOW FROM psr.shift_date)::int)
)`;

router.get('/preview', auth, requireAdmin, async (req, res) => {
  try {
    const { startDate, endDate } = req.query;
    if (!startDate || !endDate) return res.status(400).json({ error: 'startDate and endDate required' });

    const result = await db.query(`
      WITH ${GUSTO_WEEKLY_CTE}
      SELECT
        u.id, u.first_name, u.last_name, u.email,
        gem.gusto_employee_id, gem.is_synced as gusto_mapped,
        SUM(w.shifts) as shift_count,
        ROUND(SUM(w.week_hours)::numeric, 2) as total_hours,
        ROUND(SUM(LEAST(w.week_hours, 40))::numeric, 2) as regular_hours,
        ROUND(SUM(GREATEST(w.week_hours - 40, 0))::numeric, 2) as overtime_hours,
        ROUND(SUM(w.weekend_hours)::numeric, 2) as weekend_hours,
        COALESCE(u.default_pay_rate, 15) as hourly_rate,
        ROUND((SUM(LEAST(w.week_hours, 40)) * COALESCE(u.default_pay_rate, 15)
             + SUM(GREATEST(w.week_hours - 40, 0)) * COALESCE(u.default_pay_rate, 15) * 1.5)::numeric, 2) as gross_pay
      FROM weekly w
      JOIN users u ON u.id = w.caregiver_id
      LEFT JOIN gusto_employee_map gem ON gem.user_id = u.id
      GROUP BY u.id, u.first_name, u.last_name, u.email, u.default_pay_rate, gem.gusto_employee_id, gem.is_synced
      ORDER BY u.last_name, u.first_name
    `, [startDate, endDate]);

    // Warn about work in the period that is NOT in the export yet
    const warn = (await db.query(`
      SELECT
        (SELECT COUNT(*) FROM payroll_shift_reviews
          WHERE shift_date BETWEEN $1::date AND $2::date
            AND status IN ('pending', 'flagged', 'missing_punch')) AS unresolved_reviews,
        (SELECT COUNT(*) FROM time_entries te
          WHERE te.end_time IS NOT NULL
            AND te.start_time >= ($1::date)::timestamp AT TIME ZONE 'America/Chicago'
            AND te.start_time < ($2::date + 1)::timestamp AT TIME ZONE 'America/Chicago'
            AND NOT EXISTS (SELECT 1 FROM payroll_shift_reviews p2
                             WHERE p2.time_entry_id = te.id)) AS clock_entries_without_review
    `, [startDate, endDate])).rows[0];

    const totals = {
      employees: result.rows.length,
      totalHours: result.rows.reduce((s,r) => s + parseFloat(r.total_hours||0), 0).toFixed(2),
      totalGross: result.rows.reduce((s,r) => s + parseFloat(r.gross_pay||0), 0).toFixed(2),
      unmapped: result.rows.filter(r => !r.gusto_mapped).length
    };

    res.json({
      preview: result.rows, totals, period: { startDate, endDate },
      warnings: {
        unresolved_reviews: parseInt(warn.unresolved_reviews) || 0,
        clock_entries_without_review: parseInt(warn.clock_entries_without_review) || 0
      }
    });
  } catch(error) { res.status(500).json({ error: error.message }); }
});

// ─── EXPORT TO GUSTO ──────────────────────────────────────────────────────────
router.post('/export', auth, requireAdmin, async (req, res) => {
  // DISABLED until the Phase 2 API rebuild: this scaffold computes hours from
  // raw clock times (misses the staff who never clock in) and PUTs to a Gusto
  // endpoint that does not exist. Use the CSV export — it carries the real
  // approved payable hours. Do not remove this guard without rebuilding the
  // push against Gusto's current API and testing in their demo environment.
  return res.status(501).json({ error: 'Direct Gusto push is not ready — use the CSV export and upload it in Gusto.' });
  // eslint-disable-next-line no-unreachable
  const cfg = getGustoConfig();
  if (!cfg.isConfigured) return res.status(400).json({ error: 'Gusto not configured', setup: true });
  try {
    const { startDate, endDate, payPeriodId } = req.body;
    if (!startDate || !endDate) return res.status(400).json({ error: 'Date range required' });

    // Split hours into regular vs overtime PER WEEK (FLSA: anything over 40
     // hours in a workweek is overtime). Previous version totaled across the
     // whole period and dumped everything as regular_hours → Gusto paid
     // straight time on 45h weeks. Wage-and-hour exposure.
    const preview = await db.query(`
      WITH weekly AS (
        SELECT u.id AS caregiver_id, gem.gusto_employee_id,
          date_trunc('week', te.start_time) AS week_start,
          SUM(EXTRACT(EPOCH FROM (te.end_time - te.start_time))/3600) AS week_hours
        FROM users u
        JOIN time_entries te ON te.caregiver_id = u.id
        JOIN gusto_employee_map gem ON gem.user_id = u.id
        WHERE te.start_time >= $1::date AND te.start_time < $2::date + 1
          AND te.is_complete = true AND u.role = 'caregiver'
          AND gem.gusto_employee_id IS NOT NULL
        GROUP BY u.id, gem.gusto_employee_id, date_trunc('week', te.start_time)
      )
      SELECT caregiver_id, gusto_employee_id,
        ROUND(SUM(LEAST(week_hours, 40))::numeric, 2)        AS regular_hours,
        ROUND(SUM(GREATEST(week_hours - 40, 0))::numeric, 2) AS overtime_hours,
        ROUND(SUM(week_hours)::numeric, 2)                   AS total_hours
      FROM weekly
      GROUP BY caregiver_id, gusto_employee_id
    `, [startDate, endDate]);

    let exported = 0;
    const errors = [];

    for (const emp of preview.rows) {
      try {
        // Push time entries to Gusto pay schedule
        const payload = {
          employee_id: emp.gusto_employee_id,
          regular_hours: parseFloat(emp.regular_hours),
          overtime_hours: parseFloat(emp.overtime_hours),
          ...(payPeriodId ? { pay_period_id: payPeriodId } : {})
        };
        const result = await gustoRequest('PUT', `/companies/${cfg.companyId}/pay_schedules/unprocessed_termination_pay`, payload);
        if (result.ok) exported++;
        else errors.push(`${emp.gusto_employee_id}: ${result.data?.message || 'failed'}`);
      } catch(e) { errors.push(e.message); }
    }

    await db.query(`INSERT INTO gusto_sync_log (id,sync_type,status,pay_period_start,pay_period_end,records_exported,error_message,created_by) VALUES ($1,'time_entries',$2,$3,$4,$5,$6,$7)`,
      [uuidv4(), errors.length === 0 ? 'success' : exported > 0 ? 'partial' : 'failed', startDate, endDate, exported, errors.length > 0 ? errors.join('; ') : null, req.user.id]);

    res.json({ exported, skipped: preview.rows.length - exported, errors });
  } catch(error) { res.status(500).json({ error: error.message }); }
});

// ─── CSV EXPORT (upload into Gusto's hours import) ────────────────────────────
// Same payable-hours source as the preview: approved payroll shift reviews,
// OT split per Sun–Sat week. The old version summed raw clock times, which
// missed the staff who never clock in (two-thirds of paid hours).
router.get('/export-csv', auth, requireAdmin, async (req, res) => {
  try {
    const { startDate, endDate } = req.query;
    if (!startDate || !endDate) return res.status(400).json({ error: 'startDate and endDate required' });

    const result = await db.query(`
      WITH ${GUSTO_WEEKLY_CTE}
      SELECT u.first_name, u.last_name, u.email,
        ROUND(SUM(LEAST(w.week_hours, 40))::numeric, 2)        AS regular_hours,
        ROUND(SUM(GREATEST(w.week_hours - 40, 0))::numeric, 2) AS overtime_hours,
        ROUND(SUM(w.week_hours)::numeric, 2)                   AS total_hours
      FROM weekly w
      JOIN users u ON u.id = w.caregiver_id
      GROUP BY u.id, u.first_name, u.last_name, u.email
      ORDER BY u.last_name, u.first_name
    `, [startDate, endDate]);

    const q = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const lines = ['First Name,Last Name,Email,Regular Hours,Overtime Hours,Total Hours'];
    for (const r of result.rows) {
      lines.push([q(r.first_name), q(r.last_name), q(r.email), r.regular_hours, r.overtime_hours, r.total_hours].join(','));
    }

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="gusto-hours-${startDate}-to-${endDate}.csv"`);
    res.send(lines.join('\n'));
  } catch(error) { res.status(500).json({ error: error.message }); }
});

router.get('/sync-log', auth, requireAdmin, async (req, res) => {
  try {
    const result = await db.query(`SELECT * FROM gusto_sync_log ORDER BY created_at DESC LIMIT 20`);
    res.json(result.rows);
  } catch(error) { res.status(500).json({ error: error.message }); }
});

module.exports = router;
