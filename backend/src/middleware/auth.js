// src/middleware/auth.js
// Authentication middleware
const jwt = require('jsonwebtoken');
const { isStaffTokenRevoked } = require('../services/tokenRevocation');

const verifyToken = async (req, res, next) => {
  const token = req.headers.authorization?.split(' ')[1];

  if (!token) {
    return res.status(401).json({ error: 'No token provided' });
  }

  if (!process.env.JWT_SECRET) {
    console.error('FATAL: JWT_SECRET environment variable is not set');
    return res.status(500).json({ error: 'Server configuration error' });
  }
  let decoded;
  try {
    decoded = jwt.verify(token, process.env.JWT_SECRET);
  } catch (error) {
    return res.status(401).json({ error: 'Invalid token' });
  }
  if (await isStaffTokenRevoked(decoded)) return res.status(401).json({ error: 'Invalid token' });
  req.user = decoded;
  next();
};

const requireAdmin = (req, res, next) => {
  if (!req.user || req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Admin access required' });
  }
  next();
};

// Default export is verifyToken (routes use: const auth = require('./auth'))
module.exports = verifyToken;

// Named exports for destructuring (const { verifyToken, requireAdmin } = require('./auth'))
module.exports.verifyToken = verifyToken;
module.exports.requireAdmin = requireAdmin;
