// services/incidentPdfService.js
// Incident case file PDFs (migration v64):
//   • renderIncidentReportPdf  — one incident, printable report for the file
//   • renderResponsePacketPdf  — the payer/MCO response packet: cover letter,
//     incident report + investigation, EVV visit history, caregiver background
//     check, training record / signed acknowledgement, schedule-status statement
//
// Every statement in the packet is derived from stored data (incident fields,
// time_entries, schedules via caregiver_removed_from, background_checks,
// training_records). Nothing is asserted that the CRM can't show — e.g. the
// schedule statement says "removed" only when caregiver_removed_from is set.
//
// DATE columns are selected as text (to_char) because node-pg turns DATE into a
// local-midnight Date, which shifts a day depending on the server's timezone.

const fs = require('fs');
const path = require('path');
const {
  INCIDENT_TYPES, SEVERITIES, INCIDENT_STATUSES, DISPOSITIONS, MANDATORY_REPORT_STATUSES,
  ENTRY_TYPES, ATTACHMENT_CATEGORIES, TRAINING_ACK_METHODS,
} = require('../helpers/incidentOptions');

// Agency identity: AGENCY_* env (backend/.env) with the values printed on the
// invoice letterhead (BillingDashboard.jsx) as the fallback.
const AGENCY = {
  name:    process.env.AGENCY_NAME    || 'Chippewa Valley Home Care',
  address: process.env.AGENCY_ADDRESS || '2607 Beverly Hills Dr',
  city:    process.env.AGENCY_CITY    || 'Eau Claire',
  state:   process.env.AGENCY_STATE   || 'WI',
  zip:     process.env.AGENCY_ZIP     || '54701',
  phone:   process.env.AGENCY_PHONE   || '715-491-1254',
  email:   'chippewavalleyhomecare@gmail.com',
};
const LOGO_PATH = path.join(__dirname, '..', 'assets', 'logo-192.png');

// Palette from reports.js renderClientReportPdf, plus the logo's gold for the name.
const TEAL = '#2ABBA7', INK = '#111827', MUTED = '#6B7280', RULE = '#E5E7EB', SHADE = '#F3F4F6', GOLD = '#A87B26';

// Training types a medication/misappropriation concern cares about (ComplianceTracking values).
const TRAINING_TYPE_LABELS = {
  cpr: 'CPR Certification', first_aid: 'First Aid', hipaa: 'HIPAA Training',
  infection_control: 'Infection Control', bloodborne_pathogen: 'Bloodborne Pathogen',
  safety: 'Workplace Safety', dementia_care: 'Dementia Care', fall_prevention: 'Fall Prevention',
  manual_handling: 'Manual Handling', medication_administration: 'Medication Administration',
  medication_reminders: 'Medication Reminders & Handling (PCW)',
  misappropriation_policy: 'Client Funds, Property & Misappropriation Policy', other: 'Other',
};

// ─────────────────────────────── DATA ───────────────────────────────
async function loadIncidentCase(db, incidentId) {
  const inc = await db.query(`
    SELECT ir.*,
           to_char(ir.incident_date, 'YYYY-MM-DD')          AS incident_date_s,
           to_char(ir.incident_time, 'FMHH12:MI AM')        AS incident_time_s,
           to_char(ir.reported_date, 'YYYY-MM-DD')          AS reported_date_s,
           to_char(ir.response_due_date, 'YYYY-MM-DD')      AS response_due_date_s,
           to_char(ir.response_sent_date, 'YYYY-MM-DD')     AS response_sent_date_s,
           to_char(ir.closed_date, 'YYYY-MM-DD')            AS closed_date_s,
           to_char(ir.caregiver_removed_from, 'YYYY-MM-DD') AS caregiver_removed_from_s,
           to_char(ir.caregiver_returned_on, 'YYYY-MM-DD')  AS caregiver_returned_on_s,
           to_char(ir.training_ack_signed_at AT TIME ZONE 'America/Chicago', 'YYYY-MM-DD') AS training_ack_signed_s,
           c.first_name AS client_first, c.last_name AS client_last,
           to_char(c.date_of_birth, 'MM/DD/YYYY') AS client_dob,
           c.medicaid_id, c.mco_member_id, c.is_private_pay,
           c.address AS client_address, c.city AS client_city, c.state AS client_state, c.zip AS client_zip,
           rs.name AS payer_name,
           u.first_name AS caregiver_first, u.last_name AS caregiver_last,
           ru.first_name AS entered_by_first, ru.last_name AS entered_by_last,
           to_char((NOW() AT TIME ZONE 'America/Chicago')::date, 'YYYY-MM-DD') AS today_s
      FROM incident_reports ir
      JOIN clients c ON c.id = ir.client_id
      LEFT JOIN referral_sources rs ON rs.id = c.referral_source_id
      LEFT JOIN users u  ON u.id  = ir.caregiver_id
      LEFT JOIN users ru ON ru.id = ir.reported_by_user_id
     WHERE ir.id = $1`, [incidentId]);
  if (inc.rows.length === 0) return null;
  const incident = inc.rows[0];

  const [notes, attachments, visits] = await Promise.all([
    db.query(`
      SELECT n.id, n.entry_type, n.summary, to_char(n.entry_date, 'YYYY-MM-DD') AS entry_date_s,
             u.first_name, u.last_name
        FROM incident_investigation_notes n
        LEFT JOIN users u ON u.id = n.created_by
       WHERE n.incident_id = $1
       ORDER BY n.entry_date, n.created_at`, [incidentId]),
    db.query(`
      SELECT id, category, file_name, mime_type, file_size, description
        FROM incident_attachments WHERE incident_id = $1 ORDER BY created_at`, [incidentId]),
    // First clock-in per caregiver per day at the member's home, from Jan 1 of the
    // incident year onward (Chicago calendar days).
    db.query(`
      SELECT to_char(x.d, 'Dy YYYY-MM-DD') AS day_s, x.arrival, x.gps, x.cg_first, x.cg_last
        FROM (SELECT DISTINCT ON ((te.start_time AT TIME ZONE 'America/Chicago')::date, te.caregiver_id)
                     (te.start_time AT TIME ZONE 'America/Chicago')::date AS d,
                     te.start_time AS started,
                     to_char(te.start_time AT TIME ZONE 'America/Chicago', 'FMHH12:MI AM') AS arrival,
                     (te.clock_in_location IS NOT NULL) AS gps,
                     u.first_name AS cg_first, u.last_name AS cg_last
                FROM time_entries te
                JOIN users u ON u.id = te.caregiver_id
               WHERE te.client_id = $1
                 AND (te.start_time AT TIME ZONE 'America/Chicago')::date >= make_date(EXTRACT(YEAR FROM $2::date)::int, 1, 1)
               ORDER BY (te.start_time AT TIME ZONE 'America/Chicago')::date, te.caregiver_id, te.start_time) x
       ORDER BY x.d, x.started`, [incident.client_id, incident.incident_date_s]),
  ]);

  let backgroundCheck = null, trainings = [], lastCaregiverVisit = null;
  if (incident.caregiver_id) {
    const [bgc, tr, last] = await Promise.all([
      db.query(`
        SELECT check_type, provider, status, result,
               to_char(COALESCE(completed_date, completion_date, check_date), 'YYYY-MM-DD') AS completed_s,
               to_char(expiration_date, 'YYYY-MM-DD') AS expires_s,
               COALESCE(worcs_reference_number, reference_number) AS reference
          FROM background_checks
         WHERE caregiver_id = $1
         ORDER BY COALESCE(completed_date, completion_date, check_date, created_at::date) DESC NULLS LAST, created_at DESC
         LIMIT 1`, [incident.caregiver_id]),
      db.query(`
        SELECT training_type, training_name, provider, status,
               to_char(completion_date, 'YYYY-MM-DD') AS completed_s,
               to_char(expiration_date, 'YYYY-MM-DD') AS expires_s
          FROM training_records
         WHERE caregiver_id = $1
         ORDER BY completion_date DESC NULLS LAST, created_at DESC`, [incident.caregiver_id]),
      db.query(`
        SELECT to_char(MAX((start_time AT TIME ZONE 'America/Chicago')::date), 'YYYY-MM-DD') AS d
          FROM time_entries WHERE client_id = $1 AND caregiver_id = $2`,
        [incident.client_id, incident.caregiver_id]),
    ]);
    backgroundCheck = bgc.rows[0] || null;
    trainings = tr.rows;
    lastCaregiverVisit = last.rows[0]?.d || null;
  }

  return { incident, notes: notes.rows, attachments: attachments.rows, visits: visits.rows, backgroundCheck, trainings, lastCaregiverVisit };
}

// ─────────────────────────────── FORMAT ───────────────────────────────
const longDate = (ymd) => {
  if (!ymd) return '';
  const d = new Date(`${ymd}T12:00:00Z`);
  return isNaN(d) ? String(ymd) : d.toLocaleDateString('en-US', { timeZone: 'UTC', month: 'long', day: 'numeric', year: 'numeric' });
};
const shortDate = (ymd) => {
  if (!ymd) return '';
  const [y, m, d] = String(ymd).split('-');
  return y && m && d ? `${Number(m)}/${Number(d)}/${y}` : String(ymd);
};
const text = (v) => (v === null || v === undefined || String(v).trim() === '') ? '' : String(v);
const dash = (v) => text(v) || '—';
const label = (map, v) => (v && map[v]) || text(v);
const personName = (first, last) => `${text(first)} ${text(last)}`.replace(/\s+/g, ' ').trim();
const memberIdLine = (i) => {
  const ids = [];
  if (i.medicaid_id) ids.push(`Medicaid ID ${i.medicaid_id}`);
  if (i.mco_member_id) ids.push(`Member ID ${i.mco_member_id}`);
  return ids.join('  ·  ');
};
const dataUriToBuffer = (uri) => {
  const m = /^data:[^;]+;base64,(.+)$/s.exec(String(uri || ''));
  return m ? Buffer.from(m[1], 'base64') : null;
};

// ─────────────────────────────── LAYOUT ───────────────────────────────
function makeLayout(doc) {
  const W = () => doc.page.width - doc.page.margins.left - doc.page.margins.right;
  const L = () => doc.page.margins.left;
  const bottom = () => doc.page.height - doc.page.margins.bottom;

  const letterhead = (compact = false) => {
    const top = 40;
    const logoW = compact ? 34 : 46;
    if (fs.existsSync(LOGO_PATH)) {
      try { doc.image(LOGO_PATH, L(), top, { width: logoW }); } catch (_) { /* logo is decorative */ }
    }
    const x = L() + logoW + 12;
    doc.font('Helvetica-Bold').fontSize(compact ? 12 : 15).fillColor(GOLD).text(AGENCY.name, x, top + (compact ? 3 : 6), { lineBreak: false });
    doc.font('Helvetica').fontSize(8.5).fillColor(MUTED)
       .text(`${AGENCY.address}  ·  ${AGENCY.city}, ${AGENCY.state} ${AGENCY.zip}  ·  ${AGENCY.phone}  ·  ${AGENCY.email}`,
             x, top + (compact ? 19 : 26), { lineBreak: false });
    const lineY = top + (compact ? 46 : 62);
    doc.moveTo(L(), lineY).lineTo(L() + W(), lineY).lineWidth(1.2).strokeColor(TEAL).stroke();
    doc.x = L(); doc.y = lineY + 16; doc.fillColor(INK);
  };
  const newPage = (compact = true) => { doc.addPage(); letterhead(compact); };
  const ensure = (h) => { if (doc.y + h > bottom()) newPage(true); };

  const title = (t, sub) => {
    doc.font('Helvetica-Bold').fontSize(15).fillColor(INK).text(t, L(), doc.y, { width: W() });
    if (sub) doc.font('Helvetica').fontSize(9.5).fillColor(MUTED).text(sub, { width: W() });
    doc.moveDown(0.7).fillColor(INK);
  };
  const h2 = (t) => {
    ensure(42);
    doc.moveDown(0.4);
    doc.font('Helvetica-Bold').fontSize(10.5).fillColor(TEAL).text(t.toUpperCase(), L(), doc.y, { width: W(), characterSpacing: 0.4 });
    const y = doc.y + 2;
    doc.moveTo(L(), y).lineTo(L() + W(), y).lineWidth(0.6).strokeColor(RULE).stroke();
    doc.y = y + 6; doc.fillColor(INK);
  };
  const p = (t, o = {}) => {
    if (!text(t)) return;
    ensure(22);
    doc.font(o.bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(o.size || 10).fillColor(o.color || INK)
       .text(String(t), L(), doc.y, { width: W(), lineGap: 1.5 });
    doc.moveDown(o.after == null ? 0.5 : o.after);
  };
  const runIn = (head, body, after = 0.5) => {
    ensure(22);
    doc.fontSize(10).fillColor(INK).font('Helvetica-Bold').text(head, L(), doc.y, { width: W(), lineGap: 1.5, continued: true });
    doc.font('Helvetica').text(body, { width: W(), lineGap: 1.5 });
    doc.moveDown(after);
  };
  const bullets = (items, numbered = false, size = 10) => {
    items.filter(text).forEach((it, i) => {
      ensure(18);
      const y = doc.y;
      doc.font('Helvetica').fontSize(size).fillColor(INK).text(numbered ? `${i + 1}.` : '•', L() + 4, y, { width: 16 });
      doc.text(it, L() + 22, y, { width: W() - 22, lineGap: 1.5 });
      doc.moveDown(size < 10 ? 0.1 : 0.25);
    });
    doc.x = L();
    doc.moveDown(0.3);
  };
  const kv = (rows) => {
    const lw = 150;
    rows.filter(r => text(r[1])).forEach(([k, v], i) => {
      doc.font('Helvetica').fontSize(10);
      const h = Math.max(doc.heightOfString(String(v), { width: W() - lw - 12 }), 12) + 8;
      ensure(h);
      const y = doc.y;
      if (i % 2 === 0) doc.rect(L(), y, W(), h).fill(SHADE);
      doc.fillColor(MUTED).font('Helvetica-Bold').fontSize(9).text(k, L() + 6, y + 4, { width: lw - 8 });
      doc.fillColor(INK).font('Helvetica').fontSize(10).text(String(v), L() + lw + 6, y + 4, { width: W() - lw - 12 });
      doc.y = y + h;
    });
    doc.x = L();
    doc.moveDown(0.5);
  };
  const table = (cols, rows, o = {}) => {
    const rowH = o.rowH || 13;
    const fixed = cols.reduce((s, c) => s + (c.w || 0), 0);
    const flex = cols.filter(c => !c.w).length;
    const widths = cols.map(c => c.w || (W() - fixed) / Math.max(flex, 1));
    const header = () => {
      const y = doc.y;
      doc.rect(L(), y, W(), rowH + 3).fill(TEAL);
      let x = L();
      cols.forEach((c, j) => { doc.font('Helvetica-Bold').fontSize(8.5).fillColor('#fff').text(c.h, x + 5, y + 4, { width: widths[j] - 8, lineBreak: false }); x += widths[j]; });
      doc.y = y + rowH + 3;
    };
    ensure(rowH * 3);
    header();
    rows.forEach((r, i) => {
      // Wrapped cells (e.g. timeline summaries) size the row.
      doc.font('Helvetica').fontSize(8.5);
      const h = Math.max(rowH, ...r.map((cell, j) => cols[j].wrap ? doc.heightOfString(String(cell), { width: widths[j] - 8 }) + 5 : rowH));
      if (doc.y + h > bottom()) { newPage(true); header(); }
      const y = doc.y;
      if (i % 2 === 1) doc.rect(L(), y, W(), h).fill(SHADE);
      let x = L();
      r.forEach((cell, j) => {
        doc.font('Helvetica').fontSize(8.5).fillColor(INK)
           .text(String(cell), x + 5, y + 2.5, cols[j].wrap ? { width: widths[j] - 8 } : { width: widths[j] - 8, lineBreak: false });
        x += widths[j];
      });
      doc.y = y + h;
    });
    doc.x = L();
    doc.moveDown(0.6);
  };
  const signatures = (pairs) => {
    ensure(38 * pairs.length + 10);
    doc.moveDown(0.5);
    pairs.forEach(([a, b]) => {
      const y = doc.y + 20;
      doc.moveTo(L(), y).lineTo(L() + 250, y).lineWidth(0.6).strokeColor(INK).stroke();
      doc.moveTo(L() + 290, y).lineTo(L() + W(), y).stroke();
      doc.font('Helvetica').fontSize(8.5).fillColor(MUTED).text(a, L(), y + 3, { lineBreak: false });
      doc.text(b, L() + 290, y + 3, { lineBreak: false });
      doc.x = L(); doc.y = y + 18; doc.fillColor(INK);
    });
  };
  const footers = (caption) => {
    const range = doc.bufferedPageRange();
    for (let i = range.start; i < range.start + range.count; i++) {
      doc.switchToPage(i);
      const saved = doc.page.margins.bottom;
      doc.page.margins.bottom = 0;
      doc.font('Helvetica').fontSize(7.5).fillColor(MUTED)
         .text(`${caption}  ·  Confidential PHI  ·  Page ${i + 1} of ${range.count}`,
               L(), doc.page.height - 36, { width: W(), align: 'center', lineBreak: false });
      doc.page.margins.bottom = saved;
    }
  };
  return { W, L, letterhead, newPage, ensure, title, h2, p, runIn, bullets, kv, table, signatures, footers };
}

// ─────────────────────────────── SHARED SECTIONS ───────────────────────────────
function incidentSections(ui, data, { forPayer }) {
  const { incident: i, notes, attachments } = data;
  const member = personName(i.client_first, i.client_last);
  const caregiver = personName(i.caregiver_first, i.caregiver_last);

  ui.h2('Incident');
  ui.kv([
    ['Incident number', i.incident_number],
    ['Status', label(INCIDENT_STATUSES, i.status)],
    ['Member', [member, i.client_dob ? `DOB ${i.client_dob}` : '', memberIdLine(i)].filter(Boolean).join('  ·  ')],
    ['Member address', [text(i.client_address), [text(i.client_city), [text(i.client_state), text(i.client_zip)].filter(Boolean).join(' ')].filter(Boolean).join(', ')].filter(Boolean).join(', ')],
    ['Payer', i.is_private_pay ? 'Private pay' : text(i.payer_name)],
    ['Type', label(INCIDENT_TYPES, i.incident_type)],
    ['Severity', label(SEVERITIES, i.severity)],
    ['Date of incident', [longDate(i.incident_date_s), i.incident_time_s].filter(Boolean).join(' at ')],
    ['Reported by', [text(i.reported_by), text(i.reporter_contact_name)].filter(Boolean).join(' — ')],
    ['Reporter contact', [text(i.reporter_phone), text(i.reporter_email)].filter(Boolean).join('  ·  ')],
    ['Date reported to CVHC', longDate(i.reported_date_s)],
    ['Caregiver involved', caregiver],
    ['Witnesses', i.witnesses],
    ['Injuries or damage', i.injuries_or_damage],
  ]);

  ui.h2('Description');
  ui.p(dash(i.description));
  if (text(i.actions_taken)) { ui.h2('Actions taken'); ui.p(i.actions_taken); }

  ui.h2('Investigation');
  if (notes.length === 0) {
    ui.p('No investigation entries have been recorded.', { color: MUTED });
  } else {
    ui.table(
      [{ h: 'Date', w: 72 }, { h: 'Type', w: 92 }, { h: 'What happened', wrap: true }],
      notes.map(n => [shortDate(n.entry_date_s), label(ENTRY_TYPES, n.entry_type), n.summary]),
      { rowH: 13 });
  }

  ui.h2('Findings and conclusion');
  ui.kv([
    ['Conclusion', label(DISPOSITIONS, i.disposition) || 'Not yet determined'],
    ['Date closed', longDate(i.closed_date_s)],
  ]);
  ui.p(text(i.findings) || 'Findings have not been recorded.', { color: text(i.findings) ? INK : MUTED });

  if (!forPayer) {
    // Internal-only detail: mandatory-report decision, follow-up, attachment index.
    ui.h2('Mandatory reporting');
    ui.kv([
      ['Decision', label(MANDATORY_REPORT_STATUSES, i.mandatory_report_status) || 'Not recorded'],
      ['Details', i.mandatory_report_details],
    ]);
    if (i.follow_up_required || text(i.follow_up_notes)) {
      ui.h2('Follow-up');
      ui.p(text(i.follow_up_notes) || 'Follow-up required.');
    }
    ui.h2('Caregiver schedule');
    ui.p(scheduleStatusSentence(data));
    if (attachments.length) {
      ui.h2('Attachments on file');
      ui.bullets(attachments.map(a => `${a.file_name} (${label(ATTACHMENT_CATEGORIES, a.category)})${a.description ? ` — ${a.description}` : ''}`));
    }
  }
}

// Truthful schedule-status sentence, derived only from stored data.
function scheduleStatusSentence(data) {
  const { incident: i } = data;
  const caregiver = personName(i.caregiver_first, i.caregiver_last);
  const member = personName(i.client_first, i.client_last);
  if (!i.caregiver_id) return 'No caregiver is named on this incident.';
  const parts = [];
  if (i.caregiver_removed_from_s) {
    parts.push(`Effective ${longDate(i.caregiver_removed_from_s)}, CVHC removed ${caregiver} from ${member}'s schedule pending investigation.`);
    if (i.caregiver_returned_on_s) parts.push(`The caregiver was returned to the member's schedule on ${longDate(i.caregiver_returned_on_s)}.`);
  } else {
    parts.push(`CVHC did not remove ${caregiver} from ${member}'s schedule.`);
  }
  // No EVV "most recent visit" claim here: a caregiver who works without clocking in has
  // no record, so the last clock-in says nothing about whether they were in the home
  // (IR-2026-001: Neugene kept working after his last clock-in on Aug 14).
  return parts.join(' ');
}

// ─────────────────────────────── INCIDENT REPORT ───────────────────────────────
function renderIncidentReportPdf(doc, data) {
  const ui = makeLayout(doc);
  const i = data.incident;
  ui.letterhead(false);
  ui.title('Incident Report', `${dash(i.incident_number)}  ·  Printed ${longDate(i.today_s)}`);
  incidentSections(ui, data, { forPayer: false });
  ui.signatures([['Investigated by (signature)', 'Date'], ['Administrator (signature)', 'Date']]);
  ui.footers(`${AGENCY.name}  ·  Incident ${dash(i.incident_number)}`);
}

// ─────────────────────────────── RESPONSE PACKET ───────────────────────────────
// options.includeEvv: add Exhibit A (EVV clock-in history). Off by default: payers rarely
// ask for it, and send only what was requested (binder 00-Cover-Letter-Template).
function renderResponsePacketPdf(doc, data, options = {}) {
  const includeEvv = !!options.includeEvv;
  const ui = makeLayout(doc);
  const { incident: i, visits, backgroundCheck, trainings } = data;
  const member = personName(i.client_first, i.client_last);
  const caregiver = personName(i.caregiver_first, i.caregiver_last);
  const payer = i.is_private_pay ? '' : text(i.payer_name);
  const org = payer || text(i.reported_by);
  const idLine = memberIdLine(i);
  const ackSigned = !!i.training_ack_signed_at;
  const relevantTrainings = trainings.filter(t => ['medication_administration', 'medication_reminders', 'misappropriation_policy'].includes(t.training_type));

  const enclosures = ['Incident Report and Investigation Summary'];
  if (includeEvv && visits.length) enclosures.push('Exhibit A: EVV visit history for the member\'s home');
  if (i.caregiver_id) {
    enclosures.push('Caregiver background check record');
    enclosures.push(ackSigned ? 'Caregiver training acknowledgement (signed)' : 'Caregiver training record');
    enclosures.push('Statement regarding caregiver schedule status');
  }

  // ── Cover letter ──
  ui.letterhead(false);
  ui.p(longDate(i.today_s), { after: 0.7 });
  ui.p([text(i.reporter_contact_name) || 'Care Manager', org, 'Submitted via provider correspondence'].filter(Boolean).join('\n'), { after: 0.7 });
  ui.p(`RE: Response to Provider Concern — Member ${member}${idLine ? ` (${idLine})` : ''}\n${label(INCIDENT_TYPES, i.incident_type)} · CVHC Incident ${dash(i.incident_number)}`, { bold: true, after: 0.7 });
  ui.p(`Dear ${text(i.reporter_contact_name) || 'Care Manager'},`);
  ui.p(`Thank you for notifying Chippewa Valley Home Care (CVHC) of this concern${i.reported_date_s ? ` on ${longDate(i.reported_date_s)}` : ''}. This letter and its enclosures respond to your request.`);

  const conclusion = i.disposition
    ? ` CVHC's investigation concluded the concern was ${label(DISPOSITIONS, i.disposition).toLowerCase()}${i.disposition === 'unsubstantiated' ? ' as to CVHC staff' : ''}.`
    : ' CVHC\'s investigation is ongoing.';
  ui.runIn('1. Incident report and investigation. ',
    `Enclosed is CVHC Incident Report and Investigation Summary ${dash(i.incident_number)}.${conclusion}${text(i.findings) ? ` ${String(i.findings).trim()}` : ''}`);

  if (i.caregiver_id) {
    const bgcText = backgroundCheck
      ? `Enclosed is the caregiver's background check record${backgroundCheck.provider ? ` (${backgroundCheck.provider})` : ''}${backgroundCheck.result ? `, result: ${String(backgroundCheck.result).toLowerCase()}` : ''}${backgroundCheck.completed_s ? `, completed ${longDate(backgroundCheck.completed_s)}` : ''}.`
      : 'CVHC has no background check record on file in its system for this caregiver.';
    const trText = ackSigned
      ? ` Also enclosed is the caregiver's signed acknowledgement covering medication handling and the misappropriation of client property, signed ${longDate(i.training_ack_signed_s)}.`
      : relevantTrainings.length
        ? ' Also enclosed is the caregiver\'s training record for medication handling and misappropriation.'
        : ' CVHC has no completed medication-handling or misappropriation training on file in its system for this caregiver.';
    ui.runIn('2. Background check and training. ', bgcText + trText);
    ui.runIn('3. Caregiver schedule status. ', scheduleStatusSentence(data));
  }
  ui.p('Please contact me with any questions or if you need additional information.', { after: 0.4 });
  ui.p('Sincerely,', { after: 0 });
  ui.signatures([['Signature', 'Date'], ['Printed name', 'Title']]);
  doc.moveDown(0.2);
  ui.p('Enclosures', { bold: true, size: 9, after: 0.15 });
  ui.bullets(enclosures, true, 8.5);

  // ── Incident report + investigation ──
  ui.newPage(false);
  ui.title('Incident Report and Investigation Summary', `${dash(i.incident_number)}  ·  Confidential — contains protected health information`);
  incidentSections(ui, data, { forPayer: true });
  ui.signatures([['Investigated by (signature)', 'Date'], ['Administrator (signature)', 'Date']]);

  // ── Exhibit A: EVV ──
  if (includeEvv && visits.length) {
    ui.newPage(true);
    ui.title('Exhibit A — EVV Visit History', `Member: ${member}${idLine ? `  ·  ${idLine}` : ''}`);
    ui.p(`Each row is a date on which a CVHC caregiver clocked in at the member's home, from CVHC's Electronic Visit Verification records, January 1 of ${String(i.incident_date_s).slice(0, 4)} through ${longDate(i.today_s)}. Arrival is the first clock-in that day, Central Time.`, { size: 9, color: MUTED });
    ui.table(
      [{ h: '#', w: 30 }, { h: 'Date', w: 110 }, { h: 'Arrival', w: 75 }, { h: 'GPS location', w: 80 }, { h: 'Caregiver' }],
      visits.map((v, n) => [n + 1, v.day_s, v.arrival, v.gps ? 'Yes' : 'No', personName(v.cg_first, v.cg_last)]),
      { rowH: 12 });
    const lastVisit = visits[visits.length - 1];
    ui.p(`Most recent clock-in recorded at the member's home: ${lastVisit.day_s}.`, { bold: true, size: 9.5 });
    ui.p('"GPS location: No" means the clock-in was recorded without a location fix from the caregiver\'s phone.', { size: 8.5, color: MUTED });
  }

  if (i.caregiver_id) {
    // ── Background check ──
    ui.newPage(false);
    ui.title('Caregiver Background Check', `Caregiver: ${caregiver}`);
    if (backgroundCheck) {
      ui.kv([
        ['Caregiver', caregiver],
        ['Employer', `${AGENCY.name}, ${AGENCY.city}, ${AGENCY.state}`],
        ['Check type', backgroundCheck.check_type === 'worcs' ? 'Wisconsin Department of Justice caregiver background check (WORCS)' : text(backgroundCheck.check_type)],
        ['Provider', backgroundCheck.provider],
        ['Status', backgroundCheck.status],
        ['Result', backgroundCheck.result],
        ['Date completed', longDate(backgroundCheck.completed_s)],
        ['Next recheck due', longDate(backgroundCheck.expires_s)],
        ['Reference number', backgroundCheck.reference],
      ]);
      ui.p('Details above are from CVHC\'s background check record for this caregiver.', { size: 9.5, color: MUTED });
    } else {
      ui.p('CVHC has no background check record on file in its system for this caregiver.');
    }
    ui.signatures([['Verified against personnel file by (signature)', 'Date']]);

    // ── Training ──
    ui.newPage(false);
    ui.title('Caregiver Training: Medication Handling and Misappropriation', `Caregiver: ${caregiver}`);
    if (trainings.length) {
      ui.h2('Training record on file');
      ui.table(
        [{ h: 'Training', wrap: true }, { h: 'Completed', w: 80 }, { h: 'Expires', w: 80 }, { h: 'Provider', w: 130, wrap: true }],
        trainings.map(t => [TRAINING_TYPE_LABELS[t.training_type] || text(t.training_name) || text(t.training_type), shortDate(t.completed_s) || '—', shortDate(t.expires_s) || '—', dash(t.provider)]),
        { rowH: 13 });
    }
    ui.h2('Acknowledgement');
    ui.bullets([
      'Medication reminders versus administration. CVHC caregivers may remind a client that a medication is due. CVHC caregivers do not administer medications, do not set up or count doses, do not store medications, and never remove medications from a client\'s home.',
      'Controlled medications. Caregivers do not touch, move, or handle a client\'s controlled medications. If a client asks for help with one, the caregiver declines and tells the office the same day.',
      'Client Funds, Property & Misappropriation policy. CVHC has zero tolerance for taking, borrowing, holding, or removing any client property, including medications, even if the client offers.',
      'Reporting. If a caregiver notices medications missing or disturbed, or a client raises a concern about medications, the caregiver reports it to the office the same day. Suspected exploitation of an elder adult at risk is reported under Wis. Stat. § 46.90.',
      'Electronic Visit Verification. Every visit is clocked in and out on the CVHC app so CVHC\'s records show exactly when a caregiver was and was not in a client\'s home.',
    ], true, 9.5);
    if (ackSigned) {
      ui.kv([
        ['Signed by', i.training_ack_signer_name],
        ['Date signed', longDate(i.training_ack_signed_s)],
        ['Reviewed with', i.training_ack_supervisor],
        ['Method', label(TRAINING_ACK_METHODS, i.training_ack_method)],
      ]);
      const sig = dataUriToBuffer(i.training_ack_signature);
      if (sig) {
        ui.ensure(90);
        doc.font('Helvetica').fontSize(8.5).fillColor(MUTED).text('Caregiver signature', ui.L(), doc.y);
        try { doc.image(sig, ui.L(), doc.y + 2, { fit: [240, 70] }); } catch (_) { /* unreadable image */ }
        doc.y += 78; doc.x = ui.L();
      }
    } else {
      ui.p('I reviewed the content above with my supervisor. I understand it and I agree to follow it.');
      ui.signatures([['Caregiver signature', 'Date'], ['Supervisor signature and title', 'Date']]);
    }

    // ── Schedule statement ──
    ui.newPage(false);
    ui.title('Statement Regarding Caregiver Schedule Status', `Incident ${dash(i.incident_number)}`);
    ui.kv([['Member', [member, idLine].filter(Boolean).join('  ·  ')], ['Caregiver', caregiver]]);
    ui.p(scheduleStatusSentence(data));
    if (i.disposition) ui.p(`CVHC's investigation concluded the concern was ${label(DISPOSITIONS, i.disposition).toLowerCase()}${i.disposition === 'unsubstantiated' ? ' as to CVHC staff' : ''}.`);
    ui.p('I certify that this statement is true and accurate to the best of my knowledge, based on CVHC\'s scheduling records.');
    ui.signatures([['Signature', 'Date'], ['Printed name', 'Title']]);
  }

  ui.footers(`${AGENCY.name}  ·  Response to ${org || 'payer'}  ·  ${dash(i.incident_number)}`);
}

module.exports = { loadIncidentCase, renderIncidentReportPdf, renderResponsePacketPdf, scheduleStatusSentence };
