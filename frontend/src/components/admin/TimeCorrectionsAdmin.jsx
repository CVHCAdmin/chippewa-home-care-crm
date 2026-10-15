// TimeCorrectionsAdmin.jsx — the office reviews caregivers' time corrections.
// Each request shows clocked vs scheduled vs requested times, and a location check of the
// GPS the app recorded around those times. Approve rewrites the visit (billing + payroll
// follow the normal clock-out rule); deny sends the caregiver your note.
import { useEffect, useState } from 'react';
import { API_BASE_URL } from '../../config';

const tm = (ts) => ts ? new Date(ts).toLocaleTimeString('en-US', { timeZone: 'America/Chicago', hour: 'numeric', minute: '2-digit' }) : '—';
const day = (ymd) => new Date(ymd + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
const hhmm = (s) => { if (!s) return '—'; const [h, m] = s.split(':').map(Number); return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`; };
const mins = (a, b) => (a && b ? Math.round((new Date(b) - new Date(a)) / 60000) : null);
const hrs = (m) => (m == null ? '' : `${(m / 60).toFixed(2)}h`);
const ft = (f) => (f == null ? '?' : f < 1000 ? `${f} ft` : `${(f / 5280).toFixed(1)} mi`);
const EVV_CODES = [['1', '1 — Caregiver error'], ['2', '2 — Caregiver unable to use device'], ['3', '3 — Device malfunction'], ['4', '4 — Client unable to use device'], ['5', '5 — Other (note required)'], ['7', '7 — Service provided outside the home'], ['8', '8 — Other (note required)']];

function LocationCheck({ id, token }) {
  const [d, setD] = useState(null); const [err, setErr] = useState('');
  useEffect(() => { (async () => {
    const r = await fetch(`${API_BASE_URL}/api/time-corrections/${id}/location`, { headers: { Authorization: `Bearer ${token}` } });
    const j = await r.json().catch(() => ({})); if (r.ok) setD(j); else setErr(j.error || 'Could not load the location check.');
  })(); }, [id, token]);
  if (err) return <div style={{ color: '#B91C1C', fontSize: '0.85rem' }}>{err}</div>;
  if (!d) return <div style={{ fontSize: '0.85rem', color: '#64748B' }}>Checking GPS…</div>;
  const s = d.summary;
  const line = (label, p) => p && <div>{label}: <strong>{ft(p.feet)}</strong> from the client{p.at ? ` at ${tm(p.at)}` : ''}{p.feet != null && p.feet <= d.radius_feet ? ' ✅' : p.feet != null ? ' ⚠️' : ''}</div>;
  const mapUrl = (p) => `https://www.google.com/maps?q=${p.lat},${p.lng}`;
  return (
    <div style={{ fontSize: '0.85rem', background: '#F8FAFC', borderRadius: 8, padding: '0.6rem 0.75rem' }}>
      {!d.client.geocoded && <div style={{ color: '#B45309' }}>⚠ The client's address couldn't be placed on a map, so distances can't be measured. Points are still listed.</div>}
      <div><strong>{s.total_points}</strong> GPS point{s.total_points === 1 ? '' : 's'} recorded from 45 min before to 45 min after the requested times · <strong>{s.points_at_client}</strong> within {d.radius_feet} ft of the client
        {s.points_at_client > 0 && <> (first {tm(s.first_at_client)}, last {tm(s.last_at_client)})</>}</div>
      {line('Nearest to the requested start', s.near_requested_start)}
      {line('Nearest to the requested end', s.near_requested_end)}
      {line('Clock-in', d.clock_in)}
      {line('Clock-out', d.clock_out)}
      {line('Where they sent this request from', d.submitted_from)}
      {s.total_points === 0 && !d.clock_in && !d.submitted_from && <div style={{ color: '#64748B' }}>No location was recorded for these times — the app only records GPS while someone is clocked in.</div>}
      {d.points.length > 0 && <details style={{ marginTop: 4 }}><summary style={{ cursor: 'pointer' }}>All points</summary>
        {d.points.map((p, i) => <div key={i}>{tm(p.at)} — {ft(p.feet)} · <a href={mapUrl(p)} target="_blank" rel="noreferrer">map</a></div>)}
      </details>}
    </div>
  );
}

export default function TimeCorrectionsAdmin({ token }) {
  const [status, setStatus] = useState('pending');
  const [rows, setRows] = useState(null);
  const [msg, setMsg] = useState(null);
  const [busy, setBusy] = useState(null);
  const [notes, setNotes] = useState({});
  const [codes, setCodes] = useState({});
  const [showLoc, setShowLoc] = useState({});
  const auth = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };

  const load = async () => {
    const r = await fetch(`${API_BASE_URL}/api/time-corrections?status=${status}`, { headers: auth });
    const j = await r.json().catch(() => []);
    if (r.ok) setRows(j); else setMsg({ type: 'error', text: j.error || 'Could not load.' });
  };
  useEffect(() => { setRows(null); load(); /* eslint-disable-next-line */ }, [status]);

  const act = async (row, action) => {
    setBusy(row.id); setMsg(null);
    try {
      const body = action === 'approve' ? { note: notes[row.id] || '', evvReasonCode: codes[row.id] || '1' } : { note: notes[row.id] || '' };
      const r = await fetch(`${API_BASE_URL}/api/time-corrections/${row.id}/${action}`, { method: 'POST', headers: auth, body: JSON.stringify(body) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || `${action} failed`);
      setMsg({ type: 'success', text: action === 'approve'
        ? `Approved ${row.caregiver_name} — ${row.client_name}, ${day(row.visit_date)}. If payroll for that week was already generated, click "Generate shifts" again in Payroll.${row.in_sandata ? ' This client is in Sandata — fix the visit in Sandata too.' : ''}`
        : `Denied. ${row.caregiver_name} will see your note.` });
      load();
    } catch (e) { setMsg({ type: 'error', text: e.message }); }
    setBusy(null);
  };

  const colors = { success: ['#ECFDF5', '#047857'], error: ['#FEF2F2', '#B91C1C'] };
  return (
    <div>
      <div style={{ display: 'flex', gap: '0.4rem', marginBottom: '0.75rem' }}>
        {['pending', 'approved', 'denied', 'all'].map(s => (
          <button key={s} onClick={() => setStatus(s)} className={`btn ${status === s ? 'btn-primary' : 'btn-secondary'}`} style={{ textTransform: 'capitalize' }}>{s}</button>
        ))}
      </div>
      {msg && <div style={{ padding: '0.7rem', borderRadius: 8, marginBottom: '0.75rem', background: colors[msg.type][0], color: colors[msg.type][1] }}>{msg.text}</div>}
      {!rows ? <p>Loading…</p> : rows.length === 0 ? <div style={{ padding: '2rem', textAlign: 'center', color: '#6B7280' }}>No {status === 'all' ? '' : status} time corrections.</div> : rows.map(row => {
        const reqMin = mins(row.requested_start, row.requested_end);
        const origMin = mins(row.original_start, row.original_end);
        return (
          <div key={row.id} style={{ border: '1px solid #E2E8F0', borderRadius: 10, padding: '0.85rem', marginBottom: '0.75rem', background: '#fff' }}>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', alignItems: 'baseline' }}>
              <strong>{row.caregiver_name}</strong><span>→ {row.client_name}</span><span style={{ color: '#64748B' }}>· {day(row.visit_date)}</span>
              <span style={{ padding: '1px 8px', borderRadius: 999, background: '#EFF6FF', color: '#1D4ED8', fontSize: '0.78rem', fontWeight: 700 }}>{row.kind === 'missed_visit' ? 'Missed visit' : 'Fix times'}</span>
              {row.in_sandata && <span style={{ padding: '1px 8px', borderRadius: 999, background: '#FEF3C7', color: '#92400E', fontSize: '0.78rem', fontWeight: 700 }}>Sandata client</span>}
              {row.status !== 'pending' && <span style={{ color: '#64748B', fontSize: '0.82rem' }}>· {row.status}{row.reviewer_name ? ` by ${row.reviewer_name}` : ''}</span>}
            </div>
            <table style={{ marginTop: '0.5rem', fontSize: '0.88rem', borderCollapse: 'collapse' }}>
              <tbody>
                <tr><td style={{ color: '#64748B', paddingRight: 12 }}>Scheduled</td><td>{row.scheduled ? `${hhmm(row.scheduled.start)} – ${hhmm(row.scheduled.end)} (${hrs(row.scheduled.minutes)})` : 'No scheduled visit that day'}</td></tr>
                <tr><td style={{ color: '#64748B', paddingRight: 12 }}>Clocked</td><td>{row.kind === 'missed_visit' ? 'Never clocked in' : `${tm(row.original_start)} – ${row.original_end ? tm(row.original_end) : 'never clocked out'}${origMin != null ? ` (${hrs(origMin)})` : ''}`}</td></tr>
                <tr><td style={{ color: '#64748B', paddingRight: 12 }}><strong>Requested</strong></td><td><strong>{tm(row.requested_start)} – {tm(row.requested_end)} ({hrs(reqMin)})</strong></td></tr>
                <tr><td style={{ color: '#64748B', paddingRight: 12 }}>Why</td><td>{row.reason_label}: "{row.note}"</td></tr>
                {row.review_note && <tr><td style={{ color: '#64748B', paddingRight: 12 }}>Office note</td><td>{row.review_note}</td></tr>}
              </tbody>
            </table>
            <button className="btn btn-secondary" style={{ marginTop: '0.5rem', fontSize: '0.82rem' }} onClick={() => setShowLoc({ ...showLoc, [row.id]: !showLoc[row.id] })}>📍 {showLoc[row.id] ? 'Hide' : 'Location check'}</button>
            {showLoc[row.id] && <div style={{ marginTop: '0.5rem' }}><LocationCheck id={row.id} token={token} /></div>}
            {row.status === 'pending' && (
              <div style={{ marginTop: '0.6rem', display: 'flex', flexWrap: 'wrap', gap: '0.5rem', alignItems: 'center' }}>
                <input placeholder="Note (required to deny — the caregiver sees it)" value={notes[row.id] || ''} onChange={e => setNotes({ ...notes, [row.id]: e.target.value })} style={{ flex: 2, minWidth: 220, padding: '0.45rem' }} />
                {row.in_sandata && (
                  <select value={codes[row.id] || '1'} onChange={e => setCodes({ ...codes, [row.id]: e.target.value })} style={{ padding: '0.45rem' }} title="EVV reason code for the time change">
                    {EVV_CODES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                  </select>
                )}
                <button className="btn btn-primary" disabled={busy === row.id} onClick={() => act(row, 'approve')}>✓ Approve</button>
                <button className="btn btn-secondary" disabled={busy === row.id} onClick={() => act(row, 'deny')}>✕ Deny</button>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
