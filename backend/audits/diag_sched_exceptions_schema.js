// READ-ONLY. Verifies the live schema the new scope-aware edit endpoint depends on.
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const db = require('../src/db');

(async () => {
  const cols = await db.query(
    `SELECT column_name, data_type, is_nullable, column_default
     FROM information_schema.columns WHERE table_name='schedule_exceptions' ORDER BY ordinal_position`
  );
  console.log('=== schedule_exceptions columns ===');
  if (!cols.rows.length) console.log('  !!! TABLE DOES NOT EXIST !!!');
  cols.rows.forEach(c => console.log(`  ${c.column_name.padEnd(24)} ${c.data_type.padEnd(28)} null=${c.is_nullable} default=${c.column_default || '-'}`));

  const needed = ['schedule_id', 'exception_date', 'exception_type', 'override_start_time', 'override_end_time', 'override_client_id', 'override_notes', 'created_by'];
  const have = new Set(cols.rows.map(c => c.column_name));
  console.log('\n=== columns the endpoint INSERTs ===');
  needed.forEach(n => console.log(`  ${have.has(n) ? 'OK  ' : 'MISS'} ${n}`));

  console.log('\n=== constraints / indexes on schedule_exceptions ===');
  const idx = await db.query(`SELECT indexname, indexdef FROM pg_indexes WHERE tablename='schedule_exceptions'`);
  idx.rows.forEach(i => console.log(`  ${i.indexname}: ${i.indexdef}`));
  const con = await db.query(
    `SELECT conname, pg_get_constraintdef(oid) def FROM pg_constraint
     WHERE conrelid='schedule_exceptions'::regclass`
  );
  con.rows.forEach(c => console.log(`  ${c.conname}: ${c.def}`));

  console.log('\n=== schedules: columns copied by the scope=following INSERT ===');
  const sc = await db.query(
    `SELECT column_name, is_nullable, column_default FROM information_schema.columns
     WHERE table_name='schedules' ORDER BY ordinal_position`
  );
  sc.rows.forEach(c => console.log(`  ${c.column_name.padEnd(24)} null=${c.is_nullable} default=${c.column_default || '-'}`));

  console.log('\n=== schedules constraints/indexes (v53 unique, v36 trigger) ===');
  const sidx = await db.query(`SELECT indexname, indexdef FROM pg_indexes WHERE tablename='schedules'`);
  sidx.rows.forEach(i => console.log(`  ${i.indexname}: ${i.indexdef}`));
  const trg = await db.query(
    `SELECT tgname, pg_get_triggerdef(oid) def FROM pg_trigger
     WHERE tgrelid='schedules'::regclass AND NOT tgisinternal`
  );
  trg.rows.forEach(t => console.log(`  TRIGGER ${t.tgname}: ${t.def}`));

  process.exit(0);
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
