#!/usr/bin/env node

// cvhc-agent/agent.js
// CVHC Automated Claims Processing Agent
//
// Walks the full pipeline: EVV validation → authorization check → claim build →
// portal submission → response handling → escalation.
//
// Usage:
//   node cvhc-agent/agent.js              # Live mode (submits to portals)
//   node cvhc-agent/agent.js --dry-run    # Walk pipeline against real CRM data, no submissions
//   node cvhc-agent/agent.js --poll-only  # Only poll existing submitted claims for responses

const db = require('../backend/src/db');
const { v4: uuidv4 } = require('uuid');
const { setAllDryRun, resolveAdapter, listAdapters } = require('./adapters/registry');
const pipeline = require('./pipeline');
const { alertOwner, sendRunSummary } = require('./alerts');
const config = require('./config');

// ── Parse CLI flags ─────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const POLL_ONLY = args.includes('--poll-only');

// ── Stats tracking ──────────────────────────────────────────────────────────

const stats = {
  mode: DRY_RUN ? 'dry-run' : 'live',
  totalVisits: 0,
  created: 0,
  submitted: 0,
  paid: 0,
  denied: 0,
  autoCorrected: 0,
  escalated: 0,
  skipped: 0,
  timelyFilingWarnings: 0,
  authWarnings: 0,
  errors: [],
};

// ══════════════════════════════════════════════════════════════���══════════════
// MAIN AGENT LOOP
// ═════════════════════════════════════════════════════════════════════════════

async function run() {
  const startTime = Date.now();
  const modeStr = DRY_RUN ? 'DRY-RUN (no portal submissions)' : POLL_ONLY ? 'POLL-ONLY (check existing claims)' : 'LIVE';
  console.log('==========================================================');
  console.log('  CVHC Claims Processing Agent');
  console.log(`  Mode: ${modeStr}`);
  console.log(`  Started: ${new Date().toISOString()}`);
  console.log('==========================================================');
  console.log('');

  if (DRY_RUN) setAllDryRun(true);

  // Create agent run record
  let agentRunId = null;
  if (!DRY_RUN) {
    const runResult = await db.query(`
      INSERT INTO agent_claim_runs (id, mode, started_at)
      VALUES ($1, $2, NOW()) RETURNING id
    `, [uuidv4(), DRY_RUN ? 'dry-run' : 'live']);
    agentRunId = runResult.rows[0].id;
  } else {
    agentRunId = `dry-run-${Date.now().toString(36)}`;
  }

  console.log(`Agent run: ${agentRunId}\n`);

  // ── PHASE 1: Process new billable visits ────────────────────────��───────

  if (!POLL_ONLY) {
    console.log('── Phase 1: Finding billable EVV visits ────────────────────');

    let visits;
    try {
      visits = await pipeline.findBillableVisits();
    } catch (err) {
      console.error('FATAL: Could not query billable visits:', err.message);
      stats.errors.push({ stage: 'findBillableVisits', error: err.message });
      await finalize(agentRunId, startTime);
      return;
    }

    stats.totalVisits = visits.length;
    console.log(`Found ${visits.length} billable visit(s)\n`);

    for (let i = 0; i < visits.length; i++) {
      const visit = visits[i];
      const clientName = `${visit.client_first} ${visit.client_last}`;
      const prefix = `[${i + 1}/${visits.length}] ${clientName} (${visit.service_date})`;

      console.log(`${prefix}`);
      console.log(`  Payer: ${visit.payer_name || 'UNKNOWN'} (${visit.payer_type || '?'})`);

      // Stage 2: Validate EVV
      const evvResult = pipeline.validateEVV(visit);
      if (!evvResult.valid) {
        console.log(`  SKIP: EVV validation failed:`);
        evvResult.errors.forEach(e => console.log(`    - ${e}`));
        stats.skipped++;
        stats.errors.push({ visit: visit.evv_visit_id, client: clientName, stage: 'evv', errors: evvResult.errors });
        console.log('');
        continue;
      }
      if (evvResult.warnings.length > 0) {
        evvResult.warnings.forEach(w => console.log(`  WARN: ${w}`));
        if (evvResult.warnings.some(w => w.includes('Timely filing'))) {
          stats.timelyFilingWarnings++;
        }
      }

      // Stage 3: Check authorization/budget
      const authResult = pipeline.checkAuthorization(visit);
      if (!authResult.authorized) {
        console.log(`  SKIP: Authorization check failed:`);
        authResult.errors.forEach(e => console.log(`    - ${e}`));
        stats.skipped++;

        // Alert on auth issues
        if (authResult.errors.some(e => e.includes('exhausted') || e.includes('no remaining'))) {
          await alertOwner(
            `Authorization exhausted: ${clientName}`,
            `${clientName}'s authorization has no remaining units/budget. Visit on ${visit.service_date} cannot be billed.`,
            'auth_exhausted'
          );
        }

        stats.errors.push({ visit: visit.evv_visit_id, client: clientName, stage: 'auth', errors: authResult.errors });
        console.log('');
        continue;
      }
      if (authResult.warnings.length > 0) {
        authResult.warnings.forEach(w => console.log(`  WARN: ${w}`));
        stats.authWarnings += authResult.warnings.length;
      }
      console.log(`  Auth: OK (${authResult.authData.type === 'budget' ? `$${authResult.authData.remaining.toFixed(2)} remaining` : `${authResult.authData.remaining.toFixed(1)} units remaining`})`);

      // Stage 4: Build claim
      let claimResult;
      try {
        claimResult = await pipeline.buildClaim(visit, agentRunId, DRY_RUN);
      } catch (err) {
        console.log(`  ERROR building claim: ${err.message}`);
        stats.errors.push({ visit: visit.evv_visit_id, client: clientName, stage: 'build', error: err.message });
        console.log('');
        continue;
      }

      const { claim, ediContent, adapterKey } = claimResult;
      stats.created++;
      console.log(`  Claim: ${claim.claim_number} | $${claim.charge_amount.toFixed(2)} | ${claim.units} units | ${claim.procedure_code}`);

      // Stage 5: Resolve adapter and submit
      if (!adapterKey) {
        console.log(`  SKIP: No portal adapter found for payer "${visit.payer_name}" (${visit.payer_type})`);
        stats.skipped++;
        console.log('');
        continue;
      }

      const { adapter } = resolveAdapter({
        payer_type: visit.payer_type,
        name: visit.payer_name,
        payer_source: visit.payer_source,
        clearinghouse: visit.clearinghouse,
      });

      console.log(`  Adapter: ${adapter.name}`);

      // Authenticate (cached per adapter in real mode)
      try {
        await adapter.authenticate();
      } catch (err) {
        if (!DRY_RUN) {
          console.log(`  ERROR authenticating: ${err.message}`);
          stats.errors.push({ visit: visit.evv_visit_id, client: clientName, stage: 'auth_portal', error: err.message });
          console.log('');
          continue;
        }
      }

      const submitResult = await pipeline.submitClaim(claim, ediContent, adapter, visit, DRY_RUN);

      if (submitResult.submitted) {
        stats.submitted++;
        console.log(`  Submitted: ${submitResult.trackingId} (${submitResult.status})`);

        if (ediContent) {
          const ediLines = ediContent.split('\n').length;
          console.log(`  EDI 837P: ${ediLines} segments generated`);
        }
      } else {
        console.log(`  SUBMIT FAILED: ${submitResult.error}`);
        stats.errors.push({ visit: visit.evv_visit_id, client: clientName, stage: 'submit', error: submitResult.error });
      }

      console.log('');
    }
  }

  // ── PHASE 2: Poll for responses on previously submitted claims ──────────

  console.log('── Phase 2: Polling for claim responses ─────────────────────');

  const submittedClaims = await db.query(`
    SELECT c.*, rs.name AS payer_name, rs.payer_type,
      rs.payer_id_number, rs.edi_payer_id, rs.clearinghouse,
      a.payer_source,
      cl.first_name AS client_first, cl.last_name AS client_last
    FROM claims c
    LEFT JOIN referral_sources rs ON c.payer_id = rs.id
    LEFT JOIN authorizations a ON c.authorization_id = a.id
    LEFT JOIN clients cl ON c.client_id = cl.id
    WHERE c.status = 'submitted'
      AND c.portal_tracking_id IS NOT NULL
    ORDER BY c.submission_date ASC
  `);

  console.log(`Found ${submittedClaims.rows.length} submitted claim(s) to poll\n`);

  for (const claim of submittedClaims.rows) {
    const clientName = `${claim.client_first || ''} ${claim.client_last || ''}`.trim();
    console.log(`Polling: ${claim.claim_number} (${clientName}) — ${claim.payer_name}`);

    const resolution = resolveAdapter({
      payer_type: claim.payer_type,
      name: claim.payer_name,
      payer_source: claim.payer_source,
      clearinghouse: claim.clearinghouse,
    });

    if (!resolution) {
      console.log(`  SKIP: No adapter for payer\n`);
      continue;
    }

    try {
      await resolution.adapter.authenticate();
    } catch (err) {
      if (!DRY_RUN) {
        console.log(`  ERROR authenticating: ${err.message}\n`);
        continue;
      }
    }

    const response = await pipeline.handleResponse(claim, resolution.adapter, DRY_RUN);
    console.log(`  Status: ${response.status} → Action: ${response.action}`);

    switch (response.action) {
      case 'mark_paid':
        stats.paid++;
        console.log(`  PAID: $${(response.details.paidAmount || claim.charge_amount).toFixed(2)}`);
        break;

      case 'auto_correct':
        stats.autoCorrected++;
        console.log(`  AUTO-CORRECT: ${response.details.fix} (attempt ${response.details.attemptNumber})`);

        // Resubmit with correction
        if (!DRY_RUN) {
          await db.query(`
            UPDATE claims SET
              resubmit_count = resubmit_count + 1,
              status = 'pending',
              denial_code = NULL,
              denial_reason = NULL,
              updated_at = NOW()
            WHERE id = $1
          `, [claim.id]);

          await db.query(`
            INSERT INTO claim_status_history (id, claim_id, status, notes, created_by)
            VALUES ($1, $2, 'pending', $3, NULL)
          `, [uuidv4(), claim.id, `Auto-corrected: ${response.details.fix}. Resubmitting (attempt ${response.details.attemptNumber}).`]);
        }
        break;

      case 'escalate':
        stats.escalated++;
        stats.denied++;
        console.log(`  ESCALATED: ${response.details.reason}`);

        await alertOwner(
          `Claim ${claim.claim_number} denied — needs review`,
          `Client: ${clientName}\nPayer: ${claim.payer_name}\nDenial: ${response.details.denialCode} — ${response.details.denialReason}\nReason for escalation: ${response.details.reason}`,
          'escalation'
        );
        break;

      case 'wait':
        console.log('  Still pending — will check again next run');
        break;
    }

    console.log('');
  }

  // ── Finalize ────────────────��────────────────────────���────────────────────

  await finalize(agentRunId, startTime);
}

async function finalize(agentRunId, startTime) {
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

  console.log('═════════════════════════════════════════════════════��════════');
  console.log('RUN SUMMARY');
  console.log('──────────────────────────���────────────────────��──────────────');
  console.log(`  Mode:             ${stats.mode}`);
  console.log(`  Duration:         ${elapsed}s`);
  console.log(`  Visits scanned:   ${stats.totalVisits}`);
  console.log(`  Claims created:   ${stats.created}`);
  console.log(`  Claims submitted: ${stats.submitted}`);
  console.log(`  Claims paid:      ${stats.paid}`);
  console.log(`  Auto-corrected:   ${stats.autoCorrected}`);
  console.log(`  Escalated:        ${stats.escalated}`);
  console.log(`  Skipped:          ${stats.skipped}`);
  console.log(`  Errors:           ${stats.errors.length}`);
  console.log('══════════════════════════════════════════════════════════════');

  if (stats.errors.length > 0) {
    console.log('\nERROR DETAILS:');
    stats.errors.forEach((e, i) => {
      console.log(`  ${i + 1}. [${e.stage}] ${e.client || 'system'}: ${e.error || (e.errors || []).join('; ')}`);
    });
  }

  // Update agent run record
  if (!DRY_RUN && typeof agentRunId === 'string' && !agentRunId.startsWith('dry-run')) {
    await db.query(`
      UPDATE agent_claim_runs SET
        finished_at = NOW(),
        total_visits_scanned = $2,
        claims_created = $3,
        claims_submitted = $4,
        claims_denied = $5,
        claims_auto_corrected = $6,
        claims_escalated = $7,
        claims_paid = $8,
        errors = $9,
        summary = $10
      WHERE id = $1
    `, [
      agentRunId, stats.totalVisits, stats.created, stats.submitted,
      stats.denied, stats.autoCorrected, stats.escalated, stats.paid,
      JSON.stringify(stats.errors),
      `Processed ${stats.totalVisits} visits: ${stats.created} created, ${stats.submitted} submitted, ${stats.paid} paid, ${stats.escalated} escalated`,
    ]);
  }

  // Alert owner if there are issues
  await sendRunSummary(stats);

  // Clean exit
  await db.pool.end();
  console.log('\nAgent finished.');
}

// ════════════════════════��════════════════════════════════════════════════════
// ENTRY POINT
// ═════════════════════════════════════════════════════════════════════════════

run().catch(async (err) => {
  console.error('\nFATAL ERROR:', err);
  stats.errors.push({ stage: 'fatal', error: err.message });
  try {
    await sendRunSummary(stats);
    await db.pool.end();
  } catch (_) { /* ignore cleanup errors */ }
  process.exit(1);
});
