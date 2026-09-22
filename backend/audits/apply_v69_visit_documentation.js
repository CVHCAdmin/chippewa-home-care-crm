// Applies migration_v69_visit_documentation.sql (one new table, additive) and adds the
// Veterans Affairs rate: $35.00/hr for Personal Care (home health aide and homemaking
// both bill $35 — confirmed by the owner 2026-09-22), effective 2026-06-01 so it covers
// Clarence Rubenzer's service from his 6/2 start. Idempotent: skips the rate if an
// active VA + Personal Care rate already exists.
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const fs = require('fs');
const path = require('path');
const db = require('../src/db');

const VA = 'cb0d6d7e-d716-4a0d-8407-4d9aada1537e';
const PERSONAL_CARE = '2a8d7df7-b31f-44f8-a2f8-db2296a0404a';
const ALEXIS = 'c56897c9-c22c-4aa5-bafa-bb9b9aef41a7';

(async () => {
  const c = await db.pool.connect();
  try {
    await c.query(fs.readFileSync(path.join(__dirname, '..', 'migration_v69_visit_documentation.sql'), 'utf8'));
    const cols = (await c.query(`SELECT column_name FROM information_schema.columns WHERE table_name = 'visit_documentation' ORDER BY ordinal_position`)).rows.map(r => r.column_name);
    if (!cols.includes('tasks') || !cols.includes('visit_date')) throw new Error('visit_documentation missing columns: ' + cols);
    console.log('migration v69 applied — visit_documentation:', cols.join(', '));

    await c.query('BEGIN');
    const existing = (await c.query(
      `SELECT id, rate_amount FROM referral_source_rates WHERE referral_source_id = $1 AND care_type_id = $2 AND (is_active IS NULL OR is_active)`,
      [VA, PERSONAL_CARE])).rows;
    if (existing.length) {
      console.log('VA Personal Care rate already present, not adding:', existing);
      await c.query('ROLLBACK');
    } else {
      const r = (await c.query(
        `INSERT INTO referral_source_rates (referral_source_id, care_type_id, rate_amount, rate_type, effective_date)
         VALUES ($1, $2, 35.00, 'hourly', '2026-06-01') RETURNING *`, [VA, PERSONAL_CARE])).rows[0];
      await c.query(`INSERT INTO audit_logs (user_id, action, table_name, record_id, new_data) VALUES ($1, 'CREATE', 'referral_source_rates', $2, $3)`, [ALEXIS, r.id, r]);
      await c.query('COMMIT');
      console.log('VA rate added:', { id: r.id, rate: r.rate_amount, type: r.rate_type, effective: r.effective_date });
    }
  } catch (e) {
    try { await c.query('ROLLBACK'); } catch (_) {}
    console.error('FAILED:', e.message);
    process.exitCode = 1;
  } finally {
    c.release();
    process.exit();
  }
})();
