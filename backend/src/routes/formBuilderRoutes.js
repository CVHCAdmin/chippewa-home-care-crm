// routes/formBuilderRoutes.js
// Custom form templates + submissions

const express = require('express');
const router = express.Router();
const db = require('../db');
const auth = require('../middleware/auth');

// ── TEMPLATES ──────────────────────────────────────────

router.get('/templates', auth, async (req, res) => {
  const { category, active = 'true' } = req.query;
  try {
    let q = `SELECT ft.*, u.first_name || ' ' || u.last_name AS created_by_name,
      (SELECT COUNT(*) FROM form_submissions fs WHERE fs.template_id = ft.id) AS submission_count
      FROM form_templates ft LEFT JOIN users u ON ft.created_by = u.id WHERE 1=1`;
    const params = [];
    if (active !== 'all') { params.push(active === 'true'); q += ` AND ft.is_active=$${params.length}`; }
    if (category) { params.push(category); q += ` AND ft.category=$${params.length}`; }
    q += ' ORDER BY ft.category, ft.name';
    const result = await db.query(q, params);
    res.json(result.rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.get('/templates/:id', auth, async (req, res) => {
  try {
    const result = await db.query('SELECT * FROM form_templates WHERE id=$1', [req.params.id]);
    if (!result.rows.length) return res.status(404).json({ error: 'Not found' });
    res.json(result.rows[0]);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/templates', auth, async (req, res) => {
  const { name, description, category = 'general', fields = [], requiresSignature = false, autoAttachTo } = req.body;
  if (!name) return res.status(400).json({ error: 'name required' });
  try {
    const result = await db.query(`
      INSERT INTO form_templates (name, description, category, fields, requires_signature, auto_attach_to, created_by)
      VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *
    `, [name, description || null, category, JSON.stringify(fields), requiresSignature, autoAttachTo || null, req.user.id]);
    res.status(201).json(result.rows[0]);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.put('/templates/:id', auth, async (req, res) => {
  const { name, description, category, fields, requiresSignature, autoAttachTo, isActive } = req.body;
  try {
    const result = await db.query(`
      UPDATE form_templates SET
        name = COALESCE($1, name),
        description = COALESCE($2, description),
        category = COALESCE($3, category),
        fields = COALESCE($4, fields),
        requires_signature = COALESCE($5, requires_signature),
        auto_attach_to = COALESCE($6, auto_attach_to),
        is_active = COALESCE($7, is_active),
        updated_at = NOW()
      WHERE id=$8 RETURNING *
    `, [name, description, category, fields ? JSON.stringify(fields) : null, requiresSignature, autoAttachTo, isActive, req.params.id]);
    res.json(result.rows[0]);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.delete('/templates/:id', auth, async (req, res) => {
  try {
    await db.query('UPDATE form_templates SET is_active=FALSE WHERE id=$1', [req.params.id]);
    res.json({ message: 'Deactivated' });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── SUBMISSIONS ────────────────────────────────────────

router.get('/submissions', auth, async (req, res) => {
  const { entityType, entityId, templateId, status, limit = 50 } = req.query;
  try {
    let q = `
      SELECT fs.*, ft.name AS template_name, ft.category,
        u.first_name || ' ' || u.last_name AS submitted_by_name
      FROM form_submissions fs
      LEFT JOIN form_templates ft ON fs.template_id = ft.id
      LEFT JOIN users u ON fs.submitted_by = u.id
      WHERE 1=1
    `;
    const params = [];
    if (entityType) { params.push(entityType); q += ` AND fs.entity_type=$${params.length}`; }
    if (entityId) { params.push(entityId); q += ` AND fs.entity_id=$${params.length}`; }
    if (templateId) { params.push(templateId); q += ` AND fs.template_id=$${params.length}`; }
    if (status) { params.push(status); q += ` AND fs.status=$${params.length}`; }
    q += ` ORDER BY fs.created_at DESC LIMIT $${params.length+1}`;
    params.push(parseInt(limit));
    const result = await db.query(q, params);
    res.json(result.rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.get('/submissions/:id', auth, async (req, res) => {
  try {
    const result = await db.query(`
      SELECT fs.*, ft.name AS template_name, ft.fields AS template_fields, ft.category, ft.requires_signature
      FROM form_submissions fs
      LEFT JOIN form_templates ft ON fs.template_id = ft.id
      WHERE fs.id=$1
    `, [req.params.id]);
    if (!result.rows.length) return res.status(404).json({ error: 'Not found' });
    res.json(result.rows[0]);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/submissions', auth, async (req, res) => {
  const { templateId, entityType, entityId, data = {}, status = 'submitted', signature } = req.body;
  if (!templateId) return res.status(400).json({ error: 'templateId required' });
  try {
    const tmpl = await db.query('SELECT name FROM form_templates WHERE id=$1', [templateId]);
    const user = await db.query('SELECT first_name, last_name FROM users WHERE id=$1', [req.user.id]);
    const name = user.rows[0] ? `${user.rows[0].first_name} ${user.rows[0].last_name}` : 'Unknown';
    const result = await db.query(`
      INSERT INTO form_submissions (template_id, template_name, entity_type, entity_id, submitted_by, submitted_by_name, data, status, signature, signed_at)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9, $10) RETURNING *
    `, [templateId, tmpl.rows[0]?.name, entityType || null, entityId || null,
        req.user.id, name, JSON.stringify(data), status,
        signature || null, signature ? new Date() : null]);
    res.status(201).json(result.rows[0]);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.put('/submissions/:id', auth, async (req, res) => {
  const { data, status, signature } = req.body;
  try {
    const result = await db.query(`
      UPDATE form_submissions SET
        data = COALESCE($1, data),
        status = COALESCE($2, status),
        signature = COALESCE($3, signature),
        signed_at = CASE WHEN $3 IS NOT NULL THEN NOW() ELSE signed_at END,
        updated_at = NOW()
      WHERE id=$4 RETURNING *
    `, [data ? JSON.stringify(data) : null, status, signature || null, req.params.id]);
    res.json(result.rows[0]);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.delete('/submissions/:id', auth, async (req, res) => {
  try {
    await db.query('DELETE FROM form_submissions WHERE id=$1', [req.params.id]);
    res.json({ message: 'Deleted' });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
