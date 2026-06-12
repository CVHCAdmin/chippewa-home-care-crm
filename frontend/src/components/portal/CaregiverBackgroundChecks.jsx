// components/portal/CaregiverBackgroundChecks.jsx
// Expandable background-check summary for an assigned caregiver.
// Shared by the Client Portal and Family Portal caregiver lists.
import React, { useState } from 'react';
import { apiCall } from '../../config';

const TYPE_LABELS = {
  worcs: 'Wisconsin Caregiver Background Check (WI DOJ)',
  criminal: 'Criminal History',
  sex_offender: 'Sex Offender Registry',
  caregiver_registry: 'WI Caregiver Misconduct Registry',
  driving: 'Driving Record',
  drug_screen: 'Drug Screening',
};

const typeLabel = (t) =>
  TYPE_LABELS[t] || (t || 'Background Check').replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());

const statusBadge = (check) => {
  const result = (check.result || '').toLowerCase();
  const status = (check.status || '').toLowerCase();

  if (result === 'clear' || result === 'passed') {
    return { label: '✓ Clear', bg: '#d4edda', fg: '#155724' };
  }
  if (status === 'completed' && !result) {
    return { label: '✓ Completed', bg: '#d4edda', fg: '#155724' };
  }
  if (status === 'pending' || status === 'in_progress') {
    return { label: 'In Progress', bg: '#fff3cd', fg: '#856404' };
  }
  return { label: check.result || check.status || 'On File', bg: '#d1ecf1', fg: '#0c5460' };
};

const fmtDate = (d) => d ? new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : null;

const CaregiverBackgroundChecks = ({ token, caregiverId, apiBase }) => {
  const [open, setOpen]       = useState(false);
  const [checks, setChecks]   = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState('');

  const toggle = () => {
    const next = !open;
    setOpen(next);
    if (next && checks === null && !loading) {
      setLoading(true);
      apiCall(`${apiBase}/portal/caregivers/${caregiverId}/background-checks`, { method: 'GET' }, token)
        .then(data => setChecks(Array.isArray(data) ? data : []))
        .catch(err => setError(err.message === 'SESSION_EXPIRED' ? 'Session expired — please sign in again.' : 'Could not load background check information.'))
        .finally(() => setLoading(false));
    }
  };

  return (
    <div style={{ marginTop: '10px' }}>
      <button
        type="button"
        onClick={toggle}
        style={{
          background: 'none', border: '1px solid #1a5276', color: '#1a5276',
          padding: '6px 12px', borderRadius: '8px', cursor: 'pointer',
          fontWeight: 600, fontSize: '0.8rem',
        }}
      >
        🛡️ Background Check {open ? '▲' : '▼'}
      </button>

      {open && (
        <div style={{
          marginTop: '10px', background: '#f8fafc', borderRadius: '8px',
          padding: '12px 14px', border: '1px solid #e8ecf0',
        }}>
          {loading && <div style={{ color: '#888', fontSize: '0.85rem' }}>Loading…</div>}
          {error && <div style={{ color: '#a94442', fontSize: '0.85rem' }}>{error}</div>}

          {checks && checks.length === 0 && (
            <div style={{ color: '#666', fontSize: '0.85rem' }}>
              Background check records for this caregiver are on file with the office.
              Please contact your care coordinator for details.
            </div>
          )}

          {checks && checks.length > 0 && checks.map(check => {
            const badge = statusBadge(check);
            return (
              <div key={check.id} style={{
                display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start',
                gap: '10px', padding: '8px 0', borderBottom: '1px solid #eef1f4',
              }}>
                <div>
                  <div style={{ fontWeight: 600, fontSize: '0.85rem', color: '#333' }}>
                    {typeLabel(check.check_type)}
                  </div>
                  <div style={{ fontSize: '0.75rem', color: '#888', marginTop: '2px' }}>
                    {check.provider && <span>{check.provider}</span>}
                    {fmtDate(check.completed_date) && <span> · Completed {fmtDate(check.completed_date)}</span>}
                    {!check.completed_date && fmtDate(check.initiated_date) && <span> · Started {fmtDate(check.initiated_date)}</span>}
                    {fmtDate(check.expiration_date) && <span> · Valid through {fmtDate(check.expiration_date)}</span>}
                  </div>
                </div>
                <span style={{
                  background: badge.bg, color: badge.fg, padding: '3px 10px',
                  borderRadius: '10px', fontSize: '0.72rem', fontWeight: 700,
                  whiteSpace: 'nowrap', flexShrink: 0,
                }}>
                  {badge.label}
                </span>
              </div>
            );
          })}

          {checks && checks.length > 0 && (
            <div style={{ fontSize: '0.7rem', color: '#999', marginTop: '8px' }}>
              All caregivers are screened in accordance with the Wisconsin Caregiver Law before serving clients.
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default CaregiverBackgroundChecks;
