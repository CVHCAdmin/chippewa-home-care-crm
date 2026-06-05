// Real-browser verification via Playwright.
// Clicks the actual sidebar links to switch SPA routes (page.goto won't
// trigger hash routing because the URL only differs by hash). For each
// page touched this session, asserts key elements rendered + collects
// console errors + screenshots.

const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const FRONTEND = 'https://app.chippewavalleyhomecare.com';
const TOKEN = fs.readFileSync(path.join(__dirname, '.admin_token'), 'utf8').trim();
const SHOTS = path.join(__dirname, 'screenshots');
fs.mkdirSync(SHOTS, { recursive: true });

let pass = 0, fail = 0, warn = 0;
const consoleErrors = [];
const netErrors = [];
const findings = [];

const log = (sym, msg) => {
  console.log(`  ${sym} ${msg}`);
  if (sym === '✓') pass++;
  else if (sym === '✗') { fail++; findings.push(msg); }
  else if (sym === '⚠') { warn++; findings.push('WARN: ' + msg); }
};

(async () => {
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();

  page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });
  page.on('pageerror', (e) => consoleErrors.push('PAGE: ' + e.message));
  page.on('response', (r) => {
    const u = r.url();
    const status = r.status();
    if (status >= 500) netErrors.push(`${status} ${r.request().method()} ${u}`);
    // Track failed API calls separately — cosmetic font/cdn-cgi failures
    // are filtered out elsewhere.
  });
  page.on('requestfailed', (r) => {
    const u = r.url();
    if (/cdn-cgi|gstatic|fonts/.test(u)) return;
    netErrors.push(`failed ${r.method()} ${u} — ${r.failure()?.errorText}`);
  });

  await page.goto(FRONTEND + '/', { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.evaluate((tk) => {
    localStorage.setItem('token', tk);
    localStorage.setItem('user', JSON.stringify({
      id: 'browser-verifier', role: 'admin', name: 'Verifier Bot',
      first_name: 'Verifier', last_name: 'Bot',
    }));
  }, TOKEN);
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(2000);

  // Click a sidebar link by visible text — exact match on the anchor text
  const clickNav = async (linkText) => {
    const start = consoleErrors.length;
    const beforeNet = netErrors.length;
    // Sidebar items render as anchors with class .sidebar-nav a, but we'll
    // be more lenient and just match by text in the sidebar region
    try {
      await page.locator(`.sidebar a:has-text("${linkText}"), .sidebar-nav a:has-text("${linkText}")`).first().click({ timeout: 8000 });
      await page.waitForTimeout(2500);  // SPA hydration + initial fetch
      return { ok: true, newErrors: consoleErrors.length - start, newNet: netErrors.length - beforeNet };
    } catch (e) {
      // Fallback: try to navigate by hash directly + reload
      try {
        const slug = linkText.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
        await page.evaluate((s) => { window.location.hash = '#' + s; }, slug);
        await page.waitForTimeout(2500);
        return { ok: true, newErrors: consoleErrors.length - start, newNet: netErrors.length - beforeNet, viaHash: true };
      } catch (e2) {
        return { ok: false, error: e.message };
      }
    }
  };

  const check = async (name, navLabel, expectedTexts = []) => {
    console.log(`\n── ${name} ──`);
    const nav = await clickNav(navLabel);
    if (!nav.ok) {
      log('✗', `couldn't click sidebar "${navLabel}" — ${nav.error}`);
      return;
    }
    log('✓', `nav clicked: ${navLabel}${nav.viaHash ? ' (via hash fallback)' : ''}`);
    for (const text of expectedTexts) {
      const found = (await page.getByText(text, { exact: false }).first().isVisible({ timeout: 4000 }).catch(() => false));
      log(found ? '✓' : '⚠', `  text visible: "${text}"`);
    }
    if (nav.newErrors > 0) {
      const sample = consoleErrors.slice(-nav.newErrors)[0].slice(0, 180);
      log('⚠', `  ${nav.newErrors} new console error(s); first: ${sample}`);
    }
    if (nav.newNet > 0) {
      const sample = netErrors.slice(-nav.newNet)[0].slice(0, 200);
      log('⚠', `  ${nav.newNet} new net error(s); first: ${sample}`);
    }
    const shot = path.join(SHOTS, name.replace(/[^a-zA-Z0-9]+/g, '_').toLowerCase() + '.png');
    await page.screenshot({ path: shot, fullPage: false });
  };

  // Confirm we're logged in / dashboard rendered
  console.log('\n── Login bypass + dashboard ──');
  const dashVisible = await page.getByText('Dashboard', { exact: false }).first().isVisible({ timeout: 5000 }).catch(() => false);
  log(dashVisible ? '✓' : '✗', 'dashboard rendered after token-injection');
  log(await page.getByText('Quick Access', { exact: false }).first().isVisible({ timeout: 2000 }).catch(() => false) ? '✓' : '⚠', '  Quick Access sidebar section');
  log(await page.getByText('Action Items', { exact: false }).first().isVisible({ timeout: 2000 }).catch(() => false) ? '✓' : '⚠', '  Action Items widget');
  log(await page.getByText('(collected)', { exact: false }).first().isVisible({ timeout: 2000 }).catch(() => false) ? '✓' : '⚠', '  This Month Revenue "(collected)" subtitle');
  await page.screenshot({ path: path.join(SHOTS, 'dashboard.png') });

  await check('Schedule Hub',         'Schedule Hub',     ['Schedule']);
  await check('Caregivers',           'Caregivers',       ['Last Active']);
  await check('Care Plans',           'Care Plans',       ['Use Template']);
  await check('Open Shifts (admin)',  'Open Shifts',      ['Open']);
  await check('Shift Approvals',      'Shift Approvals',  []);
  await check('Documents',            'Documents',        ['Documents']);
  await check('Reports & Analytics',  'Reports',          ['Hours by Payer', 'Client Incidents']);
  await check('Audit Logs',           'Audit Logs',       ['Last 7d']);
  await check('Notifications',        'Notifications',    ['My Delivery Preferences']);
  await check('Billing / Invoices',   'Invoices',         []);
  await check('Payroll',              'Payroll',          []);

  // Real API errors (5xx from our own backend) vs cosmetic ones
  const apiErrors = netErrors.filter(e =>
    e.includes('chippewa-home-care-api') ||
    (e.includes('app.chippewavalleyhomecare') && !/cdn-cgi|gstatic|fonts/.test(e))
  );

  console.log('\n──────────────────────────────');
  console.log(`Results: ${pass} pass · ${warn} warn · ${fail} fail`);
  console.log(`Console errors: ${consoleErrors.length}, API/own-server errors: ${apiErrors.length}`);
  if (consoleErrors.length > 0) {
    console.log('\nFirst 8 console errors:');
    consoleErrors.slice(0, 8).forEach(e => console.log('  · ' + e.slice(0, 240)));
  }
  if (apiErrors.length > 0) {
    console.log('\nAPI errors:');
    apiErrors.slice(0, 10).forEach(e => console.log('  · ' + e.slice(0, 240)));
  }
  console.log(`\nScreenshots: ${SHOTS}`);

  await browser.close();
  process.exit(fail > 0 ? 1 : 0);
})();
