// routes/applicationsRoutes.js
// Job Applications - Public submission, admin review

const express = require('express');
const router = express.Router();
const db = require('../db');
const auth = require('../middleware/auth');

// ==================== PUBLIC ENDPOINT (NO AUTH) ====================

// Submit job application (public - from website)
router.post('/', async (req, res) => {
  const {
    firstName, lastName, email, phone, address, city, state, zip, dob,
    driversLicense, transportation, legalToWork, backgroundCheck,
    felony, felonyExplanation, yearsExperience, cnaLicense, certifications,
    previousEmployer, reasonForLeaving, availability, shifts, hoursDesired, startDate,
    ref1Name, ref1Relationship, ref1Phone, ref1Email,
    ref2Name, ref2Relationship, ref2Phone, ref2Email,
    whyInterested, additionalInfo
  } = req.body;

  try {
    const result = await db.query(`
      INSERT INTO job_applications (
        first_name, last_name, email, phone, address, city, state, zip, date_of_birth,
        has_drivers_license, has_transportation, legal_to_work, willing_background_check,
        felony_conviction, felony_explanation, years_experience, cna_license, certifications,
        previous_employer, reason_for_leaving, availability_days, availability_shifts, 
        hours_desired, earliest_start_date,
        ref1_name, ref1_relationship, ref1_phone, ref1_email,
        ref2_name, ref2_relationship, ref2_phone, ref2_email,
        why_interested, additional_info, status
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9,
        $10, $11, $12, $13, $14, $15, $16, $17, $18,
        $19, $20, $21, $22, $23, $24,
        $25, $26, $27, $28, $29, $30, $31, $32,
        $33, $34, 'new'
      )
      RETURNING id, first_name, last_name, created_at
    `, [
      firstName, lastName, email, phone, address, city, state, zip, dob,
      driversLicense === 'yes', transportation === 'yes', legalToWork === 'yes', backgroundCheck === 'yes',
      felony === 'yes', felonyExplanation, yearsExperience, cnaLicense, 
      Array.isArray(certifications) ? certifications.join(',') : certifications,
      previousEmployer, reasonForLeaving,
      Array.isArray(availability) ? availability.join(',') : availability,
      Array.isArray(shifts) ? shifts.join(',') : shifts,
      hoursDesired, startDate,
      ref1Name, ref1Relationship, ref1Phone, ref1Email,
      ref2Name, ref2Relationship, ref2Phone, ref2Email,
      whyInterested, additionalInfo
    ]);

    res.json({ 
      success: true, 
      message: 'Application submitted successfully',
      applicationId: result.rows[0].id 
    });
  } catch (error) {
    console.error('Application submission error:', error);
    res.status(500).json({ error: 'Failed to submit application. Please try again.' });
  }
});

// ==================== ADMIN ENDPOINTS (AUTH REQUIRED) ====================

// Get all applications
router.get('/', auth, async (req, res) => {
  const { status, startDate, endDate } = req.query;
  try {
    let query = `
      SELECT id, first_name, last_name, email, phone, city, state,
        years_experience, cna_license, status, created_at, updated_at
      FROM job_applications
      WHERE 1=1
    `;
    const params = [];

    if (status) {
      params.push(status);
      query += ` AND status = $${params.length}`;
    }
    if (startDate) {
      params.push(startDate);
      query += ` AND created_at >= $${params.length}`;
    }
    if (endDate) {
      params.push(endDate);
      query += ` AND created_at <= $${params.length}`;
    }

    query += ` ORDER BY created_at DESC`;
    
    const result = await db.query(query, params);
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get single application details
router.get('/:id', auth, async (req, res) => {
  try {
    const result = await db.query(`
      SELECT * FROM job_applications WHERE id = $1
    `, [req.params.id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Application not found' });
    }

    // Get status history
    const history = await db.query(`
      SELECT * FROM application_status_history 
      WHERE application_id = $1 
      ORDER BY created_at DESC
    `, [req.params.id]);

    res.json({ 
      ...result.rows[0], 
      status_history: history.rows 
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Update application status
router.put('/:id/status', auth, async (req, res) => {
  const { status, notes } = req.body;
  
  try {
    await db.query(`
      UPDATE job_applications 
      SET status = $1, updated_at = NOW()
      WHERE id = $2
    `, [status, req.params.id]);

    // Log status change
    await db.query(`
      INSERT INTO application_status_history (application_id, status, notes, changed_by)
      VALUES ($1, $2, $3, $4)
    `, [req.params.id, status, notes, req.user.id]);

    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Add interview notes
router.post('/:id/notes', auth, async (req, res) => {
  const { notes } = req.body;
  
  try {
    await db.query(`
      UPDATE job_applications 
      SET interview_notes = COALESCE(interview_notes, '') || E'\n\n' || $1 || ' - ' || NOW()::date,
          updated_at = NOW()
      WHERE id = $2
    `, [notes, req.params.id]);

    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Convert approved applicant to caregiver
router.post('/:id/hire', auth, async (req, res) => {
  const { hourlyRate, email, password } = req.body;
  
  try {
    const bcrypt = require('bcryptjs');
    const { v4: uuidv4 } = require('uuid');

    // Get application
    const app = await db.query('SELECT * FROM job_applications WHERE id = $1', [req.params.id]);
    if (app.rows.length === 0) {
      return res.status(404).json({ error: 'Application not found' });
    }

    const a = app.rows[0];

    // Check if already hired
    if (a.status === 'hired') {
      return res.status(400).json({ error: 'This applicant has already been hired' });
    }

    // Use applicant's email or provided email
    const caregiverEmail = email || a.email;
    if (!caregiverEmail) {
      return res.status(400).json({ error: 'Email is required to create caregiver account' });
    }

    // Check email not already in use
    const existing = await db.query('SELECT id FROM users WHERE email = $1', [caregiverEmail]);
    if (existing.rows.length > 0) {
      return res.status(409).json({ error: 'A user with this email already exists' });
    }

    // Generate temp password if not provided
    const tempPassword = password || `CVHC${a.last_name.charAt(0).toUpperCase()}${Math.random().toString(36).slice(-6)}`;
    const hashedPassword = await bcrypt.hash(tempPassword, 10);
    const userId = uuidv4();

    // Create caregiver in users table
    const caregiver = await db.query(`
      INSERT INTO users (id, email, password_hash, first_name, last_name, phone, role, default_pay_rate)
      VALUES ($1, $2, $3, $4, $5, $6, 'caregiver', $7)
      RETURNING id, email, first_name, last_name, role, default_pay_rate
    `, [userId, caregiverEmail, hashedPassword, a.first_name, a.last_name, a.phone, hourlyRate || 15.00]);

    // Update application status
    await db.query(`
      UPDATE job_applications SET status = 'hired', hired_caregiver_id = $1, updated_at = NOW() WHERE id = $2
    `, [userId, req.params.id]);

    // Log it
    await db.query(`
      INSERT INTO application_status_history (application_id, status, notes, changed_by)
      VALUES ($1, 'hired', $2, $3)
    `, [req.params.id, `Converted to caregiver. Temp password: ${tempPassword}`, req.user.id]);

    res.json({ 
      success: true, 
      caregiverId: userId, 
      tempPassword,
      caregiver: caregiver.rows[0],
      message: `${a.first_name} ${a.last_name} is now a caregiver. Temp password: ${tempPassword}`
    });
  } catch (error) {
    console.error('Hire error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Delete application
router.delete('/:id', auth, async (req, res) => {
  try {
    await db.query('DELETE FROM application_status_history WHERE application_id = $1', [req.params.id]);
    await db.query('DELETE FROM job_applications WHERE id = $1', [req.params.id]);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get application stats
router.get('/stats/summary', auth, async (req, res) => {
  try {
    const result = await db.query(`
      SELECT 
        COUNT(*) as total,
        COUNT(*) FILTER (WHERE status = 'new') as new_count,
        COUNT(*) FILTER (WHERE status = 'reviewing') as reviewing_count,
        COUNT(*) FILTER (WHERE status = 'interviewed') as interviewed_count,
        COUNT(*) FILTER (WHERE status = 'offered') as offered_count,
        COUNT(*) FILTER (WHERE status = 'hired') as hired_count,
        COUNT(*) FILTER (WHERE status = 'rejected') as rejected_count,
        COUNT(*) FILTER (WHERE created_at >= CURRENT_DATE - INTERVAL '7 days') as last_7_days,
        COUNT(*) FILTER (WHERE created_at >= CURRENT_DATE - INTERVAL '30 days') as last_30_days
      FROM job_applications
    `);
    res.json(result.rows[0]);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
