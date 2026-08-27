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

// POST one or more records (spec allows 1-5000 per transaction; we send arrays).
// Returns { ok, status, data, uuid } — uuid identifies the transaction for the
// status endpoint.
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
  return { ok: response.ok, status: response.status, data, uuid };
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

  // Response shape per spec 2.11: array (or {records: []}) of
  // {AgencyIdentifier, ProviderID, RecordType, RecordOtherID, Reason}.
  const records = Array.isArray(data) ? data
    : Array.isArray(data?.records) ? data.records
    : Array.isArray(data?.data) ? data.data
    : [];
  const rejects = records.filter(r => {
    const reason = String(r.Reason || r.reason || '');
    return reason && !/transaction received|success|accepted/i.test(reason);
  });
  return {
    ok: response.ok,
    status: response.status,
    ready: true,
    accepted: response.ok && rejects.length === 0,
    rejects,
    records,
    data,
  };
}

module.exports = { getConfig, postRecords, getStatus, entityUrl };
