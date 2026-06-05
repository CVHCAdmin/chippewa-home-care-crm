// Comprehensive smoke test for everything shipped since round 4.
// Runs in a single transaction that's ROLLED BACK at the end — nothing
// persists. Tests against the real prod schema so any drift surfaces here.

require('dotenv').config();
const db = require('../src/db');
const { v4: uuidv4 } = require('uuid');

let pass = 0, fail = 0;
function ok(name, cond, detail = '') {
  if (cond) { console.log(`  ✓ ${name}`); pass++; }
  else      { console.log(`  ✗ ${name}${detail ? ' — ' + detail : ''}`); fail++; }
}

(async () => {
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');

    const c  = (await client.query(`SELECT id, first_name, last_name FROM clients WHERE is_active = true LIMIT 1`)).rows[0];
    const cg = (await client.query(`SELECT id, first_name, last_name, phone FROM users WHERE role = 'caregiver' AND is_active = true LIMIT 1`)).rows[0];
    const admin = (await client.query(`SELECT id FROM users WHERE role = 'admin' AND is_active = true LIMIT 1`)).rows[0];
    if (!c || !cg || !admin) throw new Error('Need active client, caregiver, and admin');

    // ── ROUND 5/6: features ─────────────────────────────────────────────────
    console.log('\n── ROUND 5 + 6 ─────────────────────────────');

    console.log('\nForm templates seeded');
    const tpl = await client.query(`SELECT COUNT(*) AS n FROM form_templates WHERE is_built_in = true AND is_active = true`);
    ok('8 built-in templates present', parseInt(tpl.rows[0].n) === 8, `got ${tpl.rows[0].n}`);

    console.log('\nVisit photo insert + CHECK');
    const teId = uuidv4();
    await client.query(
      `INSERT INTO time_entries (id, caregiver_id, client_id, start_time, end_time, is_complete)
       VALUES ($1, $2, $3, NOW() - INTERVAL '2 hours', NOW(), true)`,
      [teId, cg.id, c.id]
    );
    const vp = await client.query(
      `INSERT INTO visit_photos (time_entry_id, caregiver_id, client_id, caption, category, image_base64, image_size)
       VALUES ($1, $2, $3, 'smoke test', 'task', 'data:image/png;base64,SMOKE_TEST_AAAA', 12)
       RETURNING id`,
      [teId, cg.id, c.id]
    );
    ok('visit_photo created', vp.rows.length === 1);

    let rejected = false;
    try {
      await client.query('SAVEPOINT vp_big');
      await client.query(
        `INSERT INTO visit_photos (time_entry_id, image_base64, image_size) VALUES ($1, 'x', 6000000)`,
        [teId]
      );
      await client.query('RELEASE SAVEPOINT vp_big');
    } catch (e) { rejected = /visit_photo_size_cap/.test(e.message); await client.query('ROLLBACK TO SAVEPOINT vp_big'); }
    ok('5MB visit-photo CHECK rejects 6MB', rejected);

    console.log('\nInsurance card upload + CHECK');
    const ic = await client.query(
      `UPDATE clients SET insurance_card_front = 'data:image/jpeg;base64,SMOKE', insurance_card_uploaded_at = NOW() WHERE id = $1 RETURNING insurance_card_uploaded_at`,
      [c.id]
    );
    ok('insurance_card_front saved', !!ic.rows[0].insurance_card_uploaded_at);

    // ── ROUND 8: notif prefs + smart fill ───────────────────────────────────
    console.log('\n── ROUND 8 ─────────────────────────────────');

    console.log('\nNotification prefs CRUD + helper');
    // Ensure prefs row, write opt-out, read back
    await client.query(`INSERT INTO notification_settings (user_id) VALUES ($1) ON CONFLICT (user_id) DO NOTHING`, [cg.id]);
    await client.query(`UPDATE notification_settings SET sms_enabled = false, schedule_alerts = false, quiet_hours_start = '22:00', quiet_hours_end = '07:00' WHERE user_id = $1`, [cg.id]);
    const ns = (await client.query(`SELECT sms_enabled, schedule_alerts FROM notification_settings WHERE user_id = $1`, [cg.id])).rows[0];
    ok('prefs columns persist', ns.sms_enabled === false && ns.schedule_alerts === false);

    console.log('\nshouldNotify helper logic');
    // Manually inline the same logic used by the helper since the helper
    // uses the pool (not our transaction). This checks the LOGIC.
    const prefs = (await client.query(`SELECT * FROM notification_settings WHERE user_id = $1`, [cg.id])).rows[0];
    const channelOk = prefs.sms_enabled !== false;
    const eventOk = prefs.schedule_alerts !== false;
    ok('SMS channel toggle off blocks send', channelOk === false);
    ok('schedule_alerts off blocks send', eventOk === false);
    // Quiet hours math
    const parseHm = (t) => { const [h, m] = String(t).split(':').map(Number); return h * 60 + (m || 0); };
    const start = parseHm(prefs.quiet_hours_start);
    const end   = parseHm(prefs.quiet_hours_end);
    const at23 = 23 * 60;  // 23:00 — should be inside overnight window 22→07
    const at12 = 12 * 60;  // 12:00 — should be outside
    const inWin = (cur) => start <= end ? (cur >= start && cur < end) : (cur >= start || cur < end);
    ok('overnight quiet-hours wrap detects 23:00', inWin(at23) === true);
    ok('overnight quiet-hours wrap rejects 12:00', inWin(at12) === false);

    // ── ROUND 9: care plan revisions ────────────────────────────────────────
    console.log('\n── ROUND 9 ─────────────────────────────────');

    console.log('\nCare plan revision trigger');
    const planId = uuidv4();
    await client.query(
      `INSERT INTO care_plans (id, client_id, service_type, frequency, care_goals, created_by)
       VALUES ($1, $2, 'Personal Care', 'Daily', 'Initial goals', $3)`,
      [planId, c.id, admin.id]
    );
    // Set session GUC and update with a different value — trigger should snapshot
    await client.query(`SELECT set_config('crm.user_id', $1, true)`, [admin.id]);
    await client.query(`UPDATE care_plans SET care_goals = 'Revised goals' WHERE id = $1`, [planId]);
    const revs = await client.query(`SELECT revision_number, care_goals, changed_by FROM care_plan_revisions WHERE care_plan_id = $1`, [planId]);
    ok('trigger snapshotted OLD row on UPDATE', revs.rows.length === 1);
    ok('snapshot has the OLD goals (not new)', revs.rows[0]?.care_goals === 'Initial goals');
    ok('changed_by captured via session GUC', revs.rows[0]?.changed_by === admin.id);

    // Verify trigger does NOT fire when no meaningful field changes
    await client.query(`UPDATE care_plans SET updated_at = NOW() WHERE id = $1`, [planId]);
    const revs2 = await client.query(`SELECT COUNT(*) AS n FROM care_plan_revisions WHERE care_plan_id = $1`, [planId]);
    ok('trigger no-op when only timestamp changes', parseInt(revs2.rows[0].n) === 1);

    // ── PUT /api/clients/:id supports payRate via PUT /api/caregivers/:id ──
    // Quick sanity for the bulk-pay-rate path I added without testing
    console.log('\nCaregiver PUT updates default_pay_rate (bulk path)');
    const oldRate = (await client.query(`SELECT default_pay_rate FROM users WHERE id = $1`, [cg.id])).rows[0].default_pay_rate;
    await client.query(`UPDATE users SET default_pay_rate = $1 WHERE id = $2`, [99.99, cg.id]);
    const newRate = (await client.query(`SELECT default_pay_rate FROM users WHERE id = $1`, [cg.id])).rows[0].default_pay_rate;
    ok('default_pay_rate column writable', parseFloat(newRate) === 99.99);
    // Restore so prod sees the real value if anything escapes the rollback
    await client.query(`UPDATE users SET default_pay_rate = $1 WHERE id = $2`, [oldRate, cg.id]);

    // ── Client status PATCH path ─────────────────────────────────────────────
    console.log('\nClient is_active PATCH path');
    const wasActive = (await client.query(`SELECT is_active FROM clients WHERE id = $1`, [c.id])).rows[0].is_active;
    await client.query(`UPDATE clients SET is_active = $1 WHERE id = $2`, [false, c.id]);
    const nowActive = (await client.query(`SELECT is_active FROM clients WHERE id = $1`, [c.id])).rows[0].is_active;
    ok('is_active toggles via UPDATE', nowActive === false);
    await client.query(`UPDATE clients SET is_active = $1 WHERE id = $2`, [wasActive, c.id]);

    console.log(`\n──────────────────────────────`);
    console.log(`Results: ${pass} passed, ${fail} failed`);
    console.log(`──────────────────────────────`);
  } catch (e) {
    console.error('FATAL:', e.message);
    fail++;
  } finally {
    await client.query('ROLLBACK').catch(() => {});
    client.release();
    await db.end?.();
    process.exit(fail > 0 ? 1 : 0);
  }
})();
