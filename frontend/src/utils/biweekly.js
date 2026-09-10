// Frontend copy of backend/src/helpers/biweekly.js#isBiweeklyOn — keep identical.
//
// "Is this bi-weekly shift on this date?" Whole calendar days from the anchor,
// floored to weeks, even = on. Every calendar in the app must use THIS and never
// its own ms-and-Math.round arithmetic: in Sept 2026 the week grid rounded
// 6 days/7 up to 1 (off) while payroll truncated it to 0 (on), so the grid
// painted Nicole on 9/19 and 10/3 while payroll had her on 9/12 and 9/26.
const MS_DAY = 86400000;

function parts(ymd) {
  const [y, m, d] = String(ymd).slice(0, 10).split('-').map(Number);
  return [y, m - 1, d];
}

// Any date-ish value → 'YYYY-MM-DD'. API strings are UTC-midnight ISO timestamps,
// so the first 10 chars are the calendar date; Date objects use local getters.
export function toYMD(v) {
  if (!v) return null;
  if (v instanceof Date) {
    return `${v.getFullYear()}-${String(v.getMonth() + 1).padStart(2, '0')}-${String(v.getDate()).padStart(2, '0')}`;
  }
  return String(v).slice(0, 10);
}

export function dayDiff(aYMD, bYMD) {
  return Math.round((Date.UTC(...parts(bYMD)) - Date.UTC(...parts(aYMD))) / MS_DAY);
}

export function isBiweeklyOn(date, anchor) {
  const a = toYMD(anchor);
  if (!a) return true;
  const weeks = Math.floor(dayDiff(a, toYMD(date)) / 7);
  return ((weeks % 2) + 2) % 2 === 0;
}
