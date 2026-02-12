// src/components/admin/SchedulingHub.jsx
// Unified scheduling hub - consolidates all scheduling features into one page
import React, { useState, useEffect } from 'react';
import { API_BASE_URL } from '../../config';
import AutoFillButton from './AutoFillButton';

function getWeekStart(date) {
  const d = new Date(date);
  d.setDate(d.getDate() - d.getDay());
  d.setHours(0, 0, 0, 0);
  return d;
}

const SchedulingHub = ({ token }) => {
  // ── Tab state ──
  const [activeTab, setActiveTab] = useState('week');
  const [isMobile, setIsMobile] = useState(window.innerWidth < 768);

  // ── Shared data (loaded once, used by many tabs) ──
  const [caregivers, setCaregivers] = useState([]);
  const [clients, setClients] = useState([]);
  const [loading, setLoading] = useState(true);

  // ── Message toast ──
  const [message, setMessage] = useState({ text: '', type: '' });
  const showMsg = (text, type = 'success') => {
    setMessage({ text, type });
    setTimeout(() => setMessage({ text: '', type: '' }), 4000);
  };

  // ── Week View state ──
  const [weekOf, setWeekOf] = useState(getWeekStart(new Date()).toISOString().split('T')[0]);
  const [weekData, setWeekData] = useState(null);
  const [reassignModal, setReassignModal] = useState(null);

  // ── Create Schedule state (caregiver-first, like SchedulesManagement) ──
  const [selectedCaregiverId, setSelectedCaregiverId] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [caregiverSchedules, setCaregiverSchedules] = useState([]);
  const [saving, setSaving] = useState(false);
  const [formData, setFormData] = useState({
    caregiverId: '',
    clientId: '',
    scheduleType: 'one-time', // 'one-time', 'multi-day', 'recurring'
    dayOfWeek: '',
    date: new Date().toISOString().split('T')[0],
    startTime: '09:00',
    endTime: '13:00',
    notes: ''
  });
  const [selectedDays, setSelectedDays] = useState([]);

  // Still keep suggestion state for week view reassign etc.
  const [selectedClient, setSelectedClient] = useState('');
  const [suggestions, setSuggestions] = useState([]);
  const [suggestionsLoading, setSuggestionsLoading] = useState(false);
  const [selectedCaregiver, setSelectedCaregiver] = useState(null);
  const [conflicts, setConflicts] = useState([]);

  // ── Edit Schedule Modal ──
  const [editModal, setEditModal] = useState(null);
  const [editSaving, setEditSaving] = useState(false);

  // ── Prospects state ──
  const [prospects, setProspects] = useState([]);
  const [prospectAppts, setProspectAppts] = useState([]);
  const [showProspectForm, setShowProspectForm] = useState(false);
  const [prospectForm, setProspectForm] = useState({ firstName: '', lastName: '', phone: '', email: '', notes: '', source: '' });
  const [showProspectApptForm, setShowProspectApptForm] = useState(false);
  const [prospectApptForm, setProspectApptForm] = useState({ prospectId: '', caregiverId: '', appointmentDate: '', startTime: '10:00', endTime: '11:00', appointmentType: 'assessment', location: '', notes: '' });
  const [prospectSaving, setProspectSaving] = useState(false);

  // ── Coverage state ──
  const [coverageData, setCoverageData] = useState(null);
  const [coverageLoading, setCoverageLoading] = useState(false);
  const [coverageWeekOf, setCoverageWeekOf] = useState(getWeekStart(new Date()).toISOString().split('T')[0]);

  // ── Calendar state ──
  const [calCurrentDate, setCalCurrentDate] = useState(new Date());
  const [calSchedules, setCalSchedules] = useState([]);
  const [calSelectedDay, setCalSelectedDay] = useState(null);
  const [calDaySchedules, setCalDaySchedules] = useState([]);
  const [calFilterCaregiver, setCalFilterCaregiver] = useState('');

  // ── Open Shifts state ──
  const [openShifts, setOpenShifts] = useState([]);
  const [openShiftsLoading, setOpenShiftsLoading] = useState(false);
  const [openShiftFilter, setOpenShiftFilter] = useState('open');
  const [showCreateShift, setShowCreateShift] = useState(false);
  const [shiftClaims, setShiftClaims] = useState([]);
  const [currentShift, setCurrentShift] = useState(null);
  const [careTypes, setCareTypes] = useState([]);

  // ── Shift Swaps state ──
  const [swaps, setSwaps] = useState([]);
  const [swapsLoading, setSwapsLoading] = useState(false);
  const [swapFilter, setSwapFilter] = useState('');

  // ── Absences state ──
  const [absences, setAbsences] = useState([]);
  const [absencesLoading, setAbsencesLoading] = useState(false);
  const [showAbsenceForm, setShowAbsenceForm] = useState(false);
  const [absenceForm, setAbsenceForm] = useState({ caregiverId: '', date: '', type: 'call_out', reason: '' });

  // ── Availability state ──
  const [availCaregiver, setAvailCaregiver] = useState('');
  const [availData, setAvailData] = useState(null);
  const [blackoutDates, setBlackoutDates] = useState([]);
  const [showBlackoutForm, setShowBlackoutForm] = useState(false);
  const [newBlackout, setNewBlackout] = useState({ startDate: '', endDate: '', reason: '' });
  const [availForm, setAvailForm] = useState({
    status: 'available', maxHoursPerWeek: 40,
    mondayAvailable: true, mondayStartTime: '08:00', mondayEndTime: '17:00',
    tuesdayAvailable: true, tuesdayStartTime: '08:00', tuesdayEndTime: '17:00',
    wednesdayAvailable: true, wednesdayStartTime: '08:00', wednesdayEndTime: '17:00',
    thursdayAvailable: true, thursdayStartTime: '08:00', thursdayEndTime: '17:00',
    fridayAvailable: true, fridayStartTime: '08:00', fridayEndTime: '17:00',
    saturdayAvailable: false, saturdayStartTime: '08:00', saturdayEndTime: '17:00',
    sundayAvailable: false, sundayStartTime: '08:00', sundayEndTime: '17:00',
  });
  const daysOfWeek = [
    { key: 'monday', label: 'Mon' }, { key: 'tuesday', label: 'Tue' },
    { key: 'wednesday', label: 'Wed' }, { key: 'thursday', label: 'Thu' },
    { key: 'friday', label: 'Fri' }, { key: 'saturday', label: 'Sat' },
    { key: 'sunday', label: 'Sun' }
  ];

  // ═══════════════════════════════════════════════
  // DATA LOADING
  // ═══════════════════════════════════════════════

  useEffect(() => {
    loadCoreData();
    const handleResize = () => setIsMobile(window.innerWidth < 768);
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  useEffect(() => {
    if (activeTab === 'week') loadWeekView();
  }, [activeTab, weekOf]);

  useEffect(() => {
    if (activeTab === 'coverage') loadCoverage();
  }, [activeTab, coverageWeekOf]);

  useEffect(() => {
    if (activeTab === 'calendar') loadCalendarData();
  }, [activeTab, calCurrentDate]);

  useEffect(() => {
    if (activeTab === 'open-shifts') loadOpenShifts();
  }, [activeTab, openShiftFilter]);

  useEffect(() => {
    if (activeTab === 'staffing') { loadSwaps(); loadAbsences(); }
  }, [activeTab, swapFilter]);

  const api = async (url, opts = {}) => {
    const res = await fetch(`${API_BASE_URL}${url}`, {
      ...opts,
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}`, ...opts.headers }
    });
    if (!res.ok) throw new Error(`Request failed (${res.status})`);
    return res.json();
  };

  const loadCoreData = async () => {
    try {
      const [cg, cl, ct, pr] = await Promise.all([
        api('/api/caregivers'),
        api('/api/clients'),
        api('/api/care-types').catch(() => []),
        api('/api/prospects').catch(() => [])
      ]);
      setCaregivers(Array.isArray(cg) ? cg : []);
      setClients(Array.isArray(cl) ? cl : []);
      setCareTypes(Array.isArray(ct) ? ct : []);
      setProspects(Array.isArray(pr) ? pr : []);
    } catch (e) { console.error('Failed to load data:', e); }
    finally { setLoading(false); }
  };

  const loadWeekView = async () => {
    try {
      const data = await api(`/api/scheduling/week-view?weekOf=${weekOf}`);
      setWeekData(data);
    } catch (e) { console.error(e); }
  };

  const loadCoverage = async () => {
    setCoverageLoading(true);
    try {
      const data = await api(`/api/scheduling/coverage-overview?weekOf=${coverageWeekOf}`);
      setCoverageData(data);
    } catch (e) { console.error(e); }
    finally { setCoverageLoading(false); }
  };

  const loadCalendarData = async () => {
    try {
      const [schedData, prospData, apptData] = await Promise.all([
        api('/api/schedules-all'),
        api('/api/prospects').catch(() => []),
        api(`/api/prospect-appointments?month=${calCurrentDate.getMonth() + 1}&year=${calCurrentDate.getFullYear()}`).catch(() => [])
      ]);
      setCalSchedules(Array.isArray(schedData) ? schedData : []);
      setProspects(Array.isArray(prospData) ? prospData : []);
      setProspectAppts(Array.isArray(apptData) ? apptData : []);
    } catch (e) { console.error(e); }
  };

  const loadProspects = async () => {
    try {
      const data = await api('/api/prospects');
      setProspects(Array.isArray(data) ? data : []);
    } catch (e) { console.error(e); }
  };

  const loadProspectAppts = async () => {
    try {
      const data = await api(`/api/prospect-appointments?month=${calCurrentDate.getMonth() + 1}&year=${calCurrentDate.getFullYear()}`);
      setProspectAppts(Array.isArray(data) ? data : []);
    } catch (e) { console.error(e); }
  };

  const createProspect = async () => {
    if (!prospectForm.firstName || !prospectForm.lastName) { showMsg('Name required', 'error'); return; }
    setProspectSaving(true);
    try {
      await api('/api/prospects', { method: 'POST', body: JSON.stringify(prospectForm) });
      showMsg('Prospect added!');
      setProspectForm({ firstName: '', lastName: '', phone: '', email: '', notes: '', source: '' });
      setShowProspectForm(false);
      loadProspects();
    } catch (e) { showMsg('Error: ' + e.message, 'error'); }
    finally { setProspectSaving(false); }
  };

  const createProspectAppt = async () => {
    if (!prospectApptForm.prospectId || !prospectApptForm.appointmentDate) { showMsg('Select prospect and date', 'error'); return; }
    if (prospectApptForm.startTime >= prospectApptForm.endTime) { showMsg('End time must be after start', 'error'); return; }
    setProspectSaving(true);
    try {
      await api('/api/prospect-appointments', { method: 'POST', body: JSON.stringify(prospectApptForm) });
      showMsg('Appointment scheduled!');
      setProspectApptForm({ prospectId: '', caregiverId: '', appointmentDate: '', startTime: '10:00', endTime: '11:00', appointmentType: 'assessment', location: '', notes: '' });
      setShowProspectApptForm(false);
      loadProspectAppts();
    } catch (e) { showMsg('Error: ' + e.message, 'error'); }
    finally { setProspectSaving(false); }
  };

  const convertProspect = async (prospectId) => {
    if (!window.confirm('Convert this prospect to a full client?')) return;
    try {
      const result = await api(`/api/prospects/${prospectId}/convert`, { method: 'POST' });
      showMsg(`Converted to client: ${result.client.first_name} ${result.client.last_name}`);
      loadProspects();
      loadCoreData();
    } catch (e) { showMsg('Error: ' + e.message, 'error'); }
  };

  const deleteProspectAppt = async (id) => {
    if (!window.confirm('Cancel this appointment?')) return;
    try {
      await api(`/api/prospect-appointments/${id}`, { method: 'DELETE' });
      showMsg('Appointment cancelled');
      loadProspectAppts();
    } catch (e) { showMsg('Error: ' + e.message, 'error'); }
  };

  const loadOpenShifts = async () => {
    setOpenShiftsLoading(true);
    try {
      const params = openShiftFilter ? `?status=${openShiftFilter}` : '';
      const data = await api(`/api/open-shifts${params}`);
      setOpenShifts(Array.isArray(data) ? data : []);
    } catch (e) { console.error(e); }
    finally { setOpenShiftsLoading(false); }
  };

  const loadSwaps = async () => {
    setSwapsLoading(true);
    try {
      const params = swapFilter ? `?status=${swapFilter}` : '';
      const data = await api(`/api/shift-swaps${params}`);
      setSwaps(Array.isArray(data) ? data : []);
    } catch (e) { console.error(e); }
    finally { setSwapsLoading(false); }
  };

  const loadAbsences = async () => {
    setAbsencesLoading(true);
    try {
      const data = await api('/api/absences');
      setAbsences(Array.isArray(data) ? data : []);
    } catch (e) { console.error(e); }
    finally { setAbsencesLoading(false); }
  };

  // ═══════════════════════════════════════════════
  // HELPERS
  // ═══════════════════════════════════════════════

  const formatTime = (t) => {
    if (!t) return '';
    const [h, m] = t.split(':');
    const hour = parseInt(h);
    return `${hour % 12 || 12}:${m}${hour >= 12 ? 'pm' : 'am'}`;
  };

  const getClientName = (id) => {
    const c = clients.find(cl => cl.id === id);
    return c ? `${c.first_name} ${c.last_name}` : 'Unknown';
  };

  const getCaregiverName = (id) => {
    const c = caregivers.find(cg => cg.id === id);
    return c ? `${c.first_name} ${c.last_name}` : 'Unknown';
  };

  const cgColor = (id) => {
    const colors = ['#3B82F6','#10B981','#F59E0B','#EF4444','#8B5CF6','#EC4899','#06B6D4','#84CC16'];
    const idx = caregivers.findIndex(c => c.id === id);
    return colors[idx % colors.length];
  };

  const navigateWeek = (dir) => {
    const d = new Date(weekOf + 'T12:00:00');
    d.setDate(d.getDate() + dir * 7);
    setWeekOf(getWeekStart(d).toISOString().split('T')[0]);
  };

  const shiftPresets = [
    { label: 'Morning (8am-12pm)', start: '08:00', end: '12:00' },
    { label: 'Afternoon (12pm-4pm)', start: '12:00', end: '16:00' },
    { label: 'Evening (4pm-8pm)', start: '16:00', end: '20:00' },
    { label: 'Full Day (8am-4pm)', start: '08:00', end: '16:00' },
    { label: 'Half Day AM (8am-12pm)', start: '08:00', end: '12:00' },
    { label: 'Half Day PM (1pm-5pm)', start: '13:00', end: '17:00' },
  ];

  // ═══════════════════════════════════════════════
  // CREATE SCHEDULE LOGIC (caregiver-first flow)
  // ═══════════════════════════════════════════════

  const loadCaregiverSchedules = async (cgId) => {
    if (!cgId) { setCaregiverSchedules([]); return; }
    try {
      const data = await api(`/api/schedules/${cgId}`);
      setCaregiverSchedules(Array.isArray(data) ? data : []);
    } catch (e) { console.error(e); setCaregiverSchedules([]); }
  };

  const handleCaregiverSelectCreate = (cgId) => {
    setSelectedCaregiverId(cgId);
    setFormData(prev => ({ ...prev, caregiverId: cgId }));
    loadCaregiverSchedules(cgId);
    setShowForm(false);
  };

  const toggleDaySelection = (idx) => {
    setSelectedDays(prev => prev.includes(idx) ? prev.filter(d => d !== idx) : [...prev, idx].sort((a, b) => a - b));
  };
  const selectWeekdays = () => setSelectedDays([1, 2, 3, 4, 5]);
  const clearDays = () => setSelectedDays([]);

  const applyPreset = (preset) => setFormData(prev => ({ ...prev, startTime: preset.start, endTime: preset.end }));

  const calculateHours = (start, end) => {
    if (!start || !end) return 0;
    return ((new Date(`2000-01-01T${end}`) - new Date(`2000-01-01T${start}`)) / 3600000).toFixed(2);
  };

  const handleCreateSubmit = async (e) => {
    e.preventDefault();
    if (!formData.caregiverId || !formData.clientId) { showMsg('Select both caregiver and client', 'error'); return; }
    if (formData.scheduleType === 'recurring' && formData.dayOfWeek === '') { showMsg('Select a day of week', 'error'); return; }
    if (formData.scheduleType === 'one-time' && !formData.date) { showMsg('Select a date', 'error'); return; }
    if ((formData.scheduleType === 'multi-day' || formData.scheduleType === 'bi-weekly') && selectedDays.length === 0) { showMsg('Select at least one day', 'error'); return; }
    if (formData.startTime >= formData.endTime) { showMsg('End time must be after start time', 'error'); return; }

    const today = new Date().toISOString().split('T')[0];
    // Anchor date = start of current week (for bi-weekly alignment)
    const now = new Date();
    const anchorDate = new Date(now); 
    anchorDate.setDate(now.getDate() - now.getDay());
    const anchorStr = anchorDate.toISOString().split('T')[0];

    setSaving(true);
    try {
      if (formData.scheduleType === 'multi-day' || formData.scheduleType === 'bi-weekly') {
        const freq = formData.scheduleType === 'bi-weekly' ? 'biweekly' : 'weekly';
        let created = 0, failed = 0;
        for (const dayOfWeek of selectedDays) {
          try {
            await api('/api/schedules-enhanced', { method: 'POST', body: JSON.stringify({
              caregiverId: formData.caregiverId, clientId: formData.clientId,
              scheduleType: 'recurring', dayOfWeek, date: null,
              startTime: formData.startTime, endTime: formData.endTime, notes: formData.notes,
              frequency: freq, effectiveDate: today, anchorDate: anchorStr
            })});
            created++;
          } catch { failed++; }
        }
        const label = freq === 'biweekly' ? 'bi-weekly' : 'recurring';
        showMsg(`Created ${created} ${label} schedule${created !== 1 ? 's' : ''}${failed > 0 ? ` (${failed} failed)` : ''}!`);
      } else if (formData.scheduleType === 'recurring') {
        await api('/api/schedules-enhanced', { method: 'POST', body: JSON.stringify({
          caregiverId: formData.caregiverId, clientId: formData.clientId,
          scheduleType: 'recurring',
          dayOfWeek: parseInt(formData.dayOfWeek), date: null,
          startTime: formData.startTime, endTime: formData.endTime, notes: formData.notes,
          frequency: 'weekly', effectiveDate: today, anchorDate: null
        })});
        showMsg('Schedule created!');
      } else {
        // One-time - use original endpoint (no frequency/effective_date needed)
        await api('/api/schedules', { method: 'POST', body: JSON.stringify({
          caregiverId: formData.caregiverId, clientId: formData.clientId,
          scheduleType: 'one-time',
          dayOfWeek: null, date: formData.date,
          startTime: formData.startTime, endTime: formData.endTime, notes: formData.notes
        })});
        showMsg('Schedule created!');
      }
      setFormData(prev => ({ ...prev, clientId: '', scheduleType: 'one-time', dayOfWeek: '', date: new Date().toISOString().split('T')[0], startTime: '09:00', endTime: '13:00', notes: '' }));
      setSelectedDays([]);
      setShowForm(false);
      loadCaregiverSchedules(selectedCaregiverId);
    } catch (e) { showMsg('Error: ' + e.message, 'error'); }
    finally { setSaving(false); }
  };

  const handleDeleteSchedule = async (scheduleId) => {
    if (!window.confirm('Delete this schedule?')) return;
    try {
      await api(`/api/schedules/${scheduleId}`, { method: 'DELETE' });
      showMsg('Schedule deleted');
      loadCaregiverSchedules(selectedCaregiverId);
    } catch (e) { showMsg('Error: ' + e.message, 'error'); }
  };

  const openEditModal = (schedule) => {
    const isRecurring = schedule.day_of_week !== null && schedule.day_of_week !== undefined;
    setEditModal({
      id: schedule.id,
      clientId: schedule.client_id,
      dayOfWeek: isRecurring ? schedule.day_of_week.toString() : '',
      date: schedule.date ? schedule.date.split('T')[0] : '',
      startTime: schedule.start_time || '09:00',
      endTime: schedule.end_time || '13:00',
      notes: schedule.notes || '',
      scheduleType: isRecurring ? 'recurring' : 'one-time',
      frequency: schedule.frequency || 'weekly'
    });
  };

  const handleSaveEdit = async () => {
    if (!editModal) return;
    if (editModal.startTime >= editModal.endTime) { showMsg('End time must be after start time', 'error'); return; }
    setEditSaving(true);
    try {
      await api(`/api/schedules-all/${editModal.id}`, {
        method: 'PUT',
        body: JSON.stringify({
          clientId: editModal.clientId,
          dayOfWeek: editModal.scheduleType === 'recurring' ? parseInt(editModal.dayOfWeek) : null,
          date: editModal.scheduleType === 'one-time' ? editModal.date : null,
          startTime: editModal.startTime,
          endTime: editModal.endTime,
          notes: editModal.notes,
          frequency: editModal.frequency || 'weekly'
        })
      });
      showMsg('Schedule updated!');
      setEditModal(null);
      loadCaregiverSchedules(selectedCaregiverId);
    } catch (e) { showMsg('Error: ' + e.message, 'error'); }
    finally { setEditSaving(false); }
  };

  const groupSchedules = () => {
    const recurringByDay = {}, oneTimeByDate = {};
    caregiverSchedules.forEach(s => {
      if (s.day_of_week !== null && s.day_of_week !== undefined) {
        if (!recurringByDay[s.day_of_week]) recurringByDay[s.day_of_week] = [];
        recurringByDay[s.day_of_week].push(s);
      } else if (s.date) {
        const dk = s.date.split('T')[0];
        if (!oneTimeByDate[dk]) oneTimeByDate[dk] = [];
        oneTimeByDate[dk].push(s);
      }
    });
    Object.values(recurringByDay).forEach(arr => arr.sort((a, b) => (a.start_time || '').localeCompare(b.start_time || '')));
    Object.values(oneTimeByDate).forEach(arr => arr.sort((a, b) => (a.start_time || '').localeCompare(b.start_time || '')));
    return { recurringByDay, oneTimeByDate };
  };

  const getDayName = (dow) => ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][dow] || 'Unknown';

  const calculateTotalHours = (list) => list.reduce((t, s) => t + parseFloat(calculateHours(s.start_time, s.end_time)), 0).toFixed(2);

  const handleReassign = async (scheduleId, newCaregiverId) => {
    try {
      await api(`/api/schedules/${scheduleId}/reassign`, { method: 'PUT', body: JSON.stringify({ newCaregiverId }) });
      showMsg('Schedule reassigned!');
      loadWeekView();
    } catch (e) { showMsg('Failed to reassign', 'error'); }
  };

  // ═══════════════════════════════════════════════
  // CALENDAR HELPERS
  // ═══════════════════════════════════════════════

  const calDaysInMonth = new Date(calCurrentDate.getFullYear(), calCurrentDate.getMonth() + 1, 0).getDate();
  const calFirstDay = new Date(calCurrentDate.getFullYear(), calCurrentDate.getMonth(), 1).getDay();

  const getCalSchedulesForDay = (day) => {
    const target = new Date(calCurrentDate.getFullYear(), calCurrentDate.getMonth(), day);
    const dow = target.getDay();
    const dateStr = `${target.getFullYear()}-${String(target.getMonth() + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    let filtered = calSchedules.filter(s => {
      if (s.date) return s.date.split('T')[0] === dateStr;
      if (s.day_of_week !== null && s.day_of_week !== undefined) {
        if (s.day_of_week !== dow) return false;
        // Forward-only: skip if before effective_date
        if (s.effective_date) {
          const eff = new Date(s.effective_date + 'T00:00:00');
          if (target < eff) return false;
        }
        // Bi-weekly: check if this is an "on" week
        if (s.frequency === 'biweekly' && s.anchor_date) {
          const anchor = new Date(s.anchor_date + 'T00:00:00');
          const diffMs = target.getTime() - anchor.getTime();
          const diffWeeks = Math.round(diffMs / (7 * 24 * 60 * 60 * 1000));
          if (diffWeeks % 2 !== 0) return false;
        }
        return true;
      }
      return false;
    });
    if (calFilterCaregiver) filtered = filtered.filter(s => s.caregiver_id === calFilterCaregiver);
    return filtered.sort((a, b) => (a.start_time || '').localeCompare(b.start_time || ''));
  };

  // Get prospect appointments for a calendar day
  const getProspectApptsForDay = (day) => {
    const dateStr = `${calCurrentDate.getFullYear()}-${String(calCurrentDate.getMonth() + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    return prospectAppts.filter(a => a.appointment_date && a.appointment_date.split('T')[0] === dateStr);
  };

  // ═══════════════════════════════════════════════
  // OPEN SHIFTS ACTIONS
  // ═══════════════════════════════════════════════

  const createOpenShift = async (data) => {
    try {
      await api('/api/open-shifts', { method: 'POST', body: JSON.stringify(data) });
      showMsg('Open shift created!');
      setShowCreateShift(false);
      loadOpenShifts();
    } catch (e) { showMsg('Failed: ' + e.message, 'error'); }
  };

  const approveShiftClaim = async (shiftId, claimId) => {
    try {
      await api(`/api/open-shifts/${shiftId}/claims/${claimId}/approve`, { method: 'PUT' });
      showMsg('Claim approved!');
      setCurrentShift(null);
      loadOpenShifts();
    } catch (e) { showMsg('Failed: ' + e.message, 'error'); }
  };

  const loadShiftClaims = async (shift) => {
    try {
      const data = await api(`/api/open-shifts/${shift.id}/claims`);
      setShiftClaims(Array.isArray(data) ? data : []);
      setCurrentShift(shift);
    } catch (e) { console.error(e); }
  };

  // ═══════════════════════════════════════════════
  // STAFFING ACTIONS (Swaps + Absences)
  // ═══════════════════════════════════════════════

  const approveSwap = async (id) => {
    if (!confirm('Approve this shift swap?')) return;
    try { await api(`/api/shift-swaps/${id}/approve`, { method: 'PUT' }); loadSwaps(); }
    catch (e) { showMsg('Failed: ' + e.message, 'error'); }
  };

  const rejectSwap = async (id) => {
    const reason = prompt('Rejection reason (optional):');
    try { await api(`/api/shift-swaps/${id}/reject`, { method: 'PUT', body: JSON.stringify({ reason }) }); loadSwaps(); }
    catch (e) { showMsg('Failed: ' + e.message, 'error'); }
  };

  const recordAbsence = async (e) => {
    e.preventDefault();
    try {
      await api('/api/absences', { method: 'POST', body: JSON.stringify(absenceForm) });
      showMsg('Absence recorded!');
      setAbsenceForm({ caregiverId: '', date: '', type: 'call_out', reason: '' });
      setShowAbsenceForm(false);
      loadAbsences();
    } catch (e) { showMsg('Failed: ' + e.message, 'error'); }
  };

  const deleteAbsence = async (id) => {
    if (!confirm('Delete this absence?')) return;
    try { await api(`/api/absences/${id}`, { method: 'DELETE' }); loadAbsences(); }
    catch (e) { showMsg('Failed: ' + e.message, 'error'); }
  };

  // ═══════════════════════════════════════════════
  // AVAILABILITY ACTIONS
  // ═══════════════════════════════════════════════

  const loadAvailability = async (cgId) => {
    setAvailCaregiver(cgId);
    if (!cgId) return;
    try {
      const [avail, boDates] = await Promise.all([
        api(`/api/caregivers/${cgId}/availability`),
        api(`/api/caregivers/${cgId}/blackout-dates`).catch(() => [])
      ]);
      if (avail) {
        setAvailForm({
          status: avail.status || 'available',
          maxHoursPerWeek: avail.max_hours_per_week || 40,
          mondayAvailable: avail.monday_available !== false, mondayStartTime: avail.monday_start_time || '08:00', mondayEndTime: avail.monday_end_time || '17:00',
          tuesdayAvailable: avail.tuesday_available !== false, tuesdayStartTime: avail.tuesday_start_time || '08:00', tuesdayEndTime: avail.tuesday_end_time || '17:00',
          wednesdayAvailable: avail.wednesday_available !== false, wednesdayStartTime: avail.wednesday_start_time || '08:00', wednesdayEndTime: avail.wednesday_end_time || '17:00',
          thursdayAvailable: avail.thursday_available !== false, thursdayStartTime: avail.thursday_start_time || '08:00', thursdayEndTime: avail.thursday_end_time || '17:00',
          fridayAvailable: avail.friday_available !== false, fridayStartTime: avail.friday_start_time || '08:00', fridayEndTime: avail.friday_end_time || '17:00',
          saturdayAvailable: avail.saturday_available || false, saturdayStartTime: avail.saturday_start_time || '08:00', saturdayEndTime: avail.saturday_end_time || '17:00',
          sundayAvailable: avail.sunday_available || false, sundayStartTime: avail.sunday_start_time || '08:00', sundayEndTime: avail.sunday_end_time || '17:00',
        });
        setAvailData(avail);
      }
      setBlackoutDates(Array.isArray(boDates) ? boDates : []);
    } catch (e) { console.error(e); }
  };

  const saveAvailability = async () => {
    try {
      await api(`/api/caregivers/${availCaregiver}/availability`, { method: 'PUT', body: JSON.stringify(availForm) });
      showMsg('Availability saved!');
    } catch (e) { showMsg('Error: ' + e.message, 'error'); }
  };

  const addBlackout = async (e) => {
    e.preventDefault();
    try {
      await api(`/api/caregivers/${availCaregiver}/blackout-dates`, { method: 'POST', body: JSON.stringify(newBlackout) });
      showMsg('Blackout date added!');
      setNewBlackout({ startDate: '', endDate: '', reason: '' });
      setShowBlackoutForm(false);
      loadAvailability(availCaregiver);
    } catch (e) { showMsg('Error: ' + e.message, 'error'); }
  };

  const deleteBlackout = async (id) => {
    if (!confirm('Delete this blackout date?')) return;
    try {
      await api(`/api/blackout-dates/${id}`, { method: 'DELETE' });
      loadAvailability(availCaregiver);
    } catch (e) { showMsg('Error: ' + e.message, 'error'); }
  };

  // ═══════════════════════════════════════════════
  // STYLES
  // ═══════════════════════════════════════════════

  const s = {
    tabBar: { display: 'flex', gap: '0.25rem', marginBottom: '1rem', flexWrap: 'wrap', borderBottom: '2px solid #e5e7eb', paddingBottom: '0.5rem' },
    tab: (active) => ({
      padding: isMobile ? '0.5rem 0.75rem' : '0.5rem 1rem',
      border: 'none', borderRadius: '8px 8px 0 0', cursor: 'pointer', fontSize: isMobile ? '0.8rem' : '0.88rem',
      fontWeight: active ? '600' : '400', transition: 'all 0.15s',
      background: active ? '#0f766e' : 'transparent',
      color: active ? '#fff' : '#6b7280',
      borderBottom: active ? '2px solid #0f766e' : '2px solid transparent',
    }),
    statCard: { textAlign: 'center', padding: '1rem' },
    statVal: (color) => ({ fontSize: '1.8rem', fontWeight: 'bold', color }),
    statLabel: { fontSize: '0.82rem', color: '#666', marginTop: '0.25rem' },
    badge: (bg, color) => ({ padding: '0.2rem 0.6rem', borderRadius: '12px', fontSize: '0.72rem', fontWeight: '600', background: bg, color }),
    weekNav: { display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap', marginBottom: '1rem', padding: '1rem' },
  };

  // ═══════════════════════════════════════════════
  // RENDER
  // ═══════════════════════════════════════════════

  if (loading) return <div className="loading"><div className="spinner"></div></div>;

  const tabs = [
    { id: 'week', label: '📅 Week View', mLabel: '📅' },
    { id: 'calendar', label: '📆 Calendar', mLabel: '📆' },
    { id: 'create', label: '➕ Create', mLabel: '➕' },
    { id: 'coverage', label: '📈 Coverage', mLabel: '📈' },
    { id: 'open-shifts', label: '🚨 Open Shifts', mLabel: '🚨' },
    { id: 'staffing', label: '🔄 Swaps & Absences', mLabel: '🔄' },
    { id: 'availability', label: '⏰ Availability', mLabel: '⏰' },
  ];

  const pendingSwaps = swaps.filter(sw => sw.status === 'accepted').length;

  return (
    <>
    <div>
      {/* Header */}
      <div className="page-header" style={{ marginBottom: '1rem' }}>
        <h2 style={{ margin: 0 }}>📅 Scheduling</h2>
      </div>

      {/* Toast */}
      {message.text && (
        <div style={{
          position: 'fixed', top: '1rem', right: '1rem', padding: '0.75rem 1.25rem', borderRadius: '8px', zIndex: 1000,
          background: message.type === 'error' ? '#FEE2E2' : '#D1FAE5',
          color: message.type === 'error' ? '#DC2626' : '#059669',
          boxShadow: '0 4px 12px rgba(0,0,0,0.15)'
        }}>{message.text}</div>
      )}

      {/* Tab Bar */}
      <div style={s.tabBar}>
        {tabs.map(tab => (
          <button key={tab.id} style={s.tab(activeTab === tab.id)} onClick={() => setActiveTab(tab.id)}>
            {isMobile ? tab.mLabel : tab.label}
            {tab.id === 'staffing' && pendingSwaps > 0 && (
              <span style={{ ...s.badge('#DC2626', '#fff'), marginLeft: '0.4rem' }}>{pendingSwaps}</span>
            )}
          </button>
        ))}
      </div>

      {/* ══════════════════════════════════════════ */}
      {/* WEEK VIEW TAB */}
      {/* ══════════════════════════════════════════ */}
      {activeTab === 'week' && (
        <div>
          <div className="card" style={s.weekNav}>
            <button className="btn btn-secondary btn-sm" onClick={() => navigateWeek(-1)}>◀ Prev</button>
            <strong>Week of {new Date(weekOf + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</strong>
            <button className="btn btn-secondary btn-sm" onClick={() => navigateWeek(1)}>Next ▶</button>
            <button className="btn btn-sm btn-primary" onClick={() => setWeekOf(getWeekStart(new Date()).toISOString().split('T')[0])}>Today</button>
            <AutoFillButton weekOf={weekOf} token={token} onComplete={loadWeekView} />
          </div>
          <p style={{ fontSize: '0.82rem', color: '#6B7280', marginBottom: '0.75rem' }}>💡 Click any shift to reassign it</p>

          {weekData ? (
            <div style={{ overflowX: 'auto' }}>
              <table className="table" style={{ minWidth: '800px' }}>
                <thead>
                  <tr>
                    <th style={{ width: '140px' }}>Caregiver</th>
                    {['Sun','Mon','Tue','Wed','Thu','Fri','Sat'].map((day, idx) => {
                      const date = new Date(weekData.weekStart);
                      date.setDate(date.getDate() + idx);
                      const isToday = new Date().toDateString() === date.toDateString();
                      return (
                        <th key={day} style={{ textAlign: 'center', minWidth: '95px', background: isToday ? '#EFF6FF' : undefined }}>
                          <div>{day}</div>
                          <div style={{ fontSize: '0.72rem', color: isToday ? '#2563EB' : '#6B7280', fontWeight: isToday ? '700' : '400' }}>{date.getDate()}</div>
                        </th>
                      );
                    })}
                  </tr>
                </thead>
                <tbody>
                  {weekData.caregivers.map(({ caregiver, days: dayData }) => (
                    <tr key={caregiver.id}>
                      <td>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                          <div style={{ width: '8px', height: '8px', borderRadius: '50%', background: cgColor(caregiver.id) }} />
                          <strong style={{ fontSize: '0.85rem' }}>{caregiver.first_name} {caregiver.last_name?.[0]}.</strong>
                        </div>
                      </td>
                      {[0,1,2,3,4,5,6].map(di => {
                        const date = new Date(weekData.weekStart); date.setDate(date.getDate() + di);
                        const isToday = new Date().toDateString() === date.toDateString();
                        return (
                          <td key={di} style={{ padding: '0.25rem', verticalAlign: 'top', background: isToday ? '#F0F9FF' : undefined }}>
                            {dayData[di].map(sched => (
                              <div key={sched.id} onClick={() => setReassignModal({ schedule: sched, currentCaregiver: caregiver })}
                                style={{ fontSize: '0.7rem', padding: '0.25rem 0.4rem', marginBottom: '0.2rem', borderRadius: '4px',
                                  background: sched.isRecurring ? '#DBEAFE' : '#D1FAE5', borderLeft: `3px solid ${cgColor(caregiver.id)}`, cursor: 'pointer' }}
                                title={`${getClientName(sched.client_id)} · ${formatTime(sched.start_time)}-${formatTime(sched.end_time)}`}>
                                <div style={{ fontWeight: '600', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{getClientName(sched.client_id).split(' ')[0]}</div>
                                <div style={{ color: '#6B7280' }}>{formatTime(sched.start_time)}</div>
                              </div>
                            ))}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : <div className="card" style={{ textAlign: 'center', padding: '2rem' }}>Loading week view...</div>}
        </div>
      )}

      {/* Reassign Modal */}
      {reassignModal && (
        <div className="modal active" onClick={() => setReassignModal(null)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()} style={{ maxWidth: '400px' }}>
            <div className="modal-header">
              <h2>Reassign Shift</h2>
              <button className="close-btn" onClick={() => setReassignModal(null)}>×</button>
            </div>
            <div style={{ margin: '1rem 0', padding: '1rem', background: '#F3F4F6', borderRadius: '8px' }}>
              <div style={{ fontWeight: '600' }}>{getClientName(reassignModal.schedule.client_id)}</div>
              <div style={{ fontSize: '0.88rem', color: '#6B7280' }}>{formatTime(reassignModal.schedule.start_time)} - {formatTime(reassignModal.schedule.end_time)}</div>
              <div style={{ fontSize: '0.82rem', color: '#6B7280', marginTop: '0.4rem' }}>Currently: <strong>{reassignModal.currentCaregiver.first_name} {reassignModal.currentCaregiver.last_name}</strong></div>
            </div>
            <div className="form-group">
              <label>Reassign to:</label>
              <select onChange={(e) => { if (e.target.value) { handleReassign(reassignModal.schedule.id, e.target.value); setReassignModal(null); } }} defaultValue="">
                <option value="">Select caregiver...</option>
                {caregivers.filter(cg => cg.id !== reassignModal.currentCaregiver.id).map(cg => (
                  <option key={cg.id} value={cg.id}>{cg.first_name} {cg.last_name}</option>
                ))}
              </select>
            </div>
            <div className="modal-actions"><button className="btn btn-secondary" onClick={() => setReassignModal(null)}>Cancel</button></div>
          </div>
        </div>
      )}

      {/* ══════════════════════════════════════════ */}
      {/* CALENDAR TAB */}
      {/* ══════════════════════════════════════════ */}
      {activeTab === 'calendar' && (
        <div>
          <div className="card" style={{ marginBottom: '1rem', display: 'flex', flexWrap: 'wrap', gap: '0.75rem', alignItems: 'center', justifyContent: 'space-between' }}>
            <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
              <button className="btn btn-secondary btn-sm" onClick={() => setCalCurrentDate(new Date(calCurrentDate.getFullYear(), calCurrentDate.getMonth() - 1))}>‹</button>
              <button className="btn btn-secondary btn-sm" onClick={() => setCalCurrentDate(new Date())}>Today</button>
              <button className="btn btn-secondary btn-sm" onClick={() => setCalCurrentDate(new Date(calCurrentDate.getFullYear(), calCurrentDate.getMonth() + 1))}>›</button>
              <h3 style={{ margin: '0 0.5rem', fontSize: '1.1rem' }}>{calCurrentDate.toLocaleString('default', { month: 'long', year: 'numeric' })}</h3>
            </div>
            <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
              <button className="btn btn-sm" onClick={() => setShowProspectApptForm(!showProspectApptForm)}
                style={{ background: '#F97316', color: '#fff', border: 'none', fontSize: '0.82rem' }}>
                {showProspectApptForm ? '✕ Cancel' : '+ Prospect Appt'}
              </button>
              <button className="btn btn-sm" onClick={() => setShowProspectForm(!showProspectForm)}
                style={{ background: showProspectForm ? '#6B7280' : '#8B5CF6', color: '#fff', border: 'none', fontSize: '0.82rem' }}>
                {showProspectForm ? '✕ Cancel' : '+ New Prospect'}
              </button>
              <select value={calFilterCaregiver} onChange={(e) => setCalFilterCaregiver(e.target.value)}
                style={{ padding: '0.4rem', borderRadius: '6px', border: '1px solid #ddd', fontSize: '0.88rem' }}>
                <option value="">All Caregivers</option>
                {caregivers.map(cg => <option key={cg.id} value={cg.id}>{cg.first_name} {cg.last_name}</option>)}
              </select>
            </div>
          </div>

          {/* New Prospect Quick Form */}
          {showProspectForm && (
            <div className="card" style={{ marginBottom: '1rem', border: '2px solid #8B5CF6', background: '#FAF5FF' }}>
              <h4 style={{ margin: '0 0 0.75rem', color: '#6D28D9' }}>👤 Add Prospect</h4>
              <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr', gap: '0.75rem' }}>
                <div>
                  <label style={{ display: 'block', marginBottom: '0.3rem', fontWeight: '600', fontSize: '0.85rem' }}>First Name *</label>
                  <input value={prospectForm.firstName} onChange={(e) => setProspectForm(p => ({ ...p, firstName: e.target.value }))}
                    style={{ width: '100%', padding: '0.5rem', borderRadius: '6px', border: '1px solid #ddd' }} />
                </div>
                <div>
                  <label style={{ display: 'block', marginBottom: '0.3rem', fontWeight: '600', fontSize: '0.85rem' }}>Last Name *</label>
                  <input value={prospectForm.lastName} onChange={(e) => setProspectForm(p => ({ ...p, lastName: e.target.value }))}
                    style={{ width: '100%', padding: '0.5rem', borderRadius: '6px', border: '1px solid #ddd' }} />
                </div>
                <div>
                  <label style={{ display: 'block', marginBottom: '0.3rem', fontWeight: '600', fontSize: '0.85rem' }}>Phone</label>
                  <input value={prospectForm.phone} onChange={(e) => setProspectForm(p => ({ ...p, phone: e.target.value }))}
                    style={{ width: '100%', padding: '0.5rem', borderRadius: '6px', border: '1px solid #ddd' }} />
                </div>
                <div>
                  <label style={{ display: 'block', marginBottom: '0.3rem', fontWeight: '600', fontSize: '0.85rem' }}>Source</label>
                  <input value={prospectForm.source} onChange={(e) => setProspectForm(p => ({ ...p, source: e.target.value }))} placeholder="Referral, website, etc."
                    style={{ width: '100%', padding: '0.5rem', borderRadius: '6px', border: '1px solid #ddd' }} />
                </div>
              </div>
              <div style={{ marginTop: '0.75rem' }}>
                <label style={{ display: 'block', marginBottom: '0.3rem', fontWeight: '600', fontSize: '0.85rem' }}>Notes</label>
                <textarea value={prospectForm.notes} onChange={(e) => setProspectForm(p => ({ ...p, notes: e.target.value }))} rows="2" placeholder="Any initial notes..."
                  style={{ width: '100%', padding: '0.5rem', borderRadius: '6px', border: '1px solid #ddd', resize: 'vertical' }} />
              </div>
              <div style={{ marginTop: '0.75rem', display: 'flex', gap: '0.5rem' }}>
                <button className="btn btn-primary btn-sm" onClick={createProspect} disabled={prospectSaving}>{prospectSaving ? 'Saving...' : '✓ Save Prospect'}</button>
                <button className="btn btn-secondary btn-sm" onClick={() => setShowProspectForm(false)}>Cancel</button>
              </div>
            </div>
          )}

          {/* Prospect Appointment Form */}
          {showProspectApptForm && (
            <div className="card" style={{ marginBottom: '1rem', border: '2px solid #F97316', background: '#FFF7ED' }}>
              <h4 style={{ margin: '0 0 0.75rem', color: '#C2410C' }}>📋 Schedule Prospect Appointment</h4>
              <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr', gap: '0.75rem' }}>
                <div>
                  <label style={{ display: 'block', marginBottom: '0.3rem', fontWeight: '600', fontSize: '0.85rem' }}>Prospect *</label>
                  <select value={prospectApptForm.prospectId} onChange={(e) => setProspectApptForm(p => ({ ...p, prospectId: e.target.value }))}
                    style={{ width: '100%', padding: '0.5rem', borderRadius: '6px', border: '1px solid #ddd' }}>
                    <option value="">Select prospect...</option>
                    {prospects.filter(p => p.status === 'prospect').map(p => (
                      <option key={p.id} value={p.id}>{p.first_name} {p.last_name}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label style={{ display: 'block', marginBottom: '0.3rem', fontWeight: '600', fontSize: '0.85rem' }}>Date *</label>
                  <input type="date" value={prospectApptForm.appointmentDate} onChange={(e) => setProspectApptForm(p => ({ ...p, appointmentDate: e.target.value }))}
                    style={{ width: '100%', padding: '0.5rem', borderRadius: '6px', border: '1px solid #ddd' }} />
                </div>
                <div>
                  <label style={{ display: 'block', marginBottom: '0.3rem', fontWeight: '600', fontSize: '0.85rem' }}>Start Time</label>
                  <input type="time" value={prospectApptForm.startTime} onChange={(e) => setProspectApptForm(p => ({ ...p, startTime: e.target.value }))}
                    style={{ width: '100%', padding: '0.5rem', borderRadius: '6px', border: '1px solid #ddd' }} />
                </div>
                <div>
                  <label style={{ display: 'block', marginBottom: '0.3rem', fontWeight: '600', fontSize: '0.85rem' }}>End Time</label>
                  <input type="time" value={prospectApptForm.endTime} onChange={(e) => setProspectApptForm(p => ({ ...p, endTime: e.target.value }))}
                    style={{ width: '100%', padding: '0.5rem', borderRadius: '6px', border: '1px solid #ddd' }} />
                </div>
                <div>
                  <label style={{ display: 'block', marginBottom: '0.3rem', fontWeight: '600', fontSize: '0.85rem' }}>Type</label>
                  <select value={prospectApptForm.appointmentType} onChange={(e) => setProspectApptForm(p => ({ ...p, appointmentType: e.target.value }))}
                    style={{ width: '100%', padding: '0.5rem', borderRadius: '6px', border: '1px solid #ddd' }}>
                    <option value="assessment">Assessment</option>
                    <option value="consultation">Consultation</option>
                    <option value="intake">Intake</option>
                    <option value="meet_greet">Meet & Greet</option>
                    <option value="other">Other</option>
                  </select>
                </div>
                <div>
                  <label style={{ display: 'block', marginBottom: '0.3rem', fontWeight: '600', fontSize: '0.85rem' }}>Caregiver (optional)</label>
                  <select value={prospectApptForm.caregiverId} onChange={(e) => setProspectApptForm(p => ({ ...p, caregiverId: e.target.value }))}
                    style={{ width: '100%', padding: '0.5rem', borderRadius: '6px', border: '1px solid #ddd' }}>
                    <option value="">None assigned</option>
                    {caregivers.map(cg => <option key={cg.id} value={cg.id}>{cg.first_name} {cg.last_name}</option>)}
                  </select>
                </div>
              </div>
              <div style={{ marginTop: '0.75rem' }}>
                <label style={{ display: 'block', marginBottom: '0.3rem', fontWeight: '600', fontSize: '0.85rem' }}>Location / Notes</label>
                <input value={prospectApptForm.location} onChange={(e) => setProspectApptForm(p => ({ ...p, location: e.target.value }))} placeholder="Address or meeting location"
                  style={{ width: '100%', padding: '0.5rem', borderRadius: '6px', border: '1px solid #ddd' }} />
              </div>
              <div style={{ marginTop: '0.75rem', display: 'flex', gap: '0.5rem' }}>
                <button className="btn btn-primary btn-sm" onClick={createProspectAppt} disabled={prospectSaving}
                  style={{ background: '#F97316', borderColor: '#F97316' }}>{prospectSaving ? 'Saving...' : '✓ Schedule Appointment'}</button>
                <button className="btn btn-secondary btn-sm" onClick={() => setShowProspectApptForm(false)}>Cancel</button>
              </div>
            </div>
          )}

          {/* Prospect List (collapsible) */}
          {prospects.filter(p => p.status === 'prospect').length > 0 && (
            <div className="card" style={{ marginBottom: '1rem', padding: '0.75rem' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
                <h4 style={{ margin: 0, fontSize: '0.9rem', color: '#6D28D9' }}>👤 Active Prospects ({prospects.filter(p => p.status === 'prospect').length})</h4>
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem' }}>
                {prospects.filter(p => p.status === 'prospect').map(p => (
                  <div key={p.id} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.35rem 0.75rem', background: '#FAF5FF', border: '1px solid #DDD6FE', borderRadius: '20px', fontSize: '0.82rem' }}>
                    <span style={{ fontWeight: '600' }}>{p.first_name} {p.last_name}</span>
                    {p.phone && <span style={{ color: '#6B7280' }}>{p.phone}</span>}
                    <button onClick={() => convertProspect(p.id)} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '0.78rem', color: '#059669' }} title="Convert to Client">✅</button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Month Grid */}
          <div className="card">
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: '1px', background: '#e5e7eb' }}>
              {['Sun','Mon','Tue','Wed','Thu','Fri','Sat'].map(d => (
                <div key={d} style={{ padding: '0.5rem', textAlign: 'center', fontWeight: '600', fontSize: '0.8rem', background: '#f9fafb', color: '#374151' }}>{d}</div>
              ))}
              {Array.from({ length: calFirstDay }, (_, i) => (
                <div key={`e${i}`} style={{ background: '#fafafa', minHeight: isMobile ? '50px' : '80px' }} />
              ))}
              {Array.from({ length: calDaysInMonth }, (_, i) => {
                const day = i + 1;
                const today = new Date();
                const isToday = day === today.getDate() && calCurrentDate.getMonth() === today.getMonth() && calCurrentDate.getFullYear() === today.getFullYear();
                const dayScheds = getCalSchedulesForDay(day);
                const dayProspectAppts = getProspectApptsForDay(day);
                return (
                  <div key={day} onClick={() => { setCalDaySchedules(dayScheds); setCalSelectedDay(day); }}
                    style={{ background: isToday ? '#EFF6FF' : '#fff', minHeight: isMobile ? '50px' : '80px', padding: '0.25rem', cursor: 'pointer', position: 'relative' }}>
                    <div style={{ fontSize: '0.78rem', fontWeight: isToday ? '700' : '400', color: isToday ? '#2563EB' : '#374151', marginBottom: '0.2rem' }}>{day}</div>
                    {dayScheds.slice(0, isMobile ? 1 : 2).map((sc, idx) => (
                      <div key={idx} style={{ fontSize: '0.62rem', padding: '0.1rem 0.2rem', marginBottom: '1px', borderRadius: '2px',
                        background: cgColor(sc.caregiver_id) + '20', borderLeft: `2px solid ${cgColor(sc.caregiver_id)}`,
                        whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {isMobile ? formatTime(sc.start_time) : `${getCaregiverName(sc.caregiver_id).split(' ')[0]} ${formatTime(sc.start_time)}`}
                      </div>
                    ))}
                    {dayProspectAppts.map((pa, idx) => (
                      <div key={`pa${idx}`} style={{ fontSize: '0.62rem', padding: '0.1rem 0.2rem', marginBottom: '1px', borderRadius: '2px',
                        background: '#FFF7ED', borderLeft: '2px solid #F97316',
                        whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', color: '#9A3412' }}>
                        {isMobile ? '🟠' : `🟠 ${pa.prospect_first_name}`}
                      </div>
                    ))}
                    {(dayScheds.length + dayProspectAppts.length) > (isMobile ? 1 : 3) && (
                      <div style={{ fontSize: '0.6rem', color: '#6B7280', textAlign: 'center' }}>+{(dayScheds.length + dayProspectAppts.length) - (isMobile ? 1 : 3)} more</div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {/* Caregiver Legend */}
          <div className="card" style={{ marginTop: '0.75rem' }}>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.75rem', alignItems: 'center' }}>
              {caregivers.map(cg => (
                <div key={cg.id} onClick={() => setCalFilterCaregiver(calFilterCaregiver === cg.id ? '' : cg.id)}
                  style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', cursor: 'pointer', padding: '0.2rem 0.5rem', borderRadius: '6px', background: calFilterCaregiver === cg.id ? '#E5E7EB' : 'transparent' }}>
                  <div style={{ width: '10px', height: '10px', borderRadius: '3px', background: cgColor(cg.id) }} />
                  <span style={{ fontSize: '0.82rem' }}>{cg.first_name} {cg.last_name}</span>
                </div>
              ))}
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', padding: '0.2rem 0.5rem' }}>
                <div style={{ width: '10px', height: '10px', borderRadius: '3px', background: '#F97316' }} />
                <span style={{ fontSize: '0.82rem', color: '#9A3412' }}>Prospect</span>
              </div>
            </div>
          </div>

          {/* Day Detail Modal */}
          {calSelectedDay && (
            <div className="modal active" onClick={(e) => e.target === e.currentTarget && setCalSelectedDay(null)}
              style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: '1rem' }}>
              <div style={{ background: '#fff', borderRadius: '12px', width: '100%', maxWidth: '500px', maxHeight: '80vh', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
                <div style={{ padding: '1rem 1.25rem', borderBottom: '1px solid #e5e7eb', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div>
                    <h3 style={{ margin: 0, fontSize: '1.1rem' }}>
                      {new Date(calCurrentDate.getFullYear(), calCurrentDate.getMonth(), calSelectedDay).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}
                    </h3>
                    <p style={{ margin: 0, fontSize: '0.82rem', color: '#6B7280' }}>
                      {calDaySchedules.length} appointment{calDaySchedules.length !== 1 ? 's' : ''}
                      {getProspectApptsForDay(calSelectedDay).length > 0 && ` + ${getProspectApptsForDay(calSelectedDay).length} prospect`}
                    </p>
                  </div>
                  <button onClick={() => setCalSelectedDay(null)} style={{ background: 'none', border: 'none', fontSize: '1.5rem', cursor: 'pointer', color: '#9CA3AF' }}>×</button>
                </div>
                <div style={{ flex: 1, overflow: 'auto', padding: '1rem' }}>
                  {calDaySchedules.length === 0 && getProspectApptsForDay(calSelectedDay).length === 0 ? (
                    <div style={{ textAlign: 'center', padding: '2rem', color: '#6B7280' }}>📅 No appointments</div>
                  ) : (
                    <>
                      {calDaySchedules.map((sc, idx) => (
                        <div key={idx} style={{ display: 'flex', gap: '0.75rem', padding: '0.75rem', background: '#f9fafb', borderRadius: '8px', borderLeft: `4px solid ${cgColor(sc.caregiver_id)}`, marginBottom: '0.5rem' }}>
                          <div style={{ minWidth: '70px', textAlign: 'center' }}>
                            <div style={{ fontWeight: '600', fontSize: '0.9rem' }}>{formatTime(sc.start_time)}</div>
                            <div style={{ fontSize: '0.78rem', color: '#6B7280' }}>{formatTime(sc.end_time)}</div>
                          </div>
                          <div style={{ flex: 1 }}>
                            <div style={{ fontWeight: '600' }}>{getClientName(sc.client_id)}</div>
                            <div style={{ fontSize: '0.82rem', color: '#6B7280' }}>
                              <span style={{ display: 'inline-block', width: '8px', height: '8px', borderRadius: '50%', background: cgColor(sc.caregiver_id), marginRight: '0.4rem' }} />
                              {getCaregiverName(sc.caregiver_id)}
                            </div>
                            {sc.day_of_week !== null && <span style={s.badge(sc.frequency === 'biweekly' ? '#FFEDD5' : '#DBEAFE', sc.frequency === 'biweekly' ? '#C2410C' : '#1D4ED8')}>{sc.frequency === 'biweekly' ? 'Bi-Weekly' : 'Recurring'}</span>}
                          </div>
                        </div>
                      ))}
                      {/* Prospect Appointments in Day Modal */}
                      {getProspectApptsForDay(calSelectedDay).map((pa, idx) => (
                        <div key={`pa${idx}`} style={{ display: 'flex', gap: '0.75rem', padding: '0.75rem', background: '#FFF7ED', borderRadius: '8px', borderLeft: '4px solid #F97316', marginBottom: '0.5rem' }}>
                          <div style={{ minWidth: '70px', textAlign: 'center' }}>
                            <div style={{ fontWeight: '600', fontSize: '0.9rem' }}>{formatTime(pa.start_time)}</div>
                            <div style={{ fontSize: '0.78rem', color: '#6B7280' }}>{formatTime(pa.end_time)}</div>
                          </div>
                          <div style={{ flex: 1 }}>
                            <div style={{ fontWeight: '600', color: '#9A3412' }}>🟠 {pa.prospect_first_name} {pa.prospect_last_name}</div>
                            <div style={{ fontSize: '0.82rem', color: '#B45309' }}>{(pa.appointment_type || '').replace(/_/g, ' ')}</div>
                            {pa.caregiver_first_name && <div style={{ fontSize: '0.78rem', color: '#6B7280' }}>w/ {pa.caregiver_first_name} {pa.caregiver_last_name}</div>}
                            {pa.location && <div style={{ fontSize: '0.78rem', color: '#6B7280' }}>📍 {pa.location}</div>}
                            <span style={s.badge('#FFEDD5', '#C2410C')}>Prospect</span>
                          </div>
                          <button onClick={() => deleteProspectAppt(pa.id)} style={{ background: 'none', border: 'none', color: '#DC2626', cursor: 'pointer', fontSize: '0.9rem', alignSelf: 'flex-start' }} title="Cancel">🗑</button>
                        </div>
                      ))}
                    </>
                  )}
                </div>
                <div style={{ padding: '0.75rem 1.25rem', borderTop: '1px solid #e5e7eb', textAlign: 'right' }}>
                  <button className="btn btn-secondary btn-sm" onClick={() => setCalSelectedDay(null)}>Close</button>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ══════════════════════════════════════════ */}
      {/* CREATE SCHEDULE TAB (caregiver-first) */}
      {/* ══════════════════════════════════════════ */}
      {activeTab === 'create' && (() => {
        const { recurringByDay, oneTimeByDate } = groupSchedules();
        const hasRecurring = Object.keys(recurringByDay).length > 0;
        const hasOneTime = Object.keys(oneTimeByDate).length > 0;
        return (
        <div>
          {/* Caregiver Selection */}
          <div className="card" style={{ marginBottom: '1rem' }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              <div>
                <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: '600', color: '#374151' }}>Select Caregiver</label>
                <select value={selectedCaregiverId} onChange={(e) => handleCaregiverSelectCreate(e.target.value)}
                  style={{ width: '100%', padding: '0.75rem', borderRadius: '8px', border: '2px solid #e5e7eb', fontSize: '1rem', background: '#fff' }}>
                  <option value="">Choose a caregiver...</option>
                  {caregivers.map(cg => <option key={cg.id} value={cg.id}>{cg.first_name} {cg.last_name}</option>)}
                </select>
              </div>
              {selectedCaregiverId && (
                <button className="btn btn-primary" onClick={() => { setFormData(prev => ({ ...prev, caregiverId: selectedCaregiverId })); setShowForm(!showForm); }}
                  style={{ alignSelf: 'flex-start' }}>
                  {showForm ? '✕ Cancel' : '+ Add Schedule'}
                </button>
              )}
            </div>
          </div>

          {/* Add Schedule Form */}
          {showForm && selectedCaregiverId && (
            <div className="card" style={{ marginBottom: '1.5rem', border: '2px solid #3B82F6', background: '#F8FAFC' }}>
              <h3 style={{ margin: '0 0 1.25rem 0', color: '#1E40AF' }}>New Schedule</h3>
              <form onSubmit={handleCreateSubmit}>
                {/* Schedule Type Toggle */}
                <div style={{ marginBottom: '1.25rem' }}>
                  <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: '600' }}>Schedule Type</label>
                  <div style={{ display: 'flex', borderRadius: '8px', overflow: 'hidden', border: '2px solid #e5e7eb' }}>
                    {[
                      { type: 'one-time', icon: '📅', label: 'One-Time' },
                      { type: 'multi-day', icon: '📆', label: 'Multi-Day' },
                      { type: 'recurring', icon: '🔄', label: 'Recurring' },
                      { type: 'bi-weekly', icon: '📊', label: 'Bi-Weekly' }
                    ].map((opt, i) => (
                      <button key={opt.type} type="button" onClick={() => { setFormData(prev => ({ ...prev, scheduleType: opt.type, dayOfWeek: '' })); setSelectedDays([]); }}
                        style={{ flex: 1, padding: '0.75rem 0.5rem', border: 'none', borderLeft: i > 0 ? '2px solid #e5e7eb' : 'none',
                          background: formData.scheduleType === opt.type ? '#3B82F6' : '#fff',
                          color: formData.scheduleType === opt.type ? '#fff' : '#374151',
                          cursor: 'pointer', fontWeight: '500', fontSize: '0.9rem' }}>
                        {opt.icon} {opt.label}
                      </button>
                    ))}
                  </div>
                </div>

                {/* One-Time: Date Picker */}
                {formData.scheduleType === 'one-time' && (
                  <div style={{ marginBottom: '1.25rem' }}>
                    <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: '600' }}>Date *</label>
                    <input type="date" value={formData.date} onChange={(e) => setFormData(prev => ({ ...prev, date: e.target.value }))}
                      min={new Date().toISOString().split('T')[0]} required
                      style={{ width: '100%', padding: '0.75rem', borderRadius: '8px', border: '2px solid #e5e7eb', fontSize: '1rem' }} />
                  </div>
                )}

                {/* Multi-Day: Day Grid */}
                {formData.scheduleType === 'multi-day' && (
                  <div style={{ marginBottom: '1.25rem' }}>
                    <div style={{ background: '#EFF6FF', padding: '1rem', borderRadius: '8px', border: '1px solid #BFDBFE' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
                        <label style={{ fontWeight: '600', margin: 0 }}>Select Days (Recurring Weekly) *</label>
                        <div style={{ display: 'flex', gap: '0.5rem' }}>
                          <button type="button" onClick={selectWeekdays} style={{ padding: '0.35rem 0.75rem', borderRadius: '4px', border: 'none', background: '#3B82F6', color: '#fff', cursor: 'pointer', fontSize: '0.75rem', fontWeight: '500' }}>Mon-Fri</button>
                          <button type="button" onClick={clearDays} style={{ padding: '0.35rem 0.75rem', borderRadius: '4px', border: '1px solid #D1D5DB', background: '#fff', color: '#6B7280', cursor: 'pointer', fontSize: '0.75rem', fontWeight: '500' }}>Clear</button>
                        </div>
                      </div>
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: '0.5rem', marginBottom: '0.75rem' }}>
                        {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((day, idx) => (
                          <button key={day} type="button" onClick={() => toggleDaySelection(idx)}
                            style={{ padding: '0.6rem 0.25rem', borderRadius: '8px',
                              border: selectedDays.includes(idx) ? '2px solid #3B82F6' : '2px solid #E5E7EB',
                              background: selectedDays.includes(idx) ? '#3B82F6' : '#fff',
                              color: selectedDays.includes(idx) ? '#fff' : '#374151',
                              cursor: 'pointer', fontWeight: '600', fontSize: '0.85rem' }}>
                            {day}
                          </button>
                        ))}
                      </div>
                      {selectedDays.length > 0 && (
                        <div style={{ fontSize: '0.85rem', color: '#1E40AF', padding: '0.5rem', background: '#DBEAFE', borderRadius: '4px' }}>
                          🔄 Will create <strong>{selectedDays.length}</strong> recurring weekly schedule{selectedDays.length !== 1 ? 's' : ''}: {selectedDays.map(d => ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][d]).join(', ')}
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {/* Recurring: Single Day Picker */}
                {formData.scheduleType === 'recurring' && (
                  <div style={{ marginBottom: '1.25rem' }}>
                    <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: '600' }}>Day of Week *</label>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(100px, 1fr))', gap: '0.5rem' }}>
                      {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((day, idx) => (
                        <button key={day} type="button" onClick={() => setFormData(prev => ({ ...prev, dayOfWeek: idx.toString() }))}
                          style={{ padding: '0.75rem 0.5rem', borderRadius: '8px',
                            border: formData.dayOfWeek === idx.toString() ? '2px solid #3B82F6' : '2px solid #e5e7eb',
                            background: formData.dayOfWeek === idx.toString() ? '#EFF6FF' : '#fff',
                            color: formData.dayOfWeek === idx.toString() ? '#1D4ED8' : '#374151',
                            cursor: 'pointer', fontWeight: '500', fontSize: '0.9rem' }}>
                          {day}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {/* Bi-Weekly: Day Grid (same as multi-day but every other week) */}
                {formData.scheduleType === 'bi-weekly' && (
                  <div style={{ marginBottom: '1.25rem' }}>
                    <div style={{ background: '#FFF7ED', padding: '1rem', borderRadius: '8px', border: '1px solid #FED7AA' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
                        <label style={{ fontWeight: '600', margin: 0 }}>Select Days (Every Other Week) *</label>
                        <div style={{ display: 'flex', gap: '0.5rem' }}>
                          <button type="button" onClick={selectWeekdays} style={{ padding: '0.35rem 0.75rem', borderRadius: '4px', border: 'none', background: '#F97316', color: '#fff', cursor: 'pointer', fontSize: '0.75rem', fontWeight: '500' }}>Mon-Fri</button>
                          <button type="button" onClick={clearDays} style={{ padding: '0.35rem 0.75rem', borderRadius: '4px', border: '1px solid #D1D5DB', background: '#fff', color: '#6B7280', cursor: 'pointer', fontSize: '0.75rem', fontWeight: '500' }}>Clear</button>
                        </div>
                      </div>
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: '0.5rem', marginBottom: '0.75rem' }}>
                        {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((day, idx) => (
                          <button key={day} type="button" onClick={() => toggleDaySelection(idx)}
                            style={{ padding: '0.6rem 0.25rem', borderRadius: '8px',
                              border: selectedDays.includes(idx) ? '2px solid #F97316' : '2px solid #E5E7EB',
                              background: selectedDays.includes(idx) ? '#F97316' : '#fff',
                              color: selectedDays.includes(idx) ? '#fff' : '#374151',
                              cursor: 'pointer', fontWeight: '600', fontSize: '0.85rem' }}>
                            {day}
                          </button>
                        ))}
                      </div>
                      {selectedDays.length > 0 && (
                        <div style={{ fontSize: '0.85rem', color: '#9A3412', padding: '0.5rem', background: '#FFEDD5', borderRadius: '4px' }}>
                          📊 Every other week: <strong>{selectedDays.length}</strong> day{selectedDays.length !== 1 ? 's' : ''} — {selectedDays.map(d => ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][d]).join(', ')}
                          <div style={{ fontSize: '0.78rem', marginTop: '0.25rem', color: '#B45309' }}>Starts this week, skips next week, repeats</div>
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {/* Client Selection */}
                <div style={{ marginBottom: '1.25rem' }}>
                  <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: '600' }}>Client *</label>
                  <select value={formData.clientId} onChange={(e) => setFormData(prev => ({ ...prev, clientId: e.target.value }))} required
                    style={{ width: '100%', padding: '0.75rem', borderRadius: '8px', border: '2px solid #e5e7eb', fontSize: '1rem' }}>
                    <option value="">Select client...</option>
                    {clients.map(c => <option key={c.id} value={c.id}>{c.first_name} {c.last_name}{c.service_type ? ` (${c.service_type.replace(/_/g, ' ')})` : ''}</option>)}
                  </select>
                </div>

                {/* Quick Shift Presets */}
                <div style={{ marginBottom: '1.25rem' }}>
                  <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: '600' }}>Quick Shift Presets</label>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem' }}>
                    {shiftPresets.map((preset, idx) => (
                      <button key={idx} type="button" onClick={() => applyPreset(preset)}
                        style={{ padding: '0.5rem 0.75rem', borderRadius: '20px', border: '1px solid #e5e7eb',
                          background: formData.startTime === preset.start && formData.endTime === preset.end ? '#DBEAFE' : '#fff',
                          color: '#374151', cursor: 'pointer', fontSize: '0.8rem', whiteSpace: 'nowrap' }}>
                        {preset.label}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Time Inputs */}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', marginBottom: '1.25rem' }}>
                  <div>
                    <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: '600' }}>Start Time *</label>
                    <input type="time" value={formData.startTime} onChange={(e) => setFormData(prev => ({ ...prev, startTime: e.target.value }))} required
                      style={{ width: '100%', padding: '0.75rem', borderRadius: '8px', border: '2px solid #e5e7eb', fontSize: '1rem' }} />
                  </div>
                  <div>
                    <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: '600' }}>End Time *</label>
                    <input type="time" value={formData.endTime} onChange={(e) => setFormData(prev => ({ ...prev, endTime: e.target.value }))} required
                      style={{ width: '100%', padding: '0.75rem', borderRadius: '8px', border: '2px solid #e5e7eb', fontSize: '1rem' }} />
                  </div>
                </div>

                {/* Duration Display */}
                <div style={{ marginBottom: '1.25rem', padding: '0.75rem', background: '#F3F4F6', borderRadius: '8px', textAlign: 'center' }}>
                  <span style={{ fontWeight: '600' }}>{formatTime(formData.startTime)} - {formatTime(formData.endTime)}</span>
                  <span style={{ color: '#6B7280', marginLeft: '1rem' }}>
                    ({calculateHours(formData.startTime, formData.endTime)} hours{formData.scheduleType === 'multi-day' && selectedDays.length > 0 ? ` × ${selectedDays.length} days/week = ${(calculateHours(formData.startTime, formData.endTime) * selectedDays.length).toFixed(2)} hours/week` : ''}{formData.scheduleType === 'bi-weekly' && selectedDays.length > 0 ? ` × ${selectedDays.length} days/2 weeks = ${(calculateHours(formData.startTime, formData.endTime) * selectedDays.length).toFixed(2)} hrs every other week` : ''})
                  </span>
                </div>

                {/* Notes */}
                <div style={{ marginBottom: '1.25rem' }}>
                  <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: '600' }}>Notes (optional)</label>
                  <textarea value={formData.notes} onChange={(e) => setFormData(prev => ({ ...prev, notes: e.target.value }))}
                    placeholder="Special instructions, client preferences, etc." rows="2"
                    style={{ width: '100%', padding: '0.75rem', borderRadius: '8px', border: '2px solid #e5e7eb', fontSize: '1rem', resize: 'vertical' }} />
                </div>

                {/* Submit */}
                <div style={{ display: 'flex', gap: '0.75rem' }}>
                  <button type="submit" className="btn btn-primary" disabled={saving || ((formData.scheduleType === 'multi-day' || formData.scheduleType === 'bi-weekly') && selectedDays.length === 0)} style={{ flex: 1 }}>
                    {saving ? 'Saving...' : formData.scheduleType === 'multi-day'
                      ? `✓ Create ${selectedDays.length} Weekly Schedule${selectedDays.length !== 1 ? 's' : ''}`
                      : formData.scheduleType === 'bi-weekly'
                      ? `✓ Create ${selectedDays.length} Bi-Weekly Schedule${selectedDays.length !== 1 ? 's' : ''}`
                      : '✓ Create Schedule'}
                  </button>
                  <button type="button" className="btn btn-secondary" onClick={() => { setShowForm(false); setSelectedDays([]); }}>Cancel</button>
                </div>
              </form>
            </div>
          )}

          {/* Existing Schedules Display */}
          {selectedCaregiverId && (
            <div>
              {/* Recurring Schedules */}
              {hasRecurring && (
                <div style={{ marginBottom: '1.5rem' }}>
                  <h3 style={{ margin: '0 0 1rem 0', fontSize: '1rem', color: '#374151', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                    🔄 Recurring Weekly Schedules
                    <span style={{ fontSize: '0.8rem', color: '#6B7280', fontWeight: '400' }}>({calculateTotalHours(caregiverSchedules.filter(s => s.day_of_week !== null && s.day_of_week !== undefined))} hrs/week)</span>
                  </h3>
                  <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : 'repeat(auto-fill, minmax(200px, 1fr))', gap: '0.75rem' }}>
                    {[0,1,2,3,4,5,6].filter(d => recurringByDay[d]).map(dayNum => (
                      <div key={dayNum} className="card" style={{ padding: '0.75rem' }}>
                        <div style={{ fontWeight: '700', marginBottom: '0.5rem', color: '#1E40AF', fontSize: '0.9rem' }}>{getDayName(dayNum)}</div>
                        {recurringByDay[dayNum].map(s => (
                          <div key={s.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0.5rem', marginBottom: '0.35rem', background: '#F3F4F6', borderRadius: '6px', fontSize: '0.85rem', cursor: 'pointer', transition: 'background 0.15s' }}
                            onMouseEnter={(e) => e.currentTarget.style.background = '#E0E7FF'}
                            onMouseLeave={(e) => e.currentTarget.style.background = '#F3F4F6'}
                            onClick={() => openEditModal(s)}>
                            <div>
                              <div style={{ fontWeight: '600' }}>{getClientName(s.client_id)}</div>
                              <div style={{ color: '#6B7280', fontSize: '0.78rem' }}>{formatTime(s.start_time)} - {formatTime(s.end_time)} ({calculateHours(s.start_time, s.end_time)}h)
                                {s.frequency === 'biweekly' && <span style={{ marginLeft: '0.4rem', padding: '0.1rem 0.35rem', background: '#FFEDD5', color: '#C2410C', borderRadius: '4px', fontSize: '0.68rem', fontWeight: '600' }}>Bi-Weekly</span>}
                              </div>
                              {s.notes && <div style={{ fontSize: '0.75rem', color: '#9CA3AF', fontStyle: 'italic', marginTop: '2px' }}>{s.notes}</div>}
                            </div>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                              <span style={{ fontSize: '0.78rem', color: '#6B7280' }} title="Edit">✏️</span>
                              <button onClick={(e) => { e.stopPropagation(); handleDeleteSchedule(s.id); }} style={{ background: 'none', border: 'none', color: '#DC2626', cursor: 'pointer', fontSize: '1rem', padding: '0.25rem' }} title="Delete">🗑</button>
                            </div>
                          </div>
                        ))}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* One-Time Schedules */}
              {hasOneTime && (
                <div style={{ marginBottom: '1.5rem' }}>
                  <h3 style={{ margin: '0 0 1rem 0', fontSize: '1rem', color: '#374151', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                    📅 One-Time Schedules
                  </h3>
                  {Object.keys(oneTimeByDate).sort().map(dateKey => (
                    <div key={dateKey} style={{ marginBottom: '0.75rem' }}>
                      <div style={{ fontWeight: '600', fontSize: '0.85rem', color: '#1E40AF', marginBottom: '0.35rem' }}>
                        {new Date(dateKey + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })}
                      </div>
                      {oneTimeByDate[dateKey].map(s => (
                        <div key={s.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0.5rem 0.75rem', marginBottom: '0.35rem', background: '#F3F4F6', borderRadius: '6px', fontSize: '0.85rem', cursor: 'pointer', transition: 'background 0.15s' }}
                          onMouseEnter={(e) => e.currentTarget.style.background = '#E0E7FF'}
                          onMouseLeave={(e) => e.currentTarget.style.background = '#F3F4F6'}
                          onClick={() => openEditModal(s)}>
                          <div>
                            <span style={{ fontWeight: '600' }}>{getClientName(s.client_id)}</span>
                            <span style={{ color: '#6B7280', marginLeft: '0.75rem' }}>{formatTime(s.start_time)} - {formatTime(s.end_time)} ({calculateHours(s.start_time, s.end_time)}h)</span>
                            {s.notes && <div style={{ fontSize: '0.75rem', color: '#9CA3AF', fontStyle: 'italic', marginTop: '2px' }}>{s.notes}</div>}
                          </div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                            <span style={{ fontSize: '0.78rem', color: '#6B7280' }} title="Edit">✏️</span>
                            <button onClick={(e) => { e.stopPropagation(); handleDeleteSchedule(s.id); }} style={{ background: 'none', border: 'none', color: '#DC2626', cursor: 'pointer', fontSize: '1rem', padding: '0.25rem' }} title="Delete">🗑</button>
                          </div>
                        </div>
                      ))}
                    </div>
                  ))}
                </div>
              )}

              {/* Empty State */}
              {!hasRecurring && !hasOneTime && !showForm && (
                <div className="card" style={{ textAlign: 'center', padding: '2rem', color: '#6B7280' }}>
                  No schedules yet for this caregiver. Click "+ Add Schedule" to create one.
                </div>
              )}
            </div>
          )}
        </div>
        );
      })()}

      {/* ══════════════════════════════════════════ */}
      {/* COVERAGE TAB */}
      {/* ══════════════════════════════════════════ */}
      {activeTab === 'coverage' && (
        <div>
          {/* Week Picker */}
          <div className="card" style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap', marginBottom: '1rem', padding: '1rem' }}>
            <h3 style={{ margin: 0 }}>📈 Coverage Overview</h3>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginLeft: 'auto' }}>
              <button className="btn btn-sm btn-secondary" onClick={() => { const d = new Date(coverageWeekOf + 'T12:00:00'); d.setDate(d.getDate() - 7); setCoverageWeekOf(getWeekStart(d).toISOString().split('T')[0]); }}>◀ Prev</button>
              <input type="date" value={coverageWeekOf} onChange={(e) => setCoverageWeekOf(getWeekStart(new Date(e.target.value + 'T12:00:00')).toISOString().split('T')[0])} style={{ padding: '0.3rem 0.5rem', border: '1px solid #ddd', borderRadius: '6px', fontSize: '0.85rem' }} />
              <button className="btn btn-sm btn-secondary" onClick={() => { const d = new Date(coverageWeekOf + 'T12:00:00'); d.setDate(d.getDate() + 7); setCoverageWeekOf(getWeekStart(d).toISOString().split('T')[0]); }}>Next ▶</button>
              <button className="btn btn-sm btn-primary" onClick={() => setCoverageWeekOf(getWeekStart(new Date()).toISOString().split('T')[0])}>Today</button>
            </div>
            {coverageData && (
              <div style={{ fontSize: '0.82rem', color: '#666', width: '100%' }}>
                Week of {new Date(coverageData.weekStart + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} – {new Date(coverageData.weekEnd + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
              </div>
            )}
          </div>

          {coverageLoading ? (
            <div className="card" style={{ textAlign: 'center', padding: '2rem' }}>Loading coverage data...</div>
          ) : coverageData ? (
            <>
              {/* Summary Cards */}
              <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr 1fr' : 'repeat(4, 1fr)', gap: '0.75rem', marginBottom: '1rem' }}>
                <div className="card" style={s.statCard}><div style={s.statVal('#2563EB')}>{coverageData.summary.totalCaregivers}</div><div style={s.statLabel}>Active Caregivers</div></div>
                <div className="card" style={s.statCard}><div style={s.statVal('#059669')}>{coverageData.summary.totalScheduledHours}h</div><div style={s.statLabel}>Scheduled</div></div>
                <div className="card" style={s.statCard}><div style={s.statVal(coverageData.summary.underScheduledClientCount > 0 ? '#DC2626' : '#059669')}>{coverageData.summary.underScheduledClientCount}</div><div style={s.statLabel}>Under-Scheduled</div></div>
                <div className="card" style={s.statCard}><div style={s.statVal(coverageData.summary.totalShortfallUnits > 0 ? '#DC2626' : '#059669')}>{coverageData.summary.totalShortfallUnits}u</div><div style={s.statLabel}>Shortfall ({coverageData.summary.totalShortfallHours}h)</div></div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr', gap: '1rem' }}>
                {/* Caregiver Hours */}
                <div className="card">
                  <h3 style={{ margin: '0 0 0.75rem' }}>👥 Caregiver Hours</h3>
                  <div style={{ maxHeight: '400px', overflowY: 'auto' }}>
                    {coverageData.caregivers.map(cg => (
                      <div key={cg.id} style={{ padding: '0.6rem', borderBottom: '1px solid #eee', display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                        <div style={{ flex: 1 }}>
                          <div style={{ fontWeight: '600', fontSize: '0.88rem' }}>{cg.name}</div>
                          <div style={{ fontSize: '0.78rem', color: '#666' }}>{parseFloat(cg.scheduledHours || 0).toFixed(1)}h / {cg.maxHours}h</div>
                        </div>
                        <div style={{ width: '90px' }}>
                          <div style={{ height: '7px', background: '#E5E7EB', borderRadius: '4px', overflow: 'hidden' }}>
                            <div style={{ width: `${Math.min(cg.utilizationPercent, 100)}%`, height: '100%', background: cg.utilizationPercent > 100 ? '#DC2626' : cg.utilizationPercent > 80 ? '#F59E0B' : '#10B981' }} />
                          </div>
                        </div>
                        <div style={{ minWidth: '40px', textAlign: 'right', fontWeight: '600', fontSize: '0.82rem', color: cg.utilizationPercent > 100 ? '#DC2626' : cg.utilizationPercent > 80 ? '#F59E0B' : '#10B981' }}>{cg.utilizationPercent}%</div>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Under-Scheduled Clients */}
                <div className="card">
                  <h3 style={{ margin: '0 0 0.75rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                    ⚠️ Under-Scheduled
                    {coverageData.underScheduledClients.length > 0 && <span style={s.badge('#FEE2E2', '#DC2626')}>{coverageData.underScheduledClients.length}</span>}
                  </h3>
                  {coverageData.underScheduledClients.length === 0 ? (
                    <div style={{ textAlign: 'center', padding: '2rem', color: '#059669' }}>✅ All clients fully scheduled!</div>
                  ) : (
                    <div style={{ maxHeight: '400px', overflowY: 'auto' }}>
                      {coverageData.underScheduledClients.map(cl => (
                        <div key={cl.id} style={{ padding: '0.6rem', borderBottom: '1px solid #eee', background: '#FEF2F2' }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <div>
                              <div style={{ fontWeight: '600', fontSize: '0.88rem' }}>{cl.name}</div>
                              <div style={{ fontSize: '0.78rem', color: '#666' }}>{cl.scheduledUnits}/{cl.authorizedUnits} units</div>
                            </div>
                            <span style={s.badge('#DC2626', '#fff')}>-{cl.shortfallUnits}u</span>
                          </div>
                          <div style={{ height: '5px', background: '#FECACA', borderRadius: '3px', overflow: 'hidden', marginTop: '0.4rem' }}>
                            <div style={{ width: `${cl.coveragePercent}%`, height: '100%', background: '#DC2626' }} />
                          </div>
                          <div style={{ fontSize: '0.7rem', color: '#666', marginTop: '0.2rem' }}>{cl.coveragePercent}%</div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </>
          ) : <div className="card" style={{ textAlign: 'center', padding: '2rem' }}>Failed to load. <button className="btn btn-sm btn-primary" onClick={loadCoverage}>Retry</button></div>}
        </div>
      )}

      {/* ══════════════════════════════════════════ */}
      {/* OPEN SHIFTS TAB */}
      {/* ══════════════════════════════════════════ */}
      {activeTab === 'open-shifts' && (
        <div>
          <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center', flexWrap: 'wrap', marginBottom: '1rem' }}>
            <select value={openShiftFilter} onChange={(e) => setOpenShiftFilter(e.target.value)}
              style={{ padding: '0.4rem 0.75rem', borderRadius: '6px', border: '1px solid #ddd' }}>
              <option value="open">Open</option>
              <option value="claimed">Claimed</option>
              <option value="filled">Filled</option>
              <option value="">All</option>
            </select>
            <button className="btn btn-primary btn-sm" onClick={() => setShowCreateShift(true)}>+ Post Open Shift</button>
          </div>

          {openShiftsLoading ? (
            <div className="card" style={{ textAlign: 'center', padding: '2rem' }}>Loading...</div>
          ) : openShifts.length === 0 ? (
            <div className="card" style={{ textAlign: 'center', padding: '2rem', color: '#6B7280' }}>
              <div style={{ fontSize: '2rem', marginBottom: '0.5rem' }}>✅</div>
              No {openShiftFilter || ''} open shifts
            </div>
          ) : (
            <div style={{ display: 'grid', gap: '0.75rem' }}>
              {openShifts.map(shift => (
                <div key={shift.id} className="card" style={{ padding: '1rem' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '0.5rem' }}>
                    <div>
                      <strong>{shift.client_first || ''} {shift.client_last || ''}</strong>
                      <div style={{ fontSize: '0.85rem', color: '#666' }}>
                        {shift.shift_date ? new Date(shift.shift_date).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }) : ''} · {formatTime(shift.start_time)} - {formatTime(shift.end_time)}
                      </div>
                      {shift.notes && <div style={{ fontSize: '0.82rem', color: '#888', marginTop: '0.3rem' }}>{shift.notes}</div>}
                    </div>
                    <div style={{ display: 'flex', gap: '0.4rem', alignItems: 'center' }}>
                      <span style={s.badge(shift.status === 'open' ? '#FEF3C7' : shift.status === 'claimed' ? '#DBEAFE' : '#D1FAE5', shift.status === 'open' ? '#D97706' : shift.status === 'claimed' ? '#2563EB' : '#059669')}>
                        {shift.status?.toUpperCase()}
                      </span>
                      {shift.urgency === 'urgent' && <span style={s.badge('#FEE2E2', '#DC2626')}>URGENT</span>}
                      {(shift.claim_count > 0 || shift.claims_count > 0) && (
                        <button className="btn btn-sm btn-secondary" onClick={() => loadShiftClaims(shift)}>
                          {shift.claim_count || shift.claims_count} claim(s)
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Create Open Shift Modal */}
          {showCreateShift && (
            <div className="modal active" onClick={() => setShowCreateShift(false)}>
              <div className="modal-content" onClick={(e) => e.stopPropagation()} style={{ maxWidth: '500px' }}>
                <div className="modal-header"><h2>Post Open Shift</h2><button className="close-btn" onClick={() => setShowCreateShift(false)}>×</button></div>
                <form onSubmit={(e) => { e.preventDefault(); const fd = new FormData(e.target); createOpenShift({ clientId: fd.get('clientId'), shiftDate: fd.get('date'), startTime: fd.get('start'), endTime: fd.get('end'), urgency: fd.get('urgency'), notes: fd.get('notes'), careTypeId: fd.get('careType') || null }); }}>
                  <div className="form-group"><label>Client *</label><select name="clientId" required><option value="">Select...</option>{clients.map(c => <option key={c.id} value={c.id}>{c.first_name} {c.last_name}</option>)}</select></div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '0.5rem' }}>
                    <div className="form-group"><label>Date *</label><input type="date" name="date" required /></div>
                    <div className="form-group"><label>Start *</label><input type="time" name="start" defaultValue="09:00" required /></div>
                    <div className="form-group"><label>End *</label><input type="time" name="end" defaultValue="13:00" required /></div>
                  </div>
                  <div className="form-group"><label>Urgency</label><select name="urgency"><option value="normal">Normal</option><option value="urgent">Urgent</option></select></div>
                  <div className="form-group"><label>Notes</label><textarea name="notes" rows="2" /></div>
                  <div className="modal-actions"><button type="submit" className="btn btn-primary">Post Shift</button><button type="button" className="btn btn-secondary" onClick={() => setShowCreateShift(false)}>Cancel</button></div>
                </form>
              </div>
            </div>
          )}

          {/* Claims Modal */}
          {currentShift && (
            <div className="modal active" onClick={() => setCurrentShift(null)}>
              <div className="modal-content" onClick={(e) => e.stopPropagation()} style={{ maxWidth: '500px' }}>
                <div className="modal-header"><h2>Claims for Shift</h2><button className="close-btn" onClick={() => setCurrentShift(null)}>×</button></div>
                {shiftClaims.length === 0 ? <p style={{ padding: '1rem', color: '#666' }}>No claims yet.</p> : (
                  <div style={{ padding: '1rem' }}>
                    {shiftClaims.map(cl => (
                      <div key={cl.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0.75rem', borderBottom: '1px solid #eee' }}>
                        <div>
                          <strong>{cl.caregiver_first} {cl.caregiver_last}</strong>
                          {cl.notes && <div style={{ fontSize: '0.82rem', color: '#666' }}>{cl.notes}</div>}
                        </div>
                        {cl.status === 'pending' && <button className="btn btn-sm btn-success" onClick={() => approveShiftClaim(currentShift.id, cl.id)}>✓ Approve</button>}
                        {cl.status === 'approved' && <span style={s.badge('#D1FAE5', '#059669')}>APPROVED</span>}
                      </div>
                    ))}
                  </div>
                )}
                <div className="modal-actions" style={{ padding: '1rem' }}><button className="btn btn-secondary" onClick={() => setCurrentShift(null)}>Close</button></div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ══════════════════════════════════════════ */}
      {/* STAFFING TAB (Swaps + Absences) */}
      {/* ══════════════════════════════════════════ */}
      {activeTab === 'staffing' && (
        <div>
          {/* Sub-tabs */}
          <div style={{ display: 'flex', gap: '1rem', marginBottom: '1rem' }}>
            <h3 style={{ margin: 0 }}>🔄 Shift Swaps</h3>
            <div style={{ marginLeft: 'auto', display: 'flex', gap: '0.4rem' }}>
              {['', 'pending', 'accepted', 'approved', 'rejected'].map(f => (
                <button key={f} className={`btn btn-sm ${swapFilter === f ? 'btn-primary' : 'btn-secondary'}`}
                  onClick={() => setSwapFilter(f)}>{f ? f.charAt(0).toUpperCase() + f.slice(1) : 'All'}</button>
              ))}
            </div>
          </div>

          {swapsLoading ? <div className="card" style={{ textAlign: 'center', padding: '1.5rem' }}>Loading...</div> : swaps.length === 0 ? (
            <div className="card" style={{ textAlign: 'center', padding: '1.5rem', color: '#6B7280' }}>No swap requests found</div>
          ) : (
            <div className="card" style={{ overflowX: 'auto', marginBottom: '1.5rem' }}>
              <table className="table" style={{ fontSize: '0.88rem' }}>
                <thead><tr><th>Date</th><th>Time</th><th>Client</th><th>From</th><th>→</th><th>To</th><th>Status</th><th>Actions</th></tr></thead>
                <tbody>
                  {swaps.map(sw => (
                    <tr key={sw.id}>
                      <td><strong>{sw.shift_date ? new Date(sw.shift_date).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }) : ''}</strong></td>
                      <td>{sw.start_time?.slice(0,5)}-{sw.end_time?.slice(0,5)}</td>
                      <td>{sw.client_first} {sw.client_last}</td>
                      <td><strong>{sw.requester_first} {sw.requester_last}</strong></td>
                      <td>→</td>
                      <td>{sw.target_first ? <strong>{sw.target_first} {sw.target_last}</strong> : <em style={{ color: '#666' }}>Open</em>}</td>
                      <td><span style={s.badge(
                        sw.status === 'pending' ? '#FEF3C7' : sw.status === 'accepted' ? '#DBEAFE' : sw.status === 'approved' ? '#D1FAE5' : '#FEE2E2',
                        sw.status === 'pending' ? '#D97706' : sw.status === 'accepted' ? '#2563EB' : sw.status === 'approved' ? '#059669' : '#DC2626'
                      )}>{sw.status?.toUpperCase()}</span></td>
                      <td>
                        {sw.status === 'accepted' && (
                          <div style={{ display: 'flex', gap: '0.25rem' }}>
                            <button className="btn btn-sm btn-success" onClick={() => approveSwap(sw.id)}>✓</button>
                            <button className="btn btn-sm btn-danger" onClick={() => rejectSwap(sw.id)}>✗</button>
                          </div>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* Absences Section */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
            <h3 style={{ margin: 0 }}>📋 Absences</h3>
            <button className="btn btn-primary btn-sm" onClick={() => setShowAbsenceForm(!showAbsenceForm)}>{showAbsenceForm ? '✕ Cancel' : '+ Record'}</button>
          </div>

          {showAbsenceForm && (
            <div className="card" style={{ marginBottom: '1rem' }}>
              <form onSubmit={recordAbsence}>
                <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr 1fr', gap: '0.75rem' }}>
                  <div className="form-group">
                    <label>Caregiver *</label>
                    <select value={absenceForm.caregiverId} onChange={(e) => setAbsenceForm({ ...absenceForm, caregiverId: e.target.value })} required>
                      <option value="">Select...</option>
                      {caregivers.map(cg => <option key={cg.id} value={cg.id}>{cg.first_name} {cg.last_name}</option>)}
                    </select>
                  </div>
                  <div className="form-group"><label>Date *</label><input type="date" value={absenceForm.date} onChange={(e) => setAbsenceForm({ ...absenceForm, date: e.target.value })} required /></div>
                  <div className="form-group">
                    <label>Type</label>
                    <select value={absenceForm.type} onChange={(e) => setAbsenceForm({ ...absenceForm, type: e.target.value })}>
                      <option value="call_out">Call Out</option><option value="no_show">No Show</option><option value="sick">Sick</option><option value="personal">Personal</option>
                    </select>
                  </div>
                </div>
                <div className="form-group"><label>Reason</label><textarea value={absenceForm.reason} onChange={(e) => setAbsenceForm({ ...absenceForm, reason: e.target.value })} rows="2" /></div>
                <button type="submit" className="btn btn-primary btn-sm">Record Absence</button>
              </form>
            </div>
          )}

          {absencesLoading ? <div className="card" style={{ textAlign: 'center', padding: '1.5rem' }}>Loading...</div> : absences.length === 0 ? (
            <div className="card" style={{ textAlign: 'center', padding: '1.5rem', color: '#6B7280' }}>No absences recorded</div>
          ) : (
            <div className="card" style={{ overflowX: 'auto' }}>
              <table className="table" style={{ fontSize: '0.88rem' }}>
                <thead><tr><th>Caregiver</th><th>Date</th><th>Type</th><th>Reason</th><th>Actions</th></tr></thead>
                <tbody>
                  {absences.map(ab => (
                    <tr key={ab.id}>
                      <td><strong>{getCaregiverName(ab.caregiver_id)}</strong></td>
                      <td>{new Date(ab.date).toLocaleDateString()}</td>
                      <td><span style={s.badge(ab.type === 'no_show' ? '#FEE2E2' : ab.type === 'sick' ? '#DBEAFE' : '#FEF3C7', ab.type === 'no_show' ? '#DC2626' : ab.type === 'sick' ? '#2563EB' : '#D97706')}>
                        {ab.type?.replace('_', ' ').toUpperCase()}
                      </span></td>
                      <td>{ab.reason || '—'}</td>
                      <td><button className="btn btn-sm btn-danger" onClick={() => deleteAbsence(ab.id)}>Delete</button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* ══════════════════════════════════════════ */}
      {/* AVAILABILITY TAB */}
      {/* ══════════════════════════════════════════ */}
      {activeTab === 'availability' && (
        <div>
          <div className="card" style={{ marginBottom: '1rem' }}>
            <h3 style={{ margin: '0 0 0.75rem' }}>Caregiver Availability</h3>
            <select value={availCaregiver} onChange={(e) => loadAvailability(e.target.value)}
              style={{ width: '100%', padding: '0.6rem', fontSize: '0.95rem', borderRadius: '6px', border: '1px solid #ddd' }}>
              <option value="">Select a caregiver...</option>
              {caregivers.map(cg => <option key={cg.id} value={cg.id}>{cg.first_name} {cg.last_name}</option>)}
            </select>
          </div>

          {availCaregiver && (
            <>
              {/* Status & Max Hours */}
              <div className="card" style={{ marginBottom: '1rem' }}>
                <h3 style={{ margin: '0 0 0.75rem' }}>Status & Capacity</h3>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
                  <div className="form-group">
                    <label>Status</label>
                    <select value={availForm.status} onChange={(e) => setAvailForm({ ...availForm, status: e.target.value })}>
                      <option value="available">Available</option><option value="on_call">On-Call</option>
                      <option value="medical_leave">Medical Leave</option><option value="vacation">Vacation</option>
                      <option value="unavailable">Unavailable</option>
                    </select>
                  </div>
                  <div className="form-group">
                    <label>Max Hours/Week</label>
                    <input type="number" value={availForm.maxHoursPerWeek} onChange={(e) => setAvailForm({ ...availForm, maxHoursPerWeek: parseInt(e.target.value) })} min="0" step="5" />
                  </div>
                </div>
              </div>

              {/* Weekly Grid */}
              <div className="card" style={{ marginBottom: '1rem' }}>
                <h3 style={{ margin: '0 0 0.75rem' }}>Weekly Schedule</h3>
                <div style={{ display: 'grid', gap: '0.5rem' }}>
                  {daysOfWeek.map(day => {
                    const avKey = `${day.key}Available`;
                    const stKey = `${day.key}StartTime`;
                    const enKey = `${day.key}EndTime`;
                    return (
                      <div key={day.key} style={{ padding: '0.6rem 0.75rem', background: availForm[avKey] ? '#f0fdf4' : '#fafafa', borderRadius: '6px', border: `1px solid ${availForm[avKey] ? '#bbf7d0' : '#e5e7eb'}` }}>
                        <label style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', cursor: 'pointer', marginBottom: availForm[avKey] ? '0.5rem' : 0 }}>
                          <input type="checkbox" checked={availForm[avKey]} onChange={(e) => setAvailForm({ ...availForm, [avKey]: e.target.checked })} style={{ width: 'auto' }} />
                          <strong style={{ minWidth: '40px' }}>{day.label}</strong>
                          {!availForm[avKey] && <span style={{ fontSize: '0.82rem', color: '#999' }}>Off</span>}
                        </label>
                        {availForm[avKey] && (
                          <div style={{ display: 'flex', gap: '0.5rem', marginLeft: '2rem' }}>
                            <input type="time" value={availForm[stKey]} onChange={(e) => setAvailForm({ ...availForm, [stKey]: e.target.value })} style={{ padding: '0.3rem', borderRadius: '4px', border: '1px solid #ddd' }} />
                            <span style={{ alignSelf: 'center' }}>to</span>
                            <input type="time" value={availForm[enKey]} onChange={(e) => setAvailForm({ ...availForm, [enKey]: e.target.value })} style={{ padding: '0.3rem', borderRadius: '4px', border: '1px solid #ddd' }} />
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
                <button className="btn btn-primary" onClick={saveAvailability} style={{ marginTop: '1rem' }}>Save Availability</button>
              </div>

              {/* Blackout Dates */}
              <div className="card">
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
                  <h3 style={{ margin: 0 }}>🚫 Blackout Dates</h3>
                  <button className="btn btn-sm btn-primary" onClick={() => setShowBlackoutForm(!showBlackoutForm)}>{showBlackoutForm ? 'Cancel' : '+ Add'}</button>
                </div>

                {showBlackoutForm && (
                  <form onSubmit={addBlackout} style={{ marginBottom: '1rem', paddingBottom: '1rem', borderBottom: '1px solid #eee' }}>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem' }}>
                      <div className="form-group"><label>Start *</label><input type="date" value={newBlackout.startDate} onChange={(e) => setNewBlackout({ ...newBlackout, startDate: e.target.value })} required /></div>
                      <div className="form-group"><label>End *</label><input type="date" value={newBlackout.endDate} onChange={(e) => setNewBlackout({ ...newBlackout, endDate: e.target.value })} required /></div>
                    </div>
                    <div className="form-group"><label>Reason</label><input type="text" value={newBlackout.reason} onChange={(e) => setNewBlackout({ ...newBlackout, reason: e.target.value })} placeholder="e.g., Vacation" /></div>
                    <button type="submit" className="btn btn-primary btn-sm">Add Blackout</button>
                  </form>
                )}

                {blackoutDates.length === 0 ? (
                  <p style={{ color: '#999', textAlign: 'center', padding: '0.75rem' }}>No blackout dates</p>
                ) : (
                  <div style={{ display: 'grid', gap: '0.5rem' }}>
                    {blackoutDates.sort((a, b) => new Date(a.start_date) - new Date(b.start_date)).map(bd => (
                      <div key={bd.id} style={{ padding: '0.6rem 0.75rem', background: '#FEF2F2', borderLeft: '3px solid #DC2626', borderRadius: '4px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <div>
                          <strong style={{ fontSize: '0.88rem' }}>{new Date(bd.start_date).toLocaleDateString()} - {new Date(bd.end_date).toLocaleDateString()}</strong>
                          {bd.reason && <div style={{ fontSize: '0.82rem', color: '#666' }}>{bd.reason}</div>}
                        </div>
                        <button className="btn btn-sm btn-danger" onClick={() => deleteBlackout(bd.id)}>Delete</button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      )}
    </div>

    {/* ══════════════════════════════════════════ */}
    {/* EDIT SCHEDULE MODAL */}
    {/* ══════════════════════════════════════════ */}
    {editModal && (
      <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.5)', zIndex: 2000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1rem' }}
        onClick={() => setEditModal(null)}>
        <div style={{ background: '#fff', borderRadius: '12px', padding: '1.5rem', maxWidth: '480px', width: '100%', maxHeight: '90vh', overflowY: 'auto', boxShadow: '0 20px 60px rgba(0,0,0,0.3)' }}
          onClick={(e) => e.stopPropagation()}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.25rem' }}>
            <h3 style={{ margin: 0, color: '#1E40AF' }}>✏️ Edit Schedule</h3>
            <button onClick={() => setEditModal(null)} style={{ background: 'none', border: 'none', fontSize: '1.25rem', cursor: 'pointer', color: '#6B7280' }}>✕</button>
          </div>

          {/* Schedule Type Display + Frequency Toggle */}
          <div style={{ marginBottom: '1.25rem', padding: '0.5rem 0.75rem', background: '#EFF6FF', borderRadius: '6px', fontSize: '0.85rem', color: '#1E40AF', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span>{editModal.scheduleType === 'recurring' ? '🔄 Recurring' : '📅 One-Time'} Schedule</span>
            {editModal.scheduleType === 'recurring' && (
              <div style={{ display: 'flex', gap: '0.3rem' }}>
                <button type="button" onClick={() => setEditModal(prev => ({ ...prev, frequency: 'weekly' }))}
                  style={{ padding: '0.2rem 0.5rem', borderRadius: '4px', border: 'none', fontSize: '0.78rem', fontWeight: '600', cursor: 'pointer',
                    background: editModal.frequency === 'weekly' ? '#3B82F6' : '#E5E7EB', color: editModal.frequency === 'weekly' ? '#fff' : '#374151' }}>Weekly</button>
                <button type="button" onClick={() => setEditModal(prev => ({ ...prev, frequency: 'biweekly' }))}
                  style={{ padding: '0.2rem 0.5rem', borderRadius: '4px', border: 'none', fontSize: '0.78rem', fontWeight: '600', cursor: 'pointer',
                    background: editModal.frequency === 'biweekly' ? '#F97316' : '#E5E7EB', color: editModal.frequency === 'biweekly' ? '#fff' : '#374151' }}>Bi-Weekly</button>
              </div>
            )}
          </div>

          {/* Client */}
          <div style={{ marginBottom: '1rem' }}>
            <label style={{ display: 'block', marginBottom: '0.4rem', fontWeight: '600', fontSize: '0.9rem' }}>Client</label>
            <select value={editModal.clientId} onChange={(e) => setEditModal(prev => ({ ...prev, clientId: e.target.value }))}
              style={{ width: '100%', padding: '0.6rem', borderRadius: '8px', border: '2px solid #e5e7eb', fontSize: '0.95rem' }}>
              {clients.map(c => <option key={c.id} value={c.id}>{c.first_name} {c.last_name}</option>)}
            </select>
          </div>

          {/* Day of Week (recurring) or Date (one-time) */}
          {editModal.scheduleType === 'recurring' ? (
            <div style={{ marginBottom: '1rem' }}>
              <label style={{ display: 'block', marginBottom: '0.4rem', fontWeight: '600', fontSize: '0.9rem' }}>Day of Week</label>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: '0.4rem' }}>
                {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((day, idx) => (
                  <button key={day} type="button" onClick={() => setEditModal(prev => ({ ...prev, dayOfWeek: idx.toString() }))}
                    style={{ padding: '0.5rem 0.2rem', borderRadius: '6px',
                      border: editModal.dayOfWeek === idx.toString() ? '2px solid #3B82F6' : '2px solid #E5E7EB',
                      background: editModal.dayOfWeek === idx.toString() ? '#3B82F6' : '#fff',
                      color: editModal.dayOfWeek === idx.toString() ? '#fff' : '#374151',
                      cursor: 'pointer', fontWeight: '600', fontSize: '0.8rem' }}>
                    {day}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <div style={{ marginBottom: '1rem' }}>
              <label style={{ display: 'block', marginBottom: '0.4rem', fontWeight: '600', fontSize: '0.9rem' }}>Date</label>
              <input type="date" value={editModal.date} onChange={(e) => setEditModal(prev => ({ ...prev, date: e.target.value }))}
                style={{ width: '100%', padding: '0.6rem', borderRadius: '8px', border: '2px solid #e5e7eb', fontSize: '0.95rem' }} />
            </div>
          )}

          {/* Quick Presets */}
          <div style={{ marginBottom: '1rem' }}>
            <label style={{ display: 'block', marginBottom: '0.4rem', fontWeight: '600', fontSize: '0.9rem' }}>Quick Presets</label>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.4rem' }}>
              {shiftPresets.map((p, i) => (
                <button key={i} type="button" onClick={() => setEditModal(prev => ({ ...prev, startTime: p.start, endTime: p.end }))}
                  style={{ padding: '0.35rem 0.6rem', borderRadius: '16px', border: '1px solid #e5e7eb',
                    background: editModal.startTime === p.start && editModal.endTime === p.end ? '#DBEAFE' : '#fff',
                    color: '#374151', cursor: 'pointer', fontSize: '0.78rem', whiteSpace: 'nowrap' }}>
                  {p.label}
                </button>
              ))}
            </div>
          </div>

          {/* Times */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem', marginBottom: '1rem' }}>
            <div>
              <label style={{ display: 'block', marginBottom: '0.4rem', fontWeight: '600', fontSize: '0.9rem' }}>Start Time</label>
              <input type="time" value={editModal.startTime} onChange={(e) => setEditModal(prev => ({ ...prev, startTime: e.target.value }))}
                style={{ width: '100%', padding: '0.6rem', borderRadius: '8px', border: '2px solid #e5e7eb', fontSize: '0.95rem' }} />
            </div>
            <div>
              <label style={{ display: 'block', marginBottom: '0.4rem', fontWeight: '600', fontSize: '0.9rem' }}>End Time</label>
              <input type="time" value={editModal.endTime} onChange={(e) => setEditModal(prev => ({ ...prev, endTime: e.target.value }))}
                style={{ width: '100%', padding: '0.6rem', borderRadius: '8px', border: '2px solid #e5e7eb', fontSize: '0.95rem' }} />
            </div>
          </div>

          {/* Duration */}
          <div style={{ marginBottom: '1rem', padding: '0.5rem', background: '#F3F4F6', borderRadius: '6px', textAlign: 'center', fontSize: '0.9rem' }}>
            <span style={{ fontWeight: '600' }}>{formatTime(editModal.startTime)} - {formatTime(editModal.endTime)}</span>
            <span style={{ color: '#6B7280', marginLeft: '0.75rem' }}>({calculateHours(editModal.startTime, editModal.endTime)} hours)</span>
          </div>

          {/* Notes */}
          <div style={{ marginBottom: '1.25rem' }}>
            <label style={{ display: 'block', marginBottom: '0.4rem', fontWeight: '600', fontSize: '0.9rem' }}>Notes</label>
            <textarea value={editModal.notes} onChange={(e) => setEditModal(prev => ({ ...prev, notes: e.target.value }))}
              placeholder="Optional notes..." rows="2"
              style={{ width: '100%', padding: '0.6rem', borderRadius: '8px', border: '2px solid #e5e7eb', fontSize: '0.95rem', resize: 'vertical' }} />
          </div>

          {/* Actions */}
          <div style={{ display: 'flex', gap: '0.75rem' }}>
            <button onClick={handleSaveEdit} disabled={editSaving} className="btn btn-primary" style={{ flex: 1 }}>
              {editSaving ? 'Saving...' : '✓ Save Changes'}
            </button>
            <button onClick={() => setEditModal(null)} className="btn btn-secondary">Cancel</button>
          </div>
        </div>
      </div>
    )}
  </>
  );
};

export default SchedulingHub;
