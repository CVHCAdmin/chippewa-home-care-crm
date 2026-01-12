// src/components/admin/CaregiverProfile.jsx
import React, { useState, useEffect } from 'react';
import { API_BASE_URL } from '../../config';

const CaregiverProfile = ({ caregiverId, token, onBack }) => {
  const [caregiver, setCaregiver] = useState(null);
  const [profile, setProfile] = useState(null);
  const [certifications, setCertifications] = useState([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [editingCerts, setEditingCerts] = useState(false);
  const [message, setMessage] = useState('');
  const [formData, setFormData] = useState({
    notes: '',
    capabilities: '',
    limitations: '',
    availableDaysOfWeek: [],
    preferredHours: '',
  });
  const [newCert, setNewCert] = useState({
    certificationName: '',
    issuedDate: '',
    expirationDate: '',
    certificationNumber: '',
    issuer: ''
  });

  useEffect(() => {
    loadCaregiverData();
  }, [caregiverId]);

  const loadCaregiverData = async () => {
    try {
      const [caregiverRes, profileRes, certsRes] = await Promise.all([
        fetch(`${API_BASE_URL}/api/users/caregivers/${caregiverId}`, {
          headers: { 'Authorization': `Bearer ${token}` }
        }),
        fetch(`${API_BASE_URL}/api/caregiver-profile/${caregiverId}`, {
          headers: { 'Authorization': `Bearer ${token}` }
        }),
        fetch(`${API_BASE_URL}/api/caregivers/${caregiverId}/certifications`, {
          headers: { 'Authorization': `Bearer ${token}` }
        })
      ]);

      const caregiverData = await caregiverRes.json();
      const profileData = await profileRes.json();
      const certsData = await certsRes.json();

      setCaregiver(caregiverData);
      setProfile(profileData);
      setCertifications(Array.isArray(certsData) ? certsData : []);
      setFormData({
        notes: profileData?.notes || '',
        capabilities: profileData?.capabilities || '',
        limitations: profileData?.limitations || '',
        availableDaysOfWeek: profileData?.available_days_of_week || [],
        preferredHours: profileData?.preferred_hours || '',
      });
    } catch (error) {
      console.error('Failed to load caregiver data:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleSaveProfile = async () => {
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

      setMessage('Profile updated');
      setTimeout(() => setMessage(''), 2000);
      setEditing(false);
      loadCaregiverData();
    } catch (error) {
      setMessage('Error: ' + error.message);
    }
  };

  const handleAddCertification = async (e) => {
    e.preventDefault();

    if (!newCert.certificationName || !newCert.issuedDate || !newCert.expirationDate) {
      setMessage('Certification name, issued date, and expiration date are required');
      return;
    }

    try {
      const response = await fetch(`${API_BASE_URL}/api/caregivers/${caregiverId}/certifications`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify(newCert)
      });

      if (!response.ok) throw new Error('Failed to add certification');

      setMessage('Certification added');
      setTimeout(() => setMessage(''), 2000);
      setNewCert({
        certificationName: '',
        issuedDate: '',
        expirationDate: '',
        certificationNumber: '',
        issuer: ''
      });
      setEditingCerts(false);
      loadCaregiverData();
    } catch (error) {
      setMessage('Error: ' + error.message);
    }
  };

  const handleDeleteCertification = async (certId) => {
    if (!window.confirm('Delete this certification?')) return;

    try {
      const response = await fetch(`${API_BASE_URL}/api/certifications/${certId}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${token}` }
      });

      if (!response.ok) throw new Error('Failed to delete');

      setMessage('Certification deleted');
      setTimeout(() => setMessage(''), 2000);
      loadCaregiverData();
    } catch (error) {
      setMessage('Error: ' + error.message);
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

  const isExpiringSoon = (expirationDate) => {
    const expDate = new Date(expirationDate);
    const today = new Date();
    const daysUntilExpire = Math.floor((expDate - today) / (1000 * 60 * 60 * 24));
    return daysUntilExpire < 90 && daysUntilExpire >= 0;
  };

  const isExpired = (expirationDate) => {
    const expDate = new Date(expirationDate);
    const today = new Date();
    return expDate < today;
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
        <button className="btn btn-secondary" onClick={onBack}>Back</button>
        <h2>{caregiver.first_name} {caregiver.last_name}</h2>
        <button 
          className="btn btn-primary"
          onClick={() => setEditing(!editing)}
        >
          {editing ? 'Done' : 'Edit'}
        </button>
      </div>

      {message && (
        <div className={`alert ${message.includes('Error') ? 'alert-error' : 'alert-success'}`}>
          {message}
        </div>
      )}

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
          <p><strong>Active:</strong> {caregiver.is_active ? 'Yes' : 'No'}</p>
        </div>
      </div>

      {/* Certifications Section */}
      <div className="card">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem', paddingBottom: '1rem', borderBottom: '1px solid #ddd' }}>
          <h3 style={{ margin: 0 }}>Certifications & Credentials</h3>
          <button
            className="btn btn-sm btn-primary"
            onClick={() => setEditingCerts(!editingCerts)}
          >
            {editingCerts ? 'Cancel' : 'Add Certification'}
          </button>
        </div>

        {editingCerts && (
          <form onSubmit={handleAddCertification} style={{ marginBottom: '1.5rem', paddingBottom: '1.5rem', borderBottom: '1px solid #ddd' }}>
            <h4>Add New Certification</h4>
            <div className="form-grid-2">
              <div className="form-group">
                <label>Certification Name *</label>
                <input
                  type="text"
                  value={newCert.certificationName}
                  onChange={(e) => setNewCert({ ...newCert, certificationName: e.target.value })}
                  placeholder="e.g., CNA, LPN, RN, CPR, First Aid"
                  required
                />
              </div>

              <div className="form-group">
                <label>Issuer / Organization</label>
                <input
                  type="text"
                  value={newCert.issuer}
                  onChange={(e) => setNewCert({ ...newCert, issuer: e.target.value })}
                  placeholder="e.g., American Red Cross"
                />
              </div>

              <div className="form-group">
                <label>Certification Number</label>
                <input
                  type="text"
                  value={newCert.certificationNumber}
                  onChange={(e) => setNewCert({ ...newCert, certificationNumber: e.target.value })}
                  placeholder="License or cert number"
                />
              </div>

              <div className="form-group">
                <label>Issued Date *</label>
                <input
                  type="date"
                  value={newCert.issuedDate}
                  onChange={(e) => setNewCert({ ...newCert, issuedDate: e.target.value })}
                  required
                />
              </div>

              <div className="form-group">
                <label>Expiration Date *</label>
                <input
                  type="date"
                  value={newCert.expirationDate}
                  onChange={(e) => setNewCert({ ...newCert, expirationDate: e.target.value })}
                  required
                />
              </div>
            </div>

            <div className="form-actions">
              <button type="submit" className="btn btn-primary">Add Certification</button>
              <button type="button" className="btn btn-secondary" onClick={() => setEditingCerts(false)}>Cancel</button>
            </div>
          </form>
        )}

        {certifications.length === 0 ? (
          <p style={{ color: '#999', textAlign: 'center', padding: '1rem' }}>No certifications recorded.</p>
        ) : (
          <div style={{ display: 'grid', gap: '1rem' }}>
            {certifications.map(cert => {
              const expired = isExpired(cert.expiration_date);
              const expiringSoon = isExpiringSoon(cert.expiration_date);

              return (
                <div
                  key={cert.id}
                  style={{
                    padding: '1rem',
                    background: expired ? '#fff3cd' : expiringSoon ? '#fff9e6' : '#f9f9f9',
                    border: `1px solid ${expired ? '#ffc107' : expiringSoon ? '#ffeb3b' : '#ddd'}`,
                    borderRadius: '6px'
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'start', marginBottom: '0.5rem' }}>
                    <div>
                      <strong>{cert.certification_name}</strong>
                      {cert.issuer && <div style={{ fontSize: '0.85rem', color: '#666' }}>Issuer: {cert.issuer}</div>}
                      {cert.certification_number && <div style={{ fontSize: '0.85rem', color: '#666' }}>Cert #: {cert.certification_number}</div>}
                    </div>
                    <div style={{ display: 'flex', gap: '0.5rem' }}>
                      {expired && <span className="badge" style={{ background: '#dc3545' }}>EXPIRED</span>}
                      {expiringSoon && !expired && <span className="badge" style={{ background: '#ffc107', color: 'black' }}>EXPIRING SOON</span>}
                      <button
                        className="btn btn-sm btn-danger"
                        onClick={() => handleDeleteCertification(cert.id)}
                      >
                        Delete
                      </button>
                    </div>
                  </div>

                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem', fontSize: '0.9rem' }}>
                    <div>
                      <strong>Issued:</strong> {new Date(cert.issued_date).toLocaleDateString()}
                    </div>
                    <div>
                      <strong>Expires:</strong> {new Date(cert.expiration_date).toLocaleDateString()}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Profile Editing */}
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
            <label>General Notes</label>
            <textarea
              value={formData.notes}
              onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
              placeholder="Any other relevant information..."
              rows="4"
            ></textarea>
          </div>

          <div className="form-actions">
            <button className="btn btn-primary" onClick={handleSaveProfile}>Save Changes</button>
            <button className="btn btn-secondary" onClick={() => setEditing(false)}>Cancel</button>
          </div>
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
