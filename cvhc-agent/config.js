// cvhc-agent/config.js
// Centralized configuration for the claims processing agent

require('dotenv').config({ path: require('path').resolve(__dirname, '../backend/.env') });

module.exports = {
  // Agency provider info (reuses backend env vars)
  agency: {
    name: process.env.AGENCY_NAME || 'CHIPPEWA VALLEY HOME CARE',
    npi: process.env.AGENCY_NPI || '',
    taxId: process.env.AGENCY_TAX_ID || '',
    medicaidId: process.env.AGENCY_MEDICAID_ID || '',
    taxonomyCode: process.env.AGENCY_TAXONOMY || '374700000X',
    address: process.env.AGENCY_ADDRESS || '',
    city: process.env.AGENCY_CITY || 'EAU CLAIRE',
    state: process.env.AGENCY_STATE || 'WI',
    zip: process.env.AGENCY_ZIP || '54701',
    phone: process.env.AGENCY_PHONE || '',
    contactName: process.env.AGENCY_CONTACT || '',
  },

  // Portal credentials (each adapter reads its own)
  portals: {
    forwardHealth: {
      username: process.env.FORWARDHEALTH_USERNAME || '',
      password: process.env.FORWARDHEALTH_PASSWORD || '',
      baseUrl: process.env.FORWARDHEALTH_URL || 'https://www.forwardhealth.wi.gov',
      interchangeUrl: process.env.FORWARDHEALTH_EDI_URL || 'https://www.forwardhealth.wi.gov/interChange',
    },
    availity: {
      clientId: process.env.AVAILITY_CLIENT_ID || '',
      clientSecret: process.env.AVAILITY_CLIENT_SECRET || '',
      baseUrl: process.env.AVAILITY_URL || 'https://api.availity.com/availity/v1',
    },
    changeHealthcare: {
      clientId: process.env.CHANGE_HC_CLIENT_ID || '',
      clientSecret: process.env.CHANGE_HC_CLIENT_SECRET || '',
      baseUrl: process.env.CHANGE_HC_URL || 'https://apigw.changehealthcare.com',
    },
    irisPPL: {
      username: process.env.IRIS_PPL_USERNAME || '',
      password: process.env.IRIS_PPL_PASSWORD || '',
      baseUrl: process.env.IRIS_PPL_URL || 'https://fms.publicpartnerships.com',
    },
  },

  // Alert configuration. Email sends route through backend/src/services/emailService
  // (AWS SES) — credentials come from AWS_REGION / AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY
  // / EMAIL_FROM on whichever service runs this agent.
  alerts: {
    ownerEmail: process.env.ALERT_EMAIL || process.env.AGENCY_CONTACT_EMAIL || '',
    ownerName: 'Alexis',
    twilioSid: process.env.TWILIO_ACCOUNT_SID || '',
    twilioToken: process.env.TWILIO_AUTH_TOKEN || '',
    twilioPhone: process.env.TWILIO_PHONE_NUMBER || '',
    ownerPhone: process.env.ALERT_PHONE || '',
  },

  // Pipeline settings
  pipeline: {
    maxResubmitAttempts: 2,
    pollIntervalMs: 30000,  // 30 seconds between response polls
    pollMaxAttempts: 60,    // poll for up to 30 minutes
    batchSize: 50,          // max claims per submission batch
  },

  // Timely filing defaults (overridden per-payer from DB)
  timelyFiling: {
    forwardhealth: { days: 365, warnDays: 330 },
    icare:         { days: 90,  warnDays: 75 },
    inclusa:       { days: 180, warnDays: 150 },
    lakeland:      { days: 90,  warnDays: 75 },
    fcp:           { days: 90,  warnDays: 75 },
    iris:          { days: 90,  warnDays: 75 },
  },

  // Authorization renewal lead times (days before expiry to act)
  renewalLeadTimes: {
    forwardhealth: { warnDays: 60, urgentDays: 30, criticalDays: 14 },
    icare:         { warnDays: 45, urgentDays: 30, criticalDays: 14 },
    inclusa:       { warnDays: 60, urgentDays: 45, criticalDays: 21 },
    lakeland:      { warnDays: 45, urgentDays: 30, criticalDays: 14 },
    fcp:           { warnDays: 45, urgentDays: 30, criticalDays: 14 },
    iris:          { warnDays: 90, urgentDays: 60, criticalDays: 30 },
  },

  // MCO renewal form links
  mcoRenewalLinks: {
    icare:    'https://icarewi.org/providers/authorization-requests',
    inclusa:  'https://www.inclusa.org/providers/authorization-management',
    lakeland: 'https://www.lakelandcareinc.com/providers/authorizations',
    fcp:      'https://www.familycarepartnership.com/providers/auth-renewal',
  },

  // Renewal dedup window (don't re-send if notified within this many days)
  renewalDedupDays: 7,

  // Sandata EVV settings
  sandata: {
    baseUrl: process.env.SANDATA_API_URL || 'https://openevv.sandata.com/api/v1',
    portalUrl: process.env.SANDATA_PORTAL_URL || 'https://portal.sandata.com',
    username: process.env.SANDATA_USERNAME || '',
    password: process.env.SANDATA_PASSWORD || '',
    accountId: process.env.SANDATA_ACCOUNT_ID || '',
    queueDelayMs: 3000,        // delay between queued submissions
    maxRetries: 3,
    retryBaseDelayMs: 5000,    // exponential backoff base
  },
};
