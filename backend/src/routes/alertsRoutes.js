// routes/alertsRoutes.js
// General Alerts System + Certification Expiration Alerts

const express = require('express');
const router = express.Router();
const db = require('../db');
const auth = require('../middleware/auth');

// ==================== GENERAL ALERTS ====================

// Get all alerts with filtering
router.get('/', auth, async (req, res) => {
  const { type, priority, status } = req.query;
  try {
    let query = `
      SELECT a.*,
        CASE 
          WHEN a.related_entity_type = 'client' THEN (SELECT CONCAT(first_name, ' ', last_name) FROM clients WHERE id = a.related_entity_id)
          WHEN a.related_entity_type = 'caregiver' THEN (SELECT CONCAT(first_name, ' ', last_name) FROM users WHERE id = a.related_entity_id)
          ELSE NULL
        END as related_entity_name
      FROM alerts a
      WHERE 1=1
    `;
    const params = [];

    if (type) {
      params.push(type);
      query += ` AND a.alert_type = $${params.length}`;
    }
    if (priority) {
      params.push(priority);
      query += ` AND a.priority = $${params.length}`;
    }
    if (status) {
      params.push(status);
      query += ` AND a.status = $${params.length}`;
    }

    query += ` ORDER BY 
      CASE a.priority 
        WHEN 'critical' THEN 1 
        WHEN 'high' THEN 2 
        WHEN 'medium' THEN 3 
        WHEN 'low' THEN 4 
      END,
      a.created_at DESC`;

    const result = await db.query(query, params);
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Create alert
router.post('/', auth, async (req, res) => {
  const { alertType, priority, message, dueDate, relatedEntityType, relatedEntityId } = req.body;
  try {
    const result = await db.query(`
      INSERT INTO alerts (alert_type, priority, message, due_date, related_entity_type, related_entity_id, created_by)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      RETURNING *
    `, [alertType, priority || 'medium', message, dueDate || null, relatedEntityType || null, relatedEntityId || null, req.user.id]);
    res.json(result.rows[0]);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Acknowledge alert
router.put('/:id/acknowledge', auth, async (req, res) => {
  try {
    await db.query(`
      UPDATE alerts 
      SET status = 'acknowledged', acknowledged_at = NOW(), acknowledged_by = $1
      WHERE id = $2
    `, [req.user.id, req.params.id]);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Resolve alert
router.put('/:id/resolve', auth, async (req, res) => {
  const { resolution } = req.body;
  try {
    await db.query(`
      UPDATE alerts 
      SET status = 'resolved', resolution = $1, resolved_at = NOW(), resolved_by = $2
      WHERE id = $3
    `, [resolution, req.user.id, req.params.id]);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Dismiss alert
router.put('/:id/dismiss', auth, async (req, res) => {
  try {
    await db.query(`
      UPDATE alerts 
      SET status = 'dismissed', resolved_at = NOW(), resolved_by = $1
      WHERE id = $2
    `, [req.user.id, req.params.id]);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ==================== CERTIFICATION ALERTS ====================

// Get certification alerts
router.get('/certifications', auth, async (req, res) => {
  const { acknowledged } = req.query;
  try {
    let query = `
      SELECT ca.*, 
        u.first_name, u.last_name, u.phone, u.email,
        cc.certification_type, cc.expiration_date
      FROM certification_alerts ca
      JOIN users u ON ca.caregiver_id = u.id
      JOIN caregiver_certifications cc ON ca.certification_id = cc.id
      WHERE 1=1
    `;
    const params = [];

    if (acknowledged === 'false') {
      query += ` AND ca.acknowledged = false`;
    }

    query += ` ORDER BY cc.expiration_date ASC`;
    
    const result = await db.query(query, params);
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Acknowledge certification alert
router.put('/certifications/:id/acknowledge', auth, async (req, res) => {
  try {
    await db.query(`
      UPDATE certification_alerts 
      SET acknowledged = true, acknowledged_at = NOW(), acknowledged_by = $1
      WHERE id = $2
    `, [req.user.id, req.params.id]);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Generate certification alerts (run daily via cron)
router.post('/certifications/generate', auth, async (req, res) => {
  try {
    const expiring = await db.query(`
      SELECT cc.id as cert_id, cc.caregiver_id, cc.expiration_date,
        CASE 
          WHEN cc.expiration_date <= CURRENT_DATE THEN 'expired'
          WHEN cc.expiration_date <= CURRENT_DATE + 7 THEN 'expiring_7'
          WHEN cc.expiration_date <= CURRENT_DATE + 14 THEN 'expiring_14'
          WHEN cc.expiration_date <= CURRENT_DATE + 30 THEN 'expiring_30'
        END as alert_type
      FROM caregiver_certifications cc
      JOIN users u ON cc.caregiver_id = u.id
      WHERE cc.expiration_date <= CURRENT_DATE + 30
      AND u.is_active = true
      AND NOT EXISTS (
        SELECT 1 FROM certification_alerts ca 
        WHERE ca.certification_id = cc.id 
        AND ca.alert_type = CASE 
          WHEN cc.expiration_date <= CURRENT_DATE THEN 'expired'
          WHEN cc.expiration_date <= CURRENT_DATE + 7 THEN 'expiring_7'
          WHEN cc.expiration_date <= CURRENT_DATE + 14 THEN 'expiring_14'
          WHEN cc.expiration_date <= CURRENT_DATE + 30 THEN 'expiring_30'
        END
      )
    `);

    let created = 0;
    for (const cert of expiring.rows) {
      if (cert.alert_type) {
        await db.query(`
          INSERT INTO certification_alerts (caregiver_id, certification_id, alert_type, alert_date)
          VALUES ($1, $2, $3, CURRENT_DATE)
        `, [cert.caregiver_id, cert.cert_id, cert.alert_type]);
        created++;
      }
    }

    res.json({ created, total: expiring.rows.length });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ==================== DASHBOARD ====================

router.get('/dashboard', auth, async (req, res) => {
  try {
    const certs = await db.query(`SELECT COUNT(*) as count FROM certification_alerts WHERE acknowledged = false`);
    const auths = await db.query(`SELECT COUNT(*) as count FROM authorizations WHERE end_date <= CURRENT_DATE + 30 AND end_date >= CURRENT_DATE`);
    const bgChecks = await db.query(`SELECT COUNT(*) as count FROM background_checks WHERE expiration_date <= CURRENT_DATE + 30 AND expiration_date >= CURRENT_DATE`);
    const openShifts = await db.query(`SELECT COUNT(*) as count FROM open_shifts WHERE status = 'open' AND shift_date >= CURRENT_DATE`);
    const swaps = await db.query(`SELECT COUNT(*) as count FROM shift_swap_requests WHERE status IN ('pending', 'accepted')`);
    const overdueInvoices = await db.query(`
      SELECT COUNT(*) as count, COALESCE(SUM(total - COALESCE(amount_paid, 0)), 0) as amount
      FROM invoices WHERE payment_status != 'paid' AND payment_due_date < CURRENT_DATE
    `);

    res.json({
      expiringCertifications: parseInt(certs.rows[0].count),
      expiringAuthorizations: parseInt(auths.rows[0].count),
      expiringBackgroundChecks: parseInt(bgChecks.rows[0].count),
      openShifts: parseInt(openShifts.rows[0].count),
      pendingSwapRequests: parseInt(swaps.rows[0].count),
      overdueInvoices: {
        count: parseInt(overdueInvoices.rows[0].count),
        amount: parseFloat(overdueInvoices.rows[0].amount)
      }
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
