// cvhc-agent/adapters/ForwardHealthAdapter.js
// ForwardHealth / Midas — Wisconsin Medicaid fee-for-service.
// Claims go direct to the ForwardHealth interChange as EDI 837P.
// Prior auths live in the ForwardHealth PA system. Timely filing: 365 days.

const BasePortalAdapter = require('./BasePortalAdapter');

class ForwardHealthAdapter extends BasePortalAdapter {
  constructor(portalConfig) {
    super('ForwardHealth', portalConfig);
    this.timelyFilingDays = 365;
    this.sessionToken = null;
  }

  async authenticate() {
    if (this.dryRun) {
      console.log('  [DRY-RUN] ForwardHealth: Would authenticate via interChange portal');
      return;
    }

    // TODO: Implement ForwardHealth interChange authentication
    // POST ${this.config.interchangeUrl}/auth/login
    // Headers: Content-Type: application/x-www-form-urlencoded
    // Body: { username: this.config.username, password: this.config.password }
    // Response: { sessionToken: "...", expiresIn: 3600 }
    // this.sessionToken = response.data.sessionToken;

    throw new Error('ForwardHealth: Portal credentials not configured — set FORWARDHEALTH_USERNAME and FORWARDHEALTH_PASSWORD');
  }

  async submitClaim(ediContent, metadata) {
    if (this.dryRun) return this._dryRunSubmit(metadata);

    // TODO: Submit EDI 837P to ForwardHealth interChange
    // POST ${this.config.interchangeUrl}/edi/submit
    // Headers: {
    //   Authorization: `Bearer ${this.sessionToken}`,
    //   Content-Type: 'application/edi-x12',
    //   'X-Transaction-Type': '837P',
    //   'X-Submitter-ID': config.agency.medicaidId
    // }
    // Body: ediContent (raw EDI string)
    // Response: {
    //   transactionId: "FH-2026-XXXXX",
    //   status: "received",
    //   acknowledgement: { accepted: true, errors: [] }
    // }

    throw new Error('ForwardHealth: submitClaim() not yet connected — see TODO above');
  }

  async checkClaimStatus(trackingId) {
    if (this.dryRun) return this._dryRunStatus(trackingId);

    // TODO: Poll ForwardHealth for claim adjudication
    // GET ${this.config.interchangeUrl}/edi/status/${trackingId}
    // Headers: { Authorization: `Bearer ${this.sessionToken}` }
    // Response: {
    //   status: "adjudicated" | "pending" | "denied",
    //   paidAmount: 45.00,
    //   allowedAmount: 45.00,
    //   denialCode: null,
    //   denialReason: null,
    //   eobDate: "2026-04-15",
    //   checkNumber: "FH-CHK-12345"
    // }
    // Map to normalized response:
    //   "adjudicated" → "paid", "denied" → "denied", else "pending"

    throw new Error('ForwardHealth: checkClaimStatus() not yet connected — see TODO above');
  }

  checkAutoCorrectableDenial(denialCode, claim) {
    // ForwardHealth-specific auto-corrections
    const fhFixes = {
      'CO-197': {
        correctable: true,
        fix: 'Attach ForwardHealth PA number from authorizations table',
        correctedFields: { auth_number: 'lookup-from-auth' },
      },
      'CO-109': {
        correctable: false,
        fix: null,
        correctedFields: null,
      },
    };

    if (fhFixes[denialCode]) return fhFixes[denialCode];
    return super.checkAutoCorrectableDenial(denialCode, claim);
  }
}

module.exports = ForwardHealthAdapter;
