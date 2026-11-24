// services/sandataPayload.js
// Builds Wisconsin Alt-EVV spec-conformant JSON (Sandata Third-Party spec v7.6
// + WI DMS Addendum v2.6) for the client and visit intake interfaces.
// Pure functions — no DB access, no network. Assembled data goes in, spec JSON
// comes out, so this whole layer is testable read-only against real rows.
//
// Spec source: ALT-EVV-CERTIFICATION-GAP.md (repo root) + the addendum PDF.

// ── formatting helpers ───────────────────────────────────────────────────────

// Spec date/time: YYYY-MM-DDTHH:MM:SSZ, UTC, to the second (no milliseconds).
function utc(dt) {
  if (!dt) return null;
  const d = new Date(dt);
  if (isNaN(d.getTime())) return null;
  return d.toISOString().replace(/\.\d{3}Z$/, 'Z');
}

// Sequence: spec-sanctioned timestamp form YYYYMMDDHHMMSS (numbers only, UTC),
// bumped past the last sequence used so a resubmit in the same second still
// strictly increases and a rejected sequence is never reused.
function nextSequence(lastSeq) {
  const now = new Date().toISOString().replace(/[-:TZ]/g, '').slice(0, 14);
  const ts = parseInt(now, 10);
  const last = parseInt(lastSeq, 10) || 0;
  return ts > last ? ts : last + 1;
}

// clock_in_location / clock_out_location JSONB has 3 historical shapes:
//   {lat, lng}  ·  {latitude, longitude}  ·  {lat, lng, source, captured_at}
function normalizeLoc(loc) {
  if (!loc) return null;
  const o = typeof loc === 'string' ? safeParse(loc) : loc;
  if (!o) return null;
  const lat = o.lat ?? o.latitude ?? null;
  const lng = o.lng ?? o.longitude ?? null;
  if (lat == null || lng == null) return null;
  return { lat: Number(lat), lng: Number(lng), source: o.source || 'tap' };
}

function safeParse(s) { try { return JSON.parse(s); } catch { return null; } }

// Client names: max 30 chars; only letters, hyphens, periods, apostrophes
// (Appendix 10). Strip quoted nicknames and disallowed characters.
function specName(name) {
  return String(name || '')
    .replace(/["“”][^"“”]*["“”]/g, ' ')
    .replace(/[^A-Za-z .'-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 30);
}

function digitsOnly(s) { return String(s || '').replace(/\D/g, ''); }

// 9-digit zip; pad the +4 with zeros when unknown (spec: "send 0000").
function specZip(zip) {
  const d = digitsOnly(zip);
  if (d.length >= 9) return d.slice(0, 9);
  if (d.length >= 5) return d.slice(0, 5).padEnd(9, '0');
  return null;
}

const MA_ID_RE = /^[0-9]{10,12}$/;
const WORKER_ID_RE = /^[0-9]{9,15}$/;

// ── validation (readiness / pre-flight) ──────────────────────────────────────

// Returns [] when the assembled bundle can produce a valid visit payload.
function validateVisitBundle(b) {
  const problems = [];
  if (!b.providerId) problems.push({ code: 'NO_PROVIDER_ID', msg: 'SANDATA_PROVIDER_ID env var not set (WI Medicaid provider ID)' });
  if (!MA_ID_RE.test(digitsOnly(b.medicaidId))) problems.push({ code: 'BAD_MEDICAID_ID', msg: `Client MA ID must be 10-12 digits (have: ${b.medicaidId || 'none'})` });
  if (!WORKER_ID_RE.test(digitsOnly(b.workerId))) problems.push({ code: 'BAD_WORKER_ID', msg: `Caregiver ForwardHealth worker ID must be 9-15 digits (have: ${b.workerId || 'none'})` });
  if (!b.payerId || !b.payerProgram) problems.push({ code: 'NO_PAYER_CODES', msg: 'Client payer has no Sandata PayerID/PayerProgram mapped' });
  if (!b.serviceCode) problems.push({ code: 'NO_SERVICE_CODE', msg: 'No procedure code (set care_types.default_service_code)' });
  if (!b.startTime) problems.push({ code: 'NO_START', msg: 'Visit has no start time' });
  if (!b.endTime) problems.push({ code: 'NO_END', msg: 'Visit has no end time (still open?)' });
  return problems;
}

// ── visit payload (spec section 3.6-3.10) ────────────────────────────────────
//
// bundle = {
//   providerId, visitOtherId, sequence,
//   workerId, medicaidId, payerId, payerProgram, serviceCode,
//   startTime, endTime, clockInLoc, clockOutLoc (raw JSONB),
//   originPhone (IVR caller id, null otherwise),
//   changes: [visit_time_changes rows], exceptionAck: {code, acknowledged} | null,
//   cancelled: boolean
// }
function buildVisitPayload(b) {
  const maId = digitsOnly(b.medicaidId);
  const inLoc = normalizeLoc(b.clockInLoc);
  const outLoc = normalizeLoc(b.clockOutLoc);
  const isIvr = !!b.originPhone;

  // visit_time_changes rows record admin-set punch times. Per side (in/out):
  //  - the caregiver DID punch (old value present) and the time was later
  //    corrected -> keep the ORIGINAL call (complete record set) and send the
  //    corrected time as AdjIn/AdjOut. Sandata UAT checklist: "Visits should
  //    only be sent with adjusted times when original call times have
  //    already been sent."
  //  - there was NO live punch (old value NULL, e.g. force clock-out) ->
  //    send a CallType "Manual" call at the entered time; VisitChanges below
  //    records why (checklist: "VisitChanges is required ... CallType Manual").
  const changes = Array.isArray(b.changes) ? b.changes : [];
  const side = (oldKey, newKey) => {
    const rows = changes.filter(c => c[newKey]);
    if (!rows.length) return { kind: 'live' };
    const original = rows.find(c => c[oldKey]);            // earliest real punch
    return original
      ? { kind: 'adjusted', original: original[oldKey], adjusted: rows[rows.length - 1][newKey] }
      : { kind: 'manual' };
  };
  const inSide = side('old_start', 'new_start');
  const outSide = side('old_end', 'new_end');

  // CallExternalID max is 16 chars — a UUID alone would truncate identically
  // for both calls, so build from a shortened visit id + distinct suffix.
  const callIdBase = String(b.visitOtherId).replace(/-/g, '').slice(0, 14);
  const calls = [];
  const addCall = (s, suffix, liveTime, assignment, loc) => {
    if (s.kind === 'manual') {
      if (liveTime) calls.push(buildCall(callIdBase + suffix, liveTime, assignment, null, false, b, 'Manual'));
    } else if (s.kind === 'adjusted') {
      calls.push(buildCall(callIdBase + suffix, s.original, assignment, loc, isIvr, b));
    } else if (liveTime) {
      calls.push(buildCall(callIdBase + suffix, liveTime, assignment, loc, isIvr, b));
    }
  };
  addCall(inSide, '-I', b.startTime, 'Time In', inLoc);
  addCall(outSide, '-O', b.endTime, 'Time Out', outLoc);
  const startAdjusted = inSide.kind === 'adjusted';
  const endAdjusted = outSide.kind === 'adjusted';

  const payload = {
    ProviderIdentification: {
      ProviderQualifier: 'MedicaidID',
      ProviderID: String(b.providerId),
    },
    // Sandata enforces ^\w*$ (UAT: "VisitOtherID format is incorrect"); our
    // ids are UUIDs, so strip hyphens. Deterministic, so updates still match.
    VisitOtherID: String(b.visitOtherId).replace(/\W/g, '').slice(0, 50),
    SequenceID: b.sequence,
    EmployeeQualifier: 'EmployeeCustomID',
    EmployeeIdentifier: digitsOnly(b.workerId),
    ClientIDQualifier: 'ClientCustomID',
    ClientID: maId,
    ClientOtherID: maId,
    VisitCancelledIndicator: !!b.cancelled,
    PayerID: b.payerId,
    PayerProgram: b.payerProgram,
    ProcedureCode: b.serviceCode,
    Modifier1: b.modifier || null,
    Modifier2: null,
    Modifier3: null,
    Modifier4: null,
    VisitTimeZone: 'US/Central',
    AdjInDateTime: startAdjusted ? utc(inSide.adjusted) : null,
    AdjOutDateTime: endAdjusted ? utc(outSide.adjusted) : null,
    // Required by the UAT intake (rejects null) even though the WI addendum
    // omits it; base spec v7.6 field 23. Cancelled visits are not billed.
    // billVisit=false is Sandata's only way to omit a visit already sent.
    BillVisit: b.billVisit != null ? !!b.billVisit : !b.cancelled,
    ClientVerifiedTimes: null,
    ClientVerifiedTasks: null,
    ClientVerifiedService: null,
    ClientSignatureAvailable: null,
    ClientVoiceRecording: null,
    Calls: calls,
  };

  if (changes.length) {
    payload.VisitChanges = changes.map((c, i) => ({
      // Addendum 3.9: String type (visit SequenceID is Integer). Precedes the visit's.
      SequenceID: String(b.sequence - changes.length + i),
      ChangeMadeBy: String(c.changed_by_label || c.changed_by || 'system').slice(0, 64),
      ChangeDateTime: utc(c.changed_at),
      GroupCode: null,
      ReasonCode: String(c.reason_code),
      ChangeReasonMemo: c.memo ? String(c.memo).slice(0, 256) : null,
      ResolutionCode: c.resolution_code ? String(c.resolution_code) : '1',
    }));
  }

  if (b.exceptionAck && b.exceptionAck.code != null) {
    payload.VisitExceptionAcknowledgement = [{
      ExceptionID: String(b.exceptionAck.code).slice(0, 2),
      ExceptionAcknowledged: b.exceptionAck.acknowledged !== false,
    }];
  }

  return payload;
}

// CallType per spec 3.7: Mobile when GPS was collected, Telephony for IVR
// (with the originating phone), Other for an electronic tap with no GPS fix.
//
// UAT intake (2026-11-23) also requires ClientIdentifierOnCall on every call
// (the member's WI MA ID) and MobileLogin whenever CallType=Mobile (spec v7.6:
// "log in used if a mobile application is in use", ≤64). We send the worker's
// ForwardHealth ID as the login identifier rather than their email address.
function buildCall(id, when, assignment, loc, isIvr, b, forceType = null) {
  const isMobile = !forceType && !isIvr && !!loc;
  if (forceType) isIvr = false;
  const call = {
    CallExternalID: String(id).slice(0, 16),
    CallDateTime: utc(when),
    CallAssignment: assignment,
    GroupCode: null,
    CallType: forceType || (isIvr ? 'Telephony' : (isMobile ? 'Mobile' : 'Other')),
    ProcedureCode: b.serviceCode,
    ClientIdentifierOnCall: digitsOnly(b.medicaidId) || null,
    MobileLogin: isMobile ? String(digitsOnly(b.workerId)).slice(0, 64) : null,
    CallLatitude: isMobile ? Number(loc.lat) : null,
    CallLongitude: isMobile ? Number(loc.lng) : null,
    OriginatingPhoneNumber: isIvr ? digitsOnly(b.originPhone).slice(-10) : null,
    VisitLocationType: null,
  };
  return call;
}

// ── client payload (spec sections 3.2-3.5) ───────────────────────────────────
//
// c = clients row (+ payer join fields sandata_payer_id/sandata_payer_program,
// default_service_code), sequence, providerId, includePayerSegment (only for
// members without a prior authorization).
function buildClientPayload(c, { providerId, sequence, includePayerSegment = false } = {}) {
  const maId = digitsOnly(c.medicaid_id);
  const payload = {
    ProviderIdentification: {
      ProviderQualifier: 'MedicaidID',
      ProviderID: String(providerId),
    },
    ClientFirstName: specName(c.first_name),
    ClientMiddleInitial: null,
    ClientLastName: specName(c.last_name),
    ClientQualifier: 'ClientCustomID',
    ClientMedicaidID: maId,
    ClientIdentifier: maId,
    SequenceID: sequence,
    ClientCustomID: maId,
    ClientOtherID: maId,
    ClientTimezone: 'US/Central',
  };

  if (includePayerSegment && c.sandata_payer_id && c.sandata_payer_program) {
    payload.ClientPayerInformation = [{
      PayerID: c.sandata_payer_id,
      PayerProgram: c.sandata_payer_program,
      ProcedureCode: c.default_service_code,
      ClientStatus: (c.status || 'active') === 'active' ? '02' : '04',
      EffectiveStartDate: (c.created_at ? new Date(c.created_at) : new Date()).toISOString().slice(0, 10),
    }];
  }
  // WI addendum 2.8 CLIENT RULES: a client without at least one complete
  // address (line 1, city, state, zip) or at least one phone is rejected —
  // so send address/phone whenever we have them, not only with the payer
  // segment (sections 3.4/3.5 call them PA-only; 2.8 is the stricter rule).
  if (c.address && c.city && c.zip) {
    payload.ClientAddress = [{
      ClientAddressType: 'Other',
      ClientAddressIsPrimary: false,
      ClientAddressLine1: String(c.address || '').trim().slice(0, 30),
      ClientAddressLine2: null,
      ClientCounty: null,
      ClientCity: String(c.city || '').trim().slice(0, 30),
      ClientState: (c.state || 'WI').toUpperCase().slice(0, 2),
      ClientZip: specZip(c.zip),
      ClientAddressLongitude: c.longitude != null ? Number(c.longitude) : null,
      ClientAddressLatitude: c.latitude != null ? Number(c.latitude) : null,
    }];
  }
  if (digitsOnly(c.phone).length >= 10) {
    payload.ClientPhone = [{
      ClientPhoneType: 'Other',
      ClientPhone: digitsOnly(c.phone).slice(-10),
    }];
  }

  return payload;
}

module.exports = {
  utc,
  nextSequence,
  normalizeLoc,
  specName,
  specZip,
  digitsOnly,
  MA_ID_RE,
  WORKER_ID_RE,
  validateVisitBundle,
  buildVisitPayload,
  buildClientPayload,
};
