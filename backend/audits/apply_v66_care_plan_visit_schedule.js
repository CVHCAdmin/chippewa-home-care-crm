// Applies migration_v66_care_plan_visit_schedule.sql and confirms the live result:
// both new columns on care_plans and care_plan_revisions, and the revision trigger
// watching visit_schedule. Additive only; existing rows get NULL.
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const fs = require('fs');
const path = require('path');
const db = require('../src/db');

(async () => {
  const c = await db.pool.connect();
  try {
    await c.query(fs.readFileSync(path.join(__dirname, '..', 'migration_v66_care_plan_visit_schedule.sql'), 'utf8'));
    console.log('migration applied');

    const cols = await c.query(`
      SELECT table_name, column_name, data_type FROM information_schema.columns
       WHERE table_name IN ('care_plans', 'care_plan_revisions')
         AND column_name IN ('visit_schedule', 'visit_schedule_as_of')
       ORDER BY 1, 2`);
    cols.rows.forEach(r => console.log(' ', r.table_name, r.column_name, r.data_type));
    if (cols.rows.length !== 4) throw new Error('expected 4 new columns');

    const trg = await c.query(`SELECT pg_get_triggerdef(oid) AS d FROM pg_trigger WHERE tgname = 'trg_snapshot_care_plan'`);
    if (!/visit_schedule/.test(trg.rows[0]?.d || '')) throw new Error('trigger does not watch visit_schedule');
    const fn = await c.query(`SELECT pg_get_functiondef('snapshot_care_plan_on_update'::regproc) AS d`);
    if (!/OLD\.visit_schedule_as_of/.test(fn.rows[0].d)) throw new Error('snapshot function does not copy visit_schedule_as_of');
    console.log('trigger + function: OK');
  } catch (e) {
    try { await c.query('ROLLBACK'); } catch (_) {}
    console.error('FAILED:', e.message);
    process.exitCode = 1;
  } finally {
    c.release();
    await db.pool.end();
  }
})();
