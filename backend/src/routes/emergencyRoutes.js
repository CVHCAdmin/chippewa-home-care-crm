// src/routes/emergencyRoutes.js - Emergency coverage + shift miss reporting
const express = require('express');
const router = express.Router();
const db = require('../db');
const { v4: uuidv4 } = require('uuid');
const auth = require('../middleware/auth');
const requireAdmin = require('../middleware/authorizeAdmin');
const { auditLog } = require('../middleware/shared');
const { SCHEDULE_OCCURRENCES_CTE } = require('../helpers/scheduleOccurrences');
const { CLIENT_UNAVAILABLE_REASONS } = require('../helpers/cancelReasons');

// ═══════════════════════════════════════════
// SHIFT MISS REPORTING (caregiver-initiated)
// ═══════════════════════════════════════════

// POST /api/emergency/miss-report - Caregiver reports they can't make a shift
router.post('/miss-report', auth, async (req, res) => {
  try {
    const { scheduleId, date, reason, alternativeContact } = req.body;
    const caregiverId = req.user.id;

    if (!date) return res.status(400).json({ error: 'Date is required' });

    const reportId = uuidv4();

    // Get schedule details if provided
    let scheduleInfo = null;
    if (scheduleId) {
      const sched = await db.query(
        `SELECT s.*, c.first_name as client_first_name, c.last_name as client_last_name,
                u.first_name as caregiver_first_name, u.last_name as caregiver_last_name
         FROM schedules s
         LEFT JOIN clients c ON s.client_id = c.id
         LEFT JOIN users u ON s.caregiver_id = u.id
         WHERE s.id = $1`,
        [scheduleId]
      );
      scheduleInfo = sched.rows[0] || null;
    }

    // Record the miss report as an absence
    const absenceResult = await db.query(`
      INSERT INTO absences (id, caregiver_id, date, type, reason, coverage_needed, created_at)
      VALUES ($1, $2, $3, 'call_out', $4, true, NOW())
      RETURNING *`,
      [reportId, caregiverId, date, reason || 'No reason provided']
    );

    // Create an alert for admins
    const admins = await db.query(
      `SELECT id FROM users WHERE role = 'admin' AND is_active = true`
    );

    const caregiverInfo = await db.query(
      `SELECT first_name, last_name FROM users WHERE id = $1`,
      [caregiverId]
    );
    const cg = caregiverInfo.rows[0];
    const cgName = cg ? `${cg.first_name} ${cg.last_name}` : 'A caregiver';

    const alertMessage = scheduleInfo
      ? `${cgName} cannot make their shift on ${date} with ${scheduleInfo.client_first_name} ${scheduleInfo.client_last_name}. Reason: ${reason || 'None given'}`
      : `${cgName} has reported they cannot work on ${date}. Reason: ${reason || 'None given'}`;

    for (const admin of admins.rows) {
      await db.query(`
        INSERT INTO notifications (id, user_id, type, title, message, is_read, created_at)
        VALUES ($1, $2, 'emergency_coverage', 'Shift Miss Report — Coverage Needed', $3, false, NOW())`,
        [uuidv4(), admin.id, alertMessage]
      );
    }

    // Store schedule info in absence notes
    await db.query(
      `UPDATE absences SET notes = $1 WHERE id = $2`,
      [JSON.stringify({ scheduleId, scheduleInfo: scheduleInfo ? { clientName: `${scheduleInfo.client_first_name} ${scheduleInfo.client_last_name}`, startTime: scheduleInfo.start_time, endTime: scheduleInfo.end_time } : null, alternativeContact }), reportId]
    );

    // ── CANCEL THE OCCURRENCE ────────────────────────────────────────────────
    // Reporting a miss never actually cancelled the visit — the occurrence stayed live in
    // the schedule, so the system went on treating it as happening: it pushed the caregiver
    // a "shift in 1 hour" reminder for a shift they'd just called out of, raised a no-show
    // alert against them (texting the client and family "your caregiver is running late"),
    // counted the visit in today's totals, and would still have paid and billed it. And when
    // coverage was assigned, a SECOND schedule row was created for the replacement — so the
    // same visit existed twice.
    //
    // Writing the cancellation makes the occurrence stop existing for every one of those.
    if (scheduleId && date) {
      try {
        await db.query(
          `INSERT INTO schedule_exceptions (schedule_id, exception_date, exception_type, override_notes, created_by, cancel_reason)
           VALUES ($1, $2, 'cancelled', $3, $4, 'caregiver_callout')
           ON CONFLICT (schedule_id, exception_date) DO UPDATE SET
             exception_type = 'cancelled',
             override_notes = EXCLUDED.override_notes,
             cancel_reason  = 'caregiver_callout'`,
          [scheduleId, date, `Called out: ${reason || 'no reason given'}`, caregiverId]
        );
      } catch (e) {
        console.error('[miss-report] could not cancel the occurrence:', e.message);
      }
    }

    // ── AUTO-CREATE OPEN SHIFT ────────────────────────────────────────────────
    let openShiftId = null;
    let notifiedCount = 0;

    if (scheduleInfo && scheduleInfo.client_id) {
      try {
        // Create open shift from this miss report
        const osResult = await db.query(`
          INSERT INTO open_shifts (
            client_id, schedule_id, shift_date, start_time, end_time,
            notes, urgency, created_by, source_absence_id, auto_created, status
          ) VALUES ($1, $2, $3, $4, $5, $6, 'urgent', $7, $8, true, 'open')
          RETURNING id
        `, [
          scheduleInfo.client_id,
          scheduleId || null,
          date,
          scheduleInfo.start_time,
          scheduleInfo.end_time,
          `Coverage needed — ${cgName} called out. Reason: ${reason || 'None given'}`,
          caregiverId,
          reportId
        ]);
        openShiftId = osResult.rows[0].id;

        // Find caregivers NOT scheduled at this time
        const shiftStart = scheduleInfo.start_time;
        const shiftEnd = scheduleInfo.end_time;

        const available = await db.query(`
          SELECT DISTINCT u.id, u.first_name, u.last_name, u.phone
          FROM users u
          WHERE u.role = 'caregiver'
            AND u.is_active = true
            AND u.id != $1
            AND u.id NOT IN (
              -- Exclude caregivers already scheduled at this time on this date
              SELECT DISTINCT s.caregiver_id
              FROM schedules s
              WHERE s.is_active = true
                AND s.day_of_week = EXTRACT(DOW FROM $2::date)
                AND (
                  (s.start_time <= $3 AND s.end_time > $3) OR
                  (s.start_time < $4 AND s.end_time >= $4) OR
                  (s.start_time >= $3 AND s.end_time <= $4)
                )
            )
            AND u.id NOT IN (
              -- Exclude caregivers with approved time off
              SELECT caregiver_id FROM absences
              WHERE type = 'time_off' AND date = $2 AND status = 'approved'
            )
          LIMIT 30
        `, [caregiverId, date, shiftStart, shiftEnd]);

        const availableCaregivers = available.rows;

        // Send push notifications to available caregivers
        let webpush;
        try { webpush = require('web-push'); } catch (e) { webpush = null; }

        if (webpush && process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PUBLIC_KEY !== 'PLACEHOLDER_REPLACE_WITH_REAL_KEY') {
          webpush.setVapidDetails('mailto:admin@chippewavalleyhomecare.com', process.env.VAPID_PUBLIC_KEY, process.env.VAPID_PRIVATE_KEY);
        }

        for (const cg of availableCaregivers) {
          try {
            // Log notification
            await db.query(`
              INSERT INTO open_shift_notifications (open_shift_id, caregiver_id, notification_type)
              VALUES ($1, $2, 'push') ON CONFLICT (open_shift_id, caregiver_id) DO NOTHING
            `, [openShiftId, cg.id]);

            // Send push
            if (webpush && process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PUBLIC_KEY !== 'PLACEHOLDER_REPLACE_WITH_REAL_KEY') {
              const subs = await db.query(
                `SELECT subscription FROM push_subscriptions WHERE user_id = $1 AND is_active = true`,
                [cg.id]
              );
              for (const sub of subs.rows) {
                try {
                  await webpush.sendNotification(sub.subscription, JSON.stringify({
                    title: '🚨 Urgent Open Shift',
                    body: `${scheduleInfo.client_first_name} ${scheduleInfo.client_last_name} needs coverage on ${date} (${shiftStart}–${shiftEnd}). Tap to claim.`,
                    data: { type: 'open_shift', openShiftId }
                  }));
                } catch (e) { /* ignore */ }
              }
            }

            // Add in-app notification too
            await db.query(`
              INSERT INTO notifications (id, user_id, type, title, message, is_read, created_at)
              VALUES ($1, $2, 'open_shift', '🚨 Urgent Shift Available', $3, false, NOW())
            `, [uuidv4(), cg.id,
              `${scheduleInfo.client_first_name} ${scheduleInfo.client_last_name} needs coverage on ${date} from ${shiftStart} to ${shiftEnd}. Open the app to claim this shift.`
            ]);

            notifiedCount++;
          } catch (e) { /* continue */ }
        }

        // Update open shift with notified count
        await db.query(
          `UPDATE open_shifts SET notified_caregiver_count = $1 WHERE id = $2`,
          [notifiedCount, openShiftId]
        );

      } catch (osError) {
        console.error('Error creating open shift from miss report:', osError.message);
        // Don't fail the whole request — the miss report was still saved
      }
    }

    res.status(201).json({
      id: reportId,
      message: 'Your report has been submitted. The admin team has been notified.',
      date,
      status: 'submitted',
      openShiftCreated: !!openShiftId,
      caregiversNotified: notifiedCount,
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET /api/emergency/miss-reports - Admin: all pending miss reports
router.get('/miss-reports', auth, requireAdmin, async (req, res) => {
  try {
    const result = await db.query(`
      SELECT 
        a.*,
        u.first_name, u.last_name, u.phone, u.email,
        a.notes::jsonb->>'scheduleId' as schedule_id,
        (a.notes::jsonb->'scheduleInfo'->>'clientName') as client_name,
        (a.notes::jsonb->'scheduleInfo'->>'startTime') as start_time,
        (a.notes::jsonb->'scheduleInfo'->>'endTime') as end_time
      FROM absences a
      JOIN users u ON a.caregiver_id = u.id
      WHERE a.type = 'call_out' 
        AND a.coverage_needed = true
        AND a.coverage_assigned_to IS NULL
        AND a.date >= CURRENT_DATE
      ORDER BY a.date ASC, a.created_at ASC`
    );
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ═══════════════════════════════════════════
// EMERGENCY COVERAGE FINDER
// ═══════════════════════════════════════════

// GET /api/emergency/available-caregivers - Find who can cover a shift
router.get('/available-caregivers', auth, requireAdmin, async (req, res) => {
  try {
    const { date, startTime, endTime, clientId, absenceId } = req.query;

    if (!date || !startTime || !endTime) {
      return res.status(400).json({ error: 'date, startTime, and endTime are required' });
    }

    const dayOfWeek = new Date(date + 'T12:00:00').getDay();

    // Find caregivers who:
    // 1. Are active
    // 2. Have no conflicting schedule on that date/time
    // 3. Have not requested time off that day
    // 4. Are marked available for that day
    const result = await db.query(`
      WITH conflicting_caregivers AS (
        -- Has an existing schedule that overlaps
        SELECT DISTINCT caregiver_id FROM schedules
        WHERE is_active = true
          AND (
            (date = $1)
            OR (day_of_week = $2 AND (date IS NULL OR date = $1))
          )
          AND start_time < $4::time AND end_time > $3::time
      ),
      on_time_off AS (
        -- Has approved time off that day
        SELECT DISTINCT caregiver_id FROM caregiver_time_off
        WHERE status = 'approved'
          AND start_date <= $1::date AND end_date >= $1::date
      ),
      called_out AS (
        -- Already called out this day
        SELECT DISTINCT caregiver_id FROM absences
        WHERE date = $1::date AND type IN ('call_out', 'no_show')
      )
      SELECT 
        u.id, u.first_name, u.last_name, u.phone, u.email,
        u.certifications,
        -- Check if they are available for this day in their availability preferences
        ca.weekly_availability,
        ca.status as availability_status,
        -- Count their hours this week
        COALESCE((
          SELECT SUM(EXTRACT(EPOCH FROM (end_time - start_time)) / 3600 + CASE WHEN end_time < start_time THEN 24 ELSE 0 END)
          FROM schedules s2
          WHERE s2.caregiver_id = u.id 
            AND s2.is_active = true
            AND s2.date >= DATE_TRUNC('week', $1::date)
            AND s2.date < DATE_TRUNC('week', $1::date) + INTERVAL '7 days'
        ), 0) as scheduled_hours_this_week,
        -- Last worked date
        (SELECT MAX(start_time)::date FROM time_entries te WHERE te.caregiver_id = u.id AND te.is_complete = true) as last_worked,
        -- Performance rating
        COALESCE((
          SELECT ROUND(AVG(satisfaction_score)::numeric, 1)
          FROM performance_ratings pr
          WHERE pr.caregiver_id = u.id
        ), 0) as avg_rating,
        -- Client preference match
        CASE WHEN $5::uuid IS NOT NULL AND $5::text != '' AND u.id = ANY(
          SELECT UNNEST(preferred_caregivers) FROM clients WHERE id = $5::uuid
        ) THEN true ELSE false END as is_preferred
      FROM users u
      LEFT JOIN caregiver_availability ca ON ca.caregiver_id = u.id
      WHERE u.role = 'caregiver'
        AND u.is_active = true
        AND u.id NOT IN (SELECT caregiver_id FROM conflicting_caregivers)
        AND u.id NOT IN (SELECT caregiver_id FROM on_time_off)
        AND u.id NOT IN (SELECT caregiver_id FROM called_out)
      ORDER BY is_preferred DESC, avg_rating DESC, scheduled_hours_this_week ASC`,
      [date, dayOfWeek, startTime, endTime, clientId || null]
    );

    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/emergency/assign-coverage - Assign a caregiver to cover a shift
router.post('/assign-coverage', auth, requireAdmin, async (req, res) => {
  try {
    const { absenceId, caregiverId, scheduleId, date, startTime, endTime, clientId, notes } = req.body;

    // Update the absence record
    if (absenceId) {
      await db.query(
        `UPDATE absences SET coverage_assigned_to = $1, coverage_needed = false WHERE id = $2`,
        [caregiverId, absenceId]
      );
    }

    // Create a one-time schedule entry for the covering caregiver
    if (date && startTime && endTime && clientId) {
      const newSchedId = uuidv4();
      await db.query(`
        INSERT INTO schedules (id, caregiver_id, client_id, date, start_time, end_time, notes, is_active, created_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7, true, NOW())`,
        [newSchedId, caregiverId, clientId, date, startTime, endTime,
          `Emergency coverage${notes ? ': ' + notes : ''}. Original absence: ${absenceId || 'N/A'}`]
      );
    }

    // Notify the covering caregiver
    const caregiver = await db.query('SELECT first_name, last_name FROM users WHERE id = $1', [caregiverId]);
    const client = clientId ? await db.query('SELECT first_name, last_name FROM clients WHERE id = $1', [clientId]) : null;
    
    const cg = caregiver.rows[0];
    const cl = client ? client.rows[0] : null;

    await db.query(`
      INSERT INTO notifications (id, user_id, type, title, message, is_read, created_at)
      VALUES ($1, $2, 'emergency_assignment', 'Emergency Coverage Assignment', $3, false, NOW())`,
      [
        uuidv4(),
        caregiverId,
        `You have been assigned emergency coverage on ${date} from ${startTime} to ${endTime}${cl ? ` for ${cl.first_name} ${cl.last_name}` : ''}. Please confirm your availability.`
      ]
    );

    res.json({ success: true, message: `Coverage assigned to ${cg?.first_name} ${cg?.last_name}` });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET /api/emergency/my-shifts - Caregiver: get upcoming shifts for miss-report form
router.get('/my-shifts', auth, async (req, res) => {
  try {
    const today = new Date().toISOString().split('T')[0];
    const result = await db.query(`
      SELECT s.id, s.date, s.day_of_week, s.start_time, s.end_time,
             c.first_name as client_first_name, c.last_name as client_last_name,
             c.address as client_address
      FROM schedules s
      JOIN clients c ON s.client_id = c.id
      WHERE s.caregiver_id = $1
        AND s.is_active = true
        AND (s.date >= $2::date OR (s.date IS NULL AND s.day_of_week IS NOT NULL))
        -- Suspended (service paused, or caregiver removed pending an incident
        -- investigation): the engine no longer generates these, so don't offer them.
        AND (s.suspended_from IS NULL OR s.suspended_from > $2::date)
      ORDER BY s.date ASC, s.start_time ASC
      LIMIT 14`,
      [req.user.id, today]
    );
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ═══════════════════════════════════════════
// CLIENT UNAVAILABLE (caregiver- or office-initiated)
// ═══════════════════════════════════════════
// POST /api/emergency/client-unavailable
//   { scheduleId, date: 'YYYY-MM-DD', reason: <CLIENT_UNAVAILABLE_REASONS key>, note? }
//
// The client refused care, wasn't home, was in the hospital, or cancelled ahead.
// This is the mirror image of the miss report: the visit is cancelled so that
// nothing bills, pays, reminds or no-show-alerts for it — but there is NO
// caregiver absence and NO open shift, because nobody needs covering.
//
// Why it matters for billing: the invoice engine bills every scheduled
// occurrence at its scheduled hours even with no clock-in (status 'no_punch').
// Without this record a refused visit is invoiced. With it, the day vanishes
// from the invoice and shows up in the "Not billed" list of the review step.
//
// A caregiver may only cancel their OWN occurrence, and only for a date from
// seven days ago through tomorrow. Admins may cancel any occurrence, any date.
router.post('/client-unavailable', auth, async (req, res) => {
  try {
    const { scheduleId, date, reason, note } = req.body;
    const isAdmin = req.user.role === 'admin';

    if (!scheduleId || !date || !reason) {
      return res.status(400).json({ error: 'scheduleId, date and reason are required' });
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(date))) {
      return res.status(400).json({ error: 'date must be YYYY-MM-DD' });
    }
    const label = CLIENT_UNAVAILABLE_REASONS[reason];
    if (!label) {
      return res.status(400).json({ error: `reason must be one of: ${Object.keys(CLIENT_UNAVAILABLE_REASONS).join(', ')}` });
    }
    if (reason === 'other' && !(note && String(note).trim())) {
      return res.status(400).json({ error: 'Please add a note when the reason is Other' });
    }

    if (!isAdmin) {
      const win = await db.query(`
        SELECT ($1::date BETWEEN (NOW() AT TIME ZONE 'America/Chicago')::date - 7
                           AND (NOW() AT TIME ZONE 'America/Chicago')::date + 1) AS ok`, [date]);
      if (!win.rows[0].ok) {
        return res.status(400).json({ error: 'You can report a client as unavailable for the last 7 days through tomorrow. For older dates, contact the office.' });
      }
    }

    // Does this schedule actually produce a visit on that date, and whose is it?
    // The shared engine resolves per-day overrides (a covered shift belongs to
    // the covering caregiver that day) and hides already-cancelled occurrences.
    const occ = await db.query(`
      WITH ${SCHEDULE_OCCURRENCES_CTE('occ')}
      SELECT occ.caregiver_id, occ.client_id, occ.start_time::text AS start_time, occ.end_time::text AS end_time
        FROM occ WHERE occ.schedule_id = $3 AND occ.occ_date = $1::date`,
      [date, date, scheduleId]);

    let visit = occ.rows[0] || null;
    if (!visit) {
      // Already cancelled (e.g. a second tap, or the office got there first)?
      // Then just record the better reason instead of failing.
      const existing = await db.query(`
        SELECT se.id, se.exception_type, s.caregiver_id, s.client_id, s.start_time::text AS start_time, s.end_time::text AS end_time
          FROM schedule_exceptions se JOIN schedules s ON s.id = se.schedule_id
         WHERE se.schedule_id = $1 AND se.exception_date = $2::date AND se.exception_type = 'cancelled'`,
        [scheduleId, date]);
      if (existing.rows.length === 0) {
        return res.status(404).json({ error: 'No visit is scheduled on that date for this shift' });
      }
      visit = existing.rows[0];
    }

    if (!isAdmin && visit.caregiver_id !== req.user.id) {
      return res.status(403).json({ error: 'That visit is not on your schedule' });
    }

    const noteText = note && String(note).trim() ? String(note).trim().slice(0, 500) : '';
    const overrideNotes = `Client unavailable — ${label}${noteText ? `: ${noteText}` : ''}`;

    const saved = await db.query(`
      INSERT INTO schedule_exceptions (schedule_id, exception_date, exception_type, override_notes, created_by, cancel_reason)
      VALUES ($1, $2::date, 'cancelled', $3, $4, $5)
      ON CONFLICT (schedule_id, exception_date) DO UPDATE SET
        exception_type      = 'cancelled',
        override_start_time = NULL,
        override_end_time   = NULL,
        override_notes      = EXCLUDED.override_notes,
        cancel_reason       = EXCLUDED.cancel_reason
      RETURNING *`,
      [scheduleId, date, overrideNotes, req.user.id, reason]);

    await auditLog(req.user.id, 'CLIENT_UNAVAILABLE', 'schedules', scheduleId, null,
      { date, reason, note: noteText || null, exception_id: saved.rows[0].id }, reason);

    // Tell the office. An admin recording it themselves doesn't need a notification.
    if (!isAdmin) {
      const [who, client, admins] = await Promise.all([
        db.query(`SELECT first_name, last_name FROM users WHERE id = $1`, [req.user.id]),
        db.query(`SELECT first_name, last_name FROM clients WHERE id = $1`, [visit.client_id]),
        db.query(`SELECT id FROM users WHERE role = 'admin' AND is_active = true`),
      ]);
      const cg = who.rows[0] ? `${who.rows[0].first_name} ${who.rows[0].last_name}` : 'A caregiver';
      const cl = client.rows[0] ? `${client.rows[0].first_name} ${client.rows[0].last_name}` : 'a client';
      const msg = `${cg} reported ${cl} unavailable on ${date} (${visit.start_time?.slice(0, 5)}–${visit.end_time?.slice(0, 5)}): ${label}${noteText ? ` — ${noteText}` : ''}. The visit will not be billed or paid.`;
      for (const a of admins.rows) {
        await db.query(`
          INSERT INTO notifications (id, user_id, type, title, message, is_read, created_at)
          VALUES ($1, $2, 'client_unavailable', 'Client unavailable — visit not billed', $3, false, NOW())`,
          [uuidv4(), a.id, msg]);
      }
    }

    res.status(201).json({ success: true, exception: saved.rows[0], label });
  } catch (error) {
    console.error('[client-unavailable]', error);
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
