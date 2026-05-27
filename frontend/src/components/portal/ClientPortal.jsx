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
  const [isMobile, setIsMobile]             = useState(window.innerWidth <= 768);

  useEffect(() => {
    const onResize = () => setIsMobile(window.innerWidth <= 768);
    window.addEventListener('resize', onResize);
    window.addEventListener('orientationchange', onResize);
    return () => {
      window.removeEventListener('resize', onResize);
      window.removeEventListener('orientationchange', onResize);
    };
  }, []);

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

      {/* ── Nav (responsive — distributes evenly on mobile so all tabs fit in portrait) ── */}
      <div style={{
        background: '#fff',
        borderBottom: '1px solid #e8ecf0',
        display: 'flex',
        padding: isMobile ? '0' : '0 20px',
        gap: isMobile ? 0 : '4px',
        overflowX: isMobile ? 'visible' : 'auto',
      }}>
        {NAV.map(tab => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            style={{
              background: 'none',
              border: 'none',
              padding: isMobile ? '10px 2px' : '14px 18px',
              cursor: 'pointer',
              fontSize: isMobile ? '0.7rem' : '0.88rem',
              fontWeight: activeTab === tab.key ? 600 : 400,
              color: activeTab === tab.key ? '#1a5276' : '#555',
              borderBottom: activeTab === tab.key ? '3px solid #1a5276' : '3px solid transparent',
              whiteSpace: 'nowrap',
              display: 'flex',
              flexDirection: isMobile ? 'column' : 'row',
              alignItems: 'center',
              justifyContent: 'center',
              gap: isMobile ? '2px' : '6px',
              position: 'relative',
              flex: isMobile ? '1 1 0' : '0 0 auto',
              minWidth: 0,
            }}
          >
            <span style={{ fontSize: isMobile ? '1.15rem' : 'inherit' }}>{tab.icon}</span>
            <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '100%' }}>
              {tab.label}
            </span>
            {tab.key === 'notifications' && unreadCount > 0 && (
              <span style={{
                background: '#e74c3c',
                color: '#fff',
                borderRadius: '10px',
                padding: '1px 6px',
                fontSize: '0.7rem',
                fontWeight: 700,
                position: isMobile ? 'absolute' : 'static',
                top: isMobile ? 4 : 'auto',
                right: isMobile ? 6 : 'auto',
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
