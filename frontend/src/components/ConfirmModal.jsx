// src/components/ConfirmModal.jsx - Replaces all window.confirm() calls
import React, { useState, useEffect } from 'react';

let confirmFn = null;

export const confirm = (message, options = {}) => {
  return new Promise((resolve) => {
    if (confirmFn) {
      confirmFn(message, options, resolve);
    } else {
      resolve(window.confirm(message));
    }
  });
};

export const ConfirmModal = () => {
  const [modal, setModal] = useState(null);

  useEffect(() => {
    confirmFn = (message, options, resolve) => {
      setModal({ message, options, resolve });
    };
    return () => { confirmFn = null; };
  }, []);

  if (!modal) return null;

  const { message, options = {}, resolve } = modal;
  const {
    title = 'Confirm Action',
    confirmLabel = 'Confirm',
    cancelLabel = 'Cancel',
    danger = false,
  } = options;

  const handleConfirm = () => { setModal(null); resolve(true); };
  const handleCancel  = () => { setModal(null); resolve(false); };

  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)',
      zIndex: 99998, display: 'flex', alignItems: 'center', justifyContent: 'center',
      padding: '1rem'
    }} onClick={handleCancel}>
      <div style={{
        background: '#fff', borderRadius: '12px', padding: '1.5rem',
        maxWidth: '420px', width: '100%',
        boxShadow: '0 20px 60px rgba(0,0,0,0.2)',
        animation: 'confirmSlideIn 0.2s ease'
      }} onClick={e => e.stopPropagation()}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '0.75rem' }}>
          <span style={{ fontSize: '1.4rem' }}>{danger ? '🗑️' : '❓'}</span>
          <h3 style={{ margin: 0, fontSize: '1.05rem', color: '#111827' }}>{title}</h3>
        </div>
        <p style={{ margin: '0 0 1.5rem 0', color: '#6B7280', lineHeight: '1.5', fontSize: '0.95rem' }}>
          {message}
        </p>
        <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'flex-end' }}>
          <button onClick={handleCancel} style={{
            padding: '0.6rem 1.25rem', borderRadius: '8px',
            border: '1px solid #D1D5DB', background: '#fff',
            color: '#374151', cursor: 'pointer', fontWeight: '500', fontSize: '0.9rem'
          }}>{cancelLabel}</button>
          <button onClick={handleConfirm} style={{
            padding: '0.6rem 1.25rem', borderRadius: '8px', border: 'none',
            background: danger ? '#DC2626' : '#2ABBA7',
            color: '#fff', cursor: 'pointer', fontWeight: '600', fontSize: '0.9rem'
          }}>{confirmLabel}</button>
        </div>
      </div>
      <style>{`
        @keyframes confirmSlideIn {
          from { opacity: 0; transform: scale(0.95); }
          to   { opacity: 1; transform: scale(1); }
        }
      `}</style>
    </div>
  );
};
