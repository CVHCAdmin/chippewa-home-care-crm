import React, { useState, useEffect } from 'react';

// Detects when a newer build has been deployed and offers a reload. The app is a
// long-lived SPA (caregivers/admins keep it open all day), so without this they
// can run stale code for hours after a deploy. Polls /version.json (emitted at
// build time) and compares to the build baked into this bundle. Reload is MANUAL
// — never auto-reload, so it can't interrupt someone mid clock-in.
const CURRENT_BUILD = typeof __BUILD_ID__ !== 'undefined' ? __BUILD_ID__ : null;

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
        if (!cancelled && d && d.build && String(d.build) !== String(CURRENT_BUILD)) {
          setStale(true);
        }
      } catch (_) { /* offline — ignore */ }
    };
    check();
    const id = setInterval(check, 5 * 60 * 1000); // every 5 min
    return () => { cancelled = true; clearInterval(id); };
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
