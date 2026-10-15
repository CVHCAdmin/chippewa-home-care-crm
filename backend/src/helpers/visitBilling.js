// helpers/visitBilling.js — the ONE rule for how many minutes a finished visit bills/pays.
// Used by clock-out and by approved time corrections, so a corrected visit is priced
// exactly like one that was clocked correctly.
//
//   < 60 seconds            → 0, flagged 'zero_duration' (accidental double tap)
//   private pay             → actual minutes
//   payer, no schedule      → actual minutes, flagged 'unscheduled'
//   payer with a schedule   → the scheduled (allotted) minutes; flagged 'time_variance'
//                             when actual is more than 7 minutes off
//   over 16 hours           → capped at the schedule (or 16h), flagged 'excessive_duration'
const MAX_SHIFT_MINUTES = 16 * 60;
const VARIANCE_GRACE_MINUTES = 7;

// A single shift longer than 16h is almost certainly a missed clock-out. Never silently
// auto-bill it: flag for review and cap billable at the schedule (or the ceiling).
function applyExcessiveDurationGuard({ durationMinutes, allottedMinutes, billableMinutes, needsApproval, approvalReason }) {
  if (durationMinutes <= MAX_SHIFT_MINUTES) {
    return { billableMinutes, needsApproval, approvalReason };
  }
  const cap = allottedMinutes != null ? allottedMinutes : MAX_SHIFT_MINUTES;
  return {
    billableMinutes: Math.min(billableMinutes, cap),
    needsApproval: true,
    approvalReason: approvalReason ? `${approvalReason},excessive_duration` : 'excessive_duration',
  };
}

function computeVisitBilling({ durationSeconds, allottedMinutes, isPrivatePay }) {
  const durationMinutes = Math.round(durationSeconds / 60);
  let billableMinutes, needsApproval = false, approvalReason = null;
  if (durationSeconds < 60) {
    billableMinutes = 0; needsApproval = true; approvalReason = 'zero_duration';
  } else if (isPrivatePay) {
    billableMinutes = durationMinutes;
  } else if (allottedMinutes == null) {
    billableMinutes = durationMinutes; needsApproval = true; approvalReason = 'unscheduled';
  } else {
    billableMinutes = allottedMinutes;
    if (Math.abs(durationMinutes - allottedMinutes) > VARIANCE_GRACE_MINUTES) {
      needsApproval = true; approvalReason = 'time_variance';
    }
  }
  ({ billableMinutes, needsApproval, approvalReason } = applyExcessiveDurationGuard({
    durationMinutes, allottedMinutes, billableMinutes, needsApproval, approvalReason,
  }));
  const discrepancyMinutes = allottedMinutes != null ? durationMinutes - allottedMinutes : null;
  return { durationMinutes, billableMinutes, needsApproval, approvalReason, discrepancyMinutes };
}

module.exports = { MAX_SHIFT_MINUTES, VARIANCE_GRACE_MINUTES, applyExcessiveDurationGuard, computeVisitBilling };
