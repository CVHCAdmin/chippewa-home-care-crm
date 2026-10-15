// v74 — caregiver time corrections. DRY RUN by default.
//   node audits/apply_v74_time_corrections.js           → shows whether it's applied
//   node audits/apply_v74_time_corrections.js --apply   → applies migration_v74_time_corrections.sql
// Must run BEFORE the code deploy that uses /api/time-corrections.
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const fs = require('fs');
const path = require('path');
const db = require('../src/db');
const APPLY = process.argv.includes('--apply');
(async () => {
  try {
    const has = async (t) => (await db.query(`SELECT 1 FROM information_schema.tables WHERE table_name = $1`, [t])).rows.length > 0;
    console.log(APPLY ? '=== APPLY ===' : '=== DRY RUN (pass --apply to write) ===');
    console.log(`time_corrections: ${await has('time_corrections') ? 'exists' : 'missing'}`);
    if (APPLY) {
      await db.query(fs.readFileSync(path.join(__dirname, '..', 'migration_v74_time_corrections.sql'), 'utf8'));
      console.log(`Applied. time_corrections: ${await has('time_corrections') ? 'exists' : 'MISSING'}`);
    }
  } catch (e) { console.error('FATAL', e.message); }
  finally { process.exit(0); }
})();
