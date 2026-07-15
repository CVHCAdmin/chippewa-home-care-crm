// READ-ONLY. Prints the v36 effective_date trigger function body.
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const db = require('../src/db');
(async () => {
  const r = await db.query(`SELECT prosrc FROM pg_proc WHERE proname='enforce_recurring_effective_date'`);
  console.log(r.rows[0] ? r.rows[0].prosrc : 'FUNCTION NOT FOUND');
  process.exit(0);
})().catch(e => { console.error(e.message); process.exit(1); });
