// READ-ONLY: full detail of the rows Alexis created/deleted for the Nicole/Maggie weekend split
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const db = require('../src/db');
(async () => {
  try {
    const ids = ['37b82668-e509-4e81-9b85-804a309795b6','8e2c5080-275f-4e5b-b6cf-fe77d24e888b','b18066ed-e60d-47c2-9944-8c1f8c03e3f2','09215177-f74a-46f9-8ef7-8206241fde15','a0704d84-f16b-485f-9f47-12008150ba1f','a790913a-151d-4f35-a2b4-bfbd82daa679','65ca3ea4-593d-4da5-8035-89f0050e0959','1dbf7c7c-360e-4ec8-add1-312fda09ee0a','713d741e-2cb5-4fb9-882c-89d6b8864798','88f09edf-4bd3-4dab-b47b-34bb18326741'];
    const rows = (await db.query(`SELECT s.id, s.schedule_type, s.frequency, s.day_of_week, s.date::text AS date, s.start_time, s.end_time, s.effective_date::text AS eff, s.anchor_date::text AS anchor, s.end_date::text AS end_date, s.is_active, s.created_at, s.updated_at, u.first_name||' '||u.last_name AS cg, c.first_name||' '||c.last_name AS cl FROM schedules s JOIN users u ON u.id=s.caregiver_id JOIN clients c ON c.id=s.client_id WHERE s.id = ANY($1) ORDER BY s.created_at`, [ids])).rows;
    for (const r of rows) console.log(JSON.stringify(r));
    console.log('--- audit entries (all) for those ids, last 3 days ---');
    const audit = (await db.query(`SELECT a.created_at, a.action, a.record_id, a.old_data, a.new_data FROM audit_logs a WHERE a.record_id = ANY($1) AND a.created_at > NOW() - INTERVAL '3 days' ORDER BY a.created_at`, [ids])).rows;
    for (const a of audit) console.log(a.created_at.toISOString(), a.action, a.record_id.slice(0,8), 'OLD=', JSON.stringify(a.old_data), 'NEW=', JSON.stringify(a.new_data));
    console.log('--- exceptions on those ids ---');
    const ex = (await db.query(`SELECT schedule_id, exception_date::text AS d, exception_type, override_caregiver_id, override_start_time, override_end_time FROM schedule_exceptions WHERE schedule_id = ANY($1) ORDER BY exception_date`, [ids])).rows;
    console.log(ex);
    console.log('--- CREATE audit entries last 3 days (any) ---');
    const cr = (await db.query(`SELECT a.created_at, a.action, a.table_name, a.record_id, a.new_data FROM audit_logs a WHERE a.table_name='schedules' AND a.action NOT IN ('DELETE','UPDATE','CANCEL_OCCURRENCE') AND a.created_at > NOW() - INTERVAL '3 days' ORDER BY a.created_at`)).rows;
    for (const a of cr) console.log(a.created_at.toISOString(), a.action, a.record_id, JSON.stringify(a.new_data).slice(0,200));
    console.log('--- anchor_date column type ---');
    console.log((await db.query(`SELECT column_name, data_type FROM information_schema.columns WHERE table_name='schedules' AND column_name IN ('anchor_date','effective_date','end_date','date')`)).rows);
    console.log('--- all active biweekly rows in prod ---');
    const bw = (await db.query(`SELECT s.id, s.day_of_week, s.start_time, s.end_time, s.effective_date::text AS eff, s.anchor_date::text AS anchor, s.end_date::text AS end_date, to_char(s.anchor_date,'Dy') AS anchor_dow, u.first_name||' '||u.last_name AS cg, c.first_name||' '||c.last_name AS cl FROM schedules s JOIN users u ON u.id=s.caregiver_id JOIN clients c ON c.id=s.client_id WHERE s.is_active AND s.frequency='biweekly' AND (s.end_date IS NULL OR s.end_date >= CURRENT_DATE) ORDER BY c.last_name`)).rows;
    console.table(bw);
  } catch (e) { console.error(e); } finally { await db.pool.end(); }
})();
