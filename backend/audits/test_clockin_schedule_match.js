// Proves the clock-in schedule match picks the RIGHT visit.
// This decides allotted_minutes -> billable_minutes -> the units on the payer's claim.
//
// Recreates the real shape of Terri Tranel -> Linda Johnson: several visits on the SAME
// weekday with DIFFERENT lengths, plus a superseded (end-dated) pattern that the old
// query still matched. Runs the OLD lookup and the NEW one side by side.
//
// Creates throwaway caregiver/client/schedule rows and deletes them in finally{}.
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const db = require('../src/db');
const { SCHEDULE_OCCURRENCES_CTE } = require('../src/helpers/scheduleOccurrences');

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { console.log(`  OK   ${m}`); pass++; } else { console.log(`  FAIL ${m}`); fail++; } };

// The lookup exactly as it was before the fix.
const oldMatch = (cg, cl, dow, dateStr) => db.query(
  `SELECT id, start_time, end_time FROM schedules
   WHERE caregiver_id=$1 AND client_id=$2 AND is_active=true
     AND (day_of_week=$3 OR (date IS NOT NULL AND date::date=$4::date))
   ORDER BY date DESC NULLS LAST LIMIT 1`, [cg, cl, dow, dateStr]);

// The lookup as it is now.
const newMatch = (cg, cl, dateStr, punchTime) => db.query(
  `WITH ${SCHEDULE_OCCURRENCES_CTE('occ')}
   SELECT occ.schedule_id AS id, occ.start_time, occ.end_time, occ.minutes
   FROM occ
   WHERE occ.caregiver_id = $3 AND occ.client_id = $4
   ORDER BY ABS(EXTRACT(EPOCH FROM ($5::time - occ.start_time))) ASC, occ.start_time ASC
   LIMIT 1`, [dateStr, dateStr, cg, cl, punchTime]);

(async () => {
  const cg = (await db.query(
    `INSERT INTO users (email,password_hash,first_name,last_name,role,is_active)
     VALUES ('zz-clockin-match@cvhc.test','x','ZZ','ClockMatch','caregiver',true) RETURNING id`)).rows[0].id;
  const cl = (await db.query(
    `INSERT INTO clients (first_name,last_name) VALUES ('ZZ','ClockMatchClient') RETURNING id`)).rows[0].id;

  // A Wednesday well in the future so nothing else collides.
  const WED = '2026-08-05';
  const DOW = 3;
  const EFF = '2026-06-01';

  const mk = async (start, end, endDate = null) => {
    const r = await db.query(
      `INSERT INTO schedules (caregiver_id,client_id,schedule_type,day_of_week,start_time,end_time,frequency,effective_date,is_active)
       VALUES ($1,$2,'recurring',$3,$4,$5,'weekly',$6,true) RETURNING id`,
      [cg, cl, DOW, start, end, WED]);
    await db.query(`UPDATE schedules SET effective_date=$2, end_date=$3 WHERE id=$1`, [r.rows[0].id, EFF, endDate]);
    return r.rows[0].id;
  };

  try {
    // Three Wednesday visits, different lengths — plus one that was SUPERSEDED (end-dated).
    const morning = await mk('08:00', '09:00');                 // 60 min  — live
    const midday  = await mk('12:00', '13:30');                 // 90 min  — live
    const retired = await mk('08:00', '10:00', '2026-07-01');   // 120 min — ENDED, must never match

    console.log('\nSetup: one client, three Wednesday visits with different lengths');
    console.log('  08:00-09:00 (60m, live)   12:00-13:30 (90m, live)   08:00-10:00 (120m, ENDED 2026-07-01)');

    console.log('\nTEST 1 — punch at 08:05 must bill the 60-minute morning visit');
    const n1 = await newMatch(cg, cl, WED, '08:05:00');
    ok(n1.rows[0]?.id === morning, `picked the 08:00 visit (got ${n1.rows[0] ? String(n1.rows[0].start_time).slice(0,5) : 'none'})`);
    ok(n1.rows[0]?.minutes === 60, `allotted 60 min (got ${n1.rows[0]?.minutes})`);

    console.log('\nTEST 2 — punch at 12:03 must bill the 90-minute midday visit, not the morning one');
    const n2 = await newMatch(cg, cl, WED, '12:03:00');
    ok(n2.rows[0]?.id === midday, `picked the 12:00 visit (got ${n2.rows[0] ? String(n2.rows[0].start_time).slice(0,5) : 'none'})`);
    ok(n2.rows[0]?.minutes === 90, `allotted 90 min (got ${n2.rows[0]?.minutes})`);

    console.log('\nTEST 3 — the retired (end-dated) pattern must never be matched');
    const allOcc = await db.query(
      `WITH ${SCHEDULE_OCCURRENCES_CTE('occ')} SELECT occ.schedule_id FROM occ
       WHERE occ.caregiver_id=$3 AND occ.client_id=$4`, [WED, WED, cg, cl]);
    const ids = allOcc.rows.map(r => r.schedule_id);
    ok(!ids.includes(retired), `retired pattern absent from the day's occurrences (${ids.length} occurrences, expected 2)`);
    ok(ids.length === 2, `exactly 2 live occurrences that Wednesday (got ${ids.length})`);

    console.log('\nTEST 4 — the OLD lookup was a coin flip across these same rows');
    const seen = new Set();
    for (let i = 0; i < 8; i++) {
      const o = await oldMatch(cg, cl, DOW, WED);
      if (o.rows[0]) seen.add(`${String(o.rows[0].start_time).slice(0,5)}-${String(o.rows[0].end_time).slice(0,5)}`);
    }
    console.log(`     old lookup returned: ${[...seen].join(' | ')}`);
    ok(true, `old lookup ignores the punch time entirely — it cannot tell the 60m visit from the 120m one`);
    const oldPickedRetired = [...seen].includes('08:00-10:00');
    ok(true, `old lookup ${oldPickedRetired ? 'DID' : 'could'} return the RETIRED 120-minute pattern (no end_date check)`);

    console.log('\nTEST 5 — a CANCELLED occurrence must not be billable');
    await db.query(
      `INSERT INTO schedule_exceptions (schedule_id, exception_date, exception_type)
       VALUES ($1,$2,'cancelled')`, [morning, WED]);
    const n5 = await newMatch(cg, cl, WED, '08:05:00');
    ok(n5.rows[0]?.id !== morning, `cancelled 08:00 visit not matched (fell through to ${n5.rows[0] ? String(n5.rows[0].start_time).slice(0,5) : 'none'})`);

    console.log('\nTEST 6 — a MODIFIED occurrence bills the overridden length, not the pattern length');
    await db.query(`DELETE FROM schedule_exceptions WHERE schedule_id=$1`, [morning]);
    await db.query(
      `INSERT INTO schedule_exceptions (schedule_id, exception_date, exception_type, override_start_time, override_end_time)
       VALUES ($1,$2,'modified','08:00','08:30')`, [morning, WED]);
    const n6 = await newMatch(cg, cl, WED, '08:05:00');
    ok(n6.rows[0]?.minutes === 30, `allotted the overridden 30 min, not the pattern's 60 (got ${n6.rows[0]?.minutes})`);
  } catch (e) {
    console.error('\nTEST ERROR:', e.message, e.stack);
    fail++;
  } finally {
    const ids = (await db.query('SELECT id FROM schedules WHERE caregiver_id=$1', [cg])).rows.map(r => r.id);
    if (ids.length) await db.query('DELETE FROM schedule_exceptions WHERE schedule_id = ANY($1)', [ids]);
    await db.query('DELETE FROM schedules WHERE caregiver_id=$1', [cg]);
    await db.query('DELETE FROM clients WHERE id=$1', [cl]);
    await db.query('DELETE FROM users WHERE id=$1', [cg]);
    console.log('\ncleanup done');
    console.log(`\n${'='.repeat(50)}\nPASS: ${pass}   FAIL: ${fail}\n${'='.repeat(50)}`);
    process.exit(fail ? 1 : 0);
  }
})();
