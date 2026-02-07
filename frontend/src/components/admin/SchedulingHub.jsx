// src/components/admin/SchedulingHub.jsx
// Unified scheduling hub - consolidates all scheduling features into one page
import React, { useState, useEffect, useCallback } from 'react';
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

  // ── Create Schedule state ──
  const [selectedClient, setSelectedClient] = useState('');
  const [selectedDate, setSelectedDate] = useState(new Date().toISOString().split('T')[0]);
  const [startTime, setStartTime] = useState('09:00');
  const [endTime, setEndTime] = useState('13:00');
  const [notes, setNotes] = useState('');
  const [suggestions, setSuggestions] = useState([]);
  const [suggestionsLoading, setSuggestionsLoading] = useState(false);
  const [selectedCaregiver, setSelectedCaregiver] = useState(null);
  const [conflicts, setConflicts] = useState([]);
  const [saving, setSaving] = useState(false);
  const [multiDayMode, setMultiDayMode] = useState(false);
  const [selectedDays, setSelectedDays] = useState([]);
  const [showRecurring, setShowRecurring] = useState(false);
  const [recurringTemplate, setRecurringTemplate] = useState([]);
  const [recurringWeeks, setRecurringWeeks] = useState(4);

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
  }, [activeTab]);

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
      const [cg, cl, ct] = await Promise.all([
        api('/api/caregivers'),
        api('/api/clients'),
        api('/api/care-types').catch(() => [])
      ]);
      setCaregivers(Array.isArray(cg) ? cg : []);
      setClients(Array.isArray(cl) ? cl : []);
      setCareTypes(Array.isArray(ct) ? ct : []);
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
      const data = await api('/api/schedules-all');
      setCalSchedules(Array.isArray(data) ? data : []);
    } catch (e) { console.error(e); }
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
    const d = new Date(weekOf);
    d.setDate(d.getDate() + dir * 7);
    setWeekOf(d.toISOString().split('T')[0]);
  };

  const shiftPresets = [
    { label: 'Morning', start: '08:00', end: '12:00' },
    { label: 'Afternoon', start: '12:00', end: '16:00' },
    { label: 'Evening', start: '16:00', end: '20:00' },
    { label: 'Full Day', start: '08:00', end: '16:00' },
  ];

  // ═══════════════════════════════════════════════
  // CREATE SCHEDULE LOGIC
  // ═══════════════════════════════════════════════

  const fetchSuggestions = useCallback(async () => {
    if (!selectedClient) { setSuggestions([]); return; }
    setSuggestionsLoading(true);
    try {
      const params = new URLSearchParams({ clientId: selectedClient, date: selectedDate, startTime, endTime });
      const data = await api(`/api/scheduling/suggest-caregivers?${params}`);
      setSuggestions(data.suggestions || []);
    } catch (e) { console.error(e); }
    finally { setSuggestionsLoading(false); }
  }, [selectedClient, selectedDate, startTime, endTime]);

  useEffect(() => {
    if (activeTab !== 'create') return;
    const timer = setTimeout(fetchSuggestions, 300);
    return () => clearTimeout(timer);
  }, [fetchSuggestions, activeTab]);

  const checkConflicts = async (caregiverId) => {
    if (!caregiverId) { setConflicts([]); return; }
    try {
      const data = await api('/api/scheduling/check-conflicts', {
        method: 'POST',
        body: JSON.stringify({ caregiverId, date: selectedDate, startTime, endTime })
      });
      setConflicts(data.conflicts || []);
    } catch (e) { console.error(e); }
  };

  const handleCaregiverSelect = (cg) => { setSelectedCaregiver(cg); checkConflicts(cg.id); };

  const toggleDaySelection = (idx) => {
    setSelectedDays(prev => prev.includes(idx) ? prev.filter(d => d !== idx) : [...prev, idx].sort((a, b) => a - b));
  };

  const getMultiDayDates = () => {
    const base = new Date(selectedDate);
    const sow = new Date(base);
    sow.setDate(base.getDate() - base.getDay());
    return selectedDays.map(di => {
      const d = new Date(sow);
      d.setDate(sow.getDate() + di);
      return d.toISOString().split('T')[0];
    }).filter(d => d >= new Date().toISOString().split('T')[0]);
  };

  const toggleRecurringDay = (dow) => {
    const exists = recurringTemplate.find(t => t.dayOfWeek === dow);
    if (exists) setRecurringTemplate(recurringTemplate.filter(t => t.dayOfWeek !== dow));
    else setRecurringTemplate([...recurringTemplate, { dayOfWeek: dow, startTime, endTime }]);
  };

  const handleCreateSchedule = async () => {
    if (!selectedClient || !selectedCaregiver) { showMsg('Select client and caregiver', 'error'); return; }
    if (conflicts.length > 0 && !window.confirm('This conflicts with existing shifts. Create anyway?')) return;
    setSaving(true);
    try {
      if (multiDayMode) {
        const dates = getMultiDayDates();
        let created = 0;
        for (const date of dates) {
          try {
            await api('/api/schedules', { method: 'POST', body: JSON.stringify({ caregiverId: selectedCaregiver.id, clientId: selectedClient, scheduleType: 'one-time', date, startTime, endTime, notes }) });
            created++;
          } catch {}
        }
        showMsg(`Created ${created} schedule${created !== 1 ? 's' : ''}!`);
      } else if (showRecurring) {
        const data = await api('/api/scheduling/bulk-create', {
          method: 'POST',
          body: JSON.stringify({ caregiverId: selectedCaregiver.id, clientId: selectedClient, template: recurringTemplate, weeks: recurringWeeks, startDate: selectedDate, notes })
        });
        showMsg(`Created ${data.created} schedules!${data.skippedConflicts > 0 ? ` (${data.skippedConflicts} skipped)` : ''}`);
        setRecurringTemplate([]); setShowRecurring(false);
      } else {
        await api('/api/schedules', { method: 'POST', body: JSON.stringify({ caregiverId: selectedCaregiver.id, clientId: selectedClient, scheduleType: 'one-time', date: selectedDate, startTime, endTime, notes }) });
        showMsg('Schedule created!');
      }
      setSelectedCaregiver(null); setNotes(''); setSelectedDays([]); setMultiDayMode(false);
      fetchSuggestions();
    } catch (e) { showMsg('Error: ' + e.message, 'error'); }
    finally { setSaving(false); }
  };

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
      if (s.day_of_week !== null && s.day_of_week !== undefined) return s.day_of_week === dow;
      return false;
    });
    if (calFilterCaregiver) filtered = filtered.filter(s => s.caregiver_id === calFilterCaregiver);
    return filtered.sort((a, b) => (a.start_time || '').localeCompare(b.start_time || ''));
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
            <select value={calFilterCaregiver} onChange={(e) => setCalFilterCaregiver(e.target.value)}
              style={{ padding: '0.4rem', borderRadius: '6px', border: '1px solid #ddd', fontSize: '0.88rem' }}>
              <option value="">All Caregivers</option>
              {caregivers.map(cg => <option key={cg.id} value={cg.id}>{cg.first_name} {cg.last_name}</option>)}
            </select>
          </div>

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
                return (
                  <div key={day} onClick={() => { setCalDaySchedules(dayScheds); setCalSelectedDay(day); }}
                    style={{ background: isToday ? '#EFF6FF' : '#fff', minHeight: isMobile ? '50px' : '80px', padding: '0.25rem', cursor: 'pointer', position: 'relative' }}>
                    <div style={{ fontSize: '0.78rem', fontWeight: isToday ? '700' : '400', color: isToday ? '#2563EB' : '#374151', marginBottom: '0.2rem' }}>{day}</div>
                    {dayScheds.slice(0, isMobile ? 1 : 3).map((sc, idx) => (
                      <div key={idx} style={{ fontSize: '0.62rem', padding: '0.1rem 0.2rem', marginBottom: '1px', borderRadius: '2px',
                        background: cgColor(sc.caregiver_id) + '20', borderLeft: `2px solid ${cgColor(sc.caregiver_id)}`,
                        whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {isMobile ? formatTime(sc.start_time) : `${getCaregiverName(sc.caregiver_id).split(' ')[0]} ${formatTime(sc.start_time)}`}
                      </div>
                    ))}
                    {dayScheds.length > (isMobile ? 1 : 3) && (
                      <div style={{ fontSize: '0.6rem', color: '#6B7280', textAlign: 'center' }}>+{dayScheds.length - (isMobile ? 1 : 3)} more</div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {/* Caregiver Legend */}
          <div className="card" style={{ marginTop: '0.75rem' }}>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.75rem' }}>
              {caregivers.map(cg => (
                <div key={cg.id} onClick={() => setCalFilterCaregiver(calFilterCaregiver === cg.id ? '' : cg.id)}
                  style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', cursor: 'pointer', padding: '0.2rem 0.5rem', borderRadius: '6px', background: calFilterCaregiver === cg.id ? '#E5E7EB' : 'transparent' }}>
                  <div style={{ width: '10px', height: '10px', borderRadius: '3px', background: cgColor(cg.id) }} />
                  <span style={{ fontSize: '0.82rem' }}>{cg.first_name} {cg.last_name}</span>
                </div>
              ))}
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
                    <p style={{ margin: 0, fontSize: '0.82rem', color: '#6B7280' }}>{calDaySchedules.length} appointment{calDaySchedules.length !== 1 ? 's' : ''}</p>
                  </div>
                  <button onClick={() => setCalSelectedDay(null)} style={{ background: 'none', border: 'none', fontSize: '1.5rem', cursor: 'pointer', color: '#9CA3AF' }}>×</button>
                </div>
                <div style={{ flex: 1, overflow: 'auto', padding: '1rem' }}>
                  {calDaySchedules.length === 0 ? (
                    <div style={{ textAlign: 'center', padding: '2rem', color: '#6B7280' }}>📅 No appointments</div>
                  ) : calDaySchedules.map((sc, idx) => (
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
                        {sc.day_of_week !== null && <span style={s.badge('#DBEAFE', '#1D4ED8')}>Recurring</span>}
                      </div>
                    </div>
                  ))}
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
      {/* CREATE SCHEDULE TAB */}
      {/* ══════════════════════════════════════════ */}
      {activeTab === 'create' && (
        <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr', gap: '1rem' }}>
          {/* Left: Form */}
          <div className="card">
            <h3 style={{ margin: '0 0 1rem' }}>Schedule Details</h3>

            <div className="form-group">
              <label>Client *</label>
              <select value={selectedClient} onChange={(e) => setSelectedClient(e.target.value)}>
                <option value="">Select client...</option>
                {clients.map(c => <option key={c.id} value={c.id}>{c.first_name} {c.last_name}</option>)}
              </select>
            </div>

            <div className="form-group">
              <label>{multiDayMode ? 'Week Starting' : 'Date'} *</label>
              <input type="date" value={selectedDate} onChange={(e) => setSelectedDate(e.target.value)} min={new Date().toISOString().split('T')[0]} />
            </div>

            <div className="form-group">
              <label>Quick Presets</label>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.4rem' }}>
                {shiftPresets.map(p => (
                  <button key={p.label} type="button" className="btn btn-sm btn-secondary" onClick={() => { setStartTime(p.start); setEndTime(p.end); }}
                    style={{ background: startTime === p.start && endTime === p.end ? '#3B82F6' : undefined, color: startTime === p.start && endTime === p.end ? '#fff' : undefined }}>
                    {p.label}
                  </button>
                ))}
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
              <div className="form-group"><label>Start</label><input type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)} /></div>
              <div className="form-group"><label>End</label><input type="time" value={endTime} onChange={(e) => setEndTime(e.target.value)} /></div>
            </div>

            <div className="form-group"><label>Notes</label><textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows="2" placeholder="Optional notes..." /></div>

            {/* Multi-Day */}
            <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer', marginBottom: '0.5rem' }}>
              <input type="checkbox" checked={multiDayMode} onChange={(e) => { setMultiDayMode(e.target.checked); if (e.target.checked) { setShowRecurring(false); setSelectedDays([]); } }} style={{ width: 'auto' }} />
              Multiple days (same week)
            </label>
            {multiDayMode && (
              <div style={{ background: '#EFF6FF', padding: '0.75rem', borderRadius: '8px', marginBottom: '0.75rem', border: '1px solid #BFDBFE' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.5rem' }}>
                  <strong style={{ fontSize: '0.85rem' }}>Select days:</strong>
                  <button type="button" className="btn btn-sm" onClick={() => setSelectedDays([1,2,3,4,5])} style={{ background: '#3B82F6', color: '#fff', fontSize: '0.72rem' }}>Mon-Fri</button>
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.4rem' }}>
                  {['Sun','Mon','Tue','Wed','Thu','Fri','Sat'].map((d, i) => (
                    <button key={d} type="button" className="btn btn-sm" onClick={() => toggleDaySelection(i)}
                      style={{ background: selectedDays.includes(i) ? '#3B82F6' : '#E5E7EB', color: selectedDays.includes(i) ? '#fff' : '#374151', minWidth: '40px' }}>{d}</button>
                  ))}
                </div>
                {selectedDays.length > 0 && (
                  <div style={{ fontSize: '0.82rem', color: '#1E40AF', marginTop: '0.5rem' }}>📅 {getMultiDayDates().length} schedule(s)</div>
                )}
              </div>
            )}

            {/* Recurring */}
            <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer', marginBottom: '0.5rem' }}>
              <input type="checkbox" checked={showRecurring} onChange={(e) => { setShowRecurring(e.target.checked); if (e.target.checked) { setMultiDayMode(false); setSelectedDays([]); } }} style={{ width: 'auto' }} />
              Recurring (multiple weeks)
            </label>
            {showRecurring && (
              <div style={{ background: '#F3F4F6', padding: '0.75rem', borderRadius: '8px', marginBottom: '0.75rem' }}>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.4rem', marginBottom: '0.75rem' }}>
                  {['Sun','Mon','Tue','Wed','Thu','Fri','Sat'].map((d, i) => (
                    <button key={d} type="button" className="btn btn-sm" onClick={() => toggleRecurringDay(i)}
                      style={{ background: recurringTemplate.some(t => t.dayOfWeek === i) ? '#3B82F6' : '#E5E7EB', color: recurringTemplate.some(t => t.dayOfWeek === i) ? '#fff' : '#374151' }}>{d}</button>
                  ))}
                </div>
                <div className="form-group" style={{ marginBottom: 0 }}>
                  <label>Weeks: {recurringWeeks}</label>
                  <input type="range" min="1" max="12" value={recurringWeeks} onChange={(e) => setRecurringWeeks(parseInt(e.target.value))} style={{ width: '100%' }} />
                </div>
              </div>
            )}
          </div>

          {/* Right: Suggestions */}
          <div className="card">
            <h3 style={{ margin: '0 0 1rem' }}>{suggestionsLoading ? '⏳ Finding matches...' : '✨ Recommended Caregivers'}</h3>
            {!selectedClient ? (
              <p style={{ color: '#6B7280', textAlign: 'center', padding: '2rem' }}>Select a client to see recommendations</p>
            ) : suggestionsLoading ? (
              <div style={{ textAlign: 'center', padding: '2rem' }}><div className="spinner" style={{ margin: '0 auto' }}></div></div>
            ) : suggestions.length === 0 ? (
              <p style={{ color: '#6B7280', textAlign: 'center', padding: '2rem' }}>No available caregivers found</p>
            ) : (
              <div style={{ maxHeight: '500px', overflowY: 'auto' }}>
                {suggestions.map(sg => (
                  <div key={sg.id} onClick={() => handleCaregiverSelect(sg)}
                    style={{ padding: '0.75rem', borderRadius: '8px', marginBottom: '0.5rem', cursor: 'pointer', transition: 'all 0.15s',
                      border: selectedCaregiver?.id === sg.id ? '2px solid #3B82F6' : '1px solid #e5e7eb',
                      background: selectedCaregiver?.id === sg.id ? '#EFF6FF' : '#fff' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <div>
                        <strong>{sg.first_name} {sg.last_name}</strong>
                        <div style={{ fontSize: '0.82rem', color: '#666' }}>
                          {sg.distance ? `${parseFloat(sg.distance).toFixed(1)} mi · ` : ''}{parseFloat(sg.weeklyHours || 0).toFixed(1)}h / {sg.maxHours || 40}h
                        </div>
                      </div>
                      <div style={{ ...s.badge(sg.score >= 80 ? '#D1FAE5' : sg.score >= 50 ? '#FEF3C7' : '#FEE2E2', sg.score >= 80 ? '#059669' : sg.score >= 50 ? '#D97706' : '#DC2626') }}>
                        {sg.score}%
                      </div>
                    </div>
                    {sg.hasConflict && <div style={{ fontSize: '0.78rem', color: '#DC2626', marginTop: '0.3rem' }}>⚠️ Has conflict</div>}
                    {sg.certificationMatch && !sg.certificationMatch.hasAll && (
                      <div style={{ fontSize: '0.78rem', color: '#D97706', marginTop: '0.2rem' }}>Missing: {sg.certificationMatch.missing.join(', ')}</div>
                    )}
                  </div>
                ))}
              </div>
            )}

            {/* Conflicts Warning */}
            {conflicts.length > 0 && (
              <div style={{ margin: '1rem 0', padding: '0.75rem', background: '#FEF2F2', borderRadius: '8px', border: '1px solid #FECACA' }}>
                <strong style={{ color: '#DC2626' }}>⚠️ Scheduling Conflicts</strong>
                {conflicts.map((c, i) => (
                  <div key={i} style={{ fontSize: '0.82rem', marginTop: '0.3rem' }}>
                    {getClientName(c.client_id)} · {formatTime(c.start_time)}-{formatTime(c.end_time)}
                  </div>
                ))}
              </div>
            )}

            {/* Create Button */}
            {selectedCaregiver && (
              <button className="btn btn-primary" onClick={handleCreateSchedule}
                disabled={saving || (multiDayMode && selectedDays.length === 0)} style={{ width: '100%', marginTop: '1rem' }}>
                {saving ? 'Creating...' : multiDayMode ? `Create ${getMultiDayDates().length} schedule(s)` : showRecurring ? `Create ${recurringWeeks} weeks` : `Schedule ${selectedCaregiver.first_name}`}
              </button>
            )}
          </div>
        </div>
      )}

      {/* ══════════════════════════════════════════ */}
      {/* COVERAGE TAB */}
      {/* ══════════════════════════════════════════ */}
      {activeTab === 'coverage' && (
        <div>
          {/* Week Picker */}
          <div className="card" style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap', marginBottom: '1rem', padding: '1rem' }}>
            <h3 style={{ margin: 0 }}>📈 Coverage Overview</h3>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginLeft: 'auto' }}>
              <button className="btn btn-sm btn-secondary" onClick={() => { const d = new Date(coverageWeekOf); d.setDate(d.getDate() - 7); setCoverageWeekOf(getWeekStart(d).toISOString().split('T')[0]); }}>◀ Prev</button>
              <input type="date" value={coverageWeekOf} onChange={(e) => setCoverageWeekOf(getWeekStart(new Date(e.target.value + 'T12:00:00')).toISOString().split('T')[0])} style={{ padding: '0.3rem 0.5rem', border: '1px solid #ddd', borderRadius: '6px', fontSize: '0.85rem' }} />
              <button className="btn btn-sm btn-secondary" onClick={() => { const d = new Date(coverageWeekOf); d.setDate(d.getDate() + 7); setCoverageWeekOf(getWeekStart(d).toISOString().split('T')[0]); }}>Next ▶</button>
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
  );
};

export default SchedulingHub;
