// SignaturePad — modal canvas signing component.
// Self-contained: no third-party deps, works on mouse + touch + pen.
// Usage:
//   <SignaturePad
//     open={open}
//     onClose={() => setOpen(false)}
//     documentName="I-9 Form"
//     onSign={async (dataUri, typedName) => { ... POST to /sign ... }}
//   />

import React, { useEffect, useRef, useState } from 'react';

export default function SignaturePad({ open, onClose, documentName, onSign, requireTypedName = true }) {
  const canvasRef = useRef(null);
  const drawingRef = useRef(false);
  const lastRef = useRef({ x: 0, y: 0 });
  const dirtyRef = useRef(false);
  const [typedName, setTypedName] = useState('');
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState(null);

  useEffect(() => {
    if (!open) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    // Size buffer for high-DPI screens
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    const ctx = canvas.getContext('2d');
    ctx.scale(dpr, dpr);
    ctx.lineWidth = 2.5;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = '#0F172A';
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, rect.width, rect.height);
    dirtyRef.current = false;
  }, [open]);

  const pos = (e) => {
    const canvas = canvasRef.current;
    const rect = canvas.getBoundingClientRect();
    const point = e.touches ? e.touches[0] : e;
    return { x: point.clientX - rect.left, y: point.clientY - rect.top };
  };

  const start = (e) => {
    e.preventDefault();
    drawingRef.current = true;
    lastRef.current = pos(e);
  };

  const move = (e) => {
    if (!drawingRef.current) return;
    e.preventDefault();
    const p = pos(e);
    const ctx = canvasRef.current.getContext('2d');
    ctx.beginPath();
    ctx.moveTo(lastRef.current.x, lastRef.current.y);
    ctx.lineTo(p.x, p.y);
    ctx.stroke();
    lastRef.current = p;
    dirtyRef.current = true;
  };

  const end = () => { drawingRef.current = false; };

  const clear = () => {
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    const rect = canvas.getBoundingClientRect();
    ctx.clearRect(0, 0, rect.width, rect.height);
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, rect.width, rect.height);
    dirtyRef.current = false;
    setErr(null);
  };

  const submit = async () => {
    if (!dirtyRef.current) { setErr('Draw your signature in the box above.'); return; }
    if (requireTypedName && !typedName.trim()) { setErr('Type your full legal name below to confirm.'); return; }
    setErr(null);
    setSaving(true);
    try {
      const dataUri = canvasRef.current.toDataURL('image/png');
      await onSign(dataUri, typedName.trim() || null);
    } catch (e) {
      setErr(e.message || 'Failed to save signature');
    } finally { setSaving(false); }
  };

  if (!open) return null;

  return (
    <div onClick={onClose} style={{
      position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.55)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100,
    }}>
      <div onClick={(e) => e.stopPropagation()} style={{
        background: '#fff', borderRadius: 12, padding: '1.25rem',
        width: 'min(560px, 95vw)', boxShadow: '0 20px 60px rgba(0,0,0,0.25)',
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
          <h3 style={{ margin: 0, fontSize: '1.1rem' }}>✍️ Sign{documentName ? `: ${documentName}` : ' Document'}</h3>
          <button onClick={onClose} aria-label="Close"
            style={{ background: 'none', border: 'none', fontSize: '1.5rem', cursor: 'pointer', color: '#6B7280' }}>×</button>
        </div>
        <p style={{ margin: '0 0 0.75rem', color: '#6B7280', fontSize: '0.85rem' }}>
          By signing below you confirm that the information is true to the best of your knowledge.
          Your IP address and timestamp will be recorded.
        </p>
        <div style={{
          border: '2px dashed #94A3B8', borderRadius: 8, background: '#fff',
          height: 220, marginBottom: '0.5rem', touchAction: 'none', overflow: 'hidden',
        }}>
          <canvas
            ref={canvasRef}
            style={{ width: '100%', height: '100%', display: 'block', cursor: 'crosshair' }}
            onMouseDown={start} onMouseMove={move} onMouseUp={end} onMouseLeave={end}
            onTouchStart={start} onTouchMove={move} onTouchEnd={end}
          />
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
          <button onClick={clear} type="button"
            style={{ background: 'none', border: '1px solid #D1D5DB', borderRadius: 6, padding: '0.35rem 0.75rem', fontSize: '0.85rem', cursor: 'pointer', color: '#374151' }}>
            ↺ Clear
          </button>
          <span style={{ fontSize: '0.75rem', color: '#9CA3AF' }}>Use mouse, finger, or pen</span>
        </div>
        {requireTypedName && (
          <div style={{ marginBottom: '0.75rem' }}>
            <label style={{ display: 'block', fontSize: '0.78rem', fontWeight: 700, color: '#374151', marginBottom: 4 }}>
              Type your full legal name *
            </label>
            <input type="text" value={typedName} onChange={(e) => setTypedName(e.target.value)}
              placeholder="First Last"
              style={{ width: '100%', padding: '0.5rem', border: '1px solid #D1D5DB', borderRadius: 6, fontSize: '0.95rem' }} />
          </div>
        )}
        {err && (
          <div style={{ background: '#FEE2E2', color: '#991B1B', padding: '0.5rem 0.75rem', borderRadius: 6, fontSize: '0.85rem', marginBottom: '0.5rem' }}>
            {err}
          </div>
        )}
        <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end' }}>
          <button onClick={onClose} type="button"
            style={{ background: '#fff', border: '1px solid #D1D5DB', borderRadius: 6, padding: '0.55rem 1rem', cursor: 'pointer', fontSize: '0.9rem' }}>
            Cancel
          </button>
          <button onClick={submit} disabled={saving} type="button"
            style={{ background: '#2ABBA7', color: '#fff', border: 'none', borderRadius: 6, padding: '0.55rem 1.25rem', fontSize: '0.9rem', fontWeight: 700, cursor: saving ? 'wait' : 'pointer' }}>
            {saving ? 'Saving…' : '✓ Sign & Submit'}
          </button>
        </div>
      </div>
    </div>
  );
}
