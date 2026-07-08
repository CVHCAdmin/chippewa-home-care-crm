// helpers/scheduleOccurrences.js
// SINGLE SOURCE OF TRUTH for "how many hours does the schedule imply over a date
// range." Expands each schedule into one row per actual occurrence in the period,
// respecting effective/end dates, cancellations, and per-day time overrides —
// exactly like the payroll reconciliation (payrollRoutes.js SCHEDULE_EXPANSION_CTE).
//
// The old reports/scheduling queries counted each recurring schedule ONCE with no
// date/cancellation filter, so they inflated hours (counted ended patterns,
// not-yet-started shifts, and cancelled days). Use this instead.
//
// USAGE: the CTE hard-codes $1 = startDate and $2 = endDate, so they MUST be the
// first two query params. Columns produced: schedule_id, caregiver_id, client_id,
// occ_date (date), hours (numeric, overnight-aware).

const SCHEDULE_OCCURRENCES_CTE = (name = 'schedule_occurrences') => `
  ${name} AS (
    SELECT
      s.id AS schedule_id,
      s.caregiver_id,
      s.client_id,
      d.dt::date AS occ_date,
      (EXTRACT(EPOCH FROM (COALESCE(se.override_end_time, s.end_time) - COALESCE(se.override_start_time, s.start_time))) / 3600.0
        + CASE WHEN COALESCE(se.override_end_time, s.end_time) < COALESCE(se.override_start_time, s.start_time) THEN 24 ELSE 0 END) AS hours
    FROM schedules s
    CROSS JOIN generate_series($1::date, $2::date, '1 day'::interval) AS d(dt)
    LEFT JOIN schedule_exceptions se
      ON se.schedule_id = s.id AND se.exception_date = d.dt::date
    WHERE s.is_active = true
      AND (
        (s.schedule_type = 'one-time' AND s.date = d.dt::date)
        OR (s.schedule_type = 'recurring' AND s.day_of_week = EXTRACT(DOW FROM d.dt)::int)
        OR (s.schedule_type = 'bi-weekly' AND s.day_of_week = EXTRACT(DOW FROM d.dt)::int
            AND MOD(((d.dt::date - COALESCE(s.anchor_date, s.effective_date, s.created_at::date))::int / 7), 2) = 0)
        OR (s.schedule_type = 'multi-day' AND s.date IS NOT NULL AND s.date = d.dt::date)
      )
      AND d.dt::date >= COALESCE(s.effective_date, s.created_at::date)
      AND (s.end_date IS NULL OR d.dt::date <= s.end_date)
      AND (se.id IS NULL OR se.exception_type != 'cancelled')
  )
`;

module.exports = { SCHEDULE_OCCURRENCES_CTE };
