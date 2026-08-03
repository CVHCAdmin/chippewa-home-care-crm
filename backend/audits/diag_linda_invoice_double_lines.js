// READ-ONLY: Linda Wright's most recent invoice — every line item, next to the
// time entries and schedule occurrences for the same dates, to see whether the
// same shift produced BOTH a clocked line and a scheduled line.
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const db = require('../src/db');

const chi = (ts) => ts ? new Date(ts).toLocaleString('en-US', { timeZone: 'America/Chicago', month: '2-digit', day: '2-digit', hour: 'numeric', minute: '2-digit', hour12: true }) : 'null';
const chiT = (ts) => ts ? new Date(ts).toLocaleTimeString('en-US', { timeZone: 'America/Chicago', hour: 'numeric', minute: '2-digit', hour12: true }) : 'null';

(async () => {
  try {
    const cl = await db.query(
      `SELECT id, first_name, last_name FROM clients
        WHERE first_name ILIKE 'linda%' AND last_name ILIKE 'wright%'`
    );
    if (cl.rows.length !== 1) {
      console.log('Client match count:', cl.rows.length, cl.rows);
      if (cl.rows.length === 0) return;
    }
    const client = cl.rows[0];
    console.log(`Client: ${client.first_name} ${client.last_name} (${client.id})\n`);

    const inv = await db.query(
      `SELECT * FROM invoices WHERE client_id = $1 ORDER BY created_at DESC LIMIT 3`,
      [client.id]
    );
    if (inv.rows.length === 0) { console.log('No invoices.'); return; }
    console.log('=== Most recent invoices ===');
    for (const i of inv.rows) {
      console.log(`  #${i.invoice_number}  period ${String(i.billing_period_start).slice(0,15)} .. ${String(i.billing_period_end).slice(0,15)}  total $${i.total}  status ${i.payment_status}  sent_at ${i.sent_at ? chi(i.sent_at) : 'DRAFT'}  created ${chi(i.created_at)}`);
    }

    const invoice = inv.rows[0];
    console.log(`\n=== Line items on latest: #${invoice.invoice_number} ===`);
    const items = await db.query(
      `SELECT ili.*, u.first_name AS cg_first, u.last_name AS cg_last
         FROM invoice_line_items ili
         LEFT JOIN users u ON u.id = ili.caregiver_id
        WHERE ili.invoice_id = $1
        ORDER BY ili.service_date NULLS LAST, ili.created_at`,
      [invoice.id]
    );
    let sum = 0;
    for (const li of items.rows) {
      sum += parseFloat(li.amount);
      console.log(`  ${String(li.service_date).slice(0,15)}  ${(li.cg_first||'?')+' '+(li.cg_last||'?')}`.padEnd(50)
        + ` ${String(li.hours).padStart(6)}h  $${String(li.amount).padStart(8)}  te=${li.time_entry_id ? 'YES' : 'no '}  "${li.description}"`);
    }
    console.log(`  line-item sum: $${sum.toFixed(2)}  (invoice total $${invoice.total})`);

    // Real punches in the period
    console.log('\n=== Completed time entries in the period ===');
    const tes = await db.query(
      `SELECT te.id, te.caregiver_id, te.start_time, te.end_time, te.duration_minutes, te.billable_minutes,
              u.first_name AS cg_first, u.last_name AS cg_last
         FROM time_entries te
         JOIN users u ON u.id = te.caregiver_id
        WHERE te.client_id = $1 AND te.is_complete = true
          AND te.start_time >= $2 AND te.start_time < ($3::date + INTERVAL '1 day')
        ORDER BY te.start_time`,
      [client.id, invoice.billing_period_start, invoice.billing_period_end]
    );
    for (const te of tes.rows) {
      console.log(`  ${chi(te.start_time)} -> ${chiT(te.end_time)}  ${te.cg_first} ${te.cg_last}  dur=${te.duration_minutes}m billable=${te.billable_minutes}m  (${te.id})`);
    }
    if (tes.rows.length === 0) console.log('  (none)');

    // Schedules that could expand into this period for this client
    console.log('\n=== Schedules touching this client (raw rows) ===');
    const sch = await db.query(
      `SELECT s.id, s.caregiver_id, u.first_name AS cg_first, u.last_name AS cg_last,
              s.schedule_type, s.day_of_week, s.date, s.start_time, s.end_time,
              s.frequency, s.effective_date, s.anchor_date, s.end_date,
              s.status, s.is_active, s.is_training, s.suspended_from
         FROM schedules s
         LEFT JOIN users u ON u.id = s.caregiver_id
        WHERE s.client_id = $1
        ORDER BY s.day_of_week NULLS LAST, s.date NULLS LAST, s.start_time`,
      [client.id]
    );
    for (const s of sch.rows) {
      console.log(`  ${s.id.slice(0,8)}  ${(s.cg_first||'?')+' '+(s.cg_last||'?')}`.padEnd(32)
        + ` type=${s.schedule_type} dow=${s.day_of_week ?? '-'} date=${s.date ? String(s.date).slice(0,15) : '-'} ${s.start_time}-${s.end_time} freq=${s.frequency||'-'} eff=${s.effective_date ? String(s.effective_date).slice(0,15) : '-'} end=${s.end_date ? String(s.end_date).slice(0,15) : '-'} status=${s.status} active=${s.is_active} training=${s.is_training} susp=${s.suspended_from ? String(s.suspended_from).slice(0,15) : '-'}`);
    }
    if (sch.rows.length === 0) console.log('  (none)');
  } catch (e) {
    console.error('FAILED:', e.message);
    process.exitCode = 1;
  } finally {
    await db.pool.end();
    process.exit();
  }
})();
