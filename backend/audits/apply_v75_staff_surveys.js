// v75 — anonymous staff surveys. DRY RUN by default.
//   node audits/apply_v75_staff_surveys.js           → shows whether it's applied
//   node audits/apply_v75_staff_surveys.js --apply   → applies migration_v75_staff_surveys.sql
// Must run BEFORE the code deploy that uses /api/surveys.
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const fs = require('fs');
const path = require('path');
const db = require('../src/db');
const APPLY = process.argv.includes('--apply');
(async () => {
  try {
    const has = async (t) => (await db.query(`SELECT 1 FROM information_schema.tables WHERE table_name = $1`, [t])).rows.length > 0;
    console.log(APPLY ? '=== APPLY ===' : '=== DRY RUN (pass --apply to write) ===');
    console.log(`survey tables: ${await has('survey_responses') ? 'exists' : 'missing'}`);
    if (APPLY) {
      await db.query(fs.readFileSync(path.join(__dirname, '..', 'migration_v75_staff_surveys.sql'), 'utf8'));
      console.log(`Applied. survey tables: ${await has('survey_responses') ? 'exists' : 'MISSING'}`);
    }
  } catch (e) { console.error('FATAL', e.message); }
  finally { process.exit(0); }
})();
