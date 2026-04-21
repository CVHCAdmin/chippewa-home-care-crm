// src/components/admin/EligibilityCard.jsx
// Wisconsin caregiver eligibility summary derived from the most recent WORCS
// background check. Rule-based per Wis. Stat. § 50.065 / § 48.685 / DHS 12.
// Shown in CaregiverDetail on the Background Check tab.
import React, { useEffect, useState, useCallback } from 'react';
import { API_BASE_URL } from '../../config';

const STATUS_META = {
  clear:          { label: 'Cleared',                        color: '#065F46', bg: '#D1FAE5', icon: '✅' },
  flagged_review: { label: 'Flagged — admin review needed',  color: '#B45309', bg: '#FEF3C7', icon: '⚠️' },
  rehab_review:   { label: 'Requires DHS rehabilitation review', color: '#B45309', bg: '#FFEDD5', icon: '🔎' },
  disqualified:   { label: 'Disqualified — cannot hire',     color: '#991B1B', bg: '#FEE2E2', icon: '⛔' },
};

const SEVERITY_META = {
  permanent_bar: { label: 'Permanent bar',         color: '#991B1B', bg: '#FEE2E2' },
  rehab_review:  { label: 'Rehabilitation review', color: '#B45309', bg: '#FFEDD5' },
  advisory:      { label: 'Advisory',              color: '#1E40AF', bg: '#DBEAFE' },
};

const s = {
  card: { background: '#fff', borderRadius: 14, border: '1px solid #E5E7EB', padding: '1.25rem', marginBottom: '1rem' },
  statusBar: (status) => ({
    padding: '0.9rem 1rem', borderRadius: 10,
    background: STATUS_META[status]?.bg || '#EFF6FF',
    color: STATUS_META[status]?.color || '#1E40AF',
    borderLeft: `4px solid ${STATUS_META[status]?.color || '#1E40AF'}`,
    marginBottom: '0.875rem',
  }),
  match: { padding: '0.75rem 1rem', borderRadius: 8, background: '#F9FAFB', border: '1px solid #E5E7EB', marginBottom: 8 },
  badge: (meta) => ({ display: 'inline-block', padding: '2px 10px', borderRadius: 99, fontSize: '0.72rem', fontWeight: 700, color: meta.color, background: meta.bg, marginLeft: '0.5rem' }),
  btn: { padding: '0.45rem 0.9rem', background: '#fff', color: '#2ABBA7', border: '2px solid #2ABBA7', borderRadius: 8, cursor: 'pointer', fontWeight: 700, fontSize: '0.82rem' },
};

const EligibilityCard = ({ caregiverId, token }) => {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [polling, setPolling] = useState(false);

  const hdr = { 'Authorization': `Bearer ${token}` };

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch(`${API_BASE_URL}/api/background-checks/caregiver/${caregiverId}/eligibility`, { headers: hdr });
      if (!r.ok) throw new Error('Unable to load eligibility');
      setData(await r.json());
    } catch (err) {
      console.error('EligibilityCard load error:', err);
    } finally {
      setLoading(false);
    }
  }, [caregiverId, token]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { load(); }, [load]);

  const pollNow = async () => {
    setPolling(true);
    try {
      await fetch(`${API_BASE_URL}/api/background-checks/poll-now`, { method: 'POST', headers: hdr });
      await load();
    } finally {
      setPolling(false);
    }
  };

  if (loading) return <div style={s.card}>Loading eligibility analysis…</div>;
  if (!data)   return null;

  const meta = STATUS_META[data.status] || STATUS_META.flagged_review;

  return (
    <div style={s.card}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
        <div style={{ fontWeight: 800, fontSize: '0.95rem' }}>
          🛡️ Wisconsin Caregiver Eligibility Analysis
        </div>
        <button style={s.btn} onClick={pollNow} disabled={polling}>{polling ? 'Checking…' : 'Poll WORCS Now'}</button>
      </div>

      <div style={s.statusBar(data.status)}>
        <div style={{ fontWeight: 800, fontSize: '1rem' }}>{meta.icon} {meta.label}</div>
        <div style={{ marginTop: 4, fontSize: '0.88rem' }}>{data.summary}</div>
      </div>

      {data.recommendation && (
        <div style={{ fontSize: '0.88rem', color: '#374151', marginBottom: '0.75rem' }}>
          <strong>Recommendation:</strong> {data.recommendation}
        </div>
      )}

      {data.matches && data.matches.length > 0 && (
        <div>
          <div style={{ fontWeight: 700, fontSize: '0.82rem', color: '#6B7280', marginBottom: '0.5rem', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
            Matched statutes
          </div>
          {data.matches.map((m, i) => {
            const sev = SEVERITY_META[m.severity] || SEVERITY_META.advisory;
            return (
              <div key={i} style={s.match}>
                <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap' }}>
                  <strong style={{ color: '#0F172A' }}>{m.statute}</strong>
                  <span style={s.badge(sev)}>{sev.label}</span>
                </div>
                <div style={{ color: '#374151', fontSize: '0.88rem', marginTop: 4 }}>
                  {m.short_title}
                </div>
                {m.description && (
                  <div style={{ color: '#6B7280', fontSize: '0.82rem', marginTop: 4 }}>{m.description}</div>
                )}
              </div>
            );
          })}
        </div>
      )}

      <div style={{ marginTop: '0.75rem', padding: '0.5rem 0.75rem', background: '#F3F4F6', borderRadius: 6, fontSize: '0.75rem', color: '#6B7280' }}>
        This automated analysis is a review tool. The final hiring decision must be made by
        an agency administrator per Wisconsin caregiver law. If the applicant is disqualified,
        provide them a copy of the WORCS report and an FCRA summary of rights before taking
        final adverse action.
      </div>
    </div>
  );
};

export default EligibilityCard;
