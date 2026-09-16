// Corrects Neugene Watkins' WORCS background_checks row to match the DOJ/DHS caregiver
// background check document uploaded 2026-09-16 (Background Checks → Documents):
// request/report date 9/16/2026, order reference XqDMXLb3. Result stays 'clear' — the
// CRM's passed value (owner confirmed he passed; DHS findings none). The earlier row said
// completed 3/4/2026 with no document ("dates approximate, hire date used").
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const db = require('../src/db');
const { auditLog } = require('../src/middleware/shared');

const CHECK_ID = '255682cf-006b-452c-83e7-7eeba602e956';
const APPLY = process.argv.includes('--apply');

(async () => {
  const c = await db.pool.connect();
  try {
    await c.query('BEGIN');
    const before = (await c.query(`SELECT * FROM background_checks WHERE id = $1 FOR UPDATE`, [CHECK_ID])).rows[0];
    if (!before) throw new Error('check not found');
    const docs = (await c.query(`SELECT file_name, created_at FROM background_check_documents WHERE background_check_id = $1`, [CHECK_ID])).rows;
    if (!docs.length) throw new Error('no uploaded document on this check — refusing to change dates');

    const note = `${before.notes || ''}\n\nCorrected 2026-09-16 from the uploaded DOJ WORCS caregiver background check (order reference XqDMXLb3): requested and reported 9/16/2026. The earlier 3/4/2026 date had no document behind it. DHS Governmental Findings Report: no findings. DOJ criminal history report lists a 2006 disorderly conduct conviction and a 07/16/2025 arrest (resisting/obstructing, charge issued); owner determined the caregiver passed.`.trim();
    const after = (await c.query(`
      UPDATE background_checks
         SET initiated_date = '2026-09-16', completed_date = '2026-09-16', check_date = '2026-09-16',
             expiration_date = '2030-09-16', reference_number = 'XqDMXLb3', worcs_reference_number = 'XqDMXLb3',
             findings = 'DHS Governmental Findings Report: no findings. DOJ criminal history report lists a 2006 disorderly conduct conviction and a 07/16/2025 arrest (resisting/obstructing an officer, charge issued).',
             notes = $2, updated_at = NOW()
       WHERE id = $1
       RETURNING id, status, result, initiated_date::text, completed_date::text, check_date::text, expiration_date::text, reference_number, worcs_reference_number, findings`,
      [CHECK_ID, note])).rows[0];
    console.log('before:', { completed: before.completed_date, expires: before.expiration_date, ref: before.reference_number, result: before.result });
    console.log('after: ', after);
    console.log('documents:', docs);

    if (!APPLY) { await c.query('ROLLBACK'); console.log('\nDRY RUN — rerun with --apply'); return; }
    await c.query('COMMIT');
    const oldData = { initiated_date: before.initiated_date, completed_date: before.completed_date, check_date: before.check_date, expiration_date: before.expiration_date, reference_number: before.reference_number, worcs_reference_number: before.worcs_reference_number, findings: before.findings, notes: before.notes };
    await auditLog('c56897c9-c22c-4aa5-bafa-bb9b9aef41a7', 'UPDATE', 'background_checks', CHECK_ID, oldData, after, 'corrected_from_uploaded_document');
    console.log('\nAPPLIED');
  } catch (e) {
    await c.query('ROLLBACK').catch(() => {});
    console.error('FAILED:', e.message); process.exitCode = 1;
  } finally { c.release(); await db.pool.end(); }
})();
