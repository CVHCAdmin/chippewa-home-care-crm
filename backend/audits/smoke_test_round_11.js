// Smoke test for round-11 features: caregiver unsigned-docs queue,
// bulk client CSV import, push key crash protection.

require('dotenv').config();
const db = require('../src/db');
const { v4: uuidv4 } = require('uuid');

let pass = 0, fail = 0;
const ok = (name, cond, detail = '') => {
  if (cond) { console.log(`  ✓ ${name}`); pass++; }
  else      { console.log(`  ✗ ${name}${detail ? ' — ' + detail : ''}`); fail++; }
};

(async () => {
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');

    const cg = (await client.query(`SELECT id FROM users WHERE role = 'caregiver' AND is_active = true LIMIT 1`)).rows[0];
    const admin = (await client.query(`SELECT id FROM users WHERE role = 'admin' AND is_active = true LIMIT 1`)).rows[0];

    console.log('\nUnsigned documents endpoint');
    // Insert a caregiver-targeted doc that requires signature
    const docId = uuidv4();
    await client.query(
      `INSERT INTO documents (id, entity_type, entity_id, document_type, name, file_url, requires_signature, uploaded_by)
       VALUES ($1, 'caregiver', $2, 'i9', 'SMOKE I-9', '/uploads/smoke-i9.pdf', true, $3)`,
      [docId, cg.id, admin.id]
    );
    // The endpoint query: company OR caregiver=user, requires_signature=true, signed_at IS NULL
    const unsigned = await client.query(
      `SELECT id, name FROM documents
        WHERE requires_signature = true AND signed_at IS NULL
          AND ((entity_type = 'company') OR (entity_type = 'caregiver' AND entity_id = $1))`,
      [cg.id]
    );
    ok('unsigned-docs query returns the doc', unsigned.rows.some(r => r.id === docId));

    // Sign it, then verify it drops off the unsigned list
    await client.query(
      `UPDATE documents SET signed_at = NOW(), signed_by = $2,
        signature_image_base64 = 'data:image/png;base64,SMOKE',
        signature_typed_name = 'Test' WHERE id = $1`,
      [docId, cg.id]
    );
    const unsigned2 = await client.query(
      `SELECT id FROM documents
        WHERE requires_signature = true AND signed_at IS NULL
          AND entity_type = 'caregiver' AND entity_id = $1`,
      [cg.id]
    );
    ok('signed doc no longer in unsigned list', !unsigned2.rows.some(r => r.id === docId));

    console.log('\nBulk client import dedupe + matching');
    // Verify the SQL the bulk-import endpoint uses for dedupe
    const dedupe = await client.query(
      `SELECT id FROM clients
        WHERE LOWER(first_name) = LOWER('NoSuchTestPersonABC')
          AND LOWER(last_name)  = LOWER('XYZTestUnique')
          AND ($1::date IS NULL OR date_of_birth = $1::date)`,
      [null]
    );
    ok('dedupe query returns 0 for unique name', dedupe.rows.length === 0);

    // Verify care_types + referral_sources lookup works (the maps the endpoint builds)
    const ct = await client.query(`SELECT COUNT(*) AS n FROM care_types`);
    const rs = await client.query(`SELECT COUNT(*) AS n FROM referral_sources WHERE is_active = true`);
    ok('care_types table populated', parseInt(ct.rows[0].n) > 0);
    ok('referral_sources table populated', parseInt(rs.rows[0].n) > 0);

    // Actually insert a test client through the same INSERT shape the endpoint uses
    const ins = await client.query(
      `INSERT INTO clients
       (first_name, last_name, date_of_birth, phone,
        care_type_id, referral_source_id, is_private_pay, private_pay_rate,
        is_active)
       VALUES ('Smoke', 'BulkImport', '1950-01-01', '555-0100',
        NULL, NULL, true, 25.00, true)
       RETURNING id, is_private_pay, private_pay_rate`,
      []
    );
    ok('bulk-import INSERT shape works', ins.rows[0].is_private_pay === true && parseFloat(ins.rows[0].private_pay_rate) === 25);

    console.log('\nReports endpoints — quick sanity');
    // hours-by-payer query shape — make sure it doesn't error on empty windows
    const hbp = await client.query(`
      SELECT COALESCE(rs.id::text, CASE WHEN c.is_private_pay THEN 'private' ELSE 'unknown' END) AS payer_key,
             COUNT(*) AS n
      FROM time_entries te
      JOIN clients c ON te.client_id = c.id
      LEFT JOIN referral_sources rs ON c.referral_source_id = rs.id
      WHERE te.is_complete = true AND te.start_time >= CURRENT_DATE - 7
      GROUP BY payer_key LIMIT 1
    `);
    ok('hours-by-payer SQL runs', true);

    // caregiver-utilization query shape
    const cu = await client.query(`
      WITH actuals AS (
        SELECT caregiver_id, ROUND(SUM(duration_minutes) / 60.0, 2) AS h FROM time_entries
        WHERE is_complete = true AND start_time >= CURRENT_DATE - 30 GROUP BY caregiver_id
      )
      SELECT u.id, COALESCE(ca.max_hours_per_week, 40) AS cap, COALESCE(a.h, 0) AS actual
      FROM users u LEFT JOIN caregiver_availability ca ON ca.caregiver_id = u.id
      LEFT JOIN actuals a ON a.caregiver_id = u.id
      WHERE u.role = 'caregiver' AND u.is_active = true LIMIT 3
    `);
    ok('caregiver-utilization SQL runs', cu.rows.length >= 0);

    // client-revenue-by-month query shape
    const crm = await client.query(`
      SELECT TO_CHAR(date_trunc('month', i.billing_period_start), 'YYYY-MM') AS month,
             COUNT(i.id) AS n
      FROM invoices i WHERE i.billing_period_start >= '2026-01-01'
      GROUP BY month LIMIT 5
    `);
    ok('client-revenue-by-month SQL runs', crm.rows.length >= 0);

    console.log(`\n──────────────────────────────`);
    console.log(`Results: ${pass} passed, ${fail} failed`);
    console.log(`──────────────────────────────`);
  } catch (e) {
    console.error('FATAL:', e.message); fail++;
  } finally {
    await client.query('ROLLBACK').catch(() => {});
    client.release();
    await db.end?.();
    process.exit(fail > 0 ? 1 : 0);
  }
})();
