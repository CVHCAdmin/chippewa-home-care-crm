// SchedulerGrid.jsx - Weekly schedule grid: click cell to create, click shift to edit/delete
import React, { useState, useEffect, useCallback } from 'react';
import { API_BASE_URL } from '../../config';
import { getTodayCT } from '../../utils/timezone';

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
  const [newShiftForm, setNewShiftForm] = useState({ clientId:'', startTime:'09:00', endTime:'13:00', notes:'', isSplit:false, split2Start:'16:00', split2End:'20:00' });
  const [splitError, setSplitError]     = useState('');
  const [editShift, setEditShift]         = useState(null);
  const [editShiftForm, setEditShiftForm] = useState({ clientId:'', startTime:'', endTime:'', notes:'' });
  const [editScope, setEditScope]         = useState('all'); // 'all' | 'once'
  const [editDate, setEditDate]           = useState('');

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
      if (!cgRes.ok || !clRes.ok || !schRes.ok) throw new Error('Failed to load schedule data');
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
  const todayStr     = getTodayCT();
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
    setNewShiftForm({ clientId:'', startTime:'09:00', endTime:'13:00', notes:'', isSplit:false, split2Start:'16:00', split2End:'20:00' });
    setSplitError('');
  }

  // Validate split shift times and set error message
  function validateSplitTimes(form) {
    if (!form.isSplit) { setSplitError(''); return true; }
    if (form.split2Start <= form.endTime) {
      setSplitError('Shift 2 must start after Shift 1 ends');
      return false;
    }
    if (form.split2End <= form.split2Start) {
      setSplitError('Shift 2 end must be after Shift 2 start');
      return false;
    }
    setSplitError('');
    return true;
  }

  async function handleCreateShift() {
    if (!newShiftForm.clientId) return showToast('Select a client', 'error');
    if (!validateSplitTimes(newShiftForm)) return;
    setSaving(true);
    try {
      const payload = {
        caregiverId:  newShift.caregiverId,
        clientId:     newShiftForm.clientId,
        scheduleType: 'one-time',
        date:         weekDateStrs[newShift.dayIndex],
        startTime:    newShiftForm.startTime,
        endTime:      newShiftForm.endTime,
        notes:        newShiftForm.notes,
      };
      if (newShiftForm.isSplit) {
        payload.splitShift = {
          startTime: newShiftForm.split2Start,
          endTime:   newShiftForm.split2End,
        };
      }
      const res = await fetch(`${API_BASE_URL}/api/schedules-enhanced`, {
        method: 'POST',
        headers: { 'Content-Type':'application/json', Authorization:`Bearer ${token}` },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || 'Failed to create shift');
      }
      showToast(newShiftForm.isSplit ? 'Split shift created' : 'Shift created');
      setNewShift(null);
      await loadAll();
      onScheduleChange && onScheduleChange();
    } catch (err) {
      showToast(err.message, 'error');
    } finally {
      setSaving(false);
    }
  }

  async function handleDeleteShift(scheduleId, shift) {
    const isSplit = shift && shift.is_split_shift;
    const msg = isSplit ? 'Delete both segments of this split shift?' : 'Delete this shift?';
    if (!window.confirm(msg)) return;
    setSaving(true);
    try {
      const url = isSplit
        ? `${API_BASE_URL}/api/schedules/${scheduleId}?deletePair=true`
        : `${API_BASE_URL}/api/schedules/${scheduleId}`;
      await fetch(url, {
        method: 'DELETE',
        headers: { Authorization:`Bearer ${token}` },
      });
      showToast(isSplit ? 'Split shift pair deleted' : 'Shift deleted');
      setEditShift(null);
      await loadAll();
      onScheduleChange && onScheduleChange();
    } catch {
      showToast('Delete failed', 'error');
    } finally {
      setSaving(false);
    }
  }

  function openEditShift(s, cellDate) {
    setEditShift(s);
    setEditDate(cellDate || '');
    setEditScope('all');
    setEditShiftForm({
      clientId:  s.client_id || '',
      startTime: s.start_time ? s.start_time.slice(0,5) : '09:00',
      endTime:   s.end_time   ? s.end_time.slice(0,5)   : '13:00',
      notes:     s.notes || '',
    });
  }

  async function handleSaveShift() {
    if (!editShiftForm.clientId) return showToast('Select a client', 'error');
    if (editShiftForm.startTime >= editShiftForm.endTime) return showToast('End time must be after start', 'error');
    setSaving(true);
    try {
      if (editScope === 'once') {
        // Create a one-time override for just this date
        const res = await fetch(`${API_BASE_URL}/api/schedules-enhanced`, {
          method: 'POST',
          headers: { 'Content-Type':'application/json', Authorization:`Bearer ${token}` },
          body: JSON.stringify({
            caregiverId:  editShift.caregiver_id,
            clientId:     editShiftForm.clientId,
            scheduleType: 'one-time',
            date:         editDate,
            startTime:    editShiftForm.startTime,
            endTime:      editShiftForm.endTime,
            notes:        editShiftForm.notes,
          }),
        });
        if (!res.ok) throw new Error('Failed to create one-time shift');
        showToast(`One-time shift created for ${new Date(editDate + 'T12:00:00').toLocaleDateString('en-US', { weekday:'short', month:'short', day:'numeric' })}`);
      } else {
        // Update the recurring schedule itself
        const res = await fetch(`${API_BASE_URL}/api/schedules-all/${editShift.id}`, {
          method: 'PUT',
          headers: { 'Content-Type':'application/json', Authorization:`Bearer ${token}` },
          body: JSON.stringify({
            clientId:   editShiftForm.clientId,
            startTime:  editShiftForm.startTime,
            endTime:    editShiftForm.endTime,
            notes:      editShiftForm.notes,
            dayOfWeek:  editShift.day_of_week,
            date:       editShift.date ? editShift.date.slice(0,10) : null,
            frequency:  editShift.frequency || 'weekly',
            anchorDate: editShift.anchor_date || null,
          }),
        });
        if (!res.ok) throw new Error('Failed to save');
        showToast('Shift updated');
      }
      setEditShift(null);
      await loadAll();
      onScheduleChange && onScheduleChange();
    } catch (err) {
      showToast(err.message, 'error');
    } finally {
      setSaving(false);
    }
  }

  // Helper: find the split partner of a shift in the same cell
  function getSplitPartner(shift, cellShifts) {
    if (!shift.is_split_shift || !shift.split_shift_group_id) return null;
    return cellShifts.find(s => s.id !== shift.id && s.split_shift_group_id === shift.split_shift_group_id) || null;
  }

  // Render a single shift block on the grid
  function renderShiftBlock(s, dayIndex, cellShifts) {
    const client = clientMap[s.client_id];
    const color  = clientColor(s.client_id, clientMap);
    const durH   = Number(parseFloat((timeToMinutes(s.end_time) - timeToMinutes(s.start_time)) / 60 || 0)).toFixed(2);
    const isSplit = s.is_split_shift && s.split_segment;
    const partner = isSplit ? getSplitPartner(s, cellShifts) : null;
    // Only show the dashed connector above segment 2
    const showConnector = isSplit && s.split_segment === 2 && partner;

    return (
      <React.Fragment key={s.id}>
        {showConnector && (
          <div style={{
            borderLeft: `2px dashed ${color}`,
            height: 8,
            marginLeft: 12,
            opacity: 0.5,
          }} />
        )}
        <div
          onClick={e => { e.stopPropagation(); openEditShift(s, weekDateStrs[dayIndex]); }}
          style={{
            background: color,
            color:'#fff',
            borderRadius:5,
            padding:'3px 6px',
            marginBottom: isSplit && s.split_segment === 1 ? 0 : 3,
            fontSize:11,
            fontWeight:600,
            cursor:'pointer',
            userSelect:'none',
            boxShadow:'0 1px 3px rgba(0,0,0,0.15)',
            borderLeft: isSplit ? '3px solid rgba(255,255,255,0.5)' : undefined,
          }}
        >
          <div style={{ whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis', fontWeight:700, display:'flex', alignItems:'center', gap:3 }}>
            {client ? `${client.first_name} ${client.last_name}` : 'Unknown'}
            {isSplit && <span style={{ fontSize:8, opacity:0.8, background:'rgba(255,255,255,0.25)', borderRadius:3, padding:'1px 3px' }}>Split {s.split_segment}/2</span>}
          </div>
          <div style={{ opacity:0.9, fontSize:10 }}>
            {formatTime(s.start_time)}-{formatTime(s.end_time)} ({durH}h)
            {!s.date && <span style={{ marginLeft:4, opacity:0.7 }}>&#8635;</span>}
          </div>
        </div>
      </React.Fragment>
    );
  }

  if (loading) return (
    <div style={{ display:'flex', alignItems:'center', justifyContent:'center', height:300, color:'#6B7280' }}>
      <div style={{ textAlign:'center' }}>
        <div style={{ fontSize:32, marginBottom:12 }}>&#128197;</div>
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
          <button onClick={prevWeek} style={navBtn}>&#8249;</button>
          <button onClick={goToday}  style={{ ...navBtn, padding:'6px 14px', fontSize:13 }}>Today</button>
          <button onClick={nextWeek} style={navBtn}>&#8250;</button>
        </div>
        <span style={{ fontWeight:700, fontSize:16, color:'#111827', flex:1 }}>
          {weekDates[0].toLocaleDateString('en-US', { month:'short', day:'numeric' })}
          {' \u2013 '}
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
                    <div style={{ fontSize:11, color:'#6B7280' }}>{Number(parseFloat(weeklyHours(cg.id) || 0)).toFixed(2)}h this week</div>
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
                    const durH = Number(parseFloat((timeToMinutes(s.end_time) - timeToMinutes(s.start_time)) / 60 || 0)).toFixed(2);
                    const isSplit = s.is_split_shift && s.split_segment;
                    return (
                      <div key={s.id} onClick={() => openEditShift(s, weekDateStrs[mobileDay])} style={{
                        padding:'10px 14px', borderLeft:`4px solid ${color}`,
                        borderBottom:'1px solid #F9FAFB', cursor:'pointer', display:'flex', justifyContent:'space-between', alignItems:'center'
                      }}>
                        <div>
                          <div style={{ fontWeight:600, fontSize:14, display:'flex', alignItems:'center', gap:6 }}>
                            {cl ? `${cl.first_name} ${cl.last_name}` : 'Unknown'}
                            {isSplit && <span style={{ fontSize:10, color, background:`${color}20`, borderRadius:4, padding:'1px 5px', fontWeight:700 }}>Split {s.split_segment}/2</span>}
                          </div>
                          <div style={{ fontSize:12, color:'#6B7280', marginTop:2 }}>{formatTime(s.start_time)} \u2013 {formatTime(s.end_time)} \u00B7 {durH}h</div>
                        </div>
                        <span style={{ fontSize:12, color:'#9CA3AF' }}>&#9998;</span>
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
            const hrs    = Number(parseFloat(weeklyHours(cg.id) || 0)).toFixed(2);
            const isOver = parseFloat(hrs) > 40;
            return (
              <div key={cg.id} style={{ display:'grid', gridTemplateColumns:'160px repeat(7, 1fr)', borderBottom:'1px solid #F3F4F6', background:'#fff', minHeight:72 }}>

                {/* Name */}
                <div style={{ padding:'10px 14px', borderRight:'1px solid #F3F4F6', background:'#FAFAFA' }}>
                  <div style={{ fontWeight:700, fontSize:13, color:'#111827', whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>
                    {cg.first_name} {cg.last_name}
                  </div>
                  <div style={{ fontSize:11, color: isOver ? '#EF4444' : '#6B7280', fontWeight: isOver ? 700 : 400, marginTop:2 }}>
                    {hrs}h{isOver ? ' \u26A0\uFE0F OT' : ''}
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
                      {shifts.map(s => renderShiftBlock(s, dayIndex, shifts))}
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
          title={`New Shift \u2014 ${DAY_FULL[newShift.dayIndex]}, ${weekDates[newShift.dayIndex].toLocaleDateString('en-US',{ month:'long', day:'numeric' })}`}
          onClose={() => setNewShift(null)}
        >
          <Field label="Client">
            <select value={newShiftForm.clientId} onChange={e => setNewShiftForm(f => ({ ...f, clientId:e.target.value }))} style={inputStyle}>
              <option value="">\u2014 Select client \u2014</option>
              {clients.map(c => <option key={c.id} value={c.id}>{c.first_name} {c.last_name}</option>)}
            </select>
          </Field>

          {/* Shift 1 time block */}
          <div style={{ marginTop:12 }}>
            {newShiftForm.isSplit && <div style={{ fontSize:11, fontWeight:700, color:'#3B82F6', marginBottom:4 }}>SHIFT 1</div>}
            <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:12 }}>
              <Field label="Start">
                <input type="time" value={newShiftForm.startTime} onChange={e => {
                  const f = { ...newShiftForm, startTime:e.target.value };
                  setNewShiftForm(f);
                  validateSplitTimes(f);
                }} style={inputStyle} />
              </Field>
              <Field label="End">
                <input type="time" value={newShiftForm.endTime} onChange={e => {
                  const f = { ...newShiftForm, endTime:e.target.value };
                  setNewShiftForm(f);
                  validateSplitTimes(f);
                }} style={inputStyle} />
              </Field>
            </div>
          </div>

          {/* Split Shift Toggle */}
          <div style={{ marginTop:14, display:'flex', alignItems:'center', gap:8 }}>
            <label style={{ display:'flex', alignItems:'center', gap:8, cursor:'pointer', fontSize:13, fontWeight:600, color:'#374151' }}>
              <div
                onClick={() => {
                  const next = { ...newShiftForm, isSplit: !newShiftForm.isSplit };
                  if (!next.isSplit) { next.split2Start = '16:00'; next.split2End = '20:00'; }
                  setNewShiftForm(next);
                  validateSplitTimes(next);
                }}
                style={{
                  width:36, height:20, borderRadius:10, position:'relative', cursor:'pointer',
                  background: newShiftForm.isSplit ? '#3B82F6' : '#D1D5DB',
                  transition:'background 0.2s',
                }}
              >
                <div style={{
                  width:16, height:16, borderRadius:'50%', background:'#fff', position:'absolute', top:2,
                  left: newShiftForm.isSplit ? 18 : 2,
                  transition:'left 0.2s', boxShadow:'0 1px 3px rgba(0,0,0,0.2)',
                }} />
              </div>
              Split Shift
            </label>
            {newShiftForm.isSplit && (
              <span style={{ fontSize:11, color:'#6B7280' }}>Two segments, same day</span>
            )}
          </div>

          {/* Shift 2 time block (split only) */}
          {newShiftForm.isSplit && (
            <>
              <div style={{ borderTop:'1px dashed #D1D5DB', margin:'14px 0 10px', position:'relative' }}>
                <span style={{ position:'absolute', top:-9, left:'50%', transform:'translateX(-50%)', background:'#fff', padding:'0 8px', fontSize:10, color:'#6B7280', fontWeight:700 }}>BREAK</span>
              </div>
              <div style={{ fontSize:11, fontWeight:700, color:'#3B82F6', marginBottom:4 }}>SHIFT 2</div>
              <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:12 }}>
                <Field label="Start">
                  <input type="time" value={newShiftForm.split2Start} onChange={e => {
                    const f = { ...newShiftForm, split2Start:e.target.value };
                    setNewShiftForm(f);
                    validateSplitTimes(f);
                  }} style={inputStyle} />
                </Field>
                <Field label="End">
                  <input type="time" value={newShiftForm.split2End} onChange={e => {
                    const f = { ...newShiftForm, split2End:e.target.value };
                    setNewShiftForm(f);
                    validateSplitTimes(f);
                  }} style={inputStyle} />
                </Field>
              </div>
              {splitError && (
                <div style={{ color:'#EF4444', fontSize:12, marginTop:6, fontWeight:600 }}>
                  {splitError}
                </div>
              )}
            </>
          )}

          <Field label="Notes (optional)" style={{ marginTop:12 }}>
            <input type="text" value={newShiftForm.notes} onChange={e => setNewShiftForm(f => ({ ...f, notes:e.target.value }))} style={inputStyle} placeholder="Any notes..." />
          </Field>
          <div style={{ display:'flex', justifyContent:'flex-end', gap:8, marginTop:16 }}>
            <button onClick={() => setNewShift(null)} style={cancelBtn}>Cancel</button>
            <button onClick={handleCreateShift} disabled={saving || (newShiftForm.isSplit && !!splitError)} style={{
              ...primaryBtn,
              opacity: (saving || (newShiftForm.isSplit && !!splitError)) ? 0.6 : 1,
            }}>
              {saving ? 'Creating...' : newShiftForm.isSplit ? 'Create Split Shift' : 'Create Shift'}
            </button>
          </div>
        </Modal>
      )}

      {/* Edit/delete shift modal */}
      {editShift && (() => {
        const durH  = editShiftForm.startTime && editShiftForm.endTime
          ? Number(parseFloat((timeToMinutes(editShiftForm.endTime) - timeToMinutes(editShiftForm.startTime)) / 60 || 0)).toFixed(2)
          : '0';
        const isRecurring = editShift.day_of_week !== null && editShift.day_of_week !== undefined;
        const isSplit = editShift.is_split_shift;
        return (
          <Modal title={isSplit ? `Edit Shift (Split ${editShift.split_segment}/2)` : 'Edit Shift'} onClose={() => setEditShift(null)}>
            {isSplit && (
              <div style={{ marginBottom:12, fontSize:12, color:'#3B82F6', background:'#EFF6FF', padding:'8px 10px', borderRadius:6, display:'flex', alignItems:'center', gap:6 }}>
                <span style={{ fontSize:14 }}>&#128279;</span>
                This is segment {editShift.split_segment} of a split shift. Deleting will remove both segments.
              </div>
            )}
            {isRecurring && (
              <div style={{ marginBottom:12 }}>
                <div style={{ fontSize:12, fontWeight:700, color:'#374151', marginBottom:6 }}>Apply changes to:</div>
                <div style={{ display:'flex', gap:8 }}>
                  <button type="button" onClick={() => setEditScope('all')} style={{
                    flex:1, padding:'8px 0', borderRadius:8, border:'2px solid', cursor:'pointer', fontWeight:600, fontSize:13,
                    borderColor: editScope === 'all' ? '#F59E0B' : '#E5E7EB',
                    background: editScope === 'all' ? '#FFFBEB' : '#fff',
                    color: editScope === 'all' ? '#92400E' : '#6B7280',
                  }}>&#8635; All future occurrences</button>
                  <button type="button" onClick={() => setEditScope('once')} style={{
                    flex:1, padding:'8px 0', borderRadius:8, border:'2px solid', cursor:'pointer', fontWeight:600, fontSize:13,
                    borderColor: editScope === 'once' ? '#3B82F6' : '#E5E7EB',
                    background: editScope === 'once' ? '#EFF6FF' : '#fff',
                    color: editScope === 'once' ? '#1D4ED8' : '#6B7280',
                  }}>&#128197; This date only{editDate ? ` (${new Date(editDate + 'T12:00:00').toLocaleDateString('en-US', { month:'short', day:'numeric' })})` : ''}</button>
                </div>
                {editScope === 'once' && (
                  <div style={{ marginTop:6, fontSize:12, color:'#2563EB', background:'#EFF6FF', padding:'6px 10px', borderRadius:6 }}>
                    A one-time shift will be created for this date. The recurring schedule stays unchanged.
                  </div>
                )}
                {editScope === 'all' && (
                  <div style={{ marginTop:6, fontSize:12, color:'#92400E', background:'#FFFBEB', padding:'6px 10px', borderRadius:6 }}>
                    Changes will apply to all future instances of this recurring shift.
                  </div>
                )}
              </div>
            )}
            <Field label="Client">
              <select value={editShiftForm.clientId} onChange={e => setEditShiftForm(f => ({ ...f, clientId: e.target.value }))} style={inputStyle}>
                <option value=''>Select client...</option>
                {clients.map(c => <option key={c.id} value={c.id}>{c.first_name} {c.last_name}</option>)}
              </select>
            </Field>
            <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:10, marginTop:10 }}>
              <Field label="Start Time">
                <input type="time" value={editShiftForm.startTime} onChange={e => setEditShiftForm(f => ({ ...f, startTime: e.target.value }))} style={inputStyle} />
              </Field>
              <Field label="End Time">
                <input type="time" value={editShiftForm.endTime} onChange={e => setEditShiftForm(f => ({ ...f, endTime: e.target.value }))} style={inputStyle} />
              </Field>
            </div>
            {editShiftForm.startTime && editShiftForm.endTime && (
              <div style={{ textAlign:'center', fontSize:12, color:'#6B7280', margin:'6px 0 2px', background:'#F3F4F6', borderRadius:6, padding:'4px 0' }}>
                {formatTime(editShiftForm.startTime)} \u2013 {formatTime(editShiftForm.endTime)} \u00B7 <strong>{durH}h</strong>
              </div>
            )}
            <Field label="Notes (optional)" style={{ marginTop:10 }}>
              <input type="text" value={editShiftForm.notes} onChange={e => setEditShiftForm(f => ({ ...f, notes: e.target.value }))} style={inputStyle} placeholder="Any notes..." />
            </Field>
            <div style={{ display:'flex', justifyContent:'space-between', marginTop:16 }}>
              <button onClick={() => handleDeleteShift(editShift.id, editShift)} disabled={saving} style={{ ...cancelBtn, color:'#EF4444', borderColor:'#FECACA' }}>
                {saving ? '...' : isSplit ? 'Delete Split Pair' : 'Delete Shift'}
              </button>
              <div style={{ display:'flex', gap:8 }}>
                <button onClick={() => setEditShift(null)} style={cancelBtn}>Cancel</button>
                <button onClick={handleSaveShift} disabled={saving} style={primaryBtn}>
                  {saving ? 'Saving...' : 'Save Changes'}
                </button>
              </div>
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
      <div style={{ background:'#fff', borderRadius:12, width:'100%', maxWidth:420, boxShadow:'0 20px 60px rgba(0,0,0,0.2)', maxHeight:'90vh', overflowY:'auto' }}>
        <div style={{ padding:'14px 20px', borderBottom:'1px solid #E5E7EB', display:'flex', justifyContent:'space-between', alignItems:'center' }}>
          <h3 style={{ margin:0, fontSize:15, fontWeight:700, color:'#111827' }}>{title}</h3>
          <button onClick={onClose} style={{ background:'none', border:'none', cursor:'pointer', fontSize:20, color:'#9CA3AF', lineHeight:1 }}>\u00D7</button>
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
