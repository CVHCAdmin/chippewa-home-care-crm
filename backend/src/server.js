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
    await pool.query(
      `INSERT INTO audit_logs (user_id, action, table_name, record_id, old_data, new_data, timestamp)
       VALUES ($1, $2, $3, $4, $5, $6, NOW())`,
      [userId || '00000000-0000-0000-0000-000000000000', action, tableName, recordId, JSON.stringify(oldData), JSON.stringify(newData)]
    );
  } catch (error) {
    console.error('Audit log error:', error);
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

// NOTIFICATIONS
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