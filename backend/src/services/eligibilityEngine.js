// src/services/eligibilityEngine.js
// Runs Wisconsin caregiver eligibility analysis against WORCS findings.
//
// Decision model:
//   clear          — no records found, no matches against the bar list
//   flagged_review — record(s) found but none match any active disqualifier;
//                    or matches are "advisory" severity. Admin must review.
//   disqualified   — at least one "permanent_bar" match. No hire.
//   rehab_review   — matches are all "rehab_review" severity; hiring is
//                    permitted only after Wisconsin DHS rehabilitation review.
//
// This is a rule-based engine by design. Caregiver eligibility is a legal
// determination and cannot be automated away. The engine surfaces the
// matched statutes and lets the admin make the final call.

const db = require('../db');

const SEVERITY_ORDER = { permanent_bar: 3, rehab_review: 2, advisory: 1 };

/**
 * Given WORCS result text (findings, raw result, etc.), match it against the
 * active caregiver_disqualifiers and return a structured decision.
 *
 * @param {Object} worcs  { result, hasRecord, findings, rawResult, ... }
 * @returns {Promise<{
 *   status: 'clear'|'flagged_review'|'rehab_review'|'disqualified',
 *   matches: Array<{ category, statute, short_title, severity, description, matched_text }>,
 *   summary: string,
 *   recommendation: string
 * }>}
 */
async function evaluateWorcsResult(worcs) {
  if (!worcs) {
    return {
      status: 'flagged_review',
      matches: [],
      summary: 'No WORCS result available to evaluate.',
      recommendation: 'Re-run the background check before hiring.',
    };
  }

  // No record → cleared.
  if (worcs.hasRecord === false || worcs.result === 'cleared') {
    return {
      status: 'clear',
      matches: [],
      summary: 'No criminal record was returned by the Wisconsin DOJ Online Record Check System.',
      recommendation: 'Approve — no criminal history per WORCS.',
    };
  }

  // Collect all searchable text from the WORCS payload.
  const haystack = [
    worcs.findings,
    worcs.rawResult,
    worcs.result,
    worcs.description,
    JSON.stringify(worcs.details || {}),
  ].filter(Boolean).join('\n').toLowerCase();

  // Load active disqualifiers
  const { rows: disqualifiers } = await db.query(
    `SELECT id, category, statute, short_title, description, severity, match_patterns
       FROM caregiver_disqualifiers
      WHERE is_active = true`
  );

  const matches = [];
  for (const d of disqualifiers) {
    const patterns = Array.isArray(d.match_patterns) ? d.match_patterns : [];
    for (const pattern of patterns) {
      try {
        const re = new RegExp(pattern, 'i');
        const m = haystack.match(re);
        if (m) {
          matches.push({
            category: d.category,
            statute: d.statute,
            short_title: d.short_title,
            description: d.description,
            severity: d.severity,
            matched_text: m[0],
          });
          break; // one pattern hit is enough for this disqualifier
        }
      } catch (err) {
        console.warn(`[eligibility] bad regex on disqualifier ${d.statute}: ${err.message}`);
      }
    }
  }

  // Deduplicate by statute (in case a record hits both a pattern on the same
  // disqualifier through different regex — unlikely but defensive)
  const seen = new Set();
  const unique = matches.filter(m => {
    if (seen.has(m.statute)) return false;
    seen.add(m.statute);
    return true;
  });

  // Determine overall status by the most severe match
  const maxSeverity = unique.reduce(
    (max, m) => Math.max(max, SEVERITY_ORDER[m.severity] || 0),
    0
  );

  if (unique.length === 0) {
    return {
      status: 'flagged_review',
      matches: [],
      summary: 'WORCS returned a record but no entries match the Wisconsin statutory caregiver bar list. Manual review required.',
      recommendation: 'Review the raw WORCS report for any disqualifying content not captured by automated rules. If nothing disqualifying, proceed with hiring.',
    };
  }

  if (maxSeverity === SEVERITY_ORDER.permanent_bar) {
    const perm = unique.filter(m => m.severity === 'permanent_bar');
    return {
      status: 'disqualified',
      matches: unique,
      summary: `WORCS record matches ${perm.length} permanent caregiver bar${perm.length === 1 ? '' : 's'} under Wisconsin law. This candidate cannot be hired as a caregiver.`,
      recommendation: `Do not hire. Matched: ${perm.map(m => m.statute).join(', ')}.`,
    };
  }

  if (maxSeverity === SEVERITY_ORDER.rehab_review) {
    return {
      status: 'rehab_review',
      matches: unique,
      summary: `WORCS record matches one or more offenses that bar caregiver employment unless the applicant obtains a Wisconsin DHS rehabilitation review finding substantial evidence of rehabilitation.`,
      recommendation: `Do not hire until applicant obtains a DHS rehabilitation review. Give the applicant a copy of the report and the FCRA summary of rights per § 1681b(b)(3).`,
    };
  }

  return {
    status: 'flagged_review',
    matches: unique,
    summary: `WORCS record contains advisory-level matches. These do not automatically bar employment, but warrant admin consideration.`,
    recommendation: 'Review matches below; hiring is permitted at the agency\'s discretion.',
  };
}

/**
 * Convenience wrapper: load the most recent WORCS background_checks row for a
 * caregiver, run the evaluation, and return the decision. Does NOT persist;
 * the caller decides what to do with the result.
 */
async function runEligibilityForCaregiver(caregiverId) {
  const r = await db.query(
    `SELECT * FROM background_checks
      WHERE caregiver_id = $1
        AND check_type = 'worcs'
      ORDER BY created_at DESC
      LIMIT 1`,
    [caregiverId]
  );
  if (!r.rows.length) {
    return {
      status: 'flagged_review',
      matches: [],
      summary: 'No WORCS background check has been run yet.',
      recommendation: 'Send onboarding packet to the caregiver to collect consent and run WORCS.',
    };
  }
  const bc = r.rows[0];
  return evaluateWorcsResult({
    hasRecord: bc.result === 'record_found' ? true : (bc.result === 'clear' ? false : null),
    result:    bc.result,
    findings:  bc.findings,
    rawResult: bc.notes,
  });
}

module.exports = { evaluateWorcsResult, runEligibilityForCaregiver };
