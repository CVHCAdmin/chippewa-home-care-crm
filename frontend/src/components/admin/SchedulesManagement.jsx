// src/components/admin/SchedulesManagement.jsx
// Professional scheduling interface modeled after When I Work / Homebase / Deputy
import React, { useState, useEffect } from 'react';
import { getCaregivers, getClients } from '../../config';
import { API_BASE_URL } from '../../config';

const SchedulesManagement = ({ token }) => {
  const [caregivers, setCaregivers] = useState([]);
  const [clients, setClients] = useState([]);
  const [selectedCaregiverId, setSelectedCaregiverId] = useState('');
  const [schedules, setSchedules] = useState([]);
  const [showForm, setShowForm] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState({ text: '', type: '' });
  
  // Form state with better defaults
  const [formData, setFormData] = useState({
    caregiverId: '',
    clientId: '',
    scheduleType: 'one-time', // 'one-time', 'multi-day', 'recurring'
    dayOfWeek: '',
    date: new Date().toISOString().split('T')[0], // Default to today
    startTime: '09:00',
    endTime: '13:00',
    notes: ''
  });

  // Multi-day selection state
  const [selectedDays, setSelectedDays] = useState([]); // [0-6] for Sun-Sat

  // Common shift presets
  const shiftPresets = [
    { label: 'Morning (8am-12pm)', start: '08:00', end: '12:00' },
    { label: 'Afternoon (12pm-4pm)', start: '12:00', end: '16:00' },
    { label: 'Evening (4pm-8pm)', start: '16:00', end: '20:00' },
    { label: 'Full Day (8am-4pm)', start: '08:00', end: '16:00' },
    { label: 'Half Day AM (8am-12pm)', start: '08:00', end: '12:00' },
    { label: 'Half Day PM (1pm-5pm)', start: '13:00', end: '17:00' },
  ];

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    try {
      const [caregiversData, clientsData] = await Promise.all([
        getCaregivers(token),
        getClients(token)
      ]);
      setCaregivers(Array.isArray(caregiversData) ? caregiversData : []);
      setClients(Array.isArray(clientsData) ? clientsData : []);
    } catch (error) {
      console.error('Failed to load data:', error);
    } finally {
      setLoading(false);
    }
  };

  const loadSchedules = async (caregiverId) => {
    if (!caregiverId) {
      setSchedules([]);
      return;
    }
    try {
      const response = await fetch(`${API_BASE_URL}/api/schedules/${caregiverId}`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      const data = await response.json();
      setSchedules(Array.isArray(data) ? data : []);
    } catch (error) {
      console.error('Failed to load schedules:', error);
      setSchedules([]);
    }
  };

  const handleCaregiverSelect = (caregiverId) => {
    setSelectedCaregiverId(caregiverId);
    setFormData(prev => ({ ...prev, caregiverId }));
    loadSchedules(caregiverId);
  };

  const showMessage = (text, type = 'success') => {
    setMessage({ text, type });
    setTimeout(() => setMessage({ text: '', type: '' }), 3000);
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

  // Clear all selected days
  const clearDays = () => {
    setSelectedDays([]);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    
    // Validation
    if (!formData.caregiverId || !formData.clientId) {
      showMessage('Please select both caregiver and client', 'error');
      return;
    }

    if (formData.scheduleType === 'recurring' && formData.dayOfWeek === '') {
      showMessage('Please select a day of week for recurring schedule', 'error');
      return;
    }

    if (formData.scheduleType === 'one-time' && !formData.date) {
      showMessage('Please select a date for one-time schedule', 'error');
      return;
    }

    if (formData.scheduleType === 'multi-day' && selectedDays.length === 0) {
      showMessage('Please select at least one day', 'error');
      return;
    }

    // Time validation
    if (formData.startTime >= formData.endTime) {
      showMessage('End time must be after start time', 'error');
      return;
    }

    setSaving(true);

    try {
      // Handle multi-day scheduling (creates recurring schedules for each selected day)
      if (formData.scheduleType === 'multi-day') {
        if (selectedDays.length === 0) {
          showMessage('Please select at least one day', 'error');
          setSaving(false);
          return;
        }

        let created = 0;
        let failed = 0;

        for (const dayOfWeek of selectedDays) {
          try {
            const response = await fetch(`${API_BASE_URL}/api/schedules`, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
              },
              body: JSON.stringify({
                caregiverId: formData.caregiverId,
                clientId: formData.clientId,
                scheduleType: 'recurring',
                dayOfWeek: dayOfWeek,
                date: null,
                startTime: formData.startTime,
                endTime: formData.endTime,
                notes: formData.notes
              })
            });

            if (response.ok) {
              created++;
            } else {
              failed++;
            }
          } catch {
            failed++;
          }
        }

        if (created > 0) {
          showMessage(`Created ${created} recurring schedule${created > 1 ? 's' : ''}${failed > 0 ? ` (${failed} failed)` : ''}!`, 'success');
          
          // Reset form
          setFormData(prev => ({
            ...prev,
            clientId: '',
            scheduleType: 'one-time',
            dayOfWeek: '',
            date: new Date().toISOString().split('T')[0],
            startTime: '09:00',
            endTime: '13:00',
            notes: ''
          }));
          setSelectedDays([]);
          setShowForm(false);
          loadSchedules(selectedCaregiverId);
        } else {
          showMessage('Failed to create schedules', 'error');
        }
      } else {
        // Handle single one-time or recurring schedule
        const response = await fetch(`${API_BASE_URL}/api/schedules`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`
          },
          body: JSON.stringify({
            caregiverId: formData.caregiverId,
            clientId: formData.clientId,
            scheduleType: formData.scheduleType,
            dayOfWeek: formData.scheduleType === 'recurring' ? parseInt(formData.dayOfWeek) : null,
            date: formData.scheduleType === 'one-time' ? formData.date : null,
            startTime: formData.startTime,
            endTime: formData.endTime,
            notes: formData.notes
          })
        });

        if (!response.ok) {
          const error = await response.json();
          throw new Error(error.error || 'Failed to create schedule');
        }

        showMessage('Schedule created successfully!', 'success');
        
        // Reset form but keep caregiver selected
        setFormData(prev => ({
          ...prev,
          clientId: '',
          scheduleType: 'one-time',
          dayOfWeek: '',
          date: new Date().toISOString().split('T')[0],
          startTime: '09:00',
          endTime: '13:00',
          notes: ''
        }));
        
        setShowForm(false);
        loadSchedules(selectedCaregiverId);
      }
    } catch (error) {
      showMessage('Error: ' + error.message, 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteSchedule = async (scheduleId) => {
    if (!window.confirm('Delete this schedule?')) return;

    try {
      const response = await fetch(`${API_BASE_URL}/api/schedules/${scheduleId}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${token}` }
      });

      if (!response.ok) throw new Error('Failed to delete');

      showMessage('Schedule deleted', 'success');
      loadSchedules(selectedCaregiverId);
    } catch (error) {
      showMessage('Error: ' + error.message, 'error');
    }
  };

  const applyPreset = (preset) => {
    setFormData(prev => ({
      ...prev,
      startTime: preset.start,
      endTime: preset.end
    }));
  };

  // Helper functions
  const getClientName = (clientId) => {
    const client = clients.find(c => c.id === clientId);
    return client ? `${client.first_name} ${client.last_name}` : 'Unknown Client';
  };

  const getDayName = (dayOfWeek) => {
    const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    return days[dayOfWeek] || 'Unknown';
  };

  const formatTime = (timeStr) => {
    if (!timeStr) return '';
    const [hours, minutes] = timeStr.split(':');
    const h = parseInt(hours);
    const ampm = h >= 12 ? 'pm' : 'am';
    const hour12 = h % 12 || 12;
    return `${hour12}:${minutes}${ampm}`;
  };

  const formatDate = (dateStr) => {
    if (!dateStr) return 'Invalid Date';
    try {
      // Handle different date formats
      const date = new Date(dateStr + 'T00:00:00'); // Force local timezone
      if (isNaN(date.getTime())) return 'Invalid Date';
      return date.toLocaleDateString('en-US', { 
        weekday: 'short', 
        month: 'short', 
        day: 'numeric' 
      });
    } catch {
      return 'Invalid Date';
    }
  };

  const calculateHours = (start, end) => {
    if (!start || !end) return 0;
    const startDate = new Date(`2000-01-01T${start}`);
    const endDate = new Date(`2000-01-01T${end}`);
    return ((endDate - startDate) / (1000 * 60 * 60)).toFixed(1);
  };

  // Calculate total hours for array of schedules
  const calculateTotalHours = (scheduleList) => {
    return scheduleList.reduce((total, schedule) => {
      return total + parseFloat(calculateHours(schedule.start_time, schedule.end_time));
    }, 0).toFixed(1);
  };

  // Group schedules by type then day/date
  const groupSchedules = () => {
    const recurringByDay = {}; // { 0: [...], 1: [...], etc }
    const oneTimeByDate = {}; // { '2026-01-15': [...], etc }

    schedules.forEach(schedule => {
      if (schedule.day_of_week !== null && schedule.day_of_week !== undefined) {
        if (!recurringByDay[schedule.day_of_week]) {
          recurringByDay[schedule.day_of_week] = [];
        }
        recurringByDay[schedule.day_of_week].push(schedule);
      } else if (schedule.date) {
        const dateKey = schedule.date.split('T')[0];
        if (!oneTimeByDate[dateKey]) {
          oneTimeByDate[dateKey] = [];
        }
        oneTimeByDate[dateKey].push(schedule);
      }
    });

    // Sort schedules within each day by start time
    Object.values(recurringByDay).forEach(daySchedules => {
      daySchedules.sort((a, b) => (a.start_time || '').localeCompare(b.start_time || ''));
    });
    Object.values(oneTimeByDate).forEach(dateSchedules => {
      dateSchedules.sort((a, b) => (a.start_time || '').localeCompare(b.start_time || ''));
    });

    return { recurringByDay, oneTimeByDate };
  };

  if (loading) {
    return (
      <div className="loading">
        <div className="spinner"></div>
      </div>
    );
  }

  const { recurringByDay, oneTimeByDate } = groupSchedules();
  const hasRecurring = Object.keys(recurringByDay).length > 0;
  const hasOneTime = Object.keys(oneTimeByDate).length > 0;

  return (
    <div className="schedules-management">
      {/* Header */}
      <div className="page-header" style={{ marginBottom: '1.5rem' }}>
        <h2 style={{ margin: 0 }}>📋 Schedule Management</h2>
        <p style={{ margin: '0.25rem 0 0 0', color: '#666', fontSize: '0.9rem' }}>
          Create and manage caregiver schedules
        </p>
      </div>

      {/* Message Toast */}
      {message.text && (
        <div style={{
          position: 'fixed',
          top: '1rem',
          right: '1rem',
          padding: '1rem 1.5rem',
          borderRadius: '8px',
          background: message.type === 'error' ? '#FEE2E2' : '#D1FAE5',
          color: message.type === 'error' ? '#DC2626' : '#059669',
          boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
          zIndex: 1000,
          animation: 'slideIn 0.3s ease'
        }}>
          {message.text}
        </div>
      )}

      {/* Caregiver Selection */}
      <div className="card" style={{ marginBottom: '1rem' }}>
        <div style={{ 
          display: 'flex', 
          flexDirection: 'column',
          gap: '1rem'
        }}>
          <div>
            <label style={{ 
              display: 'block', 
              marginBottom: '0.5rem', 
              fontWeight: '600',
              color: '#374151'
            }}>
              Select Caregiver
            </label>
            <select
              value={selectedCaregiverId}
              onChange={(e) => handleCaregiverSelect(e.target.value)}
              style={{
                width: '100%',
                padding: '0.75rem',
                borderRadius: '8px',
                border: '2px solid #e5e7eb',
                fontSize: '1rem',
                background: '#fff'
              }}
            >
              <option value="">Choose a caregiver...</option>
              {caregivers.map(cg => (
                <option key={cg.id} value={cg.id}>
                  {cg.first_name} {cg.last_name}
                </option>
              ))}
            </select>
          </div>

          {selectedCaregiverId && (
            <button 
              className="btn btn-primary"
              onClick={() => {
                setFormData(prev => ({ ...prev, caregiverId: selectedCaregiverId }));
                setShowForm(!showForm);
              }}
              style={{ alignSelf: 'flex-start' }}
            >
              {showForm ? '✕ Cancel' : '+ Add Schedule'}
            </button>
          )}
        </div>
      </div>

      {/* Add Schedule Form */}
      {showForm && selectedCaregiverId && (
        <div className="card" style={{ 
          marginBottom: '1.5rem',
          border: '2px solid #3B82F6',
          background: '#F8FAFC'
        }}>
          <h3 style={{ margin: '0 0 1.25rem 0', color: '#1E40AF' }}>
            New Schedule
          </h3>
          
          <form onSubmit={handleSubmit}>
            {/* Schedule Type Toggle - Now with 3 options */}
            <div style={{ marginBottom: '1.25rem' }}>
              <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: '600' }}>
                Schedule Type
              </label>
              <div style={{ 
                display: 'flex', 
                borderRadius: '8px',
                overflow: 'hidden',
                border: '2px solid #e5e7eb'
              }}>
                <button
                  type="button"
                  onClick={() => {
                    setFormData(prev => ({ ...prev, scheduleType: 'one-time', dayOfWeek: '' }));
                    setSelectedDays([]);
                  }}
                  style={{
                    flex: 1,
                    padding: '0.75rem 0.5rem',
                    border: 'none',
                    background: formData.scheduleType === 'one-time' ? '#3B82F6' : '#fff',
                    color: formData.scheduleType === 'one-time' ? '#fff' : '#374151',
                    cursor: 'pointer',
                    fontWeight: '500',
                    fontSize: '0.9rem'
                  }}
                >
                  📅 One-Time
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setFormData(prev => ({ ...prev, scheduleType: 'multi-day', dayOfWeek: '' }));
                  }}
                  style={{
                    flex: 1,
                    padding: '0.75rem 0.5rem',
                    border: 'none',
                    borderLeft: '2px solid #e5e7eb',
                    background: formData.scheduleType === 'multi-day' ? '#3B82F6' : '#fff',
                    color: formData.scheduleType === 'multi-day' ? '#fff' : '#374151',
                    cursor: 'pointer',
                    fontWeight: '500',
                    fontSize: '0.9rem'
                  }}
                >
                  📆 Multi-Day
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setFormData(prev => ({ ...prev, scheduleType: 'recurring', date: '' }));
                    setSelectedDays([]);
                  }}
                  style={{
                    flex: 1,
                    padding: '0.75rem 0.5rem',
                    border: 'none',
                    borderLeft: '2px solid #e5e7eb',
                    background: formData.scheduleType === 'recurring' ? '#3B82F6' : '#fff',
                    color: formData.scheduleType === 'recurring' ? '#fff' : '#374151',
                    cursor: 'pointer',
                    fontWeight: '500',
                    fontSize: '0.9rem'
                  }}
                >
                  🔄 Recurring
                </button>
              </div>
            </div>

            {/* Date or Day Selection based on type */}
            {formData.scheduleType === 'one-time' && (
              <div style={{ marginBottom: '1.25rem' }}>
                <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: '600' }}>
                  Date *
                </label>
                <input
                  type="date"
                  value={formData.date}
                  onChange={(e) => setFormData(prev => ({ ...prev, date: e.target.value }))}
                  min={new Date().toISOString().split('T')[0]}
                  required
                  style={{
                    width: '100%',
                    padding: '0.75rem',
                    borderRadius: '8px',
                    border: '2px solid #e5e7eb',
                    fontSize: '1rem'
                  }}
                />
              </div>
            )}

            {formData.scheduleType === 'multi-day' && (
              <div style={{ marginBottom: '1.25rem' }}>
                {/* Multi-Day Selection for Recurring */}
                <div style={{ 
                  background: '#EFF6FF', 
                  padding: '1rem', 
                  borderRadius: '8px',
                  border: '1px solid #BFDBFE'
                }}>
                  <div style={{ 
                    display: 'flex', 
                    justifyContent: 'space-between', 
                    alignItems: 'center', 
                    marginBottom: '0.75rem' 
                  }}>
                    <label style={{ fontWeight: '600', margin: 0 }}>
                      Select Days (Recurring Weekly) *
                    </label>
                    <div style={{ display: 'flex', gap: '0.5rem' }}>
                      <button
                        type="button"
                        onClick={selectWeekdays}
                        style={{
                          padding: '0.35rem 0.75rem',
                          borderRadius: '4px',
                          border: 'none',
                          background: '#3B82F6',
                          color: '#fff',
                          cursor: 'pointer',
                          fontSize: '0.75rem',
                          fontWeight: '500'
                        }}
                      >
                        Mon-Fri
                      </button>
                      <button
                        type="button"
                        onClick={clearDays}
                        style={{
                          padding: '0.35rem 0.75rem',
                          borderRadius: '4px',
                          border: '1px solid #D1D5DB',
                          background: '#fff',
                          color: '#6B7280',
                          cursor: 'pointer',
                          fontSize: '0.75rem',
                          fontWeight: '500'
                        }}
                      >
                        Clear
                      </button>
                    </div>
                  </div>
                  
                  <div style={{ 
                    display: 'grid', 
                    gridTemplateColumns: 'repeat(7, 1fr)',
                    gap: '0.5rem',
                    marginBottom: '0.75rem'
                  }}>
                    {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((day, idx) => (
                      <button
                        key={day}
                        type="button"
                        onClick={() => toggleDaySelection(idx)}
                        style={{
                          padding: '0.6rem 0.25rem',
                          borderRadius: '8px',
                          border: selectedDays.includes(idx) ? '2px solid #3B82F6' : '2px solid #E5E7EB',
                          background: selectedDays.includes(idx) ? '#3B82F6' : '#fff',
                          color: selectedDays.includes(idx) ? '#fff' : '#374151',
                          cursor: 'pointer',
                          fontWeight: '600',
                          fontSize: '0.85rem'
                        }}
                      >
                        {day}
                      </button>
                    ))}
                  </div>
                  
                  {selectedDays.length > 0 && (
                    <div style={{ 
                      fontSize: '0.85rem', 
                      color: '#1E40AF',
                      padding: '0.5rem',
                      background: '#DBEAFE',
                      borderRadius: '4px'
                    }}>
                      🔄 Will create <strong>{selectedDays.length}</strong> recurring weekly schedule{selectedDays.length !== 1 ? 's' : ''}: {' '}
                      {selectedDays.map(d => ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][d]).join(', ')}
                    </div>
                  )}
                </div>
              </div>
            )}

            {formData.scheduleType === 'recurring' && (
              <div style={{ marginBottom: '1.25rem' }}>
                <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: '600' }}>
                  Day of Week *
                </label>
                <div style={{ 
                  display: 'grid', 
                  gridTemplateColumns: 'repeat(auto-fill, minmax(100px, 1fr))',
                  gap: '0.5rem'
                }}>
                  {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((day, idx) => (
                    <button
                      key={day}
                      type="button"
                      onClick={() => setFormData(prev => ({ ...prev, dayOfWeek: idx.toString() }))}
                      style={{
                        padding: '0.75rem 0.5rem',
                        borderRadius: '8px',
                        border: formData.dayOfWeek === idx.toString() ? '2px solid #3B82F6' : '2px solid #e5e7eb',
                        background: formData.dayOfWeek === idx.toString() ? '#EFF6FF' : '#fff',
                        color: formData.dayOfWeek === idx.toString() ? '#1D4ED8' : '#374151',
                        cursor: 'pointer',
                        fontWeight: '500',
                        fontSize: '0.9rem'
                      }}
                    >
                      {day}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Client Selection */}
            <div style={{ marginBottom: '1.25rem' }}>
              <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: '600' }}>
                Client *
              </label>
              <select
                value={formData.clientId}
                onChange={(e) => setFormData(prev => ({ ...prev, clientId: e.target.value }))}
                required
                style={{
                  width: '100%',
                  padding: '0.75rem',
                  borderRadius: '8px',
                  border: '2px solid #e5e7eb',
                  fontSize: '1rem'
                }}
              >
                <option value="">Select client...</option>
                {clients.map(client => (
                  <option key={client.id} value={client.id}>
                    {client.first_name} {client.last_name}
                    {client.service_type && ` (${client.service_type.replace(/_/g, ' ')})`}
                  </option>
                ))}
              </select>
            </div>

            {/* Quick Time Presets */}
            <div style={{ marginBottom: '1.25rem' }}>
              <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: '600' }}>
                Quick Shift Presets
              </label>
              <div style={{ 
                display: 'flex', 
                flexWrap: 'wrap', 
                gap: '0.5rem'
              }}>
                {shiftPresets.map((preset, idx) => (
                  <button
                    key={idx}
                    type="button"
                    onClick={() => applyPreset(preset)}
                    style={{
                      padding: '0.5rem 0.75rem',
                      borderRadius: '20px',
                      border: '1px solid #e5e7eb',
                      background: formData.startTime === preset.start && formData.endTime === preset.end 
                        ? '#DBEAFE' 
                        : '#fff',
                      color: '#374151',
                      cursor: 'pointer',
                      fontSize: '0.8rem',
                      whiteSpace: 'nowrap'
                    }}
                  >
                    {preset.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Custom Time Inputs */}
            <div style={{ 
              display: 'grid', 
              gridTemplateColumns: '1fr 1fr',
              gap: '1rem',
              marginBottom: '1.25rem'
            }}>
              <div>
                <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: '600' }}>
                  Start Time *
                </label>
                <input
                  type="time"
                  value={formData.startTime}
                  onChange={(e) => setFormData(prev => ({ ...prev, startTime: e.target.value }))}
                  required
                  style={{
                    width: '100%',
                    padding: '0.75rem',
                    borderRadius: '8px',
                    border: '2px solid #e5e7eb',
                    fontSize: '1rem'
                  }}
                />
              </div>
              <div>
                <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: '600' }}>
                  End Time *
                </label>
                <input
                  type="time"
                  value={formData.endTime}
                  onChange={(e) => setFormData(prev => ({ ...prev, endTime: e.target.value }))}
                  required
                  style={{
                    width: '100%',
                    padding: '0.75rem',
                    borderRadius: '8px',
                    border: '2px solid #e5e7eb',
                    fontSize: '1rem'
                  }}
                />
              </div>
            </div>

            {/* Duration Display */}
            <div style={{ 
              marginBottom: '1.25rem',
              padding: '0.75rem',
              background: '#F3F4F6',
              borderRadius: '8px',
              textAlign: 'center'
            }}>
              <span style={{ fontWeight: '600' }}>
                {formatTime(formData.startTime)} - {formatTime(formData.endTime)}
              </span>
              <span style={{ color: '#6B7280', marginLeft: '1rem' }}>
                ({calculateHours(formData.startTime, formData.endTime)} hours{formData.scheduleType === 'multi-day' && selectedDays.length > 0 ? ` × ${selectedDays.length} days/week = ${(calculateHours(formData.startTime, formData.endTime) * selectedDays.length).toFixed(1)} hours/week` : ''})
              </span>
            </div>

            {/* Notes */}
            <div style={{ marginBottom: '1.25rem' }}>
              <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: '600' }}>
                Notes (optional)
              </label>
              <textarea
                value={formData.notes}
                onChange={(e) => setFormData(prev => ({ ...prev, notes: e.target.value }))}
                placeholder="Special instructions, client preferences, etc."
                rows="2"
                style={{
                  width: '100%',
                  padding: '0.75rem',
                  borderRadius: '8px',
                  border: '2px solid #e5e7eb',
                  fontSize: '1rem',
                  resize: 'vertical'
                }}
              />
            </div>

            {/* Submit Buttons */}
            <div style={{ display: 'flex', gap: '0.75rem' }}>
              <button 
                type="submit" 
                className="btn btn-primary"
                disabled={saving || (formData.scheduleType === 'multi-day' && selectedDays.length === 0)}
                style={{ flex: 1 }}
              >
                {saving ? 'Saving...' : formData.scheduleType === 'multi-day' 
                  ? `✓ Create ${selectedDays.length} Recurring Schedule${selectedDays.length !== 1 ? 's' : ''}`
                  : '✓ Create Schedule'
                }
              </button>
              <button 
                type="button" 
                className="btn btn-secondary"
                onClick={() => {
                  setShowForm(false);
                  setSelectedDays([]);
                }}
              >
                Cancel
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Schedules Display */}
      {selectedCaregiverId && (
        <div>
          {/* Recurring Schedules - Grouped by Day */}
          {hasRecurring && (
            <div style={{ marginBottom: '1.5rem' }}>
              <h3 style={{ 
                margin: '0 0 1rem 0', 
                fontSize: '1rem',
                color: '#374151',
                display: 'flex',
                alignItems: 'center',
                gap: '0.5rem'
              }}>
                <span style={{ fontSize: '1.25rem' }}>🔄</span>
                Recurring Weekly
              </h3>
              
              <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                {Object.entries(recurringByDay)
                  .sort(([a], [b]) => parseInt(a) - parseInt(b))
                  .map(([dayOfWeek, daySchedules]) => (
                  <div key={dayOfWeek} className="card" style={{ padding: 0, overflow: 'hidden' }}>
                    {/* Day Header with Total */}
                    <div style={{
                      padding: '0.75rem 1rem',
                      background: '#EDE9FE',
                      borderBottom: '1px solid #DDD6FE',
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center'
                    }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                        <span style={{ fontWeight: '700', color: '#6D28D9' }}>
                          {getDayName(parseInt(dayOfWeek))}
                        </span>
                        <span style={{ 
                          fontSize: '0.75rem', 
                          background: '#8B5CF6',
                          color: '#fff',
                          padding: '0.125rem 0.5rem',
                          borderRadius: '10px'
                        }}>
                          {daySchedules.length} shift{daySchedules.length !== 1 ? 's' : ''}
                        </span>
                      </div>
                      <span style={{ fontWeight: '600', color: '#7C3AED' }}>
                        {calculateTotalHours(daySchedules)}h total
                      </span>
                    </div>
                    
                    {/* Individual Schedules */}
                    <div style={{ padding: '0.5rem' }}>
                      {daySchedules.map(schedule => (
                        <div 
                          key={schedule.id}
                          style={{ 
                            padding: '0.75rem',
                            display: 'flex',
                            alignItems: 'center',
                            gap: '1rem',
                            borderBottom: '1px solid #f3f4f6'
                          }}
                        >
                          <div style={{ flex: 1 }}>
                            <div style={{ fontWeight: '600', marginBottom: '0.25rem' }}>
                              {getClientName(schedule.client_id)}
                            </div>
                            <div style={{ fontSize: '0.9rem', color: '#6B7280' }}>
                              {formatTime(schedule.start_time)} - {formatTime(schedule.end_time)}
                              <span style={{ marginLeft: '0.5rem', color: '#9CA3AF' }}>
                                ({calculateHours(schedule.start_time, schedule.end_time)}h)
                              </span>
                            </div>
                            {schedule.notes && (
                              <div style={{ 
                                fontSize: '0.8rem', 
                                color: '#9CA3AF',
                                marginTop: '0.25rem',
                                fontStyle: 'italic'
                              }}>
                                {schedule.notes}
                              </div>
                            )}
                          </div>
                          
                          <button
                            onClick={() => handleDeleteSchedule(schedule.id)}
                            style={{
                              background: 'none',
                              border: 'none',
                              color: '#EF4444',
                              cursor: 'pointer',
                              padding: '0.5rem',
                              fontSize: '1.25rem'
                            }}
                            title="Delete schedule"
                          >
                            🗑️
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* One-Time Schedules - Grouped by Date */}
          {hasOneTime && (
            <div style={{ marginBottom: '1.5rem' }}>
              <h3 style={{ 
                margin: '0 0 1rem 0', 
                fontSize: '1rem',
                color: '#374151',
                display: 'flex',
                alignItems: 'center',
                gap: '0.5rem'
              }}>
                <span style={{ fontSize: '1.25rem' }}>📅</span>
                One-Time Appointments
              </h3>
              
              <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                {Object.entries(oneTimeByDate)
                  .sort(([a], [b]) => new Date(a) - new Date(b))
                  .map(([dateKey, dateSchedules]) => {
                    const isPast = new Date(dateKey + 'T23:59:59') < new Date();
                    const dateDisplay = new Date(dateKey + 'T00:00:00').toLocaleDateString('en-US', { 
                      weekday: 'long', 
                      month: 'short', 
                      day: 'numeric' 
                    });
                    
                    return (
                      <div 
                        key={dateKey} 
                        className="card" 
                        style={{ 
                          padding: 0, 
                          overflow: 'hidden',
                          opacity: isPast ? 0.7 : 1
                        }}
                      >
                        {/* Date Header with Total */}
                        <div style={{
                          padding: '0.75rem 1rem',
                          background: isPast ? '#F3F4F6' : '#DBEAFE',
                          borderBottom: `1px solid ${isPast ? '#E5E7EB' : '#BFDBFE'}`,
                          display: 'flex',
                          justifyContent: 'space-between',
                          alignItems: 'center'
                        }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                            <span style={{ fontWeight: '700', color: isPast ? '#6B7280' : '#1D4ED8' }}>
                              {dateDisplay}
                            </span>
                            <span style={{ 
                              fontSize: '0.75rem', 
                              background: isPast ? '#9CA3AF' : '#3B82F6',
                              color: '#fff',
                              padding: '0.125rem 0.5rem',
                              borderRadius: '10px'
                            }}>
                              {dateSchedules.length} shift{dateSchedules.length !== 1 ? 's' : ''}
                            </span>
                            {isPast && (
                              <span style={{ 
                                fontSize: '0.7rem', 
                                color: '#9CA3AF',
                                fontStyle: 'italic'
                              }}>
                                (past)
                              </span>
                            )}
                          </div>
                          <span style={{ fontWeight: '600', color: isPast ? '#6B7280' : '#2563EB' }}>
                            {calculateTotalHours(dateSchedules)}h total
                          </span>
                        </div>
                        
                        {/* Individual Schedules */}
                        <div style={{ padding: '0.5rem' }}>
                          {dateSchedules.map(schedule => (
                            <div 
                              key={schedule.id}
                              style={{ 
                                padding: '0.75rem',
                                display: 'flex',
                                alignItems: 'center',
                                gap: '1rem',
                                borderBottom: '1px solid #f3f4f6'
                              }}
                            >
                              <div style={{ flex: 1 }}>
                                <div style={{ fontWeight: '600', marginBottom: '0.25rem' }}>
                                  {getClientName(schedule.client_id)}
                                </div>
                                <div style={{ fontSize: '0.9rem', color: '#6B7280' }}>
                                  {formatTime(schedule.start_time)} - {formatTime(schedule.end_time)}
                                  <span style={{ marginLeft: '0.5rem', color: '#9CA3AF' }}>
                                    ({calculateHours(schedule.start_time, schedule.end_time)}h)
                                  </span>
                                </div>
                                {schedule.notes && (
                                  <div style={{ 
                                    fontSize: '0.8rem', 
                                    color: '#9CA3AF',
                                    marginTop: '0.25rem',
                                    fontStyle: 'italic'
                                  }}>
                                    {schedule.notes}
                                  </div>
                                )}
                              </div>
                              
                              <button
                                onClick={() => handleDeleteSchedule(schedule.id)}
                                style={{
                                  background: 'none',
                                  border: 'none',
                                  color: '#EF4444',
                                  cursor: 'pointer',
                                  padding: '0.5rem',
                                  fontSize: '1.25rem'
                                }}
                                title="Delete schedule"
                              >
                                🗑️
                              </button>
                            </div>
                          ))}
                        </div>
                      </div>
                    );
                  })}
              </div>
            </div>
          )}

          {/* Empty State */}
          {!hasRecurring && !hasOneTime && (
            <div className="card" style={{ 
              textAlign: 'center', 
              padding: '3rem 1.5rem',
              color: '#6B7280'
            }}>
              <p style={{ fontSize: '3rem', margin: '0 0 1rem 0' }}>📋</p>
              <p style={{ margin: '0 0 0.5rem 0', fontWeight: '600', color: '#374151' }}>
                No schedules yet
              </p>
              <p style={{ margin: 0, fontSize: '0.9rem' }}>
                Click "Add Schedule" to create the first appointment for this caregiver
              </p>
            </div>
          )}
        </div>
      )}

      {/* No Caregiver Selected State */}
      {!selectedCaregiverId && (
        <div className="card" style={{ 
          textAlign: 'center', 
          padding: '3rem 1.5rem',
          color: '#6B7280'
        }}>
          <p style={{ fontSize: '3rem', margin: '0 0 1rem 0' }}>👆</p>
          <p style={{ margin: 0, fontWeight: '600', color: '#374151' }}>
            Select a caregiver above to manage their schedule
          </p>
        </div>
      )}

      {/* Animation keyframes */}
      <style>{`
        @keyframes slideIn {
          from { transform: translateX(100%); opacity: 0; }
          to { transform: translateX(0); opacity: 1; }
        }
        
        .schedules-management select:focus,
        .schedules-management input:focus,
        .schedules-management textarea:focus {
          outline: none;
          border-color: #3B82F6;
          box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.1);
        }
      `}</style>
    </div>
  );
};

export default SchedulesManagement;
