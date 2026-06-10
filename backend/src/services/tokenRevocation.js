// services/tokenRevocation.js
// Server-side logout: a staff JWT is revoked when it was issued before the
// user's last_logout_at (logout revokes ALL of that user's outstanding
// tokens, on every device). Lookups are cached briefly so the per-request
// overhead is a Map hit, not a DB query.

const db = require('../db');

const CACHE_TTL_MS = 30 * 1000;
const cache = new Map(); // userId -> { lastLogoutMs: number|null, expiresAt: number }
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function getLastLogoutMs(userId) {
  const hit = cache.get(userId);
  if (hit && hit.expiresAt > Date.now()) return hit.lastLogoutMs;
  const { rows } = await db.query('SELECT last_logout_at FROM users WHERE id = $1', [userId]);
  const lastLogoutMs = rows[0]?.last_logout_at ? new Date(rows[0].last_logout_at).getTime() : null;
  cache.set(userId, { lastLogoutMs, expiresAt: Date.now() + CACHE_TTL_MS });
  return lastLogoutMs;
}

// Fails open (returns false) on lookup errors so a DB blip can't 401 the
// whole API — revocation is defense-in-depth, token expiry is the backstop.
// Portal tokens (no users.id in the payload) pass through untouched.
async function isStaffTokenRevoked(decoded) {
  try {
    if (!decoded?.id || !decoded.iat || !UUID_RE.test(decoded.id)) return false;
    const lastLogoutMs = await getLastLogoutMs(decoded.id);
    if (!lastLogoutMs) return false;
    // iat has second granularity — floor the logout time so a re-login in
    // the same second as the logout isn't bounced.
    return decoded.iat < Math.floor(lastLogoutMs / 1000);
  } catch (e) {
    console.error('Token revocation check failed (allowing request):', e.message);
    return false;
  }
}

// Stamp the logout and update the cache in place so revocation takes
// effect immediately in this process instead of waiting out the TTL.
async function markUserLoggedOut(userId) {
  const { rows } = await db.query(
    'UPDATE users SET last_logout_at = NOW() WHERE id = $1 RETURNING last_logout_at',
    [userId]
  );
  const lastLogoutMs = rows[0]?.last_logout_at ? new Date(rows[0].last_logout_at).getTime() : Date.now();
  cache.set(userId, { lastLogoutMs, expiresAt: Date.now() + CACHE_TTL_MS });
}

module.exports = { isStaffTokenRevoked, markUserLoggedOut };
