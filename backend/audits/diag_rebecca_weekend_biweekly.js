// READ-ONLY: Rebecca weekend split (Nicole / Maggie bi-weekly) diagnosis, 2026-09-10
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const db = require('../src/db');
(async () => {
  try {
    const cls = (await db.query(`SELECT id, first_name, last_name, is_active, status FROM clients WHERE first_name ILIKE 'rebecca%' OR first_name ILIKE 'becky%'`)).rows;
    console.log('CLIENTS:', cls);
    const cgs = (await db.query(`SELECT id, first_name, last_name, role, is_active FROM users WHERE (first_name ILIKE 'nicole%' OR first_name ILIKE 'maggie%' OR first_name ILIKE 'margaret%')`)).rows;
    console.log('CAREGIVERS:', cgs);
    const clientIds = cls.map(c => c.id);
    const cgIds = cgs.map(c => c.id);
    const rows = (await db.query(
      `SELECT s.id, s.schedule_type, s.frequency, s.day_of_week, s.date::text AS date, s.start_time, s.end_time,
              s.effective_date::text AS effective_date, s.anchor_date::text AS anchor_date, s.end_date::text AS end_date,
              s.is_active, s.suspended_from::text AS suspended_from, s.created_at, s.updated_at, s.notes,
              u.first_name AS cg_first, u.last_name AS cg_last, c.first_name AS cl_first, c.last_name AS cl_last
         FROM schedules s JOIN users u ON u.id=s.caregiver_id JOIN clients c ON c.id=s.client_id
        WHERE s.client_id = ANY($1) OR (s.caregiver_id = ANY($2) AND s.created_at > NOW() - INTERVAL '14 days')
        ORDER BY c.last_name, s.day_of_week, s.start_time, s.created_at`, [clientIds, cgIds])).rows;
    console.log('SCHEDULE ROWS:'); console.table(rows.map(r => ({ id: r.id.slice(0,8), cg: r.cg_first+' '+r.cg_last, cl: r.cl_first+' '+r.cl_last, type: r.schedule_type, freq: r.frequency, dow: r.day_of_week, date: r.date, start: r.start_time, end: r.end_time, eff: r.effective_date, anchor: r.anchor_date, end_date: r.end_date, active: r.is_active, susp: r.suspended_from, created: r.created_at && r.created_at.toISOString(), notes: (r.notes||'').slice(0,30) })));
    const ex = (await db.query(`SELECT se.* FROM schedule_exceptions se WHERE se.schedule_id = ANY($1) AND se.exception_date >= '2026-08-01' ORDER BY exception_date`, [rows.map(r => r.id)])).rows;
    console.log('EXCEPTIONS:', ex);
    // Engine expansion for the weekend dates, Sept 5 - Oct 11
    const { SCHEDULE_OCCURRENCES_CTE } = require('../src/helpers/scheduleOccurrences');
    const occ = (await db.query(`WITH ${SCHEDULE_OCCURRENCES_CTE()} SELECT o.occ_date::text AS d, to_char(o.occ_date,'Dy') AS dow, u.first_name AS cg, o.start_time, o.end_time, o.schedule_id FROM schedule_occurrences o JOIN users u ON u.id=o.caregiver_id WHERE o.client_id = ANY($3) ORDER BY o.occ_date, o.start_time`, ['2026-09-05', '2026-10-11', clientIds])).rows;
    console.log('ENGINE OCCURRENCES 9/5-10/11:'); console.table(occ.map(o => ({ ...o, schedule_id: o.schedule_id.slice(0,8) })));
    const audit = (await db.query(`SELECT a.created_at, a.action, a.table_name, a.record_id, u.first_name AS by_first, a.new_data FROM audit_logs a LEFT JOIN users u ON u.id=a.user_id WHERE a.table_name='schedules' AND a.created_at > NOW() - INTERVAL '3 days' ORDER BY a.created_at DESC LIMIT 20`)).rows;
    console.log('AUDIT (3d):'); for (const a of audit) console.log(a.created_at.toISOString(), a.action, a.by_first, a.record_id, JSON.stringify(a.new_data).slice(0, 300));
  } catch (e) { console.error(e); } finally { await db.pool.end(); }
})();
