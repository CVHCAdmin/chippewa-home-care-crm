// Mirrors backend/src/helpers/incidentOptions.js — keep the two lists identical.
// INCIDENT_TYPES values are the ones IncidentReporting.jsx has always stored.

export const INCIDENT_TYPES = [
  { value: 'accident',           label: 'Accident' },
  { value: 'fall',               label: 'Fall' },
  { value: 'medication_error',   label: 'Medication Error' },
  { value: 'missing_medication', label: 'Missing / Misappropriated Medication' },
  { value: 'behavioral',         label: 'Behavioral Issue' },
  { value: 'injury',             label: 'Injury' },
  { value: 'property_damage',    label: 'Property Damage' },
  { value: 'health_emergency',   label: 'Health Emergency' },
  { value: 'other',              label: 'Other' },
];

export const SEVERITIES = [
  { value: 'minor',    label: 'Minor' },
  { value: 'moderate', label: 'Moderate' },
  { value: 'severe',   label: 'Severe' },
  { value: 'critical', label: 'Critical' },
];

export const INCIDENT_STATUSES = [
  { value: 'open',          label: 'Open' },
  { value: 'investigating', label: 'Investigating' },
  { value: 'closed',        label: 'Closed' },
];

export const DISPOSITIONS = [
  { value: 'substantiated',   label: 'Substantiated' },
  { value: 'unsubstantiated', label: 'Unsubstantiated' },
  { value: 'inconclusive',    label: 'Inconclusive' },
];

export const MANDATORY_REPORT_STATUSES = [
  { value: 'not_required', label: 'Not required' },
  { value: 'pending',      label: 'Decision pending' },
  { value: 'reported',     label: 'Reported' },
];

export const ENTRY_TYPES = [
  { value: 'call',      label: 'Phone call' },
  { value: 'interview', label: 'Interview' },
  { value: 'document',  label: 'Document reviewed' },
  { value: 'action',    label: 'Action taken' },
  { value: 'schedule',  label: 'Schedule change' },
  { value: 'note',      label: 'Note' },
];

export const ATTACHMENT_CATEGORIES = [
  { value: 'payer_notice',     label: 'Payer / MCO notice' },
  { value: 'statement',        label: 'Signed statement' },
  { value: 'background_check', label: 'Background check' },
  { value: 'training',         label: 'Training record' },
  { value: 'signed_response',  label: 'Signed response' },
  { value: 'photo',            label: 'Photo' },
  { value: 'other',            label: 'Other' },
];

export const TRAINING_ACK_METHODS = [
  { value: 'in_person', label: 'In person' },
  { value: 'phone',     label: 'Phone' },
  { value: 'video',     label: 'Video' },
];

const toMap = (list) => Object.fromEntries(list.map(o => [o.value, o.label]));
const MAPS = {
  type: toMap(INCIDENT_TYPES), severity: toMap(SEVERITIES), status: toMap(INCIDENT_STATUSES),
  disposition: toMap(DISPOSITIONS), mandatory: toMap(MANDATORY_REPORT_STATUSES),
  entry: toMap(ENTRY_TYPES), category: toMap(ATTACHMENT_CATEGORIES), method: toMap(TRAINING_ACK_METHODS),
};

export const incidentLabel = (kind, value) => (MAPS[kind] && MAPS[kind][value]) || value || '';

// Same raw-file cap the backend enforces (base64 must fit the 10mb JSON limit).
export const ATTACHMENT_MAX_BYTES = 7_000_000;
export const ATTACHMENT_ACCEPT = 'application/pdf,image/jpeg,image/png,image/gif,image/webp';
