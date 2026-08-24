// Applies migration_v59_portal_multi_account.sql and verifies the live schema
// (prod has legacy-drift history, so we always confirm after IF NOT EXISTS DDL).
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const fs = require('fs');
const path = require('path');
const db = require('../src/db');

(async () => {
  try {
    const sql = fs.readFileSync(path.join(__dirname, '..', 'migration_v59_portal_multi_account.sql'), 'utf8');
    await db.query(sql);
    console.log('migration applied');

    const col = await db.query(`
      SELECT data_type FROM information_schema.columns
       WHERE table_name = 'client_portal_accounts' AND column_name = 'display_name'`);
    console.log('display_name column:', col.rows[0] || 'MISSING!');

    const idx = await db.query(`SELECT indexname, indexdef FROM pg_indexes WHERE tablename = 'client_portal_accounts'`);
    idx.rows.forEach(r => console.log('index:', r.indexdef));
    const stillUnique = idx.rows.some(r => r.indexname === 'idx_client_portal_accounts_client_id');
    console.log(stillUnique ? '❌ unique client_id index STILL PRESENT' : '✅ unique client_id index gone — multi-account enabled');
    process.exit(0);
  } catch (e) { console.error('ERR', e.message); process.exit(1); }
})();
