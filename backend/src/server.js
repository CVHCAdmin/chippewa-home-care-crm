// server.js - HomeCare CRM API
// Pure setup and route mounting — all logic lives in /routes
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');
const rateLimit = require('express-rate-limit');
const auditLogger = require('./middleware/auditLogger');
const dotenv = require('dotenv');
const db = require('./db');

dotenv.config();

// ============ STARTUP VALIDATION ============
const REQUIRED_ENV = ['JWT_SECRET', 'DATABASE_URL'];
const MISSING = REQUIRED_ENV.filter(k => !process.env[k]);
if (MISSING.length) {
  console.error(`\n❌ FATAL: Missing required environment variables:\n  ${MISSING.join('\n  ')}\n`);
  process.exit(1);
}

const WARN_IF_MISSING = ['ENCRYPTION_KEY', 'STRIPE_SECRET_KEY', 'TWILIO_ACCOUNT_SID', 'VAPID_PUBLIC_KEY', 'VAPID_PRIVATE_KEY', 'FRONTEND_URL', 'ALLOWED_ORIGINS'];
WARN_IF_MISSING.filter(k => !process.env[k]).forEach(k => console.warn(`⚠️  Optional env var not set: ${k}`));

const app = express();
app.set('trust proxy', 1);
const port = process.env.PORT || 5000;

// ============ SECURITY MIDDLEWARE ============
app.use(helmet());
app.use(compression());

// CORS — CVHC defaults + ALLOWED_ORIGINS env var for additional domains (white-labeling)
// To add a new domain: set ALLOWED_ORIGINS=https://newclient.netlify.app in Render env vars
app.use(cors({
  origin: (origin, callback) => {
    const defaultOrigins = [
      'https://cvhc-crm.netlify.app',
      'https://chippewavalleyhomecare.com',
      'https://www.chippewavalleyhomecare.com',
      process.env.FRONTEND_URL,
      'http://localhost:3000',
      'http://localhost:5173',
      'https://localhost',      // Capacitor Android APK origin
      'capacitor://localhost',   // Capacitor iOS origin
    ].filter(Boolean);

    const extraOrigins = (process.env.ALLOWED_ORIGINS || '')
      .split(',').map(o => o.trim()).filter(Boolean);

    const allowed = [...new Set([...defaultOrigins, ...extraOrigins])];

    if (!origin || allowed.includes(origin)) return callback(null, true);
    callback(new Error(`CORS: origin ${origin} not allowed. Add it to ALLOWED_ORIGINS env var.`));
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

// Rate limiters
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, max: 500, standardHeaders: true, legacyHeaders: false,
  skip: (req) => req.path.includes('/api/messages/unread-count') || req.path.includes('/api/push/unread-count')
});
app.use(limiter);
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ limit: '10mb', extended: true }));

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, max: 5,
  message: { error: 'Too many login attempts. Try again in 15 minutes.' }
});
app.use('/api/auth/login', authLimiter);
app.use('/api/auth/register-caregiver', authLimiter);
app.use('/api/auth/register-admin', authLimiter);

app.use(auditLogger(db.pool));

// ============ HEALTH CHECK ============
app.get('/health', (req, res) => res.json({ status: 'ok', timestamp: new Date() }));

// ============ ROUTE IMPORTS ============
const { verifyToken } = require('./middleware/shared');

// Core resources
const authRoutes         = require('./routes/authRoutes');
const caregiverRoutes    = require('./routes/caregiverRoutes');
const clientsRoutes      = require('./routes/clientsRoutes');
const timeTrackingRoutes = require('./routes/timeTrackingRoutes');
const dashboardRoutes    = require('./routes/dashboardRoutes');
const schedulingRoutes   = require('./routes/schedulingRoutes');
const billingRoutes      = require('./routes/billingRoutes');

// Split from miscRoutes — each focused domain
const referralRoutes     = require('./routes/referralRoutes');
const notificationRoutes = require('./routes/notificationRoutes');
const prospectRoutes     = require('./routes/prospectRoutes');
const pricingRoutes      = require('./routes/pricingRoutes');
const absenceRoutes      = require('./routes/absenceRoutes');
const expenseRoutes      = require('./routes/expenseRoutes');
const clinicalRoutes     = require('./routes/clinicalRoutes');

// ============ ROUTE MOUNTING ============

// Auth (routes handle their own token requirements)
app.use('/api/auth', authRoutes);

// Core resources
app.use('/api/caregivers',   verifyToken, caregiverRoutes);
app.use('/api/clients',      verifyToken, clientsRoutes);
app.use('/api/time-entries', verifyToken, timeTrackingRoutes);
app.use('/api/dashboard',    verifyToken, dashboardRoutes);
app.use('/api/scheduling',   verifyToken, schedulingRoutes);
app.use('/api/billing',      verifyToken, billingRoutes);

// Domain-focused routes (mounted at /api, each defines its own paths)
app.use('/api', referralRoutes);
app.use('/api', notificationRoutes);
app.use('/api', prospectRoutes);
app.use('/api', pricingRoutes);
app.use('/api', absenceRoutes);
app.use('/api', expenseRoutes);
app.use('/api', clinicalRoutes);

// Dedicated route files (mounted at their own prefixes — no conflicts)
app.use('/api/reports',           verifyToken, require('./routes/reports'));
app.use('/api/payroll',           verifyToken, require('./routes/payrollRoutes'));
app.use('/api/audit-logs',        verifyToken, require('./routes/auditLogs'));
app.use('/api/users',             verifyToken, require('./routes/users'));
app.use('/api/claims',            verifyToken, require('./routes/claimsRoutes'));
app.use('/api/stripe',                         require('./routes/stripeRoutes'));
app.use('/api/applications', (req, res, next) => {
  // POST / is public (job application form from website)
  // Everything else requires admin auth
  if (req.method === 'POST' && req.path === '/') return next();
  return verifyToken(req, res, next);
}, require('./routes/applicationsRoutes'));
app.use('/api/schedules',         verifyToken, require('./routes/schedulesRoutes'));
app.use('/api/sms',               verifyToken, require('./routes/smsRoutes'));
app.use('/api/open-shifts',       verifyToken, require('./routes/openShiftsRoutes'));
app.use('/api/medications',       verifyToken, require('./routes/medicationsRoutes'));
app.use('/api/documents',         verifyToken, require('./routes/documentsRoutes'));
app.use('/api/adl',               verifyToken, require('./routes/adlRoutes'));
app.use('/api/background-checks', verifyToken, require('./routes/backgroundChecksRoutes'));
app.use('/api/family-portal', (req, res, next) => {
  // Defense-in-depth: admin sub-routes require a valid admin token even though
  // familyPortalRoutes has its own auth. Belt AND suspenders.
  if (req.path.startsWith('/admin')) return verifyToken(req, res, next);
  next();
}, require('./routes/familyPortalRoutes'));
app.use('/api/client-portal', (req, res, next) => {
  // Public routes: /login, /set-password — no token needed
  // Portal routes: /portal/* — clientAuth middleware inside the router handles it
  // Admin routes: /admin/* — require valid admin token here as belt-and-suspenders
  if (req.path.startsWith('/admin')) return verifyToken(req, res, next);
  next();
}, require('./routes/clientPortalRoutes'));
app.use('/api/shift-swaps',       verifyToken, require('./routes/shiftSwapsRoutes'));
app.use('/api/alerts',            verifyToken, require('./routes/alertsRoutes'));
app.use('/api/route-optimizer',   verifyToken, require('./routes/routeOptimizerRoutes'));
app.use('/api/matching',          verifyToken, require('./routes/matchingRoutes'));
app.use('/api/emergency',         verifyToken, require('./routes/emergencyRoutes'));
app.use('/api/messages',          verifyToken, require('./routes/messageRoutes'));
app.use('/api/remittance',        verifyToken, require('./routes/remittanceRoutes'));
app.use('/api/sandata',           verifyToken, require('./routes/sandataRoutes'));
app.use('/api/authorizations',    verifyToken, require('./routes/authorizationRoutes'));
app.use('/api/failsafe',          verifyToken, require('./routes/failsafeRoutes'));
app.use('/api/edi',               verifyToken, require('./routes/ediRoutes'));
app.use('/api/gusto',             verifyToken, require('./routes/gustoRoutes'));
app.use('/api/optimizer',         verifyToken, require('./routes/optimizerRoutes'));
app.use('/api/roster-optimizer',  verifyToken, require('./routes/rosterOptimizerRoutes'));
app.use('/api/push',              verifyToken, require('./routes/pushNotificationRoutes').router);

// ── EXPLICIT ROUTES (Express path-boundary workarounds) ──────────────────────

// /api/schedules-all — router.get('-all') can't match this path due to Express
// path segment rules, so these live directly on the app instance.
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
  } catch (error) { res.status(500).json({ error: error.message }); }
});

app.put('/api/schedules-all/:scheduleId', verifyToken, async (req, res) => {
  try {
    const { scheduleId } = req.params;
    const { clientId, dayOfWeek, date, startTime, endTime, notes, frequency, effectiveDate, anchorDate } = req.body;
    if (startTime && endTime && startTime >= endTime) return res.status(400).json({ error: 'End time must be after start time' });
    const result = await db.query(
      `UPDATE schedules SET client_id=COALESCE($1,client_id), day_of_week=$2, date=$3,
        start_time=COALESCE($4,start_time), end_time=COALESCE($5,end_time), notes=$6,
        frequency=COALESCE($7,frequency), effective_date=COALESCE($8,effective_date),
        anchor_date=COALESCE($9,anchor_date), updated_at=NOW()
       WHERE id=$10 AND is_active=true RETURNING *`,
      [clientId, dayOfWeek !== undefined ? dayOfWeek : null, date || null, startTime, endTime,
       notes || null, frequency || 'weekly', effectiveDate || null, anchorDate || null, scheduleId]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Schedule not found' });
    res.json(result.rows[0]);
  } catch (error) { res.status(500).json({ error: error.message }); }
});

// /api/payroll-periods — path has a hyphen so can't live inside payrollRoutes
// (which is mounted at /api/payroll). Alias to /api/payroll/periods.
app.get('/api/payroll-periods', verifyToken, async (req, res) => {
  try {
    res.json((await db.query(`SELECT DISTINCT pay_period_start, pay_period_end FROM payroll ORDER BY pay_period_end DESC`)).rows);
  } catch (error) { res.status(500).json({ error: error.message }); }
});

// ============ GLOBAL ERROR HANDLER ============
app.use((err, req, res, next) => {
  const status = err.status || err.statusCode || 500;
  console.error(`[ERROR] ${req.method} ${req.path}`, {
    status, message: err.message,
    stack: process.env.NODE_ENV === 'development' ? err.stack : undefined,
  });
  res.status(status).json({
    error: status < 500 ? err.message : 'An unexpected error occurred. Please try again.',
  });
});

// ============ START SERVER ============
const agencyName = process.env.AGENCY_NAME || 'HomeCare CRM';
app.listen(port, () => {
  console.log(`🚀 ${agencyName} API running on port ${port}`);
  console.log(`📊 Dashboard: ${process.env.FRONTEND_URL || 'http://localhost:3000'}`);
  if (!process.env.ALLOWED_ORIGINS) console.warn('⚠️  ALLOWED_ORIGINS not set — CORS will block all browser requests in production!');
});
