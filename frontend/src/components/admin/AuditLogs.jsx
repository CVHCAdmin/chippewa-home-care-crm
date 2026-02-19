import { toast } from '../Toast';
// src/components/admin/AuditLogs.jsx
import React, { useState, useEffect } from 'react';
import { API_BASE_URL } from '../../config';

const AuditLogs = ({ token }) => {
  const [logs, setLogs] = useState([]);
  const [filteredLogs, setFilteredLogs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedLog, setSelectedLog] = useState(null);
  const [filters, setFilters] = useState({
    startDate: new Date(new Date().setDate(new Date().getDate() - 30)).toISOString().split('T')[0],
    endDate: new Date().toISOString().split('T')[0],
    userId: '',
    action: '',
    entityType: '',
    searchTerm: ''
  });
  const [users, setUsers] = useState([]);
  const [stats, setStats] = useState({
    totalEvents: 0,
    uniqueUsers: 0,
    dataChanges: 0,
    accessEvents: 0,
    suspiciousActivity: 0
  });

  useEffect(() => {
    loadLogs();
    loadUsers();
  }, []);

  useEffect(() => {
    applyFilters();
  }, [logs, filters]);

  const loadLogs = async () => {
    setLoading(true);
    try {
      const response = await fetch(
        `${API_BASE_URL}/api/audit-logs?startDate=${filters.startDate}&endDate=${filters.endDate}`,
        {
          headers: { 'Authorization': `Bearer ${token}` }
        }
      );
      const data = await response.json();
      setLogs(data.logs || []);
      
      // Calculate stats
      const uniqueUsers = new Set(data.logs.map(log => log.user_id)).size;
      const dataChanges = data.logs.filter(log => log.action === 'update' || log.action === 'create' || log.action === 'delete').length;
      const accessEvents = data.logs.filter(log => log.action === 'login' || log.action === 'access').length;
      const suspiciousActivity = data.logs.filter(log => log.flags && log.flags.length > 0).length;

      setStats({
        totalEvents: data.logs.length,
        uniqueUsers,
        dataChanges,
        accessEvents,
        suspiciousActivity
      });
    } catch (error) {
      console.error('Failed to load audit logs:', error);
    } finally {
      setLoading(false);
    }
  };

  const loadUsers = async () => {
    try {
      const [adminsRes, caregiversRes] = await Promise.all([
        fetch(`${API_BASE_URL}/api/users/admins`, {
          headers: { 'Authorization': `Bearer ${token}` }
        }),
        fetch(`${API_BASE_URL}/api/users/caregivers`, {
          headers: { 'Authorization': `Bearer ${token}` }
        })
      ]);
      const admins = await adminsRes.json();
      const caregivers = await caregiversRes.json();
      setUsers([...admins, ...caregivers]);
    } catch (error) {
      console.error('Failed to load users:', error);
    }
  };

  const applyFilters = () => {
    let filtered = logs;

    if (filters.userId) {
      filtered = filtered.filter(log => log.user_id === filters.userId);
    }

    if (filters.action) {
      filtered = filtered.filter(log => log.action === filters.action);
    }

    if (filters.entityType) {
      filtered = filtered.filter(log => log.entity_type === filters.entityType);
    }

    if (filters.searchTerm) {
      const term = filters.searchTerm.toLowerCase();
      filtered = filtered.filter(log =>
        log.user_name.toLowerCase().includes(term) ||
        log.entity_id.includes(term) ||
        (log.change_description && log.change_description.toLowerCase().includes(term))
      );
    }

    // Sort by timestamp descending
    filtered.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
    setFilteredLogs(filtered);
  };

  const getActionBadge = (action) => {
    switch (action) {
      case 'create':
        return { class: 'badge-success', label: 'Created' };
      case 'update':
        return { class: 'badge-info', label: 'Updated' };
      case 'delete':
        return { class: 'badge-danger', label: 'Deleted' };
      case 'login':
        return { class: 'badge-primary', label: 'Login' };
      case 'access':
        return { class: 'badge-secondary', label: 'Access' };
      case 'export':
        return { class: 'badge-warning', label: 'Export' };
      case 'failed_login':
        return { class: 'badge-danger', label: 'Failed Login' };
      default:
        return { class: 'badge-secondary', label: action };
    }
  };

  const getEntityIcon = (entityType) => {
    switch (entityType) {
      case 'client':
        return '👥';
      case 'caregiver':
        return '👨‍⚕️';
      case 'schedule':
        return '📅';
      case 'invoice':
        return '💰';
      case 'care_plan':
        return '📋';
      case 'incident':
        return '⚠️';
      case 'user':
        return '👤';
      default:
        return '📄';
    }
  };

  const exportLogs = async (format) => {
    try {
      const response = await fetch(`${API_BASE_URL}/api/audit-logs/export`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          logs: filteredLogs.map(log => ({
            timestamp: log.timestamp,
            user: log.user_name,
            action: log.action,
            entity: `${log.entity_type}:${log.entity_id}`,
            changes: log.changes,
            ipAddress: log.ip_address,
            userAgent: log.user_agent
          })),
          format
        })
      });

      if (!response.ok) throw new Error('Export failed');

      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `audit-logs-${new Date().toISOString().split('T')[0]}.${format}`;
      a.click();
    } catch (error) {
      toast('Failed to export: ' + error.message, 'error');
    }
  };

  const downloadComplianceReport = async () => {
    try {
      const response = await fetch(`${API_BASE_URL}/api/audit-logs/compliance-report`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          startDate: filters.startDate,
          endDate: filters.endDate
        })
      });

      if (!response.ok) throw new Error('Report generation failed');

      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `hipaa-compliance-report-${new Date().toISOString().split('T')[0]}.pdf`;
      a.click();
    } catch (error) {
      toast('Failed to generate report: ' + error.message, 'error');
    }
  };

  return (
    <div>
      <div className="page-header">
        <h2>🔐 Audit Logs (HIPAA Compliance)</h2>
        <div className="button-group">
          <button className="btn btn-secondary" onClick={() => exportLogs('csv')}>
            📥 Export CSV
          </button>
          <button className="btn btn-secondary" onClick={() => exportLogs('pdf')}>
            📄 Export PDF
          </button>
          <button className="btn btn-primary" onClick={downloadComplianceReport}>
            ✓ Compliance Report
          </button>
        </div>
      </div>

      {/* Compliance Stats */}
      <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))' }}>
        <div className="stat-card">
          <h3>Total Events</h3>
          <div className="value">{stats.totalEvents}</div>
        </div>
        <div className="stat-card">
          <h3>Unique Users</h3>
          <div className="value">{stats.uniqueUsers}</div>
        </div>
        <div className="stat-card">
          <h3>Data Changes</h3>
          <div className="value value-info">{stats.dataChanges}</div>
        </div>
        <div className="stat-card">
          <h3>Access Events</h3>
          <div className="value value-primary">{stats.accessEvents}</div>
        </div>
        <div className="stat-card">
          <h3>Suspicious Activity</h3>
          <div className="value value-danger">{stats.suspiciousActivity}</div>
        </div>
      </div>

      {/* Filters */}
      <div className="card">
        <h3>Filter Logs</h3>
        <div className="filter-controls" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '1rem' }}>
          <div className="form-group">
            <label>Start Date</label>
            <input
              type="date"
              value={filters.startDate}
              onChange={(e) => setFilters({ ...filters, startDate: e.target.value })}
            />
          </div>

          <div className="form-group">
            <label>End Date</label>
            <input
              type="date"
              value={filters.endDate}
              onChange={(e) => setFilters({ ...filters, endDate: e.target.value })}
            />
          </div>

          <div className="form-group">
            <label>User</label>
            <select
              value={filters.userId}
              onChange={(e) => setFilters({ ...filters, userId: e.target.value })}
            >
              <option value="">All Users</option>
              {users.map(user => (
                <option key={user.id} value={user.id}>
                  {user.first_name} {user.last_name} ({user.role})
                </option>
              ))}
            </select>
          </div>

          <div className="form-group">
            <label>Action</label>
            <select
              value={filters.action}
              onChange={(e) => setFilters({ ...filters, action: e.target.value })}
            >
              <option value="">All Actions</option>
              <option value="create">Create</option>
              <option value="update">Update</option>
              <option value="delete">Delete</option>
              <option value="login">Login</option>
              <option value="access">Access</option>
              <option value="export">Export</option>
              <option value="failed_login">Failed Login</option>
            </select>
          </div>

          <div className="form-group">
            <label>Entity Type</label>
            <select
              value={filters.entityType}
              onChange={(e) => setFilters({ ...filters, entityType: e.target.value })}
            >
              <option value="">All Types</option>
              <option value="client">Client</option>
              <option value="caregiver">Caregiver</option>
              <option value="schedule">Schedule</option>
              <option value="invoice">Invoice</option>
              <option value="care_plan">Care Plan</option>
              <option value="incident">Incident</option>
              <option value="user">User</option>
            </select>
          </div>

          <div className="form-group">
            <label>Search</label>
            <input
              type="text"
              placeholder="Search by name, ID, or description..."
              value={filters.searchTerm}
              onChange={(e) => setFilters({ ...filters, searchTerm: e.target.value })}
            />
          </div>
        </div>
      </div>

      {/* Logs Table */}
      {loading ? (
        <div className="loading">
          <div className="spinner"></div>
        </div>
      ) : filteredLogs.length === 0 ? (
        <div className="card card-centered">
          <p>No audit logs found for the selected filters.</p>
        </div>
      ) : (
        <div>
          <div style={{ marginBottom: '1rem', fontSize: '0.9rem', color: '#666' }}>
            Showing {filteredLogs.length} of {logs.length} events
          </div>
          
          <div style={{ display: 'grid', gap: '1rem' }}>
            {filteredLogs.map(log => {
              const actionBadge = getActionBadge(log.action);
              const hasSuspiciousFlags = log.flags && log.flags.length > 0;

              return (
                <div
                  key={log.id}
                  className="card"
                  style={{
                    borderLeft: `4px solid ${hasSuspiciousFlags ? '#f44336' : '#ddd'}`,
                    cursor: 'pointer',
                    opacity: hasSuspiciousFlags ? 1 : 0.9
                  }}
                  onClick={() => setSelectedLog(selectedLog?.id === log.id ? null : log)}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                    <div style={{ flex: 1 }}>
                      <div style={{ display: 'flex', gap: '1rem', alignItems: 'center', marginBottom: '0.5rem' }}>
                        <span style={{ fontSize: '1.2rem' }}>
                          {getEntityIcon(log.entity_type)}
                        </span>
                        <div>
                          <strong>{log.user_name}</strong>
                          <span className={`badge ${actionBadge.class}`} style={{ marginLeft: '0.5rem' }}>
                            {actionBadge.label}
                          </span>
                          {hasSuspiciousFlags && (
                            <span className="badge badge-danger" style={{ marginLeft: '0.5rem' }}>
                              ⚠️ Flagged
                            </span>
                          )}
                        </div>
                      </div>

                      <div style={{ fontSize: '0.9rem', color: '#666' }}>
                        <p style={{ margin: '0.25rem 0' }}>
                          <strong>{log.entity_type.replace('_', ' ').toUpperCase()}</strong>
                          {' '} (ID: {log.entity_id})
                        </p>
                        <p style={{ margin: '0.25rem 0' }}>
                          {new Date(log.timestamp).toLocaleString()}
                        </p>
                        {log.ip_address && (
                          <p style={{ margin: '0.25rem 0' }}>
                            From: {log.ip_address}
                          </p>
                        )}
                      </div>

                      {log.change_description && (
                        <div style={{ marginTop: '0.5rem', padding: '0.75rem', background: '#f5f5f5', borderRadius: '4px', fontSize: '0.85rem', maxHeight: selectedLog?.id === log.id ? 'none' : '2rem', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                          {log.change_description}
                        </div>
                      )}
                    </div>

                    <span style={{ fontSize: '1.2rem', color: '#999' }}>
                      {selectedLog?.id === log.id ? '▼' : '▶'}
                    </span>
                  </div>

                  {/* Expanded Details */}
                  {selectedLog?.id === log.id && (
                    <div style={{ marginTop: '1rem', paddingTop: '1rem', borderTop: '1px solid #ddd' }}>
                      <div className="grid" style={{ gridTemplateColumns: '1fr 1fr' }}>
                        <div>
                          <h4>Details</h4>
                          <p><strong>User ID:</strong> {log.user_id}</p>
                          <p><strong>Entity Type:</strong> {log.entity_type}</p>
                          <p><strong>Entity ID:</strong> {log.entity_id}</p>
                          <p><strong>Action:</strong> {log.action}</p>
                          <p><strong>Timestamp:</strong> {new Date(log.timestamp).toLocaleString()}</p>
                        </div>

                        <div>
                          <h4>Network Info</h4>
                          <p><strong>IP Address:</strong> {log.ip_address || 'N/A'}</p>
                          <p><strong>User Agent:</strong></p>
                          <p style={{ fontSize: '0.8rem', wordBreak: 'break-word', color: '#666' }}>
                            {log.user_agent || 'N/A'}
                          </p>
                        </div>
                      </div>

                      {log.changes && Object.keys(log.changes).length > 0 && (
                        <div style={{ marginTop: '1rem' }}>
                          <h4>Changes</h4>
                          <table style={{ width: '100%', fontSize: '0.85rem', borderCollapse: 'collapse' }}>
                            <thead>
                              <tr style={{ borderBottom: '1px solid #ddd' }}>
                                <th style={{ textAlign: 'left', padding: '0.5rem' }}>Field</th>
                                <th style={{ textAlign: 'left', padding: '0.5rem' }}>Old Value</th>
                                <th style={{ textAlign: 'left', padding: '0.5rem' }}>New Value</th>
                              </tr>
                            </thead>
                            <tbody>
                              {Object.entries(log.changes).map(([field, change]) => (
                                <tr key={field} style={{ borderBottom: '1px solid #eee' }}>
                                  <td style={{ padding: '0.5rem', fontWeight: 'bold' }}>{field}</td>
                                  <td style={{ padding: '0.5rem', color: '#f44336' }}>
                                    {typeof change.old_value === 'boolean' ? (change.old_value ? 'Yes' : 'No') : change.old_value || '(empty)'}
                                  </td>
                                  <td style={{ padding: '0.5rem', color: '#4caf50' }}>
                                    {typeof change.new_value === 'boolean' ? (change.new_value ? 'Yes' : 'No') : change.new_value || '(empty)'}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      )}

                      {hasSuspiciousFlags && (
                        <div style={{ marginTop: '1rem', padding: '1rem', background: '#fff3e0', borderRadius: '4px', borderLeft: '4px solid #f57c00' }}>
                          <h4 style={{ margin: '0 0 0.5rem 0', color: '#e65100' }}>⚠️ Suspicious Activity Flags</h4>
                          <ul style={{ margin: 0, paddingLeft: '1.5rem' }}>
                            {log.flags.map((flag, idx) => (
                              <li key={idx} style={{ color: '#666' }}>{flag}</li>
                            ))}
                          </ul>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Detailed Log Modal */}
      {selectedLog && (
        <div className="modal active" style={{ display: 'none' }}>
          <div className="modal-content modal-large">
            <div className="modal-header">
              <h2>Audit Log Details</h2>
              <button className="close-btn" onClick={() => setSelectedLog(null)}>×</button>
            </div>
            {/* Details shown inline above */}
            <div className="modal-actions">
              <button className="btn btn-secondary" onClick={() => setSelectedLog(null)}>
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default AuditLogs;
