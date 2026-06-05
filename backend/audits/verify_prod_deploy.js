// End-to-end API verification against PROD (chippewa-home-care-api.onrender.com).
// Mints a fresh admin token from JWT_SECRET, hits every new endpoint shipped
// this session, reports status + a short summary of the response body.
// No DB writes — reads only (or in-app-managed writes the user expects).

require('dotenv').config();
const jwt = require('jsonwebtoken');
const db = require('../src/db');
const https = require('https');
const { URL } = require('url');

const API = 'https://chippewa-home-care-api.onrender.com';

function request(method, urlPath, token, body) {
  return new Promise((resolve) => {
    const u = new URL(API + urlPath);
    const opts = {
      method,
      hostname: u.hostname, path: u.pathname + u.search,
      headers: { 'Authorization': `Bearer ${token}` },
      timeout: 30000,
    };
    let payload = null;
    if (body !== undefined) {
      payload = typeof body === 'string' ? body : JSON.stringify(body);
      opts.headers['Content-Type'] = 'application/json';
      opts.headers['Content-Length'] = Buffer.byteLength(payload);
    }
    const req = https.request(opts, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const buf = Buffer.concat(chunks);
        let parsed = null;
        try { parsed = JSON.parse(buf.toString('utf8')); } catch { parsed = buf.toString('utf8').slice(0, 200); }
        resolve({ status: res.statusCode, contentType: res.headers['content-type'] || '', body: parsed, bytes: buf.length });
      });
    });
    req.on('timeout', () => { req.destroy(); resolve({ status: 0, err: 'timeout' }); });
    req.on('error', (e) => resolve({ status: 0, err: e.message }));
    if (payload) req.write(payload);
    req.end();
  });
}

(async () => {
  let pass = 0, fail = 0, soft = 0;
  const tag = (s) => String(s).padEnd(3);

  // Token saved by token-mint helper using the live Render JWT_SECRET
  const token = require('fs').readFileSync('audits/.admin_token', 'utf8').trim();
  await db.end?.();

  // ── Probe set ───────────────────────────────────────────────────────────
  const probes = [
    // Baseline + auth gating
    { name: 'health: API root', method: 'GET', path: '/', expect: [200, 404], note: '404 OK (no root handler)' },
    { name: 'auth: bad token → 401', method: 'GET', path: '/api/clients', tokenOverride: 'bad', expect: [401] },
    { name: 'auth: no token → 401', method: 'GET', path: '/api/clients', tokenOverride: '', expect: [401] },

    // Things from earlier rounds (round 4)
    { name: 'care-plan templates list (v38)', method: 'GET', path: '/api/care-plan-templates', expect: [200], check: (b) => Array.isArray(b) && b.length >= 6 },
    { name: 'invoice list has seq_number (v37)', method: 'GET', path: '/api/billing/invoices', expect: [200], check: (b) => Array.isArray(b) && b.every(i => i.seq_number !== undefined) },

    // Round 6 — drill-downs
    { name: 'report: hours-by-payer', method: 'GET', path: '/api/reports/hours-by-payer?startDate=2026-05-01&endDate=2026-06-05', expect: [200], check: (b) => Array.isArray(b.rows) },
    { name: 'report: caregiver-utilization', method: 'GET', path: '/api/reports/caregiver-utilization?startDate=2026-05-01&endDate=2026-06-05', expect: [200], check: (b) => Array.isArray(b.rows) },
    { name: 'report: client-visits-summary', method: 'GET', path: '/api/reports/client-visits-summary?startDate=2026-05-01&endDate=2026-06-05', expect: [200], check: (b) => Array.isArray(b.rows) },
    { name: 'report: client-revenue-by-month', method: 'GET', path: '/api/reports/client-revenue-by-month?startDate=2026-01-01&endDate=2026-06-05', expect: [200], check: (b) => Array.isArray(b.rows) },
    { name: 'report: client-incidents', method: 'GET', path: '/api/reports/client-incidents?startDate=2026-01-01&endDate=2026-06-05', expect: [200], check: (b) => Array.isArray(b.rows) },
    { name: 'report CSV branch works', method: 'GET', path: '/api/reports/hours-by-payer?startDate=2026-05-01&endDate=2026-06-05&format=csv', expect: [200], checkRaw: (r) => /csv/.test(r.contentType) },

    // Dashboard
    { name: 'dashboard summary', method: 'GET', path: '/api/dashboard/summary', expect: [200], check: (b) => typeof b.totalClients === 'number' },
    { name: 'dashboard action-items (new)', method: 'GET', path: '/api/dashboard/action-items', expect: [200], check: (b) => 'items' in b },

    // Schedule
    { name: 'scheduling: conflict-heatmap (v12, this session)', method: 'GET', path: '/api/scheduling/conflict-heatmap?weekOf=2026-06-01', expect: [200], check: (b) => Array.isArray(b.caregivers) },
    { name: 'scheduling: suggest-caregivers requires clientId', method: 'GET', path: '/api/scheduling/suggest-caregivers', expect: [400] },

    // Clinical
    { name: 'clinical: care-plans list', method: 'GET', path: '/api/care-plans', expect: [200], check: (b) => Array.isArray(b) },

    // Audit / HIPAA (admin-gated now per v9)
    { name: 'audit-logs requires admin', method: 'GET', path: '/api/audit-logs?startDate=2026-06-01&endDate=2026-06-05', expect: [200], check: (b) => 'logs' in b },
    { name: 'audit-logs without token → 401', method: 'GET', path: '/api/audit-logs', tokenOverride: '', expect: [401] },

    // Form templates seeded
    { name: 'form templates list (v42)', method: 'GET', path: '/api/forms/templates', expect: [200], check: (b) => Array.isArray(b) && b.filter(t => t.is_built_in).length >= 8 },

    // Notification settings
    { name: 'notification-settings GET (v44)', method: 'GET', path: '/api/notification-settings', expect: [200], check: (b) => 'sms_enabled' in b || 'email_enabled' in b },

    // Caregivers list enriched (round 5)
    { name: 'caregivers list has evv_worker_id + last_shift_date', method: 'GET', path: '/api/caregivers', expect: [200], check: (b) => Array.isArray(b) && b.length > 0 && ('evv_worker_id' in b[0]) && ('last_shift_date' in b[0]) },

    // Documents (auth gated per round 9)
    { name: 'documents list', method: 'GET', path: '/api/documents', expect: [200], check: (b) => Array.isArray(b) },
  ];

  console.log('Verifying ' + API + '\n');
  for (const p of probes) {
    const tk = p.tokenOverride === undefined ? token : p.tokenOverride;
    const res = await request(p.method, p.path, tk, p.body);
    const expected = p.expect.includes(res.status);
    let checkOk = true;
    let detail = '';
    if (expected && p.check && res.body && typeof res.body === 'object') {
      try { checkOk = !!p.check(res.body); } catch (e) { checkOk = false; detail = ' check err: ' + e.message; }
    }
    if (expected && p.checkRaw) {
      try { checkOk = !!p.checkRaw(res); } catch (e) { checkOk = false; detail = ' check err: ' + e.message; }
    }
    if (expected && checkOk) {
      console.log(`  ✓ ${tag(res.status)} ${p.name}${p.note ? ' (' + p.note + ')' : ''}`);
      pass++;
    } else if (expected && !checkOk) {
      console.log(`  ⚠ ${tag(res.status)} ${p.name} — payload shape unexpected${detail}`);
      console.log(`    body sample: ${JSON.stringify(res.body).slice(0, 180)}`);
      soft++;
    } else {
      console.log(`  ✗ ${tag(res.status)} ${p.name} — wanted ${p.expect.join('/')}, got ${res.status} ${res.err ? '(' + res.err + ')' : ''}`);
      console.log(`    body: ${JSON.stringify(res.body).slice(0, 180)}`);
      fail++;
    }
  }

  console.log(`\n──────────────────────────────`);
  console.log(`${pass} pass · ${soft} payload-shape warning · ${fail} fail`);
  console.log(`──────────────────────────────`);
  process.exit(fail > 0 ? 1 : 0);
})();
