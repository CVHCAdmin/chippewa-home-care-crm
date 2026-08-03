// Applies migration_v56_unique_open_time_entry.sql to the DB in backend/.env
// and verifies the live index (prod has legacy-drift history, so we always
// confirm the real schema after IF NOT EXISTS DDL).
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const fs = require('fs');
const path = require('path');
const db = require('../src/db');

(async () => {
  try {
    // Pre-check: the partial unique index can only build if no caregiver has
    // two open entries right now.
    const dupes = await db.query(`
      SELECT caregiver_id, COUNT(*) AS n FROM time_entries
       WHERE end_time IS NULL GROUP BY caregiver_id HAVING COUNT(*) > 1`);
    if (dupes.rows.length > 0) {
      console.error('BLOCKED: caregivers with multiple open entries:', dupes.rows);
      process.exitCode = 1;
      return;
    }

    const sql = fs.readFileSync(path.join(__dirname, '..', 'migration_v56_unique_open_time_entry.sql'), 'utf8');
    await db.query(sql);
    console.log('migration applied');

    const idx = await db.query(`
      SELECT indexdef FROM pg_indexes
       WHERE tablename = 'time_entries' AND indexname = 'uniq_open_time_entry_per_caregiver'`);
    console.log('live index:', idx.rows[0] ? idx.rows[0].indexdef : 'MISSING!');
  } catch (e) {
    console.error('FAILED:', e.message);
    process.exitCode = 1;
  } finally {
    try { await db.pool.end(); } catch {}
  }
})();
