// middleware/impersonationReadOnly.js
//
// "View As" is a look-only view — the banner has always said "read-only debug view" —
// but nothing enforced it. A View As token is the target person's own identity, so
// every tap saved as them: on 2026-11-06 open shifts were accepted under a caregiver's
// name while an admin was viewing as her, and the record cannot say who really tapped.
//
// Runs once for every request, before any route, so it covers every verifier (staff,
// caregiver and client-portal View As tokens all carry `impersonation: true`). Reading
// is untouched; anything that would change data is refused. Only the token is checked
// here — an invalid or missing one is left for the route's own auth to answer.
const jwt = require('jsonwebtoken');

const READ_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);
// Leaving View As is harmless (logout already skips revocation for these tokens).
const ALLOWED_WRITES = new Set(['/api/auth/logout']);

module.exports = function impersonationReadOnly(req, res, next) {
  if (READ_METHODS.has(req.method)) return next();
  const token = req.headers.authorization?.split(' ')[1];
  if (!token || !process.env.JWT_SECRET) return next();
  let decoded;
  try { decoded = jwt.verify(token, process.env.JWT_SECRET); } catch { return next(); }
  if (!decoded?.impersonation) return next();
  if (ALLOWED_WRITES.has(req.path)) return next();
  return res.status(403).json({
    error: 'View As is read-only — nothing was saved. Exit View As to make changes.',
    code: 'IMPERSONATION_READ_ONLY',
  });
};
