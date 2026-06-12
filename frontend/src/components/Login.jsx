// src/components/Login.jsx
import React, { useState } from 'react';
import { API_BASE_URL } from '../config';

const Login = ({ onLogin }) => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [mode, setMode] = useState('login'); // 'login' | 'forgot' | 'reset'
  const [message, setMessage] = useState('');
  const [portalHint, setPortalHint] = useState(false);
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');

  // Check for reset token in URL
  useState(() => {
    const params = new URLSearchParams(window.location.search);
    const token = params.get('token');
    if (token && window.location.pathname.includes('reset-password')) {
      setMode('reset');
    }
  }, []);

  const getResetToken = () => {
    const params = new URLSearchParams(window.location.search);
    return params.get('token');
  };

  // Safely parse a response that might not be JSON (e.g. a plain-text 429 from
  // the rate limiter). Returns either the parsed object or { error: <text> } so
  // callers can read data.error uniformly without JSON.parse blowing up the UI.
  const safeParseResponse = async (response) => {
    const raw = await response.text();
    try { return JSON.parse(raw); }
    catch {
      if (response.status === 429) return { error: 'Too many requests from this device. Please wait a minute and try again.' };
      return { error: raw || `Error ${response.status}` };
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setPortalHint(false);
    setLoading(true);

    try {
      const response = await fetch(`${API_BASE_URL}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim().toLowerCase(), password })
      });

      const data = await safeParseResponse(response);

      if (!response.ok) {
        if (data.portalHint === 'client') setPortalHint(true);
        throw new Error(data.error || `Error ${response.status}`);
      }

      onLogin(data.token, data.user);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleForgotPassword = async (e) => {
    e.preventDefault();
    setError('');
    setMessage('');
    setLoading(true);

    try {
      const response = await fetch(`${API_BASE_URL}/api/auth/forgot-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim().toLowerCase() })
      });

      const data = await safeParseResponse(response);
      if (!response.ok) throw new Error(data.error || 'Failed');
      setMessage(data.message);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleResetPassword = async (e) => {
    e.preventDefault();
    setError('');
    setMessage('');

    if (newPassword !== confirmPassword) { setError('Passwords do not match'); return; }
    if (newPassword.length < 8) { setError('Password must be at least 8 characters'); return; }

    setLoading(true);
    try {
      const response = await fetch(`${API_BASE_URL}/api/auth/reset-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: getResetToken(), newPassword })
      });

      const data = await safeParseResponse(response);
      if (!response.ok) throw new Error(data.error || 'Failed');
      setMessage(data.message);
      setTimeout(() => { setMode('login'); window.history.replaceState({}, '', '/'); }, 2000);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="login-container">
      <div className="login-card">
        <h1>Chippewa Valley</h1>
        <p>Home Care CRM</p>

        {error && <div className="alert alert-error">{error}</div>}
        {portalHint && (
          <a
            href="/portal"
            style={{
              display: 'block', textAlign: 'center', marginBottom: '1rem',
              background: '#1a5276', color: '#fff', padding: '12px 16px',
              borderRadius: '8px', textDecoration: 'none', fontWeight: 700,
              fontSize: '1rem',
            }}
          >
            Take me to the Client Portal →
          </a>
        )}
        {message && <div className="alert alert-success">{message}</div>}

        {/* ── LOGIN FORM ── */}
        {mode === 'login' && (
          <form onSubmit={handleSubmit}>
            <div className="form-group">
              <label htmlFor="email">Email Address</label>
              <input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="admin@example.com"
                required
              />
            </div>

            <div className="form-group">
              <label htmlFor="password">Password</label>
              <div style={{ position: 'relative' }}>
                <input
                  id="password"
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  required
                  style={{ paddingRight: '2.75rem' }}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(v => !v)}
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                  style={{
                    position: 'absolute',
                    right: '0.75rem',
                    top: '50%',
                    transform: 'translateY(-50%)',
                    background: 'none',
                    border: 'none',
                    cursor: 'pointer',
                    padding: 0,
                    fontSize: '1.1rem',
                    lineHeight: 1,
                    color: '#9CA3AF',
                    display: 'flex',
                    alignItems: 'center',
                  }}
                >
                  {showPassword ? (
                    <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/>
                      <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/>
                      <line x1="1" y1="1" x2="23" y2="23"/>
                    </svg>
                  ) : (
                    <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
                      <circle cx="12" cy="12" r="3"/>
                    </svg>
                  )}
                </button>
              </div>
            </div>

            <button type="submit" className="btn btn-primary btn-block" disabled={loading}>
              {loading ? 'Signing in...' : 'Sign In'}
            </button>

            <div style={{ textAlign: 'center', marginTop: '1rem' }}>
              <button type="button" onClick={() => { setMode('forgot'); setError(''); setMessage(''); }}
                style={{ background: 'none', border: 'none', color: '#1a5276', cursor: 'pointer', fontSize: '0.88rem', textDecoration: 'underline' }}>
                Forgot your password?
              </button>
            </div>
          </form>
        )}

        {/* ── FORGOT PASSWORD FORM ── */}
        {mode === 'forgot' && (
          <form onSubmit={handleForgotPassword}>
            <p style={{ color: '#555', fontSize: '0.9rem', marginBottom: '1rem' }}>
              Enter your email address and we'll send you a link to reset your password.
            </p>
            <div className="form-group">
              <label htmlFor="reset-email">Email Address</label>
              <input
                id="reset-email"
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

        {/* ── RESET PASSWORD FORM (from email link) ── */}
        {mode === 'reset' && (
          <form onSubmit={handleResetPassword}>
            <p style={{ color: '#555', fontSize: '0.9rem', marginBottom: '1rem' }}>
              Enter your new password below.
            </p>
            <div className="form-group">
              <label htmlFor="new-password">New Password</label>
              <input
                id="new-password"
                type="password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                placeholder="Min. 8 characters"
                required
                minLength={8}
              />
            </div>
            <div className="form-group">
              <label htmlFor="confirm-password">Confirm Password</label>
              <input
                id="confirm-password"
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder="Confirm new password"
                required
                minLength={8}
              />
            </div>

            <button type="submit" className="btn btn-primary btn-block" disabled={loading}>
              {loading ? 'Resetting...' : 'Reset Password'}
            </button>

            <div style={{ textAlign: 'center', marginTop: '1rem' }}>
              <button type="button" onClick={() => { setMode('login'); setError(''); setMessage(''); window.history.replaceState({}, '', '/'); }}
                style={{ background: 'none', border: 'none', color: '#1a5276', cursor: 'pointer', fontSize: '0.88rem', textDecoration: 'underline' }}>
                Back to Sign In
              </button>
            </div>
          </form>
        )}

        <div style={{
          marginTop: '1.25rem', paddingTop: '1rem', borderTop: '1px solid #e8ecf0',
          textAlign: 'center', fontSize: '0.9rem', color: '#555',
        }}>
          Client or family member?{' '}
          <a href="/portal" style={{ color: '#1a5276', fontWeight: 600 }}>Client Portal</a>
          {' · '}
          <a href="/family" style={{ color: '#1a5276', fontWeight: 600 }}>Family Portal</a>
        </div>

        <p className="login-footer">
          HIPAA-compliant system. Authorized personnel only.
        </p>
      </div>
    </div>
  );
};

export default Login;
