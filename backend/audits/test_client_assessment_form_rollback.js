// Applies migration_v70 (In-Home Client Assessment) and exercises the Form Builder
// handlers — submit, list, PDF — against the LIVE schema inside one transaction
// that is ROLLED BACK. formBuilderRoutes only uses db.query, so routing db.query
// through one client keeps prod untouched. The migration's own BEGIN/COMMIT are
// stripped so they can't commit the outer transaction.
//   node audits/test_client_assessment_form_rollback.js [pdfOutPath]
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const fs = require('fs');
const path = require('path');
const { PassThrough } = require('stream');
const db = require('../src/db');

function fakeRes() {
  const r = { code: 200, body: null };
  r.status = (c) => { r.code = c; return r; };
  r.json = (b) => { r.body = b; return r; };
  return r;
}
function handlerFor(router, method, p) {
  const layer = router.stack.find(l => l.route && l.route.path === p && l.route.methods[method]);
  const stack = layer.route.stack;
  return stack[stack.length - 1].handle;
}

(async () => {
  const client = await db.pool.connect();
  db.query = (text, params) => client.query(text, params);
  let failures = 0;
  const check = (name, ok, extra) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? ' — ' + extra : ''}`); if (!ok) failures++; };
  try {
    await client.query('BEGIN');
    const sql = fs.readFileSync(path.join(__dirname, '..', 'migration_v70_client_assessment_form.sql'), 'utf8')
      .replace(/^\s*BEGIN;\s*$/m, '').replace(/^\s*COMMIT;\s*$/m, '');
    await client.query(sql);
    await client.query(sql); // re-runnable

    const t = (await client.query(`SELECT * FROM form_templates WHERE name='In-Home Client Assessment'`)).rows;
    check('template seeded exactly once', t.length === 1);
    const tpl = t[0];
    const fields = tpl.fields;
    const ids = fields.map(f => f.id);
    check('field ids unique', new Set(ids).size === ids.length, `${fields.length} fields, ${fields.filter(f => f.type === 'section').length} sections`);
    check('category assessment, signature, client', tpl.category === 'assessment' && tpl.requires_signature && tpl.auto_attach_to === 'client' && tpl.is_built_in);
    const bad = fields.filter(f => ['radio', 'select'].includes(f.type) && !(f.options || []).length);
    check('every radio/select has options', bad.length === 0, bad.map(f => f.id).join(','));

    const admin = (await client.query(`SELECT id FROM users WHERE role='admin' AND is_active LIMIT 1`)).rows[0];
    const cl = (await client.query(`SELECT id, first_name, last_name FROM clients WHERE is_active ORDER BY last_name LIMIT 1`)).rows[0];

    // Fill every field with a plausible answer.
    const data = {};
    for (const f of fields) {
      if (f.type === 'section') continue;
      if (f.type === 'checkbox') data[f.id] = f.options.slice(1, 3);
      else if (f.type === 'radio' || f.type === 'select') data[f.id] = f.options[0];
      else if (f.type === 'date') data[f.id] = '2026-09-24';
      else if (f.type === 'number') data[f.id] = '12';
      else data[f.id] = `Sample answer for ${f.id}`;
    }

    const router = require('../src/routes/formBuilderRoutes');
    let res = fakeRes();
    await handlerFor(router, 'post', '/submissions')({
      body: { templateId: tpl.id, entityType: 'client', entityId: cl.id, data, status: 'submitted', signature: 'Test Assessor' },
      user: { id: admin.id },
    }, res);
    check('submission saved (201)', res.code === 201, res.body && res.body.error);
    const sub = res.body;
    check('multi-select saved as array', Array.isArray(sub.data.services) && sub.data.services.length === 2, JSON.stringify(sub.data.services));

    res = fakeRes();
    await handlerFor(router, 'get', '/submissions')({ query: { entityType: 'client', entityId: cl.id } }, res);
    const row = (res.body || []).find(x => x.id === sub.id);
    check('list shows client name', row && row.entity_name === `${cl.first_name} ${cl.last_name}`, row && row.entity_name);

    // PDF: capture the stream.
    const out = new PassThrough();
    const chunks = [];
    out.on('data', c => chunks.push(c));
    out.setHeader = () => {};
    out.status = () => out; out.json = (b) => { console.log('PDF error body', b); };
    const done = new Promise(r => out.on('end', r));
    await handlerFor(router, 'get', '/submissions/:id/pdf')({ params: { id: sub.id } }, out);
    await done;
    const pdf = Buffer.concat(chunks);
    const pages = (pdf.toString('latin1').match(/\/Type \/Page\b/g) || []).length;
    check('PDF rendered', pdf.slice(0, 4).toString() === '%PDF' && pdf.length > 5000, `${pdf.length} bytes, ${pages} page(s)`);
    if (process.argv[2]) { fs.writeFileSync(process.argv[2], pdf); console.log('      PDF written to', process.argv[2]); }
  } catch (e) {
    console.error('ERROR', e); failures++;
  } finally {
    await client.query('ROLLBACK');
    client.release();
    console.log(failures ? `\n${failures} FAILURE(S) — rolled back` : '\nALL PASS — rolled back, prod untouched');
    process.exit(failures ? 1 : 0);
  }
})();
