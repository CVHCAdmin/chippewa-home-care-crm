// Applies migration_v67_background_check_documents.sql and confirms the table, its
// foreign key to background_checks, and the index exist. Additive only.
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const fs = require('fs');
const path = require('path');
const db = require('../src/db');

(async () => {
  const c = await db.pool.connect();
  try {
    await c.query(fs.readFileSync(path.join(__dirname, '..', 'migration_v67_background_check_documents.sql'), 'utf8'));
    console.log('migration applied');

    const cols = await c.query(`
      SELECT column_name, data_type FROM information_schema.columns
       WHERE table_name = 'background_check_documents' ORDER BY ordinal_position`);
    cols.rows.forEach(r => console.log(' ', r.column_name, r.data_type));
    if (cols.rows.length !== 8) throw new Error('expected 8 columns');

    const fk = await c.query(`
      SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint
       WHERE conrelid = 'background_check_documents'::regclass AND contype = 'f'`);
    if (!fk.rows.some(r => /REFERENCES background_checks\(id\) ON DELETE CASCADE/.test(r.def))) throw new Error('FK to background_checks missing');
    const idx = await c.query(`SELECT 1 FROM pg_indexes WHERE indexname = 'idx_background_check_documents_check'`);
    if (!idx.rows.length) throw new Error('index missing');
    console.log('foreign key + index: OK');
  } catch (e) {
    try { await c.query('ROLLBACK'); } catch (_) {}
    console.error('FAILED:', e.message);
    process.exitCode = 1;
  } finally {
    c.release();
    await db.pool.end();
  }
})();
