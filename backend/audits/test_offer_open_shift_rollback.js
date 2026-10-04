// "Move to Available Shifts" end to end against the LIVE schema, inside one
// transaction that is ROLLED BACK. openShiftsRoutes only uses db.query (and the
// overtimeAlerts sendText it borrows), so routing db.query through one client keeps
// prod untouched. Texts go to a capturing stub — nothing is sent.
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const db = require('../src/db');
const { SCHEDULE_OCCURRENCES_CTE } = require('../src/helpers/scheduleOccurrences');

function fakeRes() {
  const r = { code: 200, body: null };
  r.status = (c) => { r.code = c; return r; };
  r.json = (b) => { r.body = b; return r; };
  return r;
}
const layerFor = (router, method, p) => router.stack.find(l => l.route && l.route.path === p && l.route.methods[method]);
const handlerFor = (router, method, p) => { const st = layerFor(router, method, p).route.stack; return st[st.length - 1].handle; };
const usesAdminGate = (router, method, p) => layerFor(router, method, p).route.stack.some(l => l.name === 'requireAdmin');

(async () => {
  const client = await db.pool.connect();
  db.query = (text, params) => client.query(text, params);
  const texts = [];
  require('../src/jobs/overtimeAlerts')._setSender(async (to, body) => { texts.push({ to, body }); return { status: 'sent', sid: 'TEST', error: null }; });
  let failures = 0;
  const check = (name, ok, extra) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? ' — ' + extra : ''}`); if (!ok) failures++; };
  try {
    await client.query('BEGIN');
    const router = require('../src/routes/openShiftsRoutes');
    const call = async (method, p, req) => { const res = fakeRes(); await handlerFor(router, method, p)({ query: {}, params: {}, body: {}, ...req }, res); return res; };
    const admin = (await client.query(`SELECT id FROM users WHERE role='admin' AND is_active LIMIT 1`)).rows[0];
    const A = { id: admin.id, role: 'admin' };
    const owner = async (schedId, day) => (await client.query(
      `WITH ${SCHEDULE_OCCURRENCES_CTE('occ')} SELECT occ.caregiver_id FROM occ WHERE occ.schedule_id = $3`, [day, day, schedId])).rows[0];

    // A real repeating visit in the next week.
    const pick = (await client.query(`
      WITH ${SCHEDULE_OCCURRENCES_CTE('occ')}
      SELECT occ.schedule_id, to_char(occ.occ_date,'YYYY-MM-DD') AS day, occ.caregiver_id, occ.start_time::text st, occ.end_time::text et
        FROM occ JOIN schedules s ON s.id = occ.schedule_id
       WHERE s.day_of_week IS NOT NULL AND occ.occ_date > CURRENT_DATE
       ORDER BY occ.occ_date, occ.start_time LIMIT 2`,
      [new Date().toISOString().slice(0, 10), new Date(Date.now() + 8 * 86400000).toISOString().slice(0, 10)])).rows;
    const v = pick[0];
    console.log('visit under test:', v.day, v.st, '-', v.et);

    // 0. Gates: only list + accept are open to caregivers.
    check('approve needs admin', usesAdminGate(router, 'post', '/:id/approve'));
    check('post-from-schedule needs admin', usesAdminGate(router, 'post', '/from-schedule/:scheduleId'));
    check('notify needs admin', usesAdminGate(router, 'post', '/:id/notify'));
    check('accept is open to caregivers', !usesAdminGate(router, 'post', '/:id/claim') && !usesAdminGate(router, 'get', '/available'));

    // 1. Who's free — repeating visits now count as busy.
    let r = await call('get', '/caregivers-available', { query: { date: v.day, startTime: v.st.slice(0, 5), endTime: v.et.slice(0, 5), excludeScheduleId: v.schedule_id }, user: A });
    check('caregivers-available 200', r.code === 200, r.body && r.body.error);
    const free = r.body.filter(c => c.available && c.id !== v.caregiver_id);
    const busy = r.body.filter(c => c.busy);
    console.log(`      ${free.length} free, ${busy.length} busy at that time`);
    if (free.length < 3) throw new Error('need 3 free caregivers');
    const [X, Y, Z] = free.map(c => ({ id: c.id, role: 'caregiver' }));

    // 2. Post it.
    r = await call('post', '/from-schedule/:scheduleId', { params: { scheduleId: v.schedule_id }, body: {}, user: A });
    check('repeating shift with no date → 400 (not a crash)', r.code === 400, r.body && r.body.error);
    const offDay = new Date(new Date(`${v.day}T12:00:00Z`).getTime() + 86400000).toISOString().slice(0, 10);
    r = await call('post', '/from-schedule/:scheduleId', { params: { scheduleId: v.schedule_id }, body: { date: offDay, visibleTo: [X.id] }, user: A });
    check('a day the shift doesn\'t run → 400', r.code === 400, r.body && r.body.error);
    r = await call('post', '/from-schedule/:scheduleId', { params: { scheduleId: v.schedule_id }, body: { date: v.day, visibleTo: [X.id, Y.id], autoAssign: true }, user: A });
    check('post one day → 200', r.code === 200, r.body && r.body.error);
    const os = r.body;
    check('posted for that date and times', String(os.shift_date).length && os.start_time === v.st, `${os.start_time}`);
    check('visible only to the two picked', Array.isArray(os.visible_to) && os.visible_to.length === 2 && os.auto_assign === true);
    r = await call('post', '/from-schedule/:scheduleId', { params: { scheduleId: v.schedule_id }, body: { date: v.day, visibleTo: [X.id] }, user: A });
    check('posting the same visit twice → 409', r.code === 409);
    check('still with the original caregiver until taken', (await owner(v.schedule_id, v.day)).caregiver_id === v.caregiver_id);

    // 3. Tell them (text stubbed).
    r = await call('post', '/:id/notify', { params: { id: os.id }, body: { caregiverIds: [X.id, Y.id], sms: true }, user: A });
    check('notify 200', r.code === 200, r.body && r.body.error);
    console.log(`      notified ${r.body.notified}, texted ${r.body.texted}; sample: ${texts[0] && texts[0].body}`);

    // 4. Who sees it.
    const sees = async (u) => (await call('get', '/available', { user: u })).body.some(s => s.id === os.id);
    check('picked caregiver sees it', await sees(X));
    check('caregiver not picked does NOT see it', !(await sees(Z)));
    r = await call('post', '/:id/claim', { params: { id: os.id }, user: Z });
    check('caregiver not picked cannot accept → 403', r.code === 403);

    // 5. First to accept gets it.
    r = await call('post', '/:id/claim', { params: { id: os.id }, user: X });
    check('accept → it\'s yours', r.code === 200 && r.body.assigned === true, r.body && r.body.message);
    check('that day now belongs to the acceptor', (await owner(v.schedule_id, v.day)).caregiver_id === X.id);
    const nextWeek = new Date(new Date(`${v.day}T12:00:00Z`).getTime() + 7 * 86400000).toISOString().slice(0, 10);
    const nw = await owner(v.schedule_id, nextWeek);
    check('the following week is untouched', !nw || nw.caregiver_id === v.caregiver_id);
    const st = (await client.query(`SELECT status FROM open_shifts WHERE id=$1`, [os.id])).rows[0].status;
    check('open shift marked filled', st === 'filled');
    const n = (await client.query(`SELECT count(*)::int n FROM notifications WHERE type='open_shift_filled' AND created_at > NOW() - INTERVAL '1 minute'`)).rows[0].n;
    check('office notified', n >= 1);
    r = await call('post', '/:id/claim', { params: { id: os.id }, user: Y });
    check('second person is told it\'s gone', r.code === 400 || r.code === 409, r.body && r.body.error);

    // 6. "Wait for my approval" path on another visit.
    const v2 = pick[1];
    const r2 = await call('post', '/from-schedule/:scheduleId', { params: { scheduleId: v2.schedule_id }, body: { date: v2.day, visibleTo: [Y.id], autoAssign: false }, user: A });
    const clm = await call('post', '/:id/claim', { params: { id: r2.body.id }, user: Y });
    const clmOk = clm.code === 200 && clm.body.assigned === false;
    check('approval mode: accept waits for the office', clmOk || clm.code === 400, clm.body && (clm.body.message || clm.body.error));
    if (clmOk) {
      check('...still with the original until approved', (await owner(v2.schedule_id, v2.day)).caregiver_id === v2.caregiver_id);
      const ap = await call('post', '/:id/approve', { params: { id: r2.body.id }, user: A });
      check('approve → moves that day', ap.code === 200 && (await owner(v2.schedule_id, v2.day)).caregiver_id === Y.id, ap.body && ap.body.error);
    }

    // 6b. Office list, turn down, and remove.
    const v3 = pick[1];
    const day5 = new Date(new Date(`${v3.day}T12:00:00Z`).getTime() + 7 * 86400000).toISOString().slice(0, 10);
    const p5 = await call('post', '/from-schedule/:scheduleId', { params: { scheduleId: v3.schedule_id }, body: { date: day5, visibleTo: [X.id, Z.id], autoAssign: false }, user: A });
    check('post for approval-mode list test', p5.code === 200, p5.body && p5.body.error);
    await call('post', '/:id/claim', { params: { id: p5.body.id }, user: Z });
    let list = await call('get', '/', { query: { status: 'active' }, user: A });
    let row = list.body.find(s => s.id === p5.body.id);
    check('office list shows the accepted shift (waiting for approval)', row && row.status === 'claimed' && !!row.claimed_by_first, row && row.status);
    check('office list says who it was offered to', row && typeof row.offered_to === 'string' && row.offered_to.split(', ').length === 2, row && row.offered_to);
    check('office list has the client name', row && !!row.client_first_name);
    let rj = await call('post', '/:id/reject', { params: { id: p5.body.id }, body: { reason: 'test' }, user: A });
    check('turn down → back to open for the others', rj.code === 200 && (await client.query(`SELECT status FROM open_shifts WHERE id=$1`, [p5.body.id])).rows[0].status === 'open');
    let rm = await call('post', '/:id/cancel', { params: { id: p5.body.id }, user: A });
    check('remove → 200', rm.code === 200, rm.body && rm.body.error);
    check('removed shift no longer visible to caregivers', !(await sees(X)) || !(await call('get', '/available', { user: X })).body.some(s => s.id === p5.body.id));
    check('removed shift leaves the visit with its caregiver', (await owner(v3.schedule_id, day5) || {}).caregiver_id === v3.caregiver_id);
    list = await call('get', '/', { query: { status: 'all' }, user: A });
    check("'all' includes removed and filled", list.body.some(s => s.status === 'cancelled') && list.body.some(s => s.status === 'filled'));
    rm = await call('post', '/:id/cancel', { params: { id: os.id }, user: A });
    check('a filled shift cannot be removed (400)', rm.code === 400);

    // 7. Call-out fix: a called-out (cancelled) day comes back on the substitute.
    const day3 = new Date(new Date(`${v.day}T12:00:00Z`).getTime() + 7 * 86400000).toISOString().slice(0, 10);
    await client.query(`INSERT INTO schedule_exceptions (schedule_id, exception_date, exception_type, cancel_reason, created_by)
                        VALUES ($1, $2, 'cancelled', 'caregiver_callout', $3)
                        ON CONFLICT (schedule_id, exception_date) DO UPDATE SET exception_type='cancelled', cancel_reason='caregiver_callout'`,
      [v.schedule_id, day3, v.caregiver_id]);
    check('called-out day is gone from the schedule', !(await owner(v.schedule_id, day3)));
    const co = (await client.query(`INSERT INTO open_shifts (client_id, schedule_id, shift_date, start_time, end_time, status, claimed_by, created_by)
                                    SELECT client_id, id, $2, start_time, end_time, 'claimed', $3, $4 FROM schedules WHERE id=$1 RETURNING id`,
      [v.schedule_id, day3, Z.id, admin.id])).rows[0];
    r = await call('post', '/:id/approve', { params: { id: co.id }, user: A });
    check('approve a called-out day → 200', r.code === 200, r.body && r.body.error);
    const back = await owner(v.schedule_id, day3);
    check('called-out day is back, on the substitute (was the bug)', back && back.caregiver_id === Z.id);

    // 8. A day cancelled for another reason refuses, instead of a fake "filled".
    const day4 = new Date(new Date(`${v.day}T12:00:00Z`).getTime() + 14 * 86400000).toISOString().slice(0, 10);
    await client.query(`INSERT INTO schedule_exceptions (schedule_id, exception_date, exception_type, cancel_reason, created_by)
                        VALUES ($1, $2, 'cancelled', 'client_hospital', $3)
                        ON CONFLICT (schedule_id, exception_date) DO UPDATE SET exception_type='cancelled', cancel_reason='client_hospital'`,
      [v.schedule_id, day4, admin.id]);
    const ho = (await client.query(`INSERT INTO open_shifts (client_id, schedule_id, shift_date, start_time, end_time, status, claimed_by, created_by)
                                    SELECT client_id, id, $2, start_time, end_time, 'claimed', $3, $4 FROM schedules WHERE id=$1 RETURNING id`,
      [v.schedule_id, day4, Z.id, admin.id])).rows[0];
    r = await call('post', '/:id/approve', { params: { id: ho.id }, user: A });
    check('client-cancelled day → 409, not a fake fill', r.code === 409, r.body && r.body.error);
  } catch (e) {
    console.error('ERROR', e); failures++;
  } finally {
    await client.query('ROLLBACK');
    client.release();
    console.log(failures ? `\n${failures} FAILURE(S) — rolled back` : '\nALL PASS — rolled back, prod untouched');
    process.exit(failures ? 1 : 0);
  }
})();
