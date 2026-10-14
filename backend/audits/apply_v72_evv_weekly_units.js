// v72 — weekly EVV allowance. DRY RUN by default; pass --apply to write.
//   node audits/apply_v72_evv_weekly_units.js           → shows what would happen
//   node audits/apply_v72_evv_weekly_units.js --apply   → applies migration + sets units
//
// 1. Applies migration_v72_evv_weekly_units.sql (adds clients.evv_weekly_units and
//    time_entries.sandata_required). Must run BEFORE the code deploy that reads them.
// 2. Sets each client's S5125 attendant-care (EVV) units per week from the owner's
//    MIDAS pull "MIDAS_Current_Auths_EVV_vs_Regular_Units.xlsx" (current as of 2026-10-14).
//    Matches active clients by first + last name, falling back to a unique last name.
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const fs = require('fs');
const path = require('path');
const db = require('../src/db');

const APPLY = process.argv.includes('--apply');

// [MIDAS name, EVV-required units/wk (S5125)]. Homemaker-only clients get 0.
const MIDAS_EVV_UNITS = [
  ['Darrell Board', 8], ['Kathy Boardman', 19], ['Pamela Burdick', 10], ['Jonathan Cox', 6],
  ['Evelyn Dodge', 5], ['Terri Gallegos', 12], ['Constance Greene', 34], ['Dana Hillestad', 10],
  ['Kristina Jasinski', 4], ['Trina Klukas', 0], ['Patricia Konop', 9], ['James Marken', 7],
  ['Timothy Odness', 48], ['Sandra Person', 8], ['Theresa Polden', 8], ['Mark Snabel', 12],
  ['Marleen Shilts', 61], ['Roxanne Smiskey', 0], ['Rebecca Tharp', 21], ['Jon Walker', 3],
  ['Audrey Washburn', 8], ['Ethan Woodman', 3], ['Denise Woods', 0], ['Pamela Zinn', 13],
];

(async () => {
  try {
    console.log(APPLY ? '=== APPLY ===' : '=== DRY RUN (pass --apply to write) ===');

    const hasCol = (await db.query(
      `SELECT 1 FROM information_schema.columns WHERE table_name='clients' AND column_name='evv_weekly_units'`)).rows.length > 0;
    console.log(`Migration v72: ${hasCol ? 'already applied' : 'not applied'}`);
    if (!hasCol && APPLY) {
      await db.query(fs.readFileSync(path.join(__dirname, '..', 'migration_v72_evv_weekly_units.sql'), 'utf8'));
      console.log('  → applied');
    }

    const clients = (await db.query(
      `SELECT c.id, c.first_name, c.last_name, c.medicaid_id, rs.payer_type
         FROM clients c LEFT JOIN referral_sources rs ON rs.id = c.referral_source_id
        WHERE c.is_active = true`)).rows;
    const norm = s => String(s || '').trim().toLowerCase();

    const plan = [], problems = [];
    for (const [name, units] of MIDAS_EVV_UNITS) {
      const parts = name.split(' ');
      const first = norm(parts[0]), last = norm(parts.slice(1).join(' '));
      let hits = clients.filter(c => norm(c.first_name) === first && norm(c.last_name) === last);
      let how = 'name';
      if (hits.length === 0) { hits = clients.filter(c => norm(c.last_name) === last); how = 'last name only'; }
      if (hits.length !== 1) { problems.push(`${name} (${units}u): ${hits.length === 0 ? 'no active CRM client' : `${hits.length} matches — set by hand`}`); continue; }
      const c = hits[0];
      plan.push({ name, crm: `${c.first_name} ${c.last_name}`, how, units, inSandata: c.payer_type === 'mco_family_care' && /^\d{10,12}$/.test(String(c.medicaid_id || '').trim()), id: c.id });
    }

    for (const p of plan) {
      console.log(`  ${p.crm.padEnd(24)} ${String(p.units).padStart(3)}u/wk  (matched by ${p.how}${p.crm.toLowerCase() !== p.name.toLowerCase() ? `; MIDAS "${p.name}"` : ''})${p.inSandata ? '' : '  ⚠ not a Sandata client in CRM (no My Choice payer or Medicaid ID) — app will not prompt anyway'}`);
    }
    if (problems.length) { console.log('\nNot set:'); problems.forEach(p => console.log('  ' + p)); }

    if (APPLY) {
      for (const p of plan) {
        await db.query(`UPDATE clients SET evv_weekly_units = $1, updated_at = NOW() WHERE id = $2`, [p.units, p.id]);
      }
      console.log(`\nSet evv_weekly_units on ${plan.length} clients.`);
    }
  } catch (e) { console.error('FATAL', e.message); }
  finally { process.exit(0); }
})();
