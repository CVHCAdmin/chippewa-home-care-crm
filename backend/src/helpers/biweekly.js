// helpers/biweekly.js
// The ONE definition of "which fortnight is this bi-weekly shift on".
//
// A bi-weekly row is `frequency='biweekly'` + `anchor_date`. The engine
// (scheduleOccurrences.js) and every JS expander must agree on parity, and they
// only reliably do so when anchor_date falls on the row's own day_of_week —
// then every on-date is an exact multiple of 7 days from the anchor and no
// rounding rule can disagree.
//
// Why this exists (2026-09-10): the calendar normalized the anchor to the SUNDAY
// of the week, so a Saturday row sat 6 days after its anchor. Postgres truncates
// 6/7 to 0 (on), DragDropScheduler/week-view used Math.round → 1 (off), the
// month views used Math.floor → 0 (on). Payroll had the caregiver on 9/12 and
// 9/26 while the grid painted 9/19 and 10/3. Same row, two calendars.
//
// A Sat+Sun weekend also straddles the Sunday week boundary, so one shared
// "on week" anchor can never describe "this weekend, then every other weekend".
// Aligning the anchor per row (Sat → 9/12, Sun → 9/13) is what makes that work.
//
// A frontend copy of isBiweeklyOn lives in frontend/src/utils/biweekly.js —
// keep the two identical.

const MS_DAY = 86400000;

// Any date-ish value → 'YYYY-MM-DD'. Strings are sliced (ISO timestamps from
// the API are UTC midnight, so the first 10 chars ARE the calendar date);
// Date objects use local getters (pg parses DATE columns to local midnight).
function toYMD(v) {
  if (!v) return null;
  if (v instanceof Date) {
    return `${v.getFullYear()}-${String(v.getMonth() + 1).padStart(2, '0')}-${String(v.getDate()).padStart(2, '0')}`;
  }
  return String(v).slice(0, 10);
}

// Whole calendar days from a to b, computed in UTC so DST never yields 6.96 days.
function dayDiff(aYMD, bYMD) {
  return Math.round((Date.UTC(...ymdParts(bYMD)) - Date.UTC(...ymdParts(aYMD))) / MS_DAY);
}
function ymdParts(ymd) {
  const [y, m, d] = String(ymd).slice(0, 10).split('-').map(Number);
  return [y, m - 1, d];
}
function dowOf(ymd) {
  return new Date(Date.UTC(...ymdParts(ymd))).getUTCDay();
}
function addDays(ymd, n) {
  const t = new Date(Date.UTC(...ymdParts(ymd)) + n * MS_DAY);
  return t.toISOString().slice(0, 10);
}

// Mirrors the engine's SQL: floor((date - anchor) / 7) is even → on week.
// Negative diffs (dates before the anchor) floor toward -inf, matching FLOOR() in SQL.
function isBiweeklyOn(dateYMD, anchor) {
  const a = toYMD(anchor);
  if (!a) return true; // no anchor → nothing to alternate against; treat as weekly
  const weeks = Math.floor(dayDiff(a, toYMD(dateYMD)) / 7);
  return ((weeks % 2) + 2) % 2 === 0;
}

// The anchor a bi-weekly row should actually store.
//   anchorDate     what the caller asked for (any day; may be null)
//   effectiveDate  when the pattern starts (the row's effective_date / fromDate)
//   dayOfWeek      the row's weekday (0=Sun..6=Sat)
//   previous       { anchor_date, day_of_week } of the row being edited, if any
// Result: the first date on/after max(anchorDate, effectiveDate) that falls on
// dayOfWeek. When the caller is editing an existing bi-weekly row WITHOUT moving
// its weekday or explicitly changing its anchor, the result keeps the old row's
// fortnight parity — so "change the time from Oct 3 onward" on a pattern whose on
// Saturdays are 9/26 and 10/10 lands on 10/10, not flipping to 10/3.
function alignBiweeklyAnchor({ anchorDate, effectiveDate, dayOfWeek, previous } = {}) {
  if (dayOfWeek === null || dayOfWeek === undefined) return toYMD(anchorDate);
  const dow = Number(dayOfWeek);
  if (!Number.isInteger(dow) || dow < 0 || dow > 6) return toYMD(anchorDate);
  const a = toYMD(anchorDate);
  const e = toYMD(effectiveDate);
  let base = [a, e].filter(Boolean).sort().pop();
  if (!base) return null;
  let candidate = addDays(base, (dow - dowOf(base) + 7) % 7);
  const prevAnchor = previous ? toYMD(previous.anchor_date) : null;
  const sameDay = previous && Number(previous.day_of_week) === dow;
  const anchorUntouched = !a || a === prevAnchor;
  if (prevAnchor && sameDay && anchorUntouched && !isBiweeklyOn(candidate, prevAnchor)) {
    candidate = addDays(candidate, 7);
  }
  return candidate;
}

module.exports = { toYMD, dayDiff, dowOf, addDays, isBiweeklyOn, alignBiweeklyAnchor };
