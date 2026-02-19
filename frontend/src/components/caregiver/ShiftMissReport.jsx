// src/components/caregiver/ShiftMissReport.jsx - 24/7 self-service shift miss reporting
import React, { useState, useEffect } from 'react';
import { API_BASE_URL } from '../../config';
import { toast } from '../Toast';

const ShiftMissReport = ({ token, userId, onClose }) => {
  const [upcomingShifts, setUpcomingShifts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [form, setForm] = useState({
    scheduleId: '',
    date: '',
    reason: '',
    alternativeContact: '',
  });

  useEffect(() => {
    loadMyShifts();
  }, []);

  const loadMyShifts = async () => {
    try {
      const res = await fetch(`${API_BASE_URL}/api/emergency/my-shifts`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      const data = await res.json();
      setUpcomingShifts(Array.isArray(data) ? data : []);
    } catch {}
    finally { setLoading(false); }
  };

  const handleShiftSelect = (shift) => {
    const dateStr = shift.date ? shift.date.split('T')[0] : '';
    setForm(prev => ({
      ...prev,
      scheduleId: shift.id,
      date: dateStr,
    }));
  };

  const handleSubmit = async () => {
    if (!form.date) { toast('Please select a date', 'warning'); return; }
    if (!form.reason.trim()) { toast('Please provide a reason', 'warning'); return; }

    setSubmitting(true);
    try {
      const res = await fetch(`${API_BASE_URL}/api/emergency/miss-report`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      if (!res.ok) throw new Error();
      setSubmitted(true);
    } catch {
      toast('Failed to submit. Please call the office directly.', 'error');
    } finally {
      setSubmitting(false);
    }
  };

  if (submitted) return (
    <div style={{ textAlign: 'center', padding: '2rem' }}>
      <div style={{ fontSize: '3rem', marginBottom: '1rem' }}>✅</div>
      <h3 style={{ margin: '0 0 0.5rem', color: '#111827' }}>Report Submitted</h3>
      <p style={{ color: '#6B7280', marginBottom: '1.5rem' }}>
        Your supervisor has been notified and will contact you shortly about coverage arrangements.
      </p>
      <p style={{ fontSize: '0.85rem', color: '#9CA3AF' }}>
        If you don't hear back within 30 minutes, call the office directly.
      </p>
      <button onClick={onClose} style={{
        marginTop: '1rem', padding: '0.75rem 1.5rem', background: '#2ABBA7', color: '#fff',
        border: 'none', borderRadius: '10px', cursor: 'pointer', fontWeight: '700', fontSize: '1rem'
      }}>Done</button>
    </div>
  );

  return (
    <div>
      <div style={{ textAlign: 'center', marginBottom: '1.5rem' }}>
        <div style={{ fontSize: '2.5rem', marginBottom: '0.5rem' }}>🚨</div>
        <h3 style={{ margin: 0, fontSize: '1.2rem', color: '#111827' }}>Report a Missed Shift</h3>
        <p style={{ margin: '0.5rem 0 0', color: '#6B7280', fontSize: '0.9rem' }}>
          Submit this form to notify your supervisor immediately
        </p>
      </div>

      {/* Select from upcoming shifts */}
      {!loading && upcomingShifts.length > 0 && (
        <div style={{ marginBottom: '1.25rem' }}>
          <label style={{ display: 'block', fontWeight: '700', marginBottom: '0.5rem', fontSize: '0.9rem', color: '#374151' }}>
            Select your shift (optional)
          </label>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
            {upcomingShifts.slice(0, 5).map(shift => {
              const shiftDate = shift.date ? new Date(shift.date + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }) : 'Recurring';
              const isSelected = form.scheduleId === shift.id;
              return (
                <button key={shift.id} onClick={() => handleShiftSelect(shift)}
                  style={{
                    padding: '0.75rem', textAlign: 'left', borderRadius: '8px', cursor: 'pointer',
                    border: `2px solid ${isSelected ? '#2ABBA7' : '#E5E7EB'}`,
                    background: isSelected ? '#F0FDFB' : '#fff',
                  }}>
                  <div style={{ fontWeight: '600', color: '#111827', fontSize: '0.9rem' }}>
                    {shift.client_first_name} {shift.client_last_name}
                  </div>
                  <div style={{ fontSize: '0.82rem', color: '#6B7280' }}>
                    {shiftDate} • {shift.start_time} – {shift.end_time}
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Date */}
      <div style={{ marginBottom: '1rem' }}>
        <label style={{ display: 'block', fontWeight: '700', marginBottom: '0.5rem', fontSize: '0.9rem', color: '#374151' }}>
          Date you cannot work *
        </label>
        <input type="date" value={form.date}
          onChange={e => setForm(p => ({ ...p, date: e.target.value }))}
          min={new Date().toISOString().split('T')[0]}
          style={{ width: '100%', padding: '0.75rem', border: '2px solid #E5E7EB', borderRadius: '8px', fontSize: '1rem', boxSizing: 'border-box' }} />
      </div>

      {/* Reason */}
      <div style={{ marginBottom: '1rem' }}>
        <label style={{ display: 'block', fontWeight: '700', marginBottom: '0.5rem', fontSize: '0.9rem', color: '#374151' }}>
          Reason *
        </label>
        <select value={form.reason} onChange={e => setForm(p => ({ ...p, reason: e.target.value }))}
          style={{ width: '100%', padding: '0.75rem', border: '2px solid #E5E7EB', borderRadius: '8px', fontSize: '1rem', boxSizing: 'border-box' }}>
          <option value="">Select reason...</option>
          <option value="Illness - not feeling well">Illness — not feeling well</option>
          <option value="Family emergency">Family emergency</option>
          <option value="Car trouble / transportation issue">Car trouble / transportation issue</option>
          <option value="Personal emergency">Personal emergency</option>
          <option value="Prior commitment conflict">Prior commitment conflict</option>
          <option value="Other">Other (add note below)</option>
        </select>
      </div>

      {/* Additional note */}
      <div style={{ marginBottom: '1.25rem' }}>
        <label style={{ display: 'block', fontWeight: '700', marginBottom: '0.5rem', fontSize: '0.9rem', color: '#374151' }}>
          Additional notes (optional)
        </label>
        <textarea
          placeholder="Any additional details..."
          value={form.alternativeContact}
          onChange={e => setForm(p => ({ ...p, alternativeContact: e.target.value }))}
          rows={3}
          style={{ width: '100%', padding: '0.75rem', border: '2px solid #E5E7EB', borderRadius: '8px', fontSize: '0.9rem', resize: 'vertical', boxSizing: 'border-box' }}
        />
      </div>

      <div style={{ padding: '0.875rem', background: '#FEF2F2', borderRadius: '8px', border: '1px solid #FCA5A5', marginBottom: '1.25rem' }}>
        <p style={{ margin: 0, fontSize: '0.85rem', color: '#B91C1C', fontWeight: '600' }}>
          ⚠️ Submitting this report notifies your supervisor immediately. If this is an emergency, please also call the office directly.
        </p>
      </div>

      <div style={{ display: 'flex', gap: '0.75rem' }}>
        <button onClick={onClose} style={{
          flex: 1, padding: '0.875rem', background: '#fff', color: '#374151',
          border: '2px solid #D1D5DB', borderRadius: '10px', cursor: 'pointer', fontWeight: '600', fontSize: '1rem'
        }}>Cancel</button>
        <button onClick={handleSubmit} disabled={submitting || !form.date || !form.reason}
          style={{
            flex: 2, padding: '0.875rem', background: '#DC2626', color: '#fff',
            border: 'none', borderRadius: '10px', cursor: 'pointer', fontWeight: '700', fontSize: '1rem',
            opacity: (submitting || !form.date || !form.reason) ? 0.6 : 1
          }}>
          {submitting ? 'Submitting...' : '🚨 Submit Miss Report'}
        </button>
      </div>
    </div>
  );
};

export default ShiftMissReport;
