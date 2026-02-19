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
router.get('/preview', auth, requireAdmin, async (req, res) => {
  try {
    const { startDate, endDate } = req.query;
    if (!startDate || !endDate) return res.status(400).json({ error: 'startDate and endDate required' });

    const result = await db.query(`
      SELECT
        u.id, u.first_name, u.last_name, u.email,
        gem.gusto_employee_id, gem.is_synced as gusto_mapped,
        COUNT(te.id) as shift_count,
        ROUND(SUM(EXTRACT(EPOCH FROM (te.end_time - te.start_time))/3600)::numeric, 2) as total_hours,
        ROUND(SUM(CASE WHEN EXTRACT(DOW FROM te.start_time) IN (0,6) THEN EXTRACT(EPOCH FROM (te.end_time - te.start_time))/3600 ELSE 0 END)::numeric, 2) as weekend_hours,
        cp.pay_rate as hourly_rate,
        ROUND(SUM(EXTRACT(EPOCH FROM (te.end_time - te.start_time))/3600)::numeric * COALESCE(cp.pay_rate, 0), 2) as gross_pay
      FROM users u
      JOIN time_entries te ON te.caregiver_id = u.id
      LEFT JOIN gusto_employee_map gem ON gem.user_id = u.id
      LEFT JOIN (
        SELECT DISTINCT ON (caregiver_id) caregiver_id, pay_rate
        FROM caregiver_pay_rates ORDER BY caregiver_id, effective_date DESC
      ) cp ON cp.caregiver_id = u.id
      WHERE te.start_time >= $1::date AND te.start_time < $2::date + 1
        AND te.is_complete = true
        AND u.role = 'caregiver'
      GROUP BY u.id, u.first_name, u.last_name, u.email, gem.gusto_employee_id, gem.is_synced, cp.pay_rate
      ORDER BY u.last_name, u.first_name
    `, [startDate, endDate]);

    const totals = {
      employees: result.rows.length,
      totalHours: result.rows.reduce((s,r) => s + parseFloat(r.total_hours||0), 0).toFixed(2),
      totalGross: result.rows.reduce((s,r) => s + parseFloat(r.gross_pay||0), 0).toFixed(2),
      unmapped: result.rows.filter(r => !r.gusto_mapped).length
    };

    res.json({ preview: result.rows, totals, period: { startDate, endDate } });
  } catch(error) { res.status(500).json({ error: error.message }); }
});

// ─── EXPORT TO GUSTO ──────────────────────────────────────────────────────────
router.post('/export', auth, requireAdmin, async (req, res) => {
  const cfg = getGustoConfig();
  if (!cfg.isConfigured) return res.status(400).json({ error: 'Gusto not configured', setup: true });
  try {
    const { startDate, endDate, payPeriodId } = req.body;
    if (!startDate || !endDate) return res.status(400).json({ error: 'Date range required' });

    const preview = await db.query(`
      SELECT u.id, gem.gusto_employee_id,
        ROUND(SUM(EXTRACT(EPOCH FROM (te.end_time - te.start_time))/3600)::numeric, 2) as total_hours
      FROM users u
      JOIN time_entries te ON te.caregiver_id = u.id
      JOIN gusto_employee_map gem ON gem.user_id = u.id
      WHERE te.start_time >= $1::date AND te.start_time < $2::date + 1
        AND te.is_complete = true AND u.role = 'caregiver'
        AND gem.gusto_employee_id IS NOT NULL
      GROUP BY u.id, gem.gusto_employee_id
    `, [startDate, endDate]);

    let exported = 0;
    const errors = [];

    for (const emp of preview.rows) {
      try {
        // Push time entries to Gusto pay schedule
        const payload = {
          employee_id: emp.gusto_employee_id,
          regular_hours: parseFloat(emp.total_hours),
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

// ─── CSV EXPORT (fallback if Gusto not configured) ────────────────────────────
router.get('/export-csv', auth, requireAdmin, async (req, res) => {
  try {
    const { startDate, endDate } = req.query;
    const result = await db.query(`
      SELECT u.first_name, u.last_name, u.email,
        ROUND(SUM(EXTRACT(EPOCH FROM (te.end_time - te.start_time))/3600)::numeric, 2) as regular_hours,
        ROUND(SUM(CASE WHEN EXTRACT(EPOCH FROM (te.end_time - te.start_time))/3600 > 40 THEN EXTRACT(EPOCH FROM (te.end_time - te.start_time))/3600 - 40 ELSE 0 END)::numeric, 2) as overtime_hours
      FROM users u JOIN time_entries te ON te.caregiver_id = u.id
      WHERE te.start_time >= $1::date AND te.start_time < $2::date + 1
        AND te.is_complete = true AND u.role = 'caregiver'
      GROUP BY u.id, u.first_name, u.last_name, u.email ORDER BY u.last_name
    `, [startDate || new Date().toISOString().split('T')[0], endDate || new Date().toISOString().split('T')[0]]);

    const lines = ['First Name,Last Name,Email,Regular Hours,Overtime Hours'];
    for (const r of result.rows) {
      lines.push(`${r.first_name},${r.last_name},${r.email},${r.regular_hours},${r.overtime_hours}`);
    }

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="payroll-${startDate}-${endDate}.csv"`);
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
