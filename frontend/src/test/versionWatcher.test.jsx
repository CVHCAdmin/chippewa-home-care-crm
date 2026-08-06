// VersionWatcher auto-reload — the installed PWA has no reload button of its own,
// so this component is what gets caregivers off a stale bundle. It reloads on its
// own, which makes two failure modes expensive: reloading during a shift, and
// reload loops when a reload doesn't land on the advertised build.
import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import React from 'react';

const reload = vi.fn();

// Auto-reload only fires in the installed (standalone) app. Default the suite to
// that context; the browser-tab case is asserted explicitly below.
const setDisplayMode = (standalone) => {
  window.matchMedia = (q) => ({
    matches: standalone && String(q).includes('standalone'),
    media: String(q), addListener() {}, removeListener() {},
    addEventListener() {}, removeEventListener() {}, dispatchEvent() { return false; },
  });
};

beforeEach(() => {
  vi.resetModules();
  reload.mockClear();
  sessionStorage.clear();
  vi.stubGlobal('__BUILD_ID__', 'OLD_BUILD');
  setDisplayMode(true);
  // jsdom's location is read-only; replace it wholesale so reload is observable.
  delete window.location;
  window.location = { reload, href: 'http://localhost/' };
});

afterEach(() => { vi.unstubAllGlobals(); });

const serveBuild = (build) => {
  global.fetch = vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve({ build }) }));
};

const mount = async () => {
  const { default: VersionWatcher } = await import('../components/VersionWatcher.jsx');
  return render(<VersionWatcher />);
};

describe('VersionWatcher', () => {
  test('reloads automatically when a newer build is deployed and nothing is in flight', async () => {
    serveBuild('NEW_BUILD');
    await mount();
    await waitFor(() => expect(reload).toHaveBeenCalledTimes(1));
  });

  test('does NOT reload when the build is unchanged', async () => {
    serveBuild('OLD_BUILD');
    await mount();
    await new Promise((r) => setTimeout(r, 50));
    expect(reload).not.toHaveBeenCalled();
  });

  test('does NOT reload in a normal browser tab — that would yank an admin out of their work', async () => {
    setDisplayMode(false);
    serveBuild('NEW_BUILD');
    const { findByText } = await mount();
    expect(await findByText(/new version is available/i)).toBeInTheDocument();
    expect(reload).not.toHaveBeenCalled();
  });

  test('does NOT reload mid-shift — shows the manual banner instead', async () => {
    const { setShiftBusy } = await import('../shiftGuard.js');
    setShiftBusy(true);
    serveBuild('NEW_BUILD');
    const { findByText } = await mount();
    expect(await findByText(/new version is available/i)).toBeInTheDocument();
    expect(reload).not.toHaveBeenCalled();
    setShiftBusy(false);
  });

  test('never reload-loops: a second mount on the same stale build falls back to the banner', async () => {
    serveBuild('NEW_BUILD');
    await mount();
    await waitFor(() => expect(reload).toHaveBeenCalledTimes(1));

    // Simulate the reload landing on the SAME old build (bad deploy / stale edge).
    reload.mockClear();
    vi.resetModules();
    const { findByText } = await mount();
    expect(await findByText(/new version is available/i)).toBeInTheDocument();
    expect(reload).not.toHaveBeenCalled();
  });

  test('checks again when the app is resumed, not just on the 5-minute poll', async () => {
    serveBuild('OLD_BUILD');
    await mount();
    await new Promise((r) => setTimeout(r, 20));
    expect(reload).not.toHaveBeenCalled();

    // A deploy happens while the PWA sits backgrounded, then she taps the icon.
    serveBuild('NEW_BUILD');
    document.dispatchEvent(new Event('visibilitychange'));
    await waitFor(() => expect(reload).toHaveBeenCalledTimes(1));
  });
});
