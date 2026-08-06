import React, { useState, useEffect } from 'react';
import { isShiftBusy } from '../shiftGuard';

// Detects when a newer build has been deployed and gets the app onto it.
//
// The installed PWA (display: standalone) has no address bar and no reload
// button, and Android resumes a long-lived page instead of re-navigating — so a
// caregiver can sit on a days-old bundle with no way to escape it. That is why
// clock-in worked from the browser but not from the installed app.
//
// So: when a new build is out we reload automatically, but ONLY in the installed
// app AND only when nothing is in flight (no open shift, no punch in progress).
// Anywhere else — a normal browser tab, or mid-shift — we fall back to the manual
// banner, which is the old behaviour. A reload must never interrupt someone mid
// clock-in, and must never yank an admin out of a page they're working in.
const CURRENT_BUILD = typeof __BUILD_ID__ !== 'undefined' ? __BUILD_ID__ : null;

// Remembers the build we already auto-reloaded for. If a reload somehow doesn't
// land us on that build (stale edge, bad deploy) we show the banner instead of
// reloading forever. sessionStorage survives the reload but not a fresh launch.
const RELOADED_FOR = 'vw_autoreloaded_build';

// Auto-reload is ONLY for the installed app, which has no address bar and no
// reload button — that's the trap it exists to get people out of. In a normal
// browser tab a reload would yank an admin out of whatever they were doing
// (it bounced someone out of the Scheduling Hub mid-edit on 2026-08-06), and
// they already have a reload button, so they get the manual banner instead.
const isInstalledApp = () => {
  try {
    return window.matchMedia?.('(display-mode: standalone)')?.matches === true
      || window.navigator?.standalone === true;
  } catch (_) {
    return false;
  }
};

export default function VersionWatcher() {
  const [stale, setStale] = useState(false);

  useEffect(() => {
    if (!CURRENT_BUILD) return;
    let cancelled = false;

    const check = async () => {
      try {
        const r = await fetch(`/version.json?t=${Date.now()}`, { cache: 'no-store' });
        if (!r.ok) return; // dev / not deployed yet
        const d = await r.json();
        if (cancelled || !d || !d.build) return;
        if (String(d.build) === String(CURRENT_BUILD)) return;

        if (!isInstalledApp() || isShiftBusy()) { setStale(true); return; }

        let alreadyTried = false;
        try { alreadyTried = sessionStorage.getItem(RELOADED_FOR) === String(d.build); } catch (_) {}
        if (alreadyTried) { setStale(true); return; }

        try { sessionStorage.setItem(RELOADED_FOR, String(d.build)); } catch (_) {}
        window.location.reload();
      } catch (_) { /* offline — ignore */ }
    };

    check();
    const id = setInterval(check, 5 * 60 * 1000);

    // The moment that actually matters: she taps the icon and the PWA resumes a
    // page that may be days old. Poll-on-interval alone never catches this.
    const onVisible = () => { if (document.visibilityState === 'visible') check(); };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', onVisible);

    return () => {
      cancelled = true;
      clearInterval(id);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', onVisible);
    };
  }, []);

  if (!stale) return null;

  return (
    <div style={{
      position: 'fixed', bottom: 16, left: '50%', transform: 'translateX(-50%)',
      zIndex: 3000, background: '#1F2937', color: '#fff', borderRadius: 10,
      padding: '0.6rem 1rem', display: 'flex', alignItems: 'center', gap: '0.75rem',
      boxShadow: '0 4px 16px rgba(0,0,0,0.25)', fontSize: '0.88rem', maxWidth: '92vw',
    }}>
      <span>🔄 A new version is available.</span>
      <button
        onClick={() => window.location.reload()}
        style={{ background: '#10B981', color: '#fff', border: 'none', borderRadius: 6, padding: '0.35rem 0.8rem', fontWeight: 700, cursor: 'pointer' }}
      >Reload</button>
    </div>
  );
}
