// Private pay bills the clock; payer clients keep billing the schedule.
// Read-only: calls POST /api/billing/invoices/preview (no writes) for one private-pay and
// one payer client over a past period, and reports how each day would bill.
// usage: node audits/test_private_pay_clocked_billing.js [periodStart] [periodEnd]
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
process.env.TWILIO_ACCOUNT_SID = ''; process.env.TWILIO_AUTH_TOKEN = '';
const db = require('../src/db');

const PRIVATE = { id: 'ce701bbd-c177-4671-ba4f-142f14e6c973', name: 'Linda Wright (private pay)' };
const PAYER = { id: '54c3dca8-4c3b-4518-8108-28e7ff2b73a8', name: 'Darrell Board (My Choice)' };
const FROM = process.argv[2] || '2026-08-01';
const TO = process.argv[3] || '2026-08-31';

function handler(router, method, p) {
  const layer = router.stack.find(l => l.route && l.route.path === p && l.route.methods[method]);
  if (!layer) throw new Error(`route not found: ${method} ${p}`);
  return layer.route.stack[layer.route.stack.length - 1].handle;
}
const fakeRes = () => { const r = { statusCode: 200 }; r.status = c => (r.statusCode = c, r); r.json = b => (r.body = b, r); return r; };

let fail = 0;
const check = (n, ok, x) => { if (!ok) fail++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${x !== undefined ? ' — ' + JSON.stringify(x).slice(0, 220) : ''}`); };

(async () => {
  const before = (await db.pool.query(`SELECT count(*)::int n FROM invoices`)).rows[0].n;
  const router = require('../src/routes/billingRoutes');
  const preview = handler(router, 'post', '/invoices/reconcile');
  const user = { id: 'test', role: 'admin' };

  for (const c of [PRIVATE, PAYER]) {
    const r = fakeRes();
    await preview({ user, body: { clientId: c.id, billingPeriodStart: FROM, billingPeriodEnd: TO } }, r);
    if (r.statusCode !== 200) { check(`${c.name} preview`, false, r.body); continue; }
    const rows = r.body.reconcile || [];
    console.log(`\n== ${c.name}  ${FROM} → ${TO}  ·  total $${r.body.total?.toFixed ? r.body.total.toFixed(2) : r.body.total}`);
    console.table(rows.map(x => ({
      date: x.service_date, status: x.status,
      sched_min: x.scheduled_minutes, clocked_min: x.clocked_minutes,
      billed: x.chosen_basis, default: x.default_basis, needs_review: x.needs_choice,
    })));

    const withPunch = rows.filter(x => x.clocked_minutes != null && x.scheduled_minutes != null);
    const short = withPunch.filter(x => x.clocked_minutes < x.scheduled_minutes - 7);
    const long = withPunch.filter(x => x.clocked_minutes > x.scheduled_minutes + 7);
    const noPunch = rows.filter(x => x.status === 'no_punch');

    if (c === PRIVATE) {
      check('private pay: short punches bill the clock', short.every(x => x.chosen_basis === 'clocked'), short.map(x => `${x.service_date}:${x.chosen_basis}`));
      check('private pay: short punches do not block the invoice', short.every(x => !x.needs_choice));
      check('private pay: long punches held for review, billed scheduled', long.every(x => x.needs_choice && x.chosen_basis === 'scheduled'), long.map(x => `${x.service_date}:${x.chosen_basis}/${x.needs_choice}`));
      check('private pay: no clock-in bills scheduled and is flagged', noPunch.every(x => x.chosen_basis === 'scheduled' && x.status === 'no_punch'), noPunch.map(x => x.service_date));
    } else {
      check('payer: matched days still bill the schedule', withPunch.every(x => x.chosen_basis === 'scheduled'), withPunch.map(x => `${x.service_date}:${x.chosen_basis}`));
      check('payer: any disagreement still needs review', withPunch.filter(x => Math.abs(x.clocked_minutes - x.scheduled_minutes) > 7).every(x => x.needs_choice));
    }
  }

  const after = (await db.pool.query(`SELECT count(*)::int n FROM invoices`)).rows[0].n;
  check('preview wrote nothing: invoice count unchanged', before === after, { before, after });
  console.log(fail ? `\n${fail} FAILED` : '\nALL PASS');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
