// routes/clientTasksRoutes.js
// Per-client recurring care task templates + per-shift completion logs.
// Mounted at /api (the paths below carry their own scope).

const express = require('express');
const router = express.Router();
const db = require('../db');
const { verifyToken, requireAdmin, auditLog } = require('../middleware/shared');

// Lazy bootstrap — ensures the tables exist on first request (idempotent).
let _bootstrapped = false;
const ensureTables = async () => {
  if (_bootstrapped) return;
  await db.query(`
    CREATE TABLE IF NOT EXISTS client_task_templates (
      id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      client_id UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
      task_name VARCHAR(200) NOT NULL,
      description TEXT,
      category VARCHAR(50) DEFAULT 'other' CHECK (category IN ('adl','iadl','medication','companion','safety','other')),
      allotted_minutes INTEGER DEFAULT 0,
      sort_order INTEGER DEFAULT 0,
      is_active BOOLEAN DEFAULT true,
      created_by UUID REFERENCES users(id),
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_client_tasks_client ON client_task_templates(client_id, is_active);

    CREATE TABLE IF NOT EXISTS shift_task_completions (
      id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      time_entry_id UUID NOT NULL REFERENCES time_entries(id) ON DELETE CASCADE,
      task_template_id UUID NOT NULL REFERENCES client_task_templates(id) ON DELETE CASCADE,
      status VARCHAR(20) DEFAULT 'pending' CHECK (status IN ('pending','completed','skipped','refused')),
      notes TEXT,
      completed_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE (time_entry_id, task_template_id)
    );
    CREATE INDEX IF NOT EXISTS idx_shift_tasks_entry ON shift_task_completions(time_entry_id);

    -- v35: weekly-assessment fields (MIDAS SHC Homemaking import).
    ALTER TABLE client_task_templates ADD COLUMN IF NOT EXISTS weekly_frequency INTEGER DEFAULT 1;
    ALTER TABLE client_task_templates ADD COLUMN IF NOT EXISTS days_of_week TEXT;
    ALTER TABLE client_task_templates ADD COLUMN IF NOT EXISTS time_of_day VARCHAR(10) DEFAULT 'any';
    ALTER TABLE client_task_templates ADD COLUMN IF NOT EXISTS assessment_source VARCHAR(60);

    -- cadence: 'daily' (do every shift) vs 'weekly' (do once per week). Drives
    -- how the caregiver checklist groups tasks and whether a weekly task counts
    -- as already done for the current week. Existing rows default to 'daily'.
    ALTER TABLE client_task_templates ADD COLUMN IF NOT EXISTS cadence VARCHAR(10) DEFAULT 'daily';
  `);
  _bootstrapped = true;
};

// Coerce/clamp a frequency value to a positive integer (defaults to 1).
const normFreq = (v) => {
  const n = parseInt(v, 10);
  return Number.isFinite(n) && n > 0 ? n : 1;
};
const normTimeOfDay = (v) => (['AM', 'PM', 'any'].includes(v) ? v : 'any');
const normCadence = (v) => (v === 'weekly' ? 'weekly' : 'daily');

// ──────────────────────────────────────────────────────────────────────────
// Template CRUD (admin)
// ──────────────────────────────────────────────────────────────────────────

// GET /api/clients/:clientId/care-tasks
// Used by both admin (manage) and caregiver (during shift). All authenticated users.
router.get('/clients/:clientId/care-tasks', verifyToken, async (req, res) => {
  try {
    await ensureTables();
    const result = await db.query(
      `SELECT id, client_id, task_name, description, category, allotted_minutes,
              weekly_frequency, days_of_week, time_of_day, assessment_source, cadence,
              (COALESCE(weekly_frequency, 1) * COALESCE(allotted_minutes, 0)) AS minutes_per_week,
              sort_order, is_active, created_at, updated_at
       FROM client_task_templates
       WHERE client_id = $1 AND is_active = true
       ORDER BY sort_order, created_at`,
      [req.params.clientId]
    );
    res.json(result.rows);
  } catch (error) {
    console.error('Get care tasks error:', error);
    res.status(500).json({ error: error.message });
  }
});

// POST /api/clients/:clientId/care-tasks
router.post('/clients/:clientId/care-tasks', verifyToken, requireAdmin, async (req, res) => {
  try {
    await ensureTables();
    const { taskName, description, category, allottedMinutes, sortOrder,
            weeklyFrequency, daysOfWeek, timeOfDay, assessmentSource, cadence } = req.body;
    if (!taskName || !taskName.trim()) return res.status(400).json({ error: 'taskName is required' });

    const nextOrder = sortOrder ?? (await db.query(
      `SELECT COALESCE(MAX(sort_order), -1) + 1 AS next FROM client_task_templates WHERE client_id = $1`,
      [req.params.clientId]
    )).rows[0].next;

    const result = await db.query(
      `INSERT INTO client_task_templates
         (client_id, task_name, description, category, allotted_minutes,
          weekly_frequency, days_of_week, time_of_day, assessment_source, cadence, sort_order, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12) RETURNING *`,
      [req.params.clientId, taskName.trim(), description || null, category || 'other', allottedMinutes || 0,
       normFreq(weeklyFrequency), daysOfWeek || null, normTimeOfDay(timeOfDay), assessmentSource || null,
       normCadence(cadence), nextOrder, req.user.id]
    );
    await auditLog(req.user.id, 'CREATE', 'client_task_templates', result.rows[0].id, null, result.rows[0]);
    res.json(result.rows[0]);
  } catch (error) {
    console.error('Create care task error:', error);
    res.status(500).json({ error: error.message });
  }
});

// PUT /api/care-tasks/:id
router.put('/care-tasks/:id', verifyToken, requireAdmin, async (req, res) => {
  try {
    const { taskName, description, category, allottedMinutes, sortOrder,
            weeklyFrequency, daysOfWeek, timeOfDay, cadence } = req.body;
    const result = await db.query(
      `UPDATE client_task_templates
       SET task_name = COALESCE($1, task_name),
           description = COALESCE($2, description),
           category = COALESCE($3, category),
           allotted_minutes = COALESCE($4, allotted_minutes),
           sort_order = COALESCE($5, sort_order),
           weekly_frequency = COALESCE($7, weekly_frequency),
           days_of_week = COALESCE($8, days_of_week),
           time_of_day = COALESCE($9, time_of_day),
           cadence = COALESCE($10, cadence),
           updated_at = NOW()
       WHERE id = $6 RETURNING *`,
      [taskName, description, category, allottedMinutes, sortOrder, req.params.id,
       weeklyFrequency != null ? normFreq(weeklyFrequency) : null,
       daysOfWeek ?? null,
       timeOfDay ? normTimeOfDay(timeOfDay) : null,
       cadence ? normCadence(cadence) : null]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Task not found' });
    await auditLog(req.user.id, 'UPDATE', 'client_task_templates', req.params.id, null, result.rows[0]);
    res.json(result.rows[0]);
  } catch (error) {
    console.error('Update care task error:', error);
    res.status(500).json({ error: error.message });
  }
});

// DELETE /api/care-tasks/:id (soft delete)
router.delete('/care-tasks/:id', verifyToken, requireAdmin, async (req, res) => {
  try {
    const result = await db.query(
      `UPDATE client_task_templates SET is_active = false, updated_at = NOW() WHERE id = $1 RETURNING id, client_id`,
      [req.params.id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Task not found' });
    await auditLog(req.user.id, 'DELETE', 'client_task_templates', req.params.id, null, { soft_deleted: true });
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/clients/:clientId/care-tasks/import
// Bulk-create care tasks from a parsed MIDAS SHC Homemaking assessment.
// Body: {
//   tasks: [{ taskName, category, allottedMinutes, weeklyFrequency,
//             daysOfWeek, timeOfDay, description }],
//   replaceExisting: bool,                 // soft-delete current active tasks first
//   source: 'midas_shc_homemaking',
//   assessmentTotals: { minsPerWeek }      // optional — used for reconciliation
// }
// Returns a reconciliation block so a misread assessment is caught before it
// drives a caregiver's checklist.
router.post('/clients/:clientId/care-tasks/import', verifyToken, requireAdmin, async (req, res) => {
  const client = await db.pool.connect();
  try {
    await ensureTables();
    const { tasks, replaceExisting, source, assessmentTotals } = req.body;
    if (!Array.isArray(tasks) || tasks.length === 0) {
      return res.status(400).json({ error: 'tasks must be a non-empty array' });
    }

    // Validate every row up front — all-or-nothing.
    const clean = [];
    for (let i = 0; i < tasks.length; i++) {
      const t = tasks[i] || {};
      if (!t.taskName || !String(t.taskName).trim()) {
        return res.status(400).json({ error: `Row ${i + 1}: taskName is required` });
      }
      const category = ['adl', 'iadl', 'medication', 'companion', 'safety', 'other']
        .includes(t.category) ? t.category : 'iadl';
      clean.push({
        taskName: String(t.taskName).trim(),
        description: t.description ? String(t.description).trim() : null,
        category,
        allottedMinutes: Math.max(0, parseInt(t.allottedMinutes, 10) || 0),
        weeklyFrequency: normFreq(t.weeklyFrequency),
        daysOfWeek: t.daysOfWeek ? String(t.daysOfWeek).trim() : null,
        timeOfDay: normTimeOfDay(t.timeOfDay),
      });
    }

    const computedMinsPerWeek = clean.reduce(
      (sum, t) => sum + t.weeklyFrequency * t.allottedMinutes, 0);
    const expectedMinsPerWeek = assessmentTotals && Number.isFinite(+assessmentTotals.minsPerWeek)
      ? +assessmentTotals.minsPerWeek : null;
    const reconciliation = {
      computedMinsPerWeek,
      expectedMinsPerWeek,
      match: expectedMinsPerWeek == null ? null : computedMinsPerWeek === expectedMinsPerWeek,
      computedUnitsPerWeek: +(computedMinsPerWeek / 15).toFixed(2),
    };

    await client.query('BEGIN');

    if (replaceExisting) {
      await client.query(
        `UPDATE client_task_templates SET is_active = false, updated_at = NOW()
         WHERE client_id = $1 AND is_active = true`,
        [req.params.clientId]
      );
    }

    const baseOrder = (await client.query(
      `SELECT COALESCE(MAX(sort_order), -1) + 1 AS next FROM client_task_templates WHERE client_id = $1`,
      [req.params.clientId]
    )).rows[0].next;

    const inserted = [];
    for (let i = 0; i < clean.length; i++) {
      const t = clean[i];
      const r = await client.query(
        `INSERT INTO client_task_templates
           (client_id, task_name, description, category, allotted_minutes,
            weekly_frequency, days_of_week, time_of_day, assessment_source, sort_order, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING id`,
        [req.params.clientId, t.taskName, t.description, t.category, t.allottedMinutes,
         t.weeklyFrequency, t.daysOfWeek, t.timeOfDay, source || 'midas_import',
         baseOrder + i, req.user.id]
      );
      inserted.push(r.rows[0].id);
    }

    await client.query('COMMIT');
    await auditLog(req.user.id, 'IMPORT', 'client_task_templates', null, null,
      { clientId: req.params.clientId, count: inserted.length, replaceExisting: !!replaceExisting, source, reconciliation });

    res.json({ success: true, imported: inserted.length, replacedExisting: !!replaceExisting, reconciliation });
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('Import care tasks error:', error);
    res.status(500).json({ error: error.message });
  } finally {
    client.release();
  }
});

// GET /api/clients/:clientId/care-tasks/adherence?days=30
// Admin report: per active task, how often it got done vs skipped/refused vs
// not addressed over the window — so admins can see what isn't getting done.
router.get('/clients/:clientId/care-tasks/adherence', verifyToken, requireAdmin, async (req, res) => {
  try {
    await ensureTables();
    const days = Math.min(Math.max(parseInt(req.query.days, 10) || 30, 1), 180);
    const clientId = req.params.clientId;

    // Denominator for daily tasks: how many shifts this client had in the window.
    const shiftsRow = await db.query(
      `SELECT COUNT(*)::int AS n FROM time_entries
        WHERE client_id = $1 AND start_time >= NOW() - ($2 || ' days')::interval`,
      [clientId, String(days)]
    );
    const totalShifts = shiftsRow.rows[0].n;

    const inWindow = `te.start_time >= NOW() - ($2 || ' days')::interval`;
    const result = await db.query(
      `SELECT t.id AS task_id, t.task_name, t.category, t.cadence,
              COUNT(*) FILTER (WHERE sc.status = 'completed' AND ${inWindow})::int AS completed,
              COUNT(*) FILTER (WHERE sc.status = 'skipped'   AND ${inWindow})::int AS skipped,
              COUNT(*) FILTER (WHERE sc.status = 'refused'   AND ${inWindow})::int AS refused,
              MAX(sc.completed_at) FILTER (WHERE ${inWindow}) AS last_completed
       FROM client_task_templates t
       LEFT JOIN shift_task_completions sc ON sc.task_template_id = t.id
       LEFT JOIN time_entries te ON te.id = sc.time_entry_id
       WHERE t.client_id = $1 AND t.is_active = true
       GROUP BY t.id, t.task_name, t.category, t.cadence, t.sort_order
       ORDER BY t.sort_order, t.task_name`,
      [clientId, String(days)]
    );
    res.json({ days, totalShifts, tasks: result.rows });
  } catch (error) {
    console.error('Care task adherence error:', error);
    res.status(500).json({ error: error.message });
  }
});

// ──────────────────────────────────────────────────────────────────────────
// Per-shift completion (caregiver during active shift)
// ──────────────────────────────────────────────────────────────────────────

// GET /api/time-entries/:timeEntryId/task-completions
// Returns the merged list: each active client task + its completion status
// (if any) for THIS time entry.
router.get('/time-entries/:timeEntryId/task-completions', verifyToken, async (req, res) => {
  try {
    await ensureTables();
    const entry = await db.query('SELECT client_id FROM time_entries WHERE id = $1', [req.params.timeEntryId]);
    if (entry.rows.length === 0) return res.status(404).json({ error: 'Time entry not found' });
    const clientId = entry.rows[0].client_id;

    const result = await db.query(
      `SELECT t.id AS task_id, t.task_name, t.description, t.category, t.allotted_minutes,
              t.weekly_frequency, t.days_of_week, t.time_of_day, t.sort_order, t.cadence,
              c.id AS completion_id, COALESCE(c.status, 'pending') AS status,
              c.notes, c.completed_at, c.updated_at,
              EXISTS (
                SELECT 1 FROM shift_task_completions sc2
                JOIN time_entries te2 ON te2.id = sc2.time_entry_id
                WHERE sc2.task_template_id = t.id
                  AND sc2.status = 'completed'
                  AND te2.start_time >= date_trunc('week', NOW())
              ) AS done_this_week
       FROM client_task_templates t
       LEFT JOIN shift_task_completions c
         ON c.task_template_id = t.id AND c.time_entry_id = $1
       WHERE t.client_id = $2 AND t.is_active = true
       ORDER BY t.sort_order, t.created_at`,
      [req.params.timeEntryId, clientId]
    );
    res.json(result.rows);
  } catch (error) {
    console.error('Get task completions error:', error);
    res.status(500).json({ error: error.message });
  }
});

// PUT /api/time-entries/:timeEntryId/task-completions/:taskId
// Body: { status, notes }
// Upserts the completion record for this task on this shift.
router.put('/time-entries/:timeEntryId/task-completions/:taskId', verifyToken, async (req, res) => {
  try {
    await ensureTables();
    const { status, notes } = req.body;
    if (!['pending', 'completed', 'skipped', 'refused'].includes(status)) {
      return res.status(400).json({ error: 'Invalid status' });
    }

    // Confirm the caller is the assigned caregiver for this entry (or an admin).
    const entry = await db.query('SELECT caregiver_id FROM time_entries WHERE id = $1', [req.params.timeEntryId]);
    if (entry.rows.length === 0) return res.status(404).json({ error: 'Time entry not found' });
    if (entry.rows[0].caregiver_id !== req.user.id && req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Not your shift' });
    }

    const completedAt = status === 'completed' ? 'NOW()' : 'NULL';
    const result = await db.query(
      `INSERT INTO shift_task_completions (time_entry_id, task_template_id, status, notes, completed_at)
       VALUES ($1, $2, $3, $4, ${completedAt})
       ON CONFLICT (time_entry_id, task_template_id) DO UPDATE
         SET status = EXCLUDED.status,
             notes = EXCLUDED.notes,
             completed_at = ${completedAt},
             updated_at = NOW()
       RETURNING *`,
      [req.params.timeEntryId, req.params.taskId, status, notes || null]
    );
    res.json(result.rows[0]);
  } catch (error) {
    console.error('Update task completion error:', error);
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
