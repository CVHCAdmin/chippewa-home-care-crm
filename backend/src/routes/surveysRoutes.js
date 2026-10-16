// routes/surveysRoutes.js — anonymous staff surveys (mounted at /api/surveys)
//
// Each caregiver gets their own emailed link (so only staff answer, once each). Who has
// answered (survey_invitations.responded) and what was answered (survey_responses) are
// stored with NOTHING linking them, and a response keeps only its date. Results are
// shown only once at least MIN_RESPONSES people have answered, with comments shuffled,
// so a single early answer can't be pinned on whoever just submitted. The only identity
// on a response is a name the respondent chose to type into "contact me".
//
//   /public/*  token-only, rate-limited (the respondent) — never logs answers
//   everything else: admin
const express = require('express');
const crypto = require('crypto');
const rateLimit = require('express-rate-limit');
const router = express.Router();
const db = require('../db');
const { verifyToken, requireAdmin, auditLog } = require('../middleware/shared');
const { clientIp } = require('../helpers/clientIp');

const MIN_RESPONSES = 3;
const DEFAULT_TITLE = 'How are we doing? — Anonymous staff survey';
const DEFAULT_INTRO = 'We want honest feedback on how we are doing as owners and what we can do better. This survey is anonymous: your answers are stored separately from your name, and nobody — including the owners — can see who said what. It takes about 5 minutes.';
const DEFAULT_QUESTIONS = [
  { key: 'overall', type: 'scale5', label: 'Overall, how happy are you working at CVHC?' },
  { key: 'respected', type: 'scale5', label: 'I feel respected and appreciated by the owners.' },
  { key: 'communication', type: 'scale5', label: 'The office communicates clearly (schedule changes, expectations, policies).' },
  { key: 'responsive', type: 'scale5', label: 'When I have a problem or question, the office responds quickly.' },
  { key: 'schedule', type: 'scale5', label: 'My schedule and hours work for me.' },
  { key: 'pay', type: 'scale5', label: 'I feel I\'m paid fairly, on time, and correctly.' },
  { key: 'support', type: 'scale5', label: 'I have the training and support I need to do my job well.' },
  { key: 'app', type: 'scale5', label: 'The app (clock-in, schedule) is easy to use.' },
  { key: 'recommend', type: 'nps', label: 'How likely are you to recommend CVHC to a friend as a place to work?' },
  { key: 'doing_well', type: 'text', label: 'What\'s one thing we\'re doing well?' },
  { key: 'improve', type: 'text', label: 'What\'s one thing we should change or improve?' },
  { key: 'anything_else', type: 'text', label: 'Anything else you want the owners to know?' },
];

const publicLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 60, standardHeaders: true, legacyHeaders: false, keyGenerator: clientIp });
const newToken = () => crypto.randomBytes(48).toString('hex');
const surveyUrl = (token) => `${(process.env.FRONTEND_URL || 'https://app.chippewavalleyhomecare.com').replace(/\/$/, '')}/survey/${token}`;
const httpError = (status, message) => Object.assign(new Error(message), { status });
const sendErr = (res, e, tag) => {
  if (!e.status) console.error(`[surveys] ${tag}:`, e.message);
  res.status(e.status || 500).json({ error: e.status ? e.message : 'Something went wrong — please try again.' });
};
const shuffle = (arr) => { const a = [...arr]; for (let i = a.length - 1; i > 0; i--) { const j = crypto.randomInt(i + 1); [a[i], a[j]] = [a[j], a[i]]; } return a; };

// ── PUBLIC (respondent) ──────────────────────────────────────────────────────

async function loadInvite(token) {
  const r = await db.query(
    `SELECT si.id, si.responded, s.id AS survey_id, s.title, s.intro, s.questions, s.status, u.first_name
       FROM survey_invitations si JOIN surveys s ON s.id = si.survey_id JOIN users u ON u.id = si.user_id
      WHERE si.token = $1`, [String(token || '')]);
  if (!r.rows[0]) throw httpError(404, 'This survey link is not valid.');
  return r.rows[0];
}

router.get('/public/:token', publicLimiter, async (req, res) => {
  try {
    const inv = await loadInvite(req.params.token);
    res.json({ title: inv.title, intro: inv.intro, questions: inv.questions, firstName: inv.first_name,
      responded: inv.responded, closed: inv.status !== 'open' });
  } catch (e) { sendErr(res, e, 'public get'); }
});

function validateAnswers(questions, answers) {
  const out = {};
  const missing = [];
  for (const q of questions) {
    const v = (answers || {})[q.key];
    if (q.type === 'scale5') {
      const n = Number(v);
      if (!Number.isInteger(n) || n < 1 || n > 5) { missing.push(q.label); continue; }
      out[q.key] = n;
    } else if (q.type === 'nps') {
      const n = Number(v);
      if (!Number.isInteger(n) || n < 0 || n > 10) { missing.push(q.label); continue; }
      out[q.key] = n;
    } else {
      const t = String(v ?? '').trim().slice(0, 3000);
      if (t) out[q.key] = t;
    }
  }
  if (missing.length) throw httpError(400, `Please answer every rating question (${missing.length} left).`);
  return out;
}

// POST /public/:token/submit { answers, contactName? }
// The invitation is marked answered and the response stored in one transaction, but the
// response row carries nothing that points back to the invitation or the person.
router.post('/public/:token/submit', publicLimiter, async (req, res) => {
  const client = await db.pool.connect();
  try {
    const inv = await loadInvite(req.params.token);
    if (inv.status !== 'open') throw httpError(410, 'This survey is closed. Thank you!');
    const answers = validateAnswers(inv.questions, req.body && req.body.answers);
    const contact = String((req.body && req.body.contactName) || '').trim().slice(0, 120) || null;
    await client.query('BEGIN');
    const upd = await client.query(`UPDATE survey_invitations SET responded = true WHERE id = $1 AND responded = false RETURNING id`, [inv.id]);
    if (!upd.rows[0]) throw httpError(409, 'You already answered this survey. Thank you!');
    await client.query(`INSERT INTO survey_responses (survey_id, answers, contact_name, submitted_on)
                        VALUES ($1, $2, $3, (NOW() AT TIME ZONE 'America/Chicago')::date)`, [inv.survey_id, answers, contact]);
    await client.query('COMMIT');
    res.json({ ok: true });
  } catch (e) {
    try { await client.query('ROLLBACK'); } catch (_) { /* nothing open */ }
    sendErr(res, e, 'public submit');
  } finally { client.release(); }
});

// ── ADMIN ────────────────────────────────────────────────────────────────────
router.use((req, res, next) => (req.path.startsWith('/public') ? next('router') : next()));
router.use(verifyToken, requireAdmin);

router.get('/', async (req, res) => {
  try {
    const r = await db.query(
      `SELECT s.id, s.title, s.status, s.created_at, s.closed_at,
              (SELECT COUNT(*)::int FROM survey_invitations i WHERE i.survey_id = s.id) AS invited,
              (SELECT COUNT(*)::int FROM survey_invitations i WHERE i.survey_id = s.id AND i.responded) AS responded
         FROM surveys s ORDER BY s.created_at DESC`);
    res.json(r.rows);
  } catch (e) { sendErr(res, e, 'list'); }
});

// POST / { title?, intro? } — new survey with the standard questions
router.post('/', async (req, res) => {
  try {
    const title = String((req.body && req.body.title) || '').trim().slice(0, 200) || DEFAULT_TITLE;
    const intro = String((req.body && req.body.intro) || '').trim().slice(0, 2000) || DEFAULT_INTRO;
    const r = await db.query(`INSERT INTO surveys (title, intro, questions, created_by) VALUES ($1,$2,$3,$4) RETURNING id, title, status`,
      [title, intro, JSON.stringify(DEFAULT_QUESTIONS), req.user.id]);
    await auditLog(req.user.id, 'CREATE', 'surveys', r.rows[0].id, null, { title });
    res.status(201).json(r.rows[0]);
  } catch (e) { sendErr(res, e, 'create'); }
});

// GET /:id/people — who has been invited and whether they've answered (never what)
router.get('/:id/people', async (req, res) => {
  try {
    const r = await db.query(
      `SELECT u.id AS user_id, u.first_name, u.last_name, u.email,
              si.id AS invitation_id, si.sent_at, si.responded, si.reminder_count
         FROM users u
         LEFT JOIN survey_invitations si ON si.user_id = u.id AND si.survey_id = $1
        WHERE u.is_active = true AND u.role = 'caregiver'
        ORDER BY si.responded NULLS FIRST, u.last_name, u.first_name`, [req.params.id]);
    res.json(r.rows);
  } catch (e) { sendErr(res, e, 'people'); }
});

async function emailInvite(inv, firstName, title, isReminder) {
  const { sendSurveyInvite } = require('../services/emailService');
  return sendSurveyInvite({ to: inv.email_to, firstName, title, url: surveyUrl(inv.token), isReminder });
}

// POST /:id/send { userIds[] }
router.post('/:id/send', async (req, res) => {
  try {
    const s = await db.query(`SELECT * FROM surveys WHERE id = $1`, [req.params.id]);
    const survey = s.rows[0];
    if (!survey) throw httpError(404, 'Survey not found.');
    if (survey.status !== 'open') throw httpError(409, 'This survey is closed.');
    const userIds = Array.isArray(req.body.userIds) ? req.body.userIds : [];
    if (!userIds.length) throw httpError(400, 'Pick at least one person.');
    const users = await db.query(`SELECT id, first_name, last_name, email FROM users WHERE id = ANY($1::uuid[]) AND is_active = true`, [userIds]);
    const results = [];
    for (const u of users.rows) {
      const name = `${u.first_name} ${u.last_name}`.trim();
      if (!u.email || !/^\S+@\S+\.\S+$/.test(u.email)) { results.push({ userId: u.id, name, error: 'no valid email on file' }); continue; }
      const ins = await db.query(
        `INSERT INTO survey_invitations (survey_id, user_id, token, email_to) VALUES ($1,$2,$3,$4)
         ON CONFLICT (survey_id, user_id) DO NOTHING RETURNING *`, [survey.id, u.id, newToken(), u.email.trim().toLowerCase()]);
      if (!ins.rows[0]) { results.push({ userId: u.id, name, skipped: 'already invited — use Remind' }); continue; }
      let emailSent = false, emailError = null;
      try { emailSent = await emailInvite(ins.rows[0], u.first_name, survey.title, false); } catch (err) { emailError = err.message; }
      if (!emailSent && !emailError) emailError = 'email not sent (email service not configured)';
      results.push({ userId: u.id, name, emailSent, emailError, url: surveyUrl(ins.rows[0].token) });
    }
    await auditLog(req.user.id, 'SEND', 'surveys', survey.id, null, { invited: results.filter(r => r.url).length });
    res.json({ results });
  } catch (e) { sendErr(res, e, 'send'); }
});

// POST /invitations/:invitationId/remind — only to people who haven't answered
router.post('/invitations/:invitationId/remind', async (req, res) => {
  try {
    const r = await db.query(
      `UPDATE survey_invitations SET reminder_count = reminder_count + 1, last_reminded_at = NOW()
        WHERE id = $1 AND responded = false RETURNING *`, [req.params.invitationId]);
    const inv = r.rows[0];
    if (!inv) throw httpError(409, 'They already answered (or the invitation was not found).');
    const meta = await db.query(`SELECT u.first_name, s.title, s.status FROM users u, surveys s WHERE u.id = $1 AND s.id = $2`, [inv.user_id, inv.survey_id]);
    if (meta.rows[0].status !== 'open') throw httpError(409, 'This survey is closed.');
    let emailSent = false, emailError = null;
    try { emailSent = await emailInvite(inv, meta.rows[0].first_name, meta.rows[0].title, true); } catch (err) { emailError = err.message; }
    res.json({ emailSent, emailError, url: surveyUrl(inv.token) });
  } catch (e) { sendErr(res, e, 'remind'); }
});

// POST /:id/close
router.post('/:id/close', async (req, res) => {
  try {
    const r = await db.query(`UPDATE surveys SET status = 'closed', closed_at = NOW() WHERE id = $1 AND status = 'open' RETURNING id`, [req.params.id]);
    if (!r.rows[0]) throw httpError(409, 'Already closed.');
    res.json({ ok: true });
  } catch (e) { sendErr(res, e, 'close'); }
});

// GET /:id/results — anonymous summary (hidden until MIN_RESPONSES answers are in)
router.get('/:id/results', async (req, res) => {
  try {
    const s = await db.query(`SELECT id, title, questions FROM surveys WHERE id = $1`, [req.params.id]);
    if (!s.rows[0]) throw httpError(404, 'Survey not found.');
    const rows = (await db.query(`SELECT answers, contact_name FROM survey_responses WHERE survey_id = $1`, [req.params.id])).rows;
    if (rows.length < MIN_RESPONSES) {
      return res.json({ count: rows.length, minimum: MIN_RESPONSES, hidden: true });
    }
    const questions = s.rows[0].questions.map(q => {
      const vals = rows.map(r => r.answers[q.key]).filter(v => v !== undefined && v !== null && v !== '');
      if (q.type === 'text') return { ...q, answers: shuffle(vals) };
      const nums = vals.map(Number);
      const dist = {};
      for (const n of nums) dist[n] = (dist[n] || 0) + 1;
      const avg = nums.length ? Math.round((nums.reduce((a, b) => a + b, 0) / nums.length) * 10) / 10 : null;
      const extra = q.type === 'nps' && nums.length ? {
        promoters: nums.filter(n => n >= 9).length, passives: nums.filter(n => n >= 7 && n <= 8).length,
        detractors: nums.filter(n => n <= 6).length,
        score: Math.round(((nums.filter(n => n >= 9).length - nums.filter(n => n <= 6).length) / nums.length) * 100),
      } : {};
      return { ...q, count: nums.length, average: avg, distribution: dist, ...extra };
    });
    // People who chose to give their name: show it with their written comments only.
    const textKeys = s.rows[0].questions.filter(q => q.type === 'text').map(q => q.key);
    const contacts = shuffle(rows.filter(r => r.contact_name).map(r => ({
      name: r.contact_name, comments: textKeys.map(k => r.answers[k]).filter(Boolean),
    })));
    res.json({ count: rows.length, minimum: MIN_RESPONSES, hidden: false, questions, contacts });
  } catch (e) { sendErr(res, e, 'results'); }
});

module.exports = router;
module.exports.validateAnswers = validateAnswers;
module.exports.DEFAULT_QUESTIONS = DEFAULT_QUESTIONS;
