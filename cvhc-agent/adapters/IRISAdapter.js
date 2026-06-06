// cvhc-agent/adapters/IRISAdapter.js
// IRIS self-directed Medicaid waiver adapter.
// Billing goes to the IRIS Fiscal Agent (PPL — Public Partnerships LLC).
// No prior auth number — clients have a service plan with a dollar budget per service type.
// Timely filing: 90 days (strict). Start warning at 75 days.

const BasePortalAdapter = require('./BasePortalAdapter');

class IRISAdapter extends BasePortalAdapter {
  constructor(portalConfig) {
    super('IRIS/PPL', portalConfig);
    this.timelyFilingDays = 90;
    this.warnAtDays = 75;
    this.sessionCookie = null;
  }

  async authenticate() {
    if (this.dryRun) {
      console.log('  [DRY-RUN] IRIS/PPL: Would authenticate via PPL FMS portal');
      return;
    }

    // TODO: Authenticate with PPL Financial Management Services portal
    // POST ${this.config.baseUrl}/api/auth/login
    // Headers: Content-Type: application/json
    // Body: {
    //   username: this.config.username,
    //   password: this.config.password,
    //   organizationId: config.agency.medicaidId
    // }
    // Response: Set-Cookie header with session token
    // this.sessionCookie = response.headers['set-cookie'];

    throw new Error('IRIS/PPL: Portal credentials not configured — set IRIS_PPL_USERNAME and IRIS_PPL_PASSWORD');
  }

  /**
   * IRIS claims don't use EDI 837P — they use a PPL-specific format.
   * The ediContent param is ignored; we build from the claim metadata directly.
   */
  async submitClaim(ediContent, metadata) {
    if (this.dryRun) {
      console.log(`  [DRY-RUN] IRIS/PPL: Would submit service claim for ${metadata.clientName}`);
      console.log(`    Service: ${metadata.procedureCode || 'T1019'}, Units: ${metadata.units}, Amount: $${metadata.chargeAmount}`);
      console.log(`    Budget check: $${metadata.budgetRemaining || '?'} remaining of $${metadata.budgetTotal || '?'}`);
      return {
        trackingId: `DRY-IRIS-${Date.now().toString(36)}`,
        status: 'dry-run-accepted',
        raw: { dryRun: true, adapter: this.name, metadata },
      };
    }

    // TODO: Submit claim to PPL FMS portal
    // POST ${this.config.baseUrl}/api/claims/submit
    // Headers: {
    //   Cookie: this.sessionCookie,
    //   Content-Type: 'application/json'
    // }
    // Body: {
    //   participantId: metadata.medicaidId,       // client's Medicaid ID
    //   providerId: config.agency.medicaidId,       // agency provider ID
    //   workerName: metadata.caregiverName,
    //   serviceCode: metadata.procedureCode || 'T1019',
    //   serviceDate: metadata.serviceDate,          // YYYY-MM-DD
    //   units: metadata.units,
    //   rate: metadata.ratePerUnit,
    //   totalAmount: metadata.chargeAmount,
    //   servicePlanId: metadata.servicePlanId,       // IRIS service plan reference
    //   budgetCategory: metadata.budgetCategory || 'Supportive Home Care'
    // }
    // Response: {
    //   claimId: "PPL-2026-XXXX",
    //   status: "submitted",
    //   budgetImpact: { remaining: 1200.00, used: 4800.00, total: 6000.00 }
    // }

    throw new Error('IRIS/PPL: submitClaim() not yet connected — see TODO above');
  }

  async checkClaimStatus(trackingId) {
    if (this.dryRun) return this._dryRunStatus(trackingId);

    // TODO: Poll PPL claim status
    // GET ${this.config.baseUrl}/api/claims/${trackingId}/status
    // Headers: { Cookie: this.sessionCookie }
    // Response: {
    //   status: "approved" | "pending" | "denied" | "returned",
    //   paidAmount: 45.00,
    //   denialReason: null,
    //   processedDate: "2026-04-15"
    // }
    // Map: "approved"→"paid", "returned"→"denied", else→"pending"

    throw new Error('IRIS/PPL: checkClaimStatus() not yet connected — see TODO above');
  }

  /**
   * IRIS budget check — replaces traditional auth check.
   * @param {Object} claim - { charge_amount }
   * @param {Object} auth - { budget_amount, budget_used }
   * @returns {{ withinBudget: boolean, remaining: number, warnings: string[] }}
   */
  checkBudget(claim, auth) {
    const warnings = [];
    const budgetTotal = parseFloat(auth.budget_amount || 0);
    const budgetUsed = parseFloat(auth.budget_used || 0);
    const claimAmount = parseFloat(claim.charge_amount || 0);
    const remaining = budgetTotal - budgetUsed;

    if (remaining <= 0) {
      return { withinBudget: false, remaining: 0, warnings: ['IRIS budget fully exhausted. Contact IRIS consultant for budget adjustment.'] };
    }

    if (claimAmount > remaining) {
      return { withinBudget: false, remaining, warnings: [`Claim $${claimAmount.toFixed(2)} exceeds remaining budget $${remaining.toFixed(2)}.`] };
    }

    if (remaining < budgetTotal * 0.1) {
      warnings.push(`IRIS budget below 10%: $${remaining.toFixed(2)} of $${budgetTotal.toFixed(2)} remaining.`);
    }

    return { withinBudget: true, remaining, warnings };
  }

  checkAutoCorrectableDenial(denialCode, claim) {
    // IRIS-specific: most denials require human review because PPL
    // uses non-standard denial codes
    const irisFixes = {
      'INVALID_SVC_CODE': {
        correctable: true,
        fix: 'Map to correct IRIS service code from service plan',
        correctedFields: { procedure_code: 'remap' },
      },
      'BUDGET_EXCEEDED': {
        correctable: false,
        fix: null,
        correctedFields: null,
      },
    };

    if (irisFixes[denialCode]) return irisFixes[denialCode];
    return super.checkAutoCorrectableDenial(denialCode, claim);
  }
}

module.exports = IRISAdapter;
