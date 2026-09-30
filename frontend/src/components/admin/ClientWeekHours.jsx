// src/components/admin/ClientWeekHours.jsx
// Who was at each client, and when — one Sunday–Saturday week at a time, every
// scheduled visit beside its actual clock-in/out. Built for entering MIDAS hours.
// Read-only: corrections are made in Payroll → Shift Review and shown here.
import React, { useState, useEffect, useCallback } from 'react';
import { API_BASE_URL } from '../../config';
import { cancelReasonLabel } from '../../utils/cancelReasons';

// Sunday of the week containing `d` (local date), as YYYY-MM-DD.
const sundayOf = (d) => { const x = new Date(d); x.setHours(12, 0, 0, 0); x.setDate(x.getDate() - x.getDay()); return x.toLocaleDateString('en-CA'); };
const addDays = (ymd, n) => { const x = new Date(`${ymd}T12:00:00`); x.setDate(x.getDate() + n); return x.toLocaleDateString('en-CA'); };
const dayLabel = (ymd) => new Date(`${ymd}T12:00:00`).toLocaleDateString('en-US', { weekday: 'short', month: 'numeric', day: 'numeric' });
const hm = (t) => { if (!t) return ''; const [h, m] = String(t).split(':').map(Number); return `${h % 12 === 0 ? 12 : h % 12}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`; };
const clock = (iso) => iso ? new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'America/Chicago' }) : '';
const hrs = (m) => m == null ? '' : (m / 60).toFixed(2);
// Payroll's correction for a shift (Payroll → Shift Review), in plain words.
const payrollText = (p) => {
  if (!p) return '';
  const h = p.payable_minutes != null ? `${(p.payable_minutes / 60).toFixed(2)} h` : '';
  const head = p.kind === 'manual' ? `✏️ Paid ${h} (manual entry)`
    : p.kind === 'excused' ? '🚫 Excused — not paid'
    : p.kind === 'paid_no_clock_in' ? `✅ Paid ${h}, no clock-in`
    : p.kind === 'adjusted' ? `✏️ Paid ${h}`
    : '';
  return [head, p.note].filter(Boolean).join(' — ');
};
const FLAG_LABELS = { offline_punch: 'saved offline', admin_force_clockout: 'office clock-out', excessive_duration: 'very long punch', zero_duration: 'accidental tap' };

const ClientWeekHours = ({ token }) => {
  const [weekStart, setWeekStart] = useState(sundayOf(new Date(Date.now() - 7 * 86400000))); // last full week
  const [clientId, setClientId] = useState('');
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const r = await fetch(`${API_BASE_URL}/api/reports/client-week?weekStart=${weekStart}`, { headers: { Authorization: `Bearer ${token}` } });
      const body = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(body.error || `HTTP ${r.status}`);
      setData(body);
    } catch (e) { setError(e.message); setData(null); }
    setLoading(false);
  }, [weekStart, token]);

  useEffect(() => { load(); }, [load]);

  const clients = data ? data.clients : [];
  const shown = clientId ? clients.filter(c => c.client_id === clientId) : clients;

  return (
    <div className="client-week-hours">
      <style>{`@media print { .cwh-controls { display: none !important; } .cwh-client { break-inside: avoid; } }`}</style>
      <h2 style={{ marginTop: 0 }}>🗓️ Client Hours by Week</h2>
      <p className="text-muted" style={{ marginTop: 0 }}>Who was at each client and when — scheduled visits beside the actual clock-in and clock-out, Sunday to Saturday.</p>

      <div className="card cwh-controls" style={{ display: 'flex', gap: '0.75rem', alignItems: 'center', flexWrap: 'wrap' }}>
        <button type="button" className="btn btn-sm btn-secondary" onClick={() => setWeekStart(addDays(weekStart, -7))}>← Prev week</button>
        <strong>{dayLabel(weekStart)} – {dayLabel(addDays(weekStart, 6))}</strong>
        <button type="button" className="btn btn-sm btn-secondary" onClick={() => setWeekStart(addDays(weekStart, 7))}>Next week →</button>
        <input type="date" value={weekStart} onChange={e => e.target.value && setWeekStart(sundayOf(new Date(`${e.target.value}T12:00:00`)))}
          title="Pick any day — the page shows that day's Sunday–Saturday week" />
        <select value={clientId} onChange={e => setClientId(e.target.value)} style={{ minWidth: 200 }}>
          <option value="">All clients ({clients.length})</option>
          {clients.map(c => <option key={c.client_id} value={c.client_id}>{c.name}</option>)}
        </select>
        <button type="button" className="btn btn-sm btn-secondary" onClick={() => window.print()}>🖨️ Print</button>
      </div>

      {loading && <div className="card">Loading…</div>}
      {error && <div className="card" style={{ background: '#FEE2E2', color: '#991B1B', fontWeight: 600 }}>Could not load this week: {error}</div>}
      {!loading && !error && data && shown.length === 0 && <div className="card">No visits or clock-ins this week.</div>}

      {!loading && shown.map(c => (
        <div key={c.client_id} className="card cwh-client" style={{ maxWidth: 'none' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', flexWrap: 'wrap', gap: '0.5rem' }}>
            <h3 style={{ margin: 0 }}>{c.name}{c.is_private_pay && <span style={{ fontSize: '0.75rem', color: '#6B7280', fontWeight: 400 }}> · private pay</span>}</h3>
            <div style={{ fontSize: '0.9rem' }}>
              Scheduled <strong>{hrs(c.scheduled_minutes)} h</strong> · Clocked <strong>{hrs(c.clocked_minutes)} h</strong>
              {c.missing_clock_ins > 0 && <span style={{ color: '#B45309' }}> · {c.missing_clock_ins} with no clock-in</span>}
            </div>
          </div>
          <div style={{ overflowX: 'auto' }}>
            <table className="table" style={{ fontSize: '0.86rem', marginTop: '0.5rem' }}>
              <thead><tr><th>Day</th><th>Caregiver</th><th>Scheduled</th><th>Clocked in – out</th><th style={{ textAlign: 'right' }}>Sched h</th><th style={{ textAlign: 'right' }}>Clocked h</th><th>Note</th><th>Payroll</th></tr></thead>
              <tbody>
                {c.rows.map((r, i) => {
                  const diff = r.type === 'visit' && r.clocked_minutes != null ? r.clocked_minutes - r.sched_minutes : null;
                  const note = r.type === 'cancelled' ? `Cancelled — ${cancelReasonLabel(r.cancel_reason)}`
                    : r.type === 'unscheduled' ? 'Not on the schedule'
                    : !r.clock_in ? 'No clock-in'
                    : r.clock_in && !r.clock_out ? 'Still clocked in'
                    : '';
                  const flags = (r.flags || []).map(f => FLAG_LABELS[f]).filter(Boolean);
                  return (
                    <tr key={i} style={{ background: r.type === 'cancelled' ? '#F9FAFB' : undefined, color: r.type === 'cancelled' ? '#6B7280' : undefined }}>
                      <td>{dayLabel(r.day)}</td>
                      <td>{r.caregiver_name}{r.is_training && <span style={{ color: '#6B7280' }}> (training)</span>}</td>
                      <td>{r.sched_start ? `${hm(r.sched_start)} – ${hm(r.sched_end)}` : '—'}</td>
                      <td>{r.clock_in ? `${clock(r.clock_in)} – ${r.clock_out ? clock(r.clock_out) : '…'}` : '—'}</td>
                      <td style={{ textAlign: 'right' }}>{r.type === 'visit' ? hrs(r.sched_minutes) : ''}</td>
                      <td style={{ textAlign: 'right', color: diff == null ? undefined : diff > 7 ? '#B45309' : diff < -7 ? '#B91C1C' : undefined }}>{hrs(r.clocked_minutes)}</td>
                      <td style={{ color: note === 'No clock-in' || note === 'Not on the schedule' ? '#B45309' : '#6B7280' }}>
                        {[note, ...flags].filter(Boolean).join(' · ')}
                      </td>
                      <td style={{ color: r.payroll && (r.payroll.kind === 'manual' || r.payroll.kind === 'adjusted') ? '#1D4ED8' : r.payroll && r.payroll.kind === 'excused' ? '#991B1B' : '#374151', fontWeight: r.payroll && r.payroll.kind !== 'paid_no_clock_in' ? 600 : 400 }}>
                        {payrollText(r.payroll)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      ))}
    </div>
  );
};

export default ClientWeekHours;
