// services/sandataAutoSubmit.js
// Automated Sandata EVV submission service.
// Two paths: API (preferred) and browser automation (fallback).
// Processes a queue one-at-a-time with delay between submissions.

const db = require('../db');
const { v4: uuidv4 } = require('uuid');

// ── Sandata API client (reuses the pattern from sandataRoutes.js) ───────────

function getSandataConfig() {
  return {
    baseUrl: process.env.SANDATA_API_URL || 'https://openevv.sandata.com/api/v1',
    username: process.env.SANDATA_USERNAME,
    password: process.env.SANDATA_PASSWORD,
    accountId: process.env.SANDATA_ACCOUNT_ID,
    isConfigured: !!(process.env.SANDATA_USERNAME && process.env.SANDATA_PASSWORD && process.env.SANDATA_ACCOUNT_ID),
  };
}

async function sandataRequest(method, endpoint, body = null) {
  const cfg = getSandataConfig();
  if (!cfg.isConfigured) {
    throw new Error('Sandata credentials not configured');
  }

  const credentials = Buffer.from(`${cfg.username}:${cfg.password}`).toString('base64');
  const options = {
    method,
    headers: {
      'Authorization': `Basic ${credentials}`,
      'Account': cfg.accountId,
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    },
  };
  if (body) options.body = JSON.stringify(body);

  const response = await fetch(`${cfg.baseUrl}${endpoint}`, options);
  const data = await response.json();
  return { ok: response.ok, status: response.status, data };
}

// ── Queue configuration ─────────────────────────────────────────────────────

const QUEUE_DELAY_MS = parseInt(process.env.SANDATA_QUEUE_DELAY_MS || '3000', 10);
const MAX_RETRIES = 3;
const RETRY_BASE_DELAY_MS = 5000;

let queueProcessing = false;

// ═════════════════════════════════════════════════════════════════════════════
// ENQUEUE: Add a visit to the Sandata submission queue
// ═════════════════════════════════════════════════════════════════════════════

/**
 * Enqueue an EVV visit for Sandata submission.
 * Called automatically from clock-out after EVV record is created.
 * @param {string} evvVisitId - ID of the evv_visits record
 * @returns {Object} Queue entry
 */
async function enqueueVisit(evvVisitId) {
  // Check if already queued or submitted
  const existing = await db.query(`
    SELECT id, status FROM sandata_submission_queue
    WHERE evv_visit_id = $1 AND status NOT IN ('failed', 'cancelled')
    LIMIT 1
  `, [evvVisitId]);

  if (existing.rows.length) {
    return { queued: false, reason: `Already in queue (${existing.rows[0].status})`, id: existing.rows[0].id };
  }

  // Verify the EVV visit is ready
  const visit = await db.query(`
    SELECT ev.*, cp.evv_worker_id, cp.npi_number
    FROM evv_visits ev
    LEFT JOIN caregiver_profiles cp ON cp.caregiver_id = ev.caregiver_id
    WHERE ev.id = $1
  `, [evvVisitId]);

  if (!visit.rows.length) {
    return { queued: false, reason: 'EVV visit not found' };
  }

  const v = visit.rows[0];

  // Determine submission path
  const hasWorkerId = !!(v.evv_worker_id || v.npi_number);
  const submissionPath = hasWorkerId && getSandataConfig().isConfigured ? 'api' : 'browser';

  const queueId = uuidv4();
  await db.query(`
    INSERT INTO sandata_submission_queue (
      id, evv_visit_id, submission_path, status,
      retry_count, created_at
    ) VALUES ($1, $2, $3, 'queued', 0, NOW())
  `, [queueId, evvVisitId, submissionPath]);

  console.log(`[Sandata Queue] Enqueued ${evvVisitId} via ${submissionPath}`);

  // Kick off queue processing if not already running
  processQueueAsync();

  return { queued: true, id: queueId, path: submissionPath };
}

// ═════════════════════════════════════════════════════════════════════════════
// PROCESS QUEUE: One at a time with delay
// ═════════════════════════════════════════════════════════════════════════════

function processQueueAsync() {
  if (queueProcessing) return;
  queueProcessing = true;

  // Fire and forget — runs in background
  processQueue().catch(err => {
    console.error('[Sandata Queue] Processing error:', err.message);
  }).finally(() => {
    queueProcessing = false;
  });
}

async function processQueue() {
  while (true) {
    // Get next queued item
    const next = await db.query(`
      SELECT sq.*, ev.*,
        c.medicaid_id, c.evv_client_id,
        c.first_name AS client_first, c.last_name AS client_last,
        c.date_of_birth, c.gender,
        u.first_name AS cg_first, u.last_name AS cg_last,
        cp.evv_worker_id, cp.npi_number, cp.taxonomy_code
      FROM sandata_submission_queue sq
      JOIN evv_visits ev ON sq.evv_visit_id = ev.id
      JOIN clients c ON ev.client_id = c.id
      JOIN users u ON ev.caregiver_id = u.id
      LEFT JOIN caregiver_profiles cp ON cp.caregiver_id = u.id
      WHERE sq.status = 'queued'
      ORDER BY sq.created_at ASC
      LIMIT 1
    `);

    if (!next.rows.length) break; // Queue empty

    const item = next.rows[0];
    const queueId = item.id;

    console.log(`[Sandata Queue] Processing: ${item.evv_visit_id} (${item.client_first} ${item.client_last}, ${item.service_date})`);

    // Mark as processing
    await db.query(`UPDATE sandata_submission_queue SET status = 'processing', started_at = NOW() WHERE id = $1`, [queueId]);

    let success = false;
    let error = null;
    let permanent = false;

    if (item.submission_path === 'api') {
      const result = await submitViaAPI(item);
      success = result.success;
      error = result.error;
      permanent = !!result.permanent;
    } else {
      const result = await submitViaBrowser(item);
      success = result.success;
      error = result.error;
      permanent = !!result.permanent;
    }

    if (success) {
      await db.query(`UPDATE sandata_submission_queue SET status = 'completed', completed_at = NOW() WHERE id = $1`, [queueId]);
      console.log(`[Sandata Queue] Completed: ${item.evv_visit_id}`);
    } else {
      const retryCount = (item.retry_count || 0) + 1;
      // Permanent errors (missing auth, missing IDs, missing GPS) won't fix
      // themselves on retry — fail immediately and surface to admin.
      if (permanent || retryCount >= MAX_RETRIES) {
        // Max retries reached — mark failed and flag for manual EVV
        await db.query(`
          UPDATE sandata_submission_queue SET
            status = 'failed', retry_count = $2, last_error = $3, completed_at = NOW()
          WHERE id = $1
        `, [queueId, retryCount, error]);

        const failureReason = permanent
          ? `Permanent error — needs admin fix: ${error}`
          : `Auto-submission failed after ${MAX_RETRIES} attempts: ${error}`;
        await db.query(`
          UPDATE evv_visits SET
            sandata_status = 'needs_manual',
            sandata_exception_desc = $2,
            updated_at = NOW()
          WHERE id = $1
        `, [item.evv_visit_id, failureReason]);

        // Alert admins
        await notifySubmissionFailure(item, error);

        console.log(`[Sandata Queue] FAILED (${permanent ? 'permanent' : 'max retries'}): ${item.evv_visit_id} — ${error}`);
      } else {
        // Schedule retry with exponential backoff
        const delayMs = RETRY_BASE_DELAY_MS * Math.pow(2, retryCount - 1);
        await db.query(`
          UPDATE sandata_submission_queue SET
            status = 'queued', retry_count = $2, last_error = $3,
            next_retry_at = NOW() + INTERVAL '${Math.ceil(delayMs / 1000)} seconds'
          WHERE id = $1
        `, [queueId, retryCount, error]);

        console.log(`[Sandata Queue] Retry ${retryCount}/${MAX_RETRIES} in ${delayMs}ms: ${item.evv_visit_id}`);
      }
    }

    // Delay between submissions to avoid rate limiting
    await sleep(QUEUE_DELAY_MS);
  }
}

// ═════════════════════════════════════════════════════════════════════════════
// PATH 1: Sandata API submission (preferred)
// ═════════════════════════════════════════════════════════════════════════════

// Errors that will NEVER succeed on retry. When the API returns one of these,
// fail the queue item immediately instead of burning 3 retries first — they
// require human intervention (missing auth, bad service code, no worker ID).
const PERMANENT_ERROR_CODES = new Set([
  'NO_AUTH', 'AUTH_INVALID', 'AUTH_EXPIRED',
  'NO_MEDICAID_ID', 'INVALID_MEDICAID_ID',
  'NO_EMPLOYEE_ID', 'INVALID_EMPLOYEE_ID',
  'INVALID_SERVICE_CODE', 'INVALID_MODIFIER',
  'NO_CLIENT', 'CLIENT_INACTIVE',
  'NO_GPS', 'NO_GPS_IN', 'NO_GPS_OUT',
  'DUPLICATE_VISIT',
]);

function classifyError(exceptionCode, errorMsg) {
  if (PERMANENT_ERROR_CODES.has(exceptionCode)) return 'permanent';
  if (/auth|credential|invalid|missing/i.test(errorMsg || '')) return 'permanent';
  return 'transient';
}

async function submitViaAPI(item) {
  try {
    // Pre-flight validation. Sandata API rejects null GPS lat/long when
    // VerificationMethod is 'GPS' — used to consume 3 retries before failing.
    // Fail fast and route to manual instead. Same for missing required IDs.
    const clientId = item.evv_client_id || item.medicaid_id;
    const employeeId = item.evv_worker_id || item.npi_number;
    const missing = [];
    if (!clientId) missing.push('Medicaid/EVV client ID');
    if (!employeeId) missing.push('EVV worker ID / NPI');
    if (item.gps_in_lat == null || item.gps_in_lng == null) missing.push('GPS clock-in coords');
    if (item.actual_end && (item.gps_out_lat == null || item.gps_out_lng == null)) {
      missing.push('GPS clock-out coords');
    }
    if (missing.length > 0) {
      const code = !clientId ? 'NO_MEDICAID_ID'
                 : !employeeId ? 'NO_EMPLOYEE_ID'
                 : 'NO_GPS';
      const msg = `Pre-submit validation failed — missing: ${missing.join(', ')}`;
      await db.query(
        `UPDATE evv_visits
           SET sandata_exception_code = $2, sandata_exception_desc = $3, updated_at = NOW()
         WHERE id = $1`,
        [item.evv_visit_id, code, msg]
      );
      return { success: false, error: `${code}: ${msg}`, permanent: true };
    }

    const payload = {
      ClientID: clientId,
      EmployeeID: employeeId,
      ServiceCode: item.service_code || 'T1019',
      Modifier: item.modifier || null,
      ServiceDate: item.service_date,
      ActualStartTime: new Date(item.actual_start).toISOString(),
      ActualEndTime: item.actual_end ? new Date(item.actual_end).toISOString() : null,
      UnitsOfService: item.units_of_service,
      GPSInLatitude: item.gps_in_lat,
      GPSInLongitude: item.gps_in_lng,
      GPSOutLatitude: item.gps_out_lat,
      GPSOutLongitude: item.gps_out_lng,
      VerificationMethod: 'GPS',
    };

    const response = await sandataRequest('POST', '/visits', payload);

    if (response.ok) {
      const sandataVisitId = response.data?.VisitID || response.data?.visitId || null;

      if (!sandataVisitId) {
        return { success: false, error: 'API returned OK but no VisitID in response' };
      }

      // Update EVV visit with confirmation
      await db.query(`
        UPDATE evv_visits SET
          sandata_status = 'submitted',
          sandata_visit_id = $2,
          sandata_submitted_at = NOW(),
          sandata_response = $3,
          updated_at = NOW()
        WHERE id = $1
      `, [item.evv_visit_id, sandataVisitId, JSON.stringify(response.data)]);

      return { success: true };
    } else {
      const errorMsg = response.data?.Message || response.data?.message || `HTTP ${response.status}`;
      const exceptionCode = response.data?.ExceptionCode || response.data?.exceptionCode || 'ERR';

      // Store the exception on the EVV record
      await db.query(`
        UPDATE evv_visits SET
          sandata_exception_code = $2,
          sandata_exception_desc = $3,
          sandata_response = $4,
          updated_at = NOW()
        WHERE id = $1
      `, [item.evv_visit_id, exceptionCode, errorMsg, JSON.stringify(response.data)]);

      const permanent = classifyError(exceptionCode, errorMsg) === 'permanent';
      return { success: false, error: `${exceptionCode}: ${errorMsg}`, permanent };
    }
  } catch (err) {
    return { success: false, error: err.message };
  }
}

// ═════════════════════════════════════════════════════════════════════════════
// PATH 2: Browser automation fallback (Playwright)
// ═════════════════════════════════════════════════════════════════════════════

async function submitViaBrowser(item) {
  try {
    // Lazy-load the browser fallback module
    const { submitVisitViaBrowser } = require('./sandataBrowserFallback');
    return await submitVisitViaBrowser(item);
  } catch (err) {
    if (err.code === 'MODULE_NOT_FOUND') {
      return { success: false, error: 'Playwright not installed. Run: npm install playwright' };
    }
    return { success: false, error: err.message };
  }
}

// ═════════════════════════════════════════════════════════════════════════════
// NOTIFICATION: Alert on permanent failure
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
      `Sandata auto-submission failed for ${clientName} (${item.service_date}) after ${MAX_RETRIES} attempts.\n\nError: ${error}\n\nThis visit needs to be manually submitted to Sandata.`,
    ]);
  }
}

// ═════════════════════════════════════════════════════════════════════════════
// UTILITY
// ═════════════════════════════════════════════════════════════════════════════

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Get queue status summary for admin dashboard.
 */
async function getQueueStatus() {
  const result = await db.query(`
    SELECT
      status,
      COUNT(*) AS count,
      MIN(created_at) AS oldest
    FROM sandata_submission_queue
    WHERE created_at > NOW() - INTERVAL '7 days'
    GROUP BY status
    ORDER BY status
  `);

  return result.rows;
}

/**
 * Retry a specific failed submission.
 */
async function retrySubmission(queueId) {
  await db.query(`
    UPDATE sandata_submission_queue SET
      status = 'queued', retry_count = 0, last_error = NULL
    WHERE id = $1 AND status = 'failed'
  `, [queueId]);

  processQueueAsync();
}

module.exports = {
  enqueueVisit,
  processQueueAsync,
  getQueueStatus,
  retrySubmission,
};
