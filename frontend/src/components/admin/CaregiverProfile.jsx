// src/components/admin/CaregiverProfile.jsx
import React, { useState, useEffect } from 'react';
import { API_BASE_URL } from '../../config';

const CaregiverProfile = ({ caregiverId, token, onBack }) => {
  const [caregiver, setCaregiver] = useState(null);
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [formData, setFormData] = useState({
    notes: '',
    capabilities: '',
    limitations: '',
    availableDaysOfWeek: [],
    preferredHours: '',
    certifications: ''
  });
  const [saveMessage, setSaveMessage] = useState('');

  useEffect(() => {
    loadCaregiverData();
  }, [caregiverId]);

  const loadCaregiverData = async () => {
    try {
      const [caregiverRes, profileRes] = await Promise.all([
        fetch(`${API_BASE_URL}/api/users/caregivers/${caregiverId}`, {
          headers: { 'Authorization': `Bearer ${token}` }
        }),
        fetch(`${API_BASE_URL}/api/caregiver-profile/${caregiverId}`, {
          headers: { 'Authorization': `Bearer ${token}` }
        })
      ]);

      const caregiverData = await caregiverRes.json();
      const profileData = await profileRes.json();

      setCaregiver(caregiverData);
      setProfile(profileData);
      setFormData({
        notes: profileData?.notes || '',
        capabilities: profileData?.capabilities || '',
        limitations: profileData?.limitations || '',
        availableDaysOfWeek: profileData?.available_days_of_week || [],
        preferredHours: profileData?.preferred_hours || '',
        certifications: profileData?.certifications || ''
      });
    } catch (error) {
      console.error('Failed to load caregiver data:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async () => {
    try {
      const response = await fetch(`${API_BASE_URL}/api/caregiver-profile/${caregiverId}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify(formData)
      });

      if (!response.ok) throw new Error('Failed to save');

      setSaveMessage('✓ Profile updated');
      setTimeout(() => setSaveMessage(''), 2000);
      setEditing(false);
      loadCaregiverData();
    } catch (error) {
      alert('Failed to save: ' + error.message);
    }
  };

  const toggleDay = (day) => {
    setFormData(prev => {
      const days = [...prev.availableDaysOfWeek];
      if (days.includes(day)) {
        return { ...prev, availableDaysOfWeek: days.filter(d => d !== day) };
      } else {
        return { ...prev, availableDaysOfWeek: [...days, day].sort() };
      }
    });
  };

  const dayLabels = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

  if (loading) {
    return (
      <div className="loading">
        <div className="spinner"></div>
      </div>
    );
  }

  if (!caregiver) {
    return <div className="card card-centered"><p>Caregiver not found</p></div>;
  }

  return (
    <div>
      <div className="page-header">
        <button className="btn btn-secondary" onClick={onBack}>← Back</button>
        <h2>👔 {caregiver.first_name} {caregiver.last_name}</h2>
        <button 
          className="btn btn-primary"
          onClick={() => setEditing(!editing)}
        >
          {editing ? '✓ Done' : '✏️ Edit'}
        </button>
      </div>

      {/* Basic Info */}
      <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))' }}>
        <div className="card">
          <h3>Contact Information</h3>
          <p><strong>Email:</strong> {caregiver.email}</p>
          <p><strong>Phone:</strong> {caregiver.phone || 'Not provided'}</p>
          <p><strong>Hire Date:</strong> {caregiver.hire_date ? new Date(caregiver.hire_date).toLocaleDateString() : 'N/A'}</p>
          <p><strong>Role:</strong> <span className="badge badge-info">{caregiver.role?.toUpperCase()}</span></p>
        </div>

        <div className="card">
          <h3>Status</h3>
          <p><strong>Active:</strong> {caregiver.is_active ? '✓ Yes' : '✗ No'}</p>
          <p><strong>Certifications:</strong> {caregiver.certifications || 'None listed'}</p>
        </div>
      </div>

      {/* Profile Details */}
      {editing ? (
        <div className="card card-form">
          <h3>Edit Caregiver Profile</h3>

          <div className="form-group">
            <label>What They Can Do *</label>
            <textarea
              value={formData.capabilities}
              onChange={(e) => setFormData({ ...formData, capabilities: e.target.value })}
              placeholder="Describe tasks and skills (e.g., medication management, meal prep, mobility assistance...)"
              rows="4"
            ></textarea>
          </div>

          <div className="form-group">
            <label>Limitations / Restrictions *</label>
            <textarea
              value={formData.limitations}
              onChange={(e) => setFormData({ ...formData, limitations: e.target.value })}
              placeholder="Any limitations or restrictions (e.g., cannot lift more than X pounds...)"
              rows="4"
            ></textarea>
          </div>

          <div className="form-group">
            <label>Available Days of Week *</label>
            <div className="availability-grid">
              {dayLabels.map((day, idx) => (
                <label key={day} className="checkbox-label">
                  <input
                    type="checkbox"
                    checked={formData.availableDaysOfWeek.includes(idx)}
                    onChange={() => toggleDay(idx)}
                    className="form-checkbox"
                  />
                  <span>{day}</span>
                </label>
              ))}
            </div>
          </div>

          <div className="form-group">
            <label>Preferred Hours</label>
            <input
              type="text"
              value={formData.preferredHours}
              onChange={(e) => setFormData({ ...formData, preferredHours: e.target.value })}
              placeholder="e.g., 8am-5pm, No early mornings, Weekends only..."
            />
          </div>

          <div className="form-group">
            <label>Certifications</label>
            <input
              type="text"
              value={formData.certifications}
              onChange={(e) => setFormData({ ...formData, certifications: e.target.value })}
              placeholder="e.g., CNA, CPR, First Aid..."
            />
          </div>

          <div className="form-group">
            <label>General Notes</label>
            <textarea
              value={formData.notes}
              onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
              placeholder="Any other relevant information..."
              rows="4"
            ></textarea>
          </div>

          <div className="form-actions">
            <button className="btn btn-primary" onClick={handleSave}>Save Changes</button>
            <button className="btn btn-secondary" onClick={() => setEditing(false)}>Cancel</button>
          </div>

          {saveMessage && <p className="success-message">{saveMessage}</p>}
        </div>
      ) : (
        <>
          {/* View Mode */}
          <div className="card">
            <h3>Capabilities</h3>
            <p>{formData.capabilities || 'Not specified'}</p>
          </div>

          <div className="card">
            <h3>Limitations</h3>
            <p>{formData.limitations || 'None specified'}</p>
          </div>

          <div className="card">
            <h3>Availability</h3>
            <div className="availability-display">
              <p><strong>Days Available:</strong></p>
              <div className="availability-badges">
                {formData.availableDaysOfWeek.length > 0 ? (
                  formData.availableDaysOfWeek.map(idx => (
                    <span key={idx} className="badge badge-success">{dayLabels[idx]}</span>
                  ))
                ) : (
                  <span className="badge badge-secondary">Not specified</span>
                )}
              </div>
              {formData.preferredHours && (
                <p><strong>Preferred Hours:</strong> {formData.preferredHours}</p>
              )}
            </div>
          </div>

          {formData.certifications && (
            <div className="card">
              <h3>Certifications</h3>
              <p>{formData.certifications}</p>
            </div>
          )}

          {formData.notes && (
            <div className="card">
              <h3>Notes</h3>
              <p>{formData.notes}</p>
            </div>
          )}
        </>
      )}
    </div>
  );
};

export default CaregiverProfile;
