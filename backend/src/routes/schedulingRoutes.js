// routes/schedulingRoutes.js
// Smart scheduling: suggest-caregivers, auto-fill, conflict check, week view, bulk create, coverage overview
const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const db = require('../db');
const { verifyToken, requireAdmin } = require('../middleware/shared');

// ─── HELPERS ──────────────────────────────────────────────────────────────────

function getWeekStart(date) {
  const d = new Date(date);
  d.setDate(d.getDate() - d.getDay());
  d.setHours(0, 0, 0, 0);
  return d;
}

function calculateDistance(lat1, lon1, lat2, lon2) {
  if (!lat1 || !lon1 || !lat2 || !lon2) return null;
  const R = 3959;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat/2)**2 + Math.cos(lat1*Math.PI/180) * Math.cos(lat2*Math.PI/180) * Math.sin(dLon/2)**2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}

function timesOverlap(s1, e1, s2, e2) {
  return !(e1 <= s2 || s1 >= e2);
}

// Returns { hasAll, missing } for suggest-caregivers
function checkRequiredCerts(caregiverCerts, required) {
  if (!required || required.length === 0) return { hasAll: true, missing: [] };
  const certs = caregiverCerts || [];
  const missing = required.filter(r => !certs.includes(r));
  return { hasAll: missing.length === 0, missing };
}

// Returns boolean for auto-fill
function hasRequiredCerts(caregiverCerts, required) {
  if (!required || required.length === 0) return true;
  const certs = caregiverCerts || [];
  return required.every(r => certs.includes(r));
}

function isScheduleActiveForDate(schedule, targetDate) {
  // Hard lower bound: a recurring shift can never appear before the date it
  // was entered. effective_date wins; created_at is the fallback for legacy
  // rows. No lower bound at all → refuse (prevents back-fill to forever-ago).
  const lowerBound = schedule.effective_date || schedule.created_at;
  if (!lowerBound) return false;
  const lb = new Date(lowerBound); lb.setHours(0,0,0,0);
  const target = new Date(targetDate); target.setHours(0,0,0,0);
  if (target < lb) return false;
  if (schedule.end_date) {
    const ed = new Date(schedule.end_date); ed.setHours(0,0,0,0);
    if (target > ed) return false;
  }
  if (schedule.frequency === 'biweekly' && schedule.anchor_date) {
    const anchor = new Date(schedule.anchor_date);
    const target = new Date(targetDate);
    const diffWeeks = Math.round((target - anchor) / (7 * 24 * 60 * 60 * 1000));
    if (diffWeeks % 2 !== 0) return false;
  }
  return true;
}

// ─── ROUTES ───────────────────────────────────────────────────────────────────

// GET /api/scheduling/conflict-heatmap?weekOf=YYYY-MM-DD
// Returns each active caregiver × 7 days of the requested week with
// scheduled-hours per day vs their per-week capacity. Useful for spotting
// over-allocation (>cap), double-booking, and gaps. One SQL aggregation,
// frontend renders the grid.
router.get('/conflict-heatmap', verifyToken, requireAdmin, async (req, res) => {
  try {
    const weekOf = req.query.weekOf || new Date().toISOString().slice(0, 10);
    // Normalize to week start (Sunday) like getWeekStart in the existing code
    const start = new Date(weekOf + 'T12:00:00Z');
    start.setUTCDate(start.getUTCDate() - start.getUTCDay());
    const startStr = start.toISOString().slice(0, 10);
    const end = new Date(start); end.setUTCDate(end.getUTCDate() + 6);
    const endStr = end.toISOString().slice(0, 10);

    // For each caregiver, sum scheduled hours per day of the requested week.
    // Recurring schedules are matched via day_of_week with effective/end_date
    // bounds; one-time schedules via exact date match.
    const result = await db.query(`
      WITH days AS (
        SELECT generate_series($1::date, $2::date, '1 day'::interval)::date AS d
      ),
      cgs AS (
        SELECT u.id, u.first_name, u.last_name,
          COALESCE(ca.max_hours_per_week, 40) AS max_hours_per_week
        FROM users u
        LEFT JOIN caregiver_availability ca ON ca.caregiver_id = u.id
        WHERE u.role = 'caregiver' AND u.is_active = true
      ),
      sched_hours AS (
        SELECT
          s.caregiver_id, d.d,
          ROUND(SUM(EXTRACT(EPOCH FROM (s.end_time::time - s.start_time::time)) / 3600.0)::numeric, 2) AS hours,
          COUNT(*) AS shift_count
        FROM days d
        JOIN schedules s
          ON s.is_active = true
         AND (
           (s.schedule_type = 'one-time' AND s.date = d.d)
           OR (s.schedule_type = 'recurring' AND s.day_of_week = EXTRACT(DOW FROM d.d)::int
               AND (s.effective_date IS NULL OR d.d >= s.effective_date)
               AND (s.end_date IS NULL OR d.d <= s.end_date))
           OR (s.schedule_type = 'bi-weekly' AND s.day_of_week = EXTRACT(DOW FROM d.d)::int
               AND MOD(((d.d - COALESCE(s.anchor_date, s.effective_date, s.created_at::date))::int / 7), 2) = 0)
         )
        LEFT JOIN schedule_exceptions se
          ON se.schedule_id = s.id AND se.exception_date = d.d AND se.exception_type = 'cancelled'
        WHERE se.id IS NULL
        GROUP BY s.caregiver_id, d.d
      )
      SELECT cgs.id, cgs.first_name, cgs.last_name, cgs.max_hours_per_week,
        d.d AS day,
        COALESCE(sh.hours, 0) AS hours,
        COALESCE(sh.shift_count, 0) AS shift_count
      FROM cgs
      CROSS JOIN days d
      LEFT JOIN sched_hours sh ON sh.caregiver_id = cgs.id AND sh.d = d.d
      ORDER BY cgs.last_name, cgs.first_name, d.d
    `, [startStr, endStr]);

    // Pivot into caregiver-row format the frontend can render directly
    const byCg = new Map();
    for (const r of result.rows) {
      if (!byCg.has(r.id)) {
        byCg.set(r.id, {
          id: r.id, first_name: r.first_name, last_name: r.last_name,
          max_hours_per_week: parseFloat(r.max_hours_per_week),
          days: [], total: 0,
        });
      }
      const cg = byCg.get(r.id);
      cg.days.push({
        date: typeof r.day === 'string' ? r.day : r.day.toISOString().slice(0, 10),
        hours: parseFloat(r.hours),
        shifts: parseInt(r.shift_count),
      });
      cg.total += parseFloat(r.hours);
    }
    const caregivers = Array.from(byCg.values()).sort((a, b) => b.total - a.total);
    res.json({ weekStart: startStr, weekEnd: endStr, caregivers });
  } catch (error) {
    console.error('[conflict-heatmap]', error);
    res.status(500).json({ error: error.message });
  }
});

// GET /api/scheduling/suggest-caregivers
router.get('/suggest-caregivers', verifyToken, async (req, res) => {
  try {
    const { clientId, date, startTime, endTime } = req.query;
    if (!clientId) return res.status(400).json({ error: 'Client ID required' });

    const client = await db.query(`
      SELECT c.id, c.first_name, c.last_name, c.care_type_id, c.latitude, c.longitude,
             c.preferred_caregivers, c.do_not_use_caregivers, c.gender,
             ct.name as care_type_name, ct.required_certifications
      FROM clients c LEFT JOIN care_types ct ON c.care_type_id = ct.id
      WHERE c.id = $1
    `, [clientId]);
    if (client.rows.length === 0) return res.status(404).json({ error: 'Client not found' });

    const clientData = client.rows[0];
    const requiredCerts = clientData.required_certifications || [];
    const shiftHours = startTime && endTime
      ? (new Date(`2000-01-01T${endTime}`) - new Date(`2000-01-01T${startTime}`)) / (1000 * 60 * 60) : 4;

    // Day-of-week + time-of-day availability check uses caregiver_availability
    // {monday|...|sunday}_{available|start_time|end_time}
    const dow = date ? new Date(date + 'T12:00:00Z').getUTCDay() : null;
    const dayMap = ['sunday','monday','tuesday','wednesday','thursday','friday','saturday'];
    const dayCol = dow != null ? dayMap[dow] : null;
    const availableCol  = dayCol ? `ca.${dayCol}_available`  : 'NULL::boolean';
    const startTimeCol  = dayCol ? `ca.${dayCol}_start_time` : 'NULL::time';
    const endTimeCol    = dayCol ? `ca.${dayCol}_end_time`   : 'NULL::time';

    const caregivers = await db.query(`
      SELECT u.id, u.first_name, u.last_name, u.phone, u.default_pay_rate,
             u.latitude, u.longitude, u.certifications, u.gender,
             ca.status as availability_status, ca.max_hours_per_week,
             ${availableCol} AS day_available,
             ${startTimeCol} AS day_start_time,
             ${endTimeCol}   AS day_end_time,
             ARRAY_AGG(DISTINCT cc.certification_name)
               FILTER (WHERE cc.certification_name IS NOT NULL AND (cc.expiration_date IS NULL OR cc.expiration_date > CURRENT_DATE))
               as active_certifications,
             (SELECT EXISTS (SELECT 1 FROM caregiver_blackout_dates b
                WHERE b.caregiver_id = u.id
                  AND $1::date IS NOT NULL
                  AND b.start_date <= $1::date AND b.end_date >= $1::date)) AS is_blacked_out
      FROM users u
      LEFT JOIN caregiver_availability ca ON u.id = ca.caregiver_id
      LEFT JOIN caregiver_certifications cc ON u.id = cc.caregiver_id
      WHERE u.role = 'caregiver' AND u.is_active = true
      GROUP BY u.id, u.first_name, u.last_name, u.phone, u.default_pay_rate, u.gender,
               u.latitude, u.longitude, u.certifications, ca.status, ca.max_hours_per_week,
               ${availableCol}, ${startTimeCol}, ${endTimeCol}
      ORDER BY u.first_name
    `, [date || null]);

    const weekStart = date ? getWeekStart(new Date(date)) : getWeekStart(new Date());
    const weekEnd = new Date(weekStart); weekEnd.setDate(weekEnd.getDate() + 6);

    const [hoursResult, historyResult, conflictsResult] = await Promise.all([
      db.query(`SELECT caregiver_id, SUM(EXTRACT(EPOCH FROM (end_time::time - start_time::time))/3600) as weekly_hours FROM schedules WHERE is_active=true AND (date>=$1 AND date<=$2 OR day_of_week IS NOT NULL) GROUP BY caregiver_id`,
        [weekStart.toISOString().split('T')[0], weekEnd.toISOString().split('T')[0]]),
      db.query(`SELECT caregiver_id, COUNT(*) as visit_count FROM time_entries WHERE client_id=$1 AND is_complete=true GROUP BY caregiver_id`, [clientId]),
      date && startTime && endTime
        ? db.query(`SELECT DISTINCT caregiver_id FROM schedules WHERE is_active=true AND (date=$1 OR day_of_week=EXTRACT(DOW FROM $1::date)::int) AND NOT (end_time<=$2 OR start_time>=$3)`, [date, startTime, endTime])
        : Promise.resolve({ rows: [] }),
    ]);

    const hoursMap = {}; hoursResult.rows.forEach(r => hoursMap[r.caregiver_id] = parseFloat(r.weekly_hours)||0);
    const historyMap = {}; historyResult.rows.forEach(r => historyMap[r.caregiver_id] = parseInt(r.visit_count)||0);
    const conflictIds = new Set(conflictsResult.rows.map(r => r.caregiver_id));

    // Client preferences — DNU is a hard exclude, preferred gets a big boost
    const preferredIds = new Set((clientData.preferred_caregivers || []).map(String));
    const dnuIds       = new Set((clientData.do_not_use_caregivers || []).map(String));

    const toMin = (t) => { if (!t) return null; const [h, m] = String(t).split(':').map(Number); return h * 60 + (m || 0); };
    const shiftStart = toMin(startTime);
    const shiftEnd   = toMin(endTime);

    const ranked = caregivers.rows.map(cg => {
      const weeklyHours = hoursMap[cg.id] || 0;
      const maxHours = cg.max_hours_per_week || 40;
      const visitCount = historyMap[cg.id] || 0;
      const hasConflict = conflictIds.has(cg.id);
      const isAvailable = cg.availability_status !== 'unavailable';
      const wouldExceedHours = (weeklyHours + shiftHours) > maxHours;
      const approachingOvertime = weeklyHours > 35;
      const distance = calculateDistance(cg.latitude, cg.longitude, clientData.latitude, clientData.longitude);
      const estimatedDriveTime = distance ? Math.round(distance * 2) : null;
      const certCheck = checkRequiredCerts(cg.active_certifications, requiredCerts);

      const isPreferred = preferredIds.has(String(cg.id));
      const isDnu       = dnuIds.has(String(cg.id));
      const isBlackedOut = cg.is_blacked_out === true;

      // Day-of-week + time-of-day availability check
      const cgAvailStart = toMin(cg.day_start_time);
      const cgAvailEnd   = toMin(cg.day_end_time);
      const dayAvailable = cg.day_available === true;
      const timeFitsWindow = (cgAvailStart != null && cgAvailEnd != null && shiftStart != null && shiftEnd != null)
        ? (shiftStart >= cgAvailStart && shiftEnd <= cgAvailEnd)
        : null; // unknown — don't penalize

      let score = 100;

      // Hard exclusions: massive negative so they sink to the bottom
      if (isDnu)        score -= 1000;
      if (isBlackedOut) score -= 1000;
      if (hasConflict)  score -= 200;
      if (!isAvailable) score -= 200;

      // Preferred caregiver = big positive
      if (isPreferred)  score += 60;

      // History / continuity (capped so a single super-familiar caregiver
      // doesn't dominate when distance/cert are bad)
      score += Math.min(visitCount * 3, 30);

      // Capacity load — prefer caregivers below 70% of cap
      score -= (weeklyHours / maxHours) * 20;
      if (wouldExceedHours)     score -= 50;
      if (approachingOvertime)  score -= 10;

      // Distance
      if (distance !== null) {
        if (distance <= 5) score += 20;
        else if (distance <= 10) score += 10;
        else if (distance <= 20) score += 5;
        else if (distance > 30) score -= 15;
      }

      // Cert match
      if (!certCheck.hasAll) score -= 40;

      // Day-of-week availability window from caregiver_availability
      if (dayCol) {
        if (dayAvailable === false) score -= 50;
        else if (timeFitsWindow === true) score += 15;
        else if (timeFitsWindow === false) score -= 20;
      }

      const reasons = [];
      if (isDnu) reasons.push('🚫 Client do-not-use list');
      if (isBlackedOut) reasons.push('🚫 PTO/blackout on this date');
      if (isPreferred) reasons.push('⭐ Preferred caregiver');
      if (visitCount > 5) reasons.push(`✓ Familiar (${visitCount} visits)`);
      else if (visitCount > 0) reasons.push(`${visitCount} prior visits`);
      if (hasConflict) reasons.push('⚠️ Conflicting shift');
      if (!isAvailable) reasons.push('⚠️ Marked unavailable');
      if (wouldExceedHours) reasons.push('⚠️ Exceeds max hours');
      else if (approachingOvertime) reasons.push(`⚠️ ${weeklyHours.toFixed(0)}h this week`);
      else if (weeklyHours < 20) reasons.push('✓ Has availability');
      if (dayCol && dayAvailable === false) reasons.push(`⚠️ Not available ${dayMap[dow]}s`);
      else if (timeFitsWindow === true) reasons.push('✓ Time fits availability window');
      else if (timeFitsWindow === false) reasons.push('⚠️ Outside availability window');
      if (distance !== null) {
        if (distance <= 5) reasons.push(`✓ Nearby (${distance.toFixed(1)} mi)`);
        else if (distance <= 15) reasons.push(`${distance.toFixed(1)} mi away`);
        else if (distance > 20) reasons.push(`⚠️ Far (${distance.toFixed(1)} mi)`);
      }
      if (!certCheck.hasAll) reasons.push(`⚠️ Missing certs: ${certCheck.missing.join(', ')}`);
      else if (requiredCerts.length > 0) reasons.push('✓ Has required certs');

      // Tier label for the UI to badge cleanly
      let tier;
      if (score >= 130) tier = 'excellent';
      else if (score >= 100) tier = 'good';
      else if (score >= 60) tier = 'maybe';
      else tier = 'avoid';

      return {
        ...cg,
        weeklyHours: weeklyHours.toFixed(2), maxHours,
        visitCount, hasConflict, isAvailable, isPreferred, isDnu, isBlackedOut,
        wouldExceedHours, approachingOvertime,
        distance: distance ? distance.toFixed(1) : null, estimatedDriveTime,
        hasRequiredSkills: certCheck.hasAll, missingCertifications: certCheck.missing,
        score: Math.round(score), tier, reasons,
      };
    });

    // Filter out DNU/blacked-out from the default response (still in DB if
    // caller asks with ?includeBlocked=true)
    const blockedFiltered = req.query.includeBlocked === 'true'
      ? ranked
      : ranked.filter(c => !c.isDnu && !c.isBlackedOut);

    blockedFiltered.sort((a, b) => b.score - a.score);
    const ranked_out = blockedFiltered;
    res.json({ client: clientData, suggestions: ranked_out, shiftHours, requiredCertifications: requiredCerts });
  } catch (error) {
    console.error('Suggest caregivers error:', error);
    res.status(500).json({ error: error.message });
  }
});

// POST /api/scheduling/auto-fill
router.post('/auto-fill', verifyToken, requireAdmin, async (req, res) => {
  try {
    const { startDate, endDate, dryRun = false } = req.body;
    const start = startDate || new Date().toISOString().split('T')[0];
    const end = endDate || (() => { const d = new Date(); d.setDate(d.getDate()+7); return d.toISOString().split('T')[0]; })();

    const openShifts = await db.query(`
      SELECT os.*, c.first_name as client_first, c.last_name as client_last,
             c.care_type_id, c.latitude as client_lat, c.longitude as client_lng, ct.required_certifications
      FROM open_shifts os JOIN clients c ON os.client_id=c.id LEFT JOIN care_types ct ON c.care_type_id=ct.id
      WHERE os.status='open' AND os.shift_date>=$1 AND os.shift_date<=$2
      ORDER BY os.urgency DESC, os.shift_date ASC, os.start_time ASC
    `, [start, end]);

    if (openShifts.rows.length === 0) return res.json({ success: true, message: 'No open shifts to fill', filled: 0, failed: 0, results: [] });

    const caregivers = await db.query(`
      SELECT u.id, u.first_name, u.last_name, u.latitude, u.longitude,
             ca.status as availability_status, ca.max_hours_per_week,
             ARRAY_AGG(DISTINCT cc.certification_name) FILTER (WHERE cc.certification_name IS NOT NULL AND (cc.expiration_date IS NULL OR cc.expiration_date > CURRENT_DATE)) as active_certifications
      FROM users u
      LEFT JOIN caregiver_availability ca ON u.id=ca.caregiver_id
      LEFT JOIN caregiver_certifications cc ON u.id=cc.caregiver_id
      WHERE u.role='caregiver' AND u.is_active=true AND (ca.status IS NULL OR ca.status!='unavailable')
      GROUP BY u.id, u.first_name, u.last_name, u.latitude, u.longitude, ca.status, ca.max_hours_per_week
    `);

    const weekStart = getWeekStart(new Date(start));
    const weekEnd = new Date(weekStart); weekEnd.setDate(weekEnd.getDate()+6);
    const hoursResult = await db.query(`SELECT caregiver_id, SUM(EXTRACT(EPOCH FROM (end_time::time - start_time::time))/3600) as weekly_hours FROM schedules WHERE is_active=true AND (date>=$1 AND date<=$2 OR day_of_week IS NOT NULL) GROUP BY caregiver_id`, [weekStart.toISOString().split('T')[0], weekEnd.toISOString().split('T')[0]]);
    const historyResult = await db.query(`SELECT caregiver_id, client_id, COUNT(*) as visit_count FROM time_entries WHERE is_complete=true GROUP BY caregiver_id, client_id`);

    const hoursMap = {}; hoursResult.rows.forEach(r => hoursMap[r.caregiver_id] = parseFloat(r.weekly_hours)||0);
    const historyMap = {}; historyResult.rows.forEach(r => { if (!historyMap[r.client_id]) historyMap[r.client_id]={}; historyMap[r.client_id][r.caregiver_id]=parseInt(r.visit_count)||0; });

    const newAssignments = [], results = [];
    let filled = 0, failed = 0;

    for (const shift of openShifts.rows) {
      const shiftHours = (new Date(`2000-01-01T${shift.end_time}`) - new Date(`2000-01-01T${shift.start_time}`)) / (1000*60*60);
      const requiredCerts = shift.required_certifications || [];
      const clientHistory = historyMap[shift.client_id] || {};
      // Conflict check must include recurring patterns that fall on this
      // weekday — previously only checked exact-date one-offs, missing
      // recurring conflicts and double-booking caregivers.
      const existingConflicts = await db.query(
        `SELECT DISTINCT caregiver_id FROM schedules
          WHERE is_active = true
            AND (date = $1::date OR day_of_week = EXTRACT(DOW FROM $1::date)::int)
            AND NOT (end_time <= $2 OR start_time >= $3)`,
        [shift.shift_date, shift.start_time, shift.end_time]
      );
      const conflictingIds = existingConflicts.rows.map(r => r.caregiver_id);

      // Auth check — once per shift (per client), not per caregiver
      const { checkAuthorizationBalance } = require('../helpers/authorizationCheck');
      const shiftAuthCheck = await checkAuthorizationBalance(shift.client_id, shiftHours);
      if (!shiftAuthCheck.allowed) {
        results.push({ shiftId: shift.id, client: `${shift.client_first} ${shift.client_last}`, date: shift.shift_date, time: `${shift.start_time} - ${shift.end_time}`, status: 'unfilled', reason: 'Authorization exhausted' });
        failed++;
        continue;
      }

      const scored = caregivers.rows.map(cg => {
        const weeklyHours = hoursMap[cg.id] || 0;
        const maxHours = cg.max_hours_per_week || 40;
        const visitCount = clientHistory[cg.id] || 0;
        const additionalHours = newAssignments.filter(a => a.caregiverId===cg.id).reduce((s,a) => s + (new Date(`2000-01-01T${a.endTime}`) - new Date(`2000-01-01T${a.startTime}`))/(1000*60*60), 0);
        const projectedHours = weeklyHours + additionalHours;
        const hasConflict = conflictingIds.includes(cg.id) || newAssignments.some(a => a.caregiverId===cg.id && a.date===shift.shift_date && timesOverlap(a.startTime, a.endTime, shift.start_time, shift.end_time));
        const wouldExceedHours = (projectedHours + shiftHours) > maxHours;
        const wouldExceedOvertime = (projectedHours + shiftHours) > 40;
        const distance = calculateDistance(cg.latitude, cg.longitude, shift.client_lat, shift.client_lng);
        const hasCerts = hasRequiredCerts(cg.active_certifications, requiredCerts);
        if (hasConflict || wouldExceedHours || !hasCerts) return { ...cg, score: -1000, disqualified: true, reason: hasConflict ? 'conflict' : !hasCerts ? 'missing_certs' : 'exceeds_hours' };
        let score = 100 + Math.min(visitCount*3,30) - (projectedHours/maxHours)*20;
        if (wouldExceedOvertime) score -= 15;
        if (distance !== null) { if (distance<=5) score+=20; else if (distance<=10) score+=10; else if (distance<=20) score+=5; else if (distance>30) score-=15; }
        return { ...cg, score, disqualified: false, distance, visitCount, projectedHours };
      });

      scored.sort((a,b) => b.score - a.score);
      const bestMatch = scored.find(s => !s.disqualified);

      if (bestMatch) {
        const shiftResult = { shiftId: shift.id, client: `${shift.client_first} ${shift.client_last}`, date: shift.shift_date, time: `${shift.start_time} - ${shift.end_time}`, assignedTo: `${bestMatch.first_name} ${bestMatch.last_name}`, caregiverId: bestMatch.id, score: Math.round(bestMatch.score), distance: bestMatch.distance ? `${bestMatch.distance.toFixed(1)} mi` : 'N/A', familiarity: bestMatch.visitCount > 0 ? `${bestMatch.visitCount} visits` : 'New' };
        if (!dryRun) {
          const scheduleId = uuidv4();
          await db.query(`INSERT INTO schedules (id, caregiver_id, client_id, schedule_type, date, start_time, end_time, notes) VALUES ($1,$2,$3,'one-time',$4,$5,$6,$7)`, [scheduleId, bestMatch.id, shift.client_id, shift.shift_date, shift.start_time, shift.end_time, 'Auto-assigned']);
          await db.query(`UPDATE open_shifts SET status='filled', claimed_by=$1, claimed_at=NOW() WHERE id=$2`, [bestMatch.id, shift.id]);
          shiftResult.scheduleId = scheduleId;
        }
        newAssignments.push({ caregiverId: bestMatch.id, date: shift.shift_date, startTime: shift.start_time, endTime: shift.end_time });
        hoursMap[bestMatch.id] = (hoursMap[bestMatch.id]||0) + shiftHours;
        results.push({ ...shiftResult, status: 'filled' });
        filled++;
      } else {
        results.push({ shiftId: shift.id, client: `${shift.client_first} ${shift.client_last}`, date: shift.shift_date, time: `${shift.start_time} - ${shift.end_time}`, status: 'unfilled', reason: 'No available caregivers', candidates: scored.filter(s=>s.disqualified).slice(0,3).map(c=>({ name: `${c.first_name} ${c.last_name}`, reason: c.reason })) });
        failed++;
      }
    }

    res.json({ success: true, dryRun, message: dryRun ? `Preview: Would fill ${filled} of ${openShifts.rows.length} shifts` : `Filled ${filled} of ${openShifts.rows.length} shifts`, filled, failed, total: openShifts.rows.length, results });
  } catch (error) {
    console.error('Auto-fill error:', error);
    res.status(500).json({ error: error.message });
  }
});

// POST /api/scheduling/check-conflicts
router.post('/check-conflicts', verifyToken, async (req, res) => {
  try {
    const { caregiverId, date, startTime, endTime } = req.body;
    if (!caregiverId || !startTime || !endTime) return res.status(400).json({ error: 'Missing required fields' });
    const dayOfWeek = date ? new Date(date).getDay() : null;
    const result = await db.query(`
      SELECT s.*, c.first_name as client_first_name, c.last_name as client_last_name
      FROM schedules s LEFT JOIN clients c ON s.client_id=c.id
      WHERE s.caregiver_id=$1 AND s.is_active=true AND NOT (s.end_time<=$2 OR s.start_time>=$3)
        AND (s.date=$4 OR s.day_of_week=$5)
    `, [caregiverId, startTime, endTime, date, dayOfWeek]);
    res.json({ hasConflict: result.rows.length > 0, conflicts: result.rows.map(s => ({ id: s.id, clientName: `${s.client_first_name} ${s.client_last_name}`, startTime: s.start_time, endTime: s.end_time, isRecurring: s.day_of_week !== null })) });
  } catch (error) { res.status(500).json({ error: error.message }); }
});

// POST /api/scheduling/check-weekly-hours — OT warning at schedule time
router.post('/check-weekly-hours', verifyToken, async (req, res) => {
  try {
    const { caregiverId, date, startTime, endTime } = req.body;
    if (!caregiverId || !startTime || !endTime) return res.status(400).json({ error: 'Missing required fields' });

    const targetDate = date ? new Date(date + 'T12:00:00') : new Date();
    const weekStart = new Date(targetDate); weekStart.setDate(targetDate.getDate() - targetDate.getDay()); weekStart.setHours(0,0,0,0);
    const weekEnd = new Date(weekStart); weekEnd.setDate(weekEnd.getDate() + 6); weekEnd.setHours(23,59,59,999);
    const wsStr = weekStart.toISOString().split('T')[0];
    const weStr = weekEnd.toISOString().split('T')[0];

    const [oneTime, recurring, avail, cgName] = await Promise.all([
      db.query(`SELECT SUM(EXTRACT(EPOCH FROM (end_time::time - start_time::time))/3600) as hours FROM schedules WHERE caregiver_id=$1 AND is_active=true AND date>=$2 AND date<=$3`, [caregiverId, wsStr, weStr]),
      db.query(`SELECT SUM(EXTRACT(EPOCH FROM (end_time::time - start_time::time))/3600) as hours FROM schedules WHERE caregiver_id=$1 AND is_active=true AND day_of_week IS NOT NULL`, [caregiverId]),
      db.query(`SELECT max_hours_per_week FROM caregiver_availability WHERE caregiver_id=$1`, [caregiverId]),
      db.query(`SELECT first_name, last_name FROM users WHERE id=$1`, [caregiverId]),
    ]);

    const currentHours = (parseFloat(oneTime.rows[0]?.hours) || 0) + (parseFloat(recurring.rows[0]?.hours) || 0);
    const proposedHours = (new Date(`2000-01-01T${endTime}`) - new Date(`2000-01-01T${startTime}`)) / (1000 * 60 * 60);
    const projectedHours = currentHours + proposedHours;
    const maxHours = avail.rows[0]?.max_hours_per_week || 40;
    const overtimeHours = Math.max(0, projectedHours - 40);
    const name = cgName.rows[0] ? `${cgName.rows[0].first_name} ${cgName.rows[0].last_name}` : 'Caregiver';

    const warnings = [];
    if (projectedHours > maxHours) {
      warnings.push(`${name} will exceed max hours: ${projectedHours.toFixed(1)}h / ${maxHours}h limit`);
    }
    if (overtimeHours > 0) {
      warnings.push(`This puts ${name} at ${projectedHours.toFixed(1)}h this week (${overtimeHours.toFixed(1)}h overtime)`);
    } else if (projectedHours > 35) {
      warnings.push(`${name} approaching overtime: ${projectedHours.toFixed(1)}h this week`);
    }

    res.json({ currentWeeklyHours: parseFloat(currentHours.toFixed(2)), proposedHours: parseFloat(proposedHours.toFixed(2)), projectedHours: parseFloat(projectedHours.toFixed(2)), maxHours, overtimeHours: parseFloat(overtimeHours.toFixed(2)), warnings, caregiverName: name });
  } catch (error) { res.status(500).json({ error: error.message }); }
});

// POST /api/scheduling/check-travel-time — Travel time warning for back-to-back shifts
router.post('/check-travel-time', verifyToken, async (req, res) => {
  try {
    const { caregiverId, clientId, date, startTime, endTime } = req.body;
    if (!caregiverId || !clientId || !date || !startTime || !endTime) return res.status(400).json({ error: 'Missing required fields' });

    // Get proposed client location
    const proposedClient = await db.query(`SELECT first_name, last_name, latitude, longitude FROM clients WHERE id=$1`, [clientId]);
    if (!proposedClient.rows[0]?.latitude) return res.json({ hasTravelConflict: false, adjacentShifts: [], note: 'Client has no GPS coordinates set' });

    const pLat = parseFloat(proposedClient.rows[0].latitude);
    const pLng = parseFloat(proposedClient.rows[0].longitude);

    // Get all caregiver shifts on same day
    const dayOfWeek = new Date(date + 'T12:00:00').getDay();
    const dayShifts = await db.query(`
      SELECT s.start_time, s.end_time, s.client_id,
        c.first_name as client_first, c.last_name as client_last,
        c.latitude as client_lat, c.longitude as client_lng
      FROM schedules s JOIN clients c ON s.client_id = c.id
      WHERE s.caregiver_id = $1 AND s.is_active = true
        AND (s.date = $2 OR s.day_of_week = $3)
        AND s.client_id != $4
      ORDER BY s.start_time
    `, [caregiverId, date, dayOfWeek, clientId]);

    const adjacentShifts = [];
    for (const shift of dayShifts.rows) {
      if (!shift.client_lat || !shift.client_lng) continue;

      const sLat = parseFloat(shift.client_lat);
      const sLng = parseFloat(shift.client_lng);
      const distance = calculateDistance(pLat, pLng, sLat, sLng);
      if (distance === null) continue;

      const estimatedDriveMinutes = Math.round(distance * 2); // rough estimate

      // Check if this shift is adjacent (ends before proposed starts, or starts after proposed ends)
      let gapMinutes = null;
      if (shift.end_time <= startTime) {
        // This shift ends before proposed starts
        gapMinutes = (new Date(`2000-01-01T${startTime}`) - new Date(`2000-01-01T${shift.end_time}`)) / 60000;
      } else if (shift.start_time >= endTime) {
        // This shift starts after proposed ends
        gapMinutes = (new Date(`2000-01-01T${shift.start_time}`) - new Date(`2000-01-01T${endTime}`)) / 60000;
      }

      if (gapMinutes !== null && gapMinutes < 120) { // only flag if gap < 2 hours
        adjacentShifts.push({
          clientName: `${shift.client_first} ${shift.client_last}`,
          startTime: shift.start_time,
          endTime: shift.end_time,
          distanceMiles: parseFloat(distance.toFixed(1)),
          estimatedDriveMinutes,
          gapMinutes: Math.round(gapMinutes),
          isInsufficient: estimatedDriveMinutes > gapMinutes
        });
      }
    }

    res.json({
      hasTravelConflict: adjacentShifts.some(s => s.isInsufficient),
      adjacentShifts
    });
  } catch (error) { res.status(500).json({ error: error.message }); }
});

// GET /api/scheduling/week-view
router.get('/week-view', verifyToken, async (req, res) => {
  try {
    const { weekOf } = req.query;
    const weekStart = weekOf ? getWeekStart(new Date(weekOf)) : getWeekStart(new Date());
    const weekEnd = new Date(weekStart); weekEnd.setDate(weekEnd.getDate()+6);
    const wsStr = weekStart.toISOString().split('T')[0];
    const weStr = weekEnd.toISOString().split('T')[0];

    const [caregivers, schedules] = await Promise.all([
      db.query(`SELECT id, first_name, last_name FROM users WHERE role='caregiver' AND is_active=true ORDER BY first_name`),
      db.query(`SELECT s.*, c.first_name as client_first_name, c.last_name as client_last_name FROM schedules s LEFT JOIN clients c ON s.client_id=c.id WHERE s.is_active=true AND (s.date>=$1 AND s.date<=$2 OR s.day_of_week IS NOT NULL) ORDER BY s.start_time`, [wsStr, weStr]),
    ]);

    // Load exceptions for any recurring schedules in this week, keyed by schedule_id + date
    const recurringIds = schedules.rows
      .filter(s => s.day_of_week !== null && s.day_of_week !== undefined)
      .map(s => s.id);
    const excByKey = {};
    if (recurringIds.length > 0) {
      try {
        const excResult = await db.query(
          `SELECT * FROM schedule_exceptions
           WHERE schedule_id = ANY($1) AND exception_date >= $2 AND exception_date <= $3`,
          [recurringIds, wsStr, weStr]
        );
        excResult.rows.forEach(ex => {
          const dateStr = (ex.exception_date instanceof Date ? ex.exception_date.toISOString().split('T')[0] : String(ex.exception_date)).slice(0,10);
          excByKey[`${ex.schedule_id}|${dateStr}`] = ex;
        });
      } catch (e) {
        if (!e.message.includes('does not exist')) throw e;
      }
    }

    const weekData = {};
    caregivers.rows.forEach(cg => { weekData[cg.id] = { caregiver: cg, days: { 0:[], 1:[], 2:[], 3:[], 4:[], 5:[], 6:[] } }; });
    const toDateStr = (d) => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
    schedules.rows.forEach(s => {
      if (s.date) {
        if (!weekData[s.caregiver_id]) return;
        weekData[s.caregiver_id].days[new Date(s.date).getDay()].push({ ...s, isRecurring: false });
        return;
      }
      if (s.day_of_week === null || s.day_of_week === undefined) return;
      const dayDate = new Date(weekStart); dayDate.setDate(dayDate.getDate() + s.day_of_week);
      if (!isScheduleActiveForDate(s, dayDate)) return;
      const exc = excByKey[`${s.id}|${toDateStr(dayDate)}`];
      if (exc && exc.exception_type === 'cancelled') return;
      const effectiveCaregiverId = (exc && exc.override_caregiver_id) || s.caregiver_id;
      if (!weekData[effectiveCaregiverId]) return;
      const item = (exc && exc.exception_type === 'modified')
        ? { ...s,
            caregiver_id: effectiveCaregiverId,
            start_time: exc.override_start_time || s.start_time,
            end_time: exc.override_end_time || s.end_time,
            client_id: exc.override_client_id || s.client_id,
            notes: exc.override_notes != null ? exc.override_notes : s.notes,
            isRecurring: true }
        : { ...s, isRecurring: true };
      weekData[effectiveCaregiverId].days[s.day_of_week].push(item);
    });
    res.json({ weekStart: wsStr, weekEnd: weStr, caregivers: Object.values(weekData) });
  } catch (error) { res.status(500).json({ error: error.message }); }
});

// POST /api/scheduling/bulk-create
router.post('/bulk-create', verifyToken, requireAdmin, async (req, res) => {
  try {
    const { caregiverId, clientId, template, weeks, startDate, notes } = req.body;
    if (!caregiverId || !clientId || !template?.length) return res.status(400).json({ error: 'Missing required fields' });

    // Authorization check for total weekly hours
    const { checkAuthorizationBalance } = require('../helpers/authorizationCheck');
    const weeklyHours = template.reduce((sum, slot) => {
      return sum + (new Date(`2000-01-01T${slot.endTime}`) - new Date(`2000-01-01T${slot.startTime}`)) / (1000*60*60);
    }, 0);
    const authCheck = await checkAuthorizationBalance(clientId, weeklyHours);
    if (!authCheck.allowed && req.query.force !== 'true') {
      return res.status(400).json({ error: authCheck.error, authorization: authCheck.authorization, type: 'authorization' });
    }

    const numWeeks = Math.min(Math.max(parseInt(weeks)||4, 1), 12);
    const start = startDate ? new Date(startDate) : new Date();
    start.setDate(start.getDate() - start.getDay());
    const created = [], conflicts = [];
    for (let week = 0; week < numWeeks; week++) {
      for (const slot of template) {
        const slotDate = new Date(start); slotDate.setDate(slotDate.getDate() + (week*7) + slot.dayOfWeek);
        if (slotDate < new Date()) continue;
        const dateStr = slotDate.toISOString().split('T')[0];
        const conflict = await db.query(`SELECT id FROM schedules WHERE caregiver_id=$1 AND is_active=true AND date=$2 AND NOT (end_time<=$3 OR start_time>=$4)`, [caregiverId, dateStr, slot.startTime, slot.endTime]);
        if (conflict.rows.length > 0) { conflicts.push({ date: dateStr, startTime: slot.startTime }); continue; }
        const scheduleId = uuidv4();
        const result = await db.query(`INSERT INTO schedules (id, caregiver_id, client_id, schedule_type, date, start_time, end_time, notes) VALUES ($1,$2,$3,'one-time',$4,$5,$6,$7) RETURNING *`, [scheduleId, caregiverId, clientId, dateStr, slot.startTime, slot.endTime, notes||null]);
        created.push(result.rows[0]);
      }
    }
    res.json({ success: true, created: created.length, skippedConflicts: conflicts.length, conflicts, authWarnings: authCheck.warnings });
  } catch (error) { res.status(500).json({ error: error.message }); }
});

// GET /api/scheduling/caregiver-hours/:caregiverId
router.get('/caregiver-hours/:caregiverId', verifyToken, async (req, res) => {
  try {
    const { caregiverId } = req.params;
    const now = new Date();
    const weekStart = new Date(now); weekStart.setDate(now.getDate()-now.getDay()); weekStart.setHours(0,0,0,0);
    const weekEnd = new Date(weekStart); weekEnd.setDate(weekEnd.getDate()+6); weekEnd.setHours(23,59,59,999);
    const wsStr = weekStart.toISOString().split('T')[0]; const weStr = weekEnd.toISOString().split('T')[0];
    const [oneTime, recurring, avail] = await Promise.all([
      db.query(`SELECT SUM(EXTRACT(EPOCH FROM (end_time::time - start_time::time))/3600) as hours FROM schedules WHERE caregiver_id=$1 AND is_active=true AND date>=$2 AND date<=$3`, [caregiverId, wsStr, weStr]),
      db.query(`SELECT SUM(EXTRACT(EPOCH FROM (end_time::time - start_time::time))/3600) as hours FROM schedules WHERE caregiver_id=$1 AND is_active=true AND day_of_week IS NOT NULL`, [caregiverId]),
      db.query(`SELECT max_hours_per_week FROM caregiver_availability WHERE caregiver_id=$1`, [caregiverId]),
    ]);
    const oneTimeHours = parseFloat(oneTime.rows[0]?.hours)||0;
    const recurringHours = parseFloat(recurring.rows[0]?.hours)||0;
    const totalHours = oneTimeHours + recurringHours;
    const maxHours = avail.rows[0]?.max_hours_per_week || 40;
    res.json({ totalHours: totalHours.toFixed(2), oneTimeHours: oneTimeHours.toFixed(2), recurringHours: recurringHours.toFixed(2), maxHours, remainingHours: Math.max(0, maxHours-totalHours).toFixed(2), approachingOvertime: totalHours > 35 });
  } catch (error) { res.status(500).json({ error: error.message }); }
});

// GET /api/scheduling/coverage-overview
router.get('/coverage-overview', verifyToken, requireAdmin, async (req, res) => {
  try {
    const { weekOf } = req.query;
    const now = weekOf ? new Date(weekOf+'T12:00:00') : new Date();
    const weekStart = new Date(now); weekStart.setDate(now.getDate()-now.getDay()); weekStart.setHours(0,0,0,0);
    const weekEnd = new Date(weekStart); weekEnd.setDate(weekEnd.getDate()+6); weekEnd.setHours(23,59,59,999);
    const wsStr = weekStart.toISOString().split('T')[0]; const weStr = weekEnd.toISOString().split('T')[0];

    const [caregiversResult, clientsResult] = await Promise.all([
      db.query(`SELECT u.id, u.first_name, u.last_name, COALESCE(ca.max_hours_per_week,40) as max_hours, COALESCE(ca.status,'available') as availability_status,
        (SELECT COALESCE(SUM(EXTRACT(EPOCH FROM (s.end_time::time - s.start_time::time))/3600),0) FROM schedules s WHERE s.caregiver_id=u.id AND s.is_active=true AND ((s.date>=$1 AND s.date<=$2) OR s.day_of_week IS NOT NULL)) as scheduled_hours
        FROM users u LEFT JOIN caregiver_availability ca ON u.id=ca.caregiver_id WHERE u.role='caregiver' AND u.is_active=true ORDER BY u.first_name, u.last_name`, [wsStr, weStr]),
      db.query(`SELECT c.id, c.first_name, c.last_name, c.weekly_authorized_units,
        (SELECT COALESCE(SUM(EXTRACT(EPOCH FROM (s.end_time::time - s.start_time::time))/3600),0) FROM schedules s WHERE s.client_id=c.id AND s.is_active=true AND ((s.date>=$1 AND s.date<=$2) OR s.day_of_week IS NOT NULL)) as scheduled_hours
        FROM clients c WHERE c.is_active=true ORDER BY c.first_name, c.last_name`, [wsStr, weStr]),
    ]);

    const caregivers = caregiversResult.rows.map(cg => {
      const maxHours = parseFloat(cg.max_hours)||40; const scheduledHours = parseFloat(cg.scheduled_hours)||0;
      return { id: cg.id, name: `${cg.first_name} ${cg.last_name}`, maxHours, scheduledHours, remainingHours: Math.max(0, maxHours-scheduledHours), utilizationPercent: Math.round((scheduledHours/maxHours)*100), status: cg.availability_status };
    });
    const clientsWithUnits = clientsResult.rows.filter(cl => cl.weekly_authorized_units && parseInt(cl.weekly_authorized_units)>0).map(cl => {
      const authorizedUnits = parseInt(cl.weekly_authorized_units)||0; const authorizedHours = authorizedUnits*0.25;
      const scheduledHours = parseFloat(cl.scheduled_hours)||0; const scheduledUnits = Math.round(scheduledHours*4);
      const shortfallUnits = Math.max(0, authorizedUnits-scheduledUnits);
      return { id: cl.id, name: `${cl.first_name} ${cl.last_name}`, authorizedUnits, authorizedHours, scheduledUnits, scheduledHours, shortfallUnits, shortfallHours: shortfallUnits*0.25, coveragePercent: authorizedUnits>0 ? Math.round((scheduledUnits/authorizedUnits)*100) : 0, isUnderScheduled: shortfallUnits>0 };
    });
    const underScheduledClients = clientsWithUnits.filter(cl => cl.isUnderScheduled);
    res.json({ weekStart: wsStr, weekEnd: weStr, caregivers, clientsWithUnits, underScheduledClients, summary: { totalCaregivers: caregivers.length, totalScheduledHours: caregivers.reduce((s,cg)=>s+cg.scheduledHours,0).toFixed(2), totalAvailableHours: caregivers.reduce((s,cg)=>s+cg.maxHours,0).toFixed(2), underScheduledClientCount: underScheduledClients.length, totalShortfallUnits: underScheduledClients.reduce((s,cl)=>s+cl.shortfallUnits,0), totalShortfallHours: underScheduledClients.reduce((s,cl)=>s+cl.shortfallHours,0).toFixed(2) } });
  } catch (error) { res.status(500).json({ error: error.message }); }
});

// GET /api/absences/my
router.get('/absences/my', verifyToken, async (req, res) => {
  try {
    res.json((await db.query(`SELECT * FROM absences WHERE caregiver_id=$1 ORDER BY created_at DESC`, [req.user.id])).rows);
  } catch (error) { res.status(500).json({ error: error.message }); }
});

module.exports = router;
