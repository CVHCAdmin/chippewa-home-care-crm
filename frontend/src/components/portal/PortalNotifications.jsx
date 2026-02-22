// components/portal/PortalNotifications.jsx
// Client notifications — alerts about visits, caregivers, billing
import React, { useState, useEffect } from 'react';
import { apiCall } from '../../config';

const typeIcon = (type) => {
  const map = {
    caregiver_late:      '⏰',
    caregiver_no_show:   '⚠️',
    visit_cancelled:     '❌',
    visit_rescheduled:   '📅',
    visit_scheduled:     '📅',
    invoice_ready:       '📄',
    payment_due:         '💳',
    payment_received:    '✅',
    caregiver_assigned:  '👤',
    caregiver_removed:   '👋',
  };
  return map[type] || '🔔';
};

const formatRelativeTime = (isoStr) => {
  const diff = Date.now() - new Date(isoStr).getTime();
  const mins  = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days  = Math.floor(diff / 86400000);
  if (mins < 1)   return 'Just now';
  if (mins < 60)  return `${mins}m ago`;
  if (hours < 24) return `${hours}h ago`;
  if (days < 7)   return `${days}d ago`;
  return new Date(isoStr).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
};

const PortalNotifications = ({ token, onRead }) => {
  const [notifications, setNotifications] = useState([]);
  const [loading, setLoading]             = useState(true);
  const [error, setError]                 = useState('');

  useEffect(() => {
    apiCall('/api/client-portal/portal/notifications', { method: 'GET' }, token)
      .then(data => { if (data) setNotifications(data); })
      .catch(err => setError(err.message))
      .finally(() => setLoading(false));
  }, [token]);

  const markAllRead = async () => {
    try {
      await apiCall('/api/client-portal/portal/notifications/read-all', { method: 'PUT' }, token);
      setNotifications(prev => prev.map(n => ({ ...n, is_read: true })));
      if (onRead) onRead();
    } catch {}
  };

  const markRead = async (id) => {
    try {
      await apiCall(`/api/client-portal/portal/notifications/${id}/read`, { method: 'PUT' }, token);
      setNotifications(prev => prev.map(n => n.id === id ? { ...n, is_read: true } : n));
    } catch {}
  };

  const unreadCount = notifications.filter(n => !n.is_read).length;

  if (loading) return <div style={{ textAlign: 'center', padding: '40px', color: '#888' }}>Loading notifications...</div>;
  if (error)   return <div className="alert alert-error">{error}</div>;

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
        <h2 style={{ margin: 0, fontSize: '1.3rem', color: '#1a5276' }}>
          🔔 Notifications
          {unreadCount > 0 && (
            <span style={{
              background: '#e74c3c', color: '#fff',
              borderRadius: '10px', padding: '2px 8px',
              fontSize: '0.75rem', marginLeft: '10px', verticalAlign: 'middle',
            }}>
              {unreadCount} new
            </span>
          )}
        </h2>

        {unreadCount > 0 && (
          <button
            onClick={markAllRead}
            style={{
              background: 'none', border: '1px solid #2980b9', color: '#2980b9',
              padding: '6px 14px', borderRadius: '8px', cursor: 'pointer', fontSize: '0.82rem',
            }}
          >
            Mark all read
          </button>
        )}
      </div>

      {notifications.length === 0 ? (
        <div style={{
          background: '#fff', borderRadius: '12px', padding: '48px',
          textAlign: 'center', color: '#888', boxShadow: '0 1px 4px rgba(0,0,0,0.08)',
        }}>
          <div style={{ fontSize: '3rem', marginBottom: '12px' }}>🔔</div>
          <div>No notifications yet.</div>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {notifications.map(n => (
            <div
              key={n.id}
              onClick={() => !n.is_read && markRead(n.id)}
              style={{
                background: n.is_read ? '#fff' : '#f0f7ff',
                borderRadius: '12px', padding: '16px 18px',
                boxShadow: '0 1px 4px rgba(0,0,0,0.08)',
                cursor: n.is_read ? 'default' : 'pointer',
                borderLeft: n.is_read ? '4px solid #e0e0e0' : '4px solid #2980b9',
                display: 'flex', gap: '14px', alignItems: 'flex-start',
                transition: 'background 0.2s',
              }}
            >
              <span style={{ fontSize: '1.4rem', flexShrink: 0, marginTop: '2px' }}>
                {typeIcon(n.type)}
              </span>
              <div style={{ flex: 1 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: '8px' }}>
                  <div style={{ fontWeight: n.is_read ? 500 : 700, color: '#1a5276', fontSize: '0.92rem' }}>
                    {n.title}
                  </div>
                  <div style={{ fontSize: '0.75rem', color: '#999', flexShrink: 0 }}>
                    {formatRelativeTime(n.created_at)}
                  </div>
                </div>
                {n.message && (
                  <div style={{ fontSize: '0.85rem', color: '#555', marginTop: '3px', lineHeight: 1.5 }}>
                    {n.message}
                  </div>
                )}
              </div>
              {!n.is_read && (
                <div style={{
                  width: '8px', height: '8px', borderRadius: '50%',
                  background: '#2980b9', flexShrink: 0, marginTop: '6px',
                }} />
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default PortalNotifications;
