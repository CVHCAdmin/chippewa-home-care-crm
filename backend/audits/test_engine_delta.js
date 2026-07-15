// READ-ONLY. Runs the OLD expansion and the NEW shared engine side by side over real
// weeks and diffs the scheduled hours per caregiver. Every difference must be
// explainable by one of the three intended fixes:
//   (1) bi-weekly no longer expanded every week
//   (2) backdated one-time shifts no longer dropped
//   (3) exception-resolved caregiver/client/times
// Anything else is an unintended regression.
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const db = require('../src/db');
const { SCHEDULE_OCCURRENCES_CTE } = require('../src/helpers/scheduleOccurrences');

// The expansion exactly as it was before this change (schedule_type-keyed).
const OLD_CTE = `
  old_occ AS (
    SELECT s.id AS schedule_id, s.caregiver_id, s.client_id, d.dt::date AS occ_date,
      (EXTRACT(EPOCH FROM (COALESCE(se.override_end_time, s.end_time) - COALESCE(se.override_start_time, s.start_time))) / 3600.0
        + CASE WHEN COALESCE(se.override_end_time, s.end_time) < COALESCE(se.override_start_time, s.start_time) THEN 24 ELSE 0 END) AS hours
    FROM schedules s
    CROSS JOIN generate_series($1::date, $2::date, '1 day'::interval) AS d(dt)
    LEFT JOIN schedule_exceptions se ON se.schedule_id = s.id AND se.exception_date = d.dt::date
    WHERE s.is_active = true
      AND (
        (s.schedule_type = 'one-time' AND s.date = d.dt::date)
        OR (s.schedule_type = 'recurring' AND s.day_of_week = EXTRACT(DOW FROM d.dt)::int)
        OR (s.schedule_type = 'bi-weekly' AND s.day_of_week = EXTRACT(DOW FROM d.dt)::int
            AND MOD(((d.dt::date - COALESCE(s.anchor_date, s.effective_date, s.created_at::date))::int / 7), 2) = 0)
        OR (s.schedule_type = 'multi-day' AND s.date IS NOT NULL AND s.date = d.dt::date)
      )
      AND d.dt::date >= COALESCE(s.effective_date, s.created_at::date)
      AND (s.end_date IS NULL OR d.dt::date <= s.end_date)
      AND (se.id IS NULL OR se.exception_type != 'cancelled')
  )
`;

const WEEKS = [
  ['2026-06-07', '2026-06-13'],
  ['2026-06-14', '2026-06-20'],
  ['2026-06-21', '2026-06-27'],
  ['2026-06-28', '2026-07-04'],
  ['2026-07-05', '2026-07-11'],
];

(async () => {
  let totalOld = 0, totalNew = 0;
  for (const [start, end] of WEEKS) {
    const r = await db.query(
      `WITH ${OLD_CTE}, ${SCHEDULE_OCCURRENCES_CTE('new_occ')},
       o AS (SELECT caregiver_id, SUM(hours) h FROM old_occ GROUP BY 1),
       n AS (SELECT caregiver_id, SUM(hours) h FROM new_occ GROUP BY 1)
       SELECT COALESCE(u.first_name||' '||u.last_name,'?') AS cg,
              COALESCE(o.h,0) AS old_h, COALESCE(n.h,0) AS new_h,
              COALESCE(n.h,0) - COALESCE(o.h,0) AS delta
       FROM o FULL OUTER JOIN n ON n.caregiver_id = o.caregiver_id
       LEFT JOIN users u ON u.id = COALESCE(o.caregiver_id, n.caregiver_id)
       WHERE COALESCE(n.h,0) <> COALESCE(o.h,0)
       ORDER BY ABS(COALESCE(n.h,0) - COALESCE(o.h,0)) DESC`,
      [start, end]
    );
    const tot = await db.query(
      `WITH ${OLD_CTE}, ${SCHEDULE_OCCURRENCES_CTE('new_occ')}
       SELECT (SELECT COALESCE(SUM(hours),0) FROM old_occ) AS old_t,
              (SELECT COALESCE(SUM(hours),0) FROM new_occ) AS new_t`,
      [start, end]
    );
    const { old_t, new_t } = tot.rows[0];
    totalOld += Number(old_t); totalNew += Number(new_t);
    console.log(`\n=== week ${start} .. ${end} ===`);
    console.log(`  total scheduled hours:  OLD ${Number(old_t).toFixed(2)}  ->  NEW ${Number(new_t).toFixed(2)}  (${(Number(new_t) - Number(old_t)) >= 0 ? '+' : ''}${(Number(new_t) - Number(old_t)).toFixed(2)})`);
    if (!r.rows.length) { console.log('  no per-caregiver differences'); continue; }
    r.rows.forEach(x => console.log(
      `    ${String(x.cg).padEnd(22)} ${Number(x.old_h).toFixed(2).padStart(7)} -> ${Number(x.new_h).toFixed(2).padStart(7)}   ${Number(x.delta) >= 0 ? '+' : ''}${Number(x.delta).toFixed(2)}`));
  }

  console.log(`\n${'='.repeat(62)}`);
  console.log(`5-week total:  OLD ${totalOld.toFixed(2)}h  ->  NEW ${totalNew.toFixed(2)}h  (${(totalNew - totalOld) >= 0 ? '+' : ''}${(totalNew - totalOld).toFixed(2)}h)`);
  console.log(`${'='.repeat(62)}`);
  process.exit(0);
})().catch(e => { console.error('ERR', e.message, e.stack); process.exit(1); });
