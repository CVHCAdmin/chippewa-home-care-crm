// Verifies migration v36 + expansion guards actually prevent back-dating.
// Runs inside a single transaction that's ROLLED BACK at the end, so
// nothing persists in prod even though every test actually exercises the
// DB trigger and CHECK constraint.

require('dotenv').config();
const db = require('../src/db');

let pass = 0, fail = 0;
function assert(name, cond, detail = '') {
  if (cond) { console.log(`  ✓ ${name}`); pass++; }
  else      { console.log(`  ✗ ${name}${detail ? ' — ' + detail : ''}`); fail++; }
}

(async () => {
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');

    const cg = (await client.query(
      `SELECT id FROM users WHERE role = 'caregiver' AND is_active = true LIMIT 1`
    )).rows[0];
    const cl = (await client.query(
      `SELECT id FROM clients WHERE is_active = true LIMIT 1`
    )).rows[0];
    if (!cg || !cl) throw new Error('Need at least one active caregiver and one active client.');

    const today = (await client.query(`SELECT CURRENT_DATE AS d`)).rows[0].d;
    const todayStr = today.toISOString().slice(0, 10);
    const past = '2026-01-01';
    const future = '2027-01-01';

    // ── Test 1: recurring insert with a back-dated effective_date is clamped to today
    console.log('\nTest 1: trigger clamps a past effective_date forward on INSERT');
    const r1 = await client.query(
      `INSERT INTO schedules (caregiver_id, client_id, schedule_type, day_of_week, start_time, end_time, effective_date, notes)
       VALUES ($1, $2, 'recurring', 1, '09:00', '13:00', $3, '__TEST_BACKDATING_FIX__')
       RETURNING id, effective_date`,
      [cg.id, cl.id, past]
    );
    assert('past date clamped to today',
      r1.rows[0].effective_date.toISOString().slice(0, 10) === todayStr,
      `got ${r1.rows[0].effective_date.toISOString().slice(0, 10)}, wanted ${todayStr}`);

    // ── Test 2: recurring insert with NULL effective_date gets defaulted to today
    console.log('\nTest 2: trigger defaults NULL effective_date to today on INSERT');
    const r2 = await client.query(
      `INSERT INTO schedules (caregiver_id, client_id, schedule_type, day_of_week, start_time, end_time, effective_date, notes)
       VALUES ($1, $2, 'recurring', 2, '09:00', '13:00', NULL, '__TEST_BACKDATING_FIX__')
       RETURNING id, effective_date`,
      [cg.id, cl.id]
    );
    assert('NULL → today', r2.rows[0].effective_date.toISOString().slice(0, 10) === todayStr);

    // ── Test 3: recurring insert with a FUTURE date is honored, not clamped
    console.log('\nTest 3: future effective_date is honored, not clamped');
    const r3 = await client.query(
      `INSERT INTO schedules (caregiver_id, client_id, schedule_type, day_of_week, start_time, end_time, effective_date, notes)
       VALUES ($1, $2, 'recurring', 3, '09:00', '13:00', $3, '__TEST_BACKDATING_FIX__')
       RETURNING id, effective_date`,
      [cg.id, cl.id, future]
    );
    assert('future date preserved',
      r3.rows[0].effective_date.toISOString().slice(0, 10) === future,
      `got ${r3.rows[0].effective_date.toISOString().slice(0, 10)}`);

    // ── Test 4: one-time insert (day_of_week NULL) doesn't get touched
    console.log('\nTest 4: one-time inserts (day_of_week NULL) bypass the trigger');
    const r4 = await client.query(
      `INSERT INTO schedules (caregiver_id, client_id, schedule_type, day_of_week, date, start_time, end_time, effective_date, notes)
       VALUES ($1, $2, 'one-time', NULL, $3, '09:00', '13:00', NULL, '__TEST_BACKDATING_FIX__')
       RETURNING id, effective_date, day_of_week`,
      [cg.id, cl.id, past]
    );
    assert('one-time row keeps NULL effective_date', r4.rows[0].effective_date === null);

    // ── Test 5a: trigger re-fills NULL on UPDATE (first line of defense).
    //            We expect the UPDATE to succeed but effective_date to bounce
    //            back to today, not actually become NULL.
    console.log('\nTest 5a: trigger re-fills NULL on UPDATE of a recurring row');
    await client.query(
      `UPDATE schedules SET effective_date = NULL WHERE id = $1`,
      [r1.rows[0].id]
    );
    const reread = await client.query(
      `SELECT effective_date FROM schedules WHERE id = $1`,
      [r1.rows[0].id]
    );
    assert('NULL update silently bounced back to today',
      reread.rows[0].effective_date.toISOString().slice(0, 10) === todayStr,
      `got ${reread.rows[0].effective_date}`);

    // ── Test 5b: with the trigger disabled, the CHECK constraint actually
    //            rejects NULL — verifies the second line of defense is real.
    console.log('\nTest 5b: CHECK constraint rejects NULL when trigger is bypassed');
    await client.query(`ALTER TABLE schedules DISABLE TRIGGER trg_enforce_recurring_effective_date`);
    let blockedByCheck = false;
    try {
      await client.query('SAVEPOINT sp5b');
      await client.query(
        `UPDATE schedules SET effective_date = NULL WHERE id = $1`,
        [r1.rows[0].id]
      );
      await client.query('RELEASE SAVEPOINT sp5b');
    } catch (e) {
      blockedByCheck = e.message.includes('schedules_recurring_needs_effective_date');
      await client.query('ROLLBACK TO SAVEPOINT sp5b');
    }
    await client.query(`ALTER TABLE schedules ENABLE TRIGGER trg_enforce_recurring_effective_date`);
    assert('CHECK constraint blocks NULL', blockedByCheck);

    // ── Test 6: billing expander on the just-created recurring row returns NO
    //           occurrences before today, even when the caller asks for a
    //           4-month-wide past window.
    console.log('\nTest 6: billing expander refuses to back-fill the past');
    const occBefore = await client.query(`
      WITH expansion AS (
        SELECT generate_series(DATE '2026-02-01', $1::date - 1, '1 day')::date AS d
      )
      SELECT COUNT(*)::int AS phantom_count
      FROM expansion e
      JOIN schedules s ON s.id = $2
      WHERE s.day_of_week IS NOT NULL
        AND s.day_of_week = EXTRACT(DOW FROM e.d)::int
        AND e.d >= COALESCE(s.effective_date, s.created_at::date)
    `, [todayStr, r1.rows[0].id]);
    assert('zero phantom past occurrences',
      occBefore.rows[0].phantom_count === 0,
      `got ${occBefore.rows[0].phantom_count}`);

    // ── Test 7: payroll CTE refuses to back-fill the past for the same row
    console.log('\nTest 7: payroll expansion CTE refuses to back-fill the past');
    const payCount = await client.query(`
      SELECT COUNT(*)::int AS phantom_count
      FROM schedules s
      CROSS JOIN generate_series('2026-02-01'::date, ($1::date - 1), '1 day'::interval) AS d(dt)
      WHERE s.id = $2
        AND s.is_active = true
        AND s.schedule_type = 'recurring'
        AND s.day_of_week = EXTRACT(DOW FROM d.dt)::int
        AND d.dt::date >= COALESCE(s.effective_date, s.created_at::date)
        AND (s.end_date IS NULL OR d.dt::date <= s.end_date)
    `, [todayStr, r1.rows[0].id]);
    assert('zero phantom past occurrences in payroll CTE',
      payCount.rows[0].phantom_count === 0,
      `got ${payCount.rows[0].phantom_count}`);

    // ── Test 8: future occurrences from today's recurring schedule DO appear
    console.log('\nTest 8: future occurrences still expand normally');
    const futureOcc = await client.query(`
      SELECT COUNT(*)::int AS future_count
      FROM schedules s
      CROSS JOIN generate_series($1::date, $1::date + 30, '1 day'::interval) AS d(dt)
      WHERE s.id = $2
        AND s.day_of_week = EXTRACT(DOW FROM d.dt)::int
        AND d.dt::date >= COALESCE(s.effective_date, s.created_at::date)
    `, [todayStr, r1.rows[0].id]);
    assert('future occurrences still expand (>= 4 in 30 days)',
      futureOcc.rows[0].future_count >= 4,
      `got ${futureOcc.rows[0].future_count}`);

    console.log(`\n────────────────────────────────────────`);
    console.log(`Results: ${pass} passed, ${fail} failed`);
    console.log(`────────────────────────────────────────`);
  } catch (e) {
    console.error('FATAL:', e.message);
    fail++;
  } finally {
    // Roll back the entire transaction. Nothing persists in prod.
    await client.query('ROLLBACK').catch(() => {});
    client.release();
    await db.end?.();
    process.exit(fail > 0 ? 1 : 0);
  }
})();
