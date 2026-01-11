// src/components/admin/SchedulesManagement.jsx
import React, { useState, useEffect } from 'react';
import { getCaregivers, getSchedules, createSchedule } from '../../config';

const SchedulesManagement = ({ token }) => {
  const [caregivers, setCaregivers] = useState([]);
  const [selectedCaregiverId, setSelectedCaregiverId] = useState('');
  const [schedules, setSchedules] = useState([]);
  const [showForm, setShowForm] = useState(false);
  const [loading, setLoading] = useState(true);
  const [formData, setFormData] = useState({
    caregiverId: '',
    dayOfWeek: '',
    date: '',
    startTime: '08:00',
    endTime: '17:00',
    maxHours: 40
  });

  useEffect(() => {
    loadCaregivers();
  }, []);

  const loadCaregivers = async () => {
    try {
      const data = await getCaregivers(token);
      setCaregivers(data);
      setLoading(false);
    } catch (error) {
      console.error('Failed to load caregivers:', error);
      setLoading(false);
    }
  };

  const loadSchedules = async (caregiverId) => {
    if (!caregiverId) return;
    try {
      const data = await getSchedules(caregiverId, token);
      setSchedules(data);
    } catch (error) {
      console.error('Failed to load schedules:', error);
    }
  };

  const handleCaregiverSelect = (caregiverId) => {
    setSelectedCaregiverId(caregiverId);
    setFormData({ ...formData, caregiverId });
    loadSchedules(caregiverId);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    try {
      await createSchedule(formData, token);
      setShowForm(false);
      setFormData({
        caregiverId: selectedCaregiverId,
        dayOfWeek: '',
        date: '',
        startTime: '08:00',
        endTime: '17:00',
        maxHours: 40
      });
      loadSchedules(selectedCaregiverId);
      alert('Schedule created successfully!');
    } catch (error) {
      alert('Failed to create schedule: ' + error.message);
    }
  };

  return (
    <div>
      <h2>📅 Caregiver Schedules</h2>

      {/* Caregiver Selection */}
      <div className="card schedule-selection">
        <label className="schedule-label">
          Select Caregiver to View/Edit Schedule:
        </label>
        <select
          value={selectedCaregiverId}
          onChange={(e) => handleCaregiverSelect(e.target.value)}
          className="schedule-select"
        >
          <option value="">Select a caregiver...</option>
          {caregivers.map(cg => (
            <option key={cg.id} value={cg.id}>
              {cg.first_name} {cg.last_name}
            </option>
          ))}
        </select>

        {selectedCaregiverId && (
          <button 
            className="btn btn-primary"
            onClick={() => setShowForm(!showForm)}
          >
            {showForm ? '✕ Cancel' : '➕ Add Schedule'}
          </button>
        )}
      </div>

      {/* Add Schedule Form */}
      {showForm && selectedCaregiverId && (
        <div className="card card-form">
          <h3>Add Schedule</h3>
          <form onSubmit={handleSubmit}>
            <div className="form-grid">
              <div className="form-group">
                <label>Recurring Schedule (Day of Week)</label>
                <select
                  value={formData.dayOfWeek}
                  onChange={(e) => setFormData({ ...formData, dayOfWeek: e.target.value, date: '' })}
                >
                  <option value="">Select day of week...</option>
                  <option value="0">Sunday</option>
                  <option value="1">Monday</option>
                  <option value="2">Tuesday</option>
                  <option value="3">Wednesday</option>
                  <option value="4">Thursday</option>
                  <option value="5">Friday</option>
                  <option value="6">Saturday</option>
                </select>
              </div>

              <div className="form-group">
                <label>Or Specific Date</label>
                <input
                  type="date"
                  value={formData.date}
                  onChange={(e) => setFormData({ ...formData, date: e.target.value, dayOfWeek: '' })}
                />
              </div>

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

              <div className="form-group">
                <label>Max Hours Per Week</label>
                <input
                  type="number"
                  value={formData.maxHours}
                  onChange={(e) => setFormData({ ...formData, maxHours: parseInt(e.target.value) })}
                />
              </div>
            </div>

            <div className="form-actions">
              <button type="submit" className="btn btn-primary">Create Schedule</button>
              <button type="button" className="btn btn-secondary" onClick={() => setShowForm(false)}>Cancel</button>
            </div>
          </form>
        </div>
      )}

      {/* Schedules List */}
      {selectedCaregiverId && (
        <div className="card">
          <h3>Current Schedules</h3>
          
          {schedules.length === 0 ? (
            <p className="card-empty-state">No schedules yet for this caregiver.</p>
          ) : (
            <table className="table">
              <thead>
                <tr>
                  <th>Type</th>
                  <th>Date/Day</th>
                  <th>Time</th>
                  <th>Max Hours</th>
                  <th>Availability</th>
                </tr>
              </thead>
              <tbody>
                {schedules.map(schedule => (
                  <tr key={schedule.id}>
                    <td>{schedule.day_of_week !== null ? 'Recurring' : 'One-time'}</td>
                    <td>
                      {schedule.day_of_week !== null
                        ? ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][schedule.day_of_week]
                        : new Date(schedule.date).toLocaleDateString()}
                    </td>
                    <td>{schedule.start_time} - {schedule.end_time}</td>
                    <td>{schedule.max_hours_per_week} hrs</td>
                    <td>
                      <span className={`badge ${schedule.is_available ? 'badge-success' : 'badge-danger'}`}>
                        {schedule.is_available ? 'Available' : 'Unavailable'}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  );
};

export default SchedulesManagement;
