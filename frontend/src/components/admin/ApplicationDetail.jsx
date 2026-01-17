// src/components/admin/ApplicationDetail.jsx
import React, { useState, useEffect } from 'react';
import { API_BASE_URL } from '../../config';

const ApplicationDetail = ({ applicationId, token, onBack }) => {
  const [app, setApp] = useState(null);
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState('');
  const [interviewNotes, setInterviewNotes] = useState('');
  const [hiring, setHiring] = useState(false);
  const [message, setMessage] = useState('');

  useEffect(() => {
    loadApplication();
  }, [applicationId]);

  const loadApplication = async () => {
    try {
      const response = await fetch(`${API_BASE_URL}/api/applications/${applicationId}`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      const data = await response.json();
      setApp(data);
      setStatus(data.status);
      setInterviewNotes(data.interview_notes || '');
    } catch (error) {
      console.error('Failed to load application:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleUpdateStatus = async (newStatus) => {
    try {
      const response = await fetch(`${API_BASE_URL}/api/applications/${applicationId}/status`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          status: newStatus,
          notes: interviewNotes
        })
      });

      if (!response.ok) throw new Error('Failed to update');
      
      setStatus(newStatus);
      setMessage(`Status updated to ${newStatus}`);
      setTimeout(() => setMessage(''), 2000);
      loadApplication();
    } catch (error) {
      alert('Failed to update: ' + error.message);
    }
  };

  const handleSaveNotes = async () => {
    try {
      const response = await fetch(`${API_BASE_URL}/api/applications/${applicationId}/notes`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ notes: interviewNotes })
      });

      if (!response.ok) throw new Error('Failed to save notes');
      
      setMessage('Notes saved');
      setTimeout(() => setMessage(''), 2000);
    } catch (error) {
      alert('Failed to save notes: ' + error.message);
    }
  };

  const handleHireApplicant = async () => {
    if (!window.confirm('Convert this applicant to a caregiver account?')) return;

    setHiring(true);
    try {
      const response = await fetch(`${API_BASE_URL}/api/applications/${applicationId}/hire`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          hourlyRate: 15.00
        })
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Failed to hire');
      }

      setMessage('✓ Applicant hired and caregiver account created!');
      setTimeout(() => onBack(), 2000);
    } catch (error) {
      alert('Failed to hire: ' + error.message);
    } finally {
      setHiring(false);
    }
  };

  if (loading) {
    return <div className="loading"><div className="spinner"></div></div>;
  }

  if (!app) {
    return <div className="card card-centered"><p>Application not found</p></div>;
  }

  // Parse certifications from comma-separated string
  const certifications = app.certifications ? app.certifications.split(',').map(c => c.trim()).filter(Boolean) : [];
  
  // Parse availability days
  const availabilityDays = app.availability_days ? app.availability_days.split(',').map(d => d.trim()).filter(Boolean) : [];
  
  // Parse shifts
  const shifts = app.availability_shifts ? app.availability_shifts.split(',').map(s => s.trim()).filter(Boolean) : [];

  return (
    <div>
      <div className="page-header">
        <button className="btn btn-secondary" onClick={onBack}>← Back</button>
        <h2>{app.first_name} {app.last_name}</h2>
        <span className={`badge ${
          app.status === 'hired' ? 'badge-success' :
          app.status === 'rejected' ? 'badge-danger' :
          'badge-warning'
        }`}>{app.status?.toUpperCase()}</span>
      </div>

      {message && <div className="alert alert-success">{message}</div>}

      <div className="grid" style={{ gridTemplateColumns: '1fr 1fr' }}>
        {/* Contact Info */}
        <div className="card">
          <h3>Contact Information</h3>
          <p><strong>Email:</strong> <a href={`mailto:${app.email}`}>{app.email}</a></p>
          <p><strong>Phone:</strong> <a href={`tel:${app.phone}`}>{app.phone}</a></p>
          {app.date_of_birth && <p><strong>DOB:</strong> {new Date(app.date_of_birth).toLocaleDateString()}</p>}
          {app.address && <p><strong>Address:</strong> {app.address}, {app.city}, {app.state} {app.zip}</p>}
          <p><strong>Applied:</strong> {new Date(app.created_at).toLocaleDateString()}</p>
        </div>

        {/* Experience */}
        <div className="card">
          <h3>Experience</h3>
          {app.years_experience && <p><strong>Years:</strong> {app.years_experience} years</p>}
          {app.cna_license && <p><strong>CNA License:</strong> {app.cna_license}</p>}
          {app.previous_employer && (
            <div className="experience-item">
              <p><strong>Previous Employer:</strong> {app.previous_employer}</p>
              {app.reason_for_leaving && <p><strong>Reason for Leaving:</strong> {app.reason_for_leaving}</p>}
            </div>
          )}
        </div>
      </div>

      {/* Certifications */}
      {certifications.length > 0 && (
        <div className="card">
          <h3>Certifications</h3>
          <div className="cert-badges">
            {certifications.map(cert => (
              <span key={cert} className="badge badge-success" style={{ marginRight: '0.5rem' }}>{cert}</span>
            ))}
          </div>
        </div>
      )}

      {/* Eligibility */}
      <div className="card">
        <h3>Eligibility</h3>
        <div className="grid" style={{ gridTemplateColumns: '1fr 1fr 1fr' }}>
          <p><strong>Driver's License:</strong> {app.has_drivers_license ? '✓ Yes' : '✗ No'}</p>
          <p><strong>Transportation:</strong> {app.has_transportation ? '✓ Yes' : '✗ No'}</p>
          <p><strong>Legal to Work:</strong> {app.legal_to_work ? '✓ Yes' : '✗ No'}</p>
          <p><strong>Background Check:</strong> {app.willing_background_check ? '✓ Yes' : '✗ No'}</p>
          <p><strong>Felony:</strong> {app.felony_conviction ? 'Yes' : 'No'}</p>
        </div>
        {app.felony_conviction && app.felony_explanation && (
          <p style={{ marginTop: '1rem' }}><strong>Felony Explanation:</strong> {app.felony_explanation}</p>
        )}
      </div>

      {/* References */}
      <div className="card">
        <h3>Professional References</h3>
        <div className="grid" style={{ gridTemplateColumns: '1fr 1fr' }}>
          {app.ref1_name && (
            <div className="reference-item">
              <p><strong>{app.ref1_name}</strong> ({app.ref1_relationship})</p>
              <p>Phone: <a href={`tel:${app.ref1_phone}`}>{app.ref1_phone}</a></p>
              {app.ref1_email && <p>Email: <a href={`mailto:${app.ref1_email}`}>{app.ref1_email}</a></p>}
            </div>
          )}
          {app.ref2_name && (
            <div className="reference-item">
              <p><strong>{app.ref2_name}</strong> ({app.ref2_relationship})</p>
              <p>Phone: <a href={`tel:${app.ref2_phone}`}>{app.ref2_phone}</a></p>
              {app.ref2_email && <p>Email: <a href={`mailto:${app.ref2_email}`}>{app.ref2_email}</a></p>}
            </div>
          )}
        </div>
        {!app.ref1_name && !app.ref2_name && <p style={{ color: '#666' }}>No references provided</p>}
      </div>

      {/* Availability & Expectations */}
      <div className="grid" style={{ gridTemplateColumns: '1fr 1fr' }}>
        <div className="card">
          <h3>Availability</h3>
          {availabilityDays.length > 0 && (
            <p><strong>Days:</strong> {availabilityDays.join(', ')}</p>
          )}
          {shifts.length > 0 && (
            <p><strong>Shifts:</strong> {shifts.join(', ')}</p>
          )}
          {app.hours_desired && <p><strong>Hours Desired:</strong> {app.hours_desired}</p>}
          {app.earliest_start_date && (
            <p><strong>Can Start:</strong> {new Date(app.earliest_start_date).toLocaleDateString()}</p>
          )}
        </div>

        <div className="card">
          <h3>Additional Information</h3>
          {app.why_interested && (
            <div>
              <p><strong>Why Interested:</strong></p>
              <p style={{ color: '#666' }}>{app.why_interested}</p>
            </div>
          )}
          {app.additional_info && (
            <div style={{ marginTop: '1rem' }}>
              <p><strong>Additional Notes:</strong></p>
              <p style={{ color: '#666' }}>{app.additional_info}</p>
            </div>
          )}
        </div>
      </div>

      {/* Interview Notes */}
      <div className="card">
        <h3>Interview Notes</h3>
        <textarea
          value={interviewNotes}
          onChange={(e) => setInterviewNotes(e.target.value)}
          placeholder="Add interview observations, concerns, or recommendations..."
          rows="5"
          style={{ width: '100%', marginBottom: '1rem' }}
        ></textarea>
        <button className="btn btn-secondary" onClick={handleSaveNotes}>Save Notes</button>
      </div>

      {/* Status & Actions */}
      <div className="card">
        <h3>Application Status</h3>
        <div className="status-buttons" style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
          {['new', 'reviewing', 'interviewed', 'offered', 'hired', 'rejected'].map(s => (
            <button
              key={s}
              className={`btn ${status === s ? 'btn-primary' : 'btn-secondary'}`}
              onClick={() => handleUpdateStatus(s)}
              disabled={s === status}
            >
              {s.charAt(0).toUpperCase() + s.slice(1)}
            </button>
          ))}
        </div>

        {status === 'offered' && (
          <div style={{ marginTop: '1rem' }}>
            <button
              className="btn btn-success btn-large"
              onClick={handleHireApplicant}
              disabled={hiring}
              style={{ padding: '1rem 2rem', fontSize: '1.1rem' }}
            >
              {hiring ? 'Creating account...' : '✓ Hire & Create Account'}
            </button>
            <p style={{ color: '#666', fontSize: '0.9rem', marginTop: '0.5rem' }}>
              This will create a caregiver user account and copy application data to their profile.
            </p>
          </div>
        )}
      </div>
    </div>
  );
};

export default ApplicationDetail;
