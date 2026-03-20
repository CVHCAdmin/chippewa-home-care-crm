// helpers/authorizationCheck.js
// Shared authorization enforcement — called before any schedule creation

const db = require('../db');

/**
 * Check if a client has sufficient authorized units for a shift.
 * @param {string} clientId - Client UUID
 * @param {number} shiftHours - Duration of the proposed shift in hours
 * @returns {{ allowed: boolean, warnings: string[], error: string|null, authorization: object|null }}
 */
async function checkAuthorizationBalance(clientId, shiftHours) {
  const warnings = [];

  // Find the most relevant active authorization for this client
  const result = await db.query(`
    SELECT a.*,
      a.authorized_units - a.used_units AS remaining_units,
      ROUND((a.used_units / NULLIF(a.authorized_units, 0)) * 100, 1) AS pct_used,
      CASE
        WHEN a.end_date < CURRENT_DATE THEN 'expired'
        WHEN a.authorized_units - a.used_units <= a.low_units_alert_threshold THEN 'low'
        WHEN a.end_date <= CURRENT_DATE + 30 THEN 'expiring_soon'
        ELSE 'ok'
      END AS health_status
    FROM authorizations a
    WHERE a.client_id = $1
      AND a.status = 'active'
      AND a.start_date <= CURRENT_DATE
      AND a.end_date >= CURRENT_DATE
    ORDER BY a.end_date ASC
    LIMIT 1
  `, [clientId]);

  if (result.rows.length === 0) {
    // Check if client is private pay (no auth needed)
    const clientResult = await db.query(
      `SELECT is_private_pay FROM clients WHERE id = $1`, [clientId]
    );
    if (clientResult.rows[0]?.is_private_pay) {
      return { allowed: true, warnings: [], error: null, authorization: null };
    }
    // No active auth — warn but allow (some clients may not have auths set up yet)
    return {
      allowed: true,
      warnings: ['No active authorization on file for this client'],
      error: null,
      authorization: null
    };
  }

  const auth = result.rows[0];
  const remaining = parseFloat(auth.remaining_units) || 0;

  // Convert shift hours to units based on unit_type
  let requestedUnits;
  switch (auth.unit_type) {
    case 'hourly': requestedUnits = shiftHours; break;
    case 'daily':  requestedUnits = 1; break;
    case 'visit':  requestedUnits = 1; break;
    default:       requestedUnits = shiftHours * 4; break; // 15-min units (default)
  }

  // Hard block: authorization expired (shouldn't happen given query, but safety check)
  if (auth.health_status === 'expired') {
    return {
      allowed: false,
      warnings: [],
      error: 'Authorization has expired',
      authorization: auth
    };
  }

  // Hard block: insufficient units
  if (remaining < requestedUnits) {
    return {
      allowed: false,
      warnings: [],
      error: `Insufficient authorized units: ${remaining} remaining, ${requestedUnits} needed`,
      authorization: auth
    };
  }

  // Soft warnings
  if (auth.health_status === 'low') {
    warnings.push(`Authorization running low: ${remaining} units remaining (${auth.pct_used}% used)`);
  }
  if (auth.health_status === 'expiring_soon') {
    const daysLeft = Math.ceil((new Date(auth.end_date) - new Date()) / (1000 * 60 * 60 * 24));
    warnings.push(`Authorization expires in ${daysLeft} days (${auth.end_date})`);
  }
  if (remaining - requestedUnits <= (auth.low_units_alert_threshold || 0)) {
    warnings.push(`After this shift, only ${(remaining - requestedUnits).toFixed(1)} units will remain`);
  }

  return {
    allowed: true,
    warnings,
    error: null,
    authorization: auth
  };
}

module.exports = { checkAuthorizationBalance };
