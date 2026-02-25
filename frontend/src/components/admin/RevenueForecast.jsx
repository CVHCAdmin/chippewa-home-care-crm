// RevenueForecast.jsx — projected vs actual revenue, auth utilization, weekly outlook

import { useState, useEffect } from 'react';

const API = import.meta.env.VITE_API_URL || '';

const fmt$ = (n) => '$' + parseFloat(n || 0).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
const fmtH = (n) => parseFloat(n || 0).toFixed(1) + 'h';

export default function RevenueForecast({ token }) {
  const [data, setData] = useState(null);
  const [utilData, setUtilData] = useState([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState('overview');
  const [months, setMonths] = useState(3);

  const h = { Authorization: `Bearer ${token}` };

  const load = async () => {
    setLoading(true);
    try {
      const [fR, uR] = await Promise.all([
        fetch(`${API}/api/forecast/revenue?months=${months}`, { headers: h }),
        fetch(`${API}/api/forecast/caregiver-utilization`, { headers: h }),
      ]);
      setData(await fR.json());
      setUtilData(await uR.json());
    } catch (e) {}
    setLoading(false);
  };

  useEffect(() => { load(); }, [months]);

  const tabStyle = (t) => ({ padding: '0.5rem 1rem', border: 'none', borderBottom: `3px solid ${tab === t ? '#3B82F6' : 'transparent'}`, background: 'none', cursor: 'pointer', fontWeight: tab === t ? 700 : 400, color: tab === t ? '#1D4ED8' : '#6B7280', fontSize: '0.92rem' });

  const barWidth = (val, max) => `${Math.min((parseFloat(val || 0) / Math.max(parseFloat(max || 1), 1)) * 100, 100)}%`;

  if (loading) return <div style={{ textAlign: 'center', padding: '4rem', color: '#9CA3AF' }}>Loading forecast data...</div>;

  const summary = data?.authSummary || {};
  const actual = data?.actual || [];
  const projected = data?.projected || [];
  const weekly = data?.weekly || [];
  const topClients = data?.topClients || [];

  const totalActualBilled = actual.reduce((s, r) => s + parseFloat(r.billed || 0), 0);
  const totalActualCollected = actual.reduce((s, r) => s + parseFloat(r.collected || 0), 0);
  const totalProjectedRemaining = parseFloat(summary.total_projected_remaining || 0);
  const nextWeek = weekly[0] || {};

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.25rem', flexWrap: 'wrap', gap: '0.5rem' }}>
        <h2 style={{ margin: 0 }}>📈 Revenue Forecast</h2>
        <div style={{ display: 'flex', gap: '0.4rem', alignItems: 'center' }}>
          <span style={{ fontSize: '0.85rem', color: '#6B7280' }}>History:</span>
          {[1, 3, 6].map(m => (
            <button key={m} onClick={() => setMonths(m)}
              style={{ padding: '0.3rem 0.7rem', borderRadius: '20px', border: `1px solid ${months === m ? '#3B82F6' : '#E5E7EB'}`, background: months === m ? '#3B82F6' : '#fff', color: months === m ? '#fff' : '#374151', cursor: 'pointer', fontSize: '0.82rem', fontWeight: months === m ? 700 : 400 }}>
              {m}mo
            </button>
          ))}
          <button onClick={load} style={{ padding: '0.35rem 0.75rem', borderRadius: '8px', border: '1px solid #E5E7EB', background: '#fff', color: '#374151', cursor: 'pointer', fontSize: '0.82rem' }}>↻</button>
        </div>
      </div>

      {/* KPI summary row */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '0.75rem', marginBottom: '1.5rem' }}>
        {[
          { label: `Billed (${months}mo)`, val: fmt$(totalActualBilled), sub: `${fmt$(totalActualCollected)} collected`, color: '#3B82F6', bg: '#EFF6FF' },
          { label: 'Projected Remaining', val: fmt$(totalProjectedRemaining), sub: `From ${summary.total_active_auths || 0} active auths`, color: '#10B981', bg: '#D1FAE5' },
          { label: 'Auth Utilization', val: `${summary.avg_utilization_pct || 0}%`, sub: `${fmtH(summary.total_used_hours)} / ${fmtH(summary.total_auth_hours)} hrs`, color: '#F59E0B', bg: '#FFFBEB' },
          { label: 'Est. Next Week', val: fmt$(nextWeek.estimated_revenue || 0), sub: `${fmtH(nextWeek.scheduled_hours)} scheduled`, color: '#8B5CF6', bg: '#F5F3FF' },
        ].map(k => (
          <div key={k.label} style={{ background: k.bg, borderRadius: '10px', padding: '1rem 1.1rem', border: `1px solid ${k.color}28` }}>
            <div style={{ fontSize: '0.75rem', color: '#6B7280', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '0.3rem' }}>{k.label}</div>
            <div style={{ fontSize: '1.6rem', fontWeight: 800, color: k.color, lineHeight: 1 }}>{k.val}</div>
            <div style={{ fontSize: '0.75rem', color: '#6B7280', marginTop: '0.3rem' }}>{k.sub}</div>
          </div>
        ))}
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', borderBottom: '2px solid #E5E7EB', marginBottom: '1.25rem' }}>
        <button style={tabStyle('overview')} onClick={() => setTab('overview')}>📊 Monthly History</button>
        <button style={tabStyle('weekly')} onClick={() => setTab('weekly')}>📅 4-Week Outlook</button>
        <button style={tabStyle('auths')} onClick={() => setTab('auths')}>📋 Authorizations</button>
        <button style={tabStyle('clients')} onClick={() => setTab('clients')}>👤 Top Clients</button>
        <button style={tabStyle('staff')} onClick={() => setTab('staff')}>🧑‍⚕️ Staff Utilization</button>
      </div>

      {tab === 'overview' && (
        <div>
          <h4 style={{ margin: '0 0 1rem', color: '#374151' }}>Billed vs Collected — Last {months} Month{months > 1 ? 's' : ''}</h4>
          {actual.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '3rem', color: '#9CA3AF', background: '#F9FAFB', borderRadius: '10px', border: '2px dashed #E5E7EB' }}>
              No billing data for this period. Billing data will appear here once claims are submitted.
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
              {actual.map((row, i) => {
                const billed = parseFloat(row.billed || 0);
                const collected = parseFloat(row.collected || 0);
                const maxBilled = Math.max(...actual.map(r => parseFloat(r.billed || 0)), 1);
                const collRate = billed > 0 ? Math.round((collected / billed) * 100) : 0;
                const period = new Date(row.period).toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
                return (
                  <div key={i} style={{ background: '#fff', border: '1px solid #E5E7EB', borderRadius: '10px', padding: '1rem' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.6rem' }}>
                      <span style={{ fontWeight: 700, fontSize: '0.95rem' }}>{period}</span>
                      <div style={{ display: 'flex', gap: '1.25rem', fontSize: '0.85rem' }}>
                        <span style={{ color: '#3B82F6', fontWeight: 700 }}>Billed: {fmt$(billed)}</span>
                        <span style={{ color: '#10B981', fontWeight: 700 }}>Collected: {fmt$(collected)}</span>
                        <span style={{ color: collRate >= 90 ? '#10B981' : collRate >= 70 ? '#F59E0B' : '#EF4444', fontWeight: 700 }}>{collRate}% rate</span>
                        <span style={{ color: '#9CA3AF' }}>{row.claim_count} claims</span>
                      </div>
                    </div>
                    <div style={{ height: '8px', background: '#F3F4F6', borderRadius: '4px', overflow: 'hidden' }}>
                      <div style={{ height: '100%', width: barWidth(billed, maxBilled), background: '#BFDBFE', borderRadius: '4px', position: 'relative', transition: 'width 0.3s' }}>
                        <div style={{ position: 'absolute', top: 0, left: 0, height: '100%', width: barWidth(collected, billed), background: '#3B82F6', borderRadius: '4px' }} />
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {tab === 'weekly' && (
        <div>
          <h4 style={{ margin: '0 0 1rem', color: '#374151' }}>Next 4 Weeks — Projected Revenue from Scheduled Shifts</h4>
          {weekly.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '3rem', color: '#9CA3AF', background: '#F9FAFB', borderRadius: '10px', border: '2px dashed #E5E7EB' }}>
              No scheduled shifts found for the next 4 weeks.
            </div>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: '0.75rem' }}>
              {weekly.map((w, i) => {
                const weekStart = new Date(w.week_start);
                const weekEnd = new Date(weekStart); weekEnd.setDate(weekEnd.getDate() + 6);
                const label = weekStart.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) + ' – ' + weekEnd.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
                return (
                  <div key={i} style={{ background: i === 0 ? '#EFF6FF' : '#fff', border: `1px solid ${i === 0 ? '#BFDBFE' : '#E5E7EB'}`, borderRadius: '10px', padding: '1rem', textAlign: 'center' }}>
                    {i === 0 && <div style={{ fontSize: '0.72rem', color: '#1D4ED8', fontWeight: 700, textTransform: 'uppercase', marginBottom: '0.35rem' }}>This Week</div>}
                    <div style={{ fontSize: '0.75rem', color: '#6B7280', marginBottom: '0.5rem' }}>{label}</div>
                    <div style={{ fontSize: '1.5rem', fontWeight: 800, color: '#1D4ED8' }}>{fmt$(w.estimated_revenue)}</div>
                    <div style={{ fontSize: '0.78rem', color: '#6B7280', marginTop: '0.3rem' }}>{fmtH(w.scheduled_hours)} · {w.shift_count} shifts · {w.caregiver_count} caregivers</div>
                  </div>
                );
              })}
            </div>
          )}
          <div style={{ marginTop: '1rem', padding: '0.75rem 1rem', background: '#FFFBEB', border: '1px solid #FCD34D', borderRadius: '8px', fontSize: '0.8rem', color: '#92400E' }}>
            💡 Estimated at $18.50/hr average rate. Actual revenue depends on payer rates and billing outcomes.
          </div>
        </div>
      )}

      {tab === 'auths' && (
        <div>
          <h4 style={{ margin: '0 0 1rem', color: '#374151' }}>Active Authorization Remaining Value</h4>
          {projected.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '3rem', color: '#9CA3AF', background: '#F9FAFB', borderRadius: '10px', border: '2px dashed #E5E7EB' }}>
              No active authorizations with remaining hours.
            </div>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
                <thead>
                  <tr style={{ background: '#F9FAFB', borderBottom: '2px solid #E5E7EB' }}>
                    {['Client','Service','Auth Hrs','Used Hrs','Remaining','Rate','Projected $','Expires'].map(c => (
                      <th key={c} style={{ textAlign: 'left', padding: '0.65rem 0.85rem', fontWeight: 700, color: '#374151', fontSize: '0.8rem', whiteSpace: 'nowrap' }}>{c}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {projected.map((r, i) => {
                    const pct = r.authorized_hours > 0 ? Math.round((r.used_hours / r.authorized_hours) * 100) : 0;
                    return (
                      <tr key={i} style={{ borderBottom: '1px solid #F3F4F6', background: i % 2 === 0 ? '#fff' : '#FAFAFA' }}>
                        <td style={{ padding: '0.65rem 0.85rem', fontWeight: 600 }}>{r.client_name}</td>
                        <td style={{ padding: '0.65rem 0.85rem', color: '#6B7280' }}>{r.service_type?.replace(/_/g,' ')}</td>
                        <td style={{ padding: '0.65rem 0.85rem' }}>{fmtH(r.authorized_hours)}</td>
                        <td style={{ padding: '0.65rem 0.85rem' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                            {fmtH(r.used_hours)}
                            <div style={{ width: '50px', height: '6px', background: '#E5E7EB', borderRadius: '3px', overflow: 'hidden' }}>
                              <div style={{ width: `${pct}%`, height: '100%', background: pct > 90 ? '#EF4444' : pct > 70 ? '#F59E0B' : '#10B981' }} />
                            </div>
                            <span style={{ fontSize: '0.72rem', color: '#9CA3AF' }}>{pct}%</span>
                          </div>
                        </td>
                        <td style={{ padding: '0.65rem 0.85rem', fontWeight: 700, color: '#10B981' }}>{fmtH(r.remaining_hours)}</td>
                        <td style={{ padding: '0.65rem 0.85rem', color: '#6B7280' }}>{r.hourly_rate ? fmt$(r.hourly_rate) + '/hr' : '—'}</td>
                        <td style={{ padding: '0.65rem 0.85rem', fontWeight: 700, color: '#3B82F6' }}>{fmt$(r.projected_remaining_revenue)}</td>
                        <td style={{ padding: '0.65rem 0.85rem', color: new Date(r.end_date) < new Date(Date.now() + 30*86400000) ? '#EF4444' : '#6B7280', fontSize: '0.82rem' }}>
                          {r.end_date ? new Date(r.end_date + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '—'}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot>
                  <tr style={{ borderTop: '2px solid #E5E7EB', background: '#F9FAFB' }}>
                    <td colSpan={6} style={{ padding: '0.65rem 0.85rem', fontWeight: 700, textAlign: 'right' }}>Total Projected:</td>
                    <td style={{ padding: '0.65rem 0.85rem', fontWeight: 800, color: '#3B82F6', fontSize: '1rem' }}>{fmt$(totalProjectedRemaining)}</td>
                    <td />
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
        </div>
      )}

      {tab === 'clients' && (
        <div>
          <h4 style={{ margin: '0 0 1rem', color: '#374151' }}>Top Clients by Revenue — Last 90 Days</h4>
          {topClients.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '3rem', color: '#9CA3AF', background: '#F9FAFB', borderRadius: '10px', border: '2px dashed #E5E7EB' }}>No billing data in the last 90 days.</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
              {topClients.map((c, i) => {
                const maxBilled = parseFloat(topClients[0]?.total_billed || 1);
                return (
                  <div key={i} style={{ background: '#fff', border: '1px solid #E5E7EB', borderRadius: '10px', padding: '1rem' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
                      <span style={{ fontWeight: 700 }}>{i + 1}. {c.client_name}</span>
                      <div style={{ display: 'flex', gap: '1rem', fontSize: '0.85rem' }}>
                        <span style={{ fontWeight: 700, color: '#3B82F6' }}>{fmt$(c.total_billed)}</span>
                        <span style={{ color: '#10B981' }}>Collected: {fmt$(c.total_collected)}</span>
                        <span style={{ color: '#9CA3AF' }}>{c.claim_count} claims</span>
                      </div>
                    </div>
                    <div style={{ height: '6px', background: '#F3F4F6', borderRadius: '3px', overflow: 'hidden' }}>
                      <div style={{ height: '100%', width: barWidth(c.total_billed, maxBilled), background: '#3B82F6', borderRadius: '3px' }} />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {tab === 'staff' && (
        <div>
          <h4 style={{ margin: '0 0 1rem', color: '#374151' }}>Caregiver Weekly Utilization</h4>
          {utilData.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '3rem', color: '#9CA3AF', background: '#F9FAFB', borderRadius: '10px', border: '2px dashed #E5E7EB' }}>No utilization data.</div>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
                <thead>
                  <tr style={{ background: '#F9FAFB', borderBottom: '2px solid #E5E7EB' }}>
                    {['Caregiver','Type','Clients','Weekly Hrs','Est. Weekly Rev','Utilization'].map(c => (
                      <th key={c} style={{ textAlign: 'left', padding: '0.65rem 0.85rem', fontWeight: 700, color: '#374151', fontSize: '0.8rem' }}>{c}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {utilData.map((u, i) => {
                    const hrs = parseFloat(u.weekly_hours || 0);
                    const maxHrs = parseFloat(utilData[0]?.weekly_hours || 40);
                    const pct = Math.min(Math.round((hrs / 40) * 100), 100);
                    return (
                      <tr key={i} style={{ borderBottom: '1px solid #F3F4F6', background: i % 2 === 0 ? '#fff' : '#FAFAFA' }}>
                        <td style={{ padding: '0.65rem 0.85rem', fontWeight: 600 }}>{u.caregiver_name}</td>
                        <td style={{ padding: '0.65rem 0.85rem', color: '#6B7280', fontSize: '0.8rem' }}>{u.employment_type || 'staff'}</td>
                        <td style={{ padding: '0.65rem 0.85rem' }}>{u.client_count || 0}</td>
                        <td style={{ padding: '0.65rem 0.85rem', fontWeight: 700 }}>{fmtH(hrs)}</td>
                        <td style={{ padding: '0.65rem 0.85rem', color: '#3B82F6', fontWeight: 700 }}>{fmt$(u.weekly_revenue)}</td>
                        <td style={{ padding: '0.65rem 0.85rem' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                            <div style={{ width: '80px', height: '8px', background: '#E5E7EB', borderRadius: '4px', overflow: 'hidden' }}>
                              <div style={{ width: `${pct}%`, height: '100%', background: pct >= 90 ? '#EF4444' : pct >= 70 ? '#F59E0B' : '#10B981', borderRadius: '4px' }} />
                            </div>
                            <span style={{ fontSize: '0.78rem', color: '#6B7280' }}>{pct}%</span>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
