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

// HTTPS redirect in production (Render sets X-Forwarded-Proto)
if (process.env.NODE_ENV === 'production') {
  app.use((req, res, next) => {
    if (req.headers['x-forwarded-proto'] === 'http') {
      return res.redirect(301, `https://${req.headers.host}${req.url}`);
    }
    next();
  });
}

// CORS — CVHC defaults + ALLOWED_ORIGINS env var for additional domains (white-labeling)
// To add a new domain: set ALLOWED_ORIGINS=https://newclient.netlify.app in Render env vars
app.use(cors({
  origin: (origin, callback) => {
    const defaultOrigins = [
      'https://cvhc-crm.netlify.app',
      'https://cvhc-marketing.netlify.app',        // marketing site Netlify preview
      'https://chippewa-home-care-crm.pages.dev',
      'https://app.chippewavalleyhomecare.com',
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
    callback(new Error('Not allowed by CORS'));
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

// Rate limiters
//
// Global cap (per IP) intentionally generous: an admin loading the dashboard
// fires 20+ parallel requests, then polls a few of them every few seconds for
// freshness. 500/15min works out to ~33/min — easy to trip during normal use
// and the lockout is opaque (15-min IP ban). 2000/15min ≈ ~130/min, which
// still blocks scraping but covers a real admin session.
//
// Always send a JSON body so the frontend can show a real message instead of
// JSON.parse-ing plain text and rendering "Unexpected token 'T'".
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, max: 2000, standardHeaders: true, legacyHeaders: false,
  message: { error: 'Too many requests from this device. Please wait a minute and try again.' },
  skip: (req) => req.path.includes('/api/messages/unread-count') || req.path.includes('/api/push/unread-count')
});
app.use(limiter);
// Stripe webhook needs the raw body for signature verification — skip the
// JSON parser for that one path. Every other route still gets parsed JSON.
app.use((req, res, next) => {
  if (req.originalUrl === '/api/stripe/webhook') return next();
  return express.json({ limit: '10mb' })(req, res, next);
});
app.use(express.urlencoded({ limit: '10mb', extended: true }));

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, max: 15,
  message: { error: 'Too many login attempts. Try again in 15 minutes.' }
});
app.use('/api/auth/login', authLimiter);
app.use('/api/auth/register-caregiver', authLimiter);
app.use('/api/auth/register-admin', authLimiter);

const portalLoginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, max: 10,
  message: { error: 'Too many login attempts. Try again in 15 minutes.' }
});
app.use('/api/client-portal/login', portalLoginLimiter);

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
// NOTE: no mount-level verifyToken here — that would act as a catch-all auth
// wall for every /api/* route declared after this line (it broke the public
// job-application and lead endpoints). clientTasksRoutes self-protects: every
// route in it already applies verifyToken (+ requireAdmin where needed).
app.use('/api', require('./routes/clientTasksRoutes'));

// Dedicated route files (mounted at their own prefixes — no conflicts)
app.use('/api/reports',           verifyToken, require('./routes/reports'));
app.use('/api/payroll',           verifyToken, require('./routes/payrollRoutes'));
app.use('/api/audit-logs',        verifyToken, require('./routes/auditLogs'));
app.use('/api/users',             verifyToken, require('./routes/users'));
app.use('/api/claims',            verifyToken, require('./routes/claimsRoutes'));
app.use('/api/stripe',                         require('./routes/stripeRoutes'));
app.use('/api/public',                         require('./routes/publicLeadRoutes'));
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
app.use('/api/performance-reviews', verifyToken, require('./routes/performanceReviewsRoutes'));
app.use('/api/background-checks', verifyToken, require('./routes/backgroundChecksRoutes'));
app.use('/api/job-postings',      verifyToken, require('./routes/jobPostingsRoutes'));
app.use('/api/onboarding-packets', (req, res, next) => {
  // Public tokenized routes bypass auth; everything else is admin.
  if (req.path.startsWith('/public')) return next();
  return verifyToken(req, res, next);
}, require('./routes/onboardingPacketsRoutes'));
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
app.use('/api/communication-log', verifyToken, require('./routes/communicationRoutes'));
app.use('/api/no-show',           verifyToken, require('./routes/noShowRoutes'));
app.use('/api/forms',             verifyToken, require('./routes/formBuilderRoutes'));
app.use('/api/forecast',          verifyToken, require('./routes/forecastRoutes'));
app.use('/api/payments',              verifyToken, require('./routes/paymentsRoutes'));
app.use('/api/schedule-exceptions',  verifyToken, require('./routes/scheduleExceptionsRoutes'));
app.use('/api/time-off',            verifyToken, require('./routes/timeOffRoutes'));
app.use('/api/ivr',                 require('./routes/ivrRoutes')); // No auth — Twilio webhooks are public

// ── EXPLICIT ROUTES (Express path-boundary workarounds) ──────────────────────

// /api/schedules-all — router.get('-all') can't match this path due to Express
// path segment rules, so these live directly on the app instance.
app.get('/api/schedules-all', verifyToken, async (req, res) => {
  try {
    // Check if split-shift columns exist (added by migration_v17)
    const colCheck = await db.query(
      `SELECT column_name FROM information_schema.columns
       WHERE table_name = 'schedules' AND column_name = 'is_split_shift'`
    );
    const hasSplitCols = colCheck.rows.length > 0;

    // Check if end_date column exists (added by migration_v20)
    const endDateCheck = await db.query(
      `SELECT column_name FROM information_schema.columns
       WHERE table_name = 'schedules' AND column_name = 'end_date'`
    );
    const hasEndDate = endDateCheck.rows.length > 0;

    // Check if is_training column exists (added by migration_v50)
    const trainingCheck = await db.query(
      `SELECT column_name FROM information_schema.columns
       WHERE table_name = 'schedules' AND column_name = 'is_training'`
    );
    const hasTraining = trainingCheck.rows.length > 0;

    const result = await db.query(
      `SELECT s.id, s.caregiver_id, s.client_id, s.schedule_type,
              s.day_of_week, s.date, s.start_time, s.end_time,
              s.notes, s.is_active, s.status, s.created_at, s.updated_at,
              s.frequency, s.effective_date, s.anchor_date,
              ${hasEndDate ? `s.end_date,` : `NULL::date AS end_date,`}
              ${hasTraining ? `s.is_training,` : `false AS is_training,`}
              ${hasSplitCols
                ? `s.is_split_shift, s.split_shift_group_id, s.split_segment,`
                : `false AS is_split_shift, NULL::uuid AS split_shift_group_id, NULL::int AS split_segment,`}
              u.first_name as caregiver_first_name, u.last_name as caregiver_last_name,
              c.first_name as client_first_name, c.last_name as client_last_name
       FROM schedules s
       JOIN users u ON s.caregiver_id = u.id
       JOIN clients c ON s.client_id = c.id
       WHERE s.is_active = true
       ORDER BY s.day_of_week, s.date, s.start_time`
    );

    // Also fetch all exceptions for recurring schedules
    const recurringIds = result.rows
      .filter(s => s.day_of_week !== null && s.day_of_week !== undefined)
      .map(s => s.id);

    let exceptions = [];
    if (recurringIds.length > 0) {
      try {
        const excResult = await db.query(
          `SELECT * FROM schedule_exceptions WHERE schedule_id = ANY($1) ORDER BY exception_date`,
          [recurringIds]
        );
        exceptions = excResult.rows;
      } catch (e) {
        // schedule_exceptions table may not exist yet — gracefully skip
        if (!e.message.includes('does not exist')) throw e;
      }
    }

    // Attach exceptions to their parent schedules as a map
    const excMap = {};
    exceptions.forEach(ex => {
      if (!excMap[ex.schedule_id]) excMap[ex.schedule_id] = [];
      excMap[ex.schedule_id].push(ex);
    });

    const enriched = result.rows.map(s => ({
      ...s,
      exceptions: excMap[s.id] || []
    }));

    res.json(enriched);
  } catch (error) {
    console.error('[schedules-all] GET failed:', error.message, error.stack);
    res.status(500).json({ error: error.message });
  }
});

// Editing a RECURRING shift used to rewrite history: the pattern is a single row and
// every past occurrence is re-derived from it, so changing the time silently changed
// every week already worked. That is the bug behind "she changed one shift and it
// changed multiple weeks."
//
// An edit must therefore say WHICH occurrences it means. Three scopes:
//
//   scope=this      — override that ONE date via a 'modified' schedule_exceptions row.
//     The pattern is untouched, so next week is unaffected. This is what the back office
//     does at payday: the visit really did run at a different time that one day, and the
//     schedule needs to say so before payroll reconciles against it. Requires editDate.
//     A PAST editDate is explicitly allowed — correcting the past IS the workflow.
//
//   scope=following — the shift changed permanently as of editDate. End the old pattern
//     the day before and start a new one carrying the edits. Weeks BEFORE editDate keep
//     generating from the old row, so history before the change is preserved. editDate may
//     be in the past ("as of two Mondays ago it moved to 10am") — that is a legitimate
//     effective-dated correction, not a history rewrite.
//
//   scope=all       — rewrite the pattern in place, changing every occurrence ever. Real
//     history rewriting. Allowed, but only when explicitly asked for.
//
// There is NO default. A recurring edit without a scope is rejected, because every silent
// default here is wrong for somebody: defaulting to 'all' is the original bug, and
// defaulting to 'following' quietly breaks callers that expect an in-place update. Fail
// loudly instead of corrupting the schedule.
//
// One-time shifts are a single occurrence, so they are always edited in place.
app.put('/api/schedules-all/:scheduleId', verifyToken, async (req, res) => {
  const { scheduleId } = req.params;
  const { clientId, caregiverId, dayOfWeek, date, startTime, endTime, notes, frequency, effectiveDate, anchorDate, endDate, isTraining } = req.body;
  const scope = String(req.body.scope || req.query.scope || '').toLowerCase();
  const editDate = req.body.editDate || req.query.editDate || null;

  const normalize = t => String(t).split(':').map(n => n.padStart(2, '0')).join(':');
  if (startTime && endTime && normalize(startTime) === normalize(endTime)) return res.status(400).json({ error: 'Start and end time cannot be the same' });
  if (scope && !['this', 'following', 'all'].includes(scope)) return res.status(400).json({ error: `Invalid scope '${scope}'. Use this | following | all.` });

  const client = await db.pool.connect();
  try {
    const cur = await client.query(
      `SELECT *, to_char(effective_date,'YYYY-MM-DD') AS eff_str FROM schedules WHERE id=$1 AND is_active=true`,
      [scheduleId]
    );
    if (cur.rows.length === 0) return res.status(404).json({ error: 'Schedule not found' });
    const before = cur.rows[0];
    const isRecurring = before.day_of_week !== null && before.day_of_week !== undefined;
    const today = (await client.query(`SELECT to_char((NOW() AT TIME ZONE 'America/Chicago')::date,'YYYY-MM-DD') AS d`)).rows[0].d;

    // In-place edit of this exact row (one-time shifts, and explicit scope=all).
    const editInPlace = async () => {
      const colCheck = await client.query(
        `SELECT column_name FROM information_schema.columns WHERE table_name = 'schedules' AND column_name IN ('end_date','is_training')`
      );
      const cols = new Set(colCheck.rows.map(r => r.column_name));
      const setClauses = [
        'client_id=COALESCE($1,client_id)',
        'day_of_week=$2',
        'date=$3',
        'start_time=COALESCE($4,start_time)',
        'end_time=COALESCE($5,end_time)',
        'notes=$6',
        'frequency=COALESCE($7,frequency)',
        'effective_date=COALESCE($8,effective_date)',
        'anchor_date=COALESCE($9,anchor_date)',
        // Reassignment used to need a SECOND call to /reassign. Because an edit can now
        // move the live pattern to a new row, that second call would land on the row this
        // one just retired — so the caregiver silently never changed. Do it here, in the
        // same statement, on the row we actually wrote.
        'caregiver_id=COALESCE($11,caregiver_id)',
      ];
      const params = [
        clientId, dayOfWeek !== undefined ? dayOfWeek : null, date || null, startTime, endTime,
        notes || null, frequency || 'weekly', effectiveDate || null, anchorDate || null, scheduleId,
        caregiverId || null,
      ];
      // Only touch end_date when the caller actually sent it. This used to write
      // `endDate || null` unconditionally, so ANY edit cleared end_date and
      // resurrected a previously deleted (end-dated) recurring pattern.
      if (cols.has('end_date') && endDate !== undefined) {
        params.push(endDate || null);
        setClauses.push(`end_date=$${params.length}`);
      }
      if (cols.has('is_training') && isTraining !== undefined) {
        params.push(!!isTraining);
        setClauses.push(`is_training=$${params.length}`);
      }
      setClauses.push('updated_at=NOW()');
      const r = await client.query(
        `UPDATE schedules SET ${setClauses.join(', ')} WHERE id=$10 AND is_active=true RETURNING *`, params
      );
      return r.rows[0];
    };

    // ── One-time shift: a single occurrence, so there is nothing to scope ──
    if (!isRecurring) {
      const row = await editInPlace();
      db.auditLog(req.user.id, 'UPDATE', 'schedules', scheduleId, before, row);
      return res.json({ ...row, _scope: 'one-time' });
    }

    // A recurring edit MUST say what it means. No default — see the note above.
    if (!scope) {
      return res.status(400).json({
        error: 'This is a repeating shift, so the change needs a scope: ' +
               "'this' (just that day), 'following' (that day onward), or 'all' (every occurrence, past included).",
        code: 'scope_required',
      });
    }

    // ── scope=all: rewrite the pattern in place, changing history too ──
    if (scope === 'all') {
      const row = await editInPlace();
      db.auditLog(req.user.id, 'UPDATE', 'schedules', scheduleId, before, row);
      return res.json({ ...row, _scope: 'all' });
    }

    // ── scope=this: override a single occurrence; the pattern is untouched ──
    // A past editDate is allowed on purpose. Correcting a day that has already happened,
    // so payroll reconciles against what actually ran, is the whole point.
    if (scope === 'this') {
      if (!editDate) return res.status(400).json({ error: "scope='this' requires editDate (the occurrence being changed)." });
      const ex = await client.query(
        `INSERT INTO schedule_exceptions
           (schedule_id, exception_date, exception_type, override_start_time, override_end_time,
            override_client_id, override_caregiver_id, override_notes, created_by)
         VALUES ($1,$2,'modified',$3,$4,$5,$6,$7,$8)
         ON CONFLICT (schedule_id, exception_date) DO UPDATE SET
           exception_type='modified',
           override_start_time   =COALESCE(EXCLUDED.override_start_time,    schedule_exceptions.override_start_time),
           override_end_time     =COALESCE(EXCLUDED.override_end_time,      schedule_exceptions.override_end_time),
           override_client_id    =COALESCE(EXCLUDED.override_client_id,     schedule_exceptions.override_client_id),
           override_caregiver_id =COALESCE(EXCLUDED.override_caregiver_id,  schedule_exceptions.override_caregiver_id),
           override_notes        =COALESCE(EXCLUDED.override_notes,         schedule_exceptions.override_notes)
         RETURNING *`,
        [scheduleId, editDate, startTime || null, endTime || null, clientId || null, caregiverId || null, notes || null, req.user.id]
      );
      db.auditLog(req.user.id, 'UPDATE', 'schedules', scheduleId, before, { scope: 'this', editDate, exception: ex.rows[0] });
      return res.json({ ...before, _scope: 'this', _exception: ex.rows[0] });
    }

    // ── scope=following: the shift changed permanently as of fromDate ──
    // fromDate MAY be in the past. "As of two Mondays ago this moved to 10am" is a
    // legitimate effective-dated correction, and it is exactly what the back office needs
    // at payday when the real-world change was never entered. It is not a history rewrite:
    // every week BEFORE fromDate still generates from the old row, untouched. Only
    // scope='all' rewrites history, and only when asked for by name.
    const fromDate = editDate || today;
    // Pattern hasn't produced any occurrence before fromDate → no history to protect.
    if (before.eff_str && before.eff_str >= fromDate) {
      const row = await editInPlace();
      db.auditLog(req.user.id, 'UPDATE', 'schedules', scheduleId, before, row);
      return res.json({ ...row, _scope: 'following', _note: 'pattern had not started yet; edited in place' });
    }

    await client.query('BEGIN');
    // 1) Freeze history: the old pattern stops the day before the change.
    await client.query(
      `UPDATE schedules SET end_date = ($2::date - INTERVAL '1 day')::date, updated_at=NOW()
       WHERE id=$1 AND is_active=true`, [scheduleId, fromDate]
    );
    // 2) Start a new pattern carrying the edits. Copy every column of the old row
    //    (drift-proof: preserves split-shift, care_type, status, etc.) and apply
    //    only the fields the caller actually sent.
    const allCols = (await client.query(
      `SELECT column_name FROM information_schema.columns WHERE table_name='schedules'`
    )).rows.map(r => r.column_name).filter(c => !['id', 'created_at', 'updated_at'].includes(c));
    const overrides = {
      client_id: clientId, caregiver_id: caregiverId,
      day_of_week: dayOfWeek, start_time: startTime, end_time: endTime,
      notes: notes, frequency: frequency, anchor_date: anchorDate, is_training: isTraining,
      effective_date: fromDate,     // the new pattern starts here
      end_date: before.end_date,    // preserve any original termination date
    };
    const vals = allCols.map(c => (overrides[c] !== undefined ? overrides[c] : before[c]));
    const inserted = await client.query(
      `INSERT INTO schedules (${allCols.join(',')}) VALUES (${allCols.map((_, i) => `$${i + 1}`).join(',')}) RETURNING *`,
      vals
    );
    // 3) Restate effective_date. The v36 trigger clamps it forward to CURRENT_DATE on
    //    INSERT, and Postgres runs UTC while we schedule in America/Chicago — so from
    //    19:00 Chicago onward CURRENT_DATE is already tomorrow and the clamp would push
    //    the new pattern a day out. The old pattern ends at fromDate-1, so that day
    //    would belong to NO pattern and the shift would silently vanish. The trigger
    //    exempts UPDATE by design ("left alone so back-office can correct a typo"), so
    //    this sticks. No-op whenever the clamp didn't fire.
    const created = await client.query(
      `UPDATE schedules SET effective_date=$2::date WHERE id=$1 RETURNING *`,
      [inserted.rows[0].id, fromDate]
    );
    await client.query('COMMIT');

    db.auditLog(req.user.id, 'UPDATE', 'schedules', scheduleId, before, {
      scope: 'following', endedOn: fromDate, replacedBy: created.rows[0].id, newPattern: created.rows[0],
    });
    return res.json({ ...created.rows[0], _scope: 'following', _endedPatternId: scheduleId, _effectiveFrom: fromDate });
  } catch (error) {
    try { await client.query('ROLLBACK'); } catch { /* not in a txn */ }
    if (error.code === '23505') {
      return res.status(409).json({ error: 'That change would duplicate an existing active recurring shift for this caregiver and client.' });
    }
    console.error('[schedules-all] PUT failed:', error.message, error.stack);
    return res.status(500).json({ error: error.message });
  } finally {
    client.release();
  }
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

// ============ ONE-TIME MIGRATION ENDPOINT ============
// Hit GET /api/run-migration-v7 once to create new tables, then this can be removed
const { requireAdmin: requireAdminMw } = require('./middleware/shared');
app.get('/api/run-migration-v7', verifyToken, requireAdminMw, async (req, res) => {
  try {
    await db.query(`
      CREATE TABLE IF NOT EXISTS communication_log (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        entity_type VARCHAR(20) NOT NULL CHECK (entity_type IN ('client','caregiver')),
        entity_id UUID NOT NULL,
        log_type VARCHAR(30) NOT NULL DEFAULT 'note' CHECK (log_type IN ('note','call','email','text','visit','incident','complaint','compliment','other')),
        direction VARCHAR(10) CHECK (direction IN ('inbound','outbound','internal')),
        subject VARCHAR(255),
        body TEXT NOT NULL,
        logged_by UUID REFERENCES users(id),
        logged_by_name VARCHAR(100),
        follow_up_date DATE,
        follow_up_done BOOLEAN DEFAULT FALSE,
        is_pinned BOOLEAN DEFAULT FALSE,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_comm_log_entity ON communication_log(entity_type, entity_id);
      CREATE INDEX IF NOT EXISTS idx_comm_log_created ON communication_log(created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_comm_log_followup ON communication_log(follow_up_date) WHERE follow_up_done = FALSE;

      CREATE TABLE IF NOT EXISTS noshow_alert_config (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        grace_minutes INT NOT NULL DEFAULT 15,
        notify_admin BOOLEAN DEFAULT TRUE,
        notify_caregiver BOOLEAN DEFAULT TRUE,
        notify_client_family BOOLEAN DEFAULT FALSE,
        admin_phone VARCHAR(20),
        admin_email VARCHAR(255),
        is_active BOOLEAN DEFAULT TRUE,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      );
      INSERT INTO noshow_alert_config (grace_minutes, notify_admin, notify_caregiver, is_active)
      SELECT 15, TRUE, TRUE, TRUE WHERE NOT EXISTS (SELECT 1 FROM noshow_alert_config);

      CREATE TABLE IF NOT EXISTS noshow_alerts (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        schedule_id UUID,
        caregiver_id UUID REFERENCES users(id),
        client_id UUID REFERENCES clients(id),
        shift_date DATE NOT NULL,
        expected_start TIME NOT NULL,
        alerted_at TIMESTAMPTZ DEFAULT NOW(),
        resolved_at TIMESTAMPTZ,
        resolved_by UUID REFERENCES users(id),
        resolution_note TEXT,
        status VARCHAR(20) DEFAULT 'open' CHECK (status IN ('open','resolved','false_alarm')),
        sms_sent BOOLEAN DEFAULT FALSE,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_noshow_status ON noshow_alerts(status, shift_date);
      CREATE INDEX IF NOT EXISTS idx_noshow_caregiver ON noshow_alerts(caregiver_id);

      CREATE TABLE IF NOT EXISTS form_templates (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        name VARCHAR(255) NOT NULL,
        description TEXT,
        category VARCHAR(50) DEFAULT 'general' CHECK (category IN ('assessment','incident','physician_order','consent','intake','hr','general')),
        fields JSONB NOT NULL DEFAULT '[]',
        is_active BOOLEAN DEFAULT TRUE,
        requires_signature BOOLEAN DEFAULT FALSE,
        auto_attach_to VARCHAR(20) CHECK (auto_attach_to IN ('client','caregiver','both')),
        created_by UUID REFERENCES users(id),
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_form_templates_category ON form_templates(category, is_active);

      CREATE TABLE IF NOT EXISTS form_submissions (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        template_id UUID REFERENCES form_templates(id),
        template_name VARCHAR(255),
        entity_type VARCHAR(20) CHECK (entity_type IN ('client','caregiver')),
        entity_id UUID,
        submitted_by UUID REFERENCES users(id),
        submitted_by_name VARCHAR(100),
        data JSONB NOT NULL DEFAULT '{}',
        signature TEXT,
        signed_at TIMESTAMPTZ,
        status VARCHAR(20) DEFAULT 'draft' CHECK (status IN ('draft','submitted','signed','archived')),
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_form_submissions_entity ON form_submissions(entity_type, entity_id);
      CREATE INDEX IF NOT EXISTS idx_form_submissions_template ON form_submissions(template_id);
    `);
    res.json({ success: true, message: 'Migration v7 complete — all tables created.' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ============ START SERVER ============
const agencyName = process.env.AGENCY_NAME || 'HomeCare CRM';
if (require.main === module) {
  app.listen(port, () => {
    console.log(`🚀 ${agencyName} API running on port ${port}`);
    console.log(`📊 Dashboard: ${process.env.FRONTEND_URL || 'http://localhost:3000'}`);
    if (!process.env.ALLOWED_ORIGINS) console.warn('⚠️  ALLOWED_ORIGINS not set — CORS will block all browser requests in production!');

    // Start automated daily backup (production only)
    if (process.env.NODE_ENV !== 'test') {
      const { startCron } = require('./jobs/scheduledBackup');
      startCron();

      // Start WORCS background-check polling (every 30 min)
      const { startCron: startWorcsCron } = require('./jobs/worcsPoll');
      startWorcsCron();

      // Daily authorization low-units / expiring-soon alerts
      const { startCron: startAuthAlerts } = require('./jobs/authorizationAlerts');
      startAuthAlerts();

      // Shift reminder pushes (every 5 min, finds shifts starting in ~1 hour)
      const { startCron: startShiftReminders } = require('./jobs/shiftReminders');
      startShiftReminders();
    }
  });
}

module.exports = app;
