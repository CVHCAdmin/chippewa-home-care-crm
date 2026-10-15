// TimeCorrections.jsx — caregiver asks the office to fix a past visit's times, or to add a
// visit they never clocked into. Current and last pay week only. Nothing changes until the
// office approves (Shift Approvals → Time Corrections).
import { useEffect, useState } from 'react';
import { API_BASE_URL } from '../../config';

// A timestamp → "YYYY-MM-DDTHH:MM" in Central time, for <input type="datetime-local">.
const toLocalInput = (ts) => {
  if (!ts) return '';
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: 'America/Chicago', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
    .formatToParts(new Date(ts)).map(x => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`;
};
const fmtTime = (ts) => ts ? new Date(ts).toLocaleTimeString('en-US', { timeZone: 'America/Chicago', hour: 'numeric', minute: '2-digit' }) : '—';
const fmtDay = (ymd) => new Date(ymd + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
const STATUS = { pending: ['Waiting on the office', '#B45309', '#FEF3C7'], approved: ['Approved', '#047857', '#ECFDF5'], denied: ['Not approved', '#B91C1C', '#FEF2F2'], cancelled: ['Cancelled', '#64748B', '#F1F5F9'] };

// Location at submit time is extra evidence for the office. Never wait long for it.
const quickLocation = () => new Promise(resolve => {
  if (!navigator.geolocation) return resolve(null);
  const done = setTimeout(() => resolve(null), 6000);
  navigator.geolocation.getCurrentPosition(
    p => { clearTimeout(done); resolve({ latitude: p.coords.latitude, longitude: p.coords.longitude, accuracy: p.coords.accuracy }); },
    () => { clearTimeout(done); resolve(null); },
    { enableHighAccuracy: false, timeout: 5500, maximumAge: 120000 });
});

export default function TimeCorrections({ token, clients = [] }) {
  const [data, setData] = useState(null);
  const [form, setForm] = useState(null);   // { timeEntryId?, clientId?, start, end, reason, note, title }
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [ok, setOk] = useState('');
  const auth = { Authorization: `Bearer ${token}` };

  const load = async () => {
    try {
      const r = await fetch(`${API_BASE_URL}/api/time-corrections/my`, { headers: auth });
      const j = await r.json().catch(() => null);
      if (r.ok) setData(j); else setErr((j && j.error) || 'Could not load your visits.');
    } catch { setErr('No connection — try again when you have signal.'); }
  };
  useEffect(() => { load(); /* eslint-disable-next-line */ }, []);

  const pendingFor = (entryId) => data && data.requests.find(r => r.time_entry_id === entryId && r.status === 'pending');

  const openFix = (v) => { setOk(''); setErr(''); setForm({ timeEntryId: v.id, title: `${v.client_name} · ${fmtDay(v.visit_date)}`, start: toLocalInput(v.start_time), end: toLocalInput(v.end_time || new Date()), reason: v.end_time ? 'wrong_times' : 'forgot_clock_out', note: '' }); };
  const openMissed = () => { setOk(''); setErr(''); setForm({ clientId: '', title: 'Add a visit I didn\'t clock into', start: '', end: '', reason: 'forgot_clock_in', note: '' }); };

  const submit = async () => {
    setErr('');
    if (!form.timeEntryId && !form.clientId) return setErr('Pick the client.');
    if (!form.start || !form.end) return setErr('Enter the start and end times.');
    if (form.end <= form.start) return setErr('The end time must be after the start time.');
    if (String(form.note || '').trim().length < 3) return setErr('Add a short note about what happened.');
    setBusy(true);
    try {
      const loc = await quickLocation();
      const r = await fetch(`${API_BASE_URL}/api/time-corrections`, {
        method: 'POST', headers: { ...auth, 'Content-Type': 'application/json' },
        body: JSON.stringify({ timeEntryId: form.timeEntryId, clientId: form.clientId, start: form.start, end: form.end, reason: form.reason, note: form.note, ...(loc || {}) }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || 'Could not send — try again.');
      setForm(null); setOk('Sent to the office. You\'ll see here when it\'s approved.');
      load();
    } catch (e) { setErr(e.message); }
    setBusy(false);
  };

  const cancel = async (id) => {
    const r = await fetch(`${API_BASE_URL}/api/time-corrections/${id}/cancel`, { method: 'POST', headers: auth });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) setErr(j.error || 'Could not cancel.'); else load();
  };

  const input = { width: '100%', padding: '0.55rem', fontSize: '1rem', border: '1px solid #CBD5E1', borderRadius: 8, boxSizing: 'border-box' };
  const label = { display: 'block', fontSize: '0.82rem', fontWeight: 700, color: '#334155', margin: '0.6rem 0 0.2rem' };

  return (
    <div className="card" style={{ marginBottom: '1rem' }}>
      <div className="card-title">🕐 Fix my times</div>
      <p style={{ fontSize: '0.85rem', color: '#64748B', marginTop: 0 }}>Forgot to clock in or out, or the times are wrong? Send the office your real times. Only this week and last week. Nothing changes until the office approves.</p>
      {ok && <div style={{ padding: '0.6rem', background: '#ECFDF5', color: '#047857', borderRadius: 8, marginBottom: '0.6rem', fontSize: '0.9rem' }}>{ok}</div>}
      {err && !form && <div style={{ padding: '0.6rem', background: '#FEF2F2', color: '#B91C1C', borderRadius: 8, marginBottom: '0.6rem', fontSize: '0.9rem' }}>{err}</div>}

      {form ? (
        <div style={{ border: '1px solid #E2E8F0', borderRadius: 10, padding: '0.8rem' }}>
          <strong>{form.title}</strong>
          {!form.timeEntryId && (<>
            <label style={label}>Client</label>
            <select style={input} value={form.clientId} onChange={e => setForm({ ...form, clientId: e.target.value })}>
              <option value="">Pick a client…</option>
              {clients.map(c => <option key={c.id} value={c.id}>{c.first_name} {c.last_name}</option>)}
            </select>
          </>)}
          <label style={label}>Real start time</label>
          <input type="datetime-local" style={input} value={form.start} onChange={e => setForm({ ...form, start: e.target.value })} />
          <label style={label}>Real end time</label>
          <input type="datetime-local" style={input} value={form.end} onChange={e => setForm({ ...form, end: e.target.value })} />
          <label style={label}>What happened?</label>
          <select style={input} value={form.reason} onChange={e => setForm({ ...form, reason: e.target.value })}>
            {Object.entries((data && data.reasons) || {}).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
          <label style={label}>Note for the office</label>
          <textarea style={{ ...input, minHeight: 70 }} value={form.note} placeholder="e.g. Phone died at 10:30, I left at 11:00." onChange={e => setForm({ ...form, note: e.target.value })} />
          {err && <div style={{ marginTop: '0.6rem', padding: '0.6rem', background: '#FEF2F2', color: '#B91C1C', borderRadius: 8, fontSize: '0.9rem' }}>{err}</div>}
          <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.8rem' }}>
            <button className="btn btn-primary" style={{ flex: 1 }} disabled={busy} onClick={submit}>{busy ? 'Sending…' : 'Send to office'}</button>
            <button className="btn btn-secondary" disabled={busy} onClick={() => { setForm(null); setErr(''); }}>Cancel</button>
          </div>
        </div>
      ) : (
        <>
          <button className="btn btn-secondary" style={{ width: '100%', marginBottom: '0.75rem' }} onClick={openMissed}>＋ Add a visit I didn't clock into</button>
          {!data ? <p className="text-muted">Loading…</p> : data.visits.length === 0 ? <p className="text-muted">No visits this week or last week.</p> : (
            <div>
              {data.visits.map(v => {
                const pend = pendingFor(v.id);
                return (
                  <div key={v.id} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.5rem 0', borderTop: '1px solid #F1F5F9' }}>
                    <div style={{ flex: 1, fontSize: '0.9rem' }}>
                      <strong>{fmtDay(v.visit_date)}</strong> · {v.client_name}
                      <div style={{ color: '#64748B', fontSize: '0.82rem' }}>{fmtTime(v.start_time)} – {v.end_time ? fmtTime(v.end_time) : 'still clocked in'}</div>
                    </div>
                    {pend ? <span style={{ fontSize: '0.78rem', color: '#B45309', fontWeight: 700 }}>⏳ Sent</span>
                      : <button className="btn btn-secondary" style={{ fontSize: '0.82rem' }} onClick={() => openFix(v)}>Fix times</button>}
                  </div>
                );
              })}
            </div>
          )}
          {data && data.requests.length > 0 && (
            <div style={{ marginTop: '0.75rem' }}>
              <div style={{ fontWeight: 700, fontSize: '0.88rem', marginBottom: '0.3rem' }}>My requests</div>
              {data.requests.map(r => {
                const [txt, color, bg] = STATUS[r.status];
                return (
                  <div key={r.id} style={{ padding: '0.5rem', borderRadius: 8, background: bg, marginBottom: '0.4rem', fontSize: '0.85rem' }}>
                    <div><strong>{fmtDay(r.visit_date)}</strong> · {r.client_name} · {fmtTime(r.requested_start)}–{fmtTime(r.requested_end)}</div>
                    <div style={{ color, fontWeight: 700 }}>{txt}{r.review_note ? ` — ${r.review_note}` : ''}</div>
                    {r.status === 'pending' && <button className="btn btn-secondary" style={{ fontSize: '0.78rem', marginTop: 4 }} onClick={() => cancel(r.id)}>Cancel request</button>}
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}
    </div>
  );
}
