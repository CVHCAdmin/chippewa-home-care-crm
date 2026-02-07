// routes/matchingRoutes.js
// Smart Matching: Capabilities, Needs, Restrictions, Company-wide Optimizer
// Uses iterative swap optimization (not greedy) for globally optimal assignments
const express = require('express');
const router = express.Router();
const db = require('../db');
const { v4: uuidv4 } = require('uuid');

// ════════════════════════════════════════════════════════════
// SERVICE CAPABILITIES (Master list)
// ════════════════════════════════════════════════════════════

router.get('/capabilities', async (req, res) => {
  try {
    const result = await db.query(
      `SELECT * FROM service_capabilities WHERE is_active = true ORDER BY category, sort_order, name`
    );
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/capabilities', async (req, res) => {
  try {
    const { name, category, description, icon } = req.body;
    if (!name || !category) return res.status(400).json({ error: 'name and category required' });
    const result = await db.query(
      `INSERT INTO service_capabilities (name, category, description, icon)
       VALUES ($1, $2, $3, $4) RETURNING *`,
      [name, category, description || null, icon || '📋']
    );
    res.status(201).json(result.rows[0]);
  } catch (error) {
    if (error.code === '23505') return res.status(409).json({ error: 'Capability already exists' });
    res.status(500).json({ error: error.message });
  }
});

router.delete('/capabilities/:id', async (req, res) => {
  try {
    await db.query(`UPDATE service_capabilities SET is_active = false WHERE id = $1`, [req.params.id]);
    res.json({ message: 'Capability deactivated' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ════════════════════════════════════════════════════════════
// CAREGIVER CAPABILITIES
// ════════════════════════════════════════════════════════════

router.get('/caregiver/:caregiverId/capabilities', async (req, res) => {
  try {
    const result = await db.query(`
      SELECT cc.*, sc.name, sc.category, sc.icon, sc.description as cap_description
      FROM caregiver_capabilities cc
      JOIN service_capabilities sc ON cc.capability_id = sc.id
      WHERE cc.caregiver_id = $1 AND sc.is_active = true
      ORDER BY sc.category, sc.sort_order
    `, [req.params.caregiverId]);
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.put('/caregiver/:caregiverId/capabilities', async (req, res) => {
  try {
    const { capabilities } = req.body;
    if (!Array.isArray(capabilities)) return res.status(400).json({ error: 'capabilities array required' });
    const caregiverId = req.params.caregiverId;
    await db.query(`DELETE FROM caregiver_capabilities WHERE caregiver_id = $1`, [caregiverId]);
    for (const cap of capabilities) {
      await db.query(
        `INSERT INTO caregiver_capabilities (caregiver_id, capability_id, proficiency, notes)
         VALUES ($1, $2, $3, $4)`,
        [caregiverId, cap.capabilityId, cap.proficiency || 'capable', cap.notes || null]
      );
    }
    const result = await db.query(`
      SELECT cc.*, sc.name, sc.category, sc.icon
      FROM caregiver_capabilities cc
      JOIN service_capabilities sc ON cc.capability_id = sc.id
      WHERE cc.caregiver_id = $1 AND sc.is_active = true
      ORDER BY sc.category, sc.sort_order
    `, [caregiverId]);
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ════════════════════════════════════════════════════════════
// CLIENT SERVICE NEEDS
// ════════════════════════════════════════════════════════════

router.get('/client/:clientId/needs', async (req, res) => {
  try {
    const result = await db.query(`
      SELECT csn.*, sc.name, sc.category, sc.icon
      FROM client_service_needs csn
      JOIN service_capabilities sc ON csn.capability_id = sc.id
      WHERE csn.client_id = $1 AND sc.is_active = true
      ORDER BY
        CASE csn.priority WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'normal' THEN 2 ELSE 3 END,
        sc.category, sc.sort_order
    `, [req.params.clientId]);
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.put('/client/:clientId/needs', async (req, res) => {
  try {
    const { needs } = req.body;
    if (!Array.isArray(needs)) return res.status(400).json({ error: 'needs array required' });
    const clientId = req.params.clientId;
    await db.query(`DELETE FROM client_service_needs WHERE client_id = $1`, [clientId]);
    for (const need of needs) {
      await db.query(
        `INSERT INTO client_service_needs (client_id, capability_id, priority, frequency, notes)
         VALUES ($1, $2, $3, $4, $5)`,
        [clientId, need.capabilityId, need.priority || 'normal', need.frequency || 'every_visit', need.notes || null]
      );
    }
    const result = await db.query(`
      SELECT csn.*, sc.name, sc.category, sc.icon
      FROM client_service_needs csn
      JOIN service_capabilities sc ON csn.capability_id = sc.id
      WHERE csn.client_id = $1 AND sc.is_active = true
      ORDER BY sc.category, sc.sort_order
    `, [clientId]);
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ════════════════════════════════════════════════════════════
// CLIENT SCHEDULE DAY PREFERENCES
// ════════════════════════════════════════════════════════════

// GET /api/matching/client/:clientId/schedule-prefs
router.get('/client/:clientId/schedule-prefs', async (req, res) => {
  try {
    const result = await db.query(
      `SELECT service_days_per_week, service_allowed_days FROM clients WHERE id = $1`,
      [req.params.clientId]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Client not found' });
    const row = result.rows[0];
    res.json({
      daysPerWeek: row.service_days_per_week || 5,
      allowedDays: row.service_allowed_days || [1, 2, 3, 4, 5]
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// PUT /api/matching/client/:clientId/schedule-prefs
router.put('/client/:clientId/schedule-prefs', async (req, res) => {
  try {
    const { daysPerWeek, allowedDays } = req.body;
    if (!Array.isArray(allowedDays) || allowedDays.length === 0) {
      return res.status(400).json({ error: 'allowedDays must be a non-empty array of day indices (0-6)' });
    }
    // Validate day indices
    if (allowedDays.some(d => d < 0 || d > 6)) {
      return res.status(400).json({ error: 'Day indices must be 0-6 (Sun-Sat)' });
    }
    const effectiveDays = Math.min(daysPerWeek || allowedDays.length, allowedDays.length);

    await db.query(
      `UPDATE clients SET service_days_per_week = $1, service_allowed_days = $2, updated_at = NOW() WHERE id = $3`,
      [effectiveDays, JSON.stringify(allowedDays), req.params.clientId]
    );
    res.json({ daysPerWeek: effectiveDays, allowedDays });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ════════════════════════════════════════════════════════════
// CLIENT ↔ CAREGIVER RESTRICTIONS
// ════════════════════════════════════════════════════════════

router.get('/client/:clientId/restrictions', async (req, res) => {
  try {
    const result = await db.query(`
      SELECT ccr.*, u.first_name as cg_first_name, u.last_name as cg_last_name
      FROM client_caregiver_restrictions ccr
      JOIN users u ON ccr.caregiver_id = u.id
      WHERE ccr.client_id = $1
      ORDER BY ccr.restriction_type, u.first_name
    `, [req.params.clientId]);
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/client/:clientId/restrictions', async (req, res) => {
  try {
    const { caregiverId, restrictionType, reason } = req.body;
    if (!caregiverId || !restrictionType) return res.status(400).json({ error: 'caregiverId and restrictionType required' });
    if (!['preferred', 'excluded', 'locked'].includes(restrictionType)) {
      return res.status(400).json({ error: 'restrictionType must be preferred, excluded, or locked' });
    }
    const result = await db.query(`
      INSERT INTO client_caregiver_restrictions (client_id, caregiver_id, restriction_type, reason, created_by)
      VALUES ($1, $2, $3, $4, $5)
      ON CONFLICT (client_id, caregiver_id)
      DO UPDATE SET restriction_type = $3, reason = $4, updated_at = NOW()
      RETURNING *
    `, [req.params.clientId, caregiverId, restrictionType, reason || null, req.user.id]);
    res.status(201).json(result.rows[0]);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.delete('/restrictions/:id', async (req, res) => {
  try {
    await db.query(`DELETE FROM client_caregiver_restrictions WHERE id = $1`, [req.params.id]);
    res.json({ message: 'Restriction removed' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/caregiver/:caregiverId/restrictions', async (req, res) => {
  try {
    const result = await db.query(`
      SELECT ccr.*, c.first_name as cl_first_name, c.last_name as cl_last_name
      FROM client_caregiver_restrictions ccr
      JOIN clients c ON ccr.client_id = c.id
      WHERE ccr.caregiver_id = $1
      ORDER BY ccr.restriction_type, c.first_name
    `, [req.params.caregiverId]);
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ════════════════════════════════════════════════════════════
// HELPERS
// ════════════════════════════════════════════════════════════
const DAY_NAMES = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

const haversine = (lat1, lon1, lat2, lon2) => {
  if (!lat1 || !lon1 || !lat2 || !lon2) return null;
  const R = 3959;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
};

function timeToMinutes(timeStr) {
  if (!timeStr) return 480;
  const [h, m] = timeStr.split(':').map(Number);
  return h * 60 + (m || 0);
}

function minutesToTime(mins) {
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return `${String(h).padStart(2, '0')}:${String(Math.round(m)).padStart(2, '0')}`;
}

// ════════════════════════════════════════════════════════════
// SCORING ENGINE
// ════════════════════════════════════════════════════════════
function computePairScore(clientLat, clientLng, caregiver, clientNeeds, cgCaps, restriction, opts) {
  if (restriction === 'excluded') return { score: -Infinity, blocked: true, reason: 'Excluded' };

  let score = 50;
  const factors = [];
  let needsMet = 0, criticalMet = 0, criticalTotal = 0;

  for (const need of clientNeeds) {
    const hasCap = cgCaps.has(need.capability_id);
    if (need.priority === 'critical') criticalTotal++;
    if (hasCap) {
      needsMet++;
      if (need.priority === 'critical') criticalMet++;
      const capInfo = cgCaps.get(need.capability_id);
      const basePoints = need.priority === 'critical' ? 20 : need.priority === 'high' ? 12 : need.priority === 'normal' ? 6 : 3;
      const profMult = capInfo.proficiency === 'specialized' ? 1.5 : capInfo.proficiency === 'experienced' ? 1.2 : 1.0;
      score += Math.round(basePoints * profMult);
    } else {
      if (need.priority === 'critical') { score -= 30; factors.push(`Missing critical: ${need.name}`); }
      else if (need.priority === 'high') score -= 10;
    }
  }

  if (clientNeeds.length > 0) {
    factors.push(`${Math.round((needsMet / clientNeeds.length) * 100)}% needs (${needsMet}/${clientNeeds.length})`);
  }

  if (restriction === 'preferred' && opts.respectPreferences) { score += 25; factors.push('Preferred'); }
  if (restriction === 'locked') { score += 40; factors.push('Locked'); }

  if (opts.minimizeDriving && clientLat && caregiver.latitude) {
    const dist = haversine(
      parseFloat(caregiver.latitude), parseFloat(caregiver.longitude),
      parseFloat(clientLat), parseFloat(clientLng)
    );
    if (dist !== null) {
      if (dist <= 5) score += 15;
      else if (dist <= 10) score += 8;
      else if (dist <= 15) score += 0;
      else if (dist <= 25) score -= 10;
      else score -= 20;
      factors.push(`${dist.toFixed(1)} mi`);
    }
  }

  return { score: Math.max(0, score), blocked: false, needsMet, totalNeeds: clientNeeds.length, criticalMet, criticalTotal, factors };
}

// ════════════════════════════════════════════════════════════
// THE OPTIMIZER ENGINE
// POST /api/matching/optimize
//
// 1. Generate daily slots (spread units across days)
// 2. Score all (slot, caregiver) pairs
// 3. Initial best-available assignment (hardest-to-fill first)
// 4. 2-opt swap improvement until stable
// 5. Return globally-improved solution
// ════════════════════════════════════════════════════════════
router.post('/optimize', async (req, res) => {
  try {
    const { weekStart, mode, options } = req.body;
    if (!weekStart) return res.status(400).json({ error: 'weekStart required (YYYY-MM-DD)' });

    const opts = {
      balanceHours: options?.balanceHours !== false,
      minimizeDriving: options?.minimizeDriving !== false,
      respectPreferences: options?.respectPreferences !== false
    };

    const startDate = new Date(weekStart + 'T12:00:00');
    const weekDates = [];
    for (let i = 0; i < 7; i++) {
      const d = new Date(startDate);
      d.setDate(d.getDate() + i);
      weekDates.push({ date: d.toISOString().split('T')[0], dayIndex: d.getDay(), dayName: DAY_NAMES[d.getDay()], dayLabel: DAY_LABELS[d.getDay()] });
    }
    const endDateStr = weekDates[6].date;

    // ── Load all data ────────────────────────────
    const [clientsRes, caregiversRes, capsRes, needsRes, restrictionsRes, existingRes, availRes, blackoutRes] = await Promise.all([
      db.query(`SELECT id, first_name, last_name, address, city, state, zip, latitude, longitude,
                weekly_authorized_units, service_type, service_days_per_week, service_allowed_days
                FROM clients WHERE is_active = true AND weekly_authorized_units > 0
                ORDER BY weekly_authorized_units DESC`),
      db.query(`SELECT id, first_name, last_name, address, city, state, zip, latitude, longitude
                FROM users WHERE role = 'caregiver' AND is_active = true`),
      db.query(`SELECT cc.caregiver_id, cc.capability_id, cc.proficiency, sc.name
                FROM caregiver_capabilities cc JOIN service_capabilities sc ON cc.capability_id = sc.id AND sc.is_active = true`),
      db.query(`SELECT csn.client_id, csn.capability_id, csn.priority, csn.frequency, sc.name
                FROM client_service_needs csn JOIN service_capabilities sc ON csn.capability_id = sc.id AND sc.is_active = true`),
      db.query(`SELECT * FROM client_caregiver_restrictions`),
      db.query(`SELECT * FROM schedules WHERE is_active = true AND date >= $1 AND date <= $2
                ORDER BY date, start_time`, [weekStart, endDateStr]),
      db.query(`SELECT * FROM caregiver_availability WHERE caregiver_id IN (
                SELECT id FROM users WHERE role = 'caregiver' AND is_active = true)`),
      db.query(`SELECT * FROM caregiver_blackout_dates WHERE start_date <= $1 AND end_date >= $2`, [endDateStr, weekStart])
        .catch(() => ({ rows: [] }))
    ]);

    const allClients = clientsRes.rows;
    const allCaregivers = caregiversRes.rows;

    // ── Build lookups ─────────────────────────
    const cgCapMap = {};
    capsRes.rows.forEach(r => {
      if (!cgCapMap[r.caregiver_id]) cgCapMap[r.caregiver_id] = new Map();
      cgCapMap[r.caregiver_id].set(r.capability_id, { proficiency: r.proficiency, name: r.name });
    });

    const clientNeedMap = {};
    needsRes.rows.forEach(r => {
      if (!clientNeedMap[r.client_id]) clientNeedMap[r.client_id] = [];
      clientNeedMap[r.client_id].push(r);
    });

    const restrictionLookup = {};
    restrictionsRes.rows.forEach(r => {
      if (!restrictionLookup[r.client_id]) restrictionLookup[r.client_id] = new Map();
      restrictionLookup[r.client_id].set(r.caregiver_id, r.restriction_type);
    });

    const lockedMap = {};
    restrictionsRes.rows.filter(r => r.restriction_type === 'locked').forEach(r => {
      if (!lockedMap[r.client_id]) lockedMap[r.client_id] = new Set();
      lockedMap[r.client_id].add(r.caregiver_id);
    });

    const availMap = {};
    availRes.rows.forEach(r => { availMap[r.caregiver_id] = r; });

    const blackoutMap = {};
    blackoutRes.rows.forEach(r => {
      if (!blackoutMap[r.caregiver_id]) blackoutMap[r.caregiver_id] = new Set();
      const s = new Date(r.start_date), e = new Date(r.end_date);
      for (let d = new Date(s); d <= e; d.setDate(d.getDate() + 1)) {
        blackoutMap[r.caregiver_id].add(d.toISOString().split('T')[0]);
      }
    });

    const existingMap = {};
    existingRes.rows.forEach(s => {
      const dateStr = s.date?.toISOString?.()?.split('T')[0] || s.date;
      const key = `${s.caregiver_id}-${dateStr}`;
      if (!existingMap[key]) existingMap[key] = [];
      existingMap[key].push({ clientId: s.client_id, start: s.start_time, end: s.end_time });
    });

    // ── Generate daily slots (per-client day preferences) ──
    const slots = [];
    for (const client of allClients) {
      const weeklyUnits = client.weekly_authorized_units || 0;
      if (weeklyUnits <= 0) continue;

      // Client's allowed days (default Mon-Fri)
      const allowedDayIndices = Array.isArray(client.service_allowed_days)
        ? client.service_allowed_days
        : [1, 2, 3, 4, 5];
      const requestedDaysPerWeek = client.service_days_per_week || allowedDayIndices.length;

      // Filter week dates to only allowed days
      const availableDays = weekDates.filter(d => allowedDayIndices.includes(d.dayIndex));
      if (availableDays.length === 0) continue;

      // Use requested days count, capped at available days
      let daysCount = Math.min(requestedDaysPerWeek, availableDays.length);

      // Ensure minimum 2 units (30 min) per visit
      if (Math.floor(weeklyUnits / daysCount) < 2 && weeklyUnits >= 2) {
        daysCount = Math.min(daysCount, Math.floor(weeklyUnits / 2));
      }
      daysCount = Math.max(1, daysCount);

      // Pick which days to use (spread evenly across available days)
      let assignDays;
      if (daysCount >= availableDays.length) {
        assignDays = availableDays;
      } else {
        // Spread evenly: pick every Nth day
        const step = availableDays.length / daysCount;
        assignDays = [];
        for (let i = 0; i < daysCount; i++) {
          assignDays.push(availableDays[Math.round(i * step)]);
        }
      }

      const basePerDay = Math.floor(weeklyUnits / assignDays.length);
      let remainder = weeklyUnits - (basePerDay * assignDays.length);

      for (let idx = 0; idx < assignDays.length; idx++) {
        const day = assignDays[idx];
        const dayUnits = basePerDay + (idx < remainder ? 1 : 0);
        if (dayUnits <= 0) continue;
        slots.push({
          clientId: client.id,
          clientName: `${client.first_name} ${client.last_name}`,
          clientCity: client.city,
          clientLat: client.latitude ? parseFloat(client.latitude) : null,
          clientLng: client.longitude ? parseFloat(client.longitude) : null,
          date: day.date, dayIndex: day.dayIndex, dayLabel: day.dayLabel,
          units: dayUnits, minutes: dayUnits * 15, weeklyUnits,
          slotIndex: slots.length
        });
      }
    }

    console.log(`[Optimizer] ${slots.length} daily slots for ${allClients.length} clients, ${allCaregivers.length} caregivers`);

    // ── Score matrix ──────────────────────
    const scoreMatrix = [];
    const cgIndexMap = {};
    allCaregivers.forEach((cg, idx) => { cgIndexMap[cg.id] = idx; });

    for (const slot of slots) {
      const slotScores = [];
      const clientNeeds = clientNeedMap[slot.clientId] || [];
      const clientRestr = restrictionLookup[slot.clientId] || new Map();
      const clientLocked = lockedMap[slot.clientId];

      for (const cg of allCaregivers) {
        const restriction = clientRestr.get(cg.id) || null;

        if (clientLocked && clientLocked.size > 0 && !clientLocked.has(cg.id)) {
          slotScores.push({ score: -Infinity, blocked: true, reason: 'Not locked' });
          continue;
        }

        const avail = availMap[cg.id];
        const dayName = DAY_NAMES[slot.dayIndex];
        if (avail && !avail[`${dayName}_available`]) {
          slotScores.push({ score: -Infinity, blocked: true, reason: `Off ${slot.dayLabel}` });
          continue;
        }
        if (avail?.status === 'unavailable') {
          slotScores.push({ score: -Infinity, blocked: true, reason: 'Unavailable' });
          continue;
        }
        if (blackoutMap[cg.id]?.has(slot.date)) {
          slotScores.push({ score: -Infinity, blocked: true, reason: 'Blackout' });
          continue;
        }

        const cgCaps = cgCapMap[cg.id] || new Map();
        slotScores.push(computePairScore(slot.clientLat, slot.clientLng, cg, clientNeeds, cgCaps, restriction, opts));
      }
      scoreMatrix.push(slotScores);
    }

    // ── Hour tracking ──────────────────────
    const cgDayHours = {};
    const cgWeekHours = {};
    allCaregivers.forEach(cg => { cgWeekHours[cg.id] = 0; });

    if (mode === 'optimize_existing') {
      existingRes.rows.forEach(s => {
        if (s.start_time && s.end_time) {
          const mins = (new Date(`2000-01-01T${s.end_time}`) - new Date(`2000-01-01T${s.start_time}`)) / 60000;
          const hrs = mins / 60;
          const dateStr = s.date?.toISOString?.()?.split('T')[0] || s.date;
          const dayKey = `${s.caregiver_id}-${dateStr}`;
          cgDayHours[dayKey] = (cgDayHours[dayKey] || 0) + hrs;
          cgWeekHours[s.caregiver_id] = (cgWeekHours[s.caregiver_id] || 0) + hrs;
        }
      });
    }

    const assignments = new Array(slots.length).fill(-1);

    function canAssign(si, ci) {
      const cg = allCaregivers[ci];
      const slot = slots[si];
      const hrs = slot.minutes / 60;
      const maxW = availMap[cg.id]?.max_hours_per_week || 40;
      if ((cgWeekHours[cg.id] || 0) + hrs > maxW) return false;
      const avail = availMap[cg.id];
      if (avail) {
        const dn = DAY_NAMES[slot.dayIndex];
        const dayStart = timeToMinutes(avail[`${dn}_start_time`] || '08:00');
        const dayEnd = timeToMinutes(avail[`${dn}_end_time`] || '17:00');
        const availMins = dayEnd - dayStart;
        const dayKey = `${cg.id}-${slot.date}`;
        if ((cgDayHours[dayKey] || 0) * 60 + slot.minutes > availMins) return false;
      }
      return true;
    }

    function doAssign(si, ci) {
      const cg = allCaregivers[ci];
      const hrs = slots[si].minutes / 60;
      const dayKey = `${cg.id}-${slots[si].date}`;
      cgDayHours[dayKey] = (cgDayHours[dayKey] || 0) + hrs;
      cgWeekHours[cg.id] = (cgWeekHours[cg.id] || 0) + hrs;
      assignments[si] = ci;
    }

    function doUnassign(si) {
      const ci = assignments[si];
      if (ci < 0) return;
      const cg = allCaregivers[ci];
      const hrs = slots[si].minutes / 60;
      const dayKey = `${cg.id}-${slots[si].date}`;
      cgDayHours[dayKey] = Math.max(0, (cgDayHours[dayKey] || 0) - hrs);
      cgWeekHours[cg.id] = Math.max(0, (cgWeekHours[cg.id] || 0) - hrs);
      assignments[si] = -1;
    }

    function effScore(si, ci) {
      const base = scoreMatrix[si][ci];
      if (base.blocked) return -Infinity;
      let score = base.score;
      if (opts.balanceHours) {
        const maxW = availMap[allCaregivers[ci].id]?.max_hours_per_week || 40;
        const pct = (cgWeekHours[allCaregivers[ci].id] || 0) / maxW;
        if (pct > 0.9) score -= 20;
        else if (pct > 0.7) score -= 10;
        else if (pct > 0.5) score -= 3;
      }
      // Continuity: same caregiver already serving this client today
      const eKey = `${allCaregivers[ci].id}-${slots[si].date}`;
      if ((existingMap[eKey] || []).some(e => e.clientId === slots[si].clientId)) score += 10;
      return score;
    }

    // ── Initial assignment (hardest-to-fill first) ──
    const slotOrder = slots.map((_, i) => i).sort((a, b) => {
      const eA = scoreMatrix[a].filter(s => !s.blocked).length;
      const eB = scoreMatrix[b].filter(s => !s.blocked).length;
      if (eA !== eB) return eA - eB;
      const cA = (clientNeedMap[slots[a].clientId] || []).filter(n => n.priority === 'critical').length;
      const cB = (clientNeedMap[slots[b].clientId] || []).filter(n => n.priority === 'critical').length;
      return cB - cA;
    });

    for (const si of slotOrder) {
      let bestCi = -1, bestS = -Infinity;
      for (let ci = 0; ci < allCaregivers.length; ci++) {
        if (scoreMatrix[si][ci].blocked) continue;
        if (!canAssign(si, ci)) continue;
        const s = effScore(si, ci);
        if (s > bestS) { bestS = s; bestCi = ci; }
      }
      if (bestCi >= 0) doAssign(si, bestCi);
    }

    console.log(`[Optimizer] Initial: ${assignments.filter(a => a >= 0).length}/${slots.length} filled`);

    // ── 2-opt swap improvement ───────────────
    let improved = true;
    let iters = 0;
    while (improved && iters < 50) {
      improved = false;
      iters++;
      for (let i = 0; i < slots.length; i++) {
        for (let j = i + 1; j < slots.length; j++) {
          const cI = assignments[i], cJ = assignments[j];
          if (cI < 0 && cJ < 0) continue;
          if (cI === cJ) continue;

          const curScore = (cI >= 0 ? effScore(i, cI) : 0) + (cJ >= 0 ? effScore(j, cJ) : 0);

          doUnassign(i);
          doUnassign(j);

          const canSI = cJ >= 0 ? (!scoreMatrix[i][cJ].blocked && canAssign(i, cJ)) : true;
          const canSJ = cI >= 0 ? (!scoreMatrix[j][cI].blocked && canAssign(j, cI)) : true;

          if (canSI && canSJ) {
            if (cJ >= 0) doAssign(i, cJ);
            if (cI >= 0) doAssign(j, cI);
            const swapScore = (cJ >= 0 ? effScore(i, cJ) : 0) + (cI >= 0 ? effScore(j, cI) : 0);
            if (swapScore > curScore) { improved = true; continue; }
            if (cJ >= 0) doUnassign(i);
            if (cI >= 0) doUnassign(j);
          }
          if (cI >= 0) doAssign(i, cI);
          if (cJ >= 0) doAssign(j, cJ);
        }
      }
    }

    console.log(`[Optimizer] Optimized: ${iters} iters, ${assignments.filter(a => a >= 0).length}/${slots.length} filled`);

    // ── Build results ─────────────────────────────
    const clientAssignments = {};
    for (let i = 0; i < slots.length; i++) {
      const slot = slots[i];
      if (!clientAssignments[slot.clientId]) {
        clientAssignments[slot.clientId] = {
          clientId: slot.clientId, clientName: slot.clientName, clientCity: slot.clientCity,
          weeklyUnits: slot.weeklyUnits, hoursNeeded: slot.weeklyUnits * 0.25,
          needsCount: (clientNeedMap[slot.clientId] || []).length,
          criticalNeedsCount: (clientNeedMap[slot.clientId] || []).filter(n => n.priority === 'critical').length,
          hasLocked: !!(lockedMap[slot.clientId]?.size),
          hasExcluded: !!(restrictionLookup[slot.clientId] && [...(restrictionLookup[slot.clientId].values())].some(v => v === 'excluded')),
          dailySlots: [], unfilledSlots: 0, assignedHours: 0
        };
      }
      const ci = assignments[i];
      if (ci >= 0) {
        const cg = allCaregivers[ci];
        const sc = scoreMatrix[i][ci];
        clientAssignments[slot.clientId].dailySlots.push({
          date: slot.date, dayLabel: slot.dayLabel, units: slot.units, hours: slot.minutes / 60,
          caregiverId: cg.id, caregiverName: `${cg.first_name} ${cg.last_name}`,
          score: sc.score, needsMet: sc.needsMet, totalNeeds: sc.totalNeeds,
          criticalMet: sc.criticalMet, criticalTotal: sc.criticalTotal, factors: sc.factors
        });
        clientAssignments[slot.clientId].assignedHours += slot.minutes / 60;
      } else {
        clientAssignments[slot.clientId].dailySlots.push({
          date: slot.date, dayLabel: slot.dayLabel, units: slot.units, hours: slot.minutes / 60,
          caregiverId: null, caregiverName: null, score: 0, warning: 'No eligible caregiver'
        });
        clientAssignments[slot.clientId].unfilledSlots++;
      }
    }

    const resultAssignments = Object.values(clientAssignments).sort((a, b) => {
      if (a.unfilledSlots !== b.unfilledSlots) return b.unfilledSlots - a.unfilledSlots;
      if (a.criticalNeedsCount !== b.criticalNeedsCount) return b.criticalNeedsCount - a.criticalNeedsCount;
      return a.clientName.localeCompare(b.clientName);
    });

    const caregiverUtilization = allCaregivers.map(cg => {
      const maxH = availMap[cg.id]?.max_hours_per_week || 40;
      const assigned = cgWeekHours[cg.id] || 0;
      const cls = new Set();
      for (let i = 0; i < slots.length; i++) if (assignments[i] === cgIndexMap[cg.id]) cls.add(slots[i].clientId);
      return {
        caregiverId: cg.id, caregiverName: `${cg.first_name} ${cg.last_name}`,
        maxHours: maxH, assignedHours: Math.round(assigned * 100) / 100,
        utilization: Math.round((assigned / maxH) * 100), clientCount: cls.size
      };
    }).sort((a, b) => b.utilization - a.utilization);

    const totalNeeded = resultAssignments.reduce((s, a) => s + a.hoursNeeded, 0);
    const totalAssigned = resultAssignments.reduce((s, a) => s + a.assignedHours, 0);
    const filledSlots = assignments.filter(a => a >= 0).length;
    const totalScore = slots.reduce((s, _, i) => s + (assignments[i] >= 0 ? scoreMatrix[i][assignments[i]].score : 0), 0);

    const runId = uuidv4();
    await db.query(`
      INSERT INTO optimizer_runs (id, run_type, week_start, week_end, parameters, results_summary,
        assignments_generated, total_score, run_by) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
    `, [runId, mode || 'generate_fresh', weekStart, endDateStr, JSON.stringify(opts),
      JSON.stringify({ totalNeeded, totalAssigned, slots: slots.length, filled: filledSlots, swapIters: iters }),
      filledSlots, Math.round(totalScore), req.user.id]);

    res.json({
      runId, mode: mode || 'generate_fresh', weekStart, weekEnd: endDateStr,
      weekDates: weekDates.map(d => ({ date: d.date, label: d.dayLabel })),
      assignments: resultAssignments,
      summary: {
        totalClients: allClients.length, totalCaregivers: allCaregivers.length,
        totalSlots: slots.length, filledSlots,
        slotFillPercent: slots.length > 0 ? Math.round((filledSlots / slots.length) * 100) : 100,
        totalHoursNeeded: Math.round(totalNeeded * 100) / 100,
        totalHoursAssigned: Math.round(totalAssigned * 100) / 100,
        coveragePercent: totalNeeded > 0 ? Math.round((totalAssigned / totalNeeded) * 100) : 100,
        unfilledClients: resultAssignments.filter(a => a.unfilledSlots > 0).length,
        fullyFilledClients: resultAssignments.filter(a => a.unfilledSlots === 0).length,
        totalScore: Math.round(totalScore), swapIterations: iters,
        existingScheduleCount: existingRes.rows.length
      },
      caregiverUtilization
    });
  } catch (error) {
    console.error('Optimizer error:', error);
    res.status(500).json({ error: error.message });
  }
});


// ════════════════════════════════════════════════════════════
// APPLY TO SCHEDULE
// POST /api/matching/apply-schedule
// ════════════════════════════════════════════════════════════
router.post('/apply-schedule', async (req, res) => {
  try {
    const { assignments, weekStart, clearExisting } = req.body;
    if (!assignments?.length) return res.status(400).json({ error: 'No assignments' });

    const endDate = new Date(weekStart + 'T12:00:00');
    endDate.setDate(endDate.getDate() + 6);
    const endDateStr = endDate.toISOString().split('T')[0];

    let created = 0, skipped = 0, cleared = 0;
    const errors = [];

    if (clearExisting) {
      const r = await db.query(
        `DELETE FROM schedules WHERE date >= $1 AND date <= $2 AND notes LIKE '%[Optimizer]%' AND is_active = true`,
        [weekStart, endDateStr]
      );
      cleared = r.rowCount || 0;
    }

    for (const assignment of assignments) {
      for (const slot of assignment.dailySlots) {
        if (!slot.caregiverId) { skipped++; continue; }

        // Find caregiver's start time for this day
        let startTime = '08:00';
        try {
          const aRes = await db.query(`SELECT * FROM caregiver_availability WHERE caregiver_id = $1`, [slot.caregiverId]);
          if (aRes.rows[0]) {
            const dayIdx = new Date(slot.date + 'T12:00:00').getDay();
            startTime = aRes.rows[0][`${DAY_NAMES[dayIdx]}_start_time`] || '08:00';
          }
        } catch (e) {}

        // Stack after existing schedules
        try {
          const eRes = await db.query(
            `SELECT end_time FROM schedules WHERE caregiver_id = $1 AND date = $2 AND is_active = true ORDER BY end_time DESC LIMIT 1`,
            [slot.caregiverId, slot.date]
          );
          if (eRes.rows[0]) {
            const lastEnd = timeToMinutes(eRes.rows[0].end_time.slice(0, 5));
            if (lastEnd >= timeToMinutes(startTime)) startTime = minutesToTime(lastEnd + 15);
          }
        } catch (e) {}

        const startMins = timeToMinutes(startTime);
        const endTime = minutesToTime(startMins + (slot.units * 15));

        // Conflict check
        const conflict = await db.query(
          `SELECT id FROM schedules WHERE caregiver_id = $1 AND date = $2 AND is_active = true
           AND NOT (end_time <= $3 OR start_time >= $4)`,
          [slot.caregiverId, slot.date, startTime, endTime]
        );
        if (conflict.rows.length > 0) {
          errors.push({ clientName: assignment.clientName, date: slot.date, error: 'Time conflict' });
          skipped++; continue;
        }

        await db.query(
          `INSERT INTO schedules (id, caregiver_id, client_id, schedule_type, date, start_time, end_time, notes, is_active)
           VALUES ($1, $2, $3, 'one-time', $4, $5, $6, $7, true)`,
          [uuidv4(), slot.caregiverId, assignment.clientId, slot.date, startTime, endTime,
           `[Optimizer] ${slot.units}u · Score: ${slot.score || 'N/A'}`]
        );
        created++;
      }
    }

    res.json({ success: true, created, skipped, cleared, errors,
      message: `Created ${created} schedules${skipped > 0 ? `, ${skipped} skipped` : ''}${cleared > 0 ? `, cleared ${cleared} old` : ''}` });
  } catch (error) {
    console.error('Apply schedule error:', error);
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
