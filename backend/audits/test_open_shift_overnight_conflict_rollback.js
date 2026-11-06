// Claim conflict check vs OVERNIGHT shifts, against the LIVE schema, in one transaction
// that is ROLLED BACK. openShiftsRoutes only uses db.query, so routing db.query through
// one client keeps prod untouched. Texts stubbed. Run with TWILIO vars blanked.
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const db = require('../src/db');
const { SCHEDULE_OCCURRENCES_CTE } = require('../src/helpers/scheduleOccurrences');
function fakeRes() { const r = { code: 200, body: null }; r.status = c => { r.code = c; return r; }; r.json = b => { r.body = b; return r; }; return r; }
const handlerFor = (router, m, p) => { const st = router.stack.find(l => l.route && l.route.path === p && l.route.methods[m]).route.stack; return st[st.length - 1].handle; };
(async () => {
  const client = await db.pool.connect();
  db.query = (t, p) => client.query(t, p);
  require('../src/jobs/overtimeAlerts')._setSender(async () => ({ status: 'sent', sid: 'TEST', error: null }));
  let fail = 0;
  const check = (n, ok, x) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${x ? ' — ' + x : ''}`); if (!ok) fail++; };
  try {
    await client.query('BEGIN');
    const router = require('../src/routes/openShiftsRoutes');
    const claim = async (id, u) => { const res = fakeRes(); await handlerFor(router, 'post', '/:id/claim')({ query: {}, params: { id }, body: {}, user: u }, res); return res; };
    const add = (cg, clientId, date, st, et) => client.query(
      `INSERT INTO schedules (client_id, caregiver_id, schedule_type, date, start_time, end_time, status, is_active)
       VALUES ($1,$2,'one-time',$3,$4,$5,'scheduled',true)`, [clientId, cg, date, st, et]);

    // A test open shift of each kind, offered to one caregiver, so the test never
    // depends on which live shifts happen to exist.
    const cl = (await client.query(`SELECT id FROM clients WHERE is_active LIMIT 1`)).rows[0].id;
    // Far future so the caregiver's real schedule can't interfere.
    const D = '2027-03-10', PREV = '2027-03-09', NEXT = '2027-03-11';
    const mk = async (d, st, et) => (await client.query(
      `INSERT INTO open_shifts (client_id, shift_date, start_time, end_time, status, visible_to, auto_assign)
       VALUES ($1,$2,$3,$4,'open',ARRAY[$5]::uuid[],false) RETURNING id`, [cl, d, st, et, cg])).rows[0].id;
    // A caregiver with NO visits at all (recurring included) in the 3-day window.
    const cgRow = (await client.query(`
      WITH ${SCHEDULE_OCCURRENCES_CTE('occ')}
      SELECT u.id FROM users u WHERE u.role='caregiver' AND u.is_active
        AND NOT EXISTS (SELECT 1 FROM occ WHERE occ.caregiver_id = u.id)
      ORDER BY u.first_name LIMIT 1`, [PREV, NEXT])).rows[0];
    if (!cgRow) throw new Error('no caregiver free around the test date');
    const cg = cgRow.id;

    const cases = [
      // overnight open shift 12:00 PM → 8:00 AM next day (like Gerald 11/20)
      ['overnight', '12:00', '08:00', 'clean claim',                                 null,                         200],
      ['overnight', '12:00', '08:00', 'visit same evening 6–8 PM',                  [D, '18:00', '20:00'],         400],
      ['overnight', '12:00', '08:00', 'visit next morning 6–7 AM',                  [NEXT, '06:00', '07:00'],      400],
      ['overnight', '12:00', '08:00', 'prior overnight 10 PM → 1 PM into the day',  [PREV, '22:00', '13:00'],      400],
      ['overnight', '12:00', '08:00', 'visit that morning 9–11 AM (was falsely blocked)', [D, '09:00', '11:00'],  200],
      ['overnight', '12:00', '08:00', 'next-day visit starting at 8 AM (touching)', [NEXT, '08:00', '10:00'],      200],
      ['overnight', '12:00', '08:00', 'visit ending at noon (touching)',            [D, '11:00', '12:00'],         200],
      // normal daytime open shift 12–6 PM: behaviour unchanged
      ['daytime',   '12:00', '18:00', 'clean claim',                                 null,                         200],
      ['daytime',   '12:00', '18:00', 'visit 5–7 PM',                                [D, '17:00', '19:00'],         400],
      ['daytime',   '12:00', '18:00', 'visit 6–7 PM (touching)',                     [D, '18:00', '19:00'],         200],
      ['daytime',   '12:00', '18:00', 'visit next day noon',                         [NEXT, '12:00', '18:00'],      200],
      ['daytime',   '12:00', '18:00', 'prior overnight 10 PM → 1 PM into the day',  [PREV, '22:00', '13:00'],      400],
      ['daytime',   '12:00', '18:00', 'prior overnight 10 PM → 6 AM',               [PREV, '22:00', '06:00'],      200],
    ];
    for (const [kind, st, et, label, visit, want] of cases) {
      await client.query('SAVEPOINT c');
      const id = await mk(D, st, et);
      if (visit) await add(cg, cl, ...visit);
      const r = await claim(id, { id: cg, role: 'caregiver' });
      check(`${kind} ${st}–${et}: ${label} → ${want}`, r.code === want, `${r.code} ${r.body.error || r.body.message}`);
      await client.query('ROLLBACK TO SAVEPOINT c');
    }
  } catch (e) { console.error('ERROR', e); fail++; }
  finally { await client.query('ROLLBACK'); client.release(); console.log(fail ? `\n${fail} FAILURE(S) — rolled back` : '\nALL PASS — rolled back, prod untouched'); process.exit(fail ? 1 : 0); }
})();
