// routes/jobPostingsRoutes.js
// Admin CRUD for job_postings. Public list lives in publicLeadRoutes.js.
//
// Mount: app.use('/api/job-postings', verifyToken, require('./routes/jobPostingsRoutes'))

const express = require('express');
const router = express.Router();
const db = require('../db');

// ── Helpers ─────────────────────────────────────────────────────────────
const slugify = (title) =>
  String(title || '')
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .slice(0, 180);

// Ensure the slug is unique; if taken, append a short hash.
const uniqueSlug = async (base, excludeId = null) => {
  const params = excludeId ? [base, excludeId] : [base];
  const where = excludeId ? 'AND id <> $2' : '';
  const hit = await db.query(
    `SELECT 1 FROM job_postings WHERE slug = $1 ${where} LIMIT 1`,
    params
  );
  if (!hit.rows.length) return base;
  const suffix = Math.random().toString(36).slice(2, 7);
  return `${base}-${suffix}`;
};

// ── GET /api/job-postings (admin, all postings) ─────────────────────────
router.get('/', async (req, res) => {
  const { status } = req.query; // 'published' | 'draft' | 'closed' | undefined
  try {
    let where = 'WHERE 1=1';
    if (status === 'published') where += ` AND is_published = true AND (closes_at IS NULL OR closes_at > NOW())`;
    if (status === 'draft')     where += ` AND is_published = false`;
    if (status === 'closed')    where += ` AND closes_at IS NOT NULL AND closes_at <= NOW()`;

    const result = await db.query(`
      SELECT jp.*,
             (SELECT COUNT(*) FROM job_applications ja WHERE ja.posting_id = jp.id) AS applications_count_live
        FROM job_postings jp
        ${where}
       ORDER BY jp.is_published DESC, jp.published_at DESC NULLS LAST, jp.created_at DESC
    `);
    res.json(result.rows);
  } catch (err) {
    console.error('[jobPostings] list error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/job-postings/:id (admin) ────────────────────────────────────
router.get('/:id', async (req, res) => {
  try {
    const result = await db.query(`SELECT * FROM job_postings WHERE id = $1`, [req.params.id]);
    if (!result.rows.length) return res.status(404).json({ error: 'Job posting not found' });
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/job-postings (admin create) ───────────────────────────────
router.post('/', async (req, res) => {
  const {
    title, employmentType, location,
    payRangeMin, payRangeMax, payRateUnit,
    summary, description, responsibilities, qualifications,
    isPublished, closesAt,
  } = req.body;

  if (!title || !description) {
    return res.status(400).json({ error: 'Title and description are required' });
  }

  try {
    const slug = await uniqueSlug(slugify(title));
    const publishedAt = isPublished ? new Date() : null;

    const result = await db.query(`
      INSERT INTO job_postings (
        title, slug, employment_type, location,
        pay_range_min, pay_range_max, pay_rate_unit,
        summary, description, responsibilities, qualifications,
        is_published, published_at, closes_at, created_by
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
      RETURNING *
    `, [
      title, slug,
      employmentType || 'part_time',
      location || null,
      payRangeMin || null, payRangeMax || null, payRateUnit || 'hour',
      summary || null, description,
      responsibilities || null, qualifications || null,
      !!isPublished, publishedAt, closesAt || null,
      req.user?.id || null,
    ]);

    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('[jobPostings] create error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── PUT /api/job-postings/:id (admin update) ────────────────────────────
router.put('/:id', async (req, res) => {
  const {
    title, employmentType, location,
    payRangeMin, payRangeMax, payRateUnit,
    summary, description, responsibilities, qualifications,
    isPublished, closesAt,
  } = req.body;

  try {
    const existing = await db.query(`SELECT * FROM job_postings WHERE id = $1`, [req.params.id]);
    if (!existing.rows.length) return res.status(404).json({ error: 'Job posting not found' });

    const current = existing.rows[0];

    // Re-slug only if the title actually changed.
    let slug = current.slug;
    if (title && title !== current.title) {
      slug = await uniqueSlug(slugify(title), req.params.id);
    }

    // First-time publish stamps published_at; unpublish preserves the last value.
    let publishedAt = current.published_at;
    if (isPublished && !current.is_published) publishedAt = new Date();

    const result = await db.query(`
      UPDATE job_postings SET
        title = COALESCE($1, title),
        slug = $2,
        employment_type = COALESCE($3, employment_type),
        location = $4,
        pay_range_min = $5,
        pay_range_max = $6,
        pay_rate_unit = COALESCE($7, pay_rate_unit),
        summary = $8,
        description = COALESCE($9, description),
        responsibilities = $10,
        qualifications = $11,
        is_published = COALESCE($12, is_published),
        published_at = $13,
        closes_at = $14,
        updated_at = NOW()
      WHERE id = $15
      RETURNING *
    `, [
      title || null, slug,
      employmentType || null,
      location || null,
      payRangeMin ?? null, payRangeMax ?? null, payRateUnit || null,
      summary || null, description || null,
      responsibilities || null, qualifications || null,
      isPublished === undefined ? null : !!isPublished,
      publishedAt, closesAt || null,
      req.params.id,
    ]);

    res.json(result.rows[0]);
  } catch (err) {
    console.error('[jobPostings] update error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/job-postings/:id/publish ──────────────────────────────────
router.post('/:id/publish', async (req, res) => {
  try {
    const result = await db.query(`
      UPDATE job_postings
         SET is_published = true,
             published_at = COALESCE(published_at, NOW()),
             updated_at = NOW()
       WHERE id = $1
       RETURNING *
    `, [req.params.id]);
    if (!result.rows.length) return res.status(404).json({ error: 'Not found' });
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/job-postings/:id/unpublish ────────────────────────────────
router.post('/:id/unpublish', async (req, res) => {
  try {
    const result = await db.query(`
      UPDATE job_postings
         SET is_published = false, updated_at = NOW()
       WHERE id = $1
       RETURNING *
    `, [req.params.id]);
    if (!result.rows.length) return res.status(404).json({ error: 'Not found' });
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/job-postings/:id/close (sets closes_at to now) ────────────
router.post('/:id/close', async (req, res) => {
  try {
    const result = await db.query(`
      UPDATE job_postings
         SET closes_at = NOW(), is_published = false, updated_at = NOW()
       WHERE id = $1
       RETURNING *
    `, [req.params.id]);
    if (!result.rows.length) return res.status(404).json({ error: 'Not found' });
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── DELETE /api/job-postings/:id ─────────────────────────────────────────
router.delete('/:id', async (req, res) => {
  try {
    // Applications attached to this posting will have posting_id set to NULL
    // automatically via the FK's ON DELETE SET NULL clause.
    const result = await db.query(`DELETE FROM job_postings WHERE id = $1 RETURNING id`, [req.params.id]);
    if (!result.rows.length) return res.status(404).json({ error: 'Not found' });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
