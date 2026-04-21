// src/jobs/worcsPoll.js
// Scheduled poll against Wisconsin DOJ WORCS for background checks we've
// submitted. WORCS name-based checks typically return same-day; we poll
// every 30 minutes so results land in the CRM without admin intervention.
//
// When a result comes back, we persist it to background_checks, run the
// eligibility engine against it, and email the admin with the decision.
//
// Started from server.js via `startCron()` like scheduledBackup does.

const cron = require('node-cron');
const db = require('../db');
const { getCheckResults } = require('../services/worcsService');
const { evaluateWorcsResult } = require('../services/eligibilityEngine');
const { sendAdminBgcResult } = require('../services/emailService');

// One poll cycle. Exported so it can be triggered manually via an admin
// "Check now" button or a failsafe endpoint.
async function runPollCycle() {
  let pollingResults = { polled: 0, completed: 0, errors: 0 };

  try {
    const { rows: pending } = await db.query(`
      SELECT bc.id, bc.caregiver_id, bc.reference_number, bc.status,
             u.first_name, u.last_name, u.email
        FROM background_checks bc
        JOIN users u ON u.id = bc.caregiver_id
       WHERE bc.check_type = 'worcs'
         AND bc.status IN ('pending', 'in_progress')
         AND bc.reference_number IS NOT NULL
       ORDER BY bc.created_at ASC
       LIMIT 100
    `);

    for (const row of pending) {
      pollingResults.polled++;
      try {
        const result = await getCheckResults(row.reference_number);

        // Still pending? Just bump updated_at and move on.
        if (result.status === 'pending') {
          await db.query(
            `UPDATE background_checks SET status = 'in_progress', updated_at = NOW() WHERE id = $1`,
            [row.id]
          );
          continue;
        }

        // Completed — persist + evaluate
        const bcStatus = result.status === 'completed' ? 'completed' : 'error';
        const bcResult = result.result === 'cleared'      ? 'clear'
                       : result.result === 'record_found' ? 'record_found'
                       : result.result === 'error'        ? 'error'
                       : null;
        const findings = result.rawResult || (result.hasRecord ? 'Record returned by WORCS. See raw WORCS report for details.' : null);

        await db.query(`
          UPDATE background_checks SET
            status = $1,
            result = $2,
            completed_date = COALESCE(completed_date, CURRENT_DATE),
            findings = COALESCE(findings, $3),
            updated_at = NOW()
          WHERE id = $4
        `, [bcStatus, bcResult, findings, row.id]);

        pollingResults.completed++;

        // Run eligibility analysis and email admin
        const evalResult = await evaluateWorcsResult({
          hasRecord: result.hasRecord,
          result: result.result,
          findings,
          rawResult: result.rawResult,
        });

        const adminEmail = process.env.ADMIN_EMAIL || process.env.AGENCY_ADMIN_EMAIL;
        if (adminEmail) {
          sendAdminBgcResult({
            to: adminEmail,
            caregiverName: `${row.first_name} ${row.last_name}`,
            status: evalResult.status,
            summary: evalResult.summary,
            matches: evalResult.matches,
          }).catch(err => console.error('[worcsPoll] admin email error:', err.message));
        }

        console.log(`[worcsPoll] ${row.first_name} ${row.last_name} → ${evalResult.status} (${evalResult.matches.length} matches)`);
      } catch (err) {
        pollingResults.errors++;
        console.error(`[worcsPoll] poll failed for bg ${row.id}:`, err.message);
        // Mark as error only after multiple retries would be ideal; for now
        // we leave it 'pending' so the next cycle tries again.
      }
    }

    if (pending.length > 0) {
      console.log(`[worcsPoll] cycle done: polled=${pollingResults.polled} completed=${pollingResults.completed} errors=${pollingResults.errors}`);
    }
  } catch (err) {
    console.error('[worcsPoll] cycle error:', err.message);
  }

  return pollingResults;
}

// Start cron — every 30 minutes at :07 and :37
function startCron() {
  if (process.env.WORCS_POLL_DISABLED === 'true') {
    console.log('[worcsPoll] cron disabled via WORCS_POLL_DISABLED');
    return;
  }
  cron.schedule('7,37 * * * *', () => {
    runPollCycle().catch(err => console.error('[worcsPoll] cron error:', err.message));
  });
  console.log('[worcsPoll] scheduled — polling WORCS every 30 minutes');
}

module.exports = { startCron, runPollCycle };
