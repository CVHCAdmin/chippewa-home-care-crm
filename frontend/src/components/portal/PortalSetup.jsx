// components/portal/PortalSetup.jsx
// Accepts invite token from URL, lets client set their password
import React, { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { API_BASE_URL } from '../../config';

const PortalSetup = () => {
  const [searchParams]          = useSearchParams();
  const [password, setPassword] = useState('');
  const [confirm, setConfirm]   = useState('');
  const [error, setError]       = useState('');
  const [success, setSuccess]   = useState(false);
  const [loading, setLoading]   = useState(false);

  const token = searchParams.get('token');

  useEffect(() => {
    if (!token) setError('Invalid invite link. Please contact your care coordinator.');
  }, [token]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');

    if (password.length < 8) {
      return setError('Password must be at least 8 characters.');
    }
    if (password !== confirm) {
      return setError('Passwords do not match.');
    }

    setLoading(true);
    try {
      const response = await fetch(`${API_BASE_URL}/api/client-portal/set-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, password }),
      });

      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Setup failed');

      setSuccess(true);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  if (success) {
    return (
      <div className="login-container">
        <div className="login-card" style={{ textAlign: 'center' }}>
          <div style={{ fontSize: '3rem', marginBottom: '12px' }}>✅</div>
          <h2>You're all set!</h2>
          <p style={{ color: '#555', marginBottom: '24px' }}>
            Your portal account is ready. You can now sign in to view your care schedule and more.
          </p>
          <a href="/portal" className="btn btn-primary btn-block">
            Go to Portal Login
          </a>
        </div>
      </div>
    );
  }

  return (
    <div className="login-container">
      <div className="login-card">
        <div style={{ textAlign: 'center', marginBottom: '8px' }}>
          <span style={{ fontSize: '2.5rem' }}>🔐</span>
        </div>
        <h1>Set Your Password</h1>
        <p>Create a password for your Chippewa Valley Home Care portal.</p>

        {error && <div className="alert alert-error">{error}</div>}

        {token && (
          <form onSubmit={handleSubmit}>
            <div className="form-group">
              <label htmlFor="password">New Password</label>
              <input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Minimum 8 characters"
                required
              />
            </div>

            <div className="form-group">
              <label htmlFor="confirm">Confirm Password</label>
              <input
                id="confirm"
                type="password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                placeholder="••••••••"
                required
              />
            </div>

            <button type="submit" className="btn btn-primary btn-block" disabled={loading}>
              {loading ? 'Setting password...' : 'Set Password & Activate Account'}
            </button>
          </form>
        )}
      </div>
    </div>
  );
};

export default PortalSetup;
