// READ-ONLY. Does the DB's CURRENT_DATE (used by the v36 clamp) ever disagree
// with the America/Chicago date the edit endpoint uses as `today`?
// If it does, scope=following can end-date the old pattern at chicagoToday-1
// while the trigger clamps the NEW pattern's effective_date to utcToday,
// leaving chicagoToday uncovered by ANY pattern = a silently vanished shift.
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const db = require('../src/db');

(async () => {
  const r = await db.query(`
    SELECT current_setting('TIMEZONE')                                  AS db_tz,
           NOW()                                                        AS now_raw,
           CURRENT_DATE::text                                           AS current_date_db,
           to_char((NOW() AT TIME ZONE 'America/Chicago')::date,'YYYY-MM-DD') AS chicago_date,
           (CURRENT_DATE::text <> to_char((NOW() AT TIME ZONE 'America/Chicago')::date,'YYYY-MM-DD')) AS disagree_right_now
  `);
  const x = r.rows[0];
  console.log('DB TimeZone setting :', x.db_tz);
  console.log('NOW()               :', x.now_raw);
  console.log('CURRENT_DATE (trigger uses this):', x.current_date_db);
  console.log('Chicago date (endpoint uses this):', x.chicago_date);
  console.log('DISAGREE RIGHT NOW  :', x.disagree_right_now);

  // Simulate across a full day: for which Chicago wall-clock hours do they differ?
  const sim = await db.query(`
    SELECT h,
           to_char((ts AT TIME ZONE 'America/Chicago')::date,'YYYY-MM-DD') AS chicago_d,
           to_char((ts AT TIME ZONE current_setting('TIMEZONE'))::date,'YYYY-MM-DD') AS db_d
    FROM (
      SELECT h, (date_trunc('day', NOW() AT TIME ZONE 'America/Chicago') + make_interval(hours => h))
                 AT TIME ZONE 'America/Chicago' AS ts
      FROM generate_series(0,23) h
    ) q ORDER BY h
  `);
  const bad = sim.rows.filter(r2 => r2.chicago_d !== r2.db_d);
  console.log('\nChicago hours where DB date != Chicago date (=> clamp opens a 1-day gap):');
  if (!bad.length) console.log('  none — DB and Chicago always agree');
  else bad.forEach(b => console.log(`  ${String(b.h).padStart(2, '0')}:00 Chicago  ->  chicago=${b.chicago_d}  db=${b.db_d}`));

  process.exit(0);
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
