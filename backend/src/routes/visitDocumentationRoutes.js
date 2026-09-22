// routes/visitDocumentationRoutes.js — mounted at /api/visit-docs (admin only)
//
// Office-entered care notes per visit, and an invoice built from visits the admin
// picks one by one, with a printable packet (invoice + the notes for exactly the
// billed visits). Built for VA clients whose caregiver doesn't use the app, so the
// only record of a visit is the schedule: visits come from the shared schedule
// engine (SCHEDULE_OCCURRENCES_CTE), never from free-typed dates, and cancelled
// occurrences never appear.

const express = require('express');
const router = express.Router();
const db = require('../db');
const { verifyToken, requireAdmin, auditLog } = require('../middleware/shared');
const { SCHEDULE_OCCURRENCES_CTE } = require('../helpers/scheduleOccurrences');
const { resolveClientRate } = require('./billingRoutes');

router.use(verifyToken, requireAdmin);

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^\d{2}:\d{2}(:\d{2})?$/;
const hms = (t) => (t && t.length === 5 ? `${t}:00` : t);
const round2 = (n) => Math.round(n * 100) / 100;

function fmtTime12(t) {
  const [h, m] = String(t).split(':').map(Number);
  const dh = h === 0 ? 12 : h > 12 ? h - 12 : h;
  return `${dh}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`;
}
function fmtDate(d) {
  const [y, m, day] = String(d).slice(0, 10).split('-');
  return `${Number(m)}/${Number(day)}/${y}`;
}

// Scheduled (non-cancelled) visits for one client in a date range, with the
// caregiver's name. Visit identity = date + start + caregiver.
async function scheduledVisits(dbc, clientId, from, to) {
  const r = await dbc.query(`
    WITH ${SCHEDULE_OCCURRENCES_CTE()}
    SELECT o.occ_date::text AS visit_date, o.start_time::text AS start_time, o.end_time::text AS end_time,
           o.minutes, o.caregiver_id, o.schedule_id,
           u.first_name || ' ' || u.last_name AS caregiver_name
      FROM schedule_occurrences o
      LEFT JOIN users u ON u.id = o.caregiver_id
     WHERE o.client_id = $3
     ORDER BY o.occ_date, o.start_time`, [from, to, clientId]);
  return r.rows;
}

const visitKey = (v) => `${v.visit_date}|${hms(v.start_time)}|${v.caregiver_id}`;

// How a visit's minutes split between home health aide and homemaking: homemaking
// is the per-visit minutes of the client's active homemaking (IADL) care tasks; the
// rest of the visit is home health aide. Clarence: 20 min homemaking of a 120-min
// visit → 100 aide / 20 homemaking (5 h + 1 h a week over 3 visits).
async function homemakingMinutesPerVisit(dbc, clientId) {
  const r = await dbc.query(
    `SELECT COALESCE(SUM(allotted_minutes), 0)::int AS m FROM client_task_templates
      WHERE client_id = $1 AND is_active = true AND category = 'iadl'`, [clientId]);
  return r.rows[0].m;
}

function splitVisit(minutes, homemakingMin) {
  const hm = Math.min(Math.max(homemakingMin, 0), minutes);
  return [
    { service: 'Home health aide', minutes: minutes - hm },
    { service: 'Homemaking', minutes: hm },
  ].filter((p) => p.minutes > 0);
}

// ─── GET /api/visit-docs/clients/:clientId?from=YYYY-MM-DD&to=YYYY-MM-DD ──────
router.get('/clients/:clientId', async (req, res) => {
  const { clientId } = req.params;
  const { from, to } = req.query;
  if (!DATE_RE.test(from || '') || !DATE_RE.test(to || '') || from > to) {
    return res.status(400).json({ error: 'from and to (YYYY-MM-DD) are required' });
  }
  try {
    const client = (await db.query(
      `SELECT c.id, c.first_name, c.last_name, c.is_private_pay, c.private_pay_rate, c.private_pay_rate_type,
              c.referral_source_id, c.care_type_id, rs.name AS referral_source_name
         FROM clients c LEFT JOIN referral_sources rs ON rs.id = c.referral_source_id
        WHERE c.id = $1`, [clientId])).rows[0];
    if (!client) return res.status(404).json({ error: 'Client not found' });

    const [visits, docs, billed, invoices, tasks, rate, homemakingMin] = await Promise.all([
      scheduledVisits(db, clientId, from, to),
      db.query(`SELECT vd.*, vd.visit_date::text AS visit_date, vd.start_time::text AS start_time,
                       vd.end_time::text AS end_time, u.first_name || ' ' || u.last_name AS entered_by_name
                  FROM visit_documentation vd LEFT JOIN users u ON u.id = vd.entered_by
                 WHERE vd.client_id = $1 AND vd.visit_date BETWEEN $2 AND $3`, [clientId, from, to]),
      // Lines that name a specific visit (service_date + start_time + caregiver).
      db.query(`SELECT ili.service_date::text AS visit_date, ili.start_time::text AS start_time,
                       ili.caregiver_id, i.invoice_number, i.id AS invoice_id
                  FROM invoice_line_items ili JOIN invoices i ON i.id = ili.invoice_id
                 WHERE i.client_id = $1 AND ili.service_date BETWEEN $2 AND $3
                   AND ili.start_time IS NOT NULL`, [clientId, from, to]),
      // Any invoice whose period covers a date — a regular invoice bills by period,
      // so a visit inside it is already billed even without a matching line.
      db.query(`SELECT id, invoice_number, billing_period_start::text AS start, billing_period_end::text AS end,
                       total, payment_status, sent_at
                  FROM invoices WHERE client_id = $1 AND billing_period_start <= $3 AND billing_period_end >= $2
                 ORDER BY billing_period_start`, [clientId, from, to]),
      db.query(`SELECT id, task_name, category, allotted_minutes FROM client_task_templates
                 WHERE client_id = $1 AND is_active = true ORDER BY sort_order, created_at`, [clientId]),
      resolveClientRate(db, client, from, to),
      homemakingMinutesPerVisit(db, clientId),
    ]);

    const docByKey = new Map(docs.rows.map((d) => [visitKey(d), d]));
    const lineByKey = new Map(billed.rows.map((b) => [visitKey(b), b]));
    const out = visits.map((v) => {
      const line = lineByKey.get(visitKey(v));
      const covering = invoices.rows.find((i) => i.start <= v.visit_date && i.end >= v.visit_date);
      return {
        ...v,
        split: splitVisit(v.minutes, homemakingMin),
        doc: docByKey.get(visitKey(v)) || null,
        invoiced: line ? { invoiceId: line.invoice_id, invoiceNumber: line.invoice_number }
                : covering ? { invoiceId: covering.id, invoiceNumber: covering.invoice_number, byPeriod: true }
                : null,
      };
    });

    res.json({
      client: { id: client.id, name: `${client.first_name} ${client.last_name}`, payer: client.referral_source_name || (client.is_private_pay ? 'Private pay' : null) },
      rate,
      homemakingMinutesPerVisit: homemakingMin,
      tasks: tasks.rows,
      visits: out,
      invoices: invoices.rows,
    });
  } catch (error) {
    console.error('visit-docs list error:', error);
    res.status(500).json({ error: error.message });
  }
});

// ─── PUT /api/visit-docs/clients/:clientId/visits — save one visit's note ─────
// Body: { visitDate, startTime, caregiverId, tasks: [{taskId, taskName, done}], note }
// The visit must be a real scheduled occurrence; its end time and schedule come
// from the schedule, not the request.
router.put('/clients/:clientId/visits', async (req, res) => {
  const { clientId } = req.params;
  const { visitDate, startTime, caregiverId, tasks, note } = req.body || {};
  if (!DATE_RE.test(visitDate || '') || !TIME_RE.test(startTime || '') || !caregiverId) {
    return res.status(400).json({ error: 'visitDate, startTime and caregiverId are required' });
  }
  const cleanTasks = (Array.isArray(tasks) ? tasks : [])
    .filter((t) => t && t.taskId && t.taskName)
    .map((t) => ({ taskId: String(t.taskId), taskName: String(t.taskName).slice(0, 200), done: !!t.done }));
  const cleanNote = typeof note === 'string' ? note.trim() : '';
  try {
    const visit = (await scheduledVisits(db, clientId, visitDate, visitDate))
      .find((v) => hms(v.start_time) === hms(startTime) && v.caregiver_id === caregiverId);
    if (!visit) return res.status(404).json({ error: 'No scheduled visit for that client, date, time and caregiver.' });

    const r = await db.query(`
      INSERT INTO visit_documentation (client_id, caregiver_id, visit_date, start_time, end_time, schedule_id, tasks, note, entered_by)
      VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9)
      ON CONFLICT (client_id, visit_date, start_time, caregiver_id) DO UPDATE
        SET end_time = EXCLUDED.end_time, schedule_id = EXCLUDED.schedule_id, tasks = EXCLUDED.tasks,
            note = EXCLUDED.note, entered_by = EXCLUDED.entered_by, updated_at = NOW()
      RETURNING *, visit_date::text AS visit_date, start_time::text AS start_time, end_time::text AS end_time`,
      [clientId, caregiverId, visitDate, hms(startTime), visit.end_time, visit.schedule_id,
       JSON.stringify(cleanTasks), cleanNote || null, req.user.id]);
    await auditLog(req.user.id, 'UPSERT', 'visit_documentation', r.rows[0].id, null, r.rows[0]);
    res.json(r.rows[0]);
  } catch (error) {
    console.error('visit-docs save error:', error);
    res.status(500).json({ error: error.message });
  }
});

// ─── POST /api/visit-docs/clients/:clientId/invoice — invoice picked visits ───
// Body: { visits: [{ visitDate, startTime, caregiverId }] }
// Each visit is re-checked against the schedule and refused if any invoice already
// bills it (a matching line, or an invoice whose period covers its date). Created
// as a draft (sent_at NULL) — nothing is emailed and the portal doesn't show it.
router.post('/clients/:clientId/invoice', async (req, res) => {
  const { clientId } = req.params;
  const picked = Array.isArray(req.body?.visits) ? req.body.visits : [];
  if (picked.length === 0) return res.status(400).json({ error: 'Pick at least one visit.' });
  if (picked.some((p) => !DATE_RE.test(p?.visitDate || '') || !TIME_RE.test(p?.startTime || '') || !p?.caregiverId)) {
    return res.status(400).json({ error: 'Each visit needs visitDate, startTime and caregiverId.' });
  }
  const dates = picked.map((p) => p.visitDate).sort();
  const from = dates[0];
  const to = dates[dates.length - 1];

  const dbc = await db.pool.connect();
  try {
    const client = (await dbc.query(
      `SELECT id, first_name, last_name, referral_source_id, care_type_id, is_private_pay,
              private_pay_rate, private_pay_rate_type FROM clients WHERE id = $1`, [clientId])).rows[0];
    if (!client) return res.status(404).json({ error: 'Client not found' });

    const resolved = await resolveClientRate(dbc, client, from, to);
    if (!resolved || !(resolved.rate > 0) || resolved.rateType !== 'hourly') {
      return res.status(400).json({ error: `No hourly billing rate is set for ${client.first_name} ${client.last_name}'s payer. Set it under Referral Sources → rates.` });
    }

    const scheduled = new Map((await scheduledVisits(dbc, clientId, from, to)).map((v) => [visitKey(v), v]));
    const wanted = [];
    const seen = new Set();
    for (const p of picked) {
      const key = visitKey({ visit_date: p.visitDate, start_time: p.startTime, caregiver_id: p.caregiverId });
      if (seen.has(key)) continue;
      seen.add(key);
      const v = scheduled.get(key);
      if (!v) return res.status(400).json({ error: `${fmtDate(p.visitDate)} ${fmtTime12(p.startTime)} is not a scheduled visit (it may have been cancelled).` });
      wanted.push(v);
    }

    const clash = (await dbc.query(`
      SELECT i.invoice_number, ili.service_date::text AS visit_date, ili.start_time::text AS start_time, ili.caregiver_id
        FROM invoice_line_items ili JOIN invoices i ON i.id = ili.invoice_id
       WHERE i.client_id = $1 AND ili.service_date BETWEEN $2 AND $3 AND ili.start_time IS NOT NULL`,
      [clientId, from, to])).rows;
    const clashKeys = new Map(clash.map((c) => [visitKey(c), c.invoice_number]));
    const periods = (await dbc.query(
      `SELECT invoice_number, billing_period_start::text AS s, billing_period_end::text AS e FROM invoices
        WHERE client_id = $1 AND billing_period_start <= $3 AND billing_period_end >= $2`, [clientId, from, to])).rows;
    for (const v of wanted) {
      const byLine = clashKeys.get(visitKey(v));
      const byPeriod = periods.find((p) => p.s <= v.visit_date && p.e >= v.visit_date);
      if (byLine || byPeriod) {
        return res.status(409).json({ error: `${fmtDate(v.visit_date)} is already billed on invoice ${byLine || byPeriod.invoice_number}.` });
      }
    }

    const homemakingMin = await homemakingMinutesPerVisit(dbc, clientId);
    const lines = [];
    for (const v of wanted) {
      for (const part of splitVisit(v.minutes, homemakingMin)) {
        const hours = round2(part.minutes / 60);
        lines.push({
          caregiver_id: v.caregiver_id,
          description: `${part.service} (${fmtTime12(v.start_time)} - ${fmtTime12(v.end_time)})`,
          hours, rate: resolved.rate, amount: round2(hours * resolved.rate),
          service_date: v.visit_date, start_time: hms(v.start_time), end_time: hms(v.end_time),
          scheduled_minutes: part.minutes,
        });
      }
    }
    const total = round2(lines.reduce((s, l) => s + l.amount, 0));

    const now = Date.now().toString(36).toUpperCase();
    const invoiceNumber = `INV-${now}-${clientId.slice(0, 4).toUpperCase()}`;
    const due = new Date(`${to}T12:00:00Z`);
    due.setUTCDate(due.getUTCDate() + 30);

    await dbc.query('BEGIN');
    const inv = (await dbc.query(`
      INSERT INTO invoices (client_id, invoice_number, billing_period_start, billing_period_end, subtotal, total,
                            payment_status, payment_due_date, notes, referral_source_id, invoice_type)
      VALUES ($1, $2, $3, $4, $5, $5, 'pending', $6, $7, $8, $9) RETURNING *`,
      [clientId, invoiceNumber, from, to, total, due.toISOString().slice(0, 10),
       `Built from ${wanted.length} visit${wanted.length === 1 ? '' : 's'} picked in Visit Documentation`,
       client.referral_source_id, client.is_private_pay ? 'private_pay' : 'insurance'])).rows[0];
    for (const l of lines) {
      await dbc.query(`
        INSERT INTO invoice_line_items (invoice_id, caregiver_id, description, hours, rate, amount, service_date,
                                        start_time, end_time, billed_basis, scheduled_minutes)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'scheduled', $10)`,
        [inv.id, l.caregiver_id, l.description, l.hours, l.rate, l.amount, l.service_date, l.start_time, l.end_time, l.scheduled_minutes]);
    }
    await dbc.query('COMMIT');
    await auditLog(req.user.id, 'CREATE', 'invoices', inv.id, null, { ...inv, source: 'visit-docs', visits: wanted.length });
    res.status(201).json({ ...inv, visits: wanted.length, lines: lines.length });
  } catch (error) {
    await dbc.query('ROLLBACK').catch(() => {});
    console.error('visit-docs invoice error:', error);
    res.status(500).json({ error: error.message });
  } finally {
    dbc.release();
  }
});

// ─── GET /api/visit-docs/invoices/:invoiceId/packet.pdf ───────────────────────
// Page 1+: the invoice. Then "Visit Documentation": one block per billed visit
// with its tasks and note, in date order.
router.get('/invoices/:invoiceId/packet.pdf', async (req, res) => {
  try {
    const inv = (await db.query(`
      SELECT i.*, i.billing_period_start::text AS period_start, i.billing_period_end::text AS period_end,
             i.created_at::date::text AS invoice_date, i.payment_due_date::text AS due_date,
             c.first_name, c.last_name, c.address, c.city, c.state, c.zip, c.phone, c.date_of_birth::text AS dob,
             rs.name AS payer_name
        FROM invoices i JOIN clients c ON c.id = i.client_id
        LEFT JOIN referral_sources rs ON rs.id = i.referral_source_id
       WHERE i.id = $1`, [req.params.invoiceId])).rows[0];
    if (!inv) return res.status(404).json({ error: 'Invoice not found' });

    const lines = (await db.query(`
      SELECT ili.service_date::text AS visit_date, ili.start_time::text AS start_time, ili.end_time::text AS end_time,
             ili.caregiver_id, ili.description, ili.hours, ili.rate, ili.amount,
             u.first_name || ' ' || u.last_name AS caregiver_name
        FROM invoice_line_items ili LEFT JOIN users u ON u.id = ili.caregiver_id
       WHERE ili.invoice_id = $1
       ORDER BY ili.service_date NULLS LAST, ili.start_time NULLS LAST, ili.description`, [inv.id])).rows;

    const docs = (await db.query(`
      SELECT vd.visit_date::text AS visit_date, vd.start_time::text AS start_time, vd.end_time::text AS end_time,
             vd.caregiver_id, vd.tasks, vd.note
        FROM visit_documentation vd
       WHERE vd.client_id = $1 AND vd.visit_date BETWEEN $2 AND $3`,
      [inv.client_id, inv.period_start, inv.period_end])).rows;
    const docByKey = new Map(docs.map((d) => [visitKey(d), d]));

    // Distinct billed visits, in order.
    const visits = [];
    const seen = new Set();
    for (const l of lines) {
      if (!l.visit_date || !l.start_time) continue;
      const k = visitKey(l);
      if (seen.has(k)) continue;
      seen.add(k);
      visits.push({ ...l, doc: docByKey.get(k) || null });
    }

    const agency = {
      name: process.env.AGENCY_NAME || 'Chippewa Valley Home Care',
      address: process.env.AGENCY_ADDRESS || '2607 Beverly Hills Dr',
      cityLine: `${process.env.AGENCY_CITY || 'Eau Claire'}, ${process.env.AGENCY_STATE || 'WI'} ${process.env.AGENCY_ZIP || '54701'}`,
      phone: process.env.AGENCY_PHONE || '715-491-1254',
      npi: process.env.AGENCY_NPI || '1124999487',
      taxId: process.env.AGENCY_TAX_ID || '39-5040962',
    };

    const PDFDocument = require('pdfkit');
    const doc = new PDFDocument({ size: 'LETTER', margin: 54 });
    const fname = `invoice-packet-${inv.last_name}-${inv.first_name}-${inv.invoice_number}.pdf`.replace(/[^a-zA-Z0-9._-]/g, '_');
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${fname}"`);
    doc.pipe(res);

    const L = 54, R = 558;
    const rule = (color = '#BFDBFE') => { doc.moveTo(L, doc.y + 2).lineTo(R, doc.y + 2).strokeColor(color).stroke(); doc.moveDown(0.4); };
    const ensure = (h) => { if (doc.y + h > 738) doc.addPage(); };
    const money = (n) => `$${Number(n).toFixed(2)}`;

    // ── Invoice ──
    doc.fillColor('#1D4ED8').font('Helvetica-Bold').fontSize(20).text('INVOICE', L, 54);
    doc.fillColor('#111827').font('Helvetica-Bold').fontSize(11).text(agency.name, 330, 54, { width: R - 330, align: 'right' });
    doc.font('Helvetica').fontSize(9).fillColor('#374151')
      .text(agency.address, { width: R - 330, align: 'right' })
      .text(agency.cityLine, { width: R - 330, align: 'right' })
      .text(`Phone ${agency.phone}`, { width: R - 330, align: 'right' })
      .text(`NPI ${agency.npi}  ·  Tax ID ${agency.taxId}`, { width: R - 330, align: 'right' });

    doc.y = 130;
    const col2 = 330;
    const y0 = doc.y;
    doc.fillColor('#6B7280').font('Helvetica-Bold').fontSize(8).text('BILL TO', L, y0);
    doc.fillColor('#111827').font('Helvetica').fontSize(10).text(inv.payer_name || '—', L, y0 + 11);
    doc.fillColor('#6B7280').font('Helvetica-Bold').fontSize(8).text(inv.payer_name && /veteran|\bVA\b/i.test(inv.payer_name) ? 'VETERAN' : 'CLIENT', L, y0 + 30);
    doc.fillColor('#111827').font('Helvetica').fontSize(10).text(`${inv.first_name} ${inv.last_name}`, L, y0 + 41);
    const addr = [inv.address, [inv.city, inv.state].filter(Boolean).join(', ') + (inv.zip ? ` ${inv.zip}` : '')].filter((s) => s && s.trim());
    doc.fontSize(9).fillColor('#374151').text(addr.join('\n'), L, doc.y);
    if (inv.dob) doc.text(`DOB ${fmtDate(inv.dob)}`);

    const meta = [
      ['Invoice #', inv.invoice_number], ['Invoice date', fmtDate(inv.invoice_date)],
      ['Service period', `${fmtDate(inv.period_start)} – ${fmtDate(inv.period_end)}`],
      ['Due date', inv.due_date ? fmtDate(inv.due_date) : '—'],
    ];
    meta.forEach(([k, v], i) => {
      doc.fillColor('#6B7280').font('Helvetica-Bold').fontSize(8).text(k.toUpperCase(), col2, y0 + i * 18, { width: 90 });
      doc.fillColor('#111827').font('Helvetica').fontSize(9).text(v, col2 + 90, y0 + i * 18, { width: R - col2 - 90, align: 'right' });
    });

    doc.y = Math.max(doc.y, y0 + 80) + 14;
    const cols = [[L, 62, 'Date'], [L + 62, 190, 'Service'], [L + 252, 110, 'Caregiver'], [L + 362, 40, 'Hours', 'right'], [L + 402, 46, 'Rate', 'right'], [L + 448, 56, 'Amount', 'right']];
    const header = () => {
      const y = doc.y;
      doc.rect(L, y - 3, R - L, 16).fill('#EFF6FF');
      doc.fillColor('#1E3A8A').font('Helvetica-Bold').fontSize(8.5);
      cols.forEach(([x, w, t, a]) => doc.text(t, x + 2, y, { width: w - 4, align: a || 'left' }));
      doc.y = y + 17;
    };
    header();
    let totalHours = 0;
    for (const l of lines) {
      if (doc.y + 16 > 738) { doc.addPage(); header(); }
      const y = doc.y;
      totalHours += Number(l.hours);
      doc.fillColor('#111827').font('Helvetica').fontSize(8.5);
      const cells = [l.visit_date ? fmtDate(l.visit_date) : '', l.description, l.caregiver_name || '', Number(l.hours).toFixed(2), money(l.rate), money(l.amount)];
      cols.forEach(([x, w, , a], i) => doc.text(cells[i], x + 2, y, { width: w - 4, align: a || 'left', lineBreak: false, ellipsis: true }));
      doc.y = y + 14;
    }
    ensure(50);
    rule('#9CA3AF');
    const ty = doc.y;
    doc.font('Helvetica-Bold').fontSize(10).fillColor('#111827')
      .text(`Total hours: ${totalHours.toFixed(2)}`, L, ty)
      .text(`Total due: ${money(inv.total)}`, L + 250, ty, { width: R - L - 250, align: 'right' });
    doc.moveDown(0.6);
    doc.font('Helvetica').fontSize(8.5).fillColor('#6B7280')
      .text(`Please make payment to ${agency.name}. Questions: ${agency.phone}.`, L, doc.y, { width: R - L });

    // ── Visit documentation ──
    doc.addPage();
    doc.fillColor('#1D4ED8').font('Helvetica-Bold').fontSize(16).text('Visit Documentation', L, 54);
    doc.fillColor('#374151').font('Helvetica').fontSize(9)
      .text(`${inv.first_name} ${inv.last_name}  ·  Invoice ${inv.invoice_number}  ·  ${fmtDate(inv.period_start)} – ${fmtDate(inv.period_end)}  ·  ${visits.length} visit${visits.length === 1 ? '' : 's'}`);
    doc.moveDown(0.4);
    rule();
    for (const v of visits) {
      const tasks = Array.isArray(v.doc?.tasks) ? v.doc.tasks : [];
      const noteText = v.doc?.note || '';
      const est = 34 + tasks.length * 12 + (noteText ? doc.heightOfString(noteText, { width: R - L - 12 }) + 8 : 14);
      ensure(est);
      doc.fillColor('#111827').font('Helvetica-Bold').fontSize(10)
        .text(`${fmtDate(v.visit_date)}   ${fmtTime12(v.start_time)} – ${fmtTime12(v.end_time)}   ·   ${v.caregiver_name || ''}`, L, doc.y);
      doc.font('Helvetica').fontSize(9).fillColor('#111827');
      for (const t of tasks) {
        doc.text(`${t.done ? '[X]' : '[  ]'}  ${t.taskName}`, L + 12, doc.y);
      }
      if (noteText) {
        doc.moveDown(0.2).text(noteText, L + 12, doc.y, { width: R - L - 12, lineGap: 1.5 });
      } else if (!tasks.length) {
        doc.fillColor('#9CA3AF').text('No note recorded for this visit.', L + 12, doc.y);
      }
      doc.moveDown(0.5);
      doc.moveTo(L, doc.y).lineTo(R, doc.y).strokeColor('#E5E7EB').stroke();
      doc.moveDown(0.5);
    }

    doc.end();
  } catch (error) {
    console.error('visit-docs packet error:', error);
    if (!res.headersSent) res.status(500).json({ error: error.message });
  }
});

module.exports = router;
