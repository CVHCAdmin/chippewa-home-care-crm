// helpers/carePlanSchedule.js
// Describes a client's recurring visit schedule in words, for saving onto a care plan
// ("Fill from current schedule") and for detecting when the live schedule has drifted
// from what a plan recorded. Expands schedules ONLY through the shared engine
// (helpers/scheduleOccurrences.js): a pattern is listed when it produces at least one
// visit in the next WINDOW_DAYS days, so ended, inactive, suspended and not-yet-started
// rows are handled exactly as billing/payroll handle them.
//
// The text describes the PATTERN (its own day, times, caregiver, frequency, end date),
// not one-week overrides or one-time visits, so a single swapped shift doesn't make an
// otherwise-current plan look out of date.

const { SCHEDULE_OCCURRENCES_CTE } = require('./scheduleOccurrences');

const WINDOW_DAYS = 28;
const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

const fmtTime = (t) => {
  const [h, m] = String(t).split(':').map(Number);
  const suffix = h >= 12 ? 'PM' : 'AM';
  return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${suffix}`;
};
const fmtDate = (d) => { const [y, m, day] = d.split('-').map(Number); return `${m}/${day}/${y}`; };

async function getClientVisitSchedule(query, clientId) {
  const today = (await query(`SELECT ((NOW() AT TIME ZONE 'America/Chicago')::date)::text AS d`)).rows[0].d;
  const r = await query(
    `WITH ${SCHEDULE_OCCURRENCES_CTE('occ')}
     SELECT s.id, s.day_of_week, s.start_time::text AS start_time, s.end_time::text AS end_time,
            COALESCE(s.frequency, 'weekly') AS frequency, s.end_date::text AS end_date,
            s.suspended_from::text AS suspended_from,
            TRIM(REGEXP_REPLACE(COALESCE(u.first_name, '') || ' ' || COALESCE(u.last_name, ''), '\\s+', ' ', 'g')) AS caregiver
       FROM occ
       JOIN schedules s ON s.id = occ.schedule_id
       LEFT JOIN users u ON u.id = s.caregiver_id
      WHERE occ.pattern_client_id = $3
      GROUP BY s.id, u.first_name, u.last_name`,
    [today, addDays(today, WINDOW_DAYS - 1), clientId]
  );
  const upcoming = await query(
    `WITH ${SCHEDULE_OCCURRENCES_CTE('occ')}
     SELECT COUNT(*)::int AS n FROM occ WHERE occ.client_id = $3 OR occ.pattern_client_id = $3`,
    [today, addDays(today, WINDOW_DAYS - 1), clientId]
  );

  const recurring = r.rows
    .filter(x => x.day_of_week !== null)
    .sort((a, b) => ((a.day_of_week + 6) % 7) - ((b.day_of_week + 6) % 7)
      || a.start_time.localeCompare(b.start_time) || a.caregiver.localeCompare(b.caregiver));
  const lines = recurring.map(x => {
    let line = `${DAY_NAMES[x.day_of_week]} ${fmtTime(x.start_time)} – ${fmtTime(x.end_time)} · ${x.caregiver || 'Unassigned'} · ${x.frequency === 'biweekly' ? 'every other week' : 'weekly'}`;
    if (x.end_date) line += ` · through ${fmtDate(x.end_date)}`;
    if (x.suspended_from) line += ` · paused from ${fmtDate(x.suspended_from)}`;
    return line;
  });

  return {
    asOf: today,
    windowDays: WINDOW_DAYS,
    text: lines.join('\n'),
    lines,
    upcomingVisits: upcoming.rows[0].n,
  };
}

function addDays(isoDate, n) {
  const d = new Date(`${isoDate}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

module.exports = { getClientVisitSchedule, WINDOW_DAYS };
