// Incident case-file option lists (migration v64). One place for the stored
// values and their labels — used by clinicalRoutes validation and the PDFs.
// Mirrors frontend/src/utils/incidentOptions.js; keep the two identical.
// INCIDENT_TYPES matches the <select> values already stored by
// IncidentReporting.jsx, so existing rows keep their labels.

const INCIDENT_TYPES = {
  accident:           'Accident',
  fall:               'Fall',
  medication_error:   'Medication Error',
  missing_medication: 'Missing / Misappropriated Medication',
  behavioral:         'Behavioral Issue',
  injury:             'Injury',
  property_damage:    'Property Damage',
  health_emergency:   'Health Emergency',
  other:              'Other',
};

const SEVERITIES = { minor: 'Minor', moderate: 'Moderate', severe: 'Severe', critical: 'Critical' };

const INCIDENT_STATUSES = { open: 'Open', investigating: 'Investigating', closed: 'Closed' };

const DISPOSITIONS = {
  substantiated:   'Substantiated',
  unsubstantiated: 'Unsubstantiated',
  inconclusive:    'Inconclusive',
};

const MANDATORY_REPORT_STATUSES = {
  not_required: 'Not required',
  pending:      'Decision pending',
  reported:     'Reported',
};

const ENTRY_TYPES = {
  call:      'Phone call',
  interview: 'Interview',
  document:  'Document reviewed',
  action:    'Action taken',
  schedule:  'Schedule change',
  note:      'Note',
};

const ATTACHMENT_CATEGORIES = {
  payer_notice:     'Payer / MCO notice',
  statement:        'Signed statement',
  background_check: 'Background check',
  training:         'Training record',
  signed_response:  'Signed response',
  photo:            'Photo',
  other:            'Other',
};

const TRAINING_ACK_METHODS = { in_person: 'In person', phone: 'Phone', video: 'Video' };

// training_records.training_type values written when the acknowledgement is
// signed — the same values ComplianceTracking.jsx lists.
const TRAINING_ACK_TRAINING_TYPES = ['medication_reminders', 'misappropriation_policy'];

// Attachments: data URI stored in TEXT (clients.insurance_card_* precedent).
// express.json is capped at 10mb in server.js; base64 inflates ~4/3, so the raw
// file cap is 7MB.
const ATTACHMENT_MAX_DATA_URI_LENGTH = 9_500_000;
const ATTACHMENT_ALLOWED_MIME = ['application/pdf', 'image/jpeg', 'image/png', 'image/gif', 'image/webp'];

module.exports = {
  INCIDENT_TYPES, SEVERITIES, INCIDENT_STATUSES, DISPOSITIONS, MANDATORY_REPORT_STATUSES,
  ENTRY_TYPES, ATTACHMENT_CATEGORIES, TRAINING_ACK_METHODS, TRAINING_ACK_TRAINING_TYPES,
  ATTACHMENT_MAX_DATA_URI_LENGTH, ATTACHMENT_ALLOWED_MIME,
};
