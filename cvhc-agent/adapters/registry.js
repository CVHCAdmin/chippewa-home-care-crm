// cvhc-agent/adapters/registry.js
// Payer adapter registry. Maps payer_type + payer name patterns to the correct adapter.
// Adding a new payer = new adapter file + one line here.

const ForwardHealthAdapter = require('./ForwardHealthAdapter');
const AvailityAdapter = require('./AvailityAdapter');
const ChangeHealthcareAdapter = require('./ChangeHealthcareAdapter');
const IRISAdapter = require('./IRISAdapter');
const config = require('../config');

// ── Singleton adapter instances ─────────────────────────────────────────────

const adapters = {
  forwardhealth: new ForwardHealthAdapter(config.portals.forwardHealth),
  icare:         new AvailityAdapter('iCare', config.portals.availity, { mcoName: 'iCare', timelyFilingDays: 90 }),
  lakeland:      new AvailityAdapter('Lakeland Care', config.portals.availity, { mcoName: 'Lakeland Care', timelyFilingDays: 90 }),
  inclusa:       new ChangeHealthcareAdapter('Inclusa', config.portals.changeHealthcare, { mcoName: 'Inclusa', timelyFilingDays: 180 }),
  fcp:           new ChangeHealthcareAdapter('Family Care Partnership', config.portals.changeHealthcare, { mcoName: 'FCP', timelyFilingDays: 90, requiresMedicarePrimary: true }),
  iris:          new IRISAdapter(config.portals.irisPPL),
};

// ── Pattern matching for payer resolution ───────────────────────────────────

const PAYER_PATTERNS = [
  { test: (pt, name) => pt === 'medicaid' || pt === 'FFS' || /forwardhealth/i.test(name), key: 'forwardhealth' },
  { test: (pt, name) => /icare/i.test(name),                                              key: 'icare' },
  { test: (pt, name) => /lakeland/i.test(name),                                           key: 'lakeland' },
  { test: (pt, name) => /inclusa/i.test(name),                                            key: 'inclusa' },
  { test: (pt, name) => /family care partnership|fcp/i.test(name),                         key: 'fcp' },
  { test: (pt, name) => pt === 'IRIS' || /iris/i.test(name),                               key: 'iris' },
  // My Choice Wisconsin routes to iCare adapter (same Availity clearinghouse)
  { test: (pt, name) => /my\s*choice/i.test(name),                                        key: 'icare' },
  // Generic MCO fallback — route to iCare/Availity as most common
  { test: (pt, name) => pt === 'MCO' || pt === 'mco_family_care',                         key: 'icare' },
];

/**
 * Resolve the correct portal adapter for a given payer.
 * @param {Object} payer - { payer_type, name, payer_source, clearinghouse }
 * @returns {{ adapter: BasePortalAdapter, key: string } | null}
 */
function resolveAdapter(payer) {
  if (!payer) return null;

  const pt = (payer.payer_type || '').trim();
  const name = (payer.name || '').trim();

  // If the payer has payer_source set explicitly (from authorizations table), use it
  if (payer.payer_source && adapters[payer.payer_source]) {
    return { adapter: adapters[payer.payer_source], key: payer.payer_source };
  }

  for (const pattern of PAYER_PATTERNS) {
    if (pattern.test(pt, name)) {
      return { adapter: adapters[pattern.key], key: pattern.key };
    }
  }

  return null;
}

/**
 * Set dry-run mode on all adapters
 */
function setAllDryRun(enabled) {
  for (const adapter of Object.values(adapters)) {
    adapter.setDryRun(enabled);
  }
}

/**
 * List all registered adapter keys
 */
function listAdapters() {
  return Object.keys(adapters);
}

module.exports = { resolveAdapter, setAllDryRun, listAdapters, adapters };
