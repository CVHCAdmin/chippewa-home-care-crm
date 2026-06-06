#!/usr/bin/env node

// cvhc-agent/renewal-agent.js
// CVHC Authorization Renewal Monitoring Agent
//
// Upstream dependency for the claims pipeline — if authorizations expire
// unnoticed, claims start failing with N657 denials.
//
// Usage:
//   node cvhc-agent/renewal-agent.js              # Live mode
//   node cvhc-agent/renewal-agent.js --dry-run    # Check auths without sending notices
//
// Designed to run nightly via cron or on demand.

const db = require('../backend/src/db');
const { v4: uuidv4 } = require('uuid');
const { resolveAdapter } = require('./adapters/registry');
const { alertOwner } = require('./alerts');
const config = require('./config');
const { sendEmail } = require('../backend/src/services/emailService');

// ── Parse CLI flags ─────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');

// ── Stats ───────────────────────────────────────────────────────────────────

const stats = {
  mode: DRY_RUN ? 'dry-run' : 'live',
  authsScanned: 0,
  warnings: 0,
  urgents: 0,
  criticals: 0,
  renewalsInitiated: 0,
  irisConsultantsNotified: 0,
  skippedDedup: 0,
  errors: [],
};

// ═════════════════════════════════════════════════════════════════════════════
// QUERY: Find at-risk authorizations
// ═════════════════════════════════════════════════════════════════════════════

async function findAtRiskAuths() {
  // Find auths that are:
  //   - Active status
  //   - Expiring within 90 days (covers the widest IRIS window), OR
  //   - Less than 20% of units/budget remaining
  const result = await db.query(`
    SELECT
      a.id, a.client_id, a.payer_id, a.auth_number,
      a.procedure_code, a.modifier,
      a.authorized_units, a.used_units, a.unit_type,
      a.budget_amount, a.budget_used, a.budget_type,
      a.start_date, a.end_date, a.plan_year_end,
      a.status, a.payer_source, a.renewal_status,
      a.iris_consultant_name, a.iris_consultant_email, a.iris_consultant_agency,
      a.low_units_alert_threshold,
      c.first_name AS client_first, c.last_name AS client_last,
      c.medicaid_id, c.mco_member_id,
      rs.name AS payer_name, rs.payer_type,
      rs.payer_id_number, rs.requires_medicare_primary
    FROM authorizations a
    JOIN clients c ON a.client_id = c.id
    LEFT JOIN referral_sources rs ON a.payer_id = rs.id
    WHERE a.status = 'active'
      AND (
        -- Expiring within 90 days
        a.end_date <= CURRENT_DATE + INTERVAL '90 days'
        -- OR IRIS plan year ending within 90 days
        OR a.plan_year_end <= CURRENT_DATE + INTERVAL '90 days'
        -- OR less than 20% of units remaining
        OR (a.authorized_units > 0 AND (a.authorized_units - COALESCE(a.used_units, 0)) / a.authorized_units < 0.20)
        -- OR less than 20% of budget remaining (IRIS)
        OR (a.budget_amount > 0 AND (a.budget_amount - COALESCE(a.budget_used, 0)) / a.budget_amount < 0.20)
      )
    ORDER BY a.end_date ASC NULLS LAST
  `);

  return result.rows;
}

// ═════════════════════════════════════════════════════════════════════════════
// DEDUP: Check if we already sent a notice for this auth recently
// ═════════════════════════════════════════════════════════════════════════════

async function wasRecentlyNotified(authId, noticeType) {
  const result = await db.query(`
    SELECT id FROM renewal_notices
    WHERE auth_id = $1
      AND notice_type = $2
      AND notified_at > NOW() - INTERVAL '${config.renewalDedupDays} days'
    LIMIT 1
  `, [authId, noticeType]);

  return result.rows.length > 0;
}

// ═════════════════════════════════════════════════════════════════════════════
// CLASSIFY: Determine severity and payer-specific action
// ═════════════════════════════════════════════════════════════════════════════

function classifyAuth(auth) {
  const now = new Date();
  const endDate = new Date(auth.plan_year_end || auth.end_date);
  const daysUntilExpiry = Math.ceil((endDate - now) / 86400000);

  // Calculate unit/budget remaining percentage
  let unitsRemainingPct = null;
  let budgetRemainingPct = null;

  const authorizedUnits = parseFloat(auth.authorized_units || 0);
  const usedUnits = parseFloat(auth.used_units || 0);
  if (authorizedUnits > 0) {
    unitsRemainingPct = ((authorizedUnits - usedUnits) / authorizedUnits) * 100;
  }

  const budgetAmount = parseFloat(auth.budget_amount || 0);
  const budgetUsed = parseFloat(auth.budget_used || 0);
  if (budgetAmount > 0) {
    budgetRemainingPct = ((budgetAmount - budgetUsed) / budgetAmount) * 100;
  }

  // Resolve payer key
  const payerKey = resolvePayerKey(auth);
  const leadTimes = config.renewalLeadTimes[payerKey] || config.renewalLeadTimes.forwardhealth;

  // Determine notice type based on days and usage
  let noticeType = 'warning';
  if (daysUntilExpiry <= leadTimes.criticalDays || unitsRemainingPct <= 5 || budgetRemainingPct <= 5) {
    noticeType = 'critical';
  } else if (daysUntilExpiry <= leadTimes.urgentDays || unitsRemainingPct <= 10 || budgetRemainingPct <= 10) {
    noticeType = 'urgent';
  }

  // Determine trigger reason
  const triggers = [];
  if (daysUntilExpiry <= 90) triggers.push(`expires in ${daysUntilExpiry} days`);
  if (unitsRemainingPct !== null && unitsRemainingPct < 20) triggers.push(`${unitsRemainingPct.toFixed(1)}% units remaining`);
  if (budgetRemainingPct !== null && budgetRemainingPct < 20) triggers.push(`${budgetRemainingPct.toFixed(1)}% budget remaining`);

  return {
    payerKey,
    noticeType,
    daysUntilExpiry,
    unitsRemainingPct,
    budgetRemainingPct,
    triggers,
    isIRIS: payerKey === 'iris',
    isFCP: payerKey === 'fcp',
  };
}

function resolvePayerKey(auth) {
  // Use explicit payer_source if set
  if (auth.payer_source) return auth.payer_source;

  // Resolve from payer info
  const resolution = resolveAdapter({
    payer_type: auth.payer_type,
    name: auth.payer_name,
  });

  return resolution ? resolution.key : 'forwardhealth';
}

// ═════════════════════════════════════════════════════════════════════════════
// ACTIONS: Payer-specific renewal handling
// ═════════════════════════════════════════════════════════════════════════════

async function handleForwardHealthRenewal(auth, classification) {
  const clientName = `${auth.client_first} ${auth.client_last}`;
  const { noticeType, daysUntilExpiry, triggers } = classification;

  // ForwardHealth PA renewals: notify Alexis with PA details
  const message = [
    `ForwardHealth PA Renewal Needed — ${noticeType.toUpperCase()}`,
    ``,
    `Client: ${clientName} (Medicaid: ${auth.medicaid_id || 'N/A'})`,
    `PA Number: ${auth.auth_number || 'N/A'}`,
    `Service Code: ${auth.procedure_code || 'T1019'}`,
    `Expires: ${auth.end_date} (${daysUntilExpiry} days)`,
    `Units: ${parseFloat(auth.used_units || 0).toFixed(1)} / ${parseFloat(auth.authorized_units || 0).toFixed(1)} used`,
    `Trigger: ${triggers.join(', ')}`,
    ``,
    `Action: Submit PA renewal through ForwardHealth interChange portal.`,
    `Portal: https://www.forwardhealth.wi.gov/interChange`,
  ].join('\n');

  if (!DRY_RUN) {
    await alertOwner(`PA Renewal: ${clientName}`, message, 'auth_renewal');
  }

  return `Notified admins — ForwardHealth PA renewal needed (${noticeType})`;
}

async function handleMCORenewal(auth, classification) {
  const clientName = `${auth.client_first} ${auth.client_last}`;
  const { payerKey, noticeType, daysUntilExpiry, triggers } = classification;

  const mcoName = {
    icare: 'iCare', inclusa: 'Inclusa',
    lakeland: 'Lakeland Care', fcp: 'Family Care Partnership',
  }[payerKey] || auth.payer_name;

  const renewalLink = config.mcoRenewalLinks[payerKey] || 'Contact MCO directly';
  const leadTime = config.renewalLeadTimes[payerKey];

  let fpcNote = '';
  if (classification.isFCP) {
    fpcNote = '\n** FCP dual-eligible: Check if Medicare reauthorization is also needed. **';
  }

  const message = [
    `${mcoName} Auth Renewal Needed — ${noticeType.toUpperCase()}`,
    ``,
    `Client: ${clientName} (Member: ${auth.mco_member_id || auth.medicaid_id || 'N/A'})`,
    `Auth Number: ${auth.auth_number || 'N/A'}`,
    `Service Code: ${auth.procedure_code || 'T1019'}`,
    `Expires: ${auth.end_date} (${daysUntilExpiry} days)`,
    `Units: ${parseFloat(auth.used_units || 0).toFixed(1)} / ${parseFloat(auth.authorized_units || 0).toFixed(1)} used`,
    `Trigger: ${triggers.join(', ')}`,
    `MCO Lead Time: ${leadTime.urgentDays} days minimum`,
    fpcNote,
    ``,
    `Action: Submit renewal request to ${mcoName}.`,
    `Renewal Form: ${renewalLink}`,
  ].join('\n');

  if (!DRY_RUN) {
    await alertOwner(`${mcoName} Auth Renewal: ${clientName}`, message, 'auth_renewal');
  }

  return `Notified admins — ${mcoName} auth renewal needed (${noticeType})`;
}

async function handleIRISRenewal(auth, classification) {
  const clientName = `${auth.client_first} ${auth.client_last}`;
  const { noticeType, daysUntilExpiry, triggers, budgetRemainingPct } = classification;

  const budgetTotal = parseFloat(auth.budget_amount || 0);
  const budgetUsed = parseFloat(auth.budget_used || 0);
  const budgetRemaining = budgetTotal - budgetUsed;
  const planYearEnd = auth.plan_year_end || auth.end_date;

  // Build admin notification
  const adminMessage = [
    `IRIS Plan Renewal Needed — ${noticeType.toUpperCase()}`,
    ``,
    `Client: ${clientName} (Medicaid: ${auth.medicaid_id || 'N/A'})`,
    `Plan Year Ends: ${planYearEnd} (${daysUntilExpiry} days)`,
    `Budget: $${budgetUsed.toFixed(2)} / $${budgetTotal.toFixed(2)} used ($${budgetRemaining.toFixed(2)} remaining)`,
    `Trigger: ${triggers.join(', ')}`,
    ``,
    `IRIS Consultant: ${auth.iris_consultant_name || 'Not on file'}`,
    `Consultant Agency: ${auth.iris_consultant_agency || 'Not on file'}`,
    `Consultant Email: ${auth.iris_consultant_email || 'Not on file'}`,
    ``,
    `Action: IRIS plan renewal requires a planning meeting between the client`,
    `and their IRIS consultant. This needs at least 60 days lead time.`,
    auth.iris_consultant_email
      ? `Consultant notification has been auto-sent.`
      : `** No consultant email on file — please notify manually. **`,
  ].join('\n');

  if (!DRY_RUN) {
    await alertOwner(`IRIS Plan Renewal: ${clientName}`, adminMessage, 'iris_renewal');
  }

  // Send consultant notification if email is on file
  let consultantNotified = false;
  if (auth.iris_consultant_email && !DRY_RUN) {
    try {
      const bodyLines = [
        `Hello ${auth.iris_consultant_name || 'IRIS Consultant'},`,
        ``,
        `This is an automated notice from Chippewa Valley Home Care regarding an upcoming IRIS service plan renewal.`,
        ``,
        `Client: ${clientName}`,
        `Medicaid ID: ${auth.medicaid_id || 'N/A'}`,
        `Current Plan Year End: ${planYearEnd}`,
        `Days Until Expiration: ${daysUntilExpiry}`,
        `Budget Status: $${budgetRemaining.toFixed(2)} remaining of $${budgetTotal.toFixed(2)}`,
        ``,
        `A planning meeting with the client will need to be scheduled to renew the service plan.`,
        `We recommend scheduling this within the next ${Math.min(daysUntilExpiry, 30)} days to avoid a gap in services.`,
        ``,
        `Please contact us if you have questions or need additional documentation.`,
        ``,
        `Thank you,`,
        `${config.agency.name}`,
        `${config.agency.phone}`,
      ];
      const html = `<div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;font-size:0.95rem;line-height:1.5;color:#222;">${
        bodyLines.map(l => l === '' ? '<br>' : `<div>${l}</div>`).join('')
      }</div>`;
      const sent = await sendEmail({
        to: auth.iris_consultant_email,
        subject: `IRIS Service Plan Renewal Needed — ${clientName}`,
        html,
      });
      consultantNotified = !!sent;
    } catch (err) {
      console.error(`  Failed to email IRIS consultant ${auth.iris_consultant_email}:`, err.message);
    }
  }

  const action = consultantNotified
    ? `Notified admins + emailed IRIS consultant (${auth.iris_consultant_email})`
    : `Notified admins — IRIS plan renewal needed (consultant ${auth.iris_consultant_email ? 'email failed' : 'not on file'})`;

  return { action, consultantNotified };
}

// ═════════════════════════════════════════════════════════════════════════════
// LOG: Record renewal notice
// ═════════════════════════════════════════════════════════════════════════════

async function logRenewalNotice(auth, classification, actionTaken, consultantNotified = false) {
  if (DRY_RUN) return;

  await db.query(`
    INSERT INTO renewal_notices (
      id, auth_id, notice_type, payer_source,
      days_until_expiry, units_remaining_pct, budget_remaining_pct,
      action_taken, consultant_notified, consultant_email, notified_at
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW())
  `, [
    uuidv4(), auth.id, classification.noticeType, classification.payerKey,
    classification.daysUntilExpiry,
    classification.unitsRemainingPct,
    classification.budgetRemainingPct,
    actionTaken, consultantNotified,
    auth.iris_consultant_email || null,
  ]);

  // Update renewal_status on the authorization
  const newStatus = classification.noticeType === 'critical' ? 'renewal_requested' : 'notice_sent';
  await db.query(`
    UPDATE authorizations SET
      renewal_status = CASE WHEN renewal_status = 'renewed' THEN 'renewed' ELSE $1 END,
      updated_at = NOW()
    WHERE id = $2
  `, [newStatus, auth.id]);
}

// ═════════════════════════════════════════════════════════════════════════════
// DIGEST: Daily summary for Alexis
// ═════════════════════════════════════════════════════════════════════════════

async function sendDailyDigest(details) {
  if (details.length === 0 && stats.errors.length === 0) {
    console.log('\nNo at-risk authorizations found. No digest needed.');
    return;
  }

  const criticals = details.filter(d => d.noticeType === 'critical');
  const urgents = details.filter(d => d.noticeType === 'urgent');
  const warnings = details.filter(d => d.noticeType === 'warning');

  const lines = [
    `Authorization Renewal Daily Digest`,
    `Date: ${new Date().toISOString().split('T')[0]}`,
    `Mode: ${stats.mode}`,
    `========================================`,
    ``,
  ];

  if (criticals.length > 0) {
    lines.push(`CRITICAL (${criticals.length}):`);
    for (const d of criticals) {
      lines.push(`  ${d.clientName} — ${d.payerName} — ${d.triggers.join(', ')} — ${d.action}`);
    }
    lines.push('');
  }

  if (urgents.length > 0) {
    lines.push(`URGENT (${urgents.length}):`);
    for (const d of urgents) {
      lines.push(`  ${d.clientName} — ${d.payerName} — ${d.triggers.join(', ')} — ${d.action}`);
    }
    lines.push('');
  }

  if (warnings.length > 0) {
    lines.push(`WARNING (${warnings.length}):`);
    for (const d of warnings) {
      lines.push(`  ${d.clientName} — ${d.payerName} — ${d.triggers.join(', ')} — ${d.action}`);
    }
    lines.push('');
  }

  lines.push(`Summary: ${stats.authsScanned} scanned, ${stats.warnings} warnings, ${stats.urgents} urgents, ${stats.criticals} criticals`);
  lines.push(`Renewals initiated: ${stats.renewalsInitiated}, IRIS consultants notified: ${stats.irisConsultantsNotified}`);
  lines.push(`Skipped (already notified): ${stats.skippedDedup}`);

  if (stats.errors.length > 0) {
    lines.push(`\nErrors (${stats.errors.length}):`);
    stats.errors.forEach(e => lines.push(`  - ${e}`));
  }

  const digest = lines.join('\n');
  console.log('\n' + digest);

  if (!DRY_RUN) {
    await alertOwner('Daily Auth Renewal Digest', digest, 'renewal_digest');
  }
}

// ═════════════════════════════════════════════════════════════════════════════
// MAIN
// ═════════════════════════════════════════════════════════════════════════════

async function run() {
  const startTime = Date.now();
  console.log('==========================================================');
  console.log('  CVHC Authorization Renewal Monitoring Agent');
  console.log(`  Mode: ${DRY_RUN ? 'DRY-RUN (no notices sent)' : 'LIVE'}`);
  console.log(`  Started: ${new Date().toISOString()}`);
  console.log('==========================================================\n');

  // Create run record
  let runId = null;
  if (!DRY_RUN) {
    const runResult = await db.query(`
      INSERT INTO agent_renewal_runs (id, mode, started_at)
      VALUES ($1, $2, NOW()) RETURNING id
    `, [uuidv4(), stats.mode]);
    runId = runResult.rows[0].id;
  }

  // Find at-risk auths
  console.log('── Scanning authorizations ──────────────────────────────────');
  let atRiskAuths;
  try {
    atRiskAuths = await findAtRiskAuths();
  } catch (err) {
    console.error('FATAL: Could not query authorizations:', err.message);
    stats.errors.push(err.message);
    await finalize(runId, startTime, []);
    return;
  }

  stats.authsScanned = atRiskAuths.length;
  console.log(`Found ${atRiskAuths.length} at-risk authorization(s)\n`);

  const digestDetails = [];

  for (let i = 0; i < atRiskAuths.length; i++) {
    const auth = atRiskAuths[i];
    const clientName = `${auth.client_first} ${auth.client_last}`;
    const prefix = `[${i + 1}/${atRiskAuths.length}]`;

    // Classify
    const classification = classifyAuth(auth);
    console.log(`${prefix} ${clientName} — ${auth.payer_name || classification.payerKey} — ${classification.noticeType.toUpperCase()}`);
    console.log(`  Triggers: ${classification.triggers.join(', ')}`);

    // Dedup check
    const alreadyNotified = await wasRecentlyNotified(auth.id, classification.noticeType);
    if (alreadyNotified) {
      console.log(`  SKIP: Already notified within ${config.renewalDedupDays} days`);
      stats.skippedDedup++;
      console.log('');
      continue;
    }

    // Skip if already renewed
    if (auth.renewal_status === 'renewed') {
      console.log('  SKIP: Already renewed');
      console.log('');
      continue;
    }

    // Route to payer-specific handler
    let actionTaken = '';
    let consultantNotified = false;

    try {
      if (classification.isIRIS) {
        const result = await handleIRISRenewal(auth, classification);
        actionTaken = result.action;
        consultantNotified = result.consultantNotified;
        if (consultantNotified) stats.irisConsultantsNotified++;
      } else if (classification.payerKey === 'forwardhealth') {
        actionTaken = await handleForwardHealthRenewal(auth, classification);
      } else {
        actionTaken = await handleMCORenewal(auth, classification);
      }

      // Track stats
      if (classification.noticeType === 'critical') stats.criticals++;
      else if (classification.noticeType === 'urgent') stats.urgents++;
      else stats.warnings++;

      if (classification.noticeType === 'critical') stats.renewalsInitiated++;

      console.log(`  Action: ${actionTaken}`);

      // Log the notice
      await logRenewalNotice(auth, classification, actionTaken, consultantNotified);

      digestDetails.push({
        clientName,
        payerName: auth.payer_name || classification.payerKey,
        noticeType: classification.noticeType,
        triggers: classification.triggers,
        action: actionTaken,
      });
    } catch (err) {
      console.error(`  ERROR: ${err.message}`);
      stats.errors.push(`${clientName}: ${err.message}`);
    }

    console.log('');
  }

  // Send daily digest
  await sendDailyDigest(digestDetails);

  // Finalize
  await finalize(runId, startTime, digestDetails);
}

async function finalize(runId, startTime, details) {
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

  console.log('\n==========================================================');
  console.log('RUN SUMMARY');
  console.log('----------------------------------------------------------');
  console.log(`  Mode:                ${stats.mode}`);
  console.log(`  Duration:            ${elapsed}s`);
  console.log(`  Auths scanned:       ${stats.authsScanned}`);
  console.log(`  Warnings sent:       ${stats.warnings}`);
  console.log(`  Urgents sent:        ${stats.urgents}`);
  console.log(`  Criticals sent:      ${stats.criticals}`);
  console.log(`  Renewals initiated:  ${stats.renewalsInitiated}`);
  console.log(`  IRIS consultants:    ${stats.irisConsultantsNotified}`);
  console.log(`  Skipped (dedup):     ${stats.skippedDedup}`);
  console.log(`  Errors:              ${stats.errors.length}`);
  console.log('==========================================================');

  // Update run record
  if (!DRY_RUN && runId) {
    await db.query(`
      UPDATE agent_renewal_runs SET
        finished_at = NOW(),
        auths_scanned = $2,
        warnings_sent = $3,
        urgents_sent = $4,
        criticals_sent = $5,
        renewals_initiated = $6,
        iris_consultants_notified = $7,
        errors = $8,
        summary = $9
      WHERE id = $1
    `, [
      runId, stats.authsScanned, stats.warnings, stats.urgents,
      stats.criticals, stats.renewalsInitiated, stats.irisConsultantsNotified,
      JSON.stringify(stats.errors),
      `Scanned ${stats.authsScanned}: ${stats.warnings}w/${stats.urgents}u/${stats.criticals}c, ${stats.renewalsInitiated} renewals, ${stats.irisConsultantsNotified} IRIS notifications`,
    ]);
  }

  await db.pool.end();
  console.log('\nRenewal agent finished.');
}

// ═════════════════════════════════════════════════════════════════════════════
// ENTRY POINT
// ═════════════════════════════════════════════════════════════════════════════

run().catch(async (err) => {
  console.error('\nFATAL ERROR:', err);
  stats.errors.push(err.message);
  try { await db.pool.end(); } catch (_) {}
  process.exit(1);
});
