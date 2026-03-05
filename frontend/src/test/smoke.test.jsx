// Frontend smoke tests — verify key components render without crashing
import { describe, test, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import React from 'react';

// Mock fetch globally
global.fetch = vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve({}) }));

// Mock capacitor (not available in test env)
vi.mock('@capacitor/core', () => ({
  Capacitor: { isNativePlatform: () => false, getPlatform: () => 'web' },
}));

// ── Login Component ──────────────────────────────────────────────────────────
describe('Login', () => {
  let Login;

  beforeEach(async () => {
    vi.resetModules();
    const mod = await import('../components/Login.jsx');
    Login = mod.default;
  });

  test('renders login form', () => {
    render(<Login onLogin={vi.fn()} />);
    expect(screen.getByLabelText(/email address/i)).toBeInTheDocument();
    expect(screen.getByPlaceholderText('••••••••')).toBeInTheDocument();
  });

  test('submit button exists', () => {
    render(<Login onLogin={vi.fn()} />);
    const btn = screen.getByRole('button', { name: /sign in/i });
    expect(btn).toBeInTheDocument();
  });

  test('shows error on failed login', async () => {
    global.fetch = vi.fn(() =>
      Promise.resolve({
        ok: false,
        status: 401,
        json: () => Promise.resolve({ error: 'Invalid credentials' }),
      })
    );

    render(<Login onLogin={vi.fn()} />);
    fireEvent.change(screen.getByLabelText(/email address/i), { target: { value: 'bad@test.com' } });
    fireEvent.change(screen.getByPlaceholderText('••••••••'), { target: { value: 'wrong' } });
    fireEvent.submit(screen.getByRole('button', { name: /sign in/i }));

    const error = await screen.findByText(/invalid credentials/i);
    expect(error).toBeInTheDocument();
  });
});

// ── ErrorBoundary Component ──────────────────────────────────────────────────
describe('ErrorBoundary', () => {
  let ErrorBoundary;

  beforeEach(async () => {
    vi.resetModules();
    const mod = await import('../components/ErrorBoundary.jsx');
    ErrorBoundary = mod.ErrorBoundary;
  });

  test('renders children when no error', () => {
    render(
      <ErrorBoundary>
        <div>Hello</div>
      </ErrorBoundary>
    );
    expect(screen.getByText('Hello')).toBeInTheDocument();
  });

  test('catches errors and shows fallback', () => {
    const ThrowError = () => { throw new Error('Test crash'); };
    // Suppress console.error for expected error
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});

    render(
      <ErrorBoundary>
        <ThrowError />
      </ErrorBoundary>
    );

    expect(screen.getByText(/something went wrong/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /try again/i })).toBeInTheDocument();
    spy.mockRestore();
  });
});

// ── Config / apiCall ─────────────────────────────────────────────────────────
describe('config', () => {
  test('API_BASE_URL is defined', async () => {
    const { API_BASE_URL } = await import('../config.js');
    expect(API_BASE_URL).toBeDefined();
    expect(typeof API_BASE_URL).toBe('string');
    expect(API_BASE_URL.startsWith('http')).toBe(true);
  });

  test('isTokenExpired detects expired token', async () => {
    const { isTokenExpired } = await import('../config.js');
    // Create a token with exp in the past
    const payload = btoa(JSON.stringify({ exp: Math.floor(Date.now() / 1000) - 3600 }));
    const fakeToken = `header.${payload}.signature`;
    expect(isTokenExpired(fakeToken)).toBe(true);
  });

  test('isTokenExpired returns false for valid token', async () => {
    const { isTokenExpired } = await import('../config.js');
    const payload = btoa(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 3600 }));
    const fakeToken = `header.${payload}.signature`;
    expect(isTokenExpired(fakeToken)).toBe(false);
  });
});
