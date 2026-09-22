// UI SANDBOX (v69): like sandbox_server_v57.js — the REAL API + REAL built frontend on
// one local origin, every write confined to ONE transaction rolled back on exit — but
// ALSO patches db.pool.connect and db.pool.query. v57 patched only db.query, so any
// handler that opens its own transaction (the visit-docs invoice route, the manual
// invoice route, …) or the request audit logger (which writes via pool.query) would
// have committed to prod. See memory feedback_testing_against_prod.
//
// Applies migration v69 and a VA $35/hr rate inside the transaction, so the Visit
// Documentation screen can be driven end to end before either exists in prod.
//
// Usage: node backend/audits/sandbox_server_v69.js <path-to-static-dist> [port]
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
process.env.TWILIO_ACCOUNT_SID = ''; process.env.TWILIO_AUTH_TOKEN = '';
if (!process.env.ALLOWED_ORIGINS) process.env.ALLOWED_ORIGINS = 'http://127.0.0.1:5099';

const fs = require('fs');
const path = require('path');
const express = require('express');
const db = require('../src/db');

const STATIC_DIR = process.argv[2];
const PORT = Number(process.argv[3] || 5099);
if (!STATIC_DIR) { console.error('usage: sandbox_server_v69.js <dist-dir> [port]'); process.exit(1); }

let client;
let rolledBack = false;
let chain = Promise.resolve();
let spN = 0;
const run1 = (text, params) => async () => {
  const sp = `sp_${++spN}`;
  await client.query(`SAVEPOINT ${sp}`);
  try {
    const r = await client.query(text, params);
    await client.query(`RELEASE SAVEPOINT ${sp}`);
    return r;
  } catch (e) {
    try { await client.query(`ROLLBACK TO SAVEPOINT ${sp}`); } catch { /* gone */ }
    throw e;
  }
};
const enqueue = (fn) => { const r = chain.then(fn, fn); chain = r.catch(() => {}); return r; };
const patched = (text, params) => enqueue(run1(text, params));

// A handler's own transaction: BEGIN/COMMIT/ROLLBACK become a savepoint so its
// COMMIT never reaches prod. Statements inside run without per-query savepoints
// (a failure must abort to the handler's own ROLLBACK, as in real Postgres).
let txN = 0;
const fakeConnection = () => {
  const name = `tx_${++txN}`;
  return {
    query: (text, params) => {
      const s = typeof text === 'string' ? text.trim().toUpperCase().replace(/;$/, '') : '';
      if (s === 'BEGIN') return enqueue(() => client.query(`SAVEPOINT ${name}`));
      if (s === 'COMMIT') return enqueue(() => client.query(`RELEASE SAVEPOINT ${name}`));
      if (s === 'ROLLBACK') return enqueue(() => client.query(`ROLLBACK TO SAVEPOINT ${name}`).catch(() => {}));
      return patched(text, params);
    },
    release: () => {},
  };
};

const rollback = async (why) => {
  if (rolledBack) return;
  rolledBack = true;
  try { await client.query('ROLLBACK'); console.log(`\nROLLED BACK (${why}) — prod is unchanged`); }
  catch (e) { console.error('ROLLBACK FAILED:', e.message); }
  try { client.release(); } catch {}
};

(async () => {
  client = await db.pool.connect();
  await client.query('BEGIN');
  const sql = fs.readFileSync(path.join(__dirname, '..', 'migration_v69_visit_documentation.sql'), 'utf8')
    .replace(/^\s*BEGIN;\s*$/m, '').replace(/^\s*COMMIT;\s*$/m, '');
  await client.query(sql);
  await client.query(`INSERT INTO referral_source_rates (referral_source_id, care_type_id, rate_amount, rate_type, effective_date)
                      VALUES ('cb0d6d7e-d716-4a0d-8407-4d9aada1537e', '2a8d7df7-b31f-44f8-a2f8-db2296a0404a', 35.00, 'hourly', '2026-06-01')`);
  db.query = patched;
  db.pool.query = patched;
  db.pool.connect = async () => fakeConnection();

  const api = require('../src/server');
  const wrapper = express();
  wrapper.use(express.static(STATIC_DIR));
  wrapper.use((req, res, next) => {
    if (req.method === 'GET' && !req.path.startsWith('/api') && !path.extname(req.path)) {
      return res.sendFile(path.join(STATIC_DIR, 'index.html'));
    }
    next();
  });
  wrapper.use(api);

  const server = wrapper.listen(PORT, '127.0.0.1', () => console.log(`SANDBOX READY http://127.0.0.1:${PORT}`));
  const bye = (sig) => async () => { await rollback(sig); try { server.close(); } catch {} process.exit(0); };
  process.on('SIGINT', bye('SIGINT'));
  process.on('SIGTERM', bye('SIGTERM'));
  process.on('SIGBREAK', bye('SIGBREAK'));
  process.on('uncaughtException', async (e) => { console.error('uncaught:', e.message); await rollback('uncaught'); process.exit(1); });
})();
