// src/components/AdminDashboard.jsx
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
import ScheduleCalendar from './admin/ScheduleCalendar';
import ApplicationsDashboard from './admin/ApplicationsDashboard';
import CaregiverProfile from './admin/CaregiverProfile';

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

  const renderPage = () => {
    switch (currentPage) {
      case 'dashboard':
        return <DashboardOverview summary={summary} token={token} />;
      case 'referrals':
        return <ReferralSources token={token} />;
      case 'clients':
        return <ClientsManagement token={token} />;
      case 'caregivers':
        return <CaregiverManagement token={token} onViewProfile={(id) => {
          setSelectedCaregiverId(id);
          setCurrentPage('caregiver-profile');
        }} />;
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
      case 'caregiver-profile':
        return selectedCaregiverId ? (
          <CaregiverProfile 
            caregiverId={selectedCaregiverId} 
            token={token} 
            onBack={() => setSelectedCaregiverId(null)}
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
              href="#performance"
              className={currentPage === 'performance' ? 'active' : ''}
              onClick={() => handlePageClick('performance')}
            >
              Performance
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
              href="#applications"
              className={currentPage === 'applications' ? 'active' : ''}
              onClick={() => handlePageClick('applications')}
            >
              Job Applications
            </a>
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
              href="#billing"
              className={currentPage === 'billing' ? 'active' : ''}
              onClick={() => handlePageClick('billing')}
            >
              Billing
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
