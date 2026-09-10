// END-TO-END TEST: a bi-weekly WEEKEND (Sat + Sun) shared by two caregivers.
//
// The 2026-09-10 incident: Alexis created Nicole's bi-weekly Sat+Sun "starting 9/12".
// The calendar normalized the anchor to Sunday 9/6, so the Saturday row sat 6 days after
// its anchor. Postgres truncated 6/7 → 0 (ON), the week grid used Math.round → 1 (OFF).
// Payroll had her on 9/12 + 9/26; the grid painted 9/19 + 10/3. And even where they
// agreed, Sat 9/12 and Sun 9/13 landed on different fortnights because a weekend
// straddles the Sunday week boundary.
//
// This test drives the REAL create + edit endpoints and asks the engine (payroll /
// billing / reports), the week-view route (the grid), the conflict heatmap, and the
// shared JS parity helper (every calendar) the same question — and requires one answer.
//
// Creates throwaway caregiver/client/schedule rows and deletes them in finally{}.
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const request = require('supertest');
const jwt = require('jsonwebtoken');
const app = require('../src/server');
const db = require('../src/db');
const { SCHEDULE_OCCURRENCES_CTE } = require('../src/helpers/scheduleOccurrences');
const { isBiweeklyOn, alignBiweeklyAnchor } = require('../src/helpers/biweekly');

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { console.log(`  OK   ${m}`); pass++; } else { console.log(`  FAIL ${m}`); fail++; } };
const ymd = (v) => (v ? String(v instanceof Date ? v.toISOString() : v).slice(0, 10) : null);

// Future dates only: the v36 trigger clamps a past effective_date forward on INSERT.
// Anchor everything on the first Saturday at least 14 days out.
const base = new Date(); base.setUTCHours(12, 0, 0, 0); base.setUTCDate(base.getUTCDate() + 14);
while (base.getUTCDay() !== 6) base.setUTCDate(base.getUTCDate() + 1);
const addD = (n) => new Date(base.getTime() + n * 86400000).toISOString().slice(0, 10);
const SAT1 = addD(0),  SUN1 = addD(1);     // Nicole's first weekend
const SAT2 = addD(7),  SUN2 = addD(8);     // Maggie's weekend
const SAT3 = addD(14), SUN3 = addD(15);    // Nicole again
const SAT4 = addD(21), SUN4 = addD(22);    // Maggie again
const SUNDAY_OF_WEEK1 = addD(-6);          // the Sunday BEFORE SAT1 — what the old UI sent

// Engine: who is on this client on this date?
async function engine(clId, date) {
  const r = await db.query(
    `WITH ${SCHEDULE_OCCURRENCES_CTE('o')}
     SELECT o.caregiver_id, o.start_time, o.end_time FROM o WHERE o.client_id = $3 AND o.occ_date = $1::date ORDER BY o.start_time`,
    [date, date, clId]);
  return r.rows.map(x => x.caregiver_id);
}
// Week grid: which caregivers does the week-view route put on this date?
async function grid(token, clId, date) {
  const r = await request(app).get(`/api/scheduling/week-view?weekOf=${date}`).set('Authorization', `Bearer ${token}`);
  if (r.status !== 200) throw new Error(`week-view ${r.status}: ${JSON.stringify(r.body)}`);
  const dow = new Date(date + 'T12:00:00Z').getUTCDay();
  const out = [];
  for (const row of r.body.caregivers) {
    for (const item of row.days[dow] || []) if (item.client_id === clId) out.push(row.caregiver.id);
  }
  return out;
}
// Conflict heatmap: hours on this date for a caregiver.
async function heat(token, cgId, date) {
  const r = await request(app).get(`/api/scheduling/conflict-heatmap?weekOf=${date}`).set('Authorization', `Bearer ${token}`);
  if (r.status !== 200) throw new Error(`heatmap ${r.status}: ${JSON.stringify(r.body)}`);
  const cg = r.body.caregivers.find(c => c.id === cgId);
  const day = cg && cg.days.find(d => d.date === date);
  return day ? day.hours : 0;
}
// Every JS calendar: the shared parity helper applied to the stored row.
function jsCal(rows, cgId, date) {
  const dow = new Date(date + 'T12:00:00Z').getUTCDay();
  return rows.filter(s => s.caregiver_id === cgId && s.day_of_week === dow && s.is_active
    && (!s.effective_date || ymd(s.effective_date) <= date) && (!s.end_date || ymd(s.end_date) >= date)
    && (s.frequency !== 'biweekly' || isBiweeklyOn(date, s.anchor_date))).length;
}

(async () => {
  const nicole = (await db.query(`INSERT INTO users (email,password_hash,first_name,last_name,role,is_active) VALUES ('zz-bw-nicole@cvhc.test','x','ZZ','BwNicole','caregiver',true) RETURNING id`)).rows[0].id;
  const maggie = (await db.query(`INSERT INTO users (email,password_hash,first_name,last_name,role,is_active) VALUES ('zz-bw-maggie@cvhc.test','x','ZZ','BwMaggie','caregiver',true) RETURNING id`)).rows[0].id;
  const cl = (await db.query(`INSERT INTO clients (first_name,last_name) VALUES ('ZZ','BwWeekend') RETURNING id`)).rows[0].id;
  const token = jwt.sign({ id: nicole, email: 'zz-bw-nicole@cvhc.test', role: 'admin', name: 'ZZ Admin' }, process.env.JWT_SECRET, { expiresIn: '1h' });
  const POST = (body) => request(app).post('/api/schedules-enhanced').set('Authorization', `Bearer ${token}`).send(body);
  const PUT = (id, body) => request(app).put(`/api/schedules-all/${id}`).set('Authorization', `Bearer ${token}`).send(body);
  const rows = async () => (await db.query(`SELECT * FROM schedules WHERE client_id=$1 AND is_active=true`, [cl])).rows;

  try {
    console.log(`\nWeekend under test: Nicole ${SAT1}/${SUN1} + ${SAT3}/${SUN3}; Maggie ${SAT2}/${SUN2} + ${SAT4}/${SUN4}`);

    // ── TEST 1: the exact request the old UI sent — Sunday-of-week anchor, Sat + Sun.
    console.log('\nTEST 1 — Sat+Sun bi-weekly created with a Sunday-of-week anchor lands on the SAME weekend');
    const nSat = await POST({ caregiverId: nicole, clientId: cl, scheduleType: 'recurring', dayOfWeek: 6, startTime: '08:30', endTime: '10:00', frequency: 'biweekly', effectiveDate: SAT1, anchorDate: SUNDAY_OF_WEEK1 });
    const nSun = await POST({ caregiverId: nicole, clientId: cl, scheduleType: 'recurring', dayOfWeek: 0, startTime: '08:30', endTime: '10:00', frequency: 'biweekly', effectiveDate: SAT1, anchorDate: SUNDAY_OF_WEEK1 });
    ok(nSat.status === 201 && nSun.status === 201, `both rows created (${nSat.status}, ${nSun.status})`);
    ok(ymd(nSat.body.anchor_date) === SAT1, `Saturday row anchored to its first Saturday ${SAT1} (got ${ymd(nSat.body.anchor_date)})`);
    ok(ymd(nSun.body.anchor_date) === SUN1, `Sunday row anchored to its first Sunday ${SUN1} (got ${ymd(nSun.body.anchor_date)})`);

    // ── TEST 2: engine, grid, heatmap and JS calendars all agree on every weekend date.
    console.log('\nTEST 2 — payroll engine, week grid, heatmap and calendar helper give ONE answer');
    const stored = await rows();
    for (const [date, want] of [[SAT1, 1], [SUN1, 1], [SAT2, 0], [SUN2, 0], [SAT3, 1], [SUN3, 1], [SAT4, 0], [SUN4, 0]]) {
      const e = (await engine(cl, date)).filter(id => id === nicole).length;
      const g = (await grid(token, cl, date)).filter(id => id === nicole).length;
      const h = await heat(token, nicole, date);
      const j = jsCal(stored, nicole, date);
      ok(e === want && g === want && j === want && (h > 0) === (want > 0),
        `${date}: engine=${e} grid=${g} heatmap=${h}h calendar=${j} (want ${want})`);
    }

    // ── TEST 3: Maggie was weekly; 'following' converts her to the alternate weekend.
    console.log("\nTEST 3 — weekly → bi-weekly via 'following' takes the OTHER weekend; past weeks untouched");
    const mSatW = await POST({ caregiverId: maggie, clientId: cl, scheduleType: 'recurring', dayOfWeek: 6, startTime: '08:00', endTime: '10:00', frequency: 'weekly', effectiveDate: addD(-14) });
    const mSunW = await POST({ caregiverId: maggie, clientId: cl, scheduleType: 'recurring', dayOfWeek: 0, startTime: '08:00', endTime: '09:00', frequency: 'weekly', effectiveDate: addD(-13) });
    ok(mSatW.status === 201 && mSunW.status === 201, `Maggie's weekly Sat+Sun created (${mSatW.status}, ${mSunW.status})`);
    // (effective_date got clamped to today by the trigger; that is fine — it is before SAT1.)
    // The real operation: Maggie's weekly pattern stops AS OF Nicole's first weekend, and her
    // bi-weekly pattern's first 'on' date is the weekend after (anchorDate = SAT2/SUN2).
    const eSat = await PUT(mSatW.body.id, { scope: 'following', editDate: SAT1, clientId: cl, dayOfWeek: 6, startTime: '08:00', endTime: '10:00', frequency: 'biweekly', anchorDate: SAT2 });
    const eSun = await PUT(mSunW.body.id, { scope: 'following', editDate: SUN1, clientId: cl, dayOfWeek: 0, startTime: '08:00', endTime: '09:00', frequency: 'biweekly', anchorDate: SUN2 });
    ok(eSat.status === 200 && eSun.status === 200, `both edits 200 (${eSat.status}, ${eSun.status})`);
    ok(ymd(eSat.body.anchor_date) === SAT2 && ymd(eSun.body.anchor_date) === SUN2, `new patterns anchored ${SAT2}/${SUN2} (got ${ymd(eSat.body.anchor_date)}/${ymd(eSun.body.anchor_date)})`);
    // Maggie's old weekly rows must have ended the day before, so Nicole's weekend is hers alone.
    const oldSat = (await db.query(`SELECT end_date FROM schedules WHERE id=$1`, [mSatW.body.id])).rows[0];
    ok(ymd(oldSat.end_date) === addD(-1), `old Saturday pattern ends ${addD(-1)}, the day before Nicole's first weekend (got ${ymd(oldSat.end_date)})`);

    console.log('\nTEST 4 — the finished split: each weekend has exactly one caregiver, and everyone agrees who');
    const stored2 = await rows();
    for (const [date, who] of [[SAT1, nicole], [SUN1, nicole], [SAT2, maggie], [SUN2, maggie], [SAT3, nicole], [SUN3, nicole], [SAT4, maggie], [SUN4, maggie]]) {
      const e = await engine(cl, date);
      const g = await grid(token, cl, date);
      const jN = jsCal(stored2, nicole, date), jM = jsCal(stored2, maggie, date);
      const label = who === nicole ? 'Nicole' : 'Maggie';
      ok(e.length === 1 && e[0] === who && g.length === 1 && g[0] === who && (who === nicole ? jN === 1 && jM === 0 : jM === 1 && jN === 0),
        `${date}: ${label} only — engine ${e.length} grid ${g.length} calendar N${jN}/M${jM}`);
    }

    // ── TEST 5: editing the time "from an OFF Saturday onward" must not flip the fortnight.
    console.log("\nTEST 5 — 'following' from an OFF week keeps the pattern's fortnight");
    const flip = await PUT(nSat.body.id, { scope: 'following', editDate: SAT2, clientId: cl, dayOfWeek: 6, startTime: '09:00', endTime: '10:00', frequency: 'biweekly', anchorDate: nSat.body.anchor_date });
    ok(flip.status === 200, `PUT 200 (got ${flip.status})`);
    ok(ymd(flip.body.anchor_date) === SAT3, `new row anchored to the next ON Saturday ${SAT3}, not ${SAT2} (got ${ymd(flip.body.anchor_date)})`);
    ok((await engine(cl, SAT2)).every(id => id !== nicole), `${SAT2} is still Maggie's`);
    ok((await engine(cl, SAT3)).includes(nicole), `${SAT3} is still Nicole's, now at the new time`);

    // ── TEST 6: pure helper parity, incl. dates before the anchor and a legacy Sunday anchor.
    console.log('\nTEST 6 — helper parity matches the SQL engine for dates before AND after the anchor');
    const sql = await db.query(
      `SELECT d::date AS d, (((FLOOR((d::date - $1::date)::numeric / 7)::int % 2) + 2) % 2) = 0 AS on_week
       FROM generate_series($1::date - 21, $1::date + 21, '1 day') d`, [SAT1]);
    let mismatches = 0;
    for (const r of sql.rows) if (isBiweeklyOn(ymd(r.d), SAT1) !== r.on_week) mismatches++;
    ok(mismatches === 0, `0 mismatches across 43 days around the anchor (got ${mismatches})`);
    ok(alignBiweeklyAnchor({ anchorDate: SUNDAY_OF_WEEK1, effectiveDate: SAT1, dayOfWeek: 6 }) === SAT1, 'align: Sunday-of-week anchor + Saturday row → that Saturday');
    ok(alignBiweeklyAnchor({ anchorDate: SUNDAY_OF_WEEK1, effectiveDate: SAT1, dayOfWeek: 0 }) === SUN1, 'align: Sunday-of-week anchor + Sunday row → the Sunday AFTER the start (same weekend)');
  } catch (e) {
    console.error('\nUNEXPECTED ERROR', e);
    fail++;
  } finally {
    await db.query(`DELETE FROM schedule_exceptions WHERE schedule_id IN (SELECT id FROM schedules WHERE client_id=$1)`, [cl]);
    await db.query(`DELETE FROM schedules WHERE client_id=$1`, [cl]);
    await db.query(`DELETE FROM audit_logs WHERE user_id IN ($1,$2)`, [nicole, maggie]).catch(() => {});
    await db.query(`DELETE FROM clients WHERE id=$1`, [cl]);
    await db.query(`DELETE FROM users WHERE id IN ($1,$2)`, [nicole, maggie]);
    console.log(`\n${pass} passed, ${fail} failed`);
    await db.pool.end();
    process.exit(fail ? 1 : 0);
  }
})();
