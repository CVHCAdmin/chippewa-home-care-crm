// Apply v52: repoint background_checks FKs (caregiver_id -> users,
// application_id -> job_applications), then backfill the WORCS rows that
// failed to insert for already-submitted onboarding packets.
//
// Safe to re-run: the migration drops/re-adds constraints idempotently and
// the backfill only inserts where no 'worcs' check exists for the caregiver.

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const db = require('../src/db');

(async () => {
  try {
    const sql = fs.readFileSync(path.join(__dirname, '..', 'migration_v52_fix_background_checks_fk.sql'), 'utf8');
    console.log('Applying migration v52 (background_checks FK fix)...');
    await db.query(sql);

    const { rows: fks } = await db.query(`
      SELECT conname, pg_get_constraintdef(oid) AS def
      FROM pg_constraint
      WHERE conrelid = 'background_checks'::regclass AND contype = 'f'
    `);
    console.log('✓ Migration applied. Current FKs:');
    fks.forEach(r => console.log(`  ${r.conname}: ${r.def}`));

    const bad = fks.find(r => r.conname === 'background_checks_caregiver_id_fkey' && !r.def.includes('REFERENCES users(id)'));
    if (bad) {
      console.error('✗ caregiver_id FK still does not reference users(id)!');
      process.exitCode = 1;
      return;
    }

    // Backfill: submitted packets whose caregiver has no WORCS check row.
    // Mirrors what the onboarding submit handler would have written (WORCS has
    // no credentials in prod, so the original attempt was a mock submission).
    // The transient SSN is intentionally left on the packet — WORCS never
    // received it, and a real submission will need it once credentials exist.
    const { rows: backfilled } = await db.query(`
      INSERT INTO background_checks (caregiver_id, check_type, provider, status, initiated_date, notes)
      SELECT op.caregiver_id, 'worcs', 'WI DOJ WORCS', 'pending', op.submitted_at::date,
             'Backfilled by v52 — original insert failed on legacy FK. WORCS submission still pending (no credentials configured).'
      FROM onboarding_packets op
      WHERE op.status = 'submitted'
        AND NOT EXISTS (
          SELECT 1 FROM background_checks bc
          WHERE bc.caregiver_id = op.caregiver_id AND bc.check_type = 'worcs'
        )
      RETURNING id, caregiver_id, initiated_date
    `);
    console.log(`✓ Backfilled ${backfilled.length} background_checks row(s):`);
    backfilled.forEach(r => console.log(`  ${r.id} caregiver=${r.caregiver_id} initiated=${r.initiated_date}`));
  } catch (e) {
    console.error('FAILED:', e.message);
    process.exitCode = 1;
  } finally {
    await db.end?.();
    process.exit();
  }
})();
