// server.js - HomeCare CRM API
// Refactored: all route logic lives in /routes — this file is setup only
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');
const rateLimit = require('express-rate-limit');
const auditLogger = require('./middleware/auditLogger');
const dotenv = require('dotenv');
const db = require('./db');

// Load environment variables
dotenv.config();

// ============ STARTUP VALIDATION ============
const REQUIRED_ENV = ['JWT_SECRET', 'DATABASE_URL'];
const MISSING = REQUIRED_ENV.filter(k => !process.env[k]);
if (MISSING.length) {
  console.error(`\n❌ FATAL: Missing required environment variables:\n  ${MISSING.join('\n  ')}\n`);
  console.error('Copy .env.example to .env and fill in all required values.\n');
  process.exit(1);
}

const WARN_IF_MISSING = [
  'ENCRYPTION_KEY', 'STRIPE_SECRET_KEY', 'TWILIO_ACCOUNT_SID',
  'VAPID_PUBLIC_KEY', 'VAPID_PRIVATE_KEY', 'FRONTEND_URL'
];
WARN_IF_MISSING.filter(k => !process.env[k]).forEach(k =>
  console.warn(`⚠️  Optional env var not set: ${k}`)
);

const app = express();
app.set('trust proxy', 1);
const port = process.env.PORT || 5000;

// ============ SECURITY MIDDLEWARE ============
app.use(helmet());
app.use(compression());
app.use(cors({
  origin: (origin, callback) => {
    const envOrigins = process.env.ALLOWED_ORIGINS
      ? process.env.ALLOWED_ORIGINS.split(',').map(o => o.trim())
      : [];
    const defaultOrigins = [
      'https://cvhc-crm.netlify.app',
      'https://chippewavalleyhomecare.com',
      'https://www.chippewavalleyhomecare.com',
      process.env.FRONTEND_URL || 'http://localhost:3000',
    ];
    const allowed = [...new Set([...defaultOrigins, ...envOrigins])];
    if (!origin || allowed.includes(origin)) return callback(null, true);
    callback(new Error(`CORS: origin ${origin} not allowed`));
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

// Global rate limiter
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 500,
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) =>
    req.path.includes('/api/messages/unread-count') ||
    req.path.includes('/api/push/unread-count')
});
app.use(limiter);

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ limit: '10mb', extended: true }));

// Auth-specific rate limiter (brute-force protection)
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  message: { error: 'Too many login attempts. Try again in 15 minutes.' }
});
app.use('/api/auth/login', authLimiter);
app.use('/api/auth/register-caregiver', authLimiter);
app.use('/api/auth/register-admin', authLimiter);

// ============ AUDIT LOGGING ============
app.use(auditLogger(db.pool));

// ============ HEALTH CHECK ============
app.get('/health', (req, res) => res.json({ status: 'ok', timestamp: new Date() }));

// ============ ROUTE IMPORTS ============
const { verifyToken } = require('./middleware/shared');

// Newly extracted route files (previously inline in server.js)
const authRoutes       = require('./routes/authRoutes');
const caregiverRoutes  = require('./routes/caregiverRoutes');
const clientsRoutes    = require('./routes/clientsRoutes');
const timeTrackingRoutes = require('./routes/timeTrackingRoutes');
const dashboardRoutes  = require('./routes/dashboardRoutes');
const schedulingRoutes = require('./routes/schedulingRoutes');
const miscRoutes       = require('./routes/miscRoutes');  // referral sources, notifications, prospects,
                                                          // service pricing, care types, payroll inline,
                                                          // absences, expenses, care plans, incidents,
                                                          // performance reviews, compliance, caregiver profiles,
                                                          // caregiver rates, user admin, schedules-enhanced

// Pre-existing route files
const billingRoutes    = require('./routes/billingRoutes');

// ============ ROUTE MOUNTING ============

// Auth (no global verifyToken — auth routes handle their own middleware)
app.use('/api/auth', authRoutes);

// Core resources (all require token)
app.use('/api/caregivers',    verifyToken, caregiverRoutes);
app.use('/api/clients',       verifyToken, clientsRoutes);
app.use('/api/time-entries',  verifyToken, timeTrackingRoutes);
app.use('/api/dashboard',     verifyToken, dashboardRoutes);
app.use('/api/scheduling',    verifyToken, schedulingRoutes);

// Misc inline routes (mounted at root /api — each route inside defines its own path)
app.use('/api', miscRoutes);

// Billing
app.use('/api/billing', verifyToken, billingRoutes);

// Pre-existing dedicated route files
app.use('/api/reports',            verifyToken, require('./routes/reports'));
app.use('/api/payroll',            verifyToken, require('./routes/payrollRoutes'));
app.use('/api/audit-logs',         verifyToken, require('./routes/auditLogs'));
app.use('/api/users',              verifyToken, require('./routes/users'));
app.use('/api/claims',             verifyToken, require('./routes/claimsRoutes'));
app.use('/api/stripe',                         require('./routes/stripeRoutes')); // has its own webhook signature verification
app.use('/api/applications',       verifyToken, require('./routes/applicationsRoutes'));
app.use('/api/schedules',          verifyToken, require('./routes/schedulesRoutes'));
app.use('/api/sms',                verifyToken, require('./routes/smsRoutes'));
app.use('/api/open-shifts',        verifyToken, require('./routes/openShiftsRoutes'));
app.use('/api/medications',        verifyToken, require('./routes/medicationsRoutes'));
app.use('/api/documents',          verifyToken, require('./routes/documentsRoutes'));
app.use('/api/adl',                verifyToken, require('./routes/adlRoutes'));
app.use('/api/background-checks',  verifyToken, require('./routes/backgroundChecksRoutes'));
app.use('/api/family-portal',                   require('./routes/familyPortalRoutes')); // has its own auth
app.use('/api/shift-swaps',        verifyToken, require('./routes/shiftSwapsRoutes'));
app.use('/api/alerts',             verifyToken, require('./routes/alertsRoutes'));
app.use('/api/route-optimizer',    verifyToken, require('./routes/routeOptimizerRoutes'));
app.use('/api/matching',           verifyToken, require('./routes/matchingRoutes'));
app.use('/api/emergency',          verifyToken, require('./routes/emergencyRoutes'));
app.use('/api/messages',           verifyToken, require('./routes/messageRoutes'));
app.use('/api/remittance',         verifyToken, require('./routes/remittanceRoutes'));
app.use('/api/sandata',            verifyToken, require('./routes/sandataRoutes'));
app.use('/api/authorizations',     verifyToken, require('./routes/authorizationRoutes'));
app.use('/api/failsafe',           verifyToken, require('./routes/failsafeRoutes'));
app.use('/api/edi',                verifyToken, require('./routes/ediRoutes'));
app.use('/api/gusto',              verifyToken, require('./routes/gustoRoutes'));
app.use('/api/push',               verifyToken, require('./routes/pushNotificationRoutes').router);

// ============ GLOBAL ERROR HANDLER ============
app.use((err, req, res, next) => {
  const status = err.status || err.statusCode || 500;
  console.error(`[ERROR] ${req.method} ${req.path}`, {
    status,
    message: err.message,
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
});
