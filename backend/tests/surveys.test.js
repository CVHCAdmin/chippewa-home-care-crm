// tests/surveys.test.js — anonymous staff survey
process.env.JWT_SECRET = 'test-secret-surveys';
process.env.DATABASE_URL = 'postgresql://fake:fake@localhost/fake';
process.env.NODE_ENV = 'test';

const mockQuery = jest.fn();
const mockClientQuery = jest.fn();
jest.mock('../src/db', () => ({
  query: (...a) => mockQuery(...a),
  pool: { on: jest.fn(), connect: async () => ({ query: (...a) => mockClientQuery(...a), release: () => {} }) },
  auditLog: jest.fn(),
}));
jest.mock('../src/services/tokenRevocation', () => ({ isStaffTokenRevoked: async () => false, markUserLoggedOut: () => {} }));

const express = require('express');
const request = require('supertest');
const jwt = require('jsonwebtoken');
const router = require('../src/routes/surveysRoutes');
const { DEFAULT_QUESTIONS, validateAnswers } = router;

const app = express(); app.use(express.json()); app.use('/api/surveys', router);
const USER = '22222222-2222-2222-2222-222222222222';
const INVITE = '55555555-5555-5555-5555-555555555555';
const fullAnswers = () => ({ overall: 4, respected: 5, communication: 3, responsive: 4, schedule: 5, pay: 2, support: 4, app: 3, recommend: 8, improve: 'Pay on time' });

beforeEach(() => {
  mockQuery.mockReset(); mockClientQuery.mockReset();
  mockQuery.mockImplementation(async (sql) => {
    if (/FROM survey_invitations si JOIN surveys s/.test(sql)) {
      return { rows: [{ id: INVITE, responded: false, survey_id: 's1', title: 'T', intro: 'I', questions: DEFAULT_QUESTIONS, status: 'open', first_name: 'Pat' }] };
    }
    return { rows: [] };
  });
});

test('the stored response carries nothing that identifies the person', async () => {
  const inserts = [];
  mockClientQuery.mockImplementation(async (sql, params) => {
    if (/UPDATE survey_invitations SET responded = true/.test(sql)) return { rows: [{ id: INVITE }] };
    if (/INSERT INTO survey_responses/.test(sql)) inserts.push([sql, params]);
    return { rows: [] };
  });
  const r = await request(app).post('/api/surveys/public/tok/submit').send({ answers: fullAnswers() });
  expect(r.status).toBe(200);
  expect(inserts).toHaveLength(1);
  const [sql, params] = inserts[0];
  expect(sql).not.toMatch(/user_id|invitation|token/);
  expect(JSON.stringify(params)).not.toContain(USER);
  expect(JSON.stringify(params)).not.toContain(INVITE);
  expect(JSON.stringify(params)).not.toContain('tok');
  expect(params[2]).toBeNull();                                  // no contact name unless they type one
  expect(mockClientQuery.mock.calls.some(([s]) => s === 'COMMIT')).toBe(true);
});

test('the optional name is kept only when typed', async () => {
  let params;
  mockClientQuery.mockImplementation(async (sql, p) => {
    if (/UPDATE survey_invitations/.test(sql)) return { rows: [{ id: INVITE }] };
    if (/INSERT INTO survey_responses/.test(sql)) params = p;
    return { rows: [] };
  });
  await request(app).post('/api/surveys/public/tok/submit').send({ answers: fullAnswers(), contactName: '  Pat  ' });
  expect(params[2]).toBe('Pat');
});

test('each person can answer only once', async () => {
  mockClientQuery.mockImplementation(async (sql) => (/UPDATE survey_invitations/.test(sql) ? { rows: [] } : { rows: [] }));
  const r = await request(app).post('/api/surveys/public/tok/submit').send({ answers: fullAnswers() });
  expect(r.status).toBe(409);
  expect(mockClientQuery.mock.calls.some(([s]) => /INSERT INTO survey_responses/.test(s))).toBe(false);
});

test('every rating question is required; comments are optional', () => {
  expect(() => validateAnswers(DEFAULT_QUESTIONS, { overall: 4 })).toThrow(/every rating question/);
  expect(() => validateAnswers(DEFAULT_QUESTIONS, { ...fullAnswers(), recommend: 11 })).toThrow();
  expect(validateAnswers(DEFAULT_QUESTIONS, fullAnswers()).improve).toBe('Pay on time');
});

test('results stay hidden until at least 3 people have answered', async () => {
  const tok = jwt.sign({ id: '33333333-3333-3333-3333-333333333333', role: 'admin', email: 'a@b.c' }, process.env.JWT_SECRET);
  mockQuery.mockImplementation(async (sql) => {
    if (/SELECT id, title, questions FROM surveys/.test(sql)) return { rows: [{ id: 's1', title: 'T', questions: DEFAULT_QUESTIONS }] };
    if (/FROM survey_responses/.test(sql)) return { rows: [{ answers: fullAnswers(), contact_name: null }, { answers: fullAnswers(), contact_name: null }] };
    return { rows: [] };
  });
  const r = await request(app).get('/api/surveys/s1/results').set('Authorization', `Bearer ${tok}`);
  expect(r.status).toBe(200);
  expect(r.body.hidden).toBe(true);
  expect(r.body.questions).toBeUndefined();
});

test('caregivers cannot see results', async () => {
  const tok = jwt.sign({ id: USER, role: 'caregiver', email: 'c@b.c' }, process.env.JWT_SECRET);
  expect((await request(app).get('/api/surveys/s1/results').set('Authorization', `Bearer ${tok}`)).status).toBe(403);
});

test('the HTTP audit log redacts survey answers', () => {
  // The global audit middleware records request bodies; answers must never land there.
  const src = require('fs').readFileSync(require('path').join(__dirname, '../src/middleware/auditLogger.js'), 'utf8');
  expect(src).toMatch(/key === 'answers'/);
});
