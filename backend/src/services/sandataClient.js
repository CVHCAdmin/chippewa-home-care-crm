// services/sandataClient.js
// Transport for the Sandata intake API (WI Alt-EVV, spec v7.6 / WI Addendum v2.6).
// Two-step protocol: POST records -> receive ACK with a UUID -> GET /status?uuid=
// to learn per-record accept/reject.
//
// Endpoints (spec 11.1):
//   UAT:  https://uat-api.sandata.com/interfaces/intake/{clients|employees|visits}/rest/api/v1.1
//   Prod: https://api.sandata.com/interfaces/intake/{clients|employees|visits}/rest/api/v1.1
//
// Entirely dormant without credentials: isConfigured() is false until
// SANDATA_USERNAME / SANDATA_PASSWORD / SANDATA_ACCOUNT_ID / SANDATA_PROVIDER_ID
// are set (they arrive with certification), and every caller checks it first.

const UAT_BASE = 'https://uat-api.sandata.com/interfaces/intake';

function getConfig() {
  return {
    baseUrl: (process.env.SANDATA_API_URL || UAT_BASE).replace(/\/+$/, ''),
    username: process.env.SANDATA_USERNAME,
    password: process.env.SANDATA_PASSWORD,
    accountId: process.env.SANDATA_ACCOUNT_ID,
    providerId: process.env.SANDATA_PROVIDER_ID,
    isConfigured: !!(process.env.SANDATA_USERNAME && process.env.SANDATA_PASSWORD
      && process.env.SANDATA_ACCOUNT_ID && process.env.SANDATA_PROVIDER_ID),
  };
}

function entityUrl(entity) {
  const cfg = getConfig();
  return `${cfg.baseUrl}/${entity}/rest/api/v1.1`;
}

function headers() {
  const cfg = getConfig();
  return {
    'Authorization': `Basic ${Buffer.from(`${cfg.username}:${cfg.password}`).toString('base64')}`,
    'Account': cfg.accountId,
    'Content-Type': 'application/json',
    'Accept': 'application/json',
  };
}

// Collect every ErrorMessage Sandata attached to the echoed records — at the
// record level, on ProviderIdentification, and on each Call/VisitChange.
// Observed in UAT 2026-11-23: field validation errors come back synchronously
// in the POST reply as { status:'FAILED', failedCount:N, data:[record + ErrorMessage] }
// with HTTP 200, so "HTTP ok + uuid" alone does NOT mean accepted.
function extractRecordErrors(data) {
  const out = [];
  const records = Array.isArray(data?.data) ? data.data : Array.isArray(data) ? data : [];
  for (const rec of records) {
    if (!rec || typeof rec !== 'object') continue;
    const id = rec.VisitOtherID || rec.ClientOtherID || rec.ClientID || null;
    const push = (m) => { if (m) out.push({ RecordOtherID: id, Reason: String(m) }); };
    push(rec.ErrorMessage);
    push(rec.ProviderIdentification?.ErrorMessage);
    for (const k of ['Calls', 'VisitChanges', 'VisitExceptionAcknowledgement', 'ClientPayerInformation', 'ClientAddress', 'ClientPhone']) {
      if (Array.isArray(rec[k])) rec[k].forEach(x => push(x?.ErrorMessage));
    }
    // Spec 2.11 status rows: {RecordOtherID, Reason}
    const reason = rec.Reason || rec.reason;
    if (reason && !/transaction received|success|accepted/i.test(String(reason))) push(reason);
  }
  return out;
}

function isFailedEnvelope(data) {
  return !!data && (String(data.status || '').toUpperCase() === 'FAILED' || Number(data.failedCount) > 0);
}

// POST one or more records (spec allows 1-5000 per transaction; we send arrays).
// Returns { ok, status, data, uuid, rejected, rejects } — uuid identifies the
// transaction for the status endpoint; rejected=true means Sandata refused the
// record(s) at intake (rejects[] holds the reasons) and no status poll will
// turn that into an accept.
async function postRecords(entity, records) {
  const cfg = getConfig();
  if (!cfg.isConfigured) throw new Error('Sandata not configured (SANDATA_USERNAME/PASSWORD/ACCOUNT_ID/PROVIDER_ID)');
  const body = Array.isArray(records) ? records : [records];
  const response = await fetch(entityUrl(entity), {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify(body),
  });
  let data = null;
  try { data = await response.json(); } catch { /* non-JSON error body */ }
  const uuid = data?.uuid || data?.UUID || data?.id || null;
  const rejects = extractRecordErrors(data);
  const rejected = response.ok && (isFailedEnvelope(data) || rejects.length > 0);
  if (rejected && !rejects.length) {
    rejects.push({ RecordOtherID: null, Reason: data?.messageSummary || data?.errorMessage || 'Rejected at intake' });
  }
  return { ok: response.ok, status: response.status, data, uuid, rejected, rejects };
}

// GET the processing status for a prior POST's UUID.
// Returns { ok, status, ready, accepted, records, data }:
//   ready=false  -> Sandata still processing ("not ready yet" — poll again later)
//   accepted     -> true when no record-level rejections came back
//   records      -> per-record status rows (reject reasons live here)
async function getStatus(entity, uuid) {
  const cfg = getConfig();
  if (!cfg.isConfigured) throw new Error('Sandata not configured');
  const response = await fetch(`${entityUrl(entity)}/status?uuid=${encodeURIComponent(uuid)}`, {
    method: 'GET',
    headers: headers(),
  });
  let data = null;
  try { data = await response.json(); } catch { /* non-JSON */ }

  const text = JSON.stringify(data || '');
  const notReady = /not ready/i.test(text);
  if (notReady) return { ok: true, status: response.status, ready: false, accepted: null, records: [], data };

  // Observed UAT envelope: { status:'SUCCESS'|'FAILED', failedCount, data:{ data:[...] } }.
  // A transaction rejected at POST time comes back here as status FAILED,
  // "Status was not found" — never treat that as accepted.
  const inner = data?.data && !Array.isArray(data.data) ? data.data : data;
  const records = Array.isArray(data) ? data
    : Array.isArray(data?.records) ? data.records
    : Array.isArray(inner?.data) ? inner.data
    : Array.isArray(data?.data) ? data.data
    : [];
  const rejects = extractRecordErrors({ data: records });
  const failed = isFailedEnvelope(data);
  if (failed && !rejects.length) {
    rejects.push({ RecordOtherID: null, Reason: data?.messageDetail || data?.errorMessage || data?.messageSummary || 'FAILED' });
  }
  return {
    ok: response.ok,
    status: response.status,
    ready: true,
    accepted: response.ok && !failed && rejects.length === 0,
    rejects,
    records,
    data,
  };
}

module.exports = { getConfig, postRecords, getStatus, entityUrl };
