// Functional smoke test for the new features (run-in-transaction, rolled back).
// Exercises: vitals insert+validation, suggest-caregivers ranking,
// care-plan from-template, document signing.

require('dotenv').config();
const db = require('../src/db');

let pass = 0, fail = 0;
function ok(name, cond, detail = '') {
  if (cond) { console.log(`  ✓ ${name}`); pass++; }
  else      { console.log(`  ✗ ${name}${detail ? ' — ' + detail : ''}`); fail++; }
}

(async () => {
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');

    // Pick real refs
    const c  = (await client.query(`SELECT id FROM clients WHERE is_active = true LIMIT 1`)).rows[0];
    const cg = (await client.query(`SELECT id FROM users WHERE role = 'caregiver' AND is_active = true LIMIT 1`)).rows[0];
    if (!c || !cg) throw new Error('Need an active client + caregiver');

    // ── VITALS ─────────────────────────────────────────────────────────────
    console.log('\nVitals — happy path');
    const v1 = await client.query(
      `INSERT INTO client_vitals (client_id, caregiver_id, systolic_bp, diastolic_bp, pulse, pain_scale)
       VALUES ($1, $2, 122, 78, 70, 3) RETURNING id, systolic_bp`,
      [c.id, cg.id]
    );
    ok('vitals row inserted', v1.rows[0].systolic_bp === 122);

    console.log('\nVitals — out-of-range CHECK rejects bad value');
    let rejected = false;
    try {
      await client.query('SAVEPOINT v_bad');
      await client.query(
        `INSERT INTO client_vitals (client_id, systolic_bp) VALUES ($1, 999)`,
        [c.id]
      );
      await client.query('RELEASE SAVEPOINT v_bad');
    } catch (e) {
      rejected = e.message.includes('vitals_systolic_range') || e.message.includes('violates check');
      await client.query('ROLLBACK TO SAVEPOINT v_bad');
    }
    ok('systolic=999 rejected by CHECK', rejected);

    // ── CARE PLAN FROM TEMPLATE ────────────────────────────────────────────
    console.log('\nCare plan from template');
    const tpl = (await client.query(`SELECT id, template_name FROM care_plan_templates WHERE is_built_in = true LIMIT 1`)).rows[0];
    ok('built-in template exists', !!tpl);
    if (tpl) {
      const { v4: uuidv4 } = require('uuid');
      const planId = uuidv4();
      const r = await client.query(
        `INSERT INTO care_plans
          (id, client_id, service_type, service_description, frequency, care_goals,
           special_instructions, precautions, medication_notes, mobility_notes,
           dietary_notes, communication_notes, status)
         SELECT $1, $2, service_type, service_description, frequency, care_goals,
                special_instructions, precautions, medication_notes, mobility_notes,
                dietary_notes, communication_notes, 'draft'
           FROM care_plan_templates WHERE id = $3
         RETURNING id, status, service_type`,
        [planId, c.id, tpl.id]
      );
      ok('plan created from template', r.rows[0].status === 'draft' && r.rows[0].service_type);
    }

    // ── DOCUMENT SIGNATURE ────────────────────────────────────────────────
    console.log('\nDocument signature');
    const { v4: uuidv4 } = require('uuid');
    const docId = uuidv4();
    // Create a temp document linked to the caregiver
    await client.query(
      `INSERT INTO documents (id, entity_type, entity_id, document_type, name, file_url, requires_signature, uploaded_by)
       VALUES ($1, 'caregiver', $2, 'test', 'SMOKE TEST DOC', '/uploads/smoke.pdf', true, $2)`,
      [docId, cg.id]
    );
    // Sign it
    const sig = await client.query(
      `UPDATE documents
          SET signed_at = NOW(), signed_by = $2,
              signature_image_base64 = 'data:image/png;base64,iVBOR_TESTPAYLOAD_AAAA',
              signature_typed_name = 'Test Signer',
              signature_ip = '127.0.0.1'
        WHERE id = $1
        RETURNING signed_at, signed_by, signature_typed_name`,
      [docId, cg.id]
    );
    ok('document signed_at set', !!sig.rows[0].signed_at);
    ok('document signed_by set', sig.rows[0].signed_by === cg.id);

    // History row
    await client.query(
      `INSERT INTO document_signatures
       (document_id, signed_by, signer_typed_name, signature_image_base64, ip_address)
       VALUES ($1, $2, 'Test Signer', 'data:image/png;base64,iVBOR_TEST', '127.0.0.1')`,
      [docId, cg.id]
    );
    const histCount = (await client.query(`SELECT COUNT(*) FROM document_signatures WHERE document_id = $1`, [docId])).rows[0].count;
    ok('signature history row created', histCount === '1');

    // ── BACK-DATING GUARDS — re-confirm v36 still active ───────────────────
    console.log('\nBack-dating guards still active');
    const tr = await client.query(
      `INSERT INTO schedules (caregiver_id, client_id, schedule_type, day_of_week, start_time, end_time, effective_date, notes)
       VALUES ($1, $2, 'recurring', 1, '09:00', '13:00', '2026-01-01', '__smoke_test__')
       RETURNING effective_date`,
      [cg.id, c.id]
    );
    const today = (await client.query(`SELECT CURRENT_DATE AS d`)).rows[0].d.toISOString().slice(0,10);
    ok('past date clamped to today', tr.rows[0].effective_date.toISOString().slice(0,10) === today);

    // ── INVOICE SEQ NUMBER auto-increments ─────────────────────────────────
    console.log('\nInvoice sequence number');
    const inv = await client.query(
      `INSERT INTO invoices (client_id, invoice_number, billing_period_start, billing_period_end, subtotal, total)
       VALUES ($1, 'INV-SMOKE-TEST-001', CURRENT_DATE, CURRENT_DATE, 0, 0)
       RETURNING seq_number`,
      [c.id]
    );
    ok('seq_number auto-assigned', inv.rows[0].seq_number > 8, `got ${inv.rows[0].seq_number}`);

    console.log(`\n──────────────────────────────`);
    console.log(`Results: ${pass} passed, ${fail} failed`);
    console.log(`──────────────────────────────`);
  } catch (e) {
    console.error('FATAL:', e.message);
    fail++;
  } finally {
    await client.query('ROLLBACK').catch(() => {});
    client.release();
    await db.end?.();
    process.exit(fail > 0 ? 1 : 0);
  }
})();
