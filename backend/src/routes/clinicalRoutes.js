// routes/clinicalRoutes.js — mounted at /api via app.use('/api', clinicalRoutes)
// Covers: compliance summary, care plans, incidents, performance reviews, schedules-enhanced
const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const db = require('../db');
const { verifyToken, requireAdmin, auditLog } = require('../middleware/shared');
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
    const result = await db.query(
      `UPDATE care_plans SET service_type=COALESCE($1,service_type), service_description=COALESCE($2,service_description), frequency=COALESCE($3,frequency), care_goals=COALESCE($4,care_goals), special_instructions=COALESCE($5,special_instructions), precautions=COALESCE($6,precautions), medication_notes=COALESCE($7,medication_notes), mobility_notes=COALESCE($8,mobility_notes), dietary_notes=COALESCE($9,dietary_notes), communication_notes=COALESCE($10,communication_notes), start_date=COALESCE($11,start_date), end_date=COALESCE($12,end_date), updated_at=NOW() WHERE id=$13 RETURNING *`,
      [serviceType, serviceDescription, frequency, careGoals, specialInstructions, precautions, medicationNotes, mobilityNotes, dietaryNotes, communicationNotes, startDate, endDate, req.params.id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Care plan not found' });
    await auditLog(req.user.id, 'UPDATE', 'care_plans', req.params.id, null, result.rows[0]);
    res.json(result.rows[0]);
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

router.get('/incidents/:id', verifyToken, async (req, res) => {
  try {
    const result = await db.query(`SELECT ir.*, c.first_name||' '||c.last_name as client_name, u.first_name||' '||u.last_name as caregiver_name FROM incident_reports ir LEFT JOIN clients c ON ir.client_id=c.id LEFT JOIN users u ON ir.caregiver_id=u.id WHERE ir.id=$1`, [req.params.id]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'Incident not found' });
    res.json(result.rows[0]);
  } catch (error) { res.status(500).json({ error: error.message }); }
});

router.get('/incidents', verifyToken, async (req, res) => {
  try {
    res.json((await db.query(`SELECT ir.*, c.first_name||' '||c.last_name as client_name, u.first_name||' '||u.last_name as caregiver_name FROM incident_reports ir LEFT JOIN clients c ON ir.client_id=c.id LEFT JOIN users u ON ir.caregiver_id=u.id ORDER BY ir.incident_date DESC, ir.incident_time DESC`)).rows);
  } catch (error) { res.status(500).json({ error: error.message }); }
});

router.post('/incidents', verifyToken, async (req, res) => {
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

router.patch('/incidents/:id', verifyToken, async (req, res) => {
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

router.get('/performance-reviews/summary/:caregiverId', verifyToken, async (req, res) => {
  try {
    res.json((await db.query(`SELECT COUNT(*) as total_reviews, AVG(CASE WHEN overall_assessment='excellent' THEN 3 WHEN overall_assessment='satisfactory' THEN 2 WHEN overall_assessment='needs_improvement' THEN 1 ELSE 0 END) as avg_score, COUNT(CASE WHEN overall_assessment='excellent' THEN 1 END) as excellent_count, COUNT(CASE WHEN overall_assessment='satisfactory' THEN 1 END) as satisfactory_count, COUNT(CASE WHEN overall_assessment='needs_improvement' THEN 1 END) as needs_improvement_count, MAX(review_date) as last_review_date FROM performance_reviews WHERE caregiver_id=$1`, [req.params.caregiverId])).rows[0]);
  } catch (error) { res.status(500).json({ error: error.message }); }
});

router.get('/performance-reviews/:caregiverId', verifyToken, async (req, res) => {
  try {
    res.json((await db.query(`SELECT pr.*, cl.first_name||' '||cl.last_name as client_name FROM performance_reviews pr LEFT JOIN clients cl ON pr.client_id=cl.id WHERE pr.caregiver_id=$1 ORDER BY pr.review_date DESC`, [req.params.caregiverId])).rows);
  } catch (error) { res.status(500).json({ error: error.message }); }
});

router.get('/performance-reviews', verifyToken, async (req, res) => {
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
    const { caregiverId, clientId, scheduleType, dayOfWeek, date, startTime, endTime, notes, frequency, effectiveDate, anchorDate } = req.body;
    if (!caregiverId || !clientId || !startTime || !endTime) return res.status(400).json({ error: 'Missing required fields' });
    const id = uuidv4();
    const result = await db.query(
      `INSERT INTO schedules (id, caregiver_id, client_id, schedule_type, day_of_week, date, start_time, end_time, notes, frequency, effective_date, anchor_date)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`,
      [id, caregiverId, clientId, scheduleType||'recurring', dayOfWeek!=null?dayOfWeek:null, date||null, startTime, endTime, notes||null, frequency||'weekly', effectiveDate||null, anchorDate||null]
    );
    res.status(201).json(result.rows[0]);
  } catch (error) { res.status(500).json({ error: error.message }); }
});

module.exports = router;
module.exports = router;
