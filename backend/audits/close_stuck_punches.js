// Close the 3 forgotten-clock-out punches:
//   - 2x Jennifer Snow-Best → Cheri Shower (Mar 20 2026, 41ms apart — frontend
//     double-submit; collapse to one closed entry with 0 hours and delete the dupe)
//   - 1x Debra Monte → Sally Bandoli (May 31 2026)
//
// All closed with end_time = start_time (zero duration → zero pay) and a
// system note explaining what happened. No invented worked time.

require('dotenv').config();
const db = require('../src/db');

const TARGETS = [
  // Jennifer Snow-Best duplicates — keep the first, delete the second
  { id: '3301534d-6f15-48b5-a839-96bccc166c69', action: 'close',
    note: 'Auto-closed 2026-06-05 by system audit: clocked in 2026-03-20 with no clock-out. Frontend double-submitted — sibling entry 31fa9d7b deleted. No worked time recorded.' },
  { id: '31fa9d7b-2ce2-408c-a592-80c6f91f639e', action: 'delete' },
  { id: '5e11615c-76d8-404f-8c5c-96a9dd84abcf', action: 'close',
    note: 'Auto-closed 2026-06-05 by system audit: clocked in 2026-05-31, no clock-out recorded after 5+ days. No worked time recorded.' },
];

(async () => {
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');

    for (const t of TARGETS) {
      if (t.action === 'delete') {
        const r = await client.query(
          `DELETE FROM time_entries WHERE id = $1 AND is_complete = false RETURNING id`,
          [t.id]
        );
        console.log(`  DEL ${t.id}: ${r.rowCount === 1 ? 'deleted' : 'no-op (already gone or already complete)'}`);
      } else {
        const r = await client.query(
          `UPDATE time_entries
             SET end_time = start_time,
                 is_complete = true,
                 duration_minutes = 0,
                 billable_minutes = 0,
                 notes = COALESCE(notes || E'\n', '') || $2
           WHERE id = $1 AND is_complete = false
           RETURNING id, start_time, end_time, is_complete, duration_minutes`,
          [t.id, t.note]
        );
        if (r.rowCount === 1) {
          console.log(`  FIX ${t.id}: closed with 0 duration`);
        } else {
          console.log(`  FIX ${t.id}: no-op (already closed or missing)`);
        }
      }
    }

    // Verify nothing is still old + open
    const remaining = await client.query(`
      SELECT COUNT(*)::int AS n FROM time_entries
      WHERE is_complete = false AND start_time < NOW() - INTERVAL '24 hours'
    `);
    console.log(`\nRemaining open punches > 24h old: ${remaining.rows[0].n}`);

    if (remaining.rows[0].n === 0) {
      await client.query('COMMIT');
      console.log('✓ COMMITTED');
    } else {
      await client.query('ROLLBACK');
      console.log('✗ ROLLED BACK — unexpected state, please investigate');
      process.exitCode = 1;
    }
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('FATAL:', e.message);
    process.exitCode = 1;
  } finally {
    client.release();
    await db.end?.();
    process.exit();
  }
})();
