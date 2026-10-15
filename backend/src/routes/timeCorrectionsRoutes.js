// routes/timeCorrectionsRoutes.js — caregiver time corrections (mounted at /api/time-corrections)
//
// Caregivers ask to fix the times on a past visit ("forgot to clock out") or add a visit
// they never clocked into. Only the current and last Sun–Sat pay weeks. Nothing changes
// until the office approves: approval rewrites the visit (or creates it), re-prices it
// with the clock-out rule (helpers/visitBilling), records the change for EVV
// (visit_time_changes) and keeps the original clock times on the request. The office
// fixes Sandata itself. A location check compares the GPS the app recorded around those
// times with the client's address.
const express = require('express');
const { v4: uuidv4 } = require('uuid');
const router = express.Router();
const db = require('../db');
const { verifyToken, requireAdmin, auditLog } = require('../middleware/shared');
const { SCHEDULE_OCCURRENCES_CTE } = require('../helpers/scheduleOccurrences');
const { computeVisitBilling, MAX_SHIFT_MINUTES } = require('../helpers/visitBilling');
const { geocodeClient, distanceFeet } = require('../helpers/geocode');

const REASONS = {
  forgot_clock_in: 'Forgot to clock in',
  forgot_clock_out: 'Forgot to clock out',
  app_problem: 'App or phone problem',
  wrong_times: 'Clocked times are wrong',
  other: 'Other',
};
const EVV_REASON_CODES = ['1', '2', '3', '4', '5', '7', '8']; // Wisconsin EVV visit-change reasons
const DEFAULT_RADIUS_FT = 300;

const httpError = (status, message) => Object.assign(new Error(message), { status });
const sendErr = (res, e, tag) => {
  if (!e.status) console.error(`[time-corrections] ${tag}:`, e.message);
  res.status(e.status || 500).json({ error: e.status ? e.message : 'Something went wrong — please try again.' });
};

// The window caregivers can correct: Sunday of LAST week through today (America/Chicago).
async function window() {
  const r = await db.query(
    `WITH d AS (SELECT (NOW() AT TIME ZONE 'America/Chicago')::date AS today)
     SELECT to_char(today - EXTRACT(DOW FROM today)::int - 7, 'YYYY-MM-DD') AS start,
            to_char(today, 'YYYY-MM-DD') AS today FROM d`);
  return r.rows[0];
}

async function notify(userIds, type, title, message) {
  for (const id of userIds) {
    try {
      await db.query(`INSERT INTO notifications (id, user_id, type, title, message, is_read) VALUES ($1,$2,$3,$4,$5,false)`,
        [uuidv4(), id, type, title, message]);
    } catch (e) { console.error('[time-corrections] notify:', e.message); }
  }
}
const adminIds = async () => (await db.query(`SELECT id FROM users WHERE role = 'admin' AND is_active = true`)).rows.map(r => r.id);

// "YYYY-MM-DDTHH:MM" wall clock in America/Chicago → timestamptz (as ISO) via Postgres.
async function chicagoToInstant(local) {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(String(local || ''))) throw httpError(400, 'Enter the date and time.');
  const r = await db.query(`SELECT ($1::timestamp AT TIME ZONE 'America/Chicago') AS t`, [local]);
  return new Date(r.rows[0].t);
}

// ── CAREGIVER ────────────────────────────────────────────────────────────────

// GET /my — visits that can be corrected (current + last pay week) and my requests
router.get('/my', verifyToken, async (req, res) => {
  try {
    const w = await window();
    const visits = await db.query(
      `SELECT te.id, te.client_id, te.start_time, te.end_time,
              c.first_name || ' ' || c.last_name AS client_name,
              to_char(te.start_time AT TIME ZONE 'America/Chicago', 'YYYY-MM-DD') AS visit_date
         FROM time_entries te JOIN clients c ON c.id = te.client_id
        WHERE te.caregiver_id = $1
          AND (te.start_time AT TIME ZONE 'America/Chicago')::date BETWEEN $2::date AND $3::date
        ORDER BY te.start_time DESC`, [req.user.id, w.start, w.today]);
    const requests = await db.query(
      `SELECT tc.id, tc.time_entry_id, tc.kind, tc.status, tc.reason, tc.note, tc.review_note,
              tc.requested_start, tc.requested_end, tc.original_start, tc.original_end, tc.created_at, tc.reviewed_at,
              to_char(tc.visit_date, 'YYYY-MM-DD') AS visit_date,
              c.first_name || ' ' || c.last_name AS client_name
         FROM time_corrections tc JOIN clients c ON c.id = tc.client_id
        WHERE tc.caregiver_id = $1 AND tc.created_at > NOW() - INTERVAL '45 days'
        ORDER BY tc.created_at DESC`, [req.user.id]);
    res.json({ window: w, visits: visits.rows, requests: requests.rows, reasons: REASONS });
  } catch (e) { sendErr(res, e, 'my'); }
});

// POST / — submit a correction
//   { timeEntryId, start, end, reason, note, latitude?, longitude?, accuracy? }   fix a visit
//   { clientId, start, end, reason, note, ... }                                    add a missed visit
// start/end are "YYYY-MM-DDTHH:MM" in Central time.
router.post('/', verifyToken, async (req, res) => {
  try {
    const { timeEntryId, clientId, reason, latitude, longitude, accuracy } = req.body || {};
    const note = String(req.body.note || '').trim().slice(0, 1000);
    if (!REASONS[reason]) throw httpError(400, 'Pick a reason.');
    if (note.length < 3) throw httpError(400, 'Add a short note about what happened.');
    const start = await chicagoToInstant(req.body.start);
    const end = await chicagoToInstant(req.body.end);
    if (end <= start) throw httpError(400, 'The end time must be after the start time.');
    if ((end - start) / 60000 > MAX_SHIFT_MINUTES) throw httpError(400, 'A visit can\'t be longer than 16 hours. Call the office.');
    if (end > new Date(Date.now() + 5 * 60000)) throw httpError(400, 'You can only correct visits that are over.');
    const w = await window();
    const dayR = await db.query(`SELECT to_char(($1::timestamptz AT TIME ZONE 'America/Chicago')::date, 'YYYY-MM-DD') AS d`, [start.toISOString()]);
    const visitDate = dayR.rows[0].d;
    if (visitDate < w.start || visitDate > w.today) throw httpError(400, 'You can only correct visits from this week or last week. Call the office for older visits.');

    let kind, cid, entry = null;
    if (timeEntryId) {
      const e = await db.query(`SELECT * FROM time_entries WHERE id = $1 AND caregiver_id = $2`, [timeEntryId, req.user.id]);
      entry = e.rows[0];
      if (!entry) throw httpError(404, 'Visit not found.');
      const ed = await db.query(`SELECT to_char((start_time AT TIME ZONE 'America/Chicago')::date, 'YYYY-MM-DD') AS d FROM time_entries WHERE id = $1`, [entry.id]);
      if (ed.rows[0].d < w.start) throw httpError(400, 'That visit is older than last week. Call the office.');
      kind = 'fix_times'; cid = entry.client_id;
    } else {
      if (!clientId) throw httpError(400, 'Pick the client.');
      // Same rule as the clock-in client list: a client this caregiver has a schedule with.
      const ok = await db.query(
        `SELECT 1 FROM clients c WHERE c.id = $1 AND c.is_active = true AND (
            EXISTS (SELECT 1 FROM schedules s WHERE s.client_id = c.id AND s.caregiver_id = $2 AND s.is_active = true)
         OR EXISTS (SELECT 1 FROM schedule_exceptions se JOIN schedules s3 ON s3.id = se.schedule_id
                     WHERE se.override_caregiver_id = $2 AND se.exception_type = 'modified'
                       AND COALESCE(se.override_client_id, s3.client_id) = c.id))`, [clientId, req.user.id]);
      if (!ok.rows[0]) throw httpError(400, 'You don\'t have a schedule with that client.');
      kind = 'missed_visit'; cid = clientId;
    }

    // Can't overlap another of my visits (other than the one being fixed).
    const overlap = await db.query(
      `SELECT c.first_name || ' ' || c.last_name AS client_name FROM time_entries te JOIN clients c ON c.id = te.client_id
        WHERE te.caregiver_id = $1 AND ($2::uuid IS NULL OR te.id <> $2::uuid)
          AND te.start_time < $4 AND COALESCE(te.end_time, NOW()) > $3 LIMIT 1`,
      [req.user.id, entry ? entry.id : null, start.toISOString(), end.toISOString()]);
    if (overlap.rows[0]) throw httpError(409, `Those times overlap your visit with ${overlap.rows[0].client_name}. Fix that one too, or call the office.`);

    let row;
    try {
      const ins = await db.query(
        `INSERT INTO time_corrections (caregiver_id, client_id, time_entry_id, kind, visit_date, requested_start, requested_end,
            original_start, original_end, reason, note, submit_lat, submit_lng, submit_accuracy)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING *`,
        [req.user.id, cid, entry ? entry.id : null, kind, visitDate, start.toISOString(), end.toISOString(),
         entry ? entry.start_time : null, entry ? entry.end_time : null, reason, note,
         Number.isFinite(Number(latitude)) && latitude !== null ? Number(latitude) : null,
         Number.isFinite(Number(longitude)) && longitude !== null ? Number(longitude) : null,
         Number.isFinite(Number(accuracy)) && accuracy !== null ? Math.round(Number(accuracy)) : null]);
      row = ins.rows[0];
    } catch (err) {
      if (err.code === '23505') throw httpError(409, 'You already have a request waiting for this visit. Cancel it first to send a new one.');
      throw err;
    }
    const who = await db.query(`SELECT u.first_name || ' ' || u.last_name AS cg, c.first_name || ' ' || c.last_name AS cl
                                  FROM users u, clients c WHERE u.id = $1 AND c.id = $2`, [req.user.id, cid]);
    await notify(await adminIds(), 'time_correction',
      `Time correction: ${who.rows[0].cg}`,
      `${who.rows[0].cg} asked to ${kind === 'missed_visit' ? 'add a missed visit' : 'fix the times'} for ${who.rows[0].cl} on ${visitDate}. Review in Shift Approvals → Time Corrections.`);
    await auditLog(req.user.id, 'CREATE', 'time_corrections', row.id, null, { kind, visit_date: visitDate, reason });
    res.status(201).json(row);
  } catch (e) { sendErr(res, e, 'submit'); }
});

// POST /:id/cancel — caregiver withdraws their own pending request
router.post('/:id/cancel', verifyToken, async (req, res) => {
  try {
    const r = await db.query(`UPDATE time_corrections SET status = 'cancelled' WHERE id = $1 AND caregiver_id = $2 AND status = 'pending' RETURNING id`,
      [req.params.id, req.user.id]);
    if (!r.rows[0]) throw httpError(409, 'Only your own pending requests can be cancelled.');
    res.json({ ok: true });
  } catch (e) { sendErr(res, e, 'cancel'); }
});

// ── OFFICE ───────────────────────────────────────────────────────────────────

// GET /?status=pending|approved|denied|all
router.get('/', verifyToken, requireAdmin, async (req, res) => {
  try {
    const status = ['pending', 'approved', 'denied', 'cancelled'].includes(req.query.status) ? req.query.status : (req.query.status === 'all' ? null : 'pending');
    const r = await db.query(
      `SELECT tc.*, to_char(tc.visit_date, 'YYYY-MM-DD') AS visit_date,
              u.first_name || ' ' || u.last_name AS caregiver_name,
              c.first_name || ' ' || c.last_name AS client_name, c.is_private_pay, c.medicaid_id,
              rs.payer_type, rv.first_name || ' ' || rv.last_name AS reviewer_name
         FROM time_corrections tc
         JOIN users u ON u.id = tc.caregiver_id
         JOIN clients c ON c.id = tc.client_id
         LEFT JOIN referral_sources rs ON rs.id = c.referral_source_id
         LEFT JOIN users rv ON rv.id = tc.reviewed_by
        WHERE ($1::text IS NULL OR tc.status = $1)
        ORDER BY (tc.status = 'pending') DESC, tc.created_at DESC
        LIMIT 200`, [status]);
    // The scheduled visit for that day, for side-by-side comparison.
    for (const row of r.rows) {
      const occ = await db.query(
        `WITH ${SCHEDULE_OCCURRENCES_CTE('occ')}
         SELECT to_char(occ.start_time, 'HH24:MI') AS start, to_char(occ.end_time, 'HH24:MI') AS end, occ.minutes
           FROM occ WHERE occ.caregiver_id = $3 AND occ.client_id = $4
          ORDER BY ABS(EXTRACT(EPOCH FROM (occ.start_time - ($5::timestamptz AT TIME ZONE 'America/Chicago')::time))) LIMIT 1`,
        [row.visit_date, row.visit_date, row.caregiver_id, row.client_id, row.requested_start]);
      row.scheduled = occ.rows[0] || null;
      row.in_sandata = row.payer_type === 'mco_family_care' && !row.is_private_pay && /^\d{10,12}$/.test(String(row.medicaid_id || '').trim());
      row.reason_label = REASONS[row.reason] || row.reason;
      delete row.medicaid_id;
    }
    res.json(r.rows);
  } catch (e) { sendErr(res, e, 'list'); }
});

// GET /:id/location — what the app recorded around those times, vs. the client's address
router.get('/:id/location', verifyToken, requireAdmin, async (req, res) => {
  try {
    const t = await db.query(
      `SELECT tc.*, c.latitude, c.longitude, c.address, c.city, COALESCE(g.radius_feet, $2) AS radius_feet
         FROM time_corrections tc JOIN clients c ON c.id = tc.client_id
         LEFT JOIN geofence_settings g ON g.client_id = c.id WHERE tc.id = $1`, [req.params.id, DEFAULT_RADIUS_FT]);
    const tc = t.rows[0];
    if (!tc) throw httpError(404, 'Not found.');
    let lat = tc.latitude, lng = tc.longitude;
    if (lat == null && tc.address) { const g = await geocodeClient(tc.client_id); if (g) { lat = g.latitude; lng = g.longitude; } }
    const radius = Number(tc.radius_feet) || DEFAULT_RADIUS_FT;
    const pts = await db.query(
      `SELECT latitude, longitude, accuracy, timestamp FROM gps_tracking
        WHERE caregiver_id = $1 AND timestamp BETWEEN $2::timestamptz - INTERVAL '45 minutes' AND $3::timestamptz + INTERVAL '45 minutes'
        ORDER BY timestamp`, [tc.caregiver_id, tc.requested_start, tc.requested_end]);
    const entry = tc.time_entry_id ? (await db.query(`SELECT start_time, end_time, clock_in_location, clock_out_location FROM time_entries WHERE id = $1`, [tc.time_entry_id])).rows[0] : null;
    const dist = (la, ln) => (lat != null && la != null ? distanceFeet(Number(lat), Number(lng), Number(la), Number(ln)) : null);
    const loc = (j) => (j && (j.lat ?? j.latitude) != null ? { lat: Number(j.lat ?? j.latitude), lng: Number(j.lng ?? j.longitude), source: j.source || 'tap' } : null);
    const points = pts.rows.map(p => ({ at: p.timestamp, lat: Number(p.latitude), lng: Number(p.longitude), accuracy: p.accuracy, feet: dist(p.latitude, p.longitude) }));
    const near = (when) => {
      const t0 = new Date(when).getTime();
      const c = points.filter(p => Math.abs(new Date(p.at).getTime() - t0) <= 15 * 60000);
      if (!c.length) return null;
      return c.reduce((a, b) => (Math.abs(new Date(a.at) - t0) <= Math.abs(new Date(b.at) - t0) ? a : b));
    };
    const inside = points.filter(p => p.feet != null && p.feet <= radius);
    const ci = entry && loc(entry.clock_in_location), co = entry && loc(entry.clock_out_location);
    res.json({
      client: { lat, lng, address: [tc.address, tc.city].filter(Boolean).join(', '), geocoded: lat != null },
      radius_feet: radius,
      points,
      summary: {
        total_points: points.length,
        points_at_client: inside.length,
        last_at_client: inside.length ? inside[inside.length - 1].at : null,
        first_at_client: inside.length ? inside[0].at : null,
        near_requested_start: near(tc.requested_start),
        near_requested_end: near(tc.requested_end),
      },
      clock_in: ci ? { ...ci, at: entry.start_time, feet: dist(ci.lat, ci.lng) } : null,
      clock_out: co ? { ...co, at: entry.end_time, feet: dist(co.lat, co.lng) } : null,
      submitted_from: tc.submit_lat != null ? { lat: Number(tc.submit_lat), lng: Number(tc.submit_lng), at: tc.created_at, feet: dist(tc.submit_lat, tc.submit_lng) } : null,
    });
  } catch (e) { sendErr(res, e, 'location'); }
});

// POST /:id/approve { note?, evvReasonCode? } — apply the correction
router.post('/:id/approve', verifyToken, requireAdmin, async (req, res) => {
  const client = await db.pool.connect();
  try {
    const evvReasonCode = req.body.evvReasonCode ? String(req.body.evvReasonCode) : '1';
    if (!EVV_REASON_CODES.includes(evvReasonCode)) throw httpError(400, 'Invalid EVV reason code.');
    const note = String(req.body.note || '').trim().slice(0, 1000) || null;
    if ((evvReasonCode === '5' || evvReasonCode === '8') && !note) throw httpError(400, 'EVV reason 5 or 8 needs a note.');
    await client.query('BEGIN');
    const t = await client.query(`SELECT *, to_char(visit_date, 'YYYY-MM-DD') AS vd FROM time_corrections WHERE id = $1 FOR UPDATE`, [req.params.id]);
    const tc = t.rows[0];
    if (!tc) throw httpError(404, 'Not found.');
    if (tc.status !== 'pending') throw httpError(409, `This request is already ${tc.status}.`);
    const cl = await client.query(
      `SELECT c.is_private_pay, rs.payer_type FROM clients c LEFT JOIN referral_sources rs ON rs.id = c.referral_source_id WHERE c.id = $1`, [tc.client_id]);
    const isPrivatePay = cl.rows[0].is_private_pay === true || cl.rows[0].payer_type === 'private_pay';
    const start = new Date(tc.requested_start), end = new Date(tc.requested_end);

    // Overlap check again — something may have changed since it was submitted.
    const overlap = await client.query(
      `SELECT 1 FROM time_entries WHERE caregiver_id = $1 AND ($2::uuid IS NULL OR id <> $2::uuid)
          AND start_time < $4 AND COALESCE(end_time, NOW()) > $3 LIMIT 1`,
      [tc.caregiver_id, tc.time_entry_id, start.toISOString(), end.toISOString()]);
    if (overlap.rows[0]) throw httpError(409, 'Those times now overlap another of this caregiver\'s visits. Fix that visit first.');

    let entryId = tc.time_entry_id, allotted = null, scheduleId = null;
    if (entryId) {
      const e = await client.query(`SELECT * FROM time_entries WHERE id = $1 FOR UPDATE`, [entryId]);
      if (!e.rows[0]) throw httpError(409, 'The original visit no longer exists.');
      allotted = e.rows[0].allotted_minutes; scheduleId = e.rows[0].schedule_id;
    }
    if (allotted == null) {
      // Match the scheduled visit that day (nearest start), like clock-in does.
      const occ = await client.query(
        `WITH ${SCHEDULE_OCCURRENCES_CTE('occ')}
         SELECT occ.schedule_id, occ.minutes FROM occ WHERE occ.caregiver_id = $3 AND occ.client_id = $4
          ORDER BY ABS(EXTRACT(EPOCH FROM (occ.start_time - ($5::timestamptz AT TIME ZONE 'America/Chicago')::time))) LIMIT 1`,
        [tc.vd, tc.vd, tc.caregiver_id, tc.client_id, start.toISOString()]);
      if (occ.rows[0]) { allotted = occ.rows[0].minutes; scheduleId = scheduleId || occ.rows[0].schedule_id; }
    }
    const bill = computeVisitBilling({ durationSeconds: (end - start) / 1000, allottedMinutes: allotted, isPrivatePay });
    const tag = `[Time corrected by office: ${REASONS[tc.reason]} — "${tc.note.slice(0, 200)}"]`;

    if (entryId) {
      await client.query(
        `UPDATE time_entries
            SET start_time = $1, end_time = $2, is_complete = true, duration_minutes = $3,
                billable_minutes = $4, discrepancy_minutes = $5, schedule_id = COALESCE(schedule_id, $6),
                allotted_minutes = COALESCE(allotted_minutes, $7),
                needs_approval = false, approved_by = $8, approved_at = NOW(), approved_billable_minutes = $4,
                approval_notes = $9,
                notes = CASE WHEN notes IS NULL OR notes = '' THEN $10 ELSE notes || ' | ' || $10 END,
                updated_at = NOW()
          WHERE id = $11`,
        [start.toISOString(), end.toISOString(), bill.durationMinutes, bill.billableMinutes, bill.discrepancyMinutes,
         scheduleId, allotted, req.user.id, note || 'Approved time correction', tag, entryId]);
      await client.query(
        `INSERT INTO visit_time_changes (time_entry_id, changed_by, old_start, new_start, old_end, new_end, reason_code, memo)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [entryId, req.user.id, tc.original_start, start.toISOString(), tc.original_end, end.toISOString(), evvReasonCode,
         (note || `${REASONS[tc.reason]}: ${tc.note}`).slice(0, 256)]);
    } else {
      entryId = uuidv4();
      await client.query(
        `INSERT INTO time_entries (id, caregiver_id, client_id, start_time, end_time, is_complete, duration_minutes,
            billable_minutes, discrepancy_minutes, schedule_id, allotted_minutes, needs_approval, approved_by, approved_at,
            approved_billable_minutes, approval_notes, notes)
         VALUES ($1,$2,$3,$4,$5,true,$6,$7,$8,$9,$10,false,$11,NOW(),$7,$12,$13)`,
        [entryId, tc.caregiver_id, tc.client_id, start.toISOString(), end.toISOString(), bill.durationMinutes,
         bill.billableMinutes, bill.discrepancyMinutes, scheduleId, allotted, req.user.id,
         note || 'Approved missed-visit correction', tag]);
    }
    await client.query(
      `UPDATE time_corrections SET status = 'approved', reviewed_by = $1, reviewed_at = NOW(), review_note = $2,
              evv_reason_code = $3, applied_time_entry_id = $4 WHERE id = $5`,
      [req.user.id, note, evvReasonCode, entryId, tc.id]);
    await client.query('COMMIT');

    await auditLog(req.user.id, 'APPROVE', 'time_corrections', tc.id,
      { start: tc.original_start, end: tc.original_end }, { start: start.toISOString(), end: end.toISOString(), time_entry_id: entryId, billable_minutes: bill.billableMinutes });
    try { const { createEVVFromTimeEntry } = require('./sandataRoutes'); createEVVFromTimeEntry(entryId).catch(e => console.error('[EVV correction]', e.message)); } catch (e) { /* EVV staging is best effort */ }
    const fmt = (d) => d.toLocaleTimeString('en-US', { timeZone: 'America/Chicago', hour: 'numeric', minute: '2-digit' });
    await notify([tc.caregiver_id], 'time_correction_approved', 'Time correction approved',
      `Your times for ${tc.vd} were changed to ${fmt(start)}–${fmt(end)}.`);
    res.json({ ok: true, timeEntryId: entryId, billableMinutes: bill.billableMinutes });
  } catch (e) {
    try { await client.query('ROLLBACK'); } catch (_) { /* nothing open */ }
    sendErr(res, e, 'approve');
  } finally { client.release(); }
});

// POST /:id/deny { note } — the caregiver sees the note
router.post('/:id/deny', verifyToken, requireAdmin, async (req, res) => {
  try {
    const note = String(req.body.note || '').trim().slice(0, 1000);
    if (note.length < 3) throw httpError(400, 'Tell the caregiver why (they will see this).');
    const r = await db.query(
      `UPDATE time_corrections SET status = 'denied', reviewed_by = $1, reviewed_at = NOW(), review_note = $2
        WHERE id = $3 AND status = 'pending' RETURNING caregiver_id, to_char(visit_date, 'YYYY-MM-DD') AS d`, [req.user.id, note, req.params.id]);
    if (!r.rows[0]) throw httpError(409, 'Only pending requests can be denied.');
    await auditLog(req.user.id, 'DENY', 'time_corrections', req.params.id, null, { note });
    await notify([r.rows[0].caregiver_id], 'time_correction_denied', 'Time correction not approved',
      `Your time correction for ${r.rows[0].d} was not approved: ${note}`);
    res.json({ ok: true });
  } catch (e) { sendErr(res, e, 'deny'); }
});

module.exports = router;
module.exports.REASONS = REASONS;
