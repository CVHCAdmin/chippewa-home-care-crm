// READ-ONLY: list NOT NULL invoice columns without defaults (so a test insert
// satisfies them) and find a client + referral source id to attach to.
require('dotenv').config();
const db = require('../src/db');
(async () => {
  try {
    const cols = await db.query(`
      SELECT column_name, data_type, is_nullable, column_default
        FROM information_schema.columns
       WHERE table_name = 'invoices'
       ORDER BY ordinal_position`);
    console.log('=== invoices columns (NOT NULL & no default = must supply) ===');
    for (const c of cols.rows) {
      const must = c.is_nullable === 'NO' && !c.column_default;
      console.log(`${must ? '* ' : '  '}${c.column_name} (${c.data_type}) null=${c.is_nullable} default=${c.column_default || '-'}`);
    }
    const client = await db.query(`SELECT id, first_name, last_name, referral_source_id FROM clients LIMIT 1`);
    console.log('\n=== sample client ===');
    console.dir(client.rows, { depth: null });
  } catch (e) {
    console.error('FAILED:', e.message);
    process.exitCode = 1;
  } finally {
    await db.pool.end();
    process.exit();
  }
})();
