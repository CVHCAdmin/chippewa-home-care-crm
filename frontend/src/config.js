// src/config.js - API utilities with token expiry handling
export const API_BASE_URL = import.meta.env.VITE_API_URL || 'https://chippewa-home-care-api.onrender.com';

// Global logout callback — set by App on mount
let _onSessionExpired = null;
export const setSessionExpiredCallback = (fn) => { _onSessionExpired = fn; };

// Check if JWT is expired (without verifying signature)
export const isTokenExpired = (token) => {
  try {
    const payload = JSON.parse(atob(token.split('.')[1]));
    if (!payload.exp) return false;
    return payload.exp * 1000 < Date.now();
  } catch {
    return true;
  }
};

export const apiCall = async (endpoint, options = {}, token) => {
  const headers = { 'Content-Type': 'application/json', ...options.headers };

  if (token) {
    if (isTokenExpired(token)) {
      if (_onSessionExpired) _onSessionExpired();
      throw new Error('SESSION_EXPIRED');
    }
    headers.Authorization = `Bearer ${token}`;
  }

  const response = await fetch(`${API_BASE_URL}${endpoint}`, { ...options, headers });

  if (response.status === 401) {
    if (_onSessionExpired) _onSessionExpired();
    throw new Error('SESSION_EXPIRED');
  }

  if (response.status === 429) {
    // Rate limited - return null silently instead of crashing
    console.warn(`[Rate limited] ${endpoint} - will retry on next poll`);
    return null;
  }

  if (!response.ok) {
    const text = await response.text();
    let msg = text;
    try { msg = JSON.parse(text).error || text; } catch {}
    throw new Error(msg);
  }

  return response.json();
};

export const getClients = (token) => apiCall('/api/clients', { method: 'GET' }, token);
export const createClient = (data, token) => apiCall('/api/clients', { method: 'POST', body: JSON.stringify(data) }, token);
export const getClientDetails = (id, token) => apiCall(`/api/clients/${id}`, { method: 'GET' }, token);
export const updateClient = (id, data, token) => apiCall(`/api/clients/${id}`, { method: 'PUT', body: JSON.stringify(data) }, token);

export const getReferralSources = (token) => apiCall('/api/referral-sources', { method: 'GET' }, token);
export const createReferralSource = (data, token) => apiCall('/api/referral-sources', { method: 'POST', body: JSON.stringify(data) }, token);

export const getCaregivers = (token) => apiCall('/api/users/caregivers', { method: 'GET' }, token);
export const convertToAdmin = (userId, token) => apiCall('/api/users/convert-to-admin', { method: 'POST', body: JSON.stringify({ userId }) }, token);

export const getSchedules = (caregiverId, token) => apiCall(`/api/schedules/${caregiverId}`, { method: 'GET' }, token);
export const createSchedule = (data, token) => apiCall('/api/schedules', { method: 'POST', body: JSON.stringify(data) }, token);

export const clockIn = (data, token) => apiCall('/api/time-entries/clock-in', { method: 'POST', body: JSON.stringify(data) }, token);
export const clockOut = (id, data, token) => apiCall(`/api/time-entries/${id}/clock-out`, { method: 'POST', body: JSON.stringify(data) }, token);
export const trackGPS = (id, data, token) => apiCall(`/api/time-entries/${id}/gps`, { method: 'POST', body: JSON.stringify(data) }, token);

export const getInvoices = (token) => apiCall('/api/invoices', { method: 'GET' }, token);
export const generateInvoice = (data, token) => apiCall('/api/invoices/generate', { method: 'POST', body: JSON.stringify(data) }, token);
export const updateInvoiceStatus = (id, data, token) => apiCall(`/api/invoices/${id}/payment-status`, { method: 'PUT', body: JSON.stringify(data) }, token);

export const getDashboardSummary = (token) => apiCall('/api/dashboard/summary', { method: 'GET' }, token);
export const getDashboardReferrals = (token) => apiCall('/api/dashboard/referrals', { method: 'GET' }, token);
export const getDashboardHours = (token) => apiCall('/api/dashboard/caregiver-hours', { method: 'GET' }, token);

export const exportInvoicesCSV = async (token) => {
  const headers = { 'Authorization': `Bearer ${token}` };
  const response = await fetch(`${API_BASE_URL}/api/export/invoices-csv`, { headers });
  return response.blob();
};

export const updateNotificationPreferences = (data, token) => apiCall('/api/notifications/preferences', { method: 'PUT', body: JSON.stringify(data) }, token);
