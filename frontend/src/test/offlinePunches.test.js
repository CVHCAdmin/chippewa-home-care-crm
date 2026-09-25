// Offline punch store — a tap with no signal must be saved with its real time and
// sent later in order; a punch must never be lost silently or sent twice.
import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import { savePunch, pendingPunches, offlineSession, flushPunches, isUnreachable } from '../offlinePunches';

const U = 'user-1';
const api = 'https://api.test';
const ok = (body, status = 200) => ({ ok: true, status, json: async () => body });
const no = (body, status) => ({ ok: false, status, json: async () => body });

beforeEach(() => { localStorage.clear(); });
afterEach(() => { vi.unstubAllGlobals(); });

describe('offline punches', () => {
  test('saved clock-in shows as the in-progress visit at the tap time', () => {
    expect(savePunch({ userId: U, localId: 'a', kind: 'in', at: '2026-09-24T18:10:00.000Z', clientId: 'kathy' })).toBe(true);
    expect(offlineSession(U)).toEqual({ id: 'offline-a', offline: true, client_id: 'kathy', start_time: '2026-09-24T18:10:00.000Z' });
    savePunch({ userId: U, localId: 'b', kind: 'out', at: '2026-09-24T23:00:00.000Z', inLocalId: 'a', entryId: null });
    expect(offlineSession(U)).toBeNull(); // clocked out too
    expect(offlineSession('someone-else')).toBeNull();
  });

  test('sends clock-in first, then its clock-out against the new entry id, with tap times', async () => {
    savePunch({ userId: U, localId: 'a', kind: 'in', at: 'T-IN', clientId: 'kathy' });
    savePunch({ userId: U, localId: 'b', kind: 'out', at: 'T-OUT', inLocalId: 'a', entryId: null, notes: 'n' });
    const fetch = vi.fn()
      .mockResolvedValueOnce(ok({ id: 'entry-9' }, 201))
      .mockResolvedValueOnce(ok({}));
    vi.stubGlobal('fetch', fetch);
    const r = await flushPunches({ apiBase: api, token: 't', userId: U });
    expect(r.sent).toBe(2);
    expect(fetch.mock.calls[0][0]).toBe(`${api}/api/time-entries/clock-in`);
    expect(JSON.parse(fetch.mock.calls[0][1].body).offlineAt).toBe('T-IN');
    expect(fetch.mock.calls[1][0]).toBe(`${api}/api/time-entries/entry-9/clock-out`);
    expect(JSON.parse(fetch.mock.calls[1][1].body)).toMatchObject({ offlineAt: 'T-OUT', notes: 'n' });
    expect(pendingPunches(U)).toHaveLength(0);
  });

  test('still no signal: keeps everything, sends nothing out of order', async () => {
    savePunch({ userId: U, localId: 'a', kind: 'in', at: 'T', clientId: 'c' });
    savePunch({ userId: U, localId: 'b', kind: 'out', at: 'T2', inLocalId: 'a', entryId: null });
    const fetch = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'));
    vi.stubGlobal('fetch', fetch);
    const r = await flushPunches({ apiBase: api, token: 't', userId: U });
    expect(r.sent).toBe(0);
    expect(fetch).toHaveBeenCalledTimes(1); // stopped at the clock-in
    expect(pendingPunches(U)).toHaveLength(2);
  });

  test('server down (502) or session expired (401) is retried later, not dropped', async () => {
    savePunch({ userId: U, localId: 'a', kind: 'in', at: 'T', clientId: 'c' });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(no({}, 502)));
    await flushPunches({ apiBase: api, token: 't', userId: U });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(no({}, 401)));
    await flushPunches({ apiBase: api, token: 't', userId: U });
    expect(pendingPunches(U)).toHaveLength(1);
  });

  test('server says no (e.g. overlap): dropped with the reason, and its clock-out with it', async () => {
    savePunch({ userId: U, localId: 'a', kind: 'in', at: 'T', clientId: 'c' });
    savePunch({ userId: U, localId: 'b', kind: 'out', at: 'T2', inLocalId: 'a', entryId: null });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(no({ error: 'overlaps', code: 'offline_conflict' }, 409)));
    const r = await flushPunches({ apiBase: api, token: 't', userId: U });
    expect(r.rejected).toHaveLength(1);
    expect(r.rejected[0].error).toBe('overlaps');
    expect(pendingPunches(U)).toHaveLength(0);
  });

  test('clock-out saved just after its clock-in synced still finds the visit', async () => {
    savePunch({ userId: U, localId: 'a', kind: 'in', at: 'T', clientId: 'c' });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(ok({ id: 'entry-7' }, 201)));
    await flushPunches({ apiBase: api, token: 't', userId: U });
    savePunch({ userId: U, localId: 'b', kind: 'out', at: 'T2', inLocalId: 'a', entryId: null });
    const fetch = vi.fn().mockResolvedValue(ok({}));
    vi.stubGlobal('fetch', fetch);
    const r = await flushPunches({ apiBase: api, token: 't', userId: U });
    expect(r.sent).toBe(1);
    expect(fetch.mock.calls[0][0]).toBe(`${api}/api/time-entries/entry-7/clock-out`);
  });

  test('unreachable = no response or gateway errors only', () => {
    expect(isUnreachable(null)).toBe(true);
    expect(isUnreachable({ status: 503 })).toBe(true);
    expect(isUnreachable({ status: 400 })).toBe(false);
    expect(isUnreachable({ status: 201 })).toBe(false);
  });
});
