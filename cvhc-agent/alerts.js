// cvhc-agent/alerts.js
// Alert Alexis (the owner) only when something actually needs human attention.
// Uses the existing notifications table + optional email/SMS.

const db = require('../backend/src/db');
const { v4: uuidv4 } = require('uuid');
const config = require('./config');
const { sendEmail } = require('../backend/src/services/emailService');

/**
 * Send an alert that requires human attention.
 * Creates a notification in the DB and optionally sends email/SMS.
 * @param {string} title - Short alert title
 * @param {string} message - Detailed message
 * @param {string} type - Alert type: 'escalation' | 'timely_filing' | 'auth_exhausted' | 'budget_low' | 'agent_error'
 * @param {Object} [metadata] - Extra context
 */
async function alertOwner(title, message, type = 'escalation', metadata = {}) {
  // Find admin users to notify
  const admins = await db.query(`
    SELECT id, email, first_name FROM users
    WHERE role = 'admin' AND is_active = true
  `);

  for (const admin of admins.rows) {
    await db.query(`
      INSERT INTO notifications (id, user_id, type, title, message, is_read, created_at)
      VALUES ($1, $2, $3, $4, $5, false, NOW())
    `, [uuidv4(), admin.id, `agent_${type}`, title, message]);
  }

  // Send email via shared SES service if recipient is configured.
  // The backend emailService no-ops cleanly when AWS creds aren't present,
  // so this is safe even if the agent runs in an environment that hasn't
  // been wired with the SES env vars yet.
  if (config.alerts.ownerEmail) {
    try {
      await sendEmail({
        to: config.alerts.ownerEmail,
        subject: `[CVHC Agent] ${title}`,
        html: `<h3>${title}</h3><p>${message.replace(/\n/g, '<br>')}</p>`,
      });
    } catch (err) {
      console.error('  Alert email failed:', err.message);
    }
  }

  console.log(`  ALERT [${type}]: ${title}`);
}

/**
 * Send a summary of an agent run (only if there were issues).
 * @param {Object} stats - Run statistics
 */
async function sendRunSummary(stats) {
  const issues = [];

  if (stats.escalated > 0) {
    issues.push(`${stats.escalated} claim(s) escalated — need your review`);
  }
  if (stats.timelyFilingWarnings > 0) {
    issues.push(`${stats.timelyFilingWarnings} claim(s) approaching timely filing deadline`);
  }
  if (stats.authWarnings > 0) {
    issues.push(`${stats.authWarnings} authorization(s) running low`);
  }
  if (stats.errors.length > 0) {
    issues.push(`${stats.errors.length} error(s) during processing`);
  }

  // Only alert if there are actual issues
  if (issues.length === 0) return;

  const message = [
    `Claims Agent Run Summary (${stats.mode})`,
    `────────────────────────���──────`,
    `Visits scanned: ${stats.totalVisits}`,
    `Claims created: ${stats.created}`,
    `Claims submitted: ${stats.submitted}`,
    `Claims paid: ${stats.paid}`,
    `Claims auto-corrected: ${stats.autoCorrected}`,
    `Claims escalated: ${stats.escalated}`,
    ``,
    `Issues requiring attention:`,
    ...issues.map(i => `  - ${i}`),
  ].join('\n');

  await alertOwner('Claims Agent Run Complete — Action Needed', message, 'run_summary');
}

module.exports = { alertOwner, sendRunSummary };
