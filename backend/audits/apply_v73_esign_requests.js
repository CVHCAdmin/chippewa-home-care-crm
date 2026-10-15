// v73 — e-signature requests (BID form / policy acknowledgements). DRY RUN by default.
//   node audits/apply_v73_esign_requests.js           → shows whether it's applied
//   node audits/apply_v73_esign_requests.js --apply   → applies migration_v73_esign_requests.sql
// Must run BEFORE the code deploy that uses /api/sign-requests.
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const fs = require('fs');
const path = require('path');
const db = require('../src/db');
const APPLY = process.argv.includes('--apply');
(async () => {
  try {
    const has = async (t) => (await db.query(`SELECT 1 FROM information_schema.tables WHERE table_name = $1`, [t])).rows.length > 0;
    console.log(APPLY ? '=== APPLY ===' : '=== DRY RUN (pass --apply to write) ===');
    console.log(`sign_templates: ${await has('sign_templates') ? 'exists' : 'missing'}; sign_requests: ${await has('sign_requests') ? 'exists' : 'missing'}`);
    if (APPLY) {
      await db.query(fs.readFileSync(path.join(__dirname, '..', 'migration_v73_esign_requests.sql'), 'utf8'));
      const t = await db.query(`SELECT kind, title FROM sign_templates ORDER BY created_at`);
      console.log('Applied. Templates:', t.rows.map(r => `${r.kind}: ${r.title}`).join(' | '));
    }
  } catch (e) { console.error('FATAL', e.message); }
  finally { process.exit(0); }
})();
