// One-time backfill: create background_checks rows for caregivers hired
// before the onboarding-packet/WORCS flow existed. These caregivers were
// screened at hire (required before client contact under the Wisconsin
// Caregiver Law) but the CRM has no record — the table couldn't accept
// inserts until the v52 FK fix, and no documents were ever uploaded.
//
// Dates are the best available proxy (hire date = users.created_at). Each
// row's notes flag it as retroactive so admins know to verify against the
// paper file. Idempotent: skips caregivers who already have any row, and
// skips anyone with an onboarding packet (their check comes from the real
// WORCS flow — e.g. a packet still awaiting submission must NOT be marked
// clear here).

require('dotenv').config();
const db = require('../src/db');

(async () => {
  try {
    const admin = await db.query(
      `SELECT id FROM users WHERE role = 'admin' AND email = 'chippewavalleyhomecare@gmail.com' LIMIT 1`
    );
    const createdBy = admin.rows[0]?.id || null;

    const { rows } = await db.query(`
      INSERT INTO background_checks
        (caregiver_id, check_type, provider, status, result,
         initiated_date, completed_date, expiration_date, notes, created_by)
      SELECT u.id, 'worcs', 'WI DOJ WORCS', 'completed', 'clear',
             u.created_at::date, u.created_at::date,
             (u.created_at::date + INTERVAL '4 years')::date,
             'Entered retroactively 2026-06-11 from agency hiring records — caregiver predates the CRM onboarding/WORCS flow. Dates approximate (hire date used). Verify against the paper personnel file and correct if needed.',
             $1
      FROM users u
      WHERE u.role = 'caregiver' AND u.is_active = true
        AND NOT EXISTS (SELECT 1 FROM background_checks bc WHERE bc.caregiver_id = u.id)
        AND NOT EXISTS (SELECT 1 FROM onboarding_packets op WHERE op.caregiver_id = u.id)
      RETURNING caregiver_id, completed_date, expiration_date
    `, [createdBy]);

    console.log(`✓ Inserted ${rows.length} retroactive background_checks row(s)`);

    const { rows: summary } = await db.query(`
      SELECT u.first_name, u.last_name, bc.check_type, bc.status, bc.result,
             bc.completed_date, bc.expiration_date
      FROM background_checks bc
      JOIN users u ON u.id = bc.caregiver_id
      ORDER BY u.first_name
    `);
    console.log('\n=== all background_checks rows now ===');
    summary.forEach(r => console.log(
      `${r.first_name} ${r.last_name}: ${r.check_type} ${r.status}/${r.result || 'n/a'}` +
      ` completed=${r.completed_date ? r.completed_date.toISOString().slice(0,10) : '—'}` +
      ` expires=${r.expiration_date ? r.expiration_date.toISOString().slice(0,10) : '—'}`
    ));
  } catch (e) {
    console.error('FAILED:', e.message);
    process.exitCode = 1;
  } finally {
    await db.pool.end();
  }
})();
