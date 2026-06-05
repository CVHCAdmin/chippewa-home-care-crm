// Apply v37: human-readable sequential invoice numbers.
// Safe: only ADDs a column + sequence, backfills existing rows.

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const db = require('../src/db');

(async () => {
  try {
    const sql = fs.readFileSync(path.join(__dirname, '..', 'migration_v37_invoice_seq_number.sql'), 'utf8');
    console.log('Applying migration v37...');
    await db.query(sql);

    const { rows } = await db.query(`
      SELECT COUNT(*) AS total,
             COUNT(seq_number) AS with_seq,
             MIN(seq_number) AS min_seq,
             MAX(seq_number) AS max_seq
        FROM invoices
    `);
    console.log('✓ Migration applied');
    console.log(`  invoices: ${rows[0].total} total, ${rows[0].with_seq} with seq_number (#${rows[0].min_seq}–#${rows[0].max_seq})`);
  } catch (e) {
    console.error('FAILED:', e.message);
    process.exitCode = 1;
  } finally {
    await db.end?.();
    process.exit();
  }
})();
