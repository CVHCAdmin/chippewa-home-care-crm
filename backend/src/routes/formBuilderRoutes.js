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

// GET /api/form-builder/submissions/:id/pdf — render any form submission as a
// printable PDF using the template fields as the structure. Works for POC,
// HIPAA release, intake — anything seeded in v42 or built by users.
router.get('/submissions/:id/pdf', auth, async (req, res) => {
  try {
    const r = await db.query(`
      SELECT fs.*, ft.name AS template_name, ft.fields AS template_fields,
             ft.description, ft.category, ft.requires_signature
        FROM form_submissions fs
        LEFT JOIN form_templates ft ON fs.template_id = ft.id
       WHERE fs.id = $1
    `, [req.params.id]);
    if (!r.rows.length) return res.status(404).json({ error: 'Submission not found' });
    const s = r.rows[0];
    const fields = (typeof s.template_fields === 'string') ? JSON.parse(s.template_fields) : (s.template_fields || []);
    const data   = (typeof s.data === 'string') ? JSON.parse(s.data) : (s.data || {});

    // Optional client context for the header
    let clientLine = null;
    if (s.entity_type === 'client' && s.entity_id) {
      const c = await db.query(`SELECT first_name, last_name, date_of_birth FROM clients WHERE id = $1`, [s.entity_id]);
      if (c.rows[0]) {
        clientLine = `${c.rows[0].first_name} ${c.rows[0].last_name}` +
          (c.rows[0].date_of_birth ? ` · DOB ${new Date(c.rows[0].date_of_birth).toLocaleDateString()}` : '');
      }
    }

    const PDFDocument = require('pdfkit');
    const doc = new PDFDocument({ size: 'LETTER', margin: 54 });
    const fname = `${(s.template_name || 'form').replace(/[^a-zA-Z0-9._-]/g, '_')}-${s.id.slice(0,8)}.pdf`;
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${fname}"`);
    doc.pipe(res);

    // Header
    doc.fillColor('#1D4ED8').font('Helvetica-Bold').fontSize(18).text(s.template_name || 'Form');
    if (s.description) doc.fillColor('#6B7280').font('Helvetica').fontSize(9).text(s.description);
    doc.fillColor('#6B7280').font('Helvetica').fontSize(8).text('Chippewa Valley Home Care');
    doc.moveDown(0.4);
    if (clientLine) {
      doc.fillColor('#111827').font('Helvetica-Bold').fontSize(11).text(clientLine);
      doc.moveDown(0.3);
    }

    // Submission meta
    doc.fillColor('#6B7280').font('Helvetica').fontSize(8);
    doc.text(`Submission: ${s.id}`);
    doc.text(`Submitted by ${s.submitted_by_name || s.submitted_by || 'unknown'} on ${new Date(s.created_at || s.submitted_at).toLocaleString()}`);
    doc.text(`Status: ${s.status || 'submitted'}`);
    doc.moveDown(0.6);

    // Each field — label + value, indented
    const renderVal = (v) => {
      if (v == null || v === '') return '—';
      if (Array.isArray(v)) return v.join(', ');
      if (typeof v === 'boolean') return v ? 'Yes' : 'No';
      return String(v);
    };
    for (const f of fields) {
      doc.fillColor('#374151').font('Helvetica-Bold').fontSize(9).text(f.label || f.id, { continued: false });
      doc.fillColor('#111827').font('Helvetica').fontSize(10).text(renderVal(data[f.id]), { indent: 16, paragraphGap: 2 });
      doc.moveDown(0.25);
    }

    // Signature block
    if (s.requires_signature) {
      doc.moveDown(1.5);
      const y = doc.y;
      doc.fillColor('#6B7280').fontSize(9);
      doc.text('_________________________________', 54, y);
      doc.text('_________________________________', 320, y);
      doc.moveDown(0.3);
      doc.text('Client / Authorized Rep', 54, doc.y);
      doc.text('Date', 320, doc.y - 12);

      doc.moveDown(2);
      const y2 = doc.y;
      doc.text('_________________________________', 54, y2);
      doc.text('_________________________________', 320, y2);
      doc.moveDown(0.3);
      doc.text('Agency Representative', 54, doc.y);
      doc.text('Date', 320, doc.y - 12);

      if (s.signature) {
        doc.moveDown(1);
        doc.fillColor('#6B7280').fontSize(8).text(`Electronic signature on file (captured ${s.signed_at ? new Date(s.signed_at).toLocaleString() : 'at submission'}).`);
      }
    }

    // Footer
    doc.fontSize(7).fillColor('#9CA3AF').text(
      `Generated ${new Date().toLocaleString()} by ${req.user.email || req.user.id}. ` +
      `Contains Protected Health Information — handle per HIPAA.`,
      54, 720, { width: 504, align: 'center' }
    );
    doc.end();
  } catch (error) {
    console.error('[form submissions PDF]', error);
    res.status(500).json({ error: error.message });
  }
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
