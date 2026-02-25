// routes/communicationRoutes.js
// Communication Log — timestamped notes/calls/emails per client or caregiver

const express = require('express');
const router = express.Router();
const db = require('../db');
const auth = require('../middleware/auth');

// GET logs for an entity
router.get('/:entityType/:entityId', auth, async (req, res) => {
  const { entityType, entityId } = req.params;
  const { type, limit = 50, offset = 0 } = req.query;
  try {
    let q = `
      SELECT cl.*,
        u.first_name || ' ' || u.last_name AS logged_by_full
      FROM communication_log cl
      LEFT JOIN users u ON cl.logged_by = u.id
      WHERE cl.entity_type = $1 AND cl.entity_id = $2
    `;
    const params = [entityType, entityId];
    if (type) { params.push(type); q += ` AND cl.log_type = $${params.length}`; }
    q += ` ORDER BY cl.is_pinned DESC, cl.created_at DESC LIMIT $${params.length+1} OFFSET $${params.length+2}`;
    params.push(parseInt(limit), parseInt(offset));
    const result = await db.query(q, params);
    res.json(result.rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// GET follow-ups due
router.get('/follow-ups/pending', auth, async (req, res) => {
  try {
    const result = await db.query(`
      SELECT cl.*,
        CASE WHEN cl.entity_type = 'client'
          THEN (SELECT first_name || ' ' || last_name FROM clients WHERE id = cl.entity_id)
          ELSE (SELECT first_name || ' ' || last_name FROM users WHERE id = cl.entity_id)
        END AS entity_name
      FROM communication_log cl
      WHERE cl.follow_up_done = FALSE
        AND cl.follow_up_date IS NOT NULL
        AND cl.follow_up_date <= CURRENT_DATE + INTERVAL '3 days'
      ORDER BY cl.follow_up_date ASC
      LIMIT 50
    `);
    res.json(result.rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST create log entry
router.post('/', auth, async (req, res) => {
  const { entityType, entityId, logType = 'note', direction, subject, body, followUpDate } = req.body;
  if (!entityType || !entityId || !body) return res.status(400).json({ error: 'entityType, entityId, and body required' });
  try {
    const user = await db.query('SELECT first_name, last_name FROM users WHERE id = $1', [req.user.id]);
    const name = user.rows[0] ? `${user.rows[0].first_name} ${user.rows[0].last_name}` : 'Admin';
    const result = await db.query(`
      INSERT INTO communication_log (entity_type, entity_id, log_type, direction, subject, body, logged_by, logged_by_name, follow_up_date)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *
    `, [entityType, entityId, logType, direction || null, subject || null, body, req.user.id, name, followUpDate || null]);
    res.status(201).json(result.rows[0]);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// PUT update (pin/follow-up done)
router.put('/:id', auth, async (req, res) => {
  const { isPinned, followUpDone, body, subject } = req.body;
  try {
    const fields = [], params = [];
    if (isPinned !== undefined) { params.push(isPinned); fields.push(`is_pinned=$${params.length}`); }
    if (followUpDone !== undefined) { params.push(followUpDone); fields.push(`follow_up_done=$${params.length}`); }
    if (body) { params.push(body); fields.push(`body=$${params.length}`); }
    if (subject !== undefined) { params.push(subject); fields.push(`subject=$${params.length}`); }
    params.push(req.params.id);
    const result = await db.query(
      `UPDATE communication_log SET ${fields.join(', ')}, updated_at=NOW() WHERE id=$${params.length} RETURNING *`,
      params
    );
    res.json(result.rows[0]);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// DELETE
router.delete('/:id', auth, async (req, res) => {
  try {
    await db.query('DELETE FROM communication_log WHERE id=$1', [req.params.id]);
    res.json({ message: 'Deleted' });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
