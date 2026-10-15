// Fill in map coordinates for every active client that has an address but no lat/lng.
// DRY RUN by default (looks the addresses up, saves nothing); pass --apply to save.
//   node audits/backfill_client_geocodes.js
//   node audits/backfill_client_geocodes.js --apply
// One lookup per second (OpenStreetMap's usage policy when no Google key is set).
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const db = require('../src/db');
const { fullAddress, geocodeAddress } = require('../src/helpers/geocode');

const APPLY = process.argv.includes('--apply');
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

(async () => {
  try {
    console.log(APPLY ? '=== APPLY ===' : '=== DRY RUN (pass --apply to save) ===');
    console.log(`Geocoder: ${process.env.GOOGLE_MAPS_API_KEY ? 'Google' : 'OpenStreetMap (no Google key set locally)'}`);
    const r = await db.query(
      `SELECT id, first_name, last_name, address, city, state, zip FROM clients
        WHERE is_active = true AND (latitude IS NULL OR longitude IS NULL)
        ORDER BY last_name, first_name`);
    let found = 0, missing = 0, noAddr = 0;
    for (const c of r.rows) {
      const name = `${c.first_name} ${c.last_name}`.trim();
      const addr = fullAddress(c);
      if (!c.address) { noAddr++; console.log(`  ${name.padEnd(28)} — no street address on file`); continue; }
      const g = await geocodeAddress(addr);
      if (!g) { missing++; console.log(`  ${name.padEnd(28)} ✗ not found: ${addr}`); }
      else {
        found++;
        console.log(`  ${name.padEnd(28)} ✓ ${g.latitude.toFixed(5)}, ${g.longitude.toFixed(5)} (${g.source}) — ${String(g.matched).slice(0, 70)}`);
        if (APPLY) await db.query(`UPDATE clients SET latitude = $1, longitude = $2 WHERE id = $3`, [g.latitude, g.longitude, c.id]);
      }
      await sleep(1100);
    }
    console.log(`\n${r.rows.length} without coordinates: ${found} found${APPLY ? ' and saved' : ''}, ${missing} not found, ${noAddr} no address.`);
  } catch (e) { console.error('FATAL', e.message); }
  finally { process.exit(0); }
})();
