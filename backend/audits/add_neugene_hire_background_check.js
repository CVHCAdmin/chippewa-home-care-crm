// Adds a separate background_checks row for the caregiver background check the owner
// states was completed when Neugene Watkins was hired (3/4/2026). The owner's position
// (2026-09-16): he was checked and cleared at hire; WORCS no longer shows that result and
// no receipt/document has been found. The row says exactly that — no reference number,
// no document — and the 9/16/2026 check with its uploaded document stays its own row.
// usage: node audits/add_neugene_hire_background_check.js            (dry run)
//        node audits/add_neugene_hire_background_check.js --apply
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const db = require('../src/db');
const { auditLog } = require('../src/middleware/shared');

const CAREGIVER = '7c63175b-5599-48e1-b2ac-4c8e4e65310e';
const ADMIN = 'c56897c9-c22c-4aa5-bafa-bb9b9aef41a7';
const APPLY = process.argv.includes('--apply');

(async () => {
  const c = await db.pool.connect();
  try {
    await c.query('BEGIN');
    const dup = await c.query(`SELECT id FROM background_checks WHERE caregiver_id=$1 AND completed_date='2026-03-04'`, [CAREGIVER]);
    if (dup.rows.length) throw new Error('a 3/4/2026 check row already exists: ' + dup.rows[0].id);
    const row = (await c.query(`
      INSERT INTO background_checks
        (caregiver_id, check_type, provider, status, result, initiated_date, completed_date, check_date, expiration_date, findings, notes, created_by)
      VALUES ($1, 'worcs', 'WI DOJ WORCS', 'completed', 'clear', '2026-03-04', '2026-03-04', '2026-03-04', '2030-03-04',
              'Completed at hire. The result document is no longer available from WORCS.',
              'Entered 2026-09-16 per agency records (owner): caregiver background check completed and cleared at hire. No order reference number or result document on file; WORCS no longer shows the result. A new check was run 9/16/2026 (reference XqDMXLb3, separate record with the document).',
              $2)
      RETURNING id, check_type, status, result, completed_date::text, expiration_date::text, reference_number, findings`, [CAREGIVER, ADMIN])).rows[0];
    console.log(row);
    const all = (await c.query(`SELECT completed_date::text, result, reference_number FROM background_checks WHERE caregiver_id=$1 ORDER BY completed_date`, [CAREGIVER])).rows;
    console.log(all);
    if (!APPLY) { await c.query('ROLLBACK'); console.log('DRY RUN — rerun with --apply'); return; }
    await c.query('COMMIT');
    await auditLog(ADMIN, 'CREATE', 'background_checks', row.id, null, row, 'hire_check_per_agency_records');
    console.log('APPLIED');
  } catch (e) {
    await c.query('ROLLBACK').catch(() => {});
    console.error('FAILED:', e.message); process.exitCode = 1;
  } finally { c.release(); await db.pool.end(); }
})();
