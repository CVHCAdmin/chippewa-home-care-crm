// src/components/AdminDashboard.jsx - UPDATED VERSION
import React, { useState, useEffect } from 'react';
import { getDashboardSummary } from '../config';
import DashboardOverview from './admin/DashboardOverview';
import ReferralSources from './admin/ReferralSources';
import ClientsManagement from './admin/ClientsManagement';
import CaregiverManagement from './admin/CaregiverManagement';
import BillingDashboard from './admin/BillingDashboard';
import SchedulesManagement from './admin/SchedulesManagement';
import ClientOnboarding from './admin/ClientOnboarding';
import PerformanceRatings from './admin/PerformanceRatings';
import AbsenceManagement from './admin/AbsenceManagement';
import ExpenseManagement from './admin/ExpenseManagement';
import ScheduleCalendar from './admin/ScheduleCalendar';
import CaregiverProfile from './admin/CaregiverProfile';
import ApplicationsDashboard from './admin/ApplicationsDashboard';
import CarePlans from './admin/CarePlans';
import IncidentReporting from './admin/IncidentReporting';
import CaregiverAvailability from './admin/CaregiverAvailability';
import NotificationCenter from './admin/NotificationCenter';
import ComplianceTracking from './admin/ComplianceTracking';
import ReportsAnalytics from './admin/ReportsAnalytics';
import PayrollProcessing from './admin/PayrollProcessing';
import AuditLogs from './admin/AuditLogs';

const AdminDashboard = ({ user, token, onLogout }) => {
  const [currentPage, setCurrentPage] = useState('dashboard');
  const [selectedCaregiverId, setSelectedCaregiverId] = useState(null);
  const [summary, setSummary] = useState(null);
  const [loading, setLoading] = useState(true);
  const [sidebarOpen, setSidebarOpen] = useState(false);

  useEffect(() => {
    loadDashboard();
  }, []);

  useEffect(() => {
    if (window.innerWidth <= 768) {
      setSidebarOpen(false);
    }
  }, [currentPage]);

  useEffect(() => {
    const handleResize = () => {
      if (window.innerWidth > 768) {
        setSidebarOpen(true);
      } else {
        setSidebarOpen(false);
      }
    };

    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  const loadDashboard = async () => {
    try {
      const data = await getDashboardSummary(token);
      setSummary(data);
    } catch (error) {
      console.error('Failed to load dashboard:', error);
    } finally {
      setLoading(false);
    }
  };

  const handlePageClick = (page) => {
    setCurrentPage(page);
    if (window.innerWidth <= 768) {
      setSidebarOpen(false);
    }
  };

  const handleViewCaregiverProfile = (caregiverId) => {
    setSelectedCaregiverId(caregiverId);
    setCurrentPage('caregiver-profile');
  };

  const renderPage = () => {
    switch (currentPage) {
      case 'dashboard':
        return <DashboardOverview summary={summary} token={token} />;
      case 'referrals':
        return <ReferralSources token={token} />;
      case 'clients':
        return <ClientsManagement token={token} />;
      case 'caregivers':
        return <CaregiverManagement token={token} onViewProfile={handleViewCaregiverProfile} />;
      case 'billing':
        return <BillingDashboard token={token} />;
      case 'schedules':
        return <SchedulesManagement token={token} />;
      case 'onboarding':
        return <ClientOnboarding token={token} />;
      case 'performance':
        return <PerformanceRatings token={token} />;
      case 'absences':
        return <AbsenceManagement token={token} />;
      case 'calendar':
        return <ScheduleCalendar token={token} />;
      case 'applications':
        return <ApplicationsDashboard token={token} />;
      case 'care-plans':
        return <CarePlans token={token} />;
      case 'incidents':
        return <IncidentReporting token={token} />;
      case 'availability':
        return <CaregiverAvailability token={token} />;
      case 'notifications':
        return <NotificationCenter token={token} />;
      case 'compliance':
        return <ComplianceTracking token={token} />;
      case 'reports':
        return <ReportsAnalytics token={token} />;
      case 'payroll':
        return <PayrollProcessing token={token} />;
      case 'expenses':
        return <ExpenseManagement token={token} />;
      case 'audit-logs':
        return <AuditLogs token={token} />;
      case 'caregiver-profile':
        return selectedCaregiverId ? (
          <CaregiverProfile 
            caregiverId={selectedCaregiverId} 
            token={token} 
            onBack={() => {
              setSelectedCaregiverId(null);
              setCurrentPage('caregivers');
            }}
          />
        ) : null;
      default:
        return <DashboardOverview summary={summary} token={token} />;
    }
  };

  const handleLogoutClick = () => {
    setSidebarOpen(false);
    onLogout();
  };

  return (
    <div style={{ display: 'flex', width: '100%', height: '100%' }}>
      {sidebarOpen && window.innerWidth <= 768 && (
        <div
          className="sidebar-overlay active"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      <div className={`sidebar ${sidebarOpen ? 'open' : ''}`}>
        <div className="sidebar-logo">
          CVHC CRM
        </div>
        <ul className="sidebar-nav">
          <li>
            <a
              href="#dashboard"
              className={currentPage === 'dashboard' ? 'active' : ''}
              onClick={() => handlePageClick('dashboard')}
            >
              Dashboard
            </a>
          </li>
          
          {/* Operations Section */}
          <li style={{ paddingTop: '1rem', borderTop: '1px solid #ddd', marginTop: '0.5rem' }}>
            <span style={{ fontSize: '0.75rem', textTransform: 'uppercase', color: '#999', fontWeight: 'bold', display: 'block', padding: '0.5rem 1rem' }}>
              Operations
            </span>
          </li>
          <li>
            <a
              href="#referrals"
              className={currentPage === 'referrals' ? 'active' : ''}
              onClick={() => handlePageClick('referrals')}
            >
              Referral Sources
            </a>
          </li>
          <li>
            <a
              href="#clients"
              className={currentPage === 'clients' ? 'active' : ''}
              onClick={() => handlePageClick('clients')}
            >
              Clients
            </a>
          </li>
          <li>
            <a
              href="#onboarding"
              className={currentPage === 'onboarding' ? 'active' : ''}
              onClick={() => handlePageClick('onboarding')}
            >
              Onboarding
            </a>
          </li>
          <li>
            <a
              href="#care-plans"
              className={currentPage === 'care-plans' ? 'active' : ''}
              onClick={() => handlePageClick('care-plans')}
            >
              Care Plans
            </a>
          </li>

          {/* Scheduling Section */}
          <li style={{ paddingTop: '1rem', borderTop: '1px solid #ddd', marginTop: '0.5rem' }}>
            <span style={{ fontSize: '0.75rem', textTransform: 'uppercase', color: '#999', fontWeight: 'bold', display: 'block', padding: '0.5rem 1rem' }}>
              Scheduling
            </span>
          </li>
          <li>
            <a
              href="#calendar"
              className={currentPage === 'calendar' ? 'active' : ''}
              onClick={() => handlePageClick('calendar')}
            >
              Schedule Calendar
            </a>
          </li>
          <li>
            <a
              href="#schedules"
              className={currentPage === 'schedules' ? 'active' : ''}
              onClick={() => handlePageClick('schedules')}
            >
              Schedules
            </a>
          </li>
          <li>
            <a
              href="#availability"
              className={currentPage === 'availability' ? 'active' : ''}
              onClick={() => handlePageClick('availability')}
            >
              Availability
            </a>
          </li>
          <li>
            <a
              href="#absences"
              className={currentPage === 'absences' ? 'active' : ''}
              onClick={() => handlePageClick('absences')}
            >
              Absences
            </a>
          </li>

          {/* Caregiving Section */}
          <li style={{ paddingTop: '1rem', borderTop: '1px solid #ddd', marginTop: '0.5rem' }}>
            <span style={{ fontSize: '0.75rem', textTransform: 'uppercase', color: '#999', fontWeight: 'bold', display: 'block', padding: '0.5rem 1rem' }}>
              Caregiving
            </span>
          </li>
          <li>
            <a
              href="#caregivers"
              className={currentPage === 'caregivers' ? 'active' : ''}
              onClick={() => handlePageClick('caregivers')}
            >
              Caregivers
            </a>
          </li>
          <li>
            <a
              href="#performance"
              className={currentPage === 'performance' ? 'active' : ''}
              onClick={() => handlePageClick('performance')}
            >
              Performance
            </a>
          </li>
          <li>
            <a
              href="#incidents"
              className={currentPage === 'incidents' ? 'active' : ''}
              onClick={() => handlePageClick('incidents')}
            >
              Incidents
            </a>
          </li>
          <li>
            <a
              href="#applications"
              className={currentPage === 'applications' ? 'active' : ''}
              onClick={() => handlePageClick('applications')}
            >
              Job Applications
            </a>
          </li>

          {/* Financial Section */}
          <li style={{ paddingTop: '1rem', borderTop: '1px solid #ddd', marginTop: '0.5rem' }}>
            <span style={{ fontSize: '0.75rem', textTransform: 'uppercase', color: '#999', fontWeight: 'bold', display: 'block', padding: '0.5rem 1rem' }}>
              Financial
            </span>
          </li>
          <li>
            <a
              href="#billing"
              className={currentPage === 'billing' ? 'active' : ''}
              onClick={() => handlePageClick('billing')}
            >
              Billing
            </a>
          </li>
          <li>
            <a
              href="#payroll"
              className={currentPage === 'payroll' ? 'active' : ''}
              onClick={() => handlePageClick('payroll')}
            >
              Payroll
            </a>
          </li>
          <li>
            <a
              href="#expenses"
              className={currentPage === 'expenses' ? 'active' : ''}
              onClick={() => handlePageClick('expenses')}
            >
              💰 Expenses
            </a>
          </li>
          <li>
            <a
              href="#reports"
              className={currentPage === 'reports' ? 'active' : ''}
              onClick={() => handlePageClick('reports')}
            >
              Reports & Analytics
            </a>
          </li>

          {/* Compliance Section */}
          <li style={{ paddingTop: '1rem', borderTop: '1px solid #ddd', marginTop: '0.5rem' }}>
            <span style={{ fontSize: '0.75rem', textTransform: 'uppercase', color: '#999', fontWeight: 'bold', display: 'block', padding: '0.5rem 1rem' }}>
              Compliance
            </span>
          </li>
          <li>
            <a
              href="#compliance"
              className={currentPage === 'compliance' ? 'active' : ''}
              onClick={() => handlePageClick('compliance')}
            >
              Compliance
            </a>
          </li>
          <li>
            <a
              href="#audit-logs"
              className={currentPage === 'audit-logs' ? 'active' : ''}
              onClick={() => handlePageClick('audit-logs')}
            >
              Audit Logs
            </a>
          </li>
          <li>
            <a
              href="#notifications"
              className={currentPage === 'notifications' ? 'active' : ''}
              onClick={() => handlePageClick('notifications')}
            >
              Notifications
            </a>
          </li>
        </ul>

        <div className="sidebar-user">
          <div className="sidebar-user-name">{user.name}</div>
          <div className="sidebar-user-role">Administrator</div>
          <button className="btn-logout" onClick={handleLogoutClick}>
            Logout
          </button>
        </div>
      </div>

      <div className="main-content">
        <div className="header">
          <div>
            <h1>Chippewa Valley Home Care</h1>
            <p>HIPAA-Compliant CRM & Operations Management</p>
          </div>
          <button
            className="hamburger-btn"
            onClick={() => setSidebarOpen(!sidebarOpen)}
            title="Menu"
          >
            Menu
          </button>
        </div>

        <div className="container">
          {loading ? (
            <div className="loading">
              <div className="spinner"></div>
            </div>
          ) : (
            renderPage()
          )}
        </div>
      </div>
    </div>
  );
};

export default AdminDashboard;
