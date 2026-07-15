// Proves the rate-limiter fix: each real client IP (from X-Forwarded-For) gets its OWN
// bucket, so one busy device can't lock out everyone; the same IP still gets capped; and
// /health is never limited. Replicates the exact server.js limiter config in isolation —
// no DB, no env needed.
const express = require('supertest');
const app = require('express')();
const rateLimit = require('express-rate-limit');
const request = require('supertest');

// —— identical to the fix in server.js ——
const clientKey = (req) => {
  const xff = req.headers['x-forwarded-for'];
  if (xff) {
    const first = String(xff).split(',')[0].trim();
    if (first) return first;
  }
  return req.ip;
};
const MAX = 5; // small cap so the test is fast; real value is 2000
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, max: MAX, standardHeaders: true, legacyHeaders: false,
  keyGenerator: clientKey,
  message: { error: 'Too many requests from this device. Please wait a minute and try again.' },
  skip: (req) => req.path === '/health',
});
const a = require('express')();
a.set('trust proxy', 1);
a.use(limiter);
a.get('/health', (req, res) => res.json({ ok: true }));
a.get('/x', (req, res) => res.json({ ok: true }));

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { console.log(`  OK   ${m}`); pass++; } else { console.log(`  FAIL ${m}`); fail++; } };

const hit = (path, ip) => request(a).get(path).set('X-Forwarded-For', ip);

(async () => {
  try {
    // Device A burns through its whole bucket.
    console.log('\nDevice A (1.1.1.1) makes MAX requests, then one more');
    let lastA;
    for (let i = 0; i < MAX; i++) lastA = await hit('/x', '1.1.1.1');
    ok(lastA.status === 200, `A's ${MAX}th request still 200 (got ${lastA.status})`);
    const overA = await hit('/x', '1.1.1.1');
    ok(overA.status === 429, `A's (MAX+1)th request is 429 — A is capped (got ${overA.status})`);

    // Device B must be completely unaffected — this is the whole point.
    console.log('\nDevice B (2.2.2.2) — different IP — must NOT be affected by A hitting its cap');
    const b1 = await hit('/x', '2.2.2.2');
    ok(b1.status === 200, `B's first request is 200, not 429 (got ${b1.status})`);
    ok(b1.headers['ratelimit-remaining'] === String(MAX - 1),
      `B has its OWN full bucket: remaining=${b1.headers['ratelimit-remaining']} (expected ${MAX - 1})`);

    // The XFF chain (client, proxy1, proxy2) must key on the CLIENT (left-most).
    console.log('\nA proxied request "3.3.3.3, 10.0.0.1, 10.0.0.2" keys on the client 3.3.3.3');
    const c1 = await hit('/x', '3.3.3.3, 10.0.0.1, 10.0.0.2');
    ok(c1.headers['ratelimit-remaining'] === String(MAX - 1),
      `keyed on the left-most (client) IP: remaining=${c1.headers['ratelimit-remaining']} (fresh bucket)`);

    // /health is never limited.
    console.log('\n/health is exempt even after the cap is blown');
    for (let i = 0; i < MAX + 3; i++) await hit('/health', '9.9.9.9');
    const h = await hit('/health', '9.9.9.9');
    ok(h.status === 200, `/health still 200 after ${MAX + 4} hits (got ${h.status})`);

    // Sanity: the OLD behaviour (no keyGenerator, shared req.ip in a proxied env) would have
    // put A and B in one bucket. Show they're now independent by exhausting A again and
    // confirming B still answers.
    console.log('\nRe-confirm isolation: A stays capped while B keeps working');
    ok((await hit('/x', '1.1.1.1')).status === 429, `A still capped`);
    ok((await hit('/x', '2.2.2.2')).status === 200, `B still served`);
  } catch (e) {
    console.error('TEST ERROR', e.message, e.stack); fail++;
  }
  console.log(`\n${'='.repeat(46)}\nPASS: ${pass}   FAIL: ${fail}\n${'='.repeat(46)}`);
  process.exit(fail ? 1 : 0);
})();
