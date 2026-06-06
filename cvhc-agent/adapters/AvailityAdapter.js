// cvhc-agent/adapters/AvailityAdapter.js
// Availity clearinghouse adapter — used by iCare and Lakeland Care MCOs.
// iCare: 90-day timely filing. Lakeland Care: 90-day timely filing.
// My Choice Wisconsin also routes through iCare/Availity.

const BasePortalAdapter = require('./BasePortalAdapter');

class AvailityAdapter extends BasePortalAdapter {
  constructor(mcoName, portalConfig, options = {}) {
    super(`Availity/${mcoName}`, portalConfig);
    this.mcoName = options.mcoName || mcoName;
    this.timelyFilingDays = options.timelyFilingDays || 90;
    this.accessToken = null;
    this.tokenExpiry = null;
  }

  async authenticate() {
    if (this.dryRun) {
      console.log(`  [DRY-RUN] Availity/${this.mcoName}: Would authenticate via OAuth2`);
      return;
    }

    // TODO: Availity OAuth2 client_credentials flow
    // POST https://api.availity.com/availity/v1/token
    // Headers: Content-Type: application/x-www-form-urlencoded
    // Body: {
    //   grant_type: 'client_credentials',
    //   client_id: this.config.clientId,
    //   client_secret: this.config.clientSecret,
    //   scope: 'hipaa'
    // }
    // Response: { access_token: "...", token_type: "Bearer", expires_in: 3600 }
    // this.accessToken = response.data.access_token;
    // this.tokenExpiry = Date.now() + (response.data.expires_in * 1000);

    throw new Error(`Availity/${this.mcoName}: Portal credentials not configured — set AVAILITY_CLIENT_ID and AVAILITY_CLIENT_SECRET`);
  }

  async submitClaim(ediContent, metadata) {
    if (this.dryRun) return this._dryRunSubmit(metadata);

    // TODO: Submit EDI 837P via Availity Claims API
    // POST ${this.config.baseUrl}/claims/submit
    // Headers: {
    //   Authorization: `Bearer ${this.accessToken}`,
    //   Content-Type: 'application/edi-x12',
    //   'Availity-Customer-ID': config.agency.npi,
    //   'X-Payer-ID': metadata.payerEdiId
    // }
    // Body: ediContent
    // Response: {
    //   id: "avl-claim-uuid",
    //   status: "received",
    //   statusCode: "A1",
    //   claimReference: "AVL-2026-XXXX",
    //   timestamp: "2026-04-11T12:00:00Z"
    // }
    // Return: { trackingId: response.id, status: 'submitted', raw: response }

    throw new Error(`Availity/${this.mcoName}: submitClaim() not yet connected — see TODO above`);
  }

  async checkClaimStatus(trackingId) {
    if (this.dryRun) return this._dryRunStatus(trackingId);

    // TODO: Poll Availity Claim Status API
    // GET ${this.config.baseUrl}/claims/${trackingId}/status
    // Headers: { Authorization: `Bearer ${this.accessToken}` }
    // Response: {
    //   status: "accepted" | "rejected" | "paid" | "denied" | "pending",
    //   paidAmount: 45.00,
    //   allowedAmount: 45.00,
    //   patientResponsibility: 0,
    //   adjustmentCodes: [{ code: "CO-45", amount: 5.00 }],
    //   checkNumber: "MCO-CHK-12345",
    //   eobDate: "2026-04-18"
    // }
    // Normalize: map adjustmentCodes[0].code to denialCode if status === 'denied'

    throw new Error(`Availity/${this.mcoName}: checkClaimStatus() not yet connected — see TODO above`);
  }

  checkAutoCorrectableDenial(denialCode, claim) {
    // MCO-specific: CO-22 (coordination of benefits) is common when
    // the MCO thinks another payer is primary
    const mcoFixes = {
      'CO-22': {
        correctable: true,
        fix: 'Resubmit with coordination of benefits info — confirm this MCO is primary',
        correctedFields: { sbr_sequence: 'P' },
      },
    };

    if (mcoFixes[denialCode]) return mcoFixes[denialCode];
    return super.checkAutoCorrectableDenial(denialCode, claim);
  }
}

module.exports = AvailityAdapter;
