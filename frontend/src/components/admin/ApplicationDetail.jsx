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
      const response = await fetch(`${API_BASE_URL}/api/applications/${applicationId}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          status: newStatus,
          interview_notes: interviewNotes
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
          interview_notes: interviewNotes
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

  const certs = [];
  if (app.has_cna) certs.push('CNA');
  if (app.has_lpn) certs.push('LPN');
  if (app.has_rn) certs.push('RN');
  if (app.has_cpr) certs.push('CPR');
  if (app.has_first_aid) certs.push('First Aid');

  return (
    <div>
      <div className="page-header">
        <button className="btn btn-secondary" onClick={onBack}>← Back</button>
        <h2>{app.first_name} {app.last_name}</h2>
        <span className={`badge ${
          app.status === 'hired' ? 'badge-success' :
          app.status === 'rejected' ? 'badge-danger' :
          'badge-warning'
        }`}>{app.status.toUpperCase()}</span>
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
          {app.years_of_experience && <p><strong>Years:</strong> {app.years_of_experience} years</p>}
          
          {app.previous_employer_1 && (
            <div className="experience-item">
              <p><strong>{app.previous_employer_1}</strong></p>
              <p>{app.job_title_1} {app.employment_dates_1}</p>
            </div>
          )}
          {app.previous_employer_2 && (
            <div className="experience-item">
              <p><strong>{app.previous_employer_2}</strong></p>
              <p>{app.job_title_2} {app.employment_dates_2}</p>
            </div>
          )}
          {app.previous_employer_3 && (
            <div className="experience-item">
              <p><strong>{app.previous_employer_3}</strong></p>
              <p>{app.job_title_3} {app.employment_dates_3}</p>
            </div>
          )}
        </div>
      </div>

      {/* Certifications */}
      {certs.length > 0 && (
        <div className="card">
          <h3>Certifications</h3>
          <div className="cert-badges">
            {certs.map(cert => (
              <span key={cert} className="badge badge-success">{cert}</span>
            ))}
          </div>
          {app.other_certifications && (
            <p><strong>Other:</strong> {app.other_certifications}</p>
          )}
        </div>
      )}

      {/* References */}
      <div className="card">
        <h3>Professional References</h3>
        {[1, 2, 3].map(num => (
          app[`reference_${num}_name`] && (
            <div key={num} className="reference-item">
              <p><strong>{app[`reference_${num}_name`]}</strong> ({app[`reference_${num}_relationship`]})</p>
              <p><a href={`tel:${app[`reference_${num}_phone`]}`}>{app[`reference_${num}_phone`]}</a></p>
            </div>
          )
        ))}
      </div>

      {/* Availability & Expectations */}
      <div className="grid" style={{ gridTemplateColumns: '1fr 1fr' }}>
        <div className="card">
          <h3>Availability</h3>
          {app.preferred_hours && <p><strong>Hours:</strong> {app.preferred_hours}</p>}
          <p><strong>Weekends:</strong> {app.can_work_weekends ? '✓ Yes' : '✗ No'}</p>
          <p><strong>Nights:</strong> {app.can_work_nights ? '✓ Yes' : '✗ No'}</p>
        </div>

        <div className="card">
          <h3>Expectations</h3>
          {app.expected_hourly_rate && <p><strong>Rate:</strong> {app.expected_hourly_rate}</p>}
          {app.motivation && <p><strong>Motivation:</strong> {app.motivation}</p>}
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
        ></textarea>
      </div>

      {/* Status & Actions */}
      <div className="card">
        <h3>Application Status</h3>
        <div className="status-buttons">
          {['applied', 'reviewing', 'interviewed', 'offered', 'hired', 'rejected'].map(s => (
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
