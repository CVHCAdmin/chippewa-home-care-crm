// Read-only: clock-ins with no scheduled visit for that caregiver + client on that day,
// expanded through the shared schedule engine.
// usage: node audits/diag_unscheduled_clockins.js [days]
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const db = require('../src/db');
const { SCHEDULE_OCCURRENCES_CTE } = require('../src/helpers/scheduleOccurrences');

const DAYS = parseInt(process.argv[2], 10) || 30;

(async () => {
  const { from, to } = (await db.query(
    `SELECT ((NOW() AT TIME ZONE 'America/Chicago')::date - $1::int)::text AS from,
            ((NOW() AT TIME ZONE 'America/Chicago')::date - 1)::text AS to`, [DAYS])).rows[0];
  console.log(`Clock-ins with no scheduled visit, ${from} through ${to} (Central)\n`);

  const r = await db.query(`
    WITH ${SCHEDULE_OCCURRENCES_CTE('occ')}
    SELECT to_char(t.start_time AT TIME ZONE 'America/Chicago', 'Dy MM/DD')        AS the_day,
           to_char(t.start_time AT TIME ZONE 'America/Chicago', 'FMHH12:MI AM')    AS clock_in,
           COALESCE(to_char(t.end_time AT TIME ZONE 'America/Chicago', 'FMHH12:MI AM'), '(none)') AS clock_out,
           ROUND(t.duration_minutes / 60.0, 2)                                     AS hours,
           t.billable_minutes                                                      AS billable_minutes,
           t.needs_approval                                                        AS needs_approval,
           TRIM(u.first_name || ' ' || u.last_name)                                AS caregiver,
           TRIM(c.first_name || ' ' || c.last_name)                                AS client,
           (t.schedule_id IS NOT NULL)                                             AS linked_to_schedule,
           (SELECT COUNT(*) FROM occ o2
             WHERE o2.client_id = t.client_id
               AND o2.occ_date = (t.start_time AT TIME ZONE 'America/Chicago')::date)::int AS visits_scheduled_that_day
      FROM time_entries t
      JOIN users u   ON u.id = t.caregiver_id
      JOIN clients c ON c.id = t.client_id
     WHERE (t.start_time AT TIME ZONE 'America/Chicago')::date BETWEEN $1::date AND $2::date
       AND NOT EXISTS (
             SELECT 1 FROM occ
              WHERE occ.caregiver_id = t.caregiver_id
                AND occ.client_id = t.client_id
                AND occ.occ_date = (t.start_time AT TIME ZONE 'America/Chicago')::date)
     ORDER BY t.start_time`, [from, to]);

  console.table(r.rows.map(x => ({
    date: x.the_day, caregiver: x.caregiver, client: x.client,
    in: x.clock_in, out: x.clock_out, hrs: x.hours,
    'billable min': x.billable_minutes,
    'shift link': x.linked_to_schedule ? 'yes' : 'no',
    'visits scheduled for client that day': x.visits_scheduled_that_day,
  })));
  console.log(`\n${r.rows.length} clock-ins with no matching scheduled visit.`);
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
