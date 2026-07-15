// routes/ivrRoutes.js
// IVR (Interactive Voice Response) clock-in/out via Twilio Voice
// Backup for caregivers in areas with bad cell/data service
// Caregiver calls the Twilio number, enters their PIN + client code via keypad

const express = require('express');
const router = express.Router();
const db = require('../db');
const { v4: uuidv4 } = require('uuid');
const { SCHEDULE_OCCURRENCES_CTE } = require('../helpers/scheduleOccurrences');

// POST /api/ivr/voice — Twilio voice webhook (incoming call)
// Returns TwiML to greet and gather caregiver PIN
router.post('/voice', (req, res) => {
  res.type('text/xml');
  res.send(`<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Gather input="dtmf" numDigits="4" action="/api/ivr/verify-pin" method="POST" timeout="10">
    <Say voice="alice">Welcome to Chippewa Valley Home Care. Please enter your 4-digit PIN followed by the pound sign.</Say>
  </Gather>
  <Say voice="alice">We didn't receive any input. Goodbye.</Say>
</Response>`);
});

// POST /api/ivr/verify-pin — Verify caregiver PIN, ask for action
router.post('/verify-pin', async (req, res) => {
  const pin = req.body.Digits;
  const callerPhone = req.body.From;

  try {
    // Look up caregiver by PIN (stored in users table) or by phone number
    const caregiver = await db.query(
      `SELECT id, first_name, last_name, phone FROM users
       WHERE role = 'caregiver' AND is_active = true
       AND (ivr_pin = $1 OR (phone IS NOT NULL AND RIGHT(REPLACE(REPLACE(phone, '-', ''), ' ', ''), 10) = RIGHT(REPLACE(REPLACE($2, '-', ''), ' ', ''), 10)))`,
      [pin, callerPhone || '']
    );

    if (caregiver.rows.length === 0) {
      res.type('text/xml');
      return res.send(`<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="alice">Invalid PIN. Please try again.</Say>
  <Redirect method="POST">/api/ivr/voice</Redirect>
</Response>`);
    }

    const cg = caregiver.rows[0];

    // Check if they have an active shift (clocked in but not out) — check all dates, not just today
    const activeShift = await db.query(
      `SELECT id FROM time_entries WHERE caregiver_id = $1 AND end_time IS NULL ORDER BY start_time DESC LIMIT 1`,
      [cg.id]
    );

    if (activeShift.rows.length > 0) {
      // They're clocked in — ask to clock out
      res.type('text/xml');
      return res.send(`<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Gather input="dtmf" numDigits="1" action="/api/ivr/clock-out?caregiverId=${cg.id}&amp;timeEntryId=${activeShift.rows[0].id}" method="POST" timeout="10">
    <Say voice="alice">Hello ${cg.first_name}. You are currently clocked in. Press 1 to clock out, or press 2 to cancel.</Say>
  </Gather>
  <Say voice="alice">No input received. Goodbye.</Say>
</Response>`);
    }

    // Not clocked in — ask for client code
    res.type('text/xml');
    res.send(`<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Gather input="dtmf" numDigits="3" action="/api/ivr/clock-in?caregiverId=${cg.id}" method="POST" timeout="15">
    <Say voice="alice">Hello ${cg.first_name}. To clock in, please enter your 3-digit client code followed by the pound sign.</Say>
  </Gather>
  <Say voice="alice">No input received. Goodbye.</Say>
</Response>`);
  } catch (error) {
    console.error('IVR verify-pin error:', error);
    res.type('text/xml');
    res.send(`<?xml version="1.0" encoding="UTF-8"?>
<Response><Say voice="alice">A system error occurred. Please try again later.</Say></Response>`);
  }
});

// POST /api/ivr/clock-in — Create time entry via phone
router.post('/clock-in', async (req, res) => {
  const clientCode = req.body.Digits;
  const caregiverId = req.query.caregiverId;

  try {
    // Look up client by IVR code
    const client = await db.query(
      `SELECT id, first_name, last_name FROM clients WHERE ivr_code = $1 AND is_active = true`,
      [clientCode]
    );

    if (client.rows.length === 0) {
      res.type('text/xml');
      return res.send(`<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="alice">Invalid client code. Please try again.</Say>
  <Redirect method="POST">/api/ivr/voice</Redirect>
</Response>`);
    }

    const cl = client.rows[0];
    const entryId = uuidv4();

    // Auto-close any existing open time entries for this caregiver
    const openEntries = await db.query(
      `SELECT id, start_time, allotted_minutes FROM time_entries WHERE caregiver_id = $1 AND end_time IS NULL`,
      [caregiverId]
    );
    for (const openEntry of openEntries.rows) {
      const durationMinutes = Math.round((new Date() - new Date(openEntry.start_time)) / 60000);
      const discrepancyMinutes = openEntry.allotted_minutes ? durationMinutes - openEntry.allotted_minutes : null;
      const billableMinutes = openEntry.allotted_minutes ? Math.min(durationMinutes, openEntry.allotted_minutes) : durationMinutes;
      await db.query(
        `UPDATE time_entries SET end_time = NOW(), duration_minutes = $1, is_complete = true,
          discrepancy_minutes = $2, billable_minutes = $3,
          notes = COALESCE(notes, '') || ' | Auto-closed: caregiver clocked into new client via IVR',
          updated_at = NOW() WHERE id = $4`,
        [durationMinutes, discrepancyMinutes, billableMinutes, openEntry.id]
      );
    }

    // Find the matching occurrence. Same rules as the app clock-in
    // (timeTrackingRoutes) — one shared engine, nearest start time wins — so a phone
    // punch and an app punch for the same visit produce the same allotted minutes and
    // therefore the same billed units.
    //
    // The old query used EXTRACT(DOW FROM NOW()) and CURRENT_DATE, which are UTC on this
    // server: after 19:00 Chicago it matched TOMORROW's weekday. It also had no date
    // bounds, ignored cancellations, and tie-broke at random across multi-visit days.
    let allottedMinutes = null;
    let linkedScheduleId = null;
    try {
      const nowCt = await db.query(
        `SELECT to_char((NOW() AT TIME ZONE 'America/Chicago')::date, 'YYYY-MM-DD') AS d,
                to_char((NOW() AT TIME ZONE 'America/Chicago')::time, 'HH24:MI:SS') AS t`
      );
      const { d: todayCt, t: nowTimeCt } = nowCt.rows[0];
      const sched = await db.query(
        `WITH ${SCHEDULE_OCCURRENCES_CTE('occ')}
         SELECT occ.schedule_id AS id, occ.minutes
         FROM occ
         WHERE occ.caregiver_id = $3 AND occ.client_id = $4
         ORDER BY ABS(EXTRACT(EPOCH FROM ($5::time - occ.start_time))) ASC, occ.start_time ASC
         LIMIT 1`,
        [todayCt, todayCt, caregiverId, cl.id, nowTimeCt]
      );
      if (sched.rows[0]) {
        linkedScheduleId = sched.rows[0].id;
        if (sched.rows[0].minutes != null) allottedMinutes = sched.rows[0].minutes;
      }
    } catch (e) { console.error('[IVR clock-in] schedule match failed:', e.message); }

    // schedule_id was never stored on IVR punches, so every phone clock-in was invisible
    // to anything joining time_entries -> schedules (payroll's tight match, the late-arrival
    // analytics). Store it.
    await db.query(
      `INSERT INTO time_entries (id, caregiver_id, client_id, start_time, allotted_minutes, schedule_id, notes)
       VALUES ($1, $2, $3, NOW(), $4, $5, 'Clocked in via IVR phone call')`,
      [entryId, caregiverId, cl.id, allottedMinutes, linkedScheduleId]
    );

    res.type('text/xml');
    res.send(`<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="alice">You are now clocked in for ${cl.first_name} ${cl.last_name}. Have a great shift. Goodbye.</Say>
</Response>`);
  } catch (error) {
    console.error('IVR clock-in error:', error);
    res.type('text/xml');
    res.send(`<?xml version="1.0" encoding="UTF-8"?>
<Response><Say voice="alice">A system error occurred. Please try again later.</Say></Response>`);
  }
});

// POST /api/ivr/clock-out — End time entry via phone
router.post('/clock-out', async (req, res) => {
  const digit = req.body.Digits;
  const { caregiverId, timeEntryId } = req.query;

  if (digit !== '1') {
    res.type('text/xml');
    return res.send(`<?xml version="1.0" encoding="UTF-8"?>
<Response><Say voice="alice">Clock out cancelled. Goodbye.</Say></Response>`);
  }

  try {
    const timeEntry = await db.query(`SELECT * FROM time_entries WHERE id = $1`, [timeEntryId]);
    if (timeEntry.rows.length === 0) {
      res.type('text/xml');
      return res.send(`<?xml version="1.0" encoding="UTF-8"?>
<Response><Say voice="alice">No active shift found. Goodbye.</Say></Response>`);
    }

    const durationMinutes = Math.round((new Date() - new Date(timeEntry.rows[0].start_time)) / 60000);
    const allottedMinutes = timeEntry.rows[0].allotted_minutes;
    const billableMinutes = allottedMinutes ? Math.min(durationMinutes, allottedMinutes) : durationMinutes;
    const discrepancyMinutes = allottedMinutes ? durationMinutes - allottedMinutes : null;

    await db.query(
      `UPDATE time_entries SET end_time = NOW(), duration_minutes = $1, is_complete = true,
       billable_minutes = $2, discrepancy_minutes = $3, notes = COALESCE(notes, '') || ' | Clocked out via IVR phone call',
       updated_at = NOW() WHERE id = $4`,
      [durationMinutes, billableMinutes, discrepancyMinutes, timeEntryId]
    );

    // Generate the Sandata EVV record. Web/mobile clock-outs already do this
    // (timeTrackingRoutes.js:376). IVR didn't — every IVR-closed visit was
    // skipping EVV submission entirely, which is a WI Medicaid violation.
    try {
      const { createEVVFromTimeEntry } = require('./sandataRoutes');
      createEVVFromTimeEntry(timeEntryId).catch(e => console.error('[EVV ivr clock-out]', e.message));
    } catch (e) { console.error('[EVV require]', e.message); }

    const hours = (durationMinutes / 60).toFixed(1);
    res.type('text/xml');
    res.send(`<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="alice">You are now clocked out. Total time: ${hours} hours. Thank you. Goodbye.</Say>
</Response>`);
  } catch (error) {
    console.error('IVR clock-out error:', error);
    res.type('text/xml');
    res.send(`<?xml version="1.0" encoding="UTF-8"?>
<Response><Say voice="alice">A system error occurred. Please try again later.</Say></Response>`);
  }
});

module.exports = router;
