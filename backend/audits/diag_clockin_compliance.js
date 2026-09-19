// Read-only: who clocks in and out, and who doesn't.
// For a window of days (default 30, ending yesterday), expands every scheduled visit
// through the shared schedule engine and checks whether a time entry exists for that
// caregiver + client + day, plus whether the entry was clocked out.
// usage: node audits/diag_clockin_compliance.js [days]
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const db = require('../src/db');
const { SCHEDULE_OCCURRENCES_CTE } = require('../src/helpers/scheduleOccurrences');

const DAYS = parseInt(process.argv[2], 10) || 30;

(async () => {
  const { from, to } = (await db.query(
    `SELECT ((NOW() AT TIME ZONE 'America/Chicago')::date - $1::int)::text AS from,
            ((NOW() AT TIME ZONE 'America/Chicago')::date - 1)::text AS to`, [DAYS])).rows[0];
  console.log(`Scheduled visits ${from} through ${to} (Central)\n`);

  const rows = (await db.query(`
    WITH ${SCHEDULE_OCCURRENCES_CTE('occ')},
    matched AS (
      SELECT occ.caregiver_id, occ.client_id, occ.occ_date,
             te.id AS entry_id, te.end_time
        FROM occ
        LEFT JOIN LATERAL (
          SELECT t.id, t.end_time
            FROM time_entries t
           WHERE t.caregiver_id = occ.caregiver_id
             AND t.client_id = occ.client_id
             AND (t.start_time AT TIME ZONE 'America/Chicago')::date = occ.occ_date
           ORDER BY t.start_time LIMIT 1
        ) te ON true
    )
    SELECT TRIM(u.first_name || ' ' || u.last_name) AS caregiver,
           COUNT(*)::int AS scheduled,
           COUNT(m.entry_id)::int AS clocked_in,
           COUNT(*) FILTER (WHERE m.entry_id IS NULL)::int AS missed,
           COUNT(*) FILTER (WHERE m.entry_id IS NOT NULL AND m.end_time IS NULL)::int AS no_clock_out,
           to_char(MAX(m.occ_date) FILTER (WHERE m.entry_id IS NOT NULL), 'YYYY-MM-DD') AS last_clock_in,
           to_char(MAX(m.occ_date) FILTER (WHERE m.entry_id IS NULL), 'YYYY-MM-DD') AS last_missed
      FROM matched m
      JOIN users u ON u.id = m.caregiver_id
     GROUP BY 1
     ORDER BY (COUNT(*) FILTER (WHERE m.entry_id IS NULL))::numeric / NULLIF(COUNT(*), 0) DESC, 2 DESC`,
    [from, to])).rows;

  const pct = (a, b) => (b ? Math.round((a / b) * 100) : 0);
  console.table(rows.map(r => ({
    caregiver: r.caregiver,
    scheduled: r.scheduled,
    'clocked in': r.clocked_in,
    'missed': r.missed,
    'clock-in %': pct(r.clocked_in, r.scheduled) + '%',
    'no clock-out': r.no_clock_out,
    'last clock-in': r.last_clock_in || '—',
    'last missed': r.last_missed || '—',
  })));

  const totals = rows.reduce((a, r) => ({ s: a.s + r.scheduled, c: a.c + r.clocked_in, m: a.m + r.missed, o: a.o + r.no_clock_out }), { s: 0, c: 0, m: 0, o: 0 });
  console.log(`\nAgency: ${totals.c}/${totals.s} scheduled visits clocked in (${pct(totals.c, totals.s)}%), ${totals.m} missed, ${totals.o} with no clock-out.`);

  // Clock-ins with no scheduled visit that day (the other direction).
  const extra = (await db.query(`
    WITH ${SCHEDULE_OCCURRENCES_CTE('occ')}
    SELECT TRIM(u.first_name || ' ' || u.last_name) AS caregiver, COUNT(*)::int AS unscheduled_clock_ins
      FROM time_entries t
      JOIN users u ON u.id = t.caregiver_id
     WHERE (t.start_time AT TIME ZONE 'America/Chicago')::date BETWEEN $1::date AND $2::date
       AND NOT EXISTS (SELECT 1 FROM occ WHERE occ.caregiver_id = t.caregiver_id
                        AND occ.client_id = t.client_id
                        AND occ.occ_date = (t.start_time AT TIME ZONE 'America/Chicago')::date)
     GROUP BY 1 ORDER BY 2 DESC`, [from, to])).rows;
  if (extra.length) { console.log('\nClock-ins with no scheduled visit that day:'); console.table(extra); }
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
