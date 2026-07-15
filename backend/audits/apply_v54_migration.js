// Apply v54: add schedules.suspended_from (suspend service, reversible).
// Safe to re-run: ADD COLUMN IF NOT EXISTS + CREATE INDEX IF NOT EXISTS.
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const db = require('../src/db');

(async () => {
  try {
    const sql = fs.readFileSync(path.join(__dirname, '..', 'migration_v54_suspend_service.sql'), 'utf8');
    console.log('Applying migration v54 (schedules.suspended_from)...');
    await db.query(sql);

    const { rows } = await db.query(
      `SELECT column_name, data_type FROM information_schema.columns
       WHERE table_name='schedules' AND column_name='suspended_from'`
    );
    if (!rows.length) { console.error('✗ suspended_from column NOT present after migration'); process.exitCode = 1; return; }
    console.log(`✓ column present: suspended_from (${rows[0].data_type})`);

    const { rows: idx } = await db.query(
      `SELECT indexname FROM pg_indexes WHERE tablename='schedules' AND indexname='idx_schedules_suspended_from'`
    );
    console.log(idx.length ? '✓ partial index present' : '⚠ index missing (non-fatal)');
  } catch (e) {
    console.error('FAILED:', e.message);
    process.exitCode = 1;
  } finally {
    await db.end?.();
    process.exit();
  }
})();
