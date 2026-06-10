// Apply v51: server-side logout (users.last_logout_at)
// Safe: ADD COLUMN IF NOT EXISTS — idempotent.

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const db = require('../src/db');

(async () => {
  try {
    const sql = fs.readFileSync(path.join(__dirname, '..', 'migration_v51_server_side_logout.sql'), 'utf8');
    console.log('Applying migration v51 (server-side logout)...');
    await db.query(sql);

    const { rows } = await db.query(`
      SELECT column_name, data_type, is_nullable
        FROM information_schema.columns
       WHERE table_name = 'users' AND column_name = 'last_logout_at'
    `);
    if (rows.length === 0) {
      console.error('✗ Column last_logout_at not present after migration!');
      process.exitCode = 1;
      return;
    }
    console.log('✓ Migration applied');
    console.log(`  users.last_logout_at: ${rows[0].data_type}, nullable=${rows[0].is_nullable}`);
  } catch (e) {
    console.error('FAILED:', e.message);
    process.exitCode = 1;
  } finally {
    await db.end?.();
    process.exit();
  }
})();
