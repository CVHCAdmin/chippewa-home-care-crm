// src/components/admin/SchedulesManagement.jsx
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
  const [message, setMessage] = useState('');
  const [formData, setFormData] = useState({
    caregiverId: '',
    clientId: '',
    scheduleType: 'recurring', // recurring or one-time
    dayOfWeek: '', // 0-6 for recurring
    date: '', // for one-time
    startTime: '08:00',
    endTime: '12:00',
    notes: ''
  });

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    try {
      const [caregiversData, clientsData] = await Promise.all([
        getCaregivers(token),
        getClients(token)
      ]);
      setCaregivers(caregiversData);
      setClients(clientsData);
      setLoading(false);
    } catch (error) {
      console.error('Failed to load data:', error);
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
    setFormData({ ...formData, caregiverId });
    loadSchedules(caregiverId);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setMessage('');

    // Validate
    if (!formData.caregiverId || !formData.clientId) {
      setMessage('Caregiver and Client are required');
      return;
    }

    if (formData.scheduleType === 'recurring' && formData.dayOfWeek === '') {
      setMessage('Please select a day of week for recurring schedule');
      return;
    }

    if (formData.scheduleType === 'one-time' && !formData.date) {
      setMessage('Please select a date for one-time schedule');
      return;
    }

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

      setMessage('Schedule created successfully!');
      setFormData({
        caregiverId: selectedCaregiverId,
        clientId: '',
        scheduleType: 'recurring',
        dayOfWeek: '',
        date: '',
        startTime: '08:00',
        endTime: '12:00',
        notes: ''
      });
      setShowForm(false);
      loadSchedules(selectedCaregiverId);
    } catch (error) {
      setMessage('Error: ' + error.message);
    }
  };

  const handleDeleteSchedule = async (scheduleId) => {
    if (!window.confirm('Delete this schedule slot?')) return;

    try {
      const response = await fetch(`${API_BASE_URL}/api/schedules/${scheduleId}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${token}` }
      });

      if (!response.ok) throw new Error('Failed to delete');

      setMessage('Schedule deleted');
      setTimeout(() => setMessage(''), 2000);
      loadSchedules(selectedCaregiverId);
    } catch (error) {
      setMessage('Error: ' + error.message);
    }
  };

  const getClientName = (clientId) => {
    const client = clients.find(c => c.id === clientId);
    return client ? `${client.first_name} ${client.last_name}` : 'Unknown Client';
  };

  const getDayName = (dayOfWeek) => {
    const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    return days[dayOfWeek];
  };

  const calculateDailyHours = (daySchedules) => {
    if (!Array.isArray(daySchedules) || daySchedules.length === 0) return 0;
    
    return daySchedules.reduce((total, schedule) => {
      const start = new Date(`2000-01-01 ${schedule.start_time}`);
      const end = new Date(`2000-01-01 ${schedule.end_time}`);
      const hours = (end - start) / (1000 * 60 * 60);
      return total + hours;
    }, 0).toFixed(1);
  };

  const groupSchedulesByDayAndClient = () => {
    const grouped = {};
    schedules.forEach(schedule => {
      const key = schedule.day_of_week !== null 
        ? `recurring-${schedule.day_of_week}` 
        : `one-time-${schedule.date}`;
      
      if (!grouped[key]) {
        grouped[key] = [];
      }
      grouped[key].push(schedule);
    });
    return grouped;
  };

  if (loading) {
    return (
      <div className="loading">
        <div className="spinner"></div>
      </div>
    );
  }

  const groupedSchedules = groupSchedulesByDayAndClient();

  return (
    <div>
      <div className="page-header">
        <h2>Schedule Management</h2>
      </div>

      {/* Caregiver Selection */}
      <div className="card">
        <h3>Select Caregiver</h3>
        <div style={{ display: 'flex', gap: '1rem', alignItems: 'flex-end' }}>
          <div className="form-group" style={{ flex: 1 }}>
            <label>Caregiver *</label>
            <select
              value={selectedCaregiverId}
              onChange={(e) => handleCaregiverSelect(e.target.value)}
            >
              <option value="">Select a caregiver...</option>
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
              onClick={() => setShowForm(!showForm)}
            >
              {showForm ? 'Cancel' : 'Add Schedule'}
            </button>
          )}
        </div>
      </div>

      {message && (
        <div className={`alert ${message.includes('Error') ? 'alert-error' : 'alert-success'}`}>
          {message}
        </div>
      )}

      {/* Add Schedule Form */}
      {showForm && selectedCaregiverId && (
        <div className="card card-form">
          <h3>Add New Schedule Slot</h3>
          <form onSubmit={handleSubmit}>
            <div className="form-group">
              <label>Schedule Type *</label>
              <div style={{ display: 'flex', gap: '1rem' }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <input
                    type="radio"
                    value="recurring"
                    checked={formData.scheduleType === 'recurring'}
                    onChange={(e) => setFormData({ ...formData, scheduleType: e.target.value, date: '' })}
                  />
                  Recurring (Every Week)
                </label>
                <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <input
                    type="radio"
                    value="one-time"
                    checked={formData.scheduleType === 'one-time'}
                    onChange={(e) => setFormData({ ...formData, scheduleType: e.target.value, dayOfWeek: '' })}
                  />
                  One-Time
                </label>
              </div>
            </div>

            {formData.scheduleType === 'recurring' ? (
              <div className="form-group">
                <label>Day of Week *</label>
                <select
                  value={formData.dayOfWeek}
                  onChange={(e) => setFormData({ ...formData, dayOfWeek: e.target.value })}
                  required
                >
                  <option value="">Select day...</option>
                  <option value="0">Sunday</option>
                  <option value="1">Monday</option>
                  <option value="2">Tuesday</option>
                  <option value="3">Wednesday</option>
                  <option value="4">Thursday</option>
                  <option value="5">Friday</option>
                  <option value="6">Saturday</option>
                </select>
              </div>
            ) : (
              <div className="form-group">
                <label>Date *</label>
                <input
                  type="date"
                  value={formData.date}
                  onChange={(e) => setFormData({ ...formData, date: e.target.value })}
                  required
                />
              </div>
            )}

            <div className="form-group">
              <label>Client *</label>
              <select
                value={formData.clientId}
                onChange={(e) => setFormData({ ...formData, clientId: e.target.value })}
                required
              >
                <option value="">Select client...</option>
                {clients.map(client => (
                  <option key={client.id} value={client.id}>
                    {client.first_name} {client.last_name} ({client.service_type?.replace('_', ' ')})
                  </option>
                ))}
              </select>
            </div>

            <div className="form-grid-2">
              <div className="form-group">
                <label>Start Time *</label>
                <input
                  type="time"
                  value={formData.startTime}
                  onChange={(e) => setFormData({ ...formData, startTime: e.target.value })}
                  required
                />
              </div>

              <div className="form-group">
                <label>End Time *</label>
                <input
                  type="time"
                  value={formData.endTime}
                  onChange={(e) => setFormData({ ...formData, endTime: e.target.value })}
                  required
                />
              </div>
            </div>

            <div className="form-group">
              <label>Notes</label>
              <textarea
                value={formData.notes}
                onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
                placeholder="Special instructions, client preferences, etc."
                rows="2"
              ></textarea>
            </div>

            <div className="form-actions">
              <button type="submit" className="btn btn-primary">Add Schedule Slot</button>
              <button type="button" className="btn btn-secondary" onClick={() => setShowForm(false)}>Cancel</button>
            </div>
          </form>
        </div>
      )}

      {/* Schedules List */}
      {selectedCaregiverId && (
        <div>
          <h3 style={{ marginTop: '2rem', marginBottom: '1rem' }}>Current Schedules</h3>
          
          {schedules.length === 0 ? (
            <div className="card card-centered">
              <p>No schedules yet for this caregiver.</p>
            </div>
          ) : (
            <div style={{ display: 'grid', gap: '1.5rem' }}>
              {Object.entries(groupedSchedules).map(([key, daySchedules]) => {
                const isRecurring = key.startsWith('recurring');
                const dayOrDate = isRecurring 
                  ? getDayName(parseInt(key.split('-')[1]))
                  : new Date(key.split('-')[1]).toLocaleDateString();

                const dailyHours = calculateDailyHours(daySchedules);

                return (
                  <div key={key} className="card">
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem', paddingBottom: '1rem', borderBottom: '1px solid #ddd' }}>
                      <div>
                        <h4 style={{ margin: 0 }}>
                          {isRecurring ? 'Every ' : ''}{dayOrDate}
                        </h4>
                        <small>{dailyHours} hours total</small>
                      </div>
                      {isRecurring && <span className="badge badge-info">Recurring</span>}
                    </div>

                    <div style={{ display: 'grid', gap: '0.75rem' }}>
                      {daySchedules.map(schedule => (
                        <div key={schedule.id} style={{ 
                          padding: '1rem',
                          background: '#f9f9f9',
                          borderRadius: '6px',
                          display: 'flex',
                          justifyContent: 'space-between',
                          alignItems: 'center'
                        }}>
                          <div>
                            <strong>{schedule.start_time} - {schedule.end_time}</strong>
                            <div>{getClientName(schedule.client_id)}</div>
                            {schedule.notes && <small style={{ color: '#666' }}>{schedule.notes}</small>}
                          </div>
                          <button
                            className="btn btn-sm btn-danger"
                            onClick={() => handleDeleteSchedule(schedule.id)}
                          >
                            Delete
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default SchedulesManagement;
