// Renders care plan PDFs to a folder for visual inspection. Read-only for the real plan;
// the "filled" variant fills every text field + visit schedule inside a transaction that
// is ROLLED BACK, to check page overflow and the signature block.
// usage: node audits/render_care_plan_pdf_rollback.js <outDir> <carePlanId>
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const fs = require('fs');
const path = require('path');
const { PassThrough } = require('stream');
const db = require('../src/db');

const [OUT, PLAN] = process.argv.slice(2);

async function render(handle, user, id, file) {
  const out = new PassThrough(); const chunks = []; out.on('data', c => chunks.push(c));
  out.statusCode = 200; out.setHeader = () => {}; out.status = c => (out.statusCode = c, out); out.json = b => (out.body = b, out.end(), out);
  const done = new Promise(res => out.on('finish', res));
  await handle({ user, params: { id } }, out); await done;
  if (out.statusCode !== 200) throw new Error(JSON.stringify(out.body));
  fs.writeFileSync(path.join(OUT, file), Buffer.concat(chunks));
  console.log('wrote', file);
}

(async () => {
  const client = await db.pool.connect();
  const realQuery = db.query;
  db.query = (t, p) => client.query(t, p);
  try {
    const router = require('../src/routes/clinicalRoutes');
    const layer = router.stack.find(l => l.route && l.route.path === '/care-plans/:id/pdf');
    const handle = layer.route.stack[layer.route.stack.length - 1].handle;
    const user = { id: 'render', email: 'render-test' };

    await render(handle, user, PLAN, 'plan-real.pdf');

    await client.query('BEGIN');
    const long = 'Lorem ipsum dolor sit amet, consectetur adipiscing elit. '.repeat(4);
    await client.query(
      `UPDATE care_plans SET service_description=$1, care_goals=$1, special_instructions=$1, precautions=$1,
              medication_notes=$1, mobility_notes=$1, dietary_notes=$1, communication_notes=$1,
              visit_schedule=$2, visit_schedule_as_of=CURRENT_DATE WHERE id=$3`,
      [long, 'Monday 9:00 AM – 10:30 AM · Test · weekly\nWednesday 9:00 AM – 10:30 AM · Test · weekly\nFriday 8:00 AM – 11:00 AM · Test · weekly', PLAN]
    );
    await render(handle, user, PLAN, 'plan-filled.pdf');
  } finally {
    await client.query('ROLLBACK').catch(() => {});
    db.query = realQuery;
    client.release();
    await db.pool.end();
  }
})().catch(e => { console.error(e); process.exit(1); });
