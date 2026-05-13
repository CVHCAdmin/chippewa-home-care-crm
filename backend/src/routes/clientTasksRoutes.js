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
  `);
  _bootstrapped = true;
};

// ──────────────────────────────────────────────────────────────────────────
// Template CRUD (admin)
// ──────────────────────────────────────────────────────────────────────────

// GET /api/clients/:clientId/care-tasks
// Used by both admin (manage) and caregiver (during shift). All authenticated users.
router.get('/clients/:clientId/care-tasks', verifyToken, async (req, res) => {
  try {
    await ensureTables();
    const result = await db.query(
      `SELECT id, client_id, task_name, description, category, allotted_minutes, sort_order, is_active, created_at, updated_at
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
    const { taskName, description, category, allottedMinutes, sortOrder } = req.body;
    if (!taskName || !taskName.trim()) return res.status(400).json({ error: 'taskName is required' });

    const nextOrder = sortOrder ?? (await db.query(
      `SELECT COALESCE(MAX(sort_order), -1) + 1 AS next FROM client_task_templates WHERE client_id = $1`,
      [req.params.clientId]
    )).rows[0].next;

    const result = await db.query(
      `INSERT INTO client_task_templates (client_id, task_name, description, category, allotted_minutes, sort_order, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
      [req.params.clientId, taskName.trim(), description || null, category || 'other', allottedMinutes || 0, nextOrder, req.user.id]
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
    const { taskName, description, category, allottedMinutes, sortOrder } = req.body;
    const result = await db.query(
      `UPDATE client_task_templates
       SET task_name = COALESCE($1, task_name),
           description = COALESCE($2, description),
           category = COALESCE($3, category),
           allotted_minutes = COALESCE($4, allotted_minutes),
           sort_order = COALESCE($5, sort_order),
           updated_at = NOW()
       WHERE id = $6 RETURNING *`,
      [taskName, description, category, allottedMinutes, sortOrder, req.params.id]
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
      `SELECT t.id AS task_id, t.task_name, t.description, t.category, t.allotted_minutes, t.sort_order,
              c.id AS completion_id, COALESCE(c.status, 'pending') AS status,
              c.notes, c.completed_at, c.updated_at
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
