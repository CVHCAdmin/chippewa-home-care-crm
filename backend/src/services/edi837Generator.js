// services/edi837Generator.js
// Full ANSI X12 EDI 837P (Professional) claim file generator
// Generates valid 837P files from verified EVV visit records

function ediDate(d) {
  return d ? new Date(d).toISOString().split('T')[0].replace(/-/g, '') : '';
}

function ediTime(d) {
  return d ? new Date(d).toISOString().split('T')[1].slice(0, 5).replace(':', '') : '0000';
}

function pad(s, n) {
  return String(s || '').padEnd(n).slice(0, n);
}

function ediName(s) {
  return String(s || '').toUpperCase().replace(/[^A-Z0-9 ]/g, '').slice(0, 35);
}

function ediId(s) {
  return String(s || '').replace(/[^A-Z0-9]/gi, '').toUpperCase().slice(0, 30);
}

/**
 * Build a complete EDI 837P file from claim data
 * @param {Object} options
 * @param {Array} options.claims - Array of claim records with client/caregiver/auth data
 * @param {Object} options.provider - Agency provider info (npi, taxId, name, address, etc.)
 * @param {Object} options.payer - Payer info (name, edi_payer_id, npi)
 * @param {string} options.interchangeControlNum - Unique control number
 * @returns {string} EDI 837P content
 */
function generate837P({ claims, provider, payer, interchangeControlNum }) {
  const icn = String(interchangeControlNum || Date.now()).padStart(9, '0');
  const today = ediDate(new Date());
  const now = ediTime(new Date());
  const segments = [];
  let segCount = 0;
  let hlCount = 0;

  const seg = (...parts) => {
    segments.push(parts.join('*') + '~');
    segCount++;
  };

  // ─── ISA - Interchange Control Header ──────────────────────────────────────
  seg('ISA', '00', pad('', 10), '00', pad('', 10),
    'ZZ', pad(ediId(provider.npi || provider.taxId), 15),
    'ZZ', pad(ediId(payer.edi_payer_id || payer.name), 15),
    today.slice(2), now, '^', '00501', icn, '0',
    process.env.NODE_ENV === 'production' ? 'P' : 'T', ':');

  // ─── GS - Functional Group Header ─────────────────────────────────────────
  seg('GS', 'HC',
    ediId(provider.npi || provider.taxId),
    ediId(payer.edi_payer_id || payer.name),
    today, now, '1', 'X', '005010X222A1');

  // ─── ST - Transaction Set Header ──────────────────────────────────────────
  seg('ST', '837', '0001', '005010X222A1');

  // ─── BHT - Beginning of Hierarchical Transaction ──────────────────────────
  seg('BHT', '0019', '00', icn, today, now, 'CH');

  // ─── 1000A - Submitter Name ───────────────────────────────────────────────
  seg('NM1', '41', '2',
    ediName(provider.agencyName),
    '', '', '', '', '46',
    ediId(provider.npi));
  seg('PER', 'IC',
    ediName(provider.contactName || provider.agencyName),
    'TE', (provider.phone || '0000000000').replace(/\D/g, '').slice(0, 10));

  // ─── 1000B - Receiver Name ────────────────────────────────────────────────
  seg('NM1', '40', '2',
    ediName(payer.name),
    '', '', '', '', '46',
    ediId(payer.edi_payer_id));

  // ─── 2000A - Billing Provider Hierarchical Level ──────────────────────────
  hlCount++;
  const billingHL = hlCount;
  seg('HL', String(billingHL), '', '20', '1');
  seg('PRV', 'BI', 'PXC', provider.taxonomyCode || '374700000X');

  // ─── 2010AA - Billing Provider Name ───────────────────────────────────────
  seg('NM1', '85', '2',
    ediName(provider.agencyName),
    '', '', '', '', 'XX',
    ediId(provider.npi));
  seg('N3', ediName(provider.address || ''));
  seg('N4',
    ediName(provider.city || 'EAU CLAIRE'),
    provider.state || 'WI',
    (provider.zip || '54701').replace(/\D/g, '').slice(0, 9));
  seg('REF', 'EI', (provider.taxId || '').replace(/\D/g, ''));

  // ─── 2010AB - Pay-To Provider (same as billing) ───────────────────────────
  // Omitted when same as billing provider

  // ─── Generate claims ──────────────────────────────────────────────────────
  for (const claim of claims) {
    // ─── 2000B - Subscriber Hierarchical Level ────────────────────────────
    hlCount++;
    const subscriberHL = hlCount;
    seg('HL', String(subscriberHL), String(billingHL), '22', '0');
    seg('SBR', 'P', '18', '', '', '', '', '', '', 'MC'); // MC = Medicaid

    // ─── 2010BA - Subscriber Name ─────────────────────────────────────────
    seg('NM1', 'IL', '1',
      ediName(claim.client_last_name || claim.client_last),
      ediName(claim.client_first_name || claim.client_first),
      '', '', '', 'MI',
      ediId(claim.medicaid_id));

    if (claim.client_address) {
      seg('N3', ediName(claim.client_address));
      seg('N4',
        ediName(claim.client_city || ''),
        claim.client_state || 'WI',
        (claim.client_zip || '').replace(/\D/g, ''));
    }

    if (claim.client_dob || claim.date_of_birth) {
      seg('DMG', 'D8',
        ediDate(claim.client_dob || claim.date_of_birth),
        claim.gender === 'Female' ? 'F' : claim.gender === 'Male' ? 'M' : 'U');
    }

    // ─── 2010BB - Payer Name ──────────────────────────────────────────────
    seg('NM1', 'PR', '2',
      ediName(payer.name),
      '', '', '', '', 'PI',
      ediId(payer.edi_payer_id));

    // ─── 2300 - Claim Information ─────────────────────────────────────────
    const claimAmt = parseFloat(claim.charge_amount || 0).toFixed(2);
    const claimRef = ediId(claim.claim_number || claim.id);
    const svcDate = ediDate(claim.service_date || claim.service_date_from);
    const pos = claim.place_of_service || '12'; // 12 = Home

    seg('CLM', claimRef, claimAmt, '', '',
      `${pos}:B:1`, 'Y', 'A', 'Y', 'I');

    // Service dates
    seg('DTP', '431', 'D8', svcDate); // Date of onset
    seg('DTP', '472', 'RD8',
      `${svcDate}-${ediDate(claim.service_date_to || claim.service_date || claim.service_date_from)}`);

    // Prior authorization number
    if (claim.auth_number || claim.authorization_number) {
      seg('REF', 'G1', ediId(claim.auth_number || claim.authorization_number));
    }

    // Diagnosis code
    const dx = claim.diagnosis_code || claim.primary_diagnosis_code || 'Z7689';
    seg('HI', `ABK:${ediId(dx)}`);

    // ─── 2310B - Rendering Provider ─────────────────────────────────────
    if (claim.caregiver_last || claim.caregiver_last_name) {
      seg('NM1', '82', '1',
        ediName(claim.caregiver_last || claim.caregiver_last_name),
        ediName(claim.caregiver_first || claim.caregiver_first_name),
        '', '', '', 'XX',
        ediId(claim.caregiver_npi || claim.npi_number || provider.npi));
      if (claim.taxonomy_code) {
        seg('PRV', 'PE', 'PXC', claim.taxonomy_code);
      }
    }

    // ─── 2400 - Service Line ────────────────────────────────────────────
    const units = parseFloat(claim.units_billed || claim.units || claim.units_of_service || 1);
    const procCode = claim.procedure_code || 'T1019';
    const modifier = claim.modifier ? `:${claim.modifier}` : '';

    seg('LX', '1');
    seg('SV1',
      `HC:${ediId(procCode)}${modifier}`,
      claimAmt, 'UN',
      units.toFixed(3), '', '1');
    seg('DTP', '472', 'D8', svcDate);

    // EVV reference
    if (claim.sandata_visit_id) {
      seg('REF', 'LU', ediId(claim.sandata_visit_id));
    }
  }

  // ─── SE - Transaction Set Trailer ─────────────────────────────────────────
  seg('SE', String(segCount + 1), '0001');

  // ─── GE - Functional Group Trailer ────────────────────────────────────────
  seg('GE', '1', '1');

  // ─── IEA - Interchange Control Trailer ────────────────────────────────────
  seg('IEA', '1', icn);

  return segments.join('\n');
}

/**
 * Get agency provider info from environment
 */
function getProviderInfo() {
  return {
    agencyName: process.env.AGENCY_NAME || 'CHIPPEWA VALLEY HOME CARE',
    npi: process.env.AGENCY_NPI || '',
    taxId: process.env.AGENCY_TAX_ID || '',
    medicaidId: process.env.AGENCY_MEDICAID_ID || '',
    taxonomyCode: process.env.AGENCY_TAXONOMY || '374700000X',
    address: process.env.AGENCY_ADDRESS || '',
    city: process.env.AGENCY_CITY || 'EAU CLAIRE',
    state: process.env.AGENCY_STATE || 'WI',
    zip: process.env.AGENCY_ZIP || '54701',
    phone: process.env.AGENCY_PHONE || '',
    contactName: process.env.AGENCY_CONTACT || '',
    clearinghouseId: process.env.CLEARINGHOUSE_ID || '',
    clearinghouseName: process.env.CLEARINGHOUSE_NAME || '',
  };
}

module.exports = { generate837P, getProviderInfo };
