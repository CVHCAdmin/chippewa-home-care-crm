// routes/index.js
// Master routes file - import and register all routes

const express = require('express');
const router = express.Router();

// Import all route modules
const billingRoutes = require('./billingRoutes');
const payrollRoutes = require('./payrollRoutes');
const claimsRoutes = require('./claimsRoutes');
const smsRoutes = require('./smsRoutes');
const openShiftsRoutes = require('./openShiftsRoutes');
const medicationsRoutes = require('./medicationsRoutes');
const documentsRoutes = require('./documentsRoutes');
const adlRoutes = require('./adlRoutes');
const backgroundChecksRoutes = require('./backgroundChecksRoutes');
const familyPortalRoutes = require('./familyPortalRoutes');
const clientPortalRoutes = require('./clientPortalRoutes');
const shiftSwapsRoutes = require('./shiftSwapsRoutes');
const reportsRoutes = require('./reportsRoutes');
const alertsRoutes = require('./alertsRoutes');
const applicationsRoutes = require('./applicationsRoutes'); // NEW: Job applications
const routeOptimizerRoutes = require('./routeOptimizerRoutes'); // Route optimizer

// Register routes with their prefixes
router.use('/billing', billingRoutes);
router.use('/payroll', payrollRoutes);
router.use('/claims', claimsRoutes);
router.use('/sms', smsRoutes);
router.use('/open-shifts', openShiftsRoutes);
router.use('/medications', medicationsRoutes);
router.use('/documents', documentsRoutes);
router.use('/adl', adlRoutes);
router.use('/background-checks', backgroundChecksRoutes);
router.use('/family-portal', familyPortalRoutes);
router.use('/client-portal', clientPortalRoutes);
router.use('/shift-swaps', shiftSwapsRoutes);
router.use('/reports', reportsRoutes);
router.use('/alerts', alertsRoutes);
router.use('/applications', applicationsRoutes); // NEW: Job applications
router.use('/route-optimizer', routeOptimizerRoutes); // Route optimizer

// Also expose billing/payroll endpoints at root level for backwards compatibility
router.use('/', billingRoutes);  // For /api/authorizations, /api/invoice-payments, etc.
router.use('/', payrollRoutes);  // For /api/mileage, /api/pto, etc.

module.exports = router;

/*
===============================================================================
USAGE IN server.js
===============================================================================

1. Add this near your other requires:
   const additionalRoutes = require('./routes/index');

2. Add this with your other app.use statements (AFTER existing routes):
   app.use('/api', additionalRoutes);

Example server.js setup:
------------------------

const express = require('express');
const cors = require('cors');
const app = express();

// Middleware
app.use(cors());
app.use(express.json());

// Existing routes
app.use('/api/auth', require('./routes/auth'));
app.use('/api/clients', require('./routes/clients'));
app.use('/api/caregivers', require('./routes/caregivers'));
app.use('/api/schedules', require('./routes/schedules'));
app.use('/api/time-entries', require('./routes/timeEntries'));
app.use('/api/invoices', require('./routes/invoices'));
// ... other existing routes

// NEW: Add all additional routes
const additionalRoutes = require('./routes/index');
app.use('/api', additionalRoutes);

// Start server
app.listen(process.env.PORT || 5000);

===============================================================================
ENV VARS NEEDED
===============================================================================

# Twilio (for SMS)
TWILIO_ACCOUNT_SID=your_twilio_sid
TWILIO_AUTH_TOKEN=your_twilio_token
TWILIO_PHONE_NUMBER=+1234567890

# File uploads
UPLOAD_DIR=./uploads

===============================================================================
API ENDPOINTS SUMMARY
===============================================================================

ALERTS:
  GET    /api/alerts                    - Get all alerts
  POST   /api/alerts                    - Create alert
  PUT    /api/alerts/:id/acknowledge    - Acknowledge alert
  PUT    /api/alerts/:id/resolve        - Resolve alert
  PUT    /api/alerts/:id/dismiss        - Dismiss alert
  GET    /api/alerts/dashboard          - Get dashboard summary

BACKGROUND CHECKS:
  GET    /api/background-checks         - Get all checks
  POST   /api/background-checks         - Add check
  PUT    /api/background-checks/:id     - Update check
  DELETE /api/background-checks/:id     - Delete check

SMS:
  GET    /api/sms/messages              - Get messages
  POST   /api/sms/send                  - Send single SMS
  POST   /api/sms/send-bulk             - Send bulk SMS
  GET    /api/sms/templates             - Get templates
  POST   /api/sms/templates             - Create template
  PUT    /api/sms/templates/:id         - Update template
  DELETE /api/sms/templates/:id         - Delete template

FAMILY PORTAL:
  GET    /api/family-portal/admin/members           - Get all family members
  POST   /api/family-portal/admin/members           - Add family member
  PUT    /api/family-portal/admin/members/:id/status - Toggle active
  PUT    /api/family-portal/admin/members/:id/reset-password - Reset password
  GET    /api/family-portal/admin/messages          - Get messages
  POST   /api/family-portal/admin/messages/:id/reply - Reply to message

ADL TRACKING:
  GET    /api/adl/client/:id/requirements   - Get requirements
  POST   /api/adl/requirements              - Add requirement
  PUT    /api/adl/requirements/:id          - Update requirement
  DELETE /api/adl/requirements/:id          - Delete requirement
  GET    /api/adl/client/:id/logs           - Get logs
  POST   /api/adl/log                       - Log activity

CLAIMS:
  GET    /api/claims                    - Get all claims
  GET    /api/claims/:id                - Get claim details
  POST   /api/claims                    - Create claim
  PUT    /api/claims/:id/status         - Update status
  POST   /api/claims/export/837p        - Export 837P file

OPEN SHIFTS:
  GET    /api/open-shifts               - Get open shifts
  POST   /api/open-shifts               - Create open shift
  POST   /api/open-shifts/:id/claim     - Claim shift
  POST   /api/open-shifts/:id/approve   - Approve claim
  POST   /api/open-shifts/:id/broadcast - Broadcast to caregivers

SHIFT SWAPS:
  GET    /api/shift-swaps               - Get swap requests
  POST   /api/shift-swaps               - Create swap request
  PUT    /api/shift-swaps/:id/respond   - Accept/reject
  PUT    /api/shift-swaps/:id/approve   - Admin approve
  PUT    /api/shift-swaps/:id/reject    - Admin reject

MEDICATIONS:
  GET    /api/medications/client/:id    - Get client medications
  POST   /api/medications               - Add medication
  PUT    /api/medications/:id           - Update medication
  POST   /api/medications/log           - Log administration
  GET    /api/medications/logs/client/:id - Get logs

DOCUMENTS:
  GET    /api/documents/:type/:id       - Get documents
  POST   /api/documents/upload          - Upload document
  DELETE /api/documents/:id             - Delete document
  POST   /api/documents/:id/acknowledge - Sign/acknowledge

JOB APPLICATIONS:
  POST   /api/applications              - Submit application (PUBLIC - no auth)
  GET    /api/applications              - Get all applications (admin)
  GET    /api/applications/:id          - Get application details (admin)
  PUT    /api/applications/:id/status   - Update status (admin)
  POST   /api/applications/:id/notes    - Add interview notes (admin)
  POST   /api/applications/:id/hire     - Convert to caregiver (admin)
  DELETE /api/applications/:id          - Delete application (admin)
  GET    /api/applications/stats/summary - Get application stats (admin)

*/
