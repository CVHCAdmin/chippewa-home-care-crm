// hooks/useNative.js
// Unified native capabilities hook — works on web AND native (iOS/Android via Capacitor)
// All Capacitor APIs fall back gracefully to browser APIs when running in a browser.

import { useState, useEffect, useCallback, useRef } from 'react';
import { Capacitor } from '@capacitor/core';

// ── Lazy plugin loaders (don't crash on web if plugin unavailable) ─────────────
const getGeolocation = () => import('@capacitor/geolocation').then(m => m.Geolocation).catch(() => null);
const getNetwork     = () => import('@capacitor/network').then(m => m.Network).catch(() => null);
const getHaptics     = () => import('@capacitor/haptics').then(m => m.Haptics).catch(() => null);
const getLocalNotif  = () => import('@capacitor/local-notifications').then(m => m.LocalNotifications).catch(() => null);

export const isNative = Capacitor.isNativePlatform();
export const platform = Capacitor.getPlatform(); // 'ios' | 'android' | 'web'

// ── useNetwork ────────────────────────────────────────────────────────────────
// Returns { online, connectionType } and listens for changes
export function useNetwork() {
  const [status, setStatus] = useState({ online: navigator.onLine, connectionType: 'unknown' });

  useEffect(() => {
    let cleanup = () => {};

    async function init() {
      const Network = await getNetwork();

      if (Network && isNative) {
        // Native: use Capacitor Network plugin
        const current = await Network.getStatus();
        setStatus({ online: current.connected, connectionType: current.connectionType });

        const handle = await Network.addListener('networkStatusChange', s => {
          setStatus({ online: s.connected, connectionType: s.connectionType });
        });
        cleanup = () => handle.remove();
      } else {
        // Web: use browser events
        const onOnline  = () => setStatus(s => ({ ...s, online: true }));
        const onOffline = () => setStatus(s => ({ ...s, online: false }));
        window.addEventListener('online', onOnline);
        window.addEventListener('offline', onOffline);
        cleanup = () => {
          window.removeEventListener('online', onOnline);
          window.removeEventListener('offline', onOffline);
        };
      }
    }

    init();
    return () => cleanup();
  }, []);

  return status;
}

// ── useGeolocation ────────────────────────────────────────────────────────────
// One-shot position grab + optional watch mode
export function useGeolocation({ watch = false, highAccuracy = true } = {}) {
  const [position, setPosition] = useState(null);
  const [error, setError]       = useState(null);
  const [loading, setLoading]   = useState(false);
  const watchIdRef = useRef(null);

  const getPosition = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const Geolocation = await getGeolocation();

      if (Geolocation && isNative) {
        // Native: request permissions first
        const perm = await Geolocation.requestPermissions();
        if (perm.location !== 'granted') {
          throw new Error('Location permission denied');
        }
        const pos = await Geolocation.getCurrentPosition({
          enableHighAccuracy: highAccuracy,
          timeout: 15000,
        });
        setPosition({
          latitude:  pos.coords.latitude,
          longitude: pos.coords.longitude,
          accuracy:  pos.coords.accuracy,
          timestamp: pos.timestamp,
        });
      } else {
        // Web: browser geolocation
        await new Promise((resolve, reject) => {
          navigator.geolocation.getCurrentPosition(
            pos => {
              setPosition({
                latitude:  pos.coords.latitude,
                longitude: pos.coords.longitude,
                accuracy:  pos.coords.accuracy,
                timestamp: pos.timestamp,
              });
              resolve();
            },
            err => reject(new Error(err.message)),
            { enableHighAccuracy: highAccuracy, timeout: 15000 }
          );
        });
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [highAccuracy]);

  // Watch mode
  useEffect(() => {
    if (!watch) return;
    let cancelled = false;

    async function startWatch() {
      const Geolocation = await getGeolocation();
      if (Geolocation && isNative) {
        watchIdRef.current = await Geolocation.watchPosition(
          { enableHighAccuracy: true },
          (pos, err) => {
            if (cancelled) return;
            if (err) { setError(err.message); return; }
            setPosition({
              latitude:  pos.coords.latitude,
              longitude: pos.coords.longitude,
              accuracy:  pos.coords.accuracy,
              timestamp: pos.timestamp,
            });
          }
        );
      } else {
        watchIdRef.current = navigator.geolocation.watchPosition(
          pos => {
            if (cancelled) return;
            setPosition({
              latitude:  pos.coords.latitude,
              longitude: pos.coords.longitude,
              accuracy:  pos.coords.accuracy,
              timestamp: pos.timestamp,
            });
          },
          err => setError(err.message),
          { enableHighAccuracy: true }
        );
      }
    }

    startWatch();
    return () => {
      cancelled = true;
      if (watchIdRef.current !== null) {
        getGeolocation().then(G => {
          if (G && isNative) G.clearWatch({ id: watchIdRef.current });
          else navigator.geolocation.clearWatch(watchIdRef.current);
        });
      }
    };
  }, [watch]);

  return { position, error, loading, getPosition };
}

// ── useHaptics ────────────────────────────────────────────────────────────────
// Returns haptic feedback functions — no-ops on web
export function useHaptics() {
  const impact = useCallback(async (style = 'medium') => {
    if (!isNative) return;
    const Haptics = await getHaptics();
    if (!Haptics) return;
    const styleMap = { light: 'LIGHT', medium: 'MEDIUM', heavy: 'HEAVY' };
    await Haptics.impact({ style: styleMap[style] || 'MEDIUM' }).catch(() => {});
  }, []);

  const notification = useCallback(async (type = 'success') => {
    if (!isNative) return;
    const Haptics = await getHaptics();
    if (!Haptics) return;
    const typeMap = { success: 'SUCCESS', warning: 'WARNING', error: 'ERROR' };
    await Haptics.notification({ type: typeMap[type] || 'SUCCESS' }).catch(() => {});
  }, []);

  return { impact, notification };
}

// ── useOfflineSync ────────────────────────────────────────────────────────────
// Reads the offline queue from IndexedDB and exposes sync status
export function useOfflineSync() {
  const [queueCount, setQueueCount] = useState(0);
  const [syncing, setSyncing]       = useState(false);
  const { online } = useNetwork();

  const openDB = () => new Promise((resolve, reject) => {
    const req = indexedDB.open('homecare-offline', 1);
    req.onupgradeneeded = e => e.target.result.createObjectStore('queue', { keyPath: 'id' });
    req.onsuccess = e => resolve(e.target.result);
    req.onerror   = e => reject(e.target.error);
  });

  const getQueueCount = useCallback(async () => {
    try {
      const db  = await openDB();
      const tx  = db.transaction('queue', 'readonly');
      const req = tx.objectStore('queue').count();
      req.onsuccess = () => setQueueCount(req.result);
    } catch { /* ignore */ }
  }, []);

  // Poll queue count every 5s
  useEffect(() => {
    getQueueCount();
    const interval = setInterval(getQueueCount, 5000);
    return () => clearInterval(interval);
  }, [getQueueCount]);

  // Listen for SW messages
  useEffect(() => {
    const handler = (event) => {
      if (event.data?.type === 'SYNCED' || event.data?.type === 'QUEUED') {
        getQueueCount();
      }
    };
    navigator.serviceWorker?.addEventListener('message', handler);
    return () => navigator.serviceWorker?.removeEventListener('message', handler);
  }, [getQueueCount]);

  // Auto-trigger background sync when back online
  useEffect(() => {
    if (online && queueCount > 0) {
      setSyncing(true);
      navigator.serviceWorker?.ready
        .then(sw => sw.sync?.register('sync-queue'))
        .catch(() => {})
        .finally(() => setTimeout(() => setSyncing(false), 2000));
    }
  }, [online, queueCount]);

  return { queueCount, syncing, online };
}

// ── useLocalNotifications ─────────────────────────────────────────────────────
// Schedule local notifications (shift reminders etc)
export function useLocalNotifications() {
  const schedule = useCallback(async ({ title, body, id, at }) => {
    const LN = await getLocalNotif();
    if (!LN || !isNative) return;
    const perm = await LN.requestPermissions();
    if (perm.display !== 'granted') return;
    await LN.schedule({
      notifications: [{
        id: id || Date.now(),
        title,
        body,
        schedule: at ? { at: new Date(at) } : undefined,
        sound: 'default',
        smallIcon: 'ic_stat_icon_config_sample',
      }]
    });
  }, []);

  const cancel = useCallback(async (id) => {
    const LN = await getLocalNotif();
    if (!LN || !isNative) return;
    await LN.cancel({ notifications: [{ id }] });
  }, []);

  return { schedule, cancel };
}
