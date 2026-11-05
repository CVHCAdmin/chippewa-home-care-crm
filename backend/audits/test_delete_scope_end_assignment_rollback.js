// Rollback test for the schedule DELETE fixes + POST /end-assignment, against the LIVE
// schema and real rows. Everything runs inside ONE transaction that is ROLLED BACK.
// db.query AND db.pool.connect are patched (end-assignment opens its own transaction;
// see memory feedback_testing_against_prod) — BEGIN/COMMIT/ROLLBACK become savepoints.
//
// Proves, with the shared occurrence engine (what payroll/billing read):
//   1. end-assignment removes every one of a caregiver's days with a client from F on,
//      keeps every occurrence before F, touches nobody else; dryRun writes nothing;
//      a second run changes nothing.
//   2. 'this & following' on a split shift with deletePair ends BOTH halves (only that
//      weekday); without the flag (drag-to-move path) only the clicked row — as before.
//   3. cascade: rows split off by an earlier 'this & following' edit end too; without
//      the flag they keep running (old behaviour, used by drag-to-move).
//   4. 'stop going forward' on a split shift whose group holds old patterns touches ONLY
//      the live pair — old rows are not lengthened / erased.
//   5. 'stop going forward' on a row that already ended never lengthens it.
//
// usage: node audits/test_delete_scope_end_assignment_rollback.js
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const db = require('../src/db');
const { SCHEDULE_OCCURRENCES_CTE } = require('../src/helpers/scheduleOccurrences');

function handler(router, method, p) {
  const layer = router.stack.find(l => l.route && l.route.path === p && l.route.methods[method]);
  if (!layer) throw new Error(`route not found: ${method.toUpperCase()} ${p}`);
  const st = layer.route.stack;
  return st[st.length - 1].handle;
}
function fakeRes() {
  const r = { statusCode: 200, body: undefined };
  r.status = (c) => { r.statusCode = c; return r; };
  r.json = (b) => { r.body = b; return r; };
  return r;
}

(async () => {
  const client = await db.pool.connect();
  const realQuery = db.query;
  const realConnect = db.pool.connect;
  db.query = (t, p) => client.query(t, p);
  db.pool.connect = async () => ({
    query: (t, p) => {
      const s = typeof t === 'string' ? t.trim().toUpperCase() : '';
      if (s === 'BEGIN') return client.query('SAVEPOINT handler_tx');
      if (s === 'COMMIT') return client.query('RELEASE SAVEPOINT handler_tx');
      if (s === 'ROLLBACK') return client.query('ROLLBACK TO SAVEPOINT handler_tx');
      return client.query(t, p);
    },
    release: () => {},
  });

  let failures = 0, passes = 0;
  const check = (name, ok, extra) => {
    if (ok) passes++; else failures++;
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra !== undefined ? ' — ' + (typeof extra === 'string' ? extra : JSON.stringify(extra)) : ''}`);
  };
  const q = async (sql, p) => (await client.query(sql, p)).rows;
  const one = async (sql, p) => (await client.query(sql, p)).rows[0];

  try {
    await client.query('BEGIN');
    const router = require('../src/routes/schedulesRoutes');
    const del = handler(router, 'delete', '/:scheduleId');
    const endAssign = handler(router, 'post', '/end-assignment');
    const admin = await one(`SELECT id FROM users WHERE role='admin' AND is_active IS NOT FALSE ORDER BY created_at LIMIT 1`);
    const user = { id: admin.id, role: 'admin' };
    const call = async (h, req) => { const res = fakeRes(); await h({ user, params: {}, query: {}, body: {}, ...req }, res); return res; };

    const today = (await one(`SELECT to_char((NOW() AT TIME ZONE 'America/Chicago')::date,'YYYY-MM-DD') d`)).d;
    const addDays = async (d, n) => (await one(`SELECT to_char($1::date + $2::int,'YYYY-MM-DD') d`, [d, n])).d;
    // occurrences per pattern caregiver+client in [a,b], split before/on-after F
    const occ = async (cg, cl, a, b, F, dow) => one(
      `WITH ${SCHEDULE_OCCURRENCES_CTE('o')}
       SELECT count(*) FILTER (WHERE occ_date <  $5::date)::int AS before,
              count(*) FILTER (WHERE occ_date >= $5::date)::int AS after,
              COALESCE(sum(minutes) FILTER (WHERE occ_date < $5::date),0)::int AS before_min
         FROM o WHERE pattern_caregiver_id = $3 AND pattern_client_id = $4
          AND ($6::int IS NULL OR EXTRACT(DOW FROM occ_date)::int = $6::int)`,
      [a, b, cg, cl, F, dow ?? null]);
    const idOf = async (first, last, table = 'users') =>
      (await one(`SELECT id FROM ${table} WHERE lower(trim(first_name))=lower($1) AND lower(trim(last_name))=lower($2) LIMIT 1`, [first, last]))?.id;

    // Live (unsuspended) split-shift pair: Zachary Phillips -> Tim (split Mon-Sat).
    // (Neugene -> Ryan Joneen is suspended from 11/2, so it generates no visits.)
    const ZACH0 = await idOf('Zachary', 'Phillips');
    const TIM = (await one(`SELECT s.client_id FROM schedules s JOIN clients c ON c.id=s.client_id
                              WHERE s.caregiver_id=$1 AND trim(c.first_name)='Tim' AND s.is_split_shift AND s.is_active
                                AND s.end_date IS NULL AND s.suspended_from IS NULL LIMIT 1`, [ZACH0]))?.client_id;
    const NEUGENE = ZACH0, RYAN = TIM; // names kept short below: split-shift caregiver/client
    const ALYCIA = await idOf('Alycia', 'White');
    const SANDY = (await one(`SELECT id FROM clients WHERE first_name ILIKE 'Sandra%' AND last_name ILIKE 'Person'`))?.id;
    const ZACH = await idOf('Zachary', 'Phillips');
    const MARLEEN = await idOf('Marleen', 'shilts', 'clients');
    check('fixtures found', NEUGENE && RYAN && ALYCIA && SANDY && ZACH && MARLEEN);

    const F = await addDays(today, 1);
    const winA = await addDays(today, -70), winB = await addDays(today, 70);

    // ── 1. end-assignment ───────────────────────────────────────────────
    await client.query('SAVEPOINT t1');
    {
      const before = await occ(ALYCIA, SANDY, winA, winB, F);
      const othersBefore = await q(`SELECT id, end_date, is_active FROM schedules WHERE (client_id=$1 AND caregiver_id<>$2) OR (caregiver_id=$2 AND client_id<>$1) ORDER BY id`, [SANDY, ALYCIA]);
      const dry = await call(endAssign, { body: { caregiverId: ALYCIA, clientId: SANDY, fromDate: F, dryRun: true } });
      check('dryRun 200 and lists every weekday', dry.statusCode === 200 && dry.body.recurring.length >= 5, dry.body.recurring?.map(r => r.day_of_week));
      const afterDry = await occ(ALYCIA, SANDY, winA, winB, F);
      check('dryRun writes nothing', afterDry.after === before.after && afterDry.before === before.before, { before, afterDry });

      const run = await call(endAssign, { body: { caregiverId: ALYCIA, clientId: SANDY, fromDate: F } });
      check('end-assignment 200', run.statusCode === 200, run.body?.error || { ended: run.body.endedCount, removed: run.body.removedCount });
      const after = await occ(ALYCIA, SANDY, winA, winB, F);
      check(`no ${'Alycia→Sandy'} visits on/after ${F}`, before.after > 0 && after.after === 0, { before: before.after, after: after.after });
      check('every visit before F kept (count + minutes identical)', after.before === before.before && after.before_min === before.before_min, { before, after });
      const othersAfter = await q(`SELECT id, end_date, is_active FROM schedules WHERE (client_id=$1 AND caregiver_id<>$2) OR (caregiver_id=$2 AND client_id<>$1) ORDER BY id`, [SANDY, ALYCIA]);
      check('other caregivers with Sandy + Alycia\'s other clients untouched', JSON.stringify(othersAfter) === JSON.stringify(othersBefore), `${othersBefore.length} rows compared`);
      const again = await call(endAssign, { body: { caregiverId: ALYCIA, clientId: SANDY, fromDate: F } });
      check('second run changes nothing', again.statusCode === 200 && again.body.endedCount === 0 && again.body.removedCount === 0, { ended: again.body.endedCount });
      const later = await call(endAssign, { body: { caregiverId: ALYCIA, clientId: SANDY, fromDate: await addDays(F, 14) } });
      const lenBack = await occ(ALYCIA, SANDY, winA, winB, F);
      check('later fromDate never lengthens already-ended rows', later.body.endedCount === 0 && lenBack.after === 0, { ended: later.body.endedCount, after: lenBack.after });

      // split-shift pair end-assignment (Neugene → Ryan: Thu + Fri, both halves)
      const nB = await occ(NEUGENE, RYAN, winA, winB, F);
      const r2 = await call(endAssign, { body: { caregiverId: NEUGENE, clientId: RYAN, fromDate: F } });
      const nA = await occ(NEUGENE, RYAN, winA, winB, F);
      check('split shifts: both halves of every day gone from F', r2.statusCode === 200 && nB.after > 0 && nA.after === 0 && nA.before === nB.before, { before: nB, after: nA, ended: r2.body.endedCount });

      const bad = await call(endAssign, { body: { caregiverId: ALYCIA, clientId: SANDY, fromDate: '11/05/2026' } });
      check('bad date rejected 400', bad.statusCode === 400);
    }
    await client.query('ROLLBACK TO SAVEPOINT t1');

    // ── 2. split shift: following + deletePair vs drag path ──────────────
    const ryanFri = await q(`SELECT * FROM schedules WHERE caregiver_id=$1 AND client_id=$2 AND day_of_week=5 AND is_active AND end_date IS NULL AND suspended_from IS NULL ORDER BY start_time`, [NEUGENE, RYAN]);
    const nextFri = (await one(`SELECT to_char(d,'YYYY-MM-DD') d FROM generate_series($1::date, $1::date + 6, '1 day') d WHERE EXTRACT(DOW FROM d)=5`, [F])).d;
    if (ryanFri.length === 2) {
      await client.query('SAVEPOINT t2');
      const b = await occ(NEUGENE, RYAN, winA, winB, nextFri, 5);
      const r = await call(del, { params: { scheduleId: ryanFri[0].id }, query: { scope: 'following', date: nextFri, deletePair: 'true', cascade: 'true' } });
      const a = await occ(NEUGENE, RYAN, winA, winB, nextFri, 5);
      const thu = await occ(NEUGENE, RYAN, winA, winB, nextFri, 4);
      const thuB = b; // (counted below separately)
      check('following+deletePair ends BOTH halves', r.statusCode === 200 && r.body.endedCount === 2 && a.after === 0 && b.after > 0 && a.before === b.before, { before: b, after: a });
      check('...and only that weekday (Thursday still scheduled)', thu.after > 0, thu);
      await client.query('ROLLBACK TO SAVEPOINT t2');

      const r3 = await call(del, { params: { scheduleId: ryanFri[0].id }, query: { scope: 'following', date: nextFri } });
      const partner = await one(`SELECT end_date FROM schedules WHERE id=$1`, [ryanFri[1].id]);
      check('drag-to-move path (no flags): only the clicked row ends, as before', r3.statusCode === 200 && r3.body.endedCount === 1 && partner.end_date === null);
      await client.query('ROLLBACK TO SAVEPOINT t2');
    } else {
      check('Zach->Tim Friday split rows present for test 2', false, ryanFri.length);
    }

    // ── 3. cascade through an earlier 'this & following' edit ────────────
    await client.query('SAVEPOINT t3');
    {
      const PAT = await idOf('Patricia', 'Wittmann');
      const DIANE = await idOf('Diane', 'Shantz', 'clients');
      const A = await one(`SELECT * FROM schedules WHERE caregiver_id=$1 AND client_id=$2 AND day_of_week=1 AND is_active AND end_date IS NULL LIMIT 1`, [PAT, DIANE]);
      if (!A) { check('Patricia→Diane Monday row present', false); }
      else {
        // Simulate exactly what PUT /api/schedules-all scope=following does on D2.
        const mon1 = (await one(`SELECT to_char(d,'YYYY-MM-DD') d FROM generate_series($1::date, $1::date + 6, '1 day') d WHERE EXTRACT(DOW FROM d)=1`, [F])).d;
        const D2 = await addDays(mon1, 14);
        await client.query(`UPDATE schedules SET end_date = $2::date - 1 WHERE id=$1`, [A.id, D2]);
        const B = await one(
          `INSERT INTO schedules (caregiver_id, client_id, schedule_type, day_of_week, start_time, end_time, frequency, effective_date, notes)
           VALUES ($1,$2,'recurring',1,'14:30','16:30','weekly',$3,'TEST successor') RETURNING id`, [PAT, DIANE, D2]);
        await client.query(`UPDATE schedules SET effective_date=$2 WHERE id=$1`, [B.id, D2]);
        await client.query(`INSERT INTO audit_logs (user_id, action, table_name, record_id, old_data, new_data, created_at)
                             VALUES ($1,'UPDATE','schedules',$2,'{}'::jsonb, jsonb_build_object('scope','following','replacedBy',$3::text), NOW())`, [admin.id, A.id, B.id]);
        const b = await occ(PAT, DIANE, winA, winB, mon1, 1);
        await client.query('SAVEPOINT t3b');
        const r = await call(del, { params: { scheduleId: A.id }, query: { scope: 'following', date: mon1, cascade: 'true' } });
        const a = await occ(PAT, DIANE, winA, winB, mon1, 1);
        check('cascade: newer row from an old edit ends too — nothing from that Monday on', r.statusCode === 200 && b.after > 0 && a.after === 0 && a.before === b.before, { before: b, after: a });
        await client.query('ROLLBACK TO SAVEPOINT t3b');
        const r2 = await call(del, { params: { scheduleId: A.id }, query: { scope: 'following', date: mon1 } });
        const a2 = await occ(PAT, DIANE, winA, winB, mon1, 1);
        check('without cascade the newer row keeps running (old behaviour kept for drag)', r2.statusCode === 200 && a2.after > 0, a2);
        await client.query('ROLLBACK TO SAVEPOINT t3b');
        const r3 = await call(del, { params: { scheduleId: A.id }, query: { scope: 'all', cascade: 'true' } });
        const a3 = await occ(PAT, DIANE, winA, winB, today, 1);
        check('stop-going-forward + cascade: nothing from today on', r3.statusCode === 200 && a3.after === 0, a3);
      }
    }
    await client.query('ROLLBACK TO SAVEPOINT t3');

    // ── 4. bloated split group: scope=all + deletePair ───────────────────
    await client.query('SAVEPOINT t4');
    {
      const g = await one(`
        SELECT split_shift_group_id g FROM schedules WHERE split_shift_group_id IS NOT NULL AND is_active
         GROUP BY 1 HAVING count(*) > 2 AND count(*) FILTER (WHERE day_of_week IS NOT NULL AND (end_date IS NULL OR end_date >= CURRENT_DATE)) = 2 LIMIT 1`);
      if (!g) { check('found a split group with old rows + a live pair', false); }
      else {
        const rows = await q(`SELECT id, caregiver_id, client_id, is_active, to_char(end_date,'YYYY-MM-DD') end_date, to_char(effective_date,'YYYY-MM-DD') eff FROM schedules WHERE split_shift_group_id=$1 ORDER BY id`, [g.g]);
        const live = rows.filter(r => !r.end_date || r.end_date >= today);
        const old = rows.filter(r => r.end_date && r.end_date < today);
        const r = await call(del, { params: { scheduleId: live[0].id }, query: { scope: 'all', deletePair: 'true', cascade: 'true' } });
        const after = await q(`SELECT id, is_active, to_char(end_date,'YYYY-MM-DD') end_date FROM schedules WHERE id = ANY($1::uuid[]) ORDER BY id`, [rows.map(x => x.id)]);
        const byId = Object.fromEntries(after.map(x => [x.id, x]));
        const oldUnchanged = old.every(o => byId[o.id].is_active === o.is_active && byId[o.id].end_date === o.end_date);
        const liveStopped = live.every(l => !byId[l.id].is_active || byId[l.id].end_date < today);
        check(`group ${g.g.slice(0, 8)}: ${old.length} old rows untouched (not lengthened/erased)`, r.statusCode === 200 && oldUnchanged, old.map(o => [o.end_date, byId[o.id].end_date]));
        check('...and both live halves stopped', liveStopped && r.body.deletedCount === live.length, { deleted: r.body.deletedCount, live: live.length });
      }
    }
    await client.query('ROLLBACK TO SAVEPOINT t4');

    // ── 5. never lengthen an already-ended row ───────────────────────────
    await client.query('SAVEPOINT t5');
    {
      const ended = await one(`SELECT id, to_char(end_date,'YYYY-MM-DD') end_date FROM schedules
                                WHERE caregiver_id=$1 AND client_id=$2 AND is_active AND day_of_week IS NOT NULL
                                  AND end_date < (NOW() AT TIME ZONE 'America/Chicago')::date - 1 ORDER BY end_date DESC LIMIT 1`, [ZACH, MARLEEN]);
      const r = await call(del, { params: { scheduleId: ended.id }, query: { scope: 'all', cascade: 'true' } });
      const now = await one(`SELECT to_char(end_date,'YYYY-MM-DD') end_date, is_active FROM schedules WHERE id=$1`, [ended.id]);
      check(`stop-going-forward on Zach→Marleen row ended ${ended.end_date}: end date unchanged`, r.statusCode === 200 && now.end_date === ended.end_date && now.is_active, { was: ended.end_date, now: now.end_date, msg: r.body.message });
    }
    await client.query('ROLLBACK TO SAVEPOINT t5');

    // ── guards still hold ───────────────────────────────────────────────
    const anyRec = await one(`SELECT id FROM schedules WHERE is_active AND day_of_week IS NOT NULL AND end_date IS NULL LIMIT 1`);
    const g1 = await call(del, { params: { scheduleId: anyRec.id }, query: { scope: 'following' } });
    check('following without a date still refused (400)', g1.statusCode === 400);
  } catch (e) {
    failures++;
    console.error('ERROR', e);
  } finally {
    try { await client.query('ROLLBACK'); } catch { /* */ }
    db.query = realQuery;
    db.pool.connect = realConnect;
    client.release();
    console.log(`\n${passes} passed, ${failures} failed — all changes rolled back`);
    process.exit(failures ? 1 : 0);
  }
})();
