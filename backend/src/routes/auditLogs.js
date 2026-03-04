// src/routes/auditLogs.js
const express = require('express');
const router = express.Router();
const db = require('../db');

/**
 * GET /api/audit-logs/stats/summary
 * Get audit log statistics
 * NOTE: This route must be defined before /:id to avoid conflict
 */
router.get('/stats/summary', async (req, res) => {
  try {
    const { startDate, endDate } = req.query;
    let dateFilter = '';
    const params = [];

    if (startDate) {
      params.push(startDate);
      dateFilter += ` AND created_at >= $${params.length}`;
    }
    if (endDate) {
      params.push(endDate);
      dateFilter += ` AND created_at <= $${params.length}`;
    }

    const [totalResult, usersResult, changesResult, actionsResult] = await Promise.all([
      db.query(`SELECT COUNT(*) as total FROM audit_logs WHERE 1=1${dateFilter}`, params),
      db.query(`SELECT COUNT(DISTINCT user_id) as unique_users FROM audit_logs WHERE 1=1${dateFilter}`, params),
      db.query(`SELECT COUNT(*) as data_changes FROM audit_logs WHERE action IN ('INSERT','UPDATE','DELETE','CREATE')${dateFilter}`, params),
      db.query(`SELECT action, COUNT(*) as count FROM audit_logs WHERE 1=1${dateFilter} GROUP BY action ORDER BY count DESC`, params),
    ]);

    res.json({
      success: true,
      stats: {
        totalEvents: parseInt(totalResult.rows[0].total),
        uniqueUsers: parseInt(usersResult.rows[0].unique_users),
        dataChanges: parseInt(changesResult.rows[0].data_changes),
        byAction: actionsResult.rows
      }
    });
  } catch (error) {
    console.error('Error retrieving audit log stats:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/audit-logs
 * Retrieve audit logs with filtering
 */
router.get('/', async (req, res) => {
  try {
    const { startDate, endDate, userId, action, entityType, page = 1, limit = 50 } = req.query;
    const pageNum = parseInt(page);
    const limitNum = Math.min(parseInt(limit) || 50, 200);
    const offset = (pageNum - 1) * limitNum;

    let where = '1=1';
    const params = [];

    if (startDate) {
      params.push(startDate);
      where += ` AND a.created_at >= $${params.length}`;
    }
    if (endDate) {
      params.push(endDate);
      where += ` AND a.created_at <= $${params.length}`;
    }
    if (userId) {
      params.push(userId);
      where += ` AND a.user_id = $${params.length}`;
    }
    if (action) {
      params.push(action);
      where += ` AND a.action = $${params.length}`;
    }
    if (entityType) {
      params.push(entityType);
      where += ` AND a.table_name = $${params.length}`;
    }

    const countResult = await db.query(
      `SELECT COUNT(*) as total FROM audit_logs a WHERE ${where}`, params
    );
    const total = parseInt(countResult.rows[0].total);

    params.push(limitNum);
    const limitParam = params.length;
    params.push(offset);
    const offsetParam = params.length;

    const result = await db.query(
      `SELECT a.*, u.first_name, u.last_name, u.email
       FROM audit_logs a
       LEFT JOIN users u ON a.user_id = u.id
       WHERE ${where}
       ORDER BY a.created_at DESC
       LIMIT $${limitParam} OFFSET $${offsetParam}`,
      params
    );

    res.json({
      success: true,
      logs: result.rows,
      pagination: {
        total,
        pages: Math.ceil(total / limitNum),
        currentPage: pageNum
      }
    });
  } catch (error) {
    console.error('Error retrieving audit logs:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/audit-logs/entity/:entityType/:entityId
 * Get all logs for a specific entity
 */
router.get('/entity/:entityType/:entityId', async (req, res) => {
  try {
    const { entityType, entityId } = req.params;
    const result = await db.query(
      `SELECT a.*, u.first_name, u.last_name, u.email
       FROM audit_logs a
       LEFT JOIN users u ON a.user_id = u.id
       WHERE a.table_name = $1 AND a.record_id = $2
       ORDER BY a.created_at DESC`,
      [entityType, entityId]
    );

    res.json({
      success: true,
      logs: result.rows,
      count: result.rows.length
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/audit-logs/:id
 * Get a specific audit log entry
 */
router.get('/:id', async (req, res) => {
  try {
    const result = await db.query(
      `SELECT a.*, u.first_name, u.last_name, u.email
       FROM audit_logs a
       LEFT JOIN users u ON a.user_id = u.id
       WHERE a.id = $1`,
      [req.params.id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Audit log not found' });
    }
    res.json({ success: true, log: result.rows[0] });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/audit-logs/export
 * Export audit logs as CSV or PDF
 */
router.post('/export', async (req, res) => {
  try {
    const { format = 'csv', startDate, endDate } = req.body;
    const params = [];
    let where = '1=1';
    if (startDate) { params.push(startDate); where += ` AND created_at >= $${params.length}`; }
    if (endDate) { params.push(endDate); where += ` AND created_at <= $${params.length}`; }

    const result = await db.query(
      `SELECT a.*, u.first_name, u.last_name, u.email
       FROM audit_logs a LEFT JOIN users u ON a.user_id = u.id
       WHERE ${where} ORDER BY a.created_at DESC LIMIT 10000`,
      params
    );

    res.json({
      success: true,
      format,
      count: result.rows.length,
      data: result.rows
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/audit-logs/compliance-report
 * Generate HIPAA compliance report
 */
router.post('/compliance-report', async (req, res) => {
  try {
    const { startDate, endDate } = req.body;
    const params = [];
    let dateFilter = '';
    if (startDate) { params.push(startDate); dateFilter += ` AND created_at >= $${params.length}`; }
    if (endDate) { params.push(endDate); dateFilter += ` AND created_at <= $${params.length}`; }

    const [total, byAction, byTable, byUser] = await Promise.all([
      db.query(`SELECT COUNT(*) as total FROM audit_logs WHERE 1=1${dateFilter}`, params),
      db.query(`SELECT action, COUNT(*) as count FROM audit_logs WHERE 1=1${dateFilter} GROUP BY action ORDER BY count DESC`, params),
      db.query(`SELECT table_name, COUNT(*) as count FROM audit_logs WHERE table_name IS NOT NULL${dateFilter} GROUP BY table_name ORDER BY count DESC`, params),
      db.query(`SELECT u.first_name, u.last_name, u.email, COUNT(*) as event_count FROM audit_logs a JOIN users u ON a.user_id = u.id WHERE 1=1${dateFilter} GROUP BY u.id, u.first_name, u.last_name, u.email ORDER BY event_count DESC LIMIT 20`, params),
    ]);

    res.json({
      success: true,
      report: {
        totalEvents: parseInt(total.rows[0].total),
        byAction: byAction.rows,
        byTable: byTable.rows,
        topUsers: byUser.rows,
        period: { startDate, endDate }
      }
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
