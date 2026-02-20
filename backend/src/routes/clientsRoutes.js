// routes/clientsRoutes.js
const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const db = require('../db');
const { verifyToken, requireAdmin, auditLog } = require('../middleware/shared');

// POST /api/clients
router.post('/', verifyToken, async (req, res) => {
  try {
    const { firstName, lastName, dateOfBirth, phone, email, address, city, state, zip,
      referredBy, serviceType, referralSourceId, careTypeId,
      isPrivatePay, privatePayRate, privatePayRateType, weeklyAuthorizedUnits } = req.body;
    const clientId = uuidv4();
    const result = await db.query(
      `INSERT INTO clients (id, first_name, last_name, date_of_birth, phone, email, address, city, state, zip,
        referred_by, service_type, start_date, referral_source_id, care_type_id,
        is_private_pay, private_pay_rate, private_pay_rate_type, weekly_authorized_units)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,CURRENT_DATE,$13,$14,$15,$16,$17,$18) RETURNING *`,
      [clientId, firstName, lastName, dateOfBirth, phone, email, address, city, state, zip,
       referredBy || referralSourceId, serviceType, referralSourceId, careTypeId,
       isPrivatePay || false, privatePayRate, privatePayRateType || 'hourly', weeklyAuthorizedUnits || null]
    );
    await db.query(`INSERT INTO client_onboarding (client_id) VALUES ($1)`, [clientId]);
    await auditLog(req.user.id, 'CREATE', 'clients', clientId, null, result.rows[0]);
    res.status(201).json(result.rows[0]);
  } catch (error) { res.status(500).json({ error: error.message }); }
});

// GET /api/clients
router.get('/', verifyToken, async (req, res) => {
  try {
    const result = await db.query(
      `SELECT c.*, rs.name as referral_source_name, ct.name as care_type_name
       FROM clients c
       LEFT JOIN referral_sources rs ON c.referral_source_id = rs.id
       LEFT JOIN care_types ct ON c.care_type_id = ct.id
       WHERE c.is_active = true ORDER BY c.first_name`
    );
    res.json(result.rows);
  } catch (error) { res.status(500).json({ error: error.message }); }
});

// GET /api/clients/:id
router.get('/:id', verifyToken, async (req, res) => {
  try {
    const [clientResult, emergencyResult, onboardingResult] = await Promise.all([
      db.query('SELECT * FROM clients WHERE id = $1', [req.params.id]),
      db.query('SELECT * FROM client_emergency_contacts WHERE client_id = $1', [req.params.id]),
      db.query('SELECT * FROM client_onboarding WHERE client_id = $1', [req.params.id]),
    ]);
    res.json({ client: clientResult.rows[0], emergencyContacts: emergencyResult.rows, onboarding: onboardingResult.rows[0] });
  } catch (error) { res.status(500).json({ error: error.message }); }
});

// PUT /api/clients/:id
router.put('/:id', verifyToken, async (req, res) => {
  try {
    const { firstName, lastName, dateOfBirth, phone, email, address, city, state, zip,
      serviceType, medicalConditions, allergies, medications, notes,
      insuranceProvider, insuranceId, insuranceGroup, gender, preferredCaregivers,
      emergencyContactName, emergencyContactPhone, emergencyContactRelationship,
      medicalNotes, doNotUseCaregivers, carePreferences, mobilityAssistanceNeeds,
      referralSourceId, careTypeId, isPrivatePay, privatePayRate, privatePayRateType, billingNotes,
      weeklyAuthorizedUnits, serviceDaysPerWeek, serviceAllowedDays } = req.body;
    const result = await db.query(
      `UPDATE clients SET
        first_name=COALESCE($1,first_name), last_name=COALESCE($2,last_name), date_of_birth=$3,
        phone=$4, email=$5, address=$6, city=$7, state=$8, zip=$9,
        service_type=COALESCE($10,service_type), medical_conditions=$11, allergies=$12,
        medications=$13, notes=$14, insurance_provider=$15, insurance_id=$16, insurance_group=$17,
        gender=$18, preferred_caregivers=$19, emergency_contact_name=$20, emergency_contact_phone=$21,
        emergency_contact_relationship=$22, medical_notes=$23, do_not_use_caregivers=$24,
        care_preferences=$25, mobility_assistance_needs=$26, referral_source_id=$27, care_type_id=$28,
        is_private_pay=COALESCE($29,is_private_pay), private_pay_rate=$30,
        private_pay_rate_type=COALESCE($31,private_pay_rate_type), billing_notes=$32,
        weekly_authorized_units=$33, service_days_per_week=COALESCE($34,service_days_per_week),
        service_allowed_days=COALESCE($35,service_allowed_days), updated_at=NOW()
       WHERE id=$36 RETURNING *`,
      [firstName, lastName, dateOfBirth, phone, email, address, city, state, zip,
       serviceType, medicalConditions, allergies, medications, notes,
       insuranceProvider, insuranceId, insuranceGroup, gender, preferredCaregivers,
       emergencyContactName, emergencyContactPhone, emergencyContactRelationship,
       medicalNotes, doNotUseCaregivers, carePreferences, mobilityAssistanceNeeds,
       referralSourceId, careTypeId, isPrivatePay, privatePayRate, privatePayRateType, billingNotes,
       weeklyAuthorizedUnits, serviceDaysPerWeek || null,
       serviceAllowedDays ? JSON.stringify(serviceAllowedDays) : null, req.params.id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Client not found' });
    await auditLog(req.user.id, 'UPDATE', 'clients', req.params.id, null, result.rows[0]);
    res.json(result.rows[0]);
  } catch (error) { res.status(500).json({ error: error.message }); }
});

// DELETE /api/clients/:id
router.delete('/:id', verifyToken, requireAdmin, async (req, res) => {
  try {
    const existing = await db.query('SELECT * FROM clients WHERE id = $1', [req.params.id]);
    if (existing.rows.length === 0) return res.status(404).json({ error: 'Client not found' });
    const result = await db.query(`UPDATE clients SET is_active=false, updated_at=NOW() WHERE id=$1 RETURNING *`, [req.params.id]);
    await auditLog(req.user.id, 'DELETE', 'clients', req.params.id, existing.rows[0], result.rows[0]);
    res.json({ message: 'Client deleted successfully', client: result.rows[0] });
  } catch (error) { res.status(500).json({ error: error.message }); }
});

// GET /api/clients/:id/onboarding
router.get('/:id/onboarding', verifyToken, async (req, res) => {
  try {
    let result = await db.query(`SELECT * FROM client_onboarding WHERE client_id = $1`, [req.params.id]);
    if (result.rows.length === 0) {
      await db.query(`INSERT INTO client_onboarding (client_id) VALUES ($1)`, [req.params.id]);
      result = await db.query(`SELECT * FROM client_onboarding WHERE client_id = $1`, [req.params.id]);
    }
    res.json(result.rows[0] || {});
  } catch (error) { res.status(500).json({ error: error.message }); }
});

// PATCH /api/clients/:id/onboarding/:stepId
router.patch('/:id/onboarding/:stepId', verifyToken, async (req, res) => {
  try {
    const ALLOWED_COLUMNS = new Set(['step_name','step_status','completed_at','completed_by','notes','documents_received',
      'signature_obtained','effective_date','review_date','assigned_to','form_data','is_complete','skipped','skipped_reason']);
    const updates = req.body;
    let updateFields = [], params = [], paramIndex = 1;
    Object.keys(updates).forEach(key => {
      if (!ALLOWED_COLUMNS.has(key)) throw new Error(`Invalid field: ${key}`);
      updateFields.push(`${key} = $${paramIndex}`);
      params.push(updates[key]);
      paramIndex++;
    });
    if (updateFields.length === 0) return res.json({ message: 'No fields to update' });
    updateFields.push(`updated_at = NOW()`);
    params.push(req.params.id);
    const result = await db.query(
      `UPDATE client_onboarding SET ${updateFields.join(', ')} WHERE client_id = $${paramIndex} RETURNING *`, params
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Onboarding record not found' });
    await auditLog(req.user.id, 'UPDATE', 'client_onboarding', req.params.id, null, result.rows[0]);
    res.json(result.rows[0]);
  } catch (error) { res.status(500).json({ error: error.message }); }
});

// GET /api/clients/:id/caregiver-view
router.get('/:id/caregiver-view', verifyToken, async (req, res) => {
  try {
    const result = await db.query(
      `SELECT id, first_name, last_name, date_of_birth, phone, email, address, city, state, zip,
        emergency_contact_name, emergency_contact_phone, emergency_contact_relationship,
        medical_conditions, medications, allergies, medical_notes, care_preferences,
        mobility_assistance_needs, preferred_caregivers, notes
       FROM clients WHERE id = $1`, [req.params.id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Client not found' });
    res.json(result.rows[0]);
  } catch (error) { res.status(500).json({ error: error.message }); }
});

// GET /api/clients/:id/visit-notes
router.get('/:id/visit-notes', verifyToken, async (req, res) => {
  try {
    const result = await db.query(
      `SELECT vn.*, u.first_name || ' ' || u.last_name as caregiver_name
       FROM client_visit_notes vn LEFT JOIN users u ON vn.caregiver_id = u.id
       WHERE vn.client_id = $1 ORDER BY vn.created_at DESC LIMIT 50`, [req.params.id]
    );
    res.json(result.rows);
  } catch (error) { res.status(500).json({ error: error.message }); }
});

// POST /api/clients/:id/visit-notes
router.post('/:id/visit-notes', verifyToken, async (req, res) => {
  try {
    const noteId = uuidv4();
    const result = await db.query(
      `INSERT INTO client_visit_notes (id, client_id, caregiver_id, note) VALUES ($1, $2, $3, $4) RETURNING *`,
      [noteId, req.params.id, req.user.id, req.body.note]
    );
    await auditLog(req.user.id, 'CREATE', 'client_visit_notes', noteId, null, result.rows[0]);
    res.status(201).json(result.rows[0]);
  } catch (error) { res.status(500).json({ error: error.message }); }
});

// GET /api/clients/:clientId/services
router.get('/:clientId/services', verifyToken, async (req, res) => {
  try {
    const result = await db.query(
      `SELECT cs.*, sp.service_name, sp.client_hourly_rate, sp.caregiver_hourly_rate
       FROM client_services cs JOIN service_pricing sp ON cs.service_pricing_id = sp.id
       WHERE cs.client_id = $1 ORDER BY cs.is_primary DESC, sp.service_name`, [req.params.clientId]
    );
    res.json(result.rows);
  } catch (error) { res.status(500).json({ error: error.message }); }
});

// POST /api/clients/:clientId/services
router.post('/:clientId/services', verifyToken, requireAdmin, async (req, res) => {
  try {
    const { servicePricingId, isPrimary, notes } = req.body;
    if (!servicePricingId) return res.status(400).json({ error: 'servicePricingId is required' });
    if (isPrimary) await db.query(`UPDATE client_services SET is_primary=false WHERE client_id=$1`, [req.params.clientId]);
    const assignmentId = uuidv4();
    const result = await db.query(
      `INSERT INTO client_services (id, client_id, service_pricing_id, is_primary, notes) VALUES ($1,$2,$3,$4,$5) RETURNING *`,
      [assignmentId, req.params.clientId, servicePricingId, isPrimary || false, notes || null]
    );
    await auditLog(req.user.id, 'CREATE', 'client_services', assignmentId, null, result.rows[0]);
    res.status(201).json(result.rows[0]);
  } catch (error) { res.status(500).json({ error: error.message }); }
});

// DELETE /api/clients/:clientId/services/:serviceId
router.delete('/:clientId/services/:serviceId', verifyToken, requireAdmin, async (req, res) => {
  try {
    const result = await db.query(
      `DELETE FROM client_services WHERE id=$1 AND client_id=$2 RETURNING *`,
      [req.params.serviceId, req.params.clientId]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Service assignment not found' });
    await auditLog(req.user.id, 'DELETE', 'client_services', req.params.serviceId, null, result.rows[0]);
    res.json({ message: 'Service removed from client' });
  } catch (error) { res.status(500).json({ error: error.message }); }
});

// GET /api/clients/:id/billing-rate
router.get('/:id/billing-rate', verifyToken, async (req, res) => {
  try {
    const result = await db.query(`
      SELECT c.is_private_pay,
        CASE WHEN c.is_private_pay THEN c.private_pay_rate ELSE rsr.rate_amount END as rate_amount,
        CASE WHEN c.is_private_pay THEN c.private_pay_rate_type ELSE rsr.rate_type END as rate_type,
        rs.name as referral_source_name, ct.name as care_type_name
      FROM clients c
      LEFT JOIN referral_sources rs ON c.referral_source_id = rs.id
      LEFT JOIN care_types ct ON c.care_type_id = ct.id
      LEFT JOIN referral_source_rates rsr ON rsr.referral_source_id=c.referral_source_id AND rsr.care_type_id=c.care_type_id AND rsr.is_active=true
      WHERE c.id = $1`, [req.params.id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Client not found' });
    res.json(result.rows[0]);
  } catch (error) { res.status(500).json({ error: error.message }); }
});

// PUT /api/clients/:id/billing
router.put('/:id/billing', verifyToken, requireAdmin, async (req, res) => {
  try {
    const { referralSourceId, careTypeId, isPrivatePay, privatePayRate, privatePayRateType, billingNotes } = req.body;
    const result = await db.query(
      `UPDATE clients SET referral_source_id=$1, care_type_id=$2, is_private_pay=$3, private_pay_rate=$4,
        private_pay_rate_type=$5, billing_notes=$6, updated_at=NOW() WHERE id=$7 RETURNING *`,
      [referralSourceId, careTypeId, isPrivatePay, privatePayRate, privatePayRateType, billingNotes, req.params.id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Client not found' });
    await auditLog(req.user.id, 'UPDATE', 'clients', req.params.id, null, result.rows[0]);
    res.json(result.rows[0]);
  } catch (error) { res.status(500).json({ error: error.message }); }
});

module.exports = router;
