// scripts/smoke-test.js — post-deploy smoke test of the core flows.
//
// Catches the big outages (server down, login broken, a route 500ing) before a
// caregiver/admin does. Read-only — never creates clock-ins or other data.
//
// Usage:
//   BASE_URL=https://chippewa-home-care-api.onrender.com node scripts/smoke-test.js
// Optional authed checks (exercises dashboard / schedules / invoices / shift-swaps
// / time-entries as a real staff user):
//   SMOKE_EMAIL=you@cvhc SMOKE_PASSWORD=*** node scripts/smoke-test.js
//
// Exits non-zero if any check fails, so it can gate a deploy / CI.

const BASE = (process.env.BASE_URL || 'https://chippewa-home-care-api.onrender.com').replace(/\/$/, '');
const EMAIL = process.env.SMOKE_EMAIL;
const PASSWORD = process.env.SMOKE_PASSWORD;

let failures = 0;
const ok  = (n) => console.log('  ✓ ' + n);
const bad = (n, d) => { failures++; console.log('  ✗ ' + n + (d ? ' — ' + d : '')); };

async function getJson(res) { try { return await res.json(); } catch { return {}; } }

async function main() {
  console.log(`Smoke test → ${BASE}\n`);

  // 1) Server is up.
  try {
    const r = await fetch(`${BASE}/health`);
    r.ok ? ok('GET /health (200)') : bad('GET /health', `status ${r.status}`);
  } catch (e) { bad('GET /health', e.message); }

  // 2) Login route alive + DB reachable: bad creds must be a clean 401, not a 500.
  try {
    const r = await fetch(`${BASE}/api/auth/login`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'smoke-check@invalid.test', password: 'x' }),
    });
    const d = await getJson(r);
    (r.status === 401 && /invalid|not.*found|portal/i.test(d.error || d.portalHint || ''))
      ? ok('POST /api/auth/login rejects bad creds (401)')
      : bad('POST /api/auth/login bad creds', `status ${r.status} ${JSON.stringify(d)}`);
  } catch (e) { bad('POST /api/auth/login', e.message); }

  // 3) Authed core flow — only when real staff creds are provided.
  if (EMAIL && PASSWORD) {
    let token = null;
    try {
      const r = await fetch(`${BASE}/api/auth/login`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
      });
      const d = await getJson(r);
      if (r.ok && d.token) { token = d.token; ok(`login as ${EMAIL}`); }
      else bad(`login as ${EMAIL}`, `status ${r.status}`);
    } catch (e) { bad(`login as ${EMAIL}`, e.message); }

    if (token) {
      const headers = { Authorization: `Bearer ${token}` };
      const get = async (path) => {
        try { const r = await fetch(`${BASE}${path}`, { headers }); r.ok ? ok(`GET ${path}`) : bad(`GET ${path}`, `status ${r.status}`); }
        catch (e) { bad(`GET ${path}`, e.message); }
      };
      await get('/api/dashboard/summary');       // dashboard
      await get('/api/time-entries/recent?limit=1'); // clock (read)
      await get('/api/schedules-all');           // schedule
      await get('/api/billing/invoices');        // invoice
      await get('/api/shift-swaps');             // guards the created_at→requested_at regression
    }
  } else {
    console.log('  · (set SMOKE_EMAIL + SMOKE_PASSWORD to also check dashboard / schedules / invoices / shift-swaps)');
  }

  console.log(failures ? `\n❌ FAILED — ${failures} check(s) failed` : '\n✅ All smoke checks passed');
  process.exit(failures ? 1 : 0);
}

main();
