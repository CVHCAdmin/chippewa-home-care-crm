// DragDropScheduler.jsx - Visual drag-and-drop weekly scheduling
import React, { useState, useEffect, useRef, useCallback } from 'react';
import { API_BASE_URL } from '../../config';

const HOUR_START = 6;   // 6 AM
const HOUR_END   = 22;  // 10 PM
const TOTAL_HOURS = HOUR_END - HOUR_START;
const CELL_HEIGHT = 64; // px per hour

const PALETTE = [
  '#3B82F6','#10B981','#F59E0B','#EF4444','#8B5CF6',
  '#06B6D4','#F97316','#EC4899','#14B8A6','#6366F1',
];

function clientColor(clientId, clientMap) {
  const ids = Object.keys(clientMap).sort();
  const idx = ids.indexOf(clientId);
  return PALETTE[idx % PALETTE.length];
}

function timeToMinutes(t) {
  if (!t) return 0;
  const [h, m] = t.split(':').map(Number);
  return h * 60 + m;
}

function minutesToTime(m) {
  const h = Math.floor(m / 60).toString().padStart(2, '0');
  const min = (m % 60).toString().padStart(2, '0');
  return `${h}:${min}`;
}

function formatTime(t) {
  if (!t) return '';
  const [h, m] = t.split(':').map(Number);
  const ampm = h >= 12 ? 'PM' : 'AM';
  const hour = h % 12 || 12;
  return `${hour}:${m.toString().padStart(2, '0')} ${ampm}`;
}

function getWeekDates(weekStart) {
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(weekStart);
    d.setDate(d.getDate() + i);
    return d;
  });
}

function getWeekStart(date) {
  const d = new Date(date);
  d.setDate(d.getDate() - d.getDay());
  d.setHours(0, 0, 0, 0);
  return d;
}

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const DAY_FULL  = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];

export default function DragDropScheduler({ token, onScheduleChange }) {
  const [weekOf, setWeekOf]         = useState(getWeekStart(new Date()));
  const [caregivers, setCaregivers] = useState([]);
  const [clients, setClients]       = useState([]);
  const [schedules, setSchedules]   = useState([]);
  const [loading, setLoading]       = useState(true);
  const [saving, setSaving]         = useState(false);
  const [toast, setToast]           = useState(null);

  // Drag state
  const [dragging, setDragging]     = useState(null); // { scheduleId, caregiverId, dayIndex }
  const [dragOver, setDragOver]     = useState(null); // { caregiverId, dayIndex }
  const [dragPreview, setDragPreview] = useState(null); // preview position while dragging

  // New shift modal
  const [newShift, setNewShift]     = useState(null);
  const [newShiftForm, setNewShiftForm] = useState({ clientId:'', startTime:'09:00', endTime:'13:00', notes:'' });

  // Edit modal
  const [editShift, setEditShift]   = useState(null);

  const gridRef = useRef(null);
  const clientMap = Object.fromEntries(clients.map(c => [c.id, c]));

  const showToast = (msg, type = 'success') => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3500);
  };

  // ── Data loading ──────────────────────────────────────────────────────────
  const loadAll = useCallback(async () => {
    setLoading(true);
    try {
      const [cgRes, clRes, schRes] = await Promise.all([
        fetch(`${API_BASE_URL}/api/caregivers`, { headers: { Authorization: `Bearer ${token}` } }),
        fetch(`${API_BASE_URL}/api/clients`,    { headers: { Authorization: `Bearer ${token}` } }),
        fetch(`${API_BASE_URL}/api/schedules-all`, { headers: { Authorization: `Bearer ${token}` } }),
      ]);
      const [cgs, cls, schs] = await Promise.all([cgRes.json(), clRes.json(), schRes.json()]);
      setCaregivers(Array.isArray(cgs) ? cgs : []);
      setClients(Array.isArray(cls) ? cls : []);
      setSchedules(Array.isArray(schs) ? schs : []);
    } catch (e) {
      showToast('Failed to load schedule data', 'error');
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => { loadAll(); }, [loadAll]);

  // Global drag cleanup — ensures stuck state always clears if drag ends outside a drop zone
  useEffect(() => {
    const cleanup = () => {
      setDragging(null);
      setDragOver(null);
    };
    document.addEventListener('dragend', cleanup);
    return () => document.removeEventListener('dragend', cleanup);
  }, []);

  // ── Compute which schedules belong in a cell ───────────────────────────────
  const weekDates  = getWeekDates(weekOf);
  const weekDateStrs = weekDates.map(d => d.toISOString().split('T')[0]);

  function getShiftsForCell(caregiverId, dayIndex) {
    const dateStr = weekDateStrs[dayIndex];
    const cellDate = new Date(dateStr + 'T00:00:00');

    return schedules.filter(s => {
      if (s.caregiver_id !== caregiverId) return false;

      // One-off schedule — match exact date only
      if (s.date) return s.date.slice(0, 10) === dateStr;

      // Recurring schedule — match day of week, but only from the week it was created onwards
      if (s.day_of_week !== null && s.day_of_week !== undefined) {
        if (Number(s.day_of_week) !== dayIndex) return false;

        // Don't show on weeks before the schedule was created/effective
        // Prefer effective_date or anchor_date if set, fall back to created_at
        const effectiveFrom = s.effective_date || s.anchor_date || s.created_at;
        if (effectiveFrom) {
          const fromDate = new Date(effectiveFrom);
          fromDate.setHours(0, 0, 0, 0);
          if (cellDate < fromDate) return false;
        }

        return true;
      }

      return false;
    });
  }

  // ── Drag handlers ─────────────────────────────────────────────────────────
  function handleDragStart(e, schedule, caregiverId, dayIndex) {
    setDragging({ scheduleId: schedule.id, caregiverId, dayIndex, schedule });
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', schedule.id);
  }

  function handleDragOver(e, caregiverId, dayIndex) {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    setDragOver({ caregiverId, dayIndex });
  }

  function handleDragLeave(e) {
    // Only clear if we're actually leaving the cell, not just moving to a child element
    if (e.currentTarget.contains(e.relatedTarget)) return;
    setDragOver(null);
  }

  async function handleDrop(e, targetCaregiverId, targetDayIndex) {
    e.preventDefault();
    setDragOver(null);
    if (!dragging) return;

    const { scheduleId, caregiverId: sourceCaregiverId, dayIndex: sourceDayIndex, schedule } = dragging;

    // Same cell — no-op
    if (targetCaregiverId === sourceCaregiverId && targetDayIndex === sourceDayIndex) {
      setDragging(null);
      return;
    }

    setSaving(true);
    try {
      const targetDate = weekDateStrs[targetDayIndex];
      const body = {
        clientId:    schedule.client_id,
        date:        targetDate,
        dayOfWeek:   null,
        startTime:   schedule.start_time,
        endTime:     schedule.end_time,
        notes:       schedule.notes,
        frequency:   'one-time',
      };

      // If moving to different caregiver: create new + delete old
      if (targetCaregiverId !== sourceCaregiverId) {
        // Create new schedule for target caregiver
        const res = await fetch(`${API_BASE_URL}/api/schedules-enhanced`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({ ...body, caregiverId: targetCaregiverId }),
        });
        if (!res.ok) throw new Error('Failed to create new schedule');

        // Delete old
        await fetch(`${API_BASE_URL}/api/schedules-all/${scheduleId}`, {
          method: 'DELETE',
          headers: { Authorization: `Bearer ${token}` },
        });
      } else {
        // Same caregiver, different day — update in place
        const res = await fetch(`${API_BASE_URL}/api/schedules-all/${scheduleId}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify(body),
        });
        if (!res.ok) throw new Error('Failed to update schedule');
      }

      showToast('Schedule updated ✓');
      await loadAll();
      onScheduleChange && onScheduleChange();
    } catch (err) {
      showToast(err.message || 'Move failed', 'error');
    } finally {
      setSaving(false);
      setDragging(null);
    }
  }

  function handleDragEnd(e) {
    e.preventDefault();
    setDragging(null);
    setDragOver(null);
  }

  // ── Create new shift by clicking a cell ──────────────────────────────────
  function handleCellClick(caregiverId, dayIndex) {
    if (saving) return; // don't open modal while a save is in progress
    setNewShift({ caregiverId, dayIndex });
    setNewShiftForm({ clientId: '', startTime: '09:00', endTime: '13:00', notes: '' });
  }

  async function handleCreateShift() {
    if (!newShiftForm.clientId) return showToast('Select a client', 'error');
    setSaving(true);
    try {
      const res = await fetch(`${API_BASE_URL}/api/schedules-enhanced`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          caregiverId:  newShift.caregiverId,
          clientId:     newShiftForm.clientId,
          scheduleType: 'one-time',
          date:         weekDateStrs[newShift.dayIndex],
          startTime:    newShiftForm.startTime,
          endTime:      newShiftForm.endTime,
          notes:        newShiftForm.notes,
        }),
      });
      if (!res.ok) throw new Error('Failed to create shift');
      showToast('Shift created ✓');
      setNewShift(null);
      await loadAll();
      onScheduleChange && onScheduleChange();
    } catch (err) {
      showToast(err.message, 'error');
    } finally {
      setSaving(false);
    }
  }

  async function handleDeleteShift(scheduleId) {
    setSaving(true);
    try {
      const res = await fetch(`${API_BASE_URL}/api/schedules-all/${scheduleId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        // Fallback: soft-delete via PUT with is_active=false not supported, try deactivation
        await fetch(`${API_BASE_URL}/api/schedules-all/${scheduleId}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({ isActive: false }),
        });
      }
      showToast('Shift removed ✓');
      setEditShift(null);
      await loadAll();
    } catch (err) {
      showToast('Delete failed', 'error');
    } finally {
      setSaving(false);
    }
  }

  // ── Week navigation ───────────────────────────────────────────────────────
  function prevWeek() {
    const d = new Date(weekOf);
    d.setDate(d.getDate() - 7);
    setWeekOf(d);
  }
  function nextWeek() {
    const d = new Date(weekOf);
    d.setDate(d.getDate() + 7);
    setWeekOf(d);
  }
  function goToday() { setWeekOf(getWeekStart(new Date())); }

  // ── Shift block rendering ─────────────────────────────────────────────────
  function ShiftBlock({ schedule, caregiverId, dayIndex }) {
    const client  = clientMap[schedule.client_id];
    const color   = clientColor(schedule.client_id, clientMap);
    const startM  = timeToMinutes(schedule.start_time);
    const endM    = timeToMinutes(schedule.end_time);
    const durH    = ((endM - startM) / 60).toFixed(1);
    const isDraggingThis = dragging?.scheduleId === schedule.id;

    return (
      <div
        draggable
        onDragStart={e => handleDragStart(e, schedule, caregiverId, dayIndex)}
        onDragEnd={handleDragEnd}
        onClick={e => { e.stopPropagation(); setEditShift({ schedule, caregiverId, dayIndex }); }}
        style={{
          background: color,
          opacity: isDraggingThis ? 0.4 : 1,
          cursor: 'grab',
          borderRadius: 6,
          padding: '3px 7px',
          marginBottom: 3,
          color: '#fff',
          fontSize: 11,
          fontWeight: 600,
          userSelect: 'none',
          boxShadow: '0 1px 3px rgba(0,0,0,0.2)',
          transition: 'opacity 0.15s, transform 0.1s',
          transform: isDraggingThis ? 'scale(0.97)' : 'scale(1)',
          position: 'relative',
          overflow: 'hidden',
        }}
      >
        <div style={{ fontWeight: 700, fontSize: 11, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {client ? `${client.first_name} ${client.last_name}` : 'Unknown Client'}
        </div>
        <div style={{ opacity: 0.9, fontSize: 10 }}>
          {formatTime(schedule.start_time)} – {formatTime(schedule.end_time)}
          <span style={{ marginLeft: 5, opacity: 0.75 }}>({durH}h)</span>
        </div>
        {schedule.day_of_week !== null && schedule.day_of_week !== undefined && !schedule.date && (
          <div style={{ position: 'absolute', top: 2, right: 4, fontSize: 9, opacity: 0.7 }}>↻</div>
        )}
      </div>
    );
  }

  // ── Totals per caregiver for the week ─────────────────────────────────────
  function weeklyHours(caregiverId) {
    let total = 0;
    for (let d = 0; d < 7; d++) {
      getShiftsForCell(caregiverId, d).forEach(s => {
        total += (timeToMinutes(s.end_time) - timeToMinutes(s.start_time)) / 60;
      });
    }
    return total;
  }

  // ── Today highlight ───────────────────────────────────────────────────────
  const todayStr  = new Date().toISOString().split('T')[0];
  const todayIdx  = weekDateStrs.indexOf(todayStr);

  if (loading) {
    return (
      <div style={{ display:'flex', alignItems:'center', justifyContent:'center', height: 300, color:'#6B7280', fontSize:16 }}>
        <div style={{ textAlign:'center' }}>
          <div style={{ fontSize:32, marginBottom:12 }}>📅</div>
          Loading schedule...
        </div>
      </div>
    );
  }

  return (
    <div style={{ fontFamily: "'DM Sans', 'Segoe UI', sans-serif", background:'#F8FAFC', minHeight:'100vh' }}>

      {/* Toast */}
      {toast && (
        <div style={{
          position: 'fixed', top: 20, right: 20, zIndex: 9999,
          background: toast.type === 'error' ? '#EF4444' : '#10B981',
          color: '#fff', padding: '10px 18px', borderRadius: 8,
          fontWeight: 600, fontSize: 14, boxShadow: '0 4px 16px rgba(0,0,0,0.15)',
          animation: 'slideIn 0.2s ease',
        }}>
          {toast.msg}
        </div>
      )}

      {/* Header */}
      <div style={{ background:'#fff', borderBottom:'1px solid #E5E7EB', padding:'14px 24px', display:'flex', alignItems:'center', gap: 16, flexWrap:'wrap' }}>
        <div style={{ display:'flex', alignItems:'center', gap:8 }}>
          <button onClick={prevWeek} style={navBtn}>‹</button>
          <button onClick={goToday} style={{ ...navBtn, padding:'6px 14px', fontSize:13 }}>Today</button>
          <button onClick={nextWeek} style={navBtn}>›</button>
        </div>

        <h2 style={{ margin:0, fontSize:17, fontWeight:700, color:'#111827', flex:1 }}>
          {weekDates[0].toLocaleDateString('en-US', { month:'short', day:'numeric' })}
          {' – '}
          {weekDates[6].toLocaleDateString('en-US', { month:'short', day:'numeric', year:'numeric' })}
        </h2>

        <div style={{ display:'flex', alignItems:'center', gap:10 }}>
          {saving && <span style={{ fontSize:13, color:'#6B7280' }}>Saving...</span>}
          <div style={{ fontSize:12, color:'#9CA3AF', padding:'4px 10px', background:'#F3F4F6', borderRadius:6 }}>
            Drag shifts to move • Click to create or edit
          </div>
        </div>
      </div>

      {/* Grid */}
      <div style={{ overflowX:'auto', padding:'0 0 24px' }}>
        <div style={{ minWidth: 900 }}>

          {/* Day headers */}
          <div style={{ display:'grid', gridTemplateColumns:'160px repeat(7, 1fr)', borderBottom:'2px solid #E5E7EB', background:'#fff', position:'sticky', top:0, zIndex:10 }}>
            <div style={{ padding:'10px 16px', color:'#9CA3AF', fontSize:12, fontWeight:600 }}>CAREGIVER</div>
            {weekDates.map((d, i) => {
              const isToday = i === todayIdx;
              const dateStr = d.toLocaleDateString('en-US', { month:'short', day:'numeric' });
              return (
                <div key={i} style={{
                  padding:'10px 8px', textAlign:'center',
                  background: isToday ? '#EFF6FF' : 'transparent',
                  borderLeft: '1px solid #F3F4F6',
                }}>
                  <div style={{ fontSize:11, fontWeight:700, color: isToday ? '#3B82F6' : '#6B7280', textTransform:'uppercase', letterSpacing:1 }}>
                    {DAY_NAMES[i]}
                  </div>
                  <div style={{ fontSize:16, fontWeight:800, color: isToday ? '#3B82F6' : '#111827' }}>
                    {d.getDate()}
                  </div>
                  <div style={{ fontSize:10, color:'#9CA3AF' }}>{dateStr.split(' ')[0]}</div>
                </div>
              );
            })}
          </div>

          {/* Caregiver rows */}
          {caregivers.map(cg => {
            const hrs = weeklyHours(cg.id).toFixed(1);
            const isOver40 = parseFloat(hrs) > 40;
            return (
              <div key={cg.id} style={{ display:'grid', gridTemplateColumns:'160px repeat(7, 1fr)', borderBottom:'1px solid #F3F4F6', background:'#fff', minHeight: 80 }}>

                {/* Caregiver label */}
                <div style={{ padding:'12px 16px', borderRight:'1px solid #F3F4F6', background:'#FAFAFA' }}>
                  <div style={{ fontWeight:700, fontSize:13, color:'#111827', whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>
                    {cg.first_name} {cg.last_name}
                  </div>
                  <div style={{ fontSize:11, color: isOver40 ? '#EF4444' : '#6B7280', fontWeight: isOver40 ? 700 : 400, marginTop:2 }}>
                    {hrs}h this week{isOver40 ? ' ⚠️' : ''}
                  </div>
                </div>

                {/* Day cells */}
                {weekDates.map((d, dayIndex) => {
                  const shifts     = getShiftsForCell(cg.id, dayIndex);
                  const isToday    = dayIndex === todayIdx;
                  const isDragOver = dragOver?.caregiverId === cg.id && dragOver?.dayIndex === dayIndex;

                  return (
                    <div
                      key={dayIndex}
                      onClick={() => handleCellClick(cg.id, dayIndex)}
                      onDragOver={e => handleDragOver(e, cg.id, dayIndex)}
                      onDragLeave={handleDragLeave}
                      onDrop={e => handleDrop(e, cg.id, dayIndex)}
                      style={{
                        borderLeft: '1px solid #F3F4F6',
                        padding: '6px 5px',
                        minHeight: 72,
                        background: isDragOver ? '#DBEAFE' : isToday ? '#F0F9FF' : 'transparent',
                        cursor: 'pointer',
                        transition: 'background 0.12s',
                        outline: isDragOver ? '2px dashed #3B82F6' : 'none',
                        outlineOffset: -2,
                        position: 'relative',
                      }}
                    >
                      {shifts.map(s => (
                        <ShiftBlock key={s.id} schedule={s} caregiverId={cg.id} dayIndex={dayIndex} />
                      ))}
                      {shifts.length === 0 && (
                        <div style={{ height:'100%', display:'flex', alignItems:'center', justifyContent:'center', opacity: 0, transition:'opacity 0.2s' }}
                          className="add-hint">
                          <span style={{ fontSize:20, color:'#D1D5DB' }}>+</span>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            );
          })}

          {caregivers.length === 0 && (
            <div style={{ textAlign:'center', padding:'60px 20px', color:'#9CA3AF' }}>
              No caregivers found. Add caregivers to start scheduling.
            </div>
          )}
        </div>
      </div>

      {/* Client legend */}
      {clients.length > 0 && (
        <div style={{ padding:'16px 24px', background:'#fff', borderTop:'1px solid #E5E7EB' }}>
          <div style={{ fontSize:11, fontWeight:700, color:'#9CA3AF', marginBottom:8, textTransform:'uppercase', letterSpacing:1 }}>Clients</div>
          <div style={{ display:'flex', flexWrap:'wrap', gap:8 }}>
            {clients.map((c, i) => (
              <div key={c.id} style={{ display:'flex', alignItems:'center', gap:5, fontSize:12, color:'#374151' }}>
                <div style={{ width:10, height:10, borderRadius:3, background: PALETTE[i % PALETTE.length], flexShrink:0 }} />
                {c.first_name} {c.last_name}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* New shift modal */}
      {newShift && (
        <Modal title={`New Shift — ${DAY_FULL[newShift.dayIndex]}, ${weekDates[newShift.dayIndex].toLocaleDateString('en-US', { month:'long', day:'numeric' })}`} onClose={() => setNewShift(null)}>
          <div style={{ display:'flex', flexDirection:'column', gap:14 }}>
            <FormField label="Client">
              <select value={newShiftForm.clientId} onChange={e => setNewShiftForm(f => ({ ...f, clientId: e.target.value }))} style={selectStyle}>
                <option value="">— Select client —</option>
                {clients.map(c => <option key={c.id} value={c.id}>{c.first_name} {c.last_name}</option>)}
              </select>
            </FormField>
            <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:12 }}>
              <FormField label="Start Time">
                <input type="time" value={newShiftForm.startTime} onChange={e => setNewShiftForm(f => ({ ...f, startTime: e.target.value }))} style={inputStyle} />
              </FormField>
              <FormField label="End Time">
                <input type="time" value={newShiftForm.endTime} onChange={e => setNewShiftForm(f => ({ ...f, endTime: e.target.value }))} style={inputStyle} />
              </FormField>
            </div>
            <FormField label="Notes (optional)">
              <input type="text" value={newShiftForm.notes} onChange={e => setNewShiftForm(f => ({ ...f, notes: e.target.value }))} style={inputStyle} placeholder="Any notes..." />
            </FormField>
            <div style={{ display:'flex', gap:10, justifyContent:'flex-end', marginTop:4 }}>
              <button onClick={() => setNewShift(null)} style={cancelBtn}>Cancel</button>
              <button onClick={handleCreateShift} disabled={saving} style={primaryBtn}>
                {saving ? 'Creating...' : 'Create Shift'}
              </button>
            </div>
          </div>
        </Modal>
      )}

      {/* Edit shift modal */}
      {editShift && (() => {
        const { schedule } = editShift;
        const client = clientMap[schedule.client_id];
        const color  = clientColor(schedule.client_id, clientMap);
        const durM   = timeToMinutes(schedule.end_time) - timeToMinutes(schedule.start_time);
        const durH   = (durM / 60).toFixed(1);
        return (
          <Modal title="Shift Details" onClose={() => setEditShift(null)}>
            <div style={{ display:'flex', flexDirection:'column', gap:14 }}>
              <div style={{ background: color, borderRadius:8, padding:'12px 16px', color:'#fff' }}>
                <div style={{ fontWeight:800, fontSize:16 }}>{client ? `${client.first_name} ${client.last_name}` : 'Unknown Client'}</div>
                <div style={{ opacity:0.9, marginTop:2 }}>
                  {formatTime(schedule.start_time)} – {formatTime(schedule.end_time)} &nbsp;·&nbsp; {durH}h
                </div>
                {schedule.day_of_week !== null && !schedule.date && (
                  <div style={{ opacity:0.75, fontSize:12, marginTop:4 }}>↻ Recurring every {DAY_FULL[schedule.day_of_week]}</div>
                )}
              </div>
              {schedule.notes && (
                <div style={{ background:'#F9FAFB', padding:'10px 14px', borderRadius:6, fontSize:13, color:'#374151' }}>
                  📝 {schedule.notes}
                </div>
              )}
              <div style={{ display:'flex', gap:10, justifyContent:'space-between', marginTop:4 }}>
                <button
                  onClick={() => handleDeleteShift(schedule.id)}
                  disabled={saving}
                  style={{ ...cancelBtn, color:'#EF4444', borderColor:'#FECACA' }}
                >
                  {saving ? '...' : 'Delete Shift'}
                </button>
                <button onClick={() => setEditShift(null)} style={primaryBtn}>Close</button>
              </div>
            </div>
          </Modal>
        );
      })()}

      <style>{`
        @keyframes slideIn { from { opacity:0; transform:translateY(-8px) } to { opacity:1; transform:translateY(0) } }
        div:hover .add-hint { opacity: 1 !important; }
      `}</style>
    </div>
  );
}

// ── Sub-components ────────────────────────────────────────────────────────────

function Modal({ title, onClose, children }) {
  return (
    <div style={{
      position:'fixed', inset:0, background:'rgba(0,0,0,0.4)', zIndex:1000,
      display:'flex', alignItems:'center', justifyContent:'center', padding:16,
    }} onClick={e => e.target === e.currentTarget && onClose()}>
      <div style={{
        background:'#fff', borderRadius:12, width:'100%', maxWidth:440,
        boxShadow:'0 20px 60px rgba(0,0,0,0.2)', overflow:'hidden',
      }}>
        <div style={{ padding:'16px 20px', borderBottom:'1px solid #E5E7EB', display:'flex', justifyContent:'space-between', alignItems:'center' }}>
          <h3 style={{ margin:0, fontSize:16, fontWeight:700, color:'#111827' }}>{title}</h3>
          <button onClick={onClose} style={{ background:'none', border:'none', cursor:'pointer', fontSize:20, color:'#9CA3AF', lineHeight:1, padding:4 }}>×</button>
        </div>
        <div style={{ padding:20 }}>{children}</div>
      </div>
    </div>
  );
}

function FormField({ label, children }) {
  return (
    <div>
      <label style={{ display:'block', fontSize:12, fontWeight:600, color:'#374151', marginBottom:5, textTransform:'uppercase', letterSpacing:0.5 }}>{label}</label>
      {children}
    </div>
  );
}

// ── Shared styles ─────────────────────────────────────────────────────────────
const navBtn = {
  background:'#F3F4F6', border:'1px solid #E5E7EB', borderRadius:7,
  padding:'6px 12px', cursor:'pointer', fontSize:15, color:'#374151',
  fontWeight:600, transition:'background 0.1s',
};
const inputStyle = {
  width:'100%', padding:'8px 12px', border:'1px solid #D1D5DB',
  borderRadius:7, fontSize:14, color:'#111827', boxSizing:'border-box',
  outline:'none',
};
const selectStyle = { ...inputStyle };
const primaryBtn = {
  background:'#3B82F6', color:'#fff', border:'none', borderRadius:7,
  padding:'9px 20px', fontWeight:700, fontSize:14, cursor:'pointer',
  transition:'background 0.15s',
};
const cancelBtn = {
  background:'#fff', color:'#6B7280', border:'1px solid #D1D5DB',
  borderRadius:7, padding:'9px 16px', fontWeight:600, fontSize:14, cursor:'pointer',
};
