// helpers/scheduleOccurrences.js
// THE schedule engine. Every place that needs to know "does this shift happen on
// date X, and with what times, caregiver and client" must go through here.
//
// Why this file is load-bearing: a recurring shift is ONE row in `schedules`
// (day_of_week + effective_date/end_date/frequency/anchor_date) and every
// occurrence is re-derived on the fly. The system previously re-derived it in ~28
// different places that disagreed with each other, so payroll, billing, the
// calendar and the caregiver's phone each gave a different answer for the same
// shift. Anything that expands a schedule and does NOT use this CTE is a bug.
//
// USAGE: the CTE hard-codes $1 = startDate and $2 = endDate, so they MUST be the
// first two query params.
//
// Columns produced:
//   schedule_id
//   caregiver_id, client_id      — RESOLVED through the exception overrides
//   pattern_caregiver_id, pattern_client_id — what the pattern itself says
//   occ_date                     — the actual calendar date of this occurrence
//   start_time, end_time         — RESOLVED through the exception overrides
//   hours, minutes               — overnight-aware duration of the resolved times
//   is_modified                  — this occurrence carries a 'modified' override
//
// Three rules encoded here that the old copies got wrong:
//
//  1. RECURRING-NESS IS `day_of_week IS NOT NULL`, NOT `schedule_type`.
//     `schedule_type` defaults to 'recurring', so rows inserted without an explicit
//     type (emergency coverage shifts) carried a `date`, no `day_of_week`, and the
//     type 'recurring' — which matched NO branch of the old schedule_type-keyed
//     expanders. They were billed but never paid. Keying off the columns that
//     actually carry the meaning fixes that class of row permanently.
//
//  2. BI-WEEKLY LIVES IN `frequency`, NOT `schedule_type`.
//     Every writer stores bi-weekly as `schedule_type='recurring'` +
//     `frequency='biweekly'`. NOTHING has ever written `schedule_type='bi-weekly'`,
//     yet payroll/reports/forecast all tested for exactly that — so the row fell
//     through to the plain 'recurring' branch and expanded EVERY week. Caregivers
//     were paid twice as often as they worked, while billing (which reads
//     `frequency`) charged correctly.
//
//  3. THE effective_date LOWER BOUND APPLIES ONLY TO RECURRING ROWS.
//     It exists to stop a recurring pattern generating phantom visits before it was
//     created. Applied to a ONE-TIME row it is nonsense — a one-time shift's `date`
//     IS its occurrence — and it silently dropped every shift entered after the
//     fact (the back-office correcting last week at payday). Those punches then
//     fell through to payroll's "unscheduled clock-in" branch and were paid
//     UNCAPPED, which is how a missed clock-out inflates a paycheck.

// Bi-weekly parity: which side of the anchor's fortnight this date falls on.
// The extra ((x % 2) + 2) % 2 normalizes Postgres's truncate-toward-zero division,
// which would otherwise return -1 for dates before the anchor and silently drop them.
const BIWEEKLY_ON_WEEK = `
  ((((d.dt::date - COALESCE(s.anchor_date, s.effective_date, s.created_at::date))::int / 7) % 2) + 2) % 2 = 0
`;

const RESOLVED_START = `COALESCE(se.override_start_time, s.start_time)`;
const RESOLVED_END = `COALESCE(se.override_end_time, s.end_time)`;
// Overnight-aware: an end time earlier than the start means it wrapped past midnight.
const OVERNIGHT_WRAP = `CASE WHEN ${RESOLVED_END} < ${RESOLVED_START} THEN 1 ELSE 0 END`;

const SCHEDULE_OCCURRENCES_CTE = (name = 'schedule_occurrences') => `
  ${name} AS (
    SELECT
      s.id AS schedule_id,
      COALESCE(se.override_caregiver_id, s.caregiver_id) AS caregiver_id,
      COALESCE(se.override_client_id,    s.client_id)    AS client_id,
      s.caregiver_id AS pattern_caregiver_id,
      s.client_id    AS pattern_client_id,
      d.dt::date AS occ_date,
      ${RESOLVED_START} AS start_time,
      ${RESOLVED_END}   AS end_time,
      (EXTRACT(EPOCH FROM (${RESOLVED_END} - ${RESOLVED_START})) / 3600.0
        + (${OVERNIGHT_WRAP}) * 24) AS hours,
      (ROUND(EXTRACT(EPOCH FROM (${RESOLVED_END} - ${RESOLVED_START})) / 60)::int
        + (${OVERNIGHT_WRAP}) * 1440) AS minutes,
      (se.id IS NOT NULL AND se.exception_type = 'modified') AS is_modified
    FROM schedules s
    CROSS JOIN generate_series($1::date, $2::date, '1 day'::interval) AS d(dt)
    LEFT JOIN schedule_exceptions se
      ON se.schedule_id = s.id AND se.exception_date = d.dt::date
    WHERE s.is_active = true
      AND (
        -- One-time: the row carries a concrete date. No effective_date/end_date
        -- bound — the date IS the occurrence (see rule 3 above).
        (s.day_of_week IS NULL AND s.date IS NOT NULL AND s.date = d.dt::date)

        -- Recurring (incl. bi-weekly): day_of_week is the only reliable marker.
        OR (
          s.day_of_week IS NOT NULL
          AND s.day_of_week = EXTRACT(DOW FROM d.dt)::int
          AND (COALESCE(s.frequency, 'weekly') <> 'biweekly' OR ${BIWEEKLY_ON_WEEK})
          AND d.dt::date >= COALESCE(s.effective_date, s.created_at::date)
          AND (s.end_date IS NULL OR d.dt::date <= s.end_date)
        )
      )
      -- A cancelled occurrence does not exist. Nothing may pay it, bill it, remind
      -- for it, alert on it, or auto-clock-in against it.
      AND (se.id IS NULL OR se.exception_type <> 'cancelled')
  )
`;

module.exports = { SCHEDULE_OCCURRENCES_CTE };
