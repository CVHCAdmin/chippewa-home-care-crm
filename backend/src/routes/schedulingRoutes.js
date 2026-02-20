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
  if (schedule.effective_date) {
    const effDate = new Date(schedule.effective_date); effDate.setHours(0,0,0,0);
    const target = new Date(targetDate); target.setHours(0,0,0,0);
    if (target < effDate) return false;
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

// GET /api/scheduling/suggest-caregivers
router.get('/suggest-caregivers', verifyToken, async (req, res) => {
  try {
    const { clientId, date, startTime, endTime } = req.query;
    if (!clientId) return res.status(400).json({ error: 'Client ID required' });

    const client = await db.query(`
      SELECT c.id, c.first_name, c.last_name, c.care_type_id, c.latitude, c.longitude,
             ct.name as care_type_name, ct.required_certifications
      FROM clients c LEFT JOIN care_types ct ON c.care_type_id = ct.id
      WHERE c.id = $1
    `, [clientId]);
    if (client.rows.length === 0) return res.status(404).json({ error: 'Client not found' });

    const clientData = client.rows[0];
    const requiredCerts = clientData.required_certifications || [];
    const shiftHours = startTime && endTime
      ? (new Date(`2000-01-01T${endTime}`) - new Date(`2000-01-01T${startTime}`)) / (1000 * 60 * 60) : 4;

    const caregivers = await db.query(`
      SELECT u.id, u.first_name, u.last_name, u.phone, u.default_pay_rate,
             u.latitude, u.longitude, u.certifications,
             ca.status as availability_status, ca.max_hours_per_week,
             ARRAY_AGG(DISTINCT cc.certification_name)
               FILTER (WHERE cc.certification_name IS NOT NULL AND (cc.expiration_date IS NULL OR cc.expiration_date > CURRENT_DATE))
               as active_certifications
      FROM users u
      LEFT JOIN caregiver_availability ca ON u.id = ca.caregiver_id
      LEFT JOIN caregiver_certifications cc ON u.id = cc.caregiver_id
      WHERE u.role = 'caregiver' AND u.is_active = true
      GROUP BY u.id, u.first_name, u.last_name, u.phone, u.default_pay_rate,
               u.latitude, u.longitude, u.certifications, ca.status, ca.max_hours_per_week
      ORDER BY u.first_name
    `);

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

      let score = 100;
      score += Math.min(visitCount * 3, 30);
      if (!isAvailable) score -= 100;
      if (hasConflict) score -= 100;
      score -= (weeklyHours / maxHours) * 20;
      if (wouldExceedHours) score -= 50;
      if (approachingOvertime) score -= 10;
      if (distance !== null) { if (distance <= 5) score += 20; else if (distance <= 10) score += 10; else if (distance <= 20) score += 5; else if (distance > 30) score -= 15; }
      if (!certCheck.hasAll) score -= 40;

      const reasons = [];
      if (visitCount > 5) reasons.push(`✓ Familiar (${visitCount} visits)`);
      else if (visitCount > 0) reasons.push(`${visitCount} prior visits`);
      if (hasConflict) reasons.push('⚠️ Conflict');
      if (!isAvailable) reasons.push('⚠️ Unavailable');
      if (wouldExceedHours) reasons.push('⚠️ Exceeds max hours');
      else if (approachingOvertime) reasons.push(`⚠️ ${weeklyHours.toFixed(0)}h this week`);
      else if (weeklyHours < 20) reasons.push('✓ Has availability');
      if (distance !== null) { if (distance <= 5) reasons.push(`✓ Nearby (${distance.toFixed(1)} mi)`); else if (distance <= 15) reasons.push(`${distance.toFixed(1)} mi away`); else if (distance > 20) reasons.push(`⚠️ Far (${distance.toFixed(1)} mi)`); }
      if (!certCheck.hasAll) reasons.push(`⚠️ Missing: ${certCheck.missing.join(', ')}`);
      else if (requiredCerts.length > 0) reasons.push('✓ Has required certs');

      return { ...cg, weeklyHours: weeklyHours.toFixed(2), maxHours, visitCount, hasConflict, isAvailable, wouldExceedHours, approachingOvertime, distance: distance ? distance.toFixed(1) : null, estimatedDriveTime, hasRequiredSkills: certCheck.hasAll, missingCertifications: certCheck.missing, score: Math.round(score), reasons };
    });

    ranked.sort((a, b) => b.score - a.score);
    res.json({ client: clientData, suggestions: ranked, shiftHours, requiredCertifications: requiredCerts });
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
      const existingConflicts = await db.query(`SELECT DISTINCT caregiver_id FROM schedules WHERE is_active=true AND date=$1 AND NOT (end_time<=$2 OR start_time>=$3)`, [shift.shift_date, shift.start_time, shift.end_time]);
      const conflictingIds = existingConflicts.rows.map(r => r.caregiver_id);

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
          await db.query(`UPDATE open_shifts SET status='filled', filled_by=$1, filled_at=NOW() WHERE id=$2`, [bestMatch.id, shift.id]);
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

    const weekData = {};
    caregivers.rows.forEach(cg => { weekData[cg.id] = { caregiver: cg, days: { 0:[], 1:[], 2:[], 3:[], 4:[], 5:[], 6:[] } }; });
    schedules.rows.forEach(s => {
      if (!weekData[s.caregiver_id]) return;
      if (s.date) { weekData[s.caregiver_id].days[new Date(s.date).getDay()].push({ ...s, isRecurring: false }); }
      else if (s.day_of_week !== null) {
        const dayDate = new Date(weekStart); dayDate.setDate(dayDate.getDate() + s.day_of_week);
        if (isScheduleActiveForDate(s, dayDate)) weekData[s.caregiver_id].days[s.day_of_week].push({ ...s, isRecurring: true });
      }
    });
    res.json({ weekStart: wsStr, weekEnd: weStr, caregivers: Object.values(weekData) });
  } catch (error) { res.status(500).json({ error: error.message }); }
});

// POST /api/scheduling/bulk-create
router.post('/bulk-create', verifyToken, requireAdmin, async (req, res) => {
  try {
    const { caregiverId, clientId, template, weeks, startDate, notes } = req.body;
    if (!caregiverId || !clientId || !template?.length) return res.status(400).json({ error: 'Missing required fields' });
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
    res.json({ success: true, created: created.length, skippedConflicts: conflicts.length, conflicts });
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
