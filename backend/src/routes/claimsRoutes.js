// src/routes/claimsRoutes.js
// Claims Management: Generate from EVV, submit, track, export 837P,
// payer routing, MIDAS/IRIS exports, denial queue, status updates

const express = require('express');
const router = express.Router();
const db = require('../db');
const { verifyToken: auth } = require('../middleware/auth');
const requireAdmin = require('../middleware/authorizeAdmin');
const { v4: uuidv4 } = require('uuid');
const { generate837P, getProviderInfo } = require('../services/edi837Generator');
const { routeClaim, generateMidasExport, generateIRISExport } = require('../services/payerRouter');
const {
  generateClaimFromEVV,
  batchGenerateClaims,
  checkAuthorizationForSubmission,
  deductAuthorizationUnits,
} = require('../services/claimsEngine');

// ─── GET ALL CLAIMS ──────────────────────────────────────────────────────────
router.get('/', auth, async (req, res) => {
  const { status, payerId, startDate, endDate } = req.query;
  try {
    let query = `
      SELECT c.*,
        rs.name as payer_name, rs.payer_type as rs_payer_type,
        cl.first_name as client_first_name, cl.last_name as client_last_name,
        cl.medicaid_id,
        u.first_name as caregiver_first_name, u.last_name as caregiver_last_name,
        i.invoice_number,
        a.auth_number,
        EXTRACT(DAY FROM NOW() - c.submitted_date) as days_since_submission
      FROM claims c
      LEFT JOIN referral_sources rs ON c.payer_id = rs.id
      LEFT JOIN clients cl ON c.client_id = cl.id
      LEFT JOIN users u ON c.caregiver_id = u.id
      LEFT JOIN invoices i ON c.invoice_id = i.id
      LEFT JOIN authorizations a ON c.authorization_id = a.id
      WHERE 1=1
    `;
    const params = [];

    if (status) {
      params.push(status);
      query += ` AND c.status = $${params.length}`;
    }
    if (payerId) {
      params.push(payerId);
      query += ` AND c.payer_id = $${params.length}`;
    }
    if (startDate) {
      params.push(startDate);
      query += ` AND COALESCE(c.service_date, c.service_date_from) >= $${params.length}`;
    }
    if (endDate) {
      params.push(endDate);
      query += ` AND COALESCE(c.service_date, c.service_date_to) <= $${params.length}`;
    }

    query += ` ORDER BY c.created_at DESC LIMIT 500`;
    const result = await db.query(query, params);
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ─── CLAIMS DASHBOARD SUMMARY ────────────────────────────────────────────────
router.get('/reports/summary', auth, async (req, res) => {
  try {
    const summary = await db.query(`
      SELECT
        status,
        COUNT(*) as count,
        COALESCE(SUM(charge_amount), 0) as total_charged,
        COALESCE(SUM(paid_amount), 0) as total_paid
      FROM claims
      GROUP BY status
    `);

    const byPayer = await db.query(`
      SELECT
        rs.name as payer_name,
        COUNT(*) as claim_count,
        COALESCE(SUM(c.charge_amount), 0) as total_charged,
        COALESCE(SUM(c.paid_amount), 0) as total_paid,
        COALESCE(SUM(CASE WHEN c.status = 'denied' THEN c.charge_amount ELSE 0 END), 0) as total_denied
      FROM claims c
      JOIN referral_sources rs ON c.payer_id = rs.id
      GROUP BY rs.id, rs.name
      ORDER BY total_charged DESC
    `);

    const aging = await db.query(`
      SELECT
        COALESCE(SUM(CASE WHEN submitted_date > NOW() - INTERVAL '30 days' THEN charge_amount ELSE 0 END), 0) as under_30,
        COALESCE(SUM(CASE WHEN submitted_date BETWEEN NOW() - INTERVAL '60 days' AND NOW() - INTERVAL '30 days' THEN charge_amount ELSE 0 END), 0) as days_30_60,
        COALESCE(SUM(CASE WHEN submitted_date BETWEEN NOW() - INTERVAL '90 days' AND NOW() - INTERVAL '60 days' THEN charge_amount ELSE 0 END), 0) as days_60_90,
        COALESCE(SUM(CASE WHEN submitted_date < NOW() - INTERVAL '90 days' THEN charge_amount ELSE 0 END), 0) as over_90
      FROM claims
      WHERE status IN ('submitted', 'accepted')
    `);

    // Total outstanding AR
    const ar = await db.query(`
      SELECT COALESCE(SUM(charge_amount - COALESCE(paid_amount, 0)), 0) as total_ar
      FROM claims WHERE status IN ('pending', 'submitted', 'accepted')
    `);

    // Paid this month
    const paidThisMonth = await db.query(`
      SELECT COALESCE(SUM(paid_amount), 0) as amount, COUNT(*) as count
      FROM claims
      WHERE status = 'paid'
        AND paid_date >= DATE_TRUNC('month', CURRENT_DATE)
    `);

    // Denied count
    const denied = await db.query(`
      SELECT COUNT(*) as count, COALESCE(SUM(charge_amount), 0) as total
      FROM claims WHERE status = 'denied'
    `);

    res.json({
      byStatus: summary.rows,
      byPayer: byPayer.rows,
      aging: aging.rows[0],
      totalAR: parseFloat(ar.rows[0]?.total_ar || 0),
      paidThisMonth: paidThisMonth.rows[0],
      deniedClaims: denied.rows[0],
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ─── DENIAL QUEUE ────────────────────────────────────────────────────────────
router.get('/denial-queue', auth, async (req, res) => {
  try {
    const denials = await db.query(`
      SELECT c.*,
        rs.name as payer_name,
        cl.first_name as client_first_name, cl.last_name as client_last_name,
        cl.medicaid_id,
        u.first_name as caregiver_first_name, u.last_name as caregiver_last_name,
        a.auth_number,
        ev.service_date as evv_service_date, ev.actual_start, ev.actual_end,
        dcl.description as denial_description, dcl.common_fix
      FROM claims c
      LEFT JOIN referral_sources rs ON c.payer_id = rs.id
      LEFT JOIN clients cl ON c.client_id = cl.id
      LEFT JOIN users u ON c.caregiver_id = u.id
      LEFT JOIN authorizations a ON c.authorization_id = a.id
      LEFT JOIN evv_visits ev ON c.evv_visit_id = ev.id
      LEFT JOIN denial_code_lookup dcl ON c.denial_code = dcl.code
      WHERE c.status = 'denied'
      ORDER BY c.updated_at DESC
    `);

    res.json(denials.rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ─── RESUBMIT DENIED CLAIM ──────────────────────────────────────────────────
router.post('/:id/resubmit', auth, requireAdmin, async (req, res) => {
  try {
    const original = await db.query('SELECT * FROM claims WHERE id = $1 AND status = $2', [req.params.id, 'denied']);
    if (!original.rows.length) return res.status(404).json({ error: 'Denied claim not found' });

    const orig = original.rows[0];
    const newClaimNumber = `CLM-${Date.now().toString(36).toUpperCase()}-R`;

    // Create new claim from original
    const result = await db.query(`
      INSERT INTO claims (
        id, evv_visit_id, invoice_id, client_id, caregiver_id, authorization_id,
        payer_id, payer_type, claim_number,
        procedure_code, modifier, diagnosis_code,
        service_date, service_date_from, service_date_to,
        place_of_service, units, units_billed,
        charge_amount, total_amount,
        submission_method, status, resubmitted_from, created_by
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,'pending',$22,$23)
      RETURNING *
    `, [
      uuidv4(), orig.evv_visit_id, orig.invoice_id, orig.client_id,
      orig.caregiver_id, orig.authorization_id,
      orig.payer_id, orig.payer_type, newClaimNumber,
      orig.procedure_code, orig.modifier, orig.diagnosis_code,
      orig.service_date, orig.service_date_from, orig.service_date_to,
      orig.place_of_service, orig.units, orig.units_billed,
      orig.charge_amount, orig.total_amount,
      orig.submission_method, orig.id, req.user.id,
    ]);

    // Mark original as voided
    await db.query(`UPDATE claims SET status = 'voided', voided_at = NOW(), voided_by = $1 WHERE id = $2`, [req.user.id, req.params.id]);

    // Log
    await db.query(`
      INSERT INTO claim_status_history (id, claim_id, status, notes, created_by)
      VALUES ($1, $2, 'pending', $3, $4)
    `, [uuidv4(), result.rows[0].id, `Resubmitted from denied claim ${orig.claim_number}`, req.user.id]);

    res.json(result.rows[0]);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ─── GENERATE CLAIM FROM EVV VISIT ──────────────────────────────────────────
router.post('/from-evv', auth, requireAdmin, async (req, res) => {
  try {
    const { evvVisitId } = req.body;
    if (!evvVisitId) return res.status(400).json({ error: 'EVV visit ID is required' });

    const result = await generateClaimFromEVV(evvVisitId, req.user.id);
    res.json(result);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

// ─── BATCH GENERATE CLAIMS FROM EVV ─────────────────────────────────────────
router.post('/batch-generate', auth, requireAdmin, async (req, res) => {
  try {
    const { startDate, endDate } = req.body;
    if (!startDate || !endDate) return res.status(400).json({ error: 'Date range is required' });

    const result = await batchGenerateClaims(startDate, endDate, req.user.id);
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ─── CHECK AUTHORIZATION BEFORE SUBMISSION ──────────────────────────────────
router.get('/:id/auth-check', auth, async (req, res) => {
  try {
    const result = await checkAuthorizationForSubmission(req.params.id);
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ─── UPDATE CLAIM STATUS (manual) ───────────────────────────────────────────
router.post('/update-status', auth, async (req, res) => {
  const { claimId, status, paidAmount, denialCode, denialReason, eobNotes } = req.body;
  if (!claimId || !status) return res.status(400).json({ error: 'claimId and status are required' });

  try {
    let updateFields = ['status = $1', 'updated_at = NOW()'];
    let params = [status];
    let idx = 2;

    if (status === 'submitted') {
      updateFields.push(`submitted_date = NOW()`);
    }
    if (status === 'accepted') {
      updateFields.push(`accepted_date = NOW()`);
    }
    if (status === 'paid') {
      if (paidAmount) { updateFields.push(`paid_amount = $${idx}`); params.push(paidAmount); idx++; }
      updateFields.push(`paid_date = NOW()`);
    }
    if (status === 'denied') {
      if (denialCode) { updateFields.push(`denial_code = $${idx}`); params.push(denialCode); idx++; }
      if (denialReason) { updateFields.push(`denial_reason = $${idx}`); params.push(denialReason); idx++; }
    }
    if (eobNotes) { updateFields.push(`eob_notes = $${idx}`); params.push(eobNotes); idx++; }

    params.push(claimId);
    await db.query(`UPDATE claims SET ${updateFields.join(', ')} WHERE id = $${idx}`, params);

    // Log
    await db.query(`
      INSERT INTO claim_status_history (id, claim_id, status, notes, created_by)
      VALUES ($1, $2, $3, $4, $5)
    `, [uuidv4(), claimId, status,
      `Manual status update${denialCode ? ` (${denialCode})` : ''}${denialReason ? `: ${denialReason}` : ''}`,
      req.user.id]);

    // Deduct auth units on submission
    if (status === 'submitted') {
      try { await deductAuthorizationUnits(claimId); } catch (e) { /* non-fatal */ }
    }

    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ─── ROUTE CLAIM TO PAYER ───────────────────────────────────────────────────
router.get('/:id/route', auth, async (req, res) => {
  try {
    const claim = await db.query(`
      SELECT rs.* FROM claims c
      JOIN referral_sources rs ON c.payer_id = rs.id
      WHERE c.id = $1
    `, [req.params.id]);
    if (!claim.rows.length) return res.status(404).json({ error: 'Claim or payer not found' });
    res.json(routeClaim(claim.rows[0]));
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ─── MIDAS EXPORT (My Choice Wisconsin) ─────────────────────────────────────
router.post('/export/midas', auth, requireAdmin, async (req, res) => {
  try {
    const { claimIds } = req.body;
    if (!claimIds?.length) return res.status(400).json({ error: 'No claims selected' });

    const claims = await db.query(`
      SELECT c.*,
        cl.first_name as client_first_name, cl.last_name as client_last_name,
        cl.medicaid_id, cl.mco_member_id,
        u.first_name as caregiver_first_name, u.last_name as caregiver_last_name,
        cp.npi_number as caregiver_npi,
        a.auth_number
      FROM claims c
      JOIN clients cl ON c.client_id = cl.id
      LEFT JOIN users u ON c.caregiver_id = u.id
      LEFT JOIN caregiver_profiles cp ON cp.caregiver_id = u.id
      LEFT JOIN authorizations a ON c.authorization_id = a.id
      WHERE c.id = ANY($1)
    `, [claimIds]);

    const provider = getProviderInfo();
    const csv = generateMidasExport(claims.rows, provider);

    // Update claims
    await db.query(`
      UPDATE claims SET submission_method = 'midas_export', status = 'submitted', submitted_date = NOW()
      WHERE id = ANY($1) AND status IN ('pending', 'draft', 'ready')
    `, [claimIds]);

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename=MIDAS-Upload-Packet-${new Date().toISOString().split('T')[0]}.csv`);
    res.send(csv);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ─── IRIS FEA EXPORT ────────────────────────────────────────────────────────
router.post('/export/iris', auth, requireAdmin, async (req, res) => {
  try {
    const { claimIds } = req.body;
    if (!claimIds?.length) return res.status(400).json({ error: 'No claims selected' });

    const claims = await db.query(`
      SELECT c.*,
        cl.first_name as client_first_name, cl.last_name as client_last_name,
        cl.medicaid_id, cl.mco_member_id,
        u.first_name as caregiver_first_name, u.last_name as caregiver_last_name,
        cp.npi_number as caregiver_npi, cp.evv_worker_id,
        a.auth_number,
        rs.fea_organization
      FROM claims c
      JOIN clients cl ON c.client_id = cl.id
      LEFT JOIN users u ON c.caregiver_id = u.id
      LEFT JOIN caregiver_profiles cp ON cp.caregiver_id = u.id
      LEFT JOIN authorizations a ON c.authorization_id = a.id
      LEFT JOIN referral_sources rs ON c.payer_id = rs.id
      WHERE c.id = ANY($1)
    `, [claimIds]);

    const csv = generateIRISExport(claims.rows);

    await db.query(`
      UPDATE claims SET submission_method = 'iris_export', status = 'submitted', submitted_date = NOW()
      WHERE id = ANY($1) AND status IN ('pending', 'draft', 'ready')
    `, [claimIds]);

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename=IRIS-FEA-Export-${new Date().toISOString().split('T')[0]}.csv`);
    res.send(csv);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ─── GET CLAIM BY ID ────────────────────────────────────────────────────────
router.get('/:id', auth, async (req, res) => {
  try {
    const result = await db.query(`
      SELECT c.*,
        rs.name as payer_name, rs.payer_type as rs_payer_type,
        rs.address as billing_address, rs.contact_name as billing_contact,
        cl.first_name as client_first_name, cl.last_name as client_last_name,
        cl.medicaid_id, cl.mco_member_id,
        u.first_name as caregiver_first_name, u.last_name as caregiver_last_name,
        i.invoice_number, i.total as invoice_total,
        a.auth_number, a.authorized_units, a.used_units, a.end_date as auth_end_date,
        dcl.description as denial_description, dcl.common_fix as denial_fix
      FROM claims c
      LEFT JOIN referral_sources rs ON c.payer_id = rs.id
      LEFT JOIN clients cl ON c.client_id = cl.id
      LEFT JOIN users u ON c.caregiver_id = u.id
      LEFT JOIN invoices i ON c.invoice_id = i.id
      LEFT JOIN authorizations a ON c.authorization_id = a.id
      LEFT JOIN denial_code_lookup dcl ON c.denial_code = dcl.code
      WHERE c.id = $1
    `, [req.params.id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Claim not found' });
    }

    const history = await db.query(`
      SELECT * FROM claim_status_history
      WHERE claim_id = $1
      ORDER BY created_at DESC
    `, [req.params.id]);

    res.json({ ...result.rows[0], status_history: history.rows });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ─── CREATE CLAIM FROM INVOICE (existing) ───────────────────────────────────
router.post('/', auth, async (req, res) => {
  const { invoiceId, procedureCode, diagnosisCode, modifier, placeOfService } = req.body;

  try {
    const invoice = await db.query(`
      SELECT i.*, c.referral_source_id, c.medicaid_id,
        c.first_name, c.last_name
      FROM invoices i
      JOIN clients c ON i.client_id = c.id
      WHERE i.id = $1
    `, [invoiceId]);

    if (invoice.rows.length === 0) {
      return res.status(404).json({ error: 'Invoice not found' });
    }

    const inv = invoice.rows[0];
    const claimNumber = `CLM-${Date.now()}`;

    const result = await db.query(`
      INSERT INTO claims (
        invoice_id, claim_number, payer_id, client_id,
        service_date_from, service_date_to, place_of_service,
        procedure_code, modifier, diagnosis_code,
        units, charge_amount, status, created_by
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, 'draft', $13)
      RETURNING *
    `, [
      invoiceId, claimNumber, inv.referral_source_id, inv.client_id,
      inv.billing_period_start, inv.billing_period_end, placeOfService || '12',
      procedureCode, modifier, diagnosisCode,
      inv.total_hours || inv.total, inv.total, req.user.id
    ]);

    await db.query(`
      INSERT INTO claim_status_history (claim_id, status, notes, created_by)
      VALUES ($1, 'draft', 'Claim created', $2)
    `, [result.rows[0].id, req.user.id]);

    res.json(result.rows[0]);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ─── UPDATE CLAIM STATUS (existing, kept for backward compat) ───────────────
router.put('/:id/status', auth, async (req, res) => {
  const { status, notes, paidAmount, denialReason, denialCode, eobNotes } = req.body;

  try {
    let updateFields = ['status = $1', 'updated_at = NOW()'];
    let params = [status];
    let paramIndex = 2;

    if (status === 'submitted') updateFields.push(`submitted_date = NOW()`);
    if (status === 'accepted') updateFields.push(`accepted_date = NOW()`);
    if (status === 'paid' && paidAmount) {
      updateFields.push(`paid_date = NOW()`, `paid_amount = $${paramIndex}`);
      params.push(paidAmount); paramIndex++;
    }
    if (status === 'denied') {
      if (denialCode) { updateFields.push(`denial_code = $${paramIndex}`); params.push(denialCode); paramIndex++; }
      if (denialReason) { updateFields.push(`denial_reason = $${paramIndex}`); params.push(denialReason); paramIndex++; }
    }
    if (eobNotes) { updateFields.push(`eob_notes = $${paramIndex}`); params.push(eobNotes); paramIndex++; }

    params.push(req.params.id);
    await db.query(`UPDATE claims SET ${updateFields.join(', ')} WHERE id = $${paramIndex}`, params);

    await db.query(`
      INSERT INTO claim_status_history (claim_id, status, notes, created_by)
      VALUES ($1, $2, $3, $4)
    `, [req.params.id, status, notes, req.user.id]);

    if (status === 'submitted') {
      try { await deductAuthorizationUnits(req.params.id); } catch (e) { /* non-fatal */ }
    }

    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ─── GENERATE 837P FILE (existing, enhanced) ────────────────────────────────
router.post('/export/837p', auth, async (req, res) => {
  const { claimIds } = req.body;

  try {
    if (!claimIds?.length) return res.status(400).json({ error: 'No claims selected' });

    const claims = await db.query(`
      SELECT c.*,
        rs.name as payer_name, rs.edi_payer_id, rs.npi as payer_npi,
        cl.first_name as client_first_name, cl.last_name as client_last_name,
        cl.medicaid_id, cl.mco_member_id, cl.date_of_birth,
        cl.address, cl.city, cl.state, cl.zip, cl.gender,
        cl.primary_diagnosis_code,
        u.first_name as caregiver_first, u.last_name as caregiver_last,
        cp.npi_number as caregiver_npi, cp.taxonomy_code,
        a.auth_number,
        ev.sandata_visit_id, ev.units_of_service
      FROM claims c
      JOIN clients cl ON c.client_id = cl.id
      LEFT JOIN referral_sources rs ON c.payer_id = rs.id
      LEFT JOIN users u ON c.caregiver_id = u.id
      LEFT JOIN caregiver_profiles cp ON cp.caregiver_id = u.id
      LEFT JOIN authorizations a ON c.authorization_id = a.id
      LEFT JOIN evv_visits ev ON c.evv_visit_id = ev.id
      WHERE c.id = ANY($1)
    `, [claimIds]);

    if (!claims.rows.length) return res.status(400).json({ error: 'No claims found' });

    const provider = getProviderInfo();
    const payer = {
      name: claims.rows[0].payer_name || 'PAYER',
      edi_payer_id: claims.rows[0].edi_payer_id || '',
      npi: claims.rows[0].payer_npi || '',
    };

    const ediContent = generate837P({
      claims: claims.rows,
      provider,
      payer,
      interchangeControlNum: Date.now(),
    });

    // Update claims as submitted
    await db.query(`
      UPDATE claims SET status = 'submitted', submitted_date = NOW(), submission_method = 'edi837'
      WHERE id = ANY($1) AND status IN ('draft', 'ready', 'pending')
    `, [claimIds]);

    // Deduct auth units
    for (const claim of claims.rows) {
      try { await deductAuthorizationUnits(claim.id); } catch (e) { /* non-fatal */ }
    }

    res.setHeader('Content-Type', 'text/plain');
    res.setHeader('Content-Disposition', `attachment; filename=claims-837p-${Date.now()}.edi`);
    res.send(ediContent);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ─── DENIAL CODE LOOKUP ─────────────────────────────────────────────────────
router.get('/lookup/denial-codes', auth, async (req, res) => {
  try {
    const result = await db.query('SELECT * FROM denial_code_lookup ORDER BY code');
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
