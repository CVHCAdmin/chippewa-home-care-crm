import { confirm } from '../ConfirmModal';
import { toast } from '../Toast';
// src/components/admin/AlertsManagement.jsx
import React, { useState, useEffect } from 'react';
import { API_BASE_URL } from '../../config';

const AlertsManagement = ({ token }) => {
  const [alerts, setAlerts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState({ type: '', priority: '', status: 'active' });
  const [showCreateModal, setShowCreateModal] = useState(false);

  const alertTypes = [
    { id: 'certification_expiring', name: 'Certification Expiring', icon: '📜', color: '#ff9800' },
    { id: 'background_check_expiring', name: 'Background Check Expiring', icon: '🔒', color: '#f44336' },
    { id: 'schedule_conflict', name: 'Schedule Conflict', icon: '📅', color: '#e91e63' },
    { id: 'missed_clock_in', name: 'Missed Clock In', icon: '⏰', color: '#f44336' },
    { id: 'overtime_warning', name: 'Overtime Warning', icon: '⚠️', color: '#ff9800' },
    { id: 'authorization_expiring', name: 'Authorization Expiring', icon: '📋', color: '#9c27b0' },
    { id: 'care_plan_review', name: 'Care Plan Review Due', icon: '📝', color: '#2196f3' },
    { id: 'medication_refill', name: 'Medication Refill Needed', icon: '💊', color: '#00bcd4' },
    { id: 'incident_report', name: 'Incident Report Filed', icon: '🚨', color: '#f44336' },
    { id: 'compliance_issue', name: 'Compliance Issue', icon: '⚖️', color: '#ff5722' },
    { id: 'billing_issue', name: 'Billing Issue', icon: '💰', color: '#795548' },
    { id: 'custom', name: 'Custom Alert', icon: '🔔', color: '#607d8b' }
  ];

  useEffect(() => {
    loadAlerts();
  }, [filter]);

  const loadAlerts = async () => {
    try {
      const params = new URLSearchParams();
      if (filter.type) params.append('type', filter.type);
      if (filter.priority) params.append('priority', filter.priority);
      if (filter.status) params.append('status', filter.status);
      
      const res = await fetch(`${API_BASE_URL}/api/alerts?${params}`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      const data = await res.json();
      setAlerts(Array.isArray(data) ? data : []);
    } catch (error) {
      console.error('Failed to load alerts:', error);
    } finally {
      setLoading(false);
    }
  };

  const createAlert = async (formData) => {
    try {
      const res = await fetch(`${API_BASE_URL}/api/alerts`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify(formData)
      });
      if (res.ok) {
        setShowCreateModal(false);
        loadAlerts();
      } else {
        const err = await res.json();
        toast('Failed: ' + err.error, 'error');
      }
    } catch (error) {
      toast('Failed: ' + error.message, 'error');
    }
  };

  const acknowledgeAlert = async (alertId) => {
    try {
      const res = await fetch(`${API_BASE_URL}/api/alerts/${alertId}/acknowledge`, {
        method: 'PUT',
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (res.ok) {
        loadAlerts();
      }
    } catch (error) {
      toast('Failed: ' + error.message, 'error');
    }
  };

  const resolveAlert = async (alertId) => {
    const resolution = prompt('Resolution notes (optional):');
    try {
      const res = await fetch(`${API_BASE_URL}/api/alerts/${alertId}/resolve`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ resolution })
      });
      if (res.ok) {
        loadAlerts();
      }
    } catch (error) {
      toast('Failed: ' + error.message, 'error');
    }
  };

  const dismissAlert = async (alertId) => {
    const _cok = await confirm('Dismiss this alert without resolving?', {danger: true}); if (!_cok) return;
    try {
      const res = await fetch(`${API_BASE_URL}/api/alerts/${alertId}/dismiss`, {
        method: 'PUT',
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (res.ok) {
        loadAlerts();
      }
    } catch (error) {
      toast('Failed: ' + error.message, 'error');
    }
  };

  const getPriorityBadge = (priority) => {
    const colors = {
      low: '#8bc34a',
      medium: '#ff9800',
      high: '#f44336',
      critical: '#b71c1c'
    };
    return (
      <span style={{
        padding: '2px 8px',
        borderRadius: '4px',
        fontSize: '0.7rem',
        fontWeight: 'bold',
        color: 'white',
        backgroundColor: colors[priority] || '#9e9e9e'
      }}>
        {priority?.toUpperCase()}
      </span>
    );
  };

  const getStatusBadge = (status) => {
    const colors = {
      active: '#f44336',
      acknowledged: '#ff9800',
      resolved: '#4caf50',
      dismissed: '#9e9e9e'
    };
    return (
      <span style={{
        padding: '2px 8px',
        borderRadius: '4px',
        fontSize: '0.7rem',
        fontWeight: 'bold',
        color: 'white',
        backgroundColor: colors[status] || '#9e9e9e'
      }}>
        {status?.toUpperCase()}
      </span>
    );
  };

  const getTypeInfo = (typeId) => {
    return alertTypes.find(t => t.id === typeId) || { icon: '🔔', name: typeId, color: '#607d8b' };
  };

  const criticalCount = alerts.filter(a => a.priority === 'critical' && a.status === 'active').length;
  const highCount = alerts.filter(a => a.priority === 'high' && a.status === 'active').length;
  const activeCount = alerts.filter(a => a.status === 'active').length;
  const acknowledgedCount = alerts.filter(a => a.status === 'acknowledged').length;

  return (
    <div>
      <div className="page-header">
        <h2>🚨 Alerts & Notifications</h2>
        <button className="btn btn-primary" onClick={() => setShowCreateModal(true)}>
          + Create Alert
        </button>
      </div>

      {/* Summary Cards */}
      <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', marginBottom: '1rem' }}>
        <div 
          className="stat-card" 
          onClick={() => setFilter({ ...filter, priority: 'critical', status: 'active' })}
          style={{ cursor: 'pointer', borderLeft: '4px solid #b71c1c' }}
        >
          <h4>Critical</h4>
          <div className="value" style={{ color: '#b71c1c' }}>{criticalCount}</div>
        </div>
        <div 
          className="stat-card" 
          onClick={() => setFilter({ ...filter, priority: 'high', status: 'active' })}
          style={{ cursor: 'pointer', borderLeft: '4px solid #f44336' }}
        >
          <h4>High Priority</h4>
          <div className="value" style={{ color: '#f44336' }}>{highCount}</div>
        </div>
        <div 
          className="stat-card" 
          onClick={() => setFilter({ ...filter, priority: '', status: 'active' })}
          style={{ cursor: 'pointer', borderLeft: '4px solid #ff9800' }}
        >
          <h4>Active</h4>
          <div className="value" style={{ color: '#ff9800' }}>{activeCount}</div>
        </div>
        <div 
          className="stat-card" 
          onClick={() => setFilter({ ...filter, status: 'acknowledged' })}
          style={{ cursor: 'pointer', borderLeft: '4px solid #2196f3' }}
        >
          <h4>Acknowledged</h4>
          <div className="value" style={{ color: '#2196f3' }}>{acknowledgedCount}</div>
        </div>
      </div>

      {/* Filters */}
      <div className="card" style={{ marginBottom: '1rem' }}>
        <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap' }}>
          <div className="form-group" style={{ margin: 0 }}>
            <label>Type</label>
            <select value={filter.type} onChange={(e) => setFilter({ ...filter, type: e.target.value })}>
              <option value="">All Types</option>
              {alertTypes.map(t => (
                <option key={t.id} value={t.id}>{t.name}</option>
              ))}
            </select>
          </div>
          <div className="form-group" style={{ margin: 0 }}>
            <label>Priority</label>
            <select value={filter.priority} onChange={(e) => setFilter({ ...filter, priority: e.target.value })}>
              <option value="">All Priorities</option>
              <option value="critical">Critical</option>
              <option value="high">High</option>
              <option value="medium">Medium</option>
              <option value="low">Low</option>
            </select>
          </div>
          <div className="form-group" style={{ margin: 0 }}>
            <label>Status</label>
            <select value={filter.status} onChange={(e) => setFilter({ ...filter, status: e.target.value })}>
              <option value="">All</option>
              <option value="active">Active</option>
              <option value="acknowledged">Acknowledged</option>
              <option value="resolved">Resolved</option>
              <option value="dismissed">Dismissed</option>
            </select>
          </div>
          <button 
            className="btn btn-secondary" 
            style={{ alignSelf: 'flex-end' }}
            onClick={() => setFilter({ type: '', priority: '', status: 'active' })}
          >
            Reset Filters
          </button>
        </div>
      </div>

      {/* Alerts List */}
      <div className="card">
        {loading ? (
          <div className="loading"><div className="spinner"></div></div>
        ) : alerts.length === 0 ? (
          <p>No alerts found. 🎉</p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
            {alerts.map(alert => {
              const typeInfo = getTypeInfo(alert.alert_type);
              return (
                <div 
                  key={alert.id} 
                  style={{ 
                    border: '1px solid #ddd', 
                    borderRadius: '8px', 
                    padding: '1rem',
                    borderLeft: `4px solid ${typeInfo.color}`,
                    backgroundColor: alert.status === 'active' ? '#fff' : '#fafafa',
                    opacity: alert.status === 'dismissed' ? 0.6 : 1
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '0.5rem' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                      <span style={{ fontSize: '1.5rem' }}>{typeInfo.icon}</span>
                      <div>
                        <strong>{typeInfo.name}</strong>
                        <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.25rem' }}>
                          {getPriorityBadge(alert.priority)}
                          {getStatusBadge(alert.status)}
                        </div>
                      </div>
                    </div>
                    <span style={{ fontSize: '0.85rem', color: '#666' }}>
                      {new Date(alert.created_at).toLocaleString()}
                    </span>
                  </div>

                  <div style={{ marginTop: '0.75rem', color: '#333' }}>
                    {alert.message}
                  </div>

                  {alert.related_entity_type && (
                    <div style={{ marginTop: '0.5rem', fontSize: '0.85rem', color: '#666' }}>
                      <strong>Related:</strong> {alert.related_entity_type} 
                      {alert.related_entity_name && ` - ${alert.related_entity_name}`}
                    </div>
                  )}

                  {alert.due_date && (
                    <div style={{ marginTop: '0.25rem', fontSize: '0.85rem', color: new Date(alert.due_date) < new Date() ? '#f44336' : '#666' }}>
                      <strong>Due:</strong> {new Date(alert.due_date).toLocaleDateString()}
                      {new Date(alert.due_date) < new Date() && ' (OVERDUE)'}
                    </div>
                  )}

                  {alert.resolution && (
                    <div style={{ 
                      marginTop: '0.5rem', 
                      padding: '0.5rem',
                      backgroundColor: '#e8f5e9',
                      borderRadius: '4px',
                      fontSize: '0.85rem'
                    }}>
                      <strong>Resolution:</strong> {alert.resolution}
                    </div>
                  )}

                  {alert.status === 'active' && (
                    <div style={{ marginTop: '0.75rem', display: 'flex', gap: '0.5rem' }}>
                      <button 
                        className="btn btn-sm btn-secondary"
                        onClick={() => acknowledgeAlert(alert.id)}
                      >
                        👁️ Acknowledge
                      </button>
                      <button 
                        className="btn btn-sm btn-success"
                        onClick={() => resolveAlert(alert.id)}
                      >
                        ✓ Resolve
                      </button>
                      <button 
                        className="btn btn-sm btn-danger"
                        onClick={() => dismissAlert(alert.id)}
                      >
                        ✗ Dismiss
                      </button>
                    </div>
                  )}

                  {alert.status === 'acknowledged' && (
                    <div style={{ marginTop: '0.75rem', display: 'flex', gap: '0.5rem' }}>
                      <button 
                        className="btn btn-sm btn-success"
                        onClick={() => resolveAlert(alert.id)}
                      >
                        ✓ Resolve
                      </button>
                      <button 
                        className="btn btn-sm btn-danger"
                        onClick={() => dismissAlert(alert.id)}
                      >
                        ✗ Dismiss
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Create Alert Modal */}
      {showCreateModal && (
        <div className="modal-overlay" onClick={() => setShowCreateModal(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3>Create Alert</h3>
              <button className="modal-close" onClick={() => setShowCreateModal(false)}>×</button>
            </div>
            <CreateAlertForm 
              alertTypes={alertTypes}
              onSubmit={createAlert}
              onCancel={() => setShowCreateModal(false)}
            />
          </div>
        </div>
      )}
    </div>
  );
};

// Create Alert Form Component
const CreateAlertForm = ({ alertTypes, onSubmit, onCancel }) => {
  const [formData, setFormData] = useState({
    alertType: 'custom',
    priority: 'medium',
    message: '',
    dueDate: '',
    relatedEntityType: '',
    relatedEntityId: ''
  });

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!formData.message) {
      toast('Message is required');
      return;
    }
    onSubmit(formData);
  };

  return (
    <form onSubmit={handleSubmit}>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
        <div className="form-group">
          <label>Alert Type *</label>
          <select 
            value={formData.alertType}
            onChange={(e) => setFormData({ ...formData, alertType: e.target.value })}
          >
            {alertTypes.map(t => (
              <option key={t.id} value={t.id}>{t.icon} {t.name}</option>
            ))}
          </select>
        </div>
        <div className="form-group">
          <label>Priority *</label>
          <select 
            value={formData.priority}
            onChange={(e) => setFormData({ ...formData, priority: e.target.value })}
          >
            <option value="low">Low</option>
            <option value="medium">Medium</option>
            <option value="high">High</option>
            <option value="critical">Critical</option>
          </select>
        </div>
      </div>

      <div className="form-group">
        <label>Message *</label>
        <textarea 
          value={formData.message}
          onChange={(e) => setFormData({ ...formData, message: e.target.value })}
          placeholder="Describe the alert..."
          rows={3}
          required
        />
      </div>

      <div className="form-group">
        <label>Due Date (Optional)</label>
        <input 
          type="date"
          value={formData.dueDate}
          onChange={(e) => setFormData({ ...formData, dueDate: e.target.value })}
        />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
        <div className="form-group">
          <label>Related Entity Type</label>
          <select 
            value={formData.relatedEntityType}
            onChange={(e) => setFormData({ ...formData, relatedEntityType: e.target.value })}
          >
            <option value="">None</option>
            <option value="client">Client</option>
            <option value="caregiver">Caregiver</option>
            <option value="schedule">Schedule</option>
            <option value="invoice">Invoice</option>
          </select>
        </div>
        <div className="form-group">
          <label>Related Entity ID</label>
          <input 
            type="text"
            value={formData.relatedEntityId}
            onChange={(e) => setFormData({ ...formData, relatedEntityId: e.target.value })}
            placeholder="ID (optional)"
          />
        </div>
      </div>

      <div className="modal-actions">
        <button type="button" className="btn btn-secondary" onClick={onCancel}>Cancel</button>
        <button type="submit" className="btn btn-primary">Create Alert</button>
      </div>
    </form>
  );
};

export default AlertsManagement;
