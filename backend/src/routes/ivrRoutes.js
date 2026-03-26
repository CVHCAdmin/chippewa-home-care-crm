// routes/ivrRoutes.js
// IVR (Interactive Voice Response) clock-in/out via Twilio Voice
// Backup for caregivers in areas with bad cell/data service
// Caregiver calls the Twilio number, enters their PIN + client code via keypad

const express = require('express');
const router = express.Router();
const db = require('../db');
const { v4: uuidv4 } = require('uuid');

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

    // Find matching schedule for allotted minutes
    let allottedMinutes = null;
    try {
      const sched = await db.query(`
        SELECT id, start_time, end_time FROM schedules
        WHERE caregiver_id=$1 AND client_id=$2 AND is_active=true
          AND (day_of_week=EXTRACT(DOW FROM NOW())::int OR date=CURRENT_DATE)
        ORDER BY date DESC NULLS LAST LIMIT 1
      `, [caregiverId, cl.id]);
      if (sched.rows[0]?.start_time && sched.rows[0]?.end_time) {
        const [sh, sm] = sched.rows[0].start_time.split(':').map(Number);
        const [eh, em] = sched.rows[0].end_time.split(':').map(Number);
        allottedMinutes = (eh * 60 + em) - (sh * 60 + sm);
      }
    } catch (e) { /* ignore */ }

    await db.query(
      `INSERT INTO time_entries (id, caregiver_id, client_id, start_time, allotted_minutes, notes)
       VALUES ($1, $2, $3, NOW(), $4, 'Clocked in via IVR phone call')`,
      [entryId, caregiverId, cl.id, allottedMinutes]
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
