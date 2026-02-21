// SchedulerGrid.jsx - Weekly schedule grid: click cell to create, click shift to edit/delete
import React, { useState, useEffect, useCallback } from 'react';
import { API_BASE_URL } from '../../config';

const PALETTE = [
  '#3B82F6','#10B981','#F59E0B','#EF4444','#8B5CF6',
  '#06B6D4','#F97316','#EC4899','#14B8A6','#6366F1',
];

function clientColor(clientId, clientMap) {
  const ids = Object.keys(clientMap).sort();
  return PALETTE[ids.indexOf(clientId) % PALETTE.length];
}

function timeToMinutes(t) {
  if (!t) return 0;
  const [h, m] = t.split(':').map(Number);
  return h * 60 + m;
}

function formatTime(t) {
  if (!t) return '';
  const [h, m] = t.split(':').map(Number);
  return `${h % 12 || 12}:${m.toString().padStart(2,'0')} ${h >= 12 ? 'PM' : 'AM'}`;
}

function getWeekStart(date) {
  const d = new Date(date);
  d.setDate(d.getDate() - d.getDay());
  d.setHours(0,0,0,0);
  return d;
}

function getWeekDates(weekStart) {
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(weekStart);
    d.setDate(d.getDate() + i);
    return d;
  });
}

const DAY_NAMES = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
const DAY_FULL  = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];

export default function SchedulerGrid({ token, onScheduleChange }) {
  const [weekOf, setWeekOf]             = useState(getWeekStart(new Date()));
  const [caregivers, setCaregivers]     = useState([]);
  const [clients, setClients]           = useState([]);
  const [schedules, setSchedules]       = useState([]);
  const [loading, setLoading]           = useState(true);
  const [saving, setSaving]             = useState(false);
  const [isMobile, setIsMobile] = useState(window.innerWidth <= 768);
  const [mobileDay, setMobileDay] = useState(new Date().getDay());
  const [toast, setToast]               = useState(null);
  const [newShift, setNewShift]         = useState(null);
  const [newShiftForm, setNewShiftForm] = useState({ clientId:'', startTime:'09:00', endTime:'13:00', notes:'' });
  const [editShift, setEditShift]       = useState(null);

  const clientMap = Object.fromEntries(clients.map(c => [c.id, c]));

  const showToast = (msg, type = 'success') => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3500);
  };

  const loadAll = useCallback(async () => {
    setLoading(true);
    try {
      const [cgRes, clRes, schRes] = await Promise.all([
        fetch(`${API_BASE_URL}/api/caregivers`,     { headers: { Authorization: `Bearer ${token}` } }),
        fetch(`${API_BASE_URL}/api/clients`,        { headers: { Authorization: `Bearer ${token}` } }),
        fetch(`${API_BASE_URL}/api/schedules-all`,  { headers: { Authorization: `Bearer ${token}` } }),
      ]);
      const [cgs, cls, schs] = await Promise.all([cgRes.json(), clRes.json(), schRes.json()]);
      setCaregivers(Array.isArray(cgs) ? cgs : []);
      setClients(Array.isArray(cls) ? cls : []);
      setSchedules(Array.isArray(schs) ? schs : []);
    } catch {
      showToast('Failed to load schedule data', 'error');
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => { loadAll(); }, [loadAll]);

  const weekDates    = getWeekDates(weekOf);
  const weekDateStrs = weekDates.map(d => d.toISOString().split('T')[0]);
  const todayStr     = new Date().toISOString().split('T')[0];
  const todayIdx     = weekDateStrs.indexOf(todayStr);

  function getShiftsForCell(caregiverId, dayIndex) {
    const dateStr  = weekDateStrs[dayIndex];
    const cellDate = new Date(dateStr + 'T00:00:00');

    return schedules.filter(s => {
      if (s.caregiver_id !== caregiverId) return false;

      // One-off
      if (s.date) return s.date.slice(0,10) === dateStr;

      // Recurring — only show from creation week forward
      if (s.day_of_week !== null && s.day_of_week !== undefined) {
        if (Number(s.day_of_week) !== dayIndex) return false;
        const effectiveFrom = s.effective_date || s.anchor_date || s.created_at;
        if (effectiveFrom) {
          const from = new Date(effectiveFrom);
          from.setHours(0,0,0,0);
          if (cellDate < from) return false;
        }
        return true;
      }
      return false;
    });
  }

  function weeklyHours(caregiverId) {
    let total = 0;
    for (let d = 0; d < 7; d++) {
      getShiftsForCell(caregiverId, d).forEach(s => {
        total += (timeToMinutes(s.end_time) - timeToMinutes(s.start_time)) / 60;
      });
    }
    return total;
  }

  function prevWeek() { const d = new Date(weekOf); d.setDate(d.getDate()-7); setWeekOf(d); }
  function nextWeek() { const d = new Date(weekOf); d.setDate(d.getDate()+7); setWeekOf(d); }
  function goToday()  { setWeekOf(getWeekStart(new Date())); }

  function handleCellClick(caregiverId, dayIndex) {
    if (saving) return;
    setNewShift({ caregiverId, dayIndex });
    setNewShiftForm({ clientId:'', startTime:'09:00', endTime:'13:00', notes:'' });
  }

  async function handleCreateShift() {
    if (!newShiftForm.clientId) return showToast('Select a client', 'error');
    setSaving(true);
    try {
      const res = await fetch(`${API_BASE_URL}/api/schedules-enhanced`, {
        method: 'POST',
        headers: { 'Content-Type':'application/json', Authorization:`Bearer ${token}` },
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
    if (!window.confirm('Delete this shift?')) return;
    setSaving(true);
    try {
      await fetch(`${API_BASE_URL}/api/schedules-all/${scheduleId}`, {
        method: 'DELETE',
        headers: { Authorization:`Bearer ${token}` },
      });
      showToast('Shift deleted ✓');
      setEditShift(null);
      await loadAll();
      onScheduleChange && onScheduleChange();
    } catch {
      showToast('Delete failed', 'error');
    } finally {
      setSaving(false);
    }
  }

  if (loading) return (
    <div style={{ display:'flex', alignItems:'center', justifyContent:'center', height:300, color:'#6B7280' }}>
      <div style={{ textAlign:'center' }}>
        <div style={{ fontSize:32, marginBottom:12 }}>📅</div>
        Loading schedule...
      </div>
    </div>
  );

  return (
    <div style={{ fontFamily:"'Segoe UI', sans-serif", background:'#F8FAFC' }}>

      {/* Toast */}
      {toast && (
        <div style={{
          position:'fixed', top:20, right:20, zIndex:9999,
          background: toast.type === 'error' ? '#EF4444' : '#10B981',
          color:'#fff', padding:'10px 18px', borderRadius:8,
          fontWeight:600, fontSize:14, boxShadow:'0 4px 16px rgba(0,0,0,0.15)',
        }}>
          {toast.msg}
        </div>
      )}

      {/* Header */}
      <div style={{ background:'#fff', borderBottom:'1px solid #E5E7EB', padding:'12px 20px', display:'flex', alignItems:'center', gap:12, flexWrap:'wrap' }}>
        <div style={{ display:'flex', gap:6 }}>
          <button onClick={prevWeek} style={navBtn}>‹</button>
          <button onClick={goToday}  style={{ ...navBtn, padding:'6px 14px', fontSize:13 }}>Today</button>
          <button onClick={nextWeek} style={navBtn}>›</button>
        </div>
        <span style={{ fontWeight:700, fontSize:16, color:'#111827', flex:1 }}>
          {weekDates[0].toLocaleDateString('en-US', { month:'short', day:'numeric' })}
          {' – '}
          {weekDates[6].toLocaleDateString('en-US', { month:'short', day:'numeric', year:'numeric' })}
        </span>
        <span style={{ fontSize:12, color:'#9CA3AF' }}>Click any cell to add a shift</span>
      </div>

      {/* Mobile Day Picker */}
      {isMobile && (
        <div style={{ background:'#fff', borderBottom:'1px solid #E5E7EB', padding:'8px 12px', overflowX:'auto', display:'flex', gap:6 }}>
          {weekDates.map((d, i) => (
            <button key={i} onClick={() => setMobileDay(i)} style={{
              flexShrink: 0,
              padding: '6px 12px',
              borderRadius: 8,
              border: 'none',
              background: mobileDay === i ? '#2ABBA7' : i === todayIdx ? '#EFF6FF' : '#F3F4F6',
              color: mobileDay === i ? '#fff' : i === todayIdx ? '#2563EB' : '#374151',
              fontWeight: mobileDay === i ? 700 : 500,
              fontSize: 13,
              cursor: 'pointer',
            }}>
              <div style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: 1 }}>{DAY_NAMES[i]}</div>
              <div style={{ fontSize: 16, fontWeight: 800 }}>{d.getDate()}</div>
            </button>
          ))}
        </div>
      )}

      {/* Mobile Day View */}
      {isMobile && (
        <div style={{ padding: '0.75rem' }}>
          {caregivers.length === 0 && (
            <div style={{ textAlign:'center', padding:'40px 20px', color:'#9CA3AF' }}>No caregivers found.</div>
          )}
          {caregivers.map(cg => {
            const shifts = getShiftsForCell(cg.id, mobileDay);
            return (
              <div key={cg.id} style={{ background:'#fff', borderRadius:12, border:'1px solid #E5E7EB', marginBottom:'0.75rem', overflow:'hidden' }}>
                <div style={{ padding:'10px 14px', background:'#FAFAFA', borderBottom:'1px solid #F3F4F6', display:'flex', justifyContent:'space-between', alignItems:'center' }}>
                  <div>
                    <div style={{ fontWeight:700, fontSize:14, color:'#111827' }}>{cg.first_name} {cg.last_name}</div>
                    <div style={{ fontSize:11, color:'#6B7280' }}>{weeklyHours(cg.id).toFixed(2)}h this week</div>
                  </div>
                  <button onClick={() => handleCellClick(cg.id, mobileDay)} style={{
                    padding:'6px 14px', borderRadius:8, border:'none',
                    background:'#2ABBA7', color:'#fff', fontSize:13, fontWeight:600, cursor:'pointer'
                  }}>+ Shift</button>
                </div>
                {shifts.length === 0 ? (
                  <div style={{ padding:'12px 14px', color:'#9CA3AF', fontSize:13 }}>No shifts</div>
                ) : (
                  shifts.map(s => {
                    const cl = clientMap[s.client_id];
                    const color = clientColor(s.client_id, clientMap);
                    const durH = ((timeToMinutes(s.end_time) - timeToMinutes(s.start_time)) / 60).toFixed(2);
                    return (
                      <div key={s.id} onClick={() => setEditShift(s)} style={{
                        padding:'10px 14px', borderLeft:`4px solid ${color}`,
                        borderBottom:'1px solid #F9FAFB', cursor:'pointer', display:'flex', justifyContent:'space-between', alignItems:'center'
                      }}>
                        <div>
                          <div style={{ fontWeight:600, fontSize:14 }}>{cl ? `${cl.first_name} ${cl.last_name}` : 'Unknown'}</div>
                          <div style={{ fontSize:12, color:'#6B7280', marginTop:2 }}>{formatTime(s.start_time)} – {formatTime(s.end_time)} · {durH}h</div>
                        </div>
                        <span style={{ fontSize:12, color:'#9CA3AF' }}>✏️</span>
                      </div>
                    );
                  })
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Desktop Grid */}
      {!isMobile && <div style={{ overflowX:'auto' }}>
        <div style={{ minWidth:860 }}>

          {/* Day headers */}
          <div style={{ display:'grid', gridTemplateColumns:'160px repeat(7, 1fr)', background:'#fff', borderBottom:'2px solid #E5E7EB', position:'sticky', top:0, zIndex:10 }}>
            <div style={{ padding:'10px 16px', fontSize:11, fontWeight:700, color:'#9CA3AF' }}>CAREGIVER</div>
            {weekDates.map((d, i) => (
              <div key={i} style={{
                padding:'10px 8px', textAlign:'center',
                borderLeft:'1px solid #F3F4F6',
                background: i === todayIdx ? '#EFF6FF' : 'transparent',
              }}>
                <div style={{ fontSize:11, fontWeight:700, color: i === todayIdx ? '#3B82F6' : '#6B7280', textTransform:'uppercase', letterSpacing:1 }}>
                  {DAY_NAMES[i]}
                </div>
                <div style={{ fontSize:18, fontWeight:800, color: i === todayIdx ? '#3B82F6' : '#111827' }}>
                  {d.getDate()}
                </div>
              </div>
            ))}
          </div>

          {/* Rows */}
          {caregivers.length === 0 && (
            <div style={{ textAlign:'center', padding:'60px 20px', color:'#9CA3AF' }}>
              No caregivers found.
            </div>
          )}

          {caregivers.map(cg => {
            const hrs    = weeklyHours(cg.id).toFixed(2);
            const isOver = parseFloat(hrs) > 40;
            return (
              <div key={cg.id} style={{ display:'grid', gridTemplateColumns:'160px repeat(7, 1fr)', borderBottom:'1px solid #F3F4F6', background:'#fff', minHeight:72 }}>

                {/* Name */}
                <div style={{ padding:'10px 14px', borderRight:'1px solid #F3F4F6', background:'#FAFAFA' }}>
                  <div style={{ fontWeight:700, fontSize:13, color:'#111827', whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>
                    {cg.first_name} {cg.last_name}
                  </div>
                  <div style={{ fontSize:11, color: isOver ? '#EF4444' : '#6B7280', fontWeight: isOver ? 700 : 400, marginTop:2 }}>
                    {hrs}h{isOver ? ' ⚠️ OT' : ''}
                  </div>
                </div>

                {/* Day cells */}
                {weekDates.map((_, dayIndex) => {
                  const shifts  = getShiftsForCell(cg.id, dayIndex);
                  const isToday = dayIndex === todayIdx;
                  return (
                    <div
                      key={dayIndex}
                      onClick={() => handleCellClick(cg.id, dayIndex)}
                      style={{
                        borderLeft:'1px solid #F3F4F6',
                        padding:'5px 4px',
                        minHeight:72,
                        background: isToday ? '#F0F9FF' : 'transparent',
                        cursor:'pointer',
                        transition:'background 0.1s',
                      }}
                      onMouseEnter={e => e.currentTarget.style.background = isToday ? '#DBEAFE' : '#F9FAFB'}
                      onMouseLeave={e => e.currentTarget.style.background = isToday ? '#F0F9FF' : 'transparent'}
                    >
                      {shifts.map(s => {
                        const client = clientMap[s.client_id];
                        const color  = clientColor(s.client_id, clientMap);
                        const durH   = ((timeToMinutes(s.end_time) - timeToMinutes(s.start_time)) / 60).toFixed(2);
                        return (
                          <div
                            key={s.id}
                            onClick={e => { e.stopPropagation(); setEditShift(s); }}
                            style={{
                              background: color,
                              color:'#fff',
                              borderRadius:5,
                              padding:'3px 6px',
                              marginBottom:3,
                              fontSize:11,
                              fontWeight:600,
                              cursor:'pointer',
                              userSelect:'none',
                              boxShadow:'0 1px 3px rgba(0,0,0,0.15)',
                            }}
                          >
                            <div style={{ whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis', fontWeight:700 }}>
                              {client ? `${client.first_name} ${client.last_name}` : 'Unknown'}
                            </div>
                            <div style={{ opacity:0.9, fontSize:10 }}>
                              {formatTime(s.start_time)}–{formatTime(s.end_time)} ({durH}h)
                              {!s.date && <span style={{ marginLeft:4, opacity:0.7 }}>↻</span>}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>
      </div>}

      {/* Client legend */}
      {clients.length > 0 && (
        <div style={{ padding:'12px 20px', background:'#fff', borderTop:'1px solid #E5E7EB', display:'flex', flexWrap:'wrap', gap:10, alignItems:'center' }}>
          <span style={{ fontSize:11, fontWeight:700, color:'#9CA3AF', textTransform:'uppercase', letterSpacing:1 }}>Clients:</span>
          {clients.map((c, i) => (
            <div key={c.id} style={{ display:'flex', alignItems:'center', gap:5, fontSize:12, color:'#374151' }}>
              <div style={{ width:10, height:10, borderRadius:2, background:PALETTE[i % PALETTE.length] }} />
              {c.first_name} {c.last_name}
            </div>
          ))}
        </div>
      )}

      {/* Create shift modal */}
      {newShift && (
        <Modal
          title={`New Shift — ${DAY_FULL[newShift.dayIndex]}, ${weekDates[newShift.dayIndex].toLocaleDateString('en-US',{ month:'long', day:'numeric' })}`}
          onClose={() => setNewShift(null)}
        >
          <Field label="Client">
            <select value={newShiftForm.clientId} onChange={e => setNewShiftForm(f => ({ ...f, clientId:e.target.value }))} style={inputStyle}>
              <option value="">— Select client —</option>
              {clients.map(c => <option key={c.id} value={c.id}>{c.first_name} {c.last_name}</option>)}
            </select>
          </Field>
          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:12, marginTop:12 }}>
            <Field label="Start">
              <input type="time" value={newShiftForm.startTime} onChange={e => setNewShiftForm(f => ({ ...f, startTime:e.target.value }))} style={inputStyle} />
            </Field>
            <Field label="End">
              <input type="time" value={newShiftForm.endTime} onChange={e => setNewShiftForm(f => ({ ...f, endTime:e.target.value }))} style={inputStyle} />
            </Field>
          </div>
          <Field label="Notes (optional)" style={{ marginTop:12 }}>
            <input type="text" value={newShiftForm.notes} onChange={e => setNewShiftForm(f => ({ ...f, notes:e.target.value }))} style={inputStyle} placeholder="Any notes..." />
          </Field>
          <div style={{ display:'flex', justifyContent:'flex-end', gap:8, marginTop:16 }}>
            <button onClick={() => setNewShift(null)} style={cancelBtn}>Cancel</button>
            <button onClick={handleCreateShift} disabled={saving} style={primaryBtn}>
              {saving ? 'Creating...' : 'Create Shift'}
            </button>
          </div>
        </Modal>
      )}

      {/* Edit/delete shift modal */}
      {editShift && (() => {
        const client = clientMap[editShift.client_id];
        const color  = clientColor(editShift.client_id, clientMap);
        const durH   = ((timeToMinutes(editShift.end_time) - timeToMinutes(editShift.start_time)) / 60).toFixed(2);
        return (
          <Modal title="Shift Details" onClose={() => setEditShift(null)}>
            <div style={{ background:color, borderRadius:8, padding:'12px 16px', color:'#fff', marginBottom:16 }}>
              <div style={{ fontWeight:800, fontSize:16 }}>{client ? `${client.first_name} ${client.last_name}` : 'Unknown'}</div>
              <div style={{ opacity:0.9, marginTop:2 }}>
                {formatTime(editShift.start_time)} – {formatTime(editShift.end_time)} · {durH}h
              </div>
              {!editShift.date && (
                <div style={{ opacity:0.75, fontSize:12, marginTop:4 }}>↻ Recurring every {DAY_FULL[editShift.day_of_week]}</div>
              )}
            </div>
            {editShift.notes && (
              <div style={{ background:'#F9FAFB', padding:'10px 14px', borderRadius:6, fontSize:13, color:'#374151', marginBottom:16 }}>
                📝 {editShift.notes}
              </div>
            )}
            <div style={{ display:'flex', justifyContent:'space-between' }}>
              <button onClick={() => handleDeleteShift(editShift.id)} disabled={saving} style={{ ...cancelBtn, color:'#EF4444', borderColor:'#FECACA' }}>
                {saving ? '...' : 'Delete Shift'}
              </button>
              <button onClick={() => setEditShift(null)} style={primaryBtn}>Close</button>
            </div>
          </Modal>
        );
      })()}
    </div>
  );
}

function Modal({ title, onClose, children }) {
  return (
    <div
      style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.4)', zIndex:1000, display:'flex', alignItems:'center', justifyContent:'center', padding:16 }}
      onClick={e => e.target === e.currentTarget && onClose()}
    >
      <div style={{ background:'#fff', borderRadius:12, width:'100%', maxWidth:420, boxShadow:'0 20px 60px rgba(0,0,0,0.2)' }}>
        <div style={{ padding:'14px 20px', borderBottom:'1px solid #E5E7EB', display:'flex', justifyContent:'space-between', alignItems:'center' }}>
          <h3 style={{ margin:0, fontSize:15, fontWeight:700, color:'#111827' }}>{title}</h3>
          <button onClick={onClose} style={{ background:'none', border:'none', cursor:'pointer', fontSize:20, color:'#9CA3AF', lineHeight:1 }}>×</button>
        </div>
        <div style={{ padding:20 }}>{children}</div>
      </div>
    </div>
  );
}

function Field({ label, children, style }) {
  return (
    <div style={style}>
      <label style={{ display:'block', fontSize:11, fontWeight:700, color:'#374151', marginBottom:4, textTransform:'uppercase', letterSpacing:0.5 }}>{label}</label>
      {children}
    </div>
  );
}

const inputStyle  = { width:'100%', padding:'8px 10px', border:'1px solid #D1D5DB', borderRadius:6, fontSize:14, boxSizing:'border-box' };
const primaryBtn  = { background:'#3B82F6', color:'#fff', border:'none', borderRadius:7, padding:'9px 20px', fontWeight:700, fontSize:14, cursor:'pointer' };
const cancelBtn   = { background:'#fff', color:'#6B7280', border:'1px solid #D1D5DB', borderRadius:7, padding:'9px 16px', fontWeight:600, fontSize:14, cursor:'pointer' };
const navBtn      = { background:'#F3F4F6', border:'1px solid #E5E7EB', borderRadius:7, padding:'6px 12px', cursor:'pointer', fontSize:15, color:'#374151', fontWeight:600 };
