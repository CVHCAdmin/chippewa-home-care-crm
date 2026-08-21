// UI SANDBOX: runs the REAL API and the REAL built frontend on one local origin,
// with every database write confined to a transaction that is rolled back when
// this process exits. Nothing it does can reach prod data permanently.
//
// Usage: node backend/audits/sandbox_server_v57.js <path-to-static-dist> [port]
// Prints "SANDBOX READY <url>" once it is serving. Ctrl-C (or SIGTERM) rolls back.
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const path = require('path');
const express = require('express');
const db = require('../src/db');                 // BEFORE the app, so the patch sticks

const STATIC_DIR = process.argv[2];
const PORT = Number(process.argv[3] || 5099);
if (!STATIC_DIR) { console.error('usage: sandbox_server_v57.js <dist-dir> [port]'); process.exit(1); }

let client;
let rolledBack = false;

// One connection carries the transaction, so queries must not interleave: a tiny
// promise-chain mutex serializes them. Each query gets its own savepoint, so one
// failing endpoint (a stray 500 somewhere in the app) can't poison the whole
// session with "current transaction is aborted".
let chain = Promise.resolve();
let spN = 0;
const patched = (text, params) => {
  const run = async () => {
    const sp = `sp_${++spN}`;
    await client.query(`SAVEPOINT ${sp}`);
    try {
      const r = await client.query(text, params);
      await client.query(`RELEASE SAVEPOINT ${sp}`);
      return r;
    } catch (e) {
      try { await client.query(`ROLLBACK TO SAVEPOINT ${sp}`); } catch { /* already gone */ }
      throw e;
    }
  };
  const result = chain.then(run, run);
  chain = result.catch(() => {});   // keep the chain alive after a failure
  return result;
};

const rollback = async (why) => {
  if (rolledBack) return;
  rolledBack = true;
  try { await client.query('ROLLBACK'); console.log(`\nROLLED BACK (${why}) — prod is unchanged`); }
  catch (e) { console.error('ROLLBACK FAILED:', e.message); }
  try { client.release(); } catch {}
  try { await db.pool.end(); } catch {}
};

(async () => {
  client = await db.pool.connect();
  await client.query('BEGIN');
  db.query = patched;

  const api = require('../src/server');          // real app, real routes, real middleware

  const wrapper = express();
  wrapper.use(express.static(STATIC_DIR));
  wrapper.use((req, res, next) => {
    // SPA: anything that isn't an API call and isn't a real file is index.html
    if (req.method === 'GET' && !req.path.startsWith('/api') && !path.extname(req.path)) {
      return res.sendFile(path.join(STATIC_DIR, 'index.html'));
    }
    next();
  });
  wrapper.use(api);

  const server = wrapper.listen(PORT, '127.0.0.1', () => {
    console.log(`SANDBOX READY http://127.0.0.1:${PORT}`);
  });

  const bye = (sig) => async () => { await rollback(sig); try { server.close(); } catch {} process.exit(0); };
  process.on('SIGINT', bye('SIGINT'));
  process.on('SIGTERM', bye('SIGTERM'));
  process.on('SIGBREAK', bye('SIGBREAK'));
  process.on('uncaughtException', async (e) => { console.error('uncaught:', e.message); await rollback('uncaught'); process.exit(1); });
})();
