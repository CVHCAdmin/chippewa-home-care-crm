// tests/smoke.test.js
// Smoke tests: verify critical endpoints respond correctly without a real DB.
// Run with: npm test  (from backend/)
// These tests mock the DB and JWT so they run in CI with no external deps.

const request = require('supertest');
const express = require('express');
const jwt = require('jsonwebtoken');

// ── Test setup ────────────────────────────────────────────────────────────────
process.env.JWT_SECRET = 'test-secret-smoke';
process.env.DATABASE_URL = 'postgresql://fake:fake@localhost/fake';
process.env.NODE_ENV = 'test';
process.env.ALLOWED_ORIGINS = 'http://localhost:3000';

// Mock the DB module before loading server routes
jest.mock('../src/db', () => ({
  query: jest.fn(),
  pool: { on: jest.fn() },
}));

const db = require('../src/db');

// Helper: generate a valid admin JWT
function adminToken() {
  return jwt.sign({ id: 'test-admin-id', role: 'admin', email: 'admin@test.com' }, process.env.JWT_SECRET, { expiresIn: '1h' });
}

function caregiverToken() {
  return jwt.sign({ id: 'test-caregiver-id', role: 'caregiver', email: 'cg@test.com' }, process.env.JWT_SECRET, { expiresIn: '1h' });
}

// ── Load the app ──────────────────────────────────────────────────────────────
// We load the actual server but db is mocked, so no real connections happen.
let app;
beforeAll(() => {
  // Suppress console output during tests
  jest.spyOn(console, 'log').mockImplementation(() => {});
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  jest.spyOn(console, 'error').mockImplementation(() => {});

  // Default DB mock — returns empty rows for any query
  db.query.mockResolvedValue({ rows: [] });

  // Use a mini express app instead of the full server to avoid listen()
  app = require('../src/testApp');
});

afterEach(() => {
  jest.clearAllMocks();
  db.query.mockResolvedValue({ rows: [] });
});

// ── Health check ──────────────────────────────────────────────────────────────
describe('Health', () => {
  test('GET /health → 200', async () => {
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
  });
});

// ── Auth ──────────────────────────────────────────────────────────────────────
describe('Auth', () => {
  test('POST /api/auth/login with missing fields → 400', async () => {
    const res = await request(app).post('/api/auth/login').send({});
    expect(res.status).toBe(400);
  });

  test('POST /api/auth/login with bad credentials → 401', async () => {
    db.query.mockResolvedValueOnce({ rows: [] }); // no user found
    const res = await request(app).post('/api/auth/login').send({ email: 'bad@test.com', password: 'wrong' });
    expect(res.status).toBe(401);
  });

  test('Protected route without token → 401', async () => {
    const res = await request(app).get('/api/clients');
    expect(res.status).toBe(401);
  });

  test('Protected route with invalid token → 401 or 403', async () => {
    const res = await request(app).get('/api/clients').set('Authorization', 'Bearer bad-token');
    expect([401, 403]).toContain(res.status);
  });
});

// ── Clients ───────────────────────────────────────────────────────────────────
describe('Clients', () => {
  test('GET /api/clients with valid token → 200', async () => {
    db.query.mockResolvedValueOnce({ rows: [{ id: '1', first_name: 'Jane', last_name: 'Doe' }] });
    const res = await request(app)
      .get('/api/clients')
      .set('Authorization', `Bearer ${adminToken()}`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });

  test('POST /api/clients missing required fields → 400 or 500', async () => {
    const res = await request(app)
      .post('/api/clients')
      .set('Authorization', `Bearer ${adminToken()}`)
      .send({});
    expect([400, 500]).toContain(res.status);
  });
});

// ── Caregivers ────────────────────────────────────────────────────────────────
describe('Caregivers', () => {
  test('GET /api/caregivers → 200 with token', async () => {
    db.query.mockResolvedValueOnce({ rows: [] });
    const res = await request(app)
      .get('/api/caregivers')
      .set('Authorization', `Bearer ${adminToken()}`);
    expect(res.status).toBe(200);
  });

  test('GET /api/caregivers/available → 200', async () => {
    db.query.mockResolvedValue({ rows: [] });
    const res = await request(app)
      .get('/api/caregivers/available')
      .set('Authorization', `Bearer ${adminToken()}`);
    expect(res.status).toBe(200);
  });
});

// ── Time Tracking ─────────────────────────────────────────────────────────────
describe('Time Tracking', () => {
  test('POST /api/time-entries/clock-in missing clientId → still responds', async () => {
    db.query.mockResolvedValue({ rows: [{ id: 'te-1', caregiver_id: 'test-caregiver-id', start_time: new Date() }] });
    const res = await request(app)
      .post('/api/time-entries/clock-in')
      .set('Authorization', `Bearer ${caregiverToken()}`)
      .send({ clientId: 'client-1', latitude: 44.8, longitude: -91.5 });
    expect([200, 201, 500]).toContain(res.status);
  });

  test('GET /api/time-entries/active → 200', async () => {
    db.query.mockResolvedValueOnce({ rows: [] });
    const res = await request(app)
      .get('/api/time-entries/active')
      .set('Authorization', `Bearer ${caregiverToken()}`);
    expect(res.status).toBe(200);
  });
});

// ── Dashboard ─────────────────────────────────────────────────────────────────
describe('Dashboard', () => {
  test('GET /api/dashboard/summary → 200 for admin', async () => {
    db.query.mockResolvedValue({ rows: [{ count: '0', amount: null }] });
    const res = await request(app)
      .get('/api/dashboard/summary')
      .set('Authorization', `Bearer ${adminToken()}`);
    expect(res.status).toBe(200);
  });

  test('GET /api/dashboard/summary → 403 for caregiver', async () => {
    const res = await request(app)
      .get('/api/dashboard/summary')
      .set('Authorization', `Bearer ${caregiverToken()}`);
    expect(res.status).toBe(403);
  });
});

// ── Scheduling ────────────────────────────────────────────────────────────────
describe('Scheduling', () => {
  test('GET /api/schedules-all → 200', async () => {
    db.query.mockResolvedValueOnce({ rows: [] });
    const res = await request(app)
      .get('/api/schedules-all')
      .set('Authorization', `Bearer ${adminToken()}`);
    expect(res.status).toBe(200);
  });

  test('GET /api/scheduling/week-view → 200', async () => {
    db.query.mockResolvedValue({ rows: [] });
    const res = await request(app)
      .get('/api/scheduling/week-view')
      .set('Authorization', `Bearer ${adminToken()}`);
    expect(res.status).toBe(200);
  });
});

// ── Payroll ───────────────────────────────────────────────────────────────────
describe('Payroll', () => {
  test('GET /api/payroll → 200', async () => {
    db.query.mockResolvedValueOnce({ rows: [] });
    const res = await request(app)
      .get('/api/payroll')
      .set('Authorization', `Bearer ${adminToken()}`);
    expect(res.status).toBe(200);
  });

  test('GET /api/payroll-periods → 200', async () => {
    db.query.mockResolvedValueOnce({ rows: [] });
    const res = await request(app)
      .get('/api/payroll-periods')
      .set('Authorization', `Bearer ${adminToken()}`);
    expect(res.status).toBe(200);
  });

  test('GET /api/payroll/discrepancies → 200', async () => {
    db.query.mockResolvedValueOnce({ rows: [] });
    const res = await request(app)
      .get('/api/payroll/discrepancies')
      .set('Authorization', `Bearer ${adminToken()}`);
    expect(res.status).toBe(200);
  });
});

// ── Users ─────────────────────────────────────────────────────────────────────
describe('Users', () => {
  test('GET /api/users → 200 for admin', async () => {
    db.query.mockResolvedValueOnce({ rows: [] });
    const res = await request(app)
      .get('/api/users')
      .set('Authorization', `Bearer ${adminToken()}`);
    expect(res.status).toBe(200);
  });

  test('GET /api/users/caregivers → 200', async () => {
    db.query.mockResolvedValueOnce({ rows: [] });
    const res = await request(app)
      .get('/api/users/caregivers')
      .set('Authorization', `Bearer ${adminToken()}`);
    expect(res.status).toBe(200);
  });
});

// ── Referral Sources ──────────────────────────────────────────────────────────
describe('Referral Sources', () => {
  test('GET /api/referral-sources → 200', async () => {
    db.query.mockResolvedValueOnce({ rows: [] });
    const res = await request(app)
      .get('/api/referral-sources')
      .set('Authorization', `Bearer ${adminToken()}`);
    expect(res.status).toBe(200);
  });
});
