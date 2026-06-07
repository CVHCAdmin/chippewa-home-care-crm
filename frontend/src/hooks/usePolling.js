// hooks/usePolling.js
// Visibility-aware interval poller.
//
// Calls `callback` once on mount, then on a setInterval(intervalMs) loop.
// When the browser tab is backgrounded (visibilityState === 'hidden'),
// the interval is paused so we don't burn rate-limit budget or battery
// updating data the user can't see. When the tab becomes visible again,
// we fire `callback` once immediately to refresh stale data, then resume
// the interval.
//
// `callback` is held in a ref so it can read the latest state via closure
// (re-renders don't restart the interval).
//
// `intervalMs <= 0` means "fire once and don't poll" — useful for guarding
// pollers behind a feature flag without an if/else around the hook.

import { useEffect, useRef } from 'react';

export function usePolling(callback, intervalMs) {
  const cbRef = useRef(callback);
  useEffect(() => { cbRef.current = callback; }, [callback]);

  useEffect(() => {
    let timer = null;
    const tick = () => { try { cbRef.current?.(); } catch (e) { /* swallow */ } };
    const start = () => {
      if (timer || !(intervalMs > 0)) return;
      timer = setInterval(tick, intervalMs);
    };
    const stop = () => {
      if (timer) { clearInterval(timer); timer = null; }
    };
    const onVisibility = () => {
      if (typeof document === 'undefined') return;
      if (document.visibilityState === 'hidden') {
        stop();
      } else {
        tick();
        start();
      }
    };

    // Initial fire
    tick();
    // Start interval if tab is visible
    if (typeof document === 'undefined' || document.visibilityState !== 'hidden') {
      start();
    }
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', onVisibility);
    }
    return () => {
      stop();
      if (typeof document !== 'undefined') {
        document.removeEventListener('visibilitychange', onVisibility);
      }
    };
  }, [intervalMs]);
}
