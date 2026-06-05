// src/components/admin/ShiftApprovals.jsx
//
// Admin queue for time entries that need approval. A shift is flagged
// when it was unscheduled or when actual clock-in/out differs from the
// scheduled window by more than the grace threshold (7 min).
//
// Admin actions: approve as-is, edit billable minutes, or reject (sets
// billable to 0 so the shift doesn't pay out).

import React, { useState, useEffect, useCallback } from 'react';
import { API_BASE_URL } from '../../config';
import CareTaskChecklist from '../CareTaskChecklist';
import VisitGpsMap from './VisitGpsMap';

const fmtHrs = (h) => (h == null || h === '' ? '—' : `${parseFloat(h).toFixed(2)}h`);
const fmt$ = (n) => (n == null || n === '' ? '—' : `$${parseFloat(n).toFixed(2)}`);
const fmtDateTime = (t) => {
  if (!t) return '—';
  const d = new Date(t);
  return d.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
};

const REASON_LABEL = {
  unscheduled: 'No schedule linked',
  time_variance: 'Clock time outside 7-min grace',
};

export default function ShiftApprovals({ token }) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [editingId, setEditingId] = useState(null);
  const [editBillable, setEditBillable] = useState('');
  const [editNotes, setEditNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [taskViewerFor, setTaskViewerFor] = useState(null); // time entry id to inspect tasks
  const [mapViewerFor, setMapViewerFor] = useState(null);   // time entry row to inspect GPS

  const hdr = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const r = await fetch(`${API_BASE_URL}/api/time-entries/pending-approval`, { headers: hdr });
      if (!r.ok) throw new Error(`Request failed (${r.status})`);
      const data = await r.json();
      setRows(Array.isArray(data) ? data : []);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => { load(); }, [load]);

  const startEdit = (row) => {
    setEditingId(row.id);
    setEditBillable(String(row.billable_minutes ?? row.allotted_minutes ?? row.duration_minutes ?? 0));
    setEditNotes('');
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditBillable('');
    setEditNotes('');
  };

  const submit = async (id, body) => {
    setBusy(true);
    try {
      const r = await fetch(`${API_BASE_URL}/api/time-entries/${id}/approve`, {
        method: 'PATCH',
        headers: hdr,
        body: JSON.stringify(body),
      });
      if (!r.ok) {
        const err = await r.json().catch(() => ({}));
        throw new Error(err.error || `Approval failed (${r.status})`);
      }
      cancelEdit();
      await load();
    } catch (e) {
      alert(e.message);
    } finally {
      setBusy(false);
    }
  };

  const approveAsIs = (row) => submit(row.id, { notes: 'Approved as clocked' });
  const reject = (row) => {
    const reason = window.prompt('Why are you rejecting this shift? (This becomes part of the audit trail.)', '');
    if (reason === null) return; // cancelled
    const note = reason.trim() || 'Rejected by admin';
    submit(row.id, { reject: true, notes: note });
  };
  const saveEdit = (row) => {
    const mins = parseInt(editBillable, 10);
    if (Number.isNaN(mins) || mins < 0) { alert('Billable minutes must be a non-negative integer'); return; }
    submit(row.id, { billable_minutes: mins, notes: editNotes || null });
  };

  const cardStyle = { background: '#fff', borderRadius: 12, padding: '1rem', boxShadow: '0 1px 3px rgba(0,0,0,0.05)', marginBottom: '0.75rem' };
  const thStyle = { padding: '0.5rem 0.75rem', textAlign: 'left', fontWeight: 700, color: '#374151', borderBottom: '1px solid #E5E7EB', fontSize: '0.78rem' };
  const tdStyle = { padding: '0.5rem 0.75rem', fontSize: '0.82rem', verticalAlign: 'top' };
  const btn = (bg = '#2ABBA7') => ({ padding: '0.4rem 0.75rem', background: bg, color: '#fff', border: 'none', borderRadius: 6, fontSize: '0.78rem', fontWeight: 600, cursor: 'pointer' });
  const badge = (fg, bg) => ({ padding: '0.2rem 0.5rem', background: bg, color: fg, borderRadius: 12, fontSize: '0.7rem', fontWeight: 700, display: 'inline-block' });

  if (loading) return <div style={{ padding: '2rem', textAlign: 'center', color: '#6B7280' }}>Loading pending approvals…</div>;
  if (error) return <div style={{ padding: '2rem', textAlign: 'center', color: '#EF4444' }}>Error: {error}</div>;

  return (
    <div style={{ padding: '1rem', maxWidth: '1400px', margin: '0 auto' }}>
      <div style={{ marginBottom: '1rem' }}>
        <h1 style={{ fontSize: '1.5rem', fontWeight: 800, margin: 0, marginBottom: '0.25rem' }}>⚠️ Shift Approvals</h1>
        <p style={{ color: '#6B7280', fontSize: '0.88rem', margin: 0 }}>
          Review time entries flagged for approval — unscheduled visits or clock variance &gt; 7 min from schedule.
          Caregivers are paid <strong>scheduled hours</strong> for non-private-pay clients; use this page to override in edge cases.
        </p>
      </div>

      {rows.length === 0 ? (
        <div style={{ ...cardStyle, textAlign: 'center', color: '#6B7280', padding: '3rem' }}>
          ✅ No shifts awaiting approval.
        </div>
      ) : (
        <div style={cardStyle}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ background: '#F9FAFB' }}>
                <th style={thStyle}>Caregiver</th>
                <th style={thStyle}>Client / Payer</th>
                <th style={thStyle}>Start</th>
                <th style={thStyle}>End</th>
                <th style={thStyle}>Actual</th>
                <th style={thStyle}>Scheduled</th>
                <th style={thStyle} title="Which figure the system will actually pay">Pay Using</th>
                <th style={thStyle}>Billable</th>
                <th style={thStyle}>Est. Pay</th>
                <th style={thStyle}>Reason</th>
                <th style={thStyle}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(r => {
                const payerLabel = r.is_private_pay ? 'Private Pay' : (r.referral_source_name || r.referral_payer_type || '—');
                const estPay = r.billable_hours && r.default_pay_rate ? parseFloat(r.billable_hours) * parseFloat(r.default_pay_rate) : null;
                const isEditing = editingId === r.id;
                return (
                  <tr key={r.id} style={{ borderBottom: '1px solid #F3F4F6' }}>
                    <td style={{ ...tdStyle, fontWeight: 600 }}>{r.caregiver_first_name} {r.caregiver_last_name}</td>
                    <td style={tdStyle}>
                      <div style={{ fontWeight: 600 }}>{r.client_first_name} {r.client_last_name}</div>
                      <div style={{ fontSize: '0.72rem', color: '#6B7280' }}>{payerLabel}</div>
                    </td>
                    <td style={tdStyle}>{fmtDateTime(r.start_time)}</td>
                    <td style={tdStyle}>{fmtDateTime(r.end_time)}</td>
                    <td style={tdStyle}>{fmtHrs(r.hours)}</td>
                    <td style={tdStyle}>{fmtHrs(r.allotted_hours)}</td>
                    <td style={tdStyle}>
                      {r.is_private_pay ? (
                        <span style={badge('#3730A3', '#E0E7FF')} title="Private pay: bill the actual clocked time">Actual</span>
                      ) : r.allotted_hours == null ? (
                        <span style={badge('#92400E', '#FEF3C7')} title="No schedule linked — needs admin override before pay">Manual</span>
                      ) : (
                        <span style={badge('#065F46', '#D1FAE5')} title="Insurance/MCO: pay the scheduled amount regardless of clock variance">Scheduled</span>
                      )}
                    </td>
                    <td style={tdStyle}>
                      {isEditing ? (
                        <input
                          type="number"
                          min="0"
                          value={editBillable}
                          onChange={e => setEditBillable(e.target.value)}
                          style={{ width: 70, padding: '0.25rem', border: '1px solid #D1D5DB', borderRadius: 4, fontSize: '0.82rem' }}
                        />
                      ) : fmtHrs(r.billable_hours)}
                      {isEditing && <div style={{ fontSize: '0.7rem', color: '#6B7280' }}>minutes</div>}
                    </td>
                    <td style={{ ...tdStyle, color: '#0891B2', fontWeight: 600 }}>{fmt$(estPay)}</td>
                    <td style={tdStyle}>
                      <span style={badge('#B45309', '#FEF3C7')}>{REASON_LABEL[r.approval_reason] || r.approval_reason || '—'}</span>
                      {r.notes && <div style={{ fontSize: '0.7rem', color: '#6B7280', marginTop: 4, maxWidth: 200 }}>{r.notes}</div>}
                    </td>
                    <td style={tdStyle}>
                      {isEditing ? (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                          <input
                            type="text"
                            placeholder="Notes (optional)"
                            value={editNotes}
                            onChange={e => setEditNotes(e.target.value)}
                            style={{ width: 180, padding: '0.25rem', border: '1px solid #D1D5DB', borderRadius: 4, fontSize: '0.78rem' }}
                          />
                          <div style={{ display: 'flex', gap: 4 }}>
                            <button disabled={busy} style={btn('#2ABBA7')} onClick={() => saveEdit(r)}>Save</button>
                            <button disabled={busy} style={btn('#6B7280')} onClick={cancelEdit}>Cancel</button>
                          </div>
                        </div>
                      ) : (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                          <button disabled={busy} style={btn('#2ABBA7')} onClick={() => approveAsIs(r)}>Approve</button>
                          <button disabled={busy} style={btn('#6366F1')} onClick={() => startEdit(r)}>Edit</button>
                          <button disabled={busy} style={btn('#0891B2')} onClick={() => setTaskViewerFor(r.id)} title="See which assigned tasks the caregiver marked complete/skipped/refused">📋 Tasks</button>
                          <button disabled={busy} style={btn('#7C3AED')} onClick={() => setMapViewerFor(r)} title="View GPS trail on a map">🗺️ Map</button>
                          <button disabled={busy} style={btn('#EF4444')} onClick={() => reject(r)}>Reject</button>
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {taskViewerFor && (
        <div onClick={() => setTaskViewerFor(null)} style={{
          position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100, padding: 20,
        }}>
          <div onClick={(e) => e.stopPropagation()} style={{ background: '#fff', borderRadius: 10, maxWidth: 640, width: '95%', maxHeight: '85vh', overflow: 'auto', padding: '1rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
              <h3 style={{ margin: 0, fontSize: '1rem' }}>📋 Task Completions</h3>
              <button onClick={() => setTaskViewerFor(null)} style={{ background: 'none', border: 'none', fontSize: 22, cursor: 'pointer', color: '#6B7280' }}>×</button>
            </div>
            <CareTaskChecklist token={token} timeEntryId={taskViewerFor} />
          </div>
        </div>
      )}

      {mapViewerFor && (
        <div onClick={() => setMapViewerFor(null)} style={{
          position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100, padding: 20,
        }}>
          <div onClick={(e) => e.stopPropagation()} style={{ background: '#fff', borderRadius: 10, maxWidth: 900, width: '95%', maxHeight: '90vh', overflow: 'auto', padding: '1rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
              <h3 style={{ margin: 0, fontSize: '1rem' }}>
                🗺️ GPS Trail — {mapViewerFor.client_first_name} {mapViewerFor.client_last_name}
              </h3>
              <button onClick={() => setMapViewerFor(null)} style={{ background: 'none', border: 'none', fontSize: 22, cursor: 'pointer', color: '#6B7280' }}>×</button>
            </div>
            <VisitGpsMap token={token} timeEntryId={mapViewerFor.id}
              clientLat={mapViewerFor.client_lat} clientLng={mapViewerFor.client_lng}
              clientName={`${mapViewerFor.client_first_name} ${mapViewerFor.client_last_name}`} />
          </div>
        </div>
      )}
    </div>
  );
}
