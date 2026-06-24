// src/components/admin/LiveBoard.jsx
// Real-time shift status board — shows all today's shifts with live EVV status
import React, { useState } from 'react';
import { API_BASE_URL } from '../../config';
import { usePolling } from '../../hooks/usePolling';
import VisitGpsMap from './VisitGpsMap';
import { formatTime } from '../../utils/datetime';

const LiveBoard = ({ token }) => {
  const [data, setData] = useState({ shifts: [], stats: {}, asOf: null });
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('all');
  const [selectedShift, setSelectedShift] = useState(null);
  const [mapShift, setMapShift] = useState(null);
  // Force clock-out modal
  const [closeTarget, setCloseTarget] = useState(null);
  const [closeMode, setCloseMode] = useState('scheduled'); // 'scheduled' | 'now' | 'time'
  const [closeEndTime, setCloseEndTime] = useState('');
  const [closeReason, setCloseReason] = useState('');
  const [closing, setClosing] = useState(false);

  const submitForceClose = async () => {
    if (!closeTarget) return;
    const body = { reason: closeReason || null };
    if (closeMode === 'scheduled') body.scheduled = true;
    else if (closeMode === 'time') {
      if (!closeEndTime) { window.alert('Pick an end time.'); return; }
      body.endTime = new Date(closeEndTime).toISOString();
    } // 'now' → send neither (server defaults to now)
    setClosing(true);
    try {
      const r = await fetch(`${API_BASE_URL}/api/time-entries/${closeTarget.time_entry_id}/admin-force-clockout`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(body),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error || 'Failed');
      setCloseTarget(null);
      loadBoard();
    } catch (err) {
      window.alert('Failed to close shift: ' + err.message);
    } finally {
      setClosing(false);
    }
  };

  const loadBoard = async () => {
    try {
      const r = await fetch(`${API_BASE_URL}/api/dashboard/live-board`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (r.ok) setData(await r.json());
    } catch (e) {
      console.error('Live board load error:', e);
    } finally {
      setLoading(false);
    }
  };

  // Refresh every 60s, paused when tab is hidden (refreshes on re-show)
  usePolling(loadBoard, 60000);

  const filteredShifts = data.shifts.filter(s => filter === 'all' || s.shift_status === filter);

  const statusConfig = {
    clocked_in:  { bg: '#D1FAE5', border: '#10B981', color: '#065F46', label: 'Clocked In',  icon: '🟢', pulse: true },
    completed:   { bg: '#E0E7FF', border: '#6366F1', color: '#3730A3', label: 'Completed',   icon: '✅', pulse: false },
    late:        { bg: '#FEE2E2', border: '#EF4444', color: '#991B1B', label: 'Late',         icon: '🔴', pulse: true },
    starting:    { bg: '#FEF3C7', border: '#F59E0B', color: '#92400E', label: 'Starting Now', icon: '🟡', pulse: true },
    upcoming:    { bg: '#F3F4F6', border: '#D1D5DB', color: '#6B7280', label: 'Upcoming',     icon: '⏳', pulse: false },
  };

  const formatTime = (t) => {
    if (!t) return '--:--';
    if (t.includes('T')) return new Date(t).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
    return t.substring(0, 5);
  };

  if (loading) return <div className="loading"><div className="spinner"></div></div>;

  return (
    <div>
      <div className="page-header">
        <h2>Live Shift Board</h2>
        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
          <span style={{ fontSize: '0.78rem', color: '#6B7280' }}>
            Auto-refreshes every 30s {data.asOf && `| Last: ${formatTime(data.asOf)}`}
          </span>
          <button className="btn btn-sm btn-primary" onClick={loadBoard}>Refresh Now</button>
        </div>
      </div>

      {/* Status Summary Cards */}
      <div style={{ display: 'flex', gap: '0.75rem', marginBottom: '1.25rem', flexWrap: 'wrap' }}>
        {[
          { key: 'all', label: 'Total Shifts', val: data.stats.total || 0, color: '#6366F1' },
          { key: 'clocked_in', label: 'Clocked In', val: data.stats.clocked_in || 0, color: '#10B981' },
          { key: 'late', label: 'Late / No-Show', val: data.stats.late || 0, color: '#EF4444' },
          { key: 'starting', label: 'Starting Now', val: data.stats.starting || 0, color: '#F59E0B' },
          { key: 'upcoming', label: 'Upcoming', val: data.stats.upcoming || 0, color: '#6B7280' },
          { key: 'completed', label: 'Completed', val: data.stats.completed || 0, color: '#6366F1' },
        ].map(s => (
          <div key={s.key} onClick={() => setFilter(s.key)}
            style={{ flex: 1, minWidth: 110, padding: '0.75rem 1rem', background: filter === s.key ? '#F0F9FF' : '#F9FAFB',
              borderRadius: 12, borderLeft: `4px solid ${s.color}`, cursor: 'pointer',
              outline: filter === s.key ? `2px solid ${s.color}` : 'none' }}>
            <div style={{ fontSize: '1.5rem', fontWeight: 800, color: s.color }}>{s.val}</div>
            <div style={{ fontSize: '0.72rem', color: '#6B7280' }}>{s.label}</div>
          </div>
        ))}
      </div>

      {/* Shift Cards Grid */}
      {filteredShifts.length === 0 ? (
        <div className="card card-centered"><p>No shifts match this filter.</p></div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: '0.75rem' }}>
          {filteredShifts.map(shift => {
            const sc = statusConfig[shift.shift_status] || statusConfig.upcoming;
            return (
              <div key={shift.schedule_id + (shift.time_entry_id || '')}
                onClick={() => setSelectedShift(selectedShift?.schedule_id === shift.schedule_id ? null : shift)}
                style={{
                  background: '#fff', borderRadius: 12, border: `2px solid ${sc.border}`,
                  padding: '1rem', cursor: 'pointer', position: 'relative', overflow: 'hidden',
                  boxShadow: shift.shift_status === 'late' ? '0 0 12px rgba(239,68,68,0.2)' : '0 1px 3px rgba(0,0,0,0.08)',
                  animation: sc.pulse && shift.shift_status === 'late' ? 'pulse-red 2s infinite' : undefined
                }}>

                {/* Status badge */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
                  <span style={{ fontWeight: 700, fontSize: '1rem' }}>
                    {shift.caregiver_first} {shift.caregiver_last}
                  </span>
                  <span style={{ padding: '2px 10px', borderRadius: 20, fontSize: '0.72rem', fontWeight: 700,
                    background: sc.bg, color: sc.color }}>
                    {sc.icon} {sc.label}
                  </span>
                </div>

                {/* Client */}
                <div style={{ fontSize: '0.88rem', color: '#374151', marginBottom: '0.35rem' }}>
                  {shift.client_first} {shift.client_last}
                  {shift.client_address && <span style={{ color: '#9CA3AF', fontSize: '0.78rem' }}> — {shift.client_city}</span>}
                </div>

                {/* Times */}
                <div style={{ display: 'flex', gap: '1rem', fontSize: '0.82rem', color: '#6B7280' }}>
                  <span>Scheduled: {formatTime(shift.scheduled_start)} - {formatTime(shift.scheduled_end)}</span>
                  {shift.clock_in_time && (
                    <span style={{ color: '#10B981', fontWeight: 600 }}>
                      In: {formatTime(shift.clock_in_time)}
                      {shift.clock_out_time && <> | Out: {formatTime(shift.clock_out_time)}</>}
                    </span>
                  )}
                </div>

                {/* Elapsed time for active shifts */}
                {shift.shift_status === 'clocked_in' && shift.minutes_elapsed != null && (
                  <div style={{ marginTop: '0.35rem', fontSize: '0.82rem', fontWeight: 700, color: '#2ABBA7' }}>
                    {Math.floor(shift.minutes_elapsed / 60)}h {Math.round(shift.minutes_elapsed % 60)}m elapsed
                  </div>
                )}

                {/* Force clock-out button for active shifts */}
                {shift.shift_status === 'clocked_in' && shift.time_entry_id && (
                  <button
                    onClick={(e) => { e.stopPropagation(); setCloseTarget(shift); setCloseMode('scheduled'); setCloseEndTime(''); setCloseReason(''); }}
                    style={{
                      marginTop: '0.5rem', width: '100%', padding: '0.45rem 0.6rem',
                      background: '#fff', color: '#B45309', border: '1px solid #FCD34D',
                      borderRadius: 6, fontSize: '0.82rem', fontWeight: 600, cursor: 'pointer'
                    }}
                  >🛑 Force Clock Out</button>
                )}

                {/* Map button — show GPS trail for any shift with a time entry */}
                {shift.time_entry_id && (
                  <button
                    onClick={(e) => { e.stopPropagation(); setMapShift(shift); }}
                    style={{
                      marginTop: '0.5rem', width: '100%', padding: '0.45rem 0.6rem',
                      background: '#fff', color: '#6D28D9', border: '1px solid #C4B5FD',
                      borderRadius: 6, fontSize: '0.82rem', fontWeight: 600, cursor: 'pointer'
                    }}
                    title="View GPS trail on map"
                  >🗺️ View on Map</button>
                )}

                {/* Late warning */}
                {shift.shift_status === 'late' && (
                  <div style={{ marginTop: '0.35rem', fontSize: '0.82rem', fontWeight: 700, color: '#DC2626' }}>
                    No clock-in — shift was scheduled to start at {formatTime(shift.scheduled_start)}
                  </div>
                )}

                {/* Duration for completed */}
                {shift.shift_status === 'completed' && shift.duration_minutes && (
                  <div style={{ marginTop: '0.35rem', fontSize: '0.82rem', color: '#6366F1' }}>
                    Total: {(shift.duration_minutes / 60).toFixed(1)}h
                  </div>
                )}

                {/* GPS trail indicator */}
                {shift.gps_trail && shift.gps_trail.length > 0 && (
                  <div style={{ marginTop: '0.35rem', fontSize: '0.72rem', color: '#9CA3AF' }}>
                    {shift.gps_trail.length} GPS points tracked
                  </div>
                )}

                {/* Expanded detail */}
                {selectedShift?.schedule_id === shift.schedule_id && (
                  <div style={{ marginTop: '0.75rem', paddingTop: '0.75rem', borderTop: '1px solid #E5E7EB', fontSize: '0.82rem' }}>
                    {shift.caregiver_phone && <div style={{ color: '#6B7280' }}>Phone: {shift.caregiver_phone}</div>}
                    {shift.client_address && <div style={{ color: '#6B7280' }}>Address: {shift.client_address}, {shift.client_city}</div>}
                    {shift.clock_in_location && (
                      <div style={{ color: '#6B7280' }}>
                        Clock-in GPS: {JSON.parse(shift.clock_in_location || '{}').lat?.toFixed(4)}, {JSON.parse(shift.clock_in_location || '{}').lng?.toFixed(4)}
                      </div>
                    )}
                    {shift.gps_trail && shift.gps_trail.length > 0 && (
                      <div style={{ marginTop: '0.5rem' }}>
                        <strong>GPS Trail ({shift.gps_trail.length} points)</strong>
                        <div style={{ maxHeight: 100, overflow: 'auto', fontSize: '0.72rem', color: '#9CA3AF', marginTop: '0.25rem' }}>
                          {shift.gps_trail.map((pt, i) => (
                            <div key={i}>{formatTime(pt.ts)} — {pt.lat?.toFixed(5)}, {pt.lng?.toFixed(5)}</div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      <style>{`
        @keyframes pulse-red {
          0%, 100% { box-shadow: 0 0 12px rgba(239,68,68,0.2); }
          50% { box-shadow: 0 0 20px rgba(239,68,68,0.4); }
        }
      `}</style>

      {/* Force clock-out modal */}
      {closeTarget && (
        <div onClick={() => !closing && setCloseTarget(null)} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100, padding: 20 }}>
          <div onClick={(e) => e.stopPropagation()} style={{ background: '#fff', borderRadius: 10, maxWidth: 440, width: '95%', padding: '1.25rem' }}>
            <h3 style={{ margin: '0 0 0.35rem', fontSize: '1rem' }}>Close shift — {closeTarget.caregiver_first} {closeTarget.caregiver_last}</h3>
            <div style={{ fontSize: '0.82rem', color: '#6B7280', marginBottom: '0.9rem' }}>
              {closeTarget.client_first} {closeTarget.client_last} · in {formatTime(closeTarget.clock_in_time)}
              {closeTarget.scheduled_start && ` · scheduled ${formatTime(closeTarget.scheduled_start)}–${formatTime(closeTarget.scheduled_end)}`}
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', marginBottom: '0.75rem' }}>
              <label style={{ fontSize: '0.88rem', cursor: 'pointer' }}><input type="radio" name="closemode" checked={closeMode === 'scheduled'} onChange={() => setCloseMode('scheduled')} /> Bill the scheduled amount</label>
              <label style={{ fontSize: '0.88rem', cursor: 'pointer' }}><input type="radio" name="closemode" checked={closeMode === 'now'} onChange={() => setCloseMode('now')} /> Clock out now (actual elapsed)</label>
              <label style={{ fontSize: '0.88rem', cursor: 'pointer' }}><input type="radio" name="closemode" checked={closeMode === 'time'} onChange={() => setCloseMode('time')} /> Specific end time</label>
              {closeMode === 'time' && (
                <input type="datetime-local" value={closeEndTime} onChange={(e) => setCloseEndTime(e.target.value)} style={{ padding: '0.4rem', border: '1px solid #D1D5DB', borderRadius: 6, fontSize: '0.88rem' }} />
              )}
            </div>
            <input type="text" placeholder="Reason (optional)" value={closeReason} onChange={(e) => setCloseReason(e.target.value)} style={{ width: '100%', padding: '0.4rem', border: '1px solid #D1D5DB', borderRadius: 6, fontSize: '0.88rem', marginBottom: '0.6rem', boxSizing: 'border-box' }} />
            <div style={{ fontSize: '0.75rem', color: '#92400E', marginBottom: '0.9rem' }}>The shift will be flagged for approval before billing/payroll.</div>
            <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end' }}>
              <button onClick={() => setCloseTarget(null)} disabled={closing} className="btn btn-sm btn-secondary">Cancel</button>
              <button onClick={submitForceClose} disabled={closing} className="btn btn-sm btn-primary">{closing ? 'Closing…' : 'Close shift'}</button>
            </div>
          </div>
        </div>
      )}

      {/* GPS trail map modal for the selected shift */}
      {mapShift && (
        <div onClick={() => setMapShift(null)} style={{
          position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100, padding: 20,
        }}>
          <div onClick={(e) => e.stopPropagation()} style={{ background: '#fff', borderRadius: 10, maxWidth: 900, width: '95%', maxHeight: '90vh', overflow: 'auto', padding: '1rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
              <h3 style={{ margin: 0, fontSize: '1rem' }}>
                🗺️ GPS — {mapShift.caregiver_first} {mapShift.caregiver_last} → {mapShift.client_first} {mapShift.client_last}
              </h3>
              <button onClick={() => setMapShift(null)} style={{ background: 'none', border: 'none', fontSize: 22, cursor: 'pointer', color: '#6B7280' }}>×</button>
            </div>
            <VisitGpsMap
              token={token}
              timeEntryId={mapShift.time_entry_id}
              clientLat={mapShift.client_lat}
              clientLng={mapShift.client_lng}
              clientName={`${mapShift.client_first} ${mapShift.client_last}`}
            />
          </div>
        </div>
      )}
    </div>
  );
};

export default LiveBoard;
