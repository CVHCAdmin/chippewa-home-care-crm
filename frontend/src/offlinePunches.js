// Punches that could not reach the server (no signal at the client's house).
//
// The app promised "Clocked in offline — will sync when reconnected" but nothing
// ever stored the punch: the service worker it relied on no longer intercepts
// fetch (public/sw.js), so a tap with no signal was simply lost. A caregiver's
// 1:10 PM clock-in vanished that way on 2026-09-24.
//
// Now a punch whose request never reached the server is saved here with the TAP
// time and replayed in order (clock-in before its clock-out) until the server
// answers. The server records the tap time and flags the entry for office review.
// Only network failures are saved — a real server answer (like "VA note required")
// is never queued, it is shown to the caregiver as before.

const KEY = 'cvhc_offline_punches_v1';

function readAll() {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) || '[]');
    return Array.isArray(v) ? v : [];
  } catch { return []; }
}
function writeAll(list) {
  try { localStorage.setItem(KEY, JSON.stringify(list)); return true; } catch { return false; }
}

export function newLocalId() {
  try { if (crypto?.randomUUID) return crypto.randomUUID(); } catch { /* older webview */ }
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export function pendingPunches(userId) {
  return readAll().filter(p => p.userId === userId);
}

// Returns false when the phone refused the write (private mode / full storage) —
// the caller must then tell the caregiver the punch was NOT saved.
export function savePunch(punch) {
  const all = readAll();
  all.push(punch);
  return writeAll(all) && readAll().some(p => p.localId === punch.localId);
}

// localId of a synced clock-in → the server entry id it became. A clock-out saved
// just as its clock-in was syncing finds its visit here.
const IDS_KEY = `${KEY}_ids`;
function syncedIds() {
  try { return JSON.parse(localStorage.getItem(IDS_KEY) || '{}') || {}; } catch { return {}; }
}
function rememberSyncedId(localId, entryId) {
  try {
    const ids = syncedIds();
    ids[localId] = entryId;
    const keys = Object.keys(ids);
    if (keys.length > 50) delete ids[keys[0]]; // small, bounded
    localStorage.setItem(IDS_KEY, JSON.stringify(ids));
  } catch { /* best effort */ }
}

function removePunch(localId) {
  writeAll(readAll().filter(p => p.localId !== localId));
}

// The visit a saved clock-in opened, if its clock-out hasn't been saved too.
export function offlineSession(userId) {
  const mine = pendingPunches(userId);
  const ins = mine.filter(p => p.kind === 'in' && !mine.some(o => o.kind === 'out' && o.inLocalId === p.localId));
  const last = ins[ins.length - 1];
  return last ? { id: `offline-${last.localId}`, offline: true, client_id: last.clientId, start_time: last.at } : null;
}

// A fetch that never got a real answer from our server.
export const isUnreachable = (res) => !res || res.status === 0 || res.status === 502 || res.status === 503 || res.status === 504;

let flushing = false;

// Send saved punches in order. Stops at the first one that still can't get through
// (keeps order: a clock-out never goes before its clock-in). Returns
// { sent, rejected: [{ punch, error }] }.
export async function flushPunches({ apiBase, token, userId }) {
  const out = { sent: 0, rejected: [] };
  if (flushing || !token || !userId) return out;
  flushing = true;
  try {
    for (const p of pendingPunches(userId)) {
      // Re-read: an earlier iteration may have filled in this clock-out's entry id.
      const cur = pendingPunches(userId).find(x => x.localId === p.localId);
      if (!cur) continue;
      let url, body;
      if (cur.kind === 'in') {
        url = `${apiBase}/api/time-entries/clock-in`;
        body = { clientId: cur.clientId, latitude: cur.latitude, longitude: cur.longitude, offlineAt: cur.at };
      } else {
        const entryId = cur.entryId || (cur.inLocalId && syncedIds()[cur.inLocalId]);
        if (!entryId) {
          if (pendingPunches(userId).some(x => x.kind === 'in' && x.localId === cur.inLocalId)) break; // clock-in not through yet
          removePunch(cur.localId);
          out.rejected.push({ punch: cur, error: 'its clock-in was never recorded — tell the office your times' });
          continue;
        }
        url = `${apiBase}/api/time-entries/${entryId}/clock-out`;
        body = { latitude: cur.latitude, longitude: cur.longitude, notes: cur.notes, offlineAt: cur.at };
      }
      let res;
      try {
        res = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify(body),
        });
      } catch { break; }                         // still no signal
      if (isUnreachable(res) || res.status === 401 || res.status === 429 || res.status >= 500) break; // try again later
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        if (cur.kind === 'in' && data.id) {
          rememberSyncedId(cur.localId, data.id);
          // Point this visit's saved clock-out (if any) at the real entry.
          const all = readAll().map(x => (x.kind === 'out' && x.inLocalId === cur.localId) ? { ...x, entryId: data.id } : x);
          writeAll(all);
        }
        removePunch(cur.localId);
        out.sent++;
      } else {
        // The server answered and said no (too old, overlaps other time — the office
        // is notified for those). Retrying can't change that; drop it and say so.
        removePunch(cur.localId);
        if (cur.kind === 'in') {
          // Its clock-out can't go anywhere without it.
          writeAll(readAll().filter(x => !(x.kind === 'out' && x.inLocalId === cur.localId)));
        }
        out.rejected.push({ punch: cur, error: data.error || `HTTP ${res.status}` });
      }
    }
  } finally {
    flushing = false;
  }
  return out;
}
