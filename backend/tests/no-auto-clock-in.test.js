// tests/no-auto-clock-in.test.js — caregivers clock in and out themselves; nothing else does.
// Installed app builds from before the Oct 2026 removal still post autoClockIn when the
// phone is near a client's house, so the server must refuse it before writing anything.
process.env.JWT_SECRET = 'test-secret-no-auto-clock-in';
process.env.DATABASE_URL = 'postgresql://fake:fake@localhost/fake';
process.env.NODE_ENV = 'test';

const mockQuery = jest.fn();
const mockClientQuery = jest.fn();
jest.mock('../src/db', () => ({
  query: (...a) => mockQuery(...a),
  pool: { on: jest.fn(), connect: async () => ({ query: (...a) => mockClientQuery(...a), release: () => {} }) },
  auditLog: jest.fn(),
}));
jest.mock('../src/services/tokenRevocation', () => ({ isStaffTokenRevoked: async () => false, markUserLoggedOut: () => {} }), { virtual: false });

const express = require('express');
const request = require('supertest');
const jwt = require('jsonwebtoken');

const CG = '22222222-2222-2222-2222-222222222222';
const CLIENT = '44444444-4444-4444-4444-444444444444';
const tok = jwt.sign({ id: CG, role: 'caregiver', email: 'x@y.z', name: 'T' }, process.env.JWT_SECRET);

beforeEach(() => { mockQuery.mockReset(); mockClientQuery.mockReset(); });

describe('POST /api/time-entries/clock-in with autoClockIn', () => {
  const app = express(); app.use(express.json());
  app.use('/api/time-entries', require('../src/routes/timeTrackingRoutes'));

  test('is refused with 409 and touches no data', async () => {
    const res = await request(app).post('/api/time-entries/clock-in')
      .set('Authorization', `Bearer ${tok}`)
      .send({ clientId: CLIENT, latitude: 44.885, longitude: -91.7028, autoClockIn: true });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('auto_clock_in_disabled');
    expect(mockQuery).not.toHaveBeenCalled();
    expect(mockClientQuery).not.toHaveBeenCalled();
  });
});

describe('POST /api/route-optimizer/geofence/check', () => {
  const app = express(); app.use(express.json());
  app.use('/api/route-optimizer', require('../src/routes/routeOptimizerRoutes'));

  test('never tells an app to auto clock in or out, even with the setting on', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ latitude: '44.88542174', longitude: '-91.70298161', first_name: 'Tim', last_name: 'O',
      radius_feet: 300, auto_clock_in: true, auto_clock_out: true }] });
    const res = await request(app).post('/api/route-optimizer/geofence/check')
      .set('Authorization', `Bearer ${tok}`)
      .send({ clientId: CLIENT, latitude: 44.8850622, longitude: -91.702852 });
    expect(res.status).toBe(200);
    expect(res.body.withinGeofence).toBe(true);
    expect(res.body.autoClockIn).toBe(false);
    expect(res.body.autoClockOut).toBe(false);
  });
});
