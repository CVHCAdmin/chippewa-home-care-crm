// APPLY (one transaction, verified before COMMIT): split Becky Tharp's weekend between
// Nicole Schick and Maggie Ruff, alternating weekends, starting Sat 2026-09-12 with Nicole.
//
// Context (2026-09-10): Alexis tried to enter this through the UI four times; the bi-weekly
// anchor was normalized to Sunday 9/6 so the calendar painted Nicole on 9/19 + 10/3 while
// payroll had 9/12 + 9/26, and she deleted every attempt. All of those rows are already
// is_active=false. This writes the rows the (now fixed) create/edit endpoints would write:
//
//   Nicole  Sat 08:30–10:00 bi-weekly, effective+anchor 2026-09-12   (9/12, 9/26, 10/10 …)
//   Nicole  Sun 08:30–10:00 bi-weekly, effective+anchor 2026-09-13   (9/13, 9/27, 10/11 …)
//   Maggie  Sat 08:00–10:00 weekly row 0bb38bf1 ends 2026-09-11; new bi-weekly row
//           effective+anchor 2026-09-19                                (9/19, 10/3, 10/17 …)
//   Maggie  Sun 08:00–09:00 weekly row 167b9b10 ends 2026-09-12; new bi-weekly row
//           effective+anchor 2026-09-20                                (9/20, 10/4, 10/18 …)
//
// Times for Nicole are the 08:30–10:00 Alexis entered on every attempt. Maggie's history
// (every weekend she already worked) is preserved: her old rows are end-dated, not deleted.
//
// Run with DRY_RUN=1 to see the verification and roll back.
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const db = require('../src/db');
const { SCHEDULE_OCCURRENCES_CTE } = require('../src/helpers/scheduleOccurrences');
const { alignBiweeklyAnchor } = require('../src/helpers/biweekly');

const CLIENT  = '0dab5370-d6a5-4fe9-91f8-ce7de61c9fdf'; // Rebecca "Becky" Tharp
const NICOLE  = '5c14f71f-f5a4-47d9-a821-69211bd15562';
const MAGGIE  = 'f7520d68-7a3c-4538-892c-ca69f286a370';
const ADMIN   = 'c56897c9-c22c-4aa5-bafa-bb9b9aef41a7'; // Alexis — the only admin account; audit rows tagged reason_code below
const REASON  = 'weekend_split_claude_2026-09-10';
const MAGGIE_SAT = '0bb38bf1-5a4a-4587-8f16-ac2682d64794';
// Maggie's Sun row is 167b9b10-… (matched by prefix + caregiver/client/dow below)
const DRY = !!process.env.DRY_RUN;

(async () => {
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    const q = (t, p) => client.query(t, p);
    const audit = (action, recordId, oldData, newData) => q(
      `INSERT INTO audit_logs (user_id, action, table_name, record_id, old_data, new_data, reason_code) VALUES ($1,$2,'schedules',$3,$4,$5,$6)`,
      [ADMIN, action, recordId, oldData ? JSON.stringify(oldData) : null, JSON.stringify(newData), REASON]);

    // Sanity: nothing active for Nicole on this client yet; Maggie's weekend rows are what we think.
    const nicoleActive = (await q(`SELECT id FROM schedules WHERE caregiver_id=$1 AND client_id=$2 AND is_active`, [NICOLE, CLIENT])).rows;
    if (nicoleActive.length) throw new Error(`Nicole already has ${nicoleActive.length} active row(s) on Becky — aborting`);
    const mag = (await q(`SELECT * FROM schedules WHERE caregiver_id=$1 AND client_id=$2 AND is_active AND day_of_week IN (0,6) AND end_date IS NULL`, [MAGGIE, CLIENT])).rows;
    const magSat = mag.find(r => r.day_of_week === 6), magSun = mag.find(r => r.day_of_week === 0);
    if (!magSat || !magSun || mag.length !== 2) throw new Error(`expected exactly one open Sat + one open Sun row for Maggie, found ${mag.length}`);
    if (magSat.id !== MAGGIE_SAT) throw new Error(`Maggie Sat row id ${magSat.id} != expected ${MAGGIE_SAT}`);
    if (!magSat.id.startsWith('0bb38bf1') || !magSun.id.startsWith('167b9b10')) throw new Error(`Maggie rows are not the expected ones (${magSat.id}, ${magSun.id})`);
    if (magSat.frequency !== 'weekly' || magSun.frequency !== 'weekly') throw new Error('Maggie rows are not weekly');
    console.log(`Maggie Sat ${magSat.id.slice(0,8)} ${magSat.start_time}-${magSat.end_time}, Sun ${magSun.id.slice(0,8)} ${magSun.start_time}-${magSun.end_time}`);

    // ── Nicole: two new bi-weekly rows
    const nicoleRows = [];
    for (const [dow, eff] of [[6, '2026-09-12'], [0, '2026-09-13']]) {
      const anchor = alignBiweeklyAnchor({ anchorDate: '2026-09-12', effectiveDate: eff, dayOfWeek: dow });
      if (anchor !== eff) throw new Error(`anchor ${anchor} != ${eff}`);
      const r = (await q(
        `INSERT INTO schedules (caregiver_id, client_id, schedule_type, day_of_week, date, start_time, end_time, notes, frequency, effective_date, anchor_date, is_training, is_active)
         VALUES ($1,$2,'recurring',$3,NULL,'08:30','10:00',NULL,'biweekly',$4,$5,false,true) RETURNING *`,
        [NICOLE, CLIENT, dow, eff, anchor])).rows[0];
      await audit('CREATE', r.id, null, { ...r, _note: 'Nicole/Maggie alternate-weekend split for Becky Tharp; Nicole starts 9/12' });
      nicoleRows.push(r);
    }

    // ── Maggie: end each weekly row the day before Nicole's first weekend, start a bi-weekly
    //    twin one weekend later (same mechanics as PUT /api/schedules-all scope=following).
    const allCols = (await q(`SELECT column_name FROM information_schema.columns WHERE table_name='schedules'`)).rows
      .map(r => r.column_name).filter(c => !['id', 'created_at', 'updated_at'].includes(c));
    const maggieRows = [];
    for (const [old, endOn, newEff] of [[magSat, '2026-09-11', '2026-09-19'], [magSun, '2026-09-12', '2026-09-20']]) {
      const anchor = alignBiweeklyAnchor({ anchorDate: newEff, effectiveDate: newEff, dayOfWeek: old.day_of_week });
      if (anchor !== newEff) throw new Error(`anchor ${anchor} != ${newEff}`);
      await q(`UPDATE schedules SET end_date=$2::date, updated_at=NOW() WHERE id=$1`, [old.id, endOn]);
      const overrides = { frequency: 'biweekly', anchor_date: anchor, effective_date: newEff, end_date: null };
      const vals = allCols.map(c => (overrides[c] !== undefined ? overrides[c] : old[c]));
      const ins = (await q(`INSERT INTO schedules (${allCols.join(',')}) VALUES (${allCols.map((_, i) => `$${i + 1}`).join(',')}) RETURNING *`, vals)).rows[0];
      // v36 trigger clamps effective_date on INSERT only when it is in the past; restate anyway (no-op).
      const fixed = (await q(`UPDATE schedules SET effective_date=$2::date WHERE id=$1 RETURNING *`, [ins.id, newEff])).rows[0];
      await audit('UPDATE', old.id, old, { scope: 'following', endedOn: newEff, replacedBy: fixed.id, newPattern: fixed, _note: 'Maggie weekly → alternate weekends (bi-weekly) so Nicole takes 9/12-13, 9/26-27, …' });
      maggieRows.push(fixed);
    }

    // ── Verify with THE engine before committing
    const occ = (await q(
      `WITH ${SCHEDULE_OCCURRENCES_CTE('o')}
       SELECT o.occ_date::text AS d, to_char(o.occ_date,'Dy') AS dow, u.first_name AS cg, o.start_time, o.end_time
       FROM o JOIN users u ON u.id=o.caregiver_id
       WHERE o.client_id=$3 AND EXTRACT(DOW FROM o.occ_date) IN (0,6)
       ORDER BY o.occ_date`, ['2026-09-05', '2026-11-01', CLIENT])).rows;
    console.log('\nWeekend coverage for Becky, 9/5 → 11/1 (engine = payroll/billing/calendar):');
    for (const o of occ) console.log(`  ${o.d} ${o.dow}  ${o.cg.padEnd(7)} ${String(o.start_time).slice(0,5)}-${String(o.end_time).slice(0,5)}`);
    const expect = {
      '2026-09-05': 'Maggie', '2026-09-06': 'Maggie',
      '2026-09-12': 'Nicole', '2026-09-13': 'Nicole', '2026-09-19': 'Maggie', '2026-09-20': 'Maggie',
      '2026-09-26': 'Nicole', '2026-09-27': 'Nicole', '2026-10-03': 'Maggie', '2026-10-04': 'Maggie',
      '2026-10-10': 'Nicole', '2026-10-11': 'Nicole', '2026-10-17': 'Maggie', '2026-10-18': 'Maggie',
      '2026-10-24': 'Nicole', '2026-10-25': 'Nicole', '2026-10-31': 'Maggie', '2026-11-01': 'Maggie',
    };
    const byDate = {}; for (const o of occ) (byDate[o.d] = byDate[o.d] || []).push(o.cg);
    let bad = 0;
    for (const [d, who] of Object.entries(expect)) {
      const got = byDate[d] || [];
      if (got.length !== 1 || got[0] !== who) { bad++; console.log(`  MISMATCH ${d}: want ${who}, got [${got.join(', ')}]`); }
    }
    for (const d of Object.keys(byDate)) if (!expect[d]) { bad++; console.log(`  UNEXPECTED ${d}: ${byDate[d]}`); }
    if (bad) throw new Error(`${bad} verification mismatch(es) — rolling back`);
    console.log('\nVerification: every weekend 9/5–11/1 has exactly the expected caregiver.');

    if (DRY) { await client.query('ROLLBACK'); console.log('DRY_RUN — rolled back'); }
    else {
      await client.query('COMMIT');
      console.log('COMMITTED');
      console.log('Nicole rows:', nicoleRows.map(r => r.id).join(', '));
      console.log('Maggie new rows:', maggieRows.map(r => r.id).join(', '), '(old rows end-dated:', MAGGIE_SAT, magSun.id + ')');
    }
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('ROLLED BACK:', e.message);
    process.exitCode = 1;
  } finally {
    client.release();
    await db.pool.end();
  }
})();
