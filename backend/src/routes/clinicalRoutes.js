// routes/clinicalRoutes.js — mounted at /api via app.use('/api', clinicalRoutes)
// Covers: compliance summary, care plans, incidents, performance reviews, schedules-enhanced
const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const db = require('../db');
const { verifyToken, requireAdmin, auditLog } = require('../middleware/shared');
const { shiftHours } = require('../helpers/shiftHours');
const { alignBiweeklyAnchor } = require('../helpers/biweekly');
const { getClientVisitSchedule } = require('../helpers/carePlanSchedule');
// ─── COMPLIANCE ───────────────────────────────────────────────────────────────

router.get('/compliance/summary', verifyToken, requireAdmin, async (req, res) => {
  try {
    const [expiredBg, expiredTraining, trainingByType, bgStatus] = await Promise.all([
      db.query(`SELECT COUNT(*) as expired_bg FROM background_checks WHERE expiration_date < CURRENT_DATE`),
      db.query(`SELECT COUNT(*) as expired_training FROM training_records WHERE expiration_date < CURRENT_DATE AND status != 'expired'`),
      db.query(`SELECT training_type, COUNT(*) as count FROM training_records WHERE status='completed' GROUP BY training_type ORDER BY count DESC`),
      db.query(`SELECT status, COUNT(*) as count FROM background_checks GROUP BY status`),
    ]);
    res.json({ expiredBackgroundChecks: expiredBg.rows[0].expired_bg, expiredTraining: expiredTraining.rows[0].expired_training, trainingByType: trainingByType.rows, backgroundCheckStatus: bgStatus.rows });
  } catch (error) { res.status(500).json({ error: error.message }); }
});

router.delete('/training-records/:id', verifyToken, requireAdmin, async (req, res) => {
  try {
    const result = await db.query(`DELETE FROM training_records WHERE id=$1 RETURNING *`, [req.params.id]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'Training record not found' });
    await auditLog(req.user.id, 'DELETE', 'training_records', req.params.id, null, result.rows[0]);
    res.json({ message: 'Training record deleted' });
  } catch (error) { res.status(500).json({ error: error.message }); }
});

router.delete('/compliance-documents/:id', verifyToken, requireAdmin, async (req, res) => {
  try {
    const result = await db.query(`DELETE FROM compliance_documents WHERE id=$1 RETURNING *`, [req.params.id]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'Document not found' });
    await auditLog(req.user.id, 'DELETE', 'compliance_documents', req.params.id, null, result.rows[0]);
    res.json({ message: 'Document deleted' });
  } catch (error) { res.status(500).json({ error: error.message }); }
});

router.delete('/blackout-dates/:dateId', verifyToken, async (req, res) => {
  try {
    const result = await db.query(`DELETE FROM caregiver_blackout_dates WHERE id=$1 RETURNING *`, [req.params.dateId]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'Blackout date not found' });
    await auditLog(req.user.id, 'DELETE', 'caregiver_blackout_dates', req.params.dateId, null, result.rows[0]);
    res.json({ message: 'Blackout date deleted' });
  } catch (error) { res.status(500).json({ error: error.message }); }
});

// ─── CARE PLANS ───────────────────────────────────────────────────────────────

router.get('/care-plans/summary', verifyToken, requireAdmin, async (req, res) => {
  try {
    const [total, active, byServiceType, byClient] = await Promise.all([
      db.query(`SELECT COUNT(*) as total_plans FROM care_plans`),
      db.query(`SELECT COUNT(*) as active_plans FROM care_plans WHERE (start_date IS NULL OR start_date<=CURRENT_DATE) AND (end_date IS NULL OR end_date>=CURRENT_DATE)`),
      db.query(`SELECT service_type, COUNT(*) as count FROM care_plans GROUP BY service_type ORDER BY count DESC`),
      db.query(`SELECT c.id, c.first_name||' '||c.last_name as client_name, COUNT(cp.id) as plan_count FROM clients c LEFT JOIN care_plans cp ON c.id=cp.client_id GROUP BY c.id, c.first_name, c.last_name HAVING COUNT(cp.id)>0 ORDER BY plan_count DESC`),
    ]);
    res.json({ total: total.rows[0].total_plans, active: active.rows[0].active_plans, byServiceType: byServiceType.rows, byClient: byClient.rows });
  } catch (error) { res.status(500).json({ error: error.message }); }
});

// GET /api/care-plans/visit-schedule/:clientId — the client's current recurring visit
// schedule in words (from the shared schedule engine), for "Fill from current schedule"
// and for flagging plans whose saved schedule no longer matches.
router.get('/care-plans/visit-schedule/:clientId', verifyToken, requireAdmin, async (req, res) => {
  try {
    res.json(await getClientVisitSchedule((t, p) => db.query(t, p), req.params.clientId));
  } catch (error) { res.status(500).json({ error: error.message }); }
});

router.get('/care-plans/:clientId', verifyToken, async (req, res) => {
  try {
    res.json((await db.query(`SELECT * FROM care_plans WHERE client_id=$1 ORDER BY start_date DESC`, [req.params.clientId])).rows);
  } catch (error) { res.status(500).json({ error: error.message }); }
});

router.get('/care-plans', verifyToken, async (req, res) => {
  try {
    res.json((await db.query(`SELECT cp.*, c.first_name||' '||c.last_name as client_name FROM care_plans cp JOIN clients c ON cp.client_id=c.id ORDER BY cp.created_at DESC`)).rows);
  } catch (error) { res.status(500).json({ error: error.message }); }
});

router.post('/care-plans', verifyToken, requireAdmin, async (req, res) => {
  try {
    const { clientId, serviceType, serviceDescription, frequency, careGoals, specialInstructions, precautions, medicationNotes, mobilityNotes, dietaryNotes, communicationNotes, startDate, endDate, visitSchedule } = req.body;
    if (!clientId || !serviceType) return res.status(400).json({ error: 'clientId and serviceType are required' });
    const snap = await resolveVisitSchedule(visitSchedule, clientId);
    if (snap.error) return res.status(400).json({ error: snap.error });
    const planId = uuidv4();
    const result = await db.query(
      `INSERT INTO care_plans (id, client_id, service_type, service_description, frequency, care_goals, special_instructions, precautions, medication_notes, mobility_notes, dietary_notes, communication_notes, start_date, end_date, created_by, visit_schedule, visit_schedule_as_of)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17) RETURNING *`,
      [planId, clientId, serviceType, serviceDescription||null, frequency||null, careGoals||null, specialInstructions||null, precautions||null, medicationNotes||null, mobilityNotes||null, dietaryNotes||null, communicationNotes||null, startDate||null, endDate||null, req.user.id,
       snap.set ? snap.text : null, snap.set ? snap.asOf : null]
    );
    await auditLog(req.user.id, 'CREATE', 'care_plans', planId, null, result.rows[0]);
    res.status(201).json(result.rows[0]);
  } catch (error) { res.status(500).json({ error: error.message }); }
});

// visitSchedule is never taken from the browser as text: 'current' makes the server
// copy the client's live schedule (dated today), '' clears it, absent leaves it alone.
async function resolveVisitSchedule(value, clientId) {
  if (value === undefined) return { set: false };
  if (value === '' || value === null) return { set: true, text: null, asOf: null };
  if (value !== 'current') return { error: "visitSchedule must be 'current' or ''" };
  const sched = await getClientVisitSchedule((t, p) => db.query(t, p), clientId);
  if (!sched.text) return { error: 'This client has no recurring visits scheduled in the next 4 weeks, so there is no schedule to save.' };
  return { set: true, text: sched.text, asOf: sched.asOf };
}

const CARE_PLAN_SERVICE_LABELS = {
  personal_care: 'Personal Care', medication_management: 'Medication Management', companionship: 'Companionship',
  respite_care: 'Respite Care', mobility_assistance: 'Mobility Assistance', meal_prep: 'Meal Preparation',
  transportation: 'Transportation', other: 'Other',
};
// Same categories as the Care Tasks screen (CareTasksManager.jsx), in print order.
const CARE_TASK_CATEGORY_LABELS = new Map([
  ['adl', 'Personal Care (ADL)'], ['iadl', 'Homemaking (IADL)'], ['medication', 'Medication Reminders'],
  ['companion', 'Companion / Social'], ['safety', 'Safety Checks'], ['other', 'Other'],
]);

// Only fields present in the body are updated; a field sent as '' is cleared
// (so an end date can be removed). serviceType can't be cleared.
const CARE_PLAN_UPDATE_FIELDS = {
  serviceType: 'service_type', serviceDescription: 'service_description', frequency: 'frequency',
  careGoals: 'care_goals', specialInstructions: 'special_instructions', precautions: 'precautions',
  medicationNotes: 'medication_notes', mobilityNotes: 'mobility_notes', dietaryNotes: 'dietary_notes',
  communicationNotes: 'communication_notes', startDate: 'start_date', endDate: 'end_date',
};

router.put('/care-plans/:id', verifyToken, requireAdmin, async (req, res) => {
  const sets = [];
  const params = [];
  for (const [key, col] of Object.entries(CARE_PLAN_UPDATE_FIELDS)) {
    if (!(key in req.body)) continue;
    const v = req.body[key] === '' ? null : req.body[key];
    if (key === 'serviceType' && !v) return res.status(400).json({ error: 'serviceType cannot be blank' });
    params.push(v);
    sets.push(`${col}=$${params.length}`);
  }
  const client = await db.pool.connect();
  try {
    if ('visitSchedule' in req.body) {
      const plan = await client.query(`SELECT client_id FROM care_plans WHERE id=$1`, [req.params.id]);
      if (plan.rows.length === 0) return res.status(404).json({ error: 'Care plan not found' });
      const snap = await resolveVisitSchedule(req.body.visitSchedule, plan.rows[0].client_id);
      if (snap.error) return res.status(400).json({ error: snap.error });
      params.push(snap.text); sets.push(`visit_schedule=$${params.length}`);
      params.push(snap.asOf); sets.push(`visit_schedule_as_of=$${params.length}`);
    }
    params.push(req.params.id);
    await client.query('BEGIN');
    // Transaction-local GUC on the same connection as the UPDATE, so the
    // snapshot trigger records who made the change.
    await client.query(`SELECT set_config('crm.user_id', $1, true)`, [req.user.id]);
    const result = await client.query(
      `UPDATE care_plans SET ${[...sets, 'updated_at=NOW()'].join(', ')} WHERE id=$${params.length} RETURNING *`,
      params
    );
    if (result.rows.length === 0) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Care plan not found' }); }
    await client.query('COMMIT');
    await auditLog(req.user.id, 'UPDATE', 'care_plans', req.params.id, null, result.rows[0]);
    res.json(result.rows[0]);
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    res.status(500).json({ error: error.message });
  } finally { client.release(); }
});

// GET /api/clinical/care-plans/:id/revisions — list snapshots of prior versions
router.get('/care-plans/:id/revisions', verifyToken, requireAdmin, async (req, res) => {
  try {
    const r = await db.query(
      `SELECT cpr.*, u.first_name AS changed_by_first, u.last_name AS changed_by_last
         FROM care_plan_revisions cpr
         LEFT JOIN users u ON cpr.changed_by = u.id
        WHERE cpr.care_plan_id = $1
        ORDER BY cpr.revision_number DESC`,
      [req.params.id]
    );
    res.json(r.rows);
  } catch (error) { res.status(500).json({ error: error.message }); }
});

router.delete('/care-plans/:id', verifyToken, requireAdmin, async (req, res) => {
  try {
    const result = await db.query(`DELETE FROM care_plans WHERE id=$1 RETURNING *`, [req.params.id]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'Care plan not found' });
    await auditLog(req.user.id, 'DELETE', 'care_plans', req.params.id, null, result.rows[0]);
    res.json({ message: 'Care plan deleted' });
  } catch (error) { res.status(500).json({ error: error.message }); }
});

// ─── CARE PLAN TEMPLATES ─────────────────────────────────────────────────────

router.get('/care-plan-templates', verifyToken, requireAdmin, async (req, res) => {
  try {
    const result = await db.query(
      `SELECT * FROM care_plan_templates WHERE is_active = true ORDER BY is_built_in DESC, template_name`
    );
    res.json(result.rows);
  } catch (error) { res.status(500).json({ error: error.message }); }
});

router.post('/care-plan-templates', verifyToken, requireAdmin, async (req, res) => {
  try {
    const { templateName, templateDescription, category, serviceType, serviceDescription,
      frequency, careGoals, specialInstructions, precautions, medicationNotes,
      mobilityNotes, dietaryNotes, communicationNotes } = req.body;
    if (!templateName) return res.status(400).json({ error: 'templateName is required' });
    const result = await db.query(
      `INSERT INTO care_plan_templates
       (template_name, template_description, category, service_type, service_description, frequency,
        care_goals, special_instructions, precautions, medication_notes, mobility_notes,
        dietary_notes, communication_notes, is_built_in, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,false,$14) RETURNING *`,
      [templateName, templateDescription, category, serviceType, serviceDescription, frequency,
       careGoals, specialInstructions, precautions, medicationNotes, mobilityNotes,
       dietaryNotes, communicationNotes, req.user.id]
    );
    await auditLog(req.user.id, 'CREATE', 'care_plan_templates', result.rows[0].id, null, result.rows[0]);
    res.status(201).json(result.rows[0]);
  } catch (error) { res.status(500).json({ error: error.message }); }
});

router.delete('/care-plan-templates/:id', verifyToken, requireAdmin, async (req, res) => {
  try {
    // Built-in templates can't be deleted (only deactivated by the user creating
    // a custom one with the same name). Custom templates can be hard-deleted.
    const existing = await db.query(`SELECT is_built_in FROM care_plan_templates WHERE id = $1`, [req.params.id]);
    if (existing.rows.length === 0) return res.status(404).json({ error: 'Template not found' });
    if (existing.rows[0].is_built_in) {
      // Soft-deactivate built-ins instead
      await db.query(`UPDATE care_plan_templates SET is_active = false, updated_at = NOW() WHERE id = $1`, [req.params.id]);
      return res.json({ message: 'Built-in template deactivated' });
    }
    await db.query(`DELETE FROM care_plan_templates WHERE id = $1`, [req.params.id]);
    res.json({ message: 'Template deleted' });
  } catch (error) { res.status(500).json({ error: error.message }); }
});

// GET /api/clinical/care-plans/:id/pdf — render a care plan as a printable PDF.
// Use case: regulator/binder/paper backup, family copy.
router.get('/care-plans/:id/pdf', verifyToken, requireAdmin, async (req, res) => {
  try {
    const r = await db.query(
      `SELECT cp.*, c.first_name AS client_first, c.last_name AS client_last,
              c.date_of_birth, c.address, c.city, c.state, c.zip, c.phone,
              c.emergency_contact_name, c.emergency_contact_phone,
              u.first_name AS author_first, u.last_name AS author_last
         FROM care_plans cp
         JOIN clients c ON cp.client_id = c.id
         LEFT JOIN users u ON cp.created_by = u.id
        WHERE cp.id = $1`,
      [req.params.id]
    );
    if (r.rows.length === 0) return res.status(404).json({ error: 'Care plan not found' });
    const p = r.rows[0];
    // Loaded before the PDF stream starts so a query error can still return JSON.
    const tasks = (await db.query(
      `SELECT task_name, category, weekly_frequency, allotted_minutes, assessment_source
         FROM client_task_templates
        WHERE client_id = $1 AND is_active = true
        ORDER BY sort_order, created_at`,
      [p.client_id]
    )).rows;

    const PDFDocument = require('pdfkit');
    const doc = new PDFDocument({ size: 'LETTER', margin: 54 });
    const fname = `care-plan-${p.client_last}-${p.client_first}-${new Date(p.created_at).toISOString().slice(0,10)}.pdf`;
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${fname.replace(/[^a-zA-Z0-9._-]/g, '_')}"`);
    doc.pipe(res);

    const section = (title, body) => {
      if (!body || !String(body).trim()) return;
      doc.moveDown(0.6).fillColor('#1E3A8A').font('Helvetica-Bold').fontSize(11).text(title.toUpperCase());
      doc.moveTo(54, doc.y + 2).lineTo(558, doc.y + 2).strokeColor('#BFDBFE').stroke();
      doc.moveDown(0.3).fillColor('#111827').font('Helvetica').fontSize(10).text(String(body), { lineGap: 2 });
    };

    // Header
    doc.fillColor('#1D4ED8').font('Helvetica-Bold').fontSize(20).text('Care Plan');
    doc.fillColor('#6B7280').font('Helvetica').fontSize(9).text('Chippewa Valley Home Care');
    doc.moveDown(0.5);

    // Client block
    doc.fillColor('#111827').font('Helvetica-Bold').fontSize(13).text(`${p.client_first} ${p.client_last}`);
    const small = [];
    if (p.date_of_birth) small.push(`DOB: ${new Date(p.date_of_birth).toLocaleDateString()}`);
    if (p.phone) small.push(`Phone: ${p.phone}`);
    if (p.address) small.push(`${p.address}${p.city ? `, ${p.city}` : ''}${p.state ? `, ${p.state}` : ''} ${p.zip || ''}`);
    doc.font('Helvetica').fontSize(9).fillColor('#6B7280').text(small.join('  ·  '));

    // Plan meta
    doc.moveDown(0.5);
    doc.font('Helvetica').fontSize(9).fillColor('#374151');
    doc.text(`Plan ID: ${p.id}`);
    doc.text(`Service Type: ${CARE_PLAN_SERVICE_LABELS[p.service_type] || p.service_type || '—'}     Frequency: ${p.frequency || '—'}`);
    doc.text(`Start: ${p.start_date ? new Date(p.start_date).toLocaleDateString() : '—'}    End: ${p.end_date ? new Date(p.end_date).toLocaleDateString() : 'Ongoing'}`);
    if (p.author_first) doc.text(`Created by: ${p.author_first} ${p.author_last}   on ${new Date(p.created_at).toLocaleDateString()}`);

    // Sections
    if (p.visit_schedule) {
      section(`Visit Schedule (as of ${new Date(p.visit_schedule_as_of).toLocaleDateString('en-US', { timeZone: 'UTC' })})`, p.visit_schedule);
    }
    section('Service Description', p.service_description);
    section('Care Goals', p.care_goals);
    section('Special Instructions', p.special_instructions);
    section('Precautions', p.precautions);
    section('Medication Notes', p.medication_notes);
    section('Mobility Notes', p.mobility_notes);
    section('Dietary Notes', p.dietary_notes);
    section('Communication Notes', p.communication_notes);

    if (p.emergency_contact_name || p.emergency_contact_phone) {
      section('Emergency Contact', `${p.emergency_contact_name || ''}   ${p.emergency_contact_phone || ''}`.trim());
    }

    // The client's care task checklist (Clients → Tasks, e.g. imported from the MIDAS
    // assessment), as it stands on the day the PDF is printed.
    if (tasks.length) {
      const mins = (t) => (t.weekly_frequency || 1) * (t.allotted_minutes || 0);
      const lines = [];
      for (const [cat, label] of CARE_TASK_CATEGORY_LABELS) {
        const group = tasks.filter(t => (CARE_TASK_CATEGORY_LABELS.has(t.category) ? t.category : 'other') === cat);
        if (!group.length) continue;
        if (lines.length) lines.push('');
        lines.push(`${label} — ${group.reduce((a, t) => a + mins(t), 0)} min/week`);
        group.forEach(t => lines.push(`   •  ${t.task_name}: ${t.weekly_frequency || 1}x/week × ${t.allotted_minutes || 0} min = ${mins(t)} min/week`));
      }
      const total = tasks.reduce((a, t) => a + mins(t), 0);
      lines.push('', `Total: ${total} min/week (${(total / 60).toFixed(2)} hours)`);
      if (tasks.some(t => /^midas/.test(t.assessment_source || ''))) lines.push('Tasks imported from the MIDAS assessment.');
      section('Care Tasks', lines.join('\n'));
    }

    // Signature lines for paper workflow; keep the block together on one page.
    if (doc.y > 600) doc.addPage();
    doc.moveDown(2);
    doc.fillColor('#6B7280').fontSize(9);
    const sigY = doc.y;
    doc.text('_________________________________', 54, sigY);
    doc.text('_________________________________', 320, sigY);
    doc.moveDown(0.3);
    doc.text('Client / Authorized Rep', 54, doc.y);
    doc.text('Date', 320, doc.y - 12);

    doc.moveDown(2);
    const sigY2 = doc.y;
    doc.text('_________________________________', 54, sigY2);
    doc.text('_________________________________', 320, sigY2);
    doc.moveDown(0.3);
    doc.text('Agency Representative', 54, doc.y);
    doc.text('Date', 320, doc.y - 12);

    // Footer
    doc.moveDown(2);
    doc.fontSize(7).fillColor('#9CA3AF').text(
      `This document contains Protected Health Information — handle per HIPAA.`,
      54, 720, { width: 504, align: 'center' }
    );

    doc.end();
  } catch (error) {
    console.error('[care-plan PDF]', error);
    res.status(500).json({ error: error.message });
  }
});

// Create a new care_plans row from a template. The admin gets a fully
// pre-filled plan to edit instead of a blank form.
router.post('/care-plans/from-template/:templateId', verifyToken, requireAdmin, async (req, res) => {
  try {
    const { clientId, startDate, endDate } = req.body;
    if (!clientId) return res.status(400).json({ error: 'clientId is required' });
    const tpl = await db.query(`SELECT * FROM care_plan_templates WHERE id = $1`, [req.params.templateId]);
    if (tpl.rows.length === 0) return res.status(404).json({ error: 'Template not found' });
    const t = tpl.rows[0];
    const { v4: uuidv4 } = require('uuid');
    const planId = uuidv4();
    const result = await db.query(
      `INSERT INTO care_plans
       (id, client_id, service_type, service_description, frequency, care_goals,
        special_instructions, precautions, medication_notes, mobility_notes,
        dietary_notes, communication_notes, start_date, end_date, created_by, status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,'draft') RETURNING *`,
      [planId, clientId, t.service_type, t.service_description, t.frequency, t.care_goals,
       t.special_instructions, t.precautions, t.medication_notes, t.mobility_notes,
       t.dietary_notes, t.communication_notes, startDate || null, endDate || null, req.user.id]
    );
    await auditLog(req.user.id, 'CREATE', 'care_plans', planId, null, { ...result.rows[0], _from_template: t.template_name });
    res.status(201).json({ carePlan: result.rows[0], appliedTemplate: t.template_name });
  } catch (error) { res.status(500).json({ error: error.message }); }
});

// ─── CARE PLAN → SCHEDULE GENERATION ─────────────────────────────────────────

router.post('/care-plans/:id/generate-schedule', verifyToken, requireAdmin, async (req, res) => {
  try {
    const { caregiverId, startTime, endTime, daysOfWeek, startDate, endDate } = req.body;
    if (!caregiverId || !startTime || !endTime || !daysOfWeek?.length) {
      return res.status(400).json({ error: 'caregiverId, startTime, endTime, and daysOfWeek are required' });
    }

    // Fetch care plan
    const planResult = await db.query('SELECT * FROM care_plans WHERE id = $1', [req.params.id]);
    if (planResult.rows.length === 0) return res.status(404).json({ error: 'Care plan not found' });
    const plan = planResult.rows[0];

    // Never add a second set of recurring shifts on top of an existing schedule.
    const existing = await getClientVisitSchedule((t, p) => db.query(t, p), plan.client_id);
    if (existing.upcomingVisits > 0) {
      return res.status(409).json({
        error: `This client already has ${existing.upcomingVisits} visit(s) scheduled in the next ${existing.windowDays} days. Generating would double-book them — change the shifts in Scheduling instead.`,
      });
    }

    // Authorization is advisory — see helpers/authorizationCheck.js. A shortfall
    // is reported back as a warning; it never stops the schedule being generated.
    const { checkAuthorizationBalance } = require('../helpers/authorizationCheck');
    const perShiftHours = shiftHours(startTime, endTime);
    const weeklyHours = perShiftHours * daysOfWeek.length;
    const authCheck = await checkAuthorizationBalance(plan.client_id, weeklyHours);
    const warnings = [...(authCheck.warnings || [])];

    // Create recurring schedules for each day
    const created = [];
    for (const dayOfWeek of daysOfWeek) {
      const scheduleId = require('uuid').v4();
      const result = await db.query(
        `INSERT INTO schedules (id, caregiver_id, client_id, schedule_type, day_of_week, start_time, end_time, notes, frequency, effective_date, end_date)
         VALUES ($1, $2, $3, 'recurring', $4, $5, $6, $7, 'weekly', $8, $9) RETURNING *`,
        [scheduleId, caregiverId, plan.client_id, dayOfWeek, startTime, endTime,
         `Generated from care plan: ${plan.service_type || 'General'}`,
         startDate || plan.start_date || null,
         endDate || plan.end_date || null]
      );
      created.push(result.rows[0]);
      await auditLog(req.user.id, 'CREATE', 'schedules', scheduleId, null, result.rows[0], 'care_plan_generation');
    }

    res.status(201).json({
      success: true,
      created: created.length,
      schedules: created,
      carePlanId: req.params.id,
      warnings
    });
  } catch (error) {
    console.error('Generate schedule from care plan error:', error);
    res.status(500).json({ error: error.message });
  }
});

// ─── INCIDENTS ────────────────────────────────────────────────────────────────

// Case file (migration v64): incident_number, status, payer response tracking,
// investigation timeline, attachments, signed training acknowledgement, reversible
// caregiver removal, printable report + payer response packet, caregiver field reports.
const {
  INCIDENT_TYPES, SEVERITIES, INCIDENT_STATUSES, DISPOSITIONS, MANDATORY_REPORT_STATUSES,
  ENTRY_TYPES, ATTACHMENT_CATEGORIES, TRAINING_ACK_METHODS, TRAINING_ACK_TRAINING_TYPES,
  ATTACHMENT_MAX_DATA_URI_LENGTH, ATTACHMENT_ALLOWED_MIME,
} = require('../helpers/incidentOptions');
const { SCHEDULE_OCCURRENCES_CTE } = require('../helpers/scheduleOccurrences');
const incidentPdf = require('../services/incidentPdfService');
const { notifyAdmins } = require('./notificationRoutes');
const { clientIp } = require('../helpers/clientIp');

const YMD_RE = /^\d{4}-\d{2}-\d{2}$/;
const HHMM_RE = /^\d{2}:\d{2}(:\d{2})?$/;
const isBlank = (v) => v === undefined || v === null || String(v).trim() === '';
const orNull = (v) => (isBlank(v) ? null : v);
const todayChicago = async (q = db) =>
  (await q.query(`SELECT to_char((NOW() AT TIME ZONE 'America/Chicago')::date, 'YYYY-MM-DD') AS d`)).rows[0].d;

// The drawn signature is a large data URI: keep it out of lists and audit rows.
const withoutSignature = (row) => {
  if (!row) return row;
  const { training_ack_signature, ...rest } = row;
  return { ...rest, has_training_ack_signature: !!training_ack_signature };
};

// DATE columns as text for form inputs (node-pg shifts DATE by server timezone).
const INCIDENT_YMD_COLUMNS = `
  to_char(ir.incident_date, 'YYYY-MM-DD')          AS incident_date_ymd,
  to_char(ir.reported_date, 'YYYY-MM-DD')          AS reported_date_ymd,
  to_char(ir.response_due_date, 'YYYY-MM-DD')      AS response_due_date_ymd,
  to_char(ir.response_sent_date, 'YYYY-MM-DD')     AS response_sent_date_ymd,
  to_char(ir.closed_date, 'YYYY-MM-DD')            AS closed_date_ymd,
  to_char(ir.caregiver_removed_from, 'YYYY-MM-DD') AS caregiver_removed_from_ymd,
  to_char(ir.caregiver_returned_on, 'YYYY-MM-DD')  AS caregiver_returned_on_ymd,
  to_char(ir.incident_time, 'HH24:MI')             AS incident_time_hhmm`;

const parseDataUri = (uri) => {
  const m = /^data:([a-z0-9.+\/-]+);base64,([A-Za-z0-9+/=\r\n]+)$/i.exec(String(uri || ''));
  return m ? { mime: m[1].toLowerCase(), base64: m[2] } : null;
};
const safeFileName = (name) => String(name || 'file').replace(/[^A-Za-z0-9._ -]/g, '_').slice(0, 200) || 'file';

// Editable incident fields. Returns an error message or null.
function validateIncidentBody(b) {
  if (isBlank(b.clientId)) return 'Client is required';
  if (!INCIDENT_TYPES[b.incidentType]) return 'Incident type is not valid';
  if (isBlank(b.description)) return 'Description is required';
  if (!YMD_RE.test(String(b.incidentDate || ''))) return 'Incident date is required';
  if (!isBlank(b.severity) && !SEVERITIES[b.severity]) return 'Severity is not valid';
  if (!isBlank(b.incidentTime) && !HHMM_RE.test(String(b.incidentTime))) return 'Incident time must be HH:MM';
  for (const [k, name] of [['reportedDate', 'Date reported'], ['responseDueDate', 'Response due date'], ['responseSentDate', 'Response sent date'], ['closedDate', 'Date closed']]) {
    if (!isBlank(b[k]) && !YMD_RE.test(String(b[k]))) return `${name} must be a valid date`;
  }
  if (!isBlank(b.status) && !INCIDENT_STATUSES[b.status]) return 'Status is not valid';
  if (!isBlank(b.disposition) && !DISPOSITIONS[b.disposition]) return 'Conclusion is not valid';
  if (!isBlank(b.mandatoryReportStatus) && !MANDATORY_REPORT_STATUSES[b.mandatoryReportStatus]) return 'Mandatory report decision is not valid';
  return null;
}

// Insert with the next IR-<year>-<nnn> number. MAX (not COUNT) so a deleted incident
// never causes a reused number; the unique index turns a same-moment race into a retry.
async function insertIncident(b, reportedByUserId, status = 'open') {
  for (let attempt = 1; attempt <= 3; attempt++) {
    const num = (await db.query(`
      SELECT 'IR-' || yy.y || '-' ||
             lpad((COALESCE(MAX(NULLIF(split_part(ir.incident_number, '-', 3), '')::int), 0) + 1)::text, 3, '0') AS num
        FROM (SELECT EXTRACT(YEAR FROM $1::date)::int AS y) yy
        LEFT JOIN incident_reports ir ON ir.incident_number LIKE 'IR-' || yy.y || '-%'
       GROUP BY yy.y`, [b.incidentDate])).rows[0].num;
    try {
      const r = await db.query(
        `INSERT INTO incident_reports (id, incident_number, client_id, caregiver_id, incident_type, severity, incident_date, incident_time,
           description, witnesses, injuries_or_damage, actions_taken, follow_up_required, follow_up_notes, reported_by, reported_date,
           reported_by_user_id, status, reporter_contact_name, reporter_phone, reporter_email, response_due_date)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22) RETURNING *`,
        [uuidv4(), num, b.clientId, orNull(b.caregiverId), b.incidentType, b.severity || 'moderate', b.incidentDate, orNull(b.incidentTime),
         b.description, orNull(b.witnesses), orNull(b.injuriesOrDamage), orNull(b.actionsTaken), !!b.followUpRequired, orNull(b.followUpNotes),
         orNull(b.reportedBy), orNull(b.reportedDate), reportedByUserId, status,
         orNull(b.reporterContactName), orNull(b.reporterPhone), orNull(b.reporterEmail), orNull(b.responseDueDate)]
      );
      return r.rows[0];
    } catch (e) {
      if (e.code === '23505' && attempt < 3) continue;
      throw e;
    }
  }
}

async function addTimelineNote(q, incidentId, entryType, summary, userId, entryDate) {
  const d = entryDate || await todayChicago(q);
  await q.query(
    `INSERT INTO incident_investigation_notes (incident_id, entry_date, entry_type, summary, created_by)
     VALUES ($1, $2::date, $3, $4, $5)`,
    [incidentId, d, entryType, summary, userId]);
}

// Thrown inside transactional handlers to roll back and answer with a status.
class IncidentHttpError extends Error { constructor(status, message) { super(message); this.status = status; } }

router.get('/incidents/summary', verifyToken, requireAdmin, async (req, res) => {
  try {
    const [total, bySeverity, byType, followUp, monthly, byClient] = await Promise.all([
      db.query(`SELECT COUNT(*) as total FROM incident_reports`),
      db.query(`SELECT severity, COUNT(*) as count FROM incident_reports GROUP BY severity ORDER BY CASE severity WHEN 'critical' THEN 1 WHEN 'severe' THEN 2 WHEN 'moderate' THEN 3 WHEN 'minor' THEN 4 END`),
      db.query(`SELECT incident_type, COUNT(*) as count FROM incident_reports GROUP BY incident_type ORDER BY count DESC`),
      db.query(`SELECT COUNT(*) as pending_followup FROM incident_reports WHERE follow_up_required=true`),
      db.query(`SELECT DATE_TRUNC('month', incident_date)::DATE as month, COUNT(*) as count, COUNT(CASE WHEN severity IN ('critical','severe') THEN 1 END) as serious_count FROM incident_reports GROUP BY DATE_TRUNC('month', incident_date) ORDER BY month DESC LIMIT 12`),
      db.query(`SELECT c.id, c.first_name||' '||c.last_name as client_name, COUNT(ir.id) as incident_count FROM clients c LEFT JOIN incident_reports ir ON c.id=ir.client_id WHERE ir.id IS NOT NULL GROUP BY c.id, c.first_name, c.last_name ORDER BY incident_count DESC LIMIT 10`),
    ]);
    res.json({ total: total.rows[0].total, bySeverity: bySeverity.rows, byType: byType.rows, pendingFollowUp: followUp.rows[0].pending_followup, monthlyTrend: monthly.rows, topClients: byClient.rows });
  } catch (error) { res.status(500).json({ error: error.message }); }
});

// Caregiver field report (caregiver app → "Report Incident"). Declared before the
// /incidents/:id routes; it is a POST so it never competes with GET /incidents/:id.
router.post('/incidents/caregiver-report', verifyToken, async (req, res) => {
  try {
    if (!['caregiver', 'admin'].includes(req.user.role)) return res.status(403).json({ error: 'Not allowed' });
    const b = req.body || {};
    if (isBlank(b.clientId)) return res.status(400).json({ error: 'Please pick the client' });
    if (!INCIDENT_TYPES[b.incidentType]) return res.status(400).json({ error: 'Please pick what happened' });
    if (!YMD_RE.test(String(b.incidentDate || ''))) return res.status(400).json({ error: 'Please enter the date' });
    if (isBlank(b.description)) return res.status(400).json({ error: 'Please describe what happened' });
    if (!isBlank(b.incidentTime) && !HHMM_RE.test(String(b.incidentTime))) return res.status(400).json({ error: 'Time must be HH:MM' });
    const today = await todayChicago();
    if (b.incidentDate > today) return res.status(400).json({ error: "The date can't be in the future" });

    const photos = Array.isArray(b.photos) ? b.photos : [];
    if (photos.length > 3) return res.status(400).json({ error: 'Up to 3 photos' });
    for (const ph of photos) {
      const parsed = parseDataUri(ph && ph.dataUri);
      if (!parsed || !parsed.mime.startsWith('image/') || !ATTACHMENT_ALLOWED_MIME.includes(parsed.mime)) return res.status(400).json({ error: 'Photos must be images' });
      if (ph.dataUri.length > ATTACHMENT_MAX_DATA_URI_LENGTH) return res.status(400).json({ error: 'A photo is too large' });
    }

    // Same "whose clients are these" rule as GET /api/clients, plus a visit worked
    // there in the last 30 days (a report can come in after the assignment ended).
    if (req.user.role !== 'admin') {
      const access = await db.query(`
        SELECT 1 FROM clients c
         WHERE c.id = $1 AND c.is_active = true
           AND (EXISTS (SELECT 1 FROM schedules s2 WHERE s2.client_id = c.id AND s2.caregiver_id = $2 AND s2.is_active = true)
             OR EXISTS (SELECT 1 FROM schedule_exceptions se JOIN schedules s3 ON s3.id = se.schedule_id AND s3.is_active = true
                         WHERE se.override_caregiver_id = $2 AND se.exception_type = 'modified'
                           AND COALESCE(se.override_client_id, s3.client_id) = c.id
                           AND se.exception_date >= (now() AT TIME ZONE 'America/Chicago')::date)
             OR EXISTS (SELECT 1 FROM time_entries te WHERE te.client_id = c.id AND te.caregiver_id = $2
                           AND te.start_time >= NOW() - INTERVAL '30 days'))`,
        [b.clientId, req.user.id]);
      if (access.rows.length === 0) return res.status(403).json({ error: 'You can only report incidents for your own clients' });
    }

    const [who, client] = await Promise.all([
      db.query(`SELECT first_name, last_name FROM users WHERE id = $1`, [req.user.id]),
      db.query(`SELECT first_name, last_name FROM clients WHERE id = $1`, [b.clientId]),
    ]);
    const reporterName = who.rows[0] ? `${who.rows[0].first_name} ${who.rows[0].last_name}`.replace(/\s+/g, ' ').trim() : 'Caregiver';
    const clientName = client.rows[0] ? `${client.rows[0].first_name} ${client.rows[0].last_name}`.replace(/\s+/g, ' ').trim() : 'client';

    const incident = await insertIncident({
      clientId: b.clientId,
      caregiverId: req.user.role === 'caregiver' ? req.user.id : orNull(b.caregiverId),
      incidentType: b.incidentType, severity: 'moderate',
      incidentDate: b.incidentDate, incidentTime: orNull(b.incidentTime),
      description: String(b.description).trim(), witnesses: orNull(b.witnesses),
      injuriesOrDamage: orNull(b.injuriesOrDamage), actionsTaken: orNull(b.actionsTaken),
      reportedBy: reporterName, reportedDate: today,
    }, req.user.id, 'open');

    await addTimelineNote(db, incident.id, 'note', `Reported by ${reporterName} through the caregiver app.`, req.user.id, today);
    for (const ph of photos) {
      const parsed = parseDataUri(ph.dataUri);
      await db.query(
        `INSERT INTO incident_attachments (incident_id, category, file_name, mime_type, file_size, file_data, description, uploaded_by)
         VALUES ($1, 'photo', $2, $3, $4, $5, $6, $7)`,
        [incident.id, safeFileName(ph.fileName || 'photo.jpg'), parsed.mime, Math.floor(parsed.base64.length * 3 / 4), ph.dataUri,
         `Photo from ${reporterName}`, req.user.id]);
    }
    await auditLog(req.user.id, 'CREATE', 'incident_reports', incident.id, null, withoutSignature(incident));

    await notifyAdmins('incident_alert', `⚠️ Incident reported: ${clientName}`,
      `${reporterName} reported ${INCIDENT_TYPES[b.incidentType]} for ${clientName} on ${b.incidentDate}${b.incidentTime ? ` at ${b.incidentTime}` : ''}: ${String(b.description).trim().slice(0, 300)}\n\nOpen Clinical → Incidents (${incident.incident_number}).`);

    res.status(201).json({ success: true, id: incident.id, incidentNumber: incident.incident_number });
  } catch (error) {
    console.error('[incident caregiver-report]', error);
    res.status(500).json({ error: error.message });
  }
});

router.get('/incidents/:id', verifyToken, requireAdmin, async (req, res) => {
  try {
    const result = await db.query(`
      SELECT ir.*, ${INCIDENT_YMD_COLUMNS},
             c.first_name||' '||c.last_name as client_name, u.first_name||' '||u.last_name as caregiver_name,
             c.is_private_pay, rs.name AS payer_name,
             ru.first_name||' '||ru.last_name AS entered_by_name, ru.role AS reported_by_role
        FROM incident_reports ir
        LEFT JOIN clients c ON ir.client_id=c.id
        LEFT JOIN referral_sources rs ON rs.id = c.referral_source_id
        LEFT JOIN users u ON ir.caregiver_id=u.id
        LEFT JOIN users ru ON ru.id = ir.reported_by_user_id
       WHERE ir.id=$1`, [req.params.id]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'Incident not found' });
    res.json(result.rows[0]);
  } catch (error) { res.status(500).json({ error: error.message }); }
});

router.get('/incidents', verifyToken, requireAdmin, async (req, res) => {
  try {
    const result = await db.query(`
      SELECT ir.*, ${INCIDENT_YMD_COLUMNS},
             c.first_name||' '||c.last_name as client_name, u.first_name||' '||u.last_name as caregiver_name,
             ru.role AS reported_by_role,
             (SELECT COUNT(*)::int FROM incident_investigation_notes n WHERE n.incident_id = ir.id) AS note_count,
             (SELECT COUNT(*)::int FROM incident_attachments a WHERE a.incident_id = ir.id) AS attachment_count
        FROM incident_reports ir
        LEFT JOIN clients c ON ir.client_id=c.id
        LEFT JOIN users u ON ir.caregiver_id=u.id
        LEFT JOIN users ru ON ru.id = ir.reported_by_user_id
       ORDER BY ir.incident_date DESC, ir.incident_time DESC`);
    res.json(result.rows.map(withoutSignature));
  } catch (error) { res.status(500).json({ error: error.message }); }
});

router.post('/incidents', verifyToken, requireAdmin, async (req, res) => {
  try {
    const err = validateIncidentBody(req.body || {});
    if (err) return res.status(400).json({ error: err });
    const incident = await insertIncident(req.body, req.user.id, req.body.status || 'open');
    await auditLog(req.user.id, 'CREATE', 'incident_reports', incident.id, null, withoutSignature(incident));
    res.status(201).json(withoutSignature(incident));
  } catch (error) { res.status(500).json({ error: error.message }); }
});

// Full edit of the case fields (the older PATCH below stays for compatibility; it
// COALESCEs, so it can never clear a field).
router.put('/incidents/:id', verifyToken, requireAdmin, async (req, res) => {
  try {
    const b = req.body || {};
    const err = validateIncidentBody(b);
    if (err) return res.status(400).json({ error: err });
    const prev = await db.query(`SELECT * FROM incident_reports WHERE id = $1`, [req.params.id]);
    if (prev.rows.length === 0) return res.status(404).json({ error: 'Incident not found' });
    const p = prev.rows[0];

    // caregiver_removal points at THIS caregiver's schedules for THIS client.
    const removalActive = p.caregiver_removed_from && !p.caregiver_returned_on;
    if (removalActive && (b.clientId !== p.client_id || orNull(b.caregiverId) !== p.caregiver_id)) {
      return res.status(409).json({ error: 'Return the caregiver to the schedule before changing the client or caregiver on this incident.' });
    }

    const status = b.status || p.status || 'open';
    let closedDate = orNull(b.closedDate);
    if (status === 'closed' && !closedDate) closedDate = await todayChicago();
    if (status !== 'closed') closedDate = null;

    const r = await db.query(
      `UPDATE incident_reports SET
         client_id=$1, caregiver_id=$2, incident_type=$3, severity=$4, incident_date=$5, incident_time=$6,
         description=$7, witnesses=$8, injuries_or_damage=$9, actions_taken=$10, follow_up_required=$11, follow_up_notes=$12,
         reported_by=$13, reported_date=$14, reporter_contact_name=$15, reporter_phone=$16, reporter_email=$17,
         response_due_date=$18, response_sent_date=$19, status=$20, disposition=$21, findings=$22,
         mandatory_report_status=$23, mandatory_report_details=$24, closed_date=$25, updated_at=NOW()
       WHERE id=$26 RETURNING *`,
      [b.clientId, orNull(b.caregiverId), b.incidentType, b.severity || p.severity || 'moderate', b.incidentDate, orNull(b.incidentTime),
       String(b.description).trim(), orNull(b.witnesses), orNull(b.injuriesOrDamage), orNull(b.actionsTaken), !!b.followUpRequired, orNull(b.followUpNotes),
       orNull(b.reportedBy), orNull(b.reportedDate), orNull(b.reporterContactName), orNull(b.reporterPhone), orNull(b.reporterEmail),
       orNull(b.responseDueDate), orNull(b.responseSentDate), status, orNull(b.disposition), orNull(b.findings),
       orNull(b.mandatoryReportStatus), orNull(b.mandatoryReportDetails), closedDate, req.params.id]
    );
    await auditLog(req.user.id, 'UPDATE', 'incident_reports', req.params.id, withoutSignature(p), withoutSignature(r.rows[0]));
    res.json(withoutSignature(r.rows[0]));
  } catch (error) { res.status(500).json({ error: error.message }); }
});

router.patch('/incidents/:id', verifyToken, requireAdmin, async (req, res) => {
  try {
    const { severity, injuriesOrDamage, actionsTaken, followUpRequired, followUpNotes } = req.body;
    const result = await db.query(
      `UPDATE incident_reports SET severity=COALESCE($1,severity), injuries_or_damage=COALESCE($2,injuries_or_damage), actions_taken=COALESCE($3,actions_taken), follow_up_required=COALESCE($4,follow_up_required), follow_up_notes=COALESCE($5,follow_up_notes), updated_at=NOW() WHERE id=$6 RETURNING *`,
      [severity, injuriesOrDamage, actionsTaken, followUpRequired, followUpNotes, req.params.id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Incident not found' });
    await auditLog(req.user.id, 'UPDATE', 'incident_reports', req.params.id, null, result.rows[0]);
    res.json(result.rows[0]);
  } catch (error) { res.status(500).json({ error: error.message }); }
});

router.delete('/incidents/:id', verifyToken, requireAdmin, async (req, res) => {
  try {
    // A caregiver still removed from the schedule by this incident must be returned
    // first — deleting would orphan the paused schedules with no way to restore them.
    const cur = await db.query(`SELECT caregiver_removed_from, caregiver_returned_on FROM incident_reports WHERE id=$1`, [req.params.id]);
    if (cur.rows.length === 0) return res.status(404).json({ error: 'Incident not found' });
    if (cur.rows[0].caregiver_removed_from && !cur.rows[0].caregiver_returned_on) {
      return res.status(409).json({ error: 'Return the caregiver to the schedule before deleting this incident.' });
    }
    const result = await db.query(`DELETE FROM incident_reports WHERE id=$1 RETURNING *`, [req.params.id]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'Incident not found' });
    await auditLog(req.user.id, 'DELETE', 'incident_reports', req.params.id, null, withoutSignature(result.rows[0]));
    res.json({ message: 'Incident report deleted' });
  } catch (error) { res.status(500).json({ error: error.message }); }
});

// ── Investigation timeline ──────────────────────────────────────────────────
router.get('/incidents/:id/notes', verifyToken, requireAdmin, async (req, res) => {
  try {
    const r = await db.query(`
      SELECT n.id, n.incident_id, n.entry_type, n.summary, n.created_at,
             to_char(n.entry_date, 'YYYY-MM-DD') AS entry_date_ymd,
             u.first_name||' '||u.last_name AS created_by_name
        FROM incident_investigation_notes n
        LEFT JOIN users u ON u.id = n.created_by
       WHERE n.incident_id = $1
       ORDER BY n.entry_date, n.created_at`, [req.params.id]);
    res.json(r.rows);
  } catch (error) { res.status(500).json({ error: error.message }); }
});

router.post('/incidents/:id/notes', verifyToken, requireAdmin, async (req, res) => {
  try {
    const { entryDate, entryType, summary } = req.body || {};
    if (!YMD_RE.test(String(entryDate || ''))) return res.status(400).json({ error: 'Date is required' });
    if (!ENTRY_TYPES[entryType]) return res.status(400).json({ error: 'Entry type is not valid' });
    if (isBlank(summary)) return res.status(400).json({ error: 'Describe what happened' });
    if (String(summary).length > 5000) return res.status(400).json({ error: 'Keep the entry under 5,000 characters' });
    const inc = await db.query(`SELECT id FROM incident_reports WHERE id = $1`, [req.params.id]);
    if (inc.rows.length === 0) return res.status(404).json({ error: 'Incident not found' });
    const r = await db.query(
      `INSERT INTO incident_investigation_notes (incident_id, entry_date, entry_type, summary, created_by)
       VALUES ($1, $2::date, $3, $4, $5) RETURNING *`,
      [req.params.id, entryDate, entryType, String(summary).trim(), req.user.id]);
    await auditLog(req.user.id, 'CREATE', 'incident_investigation_notes', r.rows[0].id, null, r.rows[0]);
    res.status(201).json(r.rows[0]);
  } catch (error) { res.status(500).json({ error: error.message }); }
});

router.delete('/incidents/:id/notes/:noteId', verifyToken, requireAdmin, async (req, res) => {
  try {
    const r = await db.query(`DELETE FROM incident_investigation_notes WHERE id = $1 AND incident_id = $2 RETURNING *`, [req.params.noteId, req.params.id]);
    if (r.rows.length === 0) return res.status(404).json({ error: 'Entry not found' });
    await auditLog(req.user.id, 'DELETE', 'incident_investigation_notes', req.params.noteId, r.rows[0], null);
    res.json({ message: 'Entry deleted' });
  } catch (error) { res.status(500).json({ error: error.message }); }
});

// ── Attachments (stored in the database; see migration v64) ─────────────────
router.get('/incidents/:id/attachments', verifyToken, requireAdmin, async (req, res) => {
  try {
    const r = await db.query(`
      SELECT a.id, a.incident_id, a.category, a.file_name, a.mime_type, a.file_size, a.description, a.created_at,
             u.first_name||' '||u.last_name AS uploaded_by_name
        FROM incident_attachments a
        LEFT JOIN users u ON u.id = a.uploaded_by
       WHERE a.incident_id = $1
       ORDER BY a.created_at`, [req.params.id]);
    res.json(r.rows);
  } catch (error) { res.status(500).json({ error: error.message }); }
});

router.get('/incidents/:id/attachments/:attachmentId', verifyToken, requireAdmin, async (req, res) => {
  try {
    const r = await db.query(`SELECT file_name, mime_type, file_data FROM incident_attachments WHERE id = $1 AND incident_id = $2`, [req.params.attachmentId, req.params.id]);
    if (r.rows.length === 0) return res.status(404).json({ error: 'Attachment not found' });
    const parsed = parseDataUri(r.rows[0].file_data);
    if (!parsed) return res.status(500).json({ error: 'Stored file is unreadable' });
    res.setHeader('Content-Type', r.rows[0].mime_type);
    res.setHeader('Content-Disposition', `inline; filename="${safeFileName(r.rows[0].file_name)}"`);
    res.send(Buffer.from(parsed.base64, 'base64'));
  } catch (error) { res.status(500).json({ error: error.message }); }
});

router.post('/incidents/:id/attachments', verifyToken, requireAdmin, async (req, res) => {
  try {
    const { category, fileName, dataUri, description } = req.body || {};
    if (!ATTACHMENT_CATEGORIES[category]) return res.status(400).json({ error: 'Pick what kind of document this is' });
    if (isBlank(fileName)) return res.status(400).json({ error: 'File name is required' });
    const parsed = parseDataUri(dataUri);
    if (!parsed) return res.status(400).json({ error: 'The file could not be read' });
    if (!ATTACHMENT_ALLOWED_MIME.includes(parsed.mime)) return res.status(400).json({ error: 'Only PDF and image files can be attached' });
    if (dataUri.length > ATTACHMENT_MAX_DATA_URI_LENGTH) return res.status(400).json({ error: 'File is too large (7 MB max)' });
    const inc = await db.query(`SELECT id FROM incident_reports WHERE id = $1`, [req.params.id]);
    if (inc.rows.length === 0) return res.status(404).json({ error: 'Incident not found' });
    const r = await db.query(
      `INSERT INTO incident_attachments (incident_id, category, file_name, mime_type, file_size, file_data, description, uploaded_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       RETURNING id, incident_id, category, file_name, mime_type, file_size, description, created_at`,
      [req.params.id, category, safeFileName(fileName), parsed.mime, Math.floor(parsed.base64.length * 3 / 4), dataUri, orNull(description), req.user.id]);
    await auditLog(req.user.id, 'CREATE', 'incident_attachments', r.rows[0].id, null, r.rows[0]);
    res.status(201).json(r.rows[0]);
  } catch (error) { res.status(500).json({ error: error.message }); }
});

router.delete('/incidents/:id/attachments/:attachmentId', verifyToken, requireAdmin, async (req, res) => {
  try {
    const r = await db.query(
      `DELETE FROM incident_attachments WHERE id = $1 AND incident_id = $2
       RETURNING id, incident_id, category, file_name, mime_type, file_size, description`,
      [req.params.attachmentId, req.params.id]);
    if (r.rows.length === 0) return res.status(404).json({ error: 'Attachment not found' });
    await auditLog(req.user.id, 'DELETE', 'incident_attachments', req.params.attachmentId, r.rows[0], null);
    res.json({ message: 'Attachment deleted' });
  } catch (error) { res.status(500).json({ error: error.message }); }
});

// ── Caregiver schedule for this client (read) ───────────────────────────────
router.get('/incidents/:id/caregiver-schedule', verifyToken, requireAdmin, async (req, res) => {
  try {
    const inc = await db.query(`
      SELECT ir.client_id, ir.caregiver_id, ir.caregiver_removal, ${INCIDENT_YMD_COLUMNS}
        FROM incident_reports ir WHERE ir.id = $1`, [req.params.id]);
    if (inc.rows.length === 0) return res.status(404).json({ error: 'Incident not found' });
    const i = inc.rows[0];
    if (!i.caregiver_id) return res.json({ caregiverId: null, schedules: [], upcomingVisits: 0, lastVisit: null });
    const today = await todayChicago();
    const [sched, upcoming, last] = await Promise.all([
      db.query(`
        SELECT s.id, s.day_of_week, to_char(s.date, 'YYYY-MM-DD') AS date,
               s.start_time::text AS start_time, s.end_time::text AS end_time, s.frequency,
               to_char(s.end_date, 'YYYY-MM-DD') AS end_date,
               to_char(s.suspended_from, 'YYYY-MM-DD') AS suspended_from
          FROM schedules s
         WHERE s.caregiver_id = $1 AND s.client_id = $2 AND s.is_active = true
           AND ((s.day_of_week IS NULL AND s.date >= $3::date)
                OR (s.day_of_week IS NOT NULL AND (s.end_date IS NULL OR s.end_date >= $3::date)))
         ORDER BY s.day_of_week NULLS LAST, s.date, s.start_time`, [i.caregiver_id, i.client_id, today]),
      db.query(`
        WITH ${SCHEDULE_OCCURRENCES_CTE('occ')}
        SELECT COUNT(*)::int AS n FROM occ WHERE occ.caregiver_id = $3 AND occ.client_id = $4`,
        [today, (await db.query(`SELECT to_char($1::date + 27, 'YYYY-MM-DD') AS d`, [today])).rows[0].d, i.caregiver_id, i.client_id]),
      db.query(`
        SELECT to_char(MAX((start_time AT TIME ZONE 'America/Chicago')::date), 'YYYY-MM-DD') AS d
          FROM time_entries WHERE client_id = $1 AND caregiver_id = $2`, [i.client_id, i.caregiver_id]),
    ]);
    res.json({
      caregiverId: i.caregiver_id,
      removedFrom: i.caregiver_removed_from_ymd, returnedOn: i.caregiver_returned_on_ymd,
      removal: i.caregiver_removal, today,
      schedules: sched.rows, upcomingVisits: upcoming.rows[0].n, lastVisit: last.rows[0].d,
    });
  } catch (error) { res.status(500).json({ error: error.message }); }
});

// ── Remove caregiver from this client pending investigation ────────────────
// Pauses THIS caregiver's schedules for THIS client via schedules.suspended_from (the
// shared engine then stops billing, payroll, reminders, no-show and the phone for them).
// Before pausing:
//   • his upcoming visits are expanded and posted as open shifts with NO schedule_id, so
//     an approved claim becomes its own one-time visit (an override on a paused pattern
//     would never generate — see openShiftsRoutes approve);
//   • visits on his patterns already covered by ANOTHER caregiver (per-day override) are
//     turned into that caregiver's own one-time shifts, or the pause would erase them;
//   • visits he covers on other caregivers' patterns for this client are released and
//     reposted for coverage.
// Every change is recorded in caregiver_removal so return-caregiver can undo it exactly.
router.post('/incidents/:id/remove-caregiver', verifyToken, requireAdmin, async (req, res) => {
  const tx = await db.pool.connect();
  let committed = false;
  try {
    await tx.query('BEGIN');
    const incR = await tx.query(`
      SELECT ir.id, ir.incident_number, ir.client_id, ir.caregiver_id,
             to_char(ir.caregiver_removed_from, 'YYYY-MM-DD') AS removed_from, ir.caregiver_returned_on,
             c.first_name||' '||c.last_name AS client_name, c.care_type_id,
             u.first_name||' '||u.last_name AS caregiver_name
        FROM incident_reports ir
        JOIN clients c ON c.id = ir.client_id
        LEFT JOIN users u ON u.id = ir.caregiver_id
       WHERE ir.id = $1
       FOR UPDATE OF ir`, [req.params.id]);
    if (incR.rows.length === 0) throw new IncidentHttpError(404, 'Incident not found');
    const inc = incR.rows[0];
    const caregiverName = String(inc.caregiver_name || '').replace(/\s+/g, ' ').trim();
    const clientName = String(inc.client_name || '').replace(/\s+/g, ' ').trim();
    if (!inc.caregiver_id) throw new IncidentHttpError(400, 'This incident has no caregiver to remove.');
    if (inc.removed_from && !inc.caregiver_returned_on) throw new IncidentHttpError(409, `This caregiver is already removed, effective ${inc.removed_from}.`);

    const today = await todayChicago(tx);
    const fromDate = isBlank(req.body?.fromDate) ? today : String(req.body.fromDate);
    if (!YMD_RE.test(fromDate)) throw new IncidentHttpError(400, 'Start date must be a valid date');
    if (fromDate < today) throw new IncidentHttpError(400, 'Removal can start today or later. Visits already worked stay as they are.');
    const postOpenShifts = req.body?.postOpenShifts !== false;
    const coverageWeeks = Math.min(12, Math.max(1, parseInt(req.body?.coverageWeeks, 10) || 4));
    const toDate = (await tx.query(`SELECT to_char($1::date + ($2::int * 7 - 1), 'YYYY-MM-DD') AS d`, [fromDate, coverageWeeks])).rows[0].d;

    const sched = await tx.query(`
      SELECT id, to_char(suspended_from, 'YYYY-MM-DD') AS suspended_from
        FROM schedules
       WHERE caregiver_id = $1 AND client_id = $2 AND is_active = true
         AND ((day_of_week IS NULL AND date >= $3::date)
              OR (day_of_week IS NOT NULL AND (end_date IS NULL OR end_date >= $3::date)))
       FOR UPDATE`, [inc.caregiver_id, inc.client_id, fromDate]);
    // Rows already paused on/before fromDate stay exactly as they are.
    const targets = sched.rows.filter(r => !r.suspended_from || r.suspended_from > fromDate);
    const targetIds = targets.map(r => r.id);

    const own = (postOpenShifts && targetIds.length) ? (await tx.query(`
      WITH ${SCHEDULE_OCCURRENCES_CTE('occ')}
      SELECT occ.schedule_id, occ.occ_date::text AS shift_date,
             occ.start_time::text AS start_time, occ.end_time::text AS end_time
        FROM occ JOIN schedules s ON s.id = occ.schedule_id
       WHERE occ.schedule_id = ANY($3::uuid[]) AND occ.caregiver_id = $4 AND s.is_training IS NOT TRUE
       ORDER BY occ.occ_date, occ.start_time`, [fromDate, toDate, targetIds, inc.caregiver_id])).rows : [];

    const coveredByOthers = targetIds.length ? (await tx.query(`
      SELECT se.id AS exception_id, se.schedule_id, to_char(se.exception_date, 'YYYY-MM-DD') AS d,
             COALESCE(se.override_start_time, s.start_time)::text AS start_time,
             COALESCE(se.override_end_time, s.end_time)::text AS end_time,
             se.override_caregiver_id, COALESCE(se.override_client_id, s.client_id) AS client_id, s.notes
        FROM schedule_exceptions se JOIN schedules s ON s.id = se.schedule_id
       WHERE se.schedule_id = ANY($1::uuid[]) AND se.exception_type = 'modified'
         AND se.override_caregiver_id IS NOT NULL AND se.override_caregiver_id <> $2
         AND se.exception_date >= $3::date`, [targetIds, inc.caregiver_id, fromDate])).rows : [];
    const converted = [];
    for (const o of coveredByOthers) {
      const ins = await tx.query(
        `INSERT INTO schedules (client_id, caregiver_id, schedule_type, date, start_time, end_time, notes)
         VALUES ($1, $2, 'one-time', $3::date, $4::time, $5::time, $6) RETURNING id`,
        [o.client_id, o.override_caregiver_id, o.d, o.start_time, o.end_time, o.notes]);
      await tx.query(`UPDATE schedule_exceptions SET exception_type = 'cancelled' WHERE id = $1`, [o.exception_id]);
      converted.push({ exception_id: o.exception_id, schedule_id: o.schedule_id, date: o.d, new_schedule_id: ins.rows[0].id, caregiver_id: o.override_caregiver_id });
    }

    const movedIn = (await tx.query(`
      SELECT se.id AS exception_id, se.schedule_id, to_char(se.exception_date, 'YYYY-MM-DD') AS d,
             COALESCE(se.override_start_time, s.start_time)::text AS start_time,
             COALESCE(se.override_end_time, s.end_time)::text AS end_time
        FROM schedule_exceptions se JOIN schedules s ON s.id = se.schedule_id AND s.is_active = true
       WHERE se.exception_type = 'modified' AND se.override_caregiver_id = $1
         AND COALESCE(se.override_client_id, s.client_id) = $2
         AND s.caregiver_id <> $1
         AND se.exception_date >= $3::date
         AND (s.suspended_from IS NULL OR se.exception_date < s.suspended_from)`,
      [inc.caregiver_id, inc.client_id, fromDate])).rows;
    for (const m of movedIn) {
      await tx.query(`UPDATE schedule_exceptions SET exception_type = 'cancelled' WHERE id = $1`, [m.exception_id]);
    }

    if (targetIds.length) {
      await tx.query(`UPDATE schedules SET suspended_from = $2::date, updated_at = NOW() WHERE id = ANY($1::uuid[])`, [targetIds, fromDate]);
    }

    const openShifts = [];
    if (postOpenShifts) {
      const toCover = [
        ...own.map(o => ({ ...o, source: 'own', exception_id: null })),
        ...movedIn.map(m => ({ schedule_id: m.schedule_id, shift_date: m.d, start_time: m.start_time, end_time: m.end_time, source: 'covering', exception_id: m.exception_id })),
      ];
      for (const o of toCover) {
        const dup = await tx.query(
          `SELECT id FROM open_shifts WHERE client_id = $1 AND shift_date = $2::date AND start_time = $3::time
             AND status IN ('open','claimed','filled') LIMIT 1`, [inc.client_id, o.shift_date, o.start_time]);
        if (dup.rows.length) continue;
        // Notes are shown to caregivers browsing open shifts: keep them neutral.
        const ins = await tx.query(
          `INSERT INTO open_shifts (client_id, schedule_id, shift_date, start_time, end_time, care_type_id,
                                    urgency, status, notes, auto_created, created_by)
           VALUES ($1, NULL, $2::date, $3::time, $4::time, $5, 'high', 'open', 'Coverage needed', true, $6) RETURNING id`,
          [inc.client_id, o.shift_date, o.start_time, o.end_time, inc.care_type_id, req.user.id]);
        openShifts.push({ open_shift_id: ins.rows[0].id, schedule_id: o.schedule_id, shift_date: o.shift_date, source: o.source, exception_id: o.exception_id });
      }
    }

    const removal = {
      from_date: fromDate, coverage_to: postOpenShifts ? toDate : null, removed_by: req.user.id,
      schedules: targets.map(t => ({ schedule_id: t.id, prior_suspended_from: t.suspended_from })),
      already_paused: sched.rows.filter(r => r.suspended_from && r.suspended_from <= fromDate).map(r => r.id),
      converted_overrides: converted,
      released_covers: movedIn.map(m => ({ exception_id: m.exception_id, schedule_id: m.schedule_id, date: m.d })),
      open_shifts: openShifts,
    };
    await tx.query(
      `UPDATE incident_reports SET caregiver_removed_from = $2::date, caregiver_returned_on = NULL,
              caregiver_removal = $3::jsonb, updated_at = NOW() WHERE id = $1`,
      [inc.id, fromDate, JSON.stringify(removal)]);

    const summary = `Removed ${caregiverName} from ${clientName}'s schedule effective ${fromDate}. `
      + `${targets.length} schedule${targets.length === 1 ? '' : 's'} paused. `
      + (postOpenShifts ? `${openShifts.length} upcoming visit${openShifts.length === 1 ? '' : 's'} through ${toDate} posted as open shifts for coverage.` : 'No open shifts posted.')
      + (converted.length ? ` ${converted.length} visit${converted.length === 1 ? '' : 's'} already covered by other caregivers kept as their own shifts.` : '')
      + (movedIn.length ? ` ${movedIn.length} visit${movedIn.length === 1 ? '' : 's'} this caregiver was covering for others released.` : '');
    await addTimelineNote(tx, inc.id, 'schedule', summary, req.user.id, today);

    await tx.query('COMMIT');
    committed = true;

    for (const t of targets) {
      await auditLog(req.user.id, 'SUSPEND', 'schedules', t.id, { suspended_from: t.suspended_from },
        { scope: 'incident_caregiver_removal', suspended_from: fromDate, incident_id: inc.id }, 'incident_removal');
    }
    for (const c of converted) {
      await auditLog(req.user.id, 'CREATE', 'schedules', c.new_schedule_id, null,
        { from_override: c.exception_id, caregiver_id: c.caregiver_id, date: c.date, incident_id: inc.id }, 'incident_removal');
    }
    await auditLog(req.user.id, 'CAREGIVER_REMOVED', 'incident_reports', inc.id, null, removal, 'incident_removal');

    res.json({ success: true, fromDate, schedulesPaused: targets.length, openShiftsPosted: openShifts.length,
               coveredVisitsKept: converted.length, coversReleased: movedIn.length, summary });
  } catch (error) {
    if (!committed) { try { await tx.query('ROLLBACK'); } catch (_) { /* already failed */ } }
    if (error instanceof IncidentHttpError) return res.status(error.status).json({ error: error.message });
    console.error('[incident remove-caregiver]', error);
    res.status(500).json({ error: error.message });
  } finally {
    tx.release();
  }
});

// ── Return caregiver to this client's schedule ──────────────────────────────
// Restores each paused row to its PRIOR suspended_from (only if nobody changed it since).
// Coverage still unclaimed is cancelled. Coverage a replacement already took is kept, and
// this caregiver's own copy of that day is cancelled so the visit isn't double-staffed.
router.post('/incidents/:id/return-caregiver', verifyToken, requireAdmin, async (req, res) => {
  const tx = await db.pool.connect();
  let committed = false;
  try {
    await tx.query('BEGIN');
    const incR = await tx.query(`
      SELECT ir.id, ir.client_id, ir.caregiver_id, ir.caregiver_removal,
             to_char(ir.caregiver_removed_from, 'YYYY-MM-DD') AS removed_from, ir.caregiver_returned_on,
             c.first_name||' '||c.last_name AS client_name, u.first_name||' '||u.last_name AS caregiver_name
        FROM incident_reports ir
        JOIN clients c ON c.id = ir.client_id
        LEFT JOIN users u ON u.id = ir.caregiver_id
       WHERE ir.id = $1
       FOR UPDATE OF ir`, [req.params.id]);
    if (incR.rows.length === 0) throw new IncidentHttpError(404, 'Incident not found');
    const inc = incR.rows[0];
    if (!inc.removed_from || inc.caregiver_returned_on) throw new IncidentHttpError(409, 'The caregiver is not currently removed from this schedule.');
    const removal = inc.caregiver_removal || {};
    const today = await todayChicago(tx);

    const restored = [], skipped = [];
    for (const s of removal.schedules || []) {
      const r = await tx.query(
        `UPDATE schedules SET suspended_from = $2::date, updated_at = NOW()
          WHERE id = $1 AND is_active = true AND suspended_from = $3::date RETURNING id`,
        [s.schedule_id, s.prior_suspended_from, removal.from_date]);
      (r.rows.length ? restored : skipped).push(s.schedule_id);
    }

    let cancelledOpenShifts = 0;
    const keptReplacements = [];
    const postedCoverExceptions = new Set();
    for (const o of removal.open_shifts || []) {
      if (o.exception_id) postedCoverExceptions.add(o.exception_id);
      const os = await tx.query(`SELECT status, to_char(shift_date, 'YYYY-MM-DD') AS d FROM open_shifts WHERE id = $1`, [o.open_shift_id]);
      if (os.rows.length === 0) continue;
      const { status, d } = os.rows[0];
      if (d < today) continue;
      if (['open', 'claimed'].includes(status)) {
        await tx.query(`UPDATE open_shifts SET status = 'cancelled' WHERE id = $1 AND status IN ('open','claimed')`, [o.open_shift_id]);
        cancelledOpenShifts++;
        if (o.source === 'covering' && o.exception_id) {
          await tx.query(`UPDATE schedule_exceptions SET exception_type = 'modified' WHERE id = $1 AND exception_type = 'cancelled'`, [o.exception_id]);
        }
      } else if (status === 'filled') {
        if (o.source === 'own' && o.schedule_id) {
          await tx.query(
            `INSERT INTO schedule_exceptions (schedule_id, exception_date, exception_type, created_by)
             VALUES ($1, $2::date, 'cancelled', $3)
             ON CONFLICT (schedule_id, exception_date) DO UPDATE SET exception_type = 'cancelled'`,
            [o.schedule_id, d, req.user.id]);
        }
        keptReplacements.push({ open_shift_id: o.open_shift_id, date: d });
      }
    }
    // Covers released without being posted (postOpenShifts was off): give them back.
    let restoredCovers = 0;
    for (const c of removal.released_covers || []) {
      if (postedCoverExceptions.has(c.exception_id) || c.date < today) continue;
      const r = await tx.query(`UPDATE schedule_exceptions SET exception_type = 'modified' WHERE id = $1 AND exception_type = 'cancelled' RETURNING id`, [c.exception_id]);
      restoredCovers += r.rows.length;
    }

    const returned = { returned_on: today, returned_by: req.user.id, restored, skipped, cancelled_open_shifts: cancelledOpenShifts, kept_replacements: keptReplacements, restored_covers: restoredCovers };
    await tx.query(
      `UPDATE incident_reports SET caregiver_returned_on = $2::date,
              caregiver_removal = COALESCE(caregiver_removal, '{}'::jsonb) || jsonb_build_object('returned', $3::jsonb),
              updated_at = NOW() WHERE id = $1`,
      [inc.id, today, JSON.stringify(returned)]);

    const caregiverName = String(inc.caregiver_name || '').replace(/\s+/g, ' ').trim();
    const clientName = String(inc.client_name || '').replace(/\s+/g, ' ').trim();
    const summary = `Returned ${caregiverName} to ${clientName}'s schedule on ${today}. `
      + `${restored.length} schedule${restored.length === 1 ? '' : 's'} restored`
      + (skipped.length ? `, ${skipped.length} left as-is because they were changed after the removal` : '') + '. '
      + `${cancelledOpenShifts} unclaimed coverage shift${cancelledOpenShifts === 1 ? '' : 's'} cancelled.`
      + (keptReplacements.length ? ` ${keptReplacements.length} visit${keptReplacements.length === 1 ? '' : 's'} already covered by a replacement stay with the replacement.` : '');
    await addTimelineNote(tx, inc.id, 'schedule', summary, req.user.id, today);

    await tx.query('COMMIT');
    committed = true;

    for (const id of restored) {
      await auditLog(req.user.id, 'RESUME', 'schedules', id, null, { scope: 'incident_caregiver_return', incident_id: inc.id }, 'incident_removal');
    }
    await auditLog(req.user.id, 'CAREGIVER_RETURNED', 'incident_reports', inc.id, null, returned, 'incident_removal');

    res.json({ success: true, restored: restored.length, skipped: skipped.length, cancelledOpenShifts, keptReplacements: keptReplacements.length, summary });
  } catch (error) {
    if (!committed) { try { await tx.query('ROLLBACK'); } catch (_) { /* already failed */ } }
    if (error instanceof IncidentHttpError) return res.status(error.status).json({ error: error.message });
    console.error('[incident return-caregiver]', error);
    res.status(500).json({ error: error.message });
  } finally {
    tx.release();
  }
});

// ── Signed training acknowledgement ─────────────────────────────────────────
// Signing records the acknowledgement on the incident AND adds completed
// training_records rows (medication_reminders, misappropriation_policy) to the
// caregiver's file, where Compliance → training shows them.
router.post('/incidents/:id/training-acknowledgement', verifyToken, requireAdmin, async (req, res) => {
  const tx = await db.pool.connect();
  let committed = false;
  try {
    const { signature, signerName, supervisorName, method } = req.body || {};
    const parsed = parseDataUri(signature);
    if (!parsed || !parsed.mime.startsWith('image/')) throw new IncidentHttpError(400, 'A drawn signature is required');
    if (String(signature).length > 2_000_000) throw new IncidentHttpError(400, 'Signature image is too large');
    if (isBlank(signerName)) throw new IncidentHttpError(400, "Type the caregiver's name");
    if (isBlank(supervisorName)) throw new IncidentHttpError(400, 'Enter who reviewed it with the caregiver');
    if (!TRAINING_ACK_METHODS[method]) throw new IncidentHttpError(400, 'Pick how it was reviewed');

    await tx.query('BEGIN');
    const incR = await tx.query(`SELECT id, caregiver_id, training_ack_signed_at FROM incident_reports WHERE id = $1 FOR UPDATE`, [req.params.id]);
    if (incR.rows.length === 0) throw new IncidentHttpError(404, 'Incident not found');
    const inc = incR.rows[0];
    if (!inc.caregiver_id) throw new IncidentHttpError(400, 'This incident has no caregiver');
    if (inc.training_ack_signed_at) throw new IncidentHttpError(409, 'The acknowledgement for this incident is already signed');
    const today = await todayChicago(tx);

    await tx.query(
      `UPDATE incident_reports SET training_ack_signed_at = NOW(), training_ack_signer_name = $2, training_ack_signature = $3,
              training_ack_supervisor = $4, training_ack_method = $5, updated_at = NOW() WHERE id = $1`,
      [inc.id, String(signerName).trim(), signature, String(supervisorName).trim(), method]);
    const provider = `${process.env.AGENCY_NAME || 'Chippewa Valley Home Care'}: reviewed with ${String(supervisorName).trim()}`.slice(0, 255);
    const records = [];
    for (const trainingType of TRAINING_ACK_TRAINING_TYPES) {
      const r = await tx.query(
        `INSERT INTO training_records (id, caregiver_id, training_type, completion_date, provider, status, recorded_by)
         VALUES ($1, $2, $3, $4::date, $5, 'completed', $6) RETURNING *`,
        [uuidv4(), inc.caregiver_id, trainingType, today, provider, req.user.id]);
      records.push(r.rows[0]);
    }
    await addTimelineNote(tx, inc.id, 'action',
      `${String(signerName).trim()} signed the medication handling and misappropriation training acknowledgement (${TRAINING_ACK_METHODS[method].toLowerCase()}), reviewed with ${String(supervisorName).trim()}. Added to the caregiver's training record.`,
      req.user.id, today);
    await tx.query('COMMIT');
    committed = true;

    for (const r of records) await auditLog(req.user.id, 'CREATE', 'training_records', r.id, null, r);
    // SignaturePad tells the signer "Your IP address and timestamp will be recorded".
    await auditLog(req.user.id, 'TRAINING_ACK_SIGNED', 'incident_reports', inc.id, null,
      { training_ack_signer_name: String(signerName).trim(), training_ack_supervisor: String(supervisorName).trim(),
        training_ack_method: method, signed_from_ip: clientIp(req), signed_at: new Date().toISOString() });
    res.status(201).json({ success: true, trainingRecords: records.length });
  } catch (error) {
    if (!committed) { try { await tx.query('ROLLBACK'); } catch (_) { /* not started or already failed */ } }
    if (error instanceof IncidentHttpError) return res.status(error.status).json({ error: error.message });
    console.error('[incident training-acknowledgement]', error);
    res.status(500).json({ error: error.message });
  } finally {
    tx.release();
  }
});

// ── PDFs ────────────────────────────────────────────────────────────────────
async function sendIncidentPdf(req, res, kind) {
  try {
    const data = await incidentPdf.loadIncidentCase(db, req.params.id);
    if (!data) return res.status(404).json({ error: 'Incident not found' });
    const PDFDocument = require('pdfkit');
    const doc = new PDFDocument({ size: 'LETTER', margins: { top: 54, bottom: 62, left: 54, right: 54 }, bufferPages: true });
    const base = kind === 'packet' ? 'incident-response-packet' : 'incident-report';
    const name = `${base}-${data.incident.incident_number || req.params.id}.pdf`.replace(/[^A-Za-z0-9._-]/g, '_');
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${name}"`);
    doc.pipe(res);
    const includeSchedule = req.query?.includeSchedule === '1';
    if (kind === 'packet') incidentPdf.renderResponsePacketPdf(doc, data, { includeSchedule });
    else incidentPdf.renderIncidentReportPdf(doc, data);
    doc.end();
    // Same audit convention as reports.js logReportGeneration.
    await auditLog(req.user.id, 'REPORT_GENERATED_PDF', 'incident_reports', req.params.id, null, { report: base, includeSchedule: kind === 'packet' ? includeSchedule : undefined });
  } catch (error) {
    console.error(`[incident ${kind} PDF]`, error);
    if (!res.headersSent) res.status(500).json({ error: error.message });
  }
}
router.get('/incidents/:id/pdf', verifyToken, requireAdmin, (req, res) => sendIncidentPdf(req, res, 'report'));
router.get('/incidents/:id/response-packet', verifyToken, requireAdmin, (req, res) => sendIncidentPdf(req, res, 'packet'));

// ─── PERFORMANCE REVIEWS ──────────────────────────────────────────────────────

router.get('/performance-reviews/summary/:caregiverId', verifyToken, requireAdmin, async (req, res) => {
  try {
    res.json((await db.query(`SELECT COUNT(*) as total_reviews, AVG(CASE WHEN overall_assessment='excellent' THEN 3 WHEN overall_assessment='satisfactory' THEN 2 WHEN overall_assessment='needs_improvement' THEN 1 ELSE 0 END) as avg_score, COUNT(CASE WHEN overall_assessment='excellent' THEN 1 END) as excellent_count, COUNT(CASE WHEN overall_assessment='satisfactory' THEN 1 END) as satisfactory_count, COUNT(CASE WHEN overall_assessment='needs_improvement' THEN 1 END) as needs_improvement_count, MAX(review_date) as last_review_date FROM performance_reviews WHERE caregiver_id=$1`, [req.params.caregiverId])).rows[0]);
  } catch (error) { res.status(500).json({ error: error.message }); }
});

router.get('/performance-reviews/:caregiverId', verifyToken, requireAdmin, async (req, res) => {
  try {
    res.json((await db.query(`SELECT pr.*, cl.first_name||' '||cl.last_name as client_name FROM performance_reviews pr LEFT JOIN clients cl ON pr.client_id=cl.id WHERE pr.caregiver_id=$1 ORDER BY pr.review_date DESC`, [req.params.caregiverId])).rows);
  } catch (error) { res.status(500).json({ error: error.message }); }
});

router.get('/performance-reviews', verifyToken, requireAdmin, async (req, res) => {
  try {
    res.json((await db.query(`SELECT pr.*, c.first_name||' '||c.last_name as caregiver_name, cl.first_name||' '||cl.last_name as client_name FROM performance_reviews pr LEFT JOIN users c ON pr.caregiver_id=c.id LEFT JOIN clients cl ON pr.client_id=cl.id ORDER BY pr.review_date DESC`)).rows);
  } catch (error) { res.status(500).json({ error: error.message }); }
});

router.post('/performance-reviews', verifyToken, requireAdmin, async (req, res) => {
  try {
    const { caregiverId, clientId, reviewDate, performanceNotes, strengths, areasForImprovement, overallAssessment } = req.body;
    if (!caregiverId || !clientId || !performanceNotes) return res.status(400).json({ error: 'Caregiver, client, and performance notes are required' });
    const reviewId = uuidv4();
    const result = await db.query(
      `INSERT INTO performance_reviews (id, caregiver_id, client_id, review_date, performance_notes, strengths, areas_for_improvement, overall_assessment, reviewed_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
      [reviewId, caregiverId, clientId, reviewDate, performanceNotes, strengths||null, areasForImprovement||null, overallAssessment||'satisfactory', req.user.id]
    );
    await auditLog(req.user.id, 'CREATE', 'performance_reviews', reviewId, null, result.rows[0]);
    res.status(201).json(result.rows[0]);
  } catch (error) { res.status(500).json({ error: error.message }); }
});

router.delete('/performance-reviews/:id', verifyToken, requireAdmin, async (req, res) => {
  try {
    const result = await db.query(`DELETE FROM performance_reviews WHERE id=$1 RETURNING *`, [req.params.id]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'Review not found' });
    await auditLog(req.user.id, 'DELETE', 'performance_reviews', req.params.id, null, result.rows[0]);
    res.json({ message: 'Review deleted' });
  } catch (error) { res.status(500).json({ error: error.message }); }
});

// ─── SCHEDULES ENHANCED ───────────────────────────────────────────────────────

router.post('/schedules-enhanced', verifyToken, async (req, res) => {
  try {
    const { caregiverId, clientId, scheduleType, dayOfWeek, date, startTime, endTime, notes, frequency, effectiveDate: rawEffectiveDate, anchorDate: rawAnchorDate, splitShift, isTraining } = req.body;
    if (!caregiverId || !clientId || !startTime || !endTime) return res.status(400).json({ error: 'Missing required fields' });

    // Recurring patterns MUST have an effective_date >= today. Anything else
    // back-fills past visits and triggers phantom auto-bills/payroll. Default
    // to today, clamp past dates forward. (DB trigger in v36 also enforces.)
    const isRecurring = dayOfWeek !== null && dayOfWeek !== undefined;
    let effectiveDate = rawEffectiveDate || null;
    let effectiveDateClamped = false;
    if (isRecurring) {
      const today = new Date().toISOString().slice(0, 10);
      // Flag (don't hide) when a past start date gets pulled forward, so the
      // client can warn the user instead of the change happening silently.
      if (effectiveDate && effectiveDate < today) effectiveDateClamped = true;
      effectiveDate = (effectiveDate && effectiveDate >= today) ? effectiveDate : today;
    }
    // Bi-weekly: store the anchor ON the row's own weekday — the first such date on/after
    // max(anchor asked for, effective date). A Sat+Sun pair created "starting 9/12"
    // therefore anchors Sat→9/12 and Sun→9/13 (same weekend), instead of both sharing a
    // Sunday-of-week anchor that put them on different fortnights and let the calendar
    // and payroll round the same row to different weeks. See helpers/biweekly.js.
    let anchorDate = rawAnchorDate || null;
    if (isRecurring && (frequency || 'weekly') === 'biweekly') {
      anchorDate = alignBiweeklyAnchor({ anchorDate: rawAnchorDate, effectiveDate, dayOfWeek });
    }

    // Authorization is advisory — see helpers/authorizationCheck.js. Never blocks
    // schedule creation; warnings ride back on the response. Skipped for training
    // shifts, which don't bill and so don't touch the client's balance.
    const { checkAuthorizationBalance } = require('../helpers/authorizationCheck');
    let totalShiftHours = shiftHours(startTime, endTime);
    if (splitShift?.startTime && splitShift?.endTime) {
      totalShiftHours += shiftHours(splitShift.startTime, splitShift.endTime);
    }
    let authCheck = { allowed: true, warnings: [] };
    if (!isTraining) {
      authCheck = await checkAuthorizationBalance(clientId, totalShiftHours);
    }

    // ── Split shift handling ──
    if (splitShift) {
      if (!splitShift.startTime || !splitShift.endTime) {
        return res.status(400).json({ error: 'Split shift requires startTime and endTime' });
      }
      if (splitShift.startTime <= endTime) {
        return res.status(400).json({ error: 'Split shift segment 2 must start after segment 1 ends' });
      }

      const splitGroupId = uuidv4();
      const id1 = uuidv4();
      const id2 = uuidv4();
      const baseParams = [caregiverId, clientId, scheduleType||'recurring', dayOfWeek!=null?dayOfWeek:null, date||null, notes||null, frequency||'weekly', effectiveDate||null, anchorDate||null];

      // Check caregiver availability conflicts for both segments
      if (date) {
        const conflicts1 = await db.query(
          `SELECT id FROM schedules WHERE caregiver_id=$1 AND is_active=true AND date=$2 AND NOT (end_time<=$3 OR start_time>=$4)`,
          [caregiverId, date, startTime, endTime]
        );
        if (conflicts1.rows.length > 0) return res.status(400).json({ error: 'Caregiver has a conflicting schedule during segment 1' });

        const conflicts2 = await db.query(
          `SELECT id FROM schedules WHERE caregiver_id=$1 AND is_active=true AND date=$2 AND NOT (end_time<=$3 OR start_time>=$4)`,
          [caregiverId, date, splitShift.startTime, splitShift.endTime]
        );
        if (conflicts2.rows.length > 0) return res.status(400).json({ error: 'Caregiver has a conflicting schedule during segment 2' });
      }

      const insertSQL = `INSERT INTO schedules (id, caregiver_id, client_id, schedule_type, day_of_week, date, start_time, end_time, notes, frequency, effective_date, anchor_date, is_split_shift, split_shift_group_id, split_segment, is_training)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,true,$13,$14,$15) RETURNING *`;

      const seg1 = await db.query(insertSQL, [id1, ...baseParams.slice(0,5), startTime, endTime, ...baseParams.slice(5), splitGroupId, 1, !!isTraining]);
      const seg2 = await db.query(insertSQL, [id2, ...baseParams.slice(0,5), splitShift.startTime, splitShift.endTime, ...baseParams.slice(5), splitGroupId, 2, !!isTraining]);

      // TODO: EVV integration — split shifts may need separate EVV visit records
      return res.status(201).json({ splitShift: true, segments: [seg1.rows[0], seg2.rows[0]], effectiveDateClamped, effectiveDate, anchorDate, authWarnings: authCheck.warnings || [] });
    }

    // ── Standard single shift ──
    // One-time duplicate guard (v53's unique index only covers recurring rows):
    // a double-submit / retry of the same one-time shift returns the existing row
    // instead of inserting a billable twin.
    if (dayOfWeek == null && date) {
      const existing = await db.query(
        `SELECT * FROM schedules
          WHERE is_active=true AND day_of_week IS NULL
            AND caregiver_id=$1 AND client_id=$2 AND date=$3::date
            AND start_time=$4 AND end_time=$5
          LIMIT 1`,
        [caregiverId, clientId, date, startTime, endTime]);
      if (existing.rows.length > 0) {
        return res.status(200).json({ ...existing.rows[0], duplicate: true, effectiveDateClamped, effectiveDate, authWarnings: authCheck.warnings || [] });
      }
    }
    const id = uuidv4();
    const result = await db.query(
      `INSERT INTO schedules (id, caregiver_id, client_id, schedule_type, day_of_week, date, start_time, end_time, notes, frequency, effective_date, anchor_date, is_training)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING *`,
      [id, caregiverId, clientId, scheduleType||'recurring', dayOfWeek!=null?dayOfWeek:null, date||null, startTime, endTime, notes||null, frequency||'weekly', effectiveDate||null, anchorDate||null, !!isTraining]
    );
    res.status(201).json({ ...result.rows[0], effectiveDateClamped, effectiveDate, anchorDate, authWarnings: authCheck.warnings || [] });
  } catch (error) {
    if (error.code === '23505') {
      return res.status(409).json({ error: 'This caregiver already has this exact shift (same client, day, and time).', duplicate: true });
    }
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
