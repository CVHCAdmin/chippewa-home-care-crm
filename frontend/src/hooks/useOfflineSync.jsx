// useOfflineSync.js - Hook to register SW and show offline/sync status
import React, { useState, useEffect } from 'react';

export function useOfflineSync() {
  const [online, setOnline]         = useState(navigator.onLine);
  const [queueCount, setQueueCount] = useState(0);
  const [syncing, setSyncing]       = useState(false);
  const [lastSynced, setLastSynced] = useState(null);

  useEffect(() => {
    // Register service worker
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw.js').catch(console.warn);

      // Listen for SW messages
      navigator.serviceWorker.addEventListener('message', event => {
        if (event.data.type === 'QUEUED') {
          setQueueCount(c => c + 1);
        }
        if (event.data.type === 'SYNCED') {
          setQueueCount(c => Math.max(0, c - 1));
          setLastSynced(new Date());
          setSyncing(false);
        }
      });
    }

    const onOnline = () => {
      setOnline(true);
      setSyncing(true);
      // Trigger background sync
      if ('serviceWorker' in navigator && 'SyncManager' in window) {
        navigator.serviceWorker.ready.then(reg => reg.sync.register('sync-queue'));
      }
    };
    const onOffline = () => setOnline(false);

    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    return () => {
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
    };
  }, []);

  return { online, queueCount, syncing, lastSynced };
}

// ── Offline Banner Component ───────────────────────────────────────────────────
export function OfflineBanner() {
  const { online, queueCount, syncing, lastSynced } = useOfflineSync();

  if (online && !queueCount && !syncing) return null;

  const bg      = !online ? '#F97316' : syncing ? '#3B82F6' : '#10B981';
  const icon    = !online ? '📵' : syncing ? '🔄' : '✅';
  const message = !online
    ? `You're offline. Clock-in/out will sync when connection returns.${queueCount ? ` (${queueCount} action${queueCount > 1 ? 's' : ''} queued)` : ''}`
    : syncing
    ? 'Syncing queued actions...'
    : `Synced ${queueCount === 0 ? 'all actions' : `${queueCount} remaining`}`;

  return (
    <div style={{
      position: 'fixed',
      bottom: 0,
      left: 0,
      right: 0,
      background: bg,
      color: '#fff',
      padding: '10px 20px',
      textAlign: 'center',
      fontSize: 14,
      fontWeight: 600,
      zIndex: 9999,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 8,
      boxShadow: '0 -2px 12px rgba(0,0,0,0.15)',
      animation: 'slideUp 0.3s ease',
    }}>
      <span>{icon}</span>
      <span>{message}</span>
      {lastSynced && (
        <span style={{ opacity: 0.8, fontSize: 12 }}>
          · Last synced {lastSynced.toLocaleTimeString()}
        </span>
      )}
      <style>{`@keyframes slideUp { from { transform: translateY(100%) } to { transform: translateY(0) } }`}</style>
    </div>
  );
}
