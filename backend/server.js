// server.js - Chippewa Valley Home Care API
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');
const rateLimit = require('express-rate-limit');
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
    const { firstName, lastName, phone, email, medicalConditions, allergies, medications } = req.body;
    const result = await pool.query(
      `UPDATE clients SET first_name = $1, last_name = $2, phone = $3, email = $4, 
       medical_conditions = $5, allergies = $6, medications = $7, updated_at = NOW()
       WHERE id = $8 RETURNING *`,
      [firstName, lastName, phone, email, medicalConditions, allergies, medications, req.params.id]
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

// ---- TIME TRACKING WITH GPS ----
app.post('/api/time-entries/clock-in', verifyToken, async (req, res) => {
  try {
    const { clientId, assignmentId, latitude, longitude } = req.body;
    const entryId = uuidv4();

    const result = await pool.query(
      `INSERT INTO time_entries (id, caregiver_id, client_id, assignment_id, start_time, clock_in_location)
       VALUES ($1, $2, $3, $4, NOW(), $5)
       RETURNING *`,
      [entryId, req.user.id, clientId, assignmentId, JSON.stringify({ lat: latitude, lng: longitude })]
    );

    res.status(201).json(result.rows[0]);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/time-entries/:id/clock-out', verifyToken, async (req, res) => {
  try {
    const { latitude, longitude } = req.body;

    const result = await pool.query(
      `UPDATE time_entries SET 
       end_time = NOW(), 
       clock_out_location = $1,
       duration_minutes = EXTRACT(EPOCH FROM (NOW() - start_time))/60,
       is_complete = true,
       updated_at = NOW()
       WHERE id = $2 AND caregiver_id = $3
       RETURNING *`,
      [JSON.stringify({ lat: latitude, lng: longitude }), req.params.id, req.user.id]
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

// GPS tracking endpoint (called periodically during shift)
app.post('/api/gps-tracking', verifyToken, async (req, res) => {
  try {
    const { timeEntryId, latitude, longitude, accuracy, speed, heading } = req.body;

    await pool.query(
      `INSERT INTO gps_tracking (caregiver_id, time_entry_id, latitude, longitude, accuracy, speed, heading)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [req.user.id, timeEntryId, latitude, longitude, accuracy, speed, heading]
    );

    res.json({ success: true });
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

// ---- NOTIFICATIONS ----
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

// ---- HEALTH CHECK ----
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date() });
});

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
