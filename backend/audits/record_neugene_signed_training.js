// Records the signed pages of the IR-2026-001 packet that the owner scanned 2026-09-18:
//   • attaches the four scans to the incident (incident_attachments, stored as data URIs)
//   • marks the incident's training acknowledgement signed
//   • adds the two training records the app's acknowledgement flow creates
//     (medication_reminders, misappropriation_policy)
// Signature lines on the scans were left undated, so the recorded date is the date the
// signed pages are evidenced by the scans (2026-09-18) — noted on the records. The pages
// came from the packet printed 2026-09-14 (audit log REPORT_GENERATED_PDF that day).
// usage: node audits/record_neugene_signed_training.js [--apply]
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const fs = require('fs');
const db = require('../src/db');
const { auditLog } = require('../src/middleware/shared');

const INCIDENT = '4565695e-f805-41a9-8f7d-a01f0a1e72ff';
const CAREGIVER = '7c63175b-5599-48e1-b2ac-4c8e4e65310e';
const ADMIN = 'c56897c9-c22c-4aa5-bafa-bb9b9aef41a7';
const SIGNED_DATE = '2026-09-18';
const SIGNED_AT = '2026-09-18 19:10:00-05';
const DIR = 'C:/Users/jerem/Documents/Scanned Documents';
const SCANS = [
  { file: 'Image (4).jpg', name: 'IR-2026-001 packet p1 cover letter (signed).jpg', category: 'signed_response', description: 'Signed cover letter, packet printed 9/14/2026. Signature lines undated.' },
  { file: 'Image (3).jpg', name: 'IR-2026-001 packet p3 investigation conclusion (signed).jpg', category: 'signed_response', description: 'Signed investigation conclusion page. Signature lines undated.' },
  { file: 'Image (2).jpg', name: 'IR-2026-001 packet p4 background check page (signed).jpg', category: 'background_check', description: 'Background check page verified against personnel file. Shows the pre-correction 3/4/2026 record. Signature line undated.' },
  { file: 'Image.jpg', name: 'IR-2026-001 packet p5 medication training acknowledgement (signed).jpg', category: 'training', description: 'Caregiver and supervisor signed the medication handling and misappropriation acknowledgement. Signature lines undated; scanned 9/18/2026.' },
];
const NOTE = 'Signed on the packet printed 9/14/2026; the signature lines were left undated, so this record is dated from the scan of the signed page (9/18/2026).';
const APPLY = process.argv.includes('--apply');

(async () => {
  const c = await db.pool.connect();
  try {
    await c.query('BEGIN');
    const inc = (await c.query(`SELECT id, training_ack_signed_at FROM incident_reports WHERE id = $1 FOR UPDATE`, [INCIDENT])).rows[0];
    if (!inc) throw new Error('incident not found');
    if (inc.training_ack_signed_at) throw new Error('acknowledgement already signed on this incident');

    const added = [];
    for (const s of SCANS) {
      const buf = fs.readFileSync(`${DIR}/${s.file}`);
      if (buf.length > 6_500_000) throw new Error(`${s.file} is too large (${buf.length} bytes)`);
      const dataUri = 'data:image/jpeg;base64,' + buf.toString('base64');
      const r = (await c.query(
        `INSERT INTO incident_attachments (incident_id, category, file_name, mime_type, file_size, file_data, description, uploaded_by)
         VALUES ($1,$2,$3,'image/jpeg',$4,$5,$6,$7)
         RETURNING id, category, file_name, file_size`,
        [INCIDENT, s.category, s.name, buf.length, dataUri, s.description, ADMIN])).rows[0];
      added.push(r);
    }

    const ack = (await c.query(
      `UPDATE incident_reports
          SET training_ack_signed_at = $2::timestamptz, training_ack_signer_name = 'Neugene Watkins',
              training_ack_supervisor = 'Jeremiah Phillips', training_ack_method = 'in_person', updated_at = NOW()
        WHERE id = $1
        RETURNING id, training_ack_signed_at, training_ack_signer_name, training_ack_supervisor, training_ack_method`,
      [INCIDENT, SIGNED_AT])).rows[0];

    const trainings = [];
    for (const type of ['medication_reminders', 'misappropriation_policy']) {
      const r = (await c.query(
        `INSERT INTO training_records (caregiver_id, training_type, training_name, completion_date, provider, status, recorded_by)
         VALUES ($1, $2, $3, $4::date, 'Chippewa Valley Home Care', 'completed', $5)
         RETURNING id, training_type, completion_date::text, status`,
        [CAREGIVER, type, type === 'medication_reminders' ? `Medication Reminders & Handling (PCW) — ${NOTE}` : `Client Funds, Property & Misappropriation Policy — ${NOTE}`, SIGNED_DATE, ADMIN])).rows[0];
      trainings.push(r);
    }

    console.log('attachments:', added);
    console.log('acknowledgement:', ack);
    console.log('training records:', trainings);
    if (!APPLY) { await c.query('ROLLBACK'); console.log('\nDRY RUN — rerun with --apply'); return; }
    await c.query('COMMIT');
    for (const a of added) await auditLog(ADMIN, 'CREATE', 'incident_attachments', a.id, null, a);
    await auditLog(ADMIN, 'UPDATE', 'incident_reports', INCIDENT, null, ack, 'training_ack_from_signed_scan');
    for (const t of trainings) await auditLog(ADMIN, 'CREATE', 'training_records', t.id, null, t);
    console.log('\nAPPLIED');
  } catch (e) {
    await c.query('ROLLBACK').catch(() => {});
    console.error('FAILED:', e.message); process.exitCode = 1;
  } finally { c.release(); await db.pool.end(); }
})();
