// src/components/admin/ApplicationsDashboard.jsx
import React, { useState, useEffect } from 'react';
import { API_BASE_URL } from '../../config';
import ApplicationDetail from './ApplicationDetail';

const ApplicationsDashboard = ({ token }) => {
  const [applications, setApplications] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('applied');
  const [selectedApp, setSelectedApp] = useState(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [hireModal, setHireModal] = useState(null);
  const [hireForm, setHireForm] = useState({ hourlyRate: '15.00', email: '', password: '' });
  const [hiring, setHiring] = useState(false);
  const [hireResult, setHireResult] = useState(null);

  useEffect(() => {
    loadApplications();
  }, []);

  const loadApplications = async () => {
    try {
      const response = await fetch(`${API_BASE_URL}/api/applications`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      const data = await response.json();
      setApplications(data);
    } catch (error) {
      console.error('Failed to load applications:', error);
    } finally {
      setLoading(false);
    }
  };

  const openHireModal = (app, e) => {
    e.stopPropagation();
    setHireForm({ hourlyRate: '15.00', email: app.email || '', password: '' });
    setHireModal(app);
    setHireResult(null);
  };

  const handleHire = async () => {
    if (!hireModal) return;
    setHiring(true);
    try {
      const response = await fetch(`${API_BASE_URL}/api/applications/${hireModal.id}/hire`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({
          hourlyRate: parseFloat(hireForm.hourlyRate) || 15.00,
          email: hireForm.email,
          password: hireForm.password || undefined
        })
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Hire failed');
      setHireResult(data);
      loadApplications();
    } catch (error) {
      alert('Error: ' + error.message);
    } finally {
      setHiring(false);
    }
  };

  const filteredApplications = applications
    .filter(app => {
      if (filter !== 'all' && app.status !== filter) return false;
      if (searchTerm) {
        const term = searchTerm.toLowerCase();
        return (
          app.first_name.toLowerCase().includes(term) ||
          app.last_name.toLowerCase().includes(term) ||
          app.email.toLowerCase().includes(term)
        );
      }
      return true;
    })
    .sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

  const getStatusColor = (status) => {
    switch (status) {
      case 'hired': return 'badge-success';
      case 'offered': return 'badge-primary';
      case 'interviewed': return 'badge-info';
      case 'reviewing': return 'badge-warning';
      case 'rejected': return 'badge-danger';
      case 'applied': return 'badge-secondary';
      default: return 'badge-secondary';
    }
  };

  const getCertificationBadges = (app) => {
    const certs = [];
    if (app.has_cna) certs.push('CNA');
    if (app.has_lpn) certs.push('LPN');
    if (app.has_rn) certs.push('RN');
    if (app.has_cpr) certs.push('CPR');
    if (app.has_first_aid) certs.push('First Aid');
    return certs;
  };

  if (selectedApp) {
    return (
      <ApplicationDetail 
        applicationId={selectedApp.id}
        token={token}
        onBack={() => {
          setSelectedApp(null);
          loadApplications();
        }}
      />
    );
  }

  return (
    <div>
      <div className="page-header">
        <h2>📋 Job Applications</h2>
      </div>

      {/* Search & Filter */}
      <div className="card">
        <div className="filter-controls">
          <input
            type="text"
            placeholder="Search by name or email..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="search-input"
          />
        </div>

        <div className="filter-tabs">
          {['all', 'applied', 'reviewing', 'interviewed', 'offered', 'hired', 'rejected'].map(f => (
            <button
              key={f}
              className={`filter-tab ${filter === f ? 'active' : ''}`}
              onClick={() => setFilter(f)}
            >
              {f.charAt(0).toUpperCase() + f.slice(1)}
              <span className="filter-count">
                ({applications.filter(a => f === 'all' || a.status === f).length})
              </span>
            </button>
          ))}
        </div>
      </div>

      {/* Applications Table */}
      {loading ? (
        <div className="loading"><div className="spinner"></div></div>
      ) : filteredApplications.length === 0 ? (
        <div className="card card-centered">
          <p>No applications found.</p>
        </div>
      ) : (
        <div className="applications-grid">
          {filteredApplications.map(app => (
            <div 
              key={app.id} 
              className="application-card"
              onClick={() => setSelectedApp(app)}
            >
              <div className="app-header">
                <div>
                  <h4>{app.first_name} {app.last_name}</h4>
                  <p className="app-date">{new Date(app.created_at).toLocaleDateString()}</p>
                </div>
                <span className={`badge ${getStatusColor(app.status)}`}>
                  {app.status.toUpperCase()}
                </span>
              </div>

              <div className="app-body">
                <p><strong>Email:</strong> {app.email}</p>
                <p><strong>Phone:</strong> {app.phone}</p>
                
                {app.years_of_experience && (
                  <p><strong>Experience:</strong> {app.years_of_experience} years</p>
                )}

                {getCertificationBadges(app).length > 0 && (
                  <div className="app-certs">
                    {getCertificationBadges(app).map(cert => (
                      <span key={cert} className="badge badge-info">{cert}</span>
                    ))}
                  </div>
                )}

                {app.expected_hourly_rate && (
                  <p><strong>Expected Rate:</strong> {app.expected_hourly_rate}</p>
                )}
              </div>

              <div className="app-footer" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <small>Click to review application</small>
                {app.status !== 'hired' && app.status !== 'rejected' && (
                  <button 
                    onClick={(e) => openHireModal(app, e)}
                    style={{ padding: '0.35rem 0.75rem', background: '#059669', color: '#fff', border: 'none', borderRadius: '6px', fontSize: '0.78rem', fontWeight: '600', cursor: 'pointer' }}>
                    ✅ Hire as Caregiver
                  </button>
                )}
                {app.status === 'hired' && (
                  <span style={{ padding: '0.25rem 0.6rem', background: '#D1FAE5', color: '#065F46', borderRadius: '6px', fontSize: '0.75rem', fontWeight: '600' }}>
                    ✓ Hired
                  </span>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Hire Modal */}
      {hireModal && (
        <div onClick={() => { setHireModal(null); setHireResult(null); }}
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: '1rem' }}>
          <div onClick={(e) => e.stopPropagation()}
            style={{ background: '#fff', borderRadius: '12px', width: '100%', maxWidth: '480px', overflow: 'hidden' }}>
            
            {!hireResult ? (
              <>
                <div style={{ padding: '1.25rem', borderBottom: '1px solid #e5e7eb' }}>
                  <h3 style={{ margin: 0, color: '#059669' }}>✅ Convert to Caregiver</h3>
                  <p style={{ margin: '0.5rem 0 0', fontSize: '0.88rem', color: '#6B7280' }}>
                    Create a caregiver account for <strong>{hireModal.first_name} {hireModal.last_name}</strong>
                  </p>
                </div>
                <div style={{ padding: '1.25rem' }}>
                  <div style={{ marginBottom: '1rem' }}>
                    <label style={{ display: 'block', marginBottom: '0.3rem', fontWeight: '600', fontSize: '0.85rem' }}>Email (for login) *</label>
                    <input value={hireForm.email} onChange={(e) => setHireForm(p => ({ ...p, email: e.target.value }))}
                      style={{ width: '100%', padding: '0.6rem', borderRadius: '6px', border: '1px solid #ddd', fontSize: '0.95rem' }} />
                  </div>
                  <div style={{ marginBottom: '1rem' }}>
                    <label style={{ display: 'block', marginBottom: '0.3rem', fontWeight: '600', fontSize: '0.85rem' }}>Temporary Password</label>
                    <input value={hireForm.password} onChange={(e) => setHireForm(p => ({ ...p, password: e.target.value }))} 
                      placeholder="Leave blank to auto-generate"
                      style={{ width: '100%', padding: '0.6rem', borderRadius: '6px', border: '1px solid #ddd', fontSize: '0.95rem' }} />
                    <small style={{ color: '#9CA3AF' }}>They'll use this to log in the first time</small>
                  </div>
                  <div style={{ marginBottom: '1rem' }}>
                    <label style={{ display: 'block', marginBottom: '0.3rem', fontWeight: '600', fontSize: '0.85rem' }}>Hourly Rate ($)</label>
                    <input type="number" step="0.25" value={hireForm.hourlyRate} onChange={(e) => setHireForm(p => ({ ...p, hourlyRate: e.target.value }))}
                      style={{ width: '100%', padding: '0.6rem', borderRadius: '6px', border: '1px solid #ddd', fontSize: '0.95rem' }} />
                  </div>

                  {/* Applicant Summary */}
                  <div style={{ padding: '0.75rem', background: '#F0FDF4', borderRadius: '8px', border: '1px solid #BBF7D0', fontSize: '0.82rem', marginBottom: '1rem' }}>
                    <div style={{ fontWeight: '700', marginBottom: '0.4rem', color: '#065F46' }}>Applicant Info</div>
                    <div>📞 {hireModal.phone || 'No phone'}</div>
                    <div>📍 {hireModal.city ? `${hireModal.city}, ${hireModal.state}` : 'No location'}</div>
                    {hireModal.years_experience && <div>🏥 {hireModal.years_experience} yrs experience</div>}
                    {hireModal.cna_license && <div>📋 CNA Licensed</div>}
                  </div>
                </div>
                <div style={{ padding: '1rem 1.25rem', borderTop: '1px solid #e5e7eb', display: 'flex', gap: '0.5rem', justifyContent: 'flex-end' }}>
                  <button onClick={() => { setHireModal(null); setHireResult(null); }}
                    style={{ padding: '0.6rem 1.25rem', background: '#F3F4F6', border: '1px solid #D1D5DB', borderRadius: '8px', cursor: 'pointer', fontSize: '0.9rem' }}>Cancel</button>
                  <button onClick={handleHire} disabled={hiring || !hireForm.email}
                    style={{ padding: '0.6rem 1.25rem', background: hiring ? '#9CA3AF' : '#059669', color: '#fff', border: 'none', borderRadius: '8px', cursor: hiring ? 'not-allowed' : 'pointer', fontSize: '0.9rem', fontWeight: '600' }}>
                    {hiring ? 'Creating...' : '✅ Create Caregiver Account'}
                  </button>
                </div>
              </>
            ) : (
              <div style={{ padding: '2rem', textAlign: 'center' }}>
                <div style={{ fontSize: '3rem', marginBottom: '1rem' }}>🎉</div>
                <h3 style={{ margin: '0 0 0.5rem', color: '#059669' }}>Caregiver Created!</h3>
                <p style={{ color: '#374151', marginBottom: '1rem' }}><strong>{hireModal.first_name} {hireModal.last_name}</strong> is now a caregiver.</p>
                <div style={{ padding: '1rem', background: '#FEF3C7', borderRadius: '8px', border: '1px solid #FCD34D', textAlign: 'left', marginBottom: '1.5rem' }}>
                  <div style={{ fontWeight: '700', marginBottom: '0.5rem', color: '#92400E' }}>⚠️ Login Credentials (save these!)</div>
                  <div style={{ fontSize: '0.9rem' }}><strong>Email:</strong> {hireForm.email}</div>
                  <div style={{ fontSize: '0.9rem' }}><strong>Temp Password:</strong> {hireResult.tempPassword}</div>
                </div>
                <button onClick={() => { setHireModal(null); setHireResult(null); }}
                  style={{ padding: '0.6rem 2rem', background: '#059669', color: '#fff', border: 'none', borderRadius: '8px', cursor: 'pointer', fontSize: '1rem', fontWeight: '600' }}>
                  Done
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default ApplicationsDashboard;
