// src/components/admin/CompanyOptimizer.jsx
// Company-Wide Smart Matching & Schedule Optimizer
import React, { useState, useEffect } from 'react';
import { API_BASE_URL } from '../../config';

const CompanyOptimizer = ({ token }) => {
  const [activeTab, setActiveTab] = useState('skills');
  const [capabilities, setCapabilities] = useState([]);
  const [caregivers, setCaregivers] = useState([]);
  const [clients, setClients] = useState([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState({ text: '', type: '' });

  const [selectedCg, setSelectedCg] = useState('');
  const [cgCaps, setCgCaps] = useState([]);
  const [cgCapsLoading, setCgCapsLoading] = useState(false);

  const [selectedClient, setSelectedClient] = useState('');
  const [clientNeeds, setClientNeeds] = useState([]);
  const [clientNeedsLoading, setClientNeedsLoading] = useState(false);
  const [schedPrefs, setSchedPrefs] = useState({ daysPerWeek: 5, allowedDays: [1, 2, 3, 4, 5] });

  const [restrictionsClient, setRestrictionsClient] = useState('');
  const [restrictions, setRestrictions] = useState([]);
  const [newRestriction, setNewRestriction] = useState({ caregiverId: '', type: 'preferred', reason: '' });

  const [optimizerWeek, setOptimizerWeek] = useState(() => {
    const d = new Date(); d.setDate(d.getDate() - d.getDay());
    return d.toISOString().split('T')[0];
  });
  const [optimizerMode, setOptimizerMode] = useState('generate_fresh');
  const [optimizerOptions, setOptimizerOptions] = useState({
    balanceHours: true, minimizeDriving: true, respectPreferences: true
  });
  const [optimizerResults, setOptimizerResults] = useState(null);
  const [optimizing, setOptimizing] = useState(false);
  const [applying, setApplying] = useState(false);
  const [clearExisting, setClearExisting] = useState(false);
  const [expandedClient, setExpandedClient] = useState(null);

  const [showNewCap, setShowNewCap] = useState(false);
  const [newCap, setNewCap] = useState({ name: '', category: 'household', description: '', icon: '📋' });

  const showMsg = (text, type = 'success') => {
    setMessage({ text, type });
    setTimeout(() => setMessage({ text: '', type: '' }), 5000);
  };

  const api = async (url, opts = {}) => {
    const res = await fetch(`${API_BASE_URL}${url}`, {
      ...opts,
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}`, ...opts.headers }
    });
    if (!res.ok) { const err = await res.json().catch(() => ({})); throw new Error(err.error || `Failed (${res.status})`); }
    return res.json();
  };

  useEffect(() => {
    Promise.all([api('/api/matching/capabilities'), api('/api/caregivers'), api('/api/clients')])
      .then(([caps, cgs, cls]) => {
        setCapabilities(caps);
        setCaregivers(Array.isArray(cgs) ? cgs : []);
        setClients(Array.isArray(cls) ? cls.filter(c => c.is_active !== false) : []);
      }).catch(console.error).finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (!selectedCg) { setCgCaps([]); return; }
    setCgCapsLoading(true);
    api(`/api/matching/caregiver/${selectedCg}/capabilities`).then(setCgCaps).catch(console.error).finally(() => setCgCapsLoading(false));
  }, [selectedCg]);

  useEffect(() => {
    if (!selectedClient) { setClientNeeds([]); setSchedPrefs({ daysPerWeek: 5, allowedDays: [1, 2, 3, 4, 5] }); return; }
    setClientNeedsLoading(true);
    Promise.all([
      api(`/api/matching/client/${selectedClient}/needs`),
      api(`/api/matching/client/${selectedClient}/schedule-prefs`)
    ]).then(([needs, prefs]) => {
      setClientNeeds(needs);
      setSchedPrefs(prefs);
    }).catch(console.error).finally(() => setClientNeedsLoading(false));
  }, [selectedClient]);

  useEffect(() => {
    if (!restrictionsClient) { setRestrictions([]); return; }
    api(`/api/matching/client/${restrictionsClient}/restrictions`).then(setRestrictions).catch(console.error);
  }, [restrictionsClient]);

  // ── Caregiver skills helpers ──
  const cgHasCap = (capId) => cgCaps.some(c => c.capability_id === capId);
  const getCgCap = (capId) => cgCaps.find(c => c.capability_id === capId);
  const toggleCgCap = (capId) => {
    if (cgHasCap(capId)) setCgCaps(p => p.filter(c => c.capability_id !== capId));
    else {
      const cap = capabilities.find(c => c.id === capId);
      setCgCaps(p => [...p, { capability_id: capId, proficiency: 'capable', name: cap?.name, category: cap?.category, icon: cap?.icon }]);
    }
  };
  const updateCgProf = (capId, prof) => setCgCaps(p => p.map(c => c.capability_id === capId ? { ...c, proficiency: prof } : c));
  const saveCgCaps = async () => {
    try {
      await api(`/api/matching/caregiver/${selectedCg}/capabilities`, {
        method: 'PUT', body: JSON.stringify({ capabilities: cgCaps.map(c => ({ capabilityId: c.capability_id, proficiency: c.proficiency || 'capable' })) })
      });
      showMsg('Skills saved!');
    } catch (e) { showMsg(e.message, 'error'); }
  };

  // ── Client needs helpers ──
  const clientHasNeed = (capId) => clientNeeds.some(n => n.capability_id === capId);
  const getClientNeed = (capId) => clientNeeds.find(n => n.capability_id === capId);
  const toggleNeed = (capId) => {
    if (clientHasNeed(capId)) setClientNeeds(p => p.filter(n => n.capability_id !== capId));
    else {
      const cap = capabilities.find(c => c.id === capId);
      setClientNeeds(p => [...p, { capability_id: capId, priority: 'normal', frequency: 'every_visit', name: cap?.name, category: cap?.category, icon: cap?.icon }]);
    }
  };
  const updateNeedPri = (capId, pri) => setClientNeeds(p => p.map(n => n.capability_id === capId ? { ...n, priority: pri } : n));
  const updateNeedFreq = (capId, freq) => setClientNeeds(p => p.map(n => n.capability_id === capId ? { ...n, frequency: freq } : n));
  const saveNeeds = async () => {
    try {
      await Promise.all([
        api(`/api/matching/client/${selectedClient}/needs`, {
          method: 'PUT', body: JSON.stringify({ needs: clientNeeds.map(n => ({ capabilityId: n.capability_id, priority: n.priority || 'normal', frequency: n.frequency || 'every_visit' })) })
        }),
        api(`/api/matching/client/${selectedClient}/schedule-prefs`, {
          method: 'PUT', body: JSON.stringify(schedPrefs)
        })
      ]);
      showMsg('Needs & schedule preferences saved!');
    } catch (e) { showMsg(e.message, 'error'); }
  };

  // Day toggle helpers
  const DAY_LABELS_FULL = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const toggleAllowedDay = (dayIdx) => {
    setSchedPrefs(p => {
      const days = p.allowedDays.includes(dayIdx)
        ? p.allowedDays.filter(d => d !== dayIdx)
        : [...p.allowedDays, dayIdx].sort((a, b) => a - b);
      return { ...p, allowedDays: days, daysPerWeek: Math.min(p.daysPerWeek, days.length) };
    });
  };

  // ── Restrictions helpers ──
  const addRestriction = async () => {
    if (!newRestriction.caregiverId) { showMsg('Select a caregiver', 'error'); return; }
    try {
      await api(`/api/matching/client/${restrictionsClient}/restrictions`, {
        method: 'POST', body: JSON.stringify({ caregiverId: newRestriction.caregiverId, restrictionType: newRestriction.type, reason: newRestriction.reason || null })
      });
      const updated = await api(`/api/matching/client/${restrictionsClient}/restrictions`);
      setRestrictions(updated);
      setNewRestriction({ caregiverId: '', type: 'preferred', reason: '' });
      showMsg('Restriction added');
    } catch (e) { showMsg(e.message, 'error'); }
  };
  const removeRestriction = async (id) => {
    try {
      await api(`/api/matching/restrictions/${id}`, { method: 'DELETE' });
      setRestrictions(p => p.filter(r => r.id !== id));
      showMsg('Removed');
    } catch (e) { showMsg(e.message, 'error'); }
  };

  // ── Optimizer ──
  const runOptimizer = async () => {
    setOptimizing(true); setOptimizerResults(null);
    try {
      const data = await api('/api/matching/optimize', {
        method: 'POST', body: JSON.stringify({ weekStart: optimizerWeek, mode: optimizerMode, options: optimizerOptions })
      });
      setOptimizerResults(data);
      showMsg(`${data.summary.coveragePercent}% coverage · ${data.summary.filledSlots}/${data.summary.totalSlots} slots filled · ${data.summary.swapIterations} optimization passes`);
    } catch (e) { showMsg('Failed: ' + e.message, 'error'); }
    finally { setOptimizing(false); }
  };

  const applySchedule = async () => {
    if (!optimizerResults) return;
    setApplying(true);
    try {
      const data = await api('/api/matching/apply-schedule', {
        method: 'POST',
        body: JSON.stringify({
          assignments: optimizerResults.assignments,
          weekStart: optimizerResults.weekStart,
          clearExisting
        })
      });
      showMsg(data.message);
      if (data.errors?.length) {
        console.warn('Apply errors:', data.errors);
      }
    } catch (e) { showMsg('Apply failed: ' + e.message, 'error'); }
    finally { setApplying(false); }
  };

  const addCapability = async () => {
    if (!newCap.name) { showMsg('Name required', 'error'); return; }
    try {
      const cap = await api('/api/matching/capabilities', { method: 'POST', body: JSON.stringify(newCap) });
      setCapabilities(p => [...p, cap]);
      setNewCap({ name: '', category: 'household', description: '', icon: '📋' });
      setShowNewCap(false);
      showMsg('Added!');
    } catch (e) { showMsg(e.message, 'error'); }
  };

  // ── Helpers ──
  const grouped = (items) => {
    const g = {};
    items.forEach(i => { const cat = i.category || 'other'; if (!g[cat]) g[cat] = []; g[cat].push(i); });
    return g;
  };
  const catLabel = { transportation: '🚗 Transportation', household: '🏠 Household', physical: '💪 Physical / Medical' };
  const priColors = { critical: '#dc2626', high: '#ea580c', normal: '#2563eb', low: '#94a3b8' };
  const typeColors = { preferred: '#16a34a', excluded: '#dc2626', locked: '#7c3aed' };
  const typeLabels = { preferred: '💚 Preferred', excluded: '🚫 Excluded', locked: '🔒 Locked' };
  const typeIcons = { preferred: '💚', excluded: '🚫', locked: '🔒' };

  // ── Styles ──
  const s = {
    page: { maxWidth: '1100px', margin: '0 auto', padding: '1rem', fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif' },
    tabs: { display: 'flex', gap: '4px', marginBottom: '1rem', overflowX: 'auto', borderBottom: '2px solid #e2e8f0', paddingBottom: '2px' },
    tab: (a) => ({ padding: '0.55rem 1rem', border: 'none', cursor: 'pointer', fontSize: '0.82rem', fontWeight: a ? '700' : '500', background: a ? '#2563eb' : 'transparent', color: a ? '#fff' : '#555', borderRadius: '8px 8px 0 0', whiteSpace: 'nowrap' }),
    card: { background: '#fff', borderRadius: '10px', padding: '1rem', boxShadow: '0 1px 4px rgba(0,0,0,0.07)', border: '1px solid #e8e8e8', marginBottom: '0.85rem' },
    cardTitle: { fontWeight: '800', fontSize: '0.95rem', marginBottom: '0.65rem' },
    label: { display: 'block', fontSize: '0.72rem', fontWeight: '700', color: '#888', textTransform: 'uppercase', marginBottom: '3px' },
    select: { width: '100%', padding: '0.45rem 0.6rem', border: '1px solid #ddd', borderRadius: '6px', fontSize: '0.88rem' },
    input: { width: '100%', padding: '0.45rem 0.6rem', border: '1px solid #ddd', borderRadius: '6px', fontSize: '0.88rem', boxSizing: 'border-box' },
    btn: (bg, dis) => ({ padding: '0.5rem 1rem', border: 'none', borderRadius: '6px', cursor: dis ? 'not-allowed' : 'pointer', fontSize: '0.82rem', fontWeight: '700', color: '#fff', background: dis ? '#ccc' : bg, opacity: dis ? 0.6 : 1 }),
    btnSm: (bg) => ({ padding: '0.3rem 0.6rem', border: 'none', borderRadius: '5px', cursor: 'pointer', fontSize: '0.75rem', fontWeight: '700', color: '#fff', background: bg }),
    btnGhost: (c) => ({ padding: '0.3rem 0.6rem', border: `1px solid ${c}`, borderRadius: '5px', cursor: 'pointer', fontSize: '0.75rem', fontWeight: '700', color: c, background: 'transparent' }),
    msg: (t) => ({ padding: '0.55rem 0.85rem', borderRadius: '8px', marginBottom: '0.75rem', fontSize: '0.82rem', fontWeight: '600', background: t === 'error' ? '#fef2f2' : t === 'warning' ? '#fffbeb' : '#f0fdf4', color: t === 'error' ? '#dc2626' : t === 'warning' ? '#92400e' : '#16a34a', border: `1px solid ${t === 'error' ? '#fecaca' : t === 'warning' ? '#fde68a' : '#bbf7d0'}` }),
    badge: (bg) => ({ display: 'inline-block', padding: '2px 7px', borderRadius: '4px', fontSize: '0.68rem', fontWeight: '700', color: '#fff', background: bg, marginLeft: '4px' }),
    capGrid: { display: 'grid', gap: '6px', marginBottom: '0.75rem' },
    capItem: (a) => ({ display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.5rem 0.65rem', border: `2px solid ${a ? '#2563eb' : '#e2e8f0'}`, borderRadius: '8px', cursor: 'pointer', background: a ? '#eff6ff' : '#fff' }),
    stat: (c) => ({ flex: '1 1 80px', padding: '0.5rem', textAlign: 'center', borderRadius: '8px', background: `${c}08`, border: `1px solid ${c}22` }),
    statVal: (c) => ({ fontSize: '1.2rem', fontWeight: '800', color: c }),
    statLbl: { fontSize: '0.65rem', color: '#999', fontWeight: '600', textTransform: 'uppercase' },
    emptyState: { textAlign: 'center', padding: '2rem', color: '#999' },
    row: { display: 'flex', gap: '0.75rem', flexWrap: 'wrap', marginBottom: '0.65rem' },
    col: (f) => ({ flex: f || 1, minWidth: '140px' }),
  };

  // ═══════════════════════════════════════════════
  // RENDER: Skills Tab
  // ═══════════════════════════════════════════════
  const renderSkills = () => {
    const g = grouped(capabilities);
    return (
      <div>
        <div style={s.card}>
          <div style={s.cardTitle}>👤 Caregiver Skills & Capabilities</div>
          <div style={{ fontSize: '0.82rem', color: '#666', marginBottom: '0.75rem' }}>
            Check off what each caregiver can do. The optimizer uses this to match them with client needs.
          </div>
          <div style={s.row}>
            <div style={s.col(2)}>
              <label style={s.label}>Caregiver</label>
              <select style={s.select} value={selectedCg} onChange={e => setSelectedCg(e.target.value)}>
                <option value="">— Select —</option>
                {caregivers.map(c => <option key={c.id} value={c.id}>{c.first_name} {c.last_name}</option>)}
              </select>
            </div>
            {selectedCg && <div style={{ ...s.col(1), display: 'flex', alignItems: 'flex-end', gap: '0.5rem' }}>
              <button style={s.btn('#16a34a')} onClick={saveCgCaps}>💾 Save</button>
              <span style={{ fontSize: '0.78rem', color: '#666' }}>{cgCaps.length}/{capabilities.length}</span>
            </div>}
          </div>
        </div>
        {selectedCg && !cgCapsLoading && Object.entries(g).map(([cat, caps]) => (
          <div key={cat} style={s.card}>
            <div style={s.cardTitle}>{catLabel[cat] || cat}</div>
            <div style={s.capGrid}>
              {caps.map(cap => {
                const a = cgHasCap(cap.id);
                return (
                  <div key={cap.id} style={s.capItem(a)} onClick={() => toggleCgCap(cap.id)}>
                    <input type="checkbox" checked={a} readOnly style={{ cursor: 'pointer', width: '16px', height: '16px' }} />
                    <span style={{ fontSize: '1rem' }}>{cap.icon}</span>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontWeight: '600', fontSize: '0.86rem' }}>{cap.name}</div>
                      {cap.description && <div style={{ fontSize: '0.72rem', color: '#888' }}>{cap.description}</div>}
                    </div>
                    {a && <select value={getCgCap(cap.id)?.proficiency || 'capable'} onClick={e => e.stopPropagation()}
                      onChange={e => { e.stopPropagation(); updateCgProf(cap.id, e.target.value); }}
                      style={{ padding: '2px 4px', fontSize: '0.72rem', border: '1px solid #ddd', borderRadius: '4px' }}>
                      <option value="capable">Capable</option><option value="experienced">Experienced</option><option value="specialized">Specialized</option>
                    </select>}
                  </div>
                );
              })}
            </div>
          </div>
        ))}
        <div style={s.card}>
          {!showNewCap ? <button style={s.btnGhost('#2563eb')} onClick={() => setShowNewCap(true)}>+ Add Custom Capability</button> : (
            <div>
              <div style={s.row}>
                <div style={s.col(2)}><label style={s.label}>Name</label><input style={s.input} value={newCap.name} onChange={e => setNewCap(p => ({ ...p, name: e.target.value }))} placeholder="e.g., Bilingual (Spanish)" /></div>
                <div style={s.col(1)}><label style={s.label}>Category</label><select style={s.select} value={newCap.category} onChange={e => setNewCap(p => ({ ...p, category: e.target.value }))}><option value="transportation">Transportation</option><option value="household">Household</option><option value="physical">Physical</option></select></div>
                <div style={s.col(0.5)}><label style={s.label}>Icon</label><input style={s.input} value={newCap.icon} onChange={e => setNewCap(p => ({ ...p, icon: e.target.value }))} maxLength="4" /></div>
              </div>
              <div style={{ display: 'flex', gap: '0.5rem' }}><button style={s.btn('#16a34a')} onClick={addCapability}>Add</button><button style={s.btnGhost('#888')} onClick={() => setShowNewCap(false)}>Cancel</button></div>
            </div>
          )}
        </div>
      </div>
    );
  };

  // ═══════════════════════════════════════════════
  // RENDER: Client Needs Tab
  // ═══════════════════════════════════════════════
  const renderNeeds = () => {
    const g = grouped(capabilities);
    return (
      <div>
        <div style={s.card}>
          <div style={s.cardTitle}>📋 Client Service Needs</div>
          <div style={{ fontSize: '0.82rem', color: '#666', marginBottom: '0.75rem' }}>What services does each client need? Mark critical items so the optimizer prioritizes them.</div>
          <div style={s.row}>
            <div style={s.col(2)}>
              <label style={s.label}>Client</label>
              <select style={s.select} value={selectedClient} onChange={e => setSelectedClient(e.target.value)}>
                <option value="">— Select —</option>
                {clients.map(c => <option key={c.id} value={c.id}>{c.first_name} {c.last_name} {c.weekly_authorized_units ? `(${c.weekly_authorized_units}u/wk)` : ''}</option>)}
              </select>
            </div>
            {selectedClient && <div style={{ ...s.col(1), display: 'flex', alignItems: 'flex-end', gap: '0.5rem' }}>
              <button style={s.btn('#16a34a')} onClick={saveNeeds}>💾 Save</button>
              <span style={{ fontSize: '0.78rem', color: '#666' }}>{clientNeeds.length} needs{clientNeeds.filter(n => n.priority === 'critical').length > 0 && <span style={s.badge('#dc2626')}>{clientNeeds.filter(n => n.priority === 'critical').length} critical</span>}</span>
            </div>}
          </div>
        </div>

        {/* Schedule day preferences */}
        {selectedClient && !clientNeedsLoading && (
          <div style={s.card}>
            <div style={s.cardTitle}>📅 Service Day Schedule</div>
            <div style={{ fontSize: '0.82rem', color: '#666', marginBottom: '0.65rem' }}>
              Which days can this client receive service? The optimizer will spread their weekly units across these days.
            </div>
            <div style={{ marginBottom: '0.65rem' }}>
              <label style={s.label}>Allowed Days</label>
              <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                {DAY_LABELS_FULL.map((label, idx) => {
                  const active = schedPrefs.allowedDays.includes(idx);
                  return (
                    <button key={idx} onClick={() => toggleAllowedDay(idx)} style={{
                      padding: '0.4rem 0.7rem', border: `2px solid ${active ? '#2563eb' : '#e2e8f0'}`,
                      borderRadius: '8px', cursor: 'pointer', fontSize: '0.82rem', fontWeight: active ? '700' : '500',
                      background: active ? '#eff6ff' : '#fff', color: active ? '#2563eb' : '#aaa',
                      minWidth: '48px', textAlign: 'center', transition: 'all 0.15s'
                    }}>
                      {label}
                    </button>
                  );
                })}
              </div>
            </div>
            <div>
              <label style={s.label}>Days Per Week (how many of the allowed days to actually use)</label>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.65rem' }}>
                <input type="range" min="1" max={schedPrefs.allowedDays.length || 1} value={schedPrefs.daysPerWeek}
                  onChange={e => setSchedPrefs(p => ({ ...p, daysPerWeek: parseInt(e.target.value) }))}
                  style={{ flex: 1, cursor: 'pointer' }} />
                <span style={{ fontSize: '1rem', fontWeight: '800', color: '#2563eb', minWidth: '50px', textAlign: 'center' }}>
                  {schedPrefs.daysPerWeek} day{schedPrefs.daysPerWeek !== 1 ? 's' : ''}
                </span>
              </div>
              {(() => {
                const cl = clients.find(c => c.id === selectedClient);
                const units = cl?.weekly_authorized_units || 0;
                if (units > 0 && schedPrefs.daysPerWeek > 0) {
                  const perDay = Math.floor(units / schedPrefs.daysPerWeek);
                  const rem = units % schedPrefs.daysPerWeek;
                  return (
                    <div style={{ fontSize: '0.78rem', color: '#666', marginTop: '0.35rem' }}>
                      {units} units/wk ÷ {schedPrefs.daysPerWeek} days = <strong>{perDay}u/day</strong> ({(perDay * 15)} min)
                      {rem > 0 && <span> + {rem} extra unit{rem > 1 ? 's' : ''} spread across first {rem} day{rem > 1 ? 's' : ''}</span>}
                    </div>
                  );
                }
                return null;
              })()}
            </div>
          </div>
        )}

        {selectedClient && !clientNeedsLoading && Object.entries(g).map(([cat, caps]) => (
          <div key={cat} style={s.card}>
            <div style={s.cardTitle}>{catLabel[cat] || cat}</div>
            <div style={s.capGrid}>
              {caps.map(cap => {
                const a = clientHasNeed(cap.id), need = getClientNeed(cap.id);
                return (
                  <div key={cap.id} style={{ ...s.capItem(a), borderColor: a ? (priColors[need?.priority] || '#2563eb') : '#e2e8f0' }} onClick={() => toggleNeed(cap.id)}>
                    <input type="checkbox" checked={a} readOnly style={{ cursor: 'pointer', width: '16px', height: '16px' }} />
                    <span style={{ fontSize: '1rem' }}>{cap.icon}</span>
                    <div style={{ flex: 1 }}><div style={{ fontWeight: '600', fontSize: '0.86rem' }}>{cap.name}</div></div>
                    {a && <div style={{ display: 'flex', gap: '4px' }} onClick={e => e.stopPropagation()}>
                      <select value={need?.priority || 'normal'} onChange={e => updateNeedPri(cap.id, e.target.value)} style={{ padding: '2px 4px', fontSize: '0.72rem', border: '1px solid #ddd', borderRadius: '4px', color: priColors[need?.priority || 'normal'], fontWeight: '700' }}>
                        <option value="critical">🔴 Critical</option><option value="high">🟠 High</option><option value="normal">🔵 Normal</option><option value="low">⚪ Low</option>
                      </select>
                      <select value={need?.frequency || 'every_visit'} onChange={e => updateNeedFreq(cap.id, e.target.value)} style={{ padding: '2px 4px', fontSize: '0.72rem', border: '1px solid #ddd', borderRadius: '4px' }}>
                        <option value="every_visit">Every Visit</option><option value="weekly">Weekly</option><option value="as_needed">As Needed</option>
                      </select>
                    </div>}
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    );
  };

  // ═══════════════════════════════════════════════
  // RENDER: Restrictions Tab
  // ═══════════════════════════════════════════════
  const renderRestrictions = () => {
    const g = {};
    restrictions.forEach(r => { if (!g[r.restriction_type]) g[r.restriction_type] = []; g[r.restriction_type].push(r); });
    return (
      <div>
        <div style={s.card}>
          <div style={s.cardTitle}>🔒 Client-Caregiver Restrictions</div>
          <div style={{ fontSize: '0.82rem', color: '#666', marginBottom: '0.75rem' }}>
            <strong>Preferred</strong> = send when possible · <strong>Excluded</strong> = never send · <strong>Locked</strong> = only this person
          </div>
          <div style={s.col(2)}><label style={s.label}>Client</label>
            <select style={s.select} value={restrictionsClient} onChange={e => setRestrictionsClient(e.target.value)}>
              <option value="">— Select —</option>
              {clients.map(c => <option key={c.id} value={c.id}>{c.first_name} {c.last_name}</option>)}
            </select>
          </div>
        </div>
        {restrictionsClient && (<>
          <div style={s.card}>
            <div style={s.cardTitle}>➕ Add Restriction</div>
            <div style={s.row}>
              <div style={s.col(2)}><label style={s.label}>Caregiver</label>
                <select style={s.select} value={newRestriction.caregiverId} onChange={e => setNewRestriction(p => ({ ...p, caregiverId: e.target.value }))}>
                  <option value="">— Select —</option>
                  {caregivers.filter(c => !restrictions.some(r => r.caregiver_id === c.id)).map(c => <option key={c.id} value={c.id}>{c.first_name} {c.last_name}</option>)}
                </select>
              </div>
              <div style={s.col(1)}><label style={s.label}>Type</label>
                <select style={s.select} value={newRestriction.type} onChange={e => setNewRestriction(p => ({ ...p, type: e.target.value }))}>
                  <option value="preferred">💚 Preferred</option><option value="excluded">🚫 Excluded</option><option value="locked">🔒 Locked</option>
                </select>
              </div>
            </div>
            <div style={{ marginBottom: '0.5rem' }}><label style={s.label}>Reason (admin-only)</label>
              <input style={s.input} value={newRestriction.reason} onChange={e => setNewRestriction(p => ({ ...p, reason: e.target.value }))} placeholder="Internal note — not visible to caregivers or families" />
            </div>
            <button style={s.btn('#2563eb')} onClick={addRestriction}>Add</button>
          </div>
          {restrictions.length === 0 ? <div style={{ ...s.card, ...s.emptyState }}>No restrictions set — all caregivers eligible</div>
          : ['locked', 'preferred', 'excluded'].map(type => {
            const items = g[type] || [];
            if (!items.length) return null;
            return (<div key={type} style={s.card}><div style={{ ...s.cardTitle, color: typeColors[type] }}>{typeLabels[type]} ({items.length})</div>
              {items.map(r => (<div key={r.id} style={{ display: 'flex', alignItems: 'center', gap: '0.65rem', padding: '0.5rem 0.65rem', borderRadius: '6px', marginBottom: '4px', background: `${typeColors[type]}08`, border: `1px solid ${typeColors[type]}22` }}>
                <span style={{ fontSize: '1.1rem' }}>{typeIcons[type]}</span>
                <div style={{ flex: 1 }}><div style={{ fontWeight: '700', fontSize: '0.88rem' }}>{r.cg_first_name} {r.cg_last_name}</div>
                  {r.reason && <div style={{ fontSize: '0.72rem', color: '#888', fontStyle: 'italic' }}>{r.reason}</div>}
                </div>
                <button style={s.btnSm('#dc2626')} onClick={() => removeRestriction(r.id)}>Remove</button>
              </div>))}
            </div>);
          })}
        </>)}
      </div>
    );
  };

  // ═══════════════════════════════════════════════
  // RENDER: Optimizer Tab
  // ═══════════════════════════════════════════════
  const renderOptimizer = () => {
    const r = optimizerResults;
    return (
      <div>
        <div style={s.card}>
          <div style={s.cardTitle}>🧠 Company-Wide Schedule Optimizer</div>
          <div style={{ fontSize: '0.82rem', color: '#666', marginBottom: '0.75rem' }}>
            Analyzes capabilities, restrictions, availability, and driving distances to produce optimal caregiver assignments. Spreads each client's weekly units across weekdays.
          </div>
          <div style={s.row}>
            <div style={s.col(1)}><label style={s.label}>Week Starting</label><input type="date" style={s.input} value={optimizerWeek} onChange={e => setOptimizerWeek(e.target.value)} /></div>
            <div style={s.col(1)}><label style={s.label}>Mode</label>
              <select style={s.select} value={optimizerMode} onChange={e => setOptimizerMode(e.target.value)}>
                <option value="generate_fresh">Generate Fresh Schedule</option>
                <option value="optimize_existing">Optimize Around Existing</option>
              </select>
            </div>
          </div>
          <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap', marginBottom: '0.75rem' }}>
            {[{ k: 'balanceHours', l: '⚖️ Balance hours' }, { k: 'minimizeDriving', l: '🗺️ Minimize driving' }, { k: 'respectPreferences', l: '💚 Boost preferred' }].map(o => (
              <label key={o.k} style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', cursor: 'pointer', fontSize: '0.82rem' }}>
                <input type="checkbox" checked={optimizerOptions[o.k]} onChange={e => setOptimizerOptions(p => ({ ...p, [o.k]: e.target.checked }))} /> {o.l}
              </label>
            ))}
          </div>
          <button style={s.btn('#7c3aed', optimizing)} onClick={runOptimizer} disabled={optimizing}>
            {optimizing ? '⏳ Optimizing...' : '🚀 Run Optimizer'}
          </button>
        </div>

        {r && (<div>
          {/* Summary */}
          <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', marginBottom: '0.85rem' }}>
            {[
              { v: `${r.summary.coveragePercent}%`, l: 'Coverage', c: r.summary.coveragePercent >= 90 ? '#16a34a' : r.summary.coveragePercent >= 70 ? '#d97706' : '#dc2626' },
              { v: r.summary.totalClients, l: 'Clients', c: '#2563eb' },
              { v: `${r.summary.filledSlots}/${r.summary.totalSlots}`, l: 'Slots Filled', c: '#7c3aed' },
              { v: `${r.summary.totalHoursAssigned}h`, l: 'Assigned', c: '#16a34a' },
              { v: `${r.summary.totalHoursNeeded}h`, l: 'Needed', c: '#ea580c' },
              { v: r.summary.swapIterations, l: 'Opt Passes', c: '#64748b' },
            ].map((st, i) => <div key={i} style={s.stat(st.c)}><div style={s.statVal(st.c)}>{st.v}</div><div style={s.statLbl}>{st.l}</div></div>)}
          </div>

          {/* Apply controls */}
          <div style={{ ...s.card, display: 'flex', alignItems: 'center', gap: '1rem', flexWrap: 'wrap' }}>
            <button style={s.btn('#16a34a', applying)} onClick={applySchedule} disabled={applying}>
              {applying ? '⏳ Applying...' : '✅ Apply All to Schedule'}
            </button>
            <label style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.82rem', cursor: 'pointer' }}>
              <input type="checkbox" checked={clearExisting} onChange={e => setClearExisting(e.target.checked)} />
              Clear previous optimizer entries for this week first
            </label>
            <div style={{ fontSize: '0.72rem', color: '#888', marginLeft: 'auto' }}>
              Week: {r.weekStart} → {r.weekEnd}
            </div>
          </div>

          {/* Client assignments */}
          <div style={s.card}>
            <div style={s.cardTitle}>📋 Assignments ({r.assignments.length} clients)</div>
            {r.assignments.map(a => {
              const expanded = expandedClient === a.clientId;
              return (
                <div key={a.clientId} style={{
                  padding: '0.65rem', borderRadius: '8px', marginBottom: '6px',
                  border: `1px solid ${a.unfilledSlots > 0 ? '#fecaca' : '#bbf7d0'}`,
                  background: a.unfilledSlots > 0 ? '#fef2f2' : '#f0fdf4', cursor: 'pointer'
                }} onClick={() => setExpandedClient(expanded ? null : a.clientId)}>

                  {/* Header row */}
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.3rem' }}>
                    <div>
                      <span style={{ fontWeight: '700', fontSize: '0.9rem' }}>{expanded ? '▼' : '▶'} {a.clientName}</span>
                      {a.clientCity && <span style={{ fontSize: '0.72rem', color: '#888', marginLeft: '6px' }}>{a.clientCity}</span>}
                      {a.hasLocked && <span style={s.badge('#7c3aed')}>🔒</span>}
                      {a.hasExcluded && <span style={s.badge('#dc2626')}>🚫</span>}
                      {a.criticalNeedsCount > 0 && <span style={s.badge('#dc2626')}>🔴 {a.criticalNeedsCount}</span>}
                    </div>
                    <div style={{ fontSize: '0.78rem', fontWeight: '700' }}>
                      <span style={{ color: '#16a34a' }}>{a.assignedHours}h</span>
                      <span style={{ color: '#888' }}> / {a.hoursNeeded}h</span>
                      {a.unfilledSlots > 0 && <span style={{ color: '#dc2626', marginLeft: '6px' }}>⚠️ {a.unfilledSlots} unfilled</span>}
                    </div>
                  </div>

                  {/* Compact day summary */}
                  {!expanded && (
                    <div style={{ display: 'flex', gap: '4px', marginTop: '0.35rem', flexWrap: 'wrap' }}>
                      {a.dailySlots.map((sl, i) => (
                        <div key={i} style={{
                          padding: '2px 8px', borderRadius: '4px', fontSize: '0.72rem', fontWeight: '600',
                          background: sl.caregiverId ? '#e0f2fe' : '#fee2e2',
                          color: sl.caregiverId ? '#0369a1' : '#dc2626'
                        }}>
                          {sl.dayLabel}: {sl.caregiverName ? sl.caregiverName.split(' ')[0] : '—'} ({sl.units}u)
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Expanded daily detail */}
                  {expanded && (
                    <div style={{ marginTop: '0.5rem' }} onClick={e => e.stopPropagation()}>
                      {a.dailySlots.map((sl, i) => (
                        <div key={i} style={{
                          display: 'flex', alignItems: 'center', gap: '0.65rem',
                          padding: '0.45rem 0.65rem', borderRadius: '6px', marginBottom: '3px',
                          background: sl.caregiverId ? '#fff' : '#fee2e2', border: '1px solid #e2e8f0'
                        }}>
                          <div style={{ fontWeight: '700', fontSize: '0.82rem', minWidth: '35px', color: '#555' }}>{sl.dayLabel}</div>
                          <div style={{ flex: 1 }}>
                            {sl.caregiverName
                              ? <span style={{ fontWeight: '600', fontSize: '0.85rem' }}>{sl.caregiverName}</span>
                              : <span style={{ color: '#dc2626', fontWeight: '600', fontSize: '0.82rem' }}>⚠️ {sl.warning || 'Unfilled'}</span>
                            }
                          </div>
                          <div style={{ fontSize: '0.75rem', color: '#888' }}>{sl.units}u ({sl.hours}h)</div>
                          {sl.score > 0 && (
                            <span style={{
                              padding: '1px 5px', borderRadius: '3px', fontSize: '0.65rem', fontWeight: '700',
                              background: sl.score >= 80 ? '#dcfce7' : sl.score >= 50 ? '#fef9c3' : '#fef2f2',
                              color: sl.score >= 80 ? '#16a34a' : sl.score >= 50 ? '#a16207' : '#dc2626'
                            }}>{sl.score}pts</span>
                          )}
                          {sl.factors?.length > 0 && (
                            <div style={{ fontSize: '0.65rem', color: '#aaa' }}>{sl.factors.join(' · ')}</div>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {/* Utilization */}
          <div style={s.card}>
            <div style={s.cardTitle}>📊 Caregiver Utilization</div>
            {r.caregiverUtilization.map(cg => (
              <div key={cg.caregiverId} style={{ display: 'flex', alignItems: 'center', gap: '0.65rem', padding: '0.3rem 0', fontSize: '0.82rem' }}>
                <span style={{ fontWeight: '600', minWidth: '130px' }}>{cg.caregiverName}</span>
                <div style={{ flex: 1, height: '14px', background: '#f1f5f9', borderRadius: '7px', overflow: 'hidden' }}>
                  <div style={{ width: `${Math.min(100, cg.utilization)}%`, height: '100%', borderRadius: '7px', background: cg.utilization >= 90 ? '#dc2626' : cg.utilization >= 70 ? '#d97706' : '#16a34a' }} />
                </div>
                <span style={{ fontWeight: '700', minWidth: '40px', textAlign: 'right', color: cg.utilization >= 90 ? '#dc2626' : '#333' }}>{cg.utilization}%</span>
                <span style={{ fontSize: '0.72rem', color: '#888', minWidth: '70px' }}>{cg.assignedHours}h/{cg.maxHours}h</span>
                <span style={{ fontSize: '0.72rem', color: '#888' }}>{cg.clientCount} cl</span>
              </div>
            ))}
          </div>
        </div>)}
      </div>
    );
  };

  if (loading) return <div style={{ ...s.page, textAlign: 'center', padding: '3rem', color: '#aaa' }}>Loading...</div>;

  return (
    <div style={s.page}>
      <h1 style={{ fontSize: '1.35rem', fontWeight: '800', marginBottom: '1rem' }}>🧠 Smart Matching & Optimizer</h1>
      {message.text && <div style={s.msg(message.type)}>{message.text}</div>}
      <div style={s.tabs}>
        {[{ id: 'skills', i: '👤', l: 'Caregiver Skills' }, { id: 'needs', i: '📋', l: 'Client Needs' }, { id: 'restrictions', i: '🔒', l: 'Restrictions' }, { id: 'optimizer', i: '🧠', l: 'Run Optimizer' }].map(t => (
          <button key={t.id} style={s.tab(activeTab === t.id)} onClick={() => setActiveTab(t.id)}>{t.i} {t.l}</button>
        ))}
      </div>
      {activeTab === 'skills' && renderSkills()}
      {activeTab === 'needs' && renderNeeds()}
      {activeTab === 'restrictions' && renderRestrictions()}
      {activeTab === 'optimizer' && renderOptimizer()}
    </div>
  );
};

export default CompanyOptimizer;
