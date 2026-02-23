// src/App.jsx - Main application component
import React, { useState, useEffect, useCallback } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import Login from './components/Login';
import AdminDashboard from './components/AdminDashboard';
import CaregiverDashboard from './components/CaregiverDashboard';
import PaymentPage, { PaymentSuccess } from './components/PaymentPage';
import PortalLogin from './components/portal/PortalLogin';
import PortalSetup from './components/portal/PortalSetup';
import ClientPortal from './components/portal/ClientPortal';
import { ToastContainer, toast } from './components/Toast';
import { ConfirmModal } from './components/ConfirmModal';
import { setSessionExpiredCallback } from './config';
import { ErrorBoundary } from './components/ErrorBoundary';

const App = () => {
  return (
    <BrowserRouter>
      <ToastContainer />
      <ConfirmModal />

      <Routes>
        {/* Public payment routes */}
        <Route path="/pay/:invoiceId"    element={<PaymentPage />} />
        <Route path="/payment-success"   element={<PaymentSuccess />} />

        {/* Client portal setup (invite link) */}
        <Route path="/portal/setup"      element={<PortalSetup />} />

        {/* Client portal */}
        <Route path="/portal/*"          element={<PortalApp />} />

        {/* Staff app */}
        <Route path="/*"                 element={<MainApp />} />
      </Routes>
    </BrowserRouter>
  );
};

// ── Client Portal App ─────────────────────────────────────────────────────────
const PortalApp = () => {
  const [client, setClient]   = useState(null);
  const [loading, setLoading] = useState(true);
  const [token, setToken]     = useState(localStorage.getItem('portal_token'));

  const handleLogout = useCallback(() => {
    localStorage.removeItem('portal_token');
    setToken(null);
    setClient(null);
  }, []);

  useEffect(() => {
    if (token) {
      try {
        const payload = JSON.parse(atob(token.split('.')[1]));
        if (payload.exp && payload.exp * 1000 < Date.now()) {
          handleLogout();
          return;
        }
        // role must be 'client'
        if (payload.role !== 'client') {
          handleLogout();
          return;
        }
        setClient(payload);
      } catch {
        handleLogout();
      }
    }
    setLoading(false);
  }, [token, handleLogout]);

  const handleLogin = (token, clientData) => {
    localStorage.setItem('portal_token', token);
    setToken(token);
    // Merge JWT payload with name from response
    const payload = JSON.parse(atob(token.split('.')[1]));
    setClient({ ...payload, firstName: clientData.firstName, lastName: clientData.lastName });
  };

  if (loading) return <div className="loading"><div className="spinner"></div></div>;

  if (!client) return <PortalLogin onLogin={handleLogin} />;

  return (
    <ErrorBoundary>
      <ClientPortal user={client} token={token} onLogout={handleLogout} />
    </ErrorBoundary>
  );
};

// ── Staff App ─────────────────────────────────────────────────────────────────
const MainApp = () => {
  const [user, setUser]         = useState(null);
  const [loading, setLoading]   = useState(true);
  const [token, setToken]       = useState(localStorage.getItem('token'));

  // Impersonation state — keeps original admin session intact
  const [impersonationToken, setImpersonationToken] = useState(null);
  const [impersonationUser, setImpersonationUser]   = useState(null);

  const handleLogout = useCallback((expired = false) => {
    localStorage.removeItem('token');
    setToken(null);
    setUser(null);
    setImpersonationToken(null);
    setImpersonationUser(null);
    if (expired) toast('Your session has expired. Please log in again.', 'warning');
  }, []);

  useEffect(() => {
    setSessionExpiredCallback(() => handleLogout(true));
  }, [handleLogout]);

  useEffect(() => {
    if (token) {
      try {
        const payload = JSON.parse(atob(token.split('.')[1]));
        if (payload.exp && payload.exp * 1000 < Date.now()) {
          handleLogout(true);
          return;
        }
        setUser(payload);
      } catch {
        localStorage.removeItem('token');
        setToken(null);
      }
    }
    setLoading(false);
  }, [token]);

  const handleLogin = (token, userData) => {
    localStorage.setItem('token', token);
    setToken(token);
    setUser(userData);
  };

  const handleImpersonate = (impToken, impUser) => {
    setImpersonationToken(impToken);
    setImpersonationUser(impUser);
  };

  const exitImpersonation = () => {
    setImpersonationToken(null);
    setImpersonationUser(null);
    toast('Returned to your admin account', 'success');
  };

  if (loading) return <div className="loading"><div className="spinner"></div></div>;

  if (!user) return <Login onLogin={handleLogin} />;

  // Active impersonation — show target user's view with a banner
  if (impersonationToken && impersonationUser) {
    return (
      <ErrorBoundary>
        {/* Impersonation banner */}
        <div style={{
          position: 'fixed', top: 0, left: 0, right: 0, zIndex: 99999,
          background: '#f97316', color: '#fff',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '0.5rem 1.25rem', fontSize: '0.875rem', fontWeight: 600,
          boxShadow: '0 2px 8px rgba(0,0,0,0.2)'
        }}>
          <span>
            👁️ Viewing as <strong>{impersonationUser.name}</strong>
            <span style={{ fontWeight: 400, opacity: 0.85, marginLeft: '0.5rem' }}>
              ({impersonationUser.role}) — read-only debug view
            </span>
          </span>
          <button
            onClick={exitImpersonation}
            style={{
              background: 'rgba(255,255,255,0.25)', border: '1px solid rgba(255,255,255,0.5)',
              color: '#fff', padding: '0.25rem 0.9rem', borderRadius: '6px',
              cursor: 'pointer', fontWeight: 700, fontSize: '0.82rem'
            }}
          >
            ✕ Exit
          </button>
        </div>
        {/* Offset content below banner */}
        <div style={{ paddingTop: '2.5rem' }}>
          {impersonationUser.role === 'admin'
            ? <AdminDashboard user={impersonationUser} token={impersonationToken} onLogout={exitImpersonation} />
            : <CaregiverDashboard user={impersonationUser} token={impersonationToken} onLogout={exitImpersonation} />
          }
        </div>
      </ErrorBoundary>
    );
  }

  if (user.role === 'admin') {
    return (
      <ErrorBoundary>
        <AdminDashboard
          user={user}
          token={token}
          onLogout={handleLogout}
          onImpersonate={handleImpersonate}
        />
      </ErrorBoundary>
    );
  } else {
    return <ErrorBoundary><CaregiverDashboard user={user} token={token} onLogout={handleLogout} /></ErrorBoundary>;
  }
};

export default App;
