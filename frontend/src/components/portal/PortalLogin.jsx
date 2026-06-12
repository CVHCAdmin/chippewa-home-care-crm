// components/portal/PortalLogin.jsx
// Client patient portal login — separate from staff login
import React, { useState } from 'react';
import { API_BASE_URL } from '../../config';

const PortalLogin = ({ onLogin }) => {
  const [email, setEmail]       = useState('');
  const [password, setPassword] = useState('');
  const [error, setError]       = useState('');
  const [loading, setLoading]   = useState(false);
  const [mode, setMode]         = useState('login'); // 'login' | 'forgot'
  const [message, setMessage]   = useState('');

  const handleForgotPassword = async (e) => {
    e.preventDefault();
    setError('');
    setMessage('');
    setLoading(true);

    try {
      const response = await fetch(`${API_BASE_URL}/api/client-portal/forgot-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim().toLowerCase() }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || `Error ${response.status}`);
      setMessage(data.message);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const response = await fetch(`${API_BASE_URL}/api/client-portal/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim().toLowerCase(), password }),
      });

      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        if (response.status === 423) throw new Error('Account temporarily locked. Please try again in 15 minutes.');
        throw new Error(data.error || `Error ${response.status}`);
      }

      const data = await response.json();

      onLogin(data.token, data.client);
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
          <span style={{ fontSize: '2.5rem' }}>🏠</span>
        </div>
        <h1>Chippewa Valley</h1>
        <p>Home Care — Client Portal</p>

        {error && <div className="alert alert-error">{error}</div>}
        {message && <div className="alert alert-success">{message}</div>}

        {mode === 'login' && (
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
            {loading ? 'Signing in...' : 'Sign In to Portal'}
          </button>

          <div style={{ textAlign: 'center', marginTop: '1rem' }}>
            <button type="button" onClick={() => { setMode('forgot'); setError(''); setMessage(''); }}
              style={{ background: 'none', border: 'none', color: '#1a5276', cursor: 'pointer', fontSize: '0.88rem', textDecoration: 'underline' }}>
              Forgot your password?
            </button>
          </div>
        </form>
        )}

        {mode === 'forgot' && (
        <form onSubmit={handleForgotPassword}>
          <p style={{ color: '#555', fontSize: '0.9rem', marginBottom: '1rem' }}>
            Enter your email address and we'll send you a link to reset your password.
          </p>
          <div className="form-group">
            <label htmlFor="forgot-email">Email Address</label>
            <input
              id="forgot-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="your@email.com"
              required
            />
          </div>

          <button type="submit" className="btn btn-primary btn-block" disabled={loading}>
            {loading ? 'Sending...' : 'Send Reset Link'}
          </button>

          <div style={{ textAlign: 'center', marginTop: '1rem' }}>
            <button type="button" onClick={() => { setMode('login'); setError(''); setMessage(''); }}
              style={{ background: 'none', border: 'none', color: '#1a5276', cursor: 'pointer', fontSize: '0.88rem', textDecoration: 'underline' }}>
              Back to Sign In
            </button>
          </div>
        </form>
        )}

        <p className="login-footer" style={{ marginTop: '16px', fontSize: '0.8rem', color: '#666' }}>
          Are you a staff member?{' '}
          <a href="/" style={{ color: '#0066cc' }}>Staff login →</a>
        </p>

        <p className="login-footer">
          HIPAA-compliant. Authorized clients only.
        </p>
      </div>
    </div>
  );
};

export default PortalLogin;
