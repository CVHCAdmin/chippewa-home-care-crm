// src/App.jsx - Main application component
import React, { useState, useEffect, useCallback } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import Login from './components/Login';
import AdminDashboard from './components/AdminDashboard';
import CaregiverDashboard from './components/CaregiverDashboard';
import PaymentPage, { PaymentSuccess } from './components/PaymentPage';
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
        {/* Public payment routes - no auth required */}
        <Route path="/pay/:invoiceId" element={<PaymentPage />} />
        <Route path="/payment-success" element={<PaymentSuccess />} />
        
        {/* Main app */}
        <Route path="/*" element={<MainApp />} />
      </Routes>
    </BrowserRouter>
  );
};

const MainApp = () => {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [token, setToken] = useState(localStorage.getItem('token'));

  const handleLogout = useCallback((expired = false) => {
    localStorage.removeItem('token');
    setToken(null);
    setUser(null);
    if (expired) toast('Your session has expired. Please log in again.', 'warning');
  }, []);

  useEffect(() => {
    setSessionExpiredCallback(() => handleLogout(true));
  }, [handleLogout]);

  useEffect(() => {
    if (token) {
      try {
        const payload = JSON.parse(atob(token.split('.')[1]));
        // Check expiry on load
        if (payload.exp && payload.exp * 1000 < Date.now()) {
          handleLogout(true);
          return;
        }
        setUser(payload);
      } catch (error) {
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

  if (loading) {
    return (
      <div className="loading">
        <div className="spinner"></div>
      </div>
    );
  }

  if (!user) {
    return <Login onLogin={handleLogin} />;
  }

  // Route based on user role
  if (user.role === 'admin') {
    return <ErrorBoundary><AdminDashboard user={user} token={token} onLogout={handleLogout} /></ErrorBoundary>;
  } else {
    return <ErrorBoundary><CaregiverDashboard user={user} token={token} onLogout={handleLogout} /></ErrorBoundary>;
  }
};

export default App;
