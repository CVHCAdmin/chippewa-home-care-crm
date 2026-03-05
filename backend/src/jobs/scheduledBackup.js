// src/jobs/scheduledBackup.js
// Automated database backup — exports critical tables to JSON files.
// Keeps last 7 daily backups.
//
// Usage:
//   node src/jobs/scheduledBackup.js --once    (run once and exit)
//   Imported by server.js for daily cron at 2 AM

const fs = require('fs');
const path = require('path');
const db = require('../db');

const BACKUP_DIR = path.join(__dirname, '..', '..', 'backups');
const MAX_BACKUPS = 7;

const CRITICAL_TABLES = [
  'users',
  'clients',
  'care_plans',
  'schedules',
  'time_entries',
  'invoices',
  'payments',
  'payroll',
  'audit_logs',
];

async function runBackup() {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const backupFile = path.join(BACKUP_DIR, `backup_${timestamp}.json`);

  console.log(`[Backup] Starting database backup at ${new Date().toISOString()}`);

  // Ensure backup directory exists
  if (!fs.existsSync(BACKUP_DIR)) {
    fs.mkdirSync(BACKUP_DIR, { recursive: true });
  }

  const backup = { timestamp: new Date().toISOString(), tables: {} };

  for (const table of CRITICAL_TABLES) {
    try {
      const result = await db.query(`SELECT COUNT(*) as count FROM ${table}`);
      const count = parseInt(result.rows[0].count);

      // For large tables (audit_logs), only backup last 30 days
      let rows;
      if (table === 'audit_logs') {
        const r = await db.query(
          `SELECT * FROM ${table} WHERE created_at > NOW() - INTERVAL '30 days' ORDER BY created_at DESC`
        );
        rows = r.rows;
      } else {
        const r = await db.query(`SELECT * FROM ${table} ORDER BY created_at DESC NULLS LAST`);
        rows = r.rows;
      }

      backup.tables[table] = { count: rows.length, totalInDb: count, rows };
      console.log(`[Backup]   ${table}: ${rows.length} rows`);
    } catch (err) {
      console.warn(`[Backup]   ${table}: SKIPPED (${err.message})`);
      backup.tables[table] = { count: 0, error: err.message };
    }
  }

  fs.writeFileSync(backupFile, JSON.stringify(backup, null, 2));
  const sizeMB = (fs.statSync(backupFile).size / (1024 * 1024)).toFixed(2);
  console.log(`[Backup] Saved to ${backupFile} (${sizeMB} MB)`);

  // Prune old backups
  pruneOldBackups();

  return backupFile;
}

function pruneOldBackups() {
  if (!fs.existsSync(BACKUP_DIR)) return;

  const files = fs.readdirSync(BACKUP_DIR)
    .filter(f => f.startsWith('backup_') && f.endsWith('.json'))
    .sort()
    .reverse();

  if (files.length > MAX_BACKUPS) {
    const toDelete = files.slice(MAX_BACKUPS);
    for (const file of toDelete) {
      fs.unlinkSync(path.join(BACKUP_DIR, file));
      console.log(`[Backup] Pruned old backup: ${file}`);
    }
  }
}

function startCron() {
  const cron = require('node-cron');
  // Run daily at 2:00 AM
  cron.schedule('0 2 * * *', async () => {
    try {
      await runBackup();
    } catch (err) {
      console.error('[Backup] Scheduled backup failed:', err.message);
    }
  });
  console.log('[Backup] Scheduled daily backup at 2:00 AM');
}

// CLI: node src/jobs/scheduledBackup.js --once
if (require.main === module) {
  runBackup()
    .then(file => { console.log(`[Backup] Done: ${file}`); process.exit(0); })
    .catch(err => { console.error('[Backup] Failed:', err.message); process.exit(1); });
}

module.exports = { runBackup, startCron };
