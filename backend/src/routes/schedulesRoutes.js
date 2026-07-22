// routes/schedulesRoutes.js
// Schedule Management Routes

const express = require('express');
const router = express.Router();
const db = require('../db');
const { v4: uuidv4 } = require('uuid');
const { shiftHours } = require('../helpers/shiftHours');

// Shared auth middleware — includes server-side logout (token revocation)
const { verifyToken } = require('../middleware/shared');

const requireAdmin = (req, res, next) => {
  if (req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Admin access required' });
  }
  next();
};

// Audit logging helper
const auditLog = async (userId, action, tableName, recordId, oldData, newData) => {
  try {
    if (recordId && typeof recordId === 'string' && !recordId.match(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i)) {
      return;
    }
    await db.query(
      `INSERT INTO audit_logs (user_id, action, table_name, record_id, old_data, new_data, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, NOW())`,
      [userId || '00000000-0000-0000-0000-000000000000', action, tableName, recordId, JSON.stringify(oldData), JSON.stringify(newData)]
    );
  } catch (error) {
    console.error('Audit log error:', error.message);
  }
};

// ==================== SCHEDULES ROUTES ====================

// GET /api/schedules/caregiver/:caregiverId - alias used by SchedulingHub
// NOTE: Must be registered BEFORE /:caregiverId to avoid being shadowed
// Attach each recurring pattern's per-date exceptions so the client expanding it can tell
// that an occurrence was cancelled or rescheduled. Without this the consumer only sees the
// pattern and has no way to know a given day is different.
async function attachExceptions(rows) {
  const recurringIds = rows
    .filter(s => s.day_of_week !== null && s.day_of_week !== undefined)
    .map(s => s.id);
  if (recurringIds.length === 0) return rows.map(s => ({ ...s, exceptions: [] }));
  let exceptions = [];
  try {
    const r = await db.query(
      `SELECT * FROM schedule_exceptions WHERE schedule_id = ANY($1) ORDER BY exception_date`,
      [recurringIds]
    );
    exceptions = r.rows;
  } catch (e) {
    if (!e.message.includes('does not exist')) throw e;
  }
  const byId = {};
  exceptions.forEach(ex => { (byId[ex.schedule_id] ||= []).push(ex); });
  return rows.map(s => ({ ...s, exceptions: byId[s.id] || [] }));
}

router.get('/caregiver/:caregiverId', verifyToken, async (req, res) => {
  try {
    const result = await db.query(`
      SELECT s.*,
        c.first_name as client_first_name, c.last_name as client_last_name
      FROM schedules s
      JOIN clients c ON s.client_id = c.id
      WHERE s.caregiver_id = $1 AND s.is_active = true
        AND (s.day_of_week IS NULL OR s.end_date IS NULL
             OR s.end_date >= (now() AT TIME ZONE 'America/Chicago')::date)
      ORDER BY s.day_of_week, s.date, s.start_time
    `, [req.params.caregiverId]);
    res.json(await attachExceptions(result.rows));
  } catch (error) { res.status(500).json({ error: error.message }); }
});

// GET /api/schedules/:caregiverId - Get schedules for a specific caregiver (caregiver dashboard)
router.get('/:caregiverId', verifyToken, async (req, res) => {
  try {
    // Caregivers can only view their own schedules; admins can view any
    if (req.user.role !== 'admin' && req.user.id !== req.params.caregiverId) {
      return res.status(403).json({ error: 'You can only view your own schedules' });
    }
    const result = await db.query(`
      SELECT s.*,
        c.first_name as client_first_name, c.last_name as client_last_name,
        c.address as client_address, c.city as client_city,
        ct.name as care_type_name
      FROM schedules s
      JOIN clients c ON s.client_id = c.id
      LEFT JOIN care_types ct ON c.care_type_id = ct.id
      WHERE s.caregiver_id = $1 AND s.is_active = true
        AND (s.day_of_week IS NULL OR s.end_date IS NULL
             OR s.end_date >= (now() AT TIME ZONE 'America/Chicago')::date)
      ORDER BY s.day_of_week, s.date, s.start_time
    `, [req.params.caregiverId]);
    // This feeds the caregiver's phone, which expands the pattern client-side. It used to
    // return the pattern with NO exceptions attached, so the app could not know a visit had
    // been cancelled or rescheduled: a cancelled shift still showed on "My Schedule", a
    // rescheduled one showed its OLD time, and — worst — the geofence auto-clock-in
    // (CaregiverDashboard "hasScheduledShiftNow") would clock somebody in to a visit the
    // office had cancelled, creating a real time entry that flowed into pay and billing.
    res.json(await attachExceptions(result.rows));
  } catch (error) { res.status(500).json({ error: error.message }); }
});

// POST /api/schedules - Create new schedule
router.post('/', verifyToken, async (req, res) => {
  try {
    const { caregiverId, clientId, scheduleType, dayOfWeek, date, startTime, endTime, notes, effectiveDate, isTraining } = req.body;

    // Authorization enforcement — skip for training shifts (not billed, so
    // they don't consume the client's authorization balance).
    const { checkAuthorizationBalance } = require('../helpers/authorizationCheck');
    const hours = shiftHours(startTime, endTime);
    let authCheck = { allowed: true, warnings: [] };
    if (!isTraining) {
      authCheck = await checkAuthorizationBalance(clientId, hours);
      if (!authCheck.allowed && req.query.force !== 'true') {
        return res.status(400).json({ error: authCheck.error, authorization: authCheck.authorization, type: 'authorization' });
      }
    }

    // Recurring schedules MUST have an effective_date — otherwise expansion
    // walks backwards and back-bills/back-pays. Default to today, clamp any
    // past date forward to today. (DB trigger in v36 also enforces this.)
    const isRecurring = dayOfWeek !== null && dayOfWeek !== undefined && dayOfWeek !== '';
    let effDate = null;
    if (isRecurring) {
      const today = new Date().toISOString().slice(0, 10);
      effDate = (effectiveDate && effectiveDate >= today) ? effectiveDate : today;
    }

    // One-time duplicate guard: the v53 unique index only covers recurring rows
    // (day_of_week IS NOT NULL), so a double-submit or retried request could insert
    // an identical one-time shift twice — each occurrence bills. Return the existing
    // row instead, same shape as the idempotent clock-in.
    if (!isRecurring && date) {
      const existing = await db.query(
        `SELECT * FROM schedules
          WHERE is_active=true AND day_of_week IS NULL
            AND caregiver_id=$1 AND client_id=$2 AND date=$3::date
            AND start_time=$4 AND end_time=$5
          LIMIT 1`,
        [caregiverId, clientId, date, startTime, endTime]);
      if (existing.rows.length > 0) {
        return res.status(200).json({ ...existing.rows[0], duplicate: true, authWarnings: authCheck.warnings });
      }
    }

    const scheduleId = uuidv4();
    const result = await db.query(
      `INSERT INTO schedules (id, caregiver_id, client_id, schedule_type, day_of_week, date, start_time, end_time, notes, effective_date, is_training)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
       RETURNING *`,
      [scheduleId, caregiverId, clientId, scheduleType, isRecurring ? dayOfWeek : null, date || null, startTime, endTime, notes || null, effDate, !!isTraining]
    );

    await auditLog(req.user.id, 'CREATE', 'schedules', scheduleId, null, result.rows[0]);
    res.status(201).json({ ...result.rows[0], authWarnings: authCheck.warnings });
  } catch (error) {
    if (error.code === '23505') {
      return res.status(409).json({ error: 'This caregiver already has this exact shift (same client, day, and time).', duplicate: true });
    }
    res.status(500).json({ error: error.message });
  }
});

// PUT /api/schedules/:id/reassign - Admin reassigns schedule to different caregiver
router.put('/:id/reassign', verifyToken, requireAdmin, async (req, res) => {
  const { newCaregiverId, reason } = req.body;
  const scheduleId = req.params.id;

  try {
    // Validate inputs
    if (!newCaregiverId) {
      return res.status(400).json({ error: 'newCaregiverId is required' });
    }

    // Get current schedule for audit log
    const current = await db.query('SELECT * FROM schedules WHERE id = $1', [scheduleId]);
    if (current.rows.length === 0) {
      return res.status(404).json({ error: 'Schedule not found' });
    }

    const oldData = current.rows[0];

    // Verify the new caregiver exists and is active
    const caregiver = await db.query(
      `SELECT id, first_name, last_name FROM users WHERE id = $1 AND role = 'caregiver' AND is_active = true`,
      [newCaregiverId]
    );
    if (caregiver.rows.length === 0) {
      return res.status(404).json({ error: 'Caregiver not found or inactive' });
    }

    // Check for scheduling conflicts with the new caregiver
    const schedule = oldData;
    if (schedule.date) {
      const conflicts = await db.query(`
        SELECT id FROM schedules 
        WHERE caregiver_id = $1 
          AND is_active = true
          AND id != $2
          AND date = $3
          AND NOT (end_time <= $4 OR start_time >= $5)
      `, [newCaregiverId, scheduleId, schedule.date, schedule.start_time, schedule.end_time]);

      if (conflicts.rows.length > 0) {
        return res.status(400).json({ 
          error: `${caregiver.rows[0].first_name} ${caregiver.rows[0].last_name} has a conflicting schedule at this time` 
        });
      }
    }

    // Update the schedule
    const result = await db.query(`
      UPDATE schedules 
      SET caregiver_id = $1, updated_at = NOW()
      WHERE id = $2
      RETURNING *
    `, [newCaregiverId, scheduleId]);

    // Audit log the change with reason code
    await auditLog(req.user.id, 'UPDATE', 'schedules', scheduleId, oldData, result.rows[0], reason || null);

    console.log(`Schedule ${scheduleId} reassigned from caregiver ${oldData.caregiver_id} to ${newCaregiverId} by admin ${req.user.id}`);

    res.json({ 
      success: true, 
      schedule: result.rows[0],
      message: `Schedule reassigned to ${caregiver.rows[0].first_name} ${caregiver.rows[0].last_name}`
    });
  } catch (error) {
    console.error('Reassignment failed:', error);
    res.status(500).json({ error: error.message });
  }
});

// NOTE: GET /api/schedules-all and PUT /api/schedules-all/:id are handled
// directly in server.js — do not add them here (Express router path boundaries
// prevent router.get('-all') from ever matching /api/schedules-all).

// DELETE /api/schedules/:scheduleId - Delete a schedule
// Query params:
//   ?scope=this&date=YYYY-MM-DD  — cancel this single occurrence (creates exception)
//   ?scope=following&date=YYYY-MM-DD — end recurring pattern before this date
//   ?scope=all (default) — for a recurring pattern, END it as of today (keeps
//        every past/worked occurrence); for a one-time shift, delete the row.
//   ?scope=purge — EXPLICIT full erase incl. history (deactivate the whole
//        pattern, hiding past + future). Only for patterns created by mistake.
//   ?deletePair=true — also delete split shift partner
router.delete('/:scheduleId', verifyToken, async (req, res) => {
  try {
    const { scheduleId } = req.params;
    const { scope = 'all', date, deletePair, reason } = req.query;

    const current = await db.query('SELECT * FROM schedules WHERE id = $1', [scheduleId]);
    if (current.rows.length === 0) {
      return res.status(404).json({ error: 'Schedule not found' });
    }

    const shift = current.rows[0];
    const isRecurring = shift.day_of_week !== null && shift.day_of_week !== undefined;

    // ── Safety: a scoped (this/following) delete must NEVER silently fall
    // through to the wipe-everything 'all' branch. If the request asked for a
    // partial delete but we can't honor it (missing date, or not a recurring
    // pattern), reject it instead of escalating to a destructive full delete.
    if ((scope === 'this' || scope === 'following')) {
      if (!isRecurring) {
        return res.status(400).json({
          error: `scope='${scope}' is only valid for recurring shifts; this is a one-time shift. Use scope=all to delete it.`,
        });
      }
      if (!date) {
        return res.status(400).json({
          error: `scope='${scope}' requires a 'date' query param. Refusing to delete to avoid wiping the whole pattern.`,
        });
      }
    }

    // ── Scope: cancel this single occurrence ──
    if (scope === 'this' && date && isRecurring) {
      try {
        await db.query(
          `INSERT INTO schedule_exceptions (schedule_id, exception_date, exception_type, created_by)
           VALUES ($1, $2, 'cancelled', $3)
           ON CONFLICT (schedule_id, exception_date) DO UPDATE SET exception_type = 'cancelled'`,
          [scheduleId, date, req.user.id]
        );
      } catch (e) {
        // Table might not exist yet
        if (e.message.includes('does not exist')) {
          return res.status(500).json({ error: 'Please run migration_v20 first' });
        }
        throw e;
      }
      await auditLog(req.user.id, 'CANCEL_OCCURRENCE', 'schedules', scheduleId, null, { date }, reason || null);
      return res.json({ message: 'Occurrence cancelled', date, scheduleId });
    }

    // ── Scope: end pattern from this date forward ──
    if (scope === 'following' && date && isRecurring) {
      // Set end_date on the recurring pattern to the day before
      const endDate = new Date(date + 'T12:00:00');
      endDate.setDate(endDate.getDate() - 1);
      const endDateStr = endDate.toISOString().split('T')[0];

      try {
        const result = await db.query(
          `UPDATE schedules SET end_date = $1, updated_at = NOW() WHERE id = $2 AND is_active = true RETURNING *`,
          [endDateStr, scheduleId]
        );
        if (result.rows.length === 0) return res.status(404).json({ error: 'Schedule not found' });
        await auditLog(req.user.id, 'END_PATTERN', 'schedules', scheduleId, shift, result.rows[0], reason || null);
        return res.json({ message: 'Recurring pattern ended', endDate: endDateStr, schedule: result.rows[0] });
      } catch (e) {
        if (e.message.includes('end_date')) {
          return res.status(500).json({ error: 'Please run migration_v20 first' });
        }
        throw e;
      }
    }

    // Which rows does this action target — just this shift, or the whole split
    // pair when the caller asked to delete the partner too?
    const isSplitPair = shift.is_split_shift && shift.split_shift_group_id && deletePair === 'true';
    const targetClause = isSplitPair ? 'split_shift_group_id = $1 AND is_active = true' : 'id = $1';
    const targetParam  = isSplitPair ? shift.split_shift_group_id : scheduleId;

    // ── Scope: purge — EXPLICIT full erase, history included ──
    // The ONLY path that deactivates a recurring pattern (hiding past + future).
    // Wired to a clearly-labeled destructive action in the UI; never the default.
    if (scope === 'purge') {
      const result = await db.query(
        `UPDATE schedules SET is_active = false, updated_at = NOW() WHERE ${targetClause} RETURNING *`,
        [targetParam]
      );
      for (const row of result.rows) {
        await auditLog(req.user.id, 'DELETE', 'schedules', row.id, null, row, reason || null);
      }
      return res.json({ message: 'Schedule permanently removed (history included)', deletedCount: result.rows.length });
    }

    // ── Scope: all ──
    // For a RECURRING pattern this must NEVER wipe already-worked history. A
    // recurring shift is a single row spanning past→future, so is_active=false
    // would hide every past occurrence too. Instead we END the pattern as of
    // today: future occurrences stop, every past occurrence stays visible and
    // billable. (Use scope=purge to truly erase a pattern created by mistake.)
    if (isRecurring) {
      // "Today" in the agency's timezone (Central). Last active day is yesterday,
      // so no occurrence is generated from today forward.
      const todayStr = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago' }).format(new Date());
      const end = new Date(todayStr + 'T12:00:00');
      end.setDate(end.getDate() - 1);
      const endStr = end.toISOString().split('T')[0];
      const effStr = new Date(shift.effective_date).toISOString().split('T')[0];

      // Pattern hadn't started yet → no past occurrences to protect → remove outright.
      if (endStr < effStr) {
        const result = await db.query(
          `UPDATE schedules SET is_active = false, updated_at = NOW() WHERE ${targetClause} RETURNING *`,
          [targetParam]
        );
        for (const row of result.rows) {
          await auditLog(req.user.id, 'DELETE', 'schedules', row.id, null, row, reason || null);
        }
        return res.json({ message: 'Recurring schedule removed (had not started; no past occurrences)', deletedCount: result.rows.length });
      }

      const result = await db.query(
        `UPDATE schedules SET end_date = $2, updated_at = NOW() WHERE ${targetClause} RETURNING *`,
        [targetParam, endStr]
      );
      for (const row of result.rows) {
        await auditLog(req.user.id, 'END_PATTERN', 'schedules', row.id, shift, row, reason || null);
      }
      return res.json({
        message: 'Recurring pattern ended today; past occurrences kept',
        endDate: endStr,
        pastKept: true,
        deletedCount: result.rows.length,
      });
    }

    // ── Scope: all on a one-time shift — delete the single row (or split pair) ──
    const result = await db.query(
      `UPDATE schedules SET is_active = false, updated_at = NOW() WHERE ${targetClause} RETURNING *`,
      [targetParam]
    );
    for (const row of result.rows) {
      await auditLog(req.user.id, 'DELETE', 'schedules', row.id, null, row, reason || null);
    }
    return res.json({
      message: isSplitPair ? 'Split shift pair deleted' : 'Schedule deleted',
      deletedCount: result.rows.length,
      wasSplitShift: shift.is_split_shift || false,
      splitShiftGroupId: shift.split_shift_group_id || null,
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ── SUSPEND / RESUME SERVICE ────────────────────────────────────────────────
// Pause a client's service without deleting anything. Sets schedules.suspended_from;
// the occurrence engine then stops generating visits on/after that date (so billing,
// payroll, reminders and no-show all stop), while already-worked visits before it stay.
// Reversible: resume clears the date and the schedule returns exactly as it was.
//
//   scope='this'   — just this one schedule (the clicked shift's weekday).
//   scope='client' — every active schedule for this shift's client (all their days).
// fromDate defaults to today (America/Chicago). A future date lets you suspend starting
// later (e.g. tomorrow) so a visit already worked today is kept.

// Resolve the set of schedule ids a suspend/resume applies to, given a scope.
async function resolveScopeIds(scheduleId, scope) {
  const cur = await db.query(`SELECT id, client_id FROM schedules WHERE id=$1 AND is_active=true`, [scheduleId]);
  if (cur.rows.length === 0) return null;
  if (scope === 'client') {
    const all = await db.query(`SELECT id FROM schedules WHERE client_id=$1 AND is_active=true`, [cur.rows[0].client_id]);
    return { clientId: cur.rows[0].client_id, ids: all.rows.map(r => r.id) };
  }
  return { clientId: cur.rows[0].client_id, ids: [scheduleId] };
}

router.post('/:id/suspend', verifyToken, requireAdmin, async (req, res) => {
  try {
    const scope = String(req.body.scope || 'this').toLowerCase();
    if (!['this', 'client'].includes(scope)) return res.status(400).json({ error: "scope must be 'this' or 'client'." });

    // Default the start date to today in Chicago; accept an explicit YYYY-MM-DD.
    const fromDate = req.body.fromDate
      || (await db.query(`SELECT to_char((NOW() AT TIME ZONE 'America/Chicago')::date,'YYYY-MM-DD') AS d`)).rows[0].d;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(fromDate)) return res.status(400).json({ error: 'fromDate must be YYYY-MM-DD.' });

    const scoped = await resolveScopeIds(req.params.id, scope);
    if (!scoped) return res.status(404).json({ error: 'Schedule not found' });

    const result = await db.query(
      `UPDATE schedules SET suspended_from=$2::date, updated_at=NOW()
       WHERE id = ANY($1) AND is_active=true RETURNING id, suspended_from`,
      [scoped.ids, fromDate]
    );
    for (const row of result.rows) {
      await auditLog(req.user.id, 'SUSPEND', 'schedules', row.id, null, { scope, suspended_from: fromDate }, req.body.reason || null);
    }
    res.json({ suspended: result.rows.length, scope, fromDate, clientId: scoped.clientId, scheduleIds: result.rows.map(r => r.id) });
  } catch (error) { res.status(500).json({ error: error.message }); }
});

router.post('/:id/resume', verifyToken, requireAdmin, async (req, res) => {
  try {
    const scope = String(req.body.scope || 'this').toLowerCase();
    if (!['this', 'client'].includes(scope)) return res.status(400).json({ error: "scope must be 'this' or 'client'." });

    const scoped = await resolveScopeIds(req.params.id, scope);
    if (!scoped) return res.status(404).json({ error: 'Schedule not found' });

    // Only touch rows that are actually suspended, so resume is a clean no-op otherwise.
    const result = await db.query(
      `UPDATE schedules SET suspended_from=NULL, updated_at=NOW()
       WHERE id = ANY($1) AND is_active=true AND suspended_from IS NOT NULL RETURNING id`,
      [scoped.ids]
    );
    for (const row of result.rows) {
      await auditLog(req.user.id, 'RESUME', 'schedules', row.id, null, { scope }, req.body.reason || null);
    }
    res.json({ resumed: result.rows.length, scope, clientId: scoped.clientId, scheduleIds: result.rows.map(r => r.id) });
  } catch (error) { res.status(500).json({ error: error.message }); }
});

// Client-scoped suspend/resume — the Clients screen operates on a client, not a single
// schedule, so it can't use the :id routes above (it has no schedule id to hand). Same
// suspended_from mechanism; this pauses/resumes EVERY active schedule the client has.
// (These paths have three segments so they never collide with '/:id/suspend'.)
router.post('/client/:clientId/suspend', verifyToken, requireAdmin, async (req, res) => {
  try {
    const fromDate = req.body.fromDate
      || (await db.query(`SELECT to_char((NOW() AT TIME ZONE 'America/Chicago')::date,'YYYY-MM-DD') AS d`)).rows[0].d;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(fromDate)) return res.status(400).json({ error: 'fromDate must be YYYY-MM-DD.' });

    const result = await db.query(
      `UPDATE schedules SET suspended_from=$2::date, updated_at=NOW()
       WHERE client_id=$1 AND is_active=true RETURNING id`,
      [req.params.clientId, fromDate]
    );
    for (const row of result.rows) {
      await auditLog(req.user.id, 'SUSPEND', 'schedules', row.id, null, { scope: 'client', suspended_from: fromDate }, req.body.reason || null);
    }
    res.json({ suspended: result.rows.length, fromDate, clientId: req.params.clientId, scheduleIds: result.rows.map(r => r.id) });
  } catch (error) { res.status(500).json({ error: error.message }); }
});

router.post('/client/:clientId/resume', verifyToken, requireAdmin, async (req, res) => {
  try {
    const result = await db.query(
      `UPDATE schedules SET suspended_from=NULL, updated_at=NOW()
       WHERE client_id=$1 AND is_active=true AND suspended_from IS NOT NULL RETURNING id`,
      [req.params.clientId]
    );
    for (const row of result.rows) {
      await auditLog(req.user.id, 'RESUME', 'schedules', row.id, null, { scope: 'client' }, req.body.reason || null);
    }
    res.json({ resumed: result.rows.length, clientId: req.params.clientId, scheduleIds: result.rows.map(r => r.id) });
  } catch (error) { res.status(500).json({ error: error.message }); }
});

module.exports = router;
