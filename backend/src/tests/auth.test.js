// __tests__/auth.test.js
// Smoke tests for authentication endpoints
// These run against a real DB — set TEST_DATABASE_URL in env

const request = require('supertest');

// Only run integration tests if TEST_DATABASE_URL is set
const INTEGRATION = !!process.env.TEST_DATABASE_URL;

describe('Auth endpoints', () => {
  let app;

  beforeAll(() => {
    if (!INTEGRATION) return;
    process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
    process.env.JWT_SECRET   = 'test-jwt-secret-for-unit-tests-only';
    process.env.ENCRYPTION_KEY = 'a'.repeat(64); // Valid 64-char hex
    app = require('../server');
  });

  describe('POST /api/auth/login', () => {
    test('returns 400 on missing credentials', async () => {
      if (!INTEGRATION) return;
      const res = await request(app).post('/api/auth/login').send({});
      expect(res.status).toBe(400);
    });

    test('returns 401 on bad credentials', async () => {
      if (!INTEGRATION) return;
      const res = await request(app)
        .post('/api/auth/login')
        .send({ email: 'nobody@example.com', password: 'wrongpassword' });
      expect(res.status).toBe(401);
    });

    test('does not return password_hash in response', async () => {
      if (!INTEGRATION) return;
      const res = await request(app)
        .post('/api/auth/login')
        .send({ email: 'admin@example.com', password: 'testpassword' });
      if (res.status === 200) {
        expect(res.body.user).not.toHaveProperty('password_hash');
      }
    });
  });
});

// ── JWT validation unit tests (no DB needed) ──────────────────────────────────

const jwt = require('jsonwebtoken');

describe('JWT validation', () => {
  const SECRET = 'test-secret';

  test('valid token decodes correctly', () => {
    const token = jwt.sign({ id: '123', role: 'admin' }, SECRET, { expiresIn: '1h' });
    const decoded = jwt.verify(token, SECRET);
    expect(decoded.id).toBe('123');
    expect(decoded.role).toBe('admin');
  });

  test('expired token throws', () => {
    const token = jwt.sign({ id: '123' }, SECRET, { expiresIn: '-1s' });
    expect(() => jwt.verify(token, SECRET)).toThrow();
  });

  test('tampered token throws', () => {
    const token = jwt.sign({ id: '123', role: 'admin' }, SECRET);
    const parts  = token.split('.');
    // Tamper with payload
    parts[1] = Buffer.from(JSON.stringify({ id: '123', role: 'superadmin' })).toString('base64');
    const tampered = parts.join('.');
    expect(() => jwt.verify(tampered, SECRET)).toThrow();
  });

  test('wrong secret throws', () => {
    const token = jwt.sign({ id: '123' }, SECRET);
    expect(() => jwt.verify(token, 'wrong-secret')).toThrow();
  });
});

// ── SQL injection prevention tests ────────────────────────────────────────────

describe('SQL injection prevention', () => {
  const ALLOWED_COLUMNS = new Set([
    'step_name', 'step_status', 'completed_at', 'notes', 'is_complete'
  ]);

  function validateColumns(updates) {
    return Object.keys(updates).every(k => ALLOWED_COLUMNS.has(k));
  }

  test('allows valid column names', () => {
    expect(validateColumns({ step_status: 'complete', notes: 'done' })).toBe(true);
  });

  test('blocks SQL injection attempt', () => {
    expect(validateColumns({ 'is_active = false; DROP TABLE clients; --': true })).toBe(false);
  });

  test('blocks unknown columns', () => {
    expect(validateColumns({ password_hash: 'hacked' })).toBe(false);
  });

  test('blocks empty string column', () => {
    expect(validateColumns({ '': 'value' })).toBe(false);
  });
});
