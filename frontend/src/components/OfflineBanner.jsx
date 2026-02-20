// components/OfflineBanner.jsx
// Shows when the caregiver is offline and has queued actions waiting to sync

import React from 'react';
import { useOfflineSync } from '../hooks/useNative';

export default function OfflineBanner() {
  const { online, queueCount, syncing } = useOfflineSync();

  if (online && queueCount === 0) return null;

  if (syncing) {
    return (
      <div style={styles.banner('#2563EB')}>
        <span style={styles.dot} />
        Syncing {queueCount} action{queueCount !== 1 ? 's' : ''}...
      </div>
    );
  }

  if (!online) {
    return (
      <div style={styles.banner('#DC2626')}>
        <span style={{ ...styles.dot, background: '#fff' }} />
        You're offline
        {queueCount > 0 && ` · ${queueCount} action${queueCount !== 1 ? 's' : ''} will sync when reconnected`}
      </div>
    );
  }

  if (queueCount > 0) {
    return (
      <div style={styles.banner('#D97706')}>
        <span style={{ ...styles.dot, background: '#fff' }} />
        {queueCount} action{queueCount !== 1 ? 's' : ''} pending sync
      </div>
    );
  }

  return null;
}

const styles = {
  banner: (bg) => ({
    position: 'fixed',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 9999,
    background: bg,
    color: '#fff',
    padding: '8px 16px',
    fontSize: '13px',
    fontWeight: 600,
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    justifyContent: 'center',
    boxShadow: '0 2px 8px rgba(0,0,0,0.2)',
  }),
  dot: {
    width: 8,
    height: 8,
    borderRadius: '50%',
    background: 'rgba(255,255,255,0.8)',
    display: 'inline-block',
    animation: 'pulse 1.5s ease-in-out infinite',
  },
};
