// src/components/admin/NotificationCenter.jsx
import React, { useState, useEffect } from 'react';
import { API_BASE_URL } from '../../config';

const NotificationCenter = ({ token }) => {
  const [tab, setTab] = useState('log'); // log or settings
  const [notifications, setNotifications] = useState([]);
  const [settings, setSettings] = useState({});
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState('');
  const [showManualForm, setShowManualForm] = useState(false);
  const [caregivers, setCaregivers] = useState([]);
  const [clients, setClients] = useState([]);
  const [filter, setFilter] = useState('all'); // all, sent, pending, failed
  const [manualNotification, setManualNotification] = useState({
    recipientType: 'caregiver', // caregiver or admin
    recipientId: '',
    notificationType: 'general',
    subject: '',
    message: ''
  });

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    try {
      const [notificationsRes, settingsRes, caregiversRes, clientsRes] = await Promise.all([
        fetch(`${API_BASE_URL}/api/notifications`, {
          headers: { 'Authorization': `Bearer ${token}` }
        }),
        fetch(`${API_BASE_URL}/api/notification-settings`, {
          headers: { 'Authorization': `Bearer ${token}` }
        }),
        fetch(`${API_BASE_URL}/api/users/caregivers`, {
          headers: { 'Authorization': `Bearer ${token}` }
        }),
        fetch(`${API_BASE_URL}/api/clients`, {
          headers: { 'Authorization': `Bearer ${token}` }
        })
      ]);

      const notificationsData = await notificationsRes.json();
      const settingsData = await settingsRes.json();
      const caregiversData = await caregiversRes.json();
      const clientsData = await clientsRes.json();

      setNotifications(Array.isArray(notificationsData) ? notificationsData : []);
      setSettings(settingsData || {});
      setCaregivers(caregiversData);
      setClients(clientsData);
    } catch (error) {
      console.error('Failed to load data:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleSaveSettings = async () => {
    try {
      const response = await fetch(`${API_BASE_URL}/api/notification-settings`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify(settings)
      });

      if (!response.ok) throw new Error('Failed to save settings');

      setMessage('Notification settings saved!');
      setTimeout(() => setMessage(''), 2000);
    } catch (error) {
      setMessage('Error: ' + error.message);
    }
  };

  const handleSendManualNotification = async (e) => {
    e.preventDefault();
    setMessage('');

    if (!manualNotification.recipientId || !manualNotification.subject || !manualNotification.message) {
      setMessage('Recipient, subject, and message are required');
      return;
    }

    try {
      const response = await fetch(`${API_BASE_URL}/api/notifications/send`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify(manualNotification)
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to send notification');
      }

      setMessage('Notification sent successfully!');
      setManualNotification({
        recipientType: 'caregiver',
        recipientId: '',
        notificationType: 'general',
        subject: '',
        message: ''
      });
      setShowManualForm(false);
      loadData();
    } catch (error) {
      setMessage('Error: ' + error.message);
    }
  };

  const getRecipientName = (type, id) => {
    if (type === 'caregiver') {
      const cg = caregivers.find(c => c.id === id);
      return cg ? `${cg.first_name} ${cg.last_name}` : 'Unknown';
    } else {
      return 'Administrator';
    }
  };

  const getNotificationTypeLabel = (type) => {
    const labels = {
      'schedule_confirmation': 'Schedule Confirmation',
      'absence_alert': 'Absence Alert',
      'incident_alert': 'Incident Alert',
      'certification_warning': 'Certification Warning',
      'general': 'General Message'
    };
    return labels[type] || type;
  };

  const getStatusColor = (status) => {
    switch (status) {
      case 'sent':
        return '#4caf50';
      case 'pending':
        return '#2196f3';
      case 'failed':
        return '#d32f2f';
      default:
        return '#999';
    }
  };

  const filteredNotifications = notifications
    .filter(notif => filter === 'all' || notif.status === filter)
    .sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

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
        <h2>Notification Center</h2>
      </div>

      {message && (
        <div className={`alert ${message.includes('Error') ? 'alert-error' : 'alert-success'}`}>
          {message}
        </div>
      )}

      {/* Tab Navigation */}
      <div className="card" style={{ marginBottom: '1.5rem' }}>
        <div style={{ display: 'flex', gap: '0.5rem', borderBottom: '1px solid #ddd', marginBottom: '1rem' }}>
          <button
            onClick={() => setTab('log')}
            style={{
              padding: '1rem',
              background: tab === 'log' ? '#2196f3' : 'transparent',
              color: tab === 'log' ? 'white' : 'inherit',
              border: 'none',
              cursor: 'pointer',
              fontSize: '1rem',
              borderBottom: tab === 'log' ? '3px solid #2196f3' : 'none'
            }}
          >
            Notification Log
          </button>
          <button
            onClick={() => setTab('settings')}
            style={{
              padding: '1rem',
              background: tab === 'settings' ? '#2196f3' : 'transparent',
              color: tab === 'settings' ? 'white' : 'inherit',
              border: 'none',
              cursor: 'pointer',
              fontSize: '1rem',
              borderBottom: tab === 'settings' ? '3px solid #2196f3' : 'none'
            }}
          >
            Settings
          </button>
        </div>
      </div>

      {/* Notification Log Tab */}
      {tab === 'log' && (
        <>
          <div style={{ display: 'flex', gap: '1rem', alignItems: 'center', marginBottom: '1.5rem' }}>
            <div className="filter-tabs">
              {['all', 'sent', 'pending', 'failed'].map(f => (
                <button
                  key={f}
                  className={`filter-tab ${filter === f ? 'active' : ''}`}
                  onClick={() => setFilter(f)}
                >
                  {f.charAt(0).toUpperCase() + f.slice(1)}
                  {f !== 'all' && ` (${filteredNotifications.filter(n => n.status === f).length})`}
                </button>
              ))}
            </div>
            <button
              className="btn btn-primary"
              onClick={() => setShowManualForm(!showManualForm)}
            >
              {showManualForm ? 'Cancel' : 'Send Notification'}
            </button>
          </div>

          {/* Manual Send Form */}
          {showManualForm && (
            <div className="card card-form">
              <h3>Send Manual Notification</h3>
              <form onSubmit={handleSendManualNotification}>
                <div className="form-grid-2">
                  <div className="form-group">
                    <label>Recipient Type *</label>
                    <select
                      value={manualNotification.recipientType}
                      onChange={(e) => setManualNotification({ ...manualNotification, recipientType: e.target.value, recipientId: '' })}
                    >
                      <option value="caregiver">Caregiver</option>
                      <option value="admin">Administrator</option>
                    </select>
                  </div>

                  {manualNotification.recipientType === 'caregiver' && (
                    <div className="form-group">
                      <label>Caregiver *</label>
                      <select
                        value={manualNotification.recipientId}
                        onChange={(e) => setManualNotification({ ...manualNotification, recipientId: e.target.value })}
                        required
                      >
                        <option value="">Select caregiver...</option>
                        {caregivers.map(cg => (
                          <option key={cg.id} value={cg.id}>
                            {cg.first_name} {cg.last_name}
                          </option>
                        ))}
                      </select>
                    </div>
                  )}

                  <div className="form-group">
                    <label>Notification Type</label>
                    <select
                      value={manualNotification.notificationType}
                      onChange={(e) => setManualNotification({ ...manualNotification, notificationType: e.target.value })}
                    >
                      <option value="general">General Message</option>
                      <option value="schedule_confirmation">Schedule Confirmation</option>
                      <option value="absence_alert">Absence Alert</option>
                      <option value="incident_alert">Incident Alert</option>
                      <option value="certification_warning">Certification Warning</option>
                    </select>
                  </div>
                </div>

                <div className="form-group">
                  <label>Subject *</label>
                  <input
                    type="text"
                    value={manualNotification.subject}
                    onChange={(e) => setManualNotification({ ...manualNotification, subject: e.target.value })}
                    placeholder="Email subject line..."
                    required
                  />
                </div>

                <div className="form-group">
                  <label>Message *</label>
                  <textarea
                    value={manualNotification.message}
                    onChange={(e) => setManualNotification({ ...manualNotification, message: e.target.value })}
                    placeholder="Email body text..."
                    rows="5"
                    required
                  ></textarea>
                </div>

                <div className="form-actions">
                  <button type="submit" className="btn btn-primary">Send Notification</button>
                  <button type="button" className="btn btn-secondary" onClick={() => setShowManualForm(false)}>Cancel</button>
                </div>
              </form>
            </div>
          )}

          {/* Notifications List */}
          {filteredNotifications.length === 0 ? (
            <div className="card card-centered">
              <p>No notifications in this filter.</p>
            </div>
          ) : (
            <div style={{ display: 'grid', gap: '1rem' }}>
              {filteredNotifications.map(notif => (
                <div
                  key={notif.id}
                  style={{
                    padding: '1rem',
                    border: `1px solid #ddd`,
                    borderLeft: `4px solid ${getStatusColor(notif.status)}`,
                    borderRadius: '4px',
                    background: '#f9f9f9'
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'start', marginBottom: '0.75rem' }}>
                    <div>
                      <h4 style={{ margin: '0 0 0.25rem 0' }}>{notif.subject}</h4>
                      <small style={{ color: '#666' }}>
                        To: {getRecipientName(notif.recipient_type, notif.recipient_id)}
                      </small>
                    </div>
                    <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                      <span
                        className="badge"
                        style={{
                          background: getStatusColor(notif.status),
                          color: 'white',
                          fontSize: '0.85rem'
                        }}
                      >
                        {notif.status.toUpperCase()}
                      </span>
                      <span className="badge badge-secondary" style={{ fontSize: '0.85rem' }}>
                        {getNotificationTypeLabel(notif.notification_type)}
                      </span>
                    </div>
                  </div>

                  <p style={{ margin: '0.5rem 0', whiteSpace: 'pre-wrap', lineHeight: '1.5' }}>
                    {notif.message}
                  </p>

                  <div style={{ marginTop: '0.75rem', paddingTop: '0.75rem', borderTop: '1px solid #e0e0e0', fontSize: '0.85rem', color: '#999' }}>
                    Sent: {new Date(notif.sent_at || notif.created_at).toLocaleString()}
                    {notif.status === 'failed' && notif.error_message && (
                      <div style={{ color: '#d32f2f', marginTop: '0.25rem' }}>
                        Error: {notif.error_message}
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {/* Settings Tab */}
      {tab === 'settings' && (
        <div className="card card-form">
          <h3>Notification Settings</h3>
          <p style={{ color: '#666', marginBottom: '1.5rem' }}>
            Configure when and how notifications are sent automatically
          </p>

          <h4>Schedule Notifications</h4>
          <div style={{ marginBottom: '1.5rem', paddingBottom: '1.5rem', borderBottom: '1px solid #ddd' }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.75rem', cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={settings.send_schedule_confirmations !== false}
                onChange={(e) => setSettings({ ...settings, send_schedule_confirmations: e.target.checked })}
              />
              <span>Send confirmation when caregiver is scheduled</span>
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.75rem', cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={settings.send_schedule_reminders !== false}
                onChange={(e) => setSettings({ ...settings, send_schedule_reminders: e.target.checked })}
              />
              <span>Send shift reminders 24 hours before scheduled shifts</span>
            </label>
          </div>

          <h4>Absence Notifications</h4>
          <div style={{ marginBottom: '1.5rem', paddingBottom: '1.5rem', borderBottom: '1px solid #ddd' }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.75rem', cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={settings.send_absence_alerts !== false}
                onChange={(e) => setSettings({ ...settings, send_absence_alerts: e.target.checked })}
              />
              <span>Notify admin when caregiver reports absence</span>
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.75rem', cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={settings.send_absence_decisions !== false}
                onChange={(e) => setSettings({ ...settings, send_absence_decisions: e.target.checked })}
              />
              <span>Notify caregiver when absence is approved/denied</span>
            </label>
          </div>

          <h4>Incident Notifications</h4>
          <div style={{ marginBottom: '1.5rem', paddingBottom: '1.5rem', borderBottom: '1px solid #ddd' }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.75rem', cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={settings.send_incident_alerts !== false}
                onChange={(e) => setSettings({ ...settings, send_incident_alerts: e.target.checked })}
              />
              <span>Notify admin for critical/severe incidents immediately</span>
            </label>
          </div>

          <h4>Certification Notifications</h4>
          <div style={{ marginBottom: '1.5rem', paddingBottom: '1.5rem', borderBottom: '1px solid #ddd' }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.75rem', cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={settings.send_certification_warnings !== false}
                onChange={(e) => setSettings({ ...settings, send_certification_warnings: e.target.checked })}
              />
              <span>Notify admin when certification is expiring in 30 days</span>
            </label>
          </div>

          <h4>Email Configuration</h4>
          <div className="form-group" style={{ marginBottom: '1.5rem' }}>
            <label>Admin Email for Alerts</label>
            <input
              type="email"
              value={settings.admin_email || ''}
              onChange={(e) => setSettings({ ...settings, admin_email: e.target.value })}
              placeholder="admin@example.com"
            />
            <small style={{ color: '#666' }}>Where critical alerts will be sent</small>
          </div>

          <div className="form-actions">
            <button className="btn btn-primary" onClick={handleSaveSettings}>
              Save Settings
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default NotificationCenter;
