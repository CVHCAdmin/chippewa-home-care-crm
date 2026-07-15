// Proves the v36 clamp silently moves a NEW pattern's effective_date forward when
// the DB's CURRENT_DATE is ahead of the Chicago date (every evening 19:00-23:59 CDT,
// because prod Postgres runs UTC).
//
// We can't wait until 7pm, so we reproduce the exact condition by pinning ONE session's
// timezone ahead of Chicago (Pacific/Auckland). The trigger reads CURRENT_DATE from the
// session timezone, so this is mechanically identical to what prod does after 7pm.
//
// Creates one throwaway caregiver/client/schedule and deletes them in finally{}.
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const db = require('../src/db');

(async () => {
  const c = await db.pool.connect();
  let cg, cl;
  try {
    cg = (await c.query(
      `INSERT INTO users (email,password_hash,first_name,last_name,role,is_active)
       VALUES ('zz-clamp-repro@cvhc.test','x','ZZ','ClampRepro','caregiver',true) RETURNING id`)).rows[0].id;
    cl = (await c.query(`INSERT INTO clients (first_name,last_name) VALUES ('ZZ','ClampRepro') RETURNING id`)).rows[0].id;

    // Pin this session ahead of Chicago -> mimics prod-UTC after 19:00 Chicago.
    await c.query(`SET TIME ZONE 'Pacific/Auckland'`);
    const t = (await c.query(
      `SELECT CURRENT_DATE::text AS db_today,
              to_char((NOW() AT TIME ZONE 'America/Chicago')::date,'YYYY-MM-DD') AS chi_today`)).rows[0];
    console.log(`session CURRENT_DATE (what the trigger compares against): ${t.db_today}`);
    console.log(`Chicago date (what the endpoint passes as effective_date): ${t.chi_today}`);
    if (t.db_today === t.chi_today) { console.log('\n(!) dates agree in this session — repro inconclusive'); return; }

    // Exactly what the scope=following branch INSERTs: effective_date = Chicago today.
    const ins = (await c.query(
      `INSERT INTO schedules (caregiver_id, client_id, schedule_type, day_of_week, start_time, end_time,
                              frequency, effective_date, is_active)
       VALUES ($1,$2,'recurring',1,'09:00','11:00','weekly',$3::date,true)
       RETURNING id, to_char(effective_date,'YYYY-MM-DD') AS eff`,
      [cg, cl, t.chi_today])).rows[0];

    console.log(`\nendpoint asked for effective_date = ${t.chi_today}`);
    console.log(`row actually stored effective_date = ${ins.eff}`);

    if (ins.eff !== t.chi_today) {
      console.log(`\n*** BUG CONFIRMED ***`);
      console.log(`The trigger clamped the new pattern forward to ${ins.eff}.`);
      console.log(`scope=following would have end-dated the OLD pattern at ${t.chi_today} minus 1 day,`);
      console.log(`so ${t.chi_today} is covered by NEITHER pattern -> that day's shift vanishes.`);
    } else {
      console.log(`\nno clamp occurred — effective_date survived intact.`);
    }

    // And confirm the sanctioned escape hatch: UPDATE is exempt from the clamp.
    const upd = (await c.query(
      `UPDATE schedules SET effective_date=$2::date WHERE id=$1
       RETURNING to_char(effective_date,'YYYY-MM-DD') AS eff`, [ins.id, t.chi_today])).rows[0];
    console.log(`\nafter a follow-up UPDATE to ${t.chi_today}: stored = ${upd.eff}  ` +
                `(${upd.eff === t.chi_today ? 'UPDATE is NOT clamped -> viable fix' : 'UPDATE also clamped'})`);
  } catch (e) {
    console.error('ERR', e.message);
  } finally {
    if (cg) {
      await c.query('DELETE FROM schedules WHERE caregiver_id=$1', [cg]);
      await c.query('DELETE FROM users WHERE id=$1', [cg]);
    }
    if (cl) await c.query('DELETE FROM clients WHERE id=$1', [cl]);
    c.release();
    console.log('\ncleanup done (throwaway rows removed)');
    process.exit(0);
  }
})();
