// routes/rosterOptimizerRoutes.js
// Full-Roster Schedule Optimizer
// Loads ALL active caregivers and clients, builds an optimized schedule
// across the entire workforce. Nothing writes to live schedules until
// the admin explicitly clicks "Apply."

const express = require('express');
const router = express.Router();
const db = require('../db');
const { v4: uuidv4 } = require('uuid');

// ─── GET FULL ROSTER ─────────────────────────────────────────────────────────
// Returns all active caregivers (with their current weekly hours) and
// all active clients (with their required hours/week from assignments or authorizations)
router.get('/roster', async (req, res) => {
  try {
    // All active caregivers with their max hours & current scheduled hours
    const cgRes = await db.query(`
      SELECT
        u.id,
        u.first_name,
        u.last_name,
        u.phone,
        u.hire_date,
        COALESCE(cs.max_hours_per_week, 40) AS max_hours_per_week,
        -- Sum of hours from existing recurring schedules this week
        COALESCE((
          SELECT ROUND(SUM(
            EXTRACT(EPOCH FROM (end_time::time - start_time::time)) / 3600
          )::numeric, 2)
          FROM schedules
          WHERE caregiver_id = u.id
            AND is_active = true
            AND schedule_type = 'recurring'
            AND day_of_week IS NOT NULL
        ), 0) AS current_weekly_hours,
        -- Number of active clients assigned
        COALESCE((
          SELECT COUNT(*)
          FROM client_assignments
          WHERE caregiver_id = u.id AND status = 'active'
        ), 0) AS active_client_count
      FROM users u
      LEFT JOIN (
        SELECT caregiver_id, MAX(max_hours_per_week) AS max_hours_per_week
        FROM caregiver_schedules
        GROUP BY caregiver_id
      ) cs ON cs.caregiver_id = u.id
      WHERE u.role = 'caregiver' AND u.is_active = true
      ORDER BY u.first_name, u.last_name
    `);

    // All active clients with their required hours/week
    const clRes = await db.query(`
      SELECT
        c.id,
        c.first_name,
        c.last_name,
        c.service_type,
        c.address,
        c.city,
        c.preferred_caregivers,
        c.do_not_use_caregivers,
        -- Hours from active assignment
        COALESCE((
          SELECT hours_per_week FROM client_assignments
          WHERE client_id = c.id AND status = 'active'
          ORDER BY assignment_date DESC LIMIT 1
        ), 0) AS assigned_hours_per_week,
        -- Days already scheduled (recurring)
        COALESCE((
          SELECT ARRAY_AGG(DISTINCT day_of_week ORDER BY day_of_week)
          FROM schedules
          WHERE client_id = c.id AND is_active = true
            AND schedule_type = 'recurring' AND day_of_week IS NOT NULL
        ), '{}') AS scheduled_days,
        -- Current caregiver(s)
        COALESCE((
          SELECT ARRAY_AGG(DISTINCT caregiver_id)
          FROM client_assignments
          WHERE client_id = c.id AND status = 'active'
        ), '{}') AS current_caregivers
      FROM clients c
      WHERE c.is_active = true
      ORDER BY c.last_name, c.first_name
    `);

    res.json({
      caregivers: cgRes.rows,
      clients: clRes.rows,
    });
  } catch (err) {
    console.error('Roster fetch error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ─── RUN FULL ROSTER OPTIMIZATION ────────────────────────────────────────────
// Input: array of caregivers [{id, targetHours}] and clients [{id, hoursPerWeek, visitsPerWeek}]
// Reads existing live schedules as context, generates proposals in sandbox only.
router.post('/run', async (req, res) => {
  try {
    const { caregivers: inputCaregivers, clients: inputClients } = req.body;

    if (!inputCaregivers?.length || !inputClients?.length) {
      return res.status(400).json({ error: 'Need at least one caregiver and one client' });
    }

    const cgIds = inputCaregivers.map(c => c.id);
    const clIds = inputClients.map(c => c.id);

    // ── Load full caregiver data ──────────────────────────────────────────
    const cgDataRes = await db.query(
      `SELECT id, first_name, last_name FROM users WHERE id = ANY($1)`,
      [cgIds]
    );
    const cgMap = {};
    cgDataRes.rows.forEach(r => { cgMap[r.id] = r; });

    // ── Load full client data ─────────────────────────────────────────────
    const clDataRes = await db.query(
      `SELECT id, first_name, last_name, preferred_caregivers, do_not_use_caregivers
       FROM clients WHERE id = ANY($1)`,
      [clIds]
    );
    const clMap = {};
    clDataRes.rows.forEach(r => { clMap[r.id] = r; });

    // ── Load all existing recurring schedules for these caregivers ────────
    const existingRes = await db.query(
      `SELECT s.id, s.caregiver_id, s.client_id, s.day_of_week,
              s.start_time::text AS start_time, s.end_time::text AS end_time,
              u.first_name AS cg_first, u.last_name AS cg_last,
              c.first_name AS cl_first, c.last_name AS cl_last
       FROM schedules s
       JOIN users u ON s.caregiver_id = u.id
       JOIN clients c ON s.client_id = c.id
       WHERE s.caregiver_id = ANY($1)
         AND s.is_active = true
         AND s.schedule_type = 'recurring'
         AND s.day_of_week IS NOT NULL
       ORDER BY s.caregiver_id, s.day_of_week, s.start_time`,
      [cgIds]
    );
    const existingSchedules = existingRes.rows;

    // ── Build per-caregiver slot map (day → booked windows) ──────────────
    const cgSlotMap = {};
    cgIds.forEach(id => {
      cgSlotMap[id] = { 0: [], 1: [], 2: [], 3: [], 4: [], 5: [], 6: [] };
    });
    existingSchedules.forEach(s => {
      if (cgSlotMap[s.caregiver_id] && s.day_of_week !== null) {
        cgSlotMap[s.caregiver_id][s.day_of_week].push({
          start: normalizeTime(s.start_time),
          end: normalizeTime(s.end_time),
          clientId: s.client_id,
          clientName: `${s.cl_first} ${s.cl_last}`,
          scheduleId: s.id,
          isExisting: true,
        });
      }
    });

    // ── Caregiver remaining capacity ──────────────────────────────────────
    const cgRemaining = {};
    inputCaregivers.forEach(cg => {
      const existingHrs = existingSchedules
        .filter(s => s.caregiver_id === cg.id)
        .reduce((sum, s) => sum + (toHours(normalizeTime(s.end_time)) - toHours(normalizeTime(s.start_time))), 0);
      cgRemaining[cg.id] = Math.max(0, parseFloat(cg.targetHours) - existingHrs);
    });

    // ── Algorithm ─────────────────────────────────────────────────────────
    const proposals = [];
    const unscheduled = [];
    const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const WEEKDAY_ORDER = [1, 3, 2, 4, 5, 0, 6]; // Mon, Wed, Tue, Thu, Fri, Sun, Sat

    for (const clInput of inputClients) {
      const { id: clId, hoursPerWeek, visitsPerWeek } = clInput;
      const clInfo = clMap[clId];
      if (!clInfo) continue;

      const hrsPerVisit = parseFloat((hoursPerWeek / visitsPerWeek).toFixed(2));
      const visitMins = Math.round(hrsPerVisit * 60);

      // Days this client is already scheduled on
      const existingClientDays = new Set(
        existingSchedules.filter(s => s.client_id === clId).map(s => s.day_of_week)
      );
      const placedDays = new Set(existingClientDays);
      let visitsPlaced = 0;

      // Score and rank caregivers for this client
      const ranked = inputCaregivers
        .map(cg => {
          const isBlocked = Array.isArray(clInfo.do_not_use_caregivers) &&
            clInfo.do_not_use_caregivers.includes(cg.id);
          const isPreferred = Array.isArray(clInfo.preferred_caregivers) &&
            clInfo.preferred_caregivers.includes(cg.id);
          const alreadySees = existingSchedules.some(
            s => s.caregiver_id === cg.id && s.client_id === clId
          );
          return {
            ...cg,
            isBlocked,
            score: isBlocked ? -999 :
              (isPreferred ? 20 : 0) +
              (alreadySees ? 10 : 0) +
              (cgRemaining[cg.id] > 0 ? 5 : 0),
          };
        })
        .filter(cg => !cg.isBlocked)
        .sort((a, b) => b.score - a.score);

      for (let v = 0; v < visitsPerWeek; v++) {
        let placed = false;

        for (const day of WEEKDAY_ORDER) {
          if (placedDays.has(day)) continue;

          for (const cg of ranked) {
            if (cgRemaining[cg.id] < hrsPerVisit - 0.01) continue;

            const daySlots = cgSlotMap[cg.id][day];
            const startTime = findSlot(daySlots, visitMins);
            if (!startTime) continue;

            const endTime = addMins(startTime, visitMins);

            const conflicts = daySlots
              .filter(s => s.isExisting && overlaps(startTime, endTime, s.start, s.end))
              .map(s => ({ clientName: s.clientName, start: s.start, end: s.end }));

            const proposal = {
              id: uuidv4(),
              clientId: clId,
              clientName: `${clInfo.first_name} ${clInfo.last_name}`,
              caregiverId: cg.id,
              caregiverName: `${cgMap[cg.id]?.first_name || ''} ${cgMap[cg.id]?.last_name || ''}`.trim(),
              dayOfWeek: day,
              dayName: DAY_NAMES[day],
              startTime,
              endTime,
              hoursPerVisit: hrsPerVisit,
              hasConflict: conflicts.length > 0,
              conflictsWith: conflicts,
            };

            proposals.push(proposal);

            // Reserve this slot in memory so future assignments avoid it
            cgSlotMap[cg.id][day].push({
              start: startTime,
              end: endTime,
              clientId: clId,
              clientName: `${clInfo.first_name} ${clInfo.last_name}`,
              isExisting: false,
            });

            cgRemaining[cg.id] -= hrsPerVisit;
            placedDays.add(day);
            visitsPlaced++;
            placed = true;
            break;
          }
          if (placed) break;
        }

        if (!placed) {
          const topCg = ranked[0];
          unscheduled.push({
            clientId: clId,
            clientName: `${clInfo.first_name} ${clInfo.last_name}`,
            visitNumber: v + 1,
            reason: topCg && cgRemaining[topCg.id] < hrsPerVisit
              ? 'All caregivers at hour capacity'
              : 'No available time slot found for any caregiver',
          });
        }
      }
    }

    // ── Build summary ─────────────────────────────────────────────────────
    const cgSummary = inputCaregivers.map(cg => {
      const info = cgMap[cg.id] || {};
      const existingHrs = existingSchedules
        .filter(s => s.caregiver_id === cg.id)
        .reduce((sum, s) => sum + (toHours(normalizeTime(s.end_time)) - toHours(normalizeTime(s.start_time))), 0);
      const proposedHrs = proposals
        .filter(p => p.caregiverId === cg.id)
        .reduce((sum, p) => sum + p.hoursPerVisit, 0);
      return {
        id: cg.id,
        name: `${info.first_name || ''} ${info.last_name || ''}`.trim(),
        targetHours: parseFloat(cg.targetHours),
        existingHours: parseFloat(existingHrs.toFixed(2)),
        proposedNewHours: parseFloat(proposedHrs.toFixed(2)),
        totalHours: parseFloat((existingHrs + proposedHrs).toFixed(2)),
        remainingCapacity: parseFloat(cgRemaining[cg.id].toFixed(2)),
        utilizationPct: parseFloat(cg.targetHours) > 0
          ? Math.min(100, Math.round(((existingHrs + proposedHrs) / parseFloat(cg.targetHours)) * 100))
          : 0,
      };
    });

    const clSummary = inputClients.map(cl => {
      const info = clMap[cl.id] || {};
      const placed = proposals.filter(p => p.clientId === cl.id).length;
      return {
        id: cl.id,
        name: `${info.first_name || ''} ${info.last_name || ''}`.trim(),
        visitsNeeded: cl.visitsPerWeek,
        visitsPlaced: placed,
        hoursPerWeek: cl.hoursPerWeek,
        fullyScheduled: placed >= cl.visitsPerWeek,
      };
    });

    res.json({
      proposals,
      existingSchedules: existingSchedules.map(s => ({
        id: s.id,
        caregiverId: s.caregiver_id,
        caregiverName: `${s.cg_first} ${s.cg_last}`,
        clientId: s.client_id,
        clientName: `${s.cl_first} ${s.cl_last}`,
        dayOfWeek: s.day_of_week,
        startTime: normalizeTime(s.start_time),
        endTime: normalizeTime(s.end_time),
      })),
      unscheduled,
      summary: {
        caregivers: cgSummary,
        clients: clSummary,
        totalProposals: proposals.length,
        conflictCount: proposals.filter(p => p.hasConflict).length,
        unscheduledCount: unscheduled.length,
        fullyScheduledClients: clSummary.filter(c => c.fullyScheduled).length,
        totalClients: clSummary.length,
      },
    });
  } catch (err) {
    console.error('Roster optimizer run error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ─── APPLY PROPOSALS → LIVE SCHEDULES ────────────────────────────────────────
router.post('/apply', async (req, res) => {
  try {
    const { proposals } = req.body;
    if (!proposals?.length) return res.status(400).json({ error: 'No proposals to apply' });

    const created = [];
    const errors = [];

    for (const p of proposals) {
      try {
        const id = uuidv4();
        await db.query(
          `INSERT INTO schedules
             (id, caregiver_id, client_id, schedule_type, day_of_week, start_time, end_time, notes, is_active)
           VALUES ($1, $2, $3, 'recurring', $4, $5, $6, $7, true)`,
          [id, p.caregiverId, p.clientId, p.dayOfWeek, p.startTime, p.endTime,
           'Created by Roster Optimizer']
        );
        created.push(id);
      } catch (err) {
        errors.push({ proposal: p, error: err.message });
      }
    }

    res.json({ success: true, created: created.length, errors: errors.length, errorDetails: errors });
  } catch (err) {
    console.error('Roster optimizer apply error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ─── HELPERS ─────────────────────────────────────────────────────────────────

function normalizeTime(t) {
  if (!t) return '08:00';
  // Strip seconds if present e.g. "08:00:00" → "08:00"
  return String(t).slice(0, 5);
}

function toHours(t) {
  if (!t) return 0;
  const [h, m] = t.split(':').map(Number);
  return h + m / 60;
}

function addMins(t, mins) {
  const [h, m] = t.split(':').map(Number);
  const total = h * 60 + m + mins;
  return `${String(Math.floor(total / 60) % 24).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}

function overlaps(aS, aE, bS, bE) {
  return aS < bE && aE > bS;
}

function findSlot(existingSlots, durationMins, windowStart = '08:00', windowEnd = '18:00') {
  const sorted = [...existingSlots].sort((a, b) => a.start.localeCompare(b.start));
  const candidates = [windowStart, ...sorted.map(s => s.end)];

  for (const candidate of candidates) {
    if (candidate >= windowEnd) break;
    const end = addMins(candidate, durationMins);
    if (end > windowEnd) break;
    const conflict = sorted.some(s => overlaps(candidate, end, s.start, s.end));
    if (!conflict) return candidate;
  }
  return null;
}

module.exports = router;
