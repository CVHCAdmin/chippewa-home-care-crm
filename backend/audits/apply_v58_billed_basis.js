// Applies migration_v58_billed_basis.sql and verifies the live schema.
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const fs = require('fs');
const path = require('path');
const db = require('../src/db');

(async () => {
  try {
    const sql = fs.readFileSync(path.join(__dirname, '..', 'migration_v58_billed_basis.sql'), 'utf8');
    await db.query(sql);
    console.log('migration applied');

    console.dir((await db.query(`
      SELECT column_name, data_type FROM information_schema.columns
       WHERE table_name = 'invoice_line_items'
         AND column_name IN ('billed_basis','scheduled_minutes','clocked_minutes')
       ORDER BY column_name`)).rows, { depth: null });

    console.log('check constraint:', (await db.query(`
      SELECT conname FROM pg_constraint
       WHERE conrelid = 'invoice_line_items'::regclass
         AND conname = 'invoice_line_items_billed_basis_check'`)).rows[0]?.conname || 'MISSING!');

    console.log('backfill:', (await db.query(
      `SELECT billed_basis, count(*)::int FROM invoice_line_items GROUP BY 1 ORDER BY 1`)).rows);
  } catch (e) {
    console.error('FAILED:', e.message);
    process.exitCode = 1;
  } finally {
    try { await db.pool.end(); } catch {}
  }
})();
