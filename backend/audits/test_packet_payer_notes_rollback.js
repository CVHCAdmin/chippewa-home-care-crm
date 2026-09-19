// Tests migration v68 + the two new cover-letter items (additional information, other
// members served) against the LIVE data, with the migration and the write inside ONE
// transaction that is ROLLED BACK.
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
process.env.TWILIO_ACCOUNT_SID = ''; process.env.TWILIO_AUTH_TOKEN = '';
const fs = require('fs');
const path = require('path');
const { PassThrough } = require('stream');
const PDFDocument = require('pdfkit');
const db = require('../src/db');

const INCIDENT = '4565695e-f805-41a9-8f7d-a01f0a1e72ff';
const NOTE = 'CVHC caregivers do not handle, administer, set up, or assist with medications, including controlled medications. This caregiver has never contacted CVHC management for assistance with the member\'s controlled medications.';

(async () => {
  const client = await db.pool.connect();
  const realQuery = db.query;
  db.query = (t, p) => client.query(t, p);
  let fail = 0;
  const check = (n, ok, x) => { if (!ok) fail++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${x !== undefined ? ' — ' + JSON.stringify(x).slice(0, 300) : ''}`); };
  try {
    await client.query('BEGIN');
    await client.query(fs.readFileSync(path.join(__dirname, '..', 'migration_v68_incident_payer_response_notes.sql'), 'utf8')
      .replace(/^\s*BEGIN;\s*$/m, '').replace(/^\s*COMMIT;\s*$/m, ''));
    check('migration v68 applies', true);
    await client.query(`UPDATE incident_reports SET payer_response_notes = $2 WHERE id = $1`, [INCIDENT, NOTE]);

    const svc = require('../src/services/incidentPdfService');
    const data = await svc.loadIncidentCase(db, INCIDENT);
    check('other members found', data.otherMembers.length > 0, data.otherMembers.map(m => `${m.first_name} ${m.last_name}: ${m.scheduled_visits} sched / ${m.clock_ins} punches`));

    const doc = new PDFDocument({ size: 'LETTER', margins: { top: 54, bottom: 62, left: 54, right: 54 }, bufferPages: true });
    const out = new PassThrough(); const chunks = []; out.on('data', c => chunks.push(c));
    doc.pipe(out); svc.renderResponsePacketPdf(doc, data, { includeSchedule: true }); doc.end();
    await new Promise(r => out.on('end', r));
    const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
    const d = await pdfjs.getDocument({ data: new Uint8Array(Buffer.concat(chunks)), verbosity: 0 }).promise;
    let all = '';
    for (let p = 1; p <= d.numPages; p++) all += (await (await d.getPage(p)).getTextContent()).items.map(i => i.str).join(' ') + '\n';
    const letter = all.slice(0, 4000).replace(/\s+/g, ' ');
    check('letter item 4 = additional information', /4\.\s*Additional information\./.test(letter));
    check('note text printed', letter.includes('never contacted CVHC management'));
    check('letter item 5 = other members', /5\.\s*Other members served by this caregiver\./.test(letter));
    for (const m of data.otherMembers) {
      check(`member listed: ${m.first_name} ${m.last_name}`, letter.includes(`${String(m.first_name).trim()} ${String(m.last_name).trim()}`));
    }
    console.log('\nLETTER EXCERPT:\n' + (letter.match(/4\. Additional information\..{0,900}/) || ['(not found)'])[0]);
  } catch (e) { fail++; console.error('ERROR', e); }
  finally {
    await client.query('ROLLBACK');
    client.release();
    db.query = realQuery;
    const col = (await db.pool.query(`SELECT count(*)::int n FROM information_schema.columns WHERE table_name='incident_reports' AND column_name='payer_response_notes'`)).rows[0].n;
    check('rolled back: column not left in prod', col === 0, col);
    console.log(fail ? `\n${fail} FAILED` : '\nALL PASS');
    process.exit(fail ? 1 : 0);
  }
})();
