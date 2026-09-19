// Applies migration_v68_incident_payer_response_notes.sql and confirms the column exists.
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const fs = require('fs');
const path = require('path');
const db = require('../src/db');

(async () => {
  const c = await db.pool.connect();
  try {
    await c.query(fs.readFileSync(path.join(__dirname, '..', 'migration_v68_incident_payer_response_notes.sql'), 'utf8'));
    console.log('migration applied');
    const col = await c.query(`
      SELECT column_name, data_type FROM information_schema.columns
       WHERE table_name = 'incident_reports' AND column_name = 'payer_response_notes'`);
    if (!col.rows.length) throw new Error('column missing');
    console.log(' ', col.rows[0].column_name, col.rows[0].data_type, '— OK');
  } catch (e) {
    try { await c.query('ROLLBACK'); } catch (_) {}
    console.error('FAILED:', e.message);
    process.exitCode = 1;
  } finally { c.release(); await db.pool.end(); }
})();
