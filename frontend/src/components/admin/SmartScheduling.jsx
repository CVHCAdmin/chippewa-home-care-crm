// src/components/admin/SmartScheduling.jsx
// Professional scheduling with AI-powered suggestions, conflict detection, and drag-and-drop
import React, { useState, useEffect, useCallback } from 'react';
import { API_BASE_URL } from '../../config';
import AutoFillButton from './AutoFillButton';

const SmartScheduling = ({ token }) => {
  // Core state
  const [caregivers, setCaregivers] = useState([]);
  const [clients, setClients] = useState([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('create'); // 'create', 'week', 'coverage', 'availability'
  const [isMobile, setIsMobile] = useState(window.innerWidth < 768);

  // Create schedule state
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

  // Multi-day scheduling (same week, same time, multiple days)
  const [multiDayMode, setMultiDayMode] = useState(false);
  const [selectedDays, setSelectedDays] = useState([]); // [0-6] for Sun-Sat

  // Recurring template state
  const [showRecurring, setShowRecurring] = useState(false);
  const [recurringTemplate, setRecurringTemplate] = useState([]);
  const [recurringWeeks, setRecurringWeeks] = useState(4);

  // Week view state
  const [weekData, setWeekData] = useState(null);
  const [weekOf, setWeekOf] = useState(getWeekStart(new Date()).toISOString().split('T')[0]);
  const [reassignModal, setReassignModal] = useState(null);

  // Availability state
  const [availabilityCaregiver, setAvailabilityCaregiver] = useState('');
  const [availability, setAvailability] = useState({
    status: 'available',
    maxHoursPerWeek: 40,
    weeklyAvailability: {},
    notes: ''
  });

  // Coverage overview state
  const [coverageData, setCoverageData] = useState(null);
  const [coverageLoading, setCoverageLoading] = useState(false);

  // Message state
  const [message, setMessage] = useState({ text: '', type: '' });

  useEffect(() => {
    loadData();
    const handleResize = () => setIsMobile(window.innerWidth < 768);
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  useEffect(() => {
    if (activeTab === 'week') loadWeekView();
    if (activeTab === 'coverage') loadCoverage();
  }, [activeTab, weekOf]);

  const loadData = async () => {
    try {
      const [cgRes, clRes] = await Promise.all([
        fetch(`${API_BASE_URL}/api/caregivers`, { headers: { 'Authorization': `Bearer ${token}` } }),
        fetch(`${API_BASE_URL}/api/clients`, { headers: { 'Authorization': `Bearer ${token}` } })
      ]);
      setCaregivers(await cgRes.json());
      setClients(await clRes.json());
    } catch (error) {
      console.error('Failed to load data:', error);
    } finally {
      setLoading(false);
    }
  };

  const loadWeekView = async () => {
    try {
      const res = await fetch(`${API_BASE_URL}/api/scheduling/week-view?weekOf=${weekOf}`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (res.ok) setWeekData(await res.json());
    } catch (error) {
      console.error('Failed to load week view:', error);
    }
  };

  const loadCoverage = async () => {
    setCoverageLoading(true);
    try {
      const res = await fetch(`${API_BASE_URL}/api/scheduling/coverage-overview`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (res.ok) setCoverageData(await res.json());
    } catch (error) {
      console.error('Failed to load coverage:', error);
    } finally {
      setCoverageLoading(false);
    }
  };

  // Fetch smart suggestions when client/date/time changes
  const fetchSuggestions = useCallback(async () => {
    if (!selectedClient) {
      setSuggestions([]);
      return;
    }

    setSuggestionsLoading(true);
    try {
      const params = new URLSearchParams({
        clientId: selectedClient,
        date: selectedDate,
        startTime,
        endTime
      });
      
      const res = await fetch(`${API_BASE_URL}/api/scheduling/suggest-caregivers?${params}`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      
      if (res.ok) {
        const data = await res.json();
        setSuggestions(data.suggestions || []);
      }
    } catch (error) {
      console.error('Failed to fetch suggestions:', error);
    } finally {
      setSuggestionsLoading(false);
    }
  }, [selectedClient, selectedDate, startTime, endTime, token]);

  useEffect(() => {
    const timer = setTimeout(fetchSuggestions, 300);
    return () => clearTimeout(timer);
  }, [fetchSuggestions]);

  // Check conflicts when caregiver selected
  const checkConflicts = async (caregiverId) => {
    if (!caregiverId) {
      setConflicts([]);
      return;
    }

    try {
      const res = await fetch(`${API_BASE_URL}/api/scheduling/check-conflicts`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          caregiverId,
          date: selectedDate,
          startTime,
          endTime
        })
      });

      if (res.ok) {
        const data = await res.json();
        setConflicts(data.conflicts || []);
      }
    } catch (error) {
      console.error('Failed to check conflicts:', error);
    }
  };

  const handleCaregiverSelect = (caregiver) => {
    setSelectedCaregiver(caregiver);
    checkConflicts(caregiver.id);
  };

  const showMessage = (text, type = 'success') => {
    setMessage({ text, type });
    setTimeout(() => setMessage({ text: '', type: '' }), 4000);
  };

  // Toggle day selection for multi-day mode
  const toggleDaySelection = (dayIndex) => {
    setSelectedDays(prev => 
      prev.includes(dayIndex) 
        ? prev.filter(d => d !== dayIndex)
        : [...prev, dayIndex].sort((a, b) => a - b)
    );
  };

  // Quick select weekdays (Mon-Fri)
  const selectWeekdays = () => {
    setSelectedDays([1, 2, 3, 4, 5]);
  };

  // Get dates for selected days based on the selected start date's week
  const getMultiDayDates = () => {
    const baseDate = new Date(selectedDate);
    const startOfWeek = new Date(baseDate);
    startOfWeek.setDate(baseDate.getDate() - baseDate.getDay());
    
    return selectedDays.map(dayIndex => {
      const date = new Date(startOfWeek);
      date.setDate(startOfWeek.getDate() + dayIndex);
      return date.toISOString().split('T')[0];
    }).filter(date => date >= new Date().toISOString().split('T')[0]); // Filter out past dates
  };

  // Create single schedule
  const handleCreateSchedule = async () => {
    if (!selectedClient || !selectedCaregiver) {
      showMessage('Please select client and caregiver', 'error');
      return;
    }

    if (conflicts.length > 0) {
      if (!window.confirm('This schedule conflicts with existing shifts. Create anyway?')) {
        return;
      }
    }

    setSaving(true);
    try {
      const res = await fetch(`${API_BASE_URL}/api/schedules`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          caregiverId: selectedCaregiver.id,
          clientId: selectedClient,
          scheduleType: 'one-time',
          date: selectedDate,
          startTime,
          endTime,
          notes
        })
      });

      if (!res.ok) throw new Error('Failed to create schedule');

      showMessage('Schedule created successfully!');
      setSelectedCaregiver(null);
      setNotes('');
      fetchSuggestions();
    } catch (error) {
      showMessage('Error: ' + error.message, 'error');
    } finally {
      setSaving(false);
    }
  };

  // Create multi-day schedules (same week, multiple days)
  const handleCreateMultiDay = async () => {
    if (!selectedClient || !selectedCaregiver) {
      showMessage('Please select client and caregiver', 'error');
      return;
    }

    const dates = getMultiDayDates();
    if (dates.length === 0) {
      showMessage('Please select at least one future day', 'error');
      return;
    }

    setSaving(true);
    let created = 0;
    let failed = 0;

    try {
      for (const date of dates) {
        try {
          const res = await fetch(`${API_BASE_URL}/api/schedules`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify({
              caregiverId: selectedCaregiver.id,
              clientId: selectedClient,
              scheduleType: 'one-time',
              date,
              startTime,
              endTime,
              notes
            })
          });

          if (res.ok) {
            created++;
          } else {
            failed++;
          }
        } catch {
          failed++;
        }
      }

      if (created > 0) {
        showMessage(`Created ${created} schedule${created > 1 ? 's' : ''}${failed > 0 ? ` (${failed} failed)` : ''}!`);
        setSelectedCaregiver(null);
        setNotes('');
        setSelectedDays([]);
        setMultiDayMode(false);
        fetchSuggestions();
      } else {
        showMessage('Failed to create schedules', 'error');
      }
    } catch (error) {
      showMessage('Error: ' + error.message, 'error');
    } finally {
      setSaving(false);
    }
  };

  // Create recurring schedules
  const handleCreateRecurring = async () => {
    if (!selectedClient || !selectedCaregiver || recurringTemplate.length === 0) {
      showMessage('Please select client, caregiver, and at least one day', 'error');
      return;
    }

    setSaving(true);
    try {
      const res = await fetch(`${API_BASE_URL}/api/scheduling/bulk-create`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          caregiverId: selectedCaregiver.id,
          clientId: selectedClient,
          template: recurringTemplate,
          weeks: recurringWeeks,
          startDate: selectedDate,
          notes
        })
      });

      if (!res.ok) throw new Error('Failed to create schedules');

      const data = await res.json();
      showMessage(`Created ${data.created} schedules! ${data.skippedConflicts > 0 ? `(${data.skippedConflicts} skipped due to conflicts)` : ''}`);
      setRecurringTemplate([]);
      setShowRecurring(false);
    } catch (error) {
      showMessage('Error: ' + error.message, 'error');
    } finally {
      setSaving(false);
    }
  };

  // Toggle day in recurring template
  const toggleRecurringDay = (dayOfWeek) => {
    const existing = recurringTemplate.find(t => t.dayOfWeek === dayOfWeek);
    if (existing) {
      setRecurringTemplate(recurringTemplate.filter(t => t.dayOfWeek !== dayOfWeek));
    } else {
      setRecurringTemplate([...recurringTemplate, { dayOfWeek, startTime, endTime }]);
    }
  };

  // Week navigation
  const navigateWeek = (direction) => {
    const current = new Date(weekOf);
    current.setDate(current.getDate() + (direction * 7));
    setWeekOf(current.toISOString().split('T')[0]);
  };

  // Reassign schedule (drag-drop simulation via click)
  const handleReassign = async (scheduleId, newCaregiverId) => {
    try {
      const res = await fetch(`${API_BASE_URL}/api/schedules/${scheduleId}/reassign`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ newCaregiverId })
      });

      if (res.ok) {
        showMessage('Schedule reassigned!');
        loadWeekView();
      }
    } catch (error) {
      showMessage('Failed to reassign', 'error');
    }
  };

  // Presets
  const shiftPresets = [
    { label: 'Morning', start: '08:00', end: '12:00' },
    { label: 'Afternoon', start: '12:00', end: '16:00' },
    { label: 'Evening', start: '16:00', end: '20:00' },
    { label: 'Full Day', start: '08:00', end: '16:00' },
  ];

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

  const getCaregiverColor = (id) => {
    const colors = ['#3B82F6', '#10B981', '#F59E0B', '#EF4444', '#8B5CF6', '#EC4899', '#06B6D4', '#84CC16'];
    const idx = caregivers.findIndex(c => c.id === id);
    return colors[idx % colors.length];
  };

  if (loading) {
    return <div className="loading"><div className="spinner"></div></div>;
  }

  return (
    <div className="smart-scheduling">
      {/* Header */}
      <div className="page-header" style={{ marginBottom: '1rem' }}>
        <h2 style={{ margin: 0 }}>🧠 Smart Scheduling</h2>
      </div>

      {/* Message Toast */}
      {message.text && (
        <div style={{
          position: 'fixed', top: '1rem', right: '1rem', padding: '1rem 1.5rem',
          borderRadius: '8px', zIndex: 1000,
          background: message.type === 'error' ? '#FEE2E2' : '#D1FAE5',
          color: message.type === 'error' ? '#DC2626' : '#059669',
          boxShadow: '0 4px 12px rgba(0,0,0,0.15)'
        }}>
          {message.text}
        </div>
      )}

      {/* Tabs */}
      <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1rem', flexWrap: 'wrap' }}>
        {[
          { id: 'create', label: '➕ Create Schedule', icon: '📝' },
          { id: 'week', label: '📅 Week View', icon: '📊' },
          { id: 'coverage', label: '📈 Coverage', icon: '📈' },
          { id: 'availability', label: '⏰ Availability', icon: '👤' }
        ].map(tab => (
          <button
            key={tab.id}
            className={`btn ${activeTab === tab.id ? 'btn-primary' : 'btn-secondary'}`}
            onClick={() => setActiveTab(tab.id)}
          >
            {isMobile ? tab.icon : tab.label}
          </button>
        ))}
      </div>

      {/* CREATE SCHEDULE TAB */}
      {activeTab === 'create' && (
        <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr', gap: '1rem' }}>
          {/* Left: Form */}
          <div className="card">
            <h3 style={{ margin: '0 0 1rem 0' }}>Schedule Details</h3>

            {/* Client Selection */}
            <div className="form-group">
              <label>Client *</label>
              <select value={selectedClient} onChange={(e) => setSelectedClient(e.target.value)}>
                <option value="">Select client...</option>
                {clients.map(c => (
                  <option key={c.id} value={c.id}>{c.first_name} {c.last_name}</option>
                ))}
              </select>
            </div>

            {/* Date */}
            <div className="form-group">
              <label>{multiDayMode ? 'Week Starting' : 'Date'} *</label>
              <input
                type="date"
                value={selectedDate}
                onChange={(e) => setSelectedDate(e.target.value)}
                min={new Date().toISOString().split('T')[0]}
              />
            </div>

            {/* Time Presets */}
            <div className="form-group">
              <label>Quick Presets</label>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem' }}>
                {shiftPresets.map(preset => (
                  <button
                    key={preset.label}
                    type="button"
                    className="btn btn-sm btn-secondary"
                    onClick={() => { setStartTime(preset.start); setEndTime(preset.end); }}
                    style={{
                      background: startTime === preset.start && endTime === preset.end ? '#3B82F6' : undefined,
                      color: startTime === preset.start && endTime === preset.end ? '#fff' : undefined
                    }}
                  >
                    {preset.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Time Inputs */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
              <div className="form-group">
                <label>Start Time</label>
                <input type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)} />
              </div>
              <div className="form-group">
                <label>End Time</label>
                <input type="time" value={endTime} onChange={(e) => setEndTime(e.target.value)} />
              </div>
            </div>

            {/* Notes */}
            <div className="form-group">
              <label>Notes</label>
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows="2"
                placeholder="Optional notes..."
              />
            </div>

            {/* Multi-Day Toggle */}
            <div className="form-group">
              <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={multiDayMode}
                  onChange={(e) => {
                    setMultiDayMode(e.target.checked);
                    if (e.target.checked) {
                      setShowRecurring(false);
                      setSelectedDays([]);
                    }
                  }}
                  style={{ width: 'auto' }}
                />
                Schedule multiple days (same week, same time)
              </label>
            </div>

            {/* Multi-Day Options */}
            {multiDayMode && (
              <div style={{ background: '#EFF6FF', padding: '1rem', borderRadius: '8px', marginBottom: '1rem', border: '1px solid #BFDBFE' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
                  <label style={{ fontWeight: '600', margin: 0 }}>
                    Select days:
                  </label>
                  <button
                    type="button"
                    className="btn btn-sm"
                    onClick={selectWeekdays}
                    style={{ background: '#3B82F6', color: '#fff', fontSize: '0.75rem' }}
                  >
                    Mon-Fri
                  </button>
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', marginBottom: '0.75rem' }}>
                  {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((day, idx) => (
                    <button
                      key={day}
                      type="button"
                      className="btn btn-sm"
                      onClick={() => toggleDaySelection(idx)}
                      style={{
                        background: selectedDays.includes(idx) ? '#3B82F6' : '#E5E7EB',
                        color: selectedDays.includes(idx) ? '#fff' : '#374151',
                        minWidth: '45px'
                      }}
                    >
                      {day}
                    </button>
                  ))}
                </div>
                {selectedDays.length > 0 && (
                  <div style={{ fontSize: '0.85rem', color: '#1E40AF' }}>
                    📅 Will create {getMultiDayDates().length} schedule{getMultiDayDates().length !== 1 ? 's' : ''}: {' '}
                    {getMultiDayDates().map(d => new Date(d + 'T12:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })).join(', ')}
                  </div>
                )}
              </div>
            )}

            {/* Recurring Toggle */}
            <div className="form-group">
              <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={showRecurring}
                  onChange={(e) => {
                    setShowRecurring(e.target.checked);
                    if (e.target.checked) {
                      setMultiDayMode(false);
                      setSelectedDays([]);
                    }
                  }}
                  style={{ width: 'auto' }}
                />
                Create recurring schedule (multiple weeks)
              </label>
            </div>

            {/* Recurring Options */}
            {showRecurring && (
              <div style={{ background: '#F3F4F6', padding: '1rem', borderRadius: '8px', marginBottom: '1rem' }}>
                <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: '600' }}>
                  Select days of the week:
                </label>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', marginBottom: '1rem' }}>
                  {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((day, idx) => (
                    <button
                      key={day}
                      type="button"
                      className="btn btn-sm"
                      onClick={() => toggleRecurringDay(idx)}
                      style={{
                        background: recurringTemplate.some(t => t.dayOfWeek === idx) ? '#3B82F6' : '#E5E7EB',
                        color: recurringTemplate.some(t => t.dayOfWeek === idx) ? '#fff' : '#374151'
                      }}
                    >
                      {day}
                    </button>
                  ))}
                </div>
                <div className="form-group" style={{ marginBottom: 0 }}>
                  <label>Number of weeks: {recurringWeeks}</label>
                  <input
                    type="range"
                    min="1"
                    max="12"
                    value={recurringWeeks}
                    onChange={(e) => setRecurringWeeks(parseInt(e.target.value))}
                    style={{ width: '100%' }}
                  />
                </div>
              </div>
            )}
          </div>

          {/* Right: Caregiver Suggestions */}
          <div className="card">
            <h3 style={{ margin: '0 0 1rem 0' }}>
              {suggestionsLoading ? '⏳ Finding best matches...' : '✨ Recommended Caregivers'}
            </h3>

            {!selectedClient ? (
              <p style={{ color: '#6B7280', textAlign: 'center', padding: '2rem' }}>
                Select a client to see caregiver recommendations
              </p>
            ) : suggestionsLoading ? (
              <div style={{ textAlign: 'center', padding: '2rem' }}>
                <div className="spinner" style={{ margin: '0 auto' }}></div>
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', maxHeight: '500px', overflowY: 'auto' }}>
                {suggestions.map((cg, idx) => {
                  const isSelected = selectedCaregiver?.id === cg.id;
                  const isTop = idx < 3 && cg.score > 80;
                  const hasIssue = cg.hasConflict || !cg.isAvailable || cg.wouldExceedHours;

                  return (
                    <div
                      key={cg.id}
                      onClick={() => handleCaregiverSelect(cg)}
                      style={{
                        padding: '1rem',
                        borderRadius: '8px',
                        cursor: 'pointer',
                        border: isSelected ? '2px solid #3B82F6' : '1px solid #E5E7EB',
                        background: isSelected ? '#EFF6FF' : hasIssue ? '#FEF2F2' : isTop ? '#F0FDF4' : '#fff',
                        transition: 'all 0.2s'
                      }}
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                          <div style={{
                            width: '40px', height: '40px', borderRadius: '50%',
                            background: getCaregiverColor(cg.id),
                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                            color: '#fff', fontWeight: '600'
                          }}>
                            {cg.first_name?.[0]}{cg.last_name?.[0]}
                          </div>
                          <div>
                            <div style={{ fontWeight: '600' }}>
                              {cg.first_name} {cg.last_name}
                              {isTop && <span style={{ marginLeft: '0.5rem', color: '#10B981' }}>⭐ Top Match</span>}
                            </div>
                            <div style={{ fontSize: '0.85rem', color: '#6B7280' }}>
                              {cg.weeklyHours || 0}h this week
                              {cg.clientHistory > 0 && ` • ${cg.clientHistory} prior visits`}
                            </div>
                          </div>
                        </div>
                        <div style={{
                          padding: '0.25rem 0.75rem', borderRadius: '999px',
                          background: cg.score > 80 ? '#D1FAE5' : cg.score > 50 ? '#FEF3C7' : '#FEE2E2',
                          color: cg.score > 80 ? '#065F46' : cg.score > 50 ? '#92400E' : '#991B1B',
                          fontWeight: '600', fontSize: '0.85rem'
                        }}>
                          {cg.score}%
                        </div>
                      </div>

                      {/* Warnings */}
                      {hasIssue && (
                        <div style={{ marginTop: '0.5rem', fontSize: '0.8rem' }}>
                          {cg.hasConflict && <div style={{ color: '#DC2626' }}>⚠️ Has conflicting schedule</div>}
                          {!cg.isAvailable && <div style={{ color: '#DC2626' }}>⚠️ Marked unavailable</div>}
                          {cg.wouldExceedHours && <div style={{ color: '#F59E0B' }}>⚠️ Would exceed weekly hours</div>}
                        </div>
                      )}

                      {/* Reasons */}
                      {cg.reasons && cg.reasons.length > 0 && (
                        <div style={{ marginTop: '0.5rem', display: 'flex', flexWrap: 'wrap', gap: '0.25rem' }}>
                          {cg.reasons.slice(0, 3).map((reason, i) => (
                            <span key={i} style={{
                              fontSize: '0.7rem', padding: '0.15rem 0.5rem',
                              background: '#F3F4F6', borderRadius: '4px', color: '#4B5563'
                            }}>
                              {reason}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}

                {suggestions.length === 0 && (
                  <p style={{ color: '#6B7280', textAlign: 'center', padding: '2rem' }}>
                    No caregivers available for this time slot
                  </p>
                )}
              </div>
            )}

            {/* Conflicts Warning */}
            {conflicts.length > 0 && (
              <div style={{
                marginTop: '1rem',
                padding: '1rem',
                background: '#FEF2F2',
                borderRadius: '8px',
                border: '1px solid #FCA5A5'
              }}>
                <div style={{ fontWeight: '600', color: '#DC2626', marginBottom: '0.5rem' }}>
                  ⚠️ Schedule Conflicts
                </div>
                {conflicts.map((c, i) => (
                  <div key={i} style={{ fontSize: '0.85rem', color: '#7F1D1D' }}>
                    {c.clientName}: {formatTime(c.startTime)} - {formatTime(c.endTime)}
                    {c.isRecurring && ' (recurring)'}
                  </div>
                ))}
              </div>
            )}

            {/* Create Button */}
            {selectedCaregiver && (
              <div style={{ marginTop: '1rem' }}>
                <button
                  className="btn btn-primary"
                  onClick={multiDayMode ? handleCreateMultiDay : (showRecurring ? handleCreateRecurring : handleCreateSchedule)}
                  disabled={saving || (multiDayMode && selectedDays.length === 0)}
                  style={{ width: '100%' }}
                >
                  {saving ? 'Creating...' : multiDayMode
                    ? `Create ${getMultiDayDates().length} schedule${getMultiDayDates().length !== 1 ? 's' : ''} for ${selectedCaregiver.first_name}`
                    : showRecurring
                      ? `Create ${recurringWeeks} weeks of schedules`
                      : `Schedule ${selectedCaregiver.first_name} for ${formatTime(startTime)}-${formatTime(endTime)}`
                  }
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* WEEK VIEW TAB */}
      {activeTab === 'week' && (
        <div>
          {/* Week Navigation */}
          <div className="card" style={{ marginBottom: '1rem', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '0.5rem' }}>
            <button className="btn btn-secondary" onClick={() => navigateWeek(-1)}>← Prev</button>
            <div style={{ fontWeight: '600' }}>
              Week of {new Date(weekOf).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
            </div>
            <button className="btn btn-secondary" onClick={() => navigateWeek(1)}>Next →</button>
<AutoFillButton weekOf={weekOf} token={token} onComplete={loadWeekView} />
          </div>

          <p style={{ fontSize: '0.85rem', color: '#6B7280', marginBottom: '1rem' }}>
            💡 Click any shift to reassign it to a different caregiver
          </p>

          {/* Week Grid */}
          {weekData ? (
            <div style={{ overflowX: 'auto' }}>
              <table className="table" style={{ minWidth: '800px' }}>
                <thead>
                  <tr>
                    <th style={{ width: '150px' }}>Caregiver</th>
                    {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((day, idx) => {
                      const date = new Date(weekData.weekStart);
                      date.setDate(date.getDate() + idx);
                      const isToday = new Date().toDateString() === date.toDateString();
                      return (
                        <th key={day} style={{ textAlign: 'center', minWidth: '100px', background: isToday ? '#EFF6FF' : undefined }}>
                          <div>{day}</div>
                          <div style={{ fontSize: '0.75rem', color: isToday ? '#2563EB' : '#6B7280', fontWeight: isToday ? '700' : '400' }}>
                            {date.getDate()}
                          </div>
                        </th>
                      );
                    })}
                  </tr>
                </thead>
                <tbody>
                  {weekData.caregivers.map(({ caregiver, days }) => (
                    <tr key={caregiver.id}>
                      <td>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                          <div style={{
                            width: '8px', height: '8px', borderRadius: '50%',
                            background: getCaregiverColor(caregiver.id)
                          }} />
                          <strong>{caregiver.first_name} {caregiver.last_name?.[0]}.</strong>
                        </div>
                      </td>
                      {[0, 1, 2, 3, 4, 5, 6].map(dayIdx => {
                        const isToday = (() => {
                          const date = new Date(weekData.weekStart);
                          date.setDate(date.getDate() + dayIdx);
                          return new Date().toDateString() === date.toDateString();
                        })();
                        return (
                          <td key={dayIdx} style={{ padding: '0.25rem', verticalAlign: 'top', background: isToday ? '#F0F9FF' : undefined }}>
                            {days[dayIdx].map(sched => (
                              <div
                                key={sched.id}
                                onClick={() => setReassignModal({ schedule: sched, currentCaregiver: caregiver })}
                                style={{
                                  fontSize: '0.7rem',
                                  padding: '0.25rem 0.5rem',
                                  marginBottom: '0.25rem',
                                  borderRadius: '4px',
                                  background: sched.isRecurring ? '#DBEAFE' : '#D1FAE5',
                                  borderLeft: `3px solid ${getCaregiverColor(caregiver.id)}`,
                                  cursor: 'pointer',
                                  transition: 'transform 0.1s, box-shadow 0.1s'
                                }}
                                onMouseEnter={(e) => { e.target.style.transform = 'scale(1.02)'; e.target.style.boxShadow = '0 2px 8px rgba(0,0,0,0.15)'; }}
                                onMouseLeave={(e) => { e.target.style.transform = 'scale(1)'; e.target.style.boxShadow = 'none'; }}
                                title={`Click to reassign\n${getClientName(sched.client_id)}\n${formatTime(sched.start_time)} - ${formatTime(sched.end_time)}`}
                              >
                                <div style={{ fontWeight: '600', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                  {getClientName(sched.client_id).split(' ')[0]}
                                </div>
                                <div style={{ color: '#6B7280' }}>
                                  {formatTime(sched.start_time)}
                                </div>
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
          ) : (
            <div className="card" style={{ textAlign: 'center', padding: '2rem' }}>
              Loading week view...
            </div>
          )}
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

            <div style={{ marginBottom: '1rem', padding: '1rem', background: '#F3F4F6', borderRadius: '8px' }}>
              <div style={{ fontWeight: '600' }}>{getClientName(reassignModal.schedule.client_id)}</div>
              <div style={{ fontSize: '0.9rem', color: '#6B7280' }}>
                {formatTime(reassignModal.schedule.start_time)} - {formatTime(reassignModal.schedule.end_time)}
              </div>
              <div style={{ fontSize: '0.85rem', color: '#6B7280', marginTop: '0.5rem' }}>
                Currently: <strong>{reassignModal.currentCaregiver.first_name} {reassignModal.currentCaregiver.last_name}</strong>
              </div>
            </div>

            <div className="form-group">
              <label>Reassign to:</label>
              <select
                onChange={(e) => {
                  if (e.target.value) {
                    handleReassign(reassignModal.schedule.id, e.target.value);
                    setReassignModal(null);
                  }
                }}
                defaultValue=""
              >
                <option value="">Select caregiver...</option>
                {caregivers
                  .filter(cg => cg.id !== reassignModal.currentCaregiver.id)
                  .map(cg => (
                    <option key={cg.id} value={cg.id}>
                      {cg.first_name} {cg.last_name}
                    </option>
                  ))
                }
              </select>
            </div>

            <div className="modal-actions">
              <button className="btn btn-secondary" onClick={() => setReassignModal(null)}>Cancel</button>
            </div>
          </div>
        </div>
      )}

      {/* COVERAGE TAB */}
      {activeTab === 'coverage' && (
        <div>
          {coverageLoading ? (
            <div className="card" style={{ textAlign: 'center', padding: '2rem' }}>
              Loading coverage data...
            </div>
          ) : coverageData ? (
            <>
              {/* Summary Cards */}
              <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr 1fr' : 'repeat(4, 1fr)', gap: '1rem', marginBottom: '1.5rem' }}>
                <div className="card" style={{ textAlign: 'center', padding: '1rem' }}>
                  <div style={{ fontSize: '2rem', fontWeight: 'bold', color: '#2563EB' }}>
                    {coverageData.summary.totalCaregivers}
                  </div>
                  <div style={{ fontSize: '0.85rem', color: '#666' }}>Active Caregivers</div>
                </div>
                <div className="card" style={{ textAlign: 'center', padding: '1rem' }}>
                  <div style={{ fontSize: '2rem', fontWeight: 'bold', color: '#059669' }}>
                    {coverageData.summary.totalScheduledHours}h
                  </div>
                  <div style={{ fontSize: '0.85rem', color: '#666' }}>Scheduled This Week</div>
                </div>
                <div className="card" style={{ textAlign: 'center', padding: '1rem' }}>
                  <div style={{ fontSize: '2rem', fontWeight: 'bold', color: coverageData.summary.underScheduledClientCount > 0 ? '#DC2626' : '#059669' }}>
                    {coverageData.summary.underScheduledClientCount}
                  </div>
                  <div style={{ fontSize: '0.85rem', color: '#666' }}>Under-Scheduled Clients</div>
                </div>
                <div className="card" style={{ textAlign: 'center', padding: '1rem' }}>
                  <div style={{ fontSize: '2rem', fontWeight: 'bold', color: coverageData.summary.totalShortfallUnits > 0 ? '#DC2626' : '#059669' }}>
                    {coverageData.summary.totalShortfallUnits} units
                  </div>
                  <div style={{ fontSize: '0.85rem', color: '#666' }}>
                    Shortfall ({coverageData.summary.totalShortfallHours}h)
                  </div>
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr', gap: '1rem' }}>
                {/* Caregiver Hours */}
                <div className="card">
                  <h3 style={{ margin: '0 0 1rem 0', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                    👥 Caregiver Weekly Hours
                  </h3>
                  <div style={{ maxHeight: '400px', overflowY: 'auto' }}>
                    {coverageData.caregivers.map(cg => (
                      <div key={cg.id} style={{ 
                        padding: '0.75rem', 
                        borderBottom: '1px solid #eee',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '1rem'
                      }}>
                        <div style={{ flex: 1 }}>
                          <div style={{ fontWeight: '600' }}>{cg.name}</div>
                          <div style={{ fontSize: '0.85rem', color: '#666' }}>
                            {cg.scheduledHours.toFixed(2)}h / {cg.maxHours}h
                          </div>
                        </div>
                        <div style={{ width: '100px' }}>
                          <div style={{ 
                            height: '8px', 
                            background: '#E5E7EB', 
                            borderRadius: '4px',
                            overflow: 'hidden'
                          }}>
                            <div style={{ 
                              width: `${Math.min(cg.utilizationPercent, 100)}%`, 
                              height: '100%',
                              background: cg.utilizationPercent > 100 ? '#DC2626' : 
                                         cg.utilizationPercent > 80 ? '#F59E0B' : '#10B981',
                              transition: 'width 0.3s'
                            }} />
                          </div>
                        </div>
                        <div style={{ 
                          minWidth: '45px', 
                          textAlign: 'right',
                          fontWeight: '600',
                          color: cg.utilizationPercent > 100 ? '#DC2626' : 
                                 cg.utilizationPercent > 80 ? '#F59E0B' : '#10B981'
                        }}>
                          {cg.utilizationPercent}%
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Under-Scheduled Clients */}
                <div className="card">
                  <h3 style={{ margin: '0 0 1rem 0', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                    ⚠️ Under-Scheduled Clients
                    {coverageData.underScheduledClients.length > 0 && (
                      <span style={{ 
                        background: '#FEE2E2', 
                        color: '#DC2626', 
                        padding: '0.25rem 0.5rem', 
                        borderRadius: '12px',
                        fontSize: '0.75rem',
                        fontWeight: '600'
                      }}>
                        {coverageData.underScheduledClients.length} need attention
                      </span>
                    )}
                  </h3>
                  {coverageData.underScheduledClients.length === 0 ? (
                    <div style={{ textAlign: 'center', padding: '2rem', color: '#059669' }}>
                      <div style={{ fontSize: '2rem', marginBottom: '0.5rem' }}>✅</div>
                      All clients with authorized units are fully scheduled!
                    </div>
                  ) : (
                    <div style={{ maxHeight: '400px', overflowY: 'auto' }}>
                      {coverageData.underScheduledClients.map(cl => (
                        <div key={cl.id} style={{ 
                          padding: '0.75rem', 
                          borderBottom: '1px solid #eee',
                          background: '#FEF2F2'
                        }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <div>
                              <div style={{ fontWeight: '600' }}>{cl.name}</div>
                              <div style={{ fontSize: '0.85rem', color: '#666' }}>
                                {cl.scheduledUnits} / {cl.authorizedUnits} units ({cl.scheduledHours.toFixed(2)}h / {cl.authorizedHours.toFixed(2)}h)
                              </div>
                            </div>
                            <div style={{ 
                              background: '#DC2626',
                              color: '#fff',
                              padding: '0.25rem 0.75rem',
                              borderRadius: '12px',
                              fontSize: '0.85rem',
                              fontWeight: '600'
                            }}>
                              -{cl.shortfallUnits} units
                            </div>
                          </div>
                          <div style={{ marginTop: '0.5rem' }}>
                            <div style={{ 
                              height: '6px', 
                              background: '#FECACA', 
                              borderRadius: '3px',
                              overflow: 'hidden'
                            }}>
                              <div style={{ 
                                width: `${cl.coveragePercent}%`, 
                                height: '100%',
                                background: '#DC2626'
                              }} />
                            </div>
                            <div style={{ fontSize: '0.75rem', color: '#666', marginTop: '0.25rem' }}>
                              {cl.coveragePercent}% coverage
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              {/* All Clients with Authorized Units */}
              <div className="card" style={{ marginTop: '1rem' }}>
                <h3 style={{ margin: '0 0 1rem 0' }}>📋 All Clients with Authorized Units</h3>
                {coverageData.clientsWithUnits.length === 0 ? (
                  <div style={{ textAlign: 'center', padding: '1rem', color: '#666' }}>
                    No clients have weekly authorized units set. Add units to clients to track coverage.
                  </div>
                ) : (
                  <div style={{ overflowX: 'auto' }}>
                    <table className="table" style={{ fontSize: '0.9rem' }}>
                      <thead>
                        <tr>
                          <th>Client</th>
                          <th style={{ textAlign: 'right' }}>Authorized</th>
                          <th style={{ textAlign: 'right' }}>Scheduled</th>
                          <th style={{ textAlign: 'right' }}>Shortfall</th>
                          <th style={{ textAlign: 'center' }}>Coverage</th>
                        </tr>
                      </thead>
                      <tbody>
                        {coverageData.clientsWithUnits.map(cl => (
                          <tr key={cl.id} style={{ background: cl.isUnderScheduled ? '#FEF2F2' : undefined }}>
                            <td style={{ fontWeight: '500' }}>{cl.name}</td>
                            <td style={{ textAlign: 'right' }}>
                              <div>{cl.authorizedUnits} units</div>
                              <div style={{ fontSize: '0.75rem', color: '#666' }}>{cl.authorizedHours.toFixed(2)}h</div>
                            </td>
                            <td style={{ textAlign: 'right' }}>
                              <div>{cl.scheduledUnits} units</div>
                              <div style={{ fontSize: '0.75rem', color: '#666' }}>{cl.scheduledHours.toFixed(2)}h</div>
                            </td>
                            <td style={{ textAlign: 'right', color: cl.shortfallUnits > 0 ? '#DC2626' : '#059669', fontWeight: '600' }}>
                              {cl.shortfallUnits > 0 ? `-${cl.shortfallUnits}` : '✓'}
                            </td>
                            <td style={{ textAlign: 'center' }}>
                              <span style={{ 
                                padding: '0.25rem 0.5rem',
                                borderRadius: '12px',
                                fontSize: '0.75rem',
                                fontWeight: '600',
                                background: cl.coveragePercent >= 100 ? '#D1FAE5' : cl.coveragePercent >= 75 ? '#FEF3C7' : '#FEE2E2',
                                color: cl.coveragePercent >= 100 ? '#059669' : cl.coveragePercent >= 75 ? '#D97706' : '#DC2626'
                              }}>
                                {cl.coveragePercent}%
                              </span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>

              <div style={{ marginTop: '1rem', fontSize: '0.85rem', color: '#666' }}>
                Week of {coverageData.weekStart} to {coverageData.weekEnd}
                <button 
                  className="btn btn-sm btn-secondary" 
                  onClick={loadCoverage}
                  style={{ marginLeft: '1rem' }}
                >
                  🔄 Refresh
                </button>
              </div>
            </>
          ) : (
            <div className="card" style={{ textAlign: 'center', padding: '2rem' }}>
              Failed to load coverage data. <button className="btn btn-sm btn-primary" onClick={loadCoverage}>Retry</button>
            </div>
          )}
        </div>
      )}

      {/* AVAILABILITY TAB */}
      {activeTab === 'availability' && (
        <div className="card">
          <h3 style={{ margin: '0 0 1rem 0' }}>Caregiver Availability</h3>

          <div className="form-group">
            <label>Select Caregiver</label>
            <select
              value={availabilityCaregiver}
              onChange={async (e) => {
                setAvailabilityCaregiver(e.target.value);
                if (e.target.value) {
                  try {
                    const res = await fetch(`${API_BASE_URL}/api/caregivers/${e.target.value}/availability`, {
                      headers: { 'Authorization': `Bearer ${token}` }
                    });
                    if (res.ok) {
                      const data = await res.json();
                      setAvailability({
                        status: data.status || 'available',
                        maxHoursPerWeek: data.max_hours_per_week || 40,
                        weeklyAvailability: data.weekly_availability || {},
                        notes: data.notes || ''
                      });
                    }
                  } catch (err) {
                    console.error(err);
                  }
                }
              }}
            >
              <option value="">Choose caregiver...</option>
              {caregivers.map(cg => (
                <option key={cg.id} value={cg.id}>{cg.first_name} {cg.last_name}</option>
              ))}
            </select>
          </div>

          {availabilityCaregiver && (
            <>
              <div className="form-group">
                <label>Status</label>
                <select
                  value={availability.status}
                  onChange={(e) => setAvailability({ ...availability, status: e.target.value })}
                >
                  <option value="available">Available</option>
                  <option value="limited">Limited Availability</option>
                  <option value="unavailable">Unavailable</option>
                </select>
              </div>

              <div className="form-group">
                <label>Max Hours Per Week: {availability.maxHoursPerWeek}</label>
                <input
                  type="range"
                  min="0"
                  max="60"
                  value={availability.maxHoursPerWeek}
                  onChange={(e) => setAvailability({ ...availability, maxHoursPerWeek: parseInt(e.target.value) })}
                  style={{ width: '100%' }}
                />
              </div>

              <div className="form-group">
                <label>Notes</label>
                <textarea
                  value={availability.notes}
                  onChange={(e) => setAvailability({ ...availability, notes: e.target.value })}
                  rows="3"
                  placeholder="Any availability notes..."
                />
              </div>

              <button
                className="btn btn-primary"
                onClick={async () => {
                  try {
                    const res = await fetch(`${API_BASE_URL}/api/caregiver-availability/${availabilityCaregiver}`, {
                      method: 'PUT',
                      headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${token}`
                      },
                      body: JSON.stringify(availability)
                    });
                    if (res.ok) showMessage('Availability updated!');
                  } catch (err) {
                    showMessage('Failed to update', 'error');
                  }
                }}
              >
                Save Availability
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
};

// Helper function
function getWeekStart(date) {
  const d = new Date(date);
  d.setDate(d.getDate() - d.getDay());
  d.setHours(0, 0, 0, 0);
  return d;
}

export default SmartScheduling;
