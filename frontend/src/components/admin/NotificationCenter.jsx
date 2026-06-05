// src/components/admin/NotificationCenter.jsx — Admin notification inbox with handled/archived workflow
import React, { useState, useEffect } from 'react';
import { API_BASE_URL } from '../../config';

const NotificationCenter = ({ token }) => {
  const [tab, setTab] = useState('new'); // new, handled, archived, settings
  const [notifications, setNotifications] = useState([]);
  const [settings, setSettings] = useState({});
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState('');
  const [selectedIds, setSelectedIds] = useState([]);
  const [counts, setCounts] = useState({ new: 0, handled: 0, archived: 0 });

  useEffect(() => { loadNotifications(); }, [tab]);

  const loadNotifications = async () => {
    setLoading(true);
    setSelectedIds([]);
    try {
      const statusParam = ['new', 'handled', 'archived'].includes(tab) ? `?status=${tab}` : '';
      const [notifRes, settingsRes] = await Promise.all([
        fetch(`${API_BASE_URL}/api/notifications${statusParam}`, { headers: { Authorization: `Bearer ${token}` } }),
        tab === 'settings' ? fetch(`${API_BASE_URL}/api/notification-settings`, { headers: { Authorization: `Bearer ${token}` } }) : Promise.resolve(null)
      ]);
      let data = [];
      if (notifRes.ok) {
        data = await notifRes.json();
        if (!Array.isArray(data)) data = [];
        setNotifications(data);
      } else {
        setNotifications([]);
      }
      if (settingsRes?.ok) setSettings(await settingsRes.json());

      // Mark all "new" notifications as read so the bell badge clears
      if (tab === 'new' && data.length > 0) {
        fetch(`${API_BASE_URL}/api/push/mark-read`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({ ids: 'all' })
        }).catch(() => {});
      }

      // Load counts for all tabs
      const [newRes, handledRes, archivedRes] = await Promise.all([
        fetch(`${API_BASE_URL}/api/notifications?status=new`, { headers: { Authorization: `Bearer ${token}` } }),
        fetch(`${API_BASE_URL}/api/notifications?status=handled`, { headers: { Authorization: `Bearer ${token}` } }),
        fetch(`${API_BASE_URL}/api/notifications?status=archived`, { headers: { Authorization: `Bearer ${token}` } })
      ]);
      setCounts({
        new: newRes.ok ? (await newRes.json()).length : 0,
        handled: handledRes.ok ? (await handledRes.json()).length : 0,
        archived: archivedRes.ok ? (await archivedRes.json()).length : 0
      });
    } catch (error) {
      console.error('Failed to load notifications:', error);
    } finally {
      setLoading(false);
    }
  };

  const updateStatus = async (id, status) => {
    try {
      const res = await fetch(`${API_BASE_URL}/api/notifications/${id}/status`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ status })
      });
      if (!res.ok) throw new Error('Failed');
      loadNotifications();
    } catch (error) {
      setMessage('Error: ' + error.message);
      setTimeout(() => setMessage(''), 3000);
    }
  };

  const bulkUpdateStatus = async (status) => {
    if (!selectedIds.length) return;
    try {
      const res = await fetch(`${API_BASE_URL}/api/notifications/bulk-status`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ ids: selectedIds, status })
      });
      if (!res.ok) throw new Error('Failed');
      setMessage(`${selectedIds.length} notification(s) marked as ${status}`);
      setTimeout(() => setMessage(''), 3000);
      loadNotifications();
    } catch (error) {
      setMessage('Error: ' + error.message);
      setTimeout(() => setMessage(''), 3000);
    }
  };

  const deleteNotification = async (id) => {
    try {
      const res = await fetch(`${API_BASE_URL}/api/notifications/${id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` }
      });
      if (!res.ok) throw new Error('Failed');
      loadNotifications();
    } catch (error) {
      setMessage('Error: ' + error.message);
      setTimeout(() => setMessage(''), 3000);
    }
  };

  const handleSaveSettings = async () => {
    try {
      // Map DB snake_case (in state) → API camelCase
      const payload = {
        emailEnabled:        settings.email_enabled,
        smsEnabled:          settings.sms_enabled,
        pushEnabled:         settings.push_enabled,
        scheduleAlerts:      settings.schedule_alerts,
        payrollAlerts:       settings.payroll_alerts,
        absenceAlerts:       settings.absence_alerts,
        paymentAlerts:       settings.payment_alerts,
        shiftReminderAlerts: settings.shift_reminder_alerts,
        billingAlerts:       settings.billing_alerts,
        lowAuthAlerts:       settings.low_auth_alerts,
        expiringCertAlerts:  settings.expiring_cert_alerts,
        messageAlerts:       settings.message_alerts,
        quietHoursStart:     settings.quiet_hours_start || null,
        quietHoursEnd:       settings.quiet_hours_end || null,
        quietHoursSkipEmergency: settings.quiet_hours_skip_emergency,
      };
      const res = await fetch(`${API_BASE_URL}/api/notification-settings`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(payload)
      });
      if (!res.ok) throw new Error('Failed to save');
      setMessage('Settings saved!');
      setTimeout(() => setMessage(''), 2000);
    } catch (error) { setMessage('Error: ' + error.message); }
  };

  const toggleSelect = (id) => {
    setSelectedIds(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);
  };

  const toggleSelectAll = () => {
    setSelectedIds(prev => prev.length === notifications.length ? [] : notifications.map(n => n.id));
  };

  const typeIcon = (type) => {
    const icons = {
      time_off_request: '🏖️',
      schedule_alert: '📅',
      absence_alert: '🚫',
      incident_alert: '⚠️',
      certification_warning: '📜',
      billing_alert: '🧾',
      general: '📬'
    };
    return icons[type] || '📬';
  };

  const typeLabel = (type) => {
    const labels = {
      time_off_request: 'Time Off Request',
      schedule_alert: 'Schedule',
      absence_alert: 'Absence',
      incident_alert: 'Incident',
      certification_warning: 'Certification',
      billing_alert: 'Billing',
      general: 'General'
    };
    return labels[type] || type || 'General';
  };

  const timeAgo = (dateStr) => {
    const diff = Date.now() - new Date(dateStr).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return 'Just now';
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    const days = Math.floor(hrs / 24);
    if (days < 7) return `${days}d ago`;
    return new Date(dateStr).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  };

  const tabs = [
    { id: 'new', label: 'New', count: counts.new, color: '#DC2626' },
    { id: 'handled', label: 'Handled', count: counts.handled, color: '#059669' },
    { id: 'archived', label: 'Archived', count: counts.archived, color: '#6B7280' },
    { id: 'settings', label: 'Settings', count: null, color: null }
  ];

  return (
    <div>
      <div className="page-header">
        <h2>Notifications</h2>
      </div>

      {message && (
        <div style={{ padding: '0.75rem 1rem', marginBottom: '1rem', borderRadius: '8px', background: message.startsWith('Error') ? '#FEE2E2' : '#D1FAE5', color: message.startsWith('Error') ? '#DC2626' : '#059669', fontWeight: '500' }}>
          {message}
        </div>
      )}

      {/* Tabs */}
      <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1.25rem', flexWrap: 'wrap' }}>
        {tabs.map(t => (
          <button key={t.id} onClick={() => setTab(t.id)}
            style={{
              padding: '0.5rem 1rem', borderRadius: '8px', cursor: 'pointer', fontWeight: '600', fontSize: '0.9rem',
              border: tab === t.id ? '2px solid #2563EB' : '1px solid #D1D5DB',
              background: tab === t.id ? '#EFF6FF' : '#fff',
              color: tab === t.id ? '#2563EB' : '#374151',
              display: 'flex', alignItems: 'center', gap: '0.4rem'
            }}>
            {t.label}
            {t.count != null && t.count > 0 && (
              <span style={{
                background: tab === t.id ? '#2563EB' : t.color, color: '#fff',
                borderRadius: '99px', fontSize: '0.72rem', fontWeight: '700',
                padding: '1px 6px', minWidth: '18px', textAlign: 'center'
              }}>{t.count}</span>
            )}
          </button>
        ))}
      </div>

      {/* Bulk actions bar */}
      {selectedIds.length > 0 && tab !== 'settings' && (
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', padding: '0.6rem 1rem', background: '#EFF6FF', border: '1px solid #BFDBFE', borderRadius: '8px', marginBottom: '1rem', flexWrap: 'wrap' }}>
          <span style={{ fontSize: '0.875rem', fontWeight: '600', color: '#1D4ED8' }}>
            {selectedIds.length} selected
          </span>
          {tab === 'new' && (
            <button onClick={() => bulkUpdateStatus('handled')}
              style={{ padding: '0.35rem 0.75rem', background: '#059669', color: '#fff', border: 'none', borderRadius: '6px', cursor: 'pointer', fontSize: '0.82rem', fontWeight: '600' }}>
              Mark Handled
            </button>
          )}
          {tab !== 'archived' && (
            <button onClick={() => bulkUpdateStatus('archived')}
              style={{ padding: '0.35rem 0.75rem', background: '#6B7280', color: '#fff', border: 'none', borderRadius: '6px', cursor: 'pointer', fontSize: '0.82rem', fontWeight: '600' }}>
              Archive
            </button>
          )}
          {tab === 'archived' && (
            <button onClick={() => bulkUpdateStatus('new')}
              style={{ padding: '0.35rem 0.75rem', background: '#2563EB', color: '#fff', border: 'none', borderRadius: '6px', cursor: 'pointer', fontSize: '0.82rem', fontWeight: '600' }}>
              Move to New
            </button>
          )}
          <button onClick={() => setSelectedIds([])}
            style={{ padding: '0.35rem 0.75rem', background: 'none', border: '1px solid #D1D5DB', borderRadius: '6px', cursor: 'pointer', fontSize: '0.82rem', color: '#6B7280' }}>
            Clear
          </button>
        </div>
      )}

      {/* Notification list */}
      {tab !== 'settings' && (
        loading ? (
          <div className="card" style={{ textAlign: 'center', padding: '2rem', color: '#888' }}>Loading...</div>
        ) : notifications.length === 0 ? (
          <div className="card" style={{ textAlign: 'center', padding: '2rem', color: '#888' }}>
            No {tab} notifications
          </div>
        ) : (
          <div>
            {/* Select all */}
            <div style={{ marginBottom: '0.5rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <input type="checkbox" checked={selectedIds.length === notifications.length && notifications.length > 0} onChange={toggleSelectAll} />
              <span style={{ fontSize: '0.82rem', color: '#6B7280' }}>Select all</span>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
              {notifications.map(n => {
                const isSelected = selectedIds.includes(n.id);
                return (
                  <div key={n.id} style={{
                    display: 'flex', alignItems: 'flex-start', gap: '0.75rem',
                    padding: '0.875rem 1rem', borderRadius: '8px',
                    border: isSelected ? '2px solid #2563EB' : '1px solid #E5E7EB',
                    background: isSelected ? '#EFF6FF' : '#fff',
                    transition: 'all 0.1s'
                  }}>
                    <input type="checkbox" checked={isSelected} onChange={() => toggleSelect(n.id)} style={{ marginTop: '0.2rem' }} />

                    <div style={{ fontSize: '1.3rem', marginTop: '0.1rem' }}>{typeIcon(n.type)}</div>

                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '0.5rem', flexWrap: 'wrap' }}>
                        <div>
                          <div style={{ fontWeight: '600', fontSize: '0.95rem' }}>{n.title}</div>
                          <span style={{
                            display: 'inline-block', padding: '0.15rem 0.5rem', borderRadius: '4px',
                            fontSize: '0.72rem', fontWeight: '600', background: '#F3F4F6', color: '#374151', marginTop: '0.2rem'
                          }}>{typeLabel(n.type)}</span>
                        </div>
                        <span style={{ fontSize: '0.78rem', color: '#9CA3AF', whiteSpace: 'nowrap' }}>{timeAgo(n.created_at)}</span>
                      </div>
                      {n.message && (
                        <p style={{ margin: '0.4rem 0 0', fontSize: '0.9rem', color: '#555', lineHeight: '1.4' }}>{n.message}</p>
                      )}
                      {n.handled_at && (
                        <div style={{ fontSize: '0.78rem', color: '#9CA3AF', marginTop: '0.3rem' }}>
                          Handled {timeAgo(n.handled_at)}
                        </div>
                      )}

                      {/* Action buttons */}
                      <div style={{ display: 'flex', gap: '0.4rem', marginTop: '0.5rem', flexWrap: 'wrap' }}>
                        {tab === 'new' && (
                          <button onClick={() => updateStatus(n.id, 'handled')}
                            style={{ padding: '0.25rem 0.6rem', background: '#D1FAE5', color: '#059669', border: '1px solid #A7F3D0', borderRadius: '6px', cursor: 'pointer', fontSize: '0.78rem', fontWeight: '600' }}>
                            Mark Handled
                          </button>
                        )}
                        {tab !== 'archived' && (
                          <button onClick={() => updateStatus(n.id, 'archived')}
                            style={{ padding: '0.25rem 0.6rem', background: '#F3F4F6', color: '#6B7280', border: '1px solid #D1D5DB', borderRadius: '6px', cursor: 'pointer', fontSize: '0.78rem', fontWeight: '600' }}>
                            Archive
                          </button>
                        )}
                        {tab === 'handled' && (
                          <button onClick={() => updateStatus(n.id, 'new')}
                            style={{ padding: '0.25rem 0.6rem', background: '#DBEAFE', color: '#2563EB', border: '1px solid #BFDBFE', borderRadius: '6px', cursor: 'pointer', fontSize: '0.78rem', fontWeight: '600' }}>
                            Reopen
                          </button>
                        )}
                        {tab === 'archived' && (
                          <button onClick={() => updateStatus(n.id, 'new')}
                            style={{ padding: '0.25rem 0.6rem', background: '#DBEAFE', color: '#2563EB', border: '1px solid #BFDBFE', borderRadius: '6px', cursor: 'pointer', fontSize: '0.78rem', fontWeight: '600' }}>
                            Move to New
                          </button>
                        )}
                        <button onClick={() => deleteNotification(n.id)}
                          style={{ padding: '0.25rem 0.6rem', background: '#FEE2E2', color: '#DC2626', border: '1px solid #FECACA', borderRadius: '6px', cursor: 'pointer', fontSize: '0.78rem', fontWeight: '600' }}>
                          Delete
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )
      )}

      {/* Settings Tab */}
      {tab === 'settings' && (
        <div className="card" style={{ padding: '1.5rem' }}>
          <h3 style={{ marginTop: 0 }}>Notification Settings</h3>
          <p style={{ color: '#666', marginBottom: '1.5rem' }}>Configure when automatic notifications are sent</p>

          {/* MY PREFERENCES — per-user channel + event-type opt-outs + quiet hours */}
          <div style={{ marginBottom: '1.5rem', paddingBottom: '1.5rem', borderBottom: '2px solid #2ABBA7' }}>
            <h4 style={{ color: '#0F766E', marginTop: 0 }}>📥 My Delivery Preferences</h4>
            <p style={{ color: '#666', fontSize: '0.85rem', marginTop: 0 }}>How and when YOU receive notifications.</p>

            <div style={{ marginBottom: '1rem' }}>
              <strong style={{ display: 'block', marginBottom: '0.5rem' }}>Channels</strong>
              {[
                ['email_enabled', '✉️ Email'],
                ['sms_enabled',   '📱 Text message (SMS)'],
                ['push_enabled',  '🔔 Push notifications'],
              ].map(([key, label]) => (
                <label key={key} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.4rem', cursor: 'pointer' }}>
                  <input type="checkbox" checked={settings[key] !== false}
                    onChange={e => setSettings({ ...settings, [key]: e.target.checked })} />
                  <span>{label}</span>
                </label>
              ))}
            </div>

            <div style={{ marginBottom: '1rem' }}>
              <strong style={{ display: 'block', marginBottom: '0.5rem' }}>Which alerts</strong>
              {[
                ['schedule_alerts',      '📅 Schedule changes'],
                ['shift_reminder_alerts','⏰ Shift reminders'],
                ['absence_alerts',       '🚫 Absence / no-show'],
                ['payroll_alerts',       '💵 Payroll updates'],
                ['payment_alerts',       '💳 Payments received'],
                ['billing_alerts',       '🧾 Billing / invoices'],
                ['low_auth_alerts',      '⚠️ Authorizations running low'],
                ['expiring_cert_alerts', '📜 Certifications expiring'],
                ['message_alerts',       '💬 New messages'],
              ].map(([key, label]) => (
                <label key={key} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.4rem', cursor: 'pointer' }}>
                  <input type="checkbox" checked={settings[key] !== false}
                    onChange={e => setSettings({ ...settings, [key]: e.target.checked })} />
                  <span>{label}</span>
                </label>
              ))}
            </div>

            <div style={{ marginBottom: '1rem' }}>
              <strong style={{ display: 'block', marginBottom: '0.5rem' }}>🌙 Quiet hours <span style={{ fontWeight: 400, color: '#6B7280', fontSize: '0.85rem' }}>(no notifications during this window)</span></strong>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem', maxWidth: 380 }}>
                <div>
                  <label style={{ display: 'block', fontSize: '0.75rem', color: '#6B7280' }}>From</label>
                  <input type="time" value={settings.quiet_hours_start || ''}
                    onChange={e => setSettings({ ...settings, quiet_hours_start: e.target.value || null })} />
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: '0.75rem', color: '#6B7280' }}>Until</label>
                  <input type="time" value={settings.quiet_hours_end || ''}
                    onChange={e => setSettings({ ...settings, quiet_hours_end: e.target.value || null })} />
                </div>
              </div>
              <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginTop: '0.5rem', cursor: 'pointer' }}>
                <input type="checkbox" checked={settings.quiet_hours_skip_emergency !== false}
                  onChange={e => setSettings({ ...settings, quiet_hours_skip_emergency: e.target.checked })} />
                <span>Still send urgent alerts (no-show, emergency button) during quiet hours</span>
              </label>
            </div>
          </div>

          <h4>Schedule Notifications</h4>
          <div style={{ marginBottom: '1.5rem', paddingBottom: '1.5rem', borderBottom: '1px solid #ddd' }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.75rem', cursor: 'pointer' }}>
              <input type="checkbox" checked={settings.send_schedule_confirmations !== false}
                onChange={e => setSettings({ ...settings, send_schedule_confirmations: e.target.checked })} />
              <span>Send confirmation when caregiver is scheduled</span>
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.75rem', cursor: 'pointer' }}>
              <input type="checkbox" checked={settings.send_schedule_reminders !== false}
                onChange={e => setSettings({ ...settings, send_schedule_reminders: e.target.checked })} />
              <span>Send shift reminders 24 hours before</span>
            </label>
          </div>

          <h4>Absence Notifications</h4>
          <div style={{ marginBottom: '1.5rem', paddingBottom: '1.5rem', borderBottom: '1px solid #ddd' }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.75rem', cursor: 'pointer' }}>
              <input type="checkbox" checked={settings.send_absence_alerts !== false}
                onChange={e => setSettings({ ...settings, send_absence_alerts: e.target.checked })} />
              <span>Notify admin when caregiver reports absence</span>
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.75rem', cursor: 'pointer' }}>
              <input type="checkbox" checked={settings.send_absence_decisions !== false}
                onChange={e => setSettings({ ...settings, send_absence_decisions: e.target.checked })} />
              <span>Notify caregiver when absence is approved/denied</span>
            </label>
          </div>

          <h4>Incident Notifications</h4>
          <div style={{ marginBottom: '1.5rem', paddingBottom: '1.5rem', borderBottom: '1px solid #ddd' }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.75rem', cursor: 'pointer' }}>
              <input type="checkbox" checked={settings.send_incident_alerts !== false}
                onChange={e => setSettings({ ...settings, send_incident_alerts: e.target.checked })} />
              <span>Notify admin for critical incidents immediately</span>
            </label>
          </div>

          <h4>Certification Notifications</h4>
          <div style={{ marginBottom: '1.5rem', paddingBottom: '1.5rem', borderBottom: '1px solid #ddd' }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.75rem', cursor: 'pointer' }}>
              <input type="checkbox" checked={settings.send_certification_warnings !== false}
                onChange={e => setSettings({ ...settings, send_certification_warnings: e.target.checked })} />
              <span>Notify when certification expires in 30 days</span>
            </label>
          </div>

          <h4>Email Configuration</h4>
          <div className="form-group" style={{ marginBottom: '1.5rem' }}>
            <label>Admin Email for Alerts</label>
            <input type="email" value={settings.admin_email || ''}
              onChange={e => setSettings({ ...settings, admin_email: e.target.value })}
              placeholder="admin@example.com" />
            <small style={{ color: '#666' }}>Where critical alerts will be sent</small>
          </div>

          <button className="btn btn-primary" onClick={handleSaveSettings}>Save Settings</button>
        </div>
      )}
    </div>
  );
};

export default NotificationCenter;
