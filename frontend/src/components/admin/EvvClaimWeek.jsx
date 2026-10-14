// EvvClaimWeek.jsx — MIDAS claim days per My Choice client for one Sun–Sat week.
// For each day: S5125 attendant-care (EVV) units — from the visits that went through
// Sandata, capped at the client's weekly EVV allowance — and S5130 homemaker units.
// The Sandata visits are already in Sandata (caregivers check in on the app); this page
// is what the office needs to key the MIDAS claim, with the visit times as backup.
import { useState, useEffect } from 'react';
import { API_BASE_URL } from '../../config';

// Sunday of the last full week, as YYYY-MM-DD (local date, no UTC shift).
const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const lastFullWeekSunday = () => { const d = new Date(); d.setHours(12, 0, 0, 0); d.setDate(d.getDate() - d.getDay() - 7); return ymd(d); };
const shiftWeek = (ws, n) => { const d = new Date(ws + 'T12:00:00'); d.setDate(d.getDate() + 7 * n); return ymd(d); };
const dayLabel = (s) => new Date(s + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'numeric', day: 'numeric' });
const hrs = (u) => `${(u * 0.25).toFixed(2).replace(/\.?0+$/, '')}h`;

export default function EvvClaimWeek({ token }) {
  const [weekStart, setWeekStart] = useState(lastFullWeekSunday());
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [open, setOpen] = useState({});

  const load = async () => {
    setLoading(true); setError('');
    try {
      const r = await fetch(`${API_BASE_URL}/api/billing/evv-claim-week?weekStart=${weekStart}`, { headers: { Authorization: `Bearer ${token}` } });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || `Failed to load (${r.status})`);
      setData(j);
    } catch (e) { setError(e.message); setData(null); }
    setLoading(false);
  };
  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [weekStart]);

  const downloadCsv = () => {
    if (!data) return;
    const q = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const rows = [['Client', 'Medicaid ID', 'MCO Member ID', 'Date', 'Procedure', 'Description', 'Units', 'Hours']];
    for (const c of data.clients) {
      for (const d of c.days) {
        if (d.evvUnits > 0) rows.push([c.client_name, c.medicaid_id, c.mco_member_id, d.date, 'S5125', 'Attendant care (EVV)', d.evvUnits, d.evvUnits * 0.25]);
        if (d.homemakerUnits > 0) rows.push([c.client_name, c.medicaid_id, c.mco_member_id, d.date, 'S5130', 'Homemaker', d.homemakerUnits, d.homemakerUnits * 0.25]);
      }
    }
    const blob = new Blob([rows.map(r => r.map(q).join(',')).join('\r\n')], { type: 'text/csv' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `midas-claim-days_${data.week_start}_to_${data.week_end}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const totals = data ? data.clients.reduce((t, c) => ({ evv: t.evv + c.totals.evvUnits, hm: t.hm + c.totals.homemakerUnits, pending: t.pending + c.pending_approval }), { evv: 0, hm: 0, pending: 0 }) : null;
  const th = { textAlign: 'left', padding: '0.4rem 0.6rem', fontSize: '0.8rem', color: '#475569', borderBottom: '1px solid #E2E8F0' };
  const td = { padding: '0.4rem 0.6rem', fontSize: '0.88rem', borderBottom: '1px solid #F1F5F9' };

  return (
    <div style={{ padding: '1rem', maxWidth: 1000 }}>
      <h2 style={{ marginBottom: '0.25rem' }}>MIDAS Claim Days (EVV / Homemaker)</h2>
      <p style={{ color: '#64748B', marginTop: 0, fontSize: '0.9rem' }}>
        Per My Choice client, per day: <strong>S5125</strong> attendant-care units (from visits that went through Sandata, capped at the weekly EVV units) and <strong>S5130</strong> homemaker units (everything else). 1 unit = 15 min, rounded per day.
      </p>

      <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap', margin: '1rem 0' }}>
        <button className="btn btn-secondary" onClick={() => setWeekStart(shiftWeek(weekStart, -1))}>← Prev week</button>
        <strong>{data ? `${dayLabel(data.week_start)} – ${dayLabel(data.week_end)}` : weekStart}</strong>
        <button className="btn btn-secondary" onClick={() => setWeekStart(shiftWeek(weekStart, 1))}>Next week →</button>
        <span style={{ flex: 1 }} />
        <button className="btn btn-secondary" onClick={() => window.print()} disabled={!data}>🖨 Print</button>
        <button className="btn btn-primary" onClick={downloadCsv} disabled={!data || !data.clients.length}>⬇ CSV for MIDAS</button>
      </div>

      {loading && <p>Loading…</p>}
      {error && <div style={{ padding: '0.75rem', background: '#FEF2F2', color: '#B91C1C', borderRadius: 8 }}>{error}</div>}

      {data && !loading && (
        <>
          <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap', marginBottom: '1rem' }}>
            <div style={{ padding: '0.6rem 1rem', background: '#EFF6FF', borderRadius: 8 }}>S5125 EVV: <strong>{totals.evv} units</strong> ({hrs(totals.evv)})</div>
            <div style={{ padding: '0.6rem 1rem', background: '#F0FDF4', borderRadius: 8 }}>S5130 Homemaker: <strong>{totals.hm} units</strong> ({hrs(totals.hm)})</div>
            {totals.pending > 0 && <div style={{ padding: '0.6rem 1rem', background: '#FEF3C7', borderRadius: 8 }}>⚠ {totals.pending} visit{totals.pending === 1 ? '' : 's'} still in Shift Approvals — review before claiming</div>}
          </div>

          {data.clients.length === 0 && <p>No My Choice visits this week.</p>}

          {data.clients.map(c => (
            <div key={c.client_id} style={{ border: '1px solid #E2E8F0', borderRadius: 10, marginBottom: '1rem', overflow: 'hidden', breakInside: 'avoid' }}>
              <div style={{ padding: '0.6rem 0.9rem', background: '#F8FAFC', display: 'flex', flexWrap: 'wrap', gap: '0.75rem', alignItems: 'baseline' }}>
                <strong style={{ fontSize: '1rem' }}>{c.client_name}</strong>
                {c.medicaid_id && <span style={{ color: '#64748B', fontSize: '0.82rem' }}>MA {c.medicaid_id}</span>}
                <span style={{ flex: 1 }} />
                <span style={{ fontSize: '0.88rem' }}>
                  EVV <strong>{c.totals.evvUnits}</strong>{c.totals.evvAuthorizedUnits != null ? ` of ${c.totals.evvAuthorizedUnits}` : ''} u · Homemaker <strong>{c.totals.homemakerUnits}</strong> u
                </span>
                {!c.in_sandata && <span style={{ fontSize: '0.78rem', color: '#64748B' }}>(not a Sandata client)</span>}
                {c.in_sandata && c.totals.evvAuthorizedUnits == null && <span style={{ fontSize: '0.78rem', color: '#B45309' }}>⚠ no EVV units entered — all Sandata time counted as EVV</span>}
                {c.in_sandata && c.totals.evvAuthorizedUnits != null && c.totals.evvUnits < c.totals.evvAuthorizedUnits && <span style={{ fontSize: '0.78rem', color: '#B45309' }}>⚠ under authorized EVV units</span>}
              </div>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr><th style={th}>Day</th><th style={th}>S5125 EVV units</th><th style={th}>S5130 Homemaker units</th><th style={th}>Visits</th></tr>
                </thead>
                <tbody>
                  {c.days.map(d => (
                    <tr key={d.date}>
                      <td style={td}>{dayLabel(d.date)}</td>
                      <td style={td}>{d.evvUnits || '—'}</td>
                      <td style={td}>{d.homemakerUnits || '—'}</td>
                      <td style={{ ...td, fontSize: '0.8rem', color: '#475569' }}>
                        {d.visits.map(v => (
                          <div key={v.id}>
                            {v.clock_in}–{v.clock_out} · {v.caregiver} · {v.minutes} min
                            {v.sentToSandata ? ' · Sandata' : ''}
                            {v.needs_approval && <span style={{ color: '#B45309' }}> · ⚠ needs approval</span>}
                          </div>
                        ))}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}
        </>
      )}
    </div>
  );
}
