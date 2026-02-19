// src/components/Toast.jsx - Global toast notification system
import React, { useState, useEffect, useCallback } from 'react';

let toastFn = null;

export const toast = (message, type = 'success', duration = 4000) => {
  if (toastFn) toastFn(message, type, duration);
};

export const ToastContainer = () => {
  const [toasts, setToasts] = useState([]);

  useEffect(() => {
    toastFn = (message, type, duration) => {
      const id = Date.now() + Math.random();
      setToasts(prev => [...prev, { id, message, type }]);
      setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), duration);
    };
    return () => { toastFn = null; };
  }, []);

  const remove = (id) => setToasts(prev => prev.filter(t => t.id !== id));

  const icons = { success: '✅', error: '❌', warning: '⚠️', info: 'ℹ️' };
  const colors = {
    success: { bg: '#F0FDF4', border: '#16A34A', text: '#15803D' },
    error:   { bg: '#FEF2F2', border: '#DC2626', text: '#B91C1C' },
    warning: { bg: '#FFFBEB', border: '#D97706', text: '#B45309' },
    info:    { bg: '#EFF6FF', border: '#2563EB', text: '#1D4ED8' },
  };

  return (
    <div style={{
      position: 'fixed', bottom: '1.5rem', right: '1.5rem',
      zIndex: 99999, display: 'flex', flexDirection: 'column', gap: '0.5rem',
      maxWidth: '380px', width: 'calc(100vw - 3rem)'
    }}>
      {toasts.map(t => {
        const c = colors[t.type] || colors.info;
        return (
          <div key={t.id} style={{
            display: 'flex', alignItems: 'flex-start', gap: '0.75rem',
            padding: '0.875rem 1rem', borderRadius: '10px',
            background: c.bg, border: `1px solid ${c.border}`,
            boxShadow: '0 4px 16px rgba(0,0,0,0.12)',
            animation: 'toastSlideIn 0.25s ease',
          }}>
            <span style={{ fontSize: '1rem', flexShrink: 0, marginTop: '1px' }}>{icons[t.type]}</span>
            <span style={{ flex: 1, fontSize: '0.9rem', color: c.text, fontWeight: '500', lineHeight: '1.4' }}>
              {t.message}
            </span>
            <button onClick={() => remove(t.id)} style={{
              background: 'none', border: 'none', cursor: 'pointer',
              color: c.text, opacity: 0.6, fontSize: '1.1rem', flexShrink: 0,
              padding: '0', lineHeight: 1
            }}>×</button>
          </div>
        );
      })}
      <style>{`
        @keyframes toastSlideIn {
          from { opacity: 0; transform: translateX(20px); }
          to   { opacity: 1; transform: translateX(0); }
        }
      `}</style>
    </div>
  );
};
