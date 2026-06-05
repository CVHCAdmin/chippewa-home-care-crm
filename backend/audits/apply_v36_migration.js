// Apply migration v36 on prod. Read-only DDL aside from the backfill UPDATE,
// which only touches recurring rows whose effective_date is NULL.
// The audit confirmed only 2 such rows exist, both is_active=false.

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const db = require('../src/db');

(async () => {
  try {
    const sql = fs.readFileSync(
      path.join(__dirname, '..', 'migration_v36_block_backdated_recurring.sql'),
      'utf8'
    );

    console.log('Applying migration v36...');
    await db.query(sql);
    console.log('✓ Migration applied.');

    const { rows } = await db.query(`
      SELECT COUNT(*) AS still_null
      FROM schedules
      WHERE day_of_week IS NOT NULL AND effective_date IS NULL
    `);
    console.log(`✓ Recurring schedules with NULL effective_date after backfill: ${rows[0].still_null}`);

    const { rows: trig } = await db.query(`
      SELECT tgname FROM pg_trigger
      WHERE tgname = 'trg_enforce_recurring_effective_date'
    `);
    console.log(`✓ Trigger present: ${trig.length === 1}`);

    const { rows: chk } = await db.query(`
      SELECT conname FROM pg_constraint
      WHERE conname = 'schedules_recurring_needs_effective_date'
    `);
    console.log(`✓ Check constraint present: ${chk.length === 1}`);
  } catch (e) {
    console.error('FAILED:', e.message);
    process.exitCode = 1;
  } finally {
    await db.end?.();
    process.exit();
  }
})();
