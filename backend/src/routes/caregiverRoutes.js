// routes/caregiverRoutes.js
const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const db = require('../db');
const { verifyToken, requireAdmin, auditLog } = require('../middleware/shared');

// GET /api/caregivers - All active caregivers
router.get('/', verifyToken, async (req, res) => {
  try {
    const result = await db.query(
      `SELECT id, email, first_name, last_name, phone, hire_date, is_active, certifications, role, default_pay_rate,
              address, city, state, zip, latitude, longitude
       FROM users WHERE role = 'caregiver' AND is_active = true ORDER BY first_name`
    );
    res.json(result.rows);
  } catch (error) { res.status(500).json({ error: error.message }); }
});

// GET /api/caregivers/available - Find available caregivers for a shift
router.get('/available', verifyToken, async (req, res) => {
  try {
    const { date, dayOfWeek, startTime, endTime } = req.query;
    if (!dayOfWeek || !startTime || !endTime) return res.status(400).json({ error: 'dayOfWeek, startTime, and endTime are required' });

    const dayMap = { 0: 'sunday', 1: 'monday', 2: 'tuesday', 3: 'wednesday', 4: 'thursday', 5: 'friday', 6: 'saturday' };
    const dayName = dayMap[parseInt(dayOfWeek)];
    const availableField = `${dayName}_available`;
    const startField = `${dayName}_start_time`;
    const endField = `${dayName}_end_time`;

    let query = `
      SELECT u.id, u.first_name, u.last_name, ca.${availableField}, ca.${startField}, ca.${endField}
      FROM users u
      LEFT JOIN caregiver_availability ca ON u.id = ca.caregiver_id
      WHERE u.role = 'caregiver'
      AND ca.${availableField} = true
      AND ca.${startField} <= $1
      AND ca.${endField} >= $2
    `;
    const params = [startTime, endTime];
    if (date) {
      query += ` AND NOT EXISTS (SELECT 1 FROM caregiver_blackout_dates WHERE caregiver_id = u.id AND start_date <= $3 AND end_date >= $3)`;
      params.push(date);
    }
    query += ` ORDER BY u.first_name, u.last_name`;
    const result = await db.query(query, params);
    res.json(result.rows);
  } catch (error) { res.status(500).json({ error: error.message }); }
});

// PUT /api/caregivers/:id - Update caregiver info
router.put('/:id', verifyToken, requireAdmin, async (req, res) => {
  try {
    const { firstName, lastName, email, phone, payRate, address, city, state, zip,
            latitude, longitude, hireDate, emergencyContactName, emergencyContactPhone,
            isActive, notes } = req.body;
    if (email) {
      const existing = await db.query('SELECT id FROM users WHERE email = $1 AND id != $2', [email, req.params.id]);
      if (existing.rows.length > 0) return res.status(409).json({ error: 'Email already in use by another account' });
    }
    const result = await db.query(
      `UPDATE users SET 
        first_name = COALESCE($1, first_name), last_name = COALESCE($2, last_name),
        email = COALESCE($3, email), phone = COALESCE($4, phone),
        default_pay_rate = COALESCE($5, default_pay_rate), address = COALESCE($6, address),
        city = COALESCE($7, city), state = COALESCE($8, state), zip = COALESCE($9, zip),
        latitude = COALESCE($10, latitude), longitude = COALESCE($11, longitude),
        hire_date = COALESCE($12, hire_date),
        emergency_contact_name = COALESCE($13, emergency_contact_name),
        emergency_contact_phone = COALESCE($14, emergency_contact_phone),
        is_active = COALESCE($15, is_active), updated_at = NOW()
       WHERE id = $16 AND role = 'caregiver'
       RETURNING id, email, first_name, last_name, phone, default_pay_rate, address, city, state, zip,
                 latitude, longitude, hire_date, emergency_contact_name, emergency_contact_phone, is_active, created_at`,
      [firstName, lastName, email, phone, payRate, address, city, state, zip,
       latitude, longitude, hireDate || null, emergencyContactName, emergencyContactPhone, isActive, req.params.id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Caregiver not found' });
    await auditLog(req.user.id, 'UPDATE', 'users', req.params.id, null, result.rows[0]);
    res.json(result.rows[0]);
  } catch (error) { res.status(500).json({ error: error.message }); }
});

// GET /api/caregivers/:id/summary - Full earnings/hours/clients summary
router.get('/:id/summary', verifyToken, requireAdmin, async (req, res) => {
  try {
    const caregiverId = req.params.id;
    const safeQuery = async (q, params) => {
      try { return await db.query(q, params); } catch(e) { console.error('[summary query error]', e.message); return { rows: [] }; }
    };
    const [userRes, earningsRes, clientsRes, recentShiftsRes, scheduleRes, ratesRes] = await Promise.all([
      safeQuery(`SELECT u.*, cp.notes, cp.capabilities, cp.limitations FROM users u LEFT JOIN caregiver_profiles cp ON cp.caregiver_id = u.id WHERE u.id = $1`, [caregiverId]),
      safeQuery(`SELECT COUNT(*) as total_shifts, COUNT(*) FILTER (WHERE is_complete = true) as completed_shifts,
        ROUND(COALESCE(SUM(CASE WHEN te.is_complete THEN EXTRACT(EPOCH FROM (te.end_time - te.start_time))/3600.0 ELSE 0 END), 0)::numeric, 2) as total_hours,
        ROUND(COALESCE(SUM(CASE WHEN te.is_complete THEN EXTRACT(EPOCH FROM (te.end_time - te.start_time))/3600.0 * COALESCE(u.default_pay_rate,0) ELSE 0 END), 0)::numeric, 2) as total_earnings,
        ROUND(COALESCE(SUM(CASE WHEN te.is_complete AND te.start_time >= NOW() - INTERVAL '7 days' THEN EXTRACT(EPOCH FROM (te.end_time - te.start_time))/3600.0 ELSE 0 END), 0)::numeric, 2) as hours_this_week,
        ROUND(COALESCE(SUM(CASE WHEN te.is_complete AND te.start_time >= date_trunc('month', NOW()) THEN EXTRACT(EPOCH FROM (te.end_time - te.start_time))/3600.0 * COALESCE(u.default_pay_rate,0) ELSE 0 END), 0)::numeric, 2) as earnings_this_month,
        ROUND(COALESCE(SUM(CASE WHEN te.is_complete AND te.start_time >= date_trunc('month', NOW()) THEN EXTRACT(EPOCH FROM (te.end_time - te.start_time))/3600.0 ELSE 0 END), 0)::numeric, 2) as hours_this_month,
        MAX(te.start_time) as last_shift_date
       FROM time_entries te JOIN users u ON u.id = te.caregiver_id WHERE te.caregiver_id = $1`, [caregiverId]),
      safeQuery(`SELECT DISTINCT c.id, c.first_name, c.last_name, c.address, c.city,
        COUNT(te.id) as shift_count, ROUND(SUM(EXTRACT(EPOCH FROM (te.end_time - te.start_time))/3600)::numeric, 1) as total_hours, MAX(te.start_time) as last_visit
        FROM time_entries te JOIN clients c ON te.client_id = c.id
        WHERE te.caregiver_id = $1 AND te.is_complete = true
        GROUP BY c.id, c.first_name, c.last_name, c.address, c.city ORDER BY last_visit DESC`, [caregiverId]),
      safeQuery(`SELECT te.id, te.start_time, te.end_time, te.is_complete,
        CASE WHEN te.end_time IS NOT NULL THEN ROUND(EXTRACT(EPOCH FROM (te.end_time - te.start_time))/3600.0::numeric, 2) ELSE NULL END as hours,
        c.first_name as client_first, c.last_name as client_last, c.address as client_address
        FROM time_entries te JOIN clients c ON te.client_id = c.id
        WHERE te.caregiver_id = $1 ORDER BY te.start_time DESC LIMIT 10`, [caregiverId]),
      safeQuery(`SELECT s.id, s.caregiver_id, s.client_id, s.date, s.start_time, s.end_time, s.schedule_type, s.notes, s.frequency,
        c.first_name as client_first, c.last_name as client_last, c.address as client_address, c.city as client_city,
        ROUND(EXTRACT(EPOCH FROM (s.end_time::time - s.start_time::time))/3600.0::numeric, 2) as shift_hours
        FROM schedules s LEFT JOIN clients c ON s.client_id = c.id
        WHERE s.caregiver_id = $1 AND s.date >= CURRENT_DATE AND s.is_active = true
        ORDER BY s.date, s.start_time LIMIT 14`, [caregiverId]),
      db.query(`SELECT default_pay_rate as rate, hire_date as effective_date, 'Current rate' as notes FROM users WHERE id = $1`, [caregiverId]).catch(() => ({ rows: [] })),
    ]);

    const now = new Date();
    const weekStart = new Date(now); weekStart.setDate(now.getDate() - now.getDay()); weekStart.setHours(0,0,0,0);
    const weekEnd = new Date(weekStart); weekEnd.setDate(weekEnd.getDate() + 6); weekEnd.setHours(23,59,59,999);
    const scheduledWeekRes = await safeQuery(`SELECT COALESCE(SUM(EXTRACT(EPOCH FROM (end_time::time - start_time::time))/3600.0), 0) as scheduled_hours_week
      FROM schedules WHERE caregiver_id = $1 AND is_active = true AND ((date >= $2 AND date <= $3) OR day_of_week = $4)`,
      [caregiverId, weekStart.toISOString().split('T')[0], weekEnd.toISOString().split('T')[0], now.getDay()]);
    const earnings = earningsRes.rows[0] || {};
    const scheduledHrsWeek = parseFloat(scheduledWeekRes.rows[0]?.scheduled_hours_week || 0);
    if (parseFloat(earnings.hours_this_week || 0) === 0 && scheduledHrsWeek > 0) {
      earnings.hours_this_week = scheduledHrsWeek.toFixed(2);
      earnings.hours_this_week_source = 'scheduled';
    }
    res.json({ profile: userRes.rows[0], earnings, clients: clientsRes.rows, recentShifts: recentShiftsRes.rows, schedule: scheduleRes.rows, payRates: ratesRes.rows });
  } catch (error) { res.status(500).json({ error: error.message }); }
});

// GET /api/caregivers/:caregiverId/availability
router.get('/:caregiverId/availability', verifyToken, async (req, res) => {
  try {
    let result = await db.query(`SELECT * FROM caregiver_availability WHERE caregiver_id = $1`, [req.params.caregiverId]);
    if (result.rows.length === 0) {
      await db.query(`INSERT INTO caregiver_availability (caregiver_id, status, max_hours_per_week,
        monday_available, monday_start_time, monday_end_time, tuesday_available, tuesday_start_time, tuesday_end_time,
        wednesday_available, wednesday_start_time, wednesday_end_time, thursday_available, thursday_start_time, thursday_end_time,
        friday_available, friday_start_time, friday_end_time, saturday_available, sunday_available)
        VALUES ($1, $2, $3, true, '08:00', '17:00', true, '08:00', '17:00', true, '08:00', '17:00', true, '08:00', '17:00', true, '08:00', '17:00', false, false)`,
        [req.params.caregiverId, 'available', 40]);
      result = await db.query(`SELECT * FROM caregiver_availability WHERE caregiver_id = $1`, [req.params.caregiverId]);
    }
    res.json(result.rows[0]);
  } catch (error) { res.status(500).json({ error: error.message }); }
});

// PUT /api/caregivers/:caregiverId/availability
router.put('/:caregiverId/availability', verifyToken, async (req, res) => {
  try {
    const { status, maxHoursPerWeek, mondayAvailable, mondayStartTime, mondayEndTime, tuesdayAvailable, tuesdayStartTime, tuesdayEndTime,
      wednesdayAvailable, wednesdayStartTime, wednesdayEndTime, thursdayAvailable, thursdayStartTime, thursdayEndTime,
      fridayAvailable, fridayStartTime, fridayEndTime, saturdayAvailable, saturdayStartTime, saturdayEndTime,
      sundayAvailable, sundayStartTime, sundayEndTime } = req.body;
    const result = await db.query(
      `UPDATE caregiver_availability SET status=COALESCE($1,status), max_hours_per_week=COALESCE($2,max_hours_per_week),
        monday_available=COALESCE($3,monday_available), monday_start_time=COALESCE($4,monday_start_time), monday_end_time=COALESCE($5,monday_end_time),
        tuesday_available=COALESCE($6,tuesday_available), tuesday_start_time=COALESCE($7,tuesday_start_time), tuesday_end_time=COALESCE($8,tuesday_end_time),
        wednesday_available=COALESCE($9,wednesday_available), wednesday_start_time=COALESCE($10,wednesday_start_time), wednesday_end_time=COALESCE($11,wednesday_end_time),
        thursday_available=COALESCE($12,thursday_available), thursday_start_time=COALESCE($13,thursday_start_time), thursday_end_time=COALESCE($14,thursday_end_time),
        friday_available=COALESCE($15,friday_available), friday_start_time=COALESCE($16,friday_start_time), friday_end_time=COALESCE($17,friday_end_time),
        saturday_available=COALESCE($18,saturday_available), saturday_start_time=COALESCE($19,saturday_start_time), saturday_end_time=COALESCE($20,saturday_end_time),
        sunday_available=COALESCE($21,sunday_available), sunday_start_time=COALESCE($22,sunday_start_time), sunday_end_time=COALESCE($23,sunday_end_time), updated_at=NOW()
       WHERE caregiver_id = $24 RETURNING *`,
      [status, maxHoursPerWeek, mondayAvailable, mondayStartTime, mondayEndTime, tuesdayAvailable, tuesdayStartTime, tuesdayEndTime,
       wednesdayAvailable, wednesdayStartTime, wednesdayEndTime, thursdayAvailable, thursdayStartTime, thursdayEndTime,
       fridayAvailable, fridayStartTime, fridayEndTime, saturdayAvailable, saturdayStartTime, saturdayEndTime,
       sundayAvailable, sundayStartTime, sundayEndTime, req.params.caregiverId]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Caregiver availability not found' });
    await auditLog(req.user.id, 'UPDATE', 'caregiver_availability', req.params.caregiverId, null, result.rows[0]);
    res.json(result.rows[0]);
  } catch (error) { res.status(500).json({ error: error.message }); }
});

// GET /api/caregivers/:caregiverId/blackout-dates
router.get('/:caregiverId/blackout-dates', verifyToken, async (req, res) => {
  try {
    const result = await db.query(`SELECT * FROM caregiver_blackout_dates WHERE caregiver_id = $1 ORDER BY start_date DESC`, [req.params.caregiverId]);
    res.json(result.rows);
  } catch (error) { res.status(500).json({ error: error.message }); }
});

// POST /api/caregivers/:caregiverId/blackout-dates
router.post('/:caregiverId/blackout-dates', verifyToken, async (req, res) => {
  try {
    const { startDate, endDate, reason } = req.body;
    if (!startDate || !endDate) return res.status(400).json({ error: 'startDate and endDate are required' });
    const blackoutId = uuidv4();
    const result = await db.query(
      `INSERT INTO caregiver_blackout_dates (id, caregiver_id, start_date, end_date, reason) VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [blackoutId, req.params.caregiverId, startDate, endDate, reason || null]
    );
    await auditLog(req.user.id, 'CREATE', 'caregiver_blackout_dates', blackoutId, null, result.rows[0]);
    res.status(201).json(result.rows[0]);
  } catch (error) { res.status(500).json({ error: error.message }); }
});

// GET /api/caregivers/:caregiverId/certifications
router.get('/:caregiverId/certifications', verifyToken, async (req, res) => {
  try {
    const result = await db.query(`SELECT * FROM caregiver_certifications WHERE caregiver_id = $1 ORDER BY expiration_date DESC`, [req.params.caregiverId]);
    res.json(result.rows);
  } catch (error) { res.status(500).json({ error: error.message }); }
});

// POST /api/caregivers/:caregiverId/certifications
router.post('/:caregiverId/certifications', verifyToken, async (req, res) => {
  try {
    const { certificationName, certificationNumber, issuer, issuedDate, expirationDate } = req.body;
    const certId = uuidv4();
    const result = await db.query(
      `INSERT INTO caregiver_certifications (id, caregiver_id, certification_name, certification_number, issuer, issued_date, expiration_date)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
      [certId, req.params.caregiverId, certificationName, certificationNumber, issuer, issuedDate, expirationDate]
    );
    await auditLog(req.user.id, 'CREATE', 'caregiver_certifications', certId, null, result.rows[0]);
    res.status(201).json(result.rows[0]);
  } catch (error) { res.status(500).json({ error: error.message }); }
});

// DELETE /api/caregivers/certifications/:certId
router.delete('/certifications/:certId', verifyToken, async (req, res) => {
  try {
    const result = await db.query(`DELETE FROM caregiver_certifications WHERE id = $1 RETURNING *`, [req.params.certId]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'Certification not found' });
    await auditLog(req.user.id, 'DELETE', 'caregiver_certifications', req.params.certId, null, result.rows[0]);
    res.json({ message: 'Certification deleted' });
  } catch (error) { res.status(500).json({ error: error.message }); }
});

// GET /api/caregivers/:caregiverId/background-check
router.get('/:caregiverId/background-check', verifyToken, async (req, res) => {
  try {
    const result = await db.query(`SELECT * FROM background_checks WHERE caregiver_id = $1 ORDER BY check_date DESC LIMIT 1`, [req.params.caregiverId]);
    res.json(result.rows.length > 0 ? result.rows[0] : null);
  } catch (error) { res.status(500).json({ error: error.message }); }
});

// POST /api/caregivers/:caregiverId/background-check
router.post('/:caregiverId/background-check', verifyToken, requireAdmin, async (req, res) => {
  try {
    const { checkDate, expirationDate, status, clearanceNumber, notes } = req.body;
    if (!checkDate || !status) return res.status(400).json({ error: 'Check date and status are required' });
    const checkId = uuidv4();
    const result = await db.query(
      `INSERT INTO background_checks (id, caregiver_id, check_date, expiration_date, status, clearance_number, notes, checked_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
      [checkId, req.params.caregiverId, checkDate, expirationDate || null, status, clearanceNumber || null, notes || null, req.user.id]
    );
    await auditLog(req.user.id, 'CREATE', 'background_checks', checkId, null, result.rows[0]);
    res.status(201).json(result.rows[0]);
  } catch (error) { res.status(500).json({ error: error.message }); }
});

// GET /api/caregivers/:caregiverId/training-records
router.get('/:caregiverId/training-records', verifyToken, async (req, res) => {
  try {
    const result = await db.query(`SELECT * FROM training_records WHERE caregiver_id = $1 ORDER BY completion_date DESC`, [req.params.caregiverId]);
    res.json(result.rows);
  } catch (error) { res.status(500).json({ error: error.message }); }
});

// POST /api/caregivers/:caregiverId/training-records
router.post('/:caregiverId/training-records', verifyToken, requireAdmin, async (req, res) => {
  try {
    const { trainingType, completionDate, expirationDate, certificationNumber, provider, status } = req.body;
    if (!trainingType || !completionDate) return res.status(400).json({ error: 'Training type and completion date are required' });
    const recordId = uuidv4();
    const result = await db.query(
      `INSERT INTO training_records (id, caregiver_id, training_type, completion_date, expiration_date, certification_number, provider, status, recorded_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *`,
      [recordId, req.params.caregiverId, trainingType, completionDate, expirationDate || null, certificationNumber || null, provider || null, status || 'completed', req.user.id]
    );
    await auditLog(req.user.id, 'CREATE', 'training_records', recordId, null, result.rows[0]);
    res.status(201).json(result.rows[0]);
  } catch (error) { res.status(500).json({ error: error.message }); }
});

// GET /api/caregivers/:caregiverId/compliance-documents
router.get('/:caregiverId/compliance-documents', verifyToken, async (req, res) => {
  try {
    const result = await db.query(`SELECT * FROM compliance_documents WHERE caregiver_id = $1 ORDER BY upload_date DESC`, [req.params.caregiverId]);
    res.json(result.rows);
  } catch (error) { res.status(500).json({ error: error.message }); }
});

// POST /api/caregivers/:caregiverId/compliance-documents
router.post('/:caregiverId/compliance-documents', verifyToken, requireAdmin, async (req, res) => {
  try {
    const { documentType, documentName, expirationDate, fileUrl, notes } = req.body;
    if (!documentType || !documentName) return res.status(400).json({ error: 'Document type and name are required' });
    const docId = uuidv4();
    const result = await db.query(
      `INSERT INTO compliance_documents (id, caregiver_id, document_type, document_name, expiration_date, file_url, notes, uploaded_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
      [docId, req.params.caregiverId, documentType, documentName, expirationDate || null, fileUrl || null, notes || null, req.user.id]
    );
    await auditLog(req.user.id, 'CREATE', 'compliance_documents', docId, null, result.rows[0]);
    res.status(201).json(result.rows[0]);
  } catch (error) { res.status(500).json({ error: error.message }); }
});

// GET /api/caregivers/:id/pay-rate-for-client/:clientId
router.get('/:id/pay-rate-for-client/:clientId', verifyToken, async (req, res) => {
  try {
    const result = await db.query(`
      SELECT cctr.hourly_rate, ct.name as care_type_name, u.default_pay_rate
      FROM clients c JOIN users u ON u.id = $1
      LEFT JOIN care_types ct ON c.care_type_id = ct.id
      LEFT JOIN caregiver_care_type_rates cctr ON cctr.caregiver_id = $1 AND cctr.care_type_id = c.care_type_id AND cctr.is_active = true
      WHERE c.id = $2
    `, [req.params.id, req.params.clientId]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'Client not found' });
    const row = result.rows[0];
    res.json({ hourlyRate: row.hourly_rate || row.default_pay_rate || 15.00, careTypeName: row.care_type_name, isDefaultRate: !row.hourly_rate });
  } catch (error) { res.status(500).json({ error: error.message }); }
});

module.exports = router;
