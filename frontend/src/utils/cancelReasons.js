// Mirrors backend/src/helpers/cancelReasons.js — keep the two lists identical.
export const CLIENT_UNAVAILABLE_REASONS = [
  { value: 'client_refused',   label: 'Client refused services' },
  { value: 'client_not_home',  label: 'Client not home / not answering' },
  { value: 'client_hospital',  label: 'Client in hospital or facility' },
  { value: 'client_cancelled', label: 'Client cancelled ahead of time' },
  { value: 'other',            label: 'Other (add a note)' },
];

export const CANCEL_REASON_LABELS = {
  client_refused:    'Client refused services',
  client_not_home:   'Client not home / not answering',
  client_hospital:   'Client in hospital or facility',
  client_cancelled:  'Client cancelled ahead of time',
  caregiver_callout: 'Caregiver called out',
  admin_cancelled:   'Cancelled by office',
  other:             'Other',
};

export const cancelReasonLabel = (code) => CANCEL_REASON_LABELS[code] || code || 'No reason recorded';
