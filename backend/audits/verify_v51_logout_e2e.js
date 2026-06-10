// One-off e2e verification of v51 server-side logout.
// Boots testApp on a local port (real routes, real DB), creates a throwaway
// caregiver, and proves: token works -> logout -> same token rejected.
// Cleans up the throwaway user afterwards.

require('dotenv').config();
const jwt = require('jsonwebtoken');
const { randomUUID } = require('crypto');
const app = require('../src/testApp');
const db = require('../src/db');

(async () => {
  const id = randomUUID();
  let server;
  try {
    await db.query(
      `INSERT INTO users (id, email, password_hash, first_name, last_name, role)
       VALUES ($1, $2, 'e2e-no-login', 'E2E', 'LogoutTest', 'caregiver')`,
      [id, `e2e-${id}@test.local`]
    );

    server = app.listen(0);
    const base = `http://127.0.0.1:${server.address().port}`;
    // Backdate iat 60s: a real user's token is minutes/hours old by the time
    // they log out, and revocation deliberately has a 1s same-second grace.
    const token = jwt.sign(
      { id, email: `e2e-${id}@test.local`, role: 'caregiver', name: 'E2E LogoutTest', iat: Math.floor(Date.now() / 1000) - 60 },
      process.env.JWT_SECRET,
      { expiresIn: '10m' }
    );
    const headers = { Authorization: `Bearer ${token}` };

    const r1 = await fetch(`${base}/api/schedules/${id}`, { headers });
    console.log(`1) authed request before logout: ${r1.status} ${r1.status !== 401 ? 'PASS' : 'FAIL'}`);

    const r2 = await fetch(`${base}/api/auth/logout`, { method: 'POST', headers });
    console.log(`2) logout: ${r2.status} ${r2.status === 200 ? 'PASS' : 'FAIL'}`);

    const r3 = await fetch(`${base}/api/schedules/${id}`, { headers });
    console.log(`3) same token after logout: ${r3.status} ${r3.status === 401 ? 'PASS' : 'FAIL'}`);

    if (r1.status === 401 || r2.status !== 200 || r3.status !== 401) process.exitCode = 1;
  } catch (e) {
    console.error('FAILED:', e.message);
    process.exitCode = 1;
  } finally {
    try {
      await db.query('DELETE FROM audit_logs WHERE user_id = $1', [id]);
      await db.query('DELETE FROM users WHERE id = $1', [id]);
      console.log('cleanup: throwaway user removed');
    } catch (e) {
      console.error('CLEANUP FAILED (delete user manually):', id, e.message);
    }
    server?.close();
    await db.end?.();
    process.exit();
  }
})();
