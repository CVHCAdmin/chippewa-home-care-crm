// services/sandataAutoSubmit.js
// Automated Sandata Alt-EVV submission queue (WI spec v7.6 / Addendum v2.6).
//
// Flow per visit: assemble bundle from live rows -> ensure the CLIENT record is
// accepted by Sandata first (spec: visits for unknown clients reject whole) ->
// build spec JSON -> POST -> store transaction UUID -> poll /status for
// accept/reject. Serialized one-at-a-time with delay, retries with backoff,
// permanent errors fail fast to needs_manual.
//
// DORMANT WITHOUT CREDENTIALS: enqueueVisit() and processQueue() both no-op
// until SANDATA_* env vars are set (they arrive with certification), so nothing
// here can fire in production before go-live.

const db = require('../db');
const { v4: uuidv4 } = require('uuid');
const sandata = require('./sandataClient');
const payloads = require('./sandataPayload');

const QUEUE_DELAY_MS = parseInt(process.env.SANDATA_QUEUE_DELAY_MS || '3000', 10);
const MAX_RETRIES = 3;
const RETRY_BASE_DELAY_MS = 5000;
// Status polling after a POST: spec says results may queue during peak load.
// Short in-line polls here; anything still processing stays 'submitted' and is
// re-checked by pollPendingStatuses() (dashboard load / next queue run).
const STATUS_POLL_DELAYS_MS = [10000, 20000, 30000];

let queueProcessing = false;

// ═════════════════════════════════════════════════════════════════════════════
// BUNDLE: everything one visit submission needs, read fresh at submit time
// ═════════════════════════════════════════════════════════════════════════════

// GPS is re-read from time_entries here (not from the evv_visits snapshot):
// breadcrumb/late-fix GPS lands on the time entry AFTER clock-out, and the
// snapshot taken at clock-out would miss it.
async function fetchBundle(evvVisitId) {
  const r = await db.query(`
    SELECT ev.id AS evv_id, ev.time_entry_id, ev.service_code, ev.modifier,
           ev.service_date, ev.actual_start, ev.actual_end,
           ev.sandata_status, ev.sandata_sequence, ev.exception_ack,
           ev.sandata_exception_code, ev.exception_ack_reason, ev.exception_ack_memo,
           te.start_time, te.end_time, te.clock_in_location, te.clock_out_location,
           te.origin_phone,
           c.id AS client_id, c.medicaid_id, c.sandata_synced_at, c.sandata_sequence AS client_sequence,
           c.first_name, c.last_name, c.address, c.city, c.state, c.zip, c.phone,
           c.latitude, c.longitude, c.status AS client_status, c.created_at AS client_created_at,
           rs.sandata_payer_id, rs.sandata_payer_program,
           cp.evv_worker_id,
           ct.default_service_code
      FROM evv_visits ev
      JOIN time_entries te ON te.id = ev.time_entry_id
      JOIN clients c ON c.id = ev.client_id
      LEFT JOIN referral_sources rs ON rs.id = c.referral_source_id
      LEFT JOIN caregiver_profiles cp ON cp.caregiver_id = ev.caregiver_id
      LEFT JOIN care_types ct ON ct.id = c.care_type_id
     WHERE ev.id = $1
  `, [evvVisitId]);
  if (!r.rows.length) return null;
  const row = r.rows[0];

  const changes = (await db.query(`
    SELECT vtc.*, u.email AS changed_by_label
      FROM visit_time_changes vtc
      LEFT JOIN users u ON u.id = vtc.changed_by
     WHERE vtc.time_entry_id = $1
     ORDER BY vtc.changed_at ASC
  `, [row.time_entry_id])).rows;

  return { row, changes };
}

function toVisitBundle({ row, changes }, cfg) {
  return {
    providerId: cfg.providerId,
    visitOtherId: row.evv_id,
    sequence: null, // filled at submit
    workerId: row.evv_worker_id,
    medicaidId: row.medicaid_id,
    payerId: row.sandata_payer_id,
    payerProgram: row.sandata_payer_program,
    serviceCode: row.service_code || row.default_service_code,
    modifier: row.modifier || null,
    startTime: row.actual_start || row.start_time,
    endTime: row.actual_end || row.end_time,
    clockInLoc: row.clock_in_location,
    clockOutLoc: row.clock_out_location,
    originPhone: row.origin_phone,
    changes,
    exceptionAck: row.exception_ack && row.sandata_exception_code
      ? { code: row.sandata_exception_code, acknowledged: true }
      : null,
    cancelled: false,
  };
}

// ═════════════════════════════════════════════════════════════════════════════
// CLIENT-FIRST SYNC (spec: unknown client MA ID -> whole visit rejected)
// ═════════════════════════════════════════════════════════════════════════════

async function ensureClientSynced(row, cfg) {
  if (row.sandata_synced_at) return { ok: true };

  const seq = payloads.nextSequence(row.client_sequence);
  const clientPayload = payloads.buildClientPayload({
    first_name: row.first_name, last_name: row.last_name,
    medicaid_id: row.medicaid_id, status: row.client_status,
    address: row.address, city: row.city, state: row.state, zip: row.zip,
    phone: row.phone, latitude: row.latitude, longitude: row.longitude,
    created_at: row.client_created_at,
    sandata_payer_id: row.sandata_payer_id,
    sandata_payer_program: row.sandata_payer_program,
    default_service_code: row.service_code || row.default_service_code,
  }, {
    providerId: cfg.providerId,
    sequence: seq,
    includePayerSegment: !!(row.sandata_payer_id && row.address && row.phone),
  });

  const post = await sandata.postRecords('clients', clientPayload);
  if (!post.ok || !post.uuid) {
    return { ok: false, error: `Client POST failed (HTTP ${post.status}): ${JSON.stringify(post.data).slice(0, 300)}` };
  }

  const status = await pollStatus('clients', post.uuid);
  if (status && status.ready && !status.accepted) {
    const reason = (status.rejects[0] && (status.rejects[0].Reason || status.rejects[0].reason)) || 'rejected';
    return { ok: false, error: `Client record rejected by Sandata: ${reason}` };
  }

  // Accepted (or still processing after our polls — optimistic; a visit reject
  // for unknown client will surface on the visit status and retry later).
  await db.query(`
    UPDATE clients SET sandata_sequence = $2, sandata_synced_at = NOW(), updated_at = NOW()
     WHERE id = $1
  `, [row.client_id, seq]);
  return { ok: true };
}

async function pollStatus(entity, uuid) {
  let last = null;
  for (const delay of STATUS_POLL_DELAYS_MS) {
    await sleep(delay);
    try {
      last = await sandata.getStatus(entity, uuid);
      if (last.ready) return last;
    } catch (e) {
      last = { ok: false, ready: false, error: e.message };
    }
  }
  return last;
}

// ═════════════════════════════════════════════════════════════════════════════
// ENQUEUE
// ═════════════════════════════════════════════════════════════════════════════

async function enqueueVisit(evvVisitId) {
  // Dormant until certification credentials exist — do not build a queue of
  // items that can only fail (pre-creds, that spammed needs_manual + alerts).
  if (!sandata.getConfig().isConfigured) {
    return { queued: false, reason: 'Sandata not configured — visit stays staged until credentials are set' };
  }

  const existing = await db.query(`
    SELECT id, status FROM sandata_submission_queue
    WHERE evv_visit_id = $1 AND status NOT IN ('failed', 'cancelled')
    LIMIT 1
  `, [evvVisitId]);
  if (existing.rows.length) {
    return { queued: false, reason: `Already in queue (${existing.rows[0].status})`, id: existing.rows[0].id };
  }

  const visit = await db.query(`SELECT id FROM evv_visits WHERE id = $1`, [evvVisitId]);
  if (!visit.rows.length) return { queued: false, reason: 'EVV visit not found' };

  const queueId = uuidv4();
  await db.query(`
    INSERT INTO sandata_submission_queue (id, evv_visit_id, submission_path, status, retry_count, created_at)
    VALUES ($1, $2, 'api', 'queued', 0, NOW())
  `, [queueId, evvVisitId]);

  console.log(`[Sandata Queue] Enqueued ${evvVisitId}`);
  processQueueAsync();
  return { queued: true, id: queueId, path: 'api' };
}

// ═════════════════════════════════════════════════════════════════════════════
// PROCESS QUEUE
// ═════════════════════════════════════════════════════════════════════════════

function processQueueAsync() {
  if (queueProcessing) return;
  queueProcessing = true;
  processQueue().catch(err => {
    console.error('[Sandata Queue] Processing error:', err.message);
  }).finally(() => {
    queueProcessing = false;
  });
}

async function processQueue() {
  if (!sandata.getConfig().isConfigured) return; // dormant

  while (true) {
    const next = await db.query(`
      SELECT sq.id AS queue_id, sq.evv_visit_id, sq.retry_count,
             c.first_name AS client_first, c.last_name AS client_last, ev.service_date
        FROM sandata_submission_queue sq
        JOIN evv_visits ev ON ev.id = sq.evv_visit_id
        JOIN clients c ON c.id = ev.client_id
       WHERE sq.status = 'queued'
         AND (sq.next_retry_at IS NULL OR sq.next_retry_at <= NOW())
       ORDER BY sq.created_at ASC
       LIMIT 1
    `);
    if (!next.rows.length) break;

    const item = next.rows[0];
    console.log(`[Sandata Queue] Processing: ${item.evv_visit_id} (${item.client_first} ${item.client_last}, ${item.service_date})`);
    await db.query(`UPDATE sandata_submission_queue SET status = 'processing', started_at = NOW() WHERE id = $1`, [item.queue_id]);

    let result;
    try {
      result = await submitViaAPI(item.evv_visit_id);
    } catch (err) {
      result = { success: false, error: err.message };
    }

    if (result.success) {
      await db.query(`UPDATE sandata_submission_queue SET status = 'completed', completed_at = NOW() WHERE id = $1`, [item.queue_id]);
      console.log(`[Sandata Queue] Completed: ${item.evv_visit_id}`);
    } else {
      const retryCount = (item.retry_count || 0) + 1;
      if (result.permanent || retryCount >= MAX_RETRIES) {
        await db.query(`
          UPDATE sandata_submission_queue
             SET status = 'failed', retry_count = $2, last_error = $3, completed_at = NOW()
           WHERE id = $1
        `, [item.queue_id, retryCount, result.error]);
        await db.query(`
          UPDATE evv_visits
             SET sandata_status = 'needs_manual', sandata_exception_desc = $2, updated_at = NOW()
           WHERE id = $1
        `, [item.evv_visit_id, result.permanent
              ? `Permanent error — needs admin fix: ${result.error}`
              : `Auto-submission failed after ${MAX_RETRIES} attempts: ${result.error}`]);
        await notifySubmissionFailure(item, result.error);
        console.log(`[Sandata Queue] FAILED (${result.permanent ? 'permanent' : 'max retries'}): ${item.evv_visit_id} — ${result.error}`);
      } else {
        const delayMs = RETRY_BASE_DELAY_MS * Math.pow(2, retryCount - 1);
        await db.query(`
          UPDATE sandata_submission_queue
             SET status = 'queued', retry_count = $2, last_error = $3,
                 next_retry_at = NOW() + ($4 || ' seconds')::interval
           WHERE id = $1
        `, [item.queue_id, retryCount, result.error, String(Math.ceil(delayMs / 1000))]);
        console.log(`[Sandata Queue] Retry ${retryCount}/${MAX_RETRIES} in ${delayMs}ms: ${item.evv_visit_id}`);
      }
    }

    await sleep(QUEUE_DELAY_MS);
  }

  // Items waiting on a backoff timer have next_retry_at in the future — the
  // loop above skips them, so schedule a one-shot wake-up (capped at 10 min);
  // otherwise a retry could sit until the next unrelated enqueue.
  try {
    const wait = await db.query(`
      SELECT EXTRACT(EPOCH FROM (MIN(next_retry_at) - NOW())) AS secs
        FROM sandata_submission_queue
       WHERE status = 'queued' AND next_retry_at > NOW()
    `);
    const secs = Number(wait.rows[0]?.secs);
    if (Number.isFinite(secs) && secs > 0) {
      const t = setTimeout(processQueueAsync, Math.min(secs + 1, 600) * 1000);
      if (t.unref) t.unref();
    }
  } catch (e) { console.error('[Sandata Queue] retry wake-up:', e.message); }
}

// ═════════════════════════════════════════════════════════════════════════════
// SUBMIT ONE VISIT
// ═════════════════════════════════════════════════════════════════════════════

async function submitViaAPI(evvVisitId) {
  const cfg = sandata.getConfig();
  const assembled = await fetchBundle(evvVisitId);
  if (!assembled) return { success: false, error: 'EVV visit not found', permanent: true };

  const bundle = toVisitBundle(assembled, cfg);

  // Pre-flight: problems that can never succeed on retry fail fast to
  // needs_manual with a precise fix-it message (no burned retries).
  const problems = payloads.validateVisitBundle(bundle);
  if (problems.length) {
    const msg = problems.map(p => p.msg).join('; ');
    await db.query(`
      UPDATE evv_visits SET sandata_exception_code = $2, sandata_exception_desc = $3, updated_at = NOW()
       WHERE id = $1
    `, [evvVisitId, problems[0].code.slice(0, 20), msg.slice(0, 500)]);
    return { success: false, error: msg, permanent: true };
  }

  // Client must be known to Sandata before its visits.
  const clientSync = await ensureClientSynced(assembled.row, cfg);
  if (!clientSync.ok) {
    return { success: false, error: clientSync.error, permanent: /rejected/i.test(clientSync.error) };
  }

  // Strictly-increasing sequence; a rejected sequence is never reused.
  const seq = payloads.nextSequence(assembled.row.sandata_sequence);
  bundle.sequence = seq;
  const payload = payloads.buildVisitPayload(bundle);

  const post = await sandata.postRecords('visits', payload);
  await db.query(`
    UPDATE evv_visits
       SET sandata_sequence = $2, sandata_uuid = $3, sandata_response = $4,
           sandata_submitted_at = NOW(), updated_at = NOW()
     WHERE id = $1
  `, [evvVisitId, seq, post.uuid, JSON.stringify(post.data || {})]);

  if (!post.ok || !post.uuid) {
    return { success: false, error: `Visit POST failed (HTTP ${post.status}): ${JSON.stringify(post.data).slice(0, 300)}` };
  }

  await db.query(`
    UPDATE evv_visits SET sandata_status = 'submitted', needs_resubmit = false, updated_at = NOW()
     WHERE id = $1
  `, [evvVisitId]);

  // Learn accept/reject now if Sandata has finished processing.
  const status = await pollStatus('visits', post.uuid);
  if (status && status.ready) {
    await applyStatusResult(evvVisitId, status);
    if (!status.accepted) {
      const reason = (status.rejects[0] && (status.rejects[0].Reason || status.rejects[0].reason)) || 'rejected';
      return { success: false, error: `Sandata rejected: ${reason}`, permanent: false };
    }
  }
  // Still processing -> stays 'submitted'; pollPendingStatuses() resolves later.
  return { success: true };
}

async function applyStatusResult(evvVisitId, status) {
  if (status.accepted) {
    await db.query(`
      UPDATE evv_visits SET sandata_status = 'accepted', sandata_exception_code = NULL,
             sandata_exception_desc = NULL, updated_at = NOW()
       WHERE id = $1
    `, [evvVisitId]);
  } else {
    const reject = status.rejects && status.rejects[0];
    const reason = (reject && (reject.Reason || reject.reason)) || 'Record rejected';
    await db.query(`
      UPDATE evv_visits SET sandata_status = 'exception', sandata_exception_code = 'REJECT',
             sandata_exception_desc = $2, sandata_response = $3, updated_at = NOW()
       WHERE id = $1
    `, [evvVisitId, String(reason).slice(0, 500), JSON.stringify(status.data || {})]);
  }
}

// Re-check every visit that was POSTed but whose accept/reject wasn't known yet.
// Called from the admin dashboard route and after queue runs — no timers needed.
async function pollPendingStatuses() {
  if (!sandata.getConfig().isConfigured) return { checked: 0 };
  const pending = await db.query(`
    SELECT id, sandata_uuid FROM evv_visits
     WHERE sandata_status = 'submitted' AND sandata_uuid IS NOT NULL
     ORDER BY sandata_submitted_at ASC
     LIMIT 50
  `);
  let resolved = 0;
  for (const v of pending.rows) {
    try {
      const status = await sandata.getStatus('visits', v.sandata_uuid);
      if (status.ready) { await applyStatusResult(v.id, status); resolved++; }
    } catch (e) {
      console.error('[Sandata Poll] status check failed:', v.id, e.message);
    }
  }
  return { checked: pending.rows.length, resolved };
}

// Mark a submitted/accepted visit as changed -> requeue with the next sequence.
async function requeueChangedVisit(evvVisitId) {
  await db.query(`UPDATE evv_visits SET needs_resubmit = true, updated_at = NOW() WHERE id = $1`, [evvVisitId]);
  return enqueueVisit(evvVisitId);
}

// ═════════════════════════════════════════════════════════════════════════════
// NOTIFICATION / UTILITY / STATUS
// ═════════════════════════════════════════════════════════════════════════════

async function notifySubmissionFailure(item, error) {
  const clientName = `${item.client_first} ${item.client_last}`;
  const admins = await db.query(`SELECT id FROM users WHERE role = 'admin' AND is_active = true`);
  for (const admin of admins.rows) {
    await db.query(`
      INSERT INTO notifications (id, user_id, type, title, message, is_read, created_at)
      VALUES ($1, $2, 'evv_submission_failed', $3, $4, false, NOW())
    `, [
      uuidv4(), admin.id,
      `EVV Submission Failed: ${clientName}`,
      `Sandata auto-submission failed for ${clientName} (${item.service_date}).\n\nError: ${error}\n\nFix the underlying issue, then retry from the EVV dashboard.`,
    ]);
  }
}

function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }

async function getQueueStatus() {
  const result = await db.query(`
    SELECT status, COUNT(*) AS count, MIN(created_at) AS oldest
      FROM sandata_submission_queue
     WHERE created_at > NOW() - INTERVAL '7 days'
     GROUP BY status ORDER BY status
  `);
  return result.rows;
}

async function retrySubmission(queueId) {
  await db.query(`
    UPDATE sandata_submission_queue
       SET status = 'queued', retry_count = 0, last_error = NULL, next_retry_at = NULL
     WHERE id = $1 AND status = 'failed'
  `, [queueId]);
  processQueueAsync();
}

module.exports = {
  enqueueVisit,
  processQueueAsync,
  getQueueStatus,
  retrySubmission,
  pollPendingStatuses,
  requeueChangedVisit,
  submitViaAPI,       // exported for UAT test harness
  fetchBundle,        // exported for readiness/preview tooling
  toVisitBundle,
};
