// cvhc-agent/adapters/ChangeHealthcareAdapter.js
// Change Healthcare clearinghouse — used by Inclusa (180-day filing)
// and Family Care Partnership (90-day filing, requires Medicare primary).

const BasePortalAdapter = require('./BasePortalAdapter');

class ChangeHealthcareAdapter extends BasePortalAdapter {
  constructor(mcoName, portalConfig, options = {}) {
    super(`ChangeHC/${mcoName}`, portalConfig);
    this.mcoName = options.mcoName || mcoName;
    this.timelyFilingDays = options.timelyFilingDays || 180;
    this.requiresMedicarePrimary = options.requiresMedicarePrimary || false;
    this.accessToken = null;
    this.tokenExpiry = null;
  }

  async authenticate() {
    if (this.dryRun) {
      console.log(`  [DRY-RUN] ChangeHC/${this.mcoName}: Would authenticate via OAuth2`);
      return;
    }

    // TODO: Change Healthcare OAuth2 client_credentials flow
    // POST ${this.config.baseUrl}/apip/auth/v2/token
    // Headers: Content-Type: application/json
    // Body: {
    //   client_id: this.config.clientId,
    //   client_secret: this.config.clientSecret,
    //   grant_type: 'client_credentials'
    // }
    // Response: { access_token: "...", token_type: "bearer", expires_in: 3600 }
    // this.accessToken = response.data.access_token;
    // this.tokenExpiry = Date.now() + (response.data.expires_in * 1000);

    throw new Error(`ChangeHC/${this.mcoName}: Portal credentials not configured — set CHANGE_HC_CLIENT_ID and CHANGE_HC_CLIENT_SECRET`);
  }

  async submitClaim(ediContent, metadata) {
    if (this.dryRun) return this._dryRunSubmit(metadata);

    // For FCP: verify Medicare was billed first
    if (this.requiresMedicarePrimary) {
      if (!metadata.medicarePaid) {
        return {
          trackingId: null,
          status: 'blocked',
          raw: { error: 'FCP requires Medicare to be billed primary first. Cannot submit until Medicare EOB is on file.' },
        };
      }
    }

    // TODO: Submit EDI 837P via Change Healthcare Professional Claims API
    // POST ${this.config.baseUrl}/medicalnetwork/professionalclaims/v3/submission
    // Headers: {
    //   Authorization: `Bearer ${this.accessToken}`,
    //   Content-Type: 'application/edi-x12',
    //   'X-CHC-Submitter-ID': config.agency.npi
    // }
    // Body: ediContent
    // Response: {
    //   meta: { submitterId: "...", senderId: "..." },
    //   status: "SUCCESS",
    //   controlNumber: "CHC-2026-XXXX",
    //   claimId: "chc-uuid",
    //   timestamp: "2026-04-11T12:00:00Z"
    // }
    // Return: { trackingId: response.claimId, status: 'submitted', raw: response }

    throw new Error(`ChangeHC/${this.mcoName}: submitClaim() not yet connected — see TODO above`);
  }

  async checkClaimStatus(trackingId) {
    if (this.dryRun) return this._dryRunStatus(trackingId);

    // TODO: Poll Change Healthcare Claim Status API
    // GET ${this.config.baseUrl}/medicalnetwork/professionalclaims/v3/${trackingId}/status
    // Headers: { Authorization: `Bearer ${this.accessToken}` }
    // Response: {
    //   claimStatus: { status: "A" | "R" | "P" | "F" },
    //   // A=Accepted, R=Rejected, P=Pending, F=Finalized (paid)
    //   payment: { paidAmount: 45.00, checkNumber: "CHC-12345" },
    //   adjustments: [{ reasonCode: "CO-45", amount: 5.00 }]
    // }
    // Map: A→accepted, R→denied, P→pending, F→paid

    throw new Error(`ChangeHC/${this.mcoName}: checkClaimStatus() not yet connected — see TODO above`);
  }

  checkAutoCorrectableDenial(denialCode, claim) {
    // FCP-specific: if denied for "other payer primary", check Medicare billing
    if (this.requiresMedicarePrimary && denialCode === 'CO-22') {
      return {
        correctable: false, // can't auto-correct — need Medicare EOB
        fix: 'Bill Medicare first, then resubmit with Medicare EOB attached',
        correctedFields: null,
      };
    }

    return super.checkAutoCorrectableDenial(denialCode, claim);
  }
}

module.exports = ChangeHealthcareAdapter;
