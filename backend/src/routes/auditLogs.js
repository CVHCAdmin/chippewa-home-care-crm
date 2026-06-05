// src/routes/auditLogs.js
const express = require('express');
const router = express.Router();
const db = require('../db');
const { verifyToken, requireAdmin } = require('../middleware/shared');

// HIPAA: every route here returns PHI access history. Admins only, period.
// Previously these had ZERO auth because the verifyToken applied at the mount
// point in server.js doesn't propagate into router-level handlers.
router.use(verifyToken, requireAdmin);

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

// POST /api/audit-logs/compliance-report.pdf — render the compliance report
// as a printable PDF suitable for regulator submission.
router.post('/compliance-report.pdf', async (req, res) => {
  try {
    const { startDate, endDate } = req.body;
    const params = [];
    let dateFilter = '';
    if (startDate) { params.push(startDate); dateFilter += ` AND created_at >= $${params.length}`; }
    if (endDate)   { params.push(endDate);   dateFilter += ` AND created_at <= $${params.length}`; }

    const [total, byAction, byTable, byUser, sensitive, alerts, dataChanges] = await Promise.all([
      db.query(`SELECT COUNT(*) as total FROM audit_logs WHERE 1=1${dateFilter}`, params),
      db.query(`SELECT action, COUNT(*) as count FROM audit_logs WHERE 1=1${dateFilter} GROUP BY action ORDER BY count DESC LIMIT 25`, params),
      db.query(`SELECT table_name, COUNT(*) as count FROM audit_logs WHERE table_name IS NOT NULL${dateFilter} GROUP BY table_name ORDER BY count DESC LIMIT 25`, params),
      db.query(`SELECT u.first_name, u.last_name, u.email, COUNT(*) as event_count FROM audit_logs a JOIN users u ON a.user_id = u.id WHERE 1=1${dateFilter} GROUP BY u.id, u.first_name, u.last_name, u.email ORDER BY event_count DESC LIMIT 20`, params),
      db.query(`SELECT COUNT(*) AS n FROM audit_logs WHERE is_sensitive = true${dateFilter}`, params),
      db.query(`SELECT COUNT(*) AS n FROM audit_logs WHERE action = 'SECURITY_ALERT'${dateFilter}`, params),
      db.query(`SELECT COUNT(*) AS n FROM audit_logs WHERE action IN ('INSERT','UPDATE','DELETE','CREATE')${dateFilter}`, params),
    ]);

    const PDFDocument = require('pdfkit');
    const doc = new PDFDocument({ size: 'LETTER', margin: 54 });
    const fname = `hipaa-audit-${startDate || 'all'}-to-${endDate || new Date().toISOString().slice(0,10)}.pdf`.replace(/[^a-zA-Z0-9._-]/g, '_');
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${fname}"`);
    doc.pipe(res);

    doc.fillColor('#1D4ED8').font('Helvetica-Bold').fontSize(18).text('HIPAA Audit & Compliance Report');
    doc.fillColor('#6B7280').font('Helvetica').fontSize(9).text('Chippewa Valley Home Care');
    doc.moveDown(0.4);
    doc.fillColor('#374151').font('Helvetica').fontSize(10);
    doc.text(`Period: ${startDate || 'all-time'} to ${endDate || new Date().toISOString().slice(0,10)}`);
    doc.text(`Generated: ${new Date().toLocaleString()}`);
    doc.moveDown(0.5);

    // Summary block
    const summary = [
      ['Total events recorded',     parseInt(total.rows[0].total)],
      ['Data-change events',        parseInt(dataChanges.rows[0].n)],
      ['Sensitive (PHI-flagged) events', parseInt(sensitive.rows[0].n)],
      ['Security alerts raised',    parseInt(alerts.rows[0].n)],
      ['Distinct active users',     byUser.rows.length],
    ];
    doc.fillColor('#1E3A8A').font('Helvetica-Bold').fontSize(12).text('SUMMARY');
    doc.moveTo(54, doc.y + 2).lineTo(558, doc.y + 2).strokeColor('#BFDBFE').stroke();
    doc.moveDown(0.3);
    doc.fillColor('#111827').font('Helvetica').fontSize(10);
    summary.forEach(([label, val]) => {
      doc.text(`${label}:`, { continued: true }).font('Helvetica-Bold').text(`  ${val.toLocaleString()}`).font('Helvetica');
    });

    const section = (title, rows, columns) => {
      doc.moveDown(0.7);
      doc.fillColor('#1E3A8A').font('Helvetica-Bold').fontSize(12).text(title);
      doc.moveTo(54, doc.y + 2).lineTo(558, doc.y + 2).strokeColor('#BFDBFE').stroke();
      doc.moveDown(0.3);
      doc.fillColor('#111827').font('Helvetica').fontSize(9);
      if (rows.length === 0) { doc.text('(none)'); return; }
      // Header row
      const colW = 504 / columns.length;
      const headerY = doc.y;
      columns.forEach((c, i) => {
        doc.font('Helvetica-Bold').text(c.label, 54 + i * colW, headerY, { width: colW, ellipsis: true });
      });
      doc.moveDown(0.2);
      // Body
      doc.font('Helvetica');
      rows.forEach(r => {
        if (doc.y > 720) { doc.addPage(); }
        const rowY = doc.y;
        columns.forEach((c, i) => {
          const v = r[c.key];
          doc.text(String(v == null ? '' : v), 54 + i * colW, rowY, { width: colW, ellipsis: true });
        });
        doc.moveDown(0.15);
      });
    };

    section('Top Actions',  byAction.rows, [{ key: 'action', label: 'Action' }, { key: 'count', label: 'Count' }]);
    section('Top Tables',   byTable.rows,  [{ key: 'table_name', label: 'Table' }, { key: 'count', label: 'Count' }]);
    section('Top Users',    byUser.rows.map(u => ({ ...u, name: `${u.first_name} ${u.last_name}` })),
      [{ key: 'name', label: 'User' }, { key: 'email', label: 'Email' }, { key: 'event_count', label: 'Events' }]);

    // Footer
    doc.fontSize(7).fillColor('#9CA3AF').text(
      'Generated automatically per HIPAA §164.312(b) audit-control requirements. Contains Protected Health Information access metadata — handle accordingly.',
      54, 750, { width: 504, align: 'center' }
    );
    doc.end();
  } catch (error) {
    console.error('[audit compliance pdf]', error);
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
