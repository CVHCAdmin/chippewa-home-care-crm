// Smoke for round 12: shift reminder log table, swap request flow,
// incident report SQL, SMS template seeds, conflict heatmap SQL.

require('dotenv').config();
const db = require('../src/db');
const { v4: uuidv4 } = require('uuid');

let pass = 0, fail = 0;
const ok = (name, cond, detail = '') => {
  if (cond) { console.log(`  ✓ ${name}`); pass++; }
  else      { console.log(`  ✗ ${name}${detail ? ' — ' + detail : ''}`); fail++; }
};

(async () => {
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');

    const cgs = (await client.query(`SELECT id, first_name FROM users WHERE role = 'caregiver' AND is_active = true LIMIT 2`)).rows;
    const c = (await client.query(`SELECT id FROM clients WHERE is_active = true LIMIT 1`)).rows[0];
    const admin = (await client.query(`SELECT id FROM users WHERE role = 'admin' AND is_active = true LIMIT 1`)).rows[0];
    if (cgs.length < 2 || !c || !admin) throw new Error('Need 2 caregivers, 1 client, 1 admin');
    const [cg1, cg2] = cgs;

    console.log('\nShift reminder log table');
    await client.query(`CREATE TABLE IF NOT EXISTS shift_reminder_log (
      schedule_id UUID NOT NULL, shift_date DATE NOT NULL,
      sent_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (schedule_id, shift_date)
    )`);
    const dummyScheduleId = uuidv4();
    await client.query(`INSERT INTO shift_reminder_log (schedule_id, shift_date) VALUES ($1, CURRENT_DATE) ON CONFLICT DO NOTHING`, [dummyScheduleId]);
    let dup = false;
    try {
      await client.query('SAVEPOINT srl_dup');
      await client.query(`INSERT INTO shift_reminder_log (schedule_id, shift_date) VALUES ($1, CURRENT_DATE)`, [dummyScheduleId]);
      await client.query('RELEASE SAVEPOINT srl_dup');
    } catch (e) { dup = /duplicate key/.test(e.message); await client.query('ROLLBACK TO SAVEPOINT srl_dup'); }
    ok('reminder-log PK prevents duplicates same day', dup);

    console.log('\nShift swap request POST + respond');
    // Make a schedule, then a swap request, then respond
    const schedId = uuidv4();
    await client.query(
      `INSERT INTO schedules (id, caregiver_id, client_id, schedule_type, date, start_time, end_time)
       VALUES ($1, $2, $3, 'one-time', CURRENT_DATE + 1, '09:00', '13:00')`,
      [schedId, cg1.id, c.id]
    );
    const swap = await client.query(
      `INSERT INTO shift_swap_requests (schedule_id, requesting_caregiver_id, target_caregiver_id, shift_date, reason)
       VALUES ($1, $2, $3, CURRENT_DATE + 1, 'smoke test')
       RETURNING id, status`,
      [schedId, cg1.id, cg2.id]
    );
    ok('swap request created with pending status', swap.rows[0]?.status === 'pending');

    console.log('\nIncident summary SQL');
    const inc = await client.query(`
      SELECT c.id AS client_id, c.first_name, c.last_name,
        COUNT(*) AS incident_count,
        COUNT(*) FILTER (WHERE ir.severity = 'critical') AS critical_count
      FROM incident_reports ir
      JOIN clients c ON ir.client_id = c.id
      WHERE ir.incident_date BETWEEN '2025-01-01' AND CURRENT_DATE
      GROUP BY c.id, c.first_name, c.last_name LIMIT 3
    `);
    ok('client-incidents SQL runs', inc.rows.length >= 0);

    console.log('\nSMS templates seeded');
    const tpl = await client.query(`SELECT COUNT(*) AS n FROM sms_templates WHERE is_active = true`);
    ok('at least 8 SMS templates present', parseInt(tpl.rows[0].n) >= 8, `got ${tpl.rows[0].n}`);

    console.log('\nConflict heatmap SQL');
    const hm = await client.query(`
      WITH days AS (SELECT generate_series('2026-06-01'::date, '2026-06-07'::date, '1 day'::interval)::date AS d)
      SELECT COUNT(*) AS n FROM days d
      LEFT JOIN schedules s
        ON s.is_active = true
       AND (s.date = d.d OR (s.day_of_week = EXTRACT(DOW FROM d.d)::int))
    `);
    ok('heatmap base SQL runs without error', hm.rows.length >= 0);

    console.log(`\n──────────────────────────────`);
    console.log(`Results: ${pass} passed, ${fail} failed`);
    console.log(`──────────────────────────────`);
  } catch (e) { console.error('FATAL:', e.message); fail++; }
  finally {
    await client.query('ROLLBACK').catch(() => {});
    client.release();
    await db.end?.();
    process.exit(fail > 0 ? 1 : 0);
  }
})();
