// routes/publicLeadRoutes.js — public, unauthenticated endpoints hit by the marketing website
// Mounted at /api/public in server.js
const express = require('express');
const rateLimit = require('express-rate-limit');
const db = require('../db');

const router = express.Router();

// Per-IP throttle to keep bots from flooding the CRM prospects table.
const leadLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many submissions from this address. Please try again later or call (715) 491-1254.' }
});

// Lighter limiter for simple GETs (job postings list) so the website can
// fetch on every page load without tripping the form limiter.
const readLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
});

router.post('/prospects', leadLimiter, async (req, res) => {
  try {
    // Honeypot: real users never fill this hidden field; bots usually do.
    if (req.body.botField) return res.status(200).json({ success: true });

    const { firstName, lastName, phone, email, relationship, service, payment, message } = req.body;

    if (!firstName || !lastName) {
      return res.status(400).json({ error: 'Name is required' });
    }
    if (!phone && !email) {
      return res.status(400).json({ error: 'Phone or email is required so we can follow up' });
    }

    const notesParts = [];
    if (relationship) notesParts.push(`Who needs care: ${relationship}`);
    if (service)      notesParts.push(`Type of care: ${service}`);
    if (payment)      notesParts.push(`Payment plan: ${payment}`);
    if (message)      notesParts.push(`Message: ${message}`);

    const result = await db.query(
      `INSERT INTO prospects (first_name, last_name, phone, email, state, notes, source)
       VALUES ($1,$2,$3,$4,$5,$6,$7)
       RETURNING id`,
      [
        String(firstName).trim().slice(0, 255),
        String(lastName).trim().slice(0, 255),
        phone ? String(phone).trim().slice(0, 20) : null,
        email ? String(email).trim().slice(0, 255) : null,
        process.env.AGENCY_STATE || 'WI',
        notesParts.join('\n\n') || null,
        'website-contact-form'
      ]
    );

    res.status(201).json({ success: true, id: result.rows[0].id });
  } catch (err) {
    console.error('publicLeadRoutes /prospects error:', err);
    res.status(500).json({ error: 'Something went wrong. Please try again or call (715) 491-1254.' });
  }
});

// ── POST /api/public/chatbot-lead ────────────────────────────────────────
// Inbound webhook from the Twomiah Close chat widget (twomiah-close). The bot
// fires this when a website visitor hands over their contact info. This is a
// machine-to-machine call, not a browser form, so it's gated by a shared
// secret header instead of the honeypot used above. The bot posts the raw
// captured-lead row: { name, email, phone, business_name, pain_summary,
// fit_score, stage_at_capture, ... }. We split `name` into first/last (both
// NOT NULL on prospects) and fold the AI summary into the notes.
router.post('/chatbot-lead', leadLimiter, async (req, res) => {
  try {
    const expected = process.env.CHATBOT_WEBHOOK_SECRET;
    if (!expected) {
      console.error('publicLeadRoutes /chatbot-lead: CHATBOT_WEBHOOK_SECRET not configured');
      return res.status(503).json({ error: 'Lead intake not configured' });
    }
    if (req.headers['x-chatbot-secret'] !== expected) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const { name, email, phone, pain_summary, fit_score, stage_at_capture } = req.body || {};

    if (!name && !email && !phone) {
      return res.status(400).json({ error: 'Lead must include a name, email, or phone' });
    }

    // prospects.first_name / last_name are both NOT NULL. Split the single
    // captured name; fall back to a placeholder when only one token is given.
    const tokens = String(name || '').trim().split(/\s+/).filter(Boolean);
    const firstName = (tokens[0] || 'Website').slice(0, 255);
    const lastName = (tokens.slice(1).join(' ') || 'Chat Lead').slice(0, 255);

    const notesParts = ['Captured by the website chat assistant.'];
    if (pain_summary)     notesParts.push(`What they need: ${pain_summary}`);
    if (fit_score != null) notesParts.push(`Bot fit score: ${fit_score}/10`);
    if (stage_at_capture) notesParts.push(`Conversation stage: ${stage_at_capture}`);

    const result = await db.query(
      `INSERT INTO prospects (first_name, last_name, phone, email, state, notes, source)
       VALUES ($1,$2,$3,$4,$5,$6,$7)
       RETURNING id`,
      [
        firstName,
        lastName,
        phone ? String(phone).trim().slice(0, 20) : null,
        email ? String(email).trim().slice(0, 255) : null,
        process.env.AGENCY_STATE || 'WI',
        notesParts.join('\n\n'),
        'chatbot'
      ]
    );

    res.status(201).json({ success: true, id: result.rows[0].id });
  } catch (err) {
    console.error('publicLeadRoutes /chatbot-lead error:', err);
    res.status(500).json({ error: 'Something went wrong saving the lead' });
  }
});

// ── GET /api/public/job-postings ─────────────────────────────────────────
// Returns currently-open postings for the website. Empty array → careers page
// shows the evergreen "we're always building our pool" fallback copy.
router.get('/job-postings', readLimiter, async (req, res) => {
  try {
    const result = await db.query(`
      SELECT id, title, slug, employment_type, location,
             pay_range_min, pay_range_max, pay_rate_unit,
             summary, description, responsibilities, qualifications,
             published_at, closes_at
        FROM job_postings
       WHERE is_published = true
         AND (closes_at IS NULL OR closes_at > NOW())
       ORDER BY published_at DESC NULLS LAST, created_at DESC
    `);
    res.set('Cache-Control', 'public, max-age=60');
    res.json(result.rows);
  } catch (err) {
    console.error('publicLeadRoutes /job-postings error:', err);
    res.status(500).json({ error: 'Unable to load openings right now.' });
  }
});

// ── GET /api/public/job-postings/:slug ──────────────────────────────────
// Single posting by slug for the per-posting application page.
router.get('/job-postings/:slug', readLimiter, async (req, res) => {
  try {
    const result = await db.query(`
      SELECT id, title, slug, employment_type, location,
             pay_range_min, pay_range_max, pay_rate_unit,
             summary, description, responsibilities, qualifications,
             published_at, closes_at
        FROM job_postings
       WHERE slug = $1
         AND is_published = true
         AND (closes_at IS NULL OR closes_at > NOW())
    `, [req.params.slug]);
    if (!result.rows.length) return res.status(404).json({ error: 'Posting not found' });
    res.set('Cache-Control', 'public, max-age=60');
    res.json(result.rows[0]);
  } catch (err) {
    console.error('publicLeadRoutes /job-postings/:slug error:', err);
    res.status(500).json({ error: 'Unable to load posting right now.' });
  }
});

module.exports = router;
