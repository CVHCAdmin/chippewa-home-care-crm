import React, { useState } from 'react';
import { API_BASE_URL } from '../../config';
import { toast } from '../Toast';

const formatMinutes = (m) => {
  const h = Math.floor(m / 60);
  const r = m % 60;
  return r === 0 ? `${h}h` : `${h}h ${r}m`;
};

const formatTime = (t) => {
  if (!t) return '';
  const [hh, mm] = String(t).split(':');
  const h = parseInt(hh, 10);
  const ampm = h >= 12 ? 'PM' : 'AM';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${mm} ${ampm}`;
};

const formatDate = (d) => {
  const dt = new Date(String(d).split('T')[0] + 'T12:00:00');
  return dt.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
};

const fmtMoney = (n) => `$${parseFloat(n || 0).toFixed(2)}`;

export default function PaydayVerificationModal({ pending, token, onResolved }) {
  const [mode, setMode] = useState('review'); // 'review' | 'dispute'
  const [disputeReason, setDisputeReason] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const submit = async (confirmed) => {
    if (!confirmed && !disputeReason.trim()) {
      toast('Please describe the issue so we can investigate.', 'warning');
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch(`${API_BASE_URL}/api/payroll/caregiver/me/verify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          payPeriodStart: pending.payPeriodStart,
          payPeriodEnd: pending.payPeriodEnd,
          confirmed,
          disputeReason: confirmed ? null : disputeReason.trim(),
          reportedTotalHours: pending.totalHours,
          reportedGrossPay: pending.grossPay,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || 'Failed to submit');
      }
      toast(confirmed ? 'Thanks — hours confirmed.' : 'Dispute sent to admin. We will review shortly.', 'success');
      onResolved();
    } catch (e) {
      toast(e.message, 'error');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 99997,
      display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1rem'
    }}>
      <div style={{
        background: '#fff', borderRadius: 16, width: '100%', maxWidth: 560,
        maxHeight: '90vh', display: 'flex', flexDirection: 'column', boxShadow: '0 20px 40px rgba(0,0,0,0.25)'
      }}>
        <div style={{ padding: '1.25rem 1.5rem', background: 'linear-gradient(135deg, #2ABBA7 0%, #1e8a7c 100%)', color: '#fff', borderTopLeftRadius: 16, borderTopRightRadius: 16 }}>
          <div style={{ fontSize: '0.85rem', opacity: 0.9, fontWeight: 500 }}>Payday Verification</div>
          <div style={{ fontSize: '1.35rem', fontWeight: 700, marginTop: '0.25rem' }}>
            Please review your hours
          </div>
          <div style={{ fontSize: '0.9rem', marginTop: '0.5rem', opacity: 0.95 }}>
            Pay period: <strong>{formatDate(pending.payPeriodStart)} – {formatDate(pending.payPeriodEnd)}</strong>
            <br />Expected pay date: <strong>{formatDate(pending.payDate)}</strong>
          </div>
        </div>

        <div style={{ padding: '1.25rem 1.5rem', overflowY: 'auto', flex: 1 }}>
          {mode === 'review' && (
            <>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '0.75rem', marginBottom: '1rem' }}>
                <div style={{ background: '#F3F4F6', padding: '0.75rem', borderRadius: 8, textAlign: 'center' }}>
                  <div style={{ fontSize: '0.7rem', color: '#6B7280', fontWeight: 600, textTransform: 'uppercase' }}>Hours</div>
                  <div style={{ fontSize: '1.4rem', fontWeight: 700, color: '#111827' }}>{pending.totalHours.toFixed(2)}h</div>
                </div>
                <div style={{ background: '#F3F4F6', padding: '0.75rem', borderRadius: 8, textAlign: 'center' }}>
                  <div style={{ fontSize: '0.7rem', color: '#6B7280', fontWeight: 600, textTransform: 'uppercase' }}>Rate</div>
                  <div style={{ fontSize: '1.4rem', fontWeight: 700, color: '#111827' }}>{fmtMoney(pending.hourlyRate)}</div>
                </div>
                <div style={{ background: '#ECFDF5', padding: '0.75rem', borderRadius: 8, textAlign: 'center', border: '1px solid #A7F3D0' }}>
                  <div style={{ fontSize: '0.7rem', color: '#065F46', fontWeight: 600, textTransform: 'uppercase' }}>Gross Pay</div>
                  <div style={{ fontSize: '1.4rem', fontWeight: 700, color: '#065F46' }}>{fmtMoney(pending.grossPay)}</div>
                </div>
              </div>

              <div style={{ fontSize: '0.9rem', fontWeight: 600, color: '#374151', marginBottom: '0.5rem' }}>
                Shifts ({pending.shifts.length})
              </div>
              <div style={{ border: '1px solid #E5E7EB', borderRadius: 8, overflow: 'hidden' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.82rem' }}>
                  <thead>
                    <tr style={{ background: '#F9FAFB', textAlign: 'left' }}>
                      <th style={{ padding: '0.5rem 0.6rem', fontWeight: 600, color: '#374151' }}>Date</th>
                      <th style={{ padding: '0.5rem 0.6rem', fontWeight: 600, color: '#374151' }}>Client</th>
                      <th style={{ padding: '0.5rem 0.6rem', fontWeight: 600, color: '#374151' }}>Scheduled</th>
                      <th style={{ padding: '0.5rem 0.6rem', fontWeight: 600, color: '#374151', textAlign: 'right' }}>Paid</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pending.shifts.map(s => (
                      <tr key={s.id} style={{ borderTop: '1px solid #F3F4F6' }}>
                        <td style={{ padding: '0.5rem 0.6rem', color: '#111827' }}>{formatDate(s.shift_date)}</td>
                        <td style={{ padding: '0.5rem 0.6rem', color: '#111827' }}>
                          {s.client_first} {s.client_last?.[0]}.
                        </td>
                        <td style={{ padding: '0.5rem 0.6rem', color: '#6B7280', fontSize: '0.78rem' }}>
                          {formatTime(s.scheduled_start)}–{formatTime(s.scheduled_end)}
                        </td>
                        <td style={{ padding: '0.5rem 0.6rem', textAlign: 'right', fontWeight: 600, color: '#059669' }}>
                          {formatMinutes(s.payable_minutes || 0)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div style={{ marginTop: '1rem', padding: '0.75rem', background: '#FFFBEB', border: '1px solid #FCD34D', borderRadius: 8, fontSize: '0.82rem', color: '#78350F' }}>
                Gross pay shown is before taxes. Your actual net check will be slightly less after federal, FICA, and state deductions.
              </div>
            </>
          )}

          {mode === 'dispute' && (
            <>
              <div style={{ fontSize: '0.95rem', color: '#374151', marginBottom: '0.75rem' }}>
                Tell us what's wrong. Be specific — which shift, what date, what you expected vs. what you see.
              </div>
              <textarea
                value={disputeReason}
                onChange={(e) => setDisputeReason(e.target.value)}
                placeholder="e.g. Tuesday April 15 with Jane Doe — I worked 4 hours but only 3 are showing."
                rows={6}
                style={{
                  width: '100%', padding: '0.75rem', borderRadius: 8, border: '1px solid #D1D5DB',
                  fontSize: '0.9rem', fontFamily: 'inherit', resize: 'vertical'
                }}
              />
              <div style={{ marginTop: '0.5rem', fontSize: '0.8rem', color: '#6B7280' }}>
                An admin will review and reach out. Payroll for this period may be held until resolved.
              </div>
            </>
          )}
        </div>

        <div style={{ padding: '1rem 1.5rem', borderTop: '1px solid #E5E7EB', display: 'flex', gap: '0.5rem', flexWrap: 'wrap', justifyContent: 'space-between' }}>
          {mode === 'review' ? (
            <>
              <button
                onClick={() => setMode('dispute')}
                disabled={submitting}
                style={{
                  padding: '0.7rem 1rem', borderRadius: 8, border: '1px solid #DC2626',
                  background: '#fff', color: '#DC2626', fontWeight: 600, cursor: 'pointer', fontSize: '0.9rem'
                }}>
                Something's Wrong
              </button>
              <button
                onClick={() => submit(true)}
                disabled={submitting}
                style={{
                  padding: '0.7rem 1.5rem', borderRadius: 8, border: 'none',
                  background: '#2ABBA7', color: '#fff', fontWeight: 700, cursor: 'pointer', fontSize: '0.95rem',
                  flex: 1, marginLeft: '0.5rem'
                }}>
                {submitting ? 'Submitting…' : 'Looks Right — Confirm'}
              </button>
            </>
          ) : (
            <>
              <button
                onClick={() => setMode('review')}
                disabled={submitting}
                style={{
                  padding: '0.7rem 1rem', borderRadius: 8, border: '1px solid #D1D5DB',
                  background: '#fff', color: '#374151', fontWeight: 600, cursor: 'pointer', fontSize: '0.9rem'
                }}>
                Back
              </button>
              <button
                onClick={() => submit(false)}
                disabled={submitting || !disputeReason.trim()}
                style={{
                  padding: '0.7rem 1.5rem', borderRadius: 8, border: 'none',
                  background: disputeReason.trim() ? '#DC2626' : '#FCA5A5',
                  color: '#fff', fontWeight: 700,
                  cursor: disputeReason.trim() ? 'pointer' : 'not-allowed',
                  fontSize: '0.95rem', flex: 1, marginLeft: '0.5rem'
                }}>
                {submitting ? 'Sending…' : 'Submit Dispute'}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
