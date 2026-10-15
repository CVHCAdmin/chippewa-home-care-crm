// routes/signRequestsRoutes.js — emailed e-signature requests (mounted at /api/sign-requests)
//
// The office sends a document (the DHS BID form, or an uploaded policy PDF) to staff.
// Each person gets their own private link by email (no login). They answer / read, draw
// a signature, and the signed PDF is stored encrypted, one record per person.
//
//   /public/*  token-only, rate-limited (the signer)
//   everything else: admin (the mount in server.js adds verifyToken; requireAdmin here)
const express = require('express');
const crypto = require('crypto');
const rateLimit = require('express-rate-limit');
const { v4: uuidv4 } = require('uuid');
const router = express.Router();
const db = require('../db');
const { verifyToken, requireAdmin, auditLog } = require('../middleware/shared');
const { clientIp } = require('../helpers/clientIp');
const { encrypt, decrypt } = require('../services/encryptionService');
const { fillBid, appendSignaturePage, mergePdfs, BID_QUESTIONS } = require('../services/signedPdf');
const fs = require('fs');
const path = require('path');

const LINK_DAYS = 30;
const MAX_UPLOAD_CHARS = 9_500_000;      // ~7 MB PDF as a data URI (JSON body limit is 10 MB)
const MAX_SIGNATURE_CHARS = 700_000;
const BID_PDF_PATH = path.join(__dirname, '..', 'assets', 'forms', 'F-82064-BID.pdf');
const EMPLOYER = {
  name: process.env.AGENCY_NAME_LEGAL || 'Chippewa Valley Home Care LLC',
  street: process.env.AGENCY_ADDRESS || '2607 Beverly Hills Dr',
  city: process.env.AGENCY_CITY || 'Eau Claire',
  state: process.env.AGENCY_STATE || 'WI',
  zip: process.env.AGENCY_ZIP || '54701',
};

const publicLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, max: 60, standardHeaders: true, legacyHeaders: false, keyGenerator: clientIp,
});
const newToken = () => crypto.randomBytes(48).toString('hex');
const frontendUrl = () => (process.env.FRONTEND_URL || 'https://app.chippewavalleyhomecare.com').replace(/\/$/, '');
const signUrl = (token) => `${frontendUrl()}/sign/${token}`;
const nowChicago = () => {
  const d = new Date();
  const date = d.toLocaleDateString('en-US', { timeZone: 'America/Chicago', month: '2-digit', day: '2-digit', year: 'numeric' });
  const time = d.toLocaleTimeString('en-US', { timeZone: 'America/Chicago', hour: 'numeric', minute: '2-digit' });
  return { date, stamp: `${date} ${time}` };
};
const httpError = (status, message) => Object.assign(new Error(message), { status });
const sendErr = (res, e, tag) => {
  if (!e.status) console.error(`[sign-requests] ${tag}:`, e.message);
  res.status(e.status || 500).json({ error: e.status ? e.message : 'Something went wrong — please try again.' });
};

async function emailRequest(reqRow, template, user) {
  const { sendSignRequest } = require('../services/emailService');
  return sendSignRequest({
    to: reqRow.email_to, firstName: user.first_name, title: template.title,
    kind: template.kind, url: signUrl(reqRow.token), expiresAt: reqRow.expires_at,
  });
}

async function notifyAdmins(type, title, message) {
  try {
    const admins = await db.query(`SELECT id FROM users WHERE role = 'admin' AND is_active = true`);
    for (const a of admins.rows) {
      await db.query(
        `INSERT INTO notifications (id, user_id, type, title, message, is_read) VALUES ($1,$2,$3,$4,$5,false)`,
        [uuidv4(), a.id, type, title, message]);
    }
  } catch (e) { console.error('[sign-requests] notify:', e.message); }
}

// ── PUBLIC (signer) ──────────────────────────────────────────────────────────

async function loadByToken(token) {
  const r = await db.query(
    `SELECT sr.*, st.kind, st.title, st.version, st.description,
            u.first_name, u.last_name, u.phone, u.address, u.city, u.state, u.zip, u.role
       FROM sign_requests sr
       JOIN sign_templates st ON st.id = sr.template_id
       JOIN users u ON u.id = sr.user_id
      WHERE sr.token = $1`, [String(token || '')]);
  const row = r.rows[0];
  if (!row) throw httpError(404, 'This signing link is not valid. Ask the office to send you a new one.');
  if (row.status === 'cancelled') throw httpError(410, 'This request was withdrawn by the office.');
  if (row.status !== 'signed' && new Date(row.expires_at) < new Date()) {
    throw httpError(410, 'This signing link has expired. Ask the office to send you a new one.');
  }
  return row;
}

// GET /public/:token — what the signing page needs
router.get('/public/:token', publicLimiter, async (req, res) => {
  try {
    const row = await loadByToken(req.params.token);
    if (row.status === 'sent') {
      await db.query(`UPDATE sign_requests SET status = 'opened', opened_at = NOW() WHERE id = $1 AND status = 'sent'`, [row.id]);
    }
    res.json({
      kind: row.kind, title: row.title, version: row.version, description: row.description,
      signerName: `${row.first_name || ''} ${row.last_name || ''}`.trim(),
      signed: row.status === 'signed', signedAt: row.signed_at,
      employer: EMPLOYER,
      // Pre-fill what the CRM already knows. SSN and date of birth are never pre-filled.
      prefill: row.kind === 'bid' ? {
        firstName: row.first_name || '', lastName: row.last_name || '', phone: row.phone || '',
        street: row.address || '', city: row.city || '', state: row.state || 'WI', zip: row.zip || '',
        position: row.role === 'admin' ? 'Administrator' : 'Caregiver',
      } : null,
      questions: row.kind === 'bid' ? BID_QUESTIONS.map(q => q[0]) : null,
    });
  } catch (e) { sendErr(res, e, 'public get'); }
});

// GET /public/:token/document.pdf — the document to read (policy) / the blank state form
router.get('/public/:token/document.pdf', publicLimiter, async (req, res) => {
  try {
    const row = await loadByToken(req.params.token);
    let buf;
    if (row.kind === 'bid') buf = fs.readFileSync(BID_PDF_PATH);
    else {
      const t = await db.query(`SELECT pdf_base64 FROM sign_templates WHERE id = $1`, [row.template_id]);
      buf = Buffer.from(t.rows[0].pdf_base64, 'base64');
    }
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="${row.kind === 'bid' ? 'F-82064-BID' : 'document'}.pdf"`);
    res.send(buf);
  } catch (e) { sendErr(res, e, 'public pdf'); }
});

const yes = (v) => v === true || v === 'yes';
const no = (v) => v === false || v === 'no';
const clean = (v, max = 200) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, max);

// Validate the BID answers exactly against the state form's required fields.
function validateBid(a) {
  const out = {
    position: clean(a.position, 80), firstName: clean(a.firstName, 60), middleName: clean(a.middleName, 60),
    lastName: clean(a.lastName, 60), otherNames: yes(a.otherNames), otherNamesList: clean(a.otherNamesList, 200),
    ssn: String(a.ssn || '').replace(/\D/g, ''), dob: clean(a.dob, 10), sex: a.sex,
    phone: clean(a.phone, 20), street: clean(a.street, 120), city: clean(a.city, 60),
    state: clean(a.state, 2).toUpperCase(), zip: clean(a.zip, 10), questions: {},
  };
  const missing = [];
  if (!out.firstName) missing.push('first name');
  if (!out.lastName) missing.push('last name');
  if (!out.position) missing.push('position');
  if (!yes(a.otherNames) && !no(a.otherNames)) missing.push('other names (yes/no)');
  if (out.otherNames && !out.otherNamesList) missing.push('the other names you have used');
  if (out.ssn.length !== 9) missing.push('a 9-digit Social Security number');
  if (!/^(0[1-9]|1[0-2])\/(0[1-9]|[12]\d|3[01])\/(19|20)\d\d$/.test(out.dob)) missing.push('date of birth as MM/DD/YYYY');
  if (out.sex !== 'Male' && out.sex !== 'Female') missing.push('sex');
  if (!out.phone) missing.push('phone number');
  if (!out.street || !out.city || !out.state || !out.zip) missing.push('full address');
  const q = a.questions || {};
  for (const [key, , , , describeField, label] of BID_QUESTIONS) {
    const ans = q[key] || {};
    if (key === 'outsideWi7' && !yes((q.govEmployee || {}).yes)) { out.questions[key] = { yes: false }; continue; }
    if (!yes(ans.yes) && !no(ans.yes)) { missing.push(`question ${label.split('.')[0]} (yes/no)`); continue; }
    const describe = String(ans.describe ?? '').trim().slice(0, 2000);
    if (yes(ans.yes) && describeField && !describe) missing.push(`details for question ${label.split('.')[0]}`);
    out.questions[key] = { yes: yes(ans.yes), describe };
  }
  if (out.ssn.length === 9) out.ssn = `${out.ssn.slice(0, 3)}-${out.ssn.slice(3, 5)}-${out.ssn.slice(5)}`;
  if (missing.length) throw httpError(400, `Please complete: ${missing.join(', ')}.`);
  return out;
}

// POST /public/:token/sign { typedName, signaturePng, agree, answers? }
router.post('/public/:token/sign', publicLimiter, async (req, res) => {
  try {
    const row = await loadByToken(req.params.token);
    if (row.status === 'signed') throw httpError(409, 'This document is already signed. Thank you!');
    const { typedName, signaturePng, agree } = req.body || {};
    if (agree !== true) throw httpError(400, 'Please check the box to confirm.');
    const name = clean(typedName, 200);
    if (name.length < 3) throw httpError(400, 'Please type your full legal name.');
    if (!/^data:image\/png;base64,/.test(String(signaturePng || '')) || signaturePng.length > MAX_SIGNATURE_CHARS) {
      throw httpError(400, 'Please draw your signature.');
    }
    const ip = clientIp(req);
    const ua = String(req.headers['user-agent'] || '').slice(0, 300);
    const { date, stamp } = nowChicago();
    let pdf, disclosuresYes = null;
    if (row.kind === 'bid') {
      const answers = validateBid(req.body.answers || {});
      disclosuresYes = BID_QUESTIONS.slice(0, 9).some(([key]) => answers.questions[key] && answers.questions[key].yes);
      pdf = await fillBid(answers, { signaturePng, typedName: name, signedDate: date, signedAt: stamp, ip, employer: EMPLOYER });
    } else {
      const t = await db.query(`SELECT pdf_base64 FROM sign_templates WHERE id = $1`, [row.template_id]);
      pdf = await appendSignaturePage(t.rows[0].pdf_base64, {
        title: row.title, version: row.version, signerName: `${row.first_name} ${row.last_name}`.trim(),
        typedName: name, signedAt: stamp, ip, userAgent: ua, signaturePng,
      });
    }
    const upd = await db.query(
      `UPDATE sign_requests
          SET status = 'signed', signed_at = NOW(), signer_typed_name = $1, signature_ip = $2,
              signature_user_agent = $3, signed_pdf_encrypted = $4, disclosures_yes = $5,
              opened_at = COALESCE(opened_at, NOW())
        WHERE id = $6 AND status IN ('sent', 'opened')
        RETURNING id`,
      [name, ip, ua, encrypt(pdf.toString('base64')), disclosuresYes, row.id]);
    if (!upd.rows[0]) throw httpError(409, 'This document is already signed. Thank you!');
    await auditLog(row.user_id, 'SIGN', 'sign_requests', row.id, null, { title: row.title, ip, disclosures_yes: disclosuresYes });
    const who = `${row.first_name} ${row.last_name}`.trim();
    await notifyAdmins(disclosuresYes ? 'bid_disclosure' : 'document_signed',
      disclosuresYes ? `⚠️ BID disclosure: ${who}` : `Signed: ${who}`,
      disclosuresYes
        ? `${who} answered YES to a disclosure question on the BID form. Review it before their next shift (E-Signatures).`
        : `${who} signed "${row.title}".`);
    res.json({ ok: true, signedAt: stamp });
  } catch (e) { sendErr(res, e, 'public sign'); }
});

// ── ADMIN ────────────────────────────────────────────────────────────────────
router.use((req, res, next) => (req.path.startsWith('/public') ? next('router') : next()));
router.use(verifyToken, requireAdmin);

// GET /templates — documents that can be sent, with signing progress
router.get('/templates', async (req, res) => {
  try {
    const r = await db.query(
      `SELECT st.id, st.kind, st.title, st.version, st.description, st.is_active, st.created_at,
              COUNT(sr.id) FILTER (WHERE sr.status <> 'cancelled')::int AS sent,
              COUNT(sr.id) FILTER (WHERE sr.status = 'signed')::int AS signed,
              COUNT(sr.id) FILTER (WHERE sr.status = 'opened')::int AS opened
         FROM sign_templates st LEFT JOIN sign_requests sr ON sr.template_id = st.id
        GROUP BY st.id ORDER BY st.is_active DESC, st.kind = 'bid' DESC, st.created_at DESC`);
    res.json(r.rows);
  } catch (e) { sendErr(res, e, 'templates'); }
});

// POST /templates { title, version, description, pdfDataUri } — upload a policy to be acknowledged
router.post('/templates', async (req, res) => {
  try {
    const { title, version, description, pdfDataUri } = req.body || {};
    if (!clean(title)) throw httpError(400, 'Title is required.');
    const m = /^data:application\/pdf;base64,(.+)$/.exec(String(pdfDataUri || ''));
    if (!m) throw httpError(400, 'Upload a PDF file.');
    if (pdfDataUri.length > MAX_UPLOAD_CHARS) throw httpError(400, 'PDF is too large (7 MB max).');
    if (!Buffer.from(m[1].slice(0, 12), 'base64').toString('latin1').startsWith('%PDF')) throw httpError(400, 'That file is not a PDF.');
    const r = await db.query(
      `INSERT INTO sign_templates (kind, title, version, description, pdf_base64, created_by)
       VALUES ('acknowledge', $1, $2, $3, $4, $5) RETURNING id, kind, title, version, description, is_active, created_at`,
      [clean(title), clean(version, 40) || null, clean(description, 1000) || null, m[1], req.user.id]);
    await auditLog(req.user.id, 'CREATE', 'sign_templates', r.rows[0].id, null, { title: r.rows[0].title, version: r.rows[0].version });
    res.status(201).json(r.rows[0]);
  } catch (e) { sendErr(res, e, 'upload'); }
});

// PATCH /templates/:id { isActive }
router.patch('/templates/:id', async (req, res) => {
  try {
    if (typeof req.body.isActive !== 'boolean') throw httpError(400, 'isActive (true/false) is required.');
    const r = await db.query(`UPDATE sign_templates SET is_active = $1 WHERE id = $2 RETURNING id, is_active`, [req.body.isActive, req.params.id]);
    if (!r.rows[0]) throw httpError(404, 'Not found.');
    res.json(r.rows[0]);
  } catch (e) { sendErr(res, e, 'patch template'); }
});

// GET /templates/:id/document.pdf — the blank document
router.get('/templates/:id/document.pdf', async (req, res) => {
  try {
    const t = await db.query(`SELECT kind, pdf_base64 FROM sign_templates WHERE id = $1`, [req.params.id]);
    if (!t.rows[0]) throw httpError(404, 'Not found.');
    res.setHeader('Content-Type', 'application/pdf');
    res.send(t.rows[0].kind === 'bid' ? fs.readFileSync(BID_PDF_PATH) : Buffer.from(t.rows[0].pdf_base64, 'base64'));
  } catch (e) { sendErr(res, e, 'template pdf'); }
});

// GET /templates/:id/people — every active staff member and where they stand on this document
router.get('/templates/:id/people', async (req, res) => {
  try {
    const r = await db.query(
      `SELECT u.id AS user_id, u.first_name, u.last_name, u.email, u.role,
              sr.id AS request_id, sr.status, sr.sent_at, sr.opened_at, sr.signed_at, sr.reminder_count,
              sr.last_reminded_at, sr.expires_at, sr.disclosures_yes, sr.signer_typed_name
         FROM users u
         LEFT JOIN LATERAL (
           SELECT * FROM sign_requests x
            WHERE x.template_id = $1 AND x.user_id = u.id AND x.status <> 'cancelled'
            ORDER BY (x.status = 'signed') DESC, x.created_at DESC LIMIT 1
         ) sr ON true
        WHERE u.is_active = true AND u.role IN ('caregiver', 'admin')
        ORDER BY (sr.status = 'signed') NULLS FIRST, u.last_name, u.first_name`, [req.params.id]);
    res.json(r.rows);
  } catch (e) { sendErr(res, e, 'people'); }
});

// POST /send { templateId, userIds[] } — email each person their own signing link
router.post('/send', async (req, res) => {
  try {
    const { templateId, userIds } = req.body || {};
    if (!Array.isArray(userIds) || !userIds.length) throw httpError(400, 'Pick at least one person.');
    const t = await db.query(`SELECT * FROM sign_templates WHERE id = $1 AND is_active = true`, [templateId]);
    const template = t.rows[0];
    if (!template) throw httpError(404, 'Document not found or inactive.');
    const users = await db.query(
      `SELECT id, first_name, last_name, email FROM users WHERE id = ANY($1::uuid[]) AND is_active = true`, [userIds]);
    const results = [];
    for (const u of users.rows) {
      const name = `${u.first_name} ${u.last_name}`.trim();
      const existing = await db.query(
        `SELECT status FROM sign_requests WHERE template_id = $1 AND user_id = $2 AND status IN ('sent','opened','signed')
          ORDER BY (status = 'signed') DESC LIMIT 1`, [template.id, u.id]);
      if (existing.rows[0]) { results.push({ userId: u.id, name, skipped: existing.rows[0].status === 'signed' ? 'already signed' : 'already sent — use Remind' }); continue; }
      if (!u.email || !/^\S+@\S+\.\S+$/.test(u.email)) { results.push({ userId: u.id, name, error: 'no valid email on file' }); continue; }
      const ins = await db.query(
        `INSERT INTO sign_requests (template_id, user_id, token, email_to, expires_at, created_by)
         VALUES ($1, $2, $3, $4, NOW() + ($5 || ' days')::interval, $6) RETURNING *`,
        [template.id, u.id, newToken(), u.email.trim().toLowerCase(), String(LINK_DAYS), req.user.id]);
      let emailSent = false, emailError = null;
      try { emailSent = await emailRequest(ins.rows[0], template, u); } catch (err) { emailError = err.message; }
      if (!emailSent && !emailError) emailError = 'email not sent (email service not configured)';
      results.push({ userId: u.id, name, requestId: ins.rows[0].id, emailSent, emailError, url: signUrl(ins.rows[0].token) });
    }
    await auditLog(req.user.id, 'SEND', 'sign_templates', template.id, null,
      { title: template.title, sent: results.filter(r => r.requestId).length, skipped: results.filter(r => !r.requestId).length });
    res.json({ results });
  } catch (e) { sendErr(res, e, 'send'); }
});

// POST /requests/:id/remind — email the same link again (and extend it)
router.post('/requests/:id/remind', async (req, res) => {
  try {
    const r = await db.query(
      `UPDATE sign_requests SET reminder_count = reminder_count + 1, last_reminded_at = NOW(),
              expires_at = GREATEST(expires_at, NOW() + ($2 || ' days')::interval)
        WHERE id = $1 AND status IN ('sent','opened') RETURNING *`, [req.params.id, String(LINK_DAYS)]);
    const row = r.rows[0];
    if (!row) throw httpError(409, 'Only unsigned requests can be reminded.');
    const t = await db.query(`SELECT * FROM sign_templates WHERE id = $1`, [row.template_id]);
    const u = await db.query(`SELECT first_name FROM users WHERE id = $1`, [row.user_id]);
    let emailSent = false, emailError = null;
    try { emailSent = await emailRequest(row, t.rows[0], u.rows[0]); } catch (err) { emailError = err.message; }
    res.json({ emailSent, emailError, url: signUrl(row.token) });
  } catch (e) { sendErr(res, e, 'remind'); }
});

// POST /requests/:id/cancel
router.post('/requests/:id/cancel', async (req, res) => {
  try {
    const r = await db.query(`UPDATE sign_requests SET status = 'cancelled' WHERE id = $1 AND status IN ('sent','opened') RETURNING id`, [req.params.id]);
    if (!r.rows[0]) throw httpError(409, 'Only unsigned requests can be cancelled.');
    await auditLog(req.user.id, 'CANCEL', 'sign_requests', req.params.id, null, null);
    res.json({ ok: true });
  } catch (e) { sendErr(res, e, 'cancel'); }
});

const signedPdfBuffer = (enc) => {
  const b64 = decrypt(enc);
  if (!b64) throw httpError(500, 'Could not decrypt the signed document.');
  return Buffer.from(b64, 'base64');
};

// GET /requests/:id/signed.pdf — one person's signed document
router.get('/requests/:id/signed.pdf', async (req, res) => {
  try {
    const r = await db.query(
      `SELECT sr.signed_pdf_encrypted, u.last_name, u.first_name, st.kind FROM sign_requests sr
         JOIN users u ON u.id = sr.user_id JOIN sign_templates st ON st.id = sr.template_id
        WHERE sr.id = $1 AND sr.status = 'signed'`, [req.params.id]);
    if (!r.rows[0]) throw httpError(404, 'Signed document not found.');
    await auditLog(req.user.id, 'DOWNLOAD', 'sign_requests', req.params.id, null, null);
    const fname = `${r.rows[0].kind === 'bid' ? 'BID' : 'Signed'}-${r.rows[0].last_name}-${r.rows[0].first_name}.pdf`.replace(/[^\w.-]+/g, '_');
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="${fname}"`);
    res.send(signedPdfBuffer(r.rows[0].signed_pdf_encrypted));
  } catch (e) { sendErr(res, e, 'signed pdf'); }
});

// GET /templates/:id/all-signed.pdf — every signed copy in one PDF (for an MCO / auditor)
router.get('/templates/:id/all-signed.pdf', async (req, res) => {
  try {
    const r = await db.query(
      `SELECT DISTINCT ON (sr.user_id) sr.signed_pdf_encrypted, u.last_name, u.first_name
         FROM sign_requests sr JOIN users u ON u.id = sr.user_id
        WHERE sr.template_id = $1 AND sr.status = 'signed'
        ORDER BY sr.user_id, sr.signed_at DESC`, [req.params.id]);
    if (!r.rows.length) throw httpError(404, 'Nobody has signed this yet.');
    r.rows.sort((a, b) => `${a.last_name} ${a.first_name}`.localeCompare(`${b.last_name} ${b.first_name}`));
    const merged = await mergePdfs(r.rows.map(x => signedPdfBuffer(x.signed_pdf_encrypted)));
    await auditLog(req.user.id, 'DOWNLOAD', 'sign_templates', req.params.id, null, { combined: r.rows.length });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="all-signed-${req.params.id.slice(0, 8)}.pdf"`);
    res.send(merged);
  } catch (e) { sendErr(res, e, 'all signed'); }
});

module.exports = router;
module.exports.validateBid = validateBid;
