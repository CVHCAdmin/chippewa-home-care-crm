// src/testApp.js
// Same middleware/routes as server.js but exports the Express app without calling listen().
// Used by smoke.test.js so tests don't need a real port or DB.

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const db = require('./db');

const app = express();
app.set('trust proxy', 1);

app.use(helmet());
app.use(cors({ origin: '*', credentials: true, methods: ['GET','POST','PUT','DELETE','PATCH'], allowedHeaders: ['Content-Type','Authorization'] }));

// Skip rate limiting in tests
if (process.env.NODE_ENV !== 'test') {
  app.use(rateLimit({ windowMs: 15*60*1000, max: 500 }));
}

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ limit: '10mb', extended: true }));

// Mock audit logger in test mode
if (process.env.NODE_ENV === 'test') {
  app.use((req, res, next) => next());
} else {
  app.use(require('./middleware/auditLogger')(db.pool));
}

// Health check
app.get('/health', (req, res) => res.json({ status: 'ok', timestamp: new Date() }));

const { verifyToken } = require('./middleware/shared');

// All routes — same as server.js
const authRoutes         = require('./routes/authRoutes');
const caregiverRoutes    = require('./routes/caregiverRoutes');
const clientsRoutes      = require('./routes/clientsRoutes');
const timeTrackingRoutes = require('./routes/timeTrackingRoutes');
const dashboardRoutes    = require('./routes/dashboardRoutes');
const schedulingRoutes   = require('./routes/schedulingRoutes');
const billingRoutes      = require('./routes/billingRoutes');
const referralRoutes     = require('./routes/referralRoutes');
const notificationRoutes = require('./routes/notificationRoutes');
const prospectRoutes     = require('./routes/prospectRoutes');
const pricingRoutes      = require('./routes/pricingRoutes');
const absenceRoutes      = require('./routes/absenceRoutes');
const expenseRoutes      = require('./routes/expenseRoutes');
const clinicalRoutes     = require('./routes/clinicalRoutes');

app.use('/api/auth', authRoutes);
app.use('/api/caregivers',   verifyToken, caregiverRoutes);
app.use('/api/clients',      verifyToken, clientsRoutes);
app.use('/api/time-entries', verifyToken, timeTrackingRoutes);
app.use('/api/dashboard',    verifyToken, dashboardRoutes);
app.use('/api/scheduling',   verifyToken, schedulingRoutes);
app.use('/api/billing',      verifyToken, billingRoutes);
app.use('/api', referralRoutes);
app.use('/api', notificationRoutes);
app.use('/api', prospectRoutes);
app.use('/api', pricingRoutes);
app.use('/api', absenceRoutes);
app.use('/api', expenseRoutes);
app.use('/api', clinicalRoutes);
app.use('/api/reports',           verifyToken, require('./routes/reports'));
app.use('/api/payroll',           verifyToken, require('./routes/payrollRoutes'));
app.use('/api/audit-logs',        verifyToken, require('./routes/auditLogs'));
app.use('/api/users',             verifyToken, require('./routes/users'));
app.use('/api/claims',            verifyToken, require('./routes/claimsRoutes'));
app.use('/api/stripe',                         require('./routes/stripeRoutes'));
app.use('/api/applications',      verifyToken, require('./routes/applicationsRoutes'));
app.use('/api/schedules',         verifyToken, require('./routes/schedulesRoutes'));
app.use('/api/sms',               verifyToken, require('./routes/smsRoutes'));
app.use('/api/open-shifts',       verifyToken, require('./routes/openShiftsRoutes'));
app.use('/api/medications',       verifyToken, require('./routes/medicationsRoutes'));
app.use('/api/documents',         verifyToken, require('./routes/documentsRoutes'));
app.use('/api/adl',               verifyToken, require('./routes/adlRoutes'));
app.use('/api/background-checks', verifyToken, require('./routes/backgroundChecksRoutes'));
app.use('/api/family-portal', (req, res, next) => {
  if (req.path.startsWith('/admin')) return verifyToken(req, res, next);
  next();
}, require('./routes/familyPortalRoutes'));
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
app.use('/api/push',              verifyToken, require('./routes/pushNotificationRoutes').router);

// Explicit path workarounds
app.get('/api/schedules-all', verifyToken, async (req, res) => {
  try {
    const result = await db.query(
      `SELECT s.*, s.frequency, s.effective_date, s.anchor_date,
              u.first_name as caregiver_first_name, u.last_name as caregiver_last_name,
              c.first_name as client_first_name, c.last_name as client_last_name
       FROM schedules s JOIN users u ON s.caregiver_id=u.id JOIN clients c ON s.client_id=c.id
       WHERE s.is_active=true ORDER BY s.day_of_week, s.date, s.start_time`
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
      [clientId, dayOfWeek !== undefined ? dayOfWeek : null, date||null, startTime, endTime, notes||null, frequency||'weekly', effectiveDate||null, anchorDate||null, scheduleId]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Schedule not found' });
    res.json(result.rows[0]);
  } catch (error) { res.status(500).json({ error: error.message }); }
});

app.get('/api/payroll-periods', verifyToken, async (req, res) => {
  try {
    res.json((await db.query(`SELECT DISTINCT pay_period_start, pay_period_end FROM payroll ORDER BY pay_period_end DESC`)).rows);
  } catch (error) { res.status(500).json({ error: error.message }); }
});

// Error handler
app.use((err, req, res, next) => {
  const status = err.status || err.statusCode || 500;
  res.status(status).json({ error: status < 500 ? err.message : 'An unexpected error occurred.' });
});

module.exports = app;
