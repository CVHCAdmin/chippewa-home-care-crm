// middleware/shared.js
// Shared helpers re-used across all route files

const jwt = require('jsonwebtoken');
const db = require('../db');

const verifyToken = (req, res, next) => {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'No token provided' });
  if (!process.env.JWT_SECRET) {
    console.error('FATAL: JWT_SECRET not set');
    return res.status(500).json({ error: 'Server configuration error' });
  }
  try {
    req.user = jwt.verify(token, process.env.JWT_SECRET);
    next();
  } catch {
    return res.status(401).json({ error: 'Invalid token' });
  }
};

const requireAdmin = (req, res, next) => {
  if (req.user?.role !== 'admin') return res.status(403).json({ error: 'Admin access required' });
  next();
};

const auditLog = async (userId, action, tableName, recordId, oldData, newData) => {
  try {
    if (recordId && typeof recordId === 'string' && !recordId.match(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i)) return;
    await db.query(
      `INSERT INTO audit_logs (user_id, action, table_name, record_id, old_data, new_data, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, NOW())`,
      [userId || '00000000-0000-0000-0000-000000000000', action, tableName, recordId, JSON.stringify(oldData), JSON.stringify(newData)]
    );
  } catch (e) {
    console.error('Audit log error:', e.message);
  }
};

module.exports = { verifyToken, requireAdmin, auditLog };
