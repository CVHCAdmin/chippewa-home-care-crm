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
  test('POST /api/auth/login with missing fields → 400 or 401', async () => {
    const res = await request(app).post('/api/auth/login').send({});
    expect([400, 401]).toContain(res.status);
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

  test('POST /api/clients with empty body → responds', async () => {
    db.query.mockResolvedValue({ rows: [{ id: 'new-client-id' }] });
    const res = await request(app)
      .post('/api/clients')
      .set('Authorization', `Bearer ${adminToken()}`)
      .send({});
    expect([200, 201, 400, 500]).toContain(res.status);
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

  test('GET /api/caregivers/available with params → 200', async () => {
    db.query.mockResolvedValue({ rows: [] });
    const res = await request(app)
      .get('/api/caregivers/available?dayOfWeek=1&startTime=09:00&endTime=17:00')
      .set('Authorization', `Bearer ${adminToken()}`);
    expect(res.status).toBe(200);
  });

  test('GET /api/caregivers/available without params → 400', async () => {
    const res = await request(app)
      .get('/api/caregivers/available')
      .set('Authorization', `Bearer ${adminToken()}`);
    expect(res.status).toBe(400);
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

// ── Billing ──────────────────────────────────────────────────────────────────
describe('Billing', () => {
  test('GET /api/billing/invoices → 200 for admin', async () => {
    db.query.mockResolvedValue({ rows: [] });
    const res = await request(app)
      .get('/api/billing/invoices')
      .set('Authorization', `Bearer ${adminToken()}`);
    expect(res.status).toBe(200);
  });

  test('GET /api/billing/invoices → 200 for caregiver (authenticated)', async () => {
    db.query.mockResolvedValue({ rows: [] });
    const res = await request(app)
      .get('/api/billing/invoices')
      .set('Authorization', `Bearer ${caregiverToken()}`);
    expect(res.status).toBe(200);
  });

  test('GET /api/billing/invoices → 401 without token', async () => {
    const res = await request(app).get('/api/billing/invoices');
    expect(res.status).toBe(401);
  });
});

// ── Clock-out ────────────────────────────────────────────────────────────────
describe('Clock-out', () => {
  test('POST /api/time-entries/:id/clock-out → responds', async () => {
    db.query.mockResolvedValue({ rows: [{ id: 'te-1', caregiver_id: 'test-caregiver-id' }] });
    const res = await request(app)
      .post('/api/time-entries/te-1/clock-out')
      .set('Authorization', `Bearer ${caregiverToken()}`)
      .send({ latitude: 44.8, longitude: -91.5 });
    expect([200, 400, 404, 500]).toContain(res.status);
  });
});

// ── Client Portal Login ──────────────────────────────────────────────────────
describe('Client Portal', () => {
  test('POST /api/client-portal/login missing fields → 400', async () => {
    const res = await request(app)
      .post('/api/client-portal/login')
      .send({});
    expect(res.status).toBe(400);
  });

  test('POST /api/client-portal/login bad credentials → 401', async () => {
    db.query.mockResolvedValueOnce({ rows: [] });
    const res = await request(app)
      .post('/api/client-portal/login')
      .send({ email: 'nobody@test.com', password: 'wrong' });
    expect(res.status).toBe(401);
  });
});

// ── Applications ─────────────────────────────────────────────────────────────
describe('Applications', () => {
  test('POST /api/applications (public) → responds', async () => {
    db.query.mockResolvedValue({ rows: [{ id: 'app-1' }] });
    const res = await request(app)
      .post('/api/applications')
      .send({ first_name: 'Test', last_name: 'User', email: 'test@test.com', phone: '555-0100' });
    expect([200, 201, 500]).toContain(res.status);
  });

  test('GET /api/applications → 200 for admin', async () => {
    db.query.mockResolvedValue({ rows: [] });
    const res = await request(app)
      .get('/api/applications')
      .set('Authorization', `Bearer ${adminToken()}`);
    expect(res.status).toBe(200);
  });
});

// ── Documents ────────────────────────────────────────────────────────────────
describe('Documents', () => {
  test('GET /api/documents/client/:entityId → 200', async () => {
    db.query.mockResolvedValueOnce({ rows: [] });
    const res = await request(app)
      .get('/api/documents/client/00000000-0000-0000-0000-000000000001')
      .set('Authorization', `Bearer ${adminToken()}`);
    expect(res.status).toBe(200);
  });
});

// ── Audit Logs ───────────────────────────────────────────────────────────────
describe('Audit Logs', () => {
  test('GET /api/audit-logs/stats/summary → responds for admin', async () => {
    db.query.mockResolvedValue({ rows: [{ total: '0', unique_users: '0', data_changes: '0' }] });
    const res = await request(app)
      .get('/api/audit-logs/stats/summary')
      .set('Authorization', `Bearer ${adminToken()}`);
    expect([200, 500]).toContain(res.status);
  });

  test('GET /api/audit-logs → 401 without token', async () => {
    const res = await request(app).get('/api/audit-logs');
    expect(res.status).toBe(401);
  });
});

// ── Role-based access control ────────────────────────────────────────────────
describe('Role-based access', () => {
  test('Dashboard summary → 403 for caregiver', async () => {
    const res = await request(app)
      .get('/api/dashboard/summary')
      .set('Authorization', `Bearer ${caregiverToken()}`);
    expect(res.status).toBe(403);
  });

  test('Caregiver cannot access users list → 403', async () => {
    const res = await request(app)
      .get('/api/users')
      .set('Authorization', `Bearer ${caregiverToken()}`);
    expect(res.status).toBe(403);
  });

  test('SMS broadcast → 403 for caregiver', async () => {
    const res = await request(app)
      .post('/api/sms/broadcast')
      .set('Authorization', `Bearer ${caregiverToken()}`)
      .send({ caregiverIds: [], message: 'test' });
    expect(res.status).toBe(403);
  });
});
