// Why an occurrence was cancelled — stored in schedule_exceptions.cancel_reason
// (migration v63). Client-side reasons are the ones a caregiver may record from
// the phone; the rest are office/system-only. One list, shared by the caregiver
// endpoint, the scheduler's cancel path, and the billing review's "not billed"
// list, so the labels never drift.

const CLIENT_UNAVAILABLE_REASONS = {
  client_refused:   'Client refused services',
  client_not_home:  'Client not home / not answering',
  client_hospital:  'Client in hospital or facility',
  client_cancelled: 'Client cancelled ahead of time',
  other:            'Other',
};

const CANCEL_REASONS = {
  ...CLIENT_UNAVAILABLE_REASONS,
  caregiver_callout: 'Caregiver called out',
  admin_cancelled:   'Cancelled by office',
};

module.exports = { CLIENT_UNAVAILABLE_REASONS, CANCEL_REASONS };
