// components/portal/ClientPortal.jsx
// Main portal container — handles nav and renders the active view
import React, { useState, useEffect } from 'react';
import { apiCall } from '../../config';
import PortalVisits      from './PortalVisits';
import PortalHistory     from './PortalHistory';
import PortalCaregivers  from './PortalCaregivers';
import PortalInvoices    from './PortalInvoices';
import PortalNotifications from './PortalNotifications';

const NAV = [
  { key: 'visits',        label: 'My Schedule',    icon: '📅' },
  { key: 'history',       label: 'Visit History',  icon: '🕐' },
  { key: 'caregivers',    label: 'My Caregivers',  icon: '👤' },
  { key: 'invoices',      label: 'Billing',        icon: '📄' },
  { key: 'notifications', label: 'Notifications',  icon: '🔔' },
];

const ClientPortal = ({ user, token, onLogout }) => {
  const [activeTab, setActiveTab]           = useState('visits');
  const [profile, setProfile]               = useState(null);
  const [unreadCount, setUnreadCount]       = useState(0);
  const [menuOpen, setMenuOpen]             = useState(false);

  useEffect(() => {
    // Load profile
    apiCall('/api/client-portal/portal/me', { method: 'GET' }, token)
      .then(data => { if (data) setProfile(data); })
      .catch(() => {});

    // Poll unread notifications count every 60s
    const fetchUnread = () => {
      apiCall('/api/client-portal/portal/notifications', { method: 'GET' }, token)
        .then(data => {
          if (data) setUnreadCount(data.filter(n => !n.is_read).length);
        })
        .catch(() => {});
    };
    fetchUnread();
    const interval = setInterval(fetchUnread, 60000);
    return () => clearInterval(interval);
  }, [token]);

  const renderView = () => {
    switch (activeTab) {
      case 'visits':        return <PortalVisits token={token} />;
      case 'history':       return <PortalHistory token={token} />;
      case 'caregivers':    return <PortalCaregivers token={token} />;
      case 'invoices':      return <PortalInvoices token={token} />;
      case 'notifications': return <PortalNotifications token={token} onRead={() => setUnreadCount(0)} />;
      default:              return <PortalVisits token={token} />;
    }
  };

  const clientName = profile
    ? `${profile.first_name} ${profile.last_name}`
    : user?.firstName ? `${user.firstName} ${user.lastName}` : 'Welcome';

  return (
    <div style={{ minHeight: '100vh', background: '#f5f7fa' }}>

      {/* ── Header ── */}
      <div style={{
        background: 'linear-gradient(135deg, #1a5276 0%, #2980b9 100%)',
        color: '#fff',
        padding: '0 20px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        height: '60px',
        boxShadow: '0 2px 8px rgba(0,0,0,0.15)',
        position: 'sticky',
        top: 0,
        zIndex: 100,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <span style={{ fontSize: '1.4rem' }}>🏠</span>
          <div>
            <div style={{ fontWeight: 700, fontSize: '0.95rem', lineHeight: 1.2 }}>
              Chippewa Valley Home Care
            </div>
            <div style={{ fontSize: '0.75rem', opacity: 0.85 }}>Client Portal</div>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
          <span style={{ fontSize: '0.85rem', opacity: 0.9 }}>{clientName}</span>
          <button
            onClick={onLogout}
            style={{
              background: 'rgba(255,255,255,0.15)',
              border: '1px solid rgba(255,255,255,0.3)',
              color: '#fff',
              padding: '5px 12px',
              borderRadius: '6px',
              cursor: 'pointer',
              fontSize: '0.8rem',
            }}
          >
            Sign Out
          </button>
        </div>
      </div>

      {/* ── Desktop Nav ── */}
      <div style={{
        background: '#fff',
        borderBottom: '1px solid #e8ecf0',
        display: 'flex',
        padding: '0 20px',
        gap: '4px',
        overflowX: 'auto',
      }}>
        {NAV.map(tab => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            style={{
              background: 'none',
              border: 'none',
              padding: '14px 18px',
              cursor: 'pointer',
              fontSize: '0.88rem',
              fontWeight: activeTab === tab.key ? 600 : 400,
              color: activeTab === tab.key ? '#1a5276' : '#555',
              borderBottom: activeTab === tab.key ? '3px solid #1a5276' : '3px solid transparent',
              whiteSpace: 'nowrap',
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              position: 'relative',
            }}
          >
            <span>{tab.icon}</span>
            {tab.label}
            {tab.key === 'notifications' && unreadCount > 0 && (
              <span style={{
                background: '#e74c3c',
                color: '#fff',
                borderRadius: '10px',
                padding: '1px 6px',
                fontSize: '0.7rem',
                fontWeight: 700,
              }}>
                {unreadCount}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* ── Content ── */}
      <div style={{ maxWidth: '900px', margin: '0 auto', padding: '24px 16px' }}>
        {renderView()}
      </div>
    </div>
  );
};

export default ClientPortal;
