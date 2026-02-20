// routes/referralRoutes.js — mounted at /api via app.use('/api', referralRoutes)
const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const db = require('../db');
const { verifyToken, requireAdmin, auditLog } = require('../middleware/shared');
// ─── REFERRAL SOURCES ───────────────────────────────────────────────────────

router.get('/referral-sources', verifyToken, async (req, res) => {
  try {
    const result = await db.query(
      `SELECT rs.*, COUNT(c.id) as referral_count FROM referral_sources rs
       LEFT JOIN clients c ON rs.id = c.referred_by AND c.is_active = true
       WHERE rs.is_active = true GROUP BY rs.id ORDER BY referral_count DESC`
    );
    res.json(result.rows);
  } catch (error) { res.status(500).json({ error: error.message }); }
});

router.post('/referral-sources', verifyToken, requireAdmin, async (req, res) => {
  try {
    const { name, type, contactName, email, phone, address, city, state, zip } = req.body;
    if (!name || !type) return res.status(400).json({ error: 'Name and type are required' });
    const sourceId = uuidv4();
    const result = await db.query(
      `INSERT INTO referral_sources (id, name, type, contact_name, email, phone, address, city, state, zip, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
      [sourceId, name, type, contactName||null, email||null, phone||null, address||null, city||null, state||process.env.AGENCY_STATE||null, zip||null, req.user.id]
    );
    await auditLog(req.user.id, 'CREATE', 'referral_sources', sourceId, null, result.rows[0]);
    res.status(201).json(result.rows[0]);
  } catch (error) { res.status(500).json({ error: error.message }); }
});

router.put('/referral-sources/:id', verifyToken, requireAdmin, async (req, res) => {
  try {
    const { name, type, contactName, email, phone, address, city, state, zip } = req.body;
    const result = await db.query(
      `UPDATE referral_sources SET name=COALESCE($1,name), type=COALESCE($2,type), contact_name=COALESCE($3,contact_name),
        email=COALESCE($4,email), phone=COALESCE($5,phone), address=COALESCE($6,address),
        city=COALESCE($7,city), state=COALESCE($8,state), zip=COALESCE($9,zip), updated_at=NOW()
       WHERE id=$10 RETURNING *`,
      [name, type, contactName, email, phone, address, city, state, zip, req.params.id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Referral source not found' });
    await auditLog(req.user.id, 'UPDATE', 'referral_sources', req.params.id, null, result.rows[0]);
    res.json(result.rows[0]);
  } catch (error) { res.status(500).json({ error: error.message }); }
});

router.delete('/referral-sources/:id', verifyToken, requireAdmin, async (req, res) => {
  try {
    const result = await db.query(`DELETE FROM referral_sources WHERE id=$1 RETURNING *`, [req.params.id]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'Referral source not found' });
    await auditLog(req.user.id, 'DELETE', 'referral_sources', req.params.id, null, result.rows[0]);
    res.json({ message: 'Referral source deleted' });
  } catch (error) { res.status(500).json({ error: error.message }); }
});

router.get('/referral-sources/stats', verifyToken, requireAdmin, async (req, res) => {
  try {
    const [totalResult, byTypeResult, topSources] = await Promise.all([
      db.query(`SELECT COUNT(*) as total FROM referral_sources`),
      db.query(`SELECT type, COUNT(*) as count FROM referral_sources GROUP BY type ORDER BY count DESC`),
      db.query(`SELECT rs.id, rs.name, COUNT(c.id) as client_count FROM referral_sources rs LEFT JOIN clients c ON rs.id = c.referral_source_id WHERE c.id IS NOT NULL GROUP BY rs.id, rs.name ORDER BY client_count DESC`),
    ]);
    res.json({ total: totalResult.rows[0].total, byType: byTypeResult.rows, topSources: topSources.rows });
  } catch (error) { res.status(500).json({ error: error.message }); }
});

module.exports = router;
