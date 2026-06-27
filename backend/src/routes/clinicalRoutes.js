// routes/clinicalRoutes.js — mounted at /api via app.use('/api', clinicalRoutes)
// Covers: compliance summary, care plans, incidents, performance reviews, schedules-enhanced
const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const db = require('../db');
const { verifyToken, requireAdmin, auditLog } = require('../middleware/shared');
const { shiftHours } = require('../helpers/shiftHours');
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
    const { clientId, serviceType, serviceDescription, frequency, careGoals, specialInstructions, precautions, medicationNotes, mobilityNotes, dietaryNotes, communicationNotes, startDate, endDate } = req.body;
    if (!clientId || !serviceType) return res.status(400).json({ error: 'clientId and serviceType are required' });
    const planId = uuidv4();
    const result = await db.query(
      `INSERT INTO care_plans (id, client_id, service_type, service_description, frequency, care_goals, special_instructions, precautions, medication_notes, mobility_notes, dietary_notes, communication_notes, start_date, end_date, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) RETURNING *`,
      [planId, clientId, serviceType, serviceDescription||null, frequency||null, careGoals||null, specialInstructions||null, precautions||null, medicationNotes||null, mobilityNotes||null, dietaryNotes||null, communicationNotes||null, startDate||null, endDate||null, req.user.id]
    );
    await auditLog(req.user.id, 'CREATE', 'care_plans', planId, null, result.rows[0]);
    res.status(201).json(result.rows[0]);
  } catch (error) { res.status(500).json({ error: error.message }); }
});

router.put('/care-plans/:id', verifyToken, requireAdmin, async (req, res) => {
  try {
    const { serviceType, serviceDescription, frequency, careGoals, specialInstructions, precautions, medicationNotes, mobilityNotes, dietaryNotes, communicationNotes, startDate, endDate } = req.body;
    // Set session GUC so the snapshot trigger can record changed_by
    await db.query(`SELECT set_config('crm.user_id', $1, true)`, [req.user.id]);
    const result = await db.query(
      `UPDATE care_plans SET service_type=COALESCE($1,service_type), service_description=COALESCE($2,service_description), frequency=COALESCE($3,frequency), care_goals=COALESCE($4,care_goals), special_instructions=COALESCE($5,special_instructions), precautions=COALESCE($6,precautions), medication_notes=COALESCE($7,medication_notes), mobility_notes=COALESCE($8,mobility_notes), dietary_notes=COALESCE($9,dietary_notes), communication_notes=COALESCE($10,communication_notes), start_date=COALESCE($11,start_date), end_date=COALESCE($12,end_date), updated_at=NOW() WHERE id=$13 RETURNING *`,
      [serviceType, serviceDescription, frequency, careGoals, specialInstructions, precautions, medicationNotes, mobilityNotes, dietaryNotes, communicationNotes, startDate, endDate, req.params.id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Care plan not found' });
    await auditLog(req.user.id, 'UPDATE', 'care_plans', req.params.id, null, result.rows[0]);
    res.json(result.rows[0]);
  } catch (error) { res.status(500).json({ error: error.message }); }
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
    doc.text(`Service Type: ${p.service_type || '—'}     Frequency: ${p.frequency || '—'}`);
    doc.text(`Start: ${p.start_date ? new Date(p.start_date).toLocaleDateString() : '—'}    End: ${p.end_date ? new Date(p.end_date).toLocaleDateString() : 'Ongoing'}`);
    if (p.author_first) doc.text(`Created by: ${p.author_first} ${p.author_last}   on ${new Date(p.created_at).toLocaleDateString()}`);

    // Sections
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

    // Signature lines for paper workflow
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
      `Generated ${new Date().toLocaleString()} by ${req.user.email || req.user.id}. ` +
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

    // Authorization check. If auth is exhausted, REFUSE to generate the
    // schedules — old code only appended a warning and proceeded, which
    // silently created out-of-auth recurring shifts. Pass ?force=true to
    // override (rare; admin needs to be explicit).
    const { checkAuthorizationBalance } = require('../helpers/authorizationCheck');
    const perShiftHours = shiftHours(startTime, endTime);
    const weeklyHours = perShiftHours * daysOfWeek.length;
    const authCheck = await checkAuthorizationBalance(plan.client_id, weeklyHours);
    const warnings = [...(authCheck.warnings || [])];
    if (!authCheck.allowed && req.query.force !== 'true') {
      return res.status(400).json({
        error: authCheck.error || 'Authorization exhausted',
        authorization: authCheck.authorization,
        type: 'authorization',
        hint: 'Pass ?force=true if you intend to schedule beyond authorized units.',
      });
    }
    if (!authCheck.allowed) {
      warnings.push(authCheck.error);
    }

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

router.get('/incidents/:id', verifyToken, requireAdmin, async (req, res) => {
  try {
    const result = await db.query(`SELECT ir.*, c.first_name||' '||c.last_name as client_name, u.first_name||' '||u.last_name as caregiver_name FROM incident_reports ir LEFT JOIN clients c ON ir.client_id=c.id LEFT JOIN users u ON ir.caregiver_id=u.id WHERE ir.id=$1`, [req.params.id]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'Incident not found' });
    res.json(result.rows[0]);
  } catch (error) { res.status(500).json({ error: error.message }); }
});

router.get('/incidents', verifyToken, requireAdmin, async (req, res) => {
  try {
    res.json((await db.query(`SELECT ir.*, c.first_name||' '||c.last_name as client_name, u.first_name||' '||u.last_name as caregiver_name FROM incident_reports ir LEFT JOIN clients c ON ir.client_id=c.id LEFT JOIN users u ON ir.caregiver_id=u.id ORDER BY ir.incident_date DESC, ir.incident_time DESC`)).rows);
  } catch (error) { res.status(500).json({ error: error.message }); }
});

router.post('/incidents', verifyToken, requireAdmin, async (req, res) => {
  try {
    const { clientId, caregiverId, incidentType, severity, incidentDate, incidentTime, description, witnesses, injuriesOrDamage, actionsTaken, followUpRequired, followUpNotes, reportedBy, reportedDate } = req.body;
    if (!clientId || !incidentType || !description) return res.status(400).json({ error: 'Client, incident type, and description are required' });
    const incidentId = uuidv4();
    const result = await db.query(
      `INSERT INTO incident_reports (id, client_id, caregiver_id, incident_type, severity, incident_date, incident_time, description, witnesses, injuries_or_damage, actions_taken, follow_up_required, follow_up_notes, reported_by, reported_date, reported_by_user_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16) RETURNING *`,
      [incidentId, clientId, caregiverId||null, incidentType, severity||'moderate', incidentDate, incidentTime||null, description, witnesses||null, injuriesOrDamage||null, actionsTaken||null, followUpRequired||false, followUpNotes||null, reportedBy||null, reportedDate||null, req.user.id]
    );
    await auditLog(req.user.id, 'CREATE', 'incident_reports', incidentId, null, result.rows[0]);
    res.status(201).json(result.rows[0]);
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
    const result = await db.query(`DELETE FROM incident_reports WHERE id=$1 RETURNING *`, [req.params.id]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'Incident not found' });
    await auditLog(req.user.id, 'DELETE', 'incident_reports', req.params.id, null, result.rows[0]);
    res.json({ message: 'Incident report deleted' });
  } catch (error) { res.status(500).json({ error: error.message }); }
});

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
    const { caregiverId, clientId, scheduleType, dayOfWeek, date, startTime, endTime, notes, frequency, effectiveDate: rawEffectiveDate, anchorDate, splitShift, isTraining } = req.body;
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

    // Authorization enforcement — skip for training shifts (they don't bill,
    // so they don't consume the client's authorization balance).
    const { checkAuthorizationBalance } = require('../helpers/authorizationCheck');
    let totalShiftHours = shiftHours(startTime, endTime);
    if (splitShift?.startTime && splitShift?.endTime) {
      totalShiftHours += shiftHours(splitShift.startTime, splitShift.endTime);
    }
    let authCheck = { allowed: true, warnings: [] };
    if (!isTraining) {
      authCheck = await checkAuthorizationBalance(clientId, totalShiftHours);
      if (!authCheck.allowed && req.query.force !== 'true') {
        return res.status(400).json({ error: authCheck.error, authorization: authCheck.authorization, type: 'authorization' });
      }
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
      return res.status(201).json({ splitShift: true, segments: [seg1.rows[0], seg2.rows[0]], effectiveDateClamped, effectiveDate });
    }

    // ── Standard single shift ──
    const id = uuidv4();
    const result = await db.query(
      `INSERT INTO schedules (id, caregiver_id, client_id, schedule_type, day_of_week, date, start_time, end_time, notes, frequency, effective_date, anchor_date, is_training)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING *`,
      [id, caregiverId, clientId, scheduleType||'recurring', dayOfWeek!=null?dayOfWeek:null, date||null, startTime, endTime, notes||null, frequency||'weekly', effectiveDate||null, anchorDate||null, !!isTraining]
    );
    res.status(201).json({ ...result.rows[0], effectiveDateClamped, effectiveDate });
  } catch (error) { res.status(500).json({ error: error.message }); }
});

module.exports = router;
