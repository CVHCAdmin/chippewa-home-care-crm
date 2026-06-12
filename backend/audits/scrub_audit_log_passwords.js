// One-time scrub: redact plaintext passwords/tokens/SSNs already stored in
// audit_logs old_data/new_data (login bodies were logged unredacted before
// the auditLogger redaction fix). Idempotent — re-running finds nothing new.

require('dotenv').config();
const db = require('../src/db');

const redact = (value) => {
  if (Array.isArray(value)) return value.map(redact);
  if (value && typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      const key = k.toLowerCase();
      const isSecret =
        key.includes('password') || key.includes('secret') ||
        key === 'ssn' || key === 'token' || key.includes('signature');
      out[k] = isSecret && v != null ? '[REDACTED]' : redact(v);
    }
    return out;
  }
  return value;
};

const hasSecret = (value) => {
  if (Array.isArray(value)) return value.some(hasSecret);
  if (value && typeof value === 'object') {
    return Object.entries(value).some(([k, v]) => {
      const key = k.toLowerCase();
      const isSecret =
        key.includes('password') || key.includes('secret') ||
        key === 'ssn' || key === 'token' || key.includes('signature');
      return (isSecret && v != null && v !== '[REDACTED]') || hasSecret(v);
    });
  }
  return false;
};

(async () => {
  try {
    const { rows } = await db.query(`
      SELECT id, old_data, new_data FROM audit_logs
      WHERE old_data::text ~* '(password|ssn|token|secret|signature)'
         OR new_data::text ~* '(password|ssn|token|secret|signature)'
    `);
    console.log(`Candidate rows: ${rows.length}`);

    let scrubbed = 0;
    for (const r of rows) {
      const needsOld = hasSecret(r.old_data);
      const needsNew = hasSecret(r.new_data);
      if (!needsOld && !needsNew) continue;

      await db.query(
        `UPDATE audit_logs SET old_data = $1, new_data = $2 WHERE id = $3`,
        [
          needsOld ? JSON.stringify(redact(r.old_data)) : r.old_data,
          needsNew ? JSON.stringify(redact(r.new_data)) : r.new_data,
          r.id,
        ]
      );
      scrubbed++;
    }
    console.log(`✓ Scrubbed ${scrubbed} audit_logs row(s)`);

    const check = await db.query(`
      SELECT COUNT(*) AS still FROM audit_logs
      WHERE new_data->>'password' IS NOT NULL AND new_data->>'password' != '[REDACTED]'
    `);
    console.log(`Rows still holding a raw password value: ${check.rows[0].still}`);
  } catch (e) {
    console.error('FAILED:', e.message);
    process.exitCode = 1;
  } finally {
    await db.pool.end();
  }
})();
