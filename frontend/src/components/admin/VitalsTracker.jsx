// VitalsTracker — record + view vitals per client.
// Drop-in panel; expects token + clientId. Quick-entry form at top,
// history table below with simple trend hint per metric (▲/▼/–).

import React, { useState, useEffect, useCallback } from 'react';
import { API_BASE_URL } from '../../config';

const FIELDS = [
  { key: 'systolicBp',       label: 'Systolic',  unit: 'mmHg', dbKey: 'systolic_bp',        type: 'integer', range: [50, 260] },
  { key: 'diastolicBp',      label: 'Diastolic', unit: 'mmHg', dbKey: 'diastolic_bp',       type: 'integer', range: [25, 160] },
  { key: 'pulse',            label: 'Pulse',     unit: 'bpm',  dbKey: 'pulse',              type: 'integer', range: [25, 220] },
  { key: 'respirations',     label: 'Resp',      unit: '/min', dbKey: 'respirations',       type: 'integer', range: [4, 70] },
  { key: 'oxygenSaturation', label: 'O₂ Sat',    unit: '%',    dbKey: 'oxygen_saturation',  type: 'integer', range: [50, 100] },
  { key: 'temperatureF',     label: 'Temp',      unit: '°F',   dbKey: 'temperature_f',      type: 'decimal', range: [85, 112] },
  { key: 'bloodGlucose',     label: 'Glucose',   unit: 'mg/dL',dbKey: 'blood_glucose',      type: 'integer', range: [20, 800] },
  { key: 'weightLbs',        label: 'Weight',    unit: 'lbs',  dbKey: 'weight_lbs',         type: 'decimal', range: [30, 800] },
  { key: 'painScale',        label: 'Pain',      unit: '0-10', dbKey: 'pain_scale',         type: 'integer', range: [0, 10] },
];

export default function VitalsTracker({ token, clientId, timeEntryId }) {
  const [form, setForm] = useState({});
  const [painLocation, setPainLocation] = useState('');
  const [notes, setNotes] = useState('');
  const [history, setHistory] = useState([]);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);

  const hdr = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };

  const load = useCallback(async () => {
    if (!clientId) return;
    try {
      const r = await fetch(`${API_BASE_URL}/api/medications/vitals/client/${clientId}?limit=30`, { headers: hdr });
      if (r.ok) setHistory(await r.json());
    } catch (e) { /* ignore */ }
  }, [clientId, token]);

  useEffect(() => { load(); }, [load]);

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true); setMsg(null);
    try {
      const body = { clientId, timeEntryId, painLocation: painLocation || null, notes: notes || null };
      FIELDS.forEach(f => { if (form[f.key] !== '' && form[f.key] != null) body[f.key] = form[f.key]; });
      const r = await fetch(`${API_BASE_URL}/api/medications/vitals`, {
        method: 'POST', headers: hdr, body: JSON.stringify(body),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || `Request failed (${r.status})`);
      setMsg({ kind: 'ok', text: 'Vitals recorded' });
      setForm({}); setPainLocation(''); setNotes('');
      load();
    } catch (err) {
      setMsg({ kind: 'err', text: err.message });
    } finally { setBusy(false); }
  };

  // trend: compare latest two entries for a given field
  const trendFor = (dbKey) => {
    const values = history.map(h => h[dbKey]).filter(v => v != null && v !== '');
    if (values.length < 2) return null;
    const a = parseFloat(values[0]); const b = parseFloat(values[1]);
    if (isNaN(a) || isNaN(b)) return null;
    if (a === b) return { arrow: '→', color: '#9CA3AF' };
    return a > b ? { arrow: '▲', color: '#DC2626' } : { arrow: '▼', color: '#0891B2' };
  };

  const inp = { padding: '0.4rem 0.5rem', border: '1px solid #D1D5DB', borderRadius: 6, fontSize: '0.9rem', width: '100%' };
  const card = { background: '#fff', borderRadius: 10, padding: '1rem', boxShadow: '0 1px 2px rgba(0,0,0,0.04)' };

  return (
    <div style={{ display: 'grid', gap: '1rem' }}>
      <div style={card}>
        <h3 style={{ margin: '0 0 0.5rem', fontSize: '1rem' }}>📋 Record Vitals</h3>
        {msg && (
          <div style={{
            padding: '0.5rem 0.75rem', borderRadius: 6, marginBottom: '0.5rem', fontSize: '0.85rem',
            background: msg.kind === 'ok' ? '#D1FAE5' : '#FEE2E2',
            color: msg.kind === 'ok' ? '#065F46' : '#991B1B',
          }}>{msg.text}</div>
        )}
        <form onSubmit={submit}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '0.75rem', marginBottom: '0.75rem' }}>
            {FIELDS.map(f => (
              <div key={f.key}>
                <label style={{ display: 'block', fontSize: '0.72rem', fontWeight: 700, color: '#6B7280', marginBottom: 2 }}>
                  {f.label} <span style={{ fontWeight: 400 }}>({f.unit})</span>
                </label>
                <input
                  type="number" step={f.type === 'decimal' ? '0.1' : '1'}
                  min={f.range[0]} max={f.range[1]}
                  value={form[f.key] ?? ''}
                  onChange={(e) => setForm({ ...form, [f.key]: e.target.value })}
                  style={inp}
                />
              </div>
            ))}
            <div>
              <label style={{ display: 'block', fontSize: '0.72rem', fontWeight: 700, color: '#6B7280', marginBottom: 2 }}>
                Pain Location
              </label>
              <input type="text" value={painLocation} onChange={(e) => setPainLocation(e.target.value)}
                placeholder="lower back, knee, etc."
                style={inp} />
            </div>
          </div>
          <div style={{ marginBottom: '0.5rem' }}>
            <label style={{ display: 'block', fontSize: '0.72rem', fontWeight: 700, color: '#6B7280', marginBottom: 2 }}>Notes</label>
            <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2}
              placeholder="Anything notable — symptoms, refusal, position, etc."
              style={{ ...inp, fontFamily: 'inherit' }} />
          </div>
          <button type="submit" disabled={busy} style={{
            background: '#2ABBA7', color: '#fff', border: 'none', borderRadius: 6,
            padding: '0.55rem 1.25rem', fontSize: '0.9rem', fontWeight: 700, cursor: busy ? 'wait' : 'pointer',
          }}>
            {busy ? 'Saving…' : '💾 Record Vitals'}
          </button>
        </form>
      </div>

      <div style={card}>
        <h3 style={{ margin: '0 0 0.5rem', fontSize: '1rem' }}>📊 Recent Vitals ({history.length})</h3>
        {history.length === 0 ? (
          <p style={{ color: '#9CA3AF', fontSize: '0.9rem' }}>No vitals recorded yet.</p>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.82rem' }}>
              <thead>
                <tr style={{ background: '#F9FAFB' }}>
                  <th style={{ padding: '0.45rem 0.6rem', textAlign: 'left', fontWeight: 700 }}>When</th>
                  {FIELDS.map(f => {
                    const trend = trendFor(f.dbKey);
                    return (
                      <th key={f.key} style={{ padding: '0.45rem 0.6rem', textAlign: 'right', fontWeight: 700 }}>
                        {f.label}
                        {trend && <span style={{ marginLeft: 4, color: trend.color }}>{trend.arrow}</span>}
                      </th>
                    );
                  })}
                  <th style={{ padding: '0.45rem 0.6rem', textAlign: 'left' }}>By</th>
                </tr>
              </thead>
              <tbody>
                {history.map(h => (
                  <tr key={h.id} style={{ borderTop: '1px solid #F3F4F6' }}>
                    <td style={{ padding: '0.4rem 0.6rem', whiteSpace: 'nowrap' }}>
                      {new Date(h.recorded_at).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
                    </td>
                    {FIELDS.map(f => (
                      <td key={f.key} style={{ padding: '0.4rem 0.6rem', textAlign: 'right' }}>
                        {h[f.dbKey] != null && h[f.dbKey] !== '' ? h[f.dbKey] : '—'}
                      </td>
                    ))}
                    <td style={{ padding: '0.4rem 0.6rem' }}>
                      {h.caregiver_first ? `${h.caregiver_first} ${h.caregiver_last?.[0] || ''}.` : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
