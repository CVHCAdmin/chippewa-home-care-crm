// src/config.js - Updated for Vite
export const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:5000';

// src/utils/api.js
export const apiCall = async (endpoint, options = {}, token) => {
  const headers = {
    'Content-Type': 'application/json',
    ...options.headers
  };

  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  const response = await fetch(`${API_BASE_URL}${endpoint}`, {
    ...options,
    headers
  });

  if (!response.ok) {
    throw new Error(await response.text());
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
export const trackGPS = (data, token) => apiCall('/api/gps-tracking', { method: 'POST', body: JSON.stringify(data) }, token);

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
