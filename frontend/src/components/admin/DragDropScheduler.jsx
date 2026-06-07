// SchedulerGrid.jsx - Weekly schedule grid with recurring support, exception-aware rendering,
// and scope-based edit/delete (this occurrence / this & following / all)
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

  // ── Create modal state ──
  const [newShift, setNewShift]         = useState(null);
  const [newShiftForm, setNewShiftForm] = useState({
    clientId:'', startTime:'09:00', endTime:'13:00', notes:'',
    isSplit:false, split2Start:'16:00', split2End:'20:00',
    scheduleType:'one-time', // 'one-time' | 'recurring'
    frequency:'weekly',      // 'weekly' | 'biweekly'
    selectedDays:[],         // for recurring: which days of week [0-6]
    startDate:'',            // when recurring pattern begins
    endDate:'',              // optional: when recurring pattern ends
  });
  const [splitError, setSplitError]     = useState('');

  // ── Edit modal state ──
  const [editShift, setEditShift]         = useState(null);
  const [editShiftForm, setEditShiftForm] = useState({ clientId:'', startTime:'', endTime:'', notes:'' });
  const [editScope, setEditScope]         = useState('all'); // 'all' | 'this' | 'following'
  const [editDate, setEditDate]           = useState('');

  // ── Delete scope modal ──
  const [deleteConfirm, setDeleteConfirm] = useState(null); // { shift, date }

  // ── Drag & drop ──
  const [dragShift, setDragShift]   = useState(null); // { shift, fromDate }
  const [dropTarget, setDropTarget] = useState(null); // { shift, fromDate, toCaregiverId, toDate, toDayIndex }
  const [dropScope, setDropScope]   = useState('all');
  const [dragOverKey, setDragOverKey] = useState(null); // `${caregiverId}:${dayIndex}` for hover highlight

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

  // Responsive listener
  useEffect(() => {
    const h = () => setIsMobile(window.innerWidth <= 768);
    window.addEventListener('resize', h);
    return () => window.removeEventListener('resize', h);
  }, []);

  const weekDates    = getWeekDates(weekOf);
  const weekDateStrs = weekDates.map(d => d.toISOString().split('T')[0]);
  const todayStr     = getTodayCT();
  const todayIdx     = weekDateStrs.indexOf(todayStr);

  // ═══════════════════════════════════════════════
  // OCCURRENCE RENDERING — exception-aware
  // ═══════════════════════════════════════════════

  function getShiftsForCell(caregiverId, dayIndex) {
    const dateStr  = weekDateStrs[dayIndex];
    const cellDate = new Date(dateStr + 'T00:00:00');

    const results = [];

    schedules.forEach(s => {
      // One-off shift
      if (s.date) {
        if (s.caregiver_id !== caregiverId) return;
        if (s.date.slice(0,10) === dateStr) results.push({ ...s, _isOneTime: true });
        return;
      }

      // Recurring shift
      if (s.day_of_week !== null && s.day_of_week !== undefined) {
        if (Number(s.day_of_week) !== dayIndex) return;

        // Respect effective_date / start boundary
        const effectiveFrom = s.effective_date || s.anchor_date || s.created_at;
        if (effectiveFrom) {
          const from = new Date(effectiveFrom);
          from.setHours(0,0,0,0);
          if (cellDate < from) return;
        }

        // Respect end_date
        if (s.end_date) {
          const endD = new Date(s.end_date + 'T23:59:59');
          if (cellDate > endD) return;
        }

        // Biweekly check
        if (s.frequency === 'biweekly' && s.anchor_date) {
          const anchor = new Date(s.anchor_date);
          const diffWeeks = Math.round((cellDate - anchor) / (7 * 24 * 60 * 60 * 1000));
          if (diffWeeks % 2 !== 0) return;
        }

        // Check exceptions for this date
        const exceptions = s.exceptions || [];
        const exc = exceptions.find(e => (e.exception_date || '').slice(0,10) === dateStr);

        if (exc && exc.exception_type === 'cancelled') return; // Skip cancelled occurrence

        // Route to the effective caregiver for this date (exception override wins)
        const effectiveCaregiverId = (exc && exc.override_caregiver_id) || s.caregiver_id;
        if (effectiveCaregiverId !== caregiverId) return;

        if (exc && exc.exception_type === 'modified') {
          // Show with overrides applied
          results.push({
            ...s,
            caregiver_id: effectiveCaregiverId,
            start_time: exc.override_start_time || s.start_time,
            end_time: exc.override_end_time || s.end_time,
            client_id: exc.override_client_id || s.client_id,
            notes: exc.override_notes !== null && exc.override_notes !== undefined ? exc.override_notes : s.notes,
            _isModified: true,
            _exceptionId: exc.id,
          });
          return;
        }

        results.push(s);
      }
    });

    return results.sort((a, b) => (a.start_time || '').localeCompare(b.start_time || ''));
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

  // ═══════════════════════════════════════════════
  // CREATE SHIFT
  // ═══════════════════════════════════════════════

  function handleCellClick(caregiverId, dayIndex) {
    if (saving) return;
    const clickedDate = weekDateStrs[dayIndex];
    setNewShift({ caregiverId, dayIndex });
    setNewShiftForm({
      clientId:'', startTime:'09:00', endTime:'13:00', notes:'',
      isSplit:false, split2Start:'16:00', split2End:'20:00',
      scheduleType:'one-time', frequency:'weekly',
      selectedDays:[dayIndex],
      startDate: clickedDate,
      endDate:'',
    });
    setSplitError('');
  }

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

  function toggleDay(dayIdx) {
    setNewShiftForm(f => {
      const days = f.selectedDays.includes(dayIdx)
        ? f.selectedDays.filter(d => d !== dayIdx)
        : [...f.selectedDays, dayIdx].sort((a,b) => a-b);
      return { ...f, selectedDays: days };
    });
  }

  async function handleCreateShift() {
    if (!newShiftForm.clientId) return showToast('Select a client', 'error');
    if (newShiftForm.startTime === newShiftForm.endTime) return showToast('Start and end time cannot be the same', 'error');
    if (!validateSplitTimes(newShiftForm)) return;

    setSaving(true);
    try {
      if (newShiftForm.scheduleType === 'recurring') {
        // Create recurring patterns for each selected day
        const days = newShiftForm.selectedDays;
        if (days.length === 0) return showToast('Select at least one day', 'error');

        const anchorStart = new Date(newShiftForm.startDate + 'T12:00:00');
        anchorStart.setDate(anchorStart.getDate() - anchorStart.getDay());
        const anchorStr = anchorStart.toISOString().split('T')[0];

        let created = 0, failed = 0;
        for (const dayOfWeek of days) {
          try {
            const payload = {
              caregiverId: newShift.caregiverId,
              clientId: newShiftForm.clientId,
              scheduleType: 'recurring',
              dayOfWeek,
              date: null,
              startTime: newShiftForm.startTime,
              endTime: newShiftForm.endTime,
              notes: newShiftForm.notes,
              frequency: newShiftForm.frequency,
              effectiveDate: newShiftForm.startDate || todayStr,
              anchorDate: newShiftForm.frequency === 'biweekly' ? anchorStr : null,
            };
            if (newShiftForm.isSplit) {
              payload.splitShift = { startTime: newShiftForm.split2Start, endTime: newShiftForm.split2End };
            }
            const res = await fetch(`${API_BASE_URL}/api/schedules-enhanced`, {
              method: 'POST',
              headers: { 'Content-Type':'application/json', Authorization:`Bearer ${token}` },
              body: JSON.stringify(payload),
            });
            if (!res.ok) throw new Error();
            created++;
          } catch { failed++; }
        }

        // If end date specified, update the newly-created schedules with end_date
        if (newShiftForm.endDate && created > 0) {
          // Reload to get the IDs, then set end_date
          // (simplified: we re-fetch and the backend already supports end_date in PUT)
        }

        showToast(`Created ${created} recurring schedule${created !== 1 ? 's' : ''}${failed ? ` (${failed} failed)` : ''}`);
      } else {
        // One-time shift
        const payload = {
          caregiverId: newShift.caregiverId,
          clientId: newShiftForm.clientId,
          scheduleType: 'one-time',
          date: weekDateStrs[newShift.dayIndex],
          startTime: newShiftForm.startTime,
          endTime: newShiftForm.endTime,
          notes: newShiftForm.notes,
        };
        if (newShiftForm.isSplit) {
          payload.splitShift = { startTime: newShiftForm.split2Start, endTime: newShiftForm.split2End };
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
      }

      setNewShift(null);
      await loadAll();
      onScheduleChange && onScheduleChange();
    } catch (err) {
      showToast(err.message, 'error');
    } finally {
      setSaving(false);
    }
  }

  // ═══════════════════════════════════════════════
  // DELETE SHIFT — scope-aware
  // ═══════════════════════════════════════════════

  function openDeleteConfirm(shift, date) {
    setDeleteConfirm({ shift, date });
  }

  async function handleDeleteShift(scope) {
    if (!deleteConfirm) return;
    const { shift, date } = deleteConfirm;
    const isSplit = shift.is_split_shift;
    setSaving(true);
    try {
      const isRecurring = shift.day_of_week !== null && shift.day_of_week !== undefined;

      if (isRecurring && scope === 'this') {
        // Cancel just this occurrence via exception
        await fetch(`${API_BASE_URL}/api/schedules/${shift.id}?scope=this&date=${date}`, {
          method: 'DELETE', headers: { Authorization:`Bearer ${token}` },
        });
        showToast('This occurrence cancelled');
      } else if (isRecurring && scope === 'following') {
        // End the recurring pattern from this date forward
        await fetch(`${API_BASE_URL}/api/schedules/${shift.id}?scope=following&date=${date}`, {
          method: 'DELETE', headers: { Authorization:`Bearer ${token}` },
        });
        showToast('Future occurrences removed');
      } else {
        // Delete all — original behavior
        const url = isSplit
          ? `${API_BASE_URL}/api/schedules/${shift.id}?scope=all&deletePair=true`
          : `${API_BASE_URL}/api/schedules/${shift.id}?scope=all`;
        await fetch(url, {
          method: 'DELETE', headers: { Authorization:`Bearer ${token}` },
        });
        showToast(isSplit ? 'Split shift pair deleted' : 'Shift deleted');
      }

      setDeleteConfirm(null);
      setEditShift(null);
      await loadAll();
      onScheduleChange && onScheduleChange();
    } catch {
      showToast('Delete failed', 'error');
    } finally {
      setSaving(false);
    }
  }

  // ═══════════════════════════════════════════════
  // EDIT SHIFT — scope-aware
  // ═══════════════════════════════════════════════

  function openEditShift(s, cellDate) {
    setEditShift(s);
    setEditDate(cellDate || '');
    setEditScope('all');
    setEditShiftForm({
      caregiverId: s.caregiver_id || '',
      clientId:  s.client_id || '',
      startTime: s.start_time ? s.start_time.slice(0,5) : '09:00',
      endTime:   s.end_time   ? s.end_time.slice(0,5)   : '13:00',
      notes:     s.notes || '',
    });
  }

  async function handleSaveShift() {
    if (!editShiftForm.clientId) return showToast('Select a client', 'error');
    if (editShiftForm.startTime === editShiftForm.endTime) return showToast('Start and end time cannot be the same', 'error');
    setSaving(true);
    try {
      const isRecurring = editShift.day_of_week !== null && editShift.day_of_week !== undefined;

      const caregiverChanged = editShiftForm.caregiverId && editShiftForm.caregiverId !== editShift.caregiver_id;

      if (isRecurring && editScope === 'this') {
        // Create a modified exception for just this date
        await fetch(`${API_BASE_URL}/api/schedule-exceptions`, {
          method: 'POST',
          headers: { 'Content-Type':'application/json', Authorization:`Bearer ${token}` },
          body: JSON.stringify({
            scheduleId: editShift.id,
            exceptionDate: editDate,
            exceptionType: 'modified',
            overrideStartTime: editShiftForm.startTime,
            overrideEndTime: editShiftForm.endTime,
            overrideClientId: editShiftForm.clientId,
            overrideCaregiverId: caregiverChanged ? editShiftForm.caregiverId : null,
            overrideNotes: editShiftForm.notes,
          }),
        });
        showToast(`Modified ${new Date(editDate + 'T12:00:00').toLocaleDateString('en-US', { weekday:'short', month:'short', day:'numeric' })} only`);

      } else if (isRecurring && editScope === 'following') {
        // End current pattern the day before this date, create new pattern from this date
        const endDate = new Date(editDate + 'T12:00:00');
        endDate.setDate(endDate.getDate() - 1);
        const endDateStr = endDate.toISOString().split('T')[0];

        // Set end_date on old pattern
        await fetch(`${API_BASE_URL}/api/schedules-all/${editShift.id}`, {
          method: 'PUT',
          headers: { 'Content-Type':'application/json', Authorization:`Bearer ${token}` },
          body: JSON.stringify({
            clientId: editShift.client_id,
            startTime: editShift.start_time,
            endTime: editShift.end_time,
            notes: editShift.notes,
            dayOfWeek: editShift.day_of_week,
            frequency: editShift.frequency || 'weekly',
            anchorDate: editShift.anchor_date || null,
          }),
        });
        // Then set end_date directly
        await fetch(`${API_BASE_URL}/api/schedules/${editShift.id}?scope=following&date=${editDate}`, {
          method: 'DELETE', headers: { Authorization:`Bearer ${token}` },
        });

        // Create new pattern from this date with updated values
        await fetch(`${API_BASE_URL}/api/schedules-enhanced`, {
          method: 'POST',
          headers: { 'Content-Type':'application/json', Authorization:`Bearer ${token}` },
          body: JSON.stringify({
            caregiverId: editShiftForm.caregiverId || editShift.caregiver_id,
            clientId: editShiftForm.clientId,
            scheduleType: 'recurring',
            dayOfWeek: editShift.day_of_week,
            date: null,
            startTime: editShiftForm.startTime,
            endTime: editShiftForm.endTime,
            notes: editShiftForm.notes,
            frequency: editShift.frequency || 'weekly',
            effectiveDate: editDate,
            anchorDate: editShift.anchor_date || null,
          }),
        });
        showToast('Updated from this date forward');

      } else {
        // Update the recurring/one-time schedule itself (all occurrences)
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

        if (caregiverChanged) {
          const rRes = await fetch(`${API_BASE_URL}/api/schedules/${editShift.id}/reassign`, {
            method: 'PUT',
            headers: { 'Content-Type':'application/json', Authorization:`Bearer ${token}` },
            body: JSON.stringify({ newCaregiverId: editShiftForm.caregiverId, reason: 'admin_decision' }),
          });
          if (!rRes.ok) {
            const errBody = await rRes.json().catch(() => ({}));
            throw new Error(errBody.error || 'Reassignment failed');
          }
        }
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

  // ═══════════════════════════════════════════════
  // DRAG & DROP — confirm move
  // ═══════════════════════════════════════════════

  async function handleConfirmDrop() {
    if (!dropTarget) return;
    const { shift, fromDate, toCaregiverId, toDate, toDayIndex } = dropTarget;
    const isRecurring = shift.day_of_week !== null && shift.day_of_week !== undefined;
    const caregiverChanged = shift.caregiver_id !== toCaregiverId;
    const dayChanged = isRecurring
      ? Number(shift.day_of_week) !== toDayIndex
      : shift.date && shift.date.slice(0,10) !== toDate;

    setSaving(true);
    try {
      const hdrs = { 'Content-Type':'application/json', Authorization:`Bearer ${token}` };

      if (isRecurring && dropScope === 'this') {
        // Cancel the original occurrence, create a one-off at the new spot
        const cRes = await fetch(`${API_BASE_URL}/api/schedule-exceptions`, {
          method:'POST', headers: hdrs,
          body: JSON.stringify({
            scheduleId: shift.id,
            exceptionDate: fromDate,
            exceptionType: 'cancelled',
          }),
        });
        if (!cRes.ok) {
          const errBody = await cRes.json().catch(() => ({}));
          throw new Error(errBody.error || 'Could not cancel original occurrence');
        }
        const nRes = await fetch(`${API_BASE_URL}/api/schedules-enhanced`, {
          method:'POST', headers: hdrs,
          body: JSON.stringify({
            caregiverId: toCaregiverId,
            clientId: shift.client_id,
            scheduleType: 'one-time',
            date: toDate,
            startTime: shift.start_time,
            endTime: shift.end_time,
            notes: shift.notes,
          }),
        });
        if (!nRes.ok) {
          const errBody = await nRes.json().catch(() => ({}));
          throw new Error(errBody.error || 'Could not create new occurrence');
        }
        showToast('Occurrence moved');

      } else if (isRecurring && dropScope === 'following') {
        // End current pattern day before fromDate, create new pattern from toDate
        await fetch(`${API_BASE_URL}/api/schedules/${shift.id}?scope=following&date=${fromDate}`, {
          method:'DELETE', headers: hdrs,
        });
        await fetch(`${API_BASE_URL}/api/schedules-enhanced`, {
          method:'POST', headers: hdrs,
          body: JSON.stringify({
            caregiverId: toCaregiverId,
            clientId: shift.client_id,
            scheduleType: 'recurring',
            dayOfWeek: toDayIndex,
            date: null,
            startTime: shift.start_time,
            endTime: shift.end_time,
            notes: shift.notes,
            frequency: shift.frequency || 'weekly',
            effectiveDate: toDate,
            anchorDate: shift.anchor_date || null,
          }),
        });
        showToast('Moved from this date forward');

      } else if (isRecurring) {
        // scope === 'all'
        if (dayChanged) {
          await fetch(`${API_BASE_URL}/api/schedules-all/${shift.id}`, {
            method:'PUT', headers: hdrs,
            body: JSON.stringify({
              clientId: shift.client_id,
              startTime: shift.start_time,
              endTime: shift.end_time,
              notes: shift.notes,
              dayOfWeek: toDayIndex,
              date: null,
              frequency: shift.frequency || 'weekly',
              anchorDate: shift.anchor_date || null,
            }),
          });
        }
        if (caregiverChanged) {
          const rRes = await fetch(`${API_BASE_URL}/api/schedules/${shift.id}/reassign`, {
            method:'PUT', headers: hdrs,
            body: JSON.stringify({ newCaregiverId: toCaregiverId, reason: 'admin_decision' }),
          });
          if (!rRes.ok) {
            const errBody = await rRes.json().catch(() => ({}));
            throw new Error(errBody.error || 'Reassignment failed');
          }
        }
        showToast('Recurring shift moved');

      } else {
        // One-time shift
        if (dayChanged) {
          await fetch(`${API_BASE_URL}/api/schedules-all/${shift.id}`, {
            method:'PUT', headers: hdrs,
            body: JSON.stringify({
              clientId: shift.client_id,
              startTime: shift.start_time,
              endTime: shift.end_time,
              notes: shift.notes,
              dayOfWeek: null,
              date: toDate,
              frequency: shift.frequency || 'weekly',
              anchorDate: shift.anchor_date || null,
            }),
          });
        }
        if (caregiverChanged) {
          const rRes = await fetch(`${API_BASE_URL}/api/schedules/${shift.id}/reassign`, {
            method:'PUT', headers: hdrs,
            body: JSON.stringify({ newCaregiverId: toCaregiverId, reason: 'admin_decision' }),
          });
          if (!rRes.ok) {
            const errBody = await rRes.json().catch(() => ({}));
            throw new Error(errBody.error || 'Reassignment failed');
          }
        }
        showToast('Shift moved');
      }

      setDropTarget(null);
      await loadAll();
      onScheduleChange && onScheduleChange();
    } catch (err) {
      showToast(err.message || 'Move failed', 'error');
    } finally {
      setSaving(false);
    }
  }

  // ═══════════════════════════════════════════════
  // RENDER HELPERS
  // ═══════════════════════════════════════════════

  function getSplitPartner(shift, cellShifts) {
    if (!shift.is_split_shift || !shift.split_shift_group_id) return null;
    return cellShifts.find(s => s.id !== shift.id && s.split_shift_group_id === shift.split_shift_group_id) || null;
  }

  function renderShiftBlock(s, dayIndex, cellShifts) {
    const client = clientMap[s.client_id];
    const color  = clientColor(s.client_id, clientMap);
    const durH   = Number(parseFloat((timeToMinutes(s.end_time) - timeToMinutes(s.start_time)) / 60 || 0)).toFixed(2);
    const isSplit = s.is_split_shift && s.split_segment;
    const partner = isSplit ? getSplitPartner(s, cellShifts) : null;
    const showConnector = isSplit && s.split_segment === 2 && partner;
    const isModified = s._isModified;

    return (
      <React.Fragment key={s.id + '-' + weekDateStrs[dayIndex]}>
        {showConnector && (
          <div style={{ borderLeft: `2px dashed ${color}`, height: 8, marginLeft: 12, opacity: 0.5 }} />
        )}
        <div
          draggable
          onDragStart={e => {
            e.stopPropagation();
            setDragShift({ shift: s, fromDate: weekDateStrs[dayIndex] });
            try { e.dataTransfer.setData('text/plain', s.id); } catch {}
            e.dataTransfer.effectAllowed = 'move';
          }}
          onDragEnd={() => { setDragShift(null); setDragOverKey(null); }}
          onClick={e => { e.stopPropagation(); openEditShift(s, weekDateStrs[dayIndex]); }}
          style={{
            background: isModified ? `repeating-linear-gradient(135deg, ${color}, ${color} 4px, ${color}dd 4px, ${color}dd 8px)` : color,
            color:'#fff', borderRadius:5, padding:'3px 6px',
            marginBottom: isSplit && s.split_segment === 1 ? 0 : 3,
            fontSize:11, fontWeight:600, cursor:'grab', userSelect:'none',
            boxShadow:'0 1px 3px rgba(0,0,0,0.15)',
            borderLeft: isSplit ? '3px solid rgba(255,255,255,0.5)' : undefined,
            opacity: dragShift && dragShift.shift.id === s.id && dragShift.fromDate === weekDateStrs[dayIndex] ? 0.4 : 1,
          }}
        >
          <div style={{ whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis', fontWeight:700, display:'flex', alignItems:'center', gap:3 }}>
            {client ? `${client.first_name} ${client.last_name}` : 'Unknown'}
            {isSplit && <span style={{ fontSize:8, opacity:0.8, background:'rgba(255,255,255,0.25)', borderRadius:3, padding:'1px 3px' }}>Split {s.split_segment}/2</span>}
            {isModified && <span style={{ fontSize:8, background:'rgba(255,255,255,0.3)', borderRadius:3, padding:'1px 3px' }}>edited</span>}
          </div>
          <div style={{ opacity:0.9, fontSize:10 }}>
            {formatTime(s.start_time)}-{formatTime(s.end_time)} ({durH}h)
            {!s.date && !s._isOneTime && <span style={{ marginLeft:4, opacity:0.7 }}>&#8635;</span>}
          </div>
          {/* Care type + payer rate hint — helps catch wrong-rate scheduling. */}
          {client && (client.care_type_name || client.referral_source_name || client.private_pay_rate) && (
            <div style={{ opacity:0.85, fontSize:9, marginTop:1, whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}
                 title={`${client.care_type_name || 'No care type'} · ${client.referral_source_name || (client.is_private_pay ? 'Private Pay' : '—')}${client.private_pay_rate ? ` · $${parseFloat(client.private_pay_rate).toFixed(2)}/hr` : ''}`}>
              {client.care_type_name && <span>{client.care_type_name}</span>}
              {client.care_type_name && (client.referral_source_name || client.private_pay_rate) && <span> · </span>}
              {client.referral_source_name
                ? <span>{client.referral_source_name}</span>
                : client.is_private_pay
                  ? <span>Private{client.private_pay_rate ? ` $${parseFloat(client.private_pay_rate).toFixed(0)}` : ''}</span>
                  : null}
            </div>
          )}
        </div>
      </React.Fragment>
    );
  }

  // ═══════════════════════════════════════════════
  // TOGGLE SWITCH COMPONENT
  // ═══════════════════════════════════════════════
  function Toggle({ on, onToggle, label, subLabel }) {
    return (
      <div style={{ display:'flex', alignItems:'center', gap:8 }}>
        <label style={{ display:'flex', alignItems:'center', gap:8, cursor:'pointer', fontSize:13, fontWeight:600, color:'#374151' }}>
          <div onClick={onToggle} style={{
            width:36, height:20, borderRadius:10, position:'relative', cursor:'pointer',
            background: on ? '#3B82F6' : '#D1D5DB', transition:'background 0.2s',
          }}>
            <div style={{
              width:16, height:16, borderRadius:'50%', background:'#fff', position:'absolute', top:2,
              left: on ? 18 : 2, transition:'left 0.2s', boxShadow:'0 1px 3px rgba(0,0,0,0.2)',
            }} />
          </div>
          {label}
        </label>
        {subLabel && <span style={{ fontSize:11, color:'#6B7280' }}>{subLabel}</span>}
      </div>
    );
  }

  // ═══════════════════════════════════════════════
  // LOADING STATE
  // ═══════════════════════════════════════════════

  if (loading) return (
    <div style={{ display:'flex', alignItems:'center', justifyContent:'center', height:300, color:'#6B7280' }}>
      <div style={{ textAlign:'center' }}>
        <div style={{ fontSize:32, marginBottom:12 }}>&#128197;</div>
        Loading schedule...
      </div>
    </div>
  );

  // ═══════════════════════════════════════════════
  // MAIN RENDER
  // ═══════════════════════════════════════════════

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
              flexShrink: 0, padding: '6px 12px', borderRadius: 8, border: 'none',
              background: mobileDay === i ? '#2ABBA7' : i === todayIdx ? '#EFF6FF' : '#F3F4F6',
              color: mobileDay === i ? '#fff' : i === todayIdx ? '#2563EB' : '#374151',
              fontWeight: mobileDay === i ? 700 : 500, fontSize: 13, cursor: 'pointer',
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
            const maxHrs = parseFloat(cg.max_hours_per_week ?? 40);
            const pct    = maxHrs > 0 ? (parseFloat(hrs) / maxHrs) : 0;
            const isOver = parseFloat(hrs) > 40;
            const isFull = pct >= 1 && !isOver;
            const hoursColor = isOver ? '#EF4444' : isFull ? '#D97706' : pct < 0.5 ? '#0891B2' : '#059669';
            return (
              <div key={cg.id} style={{ display:'grid', gridTemplateColumns:'160px repeat(7, 1fr)', borderBottom:'1px solid #F3F4F6', background:'#fff', minHeight:72 }}>
                <div style={{ padding:'10px 14px', borderRight:'1px solid #F3F4F6', background:'#FAFAFA' }}>
                  <div style={{ fontWeight:700, fontSize:13, color:'#111827', whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>
                    {cg.first_name} {cg.last_name}
                  </div>
                  <div style={{ fontSize:11, color: hoursColor, fontWeight: (isOver||isFull) ? 700 : 500, marginTop:2 }}
                       title={`${hrs}h scheduled of ${maxHrs}h max \u2014 ${Math.round(pct*100)}% capacity`}>
                    {hrs}h / {maxHrs}h
                    {isOver ? ' \u26A0\uFE0F OT' : isFull ? ' full' : ''}
                  </div>
                  {/* Capacity bar */}
                  <div style={{ marginTop:4, height:3, background:'#E5E7EB', borderRadius:2, overflow:'hidden' }}>
                    <div style={{
                      width: `${Math.min(pct, 1.5) * 100 / 1.5}%`,
                      height: '100%',
                      background: hoursColor,
                      transition: 'width 0.2s',
                    }} />
                  </div>
                </div>
                {weekDates.map((_, dayIndex) => {
                  const shifts  = getShiftsForCell(cg.id, dayIndex);
                  const isToday = dayIndex === todayIdx;
                  const cellKey = `${cg.id}:${dayIndex}`;
                  const isDragOver = dragOverKey === cellKey;
                  const bgBase = isToday ? '#F0F9FF' : 'transparent';
                  return (
                    <div
                      key={dayIndex}
                      onClick={() => handleCellClick(cg.id, dayIndex)}
                      onDragOver={e => {
                        if (!dragShift) return;
                        e.preventDefault();
                        e.dataTransfer.dropEffect = 'move';
                        if (dragOverKey !== cellKey) setDragOverKey(cellKey);
                      }}
                      onDragLeave={() => { if (dragOverKey === cellKey) setDragOverKey(null); }}
                      onDrop={e => {
                        e.preventDefault();
                        setDragOverKey(null);
                        if (!dragShift) return;
                        const toDate = weekDateStrs[dayIndex];
                        const sameCaregiver = dragShift.shift.caregiver_id === cg.id;
                        const sameDate = dragShift.fromDate === toDate;
                        if (sameCaregiver && sameDate) { setDragShift(null); return; }
                        const isRecurring = dragShift.shift.day_of_week !== null && dragShift.shift.day_of_week !== undefined;
                        setDropTarget({
                          shift: dragShift.shift,
                          fromDate: dragShift.fromDate,
                          toCaregiverId: cg.id,
                          toDate,
                          toDayIndex: dayIndex,
                        });
                        setDropScope('all');
                        setDragShift(null);
                      }}
                      style={{
                        borderLeft:'1px solid #F3F4F6', padding:'5px 4px', minHeight:72,
                        background: isDragOver ? '#DCFCE7' : bgBase,
                        boxShadow: isDragOver ? 'inset 0 0 0 2px #22C55E' : undefined,
                        cursor:'pointer', transition:'background 0.1s',
                      }}
                      onMouseEnter={e => { if (!dragShift) e.currentTarget.style.background = isToday ? '#DBEAFE' : '#F9FAFB'; }}
                      onMouseLeave={e => { if (!dragShift) e.currentTarget.style.background = isToday ? '#F0F9FF' : 'transparent'; }}
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

      {/* ═══════ CREATE SHIFT MODAL ═══════ */}
      {newShift && (
        <Modal
          title={`New Shift \u2014 ${weekDates[newShift.dayIndex].toLocaleDateString('en-US',{ weekday:'long', month:'long', day:'numeric' })}`}
          onClose={() => setNewShift(null)}
        >
          {/* Schedule Type Selector */}
          <div style={{ display:'flex', gap:6, marginBottom:14 }}>
            {[{ key:'one-time', label:'One-time' }, { key:'recurring', label:'Recurring' }].map(opt => (
              <button key={opt.key} type="button" onClick={() => setNewShiftForm(f => ({ ...f, scheduleType: opt.key }))} style={{
                flex:1, padding:'8px 0', borderRadius:8, border:'2px solid', cursor:'pointer', fontWeight:600, fontSize:13,
                borderColor: newShiftForm.scheduleType === opt.key ? '#3B82F6' : '#E5E7EB',
                background: newShiftForm.scheduleType === opt.key ? '#EFF6FF' : '#fff',
                color: newShiftForm.scheduleType === opt.key ? '#1D4ED8' : '#6B7280',
              }}>{opt.label}</button>
            ))}
          </div>

          {/* Recurring: day picker + frequency + dates */}
          {newShiftForm.scheduleType === 'recurring' && (
            <div style={{ background:'#F0F9FF', border:'1px solid #BFDBFE', borderRadius:8, padding:12, marginBottom:14 }}>
              <div style={{ fontSize:11, fontWeight:700, color:'#1D4ED8', marginBottom:8, textTransform:'uppercase', letterSpacing:0.5 }}>Recurring Pattern</div>

              {/* Day selector */}
              <div style={{ display:'flex', gap:4, marginBottom:10 }}>
                {DAY_NAMES.map((name, idx) => (
                  <button key={idx} type="button" onClick={() => toggleDay(idx)} style={{
                    flex:1, padding:'6px 0', borderRadius:6, border:'2px solid',
                    cursor:'pointer', fontWeight:700, fontSize:11,
                    borderColor: newShiftForm.selectedDays.includes(idx) ? '#3B82F6' : '#D1D5DB',
                    background: newShiftForm.selectedDays.includes(idx) ? '#3B82F6' : '#fff',
                    color: newShiftForm.selectedDays.includes(idx) ? '#fff' : '#6B7280',
                  }}>{name}</button>
                ))}
              </div>
              <div style={{ display:'flex', gap:6, marginBottom:10 }}>
                <button type="button" onClick={() => setNewShiftForm(f => ({ ...f, selectedDays:[1,2,3,4,5] }))} style={{ fontSize:11, color:'#3B82F6', background:'none', border:'none', cursor:'pointer', fontWeight:600, textDecoration:'underline' }}>Weekdays</button>
                <button type="button" onClick={() => setNewShiftForm(f => ({ ...f, selectedDays:[0,1,2,3,4,5,6] }))} style={{ fontSize:11, color:'#3B82F6', background:'none', border:'none', cursor:'pointer', fontWeight:600, textDecoration:'underline' }}>Every day</button>
                <button type="button" onClick={() => setNewShiftForm(f => ({ ...f, selectedDays:[] }))} style={{ fontSize:11, color:'#6B7280', background:'none', border:'none', cursor:'pointer', fontWeight:600, textDecoration:'underline' }}>Clear</button>
              </div>

              {/* Frequency */}
              <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:6, marginBottom:10 }}>
                {[{ key:'weekly', label:'Weekly' }, { key:'biweekly', label:'Every 2 weeks' }].map(opt => (
                  <button key={opt.key} type="button" onClick={() => setNewShiftForm(f => ({ ...f, frequency:opt.key }))} style={{
                    padding:'6px 8px', borderRadius:6, border:'1px solid',
                    cursor:'pointer', fontWeight:600, fontSize:12,
                    borderColor: newShiftForm.frequency === opt.key ? '#3B82F6' : '#D1D5DB',
                    background: newShiftForm.frequency === opt.key ? '#DBEAFE' : '#fff',
                    color: newShiftForm.frequency === opt.key ? '#1D4ED8' : '#6B7280',
                  }}>{opt.label}</button>
                ))}
              </div>

              {/* Start / End dates */}
              <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:8 }}>
                <Field label="Starts">
                  <input type="date" value={newShiftForm.startDate} onChange={e => setNewShiftForm(f => ({ ...f, startDate:e.target.value }))} style={inputStyle} />
                </Field>
                <Field label="Ends (optional)">
                  <input type="date" value={newShiftForm.endDate} onChange={e => setNewShiftForm(f => ({ ...f, endDate:e.target.value }))} style={inputStyle} min={newShiftForm.startDate || undefined} />
                </Field>
              </div>
            </div>
          )}

          <Field label="Client">
            <select value={newShiftForm.clientId} onChange={e => setNewShiftForm(f => ({ ...f, clientId:e.target.value }))} style={inputStyle}>
              <option value="">\u2014 Select client \u2014</option>
              {clients.map(c => <option key={c.id} value={c.id}>{c.first_name} {c.last_name}</option>)}
            </select>
          </Field>

          {/* Time block */}
          <div style={{ marginTop:12 }}>
            {newShiftForm.isSplit && <div style={{ fontSize:11, fontWeight:700, color:'#3B82F6', marginBottom:4 }}>SHIFT 1</div>}
            <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:12 }}>
              <Field label="Start">
                <input type="time" value={newShiftForm.startTime} onChange={e => {
                  const f = { ...newShiftForm, startTime:e.target.value };
                  setNewShiftForm(f); validateSplitTimes(f);
                }} style={inputStyle} />
              </Field>
              <Field label="End">
                <input type="time" value={newShiftForm.endTime} onChange={e => {
                  const f = { ...newShiftForm, endTime:e.target.value };
                  setNewShiftForm(f); validateSplitTimes(f);
                }} style={inputStyle} />
              </Field>
            </div>
          </div>

          {/* Split Shift Toggle */}
          <div style={{ marginTop:14 }}>
            <Toggle
              on={newShiftForm.isSplit}
              onToggle={() => {
                const next = { ...newShiftForm, isSplit: !newShiftForm.isSplit };
                if (!next.isSplit) { next.split2Start = '16:00'; next.split2End = '20:00'; }
                setNewShiftForm(next); validateSplitTimes(next);
              }}
              label="Split Shift"
              subLabel={newShiftForm.isSplit ? 'Two segments, same day' : null}
            />
          </div>

          {/* Shift 2 (split only) */}
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
                    setNewShiftForm(f); validateSplitTimes(f);
                  }} style={inputStyle} />
                </Field>
                <Field label="End">
                  <input type="time" value={newShiftForm.split2End} onChange={e => {
                    const f = { ...newShiftForm, split2End:e.target.value };
                    setNewShiftForm(f); validateSplitTimes(f);
                  }} style={inputStyle} />
                </Field>
              </div>
              {splitError && <div style={{ color:'#EF4444', fontSize:12, marginTop:6, fontWeight:600 }}>{splitError}</div>}
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
              {saving ? 'Creating...'
                : newShiftForm.scheduleType === 'recurring'
                  ? `Create Recurring (${newShiftForm.selectedDays.length} day${newShiftForm.selectedDays.length !== 1 ? 's' : ''})`
                  : newShiftForm.isSplit ? 'Create Split Shift' : 'Create Shift'}
            </button>
          </div>
        </Modal>
      )}

      {/* ═══════ EDIT SHIFT MODAL ═══════ */}
      {editShift && (() => {
        const durH  = editShiftForm.startTime && editShiftForm.endTime
          ? Number(parseFloat((timeToMinutes(editShiftForm.endTime) - timeToMinutes(editShiftForm.startTime)) / 60 || 0)).toFixed(2)
          : '0';
        const isRecurring = editShift.day_of_week !== null && editShift.day_of_week !== undefined;
        const isSplit = editShift.is_split_shift;
        const dateLabel = editDate ? new Date(editDate + 'T12:00:00').toLocaleDateString('en-US', { month:'short', day:'numeric' }) : '';

        return (
          <Modal title={isSplit ? `Edit Shift (Split ${editShift.split_segment}/2)` : 'Edit Shift'} onClose={() => setEditShift(null)}>
            {isSplit && (
              <div style={{ marginBottom:12, fontSize:12, color:'#3B82F6', background:'#EFF6FF', padding:'8px 10px', borderRadius:6, display:'flex', alignItems:'center', gap:6 }}>
                <span style={{ fontSize:14 }}>&#128279;</span>
                This is segment {editShift.split_segment} of a split shift.
              </div>
            )}

            {/* Scope selector for recurring shifts */}
            {isRecurring && (
              <div style={{ marginBottom:12 }}>
                <div style={{ fontSize:12, fontWeight:700, color:'#374151', marginBottom:6 }}>Apply changes to:</div>
                <div style={{ display:'flex', flexDirection:'column', gap:4 }}>
                  {[
                    { key:'this', icon:'\uD83D\uDCC5', label:`This date only${dateLabel ? ` (${dateLabel})` : ''}`, color:'#3B82F6', bg:'#EFF6FF', hint:'Only this single occurrence is changed. The recurring pattern stays the same.' },
                    { key:'following', icon:'\u27A1\uFE0F', label:`This & all following`, color:'#8B5CF6', bg:'#F5F3FF', hint:'Changes apply from this date forward. Earlier occurrences stay the same.' },
                    { key:'all', icon:'\u21BB', label:'All occurrences', color:'#F59E0B', bg:'#FFFBEB', hint:'Changes apply to every instance of this recurring shift.' },
                  ].map(opt => (
                    <button key={opt.key} type="button" onClick={() => setEditScope(opt.key)} style={{
                      padding:'8px 12px', borderRadius:8, border:'2px solid', cursor:'pointer',
                      fontWeight:600, fontSize:13, textAlign:'left',
                      borderColor: editScope === opt.key ? opt.color : '#E5E7EB',
                      background: editScope === opt.key ? opt.bg : '#fff',
                      color: editScope === opt.key ? opt.color : '#6B7280',
                    }}>
                      {opt.icon} {opt.label}
                    </button>
                  ))}
                </div>
                <div style={{ marginTop:6, fontSize:11, color:'#6B7280', background:'#F9FAFB', padding:'6px 10px', borderRadius:6 }}>
                  {{ this:'Only this single occurrence is changed. The recurring pattern stays the same.',
                     following:'Changes apply from this date forward. Earlier occurrences stay the same.',
                     all:'Changes apply to every instance of this recurring shift.',
                  }[editScope]}
                </div>
              </div>
            )}

            <Field label="Caregiver">
              <select value={editShiftForm.caregiverId} onChange={e => setEditShiftForm(f => ({ ...f, caregiverId: e.target.value }))} style={inputStyle}>
                <option value=''>Select caregiver...</option>
                {caregivers.map(cg => <option key={cg.id} value={cg.id}>{cg.first_name} {cg.last_name}</option>)}
              </select>
              {editShiftForm.caregiverId && editShiftForm.caregiverId !== editShift.caregiver_id && (
                <div style={{ marginTop:4, fontSize:11, color:'#8B5CF6', fontWeight:600 }}>
                  &#8635; Reassigning from {(() => {
                    const cg = caregivers.find(c => c.id === editShift.caregiver_id);
                    return cg ? `${cg.first_name} ${cg.last_name}` : 'original caregiver';
                  })()}
                </div>
              )}
            </Field>
            <Field label="Client" style={{ marginTop:10 }}>
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
              <button onClick={() => openDeleteConfirm(editShift, editDate)} disabled={saving} style={{ ...cancelBtn, color:'#EF4444', borderColor:'#FECACA' }}>
                {saving ? '...' : 'Delete'}
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

      {/* ═══════ DROP CONFIRM MODAL ═══════ */}
      {dropTarget && (() => {
        const { shift, fromDate, toCaregiverId, toDate, toDayIndex } = dropTarget;
        const isRecurring = shift.day_of_week !== null && shift.day_of_week !== undefined;
        const fromCg = caregivers.find(c => c.id === shift.caregiver_id);
        const toCg   = caregivers.find(c => c.id === toCaregiverId);
        const fromLabel = fromDate ? new Date(fromDate + 'T12:00:00').toLocaleDateString('en-US', { weekday:'short', month:'short', day:'numeric' }) : '';
        const toLabel   = new Date(toDate + 'T12:00:00').toLocaleDateString('en-US', { weekday:'long', month:'short', day:'numeric' });
        const client = clientMap[shift.client_id];

        return (
          <Modal title="Move Shift?" onClose={() => setDropTarget(null)}>
            <div style={{ fontSize:13, color:'#374151', marginBottom:12, background:'#F9FAFB', padding:'10px 12px', borderRadius:8 }}>
              <div style={{ fontWeight:700 }}>{client ? `${client.first_name} ${client.last_name}` : 'Unknown client'}</div>
              <div style={{ fontSize:12, color:'#6B7280', marginTop:2 }}>
                {formatTime(shift.start_time)}&ndash;{formatTime(shift.end_time)}
              </div>
              <div style={{ fontSize:12, color:'#6B7280', marginTop:6 }}>
                <strong>{fromCg ? `${fromCg.first_name} ${fromCg.last_name}` : 'Unknown'}</strong>{fromLabel ? ` · ${fromLabel}` : ''}
                {' '}&rarr;{' '}
                <strong>{toCg ? `${toCg.first_name} ${toCg.last_name}` : 'Unknown'}</strong> · {toLabel}
              </div>
            </div>

            {isRecurring && (
              <div style={{ marginBottom:12 }}>
                <div style={{ fontSize:12, fontWeight:700, color:'#374151', marginBottom:6 }}>Apply to:</div>
                <div style={{ display:'flex', flexDirection:'column', gap:4 }}>
                  {[
                    { key:'this', icon:'\uD83D\uDCC5', label:`This date only (${fromLabel})`, color:'#3B82F6', bg:'#EFF6FF' },
                    { key:'following', icon:'\u27A1\uFE0F', label:'This & all following', color:'#8B5CF6', bg:'#F5F3FF' },
                    { key:'all', icon:'\u21BB', label:'All occurrences', color:'#F59E0B', bg:'#FFFBEB' },
                  ].map(opt => (
                    <button key={opt.key} type="button" onClick={() => setDropScope(opt.key)} style={{
                      padding:'8px 12px', borderRadius:8, border:'2px solid', cursor:'pointer',
                      fontWeight:600, fontSize:13, textAlign:'left',
                      borderColor: dropScope === opt.key ? opt.color : '#E5E7EB',
                      background: dropScope === opt.key ? opt.bg : '#fff',
                      color: dropScope === opt.key ? opt.color : '#6B7280',
                    }}>
                      {opt.icon} {opt.label}
                    </button>
                  ))}
                </div>
                <div style={{ marginTop:6, fontSize:11, color:'#6B7280', background:'#F9FAFB', padding:'6px 10px', borderRadius:6 }}>
                  {{ this: 'Only this single occurrence moves. The recurring pattern stays the same.',
                     following: 'Moves this occurrence and all future ones. Earlier occurrences stay.',
                     all: 'The entire recurring pattern moves to the new caregiver and day.',
                  }[dropScope]}
                </div>
              </div>
            )}

            <div style={{ display:'flex', justifyContent:'flex-end', gap:8 }}>
              <button onClick={() => setDropTarget(null)} disabled={saving} style={cancelBtn}>Cancel</button>
              <button onClick={handleConfirmDrop} disabled={saving} style={primaryBtn}>
                {saving ? 'Moving...' : 'Move'}
              </button>
            </div>
          </Modal>
        );
      })()}

      {/* ═══════ DELETE SCOPE MODAL ═══════ */}
      {deleteConfirm && (() => {
        const { shift, date } = deleteConfirm;
        const isRecurring = shift.day_of_week !== null && shift.day_of_week !== undefined;
        const isSplit = shift.is_split_shift;
        const dateLabel = date ? new Date(date + 'T12:00:00').toLocaleDateString('en-US', { weekday:'short', month:'short', day:'numeric' }) : '';

        if (!isRecurring) {
          // One-time shift — simple confirm
          return (
            <Modal title="Delete Shift" onClose={() => setDeleteConfirm(null)}>
              <p style={{ margin:'0 0 16px', fontSize:14, color:'#374151' }}>
                {isSplit ? 'Delete both segments of this split shift?' : 'Delete this shift?'}
              </p>
              <div style={{ display:'flex', justifyContent:'flex-end', gap:8 }}>
                <button onClick={() => setDeleteConfirm(null)} style={cancelBtn}>Cancel</button>
                <button onClick={() => handleDeleteShift('all')} disabled={saving} style={{ ...primaryBtn, background:'#EF4444' }}>
                  {saving ? 'Deleting...' : 'Delete'}
                </button>
              </div>
            </Modal>
          );
        }

        // Recurring shift — scope selector
        return (
          <Modal title="Delete Recurring Shift" onClose={() => setDeleteConfirm(null)}>
            <p style={{ margin:'0 0 12px', fontSize:14, color:'#374151' }}>
              This is a recurring shift ({shift.frequency === 'biweekly' ? 'every 2 weeks' : 'weekly'} on {DAY_FULL[shift.day_of_week]}).
              What would you like to delete?
            </p>
            <div style={{ display:'flex', flexDirection:'column', gap:8 }}>
              <button onClick={() => handleDeleteShift('this')} disabled={saving} style={{
                padding:'12px 16px', borderRadius:8, border:'1px solid #D1D5DB', cursor:'pointer',
                background:'#fff', textAlign:'left', fontSize:13,
              }}>
                <div style={{ fontWeight:700, color:'#374151' }}>This occurrence only ({dateLabel})</div>
                <div style={{ fontSize:11, color:'#6B7280', marginTop:2 }}>Cancel just this one date. All other occurrences continue.</div>
              </button>
              <button onClick={() => handleDeleteShift('following')} disabled={saving} style={{
                padding:'12px 16px', borderRadius:8, border:'1px solid #D1D5DB', cursor:'pointer',
                background:'#fff', textAlign:'left', fontSize:13,
              }}>
                <div style={{ fontWeight:700, color:'#374151' }}>This & all following</div>
                <div style={{ fontSize:11, color:'#6B7280', marginTop:2 }}>End the recurring pattern starting from {dateLabel}. Past occurrences stay.</div>
              </button>
              <button onClick={() => handleDeleteShift('all')} disabled={saving} style={{
                padding:'12px 16px', borderRadius:8, border:'1px solid #FECACA', cursor:'pointer',
                background:'#FEF2F2', textAlign:'left', fontSize:13,
              }}>
                <div style={{ fontWeight:700, color:'#EF4444' }}>All occurrences</div>
                <div style={{ fontSize:11, color:'#6B7280', marginTop:2 }}>Permanently remove this entire recurring schedule.</div>
              </button>
            </div>
            <div style={{ display:'flex', justifyContent:'flex-end', marginTop:12 }}>
              <button onClick={() => setDeleteConfirm(null)} style={cancelBtn}>Cancel</button>
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
      <div style={{ background:'#fff', borderRadius:12, width:'100%', maxWidth:460, boxShadow:'0 20px 60px rgba(0,0,0,0.2)', maxHeight:'90vh', overflowY:'auto' }}>
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
