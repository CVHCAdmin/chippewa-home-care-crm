// src/components/admin/ApplicationsDashboard.jsx
import React, { useState, useEffect } from 'react';
import { API_BASE_URL } from '../../config';
import ApplicationDetail from './ApplicationDetail';

const ApplicationsDashboard = ({ token }) => {
  const [applications, setApplications] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('applied'); // applied, reviewing, interviewed, offered, hired, rejected
  const [selectedApp, setSelectedApp] = useState(null);
  const [searchTerm, setSearchTerm] = useState('');

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

              <div className="app-footer">
                <small>Click to review application</small>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default ApplicationsDashboard;
