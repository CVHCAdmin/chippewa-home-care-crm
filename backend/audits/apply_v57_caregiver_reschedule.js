// Applies migration_v57_caregiver_reschedule.sql and verifies the live schema
// (prod has legacy drift, so we always confirm after IF NOT EXISTS DDL).
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const fs = require('fs');
const path = require('path');
const db = require('../src/db');

(async () => {
  try {
    const sql = fs.readFileSync(path.join(__dirname, '..', 'migration_v57_caregiver_reschedule.sql'), 'utf8');
    await db.query(sql);
    console.log('migration applied');

    const cols = await db.query(`
      SELECT column_name, data_type, column_default
        FROM information_schema.columns
       WHERE table_name = 'visit_change_requests'
         AND column_name IN ('requested_by', 'request_reason', 'applied_schedule_id')
       ORDER BY column_name`);
    console.log('live columns:');
    console.dir(cols.rows, { depth: null });
    if (cols.rows.length !== 3) console.log('!! expected 3 columns');

    const chk = await db.query(`
      SELECT conname FROM pg_constraint
       WHERE conrelid = 'visit_change_requests'::regclass
         AND conname = 'visit_change_requests_requested_by_check'`);
    console.log('check constraint:', chk.rows[0]?.conname || 'MISSING!');

    const idx = await db.query(`
      SELECT indexname FROM pg_indexes
       WHERE tablename = 'visit_change_requests' AND indexname = 'idx_vcr_status_created'`);
    console.log('index:', idx.rows[0]?.indexname || 'MISSING!');

    const rows = await db.query(`SELECT requested_by, count(*) FROM visit_change_requests GROUP BY 1`);
    console.log('existing rows by origin:', rows.rows);
  } catch (e) {
    console.error('FAILED:', e.message);
    process.exitCode = 1;
  } finally {
    try { await db.pool.end(); } catch {}
  }
})();
