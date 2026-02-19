// src/components/AdminDashboard.jsx - Rebuilt with collapsible nav, search, notifications
import React, { useState, useEffect, useRef, useCallback } from 'react';
import { API_BASE_URL } from '../config';
import { getDashboardSummary } from '../config';
import { toast } from './Toast';
import HelpPanel from './HelpPanel';
import MessageBoard from './admin/MessageBoard';

// Admin pages
import DashboardOverview from './admin/DashboardOverview';
import ReferralSources from './admin/ReferralSources';
import ClientsManagement from './admin/ClientsManagement';
import CaregiverManagement from './admin/CaregiverManagement';
import BillingDashboard from './admin/BillingDashboard';
import ClientOnboarding from './admin/ClientOnboarding';
import PerformanceRatings from './admin/PerformanceRatings';
import ExpenseManagement from './admin/ExpenseManagement';
import CaregiverProfile from './admin/CaregiverProfile';
import CaregiverHistory from './admin/CaregiverHistory';
import ApplicationsDashboard from './admin/ApplicationsDashboard';
import CarePlans from './admin/CarePlans';
import IncidentReporting from './admin/IncidentReporting';
import NotificationCenter from './admin/NotificationCenter';
import ComplianceTracking from './admin/ComplianceTracking';
import ReportsAnalytics from './admin/ReportsAnalytics';
import PayrollProcessing from './admin/PayrollProcessing';
import AuditLogs from './admin/AuditLogs';
import ClaimsManagement from './admin/ClaimsManagement';
import MedicationsManagement from './admin/MedicationsManagement';
import DocumentsManagement from './admin/DocumentsManagement';
import ADLTracking from './admin/ADLTracking';
import BackgroundChecks from './admin/BackgroundChecks';
import SMSManagement from './admin/SMSManagement';
import FamilyPortalAdmin from './admin/FamilyPortalAdmin';
import AlertsManagement from './admin/AlertsManagement';
import SchedulingHub from './admin/SchedulingHub';
import RouteOptimizer from './admin/RouteOptimizer';
import CompanyOptimizer from './admin/CompanyOptimizer';
import EmergencyCoverage from './admin/EmergencyCoverage';

const NAV_SECTIONS = [
  {
    id: 'ops', label: 'Operations', icon: '🏢',
    items: [
      { id: 'dashboard', label: 'Dashboard', icon: '📊' },
      { id: 'clients', label: 'Clients', icon: '👤' },
      { id: 'onboarding', label: 'Onboarding', icon: '📋' },
      { id: 'referrals', label: 'Referral Sources', icon: '🏥' },
      { id: 'care-plans', label: 'Care Plans', icon: '❤️' },
    ]
  },
  {
    id: 'scheduling', label: 'Scheduling', icon: '📅',
    items: [
      { id: 'scheduling', label: 'Schedule Hub', icon: '📅' },
      { id: 'emergency-coverage', label: 'Emergency Coverage', icon: '🚨' },
      { id: 'route-optimizer', label: 'Route Optimizer', icon: '🗺️' },
      { id: 'company-optimizer', label: 'Company Optimizer', icon: '⚙️' },
    ]
  },
  {
    id: 'clinical', label: 'Clinical', icon: '🩺',
    items: [
      { id: 'adl', label: 'ADL Tracking', icon: '🩺' },
      { id: 'medications', label: 'Medications', icon: '💊' },
      { id: 'incidents', label: 'Incidents', icon: '⚠️' },
    ]
  },
  {
    id: 'caregiving', label: 'Caregivers', icon: '👥',
    items: [
      { id: 'caregivers', label: 'Caregivers', icon: '👥' },
      { id: 'performance', label: 'Performance', icon: '⭐' },
      { id: 'applications', label: 'Job Applications', icon: '📝' },
    ]
  },
  {
    id: 'financial', label: 'Financial', icon: '💰',
    items: [
      { id: 'billing', label: 'Billing', icon: '🧾' },
      { id: 'claims', label: 'Claims', icon: '📑' },
      { id: 'payroll', label: 'Payroll', icon: '💵' },
      { id: 'expenses', label: 'Expenses', icon: '💳' },
      { id: 'reports', label: 'Reports & Analytics', icon: '📊' },
    ]
  },
  {
    id: 'compliance', label: 'Compliance', icon: '🛡️',
    items: [
      { id: 'compliance', label: 'Compliance', icon: '🛡️' },
      { id: 'background-checks', label: 'Background Checks', icon: '🔍' },
      { id: 'documents', label: 'Documents', icon: '📁' },
      { id: 'audit-logs', label: 'Audit Logs', icon: '📜' },
    ]
  },
  {
    id: 'comms', label: 'Communication', icon: '💬',
    items: [
      { id: 'sms', label: 'SMS', icon: '📱' },
      { id: 'family-portal', label: 'Family Portal', icon: '🏠' },
      { id: 'alerts', label: 'Alerts', icon: '🔔' },
      { id: 'messages', label: 'Messages', icon: '💬' },
      { id: 'notifications', label: 'Notifications', icon: '📬' },
    ]
  },
];

// All searchable items flattened
const ALL_ITEMS = NAV_SECTIONS.flatMap(s => s.items);

const AdminDashboard = ({ user, token, onLogout }) => {
  const [currentPage, setCurrentPage] = useState('dashboard');
  const [showHelp, setShowHelp] = useState(false);
  const [selectedCaregiverId, setSelectedCaregiverId] = useState(null);
  const [selectedCaregiverName, setSelectedCaregiverName] = useState('');
  const [summary, setSummary] = useState(null);
  const [loading, setLoading] = useState(true);
  const [sidebarOpen, setSidebarOpen] = useState(window.innerWidth > 768);
  const [collapsedSections, setCollapsedSections] = useState({});
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [showSearch, setShowSearch] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);
  const [liveStats, setLiveStats] = useState({ activeCaregivers: 0, todayShifts: 0 });
  const searchRef = useRef(null);

  useEffect(() => { loadDashboard(); loadUnreadCount(); }, []);

  useEffect(() => {
    const handleResize = () => setSidebarOpen(window.innerWidth > 768);
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  useEffect(() => {
    if (window.innerWidth <= 768) setSidebarOpen(false);
  }, [currentPage]);

  useEffect(() => {
    // Global search
    if (!searchQuery.trim()) { setSearchResults([]); return; }
    const q = searchQuery.toLowerCase();
    const results = ALL_ITEMS.filter(item =>
      item.label.toLowerCase().includes(q)
    );
    setSearchResults(results);
  }, [searchQuery]);

  useEffect(() => {
    // Close search on outside click
    const handleClick = (e) => {
      if (searchRef.current && !searchRef.current.contains(e.target)) {
        setShowSearch(false);
        setSearchQuery('');
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  // Poll unread count every 30s
  useEffect(() => {
    const interval = setInterval(loadUnreadCount, 30000);
    return () => clearInterval(interval);
  }, []);

  const loadDashboard = async () => {
    try {
      const data = await getDashboardSummary(token);
      setSummary(data);
      setLiveStats({
        activeCaregivers: data?.activeCaregivers || 0,
        todayShifts: data?.todayShifts || 0,
      });
    } catch (error) {
      if (error.message !== 'SESSION_EXPIRED') {
        console.error('Failed to load dashboard:', error);
      }
    } finally {
      setLoading(false);
    }
  };

  const loadUnreadCount = async () => {
    try {
      const res = await fetch(`${API_BASE_URL}/api/push/unread-count`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (res.ok) {
        const data = await res.json();
        setUnreadCount(data.count || 0);
      }
    } catch {}
  };

  const handlePageClick = (page) => {
    setCurrentPage(page);
    setShowSearch(false);
    setSearchQuery('');
  };

  const toggleSection = (sectionId) => {
    setCollapsedSections(prev => ({ ...prev, [sectionId]: !prev[sectionId] }));
  };

  const handleViewCaregiverProfile = (caregiverId) => {
    setSelectedCaregiverId(caregiverId);
    setCurrentPage('caregiver-profile');
  };

  const handleViewCaregiverHistory = (caregiverId, name) => {
    setSelectedCaregiverId(caregiverId);
    setSelectedCaregiverName(name);
    setCurrentPage('caregiver-history');
  };

  const renderPage = () => {
    switch (currentPage) {
      case 'dashboard': return <DashboardOverview summary={summary} token={token} onNavigate={handlePageClick} />;
      case 'referrals': return <ReferralSources token={token} />;
      case 'clients': return <ClientsManagement token={token} />;
      case 'caregivers': return <CaregiverManagement token={token} onViewProfile={handleViewCaregiverProfile} onViewHistory={handleViewCaregiverHistory} />;
      case 'billing': return <BillingDashboard token={token} />;
      case 'scheduling': return <SchedulingHub token={token} />;
      case 'emergency-coverage': return <EmergencyCoverage token={token} />;
      case 'route-optimizer': return <RouteOptimizer token={token} />;
      case 'company-optimizer': return <CompanyOptimizer token={token} />;
      case 'onboarding': return <ClientOnboarding token={token} />;
      case 'performance': return <PerformanceRatings token={token} />;
      case 'applications': return <ApplicationsDashboard token={token} />;
      case 'care-plans': return <CarePlans token={token} />;
      case 'incidents': return <IncidentReporting token={token} />;
      case 'notifications': return <NotificationCenter token={token} />;
      case 'messages': return <MessageBoard token={token} />;
      case 'compliance': return <ComplianceTracking token={token} />;
      case 'reports': return <ReportsAnalytics token={token} />;
      case 'payroll': return <PayrollProcessing token={token} />;
      case 'expenses': return <ExpenseManagement token={token} />;
      case 'audit-logs': return <AuditLogs token={token} />;
      case 'caregiver-profile': return selectedCaregiverId ? (
        <CaregiverProfile caregiverId={selectedCaregiverId} token={token}
          onBack={() => { setSelectedCaregiverId(null); setCurrentPage('caregivers'); }} />
      ) : null;
      case 'caregiver-history': return selectedCaregiverId ? (
        <CaregiverHistory caregiverId={selectedCaregiverId} caregiverName={selectedCaregiverName}
          token={token} onBack={() => { setSelectedCaregiverId(null); setCurrentPage('caregivers'); }} />
      ) : null;
      case 'claims': return <ClaimsManagement token={token} />;
      case 'medications': return <MedicationsManagement token={token} />;
      case 'documents': return <DocumentsManagement token={token} />;
      case 'adl': return <ADLTracking token={token} />;
      case 'background-checks': return <BackgroundChecks token={token} />;
      case 'sms': return <SMSManagement token={token} />;
      case 'family-portal': return <FamilyPortalAdmin token={token} />;
      case 'alerts': return <AlertsManagement token={token} />;
      default: return <DashboardOverview summary={summary} token={token} onNavigate={handlePageClick} />;
    }
  };

  const pageTitle = ALL_ITEMS.find(i => i.id === currentPage)?.label || 'Dashboard';

  return (
    <div style={{ display: 'flex', width: '100%', height: '100%' }}>
      {/* Sidebar overlay on mobile */}
      {sidebarOpen && window.innerWidth <= 768 && (
        <div className="sidebar-overlay active" onClick={() => setSidebarOpen(false)} />
      )}

      {/* SIDEBAR */}
      <div className={`sidebar ${sidebarOpen ? 'open' : ''}`} style={{ width: '260px', minWidth: '260px' }}>
        <div className="sidebar-logo" style={{ fontSize: '1.4rem', padding: '0 0.5rem 1.5rem 0.5rem' }}>
          <span>🏥</span> CVHC CRM
        </div>

        <ul className="sidebar-nav" style={{ paddingBottom: '1rem' }}>
          {NAV_SECTIONS.map(section => {
            const isCollapsed = collapsedSections[section.id];
            const hasActive = section.items.some(i => i.id === currentPage);
            return (
              <li key={section.id} style={{ marginBottom: '0.25rem' }}>
                {/* Section header */}
                <button
                  onClick={() => toggleSection(section.id)}
                  style={{
                    width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                    padding: '0.5rem 0.75rem', background: hasActive ? 'rgba(255,255,255,0.1)' : 'none',
                    border: 'none', cursor: 'pointer', borderRadius: '6px',
                    color: 'rgba(255,255,255,0.7)', fontSize: '0.72rem', fontWeight: '700',
                    textTransform: 'uppercase', letterSpacing: '0.07em'
                  }}
                >
                  <span>{section.icon} {section.label}</span>
                  <span style={{ fontSize: '0.8rem', opacity: 0.7 }}>{isCollapsed ? '▶' : '▼'}</span>
                </button>

                {/* Section items */}
                {!isCollapsed && (
                  <ul style={{ listStyle: 'none', margin: '0.2rem 0 0.5rem 0', padding: 0 }}>
                    {section.items.map(item => (
                      <li key={item.id}>
                        <a
                          href={`#${item.id}`}
                          className={currentPage === item.id ? 'active' : ''}
                          onClick={(e) => { e.preventDefault(); handlePageClick(item.id); }}
                          style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.45rem 0.75rem 0.45rem 1.25rem', fontSize: '0.875rem' }}
                        >
                          <span style={{ fontSize: '0.95rem', width: '18px', textAlign: 'center' }}>{item.icon}</span>
                          {item.label}
                        </a>
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            );
          })}
        </ul>

        <div className="sidebar-user">
          <div className="sidebar-user-name">{user.name}</div>
          <div className="sidebar-user-role">Administrator</div>
          <button className="btn-logout" onClick={() => { setSidebarOpen(false); onLogout(); }}>
            Logout
          </button>
        </div>
      </div>

      {/* MAIN CONTENT */}
      <div className="main-content">
        {/* HEADER */}
        <div className="header" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '0.75rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
            <button
              className="hamburger-btn"
              onClick={() => setSidebarOpen(!sidebarOpen)}
              title="Menu"
              style={{ padding: '0.4rem 0.75rem', borderRadius: '6px', border: '1px solid #D1D5DB', background: '#fff', cursor: 'pointer', fontSize: '0.85rem', fontWeight: '600' }}
            >
              ☰ Menu
            </button>
            <div>
              <h1 style={{ fontSize: '1.15rem', margin: 0 }}>{pageTitle}</h1>
              <p style={{ margin: 0, fontSize: '0.78rem', color: '#9CA3AF' }}>Chippewa Valley Home Care</p>
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
            {/* Live stats */}
            <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
              <span style={{ padding: '0.3rem 0.6rem', background: '#F0FDF4', color: '#16A34A', borderRadius: '6px', fontSize: '0.78rem', fontWeight: '600', border: '1px solid #BBF7D0' }}>
                👥 {liveStats.activeCaregivers} Active
              </span>
              {summary?.pendingInvoices?.count > 0 && (
                <span style={{ padding: '0.3rem 0.6rem', background: '#FEF2F2', color: '#DC2626', borderRadius: '6px', fontSize: '0.78rem', fontWeight: '600', border: '1px solid #FCA5A5' }}>
                  🧾 {summary.pendingInvoices.count} Invoices
                </span>
              )}
            </div>

            {/* Global search */}
            <div ref={searchRef} style={{ position: 'relative' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', padding: '0.4rem 0.75rem', border: '1px solid #D1D5DB', borderRadius: '8px', background: '#fff', cursor: 'text' }}
                onClick={() => setShowSearch(true)}>
                <span style={{ color: '#9CA3AF' }}>🔍</span>
                <input
                  placeholder="Search..."
                  value={searchQuery}
                  onChange={e => { setSearchQuery(e.target.value); setShowSearch(true); }}
                  onFocus={() => setShowSearch(true)}
                  style={{ border: 'none', outline: 'none', fontSize: '0.85rem', width: '140px', background: 'transparent' }}
                />
              </div>
              {showSearch && searchResults.length > 0 && (
                <div style={{
                  position: 'absolute', top: 'calc(100% + 4px)', right: 0,
                  background: '#fff', borderRadius: '8px', border: '1px solid #E5E7EB',
                  boxShadow: '0 8px 24px rgba(0,0,0,0.12)', zIndex: 999, minWidth: '200px', overflow: 'hidden'
                }}>
                  {searchResults.map(item => (
                    <button key={item.id} onClick={() => handlePageClick(item.id)}
                      style={{
                        display: 'flex', alignItems: 'center', gap: '0.6rem', width: '100%',
                        padding: '0.6rem 0.875rem', border: 'none', background: 'none',
                        cursor: 'pointer', textAlign: 'left', fontSize: '0.875rem', color: '#374151'
                      }}
                      onMouseEnter={e => e.currentTarget.style.background = '#F9FAFB'}
                      onMouseLeave={e => e.currentTarget.style.background = 'none'}
                    >
                      <span>{item.icon}</span> {item.label}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Notification bell */}
            <button
              onClick={() => handlePageClick('notifications')}
              style={{
                position: 'relative', background: 'none', border: '1px solid #D1D5DB',
                borderRadius: '8px', padding: '0.4rem 0.6rem', cursor: 'pointer', fontSize: '1.1rem'
              }}
              title="Notifications"
            >
              🔔
              {unreadCount > 0 && (
                <span style={{
                  position: 'absolute', top: '-6px', right: '-6px',
                  background: '#DC2626', color: '#fff', borderRadius: '99px',
                  fontSize: '0.65rem', fontWeight: '700', padding: '1px 5px',
                  minWidth: '18px', textAlign: 'center', lineHeight: '16px'
                }}>
                  {unreadCount > 99 ? '99+' : unreadCount}
                </span>
              )}
            </button>

            {/* Help button */}
            <button
              onClick={() => setShowHelp(true)}
              style={{ background: '#2ABBA7', border: 'none', borderRadius: '8px', padding: '0.4rem 0.75rem', cursor: 'pointer', fontSize: '0.85rem', fontWeight: '700', color: '#fff' }}
              title="Help Center"
            >
              ❓ Help
            </button>
          </div>
        </div>

        <HelpPanel isOpen={showHelp} onClose={() => setShowHelp(false)} currentPage={currentPage} />

        <div className="container">
          {loading ? (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '1rem', marginBottom: '1.5rem' }}>
              {[1,2,3,4].map(i => (
                <div key={i} className="stat-card" style={{ minHeight: '80px', background: 'linear-gradient(90deg, #f0f0f0 25%, #e0e0e0 50%, #f0f0f0 75%)', backgroundSize: '200% 100%', animation: 'shimmer 1.5s infinite' }} />
              ))}
              <style>{`@keyframes shimmer { 0%{background-position:200% 0} 100%{background-position:-200% 0} }`}</style>
            </div>
          ) : renderPage()}
        </div>
      </div>
    </div>
  );
};

export default AdminDashboard;
