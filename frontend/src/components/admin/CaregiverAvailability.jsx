// src/components/admin/CaregiverAvailability.jsx
import React, { useState, useEffect } from 'react';
import { API_BASE_URL } from '../../config';

const CaregiverAvailability = ({ token }) => {
  const [caregivers, setCaregivers] = useState([]);
  const [selectedCaregiverId, setSelectedCaregiverId] = useState('');
  const [availability, setAvailability] = useState(null);
  const [blackoutDates, setBlackoutDates] = useState([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState('');
  const [showBlackoutForm, setShowBlackoutForm] = useState(false);
  const [newBlackoutDate, setNewBlackoutDate] = useState({
    startDate: '',
    endDate: '',
    reason: ''
  });
  const [formData, setFormData] = useState({
    status: 'available',
    maxHoursPerWeek: 40,
    mondayAvailable: true,
    mondayStartTime: '08:00',
    mondayEndTime: '17:00',
    tuesdayAvailable: true,
    tuesdayStartTime: '08:00',
    tuesdayEndTime: '17:00',
    wednesdayAvailable: true,
    wednesdayStartTime: '08:00',
    wednesdayEndTime: '17:00',
    thursdayAvailable: true,
    thursdayStartTime: '08:00',
    thursdayEndTime: '17:00',
    fridayAvailable: true,
    fridayStartTime: '08:00',
    fridayEndTime: '17:00',
    saturdayAvailable: false,
    saturdayStartTime: '08:00',
    saturdayEndTime: '17:00',
    sundayAvailable: false,
    sundayStartTime: '08:00',
    sundayEndTime: '17:00',
  });

  const days = [
    { key: 'monday', label: 'Monday' },
    { key: 'tuesday', label: 'Tuesday' },
    { key: 'wednesday', label: 'Wednesday' },
    { key: 'thursday', label: 'Thursday' },
    { key: 'friday', label: 'Friday' },
    { key: 'saturday', label: 'Saturday' },
    { key: 'sunday', label: 'Sunday' }
  ];

  useEffect(() => {
    loadCaregivers();
  }, []);

  const loadCaregivers = async () => {
    try {
      const response = await fetch(`${API_BASE_URL}/api/users/caregivers`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      const data = await response.json();
      setCaregivers(data);
      setLoading(false);
    } catch (error) {
      console.error('Failed to load caregivers:', error);
      setLoading(false);
    }
  };

  const handleCaregiverSelect = async (caregiverId) => {
    setSelectedCaregiverId(caregiverId);
    setMessage('');
    
    try {
      const [availRes, blackoutRes] = await Promise.all([
        fetch(`${API_BASE_URL}/api/caregivers/${caregiverId}/availability`, {
          headers: { 'Authorization': `Bearer ${token}` }
        }),
        fetch(`${API_BASE_URL}/api/caregivers/${caregiverId}/blackout-dates`, {
          headers: { 'Authorization': `Bearer ${token}` }
        })
      ]);

      const availData = await availRes.json();
      const blackoutData = await blackoutRes.json();

      if (availData) {
        setFormData({
          status: availData.status || 'available',
          maxHoursPerWeek: availData.max_hours_per_week || 40,
          mondayAvailable: availData.monday_available !== false,
          mondayStartTime: availData.monday_start_time || '08:00',
          mondayEndTime: availData.monday_end_time || '17:00',
          tuesdayAvailable: availData.tuesday_available !== false,
          tuesdayStartTime: availData.tuesday_start_time || '08:00',
          tuesdayEndTime: availData.tuesday_end_time || '17:00',
          wednesdayAvailable: availData.wednesday_available !== false,
          wednesdayStartTime: availData.wednesday_start_time || '08:00',
          wednesdayEndTime: availData.wednesday_end_time || '17:00',
          thursdayAvailable: availData.thursday_available !== false,
          thursdayStartTime: availData.thursday_start_time || '08:00',
          thursdayEndTime: availData.thursday_end_time || '17:00',
          fridayAvailable: availData.friday_available !== false,
          fridayStartTime: availData.friday_start_time || '08:00',
          fridayEndTime: availData.friday_end_time || '17:00',
          saturdayAvailable: availData.saturday_available || false,
          saturdayStartTime: availData.saturday_start_time || '08:00',
          saturdayEndTime: availData.saturday_end_time || '17:00',
          sundayAvailable: availData.sunday_available || false,
          sundayStartTime: availData.sunday_start_time || '08:00',
          sundayEndTime: availData.sunday_end_time || '17:00',
        });
        setAvailability(availData);
      }

      setBlackoutDates(Array.isArray(blackoutData) ? blackoutData : []);
    } catch (error) {
      console.error('Failed to load availability:', error);
    }
  };

  const handleSaveAvailability = async () => {
    try {
      const response = await fetch(`${API_BASE_URL}/api/caregivers/${selectedCaregiverId}/availability`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify(formData)
      });

      if (!response.ok) throw new Error('Failed to save availability');

      setMessage('Availability updated successfully!');
      setTimeout(() => setMessage(''), 2000);
    } catch (error) {
      setMessage('Error: ' + error.message);
    }
  };

  const handleAddBlackoutDate = async (e) => {
    e.preventDefault();
    
    if (!newBlackoutDate.startDate || !newBlackoutDate.endDate) {
      setMessage('Start and end dates are required');
      return;
    }

    try {
      const response = await fetch(`${API_BASE_URL}/api/caregivers/${selectedCaregiverId}/blackout-dates`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify(newBlackoutDate)
      });

      if (!response.ok) throw new Error('Failed to add blackout date');

      setMessage('Blackout date added');
      setTimeout(() => setMessage(''), 2000);
      setNewBlackoutDate({ startDate: '', endDate: '', reason: '' });
      setShowBlackoutForm(false);
      handleCaregiverSelect(selectedCaregiverId);
    } catch (error) {
      setMessage('Error: ' + error.message);
    }
  };

  const handleDeleteBlackoutDate = async (dateId) => {
    if (!window.confirm('Delete this blackout date?')) return;

    try {
      const response = await fetch(`${API_BASE_URL}/api/blackout-dates/${dateId}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${token}` }
      });

      if (!response.ok) throw new Error('Failed to delete');

      setMessage('Blackout date deleted');
      setTimeout(() => setMessage(''), 2000);
      handleCaregiverSelect(selectedCaregiverId);
    } catch (error) {
      setMessage('Error: ' + error.message);
    }
  };

  const getCaregiverName = (caregiverId) => {
    const cg = caregivers.find(c => c.id === caregiverId);
    return cg ? `${cg.first_name} ${cg.last_name}` : '';
  };

  if (loading) {
    return (
      <div className="loading">
        <div className="spinner"></div>
      </div>
    );
  }

  return (
    <div>
      <div className="page-header">
        <h2>Caregiver Availability Management</h2>
      </div>

      {message && (
        <div className={`alert ${message.includes('Error') ? 'alert-error' : 'alert-success'}`}>
          {message}
        </div>
      )}

      {/* Caregiver Selection */}
      <div className="card">
        <h3>Select Caregiver</h3>
        <select
          value={selectedCaregiverId}
          onChange={(e) => handleCaregiverSelect(e.target.value)}
          style={{ width: '100%', padding: '0.75rem', fontSize: '1rem', borderRadius: '4px', border: '1px solid #ddd' }}
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
        <>
          {/* Status and Max Hours */}
          <div className="card">
            <h3>Status & Capacity</h3>
            <div className="form-grid-2">
              <div className="form-group">
                <label>Employment Status</label>
                <select
                  value={formData.status}
                  onChange={(e) => setFormData({ ...formData, status: e.target.value })}
                >
                  <option value="available">Available</option>
                  <option value="on_call">On-Call</option>
                  <option value="medical_leave">Medical Leave</option>
                  <option value="vacation">Vacation</option>
                  <option value="unavailable">Unavailable</option>
                </select>
              </div>

              <div className="form-group">
                <label>Maximum Hours Per Week</label>
                <input
                  type="number"
                  value={formData.maxHoursPerWeek}
                  onChange={(e) => setFormData({ ...formData, maxHoursPerWeek: parseInt(e.target.value) })}
                  min="0"
                  step="5"
                />
              </div>
            </div>
          </div>

          {/* Weekly Availability */}
          <div className="card">
            <h3>Weekly Availability</h3>
            <p style={{ color: '#666', marginBottom: '1rem' }}>
              Set the days and hours {getCaregiverName(selectedCaregiverId)} is available each week
            </p>

            <div style={{ display: 'grid', gap: '1rem' }}>
              {days.map(day => {
                const availKey = `${day.key}Available`;
                const startKey = `${day.key}StartTime`;
                const endKey = `${day.key}EndTime`;

                return (
                  <div key={day.key} style={{ padding: '1rem', background: '#f9f9f9', borderRadius: '4px' }}>
                    <label style={{ display: 'flex', alignItems: 'center', gap: '1rem', marginBottom: '0.75rem', cursor: 'pointer' }}>
                      <input
                        type="checkbox"
                        checked={formData[availKey]}
                        onChange={(e) => setFormData({ ...formData, [availKey]: e.target.checked })}
                        style={{ cursor: 'pointer' }}
                      />
                      <strong style={{ flex: 1 }}>{day.label}</strong>
                    </label>

                    {formData[availKey] && (
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', marginLeft: '1.5rem' }}>
                        <div className="form-group">
                          <label>Start Time</label>
                          <input
                            type="time"
                            value={formData[startKey]}
                            onChange={(e) => setFormData({ ...formData, [startKey]: e.target.value })}
                          />
                        </div>
                        <div className="form-group">
                          <label>End Time</label>
                          <input
                            type="time"
                            value={formData[endKey]}
                            onChange={(e) => setFormData({ ...formData, [endKey]: e.target.value })}
                          />
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            <button
              className="btn btn-primary"
              onClick={handleSaveAvailability}
              style={{ marginTop: '1.5rem' }}
            >
              Save Availability
            </button>
          </div>

          {/* Blackout Dates */}
          <div className="card">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem', paddingBottom: '1rem', borderBottom: '1px solid #ddd' }}>
              <h3 style={{ margin: 0 }}>Blackout Dates (Unavailable)</h3>
              <button
                className="btn btn-sm btn-primary"
                onClick={() => setShowBlackoutForm(!showBlackoutForm)}
              >
                {showBlackoutForm ? 'Cancel' : 'Add Blackout'}
              </button>
            </div>

            {showBlackoutForm && (
              <form onSubmit={handleAddBlackoutDate} style={{ marginBottom: '1.5rem', paddingBottom: '1.5rem', borderBottom: '1px solid #ddd' }}>
                <div className="form-grid-2">
                  <div className="form-group">
                    <label>Start Date *</label>
                    <input
                      type="date"
                      value={newBlackoutDate.startDate}
                      onChange={(e) => setNewBlackoutDate({ ...newBlackoutDate, startDate: e.target.value })}
                      required
                    />
                  </div>

                  <div className="form-group">
                    <label>End Date *</label>
                    <input
                      type="date"
                      value={newBlackoutDate.endDate}
                      onChange={(e) => setNewBlackoutDate({ ...newBlackoutDate, endDate: e.target.value })}
                      required
                    />
                  </div>

                  <div className="form-group" style={{ gridColumn: '1 / -1' }}>
                    <label>Reason</label>
                    <input
                      type="text"
                      value={newBlackoutDate.reason}
                      onChange={(e) => setNewBlackoutDate({ ...newBlackoutDate, reason: e.target.value })}
                      placeholder="e.g., Vacation, Medical, Conference"
                    />
                  </div>
                </div>

                <div className="form-actions">
                  <button type="submit" className="btn btn-primary">Add Blackout Date</button>
                  <button type="button" className="btn btn-secondary" onClick={() => setShowBlackoutForm(false)}>Cancel</button>
                </div>
              </form>
            )}

            {blackoutDates.length === 0 ? (
              <p style={{ color: '#999', textAlign: 'center', padding: '1rem' }}>
                No blackout dates scheduled.
              </p>
            ) : (
              <div style={{ display: 'grid', gap: '0.75rem' }}>
                {blackoutDates
                  .sort((a, b) => new Date(a.start_date) - new Date(b.start_date))
                  .map(bd => (
                    <div
                      key={bd.id}
                      style={{
                        padding: '0.75rem',
                        background: '#ffe6e6',
                        borderLeft: '4px solid #d32f2f',
                        borderRadius: '4px',
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center'
                      }}
                    >
                      <div>
                        <strong>{new Date(bd.start_date).toLocaleDateString()} - {new Date(bd.end_date).toLocaleDateString()}</strong>
                        {bd.reason && <div style={{ fontSize: '0.9rem', color: '#666' }}>{bd.reason}</div>}
                      </div>
                      <button
                        className="btn btn-sm btn-danger"
                        onClick={() => handleDeleteBlackoutDate(bd.id)}
                      >
                        Delete
                      </button>
                    </div>
                  ))}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
};

export default CaregiverAvailability;
