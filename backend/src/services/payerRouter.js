// services/payerRouter.js
// Payer routing engine: determines submission method and destination
// based on referral_source payer_type and payer_id_number

const { generate837P, getProviderInfo } = require('./edi837Generator');

/**
 * Wisconsin MCO/Payer routing rules:
 * - My Choice Wisconsin (MCFC-CW)  → WPS via EDI 837
 * - Inclusa                         → WPS via EDI 837
 * - Lakeland Care                   → WPS via EDI 837
 * - IRIS FEA                        → IRIS FEA export (CSV for manual upload)
 * - ForwardHealth (FFS)             → ForwardHealth EDI 837
 * - HMO                             → HMO-specific export
 * - Private Pay                     → Invoice (no claim submission)
 */

const PAYER_ROUTES = {
  // MCO Family Care payers → WPS clearinghouse
  'MCO': {
    'MCFC-CW':   { method: 'edi837', destination: 'WPS Clearinghouse', name: 'My Choice Wisconsin' },
    'INCLUSA':   { method: 'edi837', destination: 'WPS Clearinghouse', name: 'Inclusa' },
    'LAKELAND':  { method: 'edi837', destination: 'WPS Clearinghouse', name: 'Lakeland Care' },
    '_default':  { method: 'edi837', destination: 'WPS Clearinghouse', name: 'MCO' },
  },
  // MCO Family Care (alias)
  'mco_family_care': {
    '_default':  { method: 'edi837', destination: 'WPS Clearinghouse', name: 'MCO Family Care' },
  },
  // IRIS self-directed
  'IRIS': {
    '_default':  { method: 'iris_export', destination: 'IRIS FEA Portal', name: 'IRIS' },
  },
  // Fee-for-service Medicaid
  'FFS': {
    '_default':  { method: 'edi837', destination: 'ForwardHealth Direct', name: 'ForwardHealth' },
  },
  'medicaid': {
    '_default':  { method: 'edi837', destination: 'ForwardHealth Direct', name: 'ForwardHealth Medicaid' },
  },
  // HMO / Managed Care
  'HMO': {
    '_default':  { method: 'hmo_export', destination: 'HMO Portal', name: 'HMO' },
  },
  'managed_care': {
    '_default':  { method: 'edi837', destination: 'Payer Direct', name: 'Managed Care' },
  },
  // VA
  'va': {
    '_default':  { method: 'edi837', destination: 'VA Claims', name: 'Veterans Affairs' },
  },
  // Private Pay — no claim submission
  'private_pay': {
    '_default':  { method: 'invoice_only', destination: 'N/A', name: 'Private Pay' },
  },
};

/**
 * Route a claim to the correct submission method/destination
 * @param {Object} referralSource - The referral_source record (payer)
 * @returns {Object} { method, destination, payerName }
 */
function routeClaim(referralSource) {
  if (!referralSource) {
    return { method: 'manual', destination: 'Unknown', payerName: 'Unknown' };
  }

  const payerType = (referralSource.payer_type || 'other').toUpperCase();
  const payerIdNum = (referralSource.payer_id_number || '').toUpperCase();

  // Check specific payer type routes
  const typeRoutes = PAYER_ROUTES[payerType] || PAYER_ROUTES[referralSource.payer_type];

  if (typeRoutes) {
    // Check for specific payer ID match first
    const specificRoute = typeRoutes[payerIdNum];
    if (specificRoute) {
      return {
        method: specificRoute.method,
        destination: specificRoute.destination,
        payerName: specificRoute.name,
      };
    }
    // Fall back to default for this payer type
    const defaultRoute = typeRoutes['_default'];
    if (defaultRoute) {
      return {
        method: defaultRoute.method,
        destination: defaultRoute.destination,
        payerName: referralSource.name || defaultRoute.name,
      };
    }
  }

  // Check submission_method field on referral source
  if (referralSource.submission_method === 'edi') {
    return { method: 'edi837', destination: 'Clearinghouse', payerName: referralSource.name };
  }

  // MIDAS portal detection (My Choice Wisconsin via MIDAS)
  if (/my\s*choice/i.test(referralSource.name || '')) {
    return { method: 'midas_export', destination: 'MIDAS Portal', payerName: 'My Choice Wisconsin' };
  }

  // Default fallback
  return { method: 'manual', destination: 'Manual Submission', payerName: referralSource.name || 'Unknown' };
}

/**
 * Generate MIDAS upload packet CSV for My Choice Wisconsin
 * @param {Array} claims - Array of claim records
 * @param {Object} provider - Agency provider info
 * @returns {string} CSV content
 */
function generateMidasExport(claims, provider) {
  const headers = [
    'Client Name', 'Medicaid ID', 'MCO Member ID',
    'Service Date', 'Procedure Code', 'Modifier', 'Units',
    'Charge Amount', 'Provider NPI', 'Provider Medicaid ID',
    'Authorization Number', 'Rendering Provider',
  ];

  const rows = claims.map(c => [
    `${c.client_first_name || c.client_first || ''} ${c.client_last_name || c.client_last || ''}`.trim(),
    c.medicaid_id || '',
    c.mco_member_id || '',
    c.service_date ? new Date(c.service_date).toLocaleDateString('en-US') : '',
    c.procedure_code || 'T1019',
    c.modifier || '',
    c.units_billed || c.units || '',
    parseFloat(c.charge_amount || 0).toFixed(2),
    provider.npi || '',
    provider.medicaidId || '',
    c.auth_number || c.authorization_number || '',
    `${c.caregiver_first_name || c.caregiver_first || ''} ${c.caregiver_last_name || c.caregiver_last || ''}`.trim(),
  ]);

  const csvRows = [
    `"MIDAS Upload Packet - ${provider.agencyName}"`,
    `"Generated: ${new Date().toLocaleString()}"`,
    '',
    headers.map(h => `"${h}"`).join(','),
    ...rows.map(r => r.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(',')),
    '',
    `"Total Claims: ${claims.length}"`,
    `"Total Charges: $${claims.reduce((sum, c) => sum + parseFloat(c.charge_amount || 0), 0).toFixed(2)}"`,
  ];

  return csvRows.join('\n');
}

/**
 * Generate IRIS FEA export CSV
 * @param {Array} claims - Array of claim records
 * @returns {string} CSV content
 */
function generateIRISExport(claims) {
  const headers = [
    'member_id', 'worker_id', 'service_date', 'procedure_code',
    'units', 'amount', 'authorization_number', 'fea_organization',
  ];

  const rows = claims.map(c => [
    c.medicaid_id || c.mco_member_id || '',
    c.caregiver_npi || c.npi_number || c.evv_worker_id || '',
    c.service_date ? new Date(c.service_date).toISOString().split('T')[0] : '',
    c.procedure_code || 'T1019',
    c.units_billed || c.units || '',
    parseFloat(c.charge_amount || 0).toFixed(2),
    c.auth_number || c.authorization_number || '',
    c.fea_organization || '',
  ]);

  return [
    headers.join(','),
    ...rows.map(r => r.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(',')),
  ].join('\n');
}

/**
 * Generate HMO-specific export
 */
function generateHMOExport(claims, provider) {
  // Similar to MIDAS but with different format requirements
  return generateMidasExport(claims, provider);
}

module.exports = {
  routeClaim,
  generateMidasExport,
  generateIRISExport,
  generateHMOExport,
  PAYER_ROUTES,
};
