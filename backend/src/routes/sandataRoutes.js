// routes/sandataRoutes.js
// Sandata Alt-EVV API integration
// Credentials set via env vars: SANDATA_USERNAME, SANDATA_PASSWORD, SANDATA_ACCOUNT_ID
// API docs: Wisconsin DHS Alt-EVV Technical Specification
// Contact: (833) 931-2035 / VDXC.ContactEVV@wisconsin.gov

const express = require('express');
const router = express.Router();
const db = require('../db');
const auth = require('../middleware/auth');
const requireAdmin = require('../middleware/authorizeAdmin');
const { v4: uuidv4 } = require('uuid');

// ─── API CLIENT ───────────────────────────────────────────────────────────────
// Transport + payload building live in services/sandataClient.js and
// services/sandataPayload.js (WI spec v7.6 / Addendum v2.6 conformant).
const sandataClient = require('../services/sandataClient');
const sandataPayloads = require('../services/sandataPayload');

function getSandataConfig() {
  return sandataClient.getConfig();
}

// ─── CALCULATE UNITS ─────────────────────────────────────────────────────────
function calcUnits(startTime, endTime, unitType) {
  if (!endTime) return 0;
  const mins = (new Date(endTime) - new Date(startTime)) / 60000;
  if (unitType === '15min') return Math.round(mins / 15 * 100) / 100;
  if (unitType === 'hour') return Math.round(mins / 60 * 100) / 100;
  if (unitType === 'visit') return 1;
  return Math.round(mins / 15 * 100) / 100; // default 15min
}

// ─── AUTO-CREATE EVV VISIT FROM TIME ENTRY ───────────────────────────────────
// Called automatically when a shift clocks out
async function createEVVFromTimeEntry(timeEntryId) {
  try {
    // Get full time entry with client and caregiver details
    const te = await db.query(`
      SELECT te.*, 
        c.medicaid_id, c.evv_client_id, c.first_name as client_first, c.last_name as client_last,
        c.referral_source_id as client_payer_id,
        u.first_name as cg_first, u.last_name as cg_last,
        cp.evv_worker_id, cp.npi_number, cp.taxonomy_code,
        ct.default_service_code, ct.default_modifier, ct.requires_evv,
        rs.payer_type
      FROM time_entries te
      JOIN clients c ON te.client_id = c.id
      JOIN users u ON te.caregiver_id = u.id
      LEFT JOIN caregiver_profiles cp ON cp.caregiver_id = u.id
      LEFT JOIN care_types ct ON c.care_type_id = ct.id
      LEFT JOIN referral_sources rs ON c.referral_source_id = rs.id
      WHERE te.id = $1
    `, [timeEntryId]);

    if (!te.rows.length) return null;
    const entry = te.rows[0];

    // Find active authorization for this client/service
    const auth = await db.query(`
      SELECT * FROM authorizations
      WHERE client_id = $1
        AND status = 'active'
        AND start_date <= $2::date
        AND end_date >= $2::date
        AND (procedure_code = $3 OR procedure_code IS NULL)
      ORDER BY end_date ASC
      LIMIT 1
    `, [entry.client_id, entry.start_time, entry.default_service_code]);

    const authorization = auth.rows[0] || null;

    // Parse GPS locations
    const gpsIn = entry.clock_in_location || {};
    const gpsOut = entry.clock_out_location || {};

    // Calculate units
    const serviceCode = entry.default_service_code || 'T1019';
    const unitType = authorization?.unit_type || '15min';
    const units = calcUnits(entry.start_time, entry.end_time, unitType);

    // Determine issues
    const issues = [];
    if (!entry.medicaid_id) issues.push({ code: 'NO_MEDICAID_ID', msg: 'Client has no Medicaid ID on file' });
    if (!entry.evv_worker_id && !entry.npi_number) issues.push({ code: 'NO_WORKER_ID', msg: 'Caregiver has no EVV Worker ID or NPI' });
    if (!authorization) issues.push({ code: 'NO_AUTH', msg: 'No active authorization found for this service/date' });
    if (!gpsIn.latitude && !gpsIn.lat) issues.push({ code: 'NO_GPS_IN', msg: 'No GPS on clock-in' });
    if (!gpsOut.latitude && !gpsOut.lat) issues.push({ code: 'NO_GPS_OUT', msg: 'No GPS on clock-out' });

    // Upsert EVV visit record
    const result = await db.query(`
      INSERT INTO evv_visits (
        id, time_entry_id, client_id, caregiver_id, authorization_id,
        service_code, modifier, service_date, actual_start, actual_end,
        units_of_service,
        gps_in_lat, gps_in_lng, gps_out_lat, gps_out_lng,
        sandata_status, evv_method, is_verified, verification_issues
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,
        $16,'gps',$17,$18)
      ON CONFLICT (time_entry_id) DO UPDATE SET
        actual_end = EXCLUDED.actual_end,
        units_of_service = EXCLUDED.units_of_service,
        gps_out_lat = EXCLUDED.gps_out_lat,
        gps_out_lng = EXCLUDED.gps_out_lng,
        verification_issues = EXCLUDED.verification_issues,
        is_verified = EXCLUDED.is_verified,
        updated_at = NOW()
      RETURNING *
    `, [
      uuidv4(), timeEntryId, entry.client_id, entry.caregiver_id,
      authorization?.id || null,
      serviceCode, entry.default_modifier || null,
      new Date(entry.start_time).toISOString().split('T')[0],
      entry.start_time, entry.end_time,
      units,
      gpsIn.latitude || gpsIn.lat || null,
      gpsIn.longitude || gpsIn.lng || null,
      gpsOut.latitude || gpsOut.lat || null,
      gpsOut.longitude || gpsOut.lng || null,
      issues.length === 0 ? 'ready' : 'pending',
      issues.length === 0,
      JSON.stringify(issues)
    ]);

    // Update authorization used units
    if (authorization && units > 0) {
      await db.query(`
        UPDATE authorizations SET 
          used_units = used_units + $1,
          status = CASE 
            WHEN used_units + $1 >= authorized_units THEN 'exhausted'
            ELSE status END,
          updated_at = NOW()
        WHERE id = $2
      `, [units, authorization.id]);

      // Check if low units alert needed
      const updatedAuth = await db.query('SELECT * FROM authorizations WHERE id = $1', [authorization.id]);
      const a = updatedAuth.rows[0];
      if (a && a.authorized_units - a.used_units <= a.low_units_alert_threshold) {
        const remaining = a.authorized_units - a.used_units;
        const admins = await db.query(`SELECT id FROM users WHERE role = 'admin' AND is_active = true`);
        const clientInfo = await db.query(`SELECT first_name, last_name FROM clients WHERE id = $1`, [entry.client_id]);
        const clientName = clientInfo.rows[0] ? `${clientInfo.rows[0].first_name} ${clientInfo.rows[0].last_name}` : 'Client';
        for (const admin of admins.rows) {
          await db.query(`
            INSERT INTO notifications (id, user_id, type, title, message, is_read, created_at)
            VALUES ($1,$2,'authorization_low','⚠️ Low Authorization Units',$3,false,NOW())
          `, [uuidv4(), admin.id,
            `${clientName}: Only ${remaining.toFixed(1)} units remaining on auth #${a.auth_number || a.id.slice(0,8)} (expires ${new Date(a.end_date).toLocaleDateString()})`
          ]);
        }
      }
    }

    // Auto-enqueue for Sandata submission if the visit is ready
    const evvRecord = result.rows[0];
    if (evvRecord && evvRecord.sandata_status === 'ready' && evvRecord.auto_submit_enabled !== false) {
      try {
        const { enqueueVisit } = require('../services/sandataAutoSubmit');
        enqueueVisit(evvRecord.id).catch(e => console.error('[EVV Auto-Submit] Enqueue error:', e.message));
      } catch (e) {
        console.error('[EVV Auto-Submit] Module load error:', e.message);
      }
    }

    return evvRecord;
  } catch (e) {
    console.error('[EVV] createEVVFromTimeEntry error:', e.message);
    return null;
  }
}

// Export for use in other routes (called from clock-out endpoint)
module.exports.createEVVFromTimeEntry = createEVVFromTimeEntry;

// ─── GET EVV STATUS DASHBOARD ────────────────────────────────────────────────
router.get('/status', auth, requireAdmin, async (req, res) => {
  try {
    const cfg = getSandataConfig();
    // Opportunistic: resolve accept/reject for anything POSTed but not yet
    // confirmed, every time an admin opens the dashboard. No-op unconfigured.
    if (cfg.isConfigured) {
      try {
        const { pollPendingStatuses } = require('../services/sandataAutoSubmit');
        pollPendingStatuses().catch(e => console.error('[EVV poll]', e.message));
      } catch (e) { console.error('[EVV poll require]', e.message); }
    }
    const { startDate, endDate } = req.query;
    const start = startDate || new Date(Date.now() - 7 * 86400000).toISOString().split('T')[0];
    const end = endDate || new Date().toISOString().split('T')[0];

    const visits = await db.query(`
      SELECT ev.*,
        c.first_name as client_first, c.last_name as client_last, c.medicaid_id,
        u.first_name as cg_first, u.last_name as cg_last,
        cp.evv_worker_id, cp.npi_number
      FROM evv_visits ev
      JOIN clients c ON ev.client_id = c.id
      JOIN users u ON ev.caregiver_id = u.id
      LEFT JOIN caregiver_profiles cp ON cp.caregiver_id = u.id
      WHERE ev.service_date BETWEEN $1 AND $2
      ORDER BY ev.service_date DESC, ev.actual_start DESC
    `, [start, end]);

    const summary = {
      total: visits.rows.length,
      verified: visits.rows.filter(v => v.is_verified).length,
      pending: visits.rows.filter(v => v.sandata_status === 'pending').length,
      ready: visits.rows.filter(v => v.sandata_status === 'ready').length,
      submitted: visits.rows.filter(v => v.sandata_status === 'submitted').length,
      accepted: visits.rows.filter(v => v.sandata_status === 'accepted').length,
      exceptions: visits.rows.filter(v => v.sandata_status === 'exception').length,
      hasIssues: visits.rows.filter(v => v.verification_issues?.length > 0).length,
    };

    res.json({ sandataConfigured: cfg.isConfigured, summary, visits: visits.rows });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ─── SUBMIT VISITS TO SANDATA ────────────────────────────────────────────────
// Routes selected visits through the spec-conformant queue (services/
// sandataAutoSubmit.js) — one payload builder, one transport, one retry policy.
router.post('/submit', auth, requireAdmin, async (req, res) => {
  try {
    const { visitIds } = req.body;
    const cfg = getSandataConfig();

    if (!cfg.isConfigured) {
      return res.status(400).json({
        error: 'Sandata credentials not configured',
        setup: 'Certification (see ALT-EVV-BUILD-PLAN.md) issues the credentials. Then add SANDATA_USERNAME, SANDATA_PASSWORD, SANDATA_ACCOUNT_ID, SANDATA_PROVIDER_ID to Render environment variables.'
      });
    }

    if (!Array.isArray(visitIds) || visitIds.length === 0) {
      return res.status(400).json({ error: 'visitIds array required' });
    }

    const { enqueueVisit } = require('../services/sandataAutoSubmit');
    const results = [];
    for (const id of visitIds) {
      try {
        const r = await enqueueVisit(id);
        results.push({ visitId: id, queued: r.queued, reason: r.reason || null });
      } catch (e) {
        results.push({ visitId: id, queued: false, reason: e.message });
      }
    }

    res.json({ queued: results.filter(r => r.queued).length, results });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ─── GET EVV VISIT DETAIL ────────────────────────────────────────────────────
router.get('/visit/:id', auth, requireAdmin, async (req, res) => {
  try {
    const result = await db.query(`
      SELECT ev.*,
        c.first_name as client_first, c.last_name as client_last, c.medicaid_id, c.evv_client_id,
        u.first_name as cg_first, u.last_name as cg_last,
        cp.evv_worker_id, cp.npi_number,
        a.auth_number, a.authorized_units, a.used_units, a.end_date as auth_expires
      FROM evv_visits ev
      JOIN clients c ON ev.client_id = c.id
      JOIN users u ON ev.caregiver_id = u.id
      LEFT JOIN caregiver_profiles cp ON cp.caregiver_id = u.id
      LEFT JOIN authorizations a ON ev.authorization_id = a.id
      WHERE ev.id = $1
    `, [req.params.id]);
    if (!result.rows.length) return res.status(404).json({ error: 'EVV visit not found' });
    res.json(result.rows[0]);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ─── MANUAL CORRECT EVV VISIT ────────────────────────────────────────────────
router.put('/visit/:id', auth, requireAdmin, async (req, res) => {
  try {
    const { serviceCode, modifier, authorizationId, actualStart, actualEnd, reasonCode, reasonMemo } = req.body;
    const before = await db.query(`SELECT * FROM evv_visits WHERE id = $1`, [req.params.id]);
    if (!before.rows.length) return res.status(404).json({ error: 'EVV visit not found' });
    const prev = before.rows[0];

    // Manually setting times is a spec 3.9 change: it must carry a WI reason
    // code and go out as Adjusted times with a VisitChanges record.
    const changingTimes = (actualStart != null || actualEnd != null);
    if (changingTimes) {
      const code = String(reasonCode || '');
      if (!['1', '2', '3', '4', '5', '7', '8'].includes(code)) {
        return res.status(400).json({ error: 'reasonCode required when changing visit times (WI codes 1,2,3,4,5,7,8)' });
      }
      if (['5', '8'].includes(code) && !String(reasonMemo || '').trim()) {
        return res.status(400).json({ error: `Reason code ${code} requires a memo explaining the change` });
      }
      await db.query(`
        INSERT INTO visit_time_changes (time_entry_id, changed_by, old_start, new_start, old_end, new_end, reason_code, memo)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      `, [prev.time_entry_id, req.user.id,
          actualStart != null ? prev.actual_start : null, actualStart || null,
          actualEnd != null ? prev.actual_end : null, actualEnd || null,
          code, String(reasonMemo || '').trim().slice(0, 256) || null]);
    }

    await db.query(`
      UPDATE evv_visits SET
        service_code = COALESCE($1, service_code),
        modifier = COALESCE($2, modifier),
        authorization_id = COALESCE($3, authorization_id),
        actual_start = COALESCE($4, actual_start),
        actual_end = COALESCE($5, actual_end),
        sandata_status = CASE WHEN sandata_status = 'exception' THEN 'ready' ELSE sandata_status END,
        updated_at = NOW()
      WHERE id = $6
    `, [serviceCode, modifier, authorizationId, actualStart, actualEnd, req.params.id]);

    // Already at Sandata? The correction must be retransmitted (incremental
    // interface — spec 2.6/2.8) with the next sequence.
    if (['submitted', 'accepted'].includes(prev.sandata_status)) {
      try {
        const { requeueChangedVisit } = require('../services/sandataAutoSubmit');
        requeueChangedVisit(req.params.id).catch(e => console.error('[EVV requeue]', e.message));
      } catch (e) { console.error('[EVV requeue require]', e.message); }
    }

    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ─── ACKNOWLEDGE A SANDATA EXCEPTION ─────────────────────────────────────────
// For exceptions that can't be "fixed" in the data (spec 3.8): admin attests it
// was reviewed, with a WI reason code; visit is resubmitted carrying the
// VisitExceptionAcknowledgement segment.
router.post('/visit/:id/acknowledge', auth, requireAdmin, async (req, res) => {
  try {
    const { reasonCode, memo } = req.body || {};
    const code = String(reasonCode || '');
    if (!['1', '2', '3', '4', '5', '7', '8'].includes(code)) {
      return res.status(400).json({ error: 'reasonCode required (WI codes 1,2,3,4,5,7,8)' });
    }
    if (['5', '8'].includes(code) && !String(memo || '').trim()) {
      return res.status(400).json({ error: `Reason code ${code} requires a memo` });
    }
    const visit = await db.query(`SELECT * FROM evv_visits WHERE id = $1`, [req.params.id]);
    if (!visit.rows.length) return res.status(404).json({ error: 'EVV visit not found' });

    await db.query(`
      UPDATE evv_visits SET
        exception_ack = true, exception_ack_by = $2, exception_ack_at = NOW(),
        exception_ack_reason = $3, exception_ack_memo = $4,
        sandata_status = CASE WHEN sandata_status IN ('exception','needs_manual') THEN 'ready' ELSE sandata_status END,
        updated_at = NOW()
      WHERE id = $1
    `, [req.params.id, req.user.id, code, String(memo || '').trim().slice(0, 256) || null]);

    try {
      const { enqueueVisit } = require('../services/sandataAutoSubmit');
      enqueueVisit(req.params.id).catch(e => console.error('[EVV ack enqueue]', e.message));
    } catch (e) { console.error('[EVV ack require]', e.message); }

    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ─── POLL SUBMITTED VISITS FOR ACCEPT/REJECT ────────────────────────────────
router.post('/poll-status', auth, requireAdmin, async (req, res) => {
  try {
    const { pollPendingStatuses } = require('../services/sandataAutoSubmit');
    res.json(await pollPendingStatuses());
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ─── CERTIFICATION READINESS REPORT ──────────────────────────────────────────
// The live checklist for workstream B (ALT-EVV-BUILD-PLAN.md): everything that
// would make Sandata reject a visit, queryable before credentials even exist.
router.get('/readiness', auth, requireAdmin, async (req, res) => {
  try {
    const cfg = getSandataConfig();

    const clients = await db.query(`
      SELECT c.id, c.first_name, c.last_name, c.medicaid_id,
             rs.name AS payer_name, rs.sandata_payer_id, rs.sandata_payer_program,
             ct.name AS care_type, ct.default_service_code
        FROM clients c
        LEFT JOIN referral_sources rs ON rs.id = c.referral_source_id
        LEFT JOIN care_types ct ON ct.id = c.care_type_id
       WHERE COALESCE(c.status, 'active') = 'active'
         AND COALESCE(c.is_private_pay, false) = false
       ORDER BY c.last_name, c.first_name
    `);
    const maIdRe = /^[0-9]{10,12}$/;
    const clientIssues = clients.rows.map(c => {
      const issues = [];
      if (!maIdRe.test(String(c.medicaid_id || '').replace(/\D/g, ''))) issues.push('missing/invalid Medicaid ID');
      if (!c.payer_name) issues.push('no payer assigned');
      else if (!c.sandata_payer_id) issues.push(`payer "${c.payer_name}" has no Sandata code`);
      if (!c.default_service_code) issues.push(`care type "${c.care_type || 'none'}" has no service code`);
      return { ...c, issues };
    }).filter(c => c.issues.length);

    const caregivers = await db.query(`
      SELECT u.id, u.first_name, u.last_name, cp.evv_worker_id
        FROM users u
        LEFT JOIN caregiver_profiles cp ON cp.caregiver_id = u.id
       WHERE u.role = 'caregiver' AND u.is_active = true
       ORDER BY u.last_name, u.first_name
    `);
    const workerRe = /^[0-9]{9,15}$/;
    const caregiverIssues = caregivers.rows
      .filter(u => !workerRe.test(String(u.evv_worker_id || '').replace(/\D/g, '')))
      .map(u => ({ ...u, issue: 'missing/invalid ForwardHealth worker ID' }));

    const careTypes = await db.query(`
      SELECT ct.name, ct.default_service_code, COUNT(c.id)::int AS active_clients
        FROM care_types ct
        LEFT JOIN clients c ON c.care_type_id = ct.id AND COALESCE(c.status,'active') = 'active'
       GROUP BY ct.id ORDER BY active_clients DESC
    `);

    const visitStats = await db.query(`
      SELECT sandata_status, COUNT(*)::int AS n
        FROM evv_visits WHERE service_date >= CURRENT_DATE - 30
       GROUP BY sandata_status
    `);

    res.json({
      configured: cfg.isConfigured,
      providerIdSet: !!cfg.providerId,
      clientsInScope: clients.rows.length,
      clientsWithIssues: clientIssues,
      activeCaregivers: caregivers.rows.length,
      caregiversWithIssues: caregiverIssues,
      careTypesMissingServiceCode: careTypes.rows.filter(ct => !ct.default_service_code && ct.active_clients > 0),
      visitStatsLast30Days: visitStats.rows,
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ─── SYNC CLIENT TO SANDATA ──────────────────────────────────────────────────
// Force a fresh client-record send (normally happens automatically before that
// client's first visit submission).
router.post('/sync-client/:clientId', auth, requireAdmin, async (req, res) => {
  const cfg = getSandataConfig();
  if (!cfg.isConfigured) return res.status(400).json({ error: 'Sandata not configured' });
  try {
    const client = await db.query(`
      SELECT c.*, rs.sandata_payer_id, rs.sandata_payer_program, ct.default_service_code
        FROM clients c
        LEFT JOIN referral_sources rs ON rs.id = c.referral_source_id
        LEFT JOIN care_types ct ON ct.id = c.care_type_id
       WHERE c.id = $1
    `, [req.params.clientId]);
    if (!client.rows.length) return res.status(404).json({ error: 'Client not found' });
    const c = client.rows[0];

    if (!sandataPayloads.MA_ID_RE.test(sandataPayloads.digitsOnly(c.medicaid_id))) {
      return res.status(400).json({ error: 'Client needs a valid 10-12 digit Medicaid ID first' });
    }

    const seq = sandataPayloads.nextSequence(c.sandata_sequence);
    const payload = sandataPayloads.buildClientPayload(c, {
      providerId: cfg.providerId,
      sequence: seq,
      includePayerSegment: !!(c.sandata_payer_id && c.address && c.phone),
    });

    const post = await sandataClient.postRecords('clients', payload);
    if (post.ok && post.uuid) {
      await db.query(
        `UPDATE clients SET sandata_sequence = $2, sandata_synced_at = NOW(), updated_at = NOW() WHERE id = $1`,
        [req.params.clientId, seq]);
    }
    res.json({ ok: post.ok, uuid: post.uuid, data: post.data });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ─── SYNC CAREGIVER TO SANDATA ───────────────────────────────────────────────
// Wisconsin does not take an employee feed from us: workers are registered in
// the ForwardHealth Portal, which issues the EmployeeIdentifier we send on
// visits. Load those IDs with backend/audits/import_evv_ids.js --type workers.
router.post('/sync-caregiver/:caregiverId', auth, requireAdmin, async (req, res) => {
  res.status(501).json({
    error: 'Not applicable for Wisconsin Alt-EVV',
    detail: 'Register the worker in the ForwardHealth Portal, then import the worker list (backend/audits/import_evv_ids.js --type workers). The ForwardHealth EmployeeIdentifier is sent with each visit.',
  });
});

// ─── AUTO-SUBMIT QUEUE STATUS ────────────────────────────────────────────────
router.get('/queue', auth, requireAdmin, async (req, res) => {
  try {
    const { getQueueStatus } = require('../services/sandataAutoSubmit');
    const status = await getQueueStatus();

    // Also get recent failures needing manual attention
    const failures = await db.query(`
      SELECT sq.*, ev.service_date,
        c.first_name AS client_first, c.last_name AS client_last,
        u.first_name AS cg_first, u.last_name AS cg_last
      FROM sandata_submission_queue sq
      JOIN evv_visits ev ON sq.evv_visit_id = ev.id
      JOIN clients c ON ev.client_id = c.id
      JOIN users u ON ev.caregiver_id = u.id
      WHERE sq.status = 'failed'
        AND sq.completed_at > NOW() - INTERVAL '30 days'
      ORDER BY sq.completed_at DESC
      LIMIT 50
    `);

    res.json({ queueStatus: status, recentFailures: failures.rows });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ─── RETRY FAILED SUBMISSION ────────────────────────────────────────────────
router.post('/queue/retry/:id', auth, requireAdmin, async (req, res) => {
  try {
    const { retrySubmission } = require('../services/sandataAutoSubmit');
    await retrySubmission(req.params.id);
    res.json({ success: true, message: 'Submission re-queued' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ─── EVV SUBMISSION STATUS DASHBOARD ────────────────────────────────────────
router.get('/submission-status', auth, requireAdmin, async (req, res) => {
  try {
    const { startDate, endDate } = req.query;
    const start = startDate || new Date(Date.now() - 7 * 86400000).toISOString().split('T')[0];
    const end = endDate || new Date().toISOString().split('T')[0];

    const result = await db.query(`
      SELECT
        ev.id, ev.service_date, ev.sandata_status, ev.sandata_visit_id,
        ev.sandata_submitted_at, ev.auto_submit_enabled,
        c.first_name AS client_first, c.last_name AS client_last,
        u.first_name AS cg_first, u.last_name AS cg_last,
        sq.status AS queue_status, sq.retry_count, sq.last_error,
        sq.submission_path
      FROM evv_visits ev
      JOIN clients c ON ev.client_id = c.id
      JOIN users u ON ev.caregiver_id = u.id
      LEFT JOIN sandata_submission_queue sq ON sq.evv_visit_id = ev.id
      WHERE ev.service_date BETWEEN $1 AND $2
      ORDER BY ev.service_date DESC, ev.actual_start DESC
    `, [start, end]);

    const visits = result.rows;
    const summary = {
      total: visits.length,
      pending: visits.filter(v => v.sandata_status === 'pending').length,
      ready: visits.filter(v => v.sandata_status === 'ready').length,
      submitted: visits.filter(v => v.sandata_status === 'submitted').length,
      accepted: visits.filter(v => v.sandata_status === 'accepted').length,
      needsManual: visits.filter(v => v.sandata_status === 'needs_manual').length,
      exception: visits.filter(v => v.sandata_status === 'exception').length,
      inQueue: visits.filter(v => v.queue_status === 'queued' || v.queue_status === 'processing').length,
    };

    res.json({ summary, visits });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ─── CONFIG STATUS ────────────────────────────────────────────────────────────
router.get('/config', auth, requireAdmin, async (req, res) => {
  const cfg = getSandataConfig();
  res.json({
    isConfigured: cfg.isConfigured,
    hasUsername: !!cfg.username,
    hasPassword: !!cfg.password,
    hasAccountId: !!cfg.accountId,
    hasProviderId: !!cfg.providerId,
    baseUrl: cfg.baseUrl,
    setupInstructions: cfg.isConfigured ? null : {
      step1: 'Start certification: Sandata.Zendesk.com/hc/en-us (ticket draft in ALT-EVV-SANDATA-TICKET.md)',
      step2: 'Return signed attestation F-02659; complete aggregator portal training',
      step3: 'Add to Render environment variables: SANDATA_USERNAME, SANDATA_PASSWORD, SANDATA_ACCOUNT_ID, SANDATA_PROVIDER_ID (WI Medicaid provider ID)',
      step4: 'UAT endpoint is the default; set SANDATA_API_URL to https://api.sandata.com/interfaces/intake at production go-live'
    }
  });
});

router.createEVVFromTimeEntry = createEVVFromTimeEntry;
module.exports = router;
