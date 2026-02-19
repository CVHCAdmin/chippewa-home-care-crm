// routes/ediRoutes.js
// EDI 837P (Professional) claim generation for WPS / clearinghouse submission

const express = require('express');
const router = express.Router();
const db = require('../db');
const auth = require('../middleware/auth');
const requireAdmin = require('../middleware/authorizeAdmin');
const { v4: uuidv4 } = require('uuid');

// ─── EDI HELPERS ──────────────────────────────────────────────────────────────
function ediDate(d) { return d ? new Date(d).toISOString().split('T')[0].replace(/-/g, '') : ''; }
function ediTime(d) { return d ? new Date(d).toISOString().split('T')[1].slice(0, 5).replace(':', '') : '0000'; }
function pad(s, n) { return String(s || '').padEnd(n).slice(0, n); }
function ediName(s) { return String(s || '').toUpperCase().replace(/[^A-Z0-9 ]/g, '').slice(0, 35); }
function ediId(s) { return String(s || '').replace(/[^A-Z0-9]/gi, '').toUpperCase().slice(0, 30); }

// Build EDI 837P content for a batch of claims
function buildEDI837P(claims, payer, providerInfo, interchangeControlNum) {
  const icn = String(interchangeControlNum || Date.now()).padStart(9, '0');
  const today = ediDate(new Date());
  const now = ediTime(new Date());
  const segments = [];
  let segCount = 0;
  let claimCount = 0;

  const seg = (...parts) => { segments.push(parts.join('*') + '~'); segCount++; };

  // ISA - Interchange Control Header
  seg('ISA', '00', '          ', '00', '          ',
    'ZZ', pad(providerInfo.npi || providerInfo.taxId || 'PROVIDER', 15),
    'ZZ', pad(payer.edi_payer_id || 'PAYER', 15),
    today, now, '^', '00501', icn, '0', 'P', ':');

  // GS - Functional Group Header
  seg('GS', 'HC', providerInfo.npi || 'PROVIDER', payer.edi_payer_id || 'PAYER',
    today, now, '1', 'X', '005010X222A1');

  // ST - Transaction Set Header
  seg('ST', '837', '0001', '005010X222A1');
  seg('BPR', 'I', '0', 'C', 'CHK', '01', '', '', '', '', '', '', '', '', '', today);
  seg('TRN', '1', icn, '1' + (providerInfo.npi || '000000000'));
  seg('DTM', '232', today);

  // 1000A - Submitter
  seg('NM1', '41', '2', ediName(providerInfo.agencyName), '', '', '', '', '46', ediId(providerInfo.npi || providerInfo.taxId));
  seg('PER', 'IC', ediName(providerInfo.contactName || providerInfo.agencyName), 'TE', (providerInfo.phone || '7155551234').replace(/\D/g, ''));

  // 1000B - Receiver
  seg('NM1', '40', '2', ediName(payer.name), '', '', '', '', '46', ediId(payer.edi_payer_id || payer.id));

  // Loop 2000A - Billing Provider
  seg('HL', '1', '', '20', '1');
  seg('PRV', 'BI', 'PXC', providerInfo.taxonomyCode || '374700000X');
  seg('NM1', '85', '2', ediName(providerInfo.agencyName), '', '', '', '', 'XX', ediId(providerInfo.npi));
  seg('N3', providerInfo.address || '123 MAIN ST');
  seg('N4', providerInfo.city || 'EAU CLAIRE', providerInfo.state || 'WI', (providerInfo.zip || '54701').replace(/\D/g, ''));
  seg('REF', 'EI', (providerInfo.taxId || '').replace(/\D/g, ''));

  // Loop 2000B - Subscriber / Payer  
  seg('HL', '2', '1', '22', '0');
  seg('SBR', 'P', '18', '', '', '', '', '', '', 'MC'); // MC = Medicaid
  seg('NM1', 'IL', '1', 'SUBSCRIBER', 'LAST', '', '', '', 'MI', 'MEDICAIDID');
  seg('NM1', 'PR', '2', ediName(payer.name), '', '', '', '', 'PI', ediId(payer.edi_payer_id || payer.npi || ''));

  // Loop 2300 - Claims
  for (const claim of claims) {
    claimCount++;
    const claimAmt = parseFloat(claim.charge_amount || claim.billed_amount || 0).toFixed(2);
    const claimRef = ediId(claim.claim_number || claim.id);
    const svcFrom = ediDate(claim.service_date_from);
    const svcTo = ediDate(claim.service_date_to || claim.service_date_from);

    seg('HL', String(2 + claimCount), '2', '23', '0');
    seg('PAT', '18');
    seg('NM1', 'QC', '1',
      ediName(claim.client_last_name), ediName(claim.client_first_name),
      '', '', '', 'MI', ediId(claim.medicaid_id || claim.mco_member_id || ''));
    if (claim.client_dob) seg('DMG', 'D8', ediDate(claim.client_dob), claim.gender === 'Female' ? 'F' : 'M');

    seg('CLM', claimRef, claimAmt, '', '', '12:B:1', 'Y', 'A', 'Y', 'I');
    seg('DTP', '435', 'D8', svcFrom);
    seg('DTP', '096', 'D8', svcTo);
    if (claim.authorization_id || claim.auth_number) {
      seg('REF', 'G1', ediId(claim.auth_number || claim.authorization_id));
    }
    seg('REF', 'EA', claimRef); // Original Ref Number

    // Diagnosis code
    if (claim.diagnosis_code || claim.primary_diagnosis_code) {
      seg('HI', `ABK:${ediId(claim.diagnosis_code || claim.primary_diagnosis_code || 'Z00.00')}`);
    } else {
      seg('HI', 'ABK:Z00000'); // placeholder
    }

    // Rendering Provider
    seg('NM1', '82', '1',
      ediName(claim.caregiver_last), ediName(claim.caregiver_first),
      '', '', '', 'XX', ediId(claim.npi_number || claim.caregiver_npi || ''));
    if (claim.taxonomy_code) seg('PRV', 'PE', 'PXC', claim.taxonomy_code);

    // Loop 2400 - Service Line
    const units = parseFloat(claim.units || 1).toFixed(3);
    const unitCode = claim.unit_type === 'hour' ? 'UN' : claim.unit_type === 'day' ? 'DA' : 'UN';
    const unitRate = (parseFloat(claimAmt) / parseFloat(units)).toFixed(2);
    seg('LX', '1');
    seg('SV1',
      `HC:${ediId(claim.procedure_code || 'T1019')}${claim.modifier ? ':' + claim.modifier : ''}`,
      claimAmt, unitCode, units, '', '1');
    seg('DTP', '472', 'D8', svcFrom);

    // EVV reference if available
    if (claim.sandata_visit_id) {
      seg('REF', 'LU', ediId(claim.sandata_visit_id));
    }
  }

  // SE - Transaction Set Trailer
  seg('SE', String(segCount + 1), '0001');
  seg('GE', String(claimCount), '1');
  seg('IEA', '1', icn);

  return segments.join('\n');
}

// ─── GENERATE EDI BATCH ───────────────────────────────────────────────────────
router.post('/generate', auth, requireAdmin, async (req, res) => {
  try {
    const { claimIds, payerId } = req.body;
    if (!claimIds?.length) return res.status(400).json({ error: 'No claims selected' });

    // Get claims with all needed data
    const claimsResult = await db.query(`
      SELECT c.*,
        cl.first_name as client_first_name, cl.last_name as client_last_name,
        cl.medicaid_id, cl.mco_member_id, cl.date_of_birth as client_dob, cl.gender,
        cl.primary_diagnosis_code as diagnosis_code,
        u.first_name as caregiver_first, u.last_name as caregiver_last,
        cp.npi_number as caregiver_npi, cp.taxonomy_code,
        ev.sandata_visit_id, ev.actual_start, ev.actual_end, ev.units_of_service as units,
        a.auth_number,
        rs.name as payer_name, rs.edi_payer_id, rs.npi as payer_npi
      FROM claims c
      JOIN clients cl ON c.client_id = cl.id
      LEFT JOIN users u ON c.created_by = u.id
      LEFT JOIN caregiver_profiles cp ON cp.caregiver_id = u.id
      LEFT JOIN evv_visits ev ON c.evv_visit_id = ev.id
      LEFT JOIN authorizations a ON c.authorization_id = a.id
      LEFT JOIN referral_sources rs ON c.payer_id = rs.id
      WHERE c.id = ANY($1)
        AND c.status IN ('draft', 'approved')
    `, [claimIds]);

    if (!claimsResult.rows.length) return res.status(400).json({ error: 'No eligible claims found' });

    // Get agency/provider info from settings or env
    const providerInfo = {
      agencyName: process.env.AGENCY_NAME || 'CHIPPEWA VALLEY HOME CARE',
      npi: process.env.AGENCY_NPI || '',
      taxId: process.env.AGENCY_TAX_ID || '',
      taxonomyCode: process.env.AGENCY_TAXONOMY || '374700000X',
      address: process.env.AGENCY_ADDRESS || '123 MAIN ST',
      city: process.env.AGENCY_CITY || 'EAU CLAIRE',
      state: process.env.AGENCY_STATE || 'WI',
      zip: process.env.AGENCY_ZIP || '54701',
      phone: process.env.AGENCY_PHONE || '7155551234',
      contactName: process.env.AGENCY_CONTACT || 'ALEXIS',
    };

    // Get payer info
    const payer = claimsResult.rows[0];
    const payerInfo = {
      name: payer.payer_name || 'PAYER',
      edi_payer_id: payer.edi_payer_id || '',
      npi: payer.payer_npi || '',
    };

    const batchNumber = `EDI-${Date.now()}`;
    const ediContent = buildEDI837P(claimsResult.rows, payerInfo, providerInfo, Date.now());
    const totalBilled = claimsResult.rows.reduce((sum, c) => sum + parseFloat(c.charge_amount || 0), 0);

    // Save batch
    const batch = await db.query(`
      INSERT INTO edi_batches (id, payer_id, batch_number, status, claim_count, total_billed, edi_content, created_by)
      VALUES ($1,$2,$3,'generated',$4,$5,$6,$7)
      RETURNING *
    `, [uuidv4(), payerId || claimsResult.rows[0].payer_id, batchNumber, claimsResult.rows.length, totalBilled, ediContent, req.user.id]);

    // Link claims to batch
    for (const claim of claimsResult.rows) {
      await db.query(`UPDATE claims SET edi_batch_id = $1, status = 'submitted', submission_date = CURRENT_DATE WHERE id = $2`, [batch.rows[0].id, claim.id]);
    }

    res.json({
      batch: batch.rows[0],
      claimCount: claimsResult.rows.length,
      totalBilled,
      ediContent,
      downloadUrl: `/api/edi/batch/${batch.rows[0].id}/download`
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ─── DOWNLOAD EDI FILE ────────────────────────────────────────────────────────
router.get('/batch/:id/download', auth, requireAdmin, async (req, res) => {
  try {
    const batch = await db.query('SELECT * FROM edi_batches WHERE id = $1', [req.params.id]);
    if (!batch.rows.length) return res.status(404).json({ error: 'Batch not found' });

    res.setHeader('Content-Type', 'text/plain');
    res.setHeader('Content-Disposition', `attachment; filename="${batch.rows[0].batch_number}.edi"`);
    res.send(batch.rows[0].edi_content);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ─── GET ALL BATCHES ──────────────────────────────────────────────────────────
router.get('/batches', auth, requireAdmin, async (req, res) => {
  try {
    const result = await db.query(`
      SELECT eb.*, rs.name as payer_name
      FROM edi_batches eb
      LEFT JOIN referral_sources rs ON eb.payer_id = rs.id
      ORDER BY eb.created_at DESC
      LIMIT 50
    `);
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ─── SERVICE CODES ────────────────────────────────────────────────────────────
router.get('/service-codes', auth, async (req, res) => {
  try {
    const result = await db.query(`SELECT * FROM service_codes WHERE is_active = true ORDER BY code, modifier1`);
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/service-codes', auth, requireAdmin, async (req, res) => {
  try {
    const { code, modifier1, modifier2, description, serviceCategory, payerType, unitType, ratePerUnit, requiresEvv } = req.body;
    const result = await db.query(`
      INSERT INTO service_codes (id, code, modifier1, modifier2, description, service_category, payer_type, unit_type, rate_per_unit, requires_evv)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *
    `, [uuidv4(), code, modifier1 || null, modifier2 || null, description, serviceCategory || 'personal_care', payerType || 'all', unitType || '15min', ratePerUnit || null, requiresEvv !== false]);
    res.status(201).json(result.rows[0]);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
