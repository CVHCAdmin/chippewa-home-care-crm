// src/components/admin/MakeShiftAvailableModal.jsx
// Admin flow: take an existing scheduled shift, mark it as an open shift,
// pick which caregivers to notify, and notify them in-app.
import React, { useState, useEffect } from 'react';
import { API_BASE_URL } from '../../config';

export default function MakeShiftAvailableModal({ token, schedule, clientName, caregiverName, onClose, onDone }) {
  const [loading, setLoading] = useState(true);
  const [bonus, setBonus] = useState('0');
  const [urgency, setUrgency] = useState('normal');
  const [customMessage, setCustomMessage] = useState('');
  const [eligible, setEligible] = useState([]);
  const [selected, setSelected] = useState(new Set());
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const hdr = { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` };

  useEffect(() => {
    const fetchEligible = async () => {
      try {
        const params = new URLSearchParams({
          date: schedule.date || new Date().toISOString().split('T')[0],
          startTime: schedule.startTime || schedule.start_time,
          endTime: schedule.endTime || schedule.end_time
        });
        if (schedule.id) params.append('excludeScheduleId', schedule.id);
        const r = await fetch(`${API_BASE_URL}/api/open-shifts/caregivers-available?${params}`, {
          headers: { Authorization: `Bearer ${token}` }
        });
        const list = r.ok ? await r.json() : [];
        const filtered = (Array.isArray(list) ? list : []).filter(c => c.id !== schedule.caregiverId);
        setEligible(filtered);
        setSelected(new Set(filtered.filter(c => c.available).map(c => c.id)));
      } catch (e) {
        setError(`Failed to load caregivers: ${e.message}`);
      } finally {
        setLoading(false);
      }
    };
    fetchEligible();
  }, [schedule, token]);

  const toggle = (id) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const selectAllAvailable = () => setSelected(new Set(eligible.filter(c => c.available).map(c => c.id)));
  const clearAll = () => setSelected(new Set());

  const submit = async (skipNotify = false) => {
    setError('');
    setSubmitting(true);
    try {
      const post = await fetch(`${API_BASE_URL}/api/open-shifts/from-schedule/${schedule.id}`, {
        method: 'POST',
        headers: hdr,
        body: JSON.stringify({
          bonusAmount: parseFloat(bonus) || 0,
          urgency
        })
      });
      if (!post.ok) {
        const d = await post.json().catch(() => ({}));
        throw new Error(d.error || 'Failed to mark shift available');
      }
      const openShift = await post.json();

      let notified = 0;
      if (!skipNotify && selected.size > 0) {
        const notify = await fetch(`${API_BASE_URL}/api/open-shifts/${openShift.id}/notify`, {
          method: 'POST',
          headers: hdr,
          body: JSON.stringify({
            caregiverIds: Array.from(selected),
            customMessage: customMessage.trim() || undefined
          })
        });
        const data = await notify.json().catch(() => ({}));
        if (!notify.ok) throw new Error(data.error || 'Notifications failed');
        notified = data.notified || 0;
      }

      onDone?.({ openShift, notified });
      onClose();
    } catch (e) {
      setError(e.message);
    } finally {
      setSubmitting(false);
    }
  };

  const fmtTime = (t) => {
    if (!t) return '';
    const [h, m] = t.split(':').map(Number);
    const period = h >= 12 ? 'pm' : 'am';
    const hh = h % 12 || 12;
    return `${hh}:${String(m).padStart(2, '0')} ${period}`;
  };

  const fmtDate = (d) => {
    if (!d) return '';
    return new Date(d).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
  };

  const overlay = {
    position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 2100,
    display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1rem'
  };
  const card = {
    background: '#fff', borderRadius: '12px', width: '100%', maxWidth: '600px',
    maxHeight: '90vh', overflow: 'hidden', display: 'flex', flexDirection: 'column'
  };
  const header = {
    padding: '1rem 1.25rem', borderBottom: '1px solid #E5E7EB',
    display: 'flex', justifyContent: 'space-between', alignItems: 'center'
  };
  const body = { flex: 1, overflow: 'auto', padding: '1.25rem' };
  const footer = {
    padding: '0.75rem 1.25rem', borderTop: '1px solid #E5E7EB',
    display: 'flex', justifyContent: 'space-between', gap: '0.5rem', flexWrap: 'wrap'
  };

  const startTime = schedule.startTime || schedule.start_time;
  const endTime = schedule.endTime || schedule.end_time;

  return (
    <div style={overlay} onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div style={card}>
        <div style={header}>
          <h3 style={{ margin: 0, fontSize: '1.1rem' }}>📋 Mark Shift Available</h3>
          <button onClick={onClose} style={{ background: 'none', border: 'none', fontSize: '1.4rem', cursor: 'pointer', color: '#9CA3AF' }}>×</button>
        </div>

        <div style={body}>
          <div style={{ background: '#F9FAFB', padding: '0.75rem 1rem', borderRadius: '8px', marginBottom: '1rem', fontSize: '0.9rem' }}>
            <div style={{ fontWeight: 600 }}>{clientName || 'Client'}</div>
            <div style={{ color: '#6B7280' }}>
              {fmtDate(schedule.date)}{schedule.day_of_week !== null && schedule.day_of_week !== undefined ? ' (recurring)' : ''}
              {' · '}{fmtTime(startTime)} – {fmtTime(endTime)}
            </div>
            {caregiverName && (
              <div style={{ color: '#6B7280', fontSize: '0.82rem', marginTop: '0.25rem' }}>
                Currently assigned: <strong>{caregiverName}</strong>
              </div>
            )}
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem', marginBottom: '1rem' }}>
            <div>
              <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 600, marginBottom: '0.3rem' }}>Pickup bonus ($)</label>
              <input
                type="number" step="0.01" min="0"
                value={bonus}
                onChange={(e) => setBonus(e.target.value)}
                style={{ width: '100%', padding: '0.5rem', borderRadius: '6px', border: '1px solid #D1D5DB' }}
              />
            </div>
            <div>
              <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 600, marginBottom: '0.3rem' }}>Urgency</label>
              <select value={urgency} onChange={(e) => setUrgency(e.target.value)}
                style={{ width: '100%', padding: '0.5rem', borderRadius: '6px', border: '1px solid #D1D5DB' }}>
                <option value="normal">Normal</option>
                <option value="high">High</option>
                <option value="critical">Critical</option>
              </select>
            </div>
          </div>

          <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 600, marginBottom: '0.3rem' }}>Optional message to caregivers</label>
          <textarea
            value={customMessage}
            onChange={(e) => setCustomMessage(e.target.value)}
            placeholder="e.g. Easy client, no transfers needed"
            rows={2}
            style={{ width: '100%', padding: '0.5rem', borderRadius: '6px', border: '1px solid #D1D5DB', resize: 'vertical', marginBottom: '1rem', fontFamily: 'inherit', fontSize: '0.9rem' }}
          />

          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
            <strong style={{ fontSize: '0.95rem' }}>Notify caregivers ({selected.size} selected)</strong>
            <div style={{ display: 'flex', gap: '0.5rem' }}>
              <button type="button" onClick={selectAllAvailable} style={{ background: 'none', border: '1px solid #D1D5DB', borderRadius: '6px', padding: '0.25rem 0.5rem', fontSize: '0.78rem', cursor: 'pointer' }}>Select all available</button>
              <button type="button" onClick={clearAll} style={{ background: 'none', border: '1px solid #D1D5DB', borderRadius: '6px', padding: '0.25rem 0.5rem', fontSize: '0.78rem', cursor: 'pointer' }}>Clear</button>
            </div>
          </div>

          <div style={{ border: '1px solid #E5E7EB', borderRadius: '8px', maxHeight: '260px', overflow: 'auto' }}>
            {loading && (
              <div style={{ padding: '1rem', color: '#6B7280', textAlign: 'center' }}>Loading caregivers…</div>
            )}
            {!loading && eligible.length === 0 && (
              <div style={{ padding: '1rem', color: '#6B7280', textAlign: 'center' }}>No other active caregivers found.</div>
            )}
            {!loading && eligible.map(c => {
              const isSelected = selected.has(c.id);
              return (
                <label
                  key={c.id}
                  style={{
                    display: 'flex', alignItems: 'center', gap: '0.6rem',
                    padding: '0.55rem 0.75rem',
                    borderBottom: '1px solid #F3F4F6',
                    cursor: 'pointer',
                    background: isSelected ? '#EFF6FF' : '#fff',
                    opacity: c.available ? 1 : 0.55
                  }}
                >
                  <input
                    type="checkbox"
                    checked={isSelected}
                    onChange={() => toggle(c.id)}
                  />
                  <div style={{ flex: 1 }}>
                    <div style={{ fontWeight: 500, fontSize: '0.9rem' }}>
                      {c.firstName} {c.lastName}
                      {!c.available && <span style={{ marginLeft: '0.5rem', fontSize: '0.72rem', color: '#DC2626', fontWeight: 600 }}>BUSY THIS TIME</span>}
                    </div>
                    {c.phone && <div style={{ fontSize: '0.78rem', color: '#6B7280' }}>{c.phone}</div>}
                  </div>
                </label>
              );
            })}
          </div>

          {error && (
            <div style={{ marginTop: '0.75rem', background: '#FEF2F2', color: '#991B1B', padding: '0.5rem 0.75rem', borderRadius: '6px', fontSize: '0.85rem' }}>
              {error}
            </div>
          )}
        </div>

        <div style={footer}>
          <button onClick={onClose} className="btn btn-secondary" disabled={submitting}>Cancel</button>
          <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
            <button onClick={() => submit(true)} className="btn btn-secondary" disabled={submitting}>
              {submitting ? 'Posting…' : 'Skip — post without notifying'}
            </button>
            <button onClick={() => submit(false)} className="btn btn-primary" disabled={submitting || selected.size === 0}>
              {submitting ? 'Posting…' : `Post & Notify ${selected.size}`}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
