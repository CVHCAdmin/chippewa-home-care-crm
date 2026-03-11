// routes/optimizerRoutes.js
// Schedule Optimizer — sandbox scheduling that reads existing data but writes nothing
// until admin explicitly applies the proposal.

const express = require('express');
const router = express.Router();
const db = require('../db');
const { v4: uuidv4 } = require('uuid');

// ─── GET CLIENT OPTIMIZER DATA ────────────────────────────────────────────────
// Returns active authorization (units→hours) + existing schedule info for a client
router.get('/client-data/:clientId', async (req, res) => {
  try {
    const { clientId } = req.params;

    // Get client info
    const clientRes = await db.query(
      `SELECT id, first_name, last_name, preferred_caregivers, do_not_use_caregivers, service_type,
              weekly_authorized_units, service_days_per_week, service_allowed_days
       FROM clients WHERE id = $1`,
      [clientId]
    );
    if (clientRes.rows.length === 0) return res.status(404).json({ error: 'Client not found' });
    const client = clientRes.rows[0];

    // Get active authorization
    const authRes = await db.query(
      `SELECT authorized_units, used_units, unit_type, start_date, end_date,
              authorized_units - used_units as remaining_units
       FROM authorizations
       WHERE client_id = $1 AND status = 'active'
         AND start_date <= CURRENT_DATE AND end_date >= CURRENT_DATE
       ORDER BY end_date ASC LIMIT 1`,
      [clientId]
    );

    const auth = authRes.rows[0] || null;
    let authorizedHoursPerWeek = 0;
    let remainingHours = 0;

    if (auth) {
      // Calculate weekly hours from authorization period
      const startDate = new Date(auth.start_date);
      const endDate = new Date(auth.end_date);
      const weeks = Math.max(1, Math.round((endDate - startDate) / (7 * 24 * 60 * 60 * 1000)));
      const totalHours = auth.unit_type === '15min'
        ? parseFloat(auth.authorized_units) / 4
        : parseFloat(auth.authorized_units); // assume hours if not 15min
      const remainingTotalHours = auth.unit_type === '15min'
        ? parseFloat(auth.remaining_units) / 4
        : parseFloat(auth.remaining_units);
      authorizedHoursPerWeek = parseFloat((totalHours / weeks).toFixed(2));
      remainingHours = parseFloat(remainingTotalHours.toFixed(2));
    }

    // Get existing recurring schedules for this client
    const schedRes = await db.query(
      `SELECT s.day_of_week, s.start_time, s.end_time, s.caregiver_id,
              u.first_name as caregiver_first, u.last_name as caregiver_last
       FROM schedules s
       JOIN users u ON s.caregiver_id = u.id
       WHERE s.client_id = $1 AND s.is_active = true
         AND s.schedule_type = 'recurring' AND s.day_of_week IS NOT NULL
       ORDER BY s.day_of_week, s.start_time`,
      [clientId]
    );

    // Use weekly_authorized_units from client record as primary source
    const clientWeeklyUnits = parseFloat(client.weekly_authorized_units) || 0;
    const assignedHoursPerWeek = clientWeeklyUnits || authorizedHoursPerWeek || null;

    res.json({
      client,
      authorization: auth,
      authorizedHoursPerWeek: clientWeeklyUnits || authorizedHoursPerWeek,
      remainingHours,
      assignedHoursPerWeek,
      serviceDaysPerWeek: client.service_days_per_week || null,
      serviceAllowedDays: client.service_allowed_days || null,
      existingScheduleDays: schedRes.rows.map(r => r.day_of_week),
      existingSchedules: schedRes.rows,
    });
  } catch (err) {
    console.error('Optimizer client-data error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ─── RUN OPTIMIZER ────────────────────────────────────────────────────────────
// Core algorithm: constraint-based schedule builder
// Input: selectedCaregivers [{id, allocatedHours}], selectedClients [{id, visitsPerWeek, hoursPerWeek}]
// Reads existing schedules, builds proposed assignments, flags conflicts
router.post('/run', async (req, res) => {
  try {
    const { caregivers: selectedCaregivers, clients: selectedClients } = req.body;

    if (!selectedCaregivers?.length || !selectedClients?.length) {
      return res.status(400).json({ error: 'Must provide at least one caregiver and one client' });
    }

    const caregiverIds = selectedCaregivers.map(c => c.id);
    const clientIds = selectedClients.map(c => c.id);

    // ── 1. Load existing schedules for ALL selected caregivers ──────────────
    const existingRes = await db.query(
      `SELECT s.id, s.caregiver_id, s.client_id, s.day_of_week, s.start_time, s.end_time,
              s.schedule_type, s.frequency,
              u.first_name as cg_first, u.last_name as cg_last,
              c.first_name as cl_first, c.last_name as cl_last
       FROM schedules s
       JOIN users u ON s.caregiver_id = u.id
       JOIN clients c ON s.client_id = c.id
       WHERE s.caregiver_id = ANY($1) AND s.is_active = true
         AND s.schedule_type = 'recurring' AND s.day_of_week IS NOT NULL
       ORDER BY s.caregiver_id, s.day_of_week, s.start_time`,
      [caregiverIds]
    );
    const existingSchedules = existingRes.rows;

    // ── 2. Load client data (preferred caregivers, do_not_use) ──────────────
    const clientDataRes = await db.query(
      `SELECT id, first_name, last_name, preferred_caregivers, do_not_use_caregivers
       FROM clients WHERE id = ANY($1)`,
      [clientIds]
    );
    const clientMap = {};
    clientDataRes.rows.forEach(c => { clientMap[c.id] = c; });

    // ── 3. Load caregiver data ───────────────────────────────────────────────
    const cgDataRes = await db.query(
      `SELECT u.id, u.first_name, u.last_name,
              a.monday_available, a.tuesday_available, a.wednesday_available,
              a.thursday_available, a.friday_available, a.saturday_available, a.sunday_available,
              a.monday_start_time, a.tuesday_start_time, a.wednesday_start_time,
              a.thursday_start_time, a.friday_start_time, a.saturday_start_time, a.sunday_start_time,
              a.monday_end_time, a.tuesday_end_time, a.wednesday_end_time,
              a.thursday_end_time, a.friday_end_time, a.saturday_end_time, a.sunday_end_time,
              a.monday_preferred_start, a.tuesday_preferred_start, a.wednesday_preferred_start,
              a.thursday_preferred_start, a.friday_preferred_start, a.saturday_preferred_start, a.sunday_preferred_start,
              a.monday_preferred_end, a.tuesday_preferred_end, a.wednesday_preferred_end,
              a.thursday_preferred_end, a.friday_preferred_end, a.saturday_preferred_end, a.sunday_preferred_end
       FROM users u
       LEFT JOIN caregiver_availability a ON a.caregiver_id = u.id
       WHERE u.id = ANY($1)`,
      [caregiverIds]
    );
    const cgMap = {};
    cgDataRes.rows.forEach(cg => { cgMap[cg.id] = cg; });

    // ── 3b. Apply per-caregiver preferred shift overrides from request ─────
    // If the admin sets a preferred shift on the optimizer screen, apply it
    // to all days, overriding the per-day DB values for this run.
    const AVAIL_KEYS_ALL = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
    selectedCaregivers.forEach(cg => {
      if (cg.preferredStart && cg.preferredEnd && cgMap[cg.id]) {
        AVAIL_KEYS_ALL.forEach(dayKey => {
          cgMap[cg.id][`${dayKey}_preferred_start`] = cg.preferredStart;
          cgMap[cg.id][`${dayKey}_preferred_end`] = cg.preferredEnd;
        });
      }
    });

    // ── 4. Build caregiver schedule map: {cgId: {dayOfWeek: [{start, end}]}} ─
    const cgScheduleMap = {};
    caregiverIds.forEach(id => { cgScheduleMap[id] = { 0: [], 1: [], 2: [], 3: [], 4: [], 5: [], 6: [] }; });
    existingSchedules.forEach(s => {
      if (cgScheduleMap[s.caregiver_id] && s.day_of_week !== null) {
        cgScheduleMap[s.caregiver_id][s.day_of_week].push({
          start: s.start_time,
          end: s.end_time,
          clientId: s.client_id,
          clientName: `${s.cl_first} ${s.cl_last}`,
          scheduleId: s.id,
          isExisting: true
        });
      }
    });

    // ── 5. Track remaining hours per caregiver ───────────────────────────────
    const cgRemainingHours = {};
    selectedCaregivers.forEach(cg => {
      // Subtract hours already booked in existing recurring schedules
      let alreadyBooked = 0;
      existingSchedules.filter(s => s.caregiver_id === cg.id).forEach(s => {
        alreadyBooked += timeToHours(s.end_time) - timeToHours(s.start_time);
      });
      cgRemainingHours[cg.id] = Math.max(0, parseFloat(cg.allocatedHours) - alreadyBooked);
    });

    // ── 5b. Build caregiver preferred-days map (session-only override) ──
    const cgPreferredDaysMap = {};
    selectedCaregivers.forEach(cg => {
      if (Array.isArray(cg.preferredDays) && cg.preferredDays.length > 0) {
        cgPreferredDaysMap[cg.id] = new Set(cg.preferredDays);
      }
    });

    // ── 6. Run optimization: assign each client's visits ────────────────────
    const proposals = [];
    const conflicts = [];
    const unscheduled = [];
    const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const AVAIL_KEYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
    const DEFAULT_START = '08:00';

    for (const clientCfg of selectedClients) {
      const { id: clientId, visitsPerWeek, hoursPerWeek, preferredDays: clientPreferredDays, timeWindowStart, timeWindowEnd } = clientCfg;
      const clientInfo = clientMap[clientId];
      if (!clientInfo) continue;

      const hoursPerVisit = parseFloat((hoursPerWeek / visitsPerWeek).toFixed(2));
      const visitDurationMins = Math.round(hoursPerVisit * 60);

      // Days already used for this client in existing schedules
      const clientExistingDays = existingSchedules
        .filter(s => s.client_id === clientId)
        .map(s => s.day_of_week);

      // Track days we've already placed a visit for this client (this run)
      const clientPlacedDays = new Set(clientExistingDays);
      let visitsPlaced = 0;

      // Score caregivers for this client
      const scoredCaregivers = selectedCaregivers.map(cg => {
        const info = clientInfo;
        const isPreferred = Array.isArray(info.preferred_caregivers) && info.preferred_caregivers.includes(cg.id);
        const isBlocked = Array.isArray(info.do_not_use_caregivers) && info.do_not_use_caregivers.includes(cg.id);
        // Check if this caregiver already sees this client
        const alreadySees = existingSchedules.some(s => s.caregiver_id === cg.id && s.client_id === clientId);
        return {
          ...cg,
          score: isBlocked ? -999 : (isPreferred ? 10 : 0) + (alreadySees ? 5 : 0),
          isBlocked
        };
      }).filter(cg => !cg.isBlocked).sort((a, b) => b.score - a.score);

      // Use client preferred days if set, otherwise default order
      const tryDays = (Array.isArray(clientPreferredDays) && clientPreferredDays.length > 0)
        ? clientPreferredDays
        : [1, 3, 2, 4, 5, 0, 6]; // Mon, Wed, Tue, Thu, Fri, Sun, Sat — prefer weekdays

      for (let visit = 0; visit < visitsPerWeek && visitsPlaced < visitsPerWeek; visit++) {
        let placed = false;

        for (const day of tryDays) {
          if (clientPlacedDays.has(day)) continue; // skip days already used

          for (const cg of scoredCaregivers) {
            if (cgRemainingHours[cg.id] < hoursPerVisit - 0.01) continue; // not enough hours

            // If caregiver has preferred days set for this run, skip non-preferred days
            if (cgPreferredDaysMap[cg.id] && !cgPreferredDaysMap[cg.id].has(day)) continue;

            // Check caregiver availability
            const cgInfo = cgMap[cg.id];
            const dayKey = AVAIL_KEYS[day];
            const isAvailable = cgInfo ? (cgInfo[`${dayKey}_available`] !== false) : true;
            if (!isAvailable) continue;

            // Find a non-conflicting start time for this day
            const daySlots = cgScheduleMap[cg.id][day];
            const startTime = findAvailableSlot(daySlots, visitDurationMins, cgInfo, day, timeWindowStart, timeWindowEnd);
            if (!startTime) continue;

            const endTime = addMinutes(startTime, visitDurationMins);

            // Check if this overlaps with any existing schedule
            const overlap = daySlots.filter(slot => slot.isExisting &&
              timesOverlap(startTime, endTime, slot.start, slot.end));

            const proposal = {
              id: uuidv4(),
              clientId,
              clientName: `${clientInfo.first_name} ${clientInfo.last_name}`,
              caregiverId: cg.id,
              caregiverName: `${cgMap[cg.id]?.first_name || ''} ${cgMap[cg.id]?.last_name || ''}`.trim(),
              dayOfWeek: day,
              dayName: DAY_NAMES[day],
              startTime,
              endTime,
              hoursPerVisit,
              hasConflict: overlap.length > 0,
              conflictsWith: overlap.map(o => ({
                scheduleId: o.scheduleId,
                clientName: o.clientName,
                start: o.start,
                end: o.end,
                suggestion: `Consider moving ${o.clientName} to another time slot`
              })),
              isNew: !clientExistingDays.includes(day)
            };

            proposals.push(proposal);

            // Register this slot so subsequent assignments avoid it
            cgScheduleMap[cg.id][day].push({
              start: startTime,
              end: endTime,
              clientId,
              clientName: `${clientInfo.first_name} ${clientInfo.last_name}`,
              isExisting: false
            });

            cgRemainingHours[cg.id] -= hoursPerVisit;
            clientPlacedDays.add(day);
            visitsPlaced++;
            placed = true;
            break;
          }
          if (placed) break;
        }

        if (!placed) {
          // Couldn't place this visit — log it
          unscheduled.push({
            clientId,
            clientName: `${clientInfo.first_name} ${clientInfo.last_name}`,
            visitNumber: visit + 1,
            reason: cgRemainingHours[scoredCaregivers[0]?.id] < hoursPerVisit
              ? 'Caregivers at hour capacity'
              : 'No available time slots found'
          });
        }
      }
    }

    // ── 7. Build summary ─────────────────────────────────────────────────────
    const summary = {
      caregivers: selectedCaregivers.map(cg => {
        const cgInfo = cgMap[cg.id];
        const name = `${cgInfo?.first_name || ''} ${cgInfo?.last_name || ''}`.trim();
        const proposedHours = proposals
          .filter(p => p.caregiverId === cg.id)
          .reduce((sum, p) => sum + p.hoursPerVisit, 0);
        const existingHours = existingSchedules
          .filter(s => s.caregiver_id === cg.id)
          .reduce((sum, s) => sum + (timeToHours(s.end_time) - timeToHours(s.start_time)), 0);
        return {
          id: cg.id,
          name,
          allocatedHours: parseFloat(cg.allocatedHours),
          existingHours: parseFloat(existingHours.toFixed(2)),
          proposedNewHours: parseFloat(proposedHours.toFixed(2)),
          totalHours: parseFloat((existingHours + proposedHours).toFixed(2)),
          remainingHours: parseFloat(cgRemainingHours[cg.id].toFixed(2))
        };
      }),
      clients: selectedClients.map(cl => {
        const clientInfo = clientMap[cl.id];
        const name = `${clientInfo?.first_name || ''} ${clientInfo?.last_name || ''}`.trim();
        const placedVisits = proposals.filter(p => p.clientId === cl.id).length;
        return {
          id: cl.id,
          name,
          visitsNeeded: cl.visitsPerWeek,
          visitsPlaced: placedVisits,
          hoursPerWeek: cl.hoursPerWeek,
          fullyScheduled: placedVisits >= cl.visitsPerWeek
        };
      }),
      totalProposals: proposals.length,
      conflictCount: proposals.filter(p => p.hasConflict).length,
      unscheduledCount: unscheduled.length
    };

    res.json({
      proposals,
      existingSchedules: existingSchedules.map(s => ({
        id: s.id,
        caregiverId: s.caregiver_id,
        caregiverName: `${s.cg_first} ${s.cg_last}`,
        clientId: s.client_id,
        clientName: `${s.cl_first} ${s.cl_last}`,
        dayOfWeek: s.day_of_week,
        startTime: s.start_time,
        endTime: s.end_time
      })),
      unscheduled,
      summary
    });
  } catch (err) {
    console.error('Optimizer run error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ─── APPLY PROPOSALS ─────────────────────────────────────────────────────────
// Writes approved proposals to the real schedules table
router.post('/apply', async (req, res) => {
  try {
    const { proposals, createdBy } = req.body;
    if (!proposals?.length) return res.status(400).json({ error: 'No proposals to apply' });

    const created = [];
    const errors = [];

    for (const p of proposals) {
      try {
        const id = uuidv4();
        await db.query(
          `INSERT INTO schedules
             (id, caregiver_id, client_id, schedule_type, day_of_week, start_time, end_time, notes, is_active)
           VALUES ($1, $2, $3, 'recurring', $4, $5, $6, $7, true)
           RETURNING id`,
          [id, p.caregiverId, p.clientId, p.dayOfWeek, p.startTime, p.endTime,
           `Created by Schedule Optimizer`]
        );
        created.push(id);
      } catch (err) {
        errors.push({ proposal: p, error: err.message });
      }
    }

    res.json({
      success: true,
      created: created.length,
      errors: errors.length,
      errorDetails: errors
    });
  } catch (err) {
    console.error('Optimizer apply error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ─── HELPERS ─────────────────────────────────────────────────────────────────

function timeToHours(timeStr) {
  if (!timeStr) return 0;
  const [h, m] = timeStr.split(':').map(Number);
  return h + m / 60;
}

function addMinutes(timeStr, minutes) {
  const [h, m] = timeStr.split(':').map(Number);
  const total = h * 60 + m + minutes;
  const nh = Math.floor(total / 60) % 24;
  const nm = total % 60;
  return `${String(nh).padStart(2, '0')}:${String(nm).padStart(2, '0')}`;
}

function timesOverlap(aStart, aEnd, bStart, bEnd) {
  return aStart < bEnd && aEnd > bStart;
}

// Find the first non-conflicting start time for a slot of `durationMins` on a given day.
// Priority order:
//   1) Intersection of client time window + caregiver preferred hours
//   2) Client time window within caregiver full availability
//   3) Caregiver preferred hours (if no client window)
//   4) Full caregiver availability window
function findAvailableSlot(existingSlots, durationMins, cgInfo, dayOfWeek, clientWindowStart, clientWindowEnd) {
  const AVAIL_KEYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
  const dayKey = AVAIL_KEYS[dayOfWeek];

  // Caregiver full availability window for this day (default 08:00–18:00)
  const cgStart = cgInfo?.[`${dayKey}_start_time`] || '08:00';
  const cgEnd = cgInfo?.[`${dayKey}_end_time`] || '18:00';

  // Caregiver preferred hours (subset of availability, may be null)
  const cgPrefStart = cgInfo?.[`${dayKey}_preferred_start`];
  const cgPrefEnd = cgInfo?.[`${dayKey}_preferred_end`];

  const hasClientWindow = clientWindowStart && clientWindowEnd;
  const hasCgPref = cgPrefStart && cgPrefEnd;

  const sorted = [...existingSlots].sort((a, b) => a.start.localeCompare(b.start));

  function tryWindow(wStart, wEnd) {
    if (wStart >= wEnd) return null;
    const candidates = [wStart, ...sorted.map(s => s.end)];
    for (const candidate of candidates) {
      if (candidate < wStart) continue;
      if (candidate >= wEnd) break;
      const proposed_end = addMinutes(candidate, durationMins);
      if (proposed_end > wEnd) break;
      const hasConflict = sorted.some(s => timesOverlap(candidate, proposed_end, s.start, s.end));
      if (!hasConflict) return candidate;
    }
    return null;
  }

  // Intersect two time windows
  function intersect(aStart, aEnd, bStart, bEnd) {
    const s = aStart > bStart ? aStart : bStart;
    const e = aEnd < bEnd ? aEnd : bEnd;
    return s < e ? [s, e] : null;
  }

  // 1) Best case: client window + caregiver preferred
  if (hasClientWindow && hasCgPref) {
    const inter = intersect(clientWindowStart, clientWindowEnd, cgPrefStart, cgPrefEnd);
    if (inter) { const slot = tryWindow(inter[0], inter[1]); if (slot) return slot; }
  }

  // 2) Client window within caregiver full availability
  if (hasClientWindow) {
    const inter = intersect(clientWindowStart, clientWindowEnd, cgStart, cgEnd);
    if (inter) { const slot = tryWindow(inter[0], inter[1]); if (slot) return slot; }
  }

  // 3) Caregiver preferred hours (no client constraint)
  if (hasCgPref) {
    const slot = tryWindow(cgPrefStart, cgPrefEnd);
    if (slot) return slot;
  }

  // 4) Full caregiver availability window
  return tryWindow(cgStart, cgEnd);
}

module.exports = router;
