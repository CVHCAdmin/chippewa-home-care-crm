// Find recurring schedules whose effective_date is BEFORE their created_at.
// Those are schedules where someone back-dated the start in the form, and
// they're the reason "stuff is still showing up for last week" after v36.

require('dotenv').config();
const db = require('../src/db');

(async () => {
  try {
    const { rows } = await db.query(`
      SELECT
        s.id,
        s.created_at::date AS created_on,
        s.effective_date,
        (s.created_at::date - s.effective_date) AS days_backdated,
        s.day_of_week,
        s.start_time,
        s.end_time,
        s.is_active,
        u.first_name || ' ' || u.last_name AS caregiver,
        c.first_name || ' ' || c.last_name AS client
      FROM schedules s
      LEFT JOIN users u ON s.caregiver_id = u.id
      LEFT JOIN clients c ON s.client_id = c.id
      WHERE s.day_of_week IS NOT NULL
        AND s.effective_date IS NOT NULL
        AND s.effective_date < s.created_at::date
      ORDER BY days_backdated DESC, s.created_at DESC
    `);

    console.log(`Found ${rows.length} recurring schedules with effective_date BEFORE created_at:`);
    console.log('');
    rows.forEach(r => {
      console.log(`  ${r.is_active ? '●' : '○'} ${r.caregiver} → ${r.client}`);
      console.log(`    schedule id: ${r.id}`);
      console.log(`    created: ${r.created_on.toISOString().slice(0,10)}  effective: ${r.effective_date.toISOString().slice(0,10)}  (${r.days_backdated} days back)`);
      console.log(`    day_of_week=${r.day_of_week}  ${r.start_time}-${r.end_time}`);
      console.log('');
    });
  } catch (e) {
    console.error('FATAL:', e.message);
    process.exitCode = 1;
  } finally {
    await db.end?.();
    process.exit();
  }
})();
