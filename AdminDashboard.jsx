// src/components/AdminDashboard.jsx
import React, { useState, useEffect } from 'react';
import { getDashboardSummary } from '../config';
import DashboardOverview from './admin/DashboardOverview';
import ReferralSources from './admin/ReferralSources';
import ClientsManagement from './admin/ClientsManagement';
import CaregiverManagement from './admin/CaregiverManagement';
import BillingDashboard from './admin/BillingDashboard';
import SchedulesManagement from './admin/SchedulesManagement';

const AdminDashboard = ({ user, token, onLogout }) => {
  const [currentPage, setCurrentPage] = useState('dashboard');
  const [summary, setSummary] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadDashboard();
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

  const renderPage = () => {
    switch (currentPage) {
      case 'dashboard':
        return <DashboardOverview summary={summary} token={token} />;
      case 'referrals':
        return <ReferralSources token={token} />;
      case 'clients':
        return <ClientsManagement token={token} />;
      case 'caregivers':
        return <CaregiverManagement token={token} />;
      case 'billing':
        return <BillingDashboard token={token} />;
      case 'schedules':
        return <SchedulesManagement token={token} />;
      default:
        return <DashboardOverview summary={summary} token={token} />;
    }
  };

  return (
    <div style={{ display: 'flex', height: '100vh' }}>
      {/* Sidebar */}
      <div className="sidebar">
        <div className="sidebar-logo">
          📋 CVHC CRM
        </div>
        <ul className="sidebar-nav">
          <li>
            <a 
              href="#dashboard"
              className={currentPage === 'dashboard' ? 'active' : ''}
              onClick={() => setCurrentPage('dashboard')}
            >
              📊 Dashboard
            </a>
          </li>
          <li>
            <a 
              href="#referrals"
              className={currentPage === 'referrals' ? 'active' : ''}
              onClick={() => setCurrentPage('referrals')}
            >
              🏥 Referral Sources
            </a>
          </li>
          <li>
            <a 
              href="#clients"
              className={currentPage === 'clients' ? 'active' : ''}
              onClick={() => setCurrentPage('clients')}
            >
              👥 Clients
            </a>
          </li>
          <li>
            <a 
              href="#caregivers"
              className={currentPage === 'caregivers' ? 'active' : ''}
              onClick={() => setCurrentPage('caregivers')}
            >
              👔 Caregivers
            </a>
          </li>
          <li>
            <a 
              href="#billing"
              className={currentPage === 'billing' ? 'active' : ''}
              onClick={() => setCurrentPage('billing')}
            >
              💰 Billing
            </a>
          </li>
          <li>
            <a 
              href="#schedules"
              className={currentPage === 'schedules' ? 'active' : ''}
              onClick={() => setCurrentPage('schedules')}
            >
              📅 Schedules
            </a>
          </li>
        </ul>

        <div className="sidebar-user">
          <div className="sidebar-user-name">{user.name}</div>
          <div className="sidebar-user-role">Administrator</div>
          <button className="btn-logout" onClick={onLogout}>
            Logout
          </button>
        </div>
      </div>

      {/* Main Content */}
      <div className="main-content">
        <div className="header">
          <h1>Chippewa Valley Home Care</h1>
          <p>HIPAA-Compliant CRM & Operations Management</p>
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
