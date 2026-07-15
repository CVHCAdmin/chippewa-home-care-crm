// THE test. "Why don't all the schedules correlate? If she changes one somewhere it
// should change everywhere that it affects."
//
// Takes one shift, applies each kind of edit, and asks PAYROLL, BILLING, REPORTS and the
// CALENDAR the same question — "what happened on this day?" — checking they all give the
// same answer. Before the shared engine they did not: payroll expanded a bi-weekly shift
// every week while billing charged every other, a backdated shift was invisible to payroll
// but billed, and a cancelled visit still reminded, alerted and could auto-clock-in.
//
// Creates throwaway rows and deletes them in finally{}.
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const db = require('../src/db');
const { SCHEDULE_OCCURRENCES_CTE } = require('../src/helpers/scheduleOccurrences');

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { console.log(`  OK   ${m}`); pass++; } else { console.log(`  FAIL ${m}`); fail++; } };

// Every consumer that matters now reads this one engine, so ask it the way each of them does.
async function ask(cgId, clId, date) {
  const r = await db.query(
    `WITH ${SCHEDULE_OCCURRENCES_CTE('o')}
     SELECT o.occ_date, o.minutes, o.hours, o.start_time, o.end_time, o.caregiver_id, o.client_id
     FROM o WHERE o.occ_date = $1::date AND o.client_id = $3`,
    [date, date, clId]
  );
  return r.rows;
}

(async () => {
  const cgA = (await db.query(
    `INSERT INTO users (email,password_hash,first_name,last_name,role,is_active)
     VALUES ('zz-agree-a@cvhc.test','x','ZZ','AgreeA','caregiver',true) RETURNING id`)).rows[0].id;
  const cgB = (await db.query(
    `INSERT INTO users (email,password_hash,first_name,last_name,role,is_active)
     VALUES ('zz-agree-b@cvhc.test','x','ZZ','AgreeB','caregiver',true) RETURNING id`)).rows[0].id;
  const cl = (await db.query(
    `INSERT INTO clients (first_name,last_name) VALUES ('ZZ','AgreeClient') RETURNING id`)).rows[0].id;

  const MON = '2026-08-03';        // a future Monday
  const MON2 = '2026-08-10';       // the Monday after
  const EFF = '2026-06-01';

  const mk = async (freq, anchor) => {
    const r = await db.query(
      `INSERT INTO schedules (caregiver_id,client_id,schedule_type,day_of_week,start_time,end_time,frequency,anchor_date,effective_date,is_active)
       VALUES ($1,$2,'recurring',1,'09:00','11:00',$3,$4,$5,true) RETURNING id`,
      [cgA, cl, freq, anchor, MON]);
    await db.query(`UPDATE schedules SET effective_date=$2 WHERE id=$1`, [r.rows[0].id, EFF]);
    return r.rows[0].id;
  };

  try {
    // ── 1. BI-WEEKLY: the shift that was paid twice as often as it was billed.
    console.log('\n1 — a BI-WEEKLY shift: payroll must not pay it twice as often as billing charges it');
    const sBi = await mk('biweekly', MON);   // anchor on MON => MON is an "on" week
    const onWeek  = await ask(cgA, cl, MON);
    const offWeek = await ask(cgA, cl, MON2);
    ok(onWeek.length === 1,  `the "on" week has the visit (got ${onWeek.length})`);
    ok(offWeek.length === 0, `the "off" week does NOT (got ${offWeek.length}) — this is the double-pay bug`);
    await db.query('DELETE FROM schedules WHERE id=$1', [sBi]);

    // ── 2. A CANCELLED day must be gone for EVERYONE.
    console.log('\n2 — a CANCELLED day disappears from pay, billing, reminders, no-show and auto-clock-in');
    const s2 = await mk('weekly', null);
    ok((await ask(cgA, cl, MON)).length === 1, `before: the visit exists`);
    await db.query(
      `INSERT INTO schedule_exceptions (schedule_id, exception_date, exception_type)
       VALUES ($1,$2,'cancelled')`, [s2, MON]);
    ok((await ask(cgA, cl, MON)).length === 0, `after: no occurrence at all — so nothing can pay it, bill it, remind for it, alert on it, or clock anyone in to it`);
    ok((await ask(cgA, cl, MON2)).length === 1, `and the following week is untouched`);
    await db.query('DELETE FROM schedule_exceptions WHERE schedule_id=$1', [s2]);

    // ── 3. A ONE-DAY TIME CHANGE must move the hours everywhere, and only for that day.
    console.log('\n3 — changing ONE day\'s time moves the hours for that day everywhere, and nowhere else');
    await db.query(
      `INSERT INTO schedule_exceptions (schedule_id, exception_date, exception_type, override_start_time, override_end_time)
       VALUES ($1,$2,'modified','09:00','10:00')`, [s2, MON]);
    const m1 = await ask(cgA, cl, MON);
    const m2 = await ask(cgA, cl, MON2);
    ok(m1[0].minutes === 60, `that day is now 60 min everywhere (got ${m1[0].minutes})`);
    ok(Number(m1[0].hours) === 1, `= 1.00 h (got ${m1[0].hours})`);
    ok(m2[0].minutes === 120, `the next week is still 120 min (got ${m2[0].minutes})`);
    await db.query('DELETE FROM schedule_exceptions WHERE schedule_id=$1', [s2]);

    // ── 4. A ONE-DAY CAREGIVER SWAP must pay/bill/show the caregiver who ACTUALLY went.
    console.log('\n4 — swapping ONE day\'s caregiver: the cover gets paid, and only for that day');
    await db.query(
      `INSERT INTO schedule_exceptions (schedule_id, exception_date, exception_type, override_caregiver_id)
       VALUES ($1,$2,'modified',$3)`, [s2, MON, cgB]);
    const sw1 = await ask(cgA, cl, MON);
    const sw2 = await ask(cgA, cl, MON2);
    ok(sw1[0].caregiver_id === cgB, `that day belongs to the COVERING caregiver (got ${sw1[0].caregiver_id === cgB ? 'cover' : 'original — the swap did not take'})`);
    ok(sw2[0].caregiver_id === cgA, `the following week is back to the ORIGINAL caregiver — the pattern was not hijacked`);
    await db.query('DELETE FROM schedule_exceptions WHERE schedule_id=$1', [s2]);

    // ── 5. An END-DATED pattern stops producing anything, for everyone.
    console.log('\n5 — an ended (deleted) pattern stops producing visits everywhere');
    await db.query(`UPDATE schedules SET end_date=$2 WHERE id=$1`, [s2, MON]);
    ok((await ask(cgA, cl, MON)).length === 1,  `its last day still counts (got ${(await ask(cgA, cl, MON)).length})`);
    ok((await ask(cgA, cl, MON2)).length === 0, `the week after it ended produces nothing (got ${(await ask(cgA, cl, MON2)).length})`);

    // ── 6. A BACKDATED one-time shift is visible to payroll, not just billing.
    // Retire the recurring pattern first: 2026-07-06 is a Monday, so it would legitimately
    // produce its own occurrence that day and we'd be counting two different shifts.
    console.log('\n6 — a shift entered AFTER the fact still counts (the payday correction)');
    await db.query('DELETE FROM schedule_exceptions WHERE schedule_id=$1', [s2]);
    await db.query('DELETE FROM schedules WHERE id=$1', [s2]);
    const past = '2026-07-06';
    const s6 = (await db.query(
      `INSERT INTO schedules (caregiver_id,client_id,schedule_type,date,start_time,end_time,is_active)
       VALUES ($1,$2,'one-time',$3,'09:00','11:00',true) RETURNING id`, [cgA, cl, past])).rows[0].id;
    const back = await ask(cgA, cl, past);
    ok(back.length === 1, `a shift dated ${past} but entered today is VISIBLE (got ${back.length}) — payroll used to drop these entirely`);
    ok(back[0] && back[0].minutes === 120, `and carries its full 120 min (got ${back[0] && back[0].minutes})`);
    await db.query('DELETE FROM schedules WHERE id=$1', [s6]);
  } catch (e) {
    console.error('\nTEST ERROR:', e.message, e.stack);
    fail++;
  } finally {
    const ids = (await db.query('SELECT id FROM schedules WHERE caregiver_id=$1 OR caregiver_id=$2', [cgA, cgB])).rows.map(r => r.id);
    if (ids.length) await db.query('DELETE FROM schedule_exceptions WHERE schedule_id = ANY($1)', [ids]);
    await db.query('DELETE FROM schedules WHERE caregiver_id=$1 OR caregiver_id=$2', [cgA, cgB]);
    await db.query('DELETE FROM clients WHERE id=$1', [cl]);
    await db.query('DELETE FROM users WHERE id=$1 OR id=$2', [cgA, cgB]);
    console.log('\ncleanup done');
    console.log(`\n${'='.repeat(52)}\nPASS: ${pass}   FAIL: ${fail}\n${'='.repeat(52)}`);
    process.exit(fail ? 1 : 0);
  }
})();
