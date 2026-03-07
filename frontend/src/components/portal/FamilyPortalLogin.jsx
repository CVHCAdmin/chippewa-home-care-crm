// components/portal/FamilyPortalLogin.jsx
// Family member portal login - separate from staff and client portals
import React, { useState } from 'react';
import { API_BASE_URL } from '../../config';

const FamilyPortalLogin = ({ onLogin }) => {
  const [email, setEmail]       = useState('');
  const [password, setPassword] = useState('');
  const [error, setError]       = useState('');
  const [loading, setLoading]   = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const response = await fetch(`${API_BASE_URL}/api/family-portal/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim().toLowerCase(), password }),
      });

      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.error || `Error ${response.status}`);
      }

      const data = await response.json();
      onLogin(data.token, data.user);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="login-container">
      <div className="login-card">
        <div style={{ textAlign: 'center', marginBottom: '8px' }}>
          <span style={{ fontSize: '2.5rem' }}>👨‍👩‍👧</span>
        </div>
        <h1>Chippewa Valley</h1>
        <p>Home Care — Family Portal</p>

        {error && <div className="alert alert-error">{error}</div>}

        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label htmlFor="email">Email Address</label>
            <input
              id="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="your@email.com"
              required
            />
          </div>

          <div className="form-group">
            <label htmlFor="password">Password</label>
            <input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              required
            />
          </div>

          <button type="submit" className="btn btn-primary btn-block" disabled={loading}>
            {loading ? 'Signing in...' : 'Sign In to Family Portal'}
          </button>
        </form>

        <p className="login-footer" style={{ marginTop: '16px', fontSize: '0.8rem', color: '#666' }}>
          Are you a client?{' '}
          <a href="/portal" style={{ color: '#0066cc' }}>Client portal</a>
          {' · '}
          <a href="/" style={{ color: '#0066cc' }}>Staff login</a>
        </p>

        <p className="login-footer">
          HIPAA-compliant. Authorized family members only.
        </p>
      </div>
    </div>
  );
};

export default FamilyPortalLogin;
