// src/components/admin/MakeShiftAvailableModal.jsx
// Admin flow: take ONE visit off the schedule and offer it as an open shift — pick
// exactly which caregivers can see and accept it, whether the first to accept gets it
// right away, and whether to text them.
//
// `date` is the visit's own date. It matters: a repeating shift has no date of its
// own, and posting without one is what made "Mark Available" fail for weekly visits.
import React, { useState, useEffect } from 'react';
import { API_BASE_URL } from '../../config';

export default function MakeShiftAvailableModal({ token, schedule, date, clientName, caregiverName, onClose, onDone }) {
  const [loading, setLoading] = useState(true);
  const [bonus, setBonus] = useState('0');
  const [urgency, setUrgency] = useState('normal');
  const [customMessage, setCustomMessage] = useState('');
  const [eligible, setEligible] = useState([]);
  const [selected, setSelected] = useState(new Set());
  const [autoAssign, setAutoAssign] = useState(true);
  const [sendText, setSendText] = useState(true);
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const hdr = { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` };
  const visitDate = date || schedule.date || '';
  const startTime = (schedule.startTime || schedule.start_time || '').slice(0, 5);
  const endTime = (schedule.endTime || schedule.end_time || '').slice(0, 5);
  const currentCaregiverId = schedule.caregiverId || schedule.caregiver_id;

  useEffect(() => {
    if (!visitDate) { setLoading(false); setError('Open the shift from the day you want to post, so it knows which date.'); return; }
    const fetchEligible = async () => {
      try {
        const params = new URLSearchParams({ date: visitDate, startTime, endTime });
        if (schedule.id) params.append('excludeScheduleId', schedule.id);
        const r = await fetch(`${API_BASE_URL}/api/open-shifts/caregivers-available?${params}`, {
          headers: { Authorization: `Bearer ${token}` }
        });
        const body = await r.json().catch(() => []);
        if (!r.ok) throw new Error(body.error || `HTTP ${r.status}`);
        const filtered = (Array.isArray(body) ? body : []).filter(c => c.id !== currentCaregiverId);
        setEligible(filtered);
        setSelected(new Set(filtered.filter(c => c.available).map(c => c.id)));
      } catch (e) {
        setError(`Failed to load caregivers: ${e.message}`);
      } finally {
        setLoading(false);
      }
    };
    fetchEligible();
  }, [schedule, token, visitDate]);

  const toggle = (id) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };
  const selectAllAvailable = () => setSelected(new Set(eligible.filter(c => c.available).map(c => c.id)));
  const clearAll = () => setSelected(new Set());

  const submit = async () => {
    setError('');
    if (selected.size === 0) return setError('Pick at least one caregiver who can see and accept this shift.');
    setSubmitting(true);
    try {
      const ids = Array.from(selected);
      const post = await fetch(`${API_BASE_URL}/api/open-shifts/from-schedule/${schedule.id}`, {
        method: 'POST',
        headers: hdr,
        body: JSON.stringify({ date: visitDate, visibleTo: ids, autoAssign, bonusAmount: parseFloat(bonus) || 0, urgency })
      });
      const posted = await post.json().catch(() => ({}));
      if (!post.ok) throw new Error(posted.error || 'Failed to post the shift');

      const notify = await fetch(`${API_BASE_URL}/api/open-shifts/${posted.id}/notify`, {
        method: 'POST',
        headers: hdr,
        body: JSON.stringify({ caregiverIds: ids, customMessage: customMessage.trim() || undefined, sms: sendText })
      });
      const data = await notify.json().catch(() => ({}));
      // The shift IS posted at this point — say so even if telling people failed.
      if (!notify.ok) {
        onDone?.({ openShift: posted, notified: 0, texted: 0, warning: `Posted, but notifying failed: ${data.error || notify.status}` });
        onClose();
        return;
      }
      onDone?.({ openShift: posted, notified: data.notified || 0, texted: data.texted || 0 });
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
    return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${h >= 12 ? 'PM' : 'AM'}`;
  };
  const fmtDate = (d) => d ? new Date(`${d}T12:00:00`).toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' }) : '';

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
  const radio = (on) => ({
    display: 'flex', gap: '0.5rem', alignItems: 'flex-start', padding: '0.55rem 0.75rem', borderRadius: 8, cursor: 'pointer',
    border: `1px solid ${on ? '#3B82F6' : '#E5E7EB'}`, background: on ? '#EFF6FF' : '#fff', marginBottom: '0.4rem', fontSize: '0.88rem'
  });

  return (
    <div style={overlay} onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div style={card}>
        <div style={header}>
          <h3 style={{ margin: 0, fontSize: '1.1rem' }}>📋 Move to Available Shifts</h3>
          <button onClick={onClose} style={{ background: 'none', border: 'none', fontSize: '1.4rem', cursor: 'pointer', color: '#9CA3AF' }}>×</button>
        </div>

        <div style={body}>
          <div style={{ background: '#F9FAFB', padding: '0.75rem 1rem', borderRadius: '8px', marginBottom: '1rem', fontSize: '0.9rem' }}>
            <div style={{ fontWeight: 600 }}>{clientName || 'Client'}</div>
            <div style={{ color: '#111827' }}><strong>{fmtDate(visitDate)}</strong> · {fmtTime(startTime)} – {fmtTime(endTime)}</div>
            {caregiverName && (
              <div style={{ color: '#6B7280', fontSize: '0.82rem', marginTop: '0.25rem' }}>
                Now assigned to <strong>{caregiverName}</strong> — it stays with them until someone takes it. Only this one day is offered.
              </div>
            )}
          </div>

          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem', flexWrap: 'wrap', gap: '0.4rem' }}>
            <strong style={{ fontSize: '0.95rem' }}>Who can see and accept it ({selected.size})</strong>
            <div style={{ display: 'flex', gap: '0.5rem' }}>
              <button type="button" onClick={selectAllAvailable} style={{ background: 'none', border: '1px solid #D1D5DB', borderRadius: '6px', padding: '0.25rem 0.5rem', fontSize: '0.78rem', cursor: 'pointer' }}>All available</button>
              <button type="button" onClick={clearAll} style={{ background: 'none', border: '1px solid #D1D5DB', borderRadius: '6px', padding: '0.25rem 0.5rem', fontSize: '0.78rem', cursor: 'pointer' }}>Clear</button>
            </div>
          </div>

          <div style={{ border: '1px solid #E5E7EB', borderRadius: '8px', maxHeight: '240px', overflow: 'auto', marginBottom: '1rem' }}>
            {loading && <div style={{ padding: '1rem', color: '#6B7280', textAlign: 'center' }}>Loading caregivers…</div>}
            {!loading && eligible.length === 0 && !error && <div style={{ padding: '1rem', color: '#6B7280', textAlign: 'center' }}>No other active caregivers found.</div>}
            {!loading && eligible.map(c => {
              const isSelected = selected.has(c.id);
              return (
                <label key={c.id} style={{
                  display: 'flex', alignItems: 'center', gap: '0.6rem', padding: '0.55rem 0.75rem',
                  borderBottom: '1px solid #F3F4F6', cursor: 'pointer',
                  background: isSelected ? '#EFF6FF' : '#fff', opacity: c.available ? 1 : 0.6
                }}>
                  <input type="checkbox" checked={isSelected} onChange={() => toggle(c.id)} />
                  <div style={{ flex: 1 }}>
                    <div style={{ fontWeight: 500, fontSize: '0.9rem' }}>
                      {c.firstName} {c.lastName}
                      {c.timeOff && <span style={{ marginLeft: '0.5rem', fontSize: '0.72rem', color: '#B45309', fontWeight: 600 }}>TIME OFF</span>}
                      {c.busy && <span style={{ marginLeft: '0.5rem', fontSize: '0.72rem', color: '#DC2626', fontWeight: 600 }}>BUSY THIS TIME</span>}
                    </div>
                    {c.phone && <div style={{ fontSize: '0.78rem', color: '#6B7280' }}>{c.phone}</div>}
                  </div>
                </label>
              );
            })}
          </div>

          <strong style={{ display: 'block', fontSize: '0.95rem', marginBottom: '0.4rem' }}>When someone accepts</strong>
          <label style={radio(autoAssign)}>
            <input type="radio" checked={autoAssign} onChange={() => setAutoAssign(true)} />
            <span><strong>Give it to the first one who accepts</strong><br /><span style={{ color: '#6B7280', fontSize: '0.8rem' }}>It moves onto their schedule right away and you get a notification.</span></span>
          </label>
          <label style={radio(!autoAssign)}>
            <input type="radio" checked={!autoAssign} onChange={() => setAutoAssign(false)} />
            <span><strong>Wait for my approval</strong><br /><span style={{ color: '#6B7280', fontSize: '0.8rem' }}>Approve it in Schedule Hub → Staffing → Open Shifts.</span></span>
          </label>

          <label style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', margin: '0.75rem 0', fontSize: '0.88rem', cursor: 'pointer' }}>
            <input type="checkbox" checked={sendText} onChange={e => setSendText(e.target.checked)} />
            <span><strong>Text them</strong> about it (they also see it in the app under Open Shifts)</span>
          </label>

          <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 600, marginBottom: '0.3rem' }}>Optional message</label>
          <textarea value={customMessage} onChange={(e) => setCustomMessage(e.target.value)}
            placeholder="e.g. Easy client, no transfers needed" rows={2}
            style={{ width: '100%', padding: '0.5rem', borderRadius: '6px', border: '1px solid #D1D5DB', resize: 'vertical', marginBottom: '0.75rem', fontFamily: 'inherit', fontSize: '0.9rem', boxSizing: 'border-box' }} />

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
            <div>
              <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 600, marginBottom: '0.3rem' }}>Pickup bonus ($)</label>
              <input type="number" step="0.01" min="0" value={bonus} onChange={(e) => setBonus(e.target.value)}
                style={{ width: '100%', padding: '0.5rem', borderRadius: '6px', border: '1px solid #D1D5DB', boxSizing: 'border-box' }} />
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

          {error && (
            <div style={{ marginTop: '0.75rem', background: '#FEF2F2', color: '#991B1B', padding: '0.5rem 0.75rem', borderRadius: '6px', fontSize: '0.85rem' }}>{error}</div>
          )}
        </div>

        <div style={footer}>
          <button onClick={onClose} className="btn btn-secondary" disabled={submitting}>Cancel</button>
          <button onClick={submit} className="btn btn-primary" disabled={submitting || loading || selected.size === 0 || !visitDate}>
            {submitting ? 'Posting…' : `Post to ${selected.size} caregiver${selected.size === 1 ? '' : 's'}`}
          </button>
        </div>
      </div>
    </div>
  );
}
