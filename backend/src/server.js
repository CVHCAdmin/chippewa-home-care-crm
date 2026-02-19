// server.js - Chippewa Valley Home Care API
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');
const rateLimit = require('express-rate-limit');
const auditLogger = require('./middleware/auditLogger');
const authorizeAdmin = require('./middleware/authorizeAdmin');
const dotenv = require('dotenv');
const db = require('./db');
const claimsRoutes = require('./routes/claimsRoutes');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');
const billingRoutes = require('./routes/billingRoutes');
const reports = require('./routes/reports');
const stripeRoutes = require('./routes/stripeRoutes');
const applicationsRoutes = require('./routes/applicationsRoutes');
const schedulesRoutes = require('./routes/schedulesRoutes');

// Load environment variables
dotenv.config();

const app = express();
app.set('trust proxy', 1);
const port = process.env.PORT || 5000;

// ============ SECURITY MIDDLEWARE ============
app.use(helmet());
app.use(compression());
app.use(cors({
  origin: [
    'https://cvhc-crm.netlify.app',
    'https://chippewavalleyhomecare.com',
    'https://www.chippewavalleyhomecare.com',
    process.env.FRONTEND_URL || 'http://localhost:3000'
  ],
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100 // limit each IP to 100 requests per windowMs
});
app.use(limiter);

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ limit: '10mb', extended: true }));
// Strict rate limiting for auth routes (prevent brute force)
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5, // 5 attempts per 15 min
  message: { error: 'Too many login attempts. Try again in 15 minutes.' }
});

app.use('/api/auth/login', authLimiter);
app.use('/api/auth/register-caregiver', authLimiter);
app.use('/api/auth/register-admin', authLimiter);
// ============ DATABASE CONNECTION ============
app.use(auditLogger(db.pool));

// ============ HIPAA AUDIT LOGGING ============
const auditLog = async (userId, action, tableName, recordId, oldData, newData) => {
  try {
    // Skip if recordId is not a valid UUID string
    if (recordId && typeof recordId === 'string' && !recordId.match(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i)) {
      console.warn('Skipping audit log: invalid recordId format:', recordId);
      return;
    }
    
    await db.query(
      `INSERT INTO audit_logs (user_id, action, table_name, record_id, old_data, new_data, created_at)
 VALUES ($1, $2, $3, $4, $5, $6, NOW())`,
      [userId || '00000000-0000-0000-0000-000000000000', action, tableName, recordId, JSON.stringify(oldData), JSON.stringify(newData)]
    );
  } catch (error) {
    console.error('Audit log database error:', error.message);
  }
};

// ============ AUTHENTICATION MIDDLEWARE ============
const verifyToken = (req, res, next) => {
  const token = req.headers.authorization?.split(' ')[1];
  
  if (!token) {
    return res.status(401).json({ error: 'No token provided' });
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'your-secret-key-change-in-production');
    req.user = decoded;
    next();
  } catch (error) {
    return res.status(401).json({ error: 'Invalid token' });
  }
};

const requireAdmin = (req, res, next) => {
  if (req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Admin access required' });
  }
  next();
};

// ============ ROUTES ============
app.use('/api/reports', reports);
app.use('/api/claims', claimsRoutes); 
app.use('/api/stripe', stripeRoutes);
app.use('/api/applications', applicationsRoutes);
app.use('/api/schedules', schedulesRoutes);

// ---- AUTHENTICATION ROUTES ----
app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    const result = await db.query('SELECT * FROM users WHERE email = $1', [email]);
    const user = result.rows[0];

    if (!user) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const passwordMatch = await bcrypt.compare(password, user.password_hash);
    if (!passwordMatch) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const token = jwt.sign(
      { id: user.id, email: user.email, role: user.role, name: `${user.first_name} ${user.last_name}` },
      process.env.JWT_SECRET || 'your-secret-key-change-in-production',
      { expiresIn: '24h' }
    );

    res.json({
      token,
      user: {
        id: user.id,
        email: user.email,
        name: `${user.first_name} ${user.last_name}`,
        role: user.role
      }
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ error: 'Login failed' });
  }
});

app.post('/api/auth/register-caregiver', verifyToken, requireAdmin, async (req, res) => {
  try {
    const { email, password, firstName, lastName, phone, payRate } = req.body;

    const hashedPassword = await bcrypt.hash(password, 10);
    const userId = uuidv4();

    // Set current user for audit trigger
    await db.query("SELECT set_config('app.current_user_id', $1, false)", [req.user.id]);

    const result = await db.query(
      `INSERT INTO users (id, email, password_hash, first_name, last_name, phone, role, default_pay_rate)
       VALUES ($1, $2, $3, $4, $5, $6, 'caregiver', $7)
       RETURNING id, email, first_name, last_name, role, default_pay_rate`,
      [userId, email, hashedPassword, firstName, lastName, phone, payRate || 15.00]
    );

    res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error('Caregiver registration error:', error);
    if (error.code === '23505') { // Unique constraint violation
      return res.status(409).json({ error: 'Email already exists' });
    }
    res.status(500).json({ error: 'Registration failed' });
  }
});

app.post('/api/auth/register-admin', verifyToken, requireAdmin, async (req, res) => {
  try {
    const { email, password, firstName, lastName, phone } = req.body;

    const hashedPassword = await bcrypt.hash(password, 10);
    const userId = uuidv4();

    // Set current user for audit trigger
    await db.query("SELECT set_config('app.current_user_id', $1, false)", [req.user.id]);

    const result = await db.query(
      `INSERT INTO users (id, email, password_hash, first_name, last_name, phone, role)
       VALUES ($1, $2, $3, $4, $5, $6, 'admin')
       RETURNING id, email, first_name, last_name, role`,
      [userId, email, hashedPassword, firstName, lastName, phone]
    );

    res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error('Admin registration error:', error);
    if (error.code === '23505') { // Unique constraint violation
      return res.status(409).json({ error: 'Email already exists' });
    }
    res.status(500).json({ error: 'Registration failed' });
  }
});
// GET /api/users - Get users with optional role filter
app.get('/api/users', verifyToken, requireAdmin, async (req, res) => {
  try {
    const { role } = req.query;
    let query = `
      SELECT id, email, first_name, last_name, phone, role, is_active, hire_date, default_pay_rate
      FROM users
      WHERE 1=1
    `;
    const params = [];

    if (role) {
      params.push(role);
      query += ` AND role = $${params.length}`;
    }

    query += ` ORDER BY first_name, last_name`;
    
    const result = await db.query(query, params);
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});
// ---- USER MANAGEMENT ----
app.get('/api/users/caregivers', verifyToken, requireAdmin, async (req, res) => {
  try {
    const result = await db.query(
      `SELECT id, email, first_name, last_name, phone, hire_date, is_active, certifications, role, default_pay_rate
       FROM users WHERE role = 'caregiver' ORDER BY first_name`
    );
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Also support /api/caregivers for backwards compatibility
app.get('/api/caregivers', verifyToken, async (req, res) => {
  try {
    const result = await db.query(
      `SELECT id, email, first_name, last_name, phone, hire_date, is_active, certifications, role, default_pay_rate,
              address, city, state, zip, latitude, longitude
       FROM users WHERE role = 'caregiver' AND is_active = true ORDER BY first_name`
    );
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// PUT /api/caregivers/:id - Update caregiver info including pay rate and address
app.put('/api/caregivers/:id', verifyToken, requireAdmin, async (req, res) => {
  try {
    const { firstName, lastName, phone, payRate, address, city, state, zip, latitude, longitude } = req.body;
    
    const result = await db.query(
      `UPDATE users SET 
        first_name = COALESCE($1, first_name),
        last_name = COALESCE($2, last_name),
        phone = COALESCE($3, phone),
        default_pay_rate = COALESCE($4, default_pay_rate),
        address = COALESCE($5, address),
        city = COALESCE($6, city),
        state = COALESCE($7, state),
        zip = COALESCE($8, zip),
        latitude = COALESCE($9, latitude),
        longitude = COALESCE($10, longitude),
        updated_at = NOW()
       WHERE id = $11 AND role = 'caregiver'
       RETURNING id, email, first_name, last_name, phone, default_pay_rate, address, city, state, zip, latitude, longitude`,
      [firstName, lastName, phone, payRate, address, city, state, zip, latitude, longitude, req.params.id]
    );
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Caregiver not found' });
    }
    
    await auditLog(req.user.id, 'UPDATE', 'users', req.params.id, null, result.rows[0]);
    res.json(result.rows[0]);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET /api/users/admins - Get all admin users
app.get('/api/users/admins', verifyToken, requireAdmin, async (req, res) => {
  try {
    const result = await db.query(
      `SELECT id, email, first_name, last_name, phone, hire_date, is_active, role
       FROM users WHERE role = 'admin' ORDER BY first_name`
    );
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/users/convert-to-admin', verifyToken, requireAdmin, async (req, res) => {
  try {
    const { userId } = req.body;
    const result = await db.query(
      `UPDATE users SET role = 'admin', updated_at = NOW() WHERE id = $1 RETURNING *`,
      [userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    await auditLog(req.user.id, 'UPDATE', 'users', userId, null, result.rows[0]);
    res.json(result.rows[0]);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ---- CLIENTS ROUTES ----
app.post('/api/clients', verifyToken, async (req, res) => {
  try {
    const { 
      firstName, lastName, dateOfBirth, phone, email, address, city, state, zip, 
      referredBy, serviceType, referralSourceId, careTypeId, 
      isPrivatePay, privatePayRate, privatePayRateType, weeklyAuthorizedUnits 
    } = req.body;
    const clientId = uuidv4();

    const result = await db.query(
      `INSERT INTO clients (
        id, first_name, last_name, date_of_birth, phone, email, address, city, state, zip, 
        referred_by, service_type, start_date, referral_source_id, care_type_id,
        is_private_pay, private_pay_rate, private_pay_rate_type, weekly_authorized_units
      )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, CURRENT_DATE, $13, $14, $15, $16, $17, $18)
       RETURNING *`,
      [clientId, firstName, lastName, dateOfBirth, phone, email, address, city, state, zip, 
       referredBy || referralSourceId, serviceType, referralSourceId, careTypeId,
       isPrivatePay || false, privatePayRate, privatePayRateType || 'hourly', weeklyAuthorizedUnits || null]
    );

    // Create onboarding checklist
    await db.query(
      `INSERT INTO client_onboarding (client_id) VALUES ($1)`,
      [clientId]
    );

    await auditLog(req.user.id, 'CREATE', 'clients', clientId, null, result.rows[0]);
    res.status(201).json(result.rows[0]);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/clients', verifyToken, async (req, res) => {
  try {
    const result = await db.query(
      `SELECT c.*, rs.name as referral_source_name, ct.name as care_type_name
       FROM clients c
       LEFT JOIN referral_sources rs ON c.referral_source_id = rs.id
       LEFT JOIN care_types ct ON c.care_type_id = ct.id
       WHERE c.is_active = true 
       ORDER BY c.first_name`
    );
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/clients/:id', verifyToken, async (req, res) => {
  try {
    const clientResult = await db.query('SELECT * FROM clients WHERE id = $1', [req.params.id]);
    const emergencyResult = await db.query('SELECT * FROM client_emergency_contacts WHERE client_id = $1', [req.params.id]);
    const onboardingResult = await db.query('SELECT * FROM client_onboarding WHERE client_id = $1', [req.params.id]);

    res.json({
      client: clientResult.rows[0],
      emergencyContacts: emergencyResult.rows,
      onboarding: onboardingResult.rows[0]
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});
app.put('/api/clients/:id', verifyToken, async (req, res) => {
  try {
    const { 
      firstName, lastName, dateOfBirth, phone, email, address, city, state, zip, 
      serviceType, medicalConditions, allergies, medications, notes,
      insuranceProvider, insuranceId, insuranceGroup, gender, preferredCaregivers,
      emergencyContactName, emergencyContactPhone, emergencyContactRelationship,
      medicalNotes, doNotUseCaregivers, carePreferences, mobilityAssistanceNeeds,
      // Billing fields
      referralSourceId, careTypeId, isPrivatePay, privatePayRate, privatePayRateType, billingNotes,
      weeklyAuthorizedUnits,
      // Schedule optimization preferences
      serviceDaysPerWeek, serviceAllowedDays
    } = req.body;
    
    const result = await db.query(
      `UPDATE clients SET 
        first_name = COALESCE($1, first_name), 
        last_name = COALESCE($2, last_name), 
        date_of_birth = $3,
        phone = $4, 
        email = $5, 
        address = $6,
        city = $7,
        state = $8,
        zip = $9,
        service_type = COALESCE($10, service_type),
        medical_conditions = $11,
        allergies = $12,
        medications = $13,
        notes = $14,
        insurance_provider = $15,
        insurance_id = $16,
        insurance_group = $17,
        gender = $18,
        preferred_caregivers = $19,
        emergency_contact_name = $20,
        emergency_contact_phone = $21,
        emergency_contact_relationship = $22,
        medical_notes = $23,
        do_not_use_caregivers = $24,
        care_preferences = $25,
        mobility_assistance_needs = $26,
        referral_source_id = $27,
        care_type_id = $28,
        is_private_pay = COALESCE($29, is_private_pay),
        private_pay_rate = $30,
        private_pay_rate_type = COALESCE($31, private_pay_rate_type),
        billing_notes = $32,
        weekly_authorized_units = $33,
        service_days_per_week = COALESCE($34, service_days_per_week),
        service_allowed_days = COALESCE($35, service_allowed_days),
        updated_at = NOW()
       WHERE id = $36 RETURNING *`,
      [firstName, lastName, dateOfBirth, phone, email, address, city, state, zip, 
       serviceType, medicalConditions, allergies, medications, notes,
       insuranceProvider, insuranceId, insuranceGroup, gender, preferredCaregivers,
       emergencyContactName, emergencyContactPhone, emergencyContactRelationship,
       medicalNotes, doNotUseCaregivers, carePreferences, mobilityAssistanceNeeds,
       referralSourceId, careTypeId, isPrivatePay, privatePayRate, privatePayRateType, billingNotes,
       weeklyAuthorizedUnits,
       serviceDaysPerWeek || null, serviceAllowedDays ? JSON.stringify(serviceAllowedDays) : null,
       req.params.id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Client not found' });
    }

    await auditLog(req.user.id, 'UPDATE', 'clients', req.params.id, null, result.rows[0]);
    res.json(result.rows[0]);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// DELETE /api/clients/:id - Soft delete a client
app.delete('/api/clients/:id', verifyToken, requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    
    // Check if client exists
    const existing = await db.query('SELECT * FROM clients WHERE id = $1', [id]);
    if (existing.rows.length === 0) {
      return res.status(404).json({ error: 'Client not found' });
    }

    // Soft delete by setting is_active to false
    const result = await db.query(
      `UPDATE clients SET is_active = false, updated_at = NOW() WHERE id = $1 RETURNING *`,
      [id]
    );

    await auditLog(req.user.id, 'DELETE', 'clients', id, existing.rows[0], result.rows[0]);
    res.json({ message: 'Client deleted successfully', client: result.rows[0] });
  } catch (error) {
    console.error('Delete client error:', error);
    res.status(500).json({ error: error.message });
  }
});

// ---- CLIENT ONBOARDING ----
app.get('/api/clients/:id/onboarding', verifyToken, async (req, res) => {
  try {
    let result = await db.query(
      `SELECT * FROM client_onboarding WHERE client_id = $1`,
      [req.params.id]
    );

    if (result.rows.length === 0) {
      // Create one if it doesn't exist
      await db.query(
        `INSERT INTO client_onboarding (client_id) VALUES ($1)`,
        [req.params.id]
      );
      result = await db.query(
        `SELECT * FROM client_onboarding WHERE client_id = $1`,
        [req.params.id]
      );
    }

    res.json(result.rows[0] || {});
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.patch('/api/clients/:id/onboarding/:stepId', verifyToken, async (req, res) => {
  try {
    const stepId = req.params.stepId;
    const updates = req.body;

    // Build dynamic UPDATE query based on fields provided
    let updateFields = [];
    let params = [];
    let paramIndex = 1;

    Object.keys(updates).forEach(key => {
      updateFields.push(`${key} = $${paramIndex}`);
      params.push(updates[key]);
      paramIndex++;
    });

    if (updateFields.length === 0) {
      return res.json({ message: 'No fields to update' });
    }

    updateFields.push(`updated_at = NOW()`);
    params.push(req.params.id);

    const query = `
      UPDATE client_onboarding 
      SET ${updateFields.join(', ')}
      WHERE client_id = $${paramIndex}
      RETURNING *
    `;

    const result = await db.query(query, params);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Onboarding record not found' });
    }

    await auditLog(req.user.id, 'UPDATE', 'client_onboarding', req.params.id, null, result.rows[0]);
    res.json(result.rows[0]);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ---- CAREGIVER CLIENT VIEW (Limited info for caregivers) ----
app.get('/api/clients/:id/caregiver-view', verifyToken, async (req, res) => {
  try {
    // Return only care-relevant info, NOT billing/admin stuff
    const result = await db.query(
      `SELECT 
        id, first_name, last_name, date_of_birth, phone, email,
        address, city, state, zip,
        emergency_contact_name, emergency_contact_phone, emergency_contact_relationship,
        medical_conditions, medications, allergies, medical_notes,
        care_preferences, mobility_assistance_needs,
        preferred_caregivers, notes
       FROM clients WHERE id = $1`,
      [req.params.id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Client not found' });
    }

    res.json(result.rows[0]);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ---- CLIENT VISIT NOTES ----
app.get('/api/clients/:id/visit-notes', verifyToken, async (req, res) => {
  try {
    const result = await db.query(
      `SELECT vn.*, u.first_name || ' ' || u.last_name as caregiver_name
       FROM client_visit_notes vn
       LEFT JOIN users u ON vn.caregiver_id = u.id
       WHERE vn.client_id = $1
       ORDER BY vn.created_at DESC
       LIMIT 50`,
      [req.params.id]
    );

    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/clients/:id/visit-notes', verifyToken, async (req, res) => {
  try {
    const { note } = req.body;
    const noteId = uuidv4();

    const result = await db.query(
      `INSERT INTO client_visit_notes (id, client_id, caregiver_id, note)
       VALUES ($1, $2, $3, $4)
       RETURNING *`,
      [noteId, req.params.id, req.user.id, note]
    );

    await auditLog(req.user.id, 'CREATE', 'client_visit_notes', noteId, null, result.rows[0]);
    res.status(201).json(result.rows[0]);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ---- REFERRAL SOURCES ----
app.post('/api/referral-sources', verifyToken, requireAdmin, async (req, res) => {
  try {
    const { name, type, contactName, email, phone, address, city, state, zip } = req.body;
    const sourceId = uuidv4();

    const result = await db.query(
      `INSERT INTO referral_sources (id, name, type, contact_name, email, phone, address, city, state, zip)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       RETURNING *`,
      [sourceId, name, type, contactName, email, phone, address, city, state, zip]
    );

    await auditLog(req.user.id, 'CREATE', 'referral_sources', sourceId, null, result.rows[0]);
    res.status(201).json(result.rows[0]);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/referral-sources', verifyToken, async (req, res) => {
  try {
    const result = await db.query(
      `SELECT rs.*, COUNT(c.id) as referral_count 
       FROM referral_sources rs
       LEFT JOIN clients c ON rs.id = c.referred_by AND c.is_active = true
       WHERE rs.is_active = true
       GROUP BY rs.id
       ORDER BY referral_count DESC`
    );
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ---- DASHBOARD ANALYTICS ----
app.get('/api/dashboard/summary', verifyToken, requireAdmin, async (req, res) => {
  try {
    const totalClientsResult = await db.query('SELECT COUNT(*) as count FROM clients WHERE is_active = true');
    const activeCaregiversResult = await db.query('SELECT COUNT(*) as count FROM users WHERE role = \'caregiver\' AND is_active = true');
    const pendingInvoicesResult = await db.query('SELECT COUNT(*) as count, SUM(total) as amount FROM invoices WHERE payment_status = \'pending\'');
    const thisMonthRevenueResult = await db.query(
      `SELECT SUM(total) as amount FROM invoices 
       WHERE billing_period_start >= date_trunc('month', CURRENT_DATE)
       AND payment_status = 'paid'`
    );

    res.json({
      totalClients: parseInt(totalClientsResult.rows[0].count),
      activeCaregivers: parseInt(activeCaregiversResult.rows[0].count),
      pendingInvoices: {
        count: parseInt(pendingInvoicesResult.rows[0].count),
        amount: parseFloat(pendingInvoicesResult.rows[0].amount || 0)
      },
      thisMonthRevenue: parseFloat(thisMonthRevenueResult.rows[0].amount || 0)
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/dashboard/referrals', verifyToken, requireAdmin, async (req, res) => {
  try {
    const result = await db.query(
      `SELECT rs.name, rs.type, COUNT(c.id) as referral_count,
              SUM(CASE WHEN i.payment_status = 'paid' THEN i.total ELSE 0 END) as total_revenue
       FROM referral_sources rs
       LEFT JOIN clients c ON rs.id = c.referred_by
       LEFT JOIN invoices i ON c.id = i.client_id
       WHERE rs.is_active = true
       GROUP BY rs.id, rs.name, rs.type
       ORDER BY referral_count DESC`
    );
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/dashboard/caregiver-hours', verifyToken, requireAdmin, async (req, res) => {
  try {
    const result = await db.query(
      `SELECT u.id, u.first_name, u.last_name,
              COUNT(te.id) as shifts,
              COALESCE(SUM(te.duration_minutes)::integer / 60, 0) as total_hours,
              COALESCE(AVG(pr.satisfaction_score), 0) as avg_satisfaction
       FROM users u
       LEFT JOIN time_entries te ON u.id = te.caregiver_id AND te.end_time IS NOT NULL
       LEFT JOIN performance_ratings pr ON u.id = pr.caregiver_id
       WHERE u.role = 'caregiver' AND u.is_active = true
       GROUP BY u.id, u.first_name, u.last_name
       ORDER BY total_hours DESC NULLS LAST`
    );
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ---- TIME TRACKING ----

// GET /api/time-entries/active - Get caregiver's active (non-clocked-out) session
app.get('/api/time-entries/active', verifyToken, async (req, res) => {
  try {
    const result = await db.query(
      `SELECT te.*, c.first_name as client_first_name, c.last_name as client_last_name
       FROM time_entries te
       JOIN clients c ON te.client_id = c.id
       WHERE te.caregiver_id = $1 AND te.end_time IS NULL
       ORDER BY te.start_time DESC
       LIMIT 1`,
      [req.user.id]
    );
    
    if (result.rows.length === 0) {
      return res.json(null);
    }
    
    // Map to expected format
    const entry = result.rows[0];
    res.json({
      id: entry.id,
      client_id: entry.client_id,
      start_time: entry.start_time,
      client_name: `${entry.client_first_name} ${entry.client_last_name}`
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET /api/time-entries/recent - Get recent completed visits for caregiver
app.get('/api/time-entries/recent', verifyToken, async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 10;
    const result = await db.query(
      `SELECT te.*, c.first_name as client_first_name, c.last_name as client_last_name
       FROM time_entries te
       JOIN clients c ON te.client_id = c.id
       WHERE te.caregiver_id = $1 AND te.end_time IS NOT NULL
       ORDER BY te.start_time DESC
       LIMIT $2`,
      [req.user.id, limit]
    );
    
    // Map to expected format
    const visits = result.rows.map(entry => ({
      id: entry.id,
      client_id: entry.client_id,
      start_time: entry.start_time,
      end_time: entry.end_time,
      notes: entry.notes,
      hours_worked: entry.hours_worked,
      client_name: `${entry.client_first_name} ${entry.client_last_name}`
    }));
    
    res.json(visits);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/time-entries/clock-in
app.post('/api/time-entries/clock-in', verifyToken, async (req, res) => {
  try {
    const { clientId, latitude, longitude } = req.body;
    const entryId = uuidv4();

    const result = await db.query(
      `INSERT INTO time_entries (id, caregiver_id, client_id, start_time, clock_in_location)
       VALUES ($1, $2, $3, NOW(), $4)
       RETURNING *`,
      [entryId, req.user.id, clientId, JSON.stringify({ lat: latitude, lng: longitude })]
    );

    await auditLog(req.user.id, 'CREATE', 'time_entries', entryId, null, result.rows[0]);

    // Get client name for push notification
    let clientName = null;
    if (clientId) {
      try {
        const cl = await db.query('SELECT first_name, last_name FROM clients WHERE id = $1', [clientId]);
        if (cl.rows[0]) clientName = `${cl.rows[0].first_name} ${cl.rows[0].last_name}`;
      } catch {}
    }

    // Fire push notification (async, don't await)
    try {
      const { sendPushToUser } = require('./routes/pushNotificationRoutes');
      const startTimeFormatted = new Date(result.rows[0].start_time).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
      sendPushToUser(req.user.id, {
        title: '✅ Clocked In',
        body: `You are clocked in${clientName ? ` for ${clientName}` : ''}. Started at ${startTimeFormatted}.`,
        icon: '/icon-192.png',
        tag: `clock-in-${entryId}`,
        data: { type: 'clock_in', timeEntryId: entryId },
      });
    } catch {}

    res.status(201).json({
      id: result.rows[0].id,
      client_id: result.rows[0].client_id,
      start_time: result.rows[0].start_time
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/time-entries/:id/clock-out (also support POST, not just PATCH)
app.post('/api/time-entries/:id/clock-out', verifyToken, async (req, res) => {
  try {
    const { latitude, longitude, notes } = req.body;

    const timeEntry = await db.query(
      `SELECT te.*, c.first_name as client_first_name, c.last_name as client_last_name
       FROM time_entries te
       LEFT JOIN clients c ON te.client_id = c.id
       WHERE te.id = $1`,
      [req.params.id]
    );
    if (timeEntry.rows.length === 0) {
      return res.status(404).json({ error: 'Time entry not found' });
    }

    const clockIn = new Date(timeEntry.rows[0].start_time);
    const clockOut = new Date();
    const hoursWorked = (clockOut - clockIn) / (1000 * 60 * 60);
    const durationMinutes = Math.round(hoursWorked * 60);

    const result = await db.query(
      `UPDATE time_entries SET 
        end_time = NOW(),
        clock_out_location = $1,
        duration_minutes = $2,
        is_complete = true,
        notes = $3,
        updated_at = NOW()
       WHERE id = $4
       RETURNING *`,
      [
        latitude && longitude ? JSON.stringify({ lat: latitude, lng: longitude }) : null,
        durationMinutes,
        notes || null,
        req.params.id
      ]
    );

    await auditLog(req.user.id, 'UPDATE', 'time_entries', req.params.id, null, result.rows[0]);

    // Fire push notification (async)
    try {
      const { sendPushToUser } = require('./routes/pushNotificationRoutes');
      const clientName = timeEntry.rows[0].client_first_name
        ? `${timeEntry.rows[0].client_first_name} ${timeEntry.rows[0].client_last_name}`
        : null;
      const hrs = hoursWorked.toFixed(2);
      const durationStr = durationMinutes >= 60
        ? `${Math.floor(durationMinutes / 60)}h ${durationMinutes % 60}m`
        : `${durationMinutes}m`;

      sendPushToUser(req.user.id, {
        title: '🕐 Clocked Out',
        body: `Shift complete${clientName ? ` — ${clientName}` : ''}. Duration: ${durationStr} (${hrs}h).`,
        icon: '/icon-192.png',
        tag: `clock-out-${req.params.id}`,
        data: { type: 'clock_out' },
      });
    } catch {}

    res.json(result.rows[0]);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/time-entries/:id/gps - Track GPS during active session (writes breadcrumbs)
app.post('/api/time-entries/:id/gps', verifyToken, async (req, res) => {
  try {
    const { latitude, longitude, accuracy, speed, heading } = req.body;

    const entryCheck = await db.query(
      `SELECT id FROM time_entries WHERE id = $1 AND caregiver_id = $2 AND end_time IS NULL`,
      [req.params.id, req.user.id]
    );

    if (entryCheck.rows.length === 0) {
      return res.status(404).json({ error: 'Active time entry not found' });
    }

    await db.query(
      `INSERT INTO gps_tracking (caregiver_id, time_entry_id, latitude, longitude, accuracy, speed, heading, timestamp)
       VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())`,
      [req.user.id, req.params.id, latitude, longitude, accuracy || null, speed || null, heading || null]
    );

    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET /api/time-entries/:id/gps - Get GPS breadcrumb trail for a specific shift
app.get('/api/time-entries/:id/gps', verifyToken, async (req, res) => {
  try {
    const result = await db.query(
      `SELECT latitude, longitude, accuracy, speed, heading, timestamp
       FROM gps_tracking
       WHERE time_entry_id = $1
       ORDER BY timestamp ASC`,
      [req.params.id]
    );
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET /api/time-entries/caregiver-history/:caregiverId - Full shift history with GPS
app.get('/api/time-entries/caregiver-history/:caregiverId', verifyToken, async (req, res) => {
  try {
    const { startDate, endDate, limit = 50 } = req.query;
    const result = await db.query(
      `SELECT 
        te.*,
        c.first_name as client_first_name, c.last_name as client_last_name,
        c.address as client_address, c.city as client_city,
        (SELECT COUNT(*) FROM gps_tracking gt WHERE gt.time_entry_id = te.id) as gps_point_count
       FROM time_entries te
       LEFT JOIN clients c ON te.client_id = c.id
       WHERE te.caregiver_id = $1
         ${startDate ? 'AND te.start_time >= $4::timestamptz' : ''}
         ${endDate ? 'AND te.start_time <= $5::timestamptz' : ''}
       ORDER BY te.start_time DESC
       LIMIT $2`,
      [req.params.caregiverId, limit,
        ...(startDate ? [startDate] : []),
        ...(endDate ? [endDate] : [])
      ].filter((_, i) => {
        if (i === 2 && !startDate) return false;
        if (i === 3 && !endDate) return false;
        return true;
      })
    );
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET /api/time-entries - Get all time entries
app.get('/api/time-entries', verifyToken, async (req, res) => {
  try {
    const result = await db.query(
      `SELECT te.*, u.first_name, u.last_name, c.first_name as client_first_name, c.last_name as client_last_name
       FROM time_entries te
       JOIN users u ON te.caregiver_id = u.id
       JOIN clients c ON te.client_id = c.id
       ORDER BY te.start_time DESC`
    );
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET /api/time-entries/caregiver/:caregiverId - Get caregiver time entries
app.get('/api/time-entries/caregiver/:caregiverId', verifyToken, async (req, res) => {
  try {
    const result = await db.query(
      `SELECT te.*, c.first_name as client_first_name, c.last_name as client_last_name
       FROM time_entries te
       JOIN clients c ON te.client_id = c.id
       WHERE te.caregiver_id = $1
       ORDER BY te.start_time DESC`,
      [req.params.caregiverId]
    );
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ---- CAREGIVER RATES ----

// GET /api/caregiver-rates/:caregiverId
app.get('/api/caregiver-rates/:caregiverId', verifyToken, async (req, res) => {
  try {
    let result = await db.query(
      `SELECT * FROM caregiver_rates WHERE caregiver_id = $1`,
      [req.params.caregiverId]
    );

    if (result.rows.length === 0) {
      // Create default rate if not exists
      await db.query(
        `INSERT INTO caregiver_rates (caregiver_id, base_hourly_rate) VALUES ($1, $2)`,
        [req.params.caregiverId, 18.50]
      );
      result = await db.query(
        `SELECT * FROM caregiver_rates WHERE caregiver_id = $1`,
        [req.params.caregiverId]
      );
    }

    res.json(result.rows[0]);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// PUT /api/caregiver-rates/:caregiverId
app.put('/api/caregiver-rates/:caregiverId', verifyToken, requireAdmin, async (req, res) => {
  try {
    const { baseHourlyRate, overtimeRate, premiumRate } = req.body;

    const result = await db.query(
      `UPDATE caregiver_rates SET
        base_hourly_rate = COALESCE($1, base_hourly_rate),
        overtime_rate = COALESCE($2, overtime_rate),
        premium_rate = COALESCE($3, premium_rate),
        updated_at = NOW()
       WHERE caregiver_id = $4
       RETURNING *`,
      [baseHourlyRate, overtimeRate, premiumRate, req.params.caregiverId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Caregiver rate not found' });
    }

    await auditLog(req.user.id, 'UPDATE', 'caregiver_rates', req.params.caregiverId, null, result.rows[0]);
    res.json(result.rows[0]);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ---- SERVICE PRICING ----

// GET /api/service-pricing - List all services
app.get('/api/service-pricing', verifyToken, async (req, res) => {
  try {
    const result = await db.query(
      `SELECT * FROM service_pricing WHERE is_active = true ORDER BY service_name`
    );
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/service-pricing - Create new service
app.post('/api/service-pricing', verifyToken, requireAdmin, async (req, res) => {
  try {
    const { serviceName, description, clientHourlyRate, caregiverHourlyRate } = req.body;
    const serviceId = uuidv4();

    if (!serviceName || !clientHourlyRate || !caregiverHourlyRate) {
      return res.status(400).json({ error: 'serviceName, clientHourlyRate, and caregiverHourlyRate are required' });
    }

    const result = await db.query(
      `INSERT INTO service_pricing (id, service_name, description, client_hourly_rate, caregiver_hourly_rate)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [serviceId, serviceName, description || null, clientHourlyRate, caregiverHourlyRate]
    );

    await auditLog(req.user.id, 'CREATE', 'service_pricing', serviceId, null, result.rows[0]);
    res.status(201).json(result.rows[0]);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// PUT /api/service-pricing/:id - Update service pricing
app.put('/api/service-pricing/:id', verifyToken, requireAdmin, async (req, res) => {
  try {
    const { serviceName, description, clientHourlyRate, caregiverHourlyRate } = req.body;

    const result = await db.query(
      `UPDATE service_pricing SET
        service_name = COALESCE($1, service_name),
        description = COALESCE($2, description),
        client_hourly_rate = COALESCE($3, client_hourly_rate),
        caregiver_hourly_rate = COALESCE($4, caregiver_hourly_rate),
        updated_at = NOW()
       WHERE id = $5
       RETURNING *`,
      [serviceName, description, clientHourlyRate, caregiverHourlyRate, req.params.id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Service not found' });
    }

    await auditLog(req.user.id, 'UPDATE', 'service_pricing', req.params.id, null, result.rows[0]);
    res.json(result.rows[0]);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// DELETE /api/service-pricing/:id - Deactivate service
app.delete('/api/service-pricing/:id', verifyToken, requireAdmin, async (req, res) => {
  try {
    const result = await db.query(
      `UPDATE service_pricing SET is_active = false, updated_at = NOW() WHERE id = $1 RETURNING *`,
      [req.params.id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Service not found' });
    }

    await auditLog(req.user.id, 'DELETE', 'service_pricing', req.params.id, null, result.rows[0]);
    res.json({ message: 'Service deactivated' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ---- CLIENT SERVICES ----

// GET /api/clients/:clientId/services - Get client's assigned services
app.get('/api/clients/:clientId/services', verifyToken, async (req, res) => {
  try {
    const result = await db.query(
      `SELECT cs.*, sp.service_name, sp.client_hourly_rate, sp.caregiver_hourly_rate
       FROM client_services cs
       JOIN service_pricing sp ON cs.service_pricing_id = sp.id
       WHERE cs.client_id = $1
       ORDER BY cs.is_primary DESC, sp.service_name`,
      [req.params.clientId]
    );
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/clients/:clientId/services - Assign service to client
app.post('/api/clients/:clientId/services', verifyToken, requireAdmin, async (req, res) => {
  try {
    const { servicePricingId, isPrimary, notes } = req.body;
    const assignmentId = uuidv4();

    if (!servicePricingId) {
      return res.status(400).json({ error: 'servicePricingId is required' });
    }

    // If setting as primary, unset other primaries for this client
    if (isPrimary) {
      await db.query(
        `UPDATE client_services SET is_primary = false WHERE client_id = $1`,
        [req.params.clientId]
      );
    }

    const result = await db.query(
      `INSERT INTO client_services (id, client_id, service_pricing_id, is_primary, notes)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [assignmentId, req.params.clientId, servicePricingId, isPrimary || false, notes || null]
    );

    await auditLog(req.user.id, 'CREATE', 'client_services', assignmentId, null, result.rows[0]);
    res.status(201).json(result.rows[0]);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// DELETE /api/clients/:clientId/services/:serviceId - Remove service from client
app.delete('/api/clients/:clientId/services/:serviceId', verifyToken, requireAdmin, async (req, res) => {
  try {
    const result = await db.query(
      `DELETE FROM client_services WHERE id = $1 AND client_id = $2 RETURNING *`,
      [req.params.serviceId, req.params.clientId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Service assignment not found' });
    }

    await auditLog(req.user.id, 'DELETE', 'client_services', req.params.serviceId, null, result.rows[0]);
    res.json({ message: 'Service removed from client' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET /api/service-pricing/margins - Get all services with profit margins
app.get('/api/service-pricing/margins', verifyToken, requireAdmin, async (req, res) => {
  try {
    const result = await db.query(
      `SELECT 
        id,
        service_name,
        client_hourly_rate,
        caregiver_hourly_rate,
        (client_hourly_rate - caregiver_hourly_rate) as margin_per_hour,
        ROUND((((client_hourly_rate - caregiver_hourly_rate) / client_hourly_rate) * 100)::numeric, 1) as margin_percentage
       FROM service_pricing
       WHERE is_active = true
       ORDER BY margin_per_hour DESC`
    );
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ---- PAYROLL PROCESSING ----

// POST /api/payroll/run - Generate payroll for a period
app.post('/api/payroll/run', verifyToken, requireAdmin, async (req, res) => {
  try {
    const { payPeriodStart, payPeriodEnd } = req.body;

    if (!payPeriodStart || !payPeriodEnd) {
      return res.status(400).json({ error: 'payPeriodStart and payPeriodEnd are required' });
    }

    const payrollId = uuidv4();
    const payrollNumber = `PR-${Date.now()}`;

    // Get all time entries for the period
    const timeEntriesResult = await db.query(
      `SELECT te.*, u.first_name, u.last_name, cr.base_hourly_rate
       FROM time_entries te
       JOIN users u ON te.caregiver_id = u.id
       LEFT JOIN caregiver_rates cr ON te.caregiver_id = cr.caregiver_id
       WHERE te.start_time >= $1 AND te.start_time <= $2
       AND te.hours_worked > 0
       ORDER BY te.caregiver_id`,
      [payPeriodStart, payPeriodEnd]
    );

    // Group by caregiver and calculate totals
    const caregiverPayroll = {};
    let totalGrossPay = 0;

    for (const entry of timeEntriesResult.rows) {
      if (!caregiverPayroll[entry.caregiver_id]) {
        caregiverPayroll[entry.caregiver_id] = {
          caregiverId: entry.caregiver_id,
          caregiverName: `${entry.first_name} ${entry.last_name}`,
          totalHours: 0,
          hourlyRate: entry.base_hourly_rate || 18.50,
          grossPay: 0,
          lineItems: []
        };
      }

      caregiverPayroll[entry.caregiver_id].totalHours += parseFloat(entry.hours_worked);
      caregiverPayroll[entry.caregiver_id].lineItems.push({
        timeEntryId: entry.id,
        date: entry.start_time,
        hours: entry.hours_worked,
        rate: entry.base_hourly_rate || 18.50
      });
    }

    // Calculate gross pay and create line items
    const lineItems = [];
    for (const caregiverId in caregiverPayroll) {
      const payData = caregiverPayroll[caregiverId];
      payData.grossPay = (payData.totalHours * payData.hourlyRate).toFixed(2);
      totalGrossPay += parseFloat(payData.grossPay);

      // Create line item for this caregiver
      lineItems.push({
        caregiverId: caregiverId,
        description: `Hours: ${payData.totalHours.toFixed(2)} × $${payData.hourlyRate.toFixed(2)}/hr`,
        totalHours: payData.totalHours.toFixed(2),
        hourlyRate: payData.hourlyRate,
        grossAmount: payData.grossPay
      });
    }

    // Calculate taxes and deductions (standard FICA: 7.65%)
    const taxRate = 0.0765;
    const totalTaxes = (totalGrossPay * taxRate).toFixed(2);
    const totalNetPay = (totalGrossPay - parseFloat(totalTaxes)).toFixed(2);

    // Create payroll record
    const payrollResult = await db.query(
      `INSERT INTO payroll (id, payroll_number, pay_period_start, pay_period_end, total_hours, gross_pay, taxes, net_pay, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING *`,
      [payrollId, payrollNumber, payPeriodStart, payPeriodEnd, 
       Object.values(caregiverPayroll).reduce((sum, p) => sum + p.totalHours, 0).toFixed(2),
       totalGrossPay, totalTaxes, totalNetPay, 'pending']
    );

    // Create line items for each caregiver
    for (const item of lineItems) {
      await db.query(
        `INSERT INTO payroll_line_items (payroll_id, caregiver_id, description, total_hours, hourly_rate, gross_amount)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [payrollId, item.caregiverId, item.description, item.totalHours, item.hourlyRate, item.grossAmount]
      );
    }

    await auditLog(req.user.id, 'CREATE', 'payroll', payrollId, null, payrollResult.rows[0]);
    res.status(201).json({
      ...payrollResult.rows[0],
      lineItems: lineItems,
      caregiverCount: lineItems.length
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET /api/payroll - List all payrolls
app.get('/api/payroll', verifyToken, requireAdmin, async (req, res) => {
  try {
    const result = await db.query(
      `SELECT * FROM payroll ORDER BY pay_period_end DESC`
    );
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET /api/payroll/:payrollId - Get payroll details with line items
app.get('/api/payroll/:payrollId', verifyToken, requireAdmin, async (req, res) => {
  try {
    const payrollResult = await db.query(
      `SELECT * FROM payroll WHERE id = $1`,
      [req.params.payrollId]
    );

    if (payrollResult.rows.length === 0) {
      return res.status(404).json({ error: 'Payroll not found' });
    }

    const lineItemsResult = await db.query(
      `SELECT pli.*, u.first_name, u.last_name
       FROM payroll_line_items pli
       JOIN users u ON pli.caregiver_id = u.id
       WHERE pli.payroll_id = $1
       ORDER BY u.first_name, u.last_name`,
      [req.params.payrollId]
    );

    res.json({
      ...payrollResult.rows[0],
      lineItems: lineItemsResult.rows
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// PATCH /api/payroll/:payrollId/status - Update payroll status
app.patch('/api/payroll/:payrollId/status', verifyToken, requireAdmin, async (req, res) => {
  try {
    const { status, processedDate, paymentMethod } = req.body;

    if (!status) {
      return res.status(400).json({ error: 'status is required' });
    }

    const result = await db.query(
      `UPDATE payroll SET 
        status = $1,
        processed_date = CASE WHEN $1 = 'processed' THEN COALESCE($2, NOW()) ELSE processed_date END,
        payment_method = COALESCE($3, payment_method),
        updated_at = NOW()
       WHERE id = $4
       RETURNING *`,
      [status, processedDate, paymentMethod, req.params.payrollId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Payroll not found' });
    }

    await auditLog(req.user.id, 'UPDATE', 'payroll', req.params.payrollId, null, result.rows[0]);
    res.json(result.rows[0]);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET /api/payroll/caregiver/:caregiverId - Get caregiver payroll history
app.get('/api/payroll/caregiver/:caregiverId', verifyToken, async (req, res) => {
  try {
    const result = await db.query(
      `SELECT pli.*, p.payroll_number, p.pay_period_start, p.pay_period_end, p.status
       FROM payroll_line_items pli
       JOIN payroll p ON pli.payroll_id = p.id
       WHERE pli.caregiver_id = $1
       ORDER BY p.pay_period_end DESC`,
      [req.params.caregiverId]
    );
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET /api/payroll/summary - Payroll overview and reports
app.get('/api/payroll/summary', verifyToken, requireAdmin, async (req, res) => {
  try {
    const result = await db.query(
      `SELECT 
        COUNT(DISTINCT id) as total_payrolls,
        COUNT(DISTINCT CASE WHEN status = 'pending' THEN id END) as pending_payrolls,
        COUNT(DISTINCT CASE WHEN status = 'processed' THEN id END) as processed_payrolls,
        COUNT(DISTINCT CASE WHEN status = 'paid' THEN id END) as paid_payrolls,
        SUM(gross_pay) as total_gross_pay,
        SUM(taxes) as total_taxes,
        SUM(net_pay) as total_net_pay,
        AVG(total_hours) as average_hours_per_payroll,
        MAX(pay_period_end) as latest_payroll_date
       FROM payroll`
    );

    const caregiverResult = await db.query(
      `SELECT 
        u.id,
        u.first_name,
        u.last_name,
        COUNT(pli.id) as payroll_count,
        SUM(pli.total_hours) as total_hours_paid,
        SUM(pli.gross_amount) as total_earned
       FROM users u
       LEFT JOIN payroll_line_items pli ON u.id = pli.caregiver_id
       WHERE u.role = 'caregiver'
       GROUP BY u.id, u.first_name, u.last_name
       ORDER BY total_earned DESC NULLS LAST`
    );

    res.json({
      summary: result.rows[0],
      caregiverStats: caregiverResult.rows
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET /api/payroll-periods - List distinct pay periods
app.get('/api/payroll-periods', verifyToken, requireAdmin, async (req, res) => {
  try {
    const result = await db.query(
      `SELECT DISTINCT pay_period_start, pay_period_end FROM payroll ORDER BY pay_period_end DESC`
    );
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ---- REPORTS & ANALYTICS ----

// GET /api/reports/revenue - Revenue by period, client, or service
app.get('/api/reports/revenue', verifyToken, requireAdmin, async (req, res) => {
  try {
    const { startDate, endDate, groupBy = 'period' } = req.query;

    let query = `
      SELECT 
        DATE_TRUNC('month', i.billing_period_end)::DATE as period,
        c.id as client_id,
        c.first_name || ' ' || c.last_name as client_name,
        sp.service_name,
        SUM(i.total) as total_revenue,
        COUNT(DISTINCT i.id) as invoice_count,
        SUM(i.subtotal) as subtotal,
        SUM(i.tax) as tax_collected
      FROM invoices i
      JOIN clients c ON i.client_id = c.id
      LEFT JOIN client_services cs ON c.id = cs.client_id
      LEFT JOIN service_pricing sp ON cs.service_pricing_id = sp.id
    `;

    const params = [];
    let paramIndex = 1;

    if (startDate && endDate) {
      query += ` WHERE i.created_at >= $${paramIndex} AND i.created_at <= $${paramIndex + 1}`;
      params.push(startDate, endDate);
      paramIndex += 2;
    }

    if (groupBy === 'client') {
      query += ` GROUP BY c.id, c.first_name, c.last_name, sp.service_name ORDER BY total_revenue DESC`;
    } else if (groupBy === 'service') {
      query += ` GROUP BY sp.service_name ORDER BY total_revenue DESC`;
    } else {
      query += ` GROUP BY period, c.id, c.first_name, c.last_name, sp.service_name ORDER BY period DESC`;
    }

    const result = await db.query(query, params);
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET /api/reports/profitability - Profit margins and analysis (including expenses)
app.get('/api/reports/profitability', verifyToken, requireAdmin, async (req, res) => {
  try {
    const result = await db.query(
      `SELECT 
        c.id,
        c.first_name || ' ' || c.last_name as client_name,
        SUM(i.total) as total_billed,
        SUM(pli.gross_amount) as payroll_cost,
        COALESCE((SELECT SUM(amount) FROM expenses), 0) as total_company_expenses,
        (SUM(i.total) - SUM(pli.gross_amount)) as gross_profit,
        (SUM(i.total) - SUM(pli.gross_amount) - COALESCE((SELECT SUM(amount) FROM expenses), 0)) as net_profit,
        ROUND((((SUM(i.total) - SUM(pli.gross_amount)) / NULLIF(SUM(i.total), 0)) * 100)::numeric, 2) as gross_margin_percent,
        ROUND((((SUM(i.total) - SUM(pli.gross_amount) - COALESCE((SELECT SUM(amount) FROM expenses), 0)) / NULLIF(SUM(i.total), 0)) * 100)::numeric, 2) as net_margin_percent,
        COUNT(DISTINCT i.id) as invoice_count
       FROM clients c
       LEFT JOIN invoices i ON c.id = i.client_id
       LEFT JOIN invoice_line_items ili ON i.id = ili.invoice_id
       LEFT JOIN payroll_line_items pli ON ili.caregiver_id = pli.caregiver_id
       GROUP BY c.id, c.first_name, c.last_name
       HAVING SUM(i.total) > 0
       ORDER BY net_profit DESC`
    );
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET /api/reports/caregiver-performance - Caregiver stats and metrics
app.get('/api/reports/caregiver-performance', verifyToken, requireAdmin, async (req, res) => {
  try {
    const result = await db.query(
      `SELECT 
        u.id,
        u.first_name || ' ' || u.last_name as caregiver_name,
        COUNT(DISTINCT te.id) as time_entries,
        SUM(te.hours_worked) as total_hours,
        cr.base_hourly_rate,
        SUM(pli.gross_amount) as total_earned,
        COUNT(DISTINCT s.id) as active_schedules,
        COUNT(DISTINCT s.client_id) as unique_clients
       FROM users u
       LEFT JOIN time_entries te ON u.id = te.caregiver_id
       LEFT JOIN caregiver_rates cr ON u.id = cr.caregiver_id
       LEFT JOIN payroll_line_items pli ON u.id = pli.caregiver_id
       LEFT JOIN schedules s ON u.id = s.caregiver_id AND s.is_active = true
       WHERE u.role = 'caregiver'
       GROUP BY u.id, u.first_name, u.last_name, cr.base_hourly_rate
       ORDER BY total_earned DESC NULLS LAST`
    );
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET /api/reports/client-summary - Client revenue and cost breakdown
app.get('/api/reports/client-summary', verifyToken, requireAdmin, async (req, res) => {
  try {
    const result = await db.query(
      `SELECT 
        c.id,
        c.first_name || ' ' || c.last_name as client_name,
        c.service_type,
        c.city,
        COUNT(DISTINCT s.id) as active_schedules,
        COUNT(DISTINCT i.id) as total_invoices,
        SUM(i.total) as total_billed,
        SUM(i.subtotal) as subtotal,
        SUM(CASE WHEN i.payment_status = 'paid' THEN i.total ELSE 0 END) as amount_paid,
        SUM(CASE WHEN i.payment_status = 'pending' THEN i.total ELSE 0 END) as amount_pending,
        COUNT(DISTINCT te.caregiver_id) as unique_caregivers,
        SUM(te.hours_worked) as total_hours_worked
       FROM clients c
       LEFT JOIN invoices i ON c.id = i.client_id
       LEFT JOIN schedules s ON c.id = s.client_id AND s.is_active = true
       LEFT JOIN time_entries te ON c.id = te.client_id
       WHERE c.is_active = true
       GROUP BY c.id, c.first_name, c.last_name, c.service_type, c.city
       ORDER BY total_billed DESC NULLS LAST`
    );
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET /api/reports/service-analysis - Service type profitability
app.get('/api/reports/service-analysis', verifyToken, requireAdmin, async (req, res) => {
  try {
    const result = await db.query(
      `SELECT 
        sp.id,
        sp.service_name,
        sp.client_hourly_rate as charge_rate,
        sp.caregiver_hourly_rate as cost_rate,
        (sp.client_hourly_rate - sp.caregiver_hourly_rate) as margin_per_hour,
        ROUND((((sp.client_hourly_rate - sp.caregiver_hourly_rate) / sp.client_hourly_rate) * 100)::numeric, 2) as margin_percent,
        COUNT(DISTINCT cs.client_id) as clients_using,
        COUNT(DISTINCT s.id) as active_assignments,
        SUM(ili.hours) as total_hours_billed
       FROM service_pricing sp
       LEFT JOIN client_services cs ON sp.id = cs.service_pricing_id
       LEFT JOIN schedules s ON cs.client_id = s.client_id AND s.is_active = true
       LEFT JOIN invoices i ON cs.client_id = i.client_id
       LEFT JOIN invoice_line_items ili ON i.id = ili.invoice_id AND ili.caregiver_id IN (
         SELECT caregiver_id FROM schedules WHERE client_id = cs.client_id
       )
       WHERE sp.is_active = true
       GROUP BY sp.id, sp.service_name, sp.client_hourly_rate, sp.caregiver_hourly_rate
       ORDER BY margin_per_hour DESC`
    );
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET /api/reports/payroll-vs-billing - Cost vs Revenue comparison (with expenses)
app.get('/api/reports/payroll-vs-billing', verifyToken, requireAdmin, async (req, res) => {
  try {
    const result = await db.query(
      `SELECT 
        DATE_TRUNC('month', COALESCE(i.billing_period_end, p.pay_period_end, e.expense_date))::DATE as period,
        SUM(i.total) as total_billed,
        SUM(p.gross_pay) as total_payroll_cost,
        SUM(p.taxes) as payroll_taxes,
        COALESCE(SUM(e.amount), 0) as total_expenses,
        (SUM(i.total) - SUM(p.gross_pay)) as gross_profit,
        (SUM(i.total) - SUM(p.gross_pay) - COALESCE(SUM(e.amount), 0)) as net_profit,
        ROUND((((SUM(i.total) - SUM(p.gross_pay)) / NULLIF(SUM(i.total), 0)) * 100)::numeric, 2) as gross_margin_percent,
        ROUND((((SUM(i.total) - SUM(p.gross_pay) - COALESCE(SUM(e.amount), 0)) / NULLIF(SUM(i.total), 0)) * 100)::numeric, 2) as net_margin_percent,
        COUNT(DISTINCT i.id) as invoice_count,
        COUNT(DISTINCT p.id) as payroll_count,
        COUNT(DISTINCT e.id) as expense_count
       FROM invoices i
       FULL OUTER JOIN payroll p ON DATE_TRUNC('month', i.billing_period_end) = DATE_TRUNC('month', p.pay_period_end)
       FULL OUTER JOIN expenses e ON DATE_TRUNC('month', i.billing_period_end) = DATE_TRUNC('month', e.expense_date)
       GROUP BY period
       ORDER BY period DESC`
    );
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET /api/reports/dashboard - Overall business metrics (with expenses and net profit)
app.get('/api/reports/dashboard', verifyToken, requireAdmin, async (req, res) => {
  try {
    const summaryResult = await db.query(
      `SELECT 
        (SELECT COUNT(*) FROM clients WHERE is_active = true) as active_clients,
        (SELECT COUNT(*) FROM users WHERE role = 'caregiver') as total_caregivers,
        COALESCE((SELECT SUM(total) FROM invoices WHERE payment_status = 'paid'), 0) as total_revenue,
        COALESCE((SELECT SUM(net_pay) FROM payroll WHERE status = 'paid'), 0) as total_payroll_paid,
        COALESCE((SELECT SUM(total) FROM invoices WHERE payment_status = 'pending'), 0) as pending_revenue,
        COALESCE((SELECT SUM(amount) FROM expenses), 0) as total_expenses,
        (SELECT COUNT(*) FROM schedules WHERE is_active = true) as active_schedules,
        COALESCE((SELECT AVG(NULLIF((billing_period_end::date - billing_period_start::date), 0)) FROM invoices), 0) as avg_billing_period_days,
        COALESCE((SELECT SUM(total) FROM invoices WHERE payment_status = 'paid'), 0) - COALESCE((SELECT SUM(net_pay) FROM payroll WHERE status = 'paid'), 0) - COALESCE((SELECT SUM(amount) FROM expenses), 0) as net_profit,
        COALESCE((SELECT SUM(CAST(hours_worked AS DECIMAL)) FROM time_entries), 0) as total_hours,
        (SELECT COUNT(*) FROM schedules WHERE status = 'completed') as completed_shifts,
        COALESCE((SELECT AVG(CAST(rating AS DECIMAL)) FROM performance_reviews WHERE overall_assessment = 'excellent'), 0) as avg_satisfaction
      `
    );

    const monthlyTrendResult = await db.query(
      `SELECT 
        DATE_TRUNC('month', i.created_at)::DATE as month,
        COALESCE(SUM(i.total), 0) as revenue,
        COALESCE((SELECT SUM(amount) FROM expenses WHERE DATE_TRUNC('month', expense_date) = DATE_TRUNC('month', i.created_at)), 0) as expenses,
        COUNT(*) as invoice_count
       FROM invoices i
       GROUP BY DATE_TRUNC('month', i.created_at)
       ORDER BY month DESC
       LIMIT 6`
    );

    const topClientsResult = await db.query(
      `SELECT 
        c.id,
        c.first_name || ' ' || c.last_name as client_name,
        SUM(i.total) as total_revenue
       FROM invoices i
       JOIN clients c ON i.client_id = c.id
       GROUP BY c.id, c.first_name, c.last_name
       ORDER BY total_revenue DESC
       LIMIT 5`
    );

    const topCaregiversResult = await db.query(
      `SELECT 
        u.id,
        u.first_name || ' ' || u.last_name as caregiver_name,
        COALESCE(SUM(pli.gross_amount), 0) as total_earned,
        COALESCE(SUM(pli.total_hours), 0) as total_hours
       FROM payroll_line_items pli
       JOIN users u ON pli.caregiver_id = u.id
       GROUP BY u.id, u.first_name, u.last_name
       ORDER BY total_earned DESC
       LIMIT 5`
    );

    const expensesByCategory = await db.query(
      `SELECT 
        category,
        COUNT(*) as count,
        SUM(amount) as total
       FROM expenses
       GROUP BY category
       ORDER BY total DESC`
    );

    res.json({
      success: true,
      summary: summaryResult.rows[0],
      monthlyTrend: monthlyTrendResult.rows,
      topClients: topClientsResult.rows,
      topCaregivers: topCaregiversResult.rows,
      expensesByCategory: expensesByCategory.rows
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ---- ABSENCE MANAGEMENT ----

// POST /api/absences - Record new absence

// POST /api/absences - Report an absence
app.post('/api/absences', verifyToken, async (req, res) => {
  try {
    const { caregiverId, date, type, reason } = req.body;

    if (!caregiverId || !date || !type) {
      return res.status(400).json({ error: 'caregiverId, date, and type are required' });
    }

    const absenceId = uuidv4();

    const result = await db.query(
      `INSERT INTO absences (id, caregiver_id, date, type, reason, reported_by, coverage_needed, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
       RETURNING *`,
      [absenceId, caregiverId, date, type, reason || null, req.user.id, true]
    );

    await auditLog(req.user.id, 'CREATE', 'absences', absenceId, null, result.rows[0]);
    res.status(201).json(result.rows[0]);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET /api/absences - List all absences with filtering
app.get('/api/absences', verifyToken, requireAdmin, async (req, res) => {
  try {
    const { type, startDate, endDate } = req.query;

    let query = `
      SELECT a.*, u.first_name, u.last_name
      FROM absences a
      JOIN users u ON a.caregiver_id = u.id
      WHERE 1=1
    `;

    const params = [];
    let paramIndex = 1;

    if (type) {
      query += ` AND a.type = $${paramIndex}`;
      params.push(type);
      paramIndex++;
    }

    if (startDate) {
      query += ` AND a.date >= $${paramIndex}`;
      params.push(startDate);
      paramIndex++;
    }

    if (endDate) {
      query += ` AND a.date <= $${paramIndex}`;
      params.push(endDate);
      paramIndex++;
    }

    query += ` ORDER BY a.date DESC`;

    const result = await db.query(query, params);
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET /api/absences/caregiver/:caregiverId - Get caregiver absence history
app.get('/api/absences/caregiver/:caregiverId', verifyToken, async (req, res) => {
  try {
    const result = await db.query(
      `SELECT * FROM absences 
       WHERE caregiver_id = $1 
       ORDER BY date DESC`,
      [req.params.caregiverId]
    );
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// PATCH /api/absences/:id - Update absence
app.patch('/api/absences/:id', verifyToken, requireAdmin, async (req, res) => {
  try {
    const { date, type, reason, coverageAssignedTo } = req.body;

    const updates = [];
    const params = [];
    let paramIndex = 1;

    if (date) {
      updates.push(`date = $${paramIndex}`);
      params.push(date);
      paramIndex++;
    }
    if (type) {
      updates.push(`type = $${paramIndex}`);
      params.push(type);
      paramIndex++;
    }
    if (reason) {
      updates.push(`reason = $${paramIndex}`);
      params.push(reason);
      paramIndex++;
    }
    if (coverageAssignedTo) {
      updates.push(`coverage_assigned_to = $${paramIndex}`);
      params.push(coverageAssignedTo);
      paramIndex++;
    }

    if (updates.length === 0) {
      return res.status(400).json({ error: 'No fields to update' });
    }

    params.push(req.params.id);
    const query = `UPDATE absences SET ${updates.join(', ')} WHERE id = $${paramIndex} RETURNING *`;

    const result = await db.query(query, params);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Absence not found' });
    }

    await auditLog(req.user.id, 'UPDATE', 'absences', req.params.id, null, result.rows[0]);
    res.json(result.rows[0]);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// DELETE /api/absences/:id
app.delete('/api/absences/:id', verifyToken, requireAdmin, async (req, res) => {
  try {
    const result = await db.query('DELETE FROM absences WHERE id = $1 RETURNING *', [req.params.id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Absence not found' });
    }

    await auditLog(req.user.id, 'DELETE', 'absences', req.params.id, null, result.rows[0]);
    res.json({ message: 'Absence deleted' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET /api/absences/summary - Get absence summary
app.get('/api/absences/summary', verifyToken, requireAdmin, async (req, res) => {
  try {
    const result = await db.query(
      `SELECT type, COUNT(*) as count, DATE_TRUNC('month', date)::DATE as month
       FROM absences
       GROUP BY type, DATE_TRUNC('month', date)
       ORDER BY month DESC, type`
    );
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ---- CAREGIVER AVAILABILITY ----

// GET /api/caregivers/:caregiverId/availability - Get caregiver availability
app.get('/api/caregivers/:caregiverId/availability', verifyToken, async (req, res) => {
  try {
    let result = await db.query(
      `SELECT * FROM caregiver_availability WHERE caregiver_id = $1`,
      [req.params.caregiverId]
    );

    if (result.rows.length === 0) {
      // Create default availability (Mon-Fri, 8am-5pm)
      await db.query(
        `INSERT INTO caregiver_availability (caregiver_id, status, max_hours_per_week,
          monday_available, monday_start_time, monday_end_time,
          tuesday_available, tuesday_start_time, tuesday_end_time,
          wednesday_available, wednesday_start_time, wednesday_end_time,
          thursday_available, thursday_start_time, thursday_end_time,
          friday_available, friday_start_time, friday_end_time,
          saturday_available, sunday_available)
         VALUES ($1, $2, $3, true, '08:00', '17:00', true, '08:00', '17:00',
          true, '08:00', '17:00', true, '08:00', '17:00', true, '08:00', '17:00',
          false, false)`,
        [req.params.caregiverId, 'available', 40]
      );
      result = await db.query(
        `SELECT * FROM caregiver_availability WHERE caregiver_id = $1`,
        [req.params.caregiverId]
      );
    }

    res.json(result.rows[0]);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// PUT /api/caregivers/:caregiverId/availability - Update caregiver availability
app.put('/api/caregivers/:caregiverId/availability', verifyToken, async (req, res) => {
  try {
    const {
      status, maxHoursPerWeek,
      mondayAvailable, mondayStartTime, mondayEndTime,
      tuesdayAvailable, tuesdayStartTime, tuesdayEndTime,
      wednesdayAvailable, wednesdayStartTime, wednesdayEndTime,
      thursdayAvailable, thursdayStartTime, thursdayEndTime,
      fridayAvailable, fridayStartTime, fridayEndTime,
      saturdayAvailable, saturdayStartTime, saturdayEndTime,
      sundayAvailable, sundayStartTime, sundayEndTime
    } = req.body;

    const result = await db.query(
      `UPDATE caregiver_availability SET
        status = COALESCE($1, status),
        max_hours_per_week = COALESCE($2, max_hours_per_week),
        monday_available = COALESCE($3, monday_available),
        monday_start_time = COALESCE($4, monday_start_time),
        monday_end_time = COALESCE($5, monday_end_time),
        tuesday_available = COALESCE($6, tuesday_available),
        tuesday_start_time = COALESCE($7, tuesday_start_time),
        tuesday_end_time = COALESCE($8, tuesday_end_time),
        wednesday_available = COALESCE($9, wednesday_available),
        wednesday_start_time = COALESCE($10, wednesday_start_time),
        wednesday_end_time = COALESCE($11, wednesday_end_time),
        thursday_available = COALESCE($12, thursday_available),
        thursday_start_time = COALESCE($13, thursday_start_time),
        thursday_end_time = COALESCE($14, thursday_end_time),
        friday_available = COALESCE($15, friday_available),
        friday_start_time = COALESCE($16, friday_start_time),
        friday_end_time = COALESCE($17, friday_end_time),
        saturday_available = COALESCE($18, saturday_available),
        saturday_start_time = COALESCE($19, saturday_start_time),
        saturday_end_time = COALESCE($20, saturday_end_time),
        sunday_available = COALESCE($21, sunday_available),
        sunday_start_time = COALESCE($22, sunday_start_time),
        sunday_end_time = COALESCE($23, sunday_end_time),
        updated_at = NOW()
       WHERE caregiver_id = $24
       RETURNING *`,
      [status, maxHoursPerWeek,
       mondayAvailable, mondayStartTime, mondayEndTime,
       tuesdayAvailable, tuesdayStartTime, tuesdayEndTime,
       wednesdayAvailable, wednesdayStartTime, wednesdayEndTime,
       thursdayAvailable, thursdayStartTime, thursdayEndTime,
       fridayAvailable, fridayStartTime, fridayEndTime,
       saturdayAvailable, saturdayStartTime, saturdayEndTime,
       sundayAvailable, sundayStartTime, sundayEndTime,
       req.params.caregiverId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Caregiver availability not found' });
    }

    await auditLog(req.user.id, 'UPDATE', 'caregiver_availability', req.params.caregiverId, null, result.rows[0]);
    res.json(result.rows[0]);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET /api/caregivers/:caregiverId/blackout-dates - Get blackout dates
app.get('/api/caregivers/:caregiverId/blackout-dates', verifyToken, async (req, res) => {
  try {
    const result = await db.query(
      `SELECT * FROM caregiver_blackout_dates 
       WHERE caregiver_id = $1 
       ORDER BY start_date DESC`,
      [req.params.caregiverId]
    );
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/caregivers/:caregiverId/blackout-dates - Add blackout date
app.post('/api/caregivers/:caregiverId/blackout-dates', verifyToken, async (req, res) => {
  try {
    const { startDate, endDate, reason } = req.body;

    if (!startDate || !endDate) {
      return res.status(400).json({ error: 'startDate and endDate are required' });
    }

    const blackoutId = uuidv4();
    const result = await db.query(
      `INSERT INTO caregiver_blackout_dates (id, caregiver_id, start_date, end_date, reason)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [blackoutId, req.params.caregiverId, startDate, endDate, reason || null]
    );

    await auditLog(req.user.id, 'CREATE', 'caregiver_blackout_dates', blackoutId, null, result.rows[0]);
    res.status(201).json(result.rows[0]);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// DELETE /api/blackout-dates/:dateId - Delete blackout date
app.delete('/api/blackout-dates/:dateId', verifyToken, async (req, res) => {
  try {
    const result = await db.query(
      `DELETE FROM caregiver_blackout_dates WHERE id = $1 RETURNING *`,
      [req.params.dateId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Blackout date not found' });
    }

    await auditLog(req.user.id, 'DELETE', 'caregiver_blackout_dates', req.params.dateId, null, result.rows[0]);
    res.json({ message: 'Blackout date deleted' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET /api/caregivers/available - Find available caregivers for a shift
app.get('/api/caregivers/available', verifyToken, async (req, res) => {
  try {
    const { date, dayOfWeek, startTime, endTime } = req.query;

    if (!dayOfWeek || !startTime || !endTime) {
      return res.status(400).json({ error: 'dayOfWeek, startTime, and endTime are required' });
    }

    const dayMap = {
      0: 'sunday', 1: 'monday', 2: 'tuesday', 3: 'wednesday',
      4: 'thursday', 5: 'friday', 6: 'saturday'
    };
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
      query += ` AND NOT EXISTS (
        SELECT 1 FROM caregiver_blackout_dates
        WHERE caregiver_id = u.id
        AND start_date <= $3
        AND end_date >= $3
      )`;
      params.push(date);
    }

    query += ` ORDER BY u.first_name, u.last_name`;

    const result = await db.query(query, params);
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ---- EXPENSES ----

// POST /api/expenses - Record new expense
app.post('/api/expenses', verifyToken, requireAdmin, async (req, res) => {
  try {
    const { expenseDate, category, description, amount, paymentMethod, notes, receiptUrl } = req.body;

    if (!expenseDate || !category || !amount) {
      return res.status(400).json({ error: 'expenseDate, category, and amount are required' });
    }

    const expenseId = uuidv4();
    const result = await db.query(
      `INSERT INTO expenses (id, expense_date, category, description, amount, payment_method, notes, receipt_url, submitted_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING *`,
      [expenseId, expenseDate, category, description || null, amount, paymentMethod || null, notes || null, receiptUrl || null, req.user.id]
    );

    await auditLog(req.user.id, 'CREATE', 'expenses', expenseId, null, result.rows[0]);
    res.status(201).json(result.rows[0]);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET /api/expenses - List expenses with filtering
app.get('/api/expenses', verifyToken, requireAdmin, async (req, res) => {
  try {
    const { category, startDate, endDate, paymentMethod } = req.query;

    let query = `SELECT * FROM expenses WHERE 1=1`;
    const params = [];
    let paramIndex = 1;

    if (category) {
      query += ` AND category = $${paramIndex}`;
      params.push(category);
      paramIndex++;
    }

    if (startDate) {
      query += ` AND expense_date >= $${paramIndex}`;
      params.push(startDate);
      paramIndex++;
    }

    if (endDate) {
      query += ` AND expense_date <= $${paramIndex}`;
      params.push(endDate);
      paramIndex++;
    }

    if (paymentMethod) {
      query += ` AND payment_method = $${paramIndex}`;
      params.push(paymentMethod);
      paramIndex++;
    }

    query += ` ORDER BY expense_date DESC`;

    const result = await db.query(query, params);
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET /api/expenses/:id - Get expense details
app.get('/api/expenses/:id', verifyToken, requireAdmin, async (req, res) => {
  try {
    const result = await db.query(
      `SELECT * FROM expenses WHERE id = $1`,
      [req.params.id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Expense not found' });
    }

    res.json(result.rows[0]);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// PUT /api/expenses/:id - Update expense
app.put('/api/expenses/:id', verifyToken, requireAdmin, async (req, res) => {
  try {
    const { expenseDate, category, description, amount, paymentMethod, notes, receiptUrl } = req.body;

    const result = await db.query(
      `UPDATE expenses SET
        expense_date = COALESCE($1, expense_date),
        category = COALESCE($2, category),
        description = COALESCE($3, description),
        amount = COALESCE($4, amount),
        payment_method = COALESCE($5, payment_method),
        notes = COALESCE($6, notes),
        receipt_url = COALESCE($7, receipt_url),
        updated_at = NOW()
       WHERE id = $8
       RETURNING *`,
      [expenseDate, category, description, amount, paymentMethod, notes, receiptUrl, req.params.id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Expense not found' });
    }

    await auditLog(req.user.id, 'UPDATE', 'expenses', req.params.id, null, result.rows[0]);
    res.json(result.rows[0]);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// DELETE /api/expenses/:id - Delete expense
app.delete('/api/expenses/:id', verifyToken, requireAdmin, async (req, res) => {
  try {
    const result = await db.query(
      `DELETE FROM expenses WHERE id = $1 RETURNING *`,
      [req.params.id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Expense not found' });
    }

    await auditLog(req.user.id, 'DELETE', 'expenses', req.params.id, null, result.rows[0]);
    res.json({ message: 'Expense deleted' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET /api/expenses/summary - Expense statistics by category
app.get('/api/expenses/summary', verifyToken, requireAdmin, async (req, res) => {
  try {
    const totalResult = await db.query(
      `SELECT 
        SUM(amount) as total_expenses,
        COUNT(*) as expense_count,
        AVG(amount) as average_expense
       FROM expenses`
    );

    const categoryResult = await db.query(
      `SELECT 
        category,
        COUNT(*) as count,
        SUM(amount) as total,
        AVG(amount) as average
       FROM expenses
       GROUP BY category
       ORDER BY total DESC`
    );

    const monthlyResult = await db.query(
      `SELECT 
        DATE_TRUNC('month', expense_date)::DATE as month,
        SUM(amount) as total
       FROM expenses
       GROUP BY DATE_TRUNC('month', expense_date)
       ORDER BY month DESC
       LIMIT 12`
    );

    res.json({
      total: totalResult.rows[0],
      byCategory: categoryResult.rows,
      byMonth: monthlyResult.rows
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});


// ---- CARE PLANS ----

// GET /api/care-plans - Get all care plans
app.get('/api/care-plans', verifyToken, async (req, res) => {
  try {
    const result = await db.query(
      `SELECT cp.*, c.first_name || ' ' || c.last_name as client_name
       FROM care_plans cp
       JOIN clients c ON cp.client_id = c.id
       ORDER BY cp.created_at DESC`
    );
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET /api/care-plans/:clientId - Get care plans for specific client
app.get('/api/care-plans/:clientId', verifyToken, async (req, res) => {
  try {
    const result = await db.query(
      `SELECT * FROM care_plans 
       WHERE client_id = $1 
       ORDER BY start_date DESC`,
      [req.params.clientId]
    );
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/care-plans - Create new care plan
app.post('/api/care-plans', verifyToken, requireAdmin, async (req, res) => {
  try {
    const {
      clientId, serviceType, serviceDescription, frequency, careGoals,
      specialInstructions, precautions, medicationNotes, mobilityNotes,
      dietaryNotes, communicationNotes, startDate, endDate
    } = req.body;

    if (!clientId || !serviceType) {
      return res.status(400).json({ error: 'clientId and serviceType are required' });
    }

    const planId = uuidv4();
    const result = await db.query(
      `INSERT INTO care_plans (
        id, client_id, service_type, service_description, frequency,
        care_goals, special_instructions, precautions, medication_notes,
        mobility_notes, dietary_notes, communication_notes, start_date, end_date, created_by
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
       RETURNING *`,
      [
        planId, clientId, serviceType, serviceDescription || null, frequency || null,
        careGoals || null, specialInstructions || null, precautions || null,
        medicationNotes || null, mobilityNotes || null, dietaryNotes || null,
        communicationNotes || null, startDate || null, endDate || null, req.user.id
      ]
    );

    await auditLog(req.user.id, 'CREATE', 'care_plans', planId, null, result.rows[0]);
    res.status(201).json(result.rows[0]);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// PUT /api/care-plans/:id - Update care plan
app.put('/api/care-plans/:id', verifyToken, requireAdmin, async (req, res) => {
  try {
    const {
      serviceType, serviceDescription, frequency, careGoals,
      specialInstructions, precautions, medicationNotes, mobilityNotes,
      dietaryNotes, communicationNotes, startDate, endDate
    } = req.body;

    const result = await db.query(
      `UPDATE care_plans SET
        service_type = COALESCE($1, service_type),
        service_description = COALESCE($2, service_description),
        frequency = COALESCE($3, frequency),
        care_goals = COALESCE($4, care_goals),
        special_instructions = COALESCE($5, special_instructions),
        precautions = COALESCE($6, precautions),
        medication_notes = COALESCE($7, medication_notes),
        mobility_notes = COALESCE($8, mobility_notes),
        dietary_notes = COALESCE($9, dietary_notes),
        communication_notes = COALESCE($10, communication_notes),
        start_date = COALESCE($11, start_date),
        end_date = COALESCE($12, end_date),
        updated_at = NOW()
       WHERE id = $13
       RETURNING *`,
      [
        serviceType, serviceDescription, frequency, careGoals,
        specialInstructions, precautions, medicationNotes, mobilityNotes,
        dietaryNotes, communicationNotes, startDate, endDate, req.params.id
      ]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Care plan not found' });
    }

    await auditLog(req.user.id, 'UPDATE', 'care_plans', req.params.id, null, result.rows[0]);
    res.json(result.rows[0]);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// DELETE /api/care-plans/:id - Delete care plan
app.delete('/api/care-plans/:id', verifyToken, requireAdmin, async (req, res) => {
  try {
    const result = await db.query(
      `DELETE FROM care_plans WHERE id = $1 RETURNING *`,
      [req.params.id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Care plan not found' });
    }

    await auditLog(req.user.id, 'DELETE', 'care_plans', req.params.id, null, result.rows[0]);
    res.json({ message: 'Care plan deleted' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET /api/care-plans/summary - Care plan statistics
app.get('/api/care-plans/summary', verifyToken, requireAdmin, async (req, res) => {
  try {
    const totalResult = await db.query(
      `SELECT COUNT(*) as total_plans FROM care_plans`
    );

    const activeResult = await db.query(
      `SELECT COUNT(*) as active_plans FROM care_plans 
       WHERE (start_date IS NULL OR start_date <= CURRENT_DATE)
       AND (end_date IS NULL OR end_date >= CURRENT_DATE)`
    );

    const byServiceType = await db.query(
      `SELECT service_type, COUNT(*) as count
       FROM care_plans
       GROUP BY service_type
       ORDER BY count DESC`
    );

    const byClient = await db.query(
      `SELECT c.id, c.first_name || ' ' || c.last_name as client_name, COUNT(cp.id) as plan_count
       FROM clients c
       LEFT JOIN care_plans cp ON c.id = cp.client_id
       GROUP BY c.id, c.first_name, c.last_name
       HAVING COUNT(cp.id) > 0
       ORDER BY plan_count DESC`
    );

    res.json({
      total: totalResult.rows[0].total_plans,
      active: activeResult.rows[0].active_plans,
      byServiceType: byServiceType.rows,
      byClient: byClient.rows
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ---- INCIDENT REPORTING ----

// GET /api/incidents - Get all incidents
app.get('/api/incidents', verifyToken, async (req, res) => {
  try {
    const result = await db.query(
      `SELECT ir.*, c.first_name || ' ' || c.last_name as client_name, 
              u.first_name || ' ' || u.last_name as caregiver_name
       FROM incident_reports ir
       LEFT JOIN clients c ON ir.client_id = c.id
       LEFT JOIN users u ON ir.caregiver_id = u.id
       ORDER BY ir.incident_date DESC, ir.incident_time DESC`
    );
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET /api/incidents/:id - Get specific incident
app.get('/api/incidents/:id', verifyToken, async (req, res) => {
  try {
    const result = await db.query(
      `SELECT ir.*, c.first_name || ' ' || c.last_name as client_name,
              u.first_name || ' ' || u.last_name as caregiver_name
       FROM incident_reports ir
       LEFT JOIN clients c ON ir.client_id = c.id
       LEFT JOIN users u ON ir.caregiver_id = u.id
       WHERE ir.id = $1`,
      [req.params.id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Incident not found' });
    }

    res.json(result.rows[0]);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/incidents - Report new incident
app.post('/api/incidents', verifyToken, async (req, res) => {
  try {
    const {
      clientId, caregiverId, incidentType, severity, incidentDate, incidentTime,
      description, witnesses, injuriesOrDamage, actionsTaken, followUpRequired,
      followUpNotes, reportedBy, reportedDate
    } = req.body;

    if (!clientId || !incidentType || !description) {
      return res.status(400).json({ error: 'Client, incident type, and description are required' });
    }

    const incidentId = uuidv4();
    const result = await db.query(
      `INSERT INTO incident_reports (
        id, client_id, caregiver_id, incident_type, severity, incident_date, incident_time,
        description, witnesses, injuries_or_damage, actions_taken, follow_up_required,
        follow_up_notes, reported_by, reported_date, reported_by_user_id
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
       RETURNING *`,
      [
        incidentId, clientId, caregiverId || null, incidentType, severity || 'moderate',
        incidentDate, incidentTime || null, description, witnesses || null,
        injuriesOrDamage || null, actionsTaken || null, followUpRequired || false,
        followUpNotes || null, reportedBy || null, reportedDate || null, req.user.id
      ]
    );

    await auditLog(req.user.id, 'CREATE', 'incident_reports', incidentId, null, result.rows[0]);
    res.status(201).json(result.rows[0]);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// PATCH /api/incidents/:id - Update incident
app.patch('/api/incidents/:id', verifyToken, async (req, res) => {
  try {
    const {
      severity, injuriesOrDamage, actionsTaken, followUpRequired, followUpNotes
    } = req.body;

    const result = await db.query(
      `UPDATE incident_reports SET
        severity = COALESCE($1, severity),
        injuries_or_damage = COALESCE($2, injuries_or_damage),
        actions_taken = COALESCE($3, actions_taken),
        follow_up_required = COALESCE($4, follow_up_required),
        follow_up_notes = COALESCE($5, follow_up_notes),
        updated_at = NOW()
       WHERE id = $6
       RETURNING *`,
      [severity, injuriesOrDamage, actionsTaken, followUpRequired, followUpNotes, req.params.id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Incident not found' });
    }

    await auditLog(req.user.id, 'UPDATE', 'incident_reports', req.params.id, null, result.rows[0]);
    res.json(result.rows[0]);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// DELETE /api/incidents/:id - Delete incident report
app.delete('/api/incidents/:id', verifyToken, requireAdmin, async (req, res) => {
  try {
    const result = await db.query(
      `DELETE FROM incident_reports WHERE id = $1 RETURNING *`,
      [req.params.id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Incident not found' });
    }

    await auditLog(req.user.id, 'DELETE', 'incident_reports', req.params.id, null, result.rows[0]);
    res.json({ message: 'Incident report deleted' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET /api/incidents/summary - Incident statistics
app.get('/api/incidents/summary', verifyToken, requireAdmin, async (req, res) => {
  try {
    const totalResult = await db.query(
      `SELECT COUNT(*) as total FROM incident_reports`
    );

    const bySeverityResult = await db.query(
      `SELECT severity, COUNT(*) as count FROM incident_reports GROUP BY severity ORDER BY 
       CASE severity WHEN 'critical' THEN 1 WHEN 'severe' THEN 2 WHEN 'moderate' THEN 3 WHEN 'minor' THEN 4 END`
    );

    const byTypeResult = await db.query(
      `SELECT incident_type, COUNT(*) as count FROM incident_reports GROUP BY incident_type ORDER BY count DESC`
    );

    const followUpResult = await db.query(
      `SELECT COUNT(*) as pending_followup FROM incident_reports WHERE follow_up_required = true`
    );

    const monthlyResult = await db.query(
      `SELECT 
        DATE_TRUNC('month', incident_date)::DATE as month,
        COUNT(*) as count,
        COUNT(CASE WHEN severity IN ('critical', 'severe') THEN 1 END) as serious_count
       FROM incident_reports
       GROUP BY DATE_TRUNC('month', incident_date)
       ORDER BY month DESC
       LIMIT 12`
    );

    const byClientResult = await db.query(
      `SELECT c.id, c.first_name || ' ' || c.last_name as client_name, COUNT(ir.id) as incident_count
       FROM clients c
       LEFT JOIN incident_reports ir ON c.id = ir.client_id
       WHERE ir.id IS NOT NULL
       GROUP BY c.id, c.first_name, c.last_name
       ORDER BY incident_count DESC
       LIMIT 10`
    );

    res.json({
      total: totalResult.rows[0].total,
      bySeverity: bySeverityResult.rows,
      byType: byTypeResult.rows,
      pendingFollowUp: followUpResult.rows[0].pending_followup,
      monthlyTrend: monthlyResult.rows,
      topClients: byClientResult.rows
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ---- PERFORMANCE REVIEWS ----

// GET /api/performance-reviews - Get all performance reviews
app.get('/api/performance-reviews', verifyToken, async (req, res) => {
  try {
    const result = await db.query(
      `SELECT pr.*, c.first_name || ' ' || c.last_name as caregiver_name,
              cl.first_name || ' ' || cl.last_name as client_name
       FROM performance_reviews pr
       LEFT JOIN users c ON pr.caregiver_id = c.id
       LEFT JOIN clients cl ON pr.client_id = cl.id
       ORDER BY pr.review_date DESC`
    );
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET /api/performance-reviews/:caregiverId - Get reviews for specific caregiver
app.get('/api/performance-reviews/:caregiverId', verifyToken, async (req, res) => {
  try {
    const result = await db.query(
      `SELECT pr.*, cl.first_name || ' ' || cl.last_name as client_name
       FROM performance_reviews pr
       LEFT JOIN clients cl ON pr.client_id = cl.id
       WHERE pr.caregiver_id = $1
       ORDER BY pr.review_date DESC`,
      [req.params.caregiverId]
    );
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/performance-reviews - Create performance review
app.post('/api/performance-reviews', verifyToken, requireAdmin, async (req, res) => {
  try {
    const { caregiverId, clientId, reviewDate, performanceNotes, strengths, areasForImprovement, overallAssessment } = req.body;

    if (!caregiverId || !clientId || !performanceNotes) {
      return res.status(400).json({ error: 'Caregiver, client, and performance notes are required' });
    }

    const reviewId = uuidv4();
    const result = await db.query(
      `INSERT INTO performance_reviews (id, caregiver_id, client_id, review_date, performance_notes, strengths, areas_for_improvement, overall_assessment, reviewed_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING *`,
      [reviewId, caregiverId, clientId, reviewDate, performanceNotes, strengths || null, areasForImprovement || null, overallAssessment || 'satisfactory', req.user.id]
    );

    await auditLog(req.user.id, 'CREATE', 'performance_reviews', reviewId, null, result.rows[0]);
    res.status(201).json(result.rows[0]);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// DELETE /api/performance-reviews/:id - Delete performance review
app.delete('/api/performance-reviews/:id', verifyToken, requireAdmin, async (req, res) => {
  try {
    const result = await db.query(
      `DELETE FROM performance_reviews WHERE id = $1 RETURNING *`,
      [req.params.id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Review not found' });
    }

    await auditLog(req.user.id, 'DELETE', 'performance_reviews', req.params.id, null, result.rows[0]);
    res.json({ message: 'Review deleted' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET /api/performance-reviews/summary/:caregiverId - Performance summary for caregiver
app.get('/api/performance-reviews/summary/:caregiverId', verifyToken, async (req, res) => {
  try {
    const result = await db.query(
      `SELECT 
        COUNT(*) as total_reviews,
        AVG(CASE WHEN overall_assessment = 'excellent' THEN 3 WHEN overall_assessment = 'satisfactory' THEN 2 WHEN overall_assessment = 'needs_improvement' THEN 1 ELSE 0 END) as avg_score,
        COUNT(CASE WHEN overall_assessment = 'excellent' THEN 1 END) as excellent_count,
        COUNT(CASE WHEN overall_assessment = 'satisfactory' THEN 1 END) as satisfactory_count,
        COUNT(CASE WHEN overall_assessment = 'needs_improvement' THEN 1 END) as needs_improvement_count,
        MAX(review_date) as last_review_date
       FROM performance_reviews
       WHERE caregiver_id = $1`,
      [req.params.caregiverId]
    );
    res.json(result.rows[0]);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ---- COMPLIANCE TRACKING ----

// GET /api/caregivers/:caregiverId/background-check - Get background check
app.get('/api/caregivers/:caregiverId/background-check', verifyToken, async (req, res) => {
  try {
    const result = await db.query(
      `SELECT * FROM background_checks WHERE caregiver_id = $1 ORDER BY check_date DESC LIMIT 1`,
      [req.params.caregiverId]
    );
    res.json(result.rows.length > 0 ? result.rows[0] : null);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/caregivers/:caregiverId/background-check - Save background check
app.post('/api/caregivers/:caregiverId/background-check', verifyToken, requireAdmin, async (req, res) => {
  try {
    const { checkDate, expirationDate, status, clearanceNumber, notes } = req.body;

    if (!checkDate || !status) {
      return res.status(400).json({ error: 'Check date and status are required' });
    }

    const checkId = uuidv4();
    const result = await db.query(
      `INSERT INTO background_checks (id, caregiver_id, check_date, expiration_date, status, clearance_number, notes, checked_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING *`,
      [checkId, req.params.caregiverId, checkDate, expirationDate || null, status, clearanceNumber || null, notes || null, req.user.id]
    );

    await auditLog(req.user.id, 'CREATE', 'background_checks', checkId, null, result.rows[0]);
    res.status(201).json(result.rows[0]);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET /api/caregivers/:caregiverId/training-records - Get training records
app.get('/api/caregivers/:caregiverId/training-records', verifyToken, async (req, res) => {
  try {
    const result = await db.query(
      `SELECT * FROM training_records WHERE caregiver_id = $1 ORDER BY completion_date DESC`,
      [req.params.caregiverId]
    );
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/caregivers/:caregiverId/training-records - Add training record
app.post('/api/caregivers/:caregiverId/training-records', verifyToken, requireAdmin, async (req, res) => {
  try {
    const { trainingType, completionDate, expirationDate, certificationNumber, provider, status } = req.body;

    if (!trainingType || !completionDate) {
      return res.status(400).json({ error: 'Training type and completion date are required' });
    }

    const recordId = uuidv4();
    const result = await db.query(
      `INSERT INTO training_records (id, caregiver_id, training_type, completion_date, expiration_date, certification_number, provider, status, recorded_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING *`,
      [recordId, req.params.caregiverId, trainingType, completionDate, expirationDate || null, certificationNumber || null, provider || null, status || 'completed', req.user.id]
    );

    await auditLog(req.user.id, 'CREATE', 'training_records', recordId, null, result.rows[0]);
    res.status(201).json(result.rows[0]);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// DELETE /api/training-records/:id - Delete training record
app.delete('/api/training-records/:id', verifyToken, requireAdmin, async (req, res) => {
  try {
    const result = await db.query(
      `DELETE FROM training_records WHERE id = $1 RETURNING *`,
      [req.params.id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Training record not found' });
    }

    await auditLog(req.user.id, 'DELETE', 'training_records', req.params.id, null, result.rows[0]);
    res.json({ message: 'Training record deleted' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET /api/caregivers/:caregiverId/compliance-documents - Get compliance documents
app.get('/api/caregivers/:caregiverId/compliance-documents', verifyToken, async (req, res) => {
  try {
    const result = await db.query(
      `SELECT * FROM compliance_documents WHERE caregiver_id = $1 ORDER BY upload_date DESC`,
      [req.params.caregiverId]
    );
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/caregivers/:caregiverId/compliance-documents - Upload compliance document
app.post('/api/caregivers/:caregiverId/compliance-documents', verifyToken, requireAdmin, async (req, res) => {
  try {
    const { documentType, documentName, expirationDate, fileUrl, notes } = req.body;

    if (!documentType || !documentName) {
      return res.status(400).json({ error: 'Document type and name are required' });
    }

    const docId = uuidv4();
    const result = await db.query(
      `INSERT INTO compliance_documents (id, caregiver_id, document_type, document_name, expiration_date, file_url, notes, uploaded_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING *`,
      [docId, req.params.caregiverId, documentType, documentName, expirationDate || null, fileUrl || null, notes || null, req.user.id]
    );

    await auditLog(req.user.id, 'CREATE', 'compliance_documents', docId, null, result.rows[0]);
    res.status(201).json(result.rows[0]);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// DELETE /api/compliance-documents/:id - Delete compliance document
app.delete('/api/compliance-documents/:id', verifyToken, requireAdmin, async (req, res) => {
  try {
    const result = await db.query(
      `DELETE FROM compliance_documents WHERE id = $1 RETURNING *`,
      [req.params.id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Document not found' });
    }

    await auditLog(req.user.id, 'DELETE', 'compliance_documents', req.params.id, null, result.rows[0]);
    res.json({ message: 'Document deleted' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET /api/compliance/summary - Compliance overview
app.get('/api/compliance/summary', verifyToken, requireAdmin, async (req, res) => {
  try {
    const expiredBgResult = await db.query(
      `SELECT COUNT(*) as expired_bg FROM background_checks WHERE expiration_date < CURRENT_DATE`
    );

    const expiredTrainingResult = await db.query(
      `SELECT COUNT(*) as expired_training FROM training_records WHERE expiration_date < CURRENT_DATE AND status != 'expired'`
    );

    const trainingByTypeResult = await db.query(
      `SELECT training_type, COUNT(*) as count FROM training_records WHERE status = 'completed' GROUP BY training_type ORDER BY count DESC`
    );

    const bgStatusResult = await db.query(
      `SELECT status, COUNT(*) as count FROM background_checks GROUP BY status`
    );

    res.json({
      expiredBackgroundChecks: expiredBgResult.rows[0].expired_bg,
      expiredTraining: expiredTrainingResult.rows[0].expired_training,
      trainingByType: trainingByTypeResult.rows,
      backgroundCheckStatus: bgStatusResult.rows
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ---- REFERRAL SOURCES ----

// GET /api/referral-sources - Get all referral sources
app.get('/api/referral-sources', verifyToken, async (req, res) => {
  try {
    const result = await db.query(
      `SELECT * FROM referral_sources ORDER BY name ASC`
    );
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/referral-sources - Create referral source
app.post('/api/referral-sources', verifyToken, requireAdmin, async (req, res) => {
  try {
    const { name, type, contactName, email, phone, address, city, state, zip } = req.body;

    if (!name || !type) {
      return res.status(400).json({ error: 'Name and type are required' });
    }

    const sourceId = uuidv4();
    const result = await db.query(
      `INSERT INTO referral_sources (id, name, type, contact_name, email, phone, address, city, state, zip, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
       RETURNING *`,
      [sourceId, name, type, contactName || null, email || null, phone || null, address || null, city || null, state || 'WI', zip || null, req.user.id]
    );

    await auditLog(req.user.id, 'CREATE', 'referral_sources', sourceId, null, result.rows[0]);
    res.status(201).json(result.rows[0]);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// PUT /api/referral-sources/:id - Update referral source
app.put('/api/referral-sources/:id', verifyToken, requireAdmin, async (req, res) => {
  try {
    const { name, type, contactName, email, phone, address, city, state, zip } = req.body;

    const result = await db.query(
      `UPDATE referral_sources SET
        name = COALESCE($1, name),
        type = COALESCE($2, type),
        contact_name = COALESCE($3, contact_name),
        email = COALESCE($4, email),
        phone = COALESCE($5, phone),
        address = COALESCE($6, address),
        city = COALESCE($7, city),
        state = COALESCE($8, state),
        zip = COALESCE($9, zip),
        updated_at = NOW()
       WHERE id = $10
       RETURNING *`,
      [name, type, contactName, email, phone, address, city, state, zip, req.params.id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Referral source not found' });
    }

    await auditLog(req.user.id, 'UPDATE', 'referral_sources', req.params.id, null, result.rows[0]);
    res.json(result.rows[0]);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// DELETE /api/referral-sources/:id - Delete referral source
app.delete('/api/referral-sources/:id', verifyToken, requireAdmin, async (req, res) => {
  try {
    const result = await db.query(
      `DELETE FROM referral_sources WHERE id = $1 RETURNING *`,
      [req.params.id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Referral source not found' });
    }

    await auditLog(req.user.id, 'DELETE', 'referral_sources', req.params.id, null, result.rows[0]);
    res.json({ message: 'Referral source deleted' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET /api/referral-sources/stats - Referral statistics
app.get('/api/referral-sources/stats', verifyToken, requireAdmin, async (req, res) => {
  try {
    const totalResult = await db.query(
      `SELECT COUNT(*) as total FROM referral_sources`
    );

    const byTypeResult = await db.query(
      `SELECT type, COUNT(*) as count FROM referral_sources GROUP BY type ORDER BY count DESC`
    );

    const clientsBySourceResult = await db.query(
      `SELECT rs.id, rs.name, COUNT(c.id) as client_count
       FROM referral_sources rs
       LEFT JOIN clients c ON rs.id = c.referral_source_id
       WHERE c.id IS NOT NULL
       GROUP BY rs.id, rs.name
       ORDER BY client_count DESC`
    );

    res.json({
      total: totalResult.rows[0].total,
      byType: byTypeResult.rows,
      topSources: clientsBySourceResult.rows
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ---- NOTIFICATIONS ----

// GET /api/notifications - Get notifications for user
app.get('/api/notifications', verifyToken, async (req, res) => {
  try {
    const result = await db.query(
      `SELECT * FROM notifications 
       WHERE recipient_id = $1 OR (recipient_type = 'admin' AND $2 = 'admin')
       ORDER BY created_at DESC
       LIMIT 50`,
      [req.user.id, req.user.role]
    );
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET /api/notification-settings - Get notification settings
app.get('/api/notification-settings', verifyToken, async (req, res) => {
  try {
    let result = await db.query(
      `SELECT * FROM notification_settings WHERE user_id = $1`,
      [req.user.id]
    );

    if (result.rows.length === 0) {
      // Create default settings
      await db.query(
        `INSERT INTO notification_settings (user_id, email_enabled, schedule_alerts, payroll_alerts, absence_alerts, payment_alerts)
         VALUES ($1, true, true, true, true, true)`,
        [req.user.id]
      );
      result = await db.query(
        `SELECT * FROM notification_settings WHERE user_id = $1`,
        [req.user.id]
      );
    }

    res.json(result.rows[0]);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// PUT /api/notification-settings - Update notification settings
app.put('/api/notification-settings', verifyToken, async (req, res) => {
  try {
    const { emailEnabled, scheduleAlerts, payrollAlerts, absenceAlerts, paymentAlerts } = req.body;

    const result = await db.query(
      `UPDATE notification_settings SET
        email_enabled = COALESCE($1, email_enabled),
        schedule_alerts = COALESCE($2, schedule_alerts),
        payroll_alerts = COALESCE($3, payroll_alerts),
        absence_alerts = COALESCE($4, absence_alerts),
        payment_alerts = COALESCE($5, payment_alerts),
        updated_at = NOW()
       WHERE user_id = $6
       RETURNING *`,
      [emailEnabled, scheduleAlerts, payrollAlerts, absenceAlerts, paymentAlerts, req.user.id]
    );

    res.json(result.rows[0]);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/notifications/send - Send manual notification
app.post('/api/notifications/send', verifyToken, requireAdmin, async (req, res) => {
  try {
    const { recipientType, recipientId, notificationType, subject, message } = req.body;

    if (!recipientId || !subject || !message) {
      return res.status(400).json({ error: 'recipientId, subject, and message are required' });
    }

    const notificationId = uuidv4();
    const result = await db.query(
      `INSERT INTO notifications (id, recipient_type, recipient_id, notification_type, subject, message, status, sent_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING *`,
      [notificationId, recipientType, recipientId, notificationType || 'general', subject, message, 'sent', req.user.id]
    );

    // Send email if enabled (would integrate with email service)
    // For now, just log in database
    await auditLog(req.user.id, 'CREATE', 'notifications', notificationId, null, result.rows[0]);
    res.status(201).json(result.rows[0]);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/notifications/send-bulk - Send to multiple recipients
app.post('/api/notifications/send-bulk', verifyToken, requireAdmin, async (req, res) => {
  try {
    const { recipientIds, notificationType, subject, message } = req.body;

    if (!recipientIds || recipientIds.length === 0 || !subject || !message) {
      return res.status(400).json({ error: 'recipientIds, subject, and message are required' });
    }

    const sentNotifications = [];

    for (const recipientId of recipientIds) {
      const notificationId = uuidv4();
      const result = await db.query(
        `INSERT INTO notifications (id, recipient_type, recipient_id, notification_type, subject, message, status, sent_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         RETURNING *`,
        [notificationId, 'caregiver', recipientId, notificationType || 'general', subject, message, 'sent', req.user.id]
      );
      sentNotifications.push(result.rows[0]);
    }

    await auditLog(req.user.id, 'CREATE', 'notifications', 'bulk', null, { count: sentNotifications.length });
    res.status(201).json({ sent: sentNotifications.length, notifications: sentNotifications });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// PATCH /api/notifications/:id/read - Mark notification as read
app.patch('/api/notifications/:id/read', verifyToken, async (req, res) => {
  try {
    const result = await db.query(
      `UPDATE notifications SET is_read = true, updated_at = NOW() WHERE id = $1 RETURNING *`,
      [req.params.id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Notification not found' });
    }

    res.json(result.rows[0]);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// DELETE /api/notifications/:id - Delete notification
app.delete('/api/notifications/:id', verifyToken, async (req, res) => {
  try {
    const result = await db.query(
      `DELETE FROM notifications WHERE id = $1 AND recipient_id = $2 RETURNING *`,
      [req.params.id, req.user.id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Notification not found' });
    }

    res.json({ message: 'Notification deleted' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET /api/notifications/summary - Notification statistics
app.get('/api/notifications/summary', verifyToken, requireAdmin, async (req, res) => {
  try {
    const result = await db.query(
      `SELECT 
        COUNT(*) as total_notifications,
        COUNT(CASE WHEN is_read = false THEN 1 END) as unread_count,
        COUNT(CASE WHEN status = 'sent' THEN 1 END) as sent_count,
        COUNT(CASE WHEN status = 'pending' THEN 1 END) as pending_count,
        COUNT(CASE WHEN status = 'failed' THEN 1 END) as failed_count,
        COUNT(DISTINCT recipient_id) as unique_recipients
       FROM notifications`
    );
    res.json(result.rows[0]);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ORIGINAL NOTIFICATIONS ENDPOINTS
app.post('/api/notifications/subscribe', verifyToken, async (req, res) => {
  try {
    const { subscription } = req.body;
    // Store subscription in database for later push notifications
    // For now, just acknowledge
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.put('/api/notifications/preferences', verifyToken, async (req, res) => {
  try {
    const { emailEnabled, pushEnabled, scheduleAlerts, absenceAlerts, billingAlerts } = req.body;

    const result = await db.query(
      `INSERT INTO notification_preferences (user_id, email_enabled, push_enabled, schedule_alerts, absence_alerts, billing_alerts)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (user_id) DO UPDATE SET 
       email_enabled = $2, push_enabled = $3, schedule_alerts = $4, absence_alerts = $5, billing_alerts = $6
       RETURNING *`,
      [req.user.id, emailEnabled, pushEnabled, scheduleAlerts, absenceAlerts, billingAlerts]
    );

    res.json(result.rows[0]);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ---- SCHEDULES ----



// GET /api/schedules-all - Get all schedules for calendar view
app.get('/api/schedules-all', verifyToken, async (req, res) => {
  try {
    const result = await db.query(
      `SELECT s.*, s.frequency, s.effective_date, s.anchor_date,
              u.first_name as caregiver_first_name, u.last_name as caregiver_last_name,
              c.first_name as client_first_name, c.last_name as client_last_name
       FROM schedules s
       JOIN users u ON s.caregiver_id = u.id
       JOIN clients c ON s.client_id = c.id
       WHERE s.is_active = true
       ORDER BY s.day_of_week, s.date, s.start_time`
    );
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// PUT /api/schedules-all/:scheduleId - Update a schedule in-place
app.put('/api/schedules-all/:scheduleId', verifyToken, async (req, res) => {
  try {
    const { scheduleId } = req.params;
    const { clientId, dayOfWeek, date, startTime, endTime, notes, frequency, effectiveDate, anchorDate } = req.body;

    if (startTime && endTime && startTime >= endTime) {
      return res.status(400).json({ error: 'End time must be after start time' });
    }

    const result = await db.query(
      `UPDATE schedules SET
        client_id = COALESCE($1, client_id),
        day_of_week = $2,
        date = $3,
        start_time = COALESCE($4, start_time),
        end_time = COALESCE($5, end_time),
        notes = $6,
        frequency = COALESCE($7, frequency),
        effective_date = COALESCE($8, effective_date),
        anchor_date = COALESCE($9, anchor_date),
        updated_at = NOW()
       WHERE id = $10 AND is_active = true
       RETURNING *`,
      [clientId, dayOfWeek !== undefined ? dayOfWeek : null, date || null, startTime, endTime, notes || null, frequency || 'weekly', effectiveDate || null, anchorDate || null, scheduleId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Schedule not found' });
    }
    res.json(result.rows[0]);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ═══════════════════════════════════════════════
// PROSPECTS & PROSPECT APPOINTMENTS
// ═══════════════════════════════════════════════

// GET /api/prospects
app.get('/api/prospects', verifyToken, async (req, res) => {
  try {
    const result = await db.query(
      `SELECT * FROM prospects WHERE status != 'inactive' ORDER BY created_at DESC`
    );
    res.json(result.rows);
  } catch (error) { res.status(500).json({ error: error.message }); }
});

// POST /api/prospects
app.post('/api/prospects', verifyToken, async (req, res) => {
  try {
    const { firstName, lastName, phone, email, address, city, state, notes, source } = req.body;
    if (!firstName || !lastName) return res.status(400).json({ error: 'First and last name required' });
    const result = await db.query(
      `INSERT INTO prospects (first_name, last_name, phone, email, address, city, state, notes, source)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *`,
      [firstName, lastName, phone || null, email || null, address || null, city || null, state || 'WI', notes || null, source || null]
    );
    res.status(201).json(result.rows[0]);
  } catch (error) { res.status(500).json({ error: error.message }); }
});

// PUT /api/prospects/:id
app.put('/api/prospects/:id', verifyToken, async (req, res) => {
  try {
    const { firstName, lastName, phone, email, address, city, state, notes, source, status } = req.body;
    const result = await db.query(
      `UPDATE prospects SET first_name = COALESCE($1, first_name), last_name = COALESCE($2, last_name),
        phone = $3, email = $4, address = $5, city = $6, state = COALESCE($7, state),
        notes = $8, source = $9, status = COALESCE($10, status), updated_at = NOW()
       WHERE id = $11 RETURNING *`,
      [firstName, lastName, phone, email, address, city, state, notes, source, status, req.params.id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Prospect not found' });
    res.json(result.rows[0]);
  } catch (error) { res.status(500).json({ error: error.message }); }
});

// DELETE /api/prospects/:id
app.delete('/api/prospects/:id', verifyToken, async (req, res) => {
  try {
    await db.query(`UPDATE prospects SET status = 'inactive' WHERE id = $1`, [req.params.id]);
    res.json({ success: true });
  } catch (error) { res.status(500).json({ error: error.message }); }
});

// POST /api/prospects/:id/convert - Convert prospect to client
app.post('/api/prospects/:id/convert', verifyToken, requireAdmin, async (req, res) => {
  try {
    const prospect = await db.query(`SELECT * FROM prospects WHERE id = $1`, [req.params.id]);
    if (prospect.rows.length === 0) return res.status(404).json({ error: 'Prospect not found' });
    const p = prospect.rows[0];

    // Create client from prospect data
    const clientResult = await db.query(
      `INSERT INTO clients (first_name, last_name, phone, email, address, city, state, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, 'active') RETURNING *`,
      [p.first_name, p.last_name, p.phone, p.email, p.address, p.city, p.state]
    );
    const newClient = clientResult.rows[0];

    // Update prospect status
    await db.query(
      `UPDATE prospects SET status = 'converted', converted_client_id = $1, updated_at = NOW() WHERE id = $2`,
      [newClient.id, req.params.id]
    );

    res.json({ client: newClient, message: 'Prospect converted to client' });
  } catch (error) { res.status(500).json({ error: error.message }); }
});

// GET /api/prospect-appointments
app.get('/api/prospect-appointments', verifyToken, async (req, res) => {
  try {
    const { month, year } = req.query;
    let query = `SELECT pa.*, p.first_name as prospect_first_name, p.last_name as prospect_last_name,
                        u.first_name as caregiver_first_name, u.last_name as caregiver_last_name
                 FROM prospect_appointments pa
                 JOIN prospects p ON pa.prospect_id = p.id
                 LEFT JOIN users u ON pa.caregiver_id = u.id
                 WHERE pa.status != 'cancelled'`;
    const params = [];
    if (month && year) {
      query += ` AND EXTRACT(MONTH FROM pa.appointment_date) = $1 AND EXTRACT(YEAR FROM pa.appointment_date) = $2`;
      params.push(month, year);
    }
    query += ` ORDER BY pa.appointment_date, pa.start_time`;
    const result = await db.query(query, params);
    res.json(result.rows);
  } catch (error) { res.status(500).json({ error: error.message }); }
});

// POST /api/prospect-appointments
app.post('/api/prospect-appointments', verifyToken, async (req, res) => {
  try {
    const { prospectId, caregiverId, appointmentDate, startTime, endTime, appointmentType, location, notes } = req.body;
    if (!prospectId || !appointmentDate || !startTime || !endTime) {
      return res.status(400).json({ error: 'Prospect, date, and times required' });
    }
    const result = await db.query(
      `INSERT INTO prospect_appointments (prospect_id, caregiver_id, appointment_date, start_time, end_time, appointment_type, location, notes)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
      [prospectId, caregiverId || null, appointmentDate, startTime, endTime, appointmentType || 'assessment', location || null, notes || null]
    );
    res.status(201).json(result.rows[0]);
  } catch (error) { res.status(500).json({ error: error.message }); }
});

// PUT /api/prospect-appointments/:id
app.put('/api/prospect-appointments/:id', verifyToken, async (req, res) => {
  try {
    const { caregiverId, appointmentDate, startTime, endTime, appointmentType, location, notes, status } = req.body;
    const result = await db.query(
      `UPDATE prospect_appointments SET
        caregiver_id = $1, appointment_date = COALESCE($2, appointment_date),
        start_time = COALESCE($3, start_time), end_time = COALESCE($4, end_time),
        appointment_type = COALESCE($5, appointment_type), location = $6,
        notes = $7, status = COALESCE($8, status)
       WHERE id = $9 RETURNING *`,
      [caregiverId || null, appointmentDate, startTime, endTime, appointmentType, location || null, notes || null, status, req.params.id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Appointment not found' });
    res.json(result.rows[0]);
  } catch (error) { res.status(500).json({ error: error.message }); }
});

// DELETE /api/prospect-appointments/:id
app.delete('/api/prospect-appointments/:id', verifyToken, async (req, res) => {
  try {
    await db.query(`UPDATE prospect_appointments SET status = 'cancelled' WHERE id = $1`, [req.params.id]);
    res.json({ success: true });
  } catch (error) { res.status(500).json({ error: error.message }); }
});


// POST /api/schedules-enhanced - Create schedule with frequency/effective_date support
app.post('/api/schedules-enhanced', verifyToken, async (req, res) => {
  try {
    const { caregiverId, clientId, scheduleType, dayOfWeek, date, startTime, endTime, notes, frequency, effectiveDate, anchorDate } = req.body;
    if (!caregiverId || !clientId || !startTime || !endTime) {
      return res.status(400).json({ error: 'Missing required fields' });
    }
    const id = uuidv4();
    const result = await db.query(
      `INSERT INTO schedules (id, caregiver_id, client_id, schedule_type, day_of_week, date, start_time, end_time, notes, frequency, effective_date, anchor_date)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12) RETURNING *`,
      [id, caregiverId, clientId, scheduleType || 'recurring', dayOfWeek !== undefined && dayOfWeek !== null ? dayOfWeek : null, date || null, startTime, endTime, notes || null, frequency || 'weekly', effectiveDate || null, anchorDate || null]
    );
    res.status(201).json(result.rows[0]);
  } catch (error) { res.status(500).json({ error: error.message }); }
});

// ---- CAREGIVER PROFILES ----

// GET /api/caregiver-profile/:caregiverId
app.get('/api/caregiver-profile/:caregiverId', verifyToken, async (req, res) => {
  try {
    let result = await db.query(
      `SELECT * FROM caregiver_profiles WHERE caregiver_id = $1`,
      [req.params.caregiverId]
    );

    if (result.rows.length === 0) {
      // Create default profile
      await db.query(
        `INSERT INTO caregiver_profiles (caregiver_id) VALUES ($1)`,
        [req.params.caregiverId]
      );
      result = await db.query(
        `SELECT * FROM caregiver_profiles WHERE caregiver_id = $1`,
        [req.params.caregiverId]
      );
    }

    res.json(result.rows[0]);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// PUT /api/caregiver-profile/:caregiverId
app.put('/api/caregiver-profile/:caregiverId', verifyToken, async (req, res) => {
  try {
    const { notes, capabilities, limitations, preferredHours, availableMon, availableTue, availableWed, availableThu, availableFri, availableSat, availableSun } = req.body;

    const result = await db.query(
      `UPDATE caregiver_profiles SET
        notes = COALESCE($1, notes),
        capabilities = COALESCE($2, capabilities),
        limitations = COALESCE($3, limitations),
        preferred_hours = COALESCE($4, preferred_hours),
        available_mon = COALESCE($5, available_mon),
        available_tue = COALESCE($6, available_tue),
        available_wed = COALESCE($7, available_wed),
        available_thu = COALESCE($8, available_thu),
        available_fri = COALESCE($9, available_fri),
        available_sat = COALESCE($10, available_sat),
        available_sun = COALESCE($11, available_sun),
        updated_at = NOW()
       WHERE caregiver_id = $12
       RETURNING *`,
      [notes, capabilities, limitations, preferredHours, availableMon, availableTue, availableWed, availableThu, availableFri, availableSat, availableSun, req.params.caregiverId]
    );

    await auditLog(req.user.id, 'UPDATE', 'caregiver_profiles', req.params.caregiverId, null, result.rows[0]);
    res.json(result.rows[0]);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ---- CERTIFICATIONS ----

// GET /api/caregivers/:caregiverId/certifications
app.get('/api/caregivers/:caregiverId/certifications', verifyToken, async (req, res) => {
  try {
    const result = await db.query(
      `SELECT * FROM caregiver_certifications WHERE caregiver_id = $1 ORDER BY expiration_date DESC`,
      [req.params.caregiverId]
    );
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/caregivers/:caregiverId/certifications
app.post('/api/caregivers/:caregiverId/certifications', verifyToken, async (req, res) => {
  try {
    const { certificationName, certificationNumber, issuer, issuedDate, expirationDate } = req.body;
    const certId = uuidv4();

    const result = await db.query(
      `INSERT INTO caregiver_certifications (id, caregiver_id, certification_name, certification_number, issuer, issued_date, expiration_date)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING *`,
      [certId, req.params.caregiverId, certificationName, certificationNumber, issuer, issuedDate, expirationDate]
    );

    await auditLog(req.user.id, 'CREATE', 'caregiver_certifications', certId, null, result.rows[0]);
    res.status(201).json(result.rows[0]);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// DELETE /api/caregivers/certifications/:certId
app.delete('/api/caregivers/certifications/:certId', verifyToken, async (req, res) => {
  try {
    const result = await db.query(
      `DELETE FROM caregiver_certifications WHERE id = $1 RETURNING *`,
      [req.params.certId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Certification not found' });
    }

    await auditLog(req.user.id, 'DELETE', 'caregiver_certifications', req.params.certId, null, result.rows[0]);
    res.json({ message: 'Certification deleted' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET /api/users/caregivers/:caregiverId - Get single caregiver
app.get('/api/users/caregivers/:caregiverId', verifyToken, async (req, res) => {
  try {
    const result = await db.query(
      `SELECT * FROM users WHERE id = $1 AND role = 'caregiver'`,
      [req.params.caregiverId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Caregiver not found' });
    }

    res.json(result.rows[0]);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ---- HEALTH CHECK ----
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date() });
});
// ---- NEW ADMIN FEATURES ----
app.use('/api/reports', verifyToken, require('./routes/reports'));
app.use('/api/payroll', verifyToken, require('./routes/payroll'));
app.use('/api/audit-logs', verifyToken, require('./routes/auditLogs'));
app.use('/api/users', verifyToken, require('./routes/users'));
app.use('/api/claims', verifyToken, require('./routes/claimsRoutes'));
app.use('/api/sms', verifyToken, require('./routes/smsRoutes'));
app.use('/api/open-shifts', verifyToken, require('./routes/openShiftsRoutes'));
app.use('/api/medications', verifyToken, require('./routes/medicationsRoutes'));
app.use('/api/documents', verifyToken, require('./routes/documentsRoutes'));
app.use('/api/adl', verifyToken, require('./routes/adlRoutes'));
app.use('/api/background-checks', verifyToken, require('./routes/backgroundCheckRoutes'));
app.use('/api/family-portal', require('./routes/familyPortalRoutes')); // No verifyToken - has its own auth
app.use('/api/shift-swaps', verifyToken, require('./routes/shiftSwapsRoutes'));
app.use('/api/alerts', verifyToken, require('./routes/alertsRoutes'));
app.use('/api', billingRoutes);
app.use('/api/route-optimizer', verifyToken, require('./routes/routeOptimizerRoutes'));
app.use('/api/matching', verifyToken, require('./routes/matchingRoutes'));
app.use('/api/emergency', verifyToken, require('./routes/emergencyRoutes'));
app.use('/api/messages', verifyToken, require('./routes/messageRoutes'));
app.use('/api/push', verifyToken, require('./routes/pushNotificationRoutes').router);

// ============ CARE TYPES ============
app.get('/api/care-types', verifyToken, async (req, res) => {
  try {
    const result = await db.query(
      `SELECT * FROM care_types WHERE is_active = true ORDER BY name`
    );
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/care-types', verifyToken, requireAdmin, async (req, res) => {
  try {
    const { name, description } = req.body;
    const id = uuidv4();
    
    const result = await db.query(
      `INSERT INTO care_types (id, name, description) VALUES ($1, $2, $3) RETURNING *`,
      [id, name, description]
    );
    
    await auditLog(req.user.id, 'CREATE', 'care_types', id, null, result.rows[0]);
    res.status(201).json(result.rows[0]);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.put('/api/care-types/:id', verifyToken, requireAdmin, async (req, res) => {
  try {
    const { name, description } = req.body;
    
    const result = await db.query(
      `UPDATE care_types SET name = $1, description = $2, updated_at = NOW() 
       WHERE id = $3 RETURNING *`,
      [name, description, req.params.id]
    );
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Care type not found' });
    }
    
    await auditLog(req.user.id, 'UPDATE', 'care_types', req.params.id, null, result.rows[0]);
    res.json(result.rows[0]);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ============ CAREGIVER CARE TYPE RATES (PAYROLL) ============
app.get('/api/caregiver-care-type-rates', verifyToken, async (req, res) => {
  try {
    const { caregiverId } = req.query;
    
    let query = `
      SELECT cctr.*, 
             u.first_name as caregiver_first_name, u.last_name as caregiver_last_name,
             ct.name as care_type_name
      FROM caregiver_care_type_rates cctr
      JOIN users u ON cctr.caregiver_id = u.id
      JOIN care_types ct ON cctr.care_type_id = ct.id
      WHERE cctr.is_active = true
        AND (cctr.end_date IS NULL OR cctr.end_date >= CURRENT_DATE)
    `;
    const params = [];
    
    if (caregiverId) {
      params.push(caregiverId);
      query += ` AND cctr.caregiver_id = $${params.length}`;
    }
    
    query += ` ORDER BY u.last_name, ct.name`;
    
    const result = await db.query(query, params);
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/caregiver-care-type-rates', verifyToken, requireAdmin, async (req, res) => {
  try {
    const { caregiverId, careTypeId, hourlyRate } = req.body;
    const id = uuidv4();
    
    // Deactivate any existing rate for this combo
    await db.query(
      `UPDATE caregiver_care_type_rates SET is_active = false, end_date = CURRENT_DATE, updated_at = NOW()
       WHERE caregiver_id = $1 AND care_type_id = $2 AND is_active = true`,
      [caregiverId, careTypeId]
    );
    
    const result = await db.query(
      `INSERT INTO caregiver_care_type_rates (id, caregiver_id, care_type_id, hourly_rate)
       VALUES ($1, $2, $3, $4) RETURNING *`,
      [id, caregiverId, careTypeId, hourlyRate]
    );
    
    await auditLog(req.user.id, 'CREATE', 'caregiver_care_type_rates', id, null, result.rows[0]);
    res.status(201).json(result.rows[0]);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.put('/api/caregiver-care-type-rates/:id', verifyToken, requireAdmin, async (req, res) => {
  try {
    const { hourlyRate } = req.body;
    
    const result = await db.query(
      `UPDATE caregiver_care_type_rates SET hourly_rate = $1, updated_at = NOW()
       WHERE id = $2 RETURNING *`,
      [hourlyRate, req.params.id]
    );
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Rate not found' });
    }
    
    await auditLog(req.user.id, 'UPDATE', 'caregiver_care_type_rates', req.params.id, null, result.rows[0]);
    res.json(result.rows[0]);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.delete('/api/caregiver-care-type-rates/:id', verifyToken, requireAdmin, async (req, res) => {
  try {
    const result = await db.query(
      `UPDATE caregiver_care_type_rates SET is_active = false, end_date = CURRENT_DATE, updated_at = NOW()
       WHERE id = $1 RETURNING *`,
      [req.params.id]
    );
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Rate not found' });
    }
    
    await auditLog(req.user.id, 'DELETE', 'caregiver_care_type_rates', req.params.id, null, result.rows[0]);
    res.json({ message: 'Rate ended' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get caregiver's pay rate for a specific client (based on client's care type)
app.get('/api/caregivers/:id/pay-rate-for-client/:clientId', verifyToken, async (req, res) => {
  try {
    const result = await db.query(`
      SELECT 
        cctr.hourly_rate,
        ct.name as care_type_name,
        u.default_pay_rate
      FROM clients c
      JOIN users u ON u.id = $1
      LEFT JOIN care_types ct ON c.care_type_id = ct.id
      LEFT JOIN caregiver_care_type_rates cctr ON 
        cctr.caregiver_id = $1 
        AND cctr.care_type_id = c.care_type_id
        AND cctr.is_active = true
      WHERE c.id = $2
    `, [req.params.id, req.params.clientId]);
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Client not found' });
    }
    
    const row = result.rows[0];
    res.json({
      hourlyRate: row.hourly_rate || row.default_pay_rate || 15.00,
      careTypeName: row.care_type_name,
      isDefaultRate: !row.hourly_rate
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ============ CLIENT BILLING INFO ============
app.get('/api/clients/:id/billing-rate', verifyToken, async (req, res) => {
  try {
    const result = await db.query(`
      SELECT 
        c.is_private_pay,
        CASE 
          WHEN c.is_private_pay THEN c.private_pay_rate
          ELSE rsr.rate_amount
        END as rate_amount,
        CASE 
          WHEN c.is_private_pay THEN c.private_pay_rate_type
          ELSE rsr.rate_type
        END as rate_type,
        rs.name as referral_source_name,
        ct.name as care_type_name
      FROM clients c
      LEFT JOIN referral_sources rs ON c.referral_source_id = rs.id
      LEFT JOIN care_types ct ON c.care_type_id = ct.id
      LEFT JOIN referral_source_rates rsr ON 
        rsr.referral_source_id = c.referral_source_id 
        AND rsr.care_type_id = c.care_type_id
        AND rsr.is_active = true
      WHERE c.id = $1
    `, [req.params.id]);
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Client not found' });
    }
    
    res.json(result.rows[0]);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.put('/api/clients/:id/billing', verifyToken, requireAdmin, async (req, res) => {
  try {
    const { referralSourceId, careTypeId, isPrivatePay, privatePayRate, privatePayRateType, billingNotes } = req.body;
    
    const result = await db.query(`
      UPDATE clients SET 
        referral_source_id = $1,
        care_type_id = $2,
        is_private_pay = $3,
        private_pay_rate = $4,
        private_pay_rate_type = $5,
        billing_notes = $6,
        updated_at = NOW()
      WHERE id = $7 RETURNING *
    `, [referralSourceId, careTypeId, isPrivatePay, privatePayRate, privatePayRateType, billingNotes, req.params.id]);
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Client not found' });
    }
    
    await auditLog(req.user.id, 'UPDATE', 'clients', req.params.id, null, result.rows[0]);
    res.json(result.rows[0]);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'Internal server error' });
});
// ============ SMART SCHEDULING ROUTES ============

// Helper to get week start (Sunday)
function getWeekStart(date) {
  const d = new Date(date);
  d.setDate(d.getDate() - d.getDay());
  d.setHours(0, 0, 0, 0);
  return d;
}

// GET /api/scheduling/suggest-caregivers - Smart caregiver suggestions with distance + skills
// REPLACES lines 4594-4702 in server.js
app.get('/api/scheduling/suggest-caregivers', verifyToken, async (req, res) => {
  try {
    const { clientId, date, startTime, endTime } = req.query;
    
    if (!clientId) {
      return res.status(400).json({ error: 'Client ID required' });
    }

    // Get client with care type and location
    const client = await db.query(`
      SELECT c.id, c.first_name, c.last_name, c.care_type_id, c.latitude, c.longitude,
             ct.name as care_type_name, ct.required_certifications
      FROM clients c
      LEFT JOIN care_types ct ON c.care_type_id = ct.id
      WHERE c.id = $1
    `, [clientId]);
    
    if (client.rows.length === 0) {
      return res.status(404).json({ error: 'Client not found' });
    }

    const clientData = client.rows[0];
    const requiredCerts = clientData.required_certifications || [];

    const shiftHours = startTime && endTime ? 
      (new Date(`2000-01-01T${endTime}`) - new Date(`2000-01-01T${startTime}`)) / (1000 * 60 * 60) : 4;

    // Get caregivers with availability AND certifications AND location
    const caregivers = await db.query(`
      SELECT u.id, u.first_name, u.last_name, u.phone, u.default_pay_rate,
             u.latitude, u.longitude, u.certifications,
             ca.status as availability_status, ca.max_hours_per_week,
             ARRAY_AGG(DISTINCT cc.certification_name) FILTER (WHERE cc.certification_name IS NOT NULL AND (cc.expiration_date IS NULL OR cc.expiration_date > CURRENT_DATE)) as active_certifications
      FROM users u
      LEFT JOIN caregiver_availability ca ON u.id = ca.caregiver_id
      LEFT JOIN caregiver_certifications cc ON u.id = cc.caregiver_id
      WHERE u.role = 'caregiver' AND u.is_active = true
      GROUP BY u.id, u.first_name, u.last_name, u.phone, u.default_pay_rate,
               u.latitude, u.longitude, u.certifications,
               ca.status, ca.max_hours_per_week
      ORDER BY u.first_name
    `);

    // Get weekly hours
    const weekStart = date ? getWeekStart(new Date(date)) : getWeekStart(new Date());
    const weekEnd = new Date(weekStart);
    weekEnd.setDate(weekEnd.getDate() + 6);

    const hoursResult = await db.query(`
      SELECT caregiver_id, SUM(EXTRACT(EPOCH FROM (end_time::time - start_time::time)) / 3600) as weekly_hours
      FROM schedules
      WHERE is_active = true AND (date >= $1 AND date <= $2 OR day_of_week IS NOT NULL)
      GROUP BY caregiver_id
    `, [weekStart.toISOString().split('T')[0], weekEnd.toISOString().split('T')[0]]);

    const hoursMap = {};
    hoursResult.rows.forEach(r => hoursMap[r.caregiver_id] = parseFloat(r.weekly_hours) || 0);

    // Get visit history with this client
    const historyResult = await db.query(`
      SELECT caregiver_id, COUNT(*) as visit_count
      FROM time_entries WHERE client_id = $1 AND is_complete = true
      GROUP BY caregiver_id
    `, [clientId]);

    const historyMap = {};
    historyResult.rows.forEach(r => historyMap[r.caregiver_id] = parseInt(r.visit_count) || 0);

    // Check conflicts
    let conflictingCaregivers = [];
    if (date && startTime && endTime) {
      const dayOfWeek = new Date(date).getDay();
      const conflicts = await db.query(`
        SELECT DISTINCT caregiver_id FROM schedules
        WHERE is_active = true AND (date = $1 OR day_of_week = $4)
          AND NOT (end_time <= $2 OR start_time >= $3)
      `, [date, startTime, endTime, dayOfWeek]);
      conflictingCaregivers = conflicts.rows.map(r => r.caregiver_id);
    }

    // Haversine distance calculation (returns miles)
    const calculateDistance = (lat1, lon1, lat2, lon2) => {
      if (!lat1 || !lon1 || !lat2 || !lon2) return null;
      const R = 3959; // Earth's radius in miles
      const dLat = (lat2 - lat1) * Math.PI / 180;
      const dLon = (lon2 - lon1) * Math.PI / 180;
      const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
                Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
                Math.sin(dLon / 2) * Math.sin(dLon / 2);
      const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
      return R * c;
    };

    // Check if caregiver has required certifications
    const hasRequiredCerts = (caregiverCerts, required) => {
      if (!required || required.length === 0) return { hasAll: true, missing: [] };
      const certs = caregiverCerts || [];
      const missing = required.filter(req => !certs.includes(req));
      return { hasAll: missing.length === 0, missing };
    };

    // Score caregivers
    const ranked = caregivers.rows.map(cg => {
      const weeklyHours = hoursMap[cg.id] || 0;
      const maxHours = cg.max_hours_per_week || 40;
      const visitCount = historyMap[cg.id] || 0;
      const hasConflict = conflictingCaregivers.includes(cg.id);
      const isAvailable = cg.availability_status !== 'unavailable';
      const wouldExceedHours = (weeklyHours + shiftHours) > maxHours;
      const approachingOvertime = (weeklyHours + shiftHours) > 40;

      // Distance calculation
      const distance = calculateDistance(
        cg.latitude, cg.longitude,
        clientData.latitude, clientData.longitude
      );
      const estimatedDriveTime = distance ? Math.round(distance * 2) : null;

      // Skills matching
      const certCheck = hasRequiredCerts(cg.active_certifications, requiredCerts);
      const hasRequiredSkills = certCheck.hasAll;
      const missingCerts = certCheck.missing;

      // Calculate score
      let score = 100;
      
      // Familiarity bonus (max +30)
      score += Math.min(visitCount * 3, 30);
      
      // Availability penalties
      if (!isAvailable) score -= 100;
      if (hasConflict) score -= 100;
      
      // Hours penalties
      score -= (weeklyHours / maxHours) * 20;
      if (wouldExceedHours) score -= 50;
      if (approachingOvertime) score -= 10;

      // Distance scoring
      if (distance !== null) {
        if (distance <= 5) score += 20;
        else if (distance <= 10) score += 10;
        else if (distance <= 20) score += 5;
        else if (distance > 30) score -= 15;
      }

      // Skills matching
      if (!hasRequiredSkills) {
        score -= 40;
      }

      // Build reason strings
      const reasons = [];
      
      if (visitCount > 5) reasons.push(`✓ Familiar (${visitCount} visits)`);
      else if (visitCount > 0) reasons.push(`${visitCount} prior visits`);
      
      if (hasConflict) reasons.push('⚠️ Conflict');
      if (!isAvailable) reasons.push('⚠️ Unavailable');
      
      if (wouldExceedHours) reasons.push('⚠️ Exceeds max hours');
      else if (approachingOvertime) reasons.push(`⚠️ ${weeklyHours.toFixed(0)}h this week`);
      else if (weeklyHours < 20) reasons.push('✓ Has availability');

      if (distance !== null) {
        if (distance <= 5) reasons.push(`✓ Nearby (${distance.toFixed(1)} mi)`);
        else if (distance <= 15) reasons.push(`${distance.toFixed(1)} mi away`);
        else if (distance > 20) reasons.push(`⚠️ Far (${distance.toFixed(1)} mi)`);
      }

      if (!hasRequiredSkills) {
        reasons.push(`⚠️ Missing: ${missingCerts.join(', ')}`);
      } else if (requiredCerts.length > 0) {
        reasons.push('✓ Has required certs');
      }

      return {
        ...cg,
        weeklyHours: weeklyHours.toFixed(2),
        maxHours,
        visitCount,
        hasConflict,
        isAvailable,
        wouldExceedHours,
        approachingOvertime,
        distance: distance ? distance.toFixed(1) : null,
        estimatedDriveTime,
        hasRequiredSkills,
        missingCertifications: missingCerts,
        score: Math.round(score),
        reasons
      };
    });

    ranked.sort((a, b) => b.score - a.score);
    
    res.json({ 
      client: clientData, 
      suggestions: ranked, 
      shiftHours,
      requiredCertifications: requiredCerts
    });
  } catch (error) {
    console.error('Suggest caregivers error:', error);
    res.status(500).json({ error: error.message });
  }
});

// POST /api/scheduling/auto-fill - Automatically fill all open shifts with best caregivers
app.post('/api/scheduling/auto-fill', verifyToken, requireAdmin, async (req, res) => {
  try {
    const { startDate, endDate, dryRun = false } = req.body;
    
    const start = startDate || new Date().toISOString().split('T')[0];
    const end = endDate || (() => {
      const d = new Date();
      d.setDate(d.getDate() + 7);
      return d.toISOString().split('T')[0];
    })();

    // Get all open shifts in date range
    const openShifts = await db.query(`
      SELECT os.*, 
        c.first_name as client_first, c.last_name as client_last,
        c.care_type_id, c.latitude as client_lat, c.longitude as client_lng,
        ct.required_certifications
      FROM open_shifts os
      JOIN clients c ON os.client_id = c.id
      LEFT JOIN care_types ct ON c.care_type_id = ct.id
      WHERE os.status = 'open'
        AND os.shift_date >= $1 AND os.shift_date <= $2
      ORDER BY os.urgency DESC, os.shift_date ASC, os.start_time ASC
    `, [start, end]);

    if (openShifts.rows.length === 0) {
      return res.json({ 
        success: true, 
        message: 'No open shifts to fill',
        filled: 0,
        failed: 0,
        results: []
      });
    }

    // Get all active caregivers
    const caregivers = await db.query(`
      SELECT u.id, u.first_name, u.last_name, u.latitude, u.longitude,
             ca.status as availability_status, ca.max_hours_per_week,
             ARRAY_AGG(DISTINCT cc.certification_name) FILTER (WHERE cc.certification_name IS NOT NULL AND (cc.expiration_date IS NULL OR cc.expiration_date > CURRENT_DATE)) as active_certifications
      FROM users u
      LEFT JOIN caregiver_availability ca ON u.id = ca.caregiver_id
      LEFT JOIN caregiver_certifications cc ON u.id = cc.caregiver_id
      WHERE u.role = 'caregiver' AND u.is_active = true
        AND (ca.status IS NULL OR ca.status != 'unavailable')
      GROUP BY u.id, u.first_name, u.last_name, u.latitude, u.longitude,
               ca.status, ca.max_hours_per_week
    `);

    // Get weekly hours
    const weekStart = getWeekStart(new Date(start));
    const weekEnd = new Date(weekStart);
    weekEnd.setDate(weekEnd.getDate() + 6);

    const hoursResult = await db.query(`
      SELECT caregiver_id, SUM(EXTRACT(EPOCH FROM (end_time::time - start_time::time)) / 3600) as weekly_hours
      FROM schedules
      WHERE is_active = true AND (date >= $1 AND date <= $2 OR day_of_week IS NOT NULL)
      GROUP BY caregiver_id
    `, [weekStart.toISOString().split('T')[0], weekEnd.toISOString().split('T')[0]]);

    const hoursMap = {};
    hoursResult.rows.forEach(r => hoursMap[r.caregiver_id] = parseFloat(r.weekly_hours) || 0);

    // Get visit history
    const historyResult = await db.query(`
      SELECT caregiver_id, client_id, COUNT(*) as visit_count
      FROM time_entries WHERE is_complete = true
      GROUP BY caregiver_id, client_id
    `);

    const historyMap = {};
    historyResult.rows.forEach(r => {
      if (!historyMap[r.client_id]) historyMap[r.client_id] = {};
      historyMap[r.client_id][r.caregiver_id] = parseInt(r.visit_count) || 0;
    });

    const newAssignments = [];

    const calculateDistance = (lat1, lon1, lat2, lon2) => {
      if (!lat1 || !lon1 || !lat2 || !lon2) return null;
      const R = 3959;
      const dLat = (lat2 - lat1) * Math.PI / 180;
      const dLon = (lon2 - lon1) * Math.PI / 180;
      const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
                Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
                Math.sin(dLon / 2) * Math.sin(dLon / 2);
      const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
      return R * c;
    };

    const timesOverlap = (start1, end1, start2, end2) => {
      return !(end1 <= start2 || start1 >= end2);
    };

    const hasRequiredCerts = (caregiverCerts, required) => {
      if (!required || required.length === 0) return true;
      const certs = caregiverCerts || [];
      return required.every(req => certs.includes(req));
    };

    const results = [];
    let filled = 0;
    let failed = 0;

    for (const shift of openShifts.rows) {
      const shiftHours = (new Date(`2000-01-01T${shift.end_time}`) - new Date(`2000-01-01T${shift.start_time}`)) / (1000 * 60 * 60);
      const requiredCerts = shift.required_certifications || [];
      const clientHistory = historyMap[shift.client_id] || {};

      const existingConflicts = await db.query(`
        SELECT DISTINCT caregiver_id FROM schedules
        WHERE is_active = true AND date = $1
          AND NOT (end_time <= $2 OR start_time >= $3)
      `, [shift.shift_date, shift.start_time, shift.end_time]);
      const conflictingIds = existingConflicts.rows.map(r => r.caregiver_id);

      const scored = caregivers.rows.map(cg => {
        const weeklyHours = hoursMap[cg.id] || 0;
        const maxHours = cg.max_hours_per_week || 40;
        const visitCount = clientHistory[cg.id] || 0;

        const hasExistingConflict = conflictingIds.includes(cg.id);
        const hasNewConflict = newAssignments.some(a => 
          a.caregiverId === cg.id && 
          a.date === shift.shift_date &&
          timesOverlap(a.startTime, a.endTime, shift.start_time, shift.end_time)
        );
        const hasConflict = hasExistingConflict || hasNewConflict;

        const additionalHours = newAssignments
          .filter(a => a.caregiverId === cg.id)
          .reduce((sum, a) => {
            const h = (new Date(`2000-01-01T${a.endTime}`) - new Date(`2000-01-01T${a.startTime}`)) / (1000 * 60 * 60);
            return sum + h;
          }, 0);
        const projectedHours = weeklyHours + additionalHours;

        const wouldExceedHours = (projectedHours + shiftHours) > maxHours;
        const wouldExceedOvertime = (projectedHours + shiftHours) > 40;

        const distance = calculateDistance(cg.latitude, cg.longitude, shift.client_lat, shift.client_lng);
        const hasCerts = hasRequiredCerts(cg.active_certifications, requiredCerts);

        if (hasConflict || wouldExceedHours || !hasCerts) {
          return { ...cg, score: -1000, disqualified: true, reason: hasConflict ? 'conflict' : !hasCerts ? 'missing_certs' : 'exceeds_hours' };
        }

        let score = 100;
        score += Math.min(visitCount * 3, 30);
        score -= (projectedHours / maxHours) * 20;
        if (wouldExceedOvertime) score -= 15;
        
        if (distance !== null) {
          if (distance <= 5) score += 20;
          else if (distance <= 10) score += 10;
          else if (distance <= 20) score += 5;
          else if (distance > 30) score -= 15;
        }

        return { ...cg, score, disqualified: false, distance, visitCount, projectedHours };
      });

      scored.sort((a, b) => b.score - a.score);
      const bestMatch = scored.find(s => !s.disqualified);

      if (bestMatch) {
        const shiftResult = {
          shiftId: shift.id,
          client: `${shift.client_first} ${shift.client_last}`,
          date: shift.shift_date,
          time: `${shift.start_time} - ${shift.end_time}`,
          assignedTo: `${bestMatch.first_name} ${bestMatch.last_name}`,
          caregiverId: bestMatch.id,
          score: Math.round(bestMatch.score),
          distance: bestMatch.distance ? `${bestMatch.distance.toFixed(1)} mi` : 'N/A',
          familiarity: bestMatch.visitCount > 0 ? `${bestMatch.visitCount} visits` : 'New'
        };

        if (!dryRun) {
          const scheduleId = uuidv4();
          await db.query(`
            INSERT INTO schedules (id, caregiver_id, client_id, schedule_type, date, start_time, end_time, notes)
            VALUES ($1, $2, $3, 'one-time', $4, $5, $6, $7)
          `, [scheduleId, bestMatch.id, shift.client_id, shift.shift_date, shift.start_time, shift.end_time, 'Auto-assigned']);

          await db.query(`
            UPDATE open_shifts SET status = 'filled', filled_by = $1, filled_at = NOW()
            WHERE id = $2
          `, [bestMatch.id, shift.id]);

          shiftResult.scheduleId = scheduleId;
        }

        newAssignments.push({
          caregiverId: bestMatch.id,
          date: shift.shift_date,
          startTime: shift.start_time,
          endTime: shift.end_time
        });

        hoursMap[bestMatch.id] = (hoursMap[bestMatch.id] || 0) + shiftHours;
        results.push({ ...shiftResult, status: 'filled' });
        filled++;
      } else {
        const topDisqualified = scored.filter(s => s.disqualified).slice(0, 3);
        results.push({
          shiftId: shift.id,
          client: `${shift.client_first} ${shift.client_last}`,
          date: shift.shift_date,
          time: `${shift.start_time} - ${shift.end_time}`,
          status: 'unfilled',
          reason: 'No available caregivers',
          candidates: topDisqualified.map(c => ({ name: `${c.first_name} ${c.last_name}`, reason: c.reason }))
        });
        failed++;
      }
    }

    res.json({
      success: true,
      dryRun,
      message: dryRun 
        ? `Preview: Would fill ${filled} of ${openShifts.rows.length} shifts`
        : `Filled ${filled} of ${openShifts.rows.length} shifts`,
      filled,
      failed,
      total: openShifts.rows.length,
      results
    });

  } catch (error) {
    console.error('Auto-fill error:', error);
    res.status(500).json({ error: error.message });
  }
});
// POST /api/scheduling/check-conflicts
app.post('/api/scheduling/check-conflicts', verifyToken, async (req, res) => {
  try {
    const { caregiverId, date, startTime, endTime } = req.body;
    if (!caregiverId || !startTime || !endTime) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    const dayOfWeek = date ? new Date(date).getDay() : null;
    const result = await db.query(`
      SELECT s.*, c.first_name as client_first_name, c.last_name as client_last_name
      FROM schedules s LEFT JOIN clients c ON s.client_id = c.id
      WHERE s.caregiver_id = $1 AND s.is_active = true
        AND NOT (s.end_time <= $2 OR s.start_time >= $3)
        AND (s.date = $4 OR s.day_of_week = $5)
    `, [caregiverId, startTime, endTime, date, dayOfWeek]);

    res.json({
      hasConflict: result.rows.length > 0,
      conflicts: result.rows.map(s => ({
        id: s.id, clientName: `${s.client_first_name} ${s.client_last_name}`,
        startTime: s.start_time, endTime: s.end_time, isRecurring: s.day_of_week !== null
      }))
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET /api/scheduling/week-view
app.get('/api/scheduling/week-view', verifyToken, async (req, res) => {
  try {
    const { weekOf } = req.query;
    const weekStart = weekOf ? getWeekStart(new Date(weekOf)) : getWeekStart(new Date());
    const weekEnd = new Date(weekStart);
    weekEnd.setDate(weekEnd.getDate() + 6);

    const caregivers = await db.query(`
      SELECT id, first_name, last_name FROM users 
      WHERE role = 'caregiver' AND is_active = true ORDER BY first_name
    `);

    const schedules = await db.query(`
      SELECT s.*, c.first_name as client_first_name, c.last_name as client_last_name
      FROM schedules s LEFT JOIN clients c ON s.client_id = c.id
      WHERE s.is_active = true AND (s.date >= $1 AND s.date <= $2 OR s.day_of_week IS NOT NULL)
      ORDER BY s.start_time
    `, [weekStart.toISOString().split('T')[0], weekEnd.toISOString().split('T')[0]]);

    const weekData = {};
    caregivers.rows.forEach(cg => {
      weekData[cg.id] = { caregiver: cg, days: { 0: [], 1: [], 2: [], 3: [], 4: [], 5: [], 6: [] } };
    });

    // Helper: check if a recurring schedule applies to a given date
    const isScheduleActiveForDate = (schedule, targetDate) => {
      // Forward-only: if effective_date exists, only show from that date forward
      if (schedule.effective_date) {
        const effDate = new Date(schedule.effective_date);
        effDate.setHours(0,0,0,0);
        const target = new Date(targetDate);
        target.setHours(0,0,0,0);
        if (target < effDate) return false;
      }
      // Bi-weekly: check if this is an "on" week
      if (schedule.frequency === 'biweekly' && schedule.anchor_date) {
        const anchor = new Date(schedule.anchor_date);
        const target = new Date(targetDate);
        const diffWeeks = Math.round((target - anchor) / (7 * 24 * 60 * 60 * 1000));
        if (diffWeeks % 2 !== 0) return false;
      }
      return true;
    };

    schedules.rows.forEach(s => {
      if (!weekData[s.caregiver_id]) return;
      if (s.date) {
        const dow = new Date(s.date).getDay();
        weekData[s.caregiver_id].days[dow].push({ ...s, isRecurring: false });
      } else if (s.day_of_week !== null) {
        // Calculate the actual date for this day_of_week in the current week
        const dayDate = new Date(weekStart);
        dayDate.setDate(dayDate.getDate() + s.day_of_week);
        if (isScheduleActiveForDate(s, dayDate)) {
          weekData[s.caregiver_id].days[s.day_of_week].push({ ...s, isRecurring: true });
        }
      }
    });

    res.json({
      weekStart: weekStart.toISOString().split('T')[0],
      weekEnd: weekEnd.toISOString().split('T')[0],
      caregivers: Object.values(weekData)
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/scheduling/bulk-create - Recurring templates
app.post('/api/scheduling/bulk-create', verifyToken, requireAdmin, async (req, res) => {
  try {
    const { caregiverId, clientId, template, weeks, startDate, notes } = req.body;
    if (!caregiverId || !clientId || !template || template.length === 0) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    const numWeeks = Math.min(Math.max(parseInt(weeks) || 4, 1), 12);
    const start = startDate ? new Date(startDate) : new Date();
    start.setDate(start.getDate() - start.getDay());

    const created = [];
    const conflicts = [];

    for (let week = 0; week < numWeeks; week++) {
      for (const slot of template) {
        const slotDate = new Date(start);
        slotDate.setDate(slotDate.getDate() + (week * 7) + slot.dayOfWeek);
        if (slotDate < new Date()) continue;

        const dateStr = slotDate.toISOString().split('T')[0];

        const conflict = await db.query(`
          SELECT id FROM schedules WHERE caregiver_id = $1 AND is_active = true
            AND date = $2 AND NOT (end_time <= $3 OR start_time >= $4)
        `, [caregiverId, dateStr, slot.startTime, slot.endTime]);

        if (conflict.rows.length > 0) {
          conflicts.push({ date: dateStr, startTime: slot.startTime });
          continue;
        }

        const scheduleId = uuidv4();
        const result = await db.query(`
          INSERT INTO schedules (id, caregiver_id, client_id, schedule_type, date, start_time, end_time, notes)
          VALUES ($1, $2, $3, 'one-time', $4, $5, $6, $7) RETURNING *
        `, [scheduleId, caregiverId, clientId, dateStr, slot.startTime, slot.endTime, notes || null]);

        created.push(result.rows[0]);
      }
    }

    res.json({ success: true, created: created.length, skippedConflicts: conflicts.length, conflicts });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});
// GET /api/open-shifts/available - Get shifts available for pickup
app.get('/api/open-shifts/available', verifyToken, async (req, res) => {
  try {
    const result = await db.query(`
      SELECT os.*, c.first_name as client_first_name, c.last_name as client_last_name
      FROM open_shifts os
      LEFT JOIN clients c ON os.client_id = c.id
      WHERE os.status = 'open' 
        AND (os.date >= CURRENT_DATE OR os.date IS NULL)
      ORDER BY os.date, os.start_time
    `);
    res.json(result.rows);
  } catch (error) {
    console.error('Get available shifts error:', error);
    res.status(500).json({ error: error.message });
  }
});

// POST /api/open-shifts/:shiftId/claim - Caregiver claims an open shift
app.post('/api/open-shifts/:shiftId/claim', verifyToken, async (req, res) => {
  try {
    const { shiftId } = req.params;
    const caregiverId = req.user.id;

    // Get the open shift
    const shiftResult = await db.query(
      `SELECT * FROM open_shifts WHERE id = $1 AND status = 'open'`,
      [shiftId]
    );

    if (shiftResult.rows.length === 0) {
      return res.status(404).json({ error: 'Shift not found or already claimed' });
    }

    const shift = shiftResult.rows[0];

    // Check for conflicts
    const conflictResult = await db.query(`
      SELECT id FROM schedules 
      WHERE caregiver_id = $1 AND is_active = true
        AND date = $2
        AND NOT (end_time <= $3 OR start_time >= $4)
    `, [caregiverId, shift.date, shift.start_time, shift.end_time]);

    if (conflictResult.rows.length > 0) {
      return res.status(400).json({ error: 'You have a conflicting schedule' });
    }

    // Create the schedule
    const scheduleId = uuidv4();
    await db.query(`
      INSERT INTO schedules (id, caregiver_id, client_id, schedule_type, date, start_time, end_time, notes)
      VALUES ($1, $2, $3, 'one-time', $4, $5, $6, $7)
    `, [scheduleId, caregiverId, shift.client_id, shift.date, shift.start_time, shift.end_time, shift.notes]);

    // Update open shift status
    await db.query(`
      UPDATE open_shifts SET status = 'filled', filled_by = $1, filled_at = NOW() WHERE id = $2
    `, [caregiverId, shiftId]);

    res.json({ success: true, scheduleId });
  } catch (error) {
    console.error('Claim shift error:', error);
    res.status(500).json({ error: error.message });
  }
});

// GET /api/absences/my - Get current user's time off requests
app.get('/api/absences/my', verifyToken, async (req, res) => {
  try {
    const result = await db.query(`
      SELECT * FROM absences 
      WHERE caregiver_id = $1 
      ORDER BY created_at DESC
    `, [req.user.id]);
    res.json(result.rows);
  } catch (error) {
    console.error('Get my absences error:', error);
    res.status(500).json({ error: error.message });
  }
});

// GET /api/scheduling/caregiver-hours/:caregiverId - Get weekly hours (if not already added)
app.get('/api/scheduling/caregiver-hours/:caregiverId', verifyToken, async (req, res) => {
  try {
    const { caregiverId } = req.params;
    
    // Get current week boundaries
    const now = new Date();
    const weekStart = new Date(now);
    weekStart.setDate(now.getDate() - now.getDay());
    weekStart.setHours(0, 0, 0, 0);
    
    const weekEnd = new Date(weekStart);
    weekEnd.setDate(weekEnd.getDate() + 6);
    weekEnd.setHours(23, 59, 59, 999);

    // Get one-time schedules this week
    const oneTimeResult = await db.query(`
      SELECT SUM(EXTRACT(EPOCH FROM (end_time::time - start_time::time)) / 3600) as hours
      FROM schedules
      WHERE caregiver_id = $1 AND is_active = true
        AND date >= $2 AND date <= $3
    `, [caregiverId, weekStart.toISOString().split('T')[0], weekEnd.toISOString().split('T')[0]]);

    // Get recurring schedules
    const recurringResult = await db.query(`
      SELECT SUM(EXTRACT(EPOCH FROM (end_time::time - start_time::time)) / 3600) as hours
      FROM schedules
      WHERE caregiver_id = $1 AND is_active = true AND day_of_week IS NOT NULL
    `, [caregiverId]);

    const oneTimeHours = parseFloat(oneTimeResult.rows[0]?.hours) || 0;
    const recurringHours = parseFloat(recurringResult.rows[0]?.hours) || 0;
    const totalHours = oneTimeHours + recurringHours;

    // Get max hours
    const availResult = await db.query(
      `SELECT max_hours_per_week FROM caregiver_availability WHERE caregiver_id = $1`,
      [caregiverId]
    );
    const maxHours = availResult.rows[0]?.max_hours_per_week || 40;

    res.json({
      totalHours: totalHours.toFixed(2),
      oneTimeHours: oneTimeHours.toFixed(2),
      recurringHours: recurringHours.toFixed(2),
      maxHours,
      remainingHours: Math.max(0, maxHours - totalHours).toFixed(2),
      approachingOvertime: totalHours > 35
    });
  } catch (error) {
    console.error('Get caregiver hours error:', error);
    res.status(500).json({ error: error.message });
  }
});

// GET /api/scheduling/coverage-overview - Get caregiver hours and under-scheduled clients
app.get('/api/scheduling/coverage-overview', verifyToken, requireAdmin, async (req, res) => {
  try {
    // Use weekOf param if provided, otherwise default to current week
    const { weekOf } = req.query;
    const now = weekOf ? new Date(weekOf + 'T12:00:00') : new Date();
    const weekStart = new Date(now);
    weekStart.setDate(now.getDate() - now.getDay());
    weekStart.setHours(0, 0, 0, 0);
    
    const weekEnd = new Date(weekStart);
    weekEnd.setDate(weekEnd.getDate() + 6);
    weekEnd.setHours(23, 59, 59, 999);

    // Get all active caregivers with their scheduled hours
    const caregiversResult = await db.query(`
      SELECT 
        u.id,
        u.first_name,
        u.last_name,
        COALESCE(ca.max_hours_per_week, 40) as max_hours,
        COALESCE(ca.status, 'available') as availability_status,
        (
          SELECT COALESCE(SUM(EXTRACT(EPOCH FROM (s.end_time::time - s.start_time::time)) / 3600), 0)
          FROM schedules s
          WHERE s.caregiver_id = u.id 
            AND s.is_active = true
            AND (
              (s.date >= $1 AND s.date <= $2)
              OR s.day_of_week IS NOT NULL
            )
        ) as scheduled_hours
      FROM users u
      LEFT JOIN caregiver_availability ca ON u.id = ca.caregiver_id
      WHERE u.role = 'caregiver' AND u.is_active = true
      ORDER BY u.first_name, u.last_name
    `, [weekStart.toISOString().split('T')[0], weekEnd.toISOString().split('T')[0]]);

    // Get all active clients with authorized units and their scheduled hours
    const clientsResult = await db.query(`
      SELECT 
        c.id,
        c.first_name,
        c.last_name,
        c.weekly_authorized_units,
        (
          SELECT COALESCE(SUM(EXTRACT(EPOCH FROM (s.end_time::time - s.start_time::time)) / 3600), 0)
          FROM schedules s
          WHERE s.client_id = c.id 
            AND s.is_active = true
            AND (
              (s.date >= $1 AND s.date <= $2)
              OR s.day_of_week IS NOT NULL
            )
        ) as scheduled_hours
      FROM clients c
      WHERE c.is_active = true
      ORDER BY c.first_name, c.last_name
    `, [weekStart.toISOString().split('T')[0], weekEnd.toISOString().split('T')[0]]);

    // Process caregivers
    const caregivers = caregiversResult.rows.map(cg => ({
      id: cg.id,
      name: `${cg.first_name} ${cg.last_name}`,
      maxHours: parseFloat(cg.max_hours) || 40,
      scheduledHours: parseFloat(cg.scheduled_hours) || 0,
      remainingHours: Math.max(0, (parseFloat(cg.max_hours) || 40) - (parseFloat(cg.scheduled_hours) || 0)),
      utilizationPercent: Math.round(((parseFloat(cg.scheduled_hours) || 0) / (parseFloat(cg.max_hours) || 40)) * 100),
      status: cg.availability_status
    }));

    // Process clients - only those with authorized units set
    const clientsWithUnits = clientsResult.rows
      .filter(cl => cl.weekly_authorized_units && parseInt(cl.weekly_authorized_units) > 0)
      .map(cl => {
        const authorizedUnits = parseInt(cl.weekly_authorized_units) || 0;
        const authorizedHours = authorizedUnits * 0.25; // 1 unit = 15 min = 0.25 hours
        const scheduledHours = parseFloat(cl.scheduled_hours) || 0;
        const scheduledUnits = Math.round(scheduledHours * 4); // Convert hours to units
        const shortfallUnits = Math.max(0, authorizedUnits - scheduledUnits);
        const shortfallHours = shortfallUnits * 0.25;
        return {
          id: cl.id,
          name: `${cl.first_name} ${cl.last_name}`,
          authorizedUnits,
          authorizedHours,
          scheduledUnits,
          scheduledHours,
          shortfallUnits,
          shortfallHours,
          coveragePercent: authorizedUnits > 0 ? Math.round((scheduledUnits / authorizedUnits) * 100) : 0,
          isUnderScheduled: shortfallUnits > 0
        };
      });

    // Separate under-scheduled clients
    const underScheduledClients = clientsWithUnits.filter(cl => cl.isUnderScheduled);

    res.json({
      weekStart: weekStart.toISOString().split('T')[0],
      weekEnd: weekEnd.toISOString().split('T')[0],
      caregivers,
      clientsWithUnits,
      underScheduledClients,
      summary: {
        totalCaregivers: caregivers.length,
        totalScheduledHours: caregivers.reduce((sum, cg) => sum + cg.scheduledHours, 0).toFixed(2),
        totalAvailableHours: caregivers.reduce((sum, cg) => sum + cg.maxHours, 0).toFixed(2),
        underScheduledClientCount: underScheduledClients.length,
        totalShortfallUnits: underScheduledClients.reduce((sum, cl) => sum + cl.shortfallUnits, 0),
        totalShortfallHours: underScheduledClients.reduce((sum, cl) => sum + cl.shortfallHours, 0).toFixed(2)
      }
    });
  } catch (error) {
    console.error('Coverage overview error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Start server
app.listen(port, () => {
  console.log(`🚀 Chippewa Valley Home Care API running on port ${port}`);
  console.log(`📊 Admin Dashboard: ${process.env.FRONTEND_URL || 'http://localhost:3000'}`);
});

