// src/components/admin/LoginActivity.jsx
import React, { useState, useEffect, useCallback } from 'react';
import { API_BASE_URL } from '../../config';

// Parses a user-agent string into a human-readable device/browser summary
function parseUserAgent(ua) {
  if (!ua) return '—';
  let browser = 'Unknown browser';
  let os = '';

  if (/Chrome\//.test(ua) && !/Chromium|Edg/.test(ua)) browser = 'Chrome';
  else if (/Firefox\//.test(ua)) browser = 'Firefox';
  else if (/Safari\//.test(ua) && !/Chrome/.test(ua)) browser = 'Safari';
  else if (/Edg\//.test(ua)) browser = 'Edge';

  if (/iPhone/.test(ua)) os = 'iPhone';
  else if (/iPad/.test(ua)) os = 'iPad';
  else if (/Android/.test(ua)) os = 'Android';
  else if (/Windows NT/.test(ua)) os = 'Windows';
  else if (/Mac OS X/.test(ua)) os = 'macOS';
  else if (/Linux/.test(ua)) os = 'Linux';

  return os ? `${browser} / ${os}` : browser;
}

function timeAgo(dateStr) {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

const FAIL_LABELS = {
  user_not_found: 'Unknown email',
  invalid_password: 'Wrong password',
  account_inactive: 'Inactive account',
};

const LoginActivity = ({ token }) => {
  const [activity, setActivity] = useState([]);
  const [loading, setLoading] = useState(true);
  const [pagination, setPagination] = useState({ total: 0, page: 1, pages: 1 });
  const [filters, setFilters] = useState({ email: '', success: '' });
  const [appliedFilters, setAppliedFilters] = useState({ email: '', success: '' });

  const loadActivity = useCallback(async (page = 1, filt = appliedFilters) => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ page, limit: 50 });
      if (filt.email) params.set('email', filt.email);
      if (filt.success !== '') params.set('success', filt.success);

      const res = await fetch(`${API_BASE_URL}/api/auth/login-activity?${params}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to load');
      setActivity(data.activity || []);
      setPagination(data.pagination || { total: 0, page: 1, pages: 1 });
    } catch (err) {
      console.error('Login activity error:', err);
    } finally {
      setLoading(false);
    }
  }, [token, appliedFilters]);

  useEffect(() => { loadActivity(1); }, []);

  const handleSearch = () => {
    setAppliedFilters({ ...filters });
    loadActivity(1, filters);
  };

  const handleReset = () => {
    const reset = { email: '', success: '' };
    setFilters(reset);
    setAppliedFilters(reset);
    loadActivity(1, reset);
  };

  // Stats derived from current page
  const total = pagination.total;
  const failedCount = activity.filter(a => !a.success).length;
  const uniqueIPs = new Set(activity.map(a => a.ip_address).filter(Boolean)).size;

  return (
    <div className="container">
      <div className="page-header">
        <div>
          <h2>Login Activity</h2>
          <p style={{ color: 'var(--color-text-light)', margin: 0 }}>
            All login attempts — who, when, where, and whether it worked
          </p>
        </div>
        <button className="btn btn-secondary btn-sm" onClick={() => loadActivity(pagination.page)}>
          ↻ Refresh
        </button>
      </div>

      {/* Summary stats */}
      <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: '1rem', marginBottom: '1.5rem' }}>
        {[
          { label: 'Total Records', value: total, color: '#3B82F6' },
          { label: 'This Page — Failed', value: failedCount, color: '#EF4444' },
          { label: 'This Page — Succeeded', value: activity.length - failedCount, color: '#10B981' },
          { label: 'Unique IPs', value: uniqueIPs, color: '#8B5CF6' },
        ].map(s => (
          <div key={s.label} className="card" style={{ textAlign: 'center', padding: '1rem' }}>
            <div style={{ fontSize: '1.75rem', fontWeight: 800, color: s.color }}>{s.value}</div>
            <div style={{ fontSize: '0.75rem', color: 'var(--color-text-light)', marginTop: '0.25rem' }}>{s.label}</div>
          </div>
        ))}
      </div>

      {/* Filters */}
      <div className="card" style={{ marginBottom: '1.25rem' }}>
        <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <div className="form-group" style={{ margin: 0, flex: '1 1 200px' }}>
            <label>Search email</label>
            <input
              type="text"
              className="form-control"
              placeholder="Filter by email..."
              value={filters.email}
              onChange={e => setFilters(f => ({ ...f, email: e.target.value }))}
              onKeyDown={e => e.key === 'Enter' && handleSearch()}
            />
          </div>
          <div className="form-group" style={{ margin: 0, minWidth: '160px' }}>
            <label>Result</label>
            <select
              className="form-control"
              value={filters.success}
              onChange={e => setFilters(f => ({ ...f, success: e.target.value }))}
            >
              <option value="">All attempts</option>
              <option value="true">✅ Successful only</option>
              <option value="false">❌ Failed only</option>
            </select>
          </div>
          <div style={{ display: 'flex', gap: '0.5rem' }}>
            <button className="btn btn-primary btn-sm" onClick={handleSearch}>Search</button>
            <button className="btn btn-secondary btn-sm" onClick={handleReset}>Reset</button>
          </div>
        </div>
      </div>

      {/* Table */}
      <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
        {loading ? (
          <div style={{ padding: '3rem', textAlign: 'center' }}>
            <div className="spinner" />
          </div>
        ) : activity.length === 0 ? (
          <div style={{ padding: '3rem', textAlign: 'center', color: 'var(--color-text-light)' }}>
            No login activity found.
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table className="table" style={{ margin: 0, minWidth: '700px' }}>
              <thead>
                <tr>
                  <th>Status</th>
                  <th>Email</th>
                  <th>Name / Role</th>
                  <th>IP Address</th>
                  <th>Device / Browser</th>
                  <th>When</th>
                  <th>Fail Reason</th>
                </tr>
              </thead>
              <tbody>
                {activity.map(row => {
                  const name = row.first_name
                    ? `${row.first_name} ${row.last_name}`
                    : '—';
                  return (
                    <tr key={row.id} style={{ background: row.success ? undefined : '#FFF5F5' }}>
                      <td>
                        <span
                          className="badge"
                          style={{
                            background: row.success ? '#D1FAE5' : '#FEE2E2',
                            color: row.success ? '#065F46' : '#991B1B',
                            fontWeight: 700,
                          }}
                        >
                          {row.success ? '✅ Success' : '❌ Failed'}
                        </span>
                      </td>
                      <td style={{ fontFamily: 'monospace', fontSize: '0.85rem' }}>{row.email}</td>
                      <td>
                        {name !== '—' ? (
                          <div>
                            <div style={{ fontWeight: 600 }}>{name}</div>
                            <div style={{ fontSize: '0.75rem', color: 'var(--color-text-light)' }}>{row.role}</div>
                          </div>
                        ) : '—'}
                      </td>
                      <td style={{ fontFamily: 'monospace', fontSize: '0.82rem' }}>{row.ip_address || '—'}</td>
                      <td style={{ fontSize: '0.82rem', color: 'var(--color-text-light)' }}>
                        {parseUserAgent(row.user_agent)}
                      </td>
                      <td>
                        <div style={{ fontWeight: 600, fontSize: '0.85rem' }}>
                          {timeAgo(row.created_at)}
                        </div>
                        <div style={{ fontSize: '0.72rem', color: 'var(--color-text-light)' }}>
                          {new Date(row.created_at).toLocaleString()}
                        </div>
                      </td>
                      <td>
                        {row.fail_reason ? (
                          <span className="badge" style={{ background: '#FEF3C7', color: '#92400E' }}>
                            {FAIL_LABELS[row.fail_reason] || row.fail_reason}
                          </span>
                        ) : '—'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Pagination */}
      {pagination.pages > 1 && (
        <div style={{ display: 'flex', justifyContent: 'center', gap: '0.5rem', marginTop: '1rem', alignItems: 'center' }}>
          <button
            className="btn btn-secondary btn-sm"
            disabled={pagination.page <= 1}
            onClick={() => loadActivity(pagination.page - 1)}
          >
            ← Prev
          </button>
          <span style={{ fontSize: '0.85rem', color: 'var(--color-text-light)' }}>
            Page {pagination.page} of {pagination.pages} &nbsp;·&nbsp; {pagination.total} records
          </span>
          <button
            className="btn btn-secondary btn-sm"
            disabled={pagination.page >= pagination.pages}
            onClick={() => loadActivity(pagination.page + 1)}
          >
            Next →
          </button>
        </div>
      )}
    </div>
  );
};

export default LoginActivity;
