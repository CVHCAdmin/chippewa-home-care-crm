// routes/billingRoutes.js
// Consolidated billing routes - invoices, payments, authorizations, rates
// All billing-related endpoints in one place

const express = require('express');
const router = express.Router();
const db = require('../db');
const auth = require('../middleware/auth');
const { requireAdmin } = require('../middleware/shared');
const { sendInvoiceEmail, sendInvoiceReminder, isConfigured: emailConfigured } = require('../services/emailService');

// ==================== HELPER FUNCTIONS ====================

// Old invoices may have descriptions like "Home Care Services (13:30 - 17:30)"
// that were stored before we converted to 12h on the way in. Reformat on read
// so the printed invoice shows AM/PM regardless of when the row was created.
const reformatTimesIn = (text) => {
  if (typeof text !== 'string') return text;
  return text.replace(/\b(\d{1,2}):(\d{2})\b/g, (match, h, m) => {
    const hr = parseInt(h, 10);
    if (hr < 0 || hr > 23) return match;
    const ampm = hr < 12 ? 'AM' : 'PM';
    const dh = hr === 0 ? 12 : hr > 12 ? hr - 12 : hr;
    return `${dh}:${m} ${ampm}`;
  });
};

// ── Helpers for schedule expansion ─────────────────────────────────────────
const DAY_MS = 24 * 60 * 60 * 1000;

const toDateOnly = (d) => {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
};

const ymd = (d) => toDateOnly(d).toISOString().slice(0, 10);

// Returns true if a recurring schedule should produce an occurrence on `target`
function isRecurringActiveOn(schedule, target) {
  // Hard lower bound: never expand a recurring shift to a date BEFORE it was
  // entered. effective_date is the source of truth; created_at is the fallback
  // for any legacy row that slipped through without one. No effective_date
  // AND no created_at → refuse to expand at all.
  const lowerBound = schedule.effective_date || schedule.created_at;
  if (!lowerBound) return false;
  if (toDateOnly(target) < toDateOnly(lowerBound)) return false;
  if (schedule.end_date) {
    if (toDateOnly(target) > toDateOnly(schedule.end_date)) return false;
  }
  if (schedule.frequency === 'biweekly' && schedule.anchor_date) {
    const diffDays = Math.round((toDateOnly(target) - toDateOnly(schedule.anchor_date)) / DAY_MS);
    if (Math.floor(diffDays / 7) % 2 !== 0) return false;
  }
  return true;
}

// "HH:MM[:SS]" + "YYYY-MM-DD" → JS Date
function combineDateAndTime(dateOnly, hms) {
  if (!hms) return null;
  const [h, m] = hms.split(':').map(Number);
  const d = toDateOnly(dateOnly);
  d.setHours(h || 0, m || 0, 0, 0);
  return d;
}

// hours between two "HH:MM" times on the same day, accounting for overnight
function hoursBetween(startHms, endHms) {
  if (!startHms || !endHms) return 0;
  const [sh, sm] = startHms.split(':').map(Number);
  const [eh, em] = endHms.split(':').map(Number);
  let mins = (eh * 60 + em) - (sh * 60 + sm);
  if (mins < 0) mins += 24 * 60; // overnight shift
  return mins / 60;
}

function fmtTime12(hms) {
  if (!hms) return '';
  const [h, m] = hms.split(':').map(Number);
  const ampm = h < 12 ? 'AM' : 'PM';
  const dh = h === 0 ? 12 : h > 12 ? h - 12 : h;
  return `${dh}:${(m || 0).toString().padStart(2, '0')} ${ampm}`;
}

/**
 * Generate line items for a client's billing period.
 *
 * Strategy: expand the schedule (one-time + recurring, minus exceptions),
 * cross-reference each scheduled visit with completed EVV time entries.
 * - If a matching time entry exists → bill the ACTUAL clocked hours (source=evv_confirmed)
 * - If no time entry yet → bill the SCHEDULED hours (source=scheduled)
 * - Time entries with no matching schedule → bill as-is (source=unscheduled_evv)
 *
 * This means billing works even when caregivers haven't clocked in/out via EVV
 * yet, and surfaces variances between scheduled and actual when EVV is in use.
 */
async function generateLineItems(clientId, referralSourceId, careTypeId, billingPeriodStart, billingPeriodEnd) {
  // ── Rate lookup ──────────────────────────────────────────────────────────
  let rate = 25.00;
  let rateType = 'hourly';

  if (referralSourceId) {
    const rateResult = await db.query(`
      SELECT rate_amount, rate_type
      FROM referral_source_rates
      WHERE referral_source_id = $1
        AND (care_type_id = $2 OR care_type_id IS NULL)
        AND (is_active = true OR is_active IS NULL)
        AND (effective_date IS NULL OR effective_date <= $3)
        AND (end_date IS NULL OR end_date >= $4)
      ORDER BY
        CASE WHEN care_type_id = $2 THEN 0 ELSE 1 END,
        effective_date DESC NULLS LAST
      LIMIT 1
    `, [referralSourceId, careTypeId, billingPeriodEnd, billingPeriodStart]);

    if (rateResult.rows.length > 0) {
      rate = parseFloat(rateResult.rows[0].rate_amount);
      rateType = rateResult.rows[0].rate_type || 'hourly';
    }
  }

  // Fall back to private-pay rate if no referral-source rate found
  if (rate === 25.00 && !referralSourceId) {
    const clientRate = await db.query(
      `SELECT private_pay_rate, private_pay_rate_type FROM clients WHERE id = $1`,
      [clientId]
    );
    if (clientRate.rows[0]?.private_pay_rate) {
      rate = parseFloat(clientRate.rows[0].private_pay_rate);
      rateType = clientRate.rows[0].private_pay_rate_type || 'hourly';
    }
  }

  // ── Pull completed time entries for the period ───────────────────────────
  const entriesResult = await db.query(`
    SELECT
      te.id as time_entry_id,
      te.caregiver_id,
      u.first_name as caregiver_first_name,
      u.last_name as caregiver_last_name,
      DATE(te.start_time) as service_date,
      te.start_time,
      te.end_time,
      te.duration_minutes,
      te.notes
    FROM time_entries te
    JOIN users u ON te.caregiver_id = u.id
    WHERE te.client_id = $1
      AND te.start_time >= $2
      AND te.start_time < ($3::date + INTERVAL '1 day')
      AND te.is_complete = true
    ORDER BY te.start_time
  `, [clientId, billingPeriodStart, billingPeriodEnd]);

  // ── Pull schedules that could produce occurrences in the period ──────────
  const schedulesResult = await db.query(`
    SELECT s.*,
      u.first_name as caregiver_first_name,
      u.last_name  as caregiver_last_name
    FROM schedules s
    JOIN users u ON s.caregiver_id = u.id
    WHERE s.client_id = $1
      AND (s.is_active = true OR s.is_active IS NULL)
      AND (
        (s.date IS NOT NULL AND s.date BETWEEN $2 AND $3)
        OR (s.day_of_week IS NOT NULL)
      )
  `, [clientId, billingPeriodStart, billingPeriodEnd]);

  // ── Pull exceptions for those schedules in range ─────────────────────────
  let exceptionsByScheduleDate = new Map(); // key: `${schedule_id}|${YYYY-MM-DD}`
  if (schedulesResult.rows.length > 0) {
    const scheduleIds = schedulesResult.rows.map(s => s.id);
    const excResult = await db.query(`
      SELECT * FROM schedule_exceptions
      WHERE schedule_id = ANY($1::uuid[])
        AND exception_date BETWEEN $2 AND $3
    `, [scheduleIds, billingPeriodStart, billingPeriodEnd]);
    for (const ex of excResult.rows) {
      exceptionsByScheduleDate.set(`${ex.schedule_id}|${ymd(ex.exception_date)}`, ex);
    }
  }

  // ── Expand schedules → expected visits per date ──────────────────────────
  // Each visit: { date, caregiver_id, caregiver_first/last, start_time, end_time, schedule_id }
  const expectedVisits = [];
  const periodStart = toDateOnly(billingPeriodStart);
  const periodEnd   = toDateOnly(billingPeriodEnd);

  for (const sched of schedulesResult.rows) {
    // One-time schedule
    if (sched.date) {
      const occDate = toDateOnly(sched.date);
      if (occDate < periodStart || occDate > periodEnd) continue;
      const exc = exceptionsByScheduleDate.get(`${sched.id}|${ymd(occDate)}`);
      if (exc && exc.exception_type === 'cancelled') continue;
      const startHms = (exc && exc.override_start_time) ? exc.override_start_time : sched.start_time;
      const endHms   = (exc && exc.override_end_time)   ? exc.override_end_time   : sched.end_time;
      expectedVisits.push({
        date: occDate,
        caregiver_id: (exc && exc.override_caregiver_id) ? exc.override_caregiver_id : sched.caregiver_id,
        caregiver_first_name: sched.caregiver_first_name,
        caregiver_last_name: sched.caregiver_last_name,
        start_time: startHms,
        end_time: endHms,
        schedule_id: sched.id,
        notes: sched.notes,
      });
      continue;
    }

    // Recurring schedule → expand across the period
    if (sched.day_of_week === null || sched.day_of_week === undefined) continue;
    for (let d = new Date(periodStart); d <= periodEnd; d = new Date(d.getTime() + DAY_MS)) {
      if (d.getDay() !== sched.day_of_week) continue;
      if (!isRecurringActiveOn(sched, d)) continue;
      const exc = exceptionsByScheduleDate.get(`${sched.id}|${ymd(d)}`);
      if (exc && exc.exception_type === 'cancelled') continue;
      const startHms = (exc && exc.override_start_time) ? exc.override_start_time : sched.start_time;
      const endHms   = (exc && exc.override_end_time)   ? exc.override_end_time   : sched.end_time;
      expectedVisits.push({
        date: new Date(d),
        caregiver_id: (exc && exc.override_caregiver_id) ? exc.override_caregiver_id : sched.caregiver_id,
        caregiver_first_name: sched.caregiver_first_name,
        caregiver_last_name: sched.caregiver_last_name,
        start_time: startHms,
        end_time: endHms,
        schedule_id: sched.id,
        notes: sched.notes,
      });
    }
  }

  // ── Match time entries to expected visits (by caregiver + date) ─────────
  const unmatchedEntries = [...entriesResult.rows];
  const visitsWithMatch = expectedVisits.map(v => {
    // Same caregiver, same calendar date — pick closest by start time
    const candidates = unmatchedEntries.filter(te =>
      te.caregiver_id === v.caregiver_id &&
      ymd(te.start_time) === ymd(v.date)
    );
    if (candidates.length === 0) return { visit: v, entry: null };
    const visitStartMs = combineDateAndTime(v.date, v.start_time)?.getTime() || 0;
    candidates.sort((a, b) => {
      const da = Math.abs(new Date(a.start_time).getTime() - visitStartMs);
      const db = Math.abs(new Date(b.start_time).getTime() - visitStartMs);
      return da - db;
    });
    const matched = candidates[0];
    const idx = unmatchedEntries.indexOf(matched);
    if (idx >= 0) unmatchedEntries.splice(idx, 1);
    return { visit: v, entry: matched };
  });

  // ── Build line items ────────────────────────────────────────────────────
  const lineItems = [];
  let invoiceTotal = 0;

  // Sort scheduled-visit lines by date for stable output
  visitsWithMatch.sort((a, b) => {
    const aT = a.visit.date.getTime();
    const bT = b.visit.date.getTime();
    if (aT !== bT) return aT - bT;
    return (a.visit.start_time || '').localeCompare(b.visit.start_time || '');
  });

  for (const { visit, entry } of visitsWithMatch) {
    let hours = 0;
    let startISO = null, endISO = null, timeRangeLabel = '';
    let source = 'scheduled';
    let timeEntryId = null;

    if (entry) {
      // EVV-confirmed → bill actual
      source = 'evv_confirmed';
      timeEntryId = entry.time_entry_id;
      if (entry.duration_minutes) {
        hours = entry.duration_minutes / 60.0;
      } else if (entry.start_time && entry.end_time) {
        hours = (new Date(entry.end_time) - new Date(entry.start_time)) / (1000 * 60 * 60);
      }
      startISO = entry.start_time;
      endISO = entry.end_time;
      const st = new Date(entry.start_time);
      const et = entry.end_time ? new Date(entry.end_time) : null;
      timeRangeLabel = et
        ? `${st.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })} - ${et.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })}`
        : '';
    } else {
      // No EVV → bill scheduled
      hours = hoursBetween(visit.start_time, visit.end_time);
      startISO = combineDateAndTime(visit.date, visit.start_time);
      endISO   = combineDateAndTime(visit.date, visit.end_time);
      timeRangeLabel = `${fmtTime12(visit.start_time)} - ${fmtTime12(visit.end_time)}`;
    }

    if (hours <= 0) continue;

    const amount = rateType === 'hourly' ? hours * rate : rate;
    invoiceTotal += amount;

    const baseDesc = entry?.notes || visit.notes || 'Home Care Services';
    const description = timeRangeLabel
      ? `${baseDesc} (${timeRangeLabel})`
      : baseDesc;

    lineItems.push({
      time_entry_id: timeEntryId,
      schedule_id: visit.schedule_id,
      caregiver_id: visit.caregiver_id,
      caregiver_first_name: visit.caregiver_first_name,
      caregiver_last_name: visit.caregiver_last_name,
      service_date: ymd(visit.date),
      start_time: startISO,
      end_time: endISO,
      time_range: timeRangeLabel,
      description,
      hours,
      rate,
      rate_type: rateType,
      amount,
      source, // 'evv_confirmed' or 'scheduled'
    });
  }

  // Orphan time entries (worked but not on schedule) → bill as unscheduled
  for (const entry of unmatchedEntries) {
    let hours = 0;
    if (entry.duration_minutes) {
      hours = entry.duration_minutes / 60.0;
    } else if (entry.start_time && entry.end_time) {
      hours = (new Date(entry.end_time) - new Date(entry.start_time)) / (1000 * 60 * 60);
    }
    if (hours <= 0) continue;

    const amount = rateType === 'hourly' ? hours * rate : rate;
    invoiceTotal += amount;

    const st = new Date(entry.start_time);
    const et = entry.end_time ? new Date(entry.end_time) : null;
    const timeRangeLabel = et
      ? `${st.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })} - ${et.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })}`
      : '';
    const baseDesc = entry.notes || 'Home Care Services (unscheduled)';

    lineItems.push({
      time_entry_id: entry.time_entry_id,
      schedule_id: null,
      caregiver_id: entry.caregiver_id,
      caregiver_first_name: entry.caregiver_first_name,
      caregiver_last_name: entry.caregiver_last_name,
      service_date: ymd(entry.start_time),
      start_time: entry.start_time,
      end_time: entry.end_time,
      time_range: timeRangeLabel,
      description: timeRangeLabel ? `${baseDesc} (${timeRangeLabel})` : baseDesc,
      hours,
      rate,
      rate_type: rateType,
      amount,
      source: 'unscheduled_evv',
    });
  }

  // Final sort by date for the invoice
  lineItems.sort((a, b) => (a.service_date || '').localeCompare(b.service_date || ''));

  return { lineItems, total: invoiceTotal };
}

/**
 * Insert line items into database. Pass a pooled client to run inside a transaction.
 */
async function insertLineItems(invoiceId, lineItems, dbClient = db) {
  for (const item of lineItems) {
    await dbClient.query(`
      INSERT INTO invoice_line_items (
        invoice_id, time_entry_id, caregiver_id, description, hours, rate, amount, service_date
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
    `, [
      invoiceId,
      item.time_entry_id,
      item.caregiver_id,
      item.description,
      item.hours,
      item.rate,
      item.amount,
      item.service_date || null
    ]);
  }
}

/**
 * Generate unique invoice number
 */
function generateInvoiceNumber(clientId) {
  const timestamp = Date.now().toString(36).toUpperCase();
  const clientPart = clientId.slice(0, 4).toUpperCase();
  return `INV-${timestamp}-${clientPart}`;
}

// ==================== INVOICES ====================

// List all invoices
router.get('/invoices', auth, async (req, res) => {
  try {
    const result = await db.query(`
      SELECT i.*, 
        c.first_name, c.last_name,
        rs.name as referral_source_name,
        (SELECT COALESCE(SUM(hours), 0) FROM invoice_line_items WHERE invoice_id = i.id) as total_hours
      FROM invoices i
      JOIN clients c ON i.client_id = c.id
      LEFT JOIN referral_sources rs ON i.referral_source_id = rs.id
      ORDER BY i.created_at DESC
    `);
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching invoices:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get single invoice with line items
router.get('/invoices/:id', auth, async (req, res) => {
  try {
    const invoiceResult = await db.query(`
      SELECT i.*, 
        c.first_name, c.last_name, c.referral_source_id, c.care_type_id,
        c.email, c.phone, c.address, c.city, c.state, c.zip,
        rs.name as referral_source_name
      FROM invoices i
      JOIN clients c ON i.client_id = c.id
      LEFT JOIN referral_sources rs ON c.referral_source_id = rs.id
      WHERE i.id = $1
    `, [req.params.id]);

    if (invoiceResult.rows.length === 0) {
      return res.status(404).json({ error: 'Invoice not found' });
    }

    const invoice = invoiceResult.rows[0];

    const lineItemsResult = await db.query(`
      SELECT 
        ili.*,
        u.first_name as caregiver_first_name,
        u.last_name as caregiver_last_name,
        COALESCE(ili.service_date, DATE(te.start_time)) as service_date
      FROM invoice_line_items ili
      LEFT JOIN users u ON ili.caregiver_id = u.id
      LEFT JOIN time_entries te ON ili.time_entry_id = te.id
      WHERE ili.invoice_id = $1
      ORDER BY COALESCE(ili.service_date, DATE(te.start_time)), u.last_name
    `, [req.params.id]);

    let lineItems = lineItemsResult.rows;

    if (lineItems.length === 0) {
      const regenerated = await generateLineItems(
        invoice.client_id,
        invoice.referral_source_id,
        invoice.care_type_id,
        invoice.billing_period_start,
        invoice.billing_period_end
      );
      lineItems = regenerated.lineItems;
    }

    res.json({
      ...invoice,
      line_items: lineItems.map(li => ({ ...li, description: reformatTimesIn(li.description) })),
      total_hours: lineItems.reduce((sum, item) => sum + parseFloat(item.hours || 0), 0)
    });

  } catch (error) {
    console.error('Error fetching invoice:', error);
    res.status(500).json({ error: error.message });
  }
});

// Preview line items WITHOUT saving an invoice. Used by the manual invoice
// form's "Import from Schedule + EVV" button so the user can review and edit
// auto-generated line items before saving.
router.post('/invoices/preview', auth, async (req, res) => {
  const { clientId, billingPeriodStart, billingPeriodEnd } = req.body;
  if (!clientId || !billingPeriodStart || !billingPeriodEnd) {
    return res.status(400).json({ error: 'clientId, billingPeriodStart, billingPeriodEnd are required' });
  }
  try {
    const clientResult = await db.query(`
      SELECT id, referral_source_id, care_type_id, is_private_pay
      FROM clients WHERE id = $1
    `, [clientId]);
    if (clientResult.rows.length === 0) return res.status(404).json({ error: 'Client not found' });

    const c = clientResult.rows[0];
    const { lineItems, total } = await generateLineItems(
      clientId, c.referral_source_id, c.care_type_id, billingPeriodStart, billingPeriodEnd
    );

    res.json({
      lineItems,
      total,
      counts: {
        total: lineItems.length,
        evvConfirmed: lineItems.filter(li => li.source === 'evv_confirmed').length,
        scheduled:    lineItems.filter(li => li.source === 'scheduled').length,
        unscheduled:  lineItems.filter(li => li.source === 'unscheduled_evv').length,
      }
    });
  } catch (error) {
    console.error('Error in invoice preview:', error);
    res.status(500).json({ error: error.message });
  }
});

// Generate single invoice — atomic: invoice + line items succeed or fail together
router.post('/invoices/generate-with-rates', auth, async (req, res) => {
  const { clientId, billingPeriodStart, billingPeriodEnd, notes } = req.body;

  if (!clientId || !billingPeriodStart || !billingPeriodEnd) {
    return res.status(400).json({ error: 'Client and billing period are required' });
  }

  const dbClient = await db.pool.connect();
  try {
    const clientResult = await dbClient.query(`
      SELECT id, first_name, last_name, referral_source_id, care_type_id,
             is_private_pay, private_pay_rate, private_pay_rate_type
      FROM clients WHERE id = $1
    `, [clientId]);

    if (clientResult.rows.length === 0) {
      return res.status(404).json({ error: 'Client not found' });
    }

    const client = clientResult.rows[0];

    const existingResult = await dbClient.query(`
      SELECT id, invoice_number FROM invoices
      WHERE client_id = $1
        AND billing_period_start = $2
        AND billing_period_end = $3
    `, [clientId, billingPeriodStart, billingPeriodEnd]);

    if (existingResult.rows.length > 0) {
      return res.status(400).json({
        error: `Invoice ${existingResult.rows[0].invoice_number} already exists for this period`
      });
    }

    const { lineItems, total } = await generateLineItems(
      clientId,
      client.referral_source_id,
      client.care_type_id,
      billingPeriodStart,
      billingPeriodEnd
    );

    if (lineItems.length === 0) {
      return res.status(400).json({
        error: 'No scheduled visits or completed EVV entries found for this client in the selected period'
      });
    }

    const dueDate = new Date(billingPeriodEnd);
    dueDate.setDate(dueDate.getDate() + 30);

    const invoiceNumber = generateInvoiceNumber(clientId);

    await dbClient.query('BEGIN');

    const invoiceResult = await dbClient.query(`
      INSERT INTO invoices (
        client_id, invoice_number, billing_period_start, billing_period_end,
        subtotal, total, payment_status, payment_due_date, notes,
        referral_source_id, invoice_type
      ) VALUES ($1, $2, $3, $4, $5, $6, 'pending', $7, $8, $9, $10)
      RETURNING *
    `, [
      clientId, invoiceNumber, billingPeriodStart, billingPeriodEnd,
      total, total, dueDate, notes,
      client.referral_source_id,
      client.is_private_pay ? 'private_pay' : 'insurance'
    ]);

    const invoice = invoiceResult.rows[0];
    await insertLineItems(invoice.id, lineItems, dbClient);

    await dbClient.query('COMMIT');

    let referralSourceName = null;
    if (client.referral_source_id) {
      const rsResult = await dbClient.query(
        'SELECT name FROM referral_sources WHERE id = $1',
        [client.referral_source_id]
      );
      referralSourceName = rsResult.rows[0]?.name;
    }

    res.json({
      ...invoice,
      first_name: client.first_name,
      last_name: client.last_name,
      referral_source_name: referralSourceName,
      line_items: lineItems,
      total_hours: lineItems.reduce((sum, item) => sum + parseFloat(item.hours), 0)
    });

  } catch (error) {
    try { await dbClient.query('ROLLBACK'); } catch {}
    console.error('Error generating invoice:', error);
    res.status(500).json({ error: error.message });
  } finally {
    dbClient.release();
  }
});

// Create manual invoice with custom line items
router.post('/invoices/manual', auth, async (req, res) => {
  const { clientId, billingPeriodStart, billingPeriodEnd, notes, lineItems, detailedMode, acknowledgeRateWarning } = req.body;

  if (!clientId || !billingPeriodStart || !billingPeriodEnd) {
    return res.status(400).json({ error: 'Client and billing period are required' });
  }

  if (!lineItems || lineItems.length === 0) {
    return res.status(400).json({ error: 'At least one line item is required' });
  }

  const dbClient = await db.pool.connect();
  try {
    // Get client info
    const clientResult = await dbClient.query(`
      SELECT id, first_name, last_name, referral_source_id, care_type_id, is_private_pay,
             private_pay_rate
      FROM clients WHERE id = $1
    `, [clientId]);

    if (clientResult.rows.length === 0) {
      return res.status(404).json({ error: 'Client not found' });
    }

    const client = clientResult.rows[0];

    // Rate sanity warning: catch obvious typos like $0.05 instead of $33,
    // or $300 instead of $30. Compare each line's rate to the client's
    // configured rate and refuse if any is <50% or >200% off, unless the
    // caller has explicitly acknowledged the warning. Skips lines with rate=0
    // (write-offs / adjustments) and lines with no expected rate to compare.
    if (!acknowledgeRateWarning) {
      let expectedRate = null;
      if (client.referral_source_id) {
        const r = await dbClient.query(
          `SELECT rate_amount FROM referral_source_rates
             WHERE referral_source_id = $1
               AND (care_type_id = $2 OR care_type_id IS NULL)
               AND (is_active = true OR is_active IS NULL)
               AND (effective_date IS NULL OR effective_date <= $3)
               AND (end_date IS NULL OR end_date >= $4)
             ORDER BY CASE WHEN care_type_id = $2 THEN 0 ELSE 1 END,
                      effective_date DESC NULLS LAST
             LIMIT 1`,
          [client.referral_source_id, client.care_type_id, billingPeriodEnd, billingPeriodStart]
        );
        if (r.rows[0]) expectedRate = parseFloat(r.rows[0].rate_amount);
      }
      if (expectedRate == null && client.private_pay_rate) {
        expectedRate = parseFloat(client.private_pay_rate);
      }
      if (expectedRate && expectedRate > 0) {
        const offendingLines = lineItems
          .map((item, idx) => ({ idx, rate: parseFloat(item.rate || 0), hours: parseFloat(item.hours || 0) }))
          .filter(l => l.rate > 0 && l.hours > 0 && (l.rate < expectedRate * 0.5 || l.rate > expectedRate * 2));
        if (offendingLines.length > 0) {
          return res.status(409).json({
            error: 'Rate looks wrong',
            message: `One or more line items have a rate that's well outside the client's configured rate of $${expectedRate.toFixed(2)}/hr. Double-check before saving.`,
            expectedRate,
            offendingLines: offendingLines.map(l => ({ lineIndex: l.idx, rate: l.rate })),
            hint: 'Resubmit with acknowledgeRateWarning: true if the rate is correct.',
          });
        }
      }
    }

    // Check for existing invoice
    const existingResult = await dbClient.query(`
      SELECT id, invoice_number FROM invoices
      WHERE client_id = $1
        AND billing_period_start = $2
        AND billing_period_end = $3
    `, [clientId, billingPeriodStart, billingPeriodEnd]);

    if (existingResult.rows.length > 0) {
      return res.status(400).json({
        error: `Invoice ${existingResult.rows[0].invoice_number} already exists for this period`
      });
    }

    // Calculate total from line items
    let total = 0;
    for (const item of lineItems) {
      const amount = parseFloat(item.hours || 0) * parseFloat(item.rate || 0);
      total += amount;
    }

    // Generate invoice number
    const timestamp = Date.now().toString(36).toUpperCase();
    const clientPart = clientId.slice(0, 4).toUpperCase();
    const invoiceNumber = `INV-${timestamp}-${clientPart}`;

    // Calculate due date
    const dueDate = new Date(billingPeriodEnd);
    dueDate.setDate(dueDate.getDate() + 30);

    // Atomic insert: invoice + all line items, or nothing
    await dbClient.query('BEGIN');

    const invoiceResult = await dbClient.query(`
      INSERT INTO invoices (
        client_id, invoice_number, billing_period_start, billing_period_end,
        subtotal, total, payment_status, payment_due_date, notes,
        referral_source_id, invoice_type
      ) VALUES ($1, $2, $3, $4, $5, $6, 'pending', $7, $8, $9, $10)
      RETURNING *
    `, [
      clientId, invoiceNumber, billingPeriodStart, billingPeriodEnd,
      total, total, dueDate, notes,
      client.referral_source_id,
      client.is_private_pay ? 'private_pay' : 'insurance'
    ]);

    const invoice = invoiceResult.rows[0];

    // Insert line items with optional service_date and times
    const insertedLineItems = [];
    for (const item of lineItems) {
      const amount = parseFloat(item.hours || 0) * parseFloat(item.rate || 0);

      // Build description with time info if provided. Convert the 24h
      // "HH:MM" dropdown values into 12h AM/PM so the printed invoice
      // shows "1:30 PM" instead of "13:30".
      const to12h = (hhmm) => {
        if (!hhmm || !/^\d{1,2}:\d{2}$/.test(hhmm)) return hhmm;
        const [h, m] = hhmm.split(':').map(Number);
        const ampm = h < 12 ? 'AM' : 'PM';
        const dh = h === 0 ? 12 : h > 12 ? h - 12 : h;
        return `${dh}:${m.toString().padStart(2, '0')} ${ampm}`;
      };
      let description = item.description || 'Home Care Services';
      if (detailedMode && item.startTime && item.endTime) {
        description = `${description} (${to12h(item.startTime)} - ${to12h(item.endTime)})`;
      }

      await dbClient.query(`
        INSERT INTO invoice_line_items (
          invoice_id, caregiver_id, description, hours, rate, amount, service_date
        ) VALUES ($1, $2, $3, $4, $5, $6, $7)
      `, [
        invoice.id,
        item.caregiverId || null,
        description,
        item.hours,
        item.rate,
        amount,
        item.serviceDate || null
      ]);

      insertedLineItems.push({
        caregiver_id: item.caregiverId,
        caregiver_first_name: item.caregiverName?.split(' ')[0] || '',
        caregiver_last_name: item.caregiverName?.split(' ').slice(1).join(' ') || '',
        description: description,
        service_date: item.serviceDate,
        hours: item.hours,
        rate: item.rate,
        amount: amount
      });
    }

    await dbClient.query('COMMIT');

    // Get referral source name
    let referralSourceName = null;
    if (client.referral_source_id) {
      const rsResult = await dbClient.query(
        'SELECT name FROM referral_sources WHERE id = $1',
        [client.referral_source_id]
      );
      referralSourceName = rsResult.rows[0]?.name;
    }

    res.json({
      ...invoice,
      first_name: client.first_name,
      last_name: client.last_name,
      referral_source_name: referralSourceName,
      line_items: insertedLineItems,
      total_hours: insertedLineItems.reduce((sum, item) => sum + parseFloat(item.hours), 0)
    });

  } catch (error) {
    try { await dbClient.query('ROLLBACK'); } catch {}
    console.error('Error creating manual invoice:', error);
    res.status(500).json({ error: error.message });
  } finally {
    dbClient.release();
  }
});

// Batch generate invoices
router.post('/invoices/batch-generate', auth, async (req, res) => {
  const { billingPeriodStart, billingPeriodEnd, clientFilter, referralSourceId } = req.body;

  if (!billingPeriodStart || !billingPeriodEnd) {
    return res.status(400).json({ error: 'Billing period is required' });
  }

  try {
    let clientQuery = `
      SELECT DISTINCT c.id, c.first_name, c.last_name, c.referral_source_id, c.care_type_id,
                      c.is_private_pay
      FROM clients c
      JOIN time_entries te ON te.client_id = c.id
      WHERE te.start_time >= $1 
        AND te.start_time < ($2::date + INTERVAL '1 day')
        AND te.is_complete = true
        AND (c.status = 'active' OR c.is_active = true)
    `;
    const params = [billingPeriodStart, billingPeriodEnd];

    if (clientFilter === 'insurance') {
      clientQuery += ` AND c.referral_source_id IS NOT NULL AND c.is_private_pay IS NOT TRUE`;
    } else if (clientFilter === 'private') {
      clientQuery += ` AND (c.referral_source_id IS NULL OR c.is_private_pay = TRUE)`;
    }

    if (referralSourceId) {
      clientQuery += ` AND c.referral_source_id = $${params.length + 1}`;
      params.push(referralSourceId);
    }

    clientQuery += ` ORDER BY c.last_name, c.first_name`;

    const clientsResult = await db.query(clientQuery, params);

    let generatedCount = 0;
    let skippedCount = 0;
    let totalAmount = 0;
    let totalHours = 0;
    const generatedInvoices = [];
    const skippedClients = [];

    for (const client of clientsResult.rows) {
      const existingResult = await db.query(`
        SELECT id, invoice_number FROM invoices
        WHERE client_id = $1
          AND billing_period_start = $2
          AND billing_period_end = $3
      `, [client.id, billingPeriodStart, billingPeriodEnd]);

      if (existingResult.rows.length > 0) {
        skippedCount++;
        skippedClients.push({
          name: `${client.first_name} ${client.last_name}`,
          reason: `Invoice ${existingResult.rows[0].invoice_number} already exists`
        });
        continue;
      }

      const { lineItems, total } = await generateLineItems(
        client.id,
        client.referral_source_id,
        client.care_type_id,
        billingPeriodStart,
        billingPeriodEnd
      );

      if (lineItems.length === 0 || total <= 0) {
        skippedCount++;
        skippedClients.push({
          name: `${client.first_name} ${client.last_name}`,
          reason: 'No billable hours found'
        });
        continue;
      }

      const dueDate = new Date(billingPeriodEnd);
      dueDate.setDate(dueDate.getDate() + 30);

      const invoiceNumber = generateInvoiceNumber(client.id);

      // Per-client transaction: if line-item insert fails, this one rolls back
      // and we skip it without aborting the whole batch.
      const dbClient = await db.pool.connect();
      try {
        await dbClient.query('BEGIN');
        const invoiceResult = await dbClient.query(`
          INSERT INTO invoices (
            client_id, invoice_number, billing_period_start, billing_period_end,
            subtotal, total, payment_status, payment_due_date,
            referral_source_id, invoice_type
          ) VALUES ($1, $2, $3, $4, $5, $6, 'pending', $7, $8, $9)
          RETURNING *
        `, [
          client.id, invoiceNumber, billingPeriodStart, billingPeriodEnd,
          total, total, dueDate,
          client.referral_source_id,
          client.is_private_pay ? 'private_pay' : 'insurance'
        ]);

        const invoice = invoiceResult.rows[0];
        await insertLineItems(invoice.id, lineItems, dbClient);
        await dbClient.query('COMMIT');

        const hours = lineItems.reduce((sum, item) => sum + parseFloat(item.hours), 0);
        generatedCount++;
        totalAmount += total;
        totalHours += hours;
        generatedInvoices.push({
          invoiceNumber,
          clientName: `${client.first_name} ${client.last_name}`,
          total,
          hours
        });
      } catch (perClientErr) {
        try { await dbClient.query('ROLLBACK'); } catch {}
        skippedCount++;
        skippedClients.push({
          name: `${client.first_name} ${client.last_name}`,
          reason: `Failed: ${perClientErr.message}`
        });
      } finally {
        dbClient.release();
      }
    }

    res.json({
      count: generatedCount,
      skipped: skippedCount,
      total: totalAmount,
      totalHours: totalHours,
      invoices: generatedInvoices,
      skippedClients: skippedClients
    });

  } catch (error) {
    console.error('Error in batch generation:', error);
    res.status(500).json({ error: error.message });
  }
});

// Update invoice payment status
router.put('/invoices/:id/payment-status', auth, async (req, res) => {
  const { status, paymentDate } = req.body;
  
  try {
    const result = await db.query(`
      UPDATE invoices 
      SET payment_status = $1,
          payment_date = $2,
          paid_at = CASE WHEN $1 = 'paid' THEN NOW() ELSE paid_at END,
          amount_paid = CASE WHEN $1 = 'paid' THEN total ELSE amount_paid END,
          updated_at = NOW()
      WHERE id = $3
      RETURNING *
    `, [status, paymentDate || new Date(), req.params.id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Invoice not found' });
    }

    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error updating invoice status:', error);
    res.status(500).json({ error: error.message });
  }
});

// Delete invoice
router.delete('/invoices/:id', auth, async (req, res) => {
  try {
    // Check if invoice exists
    const invoiceCheck = await db.query('SELECT id, invoice_number FROM invoices WHERE id = $1', [req.params.id]);
    if (invoiceCheck.rows.length === 0) {
      return res.status(404).json({ error: 'Invoice not found' });
    }
    
    const invoiceNumber = invoiceCheck.rows[0].invoice_number;

    // Delete line items first (foreign key constraint)
    await db.query('DELETE FROM invoice_line_items WHERE invoice_id = $1', [req.params.id]);
    
    // Delete payments if table exists
    try {
      await db.query('DELETE FROM invoice_payments WHERE invoice_id = $1', [req.params.id]);
    } catch (e) { /* table might not exist */ }
    
    // Delete adjustments if table exists
    try {
      await db.query('DELETE FROM invoice_adjustments WHERE invoice_id = $1', [req.params.id]);
    } catch (e) { /* table might not exist */ }
    
    // Delete invoice
    await db.query('DELETE FROM invoices WHERE id = $1', [req.params.id]);

    res.json({ message: `Invoice ${invoiceNumber} deleted successfully` });
  } catch (error) {
    console.error('Error deleting invoice:', error);
    res.status(500).json({ error: error.message });
  }
});

// ==================== SEND INVOICE EMAIL ====================

// Send invoice to client via email with Pay Now link
router.post('/invoices/:id/send-email', auth, async (req, res) => {
  try {
    const invoiceResult = await db.query(`
      SELECT i.*,
        c.first_name, c.last_name, c.email as client_email
      FROM invoices i
      JOIN clients c ON i.client_id = c.id
      WHERE i.id = $1
    `, [req.params.id]);

    if (invoiceResult.rows.length === 0) {
      return res.status(404).json({ error: 'Invoice not found' });
    }

    const invoice = invoiceResult.rows[0];

    // Use override email from request body, or fall back to client email
    const recipientEmail = req.body.email || invoice.client_email;
    if (!recipientEmail) {
      return res.status(400).json({ error: 'No email address found for this client. Please provide an email.' });
    }

    if (!emailConfigured) {
      return res.status(503).json({ error: 'Email service not configured. Set AWS SES credentials in environment.' });
    }

    const amountDue = parseFloat(invoice.total) - parseFloat(invoice.amount_paid || 0) - parseFloat(invoice.amount_adjusted || 0);

    // Get line items
    const lineItemsResult = await db.query(`
      SELECT ili.*, u.first_name as caregiver_first_name, u.last_name as caregiver_last_name
      FROM invoice_line_items ili
      LEFT JOIN users u ON ili.caregiver_id = u.id
      WHERE ili.invoice_id = $1
      ORDER BY ili.service_date, u.last_name
    `, [req.params.id]);

    const emailLineItems = lineItemsResult.rows.map(li => ({ ...li, description: reformatTimesIn(li.description) }));

    let sent;
    try {
      sent = await sendInvoiceEmail({
        to: recipientEmail,
        clientName: `${invoice.first_name} ${invoice.last_name}`,
        invoiceNumber: invoice.invoice_number,
        invoiceId: invoice.id,
        total: invoice.total,
        amountDue,
        billingPeriodStart: invoice.billing_period_start,
        billingPeriodEnd: invoice.billing_period_end,
        dueDate: invoice.payment_due_date,
        lineItems: emailLineItems,
      });
    } catch (sendErr) {
      return res.status(502).json({ error: `SendGrid rejected: ${sendErr.message}` });
    }

    if (!sent) {
      return res.status(503).json({ error: 'Email service not configured on server.' });
    }

    // Track that the invoice was emailed
    await db.query(`
      UPDATE invoices
      SET notes = COALESCE(notes, '') || $1, updated_at = NOW()
      WHERE id = $2
    `, [`\nEmailed to ${recipientEmail} on ${new Date().toLocaleDateString()}`, req.params.id]);

    res.json({ success: true, sentTo: recipientEmail });
  } catch (error) {
    console.error('Error sending invoice email:', error);
    res.status(500).json({ error: error.message });
  }
});

// POST /api/billing/invoices/:id/send-reminder
// Sends a "your payment is due/overdue" email to the client. Refuses on paid
// invoices so reminders can't go out for already-settled bills.
router.post('/invoices/:id/send-reminder', auth, async (req, res) => {
  try {
    const invoiceResult = await db.query(`
      SELECT i.*, c.first_name, c.last_name, c.email as client_email
      FROM invoices i
      JOIN clients c ON i.client_id = c.id
      WHERE i.id = $1
    `, [req.params.id]);

    if (invoiceResult.rows.length === 0) {
      return res.status(404).json({ error: 'Invoice not found' });
    }

    const invoice = invoiceResult.rows[0];
    if (invoice.payment_status === 'paid') {
      return res.status(400).json({ error: 'This invoice is already paid — no reminder needed.' });
    }

    const recipientEmail = req.body.email || invoice.client_email;
    if (!recipientEmail) {
      return res.status(400).json({ error: 'No email address found for this client. Please provide an email.' });
    }

    if (!emailConfigured) {
      return res.status(503).json({ error: 'Email service not configured. Set AWS SES credentials in environment.' });
    }

    const amountDue = parseFloat(invoice.total) - parseFloat(invoice.amount_paid || 0) - parseFloat(invoice.amount_adjusted || 0);
    if (amountDue <= 0) {
      return res.status(400).json({ error: 'No balance due on this invoice.' });
    }

    const dueDate = invoice.payment_due_date;
    const daysOverdue = Math.floor((Date.now() - new Date(dueDate).getTime()) / (1000 * 60 * 60 * 24));

    try {
      await sendInvoiceReminder({
        to: recipientEmail,
        clientName: `${invoice.first_name} ${invoice.last_name}`,
        invoiceNumber: invoice.invoice_number,
        invoiceId: invoice.id,
        amountDue,
        dueDate,
        daysOverdue,
      });
    } catch (sendErr) {
      return res.status(502).json({ error: `Email send failed: ${sendErr.message}` });
    }

    // Append to notes so the timeline is visible in the invoice view.
    const stamp = new Date().toLocaleDateString();
    const label = daysOverdue > 0 ? `${daysOverdue}d overdue` : 'pre-due';
    await db.query(`
      UPDATE invoices
      SET notes = COALESCE(notes, '') || $1, updated_at = NOW()
      WHERE id = $2
    `, [`\nReminder sent to ${recipientEmail} on ${stamp} (${label})`, req.params.id]);

    res.json({ success: true, sentTo: recipientEmail, daysOverdue });
  } catch (error) {
    console.error('Error sending invoice reminder:', error);
    res.status(500).json({ error: error.message });
  }
});

// ==================== INVOICE PAYMENTS ====================

router.get('/invoice-payments', auth, async (req, res) => {
  try {
    const result = await db.query(`
      SELECT ip.*, i.invoice_number,
        CONCAT(c.first_name, ' ', c.last_name) as client_name
      FROM invoice_payments ip
      JOIN invoices i ON ip.invoice_id = i.id
      JOIN clients c ON i.client_id = c.id
      ORDER BY ip.payment_date DESC
    `);
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching payments:', error);
    res.status(500).json({ error: error.message });
  }
});

router.post('/invoice-payments', auth, async (req, res) => {
  const { invoiceId, amount, paymentDate, paymentMethod, referenceNumber, notes } = req.body;
  try {
    const paymentResult = await db.query(`
      INSERT INTO invoice_payments (invoice_id, amount, payment_date, payment_method, reference_number, notes)
      VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING *
    `, [invoiceId, amount, paymentDate, paymentMethod, referenceNumber, notes]);

    await db.query(`
      UPDATE invoices 
      SET amount_paid = COALESCE(amount_paid, 0) + $1,
          payment_status = CASE 
            WHEN COALESCE(amount_paid, 0) + $1 >= total THEN 'paid'
            WHEN COALESCE(amount_paid, 0) + $1 > 0 THEN 'partial'
            ELSE 'pending'
          END,
          payment_date = CASE WHEN COALESCE(amount_paid, 0) + $1 >= total THEN $2 ELSE payment_date END,
          paid_at = CASE WHEN COALESCE(amount_paid, 0) + $1 >= total THEN NOW() ELSE paid_at END
      WHERE id = $3
    `, [amount, paymentDate, invoiceId]);

    res.json(paymentResult.rows[0]);
  } catch (error) {
    console.error('Error recording payment:', error);
    res.status(500).json({ error: error.message });
  }
});

// ==================== INVOICE ADJUSTMENTS ====================

router.get('/invoice-adjustments', auth, async (req, res) => {
  try {
    const result = await db.query(`
      SELECT ia.*, i.invoice_number,
        CONCAT(c.first_name, ' ', c.last_name) as client_name
      FROM invoice_adjustments ia
      JOIN invoices i ON ia.invoice_id = i.id
      JOIN clients c ON i.client_id = c.id
      ORDER BY ia.created_at DESC
    `);
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching adjustments:', error);
    res.status(500).json({ error: error.message });
  }
});

router.post('/invoice-adjustments', auth, async (req, res) => {
  const { invoiceId, amount, type, reason, notes } = req.body;
  try {
    const result = await db.query(`
      INSERT INTO invoice_adjustments (invoice_id, amount, adjustment_type, reason, notes)
      VALUES ($1, $2, $3, $4, $5)
      RETURNING *
    `, [invoiceId, amount, type, reason, notes]);

    if (type === 'write_off' || type === 'discount') {
      await db.query(`
        UPDATE invoices 
        SET amount_adjusted = COALESCE(amount_adjusted, 0) + $1,
            payment_status = CASE 
              WHEN COALESCE(amount_paid, 0) + COALESCE(amount_adjusted, 0) + $1 >= total THEN 'paid'
              ELSE payment_status
            END
        WHERE id = $2
      `, [amount, invoiceId]);
    }

    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error recording adjustment:', error);
    res.status(500).json({ error: error.message });
  }
});

// ==================== REFERRAL SOURCE RATES ====================

router.get('/referral-source-rates', auth, async (req, res) => {
  try {
    const result = await db.query(`
      SELECT rsr.*,
        rs.name as referral_source_name,
        ct.name as care_type_name,
        (SELECT COUNT(*) FROM clients c
           WHERE c.is_active = true
             AND c.referral_source_id = rsr.referral_source_id
             AND (rsr.care_type_id IS NULL OR c.care_type_id = rsr.care_type_id)
        ) AS client_count
      FROM referral_source_rates rsr
      LEFT JOIN referral_sources rs ON rsr.referral_source_id = rs.id
      LEFT JOIN care_types ct ON rsr.care_type_id = ct.id
      ORDER BY rs.name, ct.name
    `);
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching rates:', error);
    res.status(500).json({ error: error.message });
  }
});

// GET /api/billing/missing-rates
// Surfaces payer × care-type combos that have ACTIVE CLIENTS but no
// configured rate — so admins know exactly which gaps will cause silent
// $0 billing. Example: Companion Care was being used on schedules but
// had no rate configured for either My Choice Wisconsin or Private Care.
router.get('/missing-rates', auth, async (req, res) => {
  try {
    const r = await db.query(`
      SELECT rs.id AS payer_id, rs.name AS payer_name,
             ct.id AS care_type_id, ct.name AS care_type_name,
             COUNT(DISTINCT c.id) AS affected_clients
        FROM clients c
        JOIN referral_sources rs ON c.referral_source_id = rs.id
        JOIN care_types ct ON c.care_type_id = ct.id
       WHERE c.is_active = true
         AND NOT EXISTS (
           SELECT 1 FROM referral_source_rates rsr
            WHERE rsr.referral_source_id = rs.id
              AND (rsr.care_type_id IS NULL OR rsr.care_type_id = ct.id)
              AND rsr.is_active = true
         )
       GROUP BY rs.id, rs.name, ct.id, ct.name
       ORDER BY rs.name, ct.name
    `);
    res.json(r.rows);
  } catch (error) { res.status(500).json({ error: error.message }); }
});

router.post('/referral-source-rates', auth, async (req, res) => {
  const { referralSourceId, careTypeId, rateAmount, rateType, effectiveDate } = req.body;
  try {
    const existing = await db.query(`
      SELECT id FROM referral_source_rates 
      WHERE referral_source_id = $1 
        AND (care_type_id = $2 OR (care_type_id IS NULL AND $2 IS NULL))
        AND (is_active = true OR is_active IS NULL)
    `, [referralSourceId, careTypeId || null]);

    if (existing.rows.length > 0) {
      await db.query(`
        UPDATE referral_source_rates 
        SET is_active = false, end_date = $1
        WHERE id = $2
      `, [effectiveDate || new Date(), existing.rows[0].id]);
    }

    const result = await db.query(`
      INSERT INTO referral_source_rates (referral_source_id, care_type_id, rate_amount, rate_type, effective_date, is_active)
      VALUES ($1, $2, $3, $4, $5, true)
      RETURNING *
    `, [referralSourceId, careTypeId || null, rateAmount, rateType || 'hourly', effectiveDate || new Date()]);
    
    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error creating rate:', error);
    res.status(500).json({ error: error.message });
  }
});

router.delete('/referral-source-rates/:id', auth, async (req, res) => {
  try {
    const result = await db.query('DELETE FROM referral_source_rates WHERE id = $1 RETURNING *', [req.params.id]);
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Rate not found' });
    }
    res.json({ message: 'Rate deleted' });
  } catch (error) {
    console.error('Error deleting rate:', error);
    res.status(500).json({ error: error.message });
  }
});

// ==================== EXPORTS ====================

router.get('/export/invoices-csv', auth, async (req, res) => {
  try {
    const result = await db.query(`
      SELECT 
        i.invoice_number,
        i.billing_period_start,
        i.billing_period_end,
        c.first_name || ' ' || c.last_name as client_name,
        COALESCE(rs.name, 'Private Pay') as payer,
        i.total,
        COALESCE(i.amount_paid, 0) as amount_paid,
        i.total - COALESCE(i.amount_paid, 0) - COALESCE(i.amount_adjusted, 0) as balance,
        i.payment_status,
        i.payment_due_date,
        i.created_at
      FROM invoices i
      JOIN clients c ON i.client_id = c.id
      LEFT JOIN referral_sources rs ON i.referral_source_id = rs.id
      ORDER BY i.created_at DESC
    `);

    const headers = [
      'Invoice Number', 'Period Start', 'Period End', 'Client', 'Payer',
      'Total', 'Paid', 'Balance', 'Status', 'Due Date', 'Created'
    ];

    const rows = result.rows.map(row => [
      row.invoice_number,
      row.billing_period_start,
      row.billing_period_end,
      row.client_name,
      row.payer,
      row.total,
      row.amount_paid,
      row.balance,
      row.payment_status,
      row.payment_due_date,
      row.created_at
    ]);

    const csv = [
      headers.join(','),
      ...rows.map(r => r.map(cell => `"${cell || ''}"`).join(','))
    ].join('\n');

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename=invoices-${new Date().toISOString().split('T')[0]}.csv`);
    res.send(csv);
  } catch (error) {
    console.error('Error exporting invoices:', error);
    res.status(500).json({ error: error.message });
  }
});

router.get('/export/evv', auth, async (req, res) => {
  try {
    const result = await db.query(`
      SELECT 
        te.id,
        te.start_time,
        te.end_time,
        CASE 
          WHEN te.duration_minutes IS NOT NULL THEN te.duration_minutes / 60.0
          WHEN te.end_time IS NOT NULL THEN 
            EXTRACT(EPOCH FROM (te.end_time - te.start_time)) / 3600.0
          ELSE 0
        END as hours,
        te.clock_in_location,
        te.clock_out_location,
        c.first_name as client_first_name,
        c.last_name as client_last_name,
        c.medicaid_id,
        u.first_name as caregiver_first_name,
        u.last_name as caregiver_last_name,
        cp.npi_number
      FROM time_entries te
      JOIN clients c ON te.client_id = c.id
      JOIN users u ON te.caregiver_id = u.id
      LEFT JOIN caregiver_profiles cp ON cp.caregiver_id = u.id
      WHERE te.start_time >= CURRENT_DATE - INTERVAL '30 days'
        AND te.is_complete = true
      ORDER BY te.start_time DESC
    `);

    const headers = [
      'ServiceDate', 'ClientFirstName', 'ClientLastName', 'MedicaidID',
      'ProviderFirstName', 'ProviderLastName', 'NPI',
      'ClockInTime', 'ClockOutTime', 'TotalHours',
      'ClockInLatitude', 'ClockInLongitude', 'ClockOutLatitude', 'ClockOutLongitude',
      'VerificationMethod'
    ];

    const rows = result.rows.map(row => {
      const clockInLoc = row.clock_in_location || {};
      const clockOutLoc = row.clock_out_location || {};
      return [
        new Date(row.start_time).toISOString().split('T')[0],
        row.client_first_name,
        row.client_last_name,
        row.medicaid_id || '',
        row.caregiver_first_name,
        row.caregiver_last_name,
        row.npi_number || '',
        new Date(row.start_time).toISOString(),
        row.end_time ? new Date(row.end_time).toISOString() : '',
        parseFloat(row.hours).toFixed(2),
        clockInLoc.latitude || clockInLoc.lat || '',
        clockInLoc.longitude || clockInLoc.lng || '',
        clockOutLoc.latitude || clockOutLoc.lat || '',
        clockOutLoc.longitude || clockOutLoc.lng || '',
        'GPS'
      ];
    });

    const csv = [
      headers.join(','),
      ...rows.map(r => r.map(cell => `"${cell}"`).join(','))
    ].join('\n');

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename=evv-export-${new Date().toISOString().split('T')[0]}.csv`);
    res.send(csv);
  } catch (error) {
    console.error('Error exporting EVV:', error);
    res.status(500).json({ error: error.message });
  }
});

// ==================== BILLING SUMMARY ====================

router.get('/billing-summary', auth, async (req, res) => {
  const { startDate, endDate } = req.query;
  
  try {
    const billedResult = await db.query(`
      SELECT 
        COUNT(*) as invoice_count,
        COALESCE(SUM(total), 0) as total_billed,
        COALESCE(SUM(amount_paid), 0) as total_collected,
        COALESCE(SUM(total - COALESCE(amount_paid, 0) - COALESCE(amount_adjusted, 0)), 0) as total_outstanding
      FROM invoices
      WHERE ($1::date IS NULL OR created_at >= $1)
        AND ($2::date IS NULL OR created_at <= $2)
    `, [startDate || null, endDate || null]);

    const byPayerResult = await db.query(`
      SELECT 
        COALESCE(rs.name, 'Private Pay') as payer,
        COUNT(*) as invoice_count,
        COALESCE(SUM(i.total), 0) as total_billed,
        COALESCE(SUM(i.amount_paid), 0) as total_collected
      FROM invoices i
      LEFT JOIN referral_sources rs ON i.referral_source_id = rs.id
      WHERE ($1::date IS NULL OR i.created_at >= $1)
        AND ($2::date IS NULL OR i.created_at <= $2)
      GROUP BY rs.name
      ORDER BY total_billed DESC
    `, [startDate || null, endDate || null]);

    const byCaregiverResult = await db.query(`
      SELECT 
        u.first_name || ' ' || u.last_name as caregiver_name,
        COALESCE(SUM(ili.hours), 0) as total_hours,
        COALESCE(SUM(ili.amount), 0) as total_billed
      FROM invoice_line_items ili
      JOIN invoices i ON ili.invoice_id = i.id
      LEFT JOIN users u ON ili.caregiver_id = u.id
      WHERE ($1::date IS NULL OR i.created_at >= $1)
        AND ($2::date IS NULL OR i.created_at <= $2)
      GROUP BY u.first_name, u.last_name
      ORDER BY total_hours DESC
    `, [startDate || null, endDate || null]);

    res.json({
      summary: billedResult.rows[0],
      byPayer: byPayerResult.rows,
      byCaregiver: byCaregiverResult.rows
    });
  } catch (error) {
    console.error('Error generating billing summary:', error);
    res.status(500).json({ error: error.message });
  }
});

// ==================== CSV IMPORT ====================

// Import billing data from Midas / My Choice Wisconsin CSV
router.post('/import-csv', auth, requireAdmin, async (req, res) => {
  const { rows, source } = req.body;

  if (!rows || !Array.isArray(rows) || rows.length === 0) {
    return res.status(400).json({ error: 'No rows provided' });
  }

  let imported = 0, skipped = 0;
  const errors = [];

  try {
    // Group rows by clientId + billing month
    const invoiceGroups = {};

    for (const [idx, row] of rows.entries()) {
      try {
        if (!row.clientId) {
          errors.push({ row: idx + 1, error: 'No client matched' });
          skipped++;
          continue;
        }
        if (!row.serviceDate) {
          errors.push({ row: idx + 1, error: 'Missing service date' });
          skipped++;
          continue;
        }

        const svcDate = new Date(row.serviceDate);
        if (isNaN(svcDate.getTime())) {
          errors.push({ row: idx + 1, error: 'Invalid service date' });
          skipped++;
          continue;
        }

        // Billing period = month of service date
        const periodStart = new Date(svcDate.getFullYear(), svcDate.getMonth(), 1).toISOString().slice(0, 10);
        const periodEnd = new Date(svcDate.getFullYear(), svcDate.getMonth() + 1, 0).toISOString().slice(0, 10);
        const groupKey = `${row.clientId}|${periodStart}`;

        if (!invoiceGroups[groupKey]) {
          invoiceGroups[groupKey] = {
            clientId: row.clientId,
            periodStart,
            periodEnd,
            lineItems: [],
          };
        }

        const hours = parseFloat(row.hours) || 0;
        const rate = parseFloat(row.rate) || 0;
        const amount = parseFloat(row.amount) || (hours * rate);

        invoiceGroups[groupKey].lineItems.push({
          time_entry_id: null,
          caregiver_id: row.caregiverId || null,
          description: row.description || `Imported from ${source || 'CSV'}`,
          hours: hours,
          rate: rate,
          amount: amount,
          service_date: row.serviceDate,
        });
      } catch (err) {
        errors.push({ row: idx + 1, error: err.message });
        skipped++;
      }
    }

    // Create invoices for each group
    for (const group of Object.values(invoiceGroups)) {
      try {
        // Check for existing invoice for this client + period
        const existing = await db.query(
          `SELECT id FROM invoices WHERE client_id = $1 AND billing_period_start = $2 AND billing_period_end = $3`,
          [group.clientId, group.periodStart, group.periodEnd]
        );
        if (existing.rows.length > 0) {
          skipped += group.lineItems.length;
          errors.push({ row: null, error: `Invoice already exists for client ${group.clientId} period ${group.periodStart}` });
          continue;
        }

        // Get client info
        const clientResult = await db.query(
          `SELECT id, first_name, last_name, referral_source_id, is_private_pay FROM clients WHERE id = $1`,
          [group.clientId]
        );
        if (clientResult.rows.length === 0) {
          skipped += group.lineItems.length;
          errors.push({ row: null, error: `Client ${group.clientId} not found` });
          continue;
        }
        const client = clientResult.rows[0];

        const total = group.lineItems.reduce((sum, li) => sum + li.amount, 0);
        const dueDate = new Date(group.periodEnd);
        dueDate.setDate(dueDate.getDate() + 30);

        const invoiceNumber = generateInvoiceNumber(group.clientId);
        const invoiceResult = await db.query(`
          INSERT INTO invoices (
            client_id, invoice_number, billing_period_start, billing_period_end,
            subtotal, total, payment_status, payment_due_date, notes,
            referral_source_id, invoice_type
          ) VALUES ($1, $2, $3, $4, $5, $6, 'pending', $7, $8, $9, $10)
          RETURNING *
        `, [
          group.clientId, invoiceNumber, group.periodStart, group.periodEnd,
          total, total, dueDate,
          `Imported from ${source || 'CSV'}`,
          client.referral_source_id,
          client.is_private_pay ? 'private_pay' : 'insurance'
        ]);

        await insertLineItems(invoiceResult.rows[0].id, group.lineItems);
        imported += group.lineItems.length;
      } catch (err) {
        skipped += group.lineItems.length;
        errors.push({ row: null, error: `Invoice creation failed: ${err.message}` });
      }
    }

    res.json({
      imported,
      skipped,
      invoicesCreated: Object.keys(invoiceGroups).length - errors.filter(e => !e.row).length,
      errors: errors.slice(0, 50),
      source: source || 'CSV',
    });
  } catch (error) {
    console.error('Billing import error:', error);
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
