// tests/esign.test.js — emailed e-signature requests (BID form / policy acknowledgement)
process.env.JWT_SECRET = 'test-secret-esign';
process.env.DATABASE_URL = 'postgresql://fake:fake@localhost/fake';
process.env.NODE_ENV = 'test';
process.env.ENCRYPTION_KEY = 'a'.repeat(64);

const mockQuery = jest.fn();
jest.mock('../src/db', () => ({ query: (...a) => mockQuery(...a), pool: { on: jest.fn() }, auditLog: jest.fn() }));

const zlib = require('zlib');
const express = require('express');
const request = require('supertest');
const { PDFDocument } = require('pdf-lib');
const { decrypt } = require('../src/services/encryptionService');
const router = require('../src/routes/signRequestsRoutes');
const { validateBid } = router;

// A real PNG "signature" (wavy line) — the server embeds it in the PDF.
function pngDataUri(w = 120, h = 40) {
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const o = y * (w * 4 + 1) + 1 + x * 4; const ink = Math.abs(y - 20 - 8 * Math.sin(x / 10)) < 2;
    raw[o] = raw[o + 1] = raw[o + 2] = ink ? 0 : 255; raw[o + 3] = 255;
  }
  const chunk = (t, d) => { const l = Buffer.alloc(4); l.writeUInt32BE(d.length); const td = Buffer.concat([Buffer.from(t), d]); const c = Buffer.alloc(4); c.writeUInt32BE(zlib.crc32(td)); return Buffer.concat([l, td, c]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 6;
  return 'data:image/png;base64,' + Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]).toString('base64');
}

const allNo = () => Object.fromEntries(['pending', 'convictions', 'abuseChild', 'abuseAdult', 'stealing', 'credential', 'license', 'premises', 'rehab', 'armed', 'outOfState', 'govEmployee'].map(k => [k, { yes: false }]));
const goodAnswers = (over = {}) => ({
  position: 'Caregiver', firstName: 'Pat', middleName: '', lastName: 'Tester', otherNames: false, otherNamesList: '',
  ssn: '123456789', dob: '01/02/1980', sex: 'Female', phone: '715-555-0100', street: '1 Main St', city: 'Eau Claire',
  state: 'wi', zip: '54701', questions: allNo(), ...over,
});

describe('validateBid', () => {
  test('a complete form passes and the SSN is formatted', () => {
    const v = validateBid(goodAnswers());
    expect(v.ssn).toBe('123-45-6789');
    expect(v.state).toBe('WI');
    expect(v.questions.outsideWi7).toEqual({ yes: false }); // only asked of government employees
  });
  test('missing SSN / DOB / an unanswered question is refused with what is missing', () => {
    const q = allNo(); delete q.rehab;
    expect(() => validateBid(goodAnswers({ ssn: '12345', dob: '1980-01-02', questions: q })))
      .toThrow(/9-digit Social Security number.*date of birth.*question 9/);
  });
  test('a Yes needs details', () => {
    expect(() => validateBid(goodAnswers({ questions: { ...allNo(), convictions: { yes: true, describe: '' } } })))
      .toThrow(/details for question 2/);
  });
});

describe('public signing link', () => {
  const app = express(); app.use(express.json({ limit: '10mb' })); app.use('/api/sign-requests', router);
  const row = (over = {}) => ({
    id: '11111111-1111-1111-1111-111111111111', template_id: 't1', user_id: '22222222-2222-2222-2222-222222222222',
    status: 'opened', expires_at: new Date(Date.now() + 86400000).toISOString(), kind: 'bid',
    title: 'Background Information Disclosure (BID) — DHS F-82064', version: 'F-82064 (07/2026)',
    first_name: 'Pat', last_name: 'Tester', role: 'caregiver', ...over,
  });
  let updateParams;
  beforeEach(() => {
    mockQuery.mockReset(); updateParams = null;
    mockQuery.mockImplementation(async (sql, params) => {
      if (/FROM sign_requests sr\s+JOIN sign_templates/.test(sql)) return { rows: [row()] };
      if (/UPDATE sign_requests\s+SET status = 'signed'/.test(sql)) { updateParams = params; return { rows: [{ id: row().id }] }; }
      if (/FROM users WHERE role = 'admin'/.test(sql)) return { rows: [{ id: 'admin1' }] };
      return { rows: [] };
    });
  });

  test('signing a BID stores the filled official form, encrypted, and flags Yes answers', async () => {
    const answers = goodAnswers({ questions: { ...allNo(), convictions: { yes: true, describe: 'OWI, Eau Claire County, WI, 06/2015' } } });
    const r = await request(app).post('/api/sign-requests/public/tok123/sign')
      .send({ typedName: 'Pat Tester', agree: true, signaturePng: pngDataUri(), answers });
    expect(r.status).toBe(200);
    const [typedName, , , encrypted, disclosuresYes] = updateParams;
    expect(typedName).toBe('Pat Tester');
    expect(disclosuresYes).toBe(true);
    expect(encrypted).not.toMatch(/^JVBER/);                  // not a plain PDF
    const pdf = await PDFDocument.load(Buffer.from(decrypt(encrypted), 'base64'));
    expect(pdf.getPageCount()).toBe(5);                          // the 4-page form + additional page
    expect(pdf.getForm().getFields()).toHaveLength(0);           // flattened: answers can't be edited
    // The office gets a "review this" notification for a Yes answer
    const notif = mockQuery.mock.calls.find(([sql]) => /INSERT INTO notifications/.test(sql));
    expect(notif[1][2]).toBe('bid_disclosure');
  });

  test('must confirm and draw a signature', async () => {
    let r = await request(app).post('/api/sign-requests/public/tok123/sign').send({ typedName: 'Pat Tester', agree: false, signaturePng: pngDataUri(), answers: goodAnswers() });
    expect(r.status).toBe(400);
    r = await request(app).post('/api/sign-requests/public/tok123/sign').send({ typedName: 'Pat Tester', agree: true, signaturePng: '', answers: goodAnswers() });
    expect(r.status).toBe(400);
    expect(updateParams).toBeNull();
  });

  test('an already-signed link cannot be signed again', async () => {
    mockQuery.mockImplementation(async (sql) => (/FROM sign_requests sr\s+JOIN sign_templates/.test(sql) ? { rows: [row({ status: 'signed' })] } : { rows: [] }));
    const r = await request(app).post('/api/sign-requests/public/tok123/sign').send({ typedName: 'Pat Tester', agree: true, signaturePng: pngDataUri(), answers: goodAnswers() });
    expect(r.status).toBe(409);
  });

  test('an unknown link is a clear 404, and an expired one 410', async () => {
    mockQuery.mockImplementation(async () => ({ rows: [] }));
    expect((await request(app).get('/api/sign-requests/public/nope')).status).toBe(404);
    mockQuery.mockImplementation(async (sql) => (/FROM sign_requests sr/.test(sql) ? { rows: [row({ status: 'sent', expires_at: '2020-01-01T00:00:00Z' })] } : { rows: [] }));
    expect((await request(app).get('/api/sign-requests/public/old')).status).toBe(410);
  });

  test('the GET pre-fills name/address but never SSN or date of birth', async () => {
    const r = await request(app).get('/api/sign-requests/public/tok123');
    expect(r.status).toBe(200);
    expect(r.body.prefill.firstName).toBe('Pat');
    expect(r.body.prefill).not.toHaveProperty('ssn');
    expect(r.body.prefill).not.toHaveProperty('dob');
  });

  test('office endpoints require a login', async () => {
    expect((await request(app).get('/api/sign-requests/templates')).status).toBe(401);
    expect((await request(app).post('/api/sign-requests/send').send({})).status).toBe(401);
  });
});
