// NoShowAlerts.jsx — monitor + configure automated no-show detection

import { useState, useEffect } from 'react';

const API = import.meta.env.VITE_API_URL || '';

export default function NoShowAlerts({ token }) {
  const [alerts, setAlerts] = useState([]);
  const [stats, setStats] = useState({});
  const [config, setConfig] = useState({ grace_minutes: 15, notify_admin: true, notify_caregiver: true, notify_client_family: false, admin_phone: '', admin_email: '', is_active: true });
  const [tab, setTab] = useState('alerts');
  const [filter, setFilter] = useState('open');
  const [loading, setLoading] = useState(true);
  const [checking, setChecking] = useState(false);
  const [savingConfig, setSavingConfig] = useState(false);
  const [resolveModal, setResolveModal] = useState(null);
  const [resolveNote, setResolveNote] = useState('');
  const [msg, setMsg] = useState('');

  const h = { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` };
  const flash = (m, ok = true) => { setMsg({ text: m, ok }); setTimeout(() => setMsg(''), 3500); };

  const load = async () => {
    setLoading(true);
    try {
      const [aR, sR, cR] = await Promise.all([
        fetch(`${API}/api/no-show/alerts?status=${filter}&limit=100`, { headers: h }),
        fetch(`${API}/api/no-show/stats`, { headers: h }),
        fetch(`${API}/api/no-show/config`, { headers: h }),
      ]);
      setAlerts(await aR.json());
      setStats(await sR.json());
      const cfg = await cR.json();
      if (cfg && cfg.grace_minutes) setConfig(cfg);
    } catch (e) {}
    setLoading(false);
  };

  useEffect(() => { load(); }, [filter]);

  const runCheck = async () => {
    setChecking(true);
    try {
      const r = await fetch(`${API}/api/no-show/run-check`, { method: 'POST', headers: h });
      const data = await r.json();
      flash(`✓ Check complete — ${data.alerts} new alert${data.alerts !== 1 ? 's' : ''} created (${data.checked} shifts checked)`);
      load();
    } catch (e) { flash('Check failed', false); }
    setChecking(false);
  };

  const resolve = async (id, status) => {
    try {
      await fetch(`${API}/api/no-show/alerts/${id}/resolve`, {
        method: 'PUT', headers: h,
        body: JSON.stringify({ resolutionNote: resolveNote, status })
      });
      flash('Resolved');
      setResolveModal(null);
      setResolveNote('');
      load();
    } catch (e) { flash('Error', false); }
  };

  const saveConfig = async () => {
    setSavingConfig(true);
    try {
      await fetch(`${API}/api/no-show/config`, {
        method: 'PUT', headers: h,
        body: JSON.stringify({
          graceMinutes: config.grace_minutes,
          notifyAdmin: config.notify_admin,
          notifyCaregiver: config.notify_caregiver,
          notifyClientFamily: config.notify_client_family,
          adminPhone: config.admin_phone,
          adminEmail: config.admin_email,
          isActive: config.is_active
        })
      });
      flash('Settings saved');
    } catch (e) { flash('Error saving', false); }
    setSavingConfig(false);
  };

  const tabStyle = (t) => ({
    padding: '0.5rem 1rem', border: 'none', borderBottom: `3px solid ${tab === t ? '#3B82F6' : 'transparent'}`,
    background: 'none', cursor: 'pointer', fontWeight: tab === t ? 700 : 400,
    color: tab === t ? '#1D4ED8' : '#6B7280', fontSize: '0.92rem'
  });

  const statusBadge = (s) => {
    const map = { open: ['#FEF2F2','#DC2626'], resolved: ['#D1FAE5','#059669'], false_alarm: ['#F3F4F6','#6B7280'] };
    const [bg, color] = map[s] || ['#F3F4F6','#6B7280'];
    return <span style={{ background: bg, color, padding: '0.15rem 0.55rem', borderRadius: '12px', fontSize: '0.75rem', fontWeight: 700 }}>{s.replace('_', ' ')}</span>;
  };

  return (
    <div>
      {msg && <div style={{ position: 'fixed', top: '1rem', right: '1rem', background: msg.ok ? '#D1FAE5' : '#FEE2E2', color: msg.ok ? '#065F46' : '#991B1B', padding: '0.75rem 1.25rem', borderRadius: '8px', zIndex: 9999, fontWeight: 600, boxShadow: '0 4px 12px rgba(0,0,0,0.15)' }}>{msg.text}</div>}

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.25rem', flexWrap: 'wrap', gap: '0.75rem' }}>
        <h2 style={{ margin: 0 }}>🚨 No-Show Alerts</h2>
        <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
          <span style={{ fontSize: '0.82rem', color: config.is_active ? '#10B981' : '#EF4444', fontWeight: 600 }}>
            {config.is_active ? '● Active' : '○ Disabled'}
          </span>
          <button onClick={runCheck} disabled={checking}
            style={{ padding: '0.5rem 1.1rem', borderRadius: '8px', border: 'none', background: '#3B82F6', color: '#fff', cursor: 'pointer', fontWeight: 600, fontSize: '0.88rem', opacity: checking ? 0.7 : 1 }}>
            {checking ? '⏳ Checking...' : '▶ Run Check Now'}
          </button>
        </div>
      </div>

      {/* Stats row */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '0.75rem', marginBottom: '1.5rem' }}>
        {[
          { label: 'Open Alerts', val: stats.open_count || 0, color: '#EF4444', bg: '#FEF2F2' },
          { label: 'Today', val: stats.today_count || 0, color: '#F59E0B', bg: '#FFFBEB' },
          { label: 'This Week', val: stats.week_count || 0, color: '#3B82F6', bg: '#EFF6FF' },
          { label: 'Resolved', val: stats.resolved_count || 0, color: '#10B981', bg: '#D1FAE5' },
        ].map(s => (
          <div key={s.label} style={{ background: s.bg, borderRadius: '10px', padding: '1rem', textAlign: 'center', border: `1px solid ${s.color}28` }}>
            <div style={{ fontSize: '1.75rem', fontWeight: 800, color: s.color }}>{s.val}</div>
            <div style={{ fontSize: '0.78rem', color: '#6B7280', fontWeight: 600, marginTop: '0.2rem' }}>{s.label}</div>
          </div>
        ))}
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', borderBottom: '2px solid #E5E7EB', marginBottom: '1.25rem' }}>
        <button style={tabStyle('alerts')} onClick={() => setTab('alerts')}>🚨 Alerts</button>
        <button style={tabStyle('settings')} onClick={() => setTab('settings')}>⚙️ Settings</button>
      </div>

      {tab === 'alerts' && (
        <>
          <div style={{ display: 'flex', gap: '0.4rem', marginBottom: '1rem', flexWrap: 'wrap' }}>
            {['open','resolved','false_alarm','all'].map(s => (
              <button key={s} onClick={() => setFilter(s)}
                style={{ padding: '0.35rem 0.85rem', borderRadius: '20px', border: `1px solid ${filter === s ? '#3B82F6' : '#E5E7EB'}`,
                  background: filter === s ? '#3B82F6' : '#fff', color: filter === s ? '#fff' : '#374151',
                  cursor: 'pointer', fontSize: '0.82rem', fontWeight: filter === s ? 700 : 400 }}>
                {s.replace('_', ' ')}
              </button>
            ))}
          </div>

          {loading ? <div style={{ textAlign: 'center', padding: '3rem', color: '#9CA3AF' }}>Loading...</div>
          : alerts.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '3rem', color: '#9CA3AF', background: '#F9FAFB', borderRadius: '10px', border: '2px dashed #E5E7EB' }}>
              <div style={{ fontSize: '2.5rem', marginBottom: '0.5rem' }}>✅</div>
              <div style={{ fontWeight: 600 }}>No {filter !== 'all' ? filter : ''} alerts</div>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
              {alerts.map(a => (
                <div key={a.id} style={{ background: '#fff', border: `1px solid ${a.status === 'open' ? '#FCA5A5' : '#E5E7EB'}`, borderLeft: `4px solid ${a.status === 'open' ? '#EF4444' : '#10B981'}`, borderRadius: '8px', padding: '1rem', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '0.75rem' }}>
                  <div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.35rem', flexWrap: 'wrap' }}>
                      <span style={{ fontWeight: 700, fontSize: '0.95rem' }}>{a.caregiver_name || 'Unknown'}</span>
                      <span style={{ color: '#6B7280', fontSize: '0.82rem' }}>→ {a.client_name || 'Unknown client'}</span>
                      {statusBadge(a.status)}
                    </div>
                    <div style={{ fontSize: '0.82rem', color: '#6B7280' }}>
                      Shift: {a.shift_date} at {a.expected_start?.slice(0,5)}
                      {a.caregiver_phone && <span style={{ marginLeft: '0.75rem' }}>📞 {a.caregiver_phone}</span>}
                    </div>
                    {a.sms_sent && <div style={{ fontSize: '0.75rem', color: '#10B981', marginTop: '0.2rem' }}>✓ SMS sent</div>}
                    {a.resolution_note && <div style={{ fontSize: '0.82rem', color: '#374151', marginTop: '0.35rem', fontStyle: 'italic' }}>"{a.resolution_note}"</div>}
                  </div>
                  {a.status === 'open' && (
                    <button onClick={() => { setResolveModal(a); setResolveNote(''); }}
                      style={{ padding: '0.4rem 0.9rem', borderRadius: '8px', border: 'none', background: '#D1FAE5', color: '#065F46', cursor: 'pointer', fontWeight: 600, fontSize: '0.82rem' }}>
                      Resolve
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {tab === 'settings' && (
        <div style={{ maxWidth: '480px' }}>
          <div style={{ background: '#F9FAFB', borderRadius: '10px', padding: '1.25rem', border: '1px solid #E5E7EB' }}>
            <h4 style={{ margin: '0 0 1rem' }}>Alert Configuration</h4>

            <div style={{ marginBottom: '1rem' }}>
              <label style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.75rem' }}>
                <span style={{ fontWeight: 600, fontSize: '0.9rem' }}>Monitoring Active</span>
                <input type='checkbox' checked={config.is_active} onChange={e => setConfig(c => ({ ...c, is_active: e.target.checked }))} style={{ width: '1.1rem', height: '1.1rem' }} />
              </label>
              <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 600, marginBottom: '0.3rem', color: '#374151' }}>Grace Period (minutes)</label>
              <input type='number' value={config.grace_minutes} onChange={e => setConfig(c => ({ ...c, grace_minutes: parseInt(e.target.value) }))} min={5} max={60}
                style={{ width: '100px', padding: '0.5rem', borderRadius: '6px', border: '1px solid #D1D5DB', fontSize: '0.9rem' }} />
              <div style={{ fontSize: '0.75rem', color: '#9CA3AF', marginTop: '0.25rem' }}>Alert triggers if no clock-in after this many minutes past shift start</div>
            </div>

            <div style={{ marginBottom: '1rem' }}>
              <div style={{ fontWeight: 600, fontSize: '0.9rem', marginBottom: '0.5rem' }}>Notify</div>
              {[
                { key: 'notify_admin', label: 'Admin / Office' },
                { key: 'notify_caregiver', label: 'Caregiver (via SMS)' },
                { key: 'notify_client_family', label: "Client's Family" },
              ].map(({ key, label }) => (
                <label key={key} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.4rem', cursor: 'pointer' }}>
                  <input type='checkbox' checked={config[key]} onChange={e => setConfig(c => ({ ...c, [key]: e.target.checked }))} />
                  <span style={{ fontSize: '0.88rem' }}>{label}</span>
                </label>
              ))}
            </div>

            <div style={{ marginBottom: '1rem' }}>
              <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 600, marginBottom: '0.3rem', color: '#374151' }}>Admin Phone (for SMS)</label>
              <input value={config.admin_phone || ''} onChange={e => setConfig(c => ({ ...c, admin_phone: e.target.value }))}
                placeholder='+17155551234'
                style={{ width: '100%', padding: '0.5rem', borderRadius: '6px', border: '1px solid #D1D5DB', fontSize: '0.88rem', boxSizing: 'border-box' }} />
            </div>

            <button onClick={saveConfig} disabled={savingConfig}
              style={{ width: '100%', padding: '0.65rem', borderRadius: '8px', border: 'none', background: '#3B82F6', color: '#fff', cursor: 'pointer', fontWeight: 700, fontSize: '0.92rem' }}>
              {savingConfig ? 'Saving...' : '✓ Save Settings'}
            </button>
          </div>

          <div style={{ marginTop: '1rem', padding: '0.85rem 1rem', background: '#EFF6FF', borderRadius: '8px', border: '1px solid #BFDBFE' }}>
            <div style={{ fontWeight: 700, color: '#1E40AF', fontSize: '0.88rem', marginBottom: '0.35rem' }}>💡 How it works</div>
            <div style={{ fontSize: '0.82rem', color: '#374151', lineHeight: 1.6 }}>
              Click "Run Check Now" anytime to scan all shifts that should have started in the last 4 hours. For fully automated checks, set up a cron job calling <code style={{ background: '#DBEAFE', padding: '0.1rem 0.3rem', borderRadius: '3px' }}>POST /api/no-show/run-check</code> every 15–30 minutes.
            </div>
          </div>
        </div>
      )}

      {/* Resolve modal */}
      {resolveModal && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 2000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1rem' }} onClick={() => setResolveModal(null)}>
          <div style={{ background: '#fff', borderRadius: '12px', padding: '1.5rem', maxWidth: '420px', width: '100%', boxShadow: '0 20px 60px rgba(0,0,0,0.3)' }} onClick={e => e.stopPropagation()}>
            <h4 style={{ margin: '0 0 0.5rem' }}>Resolve Alert</h4>
            <p style={{ fontSize: '0.88rem', color: '#6B7280', margin: '0 0 1rem' }}>
              {resolveModal.caregiver_name} → {resolveModal.client_name}
            </p>
            <textarea value={resolveNote} onChange={e => setResolveNote(e.target.value)}
              placeholder='Resolution note (optional)...' rows={3}
              style={{ width: '100%', padding: '0.6rem', borderRadius: '8px', border: '1px solid #D1D5DB', fontSize: '0.88rem', resize: 'vertical', boxSizing: 'border-box', marginBottom: '1rem' }} />
            <div style={{ display: 'flex', gap: '0.5rem' }}>
              <button onClick={() => resolve(resolveModal.id, 'resolved')} style={{ flex: 1, padding: '0.6rem', borderRadius: '8px', border: 'none', background: '#10B981', color: '#fff', cursor: 'pointer', fontWeight: 700 }}>✓ Resolved</button>
              <button onClick={() => resolve(resolveModal.id, 'false_alarm')} style={{ flex: 1, padding: '0.6rem', borderRadius: '8px', border: '1px solid #D1D5DB', background: '#fff', color: '#374151', cursor: 'pointer', fontWeight: 600 }}>False Alarm</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
