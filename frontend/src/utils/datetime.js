// Centralized date/time formatting for the agency timezone (America/Chicago).
//
// Two distinct cases — using the wrong one is the off-by-one bug we keep hitting:
//
//  • DATE columns (no real time-of-day): date_of_birth, service_date, shift_date,
//    *_date, expiration_date, hire_date, etc. The DB value arrives as 'YYYY-MM-DD'
//    or an ISO string whose DATE PORTION is the intended day. We take that date
//    portion literally, so it NEVER shifts with the server or browser timezone.
//    (new Date('2026-06-12') parses as UTC midnight → toLocaleDateString() shows
//    6/11 in US timezones. That's the bug. formatDate() avoids it entirely.)
//
//  • TIMESTAMPTZ (a real instant): created_at, requested_at, performed_at,
//    recorded_at, GPS timestamps, *_at. Render the instant IN the agency tz.

const TZ = 'America/Chicago';
const DATE_OPTS = { year: 'numeric', month: 'numeric', day: 'numeric' };
const TIME_OPTS = { hour: 'numeric', minute: '2-digit' };

// DATE column → exact calendar date, timezone-independent.
export function formatDate(value, opts) {
  if (!value) return '';
  const s = typeof value === 'string'
    ? value
    : (value instanceof Date ? value.toISOString() : String(value));
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) {
    const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])); // local, no tz shift
    if (!isNaN(d.getTime())) return d.toLocaleDateString('en-US', opts || DATE_OPTS);
  }
  const d = new Date(value);
  return isNaN(d.getTime()) ? '' : d.toLocaleDateString('en-US', opts || DATE_OPTS);
}

// TIMESTAMPTZ shown as a date → the instant's date in the agency tz.
export function formatDateTZ(value, opts) {
  if (!value) return '';
  const d = new Date(value);
  return isNaN(d.getTime()) ? '' : d.toLocaleDateString('en-US', { timeZone: TZ, ...(opts || DATE_OPTS) });
}

// TIMESTAMPTZ shown as a time → the instant's time in the agency tz.
export function formatTime(value, opts) {
  if (!value) return '';
  const d = new Date(value);
  return isNaN(d.getTime()) ? '' : d.toLocaleTimeString('en-US', { timeZone: TZ, ...(opts || TIME_OPTS) });
}

// TIMESTAMPTZ shown as date + time → the instant in the agency tz.
export function formatDateTime(value, opts) {
  if (!value) return '';
  const d = new Date(value);
  return isNaN(d.getTime()) ? '' : d.toLocaleString('en-US', { timeZone: TZ, ...(opts || { ...DATE_OPTS, ...TIME_OPTS }) });
}
