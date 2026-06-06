// cvhc-agent/adapters/BasePortalAdapter.js
// Abstract base class for all payer portal adapters.
// Each payer extends this and implements the portal-specific HTTP calls.

const axios = require('axios');

class BasePortalAdapter {
  constructor(name, config = {}) {
    this.name = name;
    this.config = config;
    this.dryRun = false;
    this._httpClient = null;
  }

  /** Set dry-run mode — all portal calls are stubbed */
  setDryRun(enabled) {
    this.dryRun = enabled;
    return this;
  }

  /** Lazy-init HTTP client (adapters override baseURL/headers) */
  get http() {
    if (!this._httpClient) {
      this._httpClient = axios.create({
        baseURL: this.config.baseUrl || '',
        timeout: 60000,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    return this._httpClient;
  }

  // ── Methods every adapter must implement ──────────────────────────────────

  /**
   * Authenticate with the portal and store session/token.
   * @returns {Promise<void>}
   */
  async authenticate() {
    throw new Error(`${this.name}: authenticate() not implemented`);
  }

  /**
   * Submit an EDI 837P claim payload to the portal.
   * @param {string} ediContent - The EDI 837P file content
   * @param {Object} metadata - { claimId, claimNumber, clientName, payerName }
   * @returns {Promise<{ trackingId: string, status: string, raw: Object }>}
   */
  async submitClaim(ediContent, metadata) {
    throw new Error(`${this.name}: submitClaim() not implemented`);
  }

  /**
   * Poll for a claim response/adjudication.
   * @param {string} trackingId - The portal tracking ID from submitClaim
   * @returns {Promise<{ status: string, paidAmount: number|null, denialCode: string|null, denialReason: string|null, raw: Object }>}
   *   status: 'pending' | 'accepted' | 'paid' | 'denied' | 'rejected'
   */
  async checkClaimStatus(trackingId) {
    throw new Error(`${this.name}: checkClaimStatus() not implemented`);
  }

  /**
   * Check if a denial is auto-correctable.
   * @param {string} denialCode
   * @param {Object} claim - The claim record
   * @returns {{ correctable: boolean, fix: string|null, correctedFields: Object|null }}
   */
  checkAutoCorrectableDenial(denialCode, claim) {
    // Default auto-corrections common across payers
    const autoFixes = {
      'CO-4':   { fix: 'Add missing modifier from authorization', field: 'modifier' },
      'CO-16':  { fix: 'Populate missing member ID', field: 'medicaid_id' },
      'CO-197': { fix: 'Attach prior authorization number', field: 'auth_number' },
      'CO-252': { fix: 'Verify auth dates and resubmit with correct service date range', field: 'service_date' },
    };

    const autoFix = autoFixes[denialCode];
    if (!autoFix) {
      return { correctable: false, fix: null, correctedFields: null };
    }

    return {
      correctable: true,
      fix: autoFix.fix,
      correctedFields: { [autoFix.field]: `auto-corrected` },
    };
  }

  // ── Dry-run helpers ───────────────────────────────────────────────────────

  /** Standard dry-run response for submitClaim */
  _dryRunSubmit(metadata) {
    console.log(`  [DRY-RUN] ${this.name}: Would submit claim ${metadata.claimNumber} for ${metadata.clientName}`);
    return {
      trackingId: `DRY-${Date.now().toString(36)}`,
      status: 'dry-run-accepted',
      raw: { dryRun: true, adapter: this.name, metadata },
    };
  }

  /** Standard dry-run response for checkClaimStatus */
  _dryRunStatus(trackingId) {
    console.log(`  [DRY-RUN] ${this.name}: Would poll status for ${trackingId}`);
    return {
      status: 'dry-run-pending',
      paidAmount: null,
      denialCode: null,
      denialReason: null,
      raw: { dryRun: true },
    };
  }
}

module.exports = BasePortalAdapter;
