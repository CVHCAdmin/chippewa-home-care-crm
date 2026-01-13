// server.js - Chippewa Valley Home Care API
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');
const rateLimit = require('express-rate-limit');
const auditLogger = require('./middleware/auditLogger');
const authorizeAdmin = require('./middleware/authorizeAdmin');
const dotenv = require('dotenv');
const { Pool } = require('pg');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');

// Load environment variables
dotenv.config();

const app = express();
const port = process.env.PORT || 5000;

// ============ SECURITY MIDDLEWARE ============
app.use(helmet());
app.use(compression());
app.use(cors({
  origin: process.env.FRONTEND_URL || 'http://localhost:3000',
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

// ============ DATABASE CONNECTION ============
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});
app.use(auditLogger(pool));
// Test connection
pool.query('SELECT NOW()', (err, res) => {
  if (err) {
    console.error('❌ Database connection failed:', err);
  } else {
    console.log('✅ Database connected:', res.rows[0].now);
  }
});

// ============ HIPAA AUDIT LOGGING ============
const auditLog = async (userId, action, tableName, recordId, oldData, newData) => {
  try {
    // Skip if recordId is not a valid UUID string
    if (recordId && typeof recordId === 'string' && !recordId.match(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i)) {
      console.warn('Skipping audit log: invalid recordId format:', recordId);
      return;
    }
    
    await pool.query(
      `INSERT INTO audit_logs (user_id, action, table_name, record_id, old_data, new_data, timestamp)
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

// ---- AUTHENTICATION ROUTES ----
app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    const result = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
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
    const { email, password, firstName, lastName, phone } = req.body;

    const hashedPassword = await bcrypt.hash(password, 10);
    const userId = uuidv4();

    // Set current user for audit trigger
    await pool.query("SELECT set_config('app.current_user_id', $1, false)", [req.user.id]);

    const result = await pool.query(
      `INSERT INTO users (id, email, password_hash, first_name, last_name, phone, role)
       VALUES ($1, $2, $3, $4, $5, $6, 'caregiver')
       RETURNING id, email, first_name, last_name, role`,
      [userId, email, hashedPassword, firstName, lastName, phone]
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
    await pool.query("SELECT set_config('app.current_user_id', $1, false)", [req.user.id]);

    const result = await pool.query(
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

// ---- USER MANAGEMENT ----
app.get('/api/users/caregivers', verifyToken, requireAdmin, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT id, email, first_name, last_name, phone, hire_date, is_active, certifications, role
       FROM users WHERE role = 'caregiver' ORDER BY first_name`
    );
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/users/convert-to-admin', verifyToken, requireAdmin, async (req, res) => {
  try {
    const { userId } = req.body;
    const result = await pool.query(
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
    const { firstName, lastName, dateOfBirth, phone, email, address, city, state, zip, referredBy, serviceType } = req.body;
    const clientId = uuidv4();

    const result = await pool.query(
      `INSERT INTO clients (id, first_name, last_name, date_of_birth, phone, email, address, city, state, zip, referred_by, service_type, start_date)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, CURRENT_DATE)
       RETURNING *`,
      [clientId, firstName, lastName, dateOfBirth, phone, email, address, city, state, zip, referredBy, serviceType]
    );

    // Create onboarding checklist
    await pool.query(
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
    const result = await pool.query(
      `SELECT * FROM clients WHERE is_active = true ORDER BY first_name`
    );
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/clients/:id', verifyToken, async (req, res) => {
  try {
    const clientResult = await pool.query('SELECT * FROM clients WHERE id = $1', [req.params.id]);
    const emergencyResult = await pool.query('SELECT * FROM client_emergency_contacts WHERE client_id = $1', [req.params.id]);
    const onboardingResult = await pool.query('SELECT * FROM client_onboarding WHERE client_id = $1', [req.params.id]);

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
      medicalNotes, doNotUseCaregivers
    } = req.body;
    
    const result = await pool.query(
      `UPDATE clients SET 
        first_name = $1, 
        last_name = $2, 
        date_of_birth = $3,
        phone = $4, 
        email = $5, 
        address = $6,
        city = $7,
        state = $8,
        zip = $9,
        service_type = $10,
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
        updated_at = NOW()
       WHERE id = $25 RETURNING *`,
      [firstName, lastName, dateOfBirth, phone, email, address, city, state, zip, 
       serviceType, medicalConditions, allergies, medications, notes,
       insuranceProvider, insuranceId, insuranceGroup, gender, preferredCaregivers,
       emergencyContactName, emergencyContactPhone, emergencyContactRelationship,
       medicalNotes, doNotUseCaregivers, req.params.id]
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

// ---- CLIENT ONBOARDING ----
app.get('/api/clients/:id/onboarding', verifyToken, async (req, res) => {
  try {
    let result = await pool.query(
      `SELECT * FROM client_onboarding WHERE client_id = $1`,
      [req.params.id]
    );

    if (result.rows.length === 0) {
      // Create one if it doesn't exist
      await pool.query(
        `INSERT INTO client_onboarding (client_id) VALUES ($1)`,
        [req.params.id]
      );
      result = await pool.query(
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

    const result = await pool.query(query, params);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Onboarding record not found' });
    }

    await auditLog(req.user.id, 'UPDATE', 'client_onboarding', req.params.id, null, result.rows[0]);
    res.json(result.rows[0]);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ---- REFERRAL SOURCES ----
app.post('/api/referral-sources', verifyToken, requireAdmin, async (req, res) => {
  try {
    const { name, type, contactName, email, phone, address, city, state, zip } = req.body;
    const sourceId = uuidv4();

    const result = await pool.query(
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
    const result = await pool.query(
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

// ---- CAREGIVER SCHEDULES ----
app.post('/api/schedules', verifyToken, requireAdmin, async (req, res) => {
  try {
    const { caregiverId, dayOfWeek, date, startTime, endTime, maxHours } = req.body;
    const scheduleId = uuidv4();

    const result = await pool.query(
      `INSERT INTO caregiver_schedules (id, caregiver_id, day_of_week, date, start_time, end_time, max_hours_per_week)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING *`,
      [scheduleId, caregiverId, dayOfWeek, date, startTime, endTime, maxHours]
    );

    await auditLog(req.user.id, 'CREATE', 'caregiver_schedules', scheduleId, null, result.rows[0]);
    res.status(201).json(result.rows[0]);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/schedules/:caregiverId', verifyToken, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT * FROM caregiver_schedules 
       WHERE caregiver_id = $1 
       ORDER BY date DESC, start_time`,
      [req.params.caregiverId]
    );
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ---- INVOICING ----
app.post('/api/invoices/generate', verifyToken, requireAdmin, async (req, res) => {
  try {
    const { clientId, billingPeriodStart, billingPeriodEnd } = req.body;
    const invoiceId = uuidv4();
    const invoiceNumber = `INV-${Date.now()}`;

    // Get time entries for billing period
    const entriesResult = await pool.query(
      `SELECT te.*, ca.pay_rate FROM time_entries te
       LEFT JOIN client_assignments ca ON te.assignment_id = ca.id
       WHERE te.client_id = $1 AND te.start_time::date >= $2 AND te.end_time::date <= $3 AND te.is_complete = true`,
      [clientId, billingPeriodStart, billingPeriodEnd]
    );

    let total = 0;
    const lineItems = [];

    for (const entry of entriesResult.rows) {
      const amount = (entry.duration_minutes / 60) * (entry.pay_rate || 25);
      total += amount;
      lineItems.push({
        timeEntryId: entry.id,
        caregiverId: entry.caregiver_id,
        hours: entry.duration_minutes / 60,
        rate: entry.pay_rate,
        amount: amount
      });
    }

    // Create invoice
    const invoiceResult = await pool.query(
      `INSERT INTO invoices (id, invoice_number, client_id, billing_period_start, billing_period_end, subtotal, total, payment_due_date)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING *`,
      [invoiceId, invoiceNumber, clientId, billingPeriodStart, billingPeriodEnd, total, total, new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)]
    );

    // Create line items
    for (const item of lineItems) {
      await pool.query(
        `INSERT INTO invoice_line_items (invoice_id, time_entry_id, caregiver_id, description, hours, rate, amount)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [invoiceId, item.timeEntryId, item.caregiverId, 'Care Services', item.hours, item.rate, item.amount]
      );
    }

    await auditLog(req.user.id, 'CREATE', 'invoices', invoiceId, null, invoiceResult.rows[0]);
    res.status(201).json(invoiceResult.rows[0]);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/invoices', verifyToken, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT i.*, c.first_name, c.last_name FROM invoices i
       JOIN clients c ON i.client_id = c.id
       ORDER BY i.created_at DESC`
    );
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.put('/api/invoices/:id/payment-status', verifyToken, requireAdmin, async (req, res) => {
  try {
    const { status, paymentDate } = req.body;
    const result = await pool.query(
      `UPDATE invoices SET payment_status = $1, payment_date = $2, updated_at = NOW()
       WHERE id = $3 RETURNING *`,
      [status, paymentDate, req.params.id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Invoice not found' });
    }

    await auditLog(req.user.id, 'UPDATE', 'invoices', req.params.id, null, result.rows[0]);
    res.json(result.rows[0]);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ---- DASHBOARD ANALYTICS ----
app.get('/api/dashboard/summary', verifyToken, requireAdmin, async (req, res) => {
  try {
    const totalClientsResult = await pool.query('SELECT COUNT(*) as count FROM clients WHERE is_active = true');
    const activeCaregiversResult = await pool.query('SELECT COUNT(*) as count FROM users WHERE role = \'caregiver\' AND is_active = true');
    const pendingInvoicesResult = await pool.query('SELECT COUNT(*) as count, SUM(total) as amount FROM invoices WHERE payment_status = \'pending\'');
    const thisMonthRevenueResult = await pool.query(
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
    const result = await pool.query(
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
    const result = await pool.query(
      `SELECT u.id, u.first_name, u.last_name,
              COUNT(te.id) as shifts,
              SUM(te.duration_minutes)::integer / 60 as total_hours,
              AVG(pr.satisfaction_score) as avg_satisfaction
       FROM users u
       LEFT JOIN time_entries te ON u.id = te.caregiver_id AND te.is_complete = true
       LEFT JOIN performance_ratings pr ON u.id = pr.caregiver_id
       WHERE u.role = 'caregiver' AND u.is_active = true
       GROUP BY u.id, u.first_name, u.last_name
       ORDER BY total_hours DESC`
    );
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ---- EXPORTS ----
app.get('/api/export/invoices-csv', verifyToken, requireAdmin, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT i.invoice_number, c.first_name, c.last_name, i.billing_period_start, 
              i.billing_period_end, i.total, i.payment_status
       FROM invoices i
       JOIN clients c ON i.client_id = c.id
       ORDER BY i.created_at DESC`
    );

    let csv = 'Invoice #,Client Name,Period Start,Period End,Total,Status\n';
    result.rows.forEach(row => {
      csv += `"${row.invoice_number}","${row.first_name} ${row.last_name}","${row.billing_period_start}","${row.billing_period_end}","${row.total}","${row.payment_status}"\n`;
    });

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="invoices.csv"');
    res.send(csv);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ---- TIME TRACKING ----

// POST /api/time-entries/clock-in
app.post('/api/time-entries/clock-in', verifyToken, async (req, res) => {
  try {
    const { clientId, latitude, longitude } = req.body;
    const entryId = uuidv4();

    const result = await pool.query(
      `INSERT INTO time_entries (id, caregiver_id, client_id, clock_in, start_location)
       VALUES ($1, $2, $3, NOW(), $4)
       RETURNING *`,
      [entryId, req.user.id, clientId, JSON.stringify({ lat: latitude, lng: longitude })]
    );

    await auditLog(req.user.id, 'CREATE', 'time_entries', entryId, null, result.rows[0]);
    res.status(201).json(result.rows[0]);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// PATCH /api/time-entries/:id/clock-out
app.patch('/api/time-entries/:id/clock-out', verifyToken, async (req, res) => {
  try {
    const { latitude, longitude, notes } = req.body;

    // Calculate hours worked
    const timeEntry = await pool.query(`SELECT clock_in FROM time_entries WHERE id = $1`, [req.params.id]);
    const clockIn = new Date(timeEntry.rows[0].clock_in);
    const clockOut = new Date();
    const hoursWorked = (clockOut - clockIn) / (1000 * 60 * 60);

    const result = await pool.query(
      `UPDATE time_entries SET 
        clock_out = NOW(),
        end_location = $1,
        hours_worked = $2,
        notes = $3,
        updated_at = NOW()
       WHERE id = $4
       RETURNING *`,
      [JSON.stringify({ lat: latitude, lng: longitude }), hoursWorked.toFixed(2), notes || null, req.params.id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Time entry not found' });
    }

    await auditLog(req.user.id, 'UPDATE', 'time_entries', req.params.id, null, result.rows[0]);
    res.json(result.rows[0]);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET /api/time-entries - Get all time entries
app.get('/api/time-entries', verifyToken, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT te.*, u.first_name, u.last_name, c.first_name as client_first_name, c.last_name as client_last_name
       FROM time_entries te
       JOIN users u ON te.caregiver_id = u.id
       JOIN clients c ON te.client_id = c.id
       ORDER BY te.clock_in DESC`
    );
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET /api/time-entries/caregiver/:caregiverId - Get caregiver time entries
app.get('/api/time-entries/caregiver/:caregiverId', verifyToken, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT te.*, c.first_name as client_first_name, c.last_name as client_last_name
       FROM time_entries te
       JOIN clients c ON te.client_id = c.id
       WHERE te.caregiver_id = $1
       ORDER BY te.clock_in DESC`,
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
    let result = await pool.query(
      `SELECT * FROM caregiver_rates WHERE caregiver_id = $1`,
      [req.params.caregiverId]
    );

    if (result.rows.length === 0) {
      // Create default rate if not exists
      await pool.query(
        `INSERT INTO caregiver_rates (caregiver_id, base_hourly_rate) VALUES ($1, $2)`,
        [req.params.caregiverId, 18.50]
      );
      result = await pool.query(
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

    const result = await pool.query(
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

// ---- ENHANCED INVOICING ----

// GET /api/invoices/:id - Get invoice details with line items
app.get('/api/invoices/:id', verifyToken, async (req, res) => {
  try {
    const invoiceResult = await pool.query(
      `SELECT i.*, c.first_name, c.last_name, c.email, c.phone, c.address, c.city, c.state, c.zip
       FROM invoices i
       JOIN clients c ON i.client_id = c.id
       WHERE i.id = $1`,
      [req.params.id]
    );

    if (invoiceResult.rows.length === 0) {
      return res.status(404).json({ error: 'Invoice not found' });
    }

    const lineItemsResult = await pool.query(
      `SELECT ili.*, u.first_name, u.last_name
       FROM invoice_line_items ili
       LEFT JOIN users u ON ili.caregiver_id = u.id
       WHERE ili.invoice_id = $1
       ORDER BY ili.created_at`,
      [req.params.id]
    );

    res.json({
      ...invoiceResult.rows[0],
      lineItems: lineItemsResult.rows
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/invoices/generate-from-schedules - Enhanced invoice generation
app.post('/api/invoices/generate-from-schedules', verifyToken, requireAdmin, async (req, res) => {
  try {
    const { clientId, billingPeriodStart, billingPeriodEnd } = req.body;
    const invoiceId = uuidv4();
    const invoiceNumber = `INV-${Date.now()}`;

    // Get schedules for the billing period
    const schedulesResult = await pool.query(
      `SELECT s.*, u.first_name, u.last_name
       FROM schedules s
       JOIN users u ON s.caregiver_id = u.id
       WHERE s.client_id = $1
       AND s.is_active = true
       AND s.date >= $2
       AND s.date <= $3`,
      [clientId, billingPeriodStart, billingPeriodEnd]
    );

    let subtotal = 0;
    const lineItems = [];

    // Calculate billing from schedules
    for (const schedule of schedulesResult.rows) {
      const [startHour, startMin] = schedule.start_time.split(':');
      const [endHour, endMin] = schedule.end_time.split(':');
      
      const startMinutes = parseInt(startHour) * 60 + parseInt(startMin);
      const endMinutes = parseInt(endHour) * 60 + parseInt(endMin);
      const hours = ((endMinutes - startMinutes) / 60).toFixed(2);

      // Get caregiver rate
      const rateResult = await pool.query(
        `SELECT base_hourly_rate FROM caregiver_rates WHERE caregiver_id = $1`,
        [schedule.caregiver_id]
      );
      const rate = rateResult.rows[0]?.base_hourly_rate || 18.50;
      const amount = (hours * rate).toFixed(2);

      subtotal += parseFloat(amount);
      lineItems.push({
        caregiverId: schedule.caregiver_id,
        caregiver_name: `${schedule.first_name} ${schedule.last_name}`,
        description: `Care Services - ${schedule.date}`,
        hours: hours,
        rate: rate,
        amount: amount
      });
    }

    const tax = (subtotal * 0.08).toFixed(2);
    const total = (subtotal + parseFloat(tax)).toFixed(2);

    // Create invoice
    const invoiceResult = await pool.query(
      `INSERT INTO invoices (id, invoice_number, client_id, billing_period_start, billing_period_end, subtotal, tax, total, payment_due_date)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING *`,
      [invoiceId, invoiceNumber, clientId, billingPeriodStart, billingPeriodEnd, subtotal, tax, total, 
       new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)]
    );

    // Create line items
    for (const item of lineItems) {
      await pool.query(
        `INSERT INTO invoice_line_items (invoice_id, caregiver_id, description, hours, rate, amount)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [invoiceId, item.caregiverId, item.description, item.hours, item.rate, item.amount]
      );
    }

    await auditLog(req.user.id, 'CREATE', 'invoices', invoiceId, null, invoiceResult.rows[0]);
    res.status(201).json({
      ...invoiceResult.rows[0],
      lineItems: lineItems
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET /api/invoices/billing-summary - Revenue report
app.get('/api/invoices/billing-summary', verifyToken, requireAdmin, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT 
        COUNT(*) as total_invoices,
        SUM(CASE WHEN payment_status = 'paid' THEN total ELSE 0 END) as paid_amount,
        SUM(CASE WHEN payment_status = 'pending' THEN total ELSE 0 END) as pending_amount,
        SUM(CASE WHEN payment_status = 'overdue' THEN total ELSE 0 END) as overdue_amount,
        SUM(total) as total_billed,
        AVG(total) as average_invoice
       FROM invoices`
    );
    res.json(result.rows[0]);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ---- SERVICE PRICING ----

// GET /api/service-pricing - List all services
app.get('/api/service-pricing', verifyToken, async (req, res) => {
  try {
    const result = await pool.query(
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

    const result = await pool.query(
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

    const result = await pool.query(
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
    const result = await pool.query(
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
    const result = await pool.query(
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
      await pool.query(
        `UPDATE client_services SET is_primary = false WHERE client_id = $1`,
        [req.params.clientId]
      );
    }

    const result = await pool.query(
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
    const result = await pool.query(
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
    const result = await pool.query(
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
    const timeEntriesResult = await pool.query(
      `SELECT te.*, u.first_name, u.last_name, cr.base_hourly_rate
       FROM time_entries te
       JOIN users u ON te.caregiver_id = u.id
       LEFT JOIN caregiver_rates cr ON te.caregiver_id = cr.caregiver_id
       WHERE te.clock_in >= $1 AND te.clock_in <= $2
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
        date: entry.clock_in,
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
    const payrollResult = await pool.query(
      `INSERT INTO payroll (id, payroll_number, pay_period_start, pay_period_end, total_hours, gross_pay, taxes, net_pay, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING *`,
      [payrollId, payrollNumber, payPeriodStart, payPeriodEnd, 
       Object.values(caregiverPayroll).reduce((sum, p) => sum + p.totalHours, 0).toFixed(2),
       totalGrossPay, totalTaxes, totalNetPay, 'pending']
    );

    // Create line items for each caregiver
    for (const item of lineItems) {
      await pool.query(
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
    const result = await pool.query(
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
    const payrollResult = await pool.query(
      `SELECT * FROM payroll WHERE id = $1`,
      [req.params.payrollId]
    );

    if (payrollResult.rows.length === 0) {
      return res.status(404).json({ error: 'Payroll not found' });
    }

    const lineItemsResult = await pool.query(
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

    const result = await pool.query(
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
    const result = await pool.query(
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
    const result = await pool.query(
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

    const caregiverResult = await pool.query(
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
    const result = await pool.query(
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

    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET /api/reports/profitability - Profit margins and analysis (including expenses)
app.get('/api/reports/profitability', verifyToken, requireAdmin, async (req, res) => {
  try {
    const result = await pool.query(
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
    const result = await pool.query(
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
    const result = await pool.query(
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
    const result = await pool.query(
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
    const result = await pool.query(
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
    const summaryResult = await pool.query(
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

    const monthlyTrendResult = await pool.query(
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

    const topClientsResult = await pool.query(
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

    const topCaregiversResult = await pool.query(
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

    const expensesByCategory = await pool.query(
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
app.post('/api/absences', verifyToken, async (req, res) => {
  try {
    const { caregiverId, absenceDate, absenceType, reason, duration, status } = req.body;

    if (!caregiverId || !absenceDate || !absenceType) {
      return res.status(400).json({ error: 'caregiverId, absenceDate, and absenceType are required' });
    }

    const absenceId = uuidv4();
    const userRole = req.user.role;

    // If admin submitting for caregiver, set status to pending. If caregiver submitting own request, pending. If admin submitting on behalf, can be approved.
    const finalStatus = status || 'pending';

    const result = await pool.query(
      `INSERT INTO absences (id, caregiver_id, absence_date, absence_type, reason, duration_hours, status, submitted_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING *`,
      [absenceId, caregiverId, absenceDate, absenceType, reason || null, duration || null, finalStatus, req.user.id]
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
    const { status, absenceType, startDate, endDate } = req.query;

    let query = `
      SELECT a.*, u.first_name, u.last_name
      FROM absences a
      JOIN users u ON a.caregiver_id = u.id
      WHERE 1=1
    `;

    const params = [];
    let paramIndex = 1;

    if (status) {
      query += ` AND a.status = $${paramIndex}`;
      params.push(status);
      paramIndex++;
    }

    if (absenceType) {
      query += ` AND a.absence_type = $${paramIndex}`;
      params.push(absenceType);
      paramIndex++;
    }

    if (startDate) {
      query += ` AND a.absence_date >= $${paramIndex}`;
      params.push(startDate);
      paramIndex++;
    }

    if (endDate) {
      query += ` AND a.absence_date <= $${paramIndex}`;
      params.push(endDate);
      paramIndex++;
    }

    query += ` ORDER BY a.absence_date DESC`;

    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET /api/absences/caregiver/:caregiverId - Get caregiver absence history
app.get('/api/absences/caregiver/:caregiverId', verifyToken, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT * FROM absences 
       WHERE caregiver_id = $1 
       ORDER BY absence_date DESC`,
      [req.params.caregiverId]
    );
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// PATCH /api/absences/:id - Approve or deny absence
app.patch('/api/absences/:id', verifyToken, requireAdmin, async (req, res) => {
  try {
    const { status, approvedBy, notes } = req.body;

    if (!status) {
      return res.status(400).json({ error: 'status is required (approved or denied)' });
    }

    const result = await pool.query(
      `UPDATE absences SET 
        status = $1,
        approved_by = COALESCE($2, $3),
        approval_notes = $4,
        approval_date = CASE WHEN $1 IN ('approved', 'denied') THEN NOW() ELSE approval_date END,
        updated_at = NOW()
       WHERE id = $5
       RETURNING *`,
      [status, approvedBy, req.user.id, notes || null, req.params.id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Absence not found' });
    }

    await auditLog(req.user.id, 'UPDATE', 'absences', req.params.id, null, result.rows[0]);
    res.json(result.rows[0]);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// DELETE /api/absences/:id - Remove absence record
app.delete('/api/absences/:id', verifyToken, requireAdmin, async (req, res) => {
  try {
    const result = await pool.query(
      `DELETE FROM absences WHERE id = $1 RETURNING *`,
      [req.params.id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Absence not found' });
    }

    await auditLog(req.user.id, 'DELETE', 'absences', req.params.id, null, result.rows[0]);
    res.json({ message: 'Absence record deleted' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET /api/absences/summary - Absence statistics and trends
app.get('/api/absences/summary', verifyToken, requireAdmin, async (req, res) => {
  try {
    const summaryResult = await pool.query(
      `SELECT 
        COUNT(*) as total_absences,
        COUNT(CASE WHEN status = 'pending' THEN 1 END) as pending_approvals,
        COUNT(CASE WHEN status = 'approved' THEN 1 END) as approved_absences,
        COUNT(CASE WHEN status = 'denied' THEN 1 END) as denied_absences,
        COUNT(CASE WHEN absence_type = 'no_show' THEN 1 END) as no_shows,
        COUNT(CASE WHEN absence_type = 'call_out' THEN 1 END) as call_outs,
        COUNT(CASE WHEN absence_type = 'sick' THEN 1 END) as sick_leave,
        COUNT(CASE WHEN absence_type = 'personal' THEN 1 END) as personal_days,
        COUNT(CASE WHEN absence_type = 'pto' THEN 1 END) as pto
       FROM absences`
    );

    const caregiverStatsResult = await pool.query(
      `SELECT 
        u.id,
        u.first_name || ' ' || u.last_name as caregiver_name,
        COUNT(a.id) as total_absences,
        COUNT(CASE WHEN a.absence_type = 'no_show' THEN 1 END) as no_shows,
        COUNT(CASE WHEN a.absence_type = 'call_out' THEN 1 END) as call_outs,
        COUNT(CASE WHEN a.absence_type = 'sick' THEN 1 END) as sick_days,
        COUNT(CASE WHEN a.status = 'pending' THEN 1 END) as pending_approvals
       FROM users u
       LEFT JOIN absences a ON u.id = a.caregiver_id
       WHERE u.role = 'caregiver'
       GROUP BY u.id, u.first_name, u.last_name
       HAVING COUNT(a.id) > 0
       ORDER BY total_absences DESC`
    );

    const monthlyTrendResult = await pool.query(
      `SELECT 
        DATE_TRUNC('month', absence_date)::DATE as month,
        COUNT(*) as absence_count,
        COUNT(CASE WHEN status = 'approved' THEN 1 END) as approved_count
       FROM absences
       GROUP BY DATE_TRUNC('month', absence_date)
       ORDER BY month DESC
       LIMIT 6`
    );

    res.json({
      summary: summaryResult.rows[0],
      caregiverStats: caregiverStatsResult.rows,
      monthlyTrend: monthlyTrendResult.rows
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ---- CAREGIVER AVAILABILITY ----

// GET /api/caregivers/:caregiverId/availability - Get caregiver availability
app.get('/api/caregivers/:caregiverId/availability', verifyToken, async (req, res) => {
  try {
    let result = await pool.query(
      `SELECT * FROM caregiver_availability WHERE caregiver_id = $1`,
      [req.params.caregiverId]
    );

    if (result.rows.length === 0) {
      // Create default availability (Mon-Fri, 8am-5pm)
      await pool.query(
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
      result = await pool.query(
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

    const result = await pool.query(
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
    const result = await pool.query(
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
    const result = await pool.query(
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
    const result = await pool.query(
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

    const result = await pool.query(query, params);
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
    const result = await pool.query(
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

    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET /api/expenses/:id - Get expense details
app.get('/api/expenses/:id', verifyToken, requireAdmin, async (req, res) => {
  try {
    const result = await pool.query(
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

    const result = await pool.query(
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
    const result = await pool.query(
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
    const totalResult = await pool.query(
      `SELECT 
        SUM(amount) as total_expenses,
        COUNT(*) as expense_count,
        AVG(amount) as average_expense
       FROM expenses`
    );

    const categoryResult = await pool.query(
      `SELECT 
        category,
        COUNT(*) as count,
        SUM(amount) as total,
        AVG(amount) as average
       FROM expenses
       GROUP BY category
       ORDER BY total DESC`
    );

    const monthlyResult = await pool.query(
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

// ---- JOB APPLICATIONS ----

// GET /api/applications - Get all job applications
app.get('/api/applications', verifyToken, requireAdmin, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT * FROM job_applications ORDER BY created_at DESC`
    );
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET /api/applications/:id - Get specific application
app.get('/api/applications/:id', verifyToken, requireAdmin, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT * FROM job_applications WHERE id = $1`,
      [req.params.id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Application not found' });
    }

    res.json(result.rows[0]);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/applications - Submit job application
app.post('/api/applications', async (req, res) => {
  try {
    const {
      firstName, lastName, email, phone, dateOfBirth, address, city, state, zip,
      yearsOfExperience, previousEmployer1, jobTitle1, employmentDates1,
      previousEmployer2, jobTitle2, employmentDates2,
      previousEmployer3, jobTitle3, employmentDates3,
      hasCNA, hasLPN, hasRN, hasCPR, hasFirstAid
    } = req.body;

    if (!firstName || !lastName || !email || !phone) {
      return res.status(400).json({ error: 'Name, email, and phone are required' });
    }

    const appId = uuidv4();
    const result = await pool.query(
      `INSERT INTO job_applications (
        id, first_name, last_name, email, phone, date_of_birth, address, city, state, zip,
        years_of_experience, previous_employer_1, job_title_1, employment_dates_1,
        previous_employer_2, job_title_2, employment_dates_2,
        previous_employer_3, job_title_3, employment_dates_3,
        has_cna, has_lpn, has_rn, has_cpr, has_first_aid, status
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
        $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25, $26)
       RETURNING *`,
      [
        appId, firstName, lastName, email, phone, dateOfBirth, address, city, state, zip,
        yearsOfExperience, previousEmployer1, jobTitle1, employmentDates1,
        previousEmployer2, jobTitle2, employmentDates2,
        previousEmployer3, jobTitle3, employmentDates3,
        hasCNA, hasLPN, hasRN, hasCPR, hasFirstAid, 'applied'
      ]
    );

    res.status(201).json(result.rows[0]);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// PATCH /api/applications/:id - Update application status & notes
app.patch('/api/applications/:id', verifyToken, requireAdmin, async (req, res) => {
  try {
    const { status, interviewNotes } = req.body;

    const result = await pool.query(
      `UPDATE job_applications SET
        status = COALESCE($1, status),
        interview_notes = COALESCE($2, interview_notes),
        updated_at = NOW()
       WHERE id = $3
       RETURNING *`,
      [status, interviewNotes, req.params.id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Application not found' });
    }

    await auditLog(req.user.id, 'UPDATE', 'job_applications', req.params.id, null, result.rows[0]);
    res.json(result.rows[0]);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/applications/:id/hire - Convert applicant to caregiver
app.post('/api/applications/:id/hire', verifyToken, requireAdmin, async (req, res) => {
  try {
    const { interviewNotes } = req.body;

    // Get application details
    const appResult = await pool.query(
      `SELECT * FROM job_applications WHERE id = $1`,
      [req.params.id]
    );

    if (appResult.rows.length === 0) {
      return res.status(404).json({ error: 'Application not found' });
    }

    const app = appResult.rows[0];

    // Check if user already exists
    const existingUser = await pool.query(
      `SELECT id FROM users WHERE email = $1`,
      [app.email]
    );

    if (existingUser.rows.length > 0) {
      return res.status(400).json({ error: 'User with this email already exists' });
    }

    // Create caregiver account
    const userId = uuidv4();
    const hashedPassword = await bcrypt.hash('TempPassword123!', 10);

    const userResult = await pool.query(
      `INSERT INTO users (id, first_name, last_name, email, password, phone, date_of_birth, address, city, state, zip, role)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
       RETURNING id, first_name, last_name, email, role`,
      [
        userId, app.first_name, app.last_name, app.email, hashedPassword, app.phone,
        app.date_of_birth, app.address, app.city, app.state, app.zip, 'caregiver'
      ]
    );

    // Create caregiver profile
    await pool.query(
      `INSERT INTO caregiver_profiles (caregiver_id, notes)
       VALUES ($1, $2)`,
      [userId, `Hired from application. Experience: ${app.years_of_experience} years`]
    );

    // Create caregiver rates
    await pool.query(
      `INSERT INTO caregiver_rates (caregiver_id, base_hourly_rate)
       VALUES ($1, $2)`,
      [userId, 18.50]
    );

    // Create caregiver availability
    await pool.query(
      `INSERT INTO caregiver_availability (caregiver_id, status)
       VALUES ($1, $2)`,
      [userId, 'available']
    );

    // Add certifications if applicable
    if (app.has_cna) {
      await pool.query(
        `INSERT INTO caregiver_certifications (caregiver_id, certification_name)
         VALUES ($1, $2)`,
        [userId, 'CNA']
      );
    }
    if (app.has_lpn) {
      await pool.query(
        `INSERT INTO caregiver_certifications (caregiver_id, certification_name)
         VALUES ($1, $2)`,
        [userId, 'LPN']
      );
    }
    if (app.has_rn) {
      await pool.query(
        `INSERT INTO caregiver_certifications (caregiver_id, certification_name)
         VALUES ($1, $2)`,
        [userId, 'RN']
      );
    }
    if (app.has_cpr) {
      await pool.query(
        `INSERT INTO caregiver_certifications (caregiver_id, certification_name)
         VALUES ($1, $2)`,
        [userId, 'CPR']
      );
    }
    if (app.has_first_aid) {
      await pool.query(
        `INSERT INTO caregiver_certifications (caregiver_id, certification_name)
         VALUES ($1, $2)`,
        [userId, 'First Aid']
      );
    }

    // Update application status
    const updateResult = await pool.query(
      `UPDATE job_applications SET
        status = 'hired',
        interview_notes = $1,
        hired_user_id = $2,
        hired_date = NOW(),
        updated_at = NOW()
       WHERE id = $3
       RETURNING *`,
      [interviewNotes, userId, req.params.id]
    );

    await auditLog(req.user.id, 'HIRE', 'job_applications', req.params.id, null, updateResult.rows[0]);

    res.json({
      message: 'Applicant hired successfully',
      application: updateResult.rows[0],
      user: userResult.rows[0]
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// DELETE /api/applications/:id - Delete application
app.delete('/api/applications/:id', verifyToken, requireAdmin, async (req, res) => {
  try {
    const result = await pool.query(
      `DELETE FROM job_applications WHERE id = $1 RETURNING *`,
      [req.params.id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Application not found' });
    }

    await auditLog(req.user.id, 'DELETE', 'job_applications', req.params.id, null, result.rows[0]);
    res.json({ message: 'Application deleted' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET /api/applications/summary - Application statistics
app.get('/api/applications/summary', verifyToken, requireAdmin, async (req, res) => {
  try {
    const totalResult = await pool.query(
      `SELECT COUNT(*) as total FROM job_applications`
    );

    const statusResult = await pool.query(
      `SELECT status, COUNT(*) as count FROM job_applications GROUP BY status`
    );

    const certResult = await pool.query(
      `SELECT 
        COUNT(CASE WHEN has_cna THEN 1 END) as cna_count,
        COUNT(CASE WHEN has_lpn THEN 1 END) as lpn_count,
        COUNT(CASE WHEN has_rn THEN 1 END) as rn_count,
        COUNT(CASE WHEN has_cpr THEN 1 END) as cpr_count,
        COUNT(CASE WHEN has_first_aid THEN 1 END) as first_aid_count
       FROM job_applications WHERE status = 'hired'`
    );

    const hiredResult = await pool.query(
      `SELECT COUNT(*) as hired_count FROM job_applications WHERE status = 'hired'`
    );

    res.json({
      total: totalResult.rows[0].total,
      byStatus: statusResult.rows,
      hiredCertifications: certResult.rows[0],
      hiredCount: hiredResult.rows[0].hired_count
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ---- CARE PLANS ----

// GET /api/care-plans - Get all care plans
app.get('/api/care-plans', verifyToken, async (req, res) => {
  try {
    const result = await pool.query(
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
    const result = await pool.query(
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
    const result = await pool.query(
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

    const result = await pool.query(
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
    const result = await pool.query(
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
    const totalResult = await pool.query(
      `SELECT COUNT(*) as total_plans FROM care_plans`
    );

    const activeResult = await pool.query(
      `SELECT COUNT(*) as active_plans FROM care_plans 
       WHERE (start_date IS NULL OR start_date <= CURRENT_DATE)
       AND (end_date IS NULL OR end_date >= CURRENT_DATE)`
    );

    const byServiceType = await pool.query(
      `SELECT service_type, COUNT(*) as count
       FROM care_plans
       GROUP BY service_type
       ORDER BY count DESC`
    );

    const byClient = await pool.query(
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
    const result = await pool.query(
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
    const result = await pool.query(
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
    const result = await pool.query(
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

    const result = await pool.query(
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
    const result = await pool.query(
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
    const totalResult = await pool.query(
      `SELECT COUNT(*) as total FROM incident_reports`
    );

    const bySeverityResult = await pool.query(
      `SELECT severity, COUNT(*) as count FROM incident_reports GROUP BY severity ORDER BY 
       CASE severity WHEN 'critical' THEN 1 WHEN 'severe' THEN 2 WHEN 'moderate' THEN 3 WHEN 'minor' THEN 4 END`
    );

    const byTypeResult = await pool.query(
      `SELECT incident_type, COUNT(*) as count FROM incident_reports GROUP BY incident_type ORDER BY count DESC`
    );

    const followUpResult = await pool.query(
      `SELECT COUNT(*) as pending_followup FROM incident_reports WHERE follow_up_required = true`
    );

    const monthlyResult = await pool.query(
      `SELECT 
        DATE_TRUNC('month', incident_date)::DATE as month,
        COUNT(*) as count,
        COUNT(CASE WHEN severity IN ('critical', 'severe') THEN 1 END) as serious_count
       FROM incident_reports
       GROUP BY DATE_TRUNC('month', incident_date)
       ORDER BY month DESC
       LIMIT 12`
    );

    const byClientResult = await pool.query(
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
    const result = await pool.query(
      `SELECT pr.*, c.first_name || ' ' || c.last_name as caregiver_name,
              cl.first_name || ' ' || cl.last_name as client_name
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
    const result = await pool.query(
      `SELECT pr.*, cl.first_name || ' ' || cl.last_name as client_name
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
    const result = await pool.query(
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
    const result = await pool.query(
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
    const result = await pool.query(
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
    const result = await pool.query(
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
    const result = await pool.query(
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
    const result = await pool.query(
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
    const result = await pool.query(
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
    const result = await pool.query(
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
    const result = await pool.query(
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
    const result = await pool.query(
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
    const result = await pool.query(
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
    const expiredBgResult = await pool.query(
      `SELECT COUNT(*) as expired_bg FROM background_checks WHERE expiration_date < CURRENT_DATE`
    );

    const expiredTrainingResult = await pool.query(
      `SELECT COUNT(*) as expired_training FROM training_records WHERE expiration_date < CURRENT_DATE AND status != 'expired'`
    );

    const trainingByTypeResult = await pool.query(
      `SELECT training_type, COUNT(*) as count FROM training_records WHERE status = 'completed' GROUP BY training_type ORDER BY count DESC`
    );

    const bgStatusResult = await pool.query(
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
    const result = await pool.query(
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
    const result = await pool.query(
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

    const result = await pool.query(
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
    const result = await pool.query(
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
    const totalResult = await pool.query(
      `SELECT COUNT(*) as total FROM referral_sources`
    );

    const byTypeResult = await pool.query(
      `SELECT type, COUNT(*) as count FROM referral_sources GROUP BY type ORDER BY count DESC`
    );

    const clientsBySourceResult = await pool.query(
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


// ---- REPORTS (POST ENDPOINTS) ----

// POST /api/reports/overview
app.post('/api/reports/overview', verifyToken, requireAdmin, async (req, res) => {
  try {
    const { startDate, endDate } = req.body;
    const summary = await pool.query(
      `SELECT 
        COALESCE(SUM(duration_minutes) / 60.0, 0) as totalHours,
        COALESCE((SELECT SUM(total) FROM invoices WHERE CAST(created_at AS DATE) >= $1 AND CAST(created_at AS DATE) <= $2), 0) as totalRevenue,
        (SELECT COUNT(*) FROM schedules WHERE date >= $1 AND date <= $2 AND is_active = true) as totalShifts,
        0 as avgSatisfaction
       FROM time_entries
       WHERE is_complete = true AND CAST(start_time AS DATE) >= $1 AND CAST(start_time AS DATE) <= $2`,
      [startDate, endDate]
    );
    const topCaregivers = await pool.query(
      `SELECT u.id, u.first_name, u.last_name,
              COALESCE(SUM(te.duration_minutes) / 60.0, 0) as total_hours,
              COUNT(DISTINCT te.client_id) as clients_served,
              COALESCE(SUM(i.total), 0) as total_revenue,
              COALESCE(AVG(pr.rating), 0) as avg_satisfaction
       FROM users u
       LEFT JOIN time_entries te ON u.id = te.caregiver_id AND te.is_complete = true
         AND CAST(te.start_time AS DATE) >= $1 AND CAST(te.start_time AS DATE) <= $2
       LEFT JOIN invoices i ON te.client_id = i.client_id AND CAST(i.created_at AS DATE) >= $1 AND CAST(i.created_at AS DATE) <= $2
       LEFT JOIN performance_reviews pr ON u.id = pr.caregiver_id AND CAST(pr.review_date AS DATE) >= $1 AND CAST(pr.review_date AS DATE) <= $2
       WHERE u.role = 'caregiver'
       GROUP BY u.id, u.first_name, u.last_name
       ORDER BY total_hours DESC LIMIT 5`,
      [startDate, endDate]
    );
    const topClients = await pool.query(
      `SELECT c.id, c.first_name, c.last_name, c.service_type,
              COALESCE(SUM(i.total), 0) as total_cost,
              COALESCE(SUM(te.duration_minutes)::numeric / 60.0, 0) as total_hours,
              COUNT(DISTINCT te.caregiver_id) as caregiver_count
       FROM clients c
       LEFT JOIN invoices i ON c.id = i.client_id AND CAST(i.created_at AS DATE) >= $1 AND CAST(i.created_at AS DATE) <= $2
       LEFT JOIN time_entries te ON c.id = te.client_id AND te.is_complete = true AND CAST(te.start_time AS DATE) >= $1 AND CAST(te.start_time AS DATE) <= $2
       GROUP BY c.id, c.first_name, c.last_name, c.service_type
       ORDER BY total_cost DESC LIMIT 5`,
      [startDate, endDate]
    );
    res.json({
      summary: {
        totalHours: parseFloat(summary.rows[0].totalHours) || 0,
        totalRevenue: parseFloat(summary.rows[0].totalRevenue) || 0,
        totalShifts: parseInt(summary.rows[0].totalShifts) || 0,
        avgSatisfaction: parseFloat(summary.rows[0].avgSatisfaction) || 0
      },
      topCaregivers: topCaregivers.rows || [],
      topClients: topClients.rows || []
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/reports/hours
app.post('/api/reports/hours', verifyToken, requireAdmin, async (req, res) => {
  try {
    const { startDate, endDate } = req.body;
    const hoursByWeek = await pool.query(
      `SELECT TO_CHAR(DATE_TRUNC('week', start_time), 'YYYY-WW') as week, SUM(duration_minutes) / 60.0 as hours
       FROM time_entries WHERE is_complete = true AND CAST(start_time AS DATE) >= $1 AND CAST(start_time AS DATE) <= $2
       GROUP BY DATE_TRUNC('week', start_time) ORDER BY DATE_TRUNC('week', start_time) DESC`,
      [startDate, endDate]
    );
    const hoursByType = await pool.query(
      `SELECT COALESCE(cp.service_type, 'Unassigned') as service_type,
              SUM(te.duration_minutes) / 60.0 as hours,
              ROUND(SUM(te.duration_minutes) * 100.0 / NULLIF((SELECT SUM(duration_minutes) FROM time_entries WHERE is_complete = true AND CAST(start_time AS DATE) >= $1 AND CAST(start_time AS DATE) <= $2), 0), 1) as percentage
       FROM time_entries te LEFT JOIN clients c ON te.client_id = c.id
       LEFT JOIN care_plans cp ON c.id = cp.client_id
       WHERE te.is_complete = true AND CAST(te.start_time AS DATE) >= $1 AND CAST(te.start_time AS DATE) <= $2
       GROUP BY COALESCE(cp.service_type, 'Unassigned') ORDER BY hours DESC`,
      [startDate, endDate]
    );
    const caregiverBreakdown = await pool.query(
      `SELECT u.id, u.first_name, u.last_name,
              COALESCE(SUM(te.duration_minutes) / 60.0, 0) as total_hours,
              COALESCE(SUM(CASE WHEN te.duration_minutes / 60.0 <= 40 THEN te.duration_minutes / 60.0 ELSE 40 END), 0) as regular_hours,
              COALESCE(SUM(CASE WHEN te.duration_minutes / 60.0 > 40 THEN te.duration_minutes / 60.0 - 40 ELSE 0 END), 0) as overtime_hours
       FROM users u LEFT JOIN time_entries te ON u.id = te.caregiver_id AND te.is_complete = true
         AND CAST(te.start_time AS DATE) >= $1 AND CAST(te.start_time AS DATE) <= $2
       WHERE u.role = 'caregiver' GROUP BY u.id, u.first_name, u.last_name ORDER BY total_hours DESC`,
      [startDate, endDate]
    );
    res.json({ hoursByWeek: hoursByWeek.rows || [], hoursByType: hoursByType.rows || [], caregiverBreakdown: caregiverBreakdown.rows || [] });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/reports/performance
app.post('/api/reports/performance', verifyToken, requireAdmin, async (req, res) => {
  try {
    const { startDate, endDate } = req.body;
    const performance = await pool.query(
      `SELECT u.id, u.first_name, u.last_name,
              COUNT(DISTINCT ir.id) as incident_count,
              COUNT(DISTINCT tr.id) as training_hours,
                   ELSE 'Needs Improvement' END as status
       FROM users u
         AND CAST(pr.review_date AS DATE) >= $1 AND CAST(pr.review_date AS DATE) <= $2
       LEFT JOIN incident_reports ir ON u.id = ir.caregiver_id 
         AND CAST(ir.incident_date AS DATE) >= $1 AND CAST(ir.incident_date AS DATE) <= $2
       LEFT JOIN training_records tr ON u.id = tr.caregiver_id 
         AND CAST(tr.completion_date AS DATE) >= $1 AND CAST(tr.completion_date AS DATE) <= $2
       WHERE u.role = 'caregiver' GROUP BY u.id, u.first_name, u.last_name ORDER BY avg_rating DESC`,
      [startDate, endDate]
    );
    res.json({ performance: performance.rows || [] });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/reports/satisfaction
app.post('/api/reports/satisfaction', verifyToken, requireAdmin, async (req, res) => {
  try {
    const { startDate, endDate } = req.body;
    const satisfaction = await pool.query(
      `SELECT u.id, u.first_name, u.last_name,
              COUNT(pr.id) as review_count,
              COUNT(CASE WHEN pr.overall_assessment = 'excellent' THEN 1 END) as excellent_count,
              COUNT(CASE WHEN pr.overall_assessment = 'satisfactory' THEN 1 END) as satisfactory_count,
              COUNT(CASE WHEN pr.overall_assessment = 'needs_improvement' THEN 1 END) as needs_improvement_count
       FROM users u
         AND CAST(pr.review_date AS DATE) >= $1 AND CAST(pr.review_date AS DATE) <= $2
       WHERE u.role = 'caregiver' GROUP BY u.id, u.first_name, u.last_name ORDER BY avg_rating DESC`,
      [startDate, endDate]
    );
    res.json({ satisfaction: satisfaction.rows || [] });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/reports/revenue
app.post('/api/reports/revenue', verifyToken, requireAdmin, async (req, res) => {
  try {
    const { startDate, endDate } = req.body;
    const byClient = await pool.query(
      `SELECT c.id, c.first_name || ' ' || c.last_name as client_name,
              COALESCE(SUM(i.total), 0) as total_revenue,
              COUNT(DISTINCT i.id) as invoice_count
       FROM invoices i JOIN clients c ON i.client_id = c.id
       WHERE CAST(i.created_at AS DATE) >= $1 AND CAST(i.created_at AS DATE) <= $2
       GROUP BY c.id, c.first_name, c.last_name ORDER BY total_revenue DESC`,
      [startDate, endDate]
    );
    const byService = await pool.query(
      `SELECT COALESCE(cp.service_type, 'Unassigned') as service_type,
              COALESCE(SUM(i.total), 0) as total_revenue,
              COUNT(DISTINCT i.id) as invoice_count
       FROM invoices i LEFT JOIN clients c ON i.client_id = c.id
       LEFT JOIN care_plans cp ON c.id = cp.client_id
       WHERE CAST(i.created_at AS DATE) >= $1 AND CAST(i.created_at AS DATE) <= $2
       GROUP BY COALESCE(cp.service_type, 'Unassigned') ORDER BY total_revenue DESC`,
      [startDate, endDate]
    );
    const byMonth = await pool.query(
      `SELECT DATE_TRUNC('month', created_at)::DATE as month,
              COALESCE(SUM(total), 0) as total_revenue,
              COUNT(DISTINCT id) as invoice_count
       FROM invoices WHERE CAST(created_at AS DATE) >= $1 AND CAST(created_at AS DATE) <= $2
       GROUP BY DATE_TRUNC('month', created_at) ORDER BY month DESC`,
      [startDate, endDate]
    );
    res.json({
      byClient: byClient.rows || [],
      byService: byService.rows || [],
      byMonth: byMonth.rows || []
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ---- NOTIFICATIONS ----

// GET /api/notifications - Get notifications for user
app.get('/api/notifications', verifyToken, async (req, res) => {
  try {
    const result = await pool.query(
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
    let result = await pool.query(
      `SELECT * FROM notification_settings WHERE user_id = $1`,
      [req.user.id]
    );

    if (result.rows.length === 0) {
      // Create default settings
      await pool.query(
        `INSERT INTO notification_settings (user_id, email_enabled, schedule_alerts, payroll_alerts, absence_alerts, payment_alerts)
         VALUES ($1, true, true, true, true, true)`,
        [req.user.id]
      );
      result = await pool.query(
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

    const result = await pool.query(
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
    const result = await pool.query(
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
      const result = await pool.query(
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
    const result = await pool.query(
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
    const result = await pool.query(
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
    const result = await pool.query(
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

    const result = await pool.query(
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

// GET /api/schedules/:caregiverId - Get schedules for a specific caregiver
app.get('/api/schedules/:caregiverId', verifyToken, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT * FROM schedules WHERE caregiver_id = $1 AND is_active = true ORDER BY day_of_week, date, start_time`,
      [req.params.caregiverId]
    );
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET /api/schedules-all - Get all schedules for calendar view
app.get('/api/schedules-all', verifyToken, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT s.*, u.first_name as caregiver_first_name, u.last_name as caregiver_last_name,
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

// POST /api/schedules - Create new schedule
app.post('/api/schedules', verifyToken, async (req, res) => {
  try {
    const { caregiverId, clientId, scheduleType, dayOfWeek, date, startTime, endTime, notes } = req.body;
    
    const scheduleId = uuidv4();
    const result = await pool.query(
      `INSERT INTO schedules (id, caregiver_id, client_id, schedule_type, day_of_week, date, start_time, end_time, notes)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING *`,
      [scheduleId, caregiverId, clientId, scheduleType, dayOfWeek || null, date || null, startTime, endTime, notes || null]
    );

    await auditLog(req.user.id, 'CREATE', 'schedules', scheduleId, null, result.rows[0]);
    res.status(201).json(result.rows[0]);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// DELETE /api/schedules/:scheduleId - Delete a schedule
app.delete('/api/schedules/:scheduleId', verifyToken, async (req, res) => {
  try {
    const result = await pool.query(
      `UPDATE schedules SET is_active = false, updated_at = NOW() WHERE id = $1 RETURNING *`,
      [req.params.scheduleId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Schedule not found' });
    }

    await auditLog(req.user.id, 'DELETE', 'schedules', req.params.scheduleId, null, result.rows[0]);
    res.json({ message: 'Schedule deleted' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ---- CAREGIVER PROFILES ----

// GET /api/caregiver-profile/:caregiverId
app.get('/api/caregiver-profile/:caregiverId', verifyToken, async (req, res) => {
  try {
    let result = await pool.query(
      `SELECT * FROM caregiver_profiles WHERE caregiver_id = $1`,
      [req.params.caregiverId]
    );

    if (result.rows.length === 0) {
      // Create default profile
      await pool.query(
        `INSERT INTO caregiver_profiles (caregiver_id) VALUES ($1)`,
        [req.params.caregiverId]
      );
      result = await pool.query(
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

    const result = await pool.query(
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
    const result = await pool.query(
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

    const result = await pool.query(
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
    const result = await pool.query(
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
    const result = await pool.query(
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
// Error handling middleware
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'Internal server error' });
});

// Start server
app.listen(port, () => {
  console.log(`🚀 Chippewa Valley Home Care API running on port ${port}`);
  console.log(`📊 Admin Dashboard: ${process.env.FRONTEND_URL || 'http://localhost:3000'}`);
});