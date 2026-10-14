// helpers/evvWeekly.js — does THIS visit still need Sandata?
//
// My Choice authorizes two kinds of weekly units per client (MIDAS, Sun–Sat weeks):
//   S5125 attendant care — EVV required, must be checked in/out on Sandata
//   S5130 homemaker      — no Sandata
// `clients.evv_weekly_units` holds the S5125 allowance. Visits are sent to Sandata
// until that week's Sandata minutes reach the allowance; after that the rest of the
// week is homemaker time and the caregiver is not sent to Sandata. A visit that starts
// while EVV minutes remain goes to Sandata whole (owner: a small overshoot is fine).
//
// The decision is stored per visit (time_entries.sandata_required) so the clock-out
// prompt always matches the clock-in: a visit checked in on Sandata is checked out too.
const db = require('../db');

const UNIT_MINUTES = 15;

// Minutes a visit counts toward the week. A finished visit counts its BILLABLE minutes
// (for these payer clients that is the scheduled block, and it is capped when a clock-out
// was missed) — raw clock time would let one forgotten clock-out (a real 23-hour punch on
// a 2¼-hour visit, week of 2026-10-11) "use up" a client's EVV week. An open visit counts
// its elapsed time, capped at its scheduled length. Shared with GET /api/clients/evv-week.
const VISIT_MINUTES_SQL = (nowExpr) => `
  CASE WHEN te.end_time IS NOT NULL
       THEN COALESCE(te.billable_minutes, te.duration_minutes, EXTRACT(EPOCH FROM (te.end_time - te.start_time)) / 60)
       ELSE LEAST(GREATEST(0, EXTRACT(EPOCH FROM (${nowExpr} - te.start_time)) / 60),
                  COALESCE(te.allotted_minutes, 960))
  END`;

// Same rule as the app's needsSandata(): My Choice (Family Care MCO) clients who are in
// Sandata, i.e. have a Medicaid ID on file. Private pay never.
function clientInSandata(c) {
  if (!c || c.is_private_pay === true) return false;
  return c.payer_type === 'mco_family_care' && /^\d{10,12}$/.test(String(c.medicaid_id || '').trim());
}

// Sandata minutes already used by a client in the Sun–Sat (America/Chicago) week that
// contains `atIso` (null = now). Counts finished visits by their clocked minutes and an
// open visit by its elapsed minutes. Visits from before v72 (sandata_required NULL) were
// all sent to Sandata for these clients, so they count.
async function evvWeekUsage(clientId, atIso = null, { excludeEntryId = null } = {}) {
  const r = await db.query(
    `WITH d AS (SELECT (COALESCE($2::timestamptz, NOW()) AT TIME ZONE 'America/Chicago')::date AS day),
          w AS (SELECT day - EXTRACT(DOW FROM day)::int AS ws FROM d)
     SELECT to_char(w.ws, 'YYYY-MM-DD') AS week_start,
            to_char(w.ws + 6, 'YYYY-MM-DD') AS week_end,
            COALESCE(SUM(${VISIT_MINUTES_SQL('COALESCE($2::timestamptz, NOW())')}), 0)::float AS used_minutes
       FROM w
       LEFT JOIN time_entries te
         ON te.client_id = $1
        AND (te.start_time AT TIME ZONE 'America/Chicago')::date BETWEEN w.ws AND w.ws + 6
        AND COALESCE(te.sandata_required, true) = true
        AND ($3::uuid IS NULL OR te.id <> $3::uuid)
      GROUP BY w.ws`,
    [clientId, atIso, excludeEntryId]
  );
  const row = r.rows[0] || {};
  return { weekStart: row.week_start, weekEnd: row.week_end, usedMinutes: Math.round(Number(row.used_minutes) || 0) };
}

// true  = send this visit to Sandata
// false = don't (not a Sandata client, no EVV hours, or this week's EVV hours are met)
async function decideSandataRequired(clientId, atIso = null, { excludeEntryId = null } = {}) {
  const c = await db.query(
    `SELECT c.is_private_pay, c.medicaid_id, c.evv_weekly_units, rs.payer_type
       FROM clients c LEFT JOIN referral_sources rs ON rs.id = c.referral_source_id
      WHERE c.id = $1`,
    [clientId]
  );
  const client = c.rows[0];
  if (!clientInSandata(client)) return { required: false, reason: 'not_sandata_client' };
  if (client.evv_weekly_units == null) return { required: true, reason: 'no_allowance_entered' };
  const allowanceMinutes = Number(client.evv_weekly_units) * UNIT_MINUTES;
  if (allowanceMinutes <= 0) return { required: false, reason: 'no_evv_units', allowanceMinutes: 0 };
  const usage = await evvWeekUsage(clientId, atIso, { excludeEntryId });
  const required = usage.usedMinutes < allowanceMinutes;
  return { required, reason: required ? 'evv_minutes_remaining' : 'evv_week_met', allowanceMinutes, ...usage };
}

// Never hold up a clock-in on this: if the answer isn't back in `ms`, return null and the
// app falls back to prompting (sending an EVV visit to Sandata is the safe side).
function withTimeout(promise, ms) {
  let timer;
  const timeout = new Promise(resolve => { timer = setTimeout(() => resolve(null), ms); });
  return Promise.race([promise.finally(() => clearTimeout(timer)), timeout]);
}

module.exports = { UNIT_MINUTES, VISIT_MINUTES_SQL, clientInSandata, evvWeekUsage, decideSandataRequired, withTimeout };
