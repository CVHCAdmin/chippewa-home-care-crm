// middleware/shared.js
// Shared helpers re-used across all route files

const jwt = require('jsonwebtoken');
const db = require('../db');
const { isStaffTokenRevoked } = require('../services/tokenRevocation');

const verifyToken = async (req, res, next) => {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'No token provided' });
  if (!process.env.JWT_SECRET) {
    console.error('FATAL: JWT_SECRET not set');
    return res.status(500).json({ error: 'Server configuration error' });
  }
  let decoded;
  try {
    decoded = jwt.verify(token, process.env.JWT_SECRET);
  } catch {
    return res.status(401).json({ error: 'Invalid token' });
  }
  if (await isStaffTokenRevoked(decoded)) return res.status(401).json({ error: 'Invalid token' });
  req.user = decoded;
  next();
};

const requireAdmin = (req, res, next) => {
  if (req.user?.role !== 'admin') return res.status(403).json({ error: 'Admin access required' });
  next();
};

// Factory: returns middleware that allows access if the caller is an admin OR
// if req.params[paramName] matches their own user id. Use on routes like
// /api/caregivers/:caregiverId/* where the user themselves should be able to
// read/write their own data, but no one else (other than admin) should.
const requireAdminOrSelf = (paramName) => (req, res, next) => {
  if (req.user?.role === 'admin') return next();
  if (req.user?.id && req.params[paramName] && req.user.id === req.params[paramName]) return next();
  return res.status(403).json({ error: 'Not allowed: you can only access your own data' });
};

const auditLog = async (userId, action, tableName, recordId, oldData, newData, reasonCode) => {
  try {
    if (recordId && typeof recordId === 'string' && !recordId.match(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i)) return;
    await db.query(
      `INSERT INTO audit_logs (user_id, action, table_name, record_id, old_data, new_data, reason_code)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [userId || '00000000-0000-0000-0000-000000000000', action, tableName, recordId, JSON.stringify(oldData), JSON.stringify(newData), reasonCode || null]
    );
  } catch (e) {
    console.error('Audit log error:', e.message);
  }
};

module.exports = { verifyToken, requireAdmin, requireAdminOrSelf, auditLog };
