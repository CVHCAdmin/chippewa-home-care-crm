// services/sandataBrowserFallback.js
// Playwright-based browser automation fallback for Sandata EVV submission.
// Used when the API path is unavailable (no evv_worker_id or API credentials).
//
// IMPORTANT: Handles the known Sandata UI bug where the first-of-month date
// is always pre-checked in the date selector. Must uncheck it BEFORE entering
// actual visit data, every single time.

const db = require('../db');

/**
 * Submit a single EVV visit through Sandata's web portal via Playwright.
 * @param {Object} item - Queue item with visit + client + caregiver data
 * @returns {{ success: boolean, error?: string }}
 */
async function submitVisitViaBrowser(item) {
  let browser = null;

  try {
    // Lazy-load Playwright to avoid requiring it in environments where it's not needed
    const { chromium } = require('playwright');

    const portalUrl = process.env.SANDATA_PORTAL_URL || 'https://portal.sandata.com';
    const username = process.env.SANDATA_USERNAME;
    const password = process.env.SANDATA_PASSWORD;

    if (!username || !password) {
      return { success: false, error: 'Sandata portal credentials not configured (SANDATA_USERNAME, SANDATA_PASSWORD)' };
    }

    browser = await chromium.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
    });

    const context = await browser.newContext({
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      viewport: { width: 1280, height: 720 },
    });

    const page = await context.newPage();
    page.setDefaultTimeout(30000);

    // ── Step 1: Log into Sandata portal ─────────────────────────────────────

    console.log('  [Browser] Navigating to Sandata portal...');
    await page.goto(`${portalUrl}/login`, { waitUntil: 'networkidle' });

    // Fill login form
    await page.fill('input[name="username"], input[id="username"], #loginUsername', username);
    await page.fill('input[name="password"], input[id="password"], #loginPassword', password);
    await page.click('button[type="submit"], input[type="submit"], #loginButton');

    // Wait for navigation after login
    await page.waitForNavigation({ waitUntil: 'networkidle', timeout: 15000 }).catch(() => {});

    // Verify login succeeded (check for common error indicators)
    const loginError = await page.$('.error-message, .login-error, .alert-danger');
    if (loginError) {
      const errorText = await loginError.textContent();
      return { success: false, error: `Portal login failed: ${errorText.trim()}` };
    }

    console.log('  [Browser] Logged in. Navigating to visit entry...');

    // ── Step 2: Navigate to EVV visit entry form ────────────────────────────

    // Navigate to visit entry page
    await page.goto(`${portalUrl}/visits/entry`, { waitUntil: 'networkidle' }).catch(async () => {
      // Try alternate URLs if the first one fails
      await page.goto(`${portalUrl}/evv/visit-entry`, { waitUntil: 'networkidle' }).catch(async () => {
        // Last resort: look for a link in the navigation
        const visitLink = await page.$('a[href*="visit"], a[href*="entry"], a:has-text("Visit Entry")');
        if (visitLink) {
          await visitLink.click();
          await page.waitForLoadState('networkidle');
        }
      });
    });

    // ── Step 3: CRITICAL — Uncheck first-of-month date bug ──────────────────
    // Sandata's portal has a known UI bug: when the visit entry form opens,
    // the first day of the current month is always pre-checked in the date
    // selector, even when it's not a worked date. We MUST uncheck this before
    // entering real data, otherwise it submits an extra phantom day.

    console.log('  [Browser] Checking for first-of-month date bug...');

    // Get the first day of the current month
    const now = new Date();
    const firstOfMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
    const firstOfMonthShort = `${now.getMonth() + 1}/1/${now.getFullYear()}`;
    const firstOfMonthPadded = `${String(now.getMonth() + 1).padStart(2, '0')}/01/${now.getFullYear()}`;

    // Look for pre-checked date checkboxes or calendar selections
    // Try multiple selector patterns since the exact UI may vary
    const dateSelectors = [
      // Checkbox-style date selector
      `input[type="checkbox"][value="${firstOfMonth}"]:checked`,
      `input[type="checkbox"][value="${firstOfMonthShort}"]:checked`,
      `input[type="checkbox"][value="${firstOfMonthPadded}"]:checked`,
      `input[type="checkbox"][data-date="${firstOfMonth}"]:checked`,
      // Calendar-style date selector
      `.date-selected[data-date="${firstOfMonth}"]`,
      `.calendar-day.selected[data-day="1"]`,
      `td.selected[data-day="1"]`,
      `.day-cell.active:first-child`,
      // Generic first-of-month patterns
      `[data-date="${firstOfMonth}"].selected`,
      `[data-date="${firstOfMonth}"].checked`,
    ];

    for (const selector of dateSelectors) {
      const preChecked = await page.$(selector);
      if (preChecked) {
        console.log(`  [Browser] FOUND pre-checked first-of-month date — unchecking...`);
        await preChecked.click();
        // Verify it's unchecked
        await page.waitForTimeout(500);
        const stillChecked = await page.$(selector);
        if (stillChecked) {
          // Try harder — use JavaScript to uncheck
          await page.evaluate((sel) => {
            const el = document.querySelector(sel);
            if (el && el.checked !== undefined) el.checked = false;
            if (el && el.classList) el.classList.remove('selected', 'checked', 'active');
            el?.dispatchEvent(new Event('change', { bubbles: true }));
          }, selector);
        }
        console.log('  [Browser] First-of-month date unchecked.');
        break;
      }
    }

    // Also try a more general approach: look for any checked date that isn't the service date
    const serviceDate = item.service_date;
    const allCheckedDates = await page.$$('input[type="checkbox"]:checked[name*="date"], .calendar-day.selected');
    for (const el of allCheckedDates) {
      const val = await el.getAttribute('value') || await el.getAttribute('data-date') || '';
      if (val && !val.includes(serviceDate)) {
        console.log(`  [Browser] Unchecking unexpected pre-selected date: ${val}`);
        await el.click();
        await page.waitForTimeout(300);
      }
    }

    // ── Step 4: Enter actual visit data ─────────────────────────────────────

    console.log(`  [Browser] Entering visit data for ${item.service_date}...`);

    // Select/enter the actual visit date
    const dateInput = await page.$('input[name="serviceDate"], input[name="visitDate"], input[type="date"], #serviceDate');
    if (dateInput) {
      await dateInput.fill('');
      await dateInput.fill(serviceDate);
    } else {
      // Calendar-style: click the correct date
      const serviceDay = new Date(serviceDate).getDate();
      const dayCell = await page.$(`td[data-day="${serviceDay}"], .calendar-day[data-day="${serviceDay}"], [data-date="${serviceDate}"]`);
      if (dayCell) await dayCell.click();
    }

    // Enter start time
    const startTime = new Date(item.actual_start);
    const startTimeStr = `${String(startTime.getHours()).padStart(2, '0')}:${String(startTime.getMinutes()).padStart(2, '0')}`;
    const startInput = await page.$('input[name="startTime"], input[name="actualStartTime"], #startTime');
    if (startInput) {
      await startInput.fill('');
      await startInput.fill(startTimeStr);
    }

    // Enter end time
    const endTime = item.actual_end ? new Date(item.actual_end) : null;
    if (endTime) {
      const endTimeStr = `${String(endTime.getHours()).padStart(2, '0')}:${String(endTime.getMinutes()).padStart(2, '0')}`;
      const endInput = await page.$('input[name="endTime"], input[name="actualEndTime"], #endTime');
      if (endInput) {
        await endInput.fill('');
        await endInput.fill(endTimeStr);
      }
    }

    // Enter caregiver identifier
    const caregiverId = item.evv_worker_id || item.npi_number || '';
    const cgInput = await page.$('input[name="employeeId"], input[name="caregiverId"], input[name="workerId"], #employeeId');
    if (cgInput && caregiverId) {
      await cgInput.fill('');
      await cgInput.fill(caregiverId);
    }

    // Enter client identifier
    const clientId = item.evv_client_id || item.medicaid_id || '';
    const clInput = await page.$('input[name="clientId"], input[name="memberId"], input[name="participantId"], #clientId');
    if (clInput && clientId) {
      await clInput.fill('');
      await clInput.fill(clientId);
    }

    // Enter service code if there's a field for it
    const svcInput = await page.$('input[name="serviceCode"], select[name="serviceCode"], #serviceCode');
    if (svcInput) {
      const tagName = await svcInput.evaluate(el => el.tagName.toLowerCase());
      if (tagName === 'select') {
        await svcInput.selectOption({ value: item.service_code || 'T1019' });
      } else {
        await svcInput.fill(item.service_code || 'T1019');
      }
    }

    // ── Step 5: Submit the form ─────────────────────────────────────────────

    console.log('  [Browser] Submitting visit...');

    const submitBtn = await page.$('button[type="submit"], input[type="submit"], button:has-text("Submit"), button:has-text("Save")');
    if (submitBtn) {
      await submitBtn.click();
    } else {
      return { success: false, error: 'Could not find submit button on visit entry form' };
    }

    // Wait for response
    await page.waitForNavigation({ waitUntil: 'networkidle', timeout: 30000 }).catch(() => {});
    await page.waitForTimeout(2000);

    // ── Step 6: Capture confirmation number ─────────────────────────────────

    // Look for confirmation/visit ID in the response page
    const confirmationSelectors = [
      '.confirmation-number', '.visit-id', '#confirmationNumber',
      '.success-message', '.alert-success',
      'span:has-text("Visit ID")', 'span:has-text("Confirmation")',
    ];

    let confirmationNumber = null;
    for (const sel of confirmationSelectors) {
      const el = await page.$(sel);
      if (el) {
        const text = await el.textContent();
        // Extract number from text like "Visit ID: 12345" or "Confirmation: ABC-123"
        const match = text.match(/(?:ID|Number|#|Confirmation)[:\s]*([A-Za-z0-9-]+)/i);
        confirmationNumber = match ? match[1].trim() : text.trim();
        break;
      }
    }

    // Also check for error messages
    const errorEl = await page.$('.error-message, .alert-danger, .validation-error');
    if (errorEl) {
      const errorText = await errorEl.textContent();
      return { success: false, error: `Form submission error: ${errorText.trim()}` };
    }

    if (!confirmationNumber) {
      // Try to extract from URL (some portals redirect to /visits/{id})
      const url = page.url();
      const urlMatch = url.match(/visits?\/([A-Za-z0-9-]+)/);
      if (urlMatch) confirmationNumber = urlMatch[1];
    }

    if (!confirmationNumber) {
      return { success: false, error: 'Form submitted but no confirmation number found in response' };
    }

    // ── Step 7: Store confirmation number on EVV visit ──────────────────────

    await db.query(`
      UPDATE evv_visits SET
        sandata_status = 'submitted',
        sandata_visit_id = $2,
        sandata_submitted_at = NOW(),
        sandata_response = $3,
        updated_at = NOW()
      WHERE id = $1
    `, [item.evv_visit_id, confirmationNumber, JSON.stringify({ method: 'browser', confirmationNumber })]);

    console.log(`  [Browser] Visit submitted. Confirmation: ${confirmationNumber}`);
    return { success: true };

  } catch (err) {
    return { success: false, error: `Browser automation error: ${err.message}` };
  } finally {
    if (browser) {
      await browser.close().catch(() => {});
    }
  }
}

module.exports = { submitVisitViaBrowser };
