// Apply migration_v16 (claims & billing engine) to prod — it was never applied,
// so the claims/payments/remittance code throws on missing tables/columns.
// The migration is fully idempotent (ADD COLUMN IF NOT EXISTS / CREATE TABLE IF
// NOT EXISTS / ON CONFLICT DO NOTHING) and additive-only. Safe to re-run.
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const fs = require('fs');
const path = require('path');
const db = require('../src/db');

const NEW_TABLES = ['payments', 'payment_claim_matches', 'denial_code_lookup'];
const NEW_CLAIM_COLS = ['caregiver_id','units_billed','submission_method','edi_file_path',
  'clearinghouse_id','eob_notes','check_number','payer_type','resubmitted_from','voided_at','voided_by'];

(async () => {
  try {
    const sql = fs.readFileSync(path.join(__dirname, '..', 'migration_v16_claims_billing_engine.sql'), 'utf8');
    console.log('Applying migration v16 (claims & billing engine)...');
    await db.query(sql);
    console.log('✓ Migration executed.\n');

    // Verify tables
    const t = await db.query(
      `SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_name = ANY($1)`,
      [NEW_TABLES]);
    const haveT = new Set(t.rows.map(r => r.table_name));
    let ok = true;
    console.log('Tables:');
    NEW_TABLES.forEach(n => { const good = haveT.has(n); ok = ok && good; console.log(`  ${good ? 'OK  ' : 'FAIL'} ${n}`); });

    // Verify claims columns
    const c = await db.query(`SELECT column_name FROM information_schema.columns WHERE table_name='claims'`);
    const haveC = new Set(c.rows.map(r => r.column_name));
    console.log('claims columns:');
    NEW_CLAIM_COLS.forEach(col => { const good = haveC.has(col); ok = ok && good; console.log(`  ${good ? 'OK  ' : 'FAIL'} ${col}`); });

    // denial codes seeded
    const d = await db.query(`SELECT COUNT(*)::int AS n FROM denial_code_lookup`);
    console.log(`denial_code_lookup rows: ${d.rows[0].n}`);

    console.log(ok ? '\n✅ v16 fully applied.' : '\n❌ v16 incomplete — investigate.');
    if (!ok) process.exitCode = 1;
  } catch (e) {
    console.error('FAILED:', e.message);
    process.exitCode = 1;
  } finally {
    try { await db.pool.end(); } catch {}
  }
})();
