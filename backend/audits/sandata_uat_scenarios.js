// Sandata WI Alt-EVV UAT certification scenarios (vendor portal "Test Scenario
// Validation" list). Synthetic clients/visits only; never reads or writes the DB.
// Payloads are built by the production builder (src/services/sandataPayload.js)
// so what passes here is what the live queue sends.
//
//   node audits/sandata_uat_scenarios.js clients          6 new client records
//   node audits/sandata_uat_scenarios.js clients-update   updates to 3 of them
//   WORKERS=id1,id2,... node audits/sandata_uat_scenarios.js visits
//   WORKERS=...         node audits/sandata_uat_scenarios.js visits-update
//
// Each run prints, per scenario, the UUID to enter in the portal's
// "UUIDs Used for Validation" column. State (sequences, visit times) is kept
// in audits/.sandata_uat_state.json so updates reuse the same record IDs.
const path = require('path');
const fs = require('fs');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const sandata = require('../src/services/sandataClient');
const payloads = require('../src/services/sandataPayload');

const STATE_FILE = path.join(__dirname, '.sandata_uat_state.json');
const cfg = sandata.getConfig();
if (!cfg.isConfigured) { console.error('Sandata not configured'); process.exit(1); }
if (!cfg.baseUrl.includes('uat-api')) { console.error('REFUSING: not pointed at UAT:', cfg.baseUrl); process.exit(1); }

const state = fs.existsSync(STATE_FILE) ? JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')) : { seq: 0, visits: {} };
const save = () => fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
// Strictly increasing, never reused (spec): timestamp form, bumped if needed.
function nextSeq() {
  const ts = Number(new Date().toISOString().replace(/\D/g, '').slice(0, 14));
  state.seq = Math.max(ts, state.seq + 1);
  save();
  return state.seq;
}

const CLIENTS = [1, 2, 3, 4, 5, 6].map(i => ({
  first_name: ['Ann', 'Bea', 'Carl', 'Dora', 'Earl', 'Faye'][i - 1], last_name: 'Cvhctest',
  medicaid_id: `99900000${10 + i}`,
  address: `${100 + i} Test Ave`, city: 'Eau Claire', state: 'WI', zip: '54701',
  phone: `71555501${String(i).padStart(2, '0')}`, latitude: 44.81 + i / 1000, longitude: -91.49 - i / 1000,
  status: 'active', created_at: '2026-11-01T00:00:00Z',
  sandata_payer_id: 'WIFFS', sandata_payer_program: 'FFS', default_service_code: 'T1019',
}));

async function waitStatus(entity, uuid) {
  for (const s of [15, 30, 60, 120]) {
    await new Promise(r => setTimeout(r, s * 1000));
    const st = await sandata.getStatus(entity, uuid);
    if (st.ready) return st;
  }
  return { ready: false };
}

async function send(entity, label, records) {
  const r = await sandata.postRecords(entity, records);
  let verdict, detail = '';
  if (!r.ok) { verdict = `HTTP ${r.status}`; detail = JSON.stringify(r.data).slice(0, 400); }
  else if (r.rejected) { verdict = 'REJECTED at intake'; detail = r.rejects.map(x => `${x.RecordOtherID}: ${x.Reason}`).join(' | '); }
  else {
    const st = await waitStatus(entity, r.uuid);
    verdict = !st.ready ? 'still processing' : st.accepted ? 'ACCEPTED' : 'REJECTED';
    if (st.ready && !st.accepted) detail = st.rejects.map(x => `${x.RecordOtherID}: ${x.Reason}`).join(' | ');
  }
  console.log(`\n[${verdict}] ${label}\n  UUID: ${r.uuid}${detail ? `\n  ${detail}` : ''}`);
  return { uuid: r.uuid, verdict };
}

// ── visits ──────────────────────────────────────────────────────────────────
const hrs = (base, h) => new Date(base.getTime() + h * 3600e3);
const GPS = (c) => ({ lat: c.latitude, lng: c.longitude });

function visitDefs(workers) {
  const w = (i) => workers[i % workers.length];
  const day = (n) => { const d = new Date(); d.setUTCDate(d.getUTCDate() - n); d.setUTCHours(14, 0, 0, 0); return d; };
  const at = (id, by = 'office@chippewavalleyhomecare.com') => ({ changed_by_label: by, changed_at: new Date(Date.now() - 3600e3).toISOString(), resolution_code: '1', _id: id });
  return {
    V1: { label: 'Mobile Time In + Time Out', client: 0, worker: w(0), start: day(6), end: hrs(day(6), 2), inLoc: 'gps', outLoc: 'gps' },
    V2: { label: 'Telephony Time In + Time Out', client: 3, worker: w(1), start: day(5), end: hrs(day(5), 2), ivr: true },
    V3: { label: 'Manual Time In + Time Out (VisitChanges)', client: 2, worker: w(2), start: day(4), end: hrs(day(4), 3),
          changes: [{ ...at(1), old_start: null, new_start: day(4).toISOString(), old_end: null, new_end: hrs(day(4), 3).toISOString(), reason_code: 3, memo: null }] },
    V4: { label: 'Other Time In + Time Out', client: 1, worker: w(3), start: day(3), end: hrs(day(3), 2) },
    V5: { label: 'Mixed: Mobile Time In + Manual Time Out, with Exception Acknowledgement', client: 4, worker: w(4), start: day(2), end: hrs(day(2), 4), inLoc: 'gps',
          changes: [{ ...at(2), old_start: null, new_start: null, old_end: null, new_end: hrs(day(2), 4).toISOString(), reason_code: 1, memo: null }],
          exceptionAck: { code: '4', acknowledged: true } },
    V6: { label: 'Mobile visit #2', client: 5, worker: w(5), start: day(1), end: hrs(day(1), 2), inLoc: 'gps', outLoc: 'gps' },
  };
}

function buildVisit(key, d, seq, overrides = {}) {
  const c = CLIENTS[d.client];
  return payloads.buildVisitPayload({
    providerId: cfg.providerId, visitOtherId: `CVHCUAT${key}`, sequence: seq,
    workerId: d.worker, medicaidId: c.medicaid_id, payerId: 'WIFFS', payerProgram: 'FFS', serviceCode: 'T1019',
    startTime: new Date(d.start), endTime: new Date(d.end),
    clockInLoc: d.inLoc ? GPS(c) : null, clockOutLoc: d.outLoc ? GPS(c) : null,
    originPhone: d.ivr ? c.phone : null,
    changes: d.changes || [], exceptionAck: d.exceptionAck || null, cancelled: false,
    ...overrides,
  });
}

(async () => {
  const step = process.argv[2];
  const results = [];
  if (step === 'clients') {
    const seq = nextSeq();
    const recs = CLIENTS.map((c, i) => payloads.buildClientPayload(c, { providerId: cfg.providerId, sequence: seq + i, includePayerSegment: true }));
    state.seq = seq + CLIENTS.length; save();
    results.push(await send('clients', 'Scenario: at least 6 Client records', recs));
  } else if (step === 'clients-update') {
    const seq = nextSeq();
    const recs = CLIENTS.slice(0, 3).map((c, i) => payloads.buildClientPayload(
      { ...c, address: `${900 + i} Updated St`, phone: `71555509${i}0` },
      { providerId: cfg.providerId, sequence: seq + i, includePayerSegment: true }));
    state.seq = seq + 3; save();
    results.push(await send('clients', 'Scenario: updates to at least 3 Client records (new address + phone)', recs));
  } else if (step === 'visits' || step === 'visits-update') {
    const workers = String(process.env.WORKERS || '').split(',').map(s => s.trim()).filter(Boolean);
    if (!workers.length) { console.error('Set WORKERS=<comma-separated test EmployeeIdentifiers from Program Resources>'); process.exit(1); }
    const defs = visitDefs(workers);
    if (step === 'visits') {
      for (const [k, d] of Object.entries(defs)) {
        state.visits[k] = d; save();
        results.push(await send('visits', `${k} ${d.label}`, buildVisit(k, d, nextSeq())));
      }
    } else {
      const v = state.visits;
      if (!v.V1) { console.error('Run "visits" first'); process.exit(1); }
      // V1: original Mobile calls already sent -> now corrected times (AdjIn/AdjOut + VisitChanges)
      const v1 = { ...v.V1, changes: [{ changed_by_label: 'office@chippewavalleyhomecare.com', changed_at: new Date().toISOString(),
        old_start: v.V1.start, new_start: hrs(new Date(v.V1.start), 0.25).toISOString(),
        old_end: v.V1.end, new_end: hrs(new Date(v.V1.end), 0.25).toISOString(), reason_code: 1, memo: null, resolution_code: '1' }] };
      results.push(await send('visits', 'V1 update: adjusted in + adjusted out times', buildVisit('V1', v1, nextSeq())));
      results.push(await send('visits', 'V4 update: BillVisit = false', buildVisit('V4', v.V4, nextSeq(), { billVisit: false })));
      // V6: caregiver left later than punched — adjusted out time only
      const v6 = { ...v.V6, changes: [{ changed_by_label: 'office@chippewavalleyhomecare.com', changed_at: new Date().toISOString(),
        old_start: null, new_start: null, old_end: v.V6.end, new_end: hrs(new Date(v.V6.end), 0.5).toISOString(),
        reason_code: 3, memo: null, resolution_code: '1' }] };
      results.push(await send('visits', 'V6 update: adjusted out time', buildVisit('V6', v6, nextSeq())));
    }
  } else {
    console.error('usage: clients | clients-update | visits | visits-update'); process.exit(1);
  }
  console.log('\nSummary:'); results.forEach(r => console.log(`  ${r.verdict}  ${r.uuid}`));
})().catch(e => { console.error('ERROR', e); process.exit(1); });
