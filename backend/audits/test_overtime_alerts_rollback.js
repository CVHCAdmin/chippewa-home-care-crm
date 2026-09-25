// Exercises jobs/overtimeAlerts.scanOnce against the LIVE schema inside one
// transaction that is ROLLED BACK. The job only uses db.query (no pool.connect),
// so routing db.query through a single client keeps prod untouched. Twilio is
// replaced by a capturing stub — no texts are sent.
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const db = require('../src/db');
const job = require('../src/jobs/overtimeAlerts');

(async () => {
  const client = await db.pool.connect();
  db.query = (text, params) => client.query(text, params);
  const sent = [];
  job._setSender(async (to, body) => { sent.push({ to, body }); return { status: 'sent', sid: 'TEST', error: null }; });

  let failures = 0;
  const check = (name, ok, extra) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? ' — ' + extra : ''}`); if (!ok) failures++; };
  try {
    await client.query('BEGIN');
    await job.ensureTable();

    // Caregivers with a phone and no open punch (one open entry per caregiver is enforced).
    const cgs = (await client.query(`
      SELECT u.id, u.phone FROM users u
      WHERE u.role='caregiver' AND u.is_active AND u.phone IS NOT NULL
        AND NOT EXISTS (SELECT 1 FROM time_entries t WHERE t.caregiver_id=u.id AND t.end_time IS NULL)
      LIMIT 7`)).rows;
    const cl = (await client.query(`SELECT id, first_name, last_name FROM clients WHERE is_active LIMIT 1`)).rows[0];
    const admins = (await client.query(`SELECT id, phone FROM users WHERE role='admin' AND is_active`)).rows;
    if (cgs.length < 7) throw new Error('need 7 idle caregivers');

    const mk = async (cg, agoMin, allotted) => (await client.query(
      `INSERT INTO time_entries (id, caregiver_id, client_id, start_time, allotted_minutes)
       VALUES (gen_random_uuid(), $1, $2, NOW() - $3 * INTERVAL '1 minute', $4) RETURNING id`,
      [cg.id, cl.id, agoMin, allotted])).rows[0].id;
    const setAgo = (id, agoMin) => client.query(`UPDATE time_entries SET start_time = NOW() - $2 * INTERVAL '1 minute' WHERE id=$1`, [id, agoMin]);
    const textsTo = (phone) => sent.filter(s => s.to === job.toE164(phone));
    const officeTexts = () => admins.filter(a => a.phone).flatMap(a => textsTo(a.phone));
    const reset = () => { sent.length = 0; };

    // The main walk-through: 1-hour visit, clocked in 9:05-style (measured from punch).
    const A = await mk(cgs[0], 67, 60);          // 7 min over
    const B = await mk(cgs[1], 60 + 3, 60);      // 3 min over — too early
    const C = await mk(cgs[2], 60 + 45, 60);     // delayed scan: already 45 over
    const D = await mk(cgs[3], 60 + 20 * 60, 60);// 20h over — stale stuck punch
    const E = await mk(cgs[4], 300, null);       // unscheduled, no allotment
    const F = await mk(cgs[5], 90, 60);          // 30 over but clocked out
    await client.query(`UPDATE time_entries SET end_time = NOW() WHERE id=$1`, [F]);
    const G = await mk(cgs[6], 30 + 8, 30);      // 30-min visit, 8 over

    await job.scanOnce();
    check('+5: caregiver A texted once', textsTo(cgs[0].phone).length === 1, textsTo(cgs[0].phone)[0]?.body);
    check('+5: no office text', officeTexts().length === 0);
    check('3 min over: no text', textsTo(cgs[1].phone).length === 0);
    check('catch-up (45 over): exactly one text', textsTo(cgs[2].phone).length === 1, textsTo(cgs[2].phone)[0]?.body);
    const cLog = (await client.query(`SELECT threshold_min, sent FROM overtime_alert_log WHERE time_entry_id=$1 ORDER BY 1`, [C])).rows;
    check('catch-up logs +5 skipped, +30 sent', JSON.stringify(cLog) === JSON.stringify([{ threshold_min: 5, sent: false }, { threshold_min: 30, sent: true }]), JSON.stringify(cLog));
    check('stale 20h punch: no text', textsTo(cgs[3].phone).length === 0);
    check('no allotment: no text', textsTo(cgs[4].phone).length === 0);
    check('clocked out: no text', textsTo(cgs[5].phone).length === 0);
    check('30-min visit 8 over: texted', textsTo(cgs[6].phone).length === 1);

    reset(); await job.scanOnce();
    check('rescan: no duplicates', sent.filter(s => [0,1,2,6].some(i => s.to === job.toE164(cgs[i].phone))).length === 0);

    reset(); await setAgo(A, 60 + 32); await job.scanOnce();
    check('+30: caregiver A texted again', textsTo(cgs[0].phone).length === 1, textsTo(cgs[0].phone)[0]?.body);
    check('+30: still no office text', officeTexts().length === 0);

    reset(); await setAgo(A, 60 + 62); await job.scanOnce();
    check('+60: caregiver A texted', textsTo(cgs[0].phone).length === 1, textsTo(cgs[0].phone)[0]?.body);
    check('+60: office texted', officeTexts().length === admins.filter(a => a.phone).length && officeTexts().length > 0, officeTexts()[0]?.body);
    const n = (await client.query(`SELECT count(*)::int n FROM notifications WHERE type='overtime_alert' AND created_at > NOW() - INTERVAL '1 minute'`)).rows[0].n;
    check('+60: in-app notification per admin', n >= admins.length, `${n}`);

    reset(); await setAgo(A, 60 + 200); await job.scanOnce();
    check('past +60: nothing more', textsTo(cgs[0].phone).length === 0);

    const logged = (await client.query(`SELECT status, count(*)::int n FROM sms_messages WHERE twilio_sid='TEST' GROUP BY 1`)).rows;
    check('texts recorded in sms_messages as sent', logged.length === 1 && logged[0].status === 'sent', JSON.stringify(logged));

    check('E.164: (715) 829-3135', job.toE164('(715) 829-3135') === '+17158293135');
    check('E.164: 715-944-4597', job.toE164('715-944-4597') === '+17159444597');
    check('E.164: junk rejected', job.toE164('12345') === null);
  } catch (e) {
    console.error('ERROR', e); failures++;
  } finally {
    await client.query('ROLLBACK');
    client.release();
    console.log(failures ? `\n${failures} FAILURE(S) — rolled back` : '\nALL PASS — rolled back, prod untouched');
    process.exit(failures ? 1 : 0);
  }
})();
