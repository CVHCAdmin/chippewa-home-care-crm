// src/components/admin/ChangePassword.jsx
// Self-service password change for logged-in users + Admin reset for any user
import React, { useState, useEffect } from 'react';
import { API_BASE_URL } from '../../config';

const ChangePassword = ({ token, user }) => {
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  // Admin reset state
  const [users, setUsers] = useState([]);
  const [selectedUserId, setSelectedUserId] = useState('');
  const [resetPassword, setResetPassword] = useState('');
  const [resetMessage, setResetMessage] = useState('');
  const [resetError, setResetError] = useState('');
  const [resetLoading, setResetLoading] = useState(false);

  const isAdmin = user?.role === 'admin';

  useEffect(() => {
    if (isAdmin) loadUsers();
  }, [isAdmin]);

  const loadUsers = async () => {
    try {
      const res = await fetch(`${API_BASE_URL}/api/users/all`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (res.ok) setUsers(await res.json());
    } catch (err) {
      console.error('Failed to load users:', err);
    }
  };

  const handleChangePassword = async (e) => {
    e.preventDefault();
    setError('');
    setMessage('');

    if (newPassword !== confirmPassword) { setError('Passwords do not match'); return; }
    if (newPassword.length < 8) { setError('New password must be at least 8 characters'); return; }

    setLoading(true);
    try {
      const res = await fetch(`${API_BASE_URL}/api/auth/change-password`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ currentPassword, newPassword })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed');
      setMessage('Password changed successfully!');
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleAdminReset = async (e) => {
    e.preventDefault();
    setResetError('');
    setResetMessage('');

    if (!selectedUserId) { setResetError('Select a user'); return; }
    if (resetPassword.length < 8) { setResetError('Password must be at least 8 characters'); return; }

    setResetLoading(true);
    try {
      const res = await fetch(`${API_BASE_URL}/api/users/${selectedUserId}/reset-password`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ newPassword: resetPassword })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed');
      const u = users.find(u => u.id === selectedUserId);
      setResetMessage(`Password reset for ${u?.first_name} ${u?.last_name}`);
      setResetPassword('');
      setSelectedUserId('');
    } catch (err) {
      setResetError(err.message);
    } finally {
      setResetLoading(false);
    }
  };

  const generatePassword = () => {
    const chars = 'abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789!@#$';
    let pw = '';
    for (let i = 0; i < 12; i++) pw += chars[Math.floor(Math.random() * chars.length)];
    setResetPassword(pw);
  };

  return (
    <div>
      <div className="page-header">
        <h2>Password Management</h2>
      </div>

      {/* Change Own Password */}
      <div className="card" style={{ maxWidth: '500px', marginBottom: '2rem' }}>
        <h3 style={{ margin: '0 0 0.5rem' }}>Change Your Password</h3>
        <p style={{ color: '#666', fontSize: '0.88rem', marginBottom: '1rem' }}>
          Update your own login password. You'll need your current password to confirm.
        </p>

        {error && <div className="alert alert-error" style={{ marginBottom: '1rem' }}>{error}</div>}
        {message && <div className="alert alert-success" style={{ marginBottom: '1rem' }}>{message}</div>}

        <form onSubmit={handleChangePassword}>
          <div className="form-group">
            <label>Current Password</label>
            <input type="password" value={currentPassword} onChange={e => setCurrentPassword(e.target.value)}
              placeholder="Enter current password" required />
          </div>
          <div className="form-group">
            <label>New Password</label>
            <input type="password" value={newPassword} onChange={e => setNewPassword(e.target.value)}
              placeholder="Min. 8 characters" required minLength={8} />
          </div>
          <div className="form-group">
            <label>Confirm New Password</label>
            <input type="password" value={confirmPassword} onChange={e => setConfirmPassword(e.target.value)}
              placeholder="Re-enter new password" required minLength={8} />
          </div>
          <button type="submit" className="btn btn-primary" disabled={loading}>
            {loading ? 'Changing...' : 'Change Password'}
          </button>
        </form>
      </div>

      {/* Admin: Reset Any User's Password */}
      {isAdmin && (
        <div className="card" style={{ maxWidth: '500px' }}>
          <h3 style={{ margin: '0 0 0.5rem' }}>Reset User Password</h3>
          <p style={{ color: '#666', fontSize: '0.88rem', marginBottom: '1rem' }}>
            As an admin, you can reset the password for any staff member or caregiver.
          </p>

          {resetError && <div className="alert alert-error" style={{ marginBottom: '1rem' }}>{resetError}</div>}
          {resetMessage && <div className="alert alert-success" style={{ marginBottom: '1rem' }}>{resetMessage}</div>}

          <form onSubmit={handleAdminReset}>
            <div className="form-group">
              <label>Select User</label>
              <select value={selectedUserId} onChange={e => setSelectedUserId(e.target.value)}
                style={{ width: '100%', padding: '0.6rem', borderRadius: '6px', border: '1px solid #ddd', fontSize: '0.9rem' }}>
                <option value="">Select a user...</option>
                {users.filter(u => u.id !== user?.id).map(u => (
                  <option key={u.id} value={u.id}>
                    {u.first_name} {u.last_name} ({u.role}) {!u.is_active ? '- INACTIVE' : ''}
                  </option>
                ))}
              </select>
            </div>
            <div className="form-group">
              <label>New Password</label>
              <div style={{ display: 'flex', gap: '0.5rem' }}>
                <input type="text" value={resetPassword} onChange={e => setResetPassword(e.target.value)}
                  placeholder="Min. 8 characters" required minLength={8}
                  style={{ flex: 1 }} />
                <button type="button" onClick={generatePassword}
                  className="btn btn-secondary" style={{ whiteSpace: 'nowrap', fontSize: '0.82rem' }}>
                  Generate
                </button>
              </div>
            </div>
            <button type="submit" className="btn btn-primary" disabled={resetLoading || !selectedUserId}>
              {resetLoading ? 'Resetting...' : 'Reset Password'}
            </button>
          </form>
        </div>
      )}
    </div>
  );
};

export default ChangePassword;
