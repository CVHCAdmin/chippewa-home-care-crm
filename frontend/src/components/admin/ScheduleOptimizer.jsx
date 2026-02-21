// ScheduleOptimizer.jsx
// Sandbox schedule builder — pick clients & caregivers, set hours/visits,
// generate an optimized proposal, review it, then apply to live schedules.
// Does NOT touch any live data until "Apply to Schedule" is clicked.

import React, { useState, useEffect, useCallback } from 'react';
import { API_BASE_URL } from '../../config';

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const DAY_COLORS = ['#8B5CF6','#3B82F6','#10B981','#F59E0B','#EF4444','#EC4899','#06B6D4'];

export default function ScheduleOptimizer({ token, caregivers: allCaregivers, clients: allClients }) {
  // ── State ──────────────────────────────────────────────────────────────────
  const [selectedCaregivers, setSelectedCaregivers] = useState([]); // [{id, name, allocatedHours}]
  const [selectedClients, setSelectedClients]       = useState([]); // [{id, name, hoursPerWeek, visitsPerWeek, auth}]
  const [cgDropdown, setCgDropdown]   = useState('');
  const [clDropdown, setClDropdown]   = useState('');
  const [loadingClient, setLoadingClient] = useState(null);

  const [result, setResult]       = useState(null); // optimizer result
  const [running, setRunning]     = useState(false);
  const [applying, setApplying]   = useState(false);
  const [toast, setToast]         = useState(null);
  const [activeView, setActiveView] = useState('grid'); // 'grid' | 'list'
  const [selectedProposals, setSelectedProposals] = useState(new Set()); // which proposals to apply

  const showToast = (msg, type = 'success') => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 4000);
  };

  const api = useCallback(async (url, opts = {}) => {
    const res = await fetch(`${API_BASE_URL}${url}`, {
      ...opts,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, ...opts.headers }
    });
    if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error(e.error || `${res.status}`); }
    return res.json();
  }, [token]);

  // ── Add / Remove Caregivers ────────────────────────────────────────────────
  const addCaregiver = (id) => {
    if (!id || selectedCaregivers.find(c => c.id === id)) return;
    const cg = allCaregivers.find(c => c.id === id);
    if (!cg) return;
    setSelectedCaregivers(prev => [...prev, { id, name: `${cg.first_name} ${cg.last_name}`, allocatedHours: 40 }]);
    setCgDropdown('');
  };

  const removeCaregiver = (id) => setSelectedCaregivers(prev => prev.filter(c => c.id !== id));

  const updateCgHours = (id, hours) =>
    setSelectedCaregivers(prev => prev.map(c => c.id === id ? { ...c, allocatedHours: parseFloat(hours) || 0 } : c));

  // ── Add / Remove Clients ───────────────────────────────────────────────────
  const addClient = async (id) => {
    if (!id || selectedClients.find(c => c.id === id)) return;
    const cl = allClients.find(c => c.id === id);
    if (!cl) return;

    setLoadingClient(id);
    setClDropdown('');
    try {
      const data = await api(`/api/optimizer/client-data/${id}`);
      setSelectedClients(prev => [...prev, {
        id,
        name: `${cl.first_name} ${cl.last_name}`,
        hoursPerWeek: data.assignedHoursPerWeek || data.authorizedHoursPerWeek || 0,
        visitsPerWeek: suggestVisits(data.assignedHoursPerWeek || data.authorizedHoursPerWeek || 0),
        authorizedHoursPerWeek: data.authorizedHoursPerWeek,
        remainingHours: data.remainingHours,
        existingDays: data.existingScheduleDays || [],
        auth: data.authorization
      }]);
    } catch {
      setSelectedClients(prev => [...prev, {
        id, name: `${cl.first_name} ${cl.last_name}`,
        hoursPerWeek: 0, visitsPerWeek: 3,
        authorizedHoursPerWeek: 0, remainingHours: 0,
        existingDays: [], auth: null
      }]);
    } finally {
      setLoadingClient(null);
    }
  };

  const removeClient = (id) => setSelectedClients(prev => prev.filter(c => c.id !== id));

  const updateClientField = (id, field, value) =>
    setSelectedClients(prev => prev.map(c => c.id === id ? { ...c, [field]: parseFloat(value) || 0 } : c));

  // ── Run Optimizer ──────────────────────────────────────────────────────────
  const runOptimizer = async () => {
    if (!selectedCaregivers.length || !selectedClients.length) {
      showToast('Add at least one caregiver and one client', 'error'); return;
    }
    setRunning(true);
    setResult(null);
    try {
      const data = await api('/api/optimizer/run', {
        method: 'POST',
        body: JSON.stringify({
          caregivers: selectedCaregivers.map(c => ({ id: c.id, allocatedHours: c.allocatedHours })),
          clients: selectedClients.map(c => ({ id: c.id, visitsPerWeek: c.visitsPerWeek, hoursPerWeek: c.hoursPerWeek }))
        })
      });
      setResult(data);
      // Select all non-conflict proposals by default
      setSelectedProposals(new Set(data.proposals.filter(p => !p.hasConflict).map(p => p.id)));
    } catch (e) {
      showToast('Optimizer failed: ' + e.message, 'error');
    } finally {
      setRunning(false);
    }
  };

  // ── Apply Selected Proposals ───────────────────────────────────────────────
  const applyProposals = async () => {
    if (!result || selectedProposals.size === 0) return;
    const toApply = result.proposals.filter(p => selectedProposals.has(p.id));
    setApplying(true);
    try {
      const data = await api('/api/optimizer/apply', {
        method: 'POST',
        body: JSON.stringify({ proposals: toApply })
      });
      showToast(`✅ Applied ${data.created} schedule${data.created !== 1 ? 's' : ''} to live schedule!`);
      if (data.errors > 0) showToast(`⚠️ ${data.errors} failed to save`, 'error');
      setResult(null);
      setSelectedCaregivers([]);
      setSelectedClients([]);
    } catch (e) {
      showToast('Failed to apply: ' + e.message, 'error');
    } finally {
      setApplying(false);
    }
  };

  const toggleProposal = (id) => {
    setSelectedProposals(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const toggleAll = () => {
    if (selectedProposals.size === result?.proposals.length) setSelectedProposals(new Set());
    else setSelectedProposals(new Set(result?.proposals.map(p => p.id)));
  };

  // ── Helpers ────────────────────────────────────────────────────────────────
  const fmtTime = (t) => {
    if (!t) return '';
    const [h, m] = t.split(':');
    const hour = parseInt(h);
    return `${hour % 12 || 12}:${m}${hour >= 12 ? 'pm' : 'am'}`;
  };

  const cgColor = (id) => {
    const idx = allCaregivers.findIndex(c => c.id === id);
    const colors = ['#3B82F6','#10B981','#F59E0B','#EF4444','#8B5CF6','#EC4899','#06B6D4','#84CC16'];
    return colors[idx % colors.length] || '#6B7280';
  };

  // ── Render ─────────────────────────────────────────────────────────────────
  const availCaregivers = allCaregivers.filter(c => !selectedCaregivers.find(s => s.id === c.id));
  const availClients = allClients.filter(c => !selectedClients.find(s => s.id === c.id));

  return (
    <div>
      {/* Toast */}
      {toast && (
        <div style={{
          position: 'fixed', top: '1rem', right: '1rem', zIndex: 9999,
          padding: '0.75rem 1.25rem', borderRadius: '10px', fontWeight: '600',
          background: toast.type === 'error' ? '#FEE2E2' : '#D1FAE5',
          color: toast.type === 'error' ? '#DC2626' : '#065F46',
          boxShadow: '0 4px 12px rgba(0,0,0,0.15)'
        }}>{toast.msg}</div>
      )}

      {/* Intro Banner */}
      <div style={{ background: 'linear-gradient(135deg, #0f766e 0%, #1d4ed8 100%)', borderRadius: '12px', padding: '1.25rem 1.5rem', marginBottom: '1.5rem', color: '#fff' }}>
        <h3 style={{ margin: '0 0 0.4rem', fontSize: '1.1rem' }}>🧠 Schedule Optimizer</h3>
        <p style={{ margin: 0, fontSize: '0.88rem', opacity: 0.9 }}>
          Pick the clients and caretakers you want to work with. Set how many hours each caretaker gets and how many visits each client needs.
          The optimizer reads existing schedules and builds the best arrangement — then you review it before anything changes.
        </p>
      </div>

      {/* Setup Panel */}
      {!result && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.25rem', marginBottom: '1.5rem' }}>
          {/* Caretakers Column */}
          <div className="card">
            <h4 style={{ margin: '0 0 1rem', color: '#1E40AF', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              👤 Caretakers
              <span style={{ marginLeft: 'auto', fontSize: '0.75rem', background: '#DBEAFE', color: '#1E40AF', padding: '0.2rem 0.5rem', borderRadius: '12px' }}>
                {selectedCaregivers.length} added
              </span>
            </h4>

            {/* Add Caretaker Dropdown */}
            <select value={cgDropdown} onChange={e => addCaregiver(e.target.value)}
              style={{ width: '100%', padding: '0.6rem', borderRadius: '8px', border: '2px solid #BFDBFE', marginBottom: '1rem', fontSize: '0.9rem' }}>
              <option value="">+ Add a caretaker...</option>
              {availCaregivers.map(cg => (
                <option key={cg.id} value={cg.id}>{cg.first_name} {cg.last_name}</option>
              ))}
            </select>

            {/* Caretaker Cards */}
            {selectedCaregivers.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '1.5rem', color: '#9CA3AF', fontSize: '0.88rem' }}>
                No caretakers added yet
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
                {selectedCaregivers.map(cg => (
                  <div key={cg.id} style={{
                    display: 'flex', alignItems: 'center', gap: '0.75rem',
                    padding: '0.75rem', borderRadius: '8px',
                    background: '#F8FAFF', border: `2px solid ${cgColor(cg.id)}30`
                  }}>
                    <div style={{ width: '10px', height: '10px', borderRadius: '50%', background: cgColor(cg.id), flexShrink: 0 }} />
                    <div style={{ flex: 1, fontWeight: '600', fontSize: '0.9rem' }}>{cg.name}</div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                      <label style={{ fontSize: '0.78rem', color: '#6B7280', whiteSpace: 'nowrap' }}>Hrs/wk:</label>
                      <input
                        type="number" min="1" max="80" step="0.5"
                        value={cg.allocatedHours}
                        onChange={e => updateCgHours(cg.id, e.target.value)}
                        style={{ width: '60px', padding: '0.3rem 0.4rem', borderRadius: '6px', border: '1px solid #D1D5DB', fontSize: '0.9rem', textAlign: 'center' }}
                      />
                    </div>
                    <button onClick={() => removeCaregiver(cg.id)}
                      style={{ background: 'none', border: 'none', color: '#DC2626', cursor: 'pointer', fontSize: '1rem', padding: '0.2rem' }}>✕</button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Clients Column */}
          <div className="card">
            <h4 style={{ margin: '0 0 1rem', color: '#065F46', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              🏥 Clients
              <span style={{ marginLeft: 'auto', fontSize: '0.75rem', background: '#D1FAE5', color: '#065F46', padding: '0.2rem 0.5rem', borderRadius: '12px' }}>
                {selectedClients.length} added
              </span>
            </h4>

            {/* Add Client Dropdown */}
            <select value={clDropdown} onChange={e => addClient(e.target.value)}
              disabled={loadingClient !== null}
              style={{ width: '100%', padding: '0.6rem', borderRadius: '8px', border: '2px solid #A7F3D0', marginBottom: '1rem', fontSize: '0.9rem' }}>
              <option value="">{loadingClient ? 'Loading...' : '+ Add a client...'}</option>
              {availClients.map(cl => (
                <option key={cl.id} value={cl.id}>{cl.first_name} {cl.last_name}</option>
              ))}
            </select>

            {/* Client Cards */}
            {selectedClients.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '1.5rem', color: '#9CA3AF', fontSize: '0.88rem' }}>
                No clients added yet
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
                {selectedClients.map(cl => (
                  <div key={cl.id} style={{
                    padding: '0.75rem', borderRadius: '8px',
                    background: '#F0FDF4', border: '1.5px solid #A7F3D0'
                  }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '0.5rem' }}>
                      <div style={{ fontWeight: '600', fontSize: '0.9rem' }}>{cl.name}</div>
                      <button onClick={() => removeClient(cl.id)}
                        style={{ background: 'none', border: 'none', color: '#DC2626', cursor: 'pointer', fontSize: '1rem', padding: '0' }}>✕</button>
                    </div>

                    {/* Auth info badge */}
                    {cl.auth && (
                      <div style={{ fontSize: '0.75rem', color: '#065F46', background: '#D1FAE5', padding: '0.2rem 0.5rem', borderRadius: '6px', display: 'inline-block', marginBottom: '0.5rem' }}>
                        ✓ Auth: {cl.authorizedHoursPerWeek}h/wk · {cl.remainingHours}h remaining
                      </div>
                    )}
                    {!cl.auth && (
                      <div style={{ fontSize: '0.75rem', color: '#D97706', background: '#FEF3C7', padding: '0.2rem 0.5rem', borderRadius: '6px', display: 'inline-block', marginBottom: '0.5rem' }}>
                        ⚠ No active authorization found
                      </div>
                    )}

                    {/* Existing schedule days */}
                    {cl.existingDays?.length > 0 && (
                      <div style={{ display: 'flex', gap: '0.3rem', flexWrap: 'wrap', marginBottom: '0.5rem' }}>
                        <span style={{ fontSize: '0.72rem', color: '#6B7280' }}>Already scheduled:</span>
                        {cl.existingDays.map(d => (
                          <span key={d} style={{ fontSize: '0.72rem', padding: '0.1rem 0.4rem', borderRadius: '4px', background: DAY_COLORS[d] + '20', color: DAY_COLORS[d], fontWeight: '600' }}>
                            {DAY_NAMES[d]}
                          </span>
                        ))}
                      </div>
                    )}

                    {/* Editable fields */}
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem' }}>
                      <div>
                        <label style={{ fontSize: '0.72rem', fontWeight: '700', color: '#374151', display: 'block', marginBottom: '0.2rem' }}>Hours/Week</label>
                        <input
                          type="number" min="0" max="80" step="0.25"
                          value={cl.hoursPerWeek}
                          onChange={e => updateClientField(cl.id, 'hoursPerWeek', e.target.value)}
                          style={{ width: '100%', padding: '0.35rem', borderRadius: '6px', border: '1px solid #D1D5DB', fontSize: '0.9rem' }}
                        />
                      </div>
                      <div>
                        <label style={{ fontSize: '0.72rem', fontWeight: '700', color: '#374151', display: 'block', marginBottom: '0.2rem' }}>Visits/Week</label>
                        <input
                          type="number" min="1" max="7"
                          value={cl.visitsPerWeek}
                          onChange={e => updateClientField(cl.id, 'visitsPerWeek', e.target.value)}
                          style={{ width: '100%', padding: '0.35rem', borderRadius: '6px', border: '1px solid #D1D5DB', fontSize: '0.9rem' }}
                        />
                      </div>
                    </div>
                    {cl.hoursPerWeek > 0 && cl.visitsPerWeek > 0 && (
                      <div style={{ fontSize: '0.72rem', color: '#6B7280', marginTop: '0.35rem' }}>
                        ≈ {(cl.hoursPerWeek / cl.visitsPerWeek).toFixed(1)}h per visit
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Generate Button */}
      {!result && (
        <div style={{ textAlign: 'center', marginBottom: '1.5rem' }}>
          <button
            onClick={runOptimizer}
            disabled={running || !selectedCaregivers.length || !selectedClients.length}
            style={{
              padding: '0.9rem 2.5rem', borderRadius: '10px', border: 'none', cursor: 'pointer',
              fontWeight: '700', fontSize: '1.05rem',
              background: running ? '#9CA3AF' : 'linear-gradient(135deg, #0f766e, #1d4ed8)',
              color: '#fff', boxShadow: running ? 'none' : '0 4px 15px rgba(15,118,110,0.4)'
            }}>
            {running ? '⏳ Analyzing schedules...' : '✨ Generate Optimized Schedule'}
          </button>
          {(!selectedCaregivers.length || !selectedClients.length) && (
            <p style={{ margin: '0.5rem 0 0', fontSize: '0.82rem', color: '#9CA3AF' }}>
              Add at least one caretaker and one client to begin
            </p>
          )}
        </div>
      )}

      {/* ── RESULTS ───────────────────────────────────────────────────────── */}
      {result && (
        <div>
          {/* Summary Bar */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '0.75rem', marginBottom: '1.25rem' }}>
            {[
              { label: 'Proposals', value: result.summary.totalProposals, color: '#2563EB', bg: '#EFF6FF' },
              { label: 'Clean', value: result.summary.totalProposals - result.summary.conflictCount, color: '#059669', bg: '#F0FDF4' },
              { label: 'Conflicts', value: result.summary.conflictCount, color: result.summary.conflictCount > 0 ? '#DC2626' : '#059669', bg: result.summary.conflictCount > 0 ? '#FEF2F2' : '#F0FDF4' },
              { label: 'Unscheduled', value: result.summary.unscheduledCount, color: result.summary.unscheduledCount > 0 ? '#D97706' : '#059669', bg: result.summary.unscheduledCount > 0 ? '#FFFBEB' : '#F0FDF4' }
            ].map(s => (
              <div key={s.label} className="card" style={{ textAlign: 'center', padding: '0.75rem', background: s.bg }}>
                <div style={{ fontSize: '1.8rem', fontWeight: '800', color: s.color }}>{s.value}</div>
                <div style={{ fontSize: '0.78rem', color: '#6B7280' }}>{s.label}</div>
              </div>
            ))}
          </div>

          {/* Caregiver Summary */}
          <div className="card" style={{ marginBottom: '1.25rem' }}>
            <h4 style={{ margin: '0 0 0.75rem' }}>👤 Caretaker Hour Summary</h4>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.75rem' }}>
              {result.summary.caregivers.map(cg => (
                <div key={cg.id} style={{ flex: '1 1 180px', padding: '0.75rem', background: '#F9FAFB', borderRadius: '8px', borderLeft: `4px solid ${cgColor(cg.id)}` }}>
                  <div style={{ fontWeight: '700', fontSize: '0.9rem', marginBottom: '0.35rem' }}>{cg.name}</div>
                  <div style={{ fontSize: '0.78rem', color: '#6B7280', marginBottom: '0.4rem' }}>
                    {cg.existingHours}h existing + {cg.proposedNewHours}h new = <strong style={{ color: '#374151' }}>{cg.totalHours}h</strong> / {cg.allocatedHours}h
                  </div>
                  <div style={{ height: '6px', background: '#E5E7EB', borderRadius: '3px', overflow: 'hidden' }}>
                    <div style={{
                      width: `${Math.min((cg.totalHours / cg.allocatedHours) * 100, 100)}%`,
                      height: '100%',
                      background: cg.totalHours > cg.allocatedHours ? '#DC2626' : cgColor(cg.id)
                    }} />
                  </div>
                  {cg.remainingHours > 0 && (
                    <div style={{ fontSize: '0.72rem', color: '#059669', marginTop: '0.25rem' }}>{cg.remainingHours}h remaining capacity</div>
                  )}
                </div>
              ))}
            </div>
          </div>

          {/* Client Summary */}
          <div className="card" style={{ marginBottom: '1.25rem' }}>
            <h4 style={{ margin: '0 0 0.75rem' }}>🏥 Client Coverage</h4>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.75rem' }}>
              {result.summary.clients.map(cl => (
                <div key={cl.id} style={{
                  flex: '1 1 160px', padding: '0.75rem', borderRadius: '8px',
                  background: cl.fullyScheduled ? '#F0FDF4' : '#FFFBEB',
                  border: `1.5px solid ${cl.fullyScheduled ? '#A7F3D0' : '#FDE68A'}`
                }}>
                  <div style={{ fontWeight: '700', fontSize: '0.88rem', marginBottom: '0.25rem' }}>{cl.name}</div>
                  <div style={{ fontSize: '0.82rem' }}>
                    {cl.fullyScheduled
                      ? <span style={{ color: '#059669' }}>✅ {cl.visitsPlaced}/{cl.visitsNeeded} visits</span>
                      : <span style={{ color: '#D97706' }}>⚠ {cl.visitsPlaced}/{cl.visitsNeeded} visits</span>}
                  </div>
                  <div style={{ fontSize: '0.75rem', color: '#6B7280' }}>{cl.hoursPerWeek}h/week</div>
                </div>
              ))}
            </div>
          </div>

          {/* Unscheduled Warnings */}
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

          {/* View Toggle */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
            <h4 style={{ margin: 0 }}>📋 Proposed Schedule</h4>
            <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
              <button onClick={toggleAll} style={{ padding: '0.3rem 0.75rem', borderRadius: '6px', border: '1px solid #D1D5DB', background: '#fff', fontSize: '0.8rem', cursor: 'pointer' }}>
                {selectedProposals.size === result.proposals.length ? 'Deselect All' : 'Select All'}
              </button>
              <button onClick={() => setActiveView('grid')}
                style={{ padding: '0.3rem 0.75rem', borderRadius: '6px', border: 'none', fontSize: '0.8rem', cursor: 'pointer',
                  background: activeView === 'grid' ? '#1d4ed8' : '#F3F4F6', color: activeView === 'grid' ? '#fff' : '#374151' }}>
                Grid
              </button>
              <button onClick={() => setActiveView('list')}
                style={{ padding: '0.3rem 0.75rem', borderRadius: '6px', border: 'none', fontSize: '0.8rem', cursor: 'pointer',
                  background: activeView === 'list' ? '#1d4ed8' : '#F3F4F6', color: activeView === 'list' ? '#fff' : '#374151' }}>
                List
              </button>
            </div>
          </div>

          {/* GRID VIEW */}
          {activeView === 'grid' && (
            <div style={{ overflowX: 'auto', marginBottom: '1.25rem' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: '650px' }}>
                <thead>
                  <tr style={{ background: '#F9FAFB' }}>
                    <th style={{ padding: '0.6rem 0.75rem', textAlign: 'left', fontSize: '0.82rem', color: '#6B7280', fontWeight: '600', borderBottom: '2px solid #E5E7EB' }}>Caretaker</th>
                    {DAY_NAMES.map((d, i) => (
                      <th key={d} style={{ padding: '0.6rem 0.5rem', textAlign: 'center', fontSize: '0.82rem', color: '#6B7280', fontWeight: '600', borderBottom: '2px solid #E5E7EB', minWidth: '90px' }}>
                        {d}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {result.summary.caregivers.map(cg => (
                    <tr key={cg.id} style={{ borderBottom: '1px solid #F3F4F6' }}>
                      <td style={{ padding: '0.5rem 0.75rem', verticalAlign: 'top' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                          <div style={{ width: '8px', height: '8px', borderRadius: '50%', background: cgColor(cg.id) }} />
                          <span style={{ fontSize: '0.85rem', fontWeight: '600' }}>{cg.name.split(' ')[0]}</span>
                        </div>
                      </td>
                      {[0,1,2,3,4,5,6].map(day => {
                        // Existing schedules for this caregiver on this day
                        const existing = result.existingSchedules.filter(s => s.caregiverId === cg.id && s.dayOfWeek === day);
                        // New proposals for this caregiver on this day
                        const proposed = result.proposals.filter(p => p.caregiverId === cg.id && p.dayOfWeek === day);
                        return (
                          <td key={day} style={{ padding: '0.25rem', verticalAlign: 'top' }}>
                            {/* Existing (greyed) */}
                            {existing.map(s => (
                              <div key={s.id} style={{ fontSize: '0.68rem', padding: '0.2rem 0.3rem', marginBottom: '0.2rem', borderRadius: '4px', background: '#F3F4F6', borderLeft: `3px solid ${cgColor(cg.id)}80`, color: '#6B7280' }}
                                title="Existing schedule">
                                <div style={{ fontWeight: '600', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.clientName?.split(' ')[0]}</div>
                                <div>{fmtTime(s.startTime)}</div>
                              </div>
                            ))}
                            {/* Proposed */}
                            {proposed.map(p => (
                              <div key={p.id}
                                onClick={() => toggleProposal(p.id)}
                                style={{ fontSize: '0.68rem', padding: '0.2rem 0.3rem', marginBottom: '0.2rem', borderRadius: '4px', cursor: 'pointer',
                                  background: selectedProposals.has(p.id) ? (p.hasConflict ? '#FEE2E2' : '#DBEAFE') : '#fff',
                                  borderLeft: `3px solid ${p.hasConflict ? '#DC2626' : cgColor(cg.id)}`,
                                  border: `1px solid ${p.hasConflict ? '#FCA5A5' : '#BFDBFE'}`,
                                  opacity: selectedProposals.has(p.id) ? 1 : 0.5
                                }}
                                title={p.hasConflict ? `⚠ Conflict: ${p.conflictsWith.map(c => c.clientName).join(', ')}` : 'New proposal — click to toggle'}>
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
              <div style={{ fontSize: '0.75rem', color: '#6B7280', marginTop: '0.5rem', display: 'flex', gap: '1rem' }}>
                <span>◻ Greyed = existing schedule (unchanged)</span>
                <span style={{ color: '#1D4ED8' }}>🔷 Blue = proposed new visit (selected)</span>
                <span style={{ color: '#DC2626' }}>🔴 Red = proposed but has time conflict</span>
                <span>Click to toggle selection</span>
              </div>
            </div>
          )}

          {/* LIST VIEW */}
          {activeView === 'list' && (
            <div style={{ marginBottom: '1.25rem' }}>
              {result.proposals.map(p => (
                <div key={p.id}
                  onClick={() => toggleProposal(p.id)}
                  style={{
                    display: 'flex', alignItems: 'center', gap: '0.75rem',
                    padding: '0.75rem', marginBottom: '0.5rem', borderRadius: '8px', cursor: 'pointer',
                    background: selectedProposals.has(p.id) ? (p.hasConflict ? '#FEF2F2' : '#EFF6FF') : '#FAFAFA',
                    border: `1.5px solid ${selectedProposals.has(p.id) ? (p.hasConflict ? '#FCA5A5' : '#BFDBFE') : '#E5E7EB'}`
                  }}>
                  <input type="checkbox" checked={selectedProposals.has(p.id)} onChange={() => {}} style={{ width: 'auto', cursor: 'pointer' }} />
                  <div style={{ width: '10px', height: '10px', borderRadius: '50%', background: cgColor(p.caregiverId), flexShrink: 0 }} />
                  <div style={{ flex: 1 }}>
                    <div style={{ fontWeight: '600', fontSize: '0.9rem' }}>
                      {p.clientName}
                      {p.isNew && <span style={{ marginLeft: '0.4rem', fontSize: '0.7rem', padding: '0.1rem 0.4rem', background: '#DBEAFE', color: '#1D4ED8', borderRadius: '4px' }}>NEW DAY</span>}
                      {p.hasConflict && <span style={{ marginLeft: '0.4rem', fontSize: '0.7rem', padding: '0.1rem 0.4rem', background: '#FEE2E2', color: '#DC2626', borderRadius: '4px' }}>⚠ CONFLICT</span>}
                    </div>
                    <div style={{ fontSize: '0.8rem', color: '#6B7280' }}>
                      with {p.caregiverName} · {p.dayName} {fmtTime(p.startTime)}–{fmtTime(p.endTime)} ({p.hoursPerVisit}h)
                    </div>
                    {p.hasConflict && p.conflictsWith.map((c, i) => (
                      <div key={i} style={{ fontSize: '0.75rem', color: '#DC2626', marginTop: '0.2rem' }}>
                        ⚠ Overlaps with {c.clientName} ({fmtTime(c.start)}–{fmtTime(c.end)}) — {c.suggestion}
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Action Buttons */}
          <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'flex-end', padding: '1rem', background: '#F9FAFB', borderRadius: '10px' }}>
            <button onClick={() => { setResult(null); }}
              style={{ padding: '0.7rem 1.5rem', borderRadius: '8px', border: '1.5px solid #D1D5DB', background: '#fff', cursor: 'pointer', fontWeight: '600', fontSize: '0.9rem' }}>
              ← Start Over
            </button>
            <button onClick={() => { setResult(null); runOptimizer(); }}
              disabled={running}
              style={{ padding: '0.7rem 1.5rem', borderRadius: '8px', border: 'none', background: '#F3F4F6', cursor: 'pointer', fontWeight: '600', fontSize: '0.9rem' }}>
              🔄 Re-run
            </button>
            <button
              onClick={applyProposals}
              disabled={applying || selectedProposals.size === 0}
              style={{
                padding: '0.7rem 1.75rem', borderRadius: '8px', border: 'none', cursor: 'pointer',
                fontWeight: '700', fontSize: '0.95rem',
                background: applying || selectedProposals.size === 0 ? '#9CA3AF' : 'linear-gradient(135deg, #059669, #0f766e)',
                color: '#fff', boxShadow: applying || selectedProposals.size === 0 ? 'none' : '0 4px 12px rgba(5,150,105,0.35)'
              }}>
              {applying ? 'Applying...' : `✅ Apply ${selectedProposals.size} Schedule${selectedProposals.size !== 1 ? 's' : ''} to Live`}
            </button>
          </div>
          <p style={{ fontSize: '0.78rem', color: '#9CA3AF', textAlign: 'center', margin: '0.5rem 0 0' }}>
            Only checked proposals will be applied. Conflicts are unchecked by default — review them before including.
          </p>
        </div>
      )}
    </div>
  );
}

// ─── Helper ────────────────────────────────────────────────────────────────────
function suggestVisits(hoursPerWeek) {
  if (!hoursPerWeek || hoursPerWeek <= 0) return 3;
  if (hoursPerWeek <= 5) return 2;
  if (hoursPerWeek <= 10) return 3;
  if (hoursPerWeek <= 20) return 4;
  if (hoursPerWeek <= 30) return 5;
  return 6;
}
