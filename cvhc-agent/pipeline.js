// cvhc-agent/pipeline.js
// Core pipeline stages for the claims processing agent.
// Each stage is a pure function that takes a claim context and returns pass/fail + data.

const db = require('../backend/src/db');
const { v4: uuidv4 } = require('uuid');
const { generate837P, getProviderInfo } = require('../backend/src/services/edi837Generator');
const { resolveAdapter } = require('./adapters/registry');
const config = require('./config');

// ═════════════════════════════════════════════════════════════════════════════
// STAGE 1: Find billable EVV visits
// ═════════════════════════════════════════════════════════════════════════════

/**
 * Fetch all verified EVV visits that don't yet have a claim.
 * Joins client, caregiver, payer, and authorization data.
 */
async function findBillableVisits() {
  const result = await db.query(`
    SELECT
      ev.id AS evv_visit_id,
      ev.time_entry_id, ev.client_id, ev.caregiver_id,
      ev.authorization_id, ev.service_code, ev.modifier,
      ev.service_date, ev.actual_start, ev.actual_end,
      ev.units_of_service, ev.sandata_status, ev.sandata_visit_id,
      ev.is_verified, ev.verification_issues,
      ev.gps_in_lat, ev.gps_in_lng, ev.gps_out_lat, ev.gps_out_lng,
      c.first_name AS client_first, c.last_name AS client_last,
      c.medicaid_id, c.mco_member_id, c.date_of_birth,
      c.gender, c.address AS client_address, c.city AS client_city,
      c.state AS client_state, c.zip AS client_zip,
      c.referral_source_id, c.primary_diagnosis_code,
      u.first_name AS cg_first, u.last_name AS cg_last,
      cp.npi_number AS caregiver_npi, cp.taxonomy_code,
      a.id AS auth_id, a.auth_number, a.authorized_units, a.used_units,
      a.start_date AS auth_start, a.end_date AS auth_end,
      a.status AS auth_status, a.budget_amount, a.budget_used,
      a.budget_type, a.payer_source,
      rs.id AS payer_id, rs.name AS payer_name, rs.payer_type,
      rs.payer_id_number, rs.edi_payer_id, rs.submission_method,
      rs.clearinghouse, rs.timely_filing_days, rs.timely_filing_warn_days,
      rs.requires_medicare_primary, rs.fea_organization
    FROM evv_visits ev
    JOIN clients c ON ev.client_id = c.id
    JOIN users u ON ev.caregiver_id = u.id
    LEFT JOIN caregiver_profiles cp ON cp.caregiver_id = u.id
    LEFT JOIN authorizations a ON ev.authorization_id = a.id
    LEFT JOIN referral_sources rs ON c.referral_source_id = rs.id
    LEFT JOIN claims cl ON cl.evv_visit_id = ev.id
    WHERE ev.is_verified = true
      AND ev.sandata_status IN ('ready', 'submitted', 'accepted')
      AND cl.id IS NULL
    ORDER BY ev.service_date ASC
  `);

  return result.rows;
}

// ═════════════════════════════════════════════════════════════════════════════
// STAGE 2: Validate EVV against Sandata requirements
// ═════════════════════════════════════════════════════════════════════════════

/**
 * Validate a single EVV visit record for completeness and Sandata compliance.
 * @param {Object} visit - A row from findBillableVisits()
 * @returns {{ valid: boolean, errors: string[], warnings: string[] }}
 */
function validateEVV(visit) {
  const errors = [];
  const warnings = [];

  // Must be verified
  if (!visit.is_verified) {
    errors.push('EVV visit is not verified');
  }

  // Must have valid Sandata status
  if (!['ready', 'submitted', 'accepted'].includes(visit.sandata_status)) {
    errors.push(`Sandata status "${visit.sandata_status}" is not billable`);
  }

  // Must have service date
  if (!visit.service_date) {
    errors.push('Missing service date');
  }

  // Must have start/end times
  if (!visit.actual_start) errors.push('Missing clock-in time');
  if (!visit.actual_end) errors.push('Missing clock-out time');

  // Must have units
  const units = parseFloat(visit.units_of_service || 0);
  if (units <= 0) {
    errors.push('Units of service must be greater than 0');
  }

  // Must have GPS data (Wisconsin EVV requirement)
  if (!visit.gps_in_lat || !visit.gps_in_lng) {
    warnings.push('Missing GPS clock-in coordinates — may cause Sandata exception');
  }

  // Must have client Medicaid ID
  if (!visit.medicaid_id && !visit.mco_member_id) {
    errors.push('Client has no Medicaid ID or MCO member ID');
  }

  // Must have a payer
  if (!visit.referral_source_id) {
    errors.push('Client has no payer (referral_source) assigned');
  }

  // Check for verification issues flagged during EVV processing
  if (visit.verification_issues) {
    const issues = typeof visit.verification_issues === 'string'
      ? JSON.parse(visit.verification_issues)
      : visit.verification_issues;
    if (Array.isArray(issues) && issues.length > 0) {
      warnings.push(`EVV has ${issues.length} verification issue(s): ${issues.map(i => i.message || i).join('; ')}`);
    }
  }

  // Timely filing check
  if (visit.service_date) {
    const serviceDate = new Date(visit.service_date);
    const now = new Date();
    const daysSinceService = Math.floor((now - serviceDate) / 86400000);
    const filingLimit = visit.timely_filing_days || 365;
    const warnAt = visit.timely_filing_warn_days || Math.floor(filingLimit * 0.8);

    if (daysSinceService >= filingLimit) {
      errors.push(`TIMELY FILING EXPIRED: ${daysSinceService} days since service (limit: ${filingLimit})`);
    } else if (daysSinceService >= warnAt) {
      warnings.push(`Timely filing warning: ${daysSinceService}/${filingLimit} days elapsed`);
    }
  }

  return { valid: errors.length === 0, errors, warnings };
}

// ═════════════════════════════════════════════════════════════════════════════
// STAGE 3: Check authorization or budget
// ═════════════════════════════════════════════════════════════════════════════

/**
 * Validate that the client has active authorization/budget for this service.
 * IRIS clients: check dollar budget. All others: check unit authorization.
 * @param {Object} visit
 * @returns {{ authorized: boolean, errors: string[], warnings: string[], authData: Object }}
 */
function checkAuthorization(visit) {
  const errors = [];
  const warnings = [];
  const payerType = (visit.payer_type || '').toLowerCase();
  const payerName = (visit.payer_name || '').toLowerCase();
  const isIRIS = payerType === 'iris' || payerName.includes('iris');

  // No authorization linked
  if (!visit.auth_id) {
    if (isIRIS) {
      errors.push('IRIS client has no service plan/budget linked');
    } else {
      errors.push('No authorization linked to this visit');
    }
    return { authorized: false, errors, warnings, authData: null };
  }

  // Check auth status
  if (visit.auth_status === 'exhausted') {
    errors.push('Authorization is exhausted — request renewal');
    return { authorized: false, errors, warnings, authData: null };
  }
  if (visit.auth_status === 'expired' || visit.auth_status === 'inactive') {
    errors.push(`Authorization status is "${visit.auth_status}"`);
    return { authorized: false, errors, warnings, authData: null };
  }

  // Check auth date range
  if (visit.auth_start && visit.auth_end && visit.service_date) {
    const svc = new Date(visit.service_date);
    const start = new Date(visit.auth_start);
    const end = new Date(visit.auth_end);
    if (svc < start || svc > end) {
      errors.push(`Service date ${visit.service_date} is outside auth period ${visit.auth_start} to ${visit.auth_end}`);
    }

    // Warn if auth expiring within 30 days
    const daysUntilExpiry = Math.ceil((end - new Date()) / 86400000);
    if (daysUntilExpiry > 0 && daysUntilExpiry <= 30) {
      warnings.push(`Authorization expires in ${daysUntilExpiry} days`);
    }
  }

  const units = parseFloat(visit.units_of_service || 0);

  if (isIRIS) {
    // IRIS: check dollar budget
    const budgetTotal = parseFloat(visit.budget_amount || 0);
    const budgetUsed = parseFloat(visit.budget_used || 0);
    const remaining = budgetTotal - budgetUsed;

    // We need to estimate the claim dollar amount
    // For now, use units * approximate rate — the actual amount is calculated in claim building
    if (budgetTotal > 0 && remaining <= 0) {
      errors.push('IRIS budget fully exhausted');
    } else if (budgetTotal > 0 && remaining < budgetTotal * 0.1) {
      warnings.push(`IRIS budget below 10%: $${remaining.toFixed(2)} of $${budgetTotal.toFixed(2)} remaining`);
    }

    return {
      authorized: errors.length === 0,
      errors,
      warnings,
      authData: { type: 'budget', budgetTotal, budgetUsed, remaining },
    };
  } else {
    // Standard: check unit authorization
    const authorized = parseFloat(visit.authorized_units || 0);
    const used = parseFloat(visit.used_units || 0);
    const remaining = authorized - used;

    if (remaining <= 0) {
      errors.push(`Authorization has no remaining units (${used}/${authorized} used)`);
    } else if (units > remaining) {
      errors.push(`Claim needs ${units} units but only ${remaining.toFixed(1)} remain`);
    }

    if (remaining > 0 && remaining < authorized * 0.1) {
      warnings.push(`Only ${remaining.toFixed(1)} units remaining (${((remaining / authorized) * 100).toFixed(0)}%)`);
    }

    return {
      authorized: errors.length === 0,
      errors,
      warnings,
      authData: { type: 'units', authorized, used, remaining, authNumber: visit.auth_number },
    };
  }
}

// ═════════════════════════════════════════════════════════════════════════════
// STAGE 4: Build claim record and EDI 837P
// ═════════════════════════════════════════════════════════════════════════════

/**
 * Build a claim record from a validated visit and insert it into the claims table.
 * Also generates the EDI 837P content for EDI-based payers.
 * @param {Object} visit - Enriched visit row
 * @param {string} agentRunId - The current agent run ID
 * @param {boolean} dryRun
 * @returns {{ claim: Object, ediContent: string|null, adapterKey: string|null }}
 */
async function buildClaim(visit, agentRunId, dryRun = false) {
  const units = parseFloat(visit.units_of_service || 0);
  let chargeAmount = 0;

  // Look up rate
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

  // Fallback to service_codes table
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

  const claimId = uuidv4();
  const claimNumber = `CLM-${Date.now().toString(36).toUpperCase()}`;

  // Resolve adapter
  const resolution = resolveAdapter({
    payer_type: visit.payer_type,
    name: visit.payer_name,
    payer_source: visit.payer_source,
    clearinghouse: visit.clearinghouse,
  });
  const adapterKey = resolution ? resolution.key : null;

  // Determine submission method
  const isIRIS = adapterKey === 'iris';
  const submissionMethod = isIRIS ? 'iris_fea' : 'edi837';

  const claimData = {
    id: claimId,
    evv_visit_id: visit.evv_visit_id,
    client_id: visit.client_id,
    caregiver_id: visit.caregiver_id,
    authorization_id: visit.auth_id || null,
    payer_id: visit.payer_id || visit.referral_source_id,
    payer_type: visit.payer_type,
    claim_number: claimNumber,
    procedure_code: visit.service_code || 'T1019',
    modifier: visit.modifier || null,
    diagnosis_code: visit.primary_diagnosis_code || 'Z7689',
    service_date: visit.service_date,
    service_date_from: visit.service_date,
    service_date_to: visit.service_date,
    place_of_service: '12', // Home
    units,
    units_billed: units,
    charge_amount: chargeAmount,
    total_amount: chargeAmount,
    submission_method: submissionMethod,
    status: 'pending',
    agent_run_id: agentRunId,
    resubmit_count: 0,
  };

  if (!dryRun) {
    await db.query(`
      INSERT INTO claims (
        id, evv_visit_id, client_id, caregiver_id, authorization_id,
        payer_id, payer_type, claim_number,
        procedure_code, modifier, diagnosis_code,
        service_date, service_date_from, service_date_to,
        place_of_service, units, units_billed,
        charge_amount, total_amount,
        submission_method, status, agent_run_id, resubmit_count,
        created_at
      ) VALUES (
        $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,NOW()
      )
    `, [
      claimData.id, claimData.evv_visit_id, claimData.client_id,
      claimData.caregiver_id, claimData.authorization_id,
      claimData.payer_id, claimData.payer_type, claimData.claim_number,
      claimData.procedure_code, claimData.modifier, claimData.diagnosis_code,
      claimData.service_date, claimData.service_date_from, claimData.service_date_to,
      claimData.place_of_service, claimData.units, claimData.units_billed,
      claimData.charge_amount, claimData.total_amount,
      claimData.submission_method, claimData.status, agentRunId, 0,
    ]);

    // Log status history
    await db.query(`
      INSERT INTO claim_status_history (id, claim_id, status, notes, created_by)
      VALUES ($1, $2, 'pending', 'Created by claims processing agent', NULL)
    `, [uuidv4(), claimId]);
  }

  // Generate EDI 837P (even for dry-run, to validate the content builds)
  let ediContent = null;
  if (!isIRIS) {
    const provider = getProviderInfo();
    ediContent = generate837P({
      claims: [{
        ...claimData,
        client_first: visit.client_first,
        client_last: visit.client_last,
        medicaid_id: visit.medicaid_id,
        mco_member_id: visit.mco_member_id,
        date_of_birth: visit.date_of_birth,
        client_address: visit.client_address,
        client_city: visit.client_city,
        client_state: visit.client_state,
        client_zip: visit.client_zip,
        caregiver_first: visit.cg_first,
        caregiver_last: visit.cg_last,
        caregiver_npi: visit.caregiver_npi,
        taxonomy_code: visit.taxonomy_code,
        auth_number: visit.auth_number,
        sandata_visit_id: visit.sandata_visit_id,
        gender: visit.gender,
      }],
      provider,
      payer: {
        name: visit.payer_name,
        edi_payer_id: visit.edi_payer_id || visit.payer_id_number,
      },
      interchangeControlNum: Date.now().toString().slice(-9),
    });
  }

  return { claim: claimData, ediContent, adapterKey };
}

// ═════════════════════════════════════════════════════════════════════════════
// STAGE 5: Submit claim to portal
// ═════════════════════════════════════════════════════════════════════════════

/**
 * Submit a built claim through the correct portal adapter.
 * @param {Object} claim - Claim record from buildClaim
 * @param {string|null} ediContent - EDI content (null for IRIS)
 * @param {Object} adapter - Portal adapter instance
 * @param {Object} visit - Original visit data (for metadata)
 * @param {boolean} dryRun
 * @returns {{ submitted: boolean, trackingId: string|null, error: string|null }}
 */
async function submitClaim(claim, ediContent, adapter, visit, dryRun = false) {
  const metadata = {
    claimId: claim.id,
    claimNumber: claim.claim_number,
    clientName: `${visit.client_first} ${visit.client_last}`,
    payerName: visit.payer_name,
    payerEdiId: visit.edi_payer_id || visit.payer_id_number,
    procedureCode: claim.procedure_code,
    units: claim.units,
    chargeAmount: claim.charge_amount,
    serviceDate: claim.service_date,
    medicaidId: visit.medicaid_id,
    caregiverName: `${visit.cg_first} ${visit.cg_last}`,
    budgetRemaining: visit.budget_amount ? (parseFloat(visit.budget_amount) - parseFloat(visit.budget_used || 0)) : null,
    budgetTotal: visit.budget_amount ? parseFloat(visit.budget_amount) : null,
    medicarePaid: false, // TODO: check Medicare EOB for FCP clients
  };

  try {
    const result = await adapter.submitClaim(ediContent, metadata);

    if (!dryRun && result.trackingId) {
      await db.query(`
        UPDATE claims SET
          status = 'submitted',
          submission_date = CURRENT_DATE,
          portal_tracking_id = $2,
          portal_response = $3,
          updated_at = NOW()
        WHERE id = $1
      `, [claim.id, result.trackingId, JSON.stringify(result.raw)]);

      await db.query(`
        INSERT INTO claim_status_history (id, claim_id, status, notes, created_by)
        VALUES ($1, $2, 'submitted', $3, NULL)
      `, [uuidv4(), claim.id, `Submitted via ${adapter.name} — tracking: ${result.trackingId}`]);
    }

    return { submitted: true, trackingId: result.trackingId, status: result.status, error: null };
  } catch (err) {
    return { submitted: false, trackingId: null, status: 'error', error: err.message };
  }
}

// ═════════════════════════════════════════════════════════════════════════════
// STAGE 6: Poll for response and handle result
// ═════════════════════════════════════════════════════════════════════════════

/**
 * Check claim status and handle the response (paid, denied, pending).
 * @param {Object} claim - Claim record with portal_tracking_id
 * @param {Object} adapter - Portal adapter
 * @param {boolean} dryRun
 * @returns {{ status: string, action: string, details: Object }}
 *   action: 'mark_paid' | 'auto_correct' | 'escalate' | 'wait' | 'skip'
 */
async function handleResponse(claim, adapter, dryRun = false) {
  if (!claim.portal_tracking_id) {
    return { status: 'no_tracking', action: 'skip', details: { reason: 'No portal tracking ID' } };
  }

  let response;
  try {
    response = await adapter.checkClaimStatus(claim.portal_tracking_id);
  } catch (err) {
    return { status: 'poll_error', action: 'wait', details: { error: err.message } };
  }

  if (response.status === 'pending' || response.status === 'dry-run-pending') {
    return { status: 'pending', action: 'wait', details: response };
  }

  if (response.status === 'paid' || response.status === 'accepted') {
    // Mark paid in CRM
    if (!dryRun) {
      await db.query(`
        UPDATE claims SET
          status = 'paid',
          paid_amount = $2,
          paid_date = CURRENT_DATE,
          check_number = $3,
          portal_response = $4,
          updated_at = NOW()
        WHERE id = $1
      `, [claim.id, response.paidAmount || claim.charge_amount, response.raw?.checkNumber || null, JSON.stringify(response.raw)]);

      await db.query(`
        INSERT INTO claim_status_history (id, claim_id, status, notes, created_by)
        VALUES ($1, $2, 'paid', $3, NULL)
      `, [uuidv4(), claim.id, `Paid $${(response.paidAmount || claim.charge_amount).toFixed(2)}`]);

      // Update auth burn-down
      if (claim.authorization_id) {
        await db.query(`
          UPDATE authorizations SET
            used_units = used_units + $1,
            status = CASE WHEN used_units + $1 >= authorized_units THEN 'exhausted' ELSE status END,
            updated_at = NOW()
          WHERE id = $2
        `, [claim.units_billed || claim.units, claim.authorization_id]);
      }
    }

    return { status: 'paid', action: 'mark_paid', details: response };
  }

  if (response.status === 'denied' || response.status === 'rejected') {
    // Check if auto-correctable
    const resubmitCount = claim.resubmit_count || 0;
    const correction = adapter.checkAutoCorrectableDenial(response.denialCode, claim);

    if (correction.correctable && resubmitCount < config.pipeline.maxResubmitAttempts) {
      if (!dryRun) {
        await db.query(`
          UPDATE claims SET
            status = 'denied',
            denial_code = $2,
            denial_reason = $3,
            portal_response = $4,
            updated_at = NOW()
          WHERE id = $1
        `, [claim.id, response.denialCode, response.denialReason, JSON.stringify(response.raw)]);
      }

      return {
        status: 'denied',
        action: 'auto_correct',
        details: {
          denialCode: response.denialCode,
          denialReason: response.denialReason,
          fix: correction.fix,
          correctedFields: correction.correctedFields,
          attemptNumber: resubmitCount + 1,
        },
      };
    }

    // Not auto-correctable or max attempts reached — escalate
    if (!dryRun) {
      await db.query(`
        UPDATE claims SET
          status = 'denied',
          denial_code = $2,
          denial_reason = $3,
          escalated = true,
          escalated_reason = $4,
          portal_response = $5,
          updated_at = NOW()
        WHERE id = $1
      `, [
        claim.id, response.denialCode, response.denialReason,
        resubmitCount >= config.pipeline.maxResubmitAttempts
          ? `Max resubmit attempts (${config.pipeline.maxResubmitAttempts}) reached`
          : `Denial code ${response.denialCode} requires manual review`,
        JSON.stringify(response.raw),
      ]);
    }

    return {
      status: 'denied',
      action: 'escalate',
      details: {
        denialCode: response.denialCode,
        denialReason: response.denialReason,
        reason: correction.correctable
          ? `Auto-correction failed after ${resubmitCount} attempts`
          : `Denial code ${response.denialCode} not auto-correctable`,
      },
    };
  }

  return { status: response.status, action: 'wait', details: response };
}

module.exports = {
  findBillableVisits,
  validateEVV,
  checkAuthorization,
  buildClaim,
  submitClaim,
  handleResponse,
};
