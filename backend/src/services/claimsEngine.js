// services/claimsEngine.js
// Claims generation engine: creates claims from verified EVV visits
// Handles authorization burn-down, payer routing, and batch processing

const db = require('../db');
const { v4: uuidv4 } = require('uuid');
const { routeClaim } = require('./payerRouter');

/**
 * Generate a claim from a verified EVV visit
 * @param {string} evvVisitId - ID of the EVV visit
 * @param {string} userId - Admin user creating the claim
 * @returns {Object} Created claim record
 */
async function generateClaimFromEVV(evvVisitId, userId) {
  // Get full EVV visit with related data
  const visitResult = await db.query(`
    SELECT ev.*,
      c.first_name as client_first, c.last_name as client_last,
      c.medicaid_id, c.mco_member_id, c.date_of_birth,
      c.gender, c.address as client_address, c.city as client_city,
      c.state as client_state, c.zip as client_zip,
      c.referral_source_id, c.primary_diagnosis_code,
      u.first_name as cg_first, u.last_name as cg_last,
      cp.npi_number as caregiver_npi, cp.taxonomy_code,
      a.auth_number, a.authorized_units, a.used_units, a.end_date as auth_end_date,
      a.low_units_alert_threshold,
      rs.name as payer_name, rs.payer_type, rs.payer_id_number,
      rs.edi_payer_id, rs.fea_organization, rs.submission_method
    FROM evv_visits ev
    JOIN clients c ON ev.client_id = c.id
    JOIN users u ON ev.caregiver_id = u.id
    LEFT JOIN caregiver_profiles cp ON cp.caregiver_id = u.id
    LEFT JOIN authorizations a ON ev.authorization_id = a.id
    LEFT JOIN referral_sources rs ON c.referral_source_id = rs.id
    WHERE ev.id = $1
  `, [evvVisitId]);

  if (!visitResult.rows.length) {
    throw new Error('EVV visit not found');
  }

  const visit = visitResult.rows[0];

  // Check if claim already exists for this visit
  const existing = await db.query(
    'SELECT id FROM claims WHERE evv_visit_id = $1',
    [evvVisitId]
  );
  if (existing.rows.length) {
    throw new Error('Claim already exists for this EVV visit');
  }

  // Route the claim
  const route = routeClaim({
    payer_type: visit.payer_type,
    payer_id_number: visit.payer_id_number,
    name: visit.payer_name,
    submission_method: visit.submission_method,
  });

  // Calculate charge amount from units and rate
  const units = parseFloat(visit.units_of_service || 0);
  let chargeAmount = 0;

  // Look up rate from referral_source_rates
  if (visit.referral_source_id) {
    const rateResult = await db.query(`
      SELECT rate_amount FROM referral_source_rates
      WHERE referral_source_id = $1
        AND (is_active = true OR is_active IS NULL)
        AND (effective_date IS NULL OR effective_date <= $2)
        AND (end_date IS NULL OR end_date >= $2)
      ORDER BY effective_date DESC NULLS LAST
      LIMIT 1
    `, [visit.referral_source_id, visit.service_date]);

    if (rateResult.rows.length) {
      chargeAmount = units * parseFloat(rateResult.rows[0].rate_amount);
    }
  }

  // If no rate found, try service_codes table
  if (chargeAmount === 0) {
    const scResult = await db.query(`
      SELECT rate_per_unit FROM service_codes
      WHERE code = $1 AND is_active = true
      LIMIT 1
    `, [visit.service_code || 'T1019']);

    if (scResult.rows.length && scResult.rows[0].rate_per_unit) {
      chargeAmount = units * parseFloat(scResult.rows[0].rate_per_unit);
    }
  }

  const claimNumber = `CLM-${Date.now().toString(36).toUpperCase()}`;

  const result = await db.query(`
    INSERT INTO claims (
      id, evv_visit_id, client_id, caregiver_id, authorization_id,
      payer_id, payer_type, claim_number,
      procedure_code, modifier, diagnosis_code,
      service_date, service_date_from, service_date_to,
      place_of_service, units, units_billed,
      charge_amount, total_amount,
      submission_method, status, created_by
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,'pending',$21)
    RETURNING *
  `, [
    uuidv4(), evvVisitId, visit.client_id, visit.caregiver_id,
    visit.authorization_id,
    visit.referral_source_id, visit.payer_type, claimNumber,
    visit.service_code || 'T1019', visit.modifier,
    visit.primary_diagnosis_code || 'Z7689',
    visit.service_date, visit.service_date, visit.service_date,
    '12', // Place of service: Home
    units, units,
    chargeAmount, chargeAmount,
    route.method, userId,
  ]);

  // Log status
  await db.query(`
    INSERT INTO claim_status_history (id, claim_id, status, notes, created_by)
    VALUES ($1, $2, 'pending', 'Claim generated from EVV visit', $3)
  `, [uuidv4(), result.rows[0].id, userId]);

  return { claim: result.rows[0], route };
}

/**
 * Batch generate claims from all verified EVV visits in a date range
 */
async function batchGenerateClaims(startDate, endDate, userId) {
  const visits = await db.query(`
    SELECT ev.id
    FROM evv_visits ev
    LEFT JOIN claims cl ON cl.evv_visit_id = ev.id
    WHERE ev.service_date BETWEEN $1 AND $2
      AND ev.is_verified = true
      AND ev.sandata_status IN ('ready', 'submitted', 'accepted')
      AND cl.id IS NULL
    ORDER BY ev.service_date ASC
  `, [startDate, endDate]);

  const results = { generated: 0, skipped: 0, errors: [] };

  for (const visit of visits.rows) {
    try {
      await generateClaimFromEVV(visit.id, userId);
      results.generated++;
    } catch (e) {
      results.skipped++;
      results.errors.push({ visitId: visit.id, error: e.message });
    }
  }

  return results;
}

/**
 * Check authorization before claim submission
 * Returns { canSubmit, warnings, blockers }
 */
async function checkAuthorizationForSubmission(claimId) {
  const claim = await db.query(`
    SELECT c.*, a.authorized_units, a.used_units, a.end_date,
      a.low_units_alert_threshold, a.status as auth_status
    FROM claims c
    LEFT JOIN authorizations a ON c.authorization_id = a.id
    WHERE c.id = $1
  `, [claimId]);

  if (!claim.rows.length) return { canSubmit: false, blockers: ['Claim not found'] };

  const c = claim.rows[0];
  const warnings = [];
  const blockers = [];

  if (!c.authorization_id) {
    warnings.push('No authorization linked to this claim');
    return { canSubmit: true, warnings, blockers };
  }

  const remaining = parseFloat(c.authorized_units || 0) - parseFloat(c.used_units || 0);
  const unitsToBill = parseFloat(c.units_billed || c.units || 0);
  const totalAuth = parseFloat(c.authorized_units || 0);

  // Block if auth is exhausted
  if (remaining <= 0 || c.auth_status === 'exhausted') {
    blockers.push('Authorization has no remaining units. Request a renewal before submitting.');
  }

  // Block if billing more units than remaining
  if (unitsToBill > remaining && remaining > 0) {
    blockers.push(`Claim requires ${unitsToBill} units but only ${remaining.toFixed(1)} remain on authorization.`);
  }

  // Warn if remaining < 10% of authorized
  if (remaining > 0 && remaining < totalAuth * 0.1) {
    warnings.push(`Only ${remaining.toFixed(1)} units remaining (${((remaining / totalAuth) * 100).toFixed(0)}% of ${totalAuth}). Consider requesting renewal.`);
  }

  // Warn if auth expiring within 30 days
  if (c.end_date) {
    const daysUntilExpiry = Math.ceil((new Date(c.end_date) - new Date()) / 86400000);
    if (daysUntilExpiry <= 0) {
      blockers.push('Authorization has expired.');
    } else if (daysUntilExpiry <= 30) {
      warnings.push(`Authorization expires in ${daysUntilExpiry} days.`);
    }
  }

  return {
    canSubmit: blockers.length === 0,
    warnings,
    blockers,
    remainingUnits: remaining,
    unitsToBill,
  };
}

/**
 * Update authorization used_units after claim submission
 */
async function deductAuthorizationUnits(claimId) {
  const claim = await db.query(`
    SELECT c.units_billed, c.authorization_id, c.client_id,
      a.authorized_units, a.used_units, a.low_units_alert_threshold,
      a.auth_number, a.end_date
    FROM claims c
    JOIN authorizations a ON c.authorization_id = a.id
    WHERE c.id = $1
  `, [claimId]);

  if (!claim.rows.length) return;

  const c = claim.rows[0];
  const units = parseFloat(c.units_billed || 0);
  if (units <= 0 || !c.authorization_id) return;

  await db.query(`
    UPDATE authorizations SET
      used_units = used_units + $1,
      status = CASE
        WHEN used_units + $1 >= authorized_units THEN 'exhausted'
        ELSE status
      END,
      updated_at = NOW()
    WHERE id = $2
  `, [units, c.authorization_id]);

  // Check and send alerts
  const newUsed = parseFloat(c.used_units || 0) + units;
  const remaining = parseFloat(c.authorized_units || 0) - newUsed;
  const threshold = parseFloat(c.low_units_alert_threshold || 20);
  const totalAuth = parseFloat(c.authorized_units || 0);

  if (remaining <= threshold || remaining <= totalAuth * 0.1) {
    // Send admin alerts
    const admins = await db.query(`SELECT id FROM users WHERE role = 'admin' AND is_active = true`);
    const clientInfo = await db.query(`SELECT first_name, last_name FROM clients WHERE id = $1`, [c.client_id]);
    const clientName = clientInfo.rows[0] ? `${clientInfo.rows[0].first_name} ${clientInfo.rows[0].last_name}` : 'Client';

    let alertTitle, alertMessage;
    if (remaining <= 0) {
      alertTitle = 'Authorization Exhausted';
      alertMessage = `${clientName}: Authorization #${c.auth_number || 'N/A'} has been exhausted. No units remaining. Renewal required.`;
    } else {
      alertTitle = 'Low Authorization Units';
      alertMessage = `${clientName}: Only ${remaining.toFixed(1)} units remaining on auth #${c.auth_number || 'N/A'} (expires ${new Date(c.end_date).toLocaleDateString()})`;
    }

    for (const admin of admins.rows) {
      await db.query(`
        INSERT INTO notifications (id, user_id, type, title, message, is_read, created_at)
        VALUES ($1, $2, 'authorization_alert', $3, $4, false, NOW())
      `, [uuidv4(), admin.id, alertTitle, alertMessage]);
    }
  }
}

module.exports = {
  generateClaimFromEVV,
  batchGenerateClaims,
  checkAuthorizationForSubmission,
  deductAuthorizationUnits,
};
