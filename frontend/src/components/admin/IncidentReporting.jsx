import { confirm } from '../ConfirmModal';
// src/components/admin/IncidentReporting.jsx
import React, { useState, useEffect } from 'react';
import { API_BASE_URL } from '../../config';

const IncidentReporting = ({ token }) => {
  const [clients, setClients] = useState([]);
  const [caregivers, setCaregivers] = useState([]);
  const [incidents, setIncidents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [filter, setFilter] = useState('all'); // all, critical, severe, moderate, minor
  const [searchTerm, setSearchTerm] = useState('');
  const [message, setMessage] = useState('');
  const [formData, setFormData] = useState({
    clientId: '',
    caregiverId: '',
    incidentType: 'accident',
    severity: 'moderate',
    incidentDate: new Date().toISOString().split('T')[0],
    incidentTime: new Date().toISOString().split('T')[1].slice(0, 5),
    description: '',
    witnesses: '',
    injuriesOrDamage: '',
    actionsTaken: '',
    followUpRequired: false,
    followUpNotes: '',
    reportedBy: '',
    reportedDate: new Date().toISOString().split('T')[0]
  });

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    try {
      const [clientsRes, caregiversRes, incidentsRes] = await Promise.all([
        fetch(`${API_BASE_URL}/api/clients`, {
          headers: { 'Authorization': `Bearer ${token}` }
        }),
        fetch(`${API_BASE_URL}/api/users/caregivers`, {
          headers: { 'Authorization': `Bearer ${token}` }
        }),
        fetch(`${API_BASE_URL}/api/incidents`, {
          headers: { 'Authorization': `Bearer ${token}` }
        })
      ]);

      const clientsData = await clientsRes.json();
      const caregiversData = await caregiversRes.json();
      const incidentsData = await incidentsRes.json();

      setClients(clientsData);
      setCaregivers(caregiversData);
      setIncidents(Array.isArray(incidentsData) ? incidentsData : []);
    } catch (error) {
      console.error('Failed to load data:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleSubmitIncident = async (e) => {
    e.preventDefault();
    setMessage('');

    if (!formData.clientId || !formData.incidentType) {
      setMessage('Client and incident type are required');
      return;
    }

    if (!formData.description.trim()) {
      setMessage('Description is required');
      return;
    }

    try {
      const response = await fetch(`${API_BASE_URL}/api/incidents`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify(formData)
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to report incident');
      }

      setMessage('Incident reported successfully!');
      setFormData({
        clientId: '',
        caregiverId: '',
        incidentType: 'accident',
        severity: 'moderate',
        incidentDate: new Date().toISOString().split('T')[0],
        incidentTime: new Date().toISOString().split('T')[1].slice(0, 5),
        description: '',
        witnesses: '',
        injuriesOrDamage: '',
        actionsTaken: '',
        followUpRequired: false,
        followUpNotes: '',
        reportedBy: '',
        reportedDate: new Date().toISOString().split('T')[0]
      });
      setShowForm(false);
      loadData();
    } catch (error) {
      setMessage('Error: ' + error.message);
    }
  };

  const handleDeleteIncident = async (incidentId) => {
    const _cok = await confirm('Delete this incident report? This cannot be undone.', {danger: true}); if (!_cok) return;

    try {
      const response = await fetch(`${API_BASE_URL}/api/incidents/${incidentId}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${token}` }
      });

      if (!response.ok) throw new Error('Failed to delete');

      setMessage('Incident deleted');
      setTimeout(() => setMessage(''), 2000);
      loadData();
    } catch (error) {
      setMessage('Error: ' + error.message);
    }
  };

  const getClientName = (clientId) => {
    const client = clients.find(c => c.id === clientId);
    return client ? `${client.first_name} ${client.last_name}` : 'Unknown Client';
  };

  const getCaregiverName = (caregiverId) => {
    const caregiver = caregivers.find(c => c.id === caregiverId);
    return caregiver ? `${caregiver.first_name} ${caregiver.last_name}` : 'Unknown Caregiver';
  };

  const getSeverityColor = (severity) => {
    switch (severity) {
      case 'critical':
        return '#d32f2f';
      case 'severe':
        return '#f57c00';
      case 'moderate':
        return '#fbc02d';
      case 'minor':
        return '#388e3c';
      default:
        return '#999';
    }
  };

  const getSeverityLabel = (severity) => {
    return severity.charAt(0).toUpperCase() + severity.slice(1);
  };

  const getIncidentTypeLabel = (type) => {
    const labels = {
      'accident': 'Accident',
      'fall': 'Fall',
      'medication_error': 'Medication Error',
      'behavioral': 'Behavioral Issue',
      'injury': 'Injury',
      'property_damage': 'Property Damage',
      'health_emergency': 'Health Emergency',
      'other': 'Other'
    };
    return labels[type] || type;
  };

  const filteredIncidents = incidents
    .filter(incident => {
      if (filter !== 'all' && incident.severity !== filter) return false;
      if (searchTerm) {
        const term = searchTerm.toLowerCase();
        return (
          getClientName(incident.client_id).toLowerCase().includes(term) ||
          incident.description.toLowerCase().includes(term) ||
          incident.incident_type.toLowerCase().includes(term)
        );
      }
      return true;
    })
    .sort((a, b) => new Date(b.incident_date) - new Date(a.incident_date));

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
        <h2>Incident & Accident Reporting</h2>
        <button
          className="btn btn-primary"
          onClick={() => setShowForm(!showForm)}
        >
          {showForm ? 'Cancel' : 'Report Incident'}
        </button>
      </div>

      {message && (
        <div className={`alert ${message.includes('Error') ? 'alert-error' : 'alert-success'}`}>
          {message}
        </div>
      )}

      {/* Report Form */}
      {showForm && (
        <div className="card card-form">
          <h3>Report New Incident</h3>
          <form onSubmit={handleSubmitIncident}>
            <div className="form-grid-2">
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
                      {client.first_name} {client.last_name}
                    </option>
                  ))}
                </select>
              </div>

              <div className="form-group">
                <label>Caregiver Involved</label>
                <select
                  value={formData.caregiverId}
                  onChange={(e) => setFormData({ ...formData, caregiverId: e.target.value })}
                >
                  <option value="">Select caregiver (if applicable)...</option>
                  {caregivers.map(cg => (
                    <option key={cg.id} value={cg.id}>
                      {cg.first_name} {cg.last_name}
                    </option>
                  ))}
                </select>
              </div>

              <div className="form-group">
                <label>Incident Type *</label>
                <select
                  value={formData.incidentType}
                  onChange={(e) => setFormData({ ...formData, incidentType: e.target.value })}
                >
                  <option value="accident">Accident</option>
                  <option value="fall">Fall</option>
                  <option value="medication_error">Medication Error</option>
                  <option value="behavioral">Behavioral Issue</option>
                  <option value="injury">Injury</option>
                  <option value="property_damage">Property Damage</option>
                  <option value="health_emergency">Health Emergency</option>
                  <option value="other">Other</option>
                </select>
              </div>

              <div className="form-group">
                <label>Severity *</label>
                <select
                  value={formData.severity}
                  onChange={(e) => setFormData({ ...formData, severity: e.target.value })}
                >
                  <option value="minor">Minor</option>
                  <option value="moderate">Moderate</option>
                  <option value="severe">Severe</option>
                  <option value="critical">Critical</option>
                </select>
              </div>

              <div className="form-group">
                <label>Incident Date *</label>
                <input
                  type="date"
                  value={formData.incidentDate}
                  onChange={(e) => setFormData({ ...formData, incidentDate: e.target.value })}
                  required
                />
              </div>

              <div className="form-group">
                <label>Incident Time</label>
                <input
                  type="time"
                  value={formData.incidentTime}
                  onChange={(e) => setFormData({ ...formData, incidentTime: e.target.value })}
                />
              </div>

              <div className="form-group">
                <label>Reported By</label>
                <input
                  type="text"
                  value={formData.reportedBy}
                  onChange={(e) => setFormData({ ...formData, reportedBy: e.target.value })}
                  placeholder="Name of person reporting"
                />
              </div>

              <div className="form-group">
                <label>Report Date</label>
                <input
                  type="date"
                  value={formData.reportedDate}
                  onChange={(e) => setFormData({ ...formData, reportedDate: e.target.value })}
                />
              </div>
            </div>

            <div className="form-group">
              <label>Incident Description *</label>
              <textarea
                value={formData.description}
                onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                placeholder="Detailed description of what happened..."
                rows="4"
                required
              ></textarea>
            </div>

            <div className="form-group">
              <label>Witnesses</label>
              <textarea
                value={formData.witnesses}
                onChange={(e) => setFormData({ ...formData, witnesses: e.target.value })}
                placeholder="Names and contact info of witnesses..."
                rows="2"
              ></textarea>
            </div>

            <div className="form-group">
              <label>Injuries or Damage</label>
              <textarea
                value={formData.injuriesOrDamage}
                onChange={(e) => setFormData({ ...formData, injuriesOrDamage: e.target.value })}
                placeholder="Description of any injuries or property damage..."
                rows="2"
              ></textarea>
            </div>

            <div className="form-group">
              <label>Actions Taken</label>
              <textarea
                value={formData.actionsTaken}
                onChange={(e) => setFormData({ ...formData, actionsTaken: e.target.value })}
                placeholder="What actions were taken in response to the incident..."
                rows="2"
              ></textarea>
            </div>

            <div className="form-group">
              <label style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                <input
                  type="checkbox"
                  checked={formData.followUpRequired}
                  onChange={(e) => setFormData({ ...formData, followUpRequired: e.target.checked })}
                />
                <span>Follow-up Required</span>
              </label>
            </div>

            {formData.followUpRequired && (
              <div className="form-group">
                <label>Follow-up Notes</label>
                <textarea
                  value={formData.followUpNotes}
                  onChange={(e) => setFormData({ ...formData, followUpNotes: e.target.value })}
                  placeholder="What follow-up actions are needed..."
                  rows="2"
                ></textarea>
              </div>
            )}

            <div className="form-actions">
              <button type="submit" className="btn btn-primary">Report Incident</button>
              <button type="button" className="btn btn-secondary" onClick={() => setShowForm(false)}>Cancel</button>
            </div>
          </form>
        </div>
      )}

      {/* Filters */}
      <div className="card">
        <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap', alignItems: 'center' }}>
          <input
            type="text"
            placeholder="Search incidents..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            style={{ flex: 1, minWidth: '200px', padding: '0.75rem', border: '1px solid #ddd', borderRadius: '4px' }}
          />
        </div>

        <div className="filter-tabs" style={{ marginTop: '1rem' }}>
          {['all', 'critical', 'severe', 'moderate', 'minor'].map(f => (
            <button
              key={f}
              className={`filter-tab ${filter === f ? 'active' : ''}`}
              onClick={() => setFilter(f)}
            >
              {f.charAt(0).toUpperCase() + f.slice(1)}
              {f !== 'all' && ` (${incidents.filter(i => i.severity === f).length})`}
            </button>
          ))}
        </div>
      </div>

      {/* Incidents List */}
      {filteredIncidents.length === 0 ? (
        <div className="card card-centered">
          <p>No incidents reported.</p>
        </div>
      ) : (
        <div style={{ display: 'grid', gap: '1rem' }}>
          {filteredIncidents.map(incident => (
            <div
              key={incident.id}
              style={{
                padding: '1rem',
                border: `2px solid ${getSeverityColor(incident.severity)}`,
                borderRadius: '6px',
                background: '#f9f9f9'
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'start', marginBottom: '1rem' }}>
                <div>
                  <h4 style={{ margin: '0 0 0.25rem 0' }}>
                    {getClientName(incident.client_id)} - {getIncidentTypeLabel(incident.incident_type)}
                  </h4>
                  <small style={{ color: '#666' }}>
                    {new Date(incident.incident_date).toLocaleDateString()} at {incident.incident_time || 'Unknown time'}
                  </small>
                </div>
                <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                  <span
                    className="badge"
                    style={{
                      background: getSeverityColor(incident.severity),
                      color: 'white'
                    }}
                  >
                    {getSeverityLabel(incident.severity).toUpperCase()}
                  </span>
                  <button
                    className="btn btn-sm btn-danger"
                    onClick={() => handleDeleteIncident(incident.id)}
                  >
                    Delete
                  </button>
                </div>
              </div>

              <div style={{ marginBottom: '0.75rem' }}>
                <strong>Description:</strong>
                <p style={{ margin: '0.25rem 0', whiteSpace: 'pre-wrap' }}>
                  {incident.description}
                </p>
              </div>

              {incident.caregiver_id && (
                <div style={{ marginBottom: '0.75rem', fontSize: '0.9rem' }}>
                  <strong>Caregiver:</strong> {getCaregiverName(incident.caregiver_id)}
                </div>
              )}

              {incident.witnesses && (
                <div style={{ marginBottom: '0.75rem', fontSize: '0.9rem' }}>
                  <strong>Witnesses:</strong>
                  <p style={{ margin: '0.25rem 0', whiteSpace: 'pre-wrap' }}>
                    {incident.witnesses}
                  </p>
                </div>
              )}

              {incident.injuries_or_damage && (
                <div style={{ marginBottom: '0.75rem', fontSize: '0.9rem', padding: '0.75rem', background: '#ffe6e6', borderRadius: '4px' }}>
                  <strong style={{ color: '#d32f2f' }}>Injuries/Damage:</strong>
                  <p style={{ margin: '0.25rem 0', whiteSpace: 'pre-wrap' }}>
                    {incident.injuries_or_damage}
                  </p>
                </div>
              )}

              {incident.actions_taken && (
                <div style={{ marginBottom: '0.75rem', fontSize: '0.9rem' }}>
                  <strong>Actions Taken:</strong>
                  <p style={{ margin: '0.25rem 0', whiteSpace: 'pre-wrap' }}>
                    {incident.actions_taken}
                  </p>
                </div>
              )}

              {incident.follow_up_required && (
                <div style={{ padding: '0.75rem', background: '#fff3cd', borderRadius: '4px', fontSize: '0.9rem' }}>
                  <strong>Follow-up Required:</strong>
                  {incident.follow_up_notes && (
                    <p style={{ margin: '0.25rem 0', whiteSpace: 'pre-wrap' }}>
                      {incident.follow_up_notes}
                    </p>
                  )}
                </div>
              )}

              <div style={{ marginTop: '1rem', paddingTop: '1rem', borderTop: '1px solid #ddd', fontSize: '0.85rem', color: '#999' }}>
                Reported by {incident.reported_by || 'Unknown'} on {new Date(incident.reported_date).toLocaleDateString()}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default IncidentReporting;
