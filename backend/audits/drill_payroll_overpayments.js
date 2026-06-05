// Drill into the two biggest red flags from the integrity audit:
// 1. 386 rows where the same (caregiver, shift_date, schedule_id) appears in
//    overlapping pay periods — potential double-pay
// 2. 116 missing_punch rows with payable_minutes > 0 — paid for no clock-in

require('dotenv').config();
const db = require('../src/db');

(async () => {
  try {
    console.log('═══════════════════════════════════════════════════════════════');
    console.log('OVERLAPPING PAY PERIODS — TOP 20 by overpaid hours');
    console.log('═══════════════════════════════════════════════════════════════');
    const dup = await db.query(`
      WITH dups AS (
        SELECT caregiver_id, shift_date, schedule_id,
               COUNT(*) AS n_rows,
               SUM(COALESCE(payable_minutes,0)) AS total_paid_minutes,
               MIN(COALESCE(payable_minutes,0)) AS one_paid_minutes,
               array_agg(DISTINCT pay_period_start::text ORDER BY pay_period_start::text) AS pay_periods
        FROM payroll_shift_reviews
        WHERE schedule_id IS NOT NULL
        GROUP BY caregiver_id, shift_date, schedule_id
        HAVING COUNT(DISTINCT (pay_period_start, pay_period_end)) > 1
      )
      SELECT
        u.first_name || ' ' || u.last_name AS caregiver,
        d.shift_date,
        d.n_rows AS times_reviewed,
        ROUND(d.total_paid_minutes / 60.0, 2) AS total_paid_hrs,
        ROUND(d.one_paid_minutes / 60.0, 2) AS legit_hrs,
        ROUND((d.total_paid_minutes - d.one_paid_minutes) / 60.0, 2) AS extra_hrs,
        array_length(d.pay_periods, 1) AS pay_periods_count
      FROM dups d
      JOIN users u ON d.caregiver_id = u.id
      ORDER BY (d.total_paid_minutes - d.one_paid_minutes) DESC
      LIMIT 20
    `);
    dup.rows.forEach(r => {
      console.log(`  ${r.caregiver.padEnd(22)}  ${r.shift_date.toISOString().slice(0,10)}  reviewed ${r.times_reviewed}x  legit=${r.legit_hrs}hr  extra=${r.extra_hrs}hr  in ${r.pay_periods_count} pay-periods`);
    });

    const totals = await db.query(`
      WITH dups AS (
        SELECT caregiver_id, shift_date, schedule_id,
               SUM(COALESCE(payable_minutes,0)) AS total_paid_minutes,
               MIN(COALESCE(payable_minutes,0)) AS one_paid_minutes
        FROM payroll_shift_reviews
        WHERE schedule_id IS NOT NULL
        GROUP BY caregiver_id, shift_date, schedule_id
        HAVING COUNT(DISTINCT (pay_period_start, pay_period_end)) > 1
      )
      SELECT
        COUNT(*) AS dup_shift_count,
        ROUND(SUM(total_paid_minutes - one_paid_minutes) / 60.0, 2) AS total_extra_hrs
      FROM dups
    `);
    console.log(`\n  → ${totals.rows[0].dup_shift_count} unique shifts paid in multiple pay periods`);
    console.log(`  → Total extra hours paid: ${totals.rows[0].total_extra_hrs}\n`);

    console.log('═══════════════════════════════════════════════════════════════');
    console.log('MISSING_PUNCH STATUS WITH PAYABLE MINUTES > 0 — top 20');
    console.log('  (these were paid even though no clock-in exists)');
    console.log('═══════════════════════════════════════════════════════════════');
    const mp = await db.query(`
      SELECT
        u.first_name || ' ' || u.last_name AS caregiver,
        psr.shift_date,
        ROUND(psr.payable_minutes/60.0, 2) AS paid_hrs,
        psr.flag_reason,
        psr.resolution_notes,
        psr.pay_period_start,
        psr.pay_period_end
      FROM payroll_shift_reviews psr
      JOIN users u ON psr.caregiver_id = u.id
      WHERE psr.status = 'missing_punch' AND psr.payable_minutes > 0
      ORDER BY psr.payable_minutes DESC
      LIMIT 20
    `);
    mp.rows.forEach(r => {
      console.log(`  ${r.caregiver.padEnd(22)}  ${r.shift_date.toISOString().slice(0,10)}  ${r.paid_hrs}hr  reason="${r.flag_reason || ''}"  notes="${r.resolution_notes || ''}"`);
    });

    const mpTotal = await db.query(`
      SELECT
        COUNT(*) AS n,
        ROUND(SUM(payable_minutes)/60.0, 2) AS total_hrs
      FROM payroll_shift_reviews
      WHERE status = 'missing_punch' AND payable_minutes > 0
    `);
    console.log(`\n  → ${mpTotal.rows[0].n} missing_punch rows paying ${mpTotal.rows[0].total_hrs} total hours\n`);

    console.log('═══════════════════════════════════════════════════════════════');
    console.log('OPEN PUNCHES > 24h OLD (probably forgotten clock-out)');
    console.log('═══════════════════════════════════════════════════════════════');
    const open = await db.query(`
      SELECT
        u.first_name || ' ' || u.last_name AS caregiver,
        c.first_name || ' ' || c.last_name AS client,
        te.start_time,
        EXTRACT(EPOCH FROM (NOW() - te.start_time))/3600 AS hours_open
      FROM time_entries te
      JOIN users u ON te.caregiver_id = u.id
      LEFT JOIN clients c ON te.client_id = c.id
      WHERE te.is_complete = false AND te.start_time < NOW() - INTERVAL '24 hours'
      ORDER BY te.start_time
    `);
    open.rows.forEach(r => {
      console.log(`  ${r.caregiver.padEnd(22)}  ${r.client?.padEnd(22) ?? '(no client)'}  clocked in ${r.start_time.toISOString()}  (${Math.round(r.hours_open)}h ago)`);
    });
    console.log('');
  } catch (e) {
    console.error('FATAL:', e.message);
    process.exitCode = 1;
  } finally {
    await db.end?.();
    process.exit();
  }
})();
