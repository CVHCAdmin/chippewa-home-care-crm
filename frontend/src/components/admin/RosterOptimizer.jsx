// RosterOptimizer.jsx
// Full-roster schedule optimizer. Loads ALL active caregivers and clients,
// lets the admin set target hours per caretaker and visits/hours per client,
// runs the algorithm, reviews the proposed schedule, then applies it.
// Zero impact on live schedules until "Apply" is clicked.

import React, { useState, useEffect, useCallback } from 'react';
import { API_BASE_URL } from '../../config';

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const DAY_COLORS = ['#8B5CF6', '#3B82F6', '#10B981', '#F59E0B', '#EF4444', '#EC4899', '#06B6D4'];
const CG_COLORS  = ['#3B82F6','#10B981','#F59E0B','#EF4444','#8B5CF6','#EC4899','#06B6D4','#84CC16','#F97316','#6366F1'];

function fmtTime(t) {
  if (!t) return '';
  const [h, m] = t.slice(0, 5).split(':');
  const hour = parseInt(h);
  return `${hour % 12 || 12}:${m}${hour >= 12 ? 'pm' : 'am'}`;
}

function suggestVisits(hrs) {
  if (!hrs || hrs <= 0) return 3;
  if (hrs <= 5)  return 2;
  if (hrs <= 10) return 3;
  if (hrs <= 20) return 4;
  if (hrs <= 30) return 5;
  return 6;
}

export default function RosterOptimizer({ token }) {
  // ── Data ─────────────────────────────────────────────────────────────────
  const [roster, setRoster]         = useState(null);   // raw roster from API
  const [caregivers, setCaregivers] = useState([]);     // [{id,name,targetHours,...}]
  const [clients, setClients]       = useState([]);     // [{id,name,hoursPerWeek,visitsPerWeek,...}]
  const [loading, setLoading]       = useState(true);
  const [loadError, setLoadError]   = useState(null);

  // ── UI state ──────────────────────────────────────────────────────────────
  const [step, setStep]         = useState('setup');   // 'setup' | 'results'
  const [running, setRunning]   = useState(false);
  const [applying, setApplying] = useState(false);
  const [result, setResult]     = useState(null);
  const [viewMode, setViewMode] = useState('grid');    // 'grid' | 'list'
  const [selected, setSelected] = useState(new Set()); // proposal ids to apply
  const [toast, setToast]       = useState(null);
  const [cgFilter, setCgFilter] = useState('');
  const [clFilter, setClFilter] = useState('');

  const showToast = (msg, type = 'success') => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 4500);
  };

  const api = useCallback(async (url, opts = {}) => {
    const res = await fetch(`${API_BASE_URL}${url}`, {
      ...opts,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, ...opts.headers },
    });
    if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error(e.error || `${res.status}`); }
    return res.json();
  }, [token]);

  // ── Load roster ───────────────────────────────────────────────────────────
  useEffect(() => {
    (async () => {
      try {
        const data = await api('/api/roster-optimizer/roster');
        setRoster(data);
        setCaregivers(data.caregivers.map(cg => ({
          ...cg,
          targetHours: parseFloat(cg.max_hours_per_week) || 40,
          enabled: true,
        })));
        setClients(data.clients.map(cl => ({
          ...cl,
          hoursPerWeek: parseFloat(cl.assigned_hours_per_week) || 0,
          visitsPerWeek: suggestVisits(parseFloat(cl.assigned_hours_per_week)),
          enabled: true,
        })));
      } catch (err) {
        setLoadError(err.message);
      } finally {
        setLoading(false);
      }
    })();
  }, [api]);

  // ── Caregiver helpers ─────────────────────────────────────────────────────
  const updateCg = (id, field, value) =>
    setCaregivers(prev => prev.map(c => c.id === id ? { ...c, [field]: value } : c));

  const toggleAllCg = (val) =>
    setCaregivers(prev => prev.map(c => ({ ...c, enabled: val })));

  // ── Client helpers ────────────────────────────────────────────────────────
  const updateCl = (id, field, value) =>
    setClients(prev => prev.map(c => c.id === id ? { ...c, [field]: parseFloat(value) || 0 } : c));

  const toggleAllCl = (val) =>
    setClients(prev => prev.map(c => ({ ...c, enabled: val })));

  // ── Run optimizer ─────────────────────────────────────────────────────────
  const runOptimizer = async () => {
    const activeCg = caregivers.filter(c => c.enabled);
    const activeCl = clients.filter(c => c.enabled && c.hoursPerWeek > 0 && c.visitsPerWeek > 0);

    if (!activeCg.length) { showToast('Enable at least one caretaker', 'error'); return; }
    if (!activeCl.length) { showToast('Enable at least one client with hours set', 'error'); return; }

    setRunning(true);
    setResult(null);
    try {
      const data = await api('/api/roster-optimizer/run', {
        method: 'POST',
        body: JSON.stringify({
          caregivers: activeCg.map(c => ({ id: c.id, targetHours: c.targetHours })),
          clients: activeCl.map(c => ({ id: c.id, hoursPerWeek: c.hoursPerWeek, visitsPerWeek: c.visitsPerWeek })),
        }),
      });
      setResult(data);
      // Auto-select all non-conflicting proposals
      setSelected(new Set(data.proposals.filter(p => !p.hasConflict).map(p => p.id)));
      setStep('results');
    } catch (err) {
      showToast('Optimizer failed: ' + err.message, 'error');
    } finally {
      setRunning(false);
    }
  };

  // ── Apply proposals ───────────────────────────────────────────────────────
  const applyProposals = async () => {
    if (!result || selected.size === 0) return;
    const toApply = result.proposals.filter(p => selected.has(p.id));
    setApplying(true);
    try {
      const data = await api('/api/roster-optimizer/apply', {
        method: 'POST',
        body: JSON.stringify({ proposals: toApply }),
      });
      showToast(`✅ Applied ${data.created} schedule${data.created !== 1 ? 's' : ''} to live schedule!`);
      if (data.errors > 0) showToast(`⚠️ ${data.errors} failed`, 'error');
      setStep('setup');
      setResult(null);
    } catch (err) {
      showToast('Apply failed: ' + err.message, 'error');
    } finally {
      setApplying(false);
    }
  };

  const toggleProposal = (id) => setSelected(prev => {
    const next = new Set(prev);
    next.has(id) ? next.delete(id) : next.add(id);
    return next;
  });

  const cgColorFor = (id) => {
    const idx = caregivers.findIndex(c => c.id === id);
    return CG_COLORS[idx % CG_COLORS.length] || '#6B7280';
  };

  // ── Loading / error ───────────────────────────────────────────────────────
  if (loading) return (
    <div style={{ textAlign: 'center', padding: '3rem', color: '#6B7280' }}>
      <div style={{ fontSize: '2rem', marginBottom: '0.5rem' }}>⏳</div>
      Loading your full roster...
    </div>
  );

  if (loadError) return (
    <div style={{ textAlign: 'center', padding: '3rem', color: '#DC2626' }}>
      <div style={{ fontSize: '1.5rem', marginBottom: '0.5rem' }}>❌</div>
      Failed to load roster: {loadError}
    </div>
  );

  const activeCgCount = caregivers.filter(c => c.enabled).length;
  const activeClCount = clients.filter(c => c.enabled).length;
  const totalTargetHrs = caregivers.filter(c => c.enabled).reduce((s, c) => s + c.targetHours, 0);
  const totalNeededHrs = clients.filter(c => c.enabled).reduce((s, c) => s + c.hoursPerWeek, 0);

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div>

      {/* Toast */}
      {toast && (
        <div style={{
          position: 'fixed', top: '1rem', right: '1rem', zIndex: 9999,
          padding: '0.75rem 1.25rem', borderRadius: '10px', fontWeight: '600',
          background: toast.type === 'error' ? '#FEE2E2' : '#D1FAE5',
          color: toast.type === 'error' ? '#DC2626' : '#065F46',
          boxShadow: '0 4px 12px rgba(0,0,0,0.2)',
        }}>{toast.msg}</div>
      )}

      {/* Header Banner */}
      <div style={{
        background: 'linear-gradient(135deg, #1e3a5f 0%, #0f766e 100%)',
        borderRadius: '12px', padding: '1.25rem 1.5rem', marginBottom: '1.5rem', color: '#fff',
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '0.75rem' }}>
          <div>
            <h3 style={{ margin: '0 0 0.35rem', fontSize: '1.15rem' }}>📊 Roster Schedule Optimizer</h3>
            <p style={{ margin: 0, fontSize: '0.87rem', opacity: 0.88 }}>
              Automatically analyzes your entire team and client roster to build the best weekly schedule.
              Nothing changes until you review and apply.
            </p>
          </div>
          <div style={{ display: 'flex', gap: '1.25rem', flexShrink: 0 }}>
            <div style={{ textAlign: 'center' }}>
              <div style={{ fontSize: '1.5rem', fontWeight: '800' }}>{caregivers.length}</div>
              <div style={{ fontSize: '0.72rem', opacity: 0.8 }}>Caretakers</div>
            </div>
            <div style={{ textAlign: 'center' }}>
              <div style={{ fontSize: '1.5rem', fontWeight: '800' }}>{clients.length}</div>
              <div style={{ fontSize: '0.72rem', opacity: 0.8 }}>Clients</div>
            </div>
          </div>
        </div>
      </div>

      {/* ═══════════════════════════ SETUP STEP ═══════════════════════════ */}
      {step === 'setup' && (
        <>
          {/* Capacity check bar */}
          {activeCgCount > 0 && activeClCount > 0 && (
            <div style={{
              padding: '0.75rem 1rem', borderRadius: '8px', marginBottom: '1.25rem',
              background: totalTargetHrs >= totalNeededHrs ? '#F0FDF4' : '#FFFBEB',
              border: `1px solid ${totalTargetHrs >= totalNeededHrs ? '#A7F3D0' : '#FDE68A'}`,
              display: 'flex', alignItems: 'center', gap: '1rem', flexWrap: 'wrap',
            }}>
              <span style={{ fontSize: '0.88rem', fontWeight: '600',
                color: totalTargetHrs >= totalNeededHrs ? '#065F46' : '#92400E' }}>
                {totalTargetHrs >= totalNeededHrs ? '✅' : '⚠️'} Capacity Check
              </span>
              <span style={{ fontSize: '0.85rem', color: '#374151' }}>
                Available caretaker hours: <strong>{totalTargetHrs}h</strong> &nbsp;|&nbsp;
                Client hours needed: <strong>{totalNeededHrs}h</strong> &nbsp;|&nbsp;
                {totalTargetHrs >= totalNeededHrs
                  ? <span style={{ color: '#059669' }}>+{(totalTargetHrs - totalNeededHrs).toFixed(1)}h buffer</span>
                  : <span style={{ color: '#D97706' }}>⚠ {(totalNeededHrs - totalTargetHrs).toFixed(1)}h shortfall</span>
                }
              </span>
            </div>
          )}

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.25rem', marginBottom: '1.5rem' }}>

            {/* ── Caretakers Panel ── */}
            <div className="card">
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.75rem' }}>
                <h4 style={{ margin: 0, color: '#1E40AF' }}>
                  👤 Caretakers
                  <span style={{ marginLeft: '0.5rem', fontSize: '0.75rem', background: '#DBEAFE', color: '#1E40AF', padding: '0.2rem 0.5rem', borderRadius: '12px' }}>
                    {activeCgCount} / {caregivers.length} active
                  </span>
                </h4>
                <div style={{ display: 'flex', gap: '0.4rem' }}>
                  <button onClick={() => toggleAllCg(true)} style={{ fontSize: '0.72rem', padding: '0.2rem 0.5rem', borderRadius: '5px', border: '1px solid #BFDBFE', background: '#EFF6FF', cursor: 'pointer', color: '#1E40AF' }}>All</button>
                  <button onClick={() => toggleAllCg(false)} style={{ fontSize: '0.72rem', padding: '0.2rem 0.5rem', borderRadius: '5px', border: '1px solid #E5E7EB', background: '#F9FAFB', cursor: 'pointer', color: '#6B7280' }}>None</button>
                </div>
              </div>

              <input
                placeholder="🔍 Filter caretakers..."
                value={cgFilter}
                onChange={e => setCgFilter(e.target.value)}
                style={{ width: '100%', padding: '0.45rem 0.6rem', borderRadius: '7px', border: '1px solid #E5E7EB', fontSize: '0.85rem', marginBottom: '0.75rem', boxSizing: 'border-box' }}
              />

              <div style={{ maxHeight: '420px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                {caregivers
                  .filter(cg => !cgFilter || `${cg.first_name} ${cg.last_name}`.toLowerCase().includes(cgFilter.toLowerCase()))
                  .map((cg, idx) => (
                  <div key={cg.id} style={{
                    display: 'flex', alignItems: 'center', gap: '0.6rem',
                    padding: '0.6rem 0.75rem', borderRadius: '8px',
                    background: cg.enabled ? '#F0F9FF' : '#F9FAFB',
                    border: `1.5px solid ${cg.enabled ? cgColorFor(cg.id) + '40' : '#E5E7EB'}`,
                    opacity: cg.enabled ? 1 : 0.55,
                  }}>
                    <input type="checkbox" checked={cg.enabled}
                      onChange={e => updateCg(cg.id, 'enabled', e.target.checked)}
                      style={{ cursor: 'pointer', width: 'auto', flexShrink: 0 }} />
                    <div style={{ width: '9px', height: '9px', borderRadius: '50%', background: cgColorFor(cg.id), flexShrink: 0 }} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontWeight: '600', fontSize: '0.88rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {cg.first_name} {cg.last_name}
                      </div>
                      <div style={{ fontSize: '0.72rem', color: '#6B7280' }}>
                        {cg.current_weekly_hours}h existing · {cg.active_client_count} clients
                      </div>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.3rem', flexShrink: 0 }}>
                      <span style={{ fontSize: '0.72rem', color: '#6B7280' }}>Target:</span>
                      <input
                        type="number" min="1" max="80" step="0.5"
                        value={cg.targetHours}
                        onChange={e => updateCg(cg.id, 'targetHours', parseFloat(e.target.value) || 0)}
                        disabled={!cg.enabled}
                        style={{ width: '52px', padding: '0.25rem 0.3rem', borderRadius: '6px', border: '1px solid #D1D5DB', fontSize: '0.85rem', textAlign: 'center' }}
                      />
                      <span style={{ fontSize: '0.72rem', color: '#6B7280' }}>h</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* ── Clients Panel ── */}
            <div className="card">
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.75rem' }}>
                <h4 style={{ margin: 0, color: '#065F46' }}>
                  🏥 Clients
                  <span style={{ marginLeft: '0.5rem', fontSize: '0.75rem', background: '#D1FAE5', color: '#065F46', padding: '0.2rem 0.5rem', borderRadius: '12px' }}>
                    {activeClCount} / {clients.length} active
                  </span>
                </h4>
                <div style={{ display: 'flex', gap: '0.4rem' }}>
                  <button onClick={() => toggleAllCl(true)} style={{ fontSize: '0.72rem', padding: '0.2rem 0.5rem', borderRadius: '5px', border: '1px solid #A7F3D0', background: '#ECFDF5', cursor: 'pointer', color: '#065F46' }}>All</button>
                  <button onClick={() => toggleAllCl(false)} style={{ fontSize: '0.72rem', padding: '0.2rem 0.5rem', borderRadius: '5px', border: '1px solid #E5E7EB', background: '#F9FAFB', cursor: 'pointer', color: '#6B7280' }}>None</button>
                </div>
              </div>

              <input
                placeholder="🔍 Filter clients..."
                value={clFilter}
                onChange={e => setClFilter(e.target.value)}
                style={{ width: '100%', padding: '0.45rem 0.6rem', borderRadius: '7px', border: '1px solid #E5E7EB', fontSize: '0.85rem', marginBottom: '0.75rem', boxSizing: 'border-box' }}
              />

              <div style={{ maxHeight: '420px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                {clients
                  .filter(cl => !clFilter || `${cl.first_name} ${cl.last_name}`.toLowerCase().includes(clFilter.toLowerCase()))
                  .map(cl => (
                  <div key={cl.id} style={{
                    padding: '0.6rem 0.75rem', borderRadius: '8px',
                    background: cl.enabled ? '#F0FDF4' : '#F9FAFB',
                    border: `1.5px solid ${cl.enabled ? '#A7F3D0' : '#E5E7EB'}`,
                    opacity: cl.enabled ? 1 : 0.55,
                  }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', marginBottom: cl.enabled ? '0.5rem' : 0 }}>
                      <input type="checkbox" checked={cl.enabled}
                        onChange={e => updateCl(cl.id, 'enabled', e.target.checked ? 1 : 0)}
                        style={{ cursor: 'pointer', width: 'auto', flexShrink: 0 }} />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontWeight: '600', fontSize: '0.88rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {cl.first_name} {cl.last_name}
                        </div>
                        {cl.scheduled_days?.length > 0 && (
                          <div style={{ display: 'flex', gap: '0.2rem', flexWrap: 'wrap', marginTop: '0.15rem' }}>
                            {cl.scheduled_days.map(d => (
                              <span key={d} style={{ fontSize: '0.65rem', padding: '0.1rem 0.3rem', borderRadius: '3px', background: DAY_COLORS[d] + '25', color: DAY_COLORS[d], fontWeight: '700' }}>
                                {DAY_NAMES[d]}
                              </span>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                    {cl.enabled && (
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.4rem' }}>
                        <div>
                          <label style={{ fontSize: '0.68rem', fontWeight: '700', color: '#374151', display: 'block', marginBottom: '0.15rem' }}>Hrs / Week</label>
                          <input type="number" min="0" max="80" step="0.25"
                            value={cl.hoursPerWeek}
                            onChange={e => updateCl(cl.id, 'hoursPerWeek', e.target.value)}
                            style={{ width: '100%', padding: '0.3rem', borderRadius: '6px', border: '1px solid #D1D5DB', fontSize: '0.85rem', boxSizing: 'border-box' }}
                          />
                        </div>
                        <div>
                          <label style={{ fontSize: '0.68rem', fontWeight: '700', color: '#374151', display: 'block', marginBottom: '0.15rem' }}>Visits / Week</label>
                          <input type="number" min="1" max="7"
                            value={cl.visitsPerWeek}
                            onChange={e => updateCl(cl.id, 'visitsPerWeek', e.target.value)}
                            style={{ width: '100%', padding: '0.3rem', borderRadius: '6px', border: '1px solid #D1D5DB', fontSize: '0.85rem', boxSizing: 'border-box' }}
                          />
                        </div>
                        {cl.hoursPerWeek > 0 && cl.visitsPerWeek > 0 && (
                          <div style={{ gridColumn: '1/-1', fontSize: '0.7rem', color: '#6B7280' }}>
                            ≈ {(cl.hoursPerWeek / cl.visitsPerWeek).toFixed(1)}h per visit
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>

          </div>

          {/* Generate button */}
          <div style={{ textAlign: 'center' }}>
            <button
              onClick={runOptimizer}
              disabled={running || activeCgCount === 0 || activeClCount === 0}
              style={{
                padding: '0.95rem 2.75rem', borderRadius: '10px', border: 'none', cursor: 'pointer',
                fontWeight: '700', fontSize: '1.05rem',
                background: running || activeCgCount === 0 || activeClCount === 0
                  ? '#9CA3AF'
                  : 'linear-gradient(135deg, #1e3a5f, #0f766e)',
                color: '#fff',
                boxShadow: running ? 'none' : '0 4px 18px rgba(15,118,110,0.4)',
                transition: 'all 0.2s',
              }}>
              {running ? '⏳ Analyzing roster...' : `✨ Generate Optimized Schedule (${activeCgCount} caretakers · ${activeClCount} clients)`}
            </button>
            {(activeCgCount === 0 || activeClCount === 0) && (
              <p style={{ margin: '0.5rem 0 0', fontSize: '0.82rem', color: '#9CA3AF' }}>
                Enable at least one caretaker and one client to continue
              </p>
            )}
          </div>
        </>
      )}

      {/* ═══════════════════════════ RESULTS STEP ═════════════════════════ */}
      {step === 'results' && result && (
        <div>
          {/* Summary stats */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: '0.75rem', marginBottom: '1.25rem' }}>
            {[
              { label: 'Proposals', value: result.summary.totalProposals, color: '#2563EB', bg: '#EFF6FF' },
              { label: 'Clients Covered', value: `${result.summary.fullyScheduledClients}/${result.summary.totalClients}`, color: '#059669', bg: '#F0FDF4' },
              { label: 'Conflicts', value: result.summary.conflictCount, color: result.summary.conflictCount > 0 ? '#DC2626' : '#059669', bg: result.summary.conflictCount > 0 ? '#FEF2F2' : '#F0FDF4' },
              { label: 'Unscheduled', value: result.summary.unscheduledCount, color: result.summary.unscheduledCount > 0 ? '#D97706' : '#059669', bg: result.summary.unscheduledCount > 0 ? '#FFFBEB' : '#F0FDF4' },
            ].map(s => (
              <div key={s.label} className="card" style={{ textAlign: 'center', padding: '0.75rem', background: s.bg }}>
                <div style={{ fontSize: '1.85rem', fontWeight: '800', color: s.color }}>{s.value}</div>
                <div style={{ fontSize: '0.78rem', color: '#6B7280' }}>{s.label}</div>
              </div>
            ))}
          </div>

          {/* Caregiver utilization bars */}
          <div className="card" style={{ marginBottom: '1.25rem' }}>
            <h4 style={{ margin: '0 0 0.75rem' }}>👤 Caretaker Utilization</h4>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.75rem' }}>
              {result.summary.caregivers.map(cg => (
                <div key={cg.id} style={{ flex: '1 1 200px', padding: '0.75rem', background: '#F9FAFB', borderRadius: '8px', borderLeft: `4px solid ${cgColorFor(cg.id)}` }}>
                  <div style={{ fontWeight: '700', fontSize: '0.88rem', marginBottom: '0.3rem' }}>{cg.name}</div>
                  <div style={{ fontSize: '0.75rem', color: '#6B7280', marginBottom: '0.35rem' }}>
                    {cg.existingHours}h existing + {cg.proposedNewHours}h new = <strong style={{ color: '#111' }}>{cg.totalHours}h</strong> / {cg.targetHours}h target
                  </div>
                  <div style={{ height: '7px', background: '#E5E7EB', borderRadius: '4px', overflow: 'hidden' }}>
                    <div style={{
                      width: `${cg.utilizationPct}%`, height: '100%',
                      background: cg.utilizationPct > 100 ? '#DC2626' : cgColorFor(cg.id),
                      transition: 'width 0.4s',
                    }} />
                  </div>
                  <div style={{ fontSize: '0.7rem', marginTop: '0.25rem', color: cg.remainingCapacity > 0 ? '#059669' : '#6B7280' }}>
                    {cg.utilizationPct}% utilized
                    {cg.remainingCapacity > 0 && ` · ${cg.remainingCapacity}h open`}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Client coverage */}
          <div className="card" style={{ marginBottom: '1.25rem' }}>
            <h4 style={{ margin: '0 0 0.75rem' }}>🏥 Client Coverage</h4>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.6rem' }}>
              {result.summary.clients.map(cl => (
                <div key={cl.id} style={{
                  flex: '1 1 150px', padding: '0.6rem 0.75rem', borderRadius: '8px',
                  background: cl.fullyScheduled ? '#F0FDF4' : '#FFFBEB',
                  border: `1.5px solid ${cl.fullyScheduled ? '#A7F3D0' : '#FDE68A'}`,
                }}>
                  <div style={{ fontWeight: '700', fontSize: '0.85rem', marginBottom: '0.2rem' }}>{cl.name}</div>
                  <div style={{ fontSize: '0.8rem' }}>
                    {cl.fullyScheduled
                      ? <span style={{ color: '#059669' }}>✅ {cl.visitsPlaced}/{cl.visitsNeeded} visits</span>
                      : <span style={{ color: '#D97706' }}>⚠ {cl.visitsPlaced}/{cl.visitsNeeded} visits</span>}
                  </div>
                  <div style={{ fontSize: '0.72rem', color: '#6B7280' }}>{cl.hoursPerWeek}h/wk</div>
                </div>
              ))}
            </div>
          </div>

          {/* Unscheduled warnings */}
          {result.unscheduled.length > 0 && (
            <div style={{ padding: '0.875rem 1rem', background: '#FFFBEB', border: '1px solid #FDE68A', borderRadius: '8px', marginBottom: '1.25rem' }}>
              <div style={{ fontWeight: '700', color: '#92400E', marginBottom: '0.4rem' }}>⚠️ Could Not Schedule</div>
              {result.unscheduled.map((u, i) => (
                <div key={i} style={{ fontSize: '0.85rem', color: '#B45309' }}>
                  {u.clientName} — Visit {u.visitNumber}: {u.reason}
                </div>
              ))}
            </div>
          )}

          {/* View toggle + proposals */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem', flexWrap: 'wrap', gap: '0.5rem' }}>
            <h4 style={{ margin: 0 }}>📋 Proposed Schedule
              <span style={{ marginLeft: '0.5rem', fontSize: '0.8rem', color: '#6B7280', fontWeight: '400' }}>
                ({selected.size} of {result.proposals.length} selected)
              </span>
            </h4>
            <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
              <button onClick={() => setSelected(result.proposals.size === selected.size ? new Set() : new Set(result.proposals.map(p => p.id)))}
                style={{ padding: '0.3rem 0.75rem', borderRadius: '6px', border: '1px solid #D1D5DB', background: '#fff', fontSize: '0.78rem', cursor: 'pointer' }}>
                {selected.size === result.proposals.length ? 'Deselect All' : 'Select All'}
              </button>
              {['grid','list'].map(v => (
                <button key={v} onClick={() => setViewMode(v)}
                  style={{ padding: '0.3rem 0.75rem', borderRadius: '6px', border: 'none', fontSize: '0.78rem', cursor: 'pointer',
                    background: viewMode === v ? '#1d4ed8' : '#F3F4F6',
                    color: viewMode === v ? '#fff' : '#374151' }}>
                  {v.charAt(0).toUpperCase() + v.slice(1)}
                </button>
              ))}
            </div>
          </div>

          {/* GRID VIEW */}
          {viewMode === 'grid' && (
            <div style={{ overflowX: 'auto', marginBottom: '1.25rem' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: '700px' }}>
                <thead>
                  <tr style={{ background: '#F9FAFB' }}>
                    <th style={{ padding: '0.6rem 0.75rem', textAlign: 'left', fontSize: '0.8rem', color: '#6B7280', fontWeight: '600', borderBottom: '2px solid #E5E7EB', whiteSpace: 'nowrap' }}>Caretaker</th>
                    {DAY_NAMES.map(d => (
                      <th key={d} style={{ padding: '0.6rem 0.4rem', textAlign: 'center', fontSize: '0.8rem', color: '#6B7280', fontWeight: '600', borderBottom: '2px solid #E5E7EB', minWidth: '85px' }}>{d}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {result.summary.caregivers.map(cg => (
                    <tr key={cg.id} style={{ borderBottom: '1px solid #F3F4F6' }}>
                      <td style={{ padding: '0.4rem 0.75rem', verticalAlign: 'top' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                          <div style={{ width: '8px', height: '8px', borderRadius: '50%', background: cgColorFor(cg.id), flexShrink: 0 }} />
                          <span style={{ fontSize: '0.83rem', fontWeight: '600', whiteSpace: 'nowrap' }}>{cg.name.split(' ')[0]}</span>
                        </div>
                        <div style={{ fontSize: '0.68rem', color: '#9CA3AF', paddingLeft: '1.1rem' }}>{cg.totalHours}/{cg.targetHours}h</div>
                      </td>
                      {[0,1,2,3,4,5,6].map(day => {
                        const existing = result.existingSchedules.filter(s => s.caregiverId === cg.id && s.dayOfWeek === day);
                        const proposed = result.proposals.filter(p => p.caregiverId === cg.id && p.dayOfWeek === day);
                        return (
                          <td key={day} style={{ padding: '0.2rem', verticalAlign: 'top' }}>
                            {existing.map(s => (
                              <div key={s.id} title="Existing — not changed" style={{ fontSize: '0.65rem', padding: '0.2rem 0.3rem', marginBottom: '0.15rem', borderRadius: '4px', background: '#F3F4F6', borderLeft: `3px solid ${cgColorFor(cg.id)}60`, color: '#9CA3AF' }}>
                                <div style={{ fontWeight: '600', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.clientName?.split(' ')[0]}</div>
                                <div>{fmtTime(s.startTime)}</div>
                              </div>
                            ))}
                            {proposed.map(p => (
                              <div key={p.id} onClick={() => toggleProposal(p.id)}
                                title={p.hasConflict ? `⚠ Overlaps: ${p.conflictsWith.map(c => c.clientName).join(', ')}` : 'Click to toggle'}
                                style={{ fontSize: '0.65rem', padding: '0.2rem 0.3rem', marginBottom: '0.15rem', borderRadius: '4px', cursor: 'pointer',
                                  background: selected.has(p.id) ? (p.hasConflict ? '#FEE2E2' : '#DBEAFE') : '#fff',
                                  borderLeft: `3px solid ${p.hasConflict ? '#DC2626' : cgColorFor(p.caregiverId)}`,
                                  border: `1px solid ${p.hasConflict ? '#FCA5A5' : '#BFDBFE'}`,
                                  opacity: selected.has(p.id) ? 1 : 0.45,
                                }}>
                                <div style={{ fontWeight: '700', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                  {p.hasConflict ? '⚠ ' : '✦ '}{p.clientName?.split(' ')[0]}
                                </div>
                                <div>{fmtTime(p.startTime)}–{fmtTime(p.endTime)}</div>
                              </div>
                            ))}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
              <div style={{ display: 'flex', gap: '1.25rem', fontSize: '0.72rem', color: '#6B7280', marginTop: '0.5rem', flexWrap: 'wrap' }}>
                <span>◻ Grey = existing (unchanged)</span>
                <span style={{ color: '#1D4ED8' }}>🔷 Blue = proposed new (selected)</span>
                <span style={{ color: '#DC2626' }}>🔴 Red = conflict (review before applying)</span>
                <span>Click any proposal to toggle</span>
              </div>
            </div>
          )}

          {/* LIST VIEW */}
          {viewMode === 'list' && (
            <div style={{ marginBottom: '1.25rem', display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
              {result.proposals.map(p => (
                <div key={p.id} onClick={() => toggleProposal(p.id)}
                  style={{
                    display: 'flex', alignItems: 'flex-start', gap: '0.75rem',
                    padding: '0.7rem 0.9rem', borderRadius: '8px', cursor: 'pointer',
                    background: selected.has(p.id) ? (p.hasConflict ? '#FEF2F2' : '#EFF6FF') : '#FAFAFA',
                    border: `1.5px solid ${selected.has(p.id) ? (p.hasConflict ? '#FCA5A5' : '#BFDBFE') : '#E5E7EB'}`,
                  }}>
                  <input type="checkbox" checked={selected.has(p.id)} onChange={() => {}} style={{ width: 'auto', cursor: 'pointer', marginTop: '2px' }} />
                  <div style={{ width: '9px', height: '9px', borderRadius: '50%', background: cgColorFor(p.caregiverId), flexShrink: 0, marginTop: '4px' }} />
                  <div style={{ flex: 1 }}>
                    <div style={{ fontWeight: '600', fontSize: '0.88rem' }}>
                      {p.clientName}
                      {p.hasConflict && <span style={{ marginLeft: '0.4rem', fontSize: '0.68rem', padding: '0.1rem 0.4rem', background: '#FEE2E2', color: '#DC2626', borderRadius: '4px' }}>⚠ CONFLICT</span>}
                    </div>
                    <div style={{ fontSize: '0.78rem', color: '#6B7280' }}>
                      {p.caregiverName} · {p.dayName} {fmtTime(p.startTime)}–{fmtTime(p.endTime)} ({p.hoursPerVisit}h)
                    </div>
                    {p.hasConflict && p.conflictsWith.map((c, i) => (
                      <div key={i} style={{ fontSize: '0.73rem', color: '#DC2626', marginTop: '0.15rem' }}>
                        ⚠ Overlaps {c.clientName} ({fmtTime(c.start)}–{fmtTime(c.end)})
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Action bar */}
          <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'flex-end', alignItems: 'center', padding: '1rem', background: '#F9FAFB', borderRadius: '10px' }}>
            <button onClick={() => setStep('setup')}
              style={{ padding: '0.7rem 1.4rem', borderRadius: '8px', border: '1.5px solid #D1D5DB', background: '#fff', cursor: 'pointer', fontWeight: '600', fontSize: '0.88rem' }}>
              ← Back to Setup
            </button>
            <button onClick={runOptimizer} disabled={running}
              style={{ padding: '0.7rem 1.4rem', borderRadius: '8px', border: 'none', background: '#F3F4F6', cursor: 'pointer', fontWeight: '600', fontSize: '0.88rem' }}>
              🔄 Re-run
            </button>
            <button onClick={applyProposals} disabled={applying || selected.size === 0}
              style={{
                padding: '0.7rem 1.75rem', borderRadius: '8px', border: 'none', cursor: 'pointer',
                fontWeight: '700', fontSize: '0.95rem',
                background: applying || selected.size === 0 ? '#9CA3AF' : 'linear-gradient(135deg, #059669, #0f766e)',
                color: '#fff', boxShadow: applying || selected.size === 0 ? 'none' : '0 4px 12px rgba(5,150,105,0.35)',
              }}>
              {applying ? 'Applying...' : `✅ Apply ${selected.size} to Live Schedule`}
            </button>
          </div>
          <p style={{ fontSize: '0.75rem', color: '#9CA3AF', textAlign: 'center', margin: '0.5rem 0 0' }}>
            Only checked proposals apply. Conflicts are unchecked by default — review before including.
          </p>
        </div>
      )}
    </div>
  );
}
