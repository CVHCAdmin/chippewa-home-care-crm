// routes/failsafeRoutes.js
// Pre-submission validation engine - catches problems before claims get denied

const express = require('express');
const router = express.Router();
const db = require('../db');
const auth = require('../middleware/auth');
const requireAdmin = require('../middleware/authorizeAdmin');
const { v4: uuidv4 } = require('uuid');

// ─── VALIDATION RULES ─────────────────────────────────────────────────────────
const RULES = {
  // EVV-level validations
  EVV_HAS_GPS: async (visit) => {
    if (!visit.gps_in_lat) return { status: 'fail', code: 'EVV_NO_GPS_IN', message: 'No GPS location recorded on clock-in' };
    if (!visit.gps_out_lat && visit.actual_end) return { status: 'warning', code: 'EVV_NO_GPS_OUT', message: 'No GPS location on clock-out' };
    return { status: 'pass' };
  },
  EVV_HAS_MEDICAID_ID: async (visit) => {
    if (!visit.medicaid_id) return { status: 'fail', code: 'EVV_NO_MEDICAID_ID', message: `Client ${visit.client_first} ${visit.client_last} has no Medicaid ID` };
    return { status: 'pass' };
  },
  EVV_HAS_WORKER_ID: async (visit) => {
    if (!visit.evv_worker_id && !visit.npi_number) return { status: 'fail', code: 'EVV_NO_WORKER_ID', message: `Caregiver ${visit.cg_first} ${visit.cg_last} has no EVV Worker ID or NPI` };
    return { status: 'pass' };
  },
  EVV_WITHIN_AUTH: async (visit) => {
    if (!visit.authorization_id) return { status: 'warning', code: 'EVV_NO_AUTH', message: 'No authorization linked to this visit — verify manually' };
    if (visit.auth_remaining_units !== null && visit.auth_remaining_units < 0) {
      return { status: 'fail', code: 'EVV_EXCEEDS_AUTH', message: `Authorization exhausted: ${Math.abs(visit.auth_remaining_units).toFixed(1)} units over limit` };
    }
    return { status: 'pass' };
  },
  EVV_AUTH_ACTIVE: async (visit) => {
    if (!visit.auth_end_date) return { status: 'pass' };
    if (new Date(visit.service_date) > new Date(visit.auth_end_date)) {
      return { status: 'fail', code: 'EVV_AUTH_EXPIRED', message: `Authorization expired on ${new Date(visit.auth_end_date).toLocaleDateString()}` };
    }
    return { status: 'pass' };
  },
  EVV_NO_DUPLICATE: async (visit) => {
    const dup = await db.query(`
      SELECT id FROM evv_visits
      WHERE client_id = $1 AND caregiver_id = $2 AND service_date = $3
        AND id != $4 AND sandata_status NOT IN ('rejected')
    `, [visit.client_id, visit.caregiver_id, visit.service_date, visit.id]);
    if (dup.rows.length > 0) return { status: 'warning', code: 'EVV_POSSIBLE_DUPLICATE', message: 'Another EVV visit exists for same client, caregiver, and date' };
    return { status: 'pass' };
  },
  EVV_SANDATA_ACCEPTED: async (visit) => {
    if (visit.sandata_status === 'accepted') return { status: 'pass' };
    if (visit.sandata_status === 'submitted') return { status: 'warning', code: 'EVV_PENDING_SANDATA', message: 'EVV submitted to Sandata but acceptance not yet confirmed' };
    if (visit.sandata_status === 'exception') return { status: 'fail', code: 'EVV_EXCEPTION', message: `Sandata exception: ${visit.sandata_exception_desc || visit.sandata_exception_code}` };
    if (!getSandataConfig()) return { status: 'warning', code: 'EVV_NOT_SUBMITTED', message: 'EVV not yet submitted to Sandata (credentials not configured)' };
    return { status: 'fail', code: 'EVV_NOT_SUBMITTED', message: 'EVV not yet submitted to Sandata' };
  },
  // Claim-level validations
  CLAIM_HAS_SERVICE_CODE: async (claim) => {
    if (!claim.procedure_code) return { status: 'fail', code: 'CLAIM_NO_CODE', message: 'Claim has no procedure code' };
    return { status: 'pass' };
  },
  CLAIM_NO_DUPLICATE: async (claim) => {
    const dup = await db.query(`
      SELECT id FROM claims
      WHERE client_id = $1 AND procedure_code = $2
        AND service_date_from = $3 AND service_date_to = $4
        AND id != $5 AND status NOT IN ('denied', 'void')
    `, [claim.client_id, claim.procedure_code, claim.service_date_from, claim.service_date_to, claim.id]);
    if (dup.rows.length > 0) return { status: 'fail', code: 'CLAIM_DUPLICATE', message: 'Duplicate claim detected for same client, service, and dates' };
    return { status: 'pass' };
  },
  CAREGIVER_CREDENTIALS_CURRENT: async (claim) => {
    const bg = await db.query(`
      SELECT * FROM background_checks
      WHERE caregiver_id = $1
        AND (expiry_date IS NULL OR expiry_date > CURRENT_DATE)
        AND status = 'clear'
      LIMIT 1
    `, [claim.caregiver_id || claim.created_by]);
    if (!bg.rows.length) return { status: 'warning', code: 'CLAIM_CRED_EXPIRED', message: 'Caregiver may have expired background check — verify before submitting' };
    return { status: 'pass' };
  },
};

function getSandataConfig() {
  return !!(process.env.SANDATA_USERNAME && process.env.SANDATA_PASSWORD);
}

// ─── VALIDATE EVV VISITS BEFORE CLAIM GENERATION ─────────────────────────────
router.post('/validate-evv', auth, requireAdmin, async (req, res) => {
  try {
    const { visitIds } = req.body;

    const visits = await db.query(`
      SELECT ev.*,
        c.first_name as client_first, c.last_name as client_last,
        c.medicaid_id,
        u.first_name as cg_first, u.last_name as cg_last,
        cp.evv_worker_id, cp.npi_number,
        a.auth_number, a.end_date as auth_end_date,
        a.authorized_units - a.used_units as auth_remaining_units
      FROM evv_visits ev
      JOIN clients c ON ev.client_id = c.id
      JOIN users u ON ev.caregiver_id = u.id
      LEFT JOIN caregiver_profiles cp ON cp.caregiver_id = u.id
      LEFT JOIN authorizations a ON ev.authorization_id = a.id
      WHERE ev.id = ANY($1)
    `, [visitIds]);

    const validationResults = [];
    let allPass = true;

    for (const visit of visits.rows) {
      const visitResults = { visitId: visit.id, checks: [], canProceed: true };

      for (const [ruleName, ruleFn] of Object.entries(RULES)) {
        if (!ruleName.startsWith('EVV_')) continue;
        try {
          const result = await ruleFn(visit);
          visitResults.checks.push({ rule: ruleName, ...result });
          if (result.status === 'fail') {
            visitResults.canProceed = false;
            allPass = false;
          }
          if (result.status !== 'pass') {
            // Log validation issue
            await db.query(`
              INSERT INTO validation_log (id, entity_type, entity_id, validation_type, status, message, details)
              VALUES ($1,'evv_visit',$2,$3,$4,$5,$6)
              ON CONFLICT DO NOTHING
            `, [uuidv4(), visit.id, result.code, result.status, result.message, JSON.stringify({ visitId: visit.id, rule: ruleName })]);
          }
        } catch (e) { /* skip failed rule */ }
      }

      validationResults.push(visitResults);
    }

    res.json({
      allPass,
      canGenerateClaims: allPass,
      results: validationResults,
      summary: {
        total: validationResults.length,
        pass: validationResults.filter(v => v.canProceed).length,
        fail: validationResults.filter(v => !v.canProceed).length,
      }
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ─── VALIDATE CLAIMS BEFORE SUBMISSION ───────────────────────────────────────
router.post('/validate-claims', auth, requireAdmin, async (req, res) => {
  try {
    const { claimIds } = req.body;

    const claims = await db.query(`
      SELECT c.*,
        cl.first_name as client_first, cl.last_name as client_last, cl.medicaid_id,
        rs.name as payer_name, rs.edi_payer_id,
        ev.sandata_status, ev.sandata_exception_desc, ev.is_verified as evv_verified,
        ev.gps_in_lat, ev.gps_out_lat, ev.gps_in_lng, ev.gps_out_lng,
        ev.evv_worker_id, ev.npi_number
      FROM claims c
      JOIN clients cl ON c.client_id = cl.id
      LEFT JOIN referral_sources rs ON c.payer_id = rs.id
      LEFT JOIN evv_visits ev ON c.evv_visit_id = ev.id
      LEFT JOIN caregiver_profiles cp ON cp.caregiver_id = c.created_by
      WHERE c.id = ANY($1)
    `, [claimIds]);

    const results = [];
    let allPass = true;

    for (const claim of claims.rows) {
      const claimResult = { claimId: claim.id, checks: [], canSubmit: true };

      // Check EVV-to-claim match
      if (claim.evv_visit_id && claim.sandata_status !== 'accepted') {
        const check = { rule: 'EVV_SANDATA_ACCEPTED', status: 'warning', code: 'EVV_NOT_ACCEPTED', message: `EVV status is "${claim.sandata_status}" — ideally should be accepted before submitting claim` };
        claimResult.checks.push(check);
      } else if (!claim.evv_visit_id) {
        claimResult.checks.push({ rule: 'EVV_LINKED', status: 'warning', code: 'NO_EVV_LINK', message: 'No EVV visit linked to this claim' });
      }

      for (const [ruleName, ruleFn] of Object.entries(RULES)) {
        if (!ruleName.startsWith('CLAIM_') && !ruleName.startsWith('CAREGIVER_')) continue;
        try {
          const result = await ruleFn(claim);
          claimResult.checks.push({ rule: ruleName, ...result });
          if (result.status === 'fail') {
            claimResult.canSubmit = false;
            allPass = false;
          }
        } catch (e) { /* skip */ }
      }

      results.push(claimResult);
    }

    res.json({
      allPass,
      results,
      summary: {
        total: results.length,
        readyToSubmit: results.filter(r => r.canSubmit).length,
        blocked: results.filter(r => !r.canSubmit).length,
      }
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ─── GET OPEN VALIDATION ISSUES ───────────────────────────────────────────────
router.get('/issues', auth, requireAdmin, async (req, res) => {
  try {
    const result = await db.query(`
      SELECT vl.*
      FROM validation_log vl
      WHERE vl.resolved_at IS NULL
        AND vl.status IN ('fail', 'warning')
      ORDER BY vl.status DESC, vl.created_at DESC
      LIMIT 100
    `);
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ─── RESOLVE ISSUE ────────────────────────────────────────────────────────────
router.put('/issues/:id/resolve', auth, requireAdmin, async (req, res) => {
  try {
    await db.query(`UPDATE validation_log SET resolved_at = NOW(), resolved_by = $1 WHERE id = $2`, [req.user.id, req.params.id]);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
