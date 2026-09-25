// Offline punches (offlineAt on clock-in / clock-out) against the LIVE schema, inside
// one transaction that is ROLLED BACK. The clock-in/out handlers only use db.query
// (EVV/push side effects are fire-and-forget on the same db.query), so routing
// db.query through one client keeps prod untouched.
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const db = require('../src/db');

function fakeRes() {
  const r = { code: 200, body: null };
  r.status = (c) => { r.code = c; return r; };
  r.json = (b) => { r.body = b; return r; };
  return r;
}
function handlerFor(router, method, p) {
  const layer = router.stack.find(l => l.route && l.route.path === p && l.route.methods[method]);
  const stack = layer.route.stack;
  return stack[stack.length - 1].handle;
}
const minsAgo = (m) => new Date(Date.now() - m * 60000).toISOString();
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

(async () => {
  const client = await db.pool.connect();
  db.query = (text, params) => client.query(text, params);
  let failures = 0;
  const check = (name, ok, extra) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? ' — ' + extra : ''}`); if (!ok) failures++; };
  try {
    await client.query('BEGIN');
    const router = require('../src/routes/timeTrackingRoutes');
    const clockIn = handlerFor(router, 'post', '/clock-in');
    const clockOut = handlerFor(router, 'post', '/:id/clock-out');

    const cgs = (await client.query(`
      SELECT u.id FROM users u WHERE u.role='caregiver' AND u.is_active
        AND NOT EXISTS (SELECT 1 FROM time_entries t WHERE t.caregiver_id=u.id AND t.end_time IS NULL)
        AND NOT EXISTS (SELECT 1 FROM time_entries t WHERE t.caregiver_id=u.id AND t.start_time > NOW() - INTERVAL '14 hours')
      LIMIT 6`)).rows;
    const cls = (await client.query(`SELECT id FROM clients WHERE is_active AND COALESCE(is_private_pay,false)=false LIMIT 2`)).rows;
    if (cgs.length < 6 || cls.length < 2) throw new Error('need 6 idle caregivers and 2 clients');
    const [A, B] = cls.map(c => c.id);
    const call = async (h, req) => { const res = fakeRes(); await h(req, res); return res; };
    const row = async (id) => (await client.query(`SELECT * FROM time_entries WHERE id=$1`, [id])).rows[0];

    // 1. Live clock-in/out: behaves exactly as before.
    let cg = { id: cgs[0].id, role: 'caregiver' };
    let r = await call(clockIn, { body: { clientId: A, latitude: 44.8, longitude: -91.4 }, user: cg });
    check('live clock-in 201', r.code === 201, r.body && r.body.error);
    let e = await row(r.body.id);
    check('live start ≈ now, not flagged', Math.abs(new Date(e.start_time) - Date.now()) < 60000 && e.needs_approval === false && e.approval_reason === null);
    check('live clock-in location unchanged shape', JSON.stringify(e.clock_in_location) === JSON.stringify({ lat: 44.8, lng: -91.4 }));
    await client.query(`UPDATE time_entries SET start_time = NOW() - INTERVAL '60 minutes' WHERE id=$1`, [e.id]);
    r = await call(clockOut, { params: { id: e.id }, body: { notes: 'ok' }, user: cg });
    e = await row(e.id);
    check('live clock-out ends ≈ now, no offline flag', Math.abs(new Date(e.end_time) - Date.now()) < 60000 && !String(e.approval_reason || '').includes('offline'));

    // 2. Offline clock-in: recorded at the tap time, flagged.
    cg = { id: cgs[1].id, role: 'caregiver' };
    const tap = minsAgo(40);
    r = await call(clockIn, { body: { clientId: A, latitude: 44.8, longitude: -91.4, offlineAt: tap }, user: cg });
    check('offline clock-in 201', r.code === 201, r.body && r.body.error);
    const offId = r.body.id;
    e = await row(offId);
    check('start = tap time', new Date(e.start_time).toISOString() === tap);
    check('flagged offline_punch', e.needs_approval === true && e.approval_reason === 'offline_punch');
    check('location marked offline', e.clock_in_location && e.clock_in_location.source === 'offline');

    // 3. Same replay again → duplicate, no second row.
    r = await call(clockIn, { body: { clientId: A, offlineAt: tap }, user: cg });
    check('replay → duplicate', r.code === 200 && r.body.duplicate && r.body.id === offId);
    const n = (await client.query(`SELECT count(*)::int n FROM time_entries WHERE caregiver_id=$1 AND start_time > NOW() - INTERVAL '13 hours'`, [cg.id])).rows[0].n;
    check('still one entry', n === 1);

    // 4. Live clock-out of that offline visit keeps the flag.
    r = await call(clockOut, { params: { id: offId }, body: { notes: 'done' }, user: cg });
    e = await row(offId);
    check('live clock-out keeps offline flag', e.needs_approval === true && e.approval_reason.split(',').includes('offline_punch'), e.approval_reason);

    // 5. GINA: tap at door fails (1:10), app auto clocks in later (3:53), then the saved tap arrives.
    cg = { id: cgs[2].id, role: 'caregiver' };
    r = await call(clockIn, { body: { clientId: A, latitude: 44.8070182, longitude: -91.4936216 }, user: cg });
    const autoId = r.body.id;
    const door = minsAgo(163);
    r = await call(clockIn, { body: { clientId: A, offlineAt: door }, user: cg });
    check('late-arriving tap merges into the same visit', r.code === 200 && r.body.merged && r.body.id === autoId, JSON.stringify(r.body));
    e = await row(autoId);
    check('visit now starts at the door tap', new Date(e.start_time).toISOString() === door);
    check('merged visit flagged offline_punch', e.needs_approval && e.approval_reason === 'offline_punch');
    check('later location kept but marked later_punch', e.clock_in_location.source === 'later_punch' && !!e.clock_in_location.captured_at);
    const n2 = (await client.query(`SELECT count(*)::int n FROM time_entries WHERE caregiver_id=$1 AND start_time > NOW() - INTERVAL '13 hours'`, [cg.id])).rows[0].n;
    check('still one visit', n2 === 1);
    // ...and her offline clock-out 10 min ago ends it at the tap.
    const outTap = minsAgo(10);
    r = await call(clockOut, { params: { id: autoId }, body: { notes: 'went well', offlineAt: outTap }, user: cg });
    e = await row(autoId);
    check('offline clock-out ends at the tap', new Date(e.end_time).toISOString() === outTap);
    check('duration = tap to tap', e.duration_minutes === 153, `${e.duration_minutes} min`);

    // 6. Conflict: tap falls inside a visit already recorded for another client.
    cg = { id: cgs[3].id, role: 'caregiver' };
    await client.query(`INSERT INTO time_entries (id, caregiver_id, client_id, start_time, end_time, is_complete)
                        VALUES (gen_random_uuid(), $1, $2, NOW() - INTERVAL '3 hours', NOW() - INTERVAL '1 hour', true)`, [cg.id, B]);
    r = await call(clockIn, { body: { clientId: A, offlineAt: minsAgo(120) }, user: cg });
    check('overlap → 409 offline_conflict', r.code === 409 && r.body.code === 'offline_conflict');
    const note = (await client.query(`SELECT count(*)::int n FROM notifications WHERE type='offline_punch_conflict' AND created_at > NOW() - INTERVAL '1 minute'`)).rows[0].n;
    check('office notified', note >= 1);
    const n3 = (await client.query(`SELECT count(*)::int n FROM time_entries WHERE caregiver_id=$1 AND start_time > NOW() - INTERVAL '13 hours'`, [cg.id])).rows[0].n;
    check('nothing written for the conflict', n3 === 1);

    // 7. Offline tap for a new client while another visit is open → closes it AT THE TAP.
    cg = { id: cgs[4].id, role: 'caregiver' };
    r = await call(clockIn, { body: { clientId: B }, user: cg });
    const firstId = r.body.id;
    await client.query(`UPDATE time_entries SET start_time = NOW() - INTERVAL '3 hours' WHERE id=$1`, [firstId]);
    const switchTap = minsAgo(60);
    r = await call(clockIn, { body: { clientId: A, offlineAt: switchTap }, user: cg });
    check('offline switch 201', r.code === 201, r.body && r.body.error);
    e = await row(firstId);
    check('previous visit closed at the tap, not now', new Date(e.end_time).toISOString() === switchTap);
    check('auto-closed visit flagged offline_punch', e.approval_reason && e.approval_reason.split(',').includes('offline_punch'), e.approval_reason);

    // 8. Refusals.
    cg = { id: cgs[5].id, role: 'caregiver' };
    r = await call(clockIn, { body: { clientId: A, offlineAt: minsAgo(13 * 60) }, user: cg });
    check('older than 12h → 400', r.code === 400 && r.body.code === 'offline_punch_too_old');
    r = await call(clockIn, { body: { clientId: A, offlineAt: new Date(Date.now() + 10 * 60000).toISOString() }, user: cg });
    check('future → 400', r.code === 400);
    r = await call(clockIn, { body: { clientId: A, offlineAt: 'garbage' }, user: cg });
    check('garbage → 400', r.code === 400);

    await sleep(1500); // let fire-and-forget EVV writes land inside the transaction
  } catch (e) {
    console.error('ERROR', e); failures++;
  } finally {
    await client.query('ROLLBACK');
    client.release();
    console.log(failures ? `\n${failures} FAILURE(S) — rolled back` : '\nALL PASS — rolled back, prod untouched');
    process.exit(failures ? 1 : 0);
  }
})();
