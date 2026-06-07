// Apply v50: training shifts (schedules.is_training)
// Safe: ADD COLUMN IF NOT EXISTS + CREATE INDEX IF NOT EXISTS — idempotent.

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const db = require('../src/db');

(async () => {
  try {
    const sql = fs.readFileSync(path.join(__dirname, '..', 'migration_v50_training_shifts.sql'), 'utf8');
    console.log('Applying migration v50 (training shifts)...');
    await db.query(sql);

    const { rows } = await db.query(`
      SELECT column_name, data_type, column_default, is_nullable
        FROM information_schema.columns
       WHERE table_name = 'schedules' AND column_name = 'is_training'
    `);
    if (rows.length === 0) {
      console.error('✗ Column is_training not present after migration!');
      process.exitCode = 1;
      return;
    }
    console.log('✓ Migration applied');
    console.log(`  schedules.is_training: ${rows[0].data_type}, default=${rows[0].column_default}, nullable=${rows[0].is_nullable}`);

    const ix = await db.query(`SELECT indexname FROM pg_indexes WHERE tablename='schedules' AND indexname='idx_schedules_is_training'`);
    console.log(`  index idx_schedules_is_training: ${ix.rows.length ? 'present' : 'MISSING'}`);

    const cnt = await db.query(`SELECT COUNT(*)::int AS n FROM schedules WHERE is_training = true`);
    console.log(`  schedules already marked training: ${cnt.rows[0].n}`);
  } catch (e) {
    console.error('FAILED:', e.message);
    process.exitCode = 1;
  } finally {
    await db.end?.();
    process.exit();
  }
})();
