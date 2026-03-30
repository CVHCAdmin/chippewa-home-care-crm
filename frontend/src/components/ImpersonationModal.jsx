// src/components/ImpersonationModal.jsx
import React, { useState, useEffect } from 'react';
import { API_BASE_URL } from '../config';

const ImpersonationModal = ({ token, onImpersonate, onClose }) => {
  const [users, setUsers] = useState([]);
  const [clients, setClients] = useState([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [impersonating, setImpersonating] = useState(null);
  const [error, setError] = useState('');
  const [tab, setTab] = useState('staff'); // 'staff' | 'clients'

  useEffect(() => {
    Promise.all([
      fetch(`${API_BASE_URL}/api/auth/users`, {
        headers: { Authorization: `Bearer ${token}` }
      }).then(r => r.ok ? r.json() : []),
      fetch(`${API_BASE_URL}/api/clients`, {
        headers: { Authorization: `Bearer ${token}` }
      }).then(r => r.ok ? r.json() : [])
    ])
      .then(([userData, clientData]) => {
        setUsers(Array.isArray(userData) ? userData : []);
        setClients(Array.isArray(clientData) ? clientData : []);
        setLoading(false);
      })
      .catch(() => { setError('Failed to load data'); setLoading(false); });
  }, [token]);

  const q = search.toLowerCase();

  const filteredUsers = users.filter(u =>
    u.first_name?.toLowerCase().includes(q) ||
    u.last_name?.toLowerCase().includes(q) ||
    u.email?.toLowerCase().includes(q) ||
    u.role?.toLowerCase().includes(q)
  );

  const filteredClients = clients.filter(c =>
    c.first_name?.toLowerCase().includes(q) ||
    c.last_name?.toLowerCase().includes(q) ||
    c.email?.toLowerCase().includes(q) ||
    c.phone?.includes(q)
  );

  const handleImpersonate = async (userId) => {
    setImpersonating(userId);
    setError('');
    try {
      const res = await fetch(`${API_BASE_URL}/api/auth/impersonate/${userId}`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` }
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed');
      onImpersonate(data.token, data.user);
    } catch (e) {
      setError(e.message);
    } finally {
      setImpersonating(null);
    }
  };

  const handlePortalPreview = async (clientId) => {
    setImpersonating(clientId);
    setError('');
    try {
      const res = await fetch(`${API_BASE_URL}/api/auth/impersonate-portal/${clientId}`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` }
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed');
      onImpersonate(data.token, data.user);
    } catch (e) {
      setError(e.message);
    } finally {
      setImpersonating(null);
    }
  };

  const roleIcon = (role) => role === 'admin' ? '🔑' : '👤';
  const roleColor = (role) => role === 'admin' ? '#7c3aed' : '#2563eb';

  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      zIndex: 9999, padding: '1rem'
    }}>
      <div style={{
        background: '#fff', borderRadius: '12px', width: '100%', maxWidth: '520px',
        maxHeight: '80vh', display: 'flex', flexDirection: 'column',
        boxShadow: '0 20px 60px rgba(0,0,0,0.3)'
      }}>
        {/* Header */}
        <div style={{
          padding: '1.25rem 1.5rem', borderBottom: '1px solid #e5e7eb',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between'
        }}>
          <div>
            <h2 style={{ margin: 0, fontSize: '1.1rem', fontWeight: 700 }}>👁️ View As</h2>
            <p style={{ margin: '0.2rem 0 0', fontSize: '0.82rem', color: '#6b7280' }}>
              See the app from a staff member or client's perspective
            </p>
          </div>
          <button onClick={onClose} style={{
            background: 'none', border: 'none', fontSize: '1.4rem',
            cursor: 'pointer', color: '#9ca3af', lineHeight: 1
          }}>×</button>
        </div>

        {/* Tabs */}
        <div style={{ display: 'flex', borderBottom: '1px solid #e5e7eb' }}>
          {[
            { key: 'staff', label: 'Staff', icon: '👤', count: users.length },
            { key: 'clients', label: 'Client Portal', icon: '🏠', count: clients.length },
          ].map(t => (
            <button
              key={t.key}
              onClick={() => { setTab(t.key); setSearch(''); }}
              style={{
                flex: 1, padding: '0.65rem', border: 'none', cursor: 'pointer',
                fontWeight: 600, fontSize: '0.85rem',
                background: tab === t.key ? '#f0f9ff' : 'transparent',
                color: tab === t.key ? '#2563eb' : '#6b7280',
                borderBottom: tab === t.key ? '2px solid #2563eb' : '2px solid transparent',
              }}
            >
              {t.icon} {t.label} ({t.count})
            </button>
          ))}
        </div>

        {/* Search */}
        <div style={{ padding: '1rem 1.5rem', borderBottom: '1px solid #f3f4f6' }}>
          <input
            autoFocus
            type="text"
            placeholder={tab === 'staff' ? 'Search by name, email, or role...' : 'Search by name, email, or phone...'}
            value={search}
            onChange={e => setSearch(e.target.value)}
            style={{
              width: '100%', padding: '0.6rem 0.9rem', borderRadius: '8px',
              border: '1px solid #d1d5db', fontSize: '0.9rem', outline: 'none',
              boxSizing: 'border-box'
            }}
          />
        </div>

        {/* List */}
        <div style={{ overflowY: 'auto', flex: 1 }}>
          {loading && (
            <div style={{ padding: '2rem', textAlign: 'center', color: '#9ca3af' }}>
              Loading...
            </div>
          )}
          {error && (
            <div style={{ padding: '1rem 1.5rem', color: '#dc2626', fontSize: '0.85rem' }}>
              ⚠️ {error}
            </div>
          )}

          {/* Staff list */}
          {tab === 'staff' && !loading && filteredUsers.length === 0 && (
            <div style={{ padding: '2rem', textAlign: 'center', color: '#9ca3af' }}>
              No staff found
            </div>
          )}
          {tab === 'staff' && filteredUsers.map(u => (
            <div key={u.id} style={{
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              padding: '0.75rem 1.5rem', borderBottom: '1px solid #f9fafb',
              transition: 'background 0.1s'
            }}
              onMouseEnter={e => e.currentTarget.style.background = '#f9fafb'}
              onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                <div style={{
                  width: '38px', height: '38px', borderRadius: '50%',
                  background: roleColor(u.role) + '18',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: '1.1rem'
                }}>
                  {roleIcon(u.role)}
                </div>
                <div>
                  <div style={{ fontWeight: 600, fontSize: '0.9rem' }}>
                    {u.first_name} {u.last_name}
                  </div>
                  <div style={{ fontSize: '0.78rem', color: '#6b7280' }}>{u.email}</div>
                </div>
                <span style={{
                  fontSize: '0.7rem', padding: '0.15rem 0.5rem', borderRadius: '999px',
                  background: roleColor(u.role) + '18', color: roleColor(u.role),
                  fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em'
                }}>
                  {u.role}
                </span>
              </div>
              <button
                onClick={() => handleImpersonate(u.id)}
                disabled={impersonating === u.id}
                style={{
                  padding: '0.4rem 1rem', borderRadius: '6px', border: 'none',
                  background: impersonating === u.id ? '#e5e7eb' : '#2563eb',
                  color: impersonating === u.id ? '#9ca3af' : '#fff',
                  fontSize: '0.82rem', fontWeight: 600, cursor: impersonating === u.id ? 'not-allowed' : 'pointer',
                  whiteSpace: 'nowrap'
                }}
              >
                {impersonating === u.id ? 'Loading...' : 'View As'}
              </button>
            </div>
          ))}

          {/* Clients list */}
          {tab === 'clients' && !loading && filteredClients.length === 0 && (
            <div style={{ padding: '2rem', textAlign: 'center', color: '#9ca3af' }}>
              No clients found
            </div>
          )}
          {tab === 'clients' && filteredClients.map(c => (
            <div key={c.id} style={{
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              padding: '0.75rem 1.5rem', borderBottom: '1px solid #f9fafb',
              transition: 'background 0.1s'
            }}
              onMouseEnter={e => e.currentTarget.style.background = '#f9fafb'}
              onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                <div style={{
                  width: '38px', height: '38px', borderRadius: '50%',
                  background: '#059669' + '18',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: '1.1rem'
                }}>
                  🏠
                </div>
                <div>
                  <div style={{ fontWeight: 600, fontSize: '0.9rem' }}>
                    {c.first_name} {c.last_name}
                  </div>
                  <div style={{ fontSize: '0.78rem', color: '#6b7280' }}>
                    {c.email || c.phone || 'No contact info'}
                  </div>
                </div>
              </div>
              <button
                onClick={() => handlePortalPreview(c.id)}
                disabled={impersonating === c.id}
                style={{
                  padding: '0.4rem 1rem', borderRadius: '6px', border: 'none',
                  background: impersonating === c.id ? '#e5e7eb' : '#059669',
                  color: impersonating === c.id ? '#9ca3af' : '#fff',
                  fontSize: '0.82rem', fontWeight: 600, cursor: impersonating === c.id ? 'not-allowed' : 'pointer',
                  whiteSpace: 'nowrap'
                }}
              >
                {impersonating === c.id ? 'Loading...' : 'View Portal'}
              </button>
            </div>
          ))}
        </div>

        {/* Footer */}
        <div style={{
          padding: '0.85rem 1.5rem', borderTop: '1px solid #e5e7eb',
          background: '#fafafa', borderRadius: '0 0 12px 12px',
          fontSize: '0.75rem', color: '#9ca3af'
        }}>
          🔒 All impersonation sessions are logged in the audit trail
        </div>
      </div>
    </div>
  );
};

export default ImpersonationModal;
