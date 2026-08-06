// helpers/authorizationCheck.js
// Authorization ADVICE for schedule creation. It never blocks.
//
// This used to hard-block schedule creation when a client's authorized units ran
// out (commit 1df6a2c, March 2026). That was wrong twice over:
//
//  1. Scheduling is not billing. A client needs care whether or not the payer has
//     approved units yet. Refusing to staff a shift is the most expensive possible
//     response to a paperwork gap — it should be surfaced at billing time instead.
//  2. It was comparing two different quantities. `authorized_units` from the MIDAS
//     import is a WEEKLY allowance (Becky Tharp: 17 units = 4.25 h/wk) while
//     `used_units` accumulates across the whole authorization period (221 units =
//     55 h since June 7). A weekly cap measured against a running total goes
//     negative in week two and never recovers.
//
// By 2026-08-06 that combination silently 400'd schedule creation for 8 of 25
// active payer clients — discovered when a new caregiver could not be scheduled
// for Becky Tharp and the UI showed nothing at all.
//
// So: every shortfall is a warning now. Callers must surface `warnings`; they must
// not refuse the write. `allowed` is retained (always true) so older callers that
// check it keep working.

const db = require('../db');

/**
 * Assess a client's authorization balance for a proposed shift. Advisory only.
 * @param {string} clientId - Client UUID
 * @param {number} shiftHours - Duration of the proposed shift in hours
 * @returns {{ allowed: true, warnings: string[], error: null, authorization: object|null }}
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

  // Expired authorization — warn, schedule anyway. Care still has to be staffed.
  if (auth.health_status === 'expired') {
    warnings.push(`Authorization ${auth.auth_number || ''} expired on ${String(auth.end_date).slice(0, 10)} — this shift may not be billable until it's renewed`.trim());
  }

  // Over the authorized balance — warn, schedule anyway. Note this reads negative
  // for most payer clients today because of the weekly-vs-cumulative mismatch
  // described at the top of this file, so it is deliberately worded as "check",
  // not "you have overrun your authorization".
  if (remaining < requestedUnits) {
    warnings.push(`Authorization balance looks short: ${remaining} ${auth.unit_type || 'unit'} remaining, ${requestedUnits} needed for this shift — check ${auth.auth_number ? 'auth ' + auth.auth_number : 'the authorization'} before billing`);
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
