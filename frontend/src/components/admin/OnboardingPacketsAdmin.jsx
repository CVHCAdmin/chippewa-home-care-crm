// src/components/admin/OnboardingPacketsAdmin.jsx
// Admin view of post-hire onboarding packets.
// Statuses: sent | opened | in_progress | submitted | expired | cancelled
// Actions: view detail, resend link, download Gusto CSV, mark Gusto-synced.
import React, { useState, useEffect, useCallback } from 'react';
import { API_BASE_URL } from '../../config';
import { toast } from '../Toast';
import { formatDate } from '../../utils/datetime';
import EligibilityCard from './EligibilityCard';

const STATUS_META = {
  sent:         { label: 'Invite Sent',    color: '#1E40AF', bg: '#DBEAFE' },
  opened:       { label: 'Opened',         color: '#1E40AF', bg: '#DBEAFE' },
  in_progress:  { label: 'In Progress',    color: '#92400E', bg: '#FEF3C7' },
  submitted:    { label: 'Submitted',      color: '#065F46', bg: '#D1FAE5' },
  expired:      { label: 'Expired',        color: '#991B1B', bg: '#FEE2E2' },
  cancelled:    { label: 'Cancelled',      color: '#991B1B', bg: '#FEE2E2' },
};

const s = {
  page: { maxWidth: 1100, margin: '0 auto', fontFamily: "'DM Sans', system-ui, sans-serif" },
  header: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' },
  h1: { margin: 0, fontSize: '1.55rem', fontWeight: 800, color: '#0F172A' },
  sub: { color: '#64748B', fontSize: '0.9rem', marginTop: 4 },
  card: { background: '#fff', borderRadius: 14, border: '1px solid #E5E7EB', padding: '1rem 1.25rem', marginBottom: '0.75rem' },
  badge: (meta) => ({ display: 'inline-block', padding: '2px 10px', borderRadius: 99, fontSize: '0.72rem', fontWeight: 700, color: meta.color, background: meta.bg }),
  btn: (color = '#2ABBA7', outline = false) => ({ padding: '0.45rem 0.85rem', background: outline ? '#fff' : color, color: outline ? color : '#fff', border: outline ? `2px solid ${color}` : 'none', borderRadius: 8, cursor: 'pointer', fontWeight: 700, fontSize: '0.82rem' }),
  tab: (active) => ({ padding: '0.5rem 1rem', border: 'none', background: 'transparent', cursor: 'pointer', fontWeight: active ? 800 : 500, color: active ? '#2ABBA7' : '#6B7280', borderBottom: `2px solid ${active ? '#2ABBA7' : 'transparent'}`, marginBottom: -2, fontSize: '0.85rem' }),
  backdrop: { position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.55)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100, padding: '1rem' },
  modal: { background: '#fff', borderRadius: 14, maxWidth: 820, width: '100%', maxHeight: '92vh', overflowY: 'auto', padding: '1.5rem' },
  label: { fontWeight: 700, fontSize: '0.72rem', color: '#6B7280', textTransform: 'uppercase', letterSpacing: '0.04em', display: 'block', marginBottom: 2 },
  value: { color: '#0F172A', fontSize: '0.9rem', marginBottom: '0.75rem' },
};

const fmtDate = (d) => d ? formatDate(d) : '—';
const fmtDT   = (d) => d ? new Date(d).toLocaleString() : '—';

const OnboardingPacketsAdmin = ({ token }) => {
  const [packets, setPackets] = useState([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState('active');
  const [detail, setDetail] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [gustoInput, setGustoInput] = useState('');

  const hdr = { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' };

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch(`${API_BASE_URL}/api/onboarding-packets`, { headers: hdr });
      if (!r.ok) throw new Error('Failed to load packets');
      setPackets(await r.json());
    } catch (e) {
      toast('Error: ' + e.message, 'error');
    } finally {
      setLoading(false);
    }
  }, [token]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { load(); }, [load]);

  const filtered = packets.filter(p => {
    if (tab === 'all') return true;
    if (tab === 'active') return ['sent', 'opened', 'in_progress'].includes(p.status);
    if (tab === 'submitted') return p.status === 'submitted';
    if (tab === 'needs_gusto') return p.status === 'submitted' && !p.gusto_synced_at;
    return true;
  });

  const openDetail = async (p) => {
    setDetailLoading(true);
    setDetail({ stub: p });
    try {
      const r = await fetch(`${API_BASE_URL}/api/onboarding-packets/${p.id}`, { headers: hdr });
      if (!r.ok) throw new Error('Load detail failed');
      const full = await r.json();
      setDetail(full);
      setGustoInput(full.gusto_employee_id || '');
    } catch (e) {
      toast('Error: ' + e.message, 'error');
      setDetail(null);
    } finally {
      setDetailLoading(false);
    }
  };

  const resend = async (p) => {
    try {
      const r = await fetch(`${API_BASE_URL}/api/onboarding-packets/${p.id}/resend`, {
        method: 'POST', headers: hdr,
      });
      if (!r.ok) throw new Error('Resend failed');
      toast('Fresh invite sent', 'success');
      load();
    } catch (e) {
      toast('Error: ' + e.message, 'error');
    }
  };

  const downloadCsv = (p) => {
    // Use token-appended URL since <a> downloads don't carry Authorization headers.
    // Use fetch blob + manual trigger so we can include the Authorization header.
    fetch(`${API_BASE_URL}/api/onboarding-packets/${p.id}/gusto-export.csv`, {
      headers: hdr,
    }).then(async (r) => {
      if (!r.ok) throw new Error('CSV download failed');
      const blob = await r.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `gusto-import-${(p.last_name || 'caregiver').toLowerCase()}.csv`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    }).catch(err => toast('Error: ' + err.message, 'error'));
  };

  const markGustoSynced = async () => {
    if (!detail) return;
    try {
      const r = await fetch(`${API_BASE_URL}/api/onboarding-packets/${detail.id}/mark-gusto-synced`, {
        method: 'POST', headers: hdr, body: JSON.stringify({ gustoEmployeeId: gustoInput.trim() || null }),
      });
      if (!r.ok) throw new Error('Mark synced failed');
      toast('Marked as synced to Gusto', 'success');
      openDetail(detail);
      load();
    } catch (e) {
      toast('Error: ' + e.message, 'error');
    }
  };

  const activeCount      = packets.filter(p => ['sent','opened','in_progress'].includes(p.status)).length;
  const submittedCount   = packets.filter(p => p.status === 'submitted').length;
  const needsGustoCount  = packets.filter(p => p.status === 'submitted' && !p.gusto_synced_at).length;

  return (
    <div style={s.page}>
      <div style={s.header}>
        <div>
          <h1 style={s.h1}>📬 Onboarding Packets</h1>
          <div style={s.sub}>Post-hire: BGC consent, WORCS check, Gusto sync.</div>
        </div>
      </div>

      <div style={{ display: 'flex', gap: '0.5rem', borderBottom: '1px solid #E5E7EB', marginBottom: '1rem', flexWrap: 'wrap' }}>
        <button style={s.tab(tab === 'active')}       onClick={() => setTab('active')}>Active ({activeCount})</button>
        <button style={s.tab(tab === 'submitted')}    onClick={() => setTab('submitted')}>Submitted ({submittedCount})</button>
        <button style={s.tab(tab === 'needs_gusto')}  onClick={() => setTab('needs_gusto')}>Needs Gusto ({needsGustoCount})</button>
        <button style={s.tab(tab === 'all')}          onClick={() => setTab('all')}>All ({packets.length})</button>
      </div>

      {loading ? (
        <div style={{ padding: '2rem', textAlign: 'center', color: '#6B7280' }}>Loading…</div>
      ) : filtered.length === 0 ? (
        <div style={{ ...s.card, textAlign: 'center', color: '#6B7280', padding: '2.5rem' }}>
          <div style={{ fontSize: '2rem' }}>📭</div>
          <div style={{ fontWeight: 700, color: '#374151' }}>No packets in this view</div>
        </div>
      ) : filtered.map(p => {
        const meta = STATUS_META[p.status] || STATUS_META.sent;
        return (
          <div key={p.id} style={s.card}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '1rem' }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: 4, flexWrap: 'wrap' }}>
                  <div style={{ fontWeight: 800, fontSize: '1rem' }}>
                    {p.legal_first_name || p.first_name} {p.legal_last_name || p.last_name}
                  </div>
                  <span style={s.badge(meta)}>{meta.label}</span>
                  {p.gusto_synced_at && <span style={s.badge({ color: '#065F46', bg: '#ECFDF5' })}>Gusto Synced</span>}
                </div>
                <div style={{ color: '#64748B', fontSize: '0.85rem' }}>{p.email}</div>
                <div style={{ color: '#9CA3AF', fontSize: '0.78rem', marginTop: 4 }}>
                  Hired {fmtDate(p.created_at)}
                  {p.submitted_at && ` · Submitted ${fmtDate(p.submitted_at)}`}
                  {p.bgc_consent_signed_at && ` · Consent signed ${fmtDate(p.bgc_consent_signed_at)}`}
                  {p.expires_at && ` · Expires ${fmtDate(p.expires_at)}`}
                </div>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6, minWidth: 150 }}>
                <button style={s.btn('#2ABBA7', true)} onClick={() => openDetail(p)}>View Detail</button>
                {['sent','opened','in_progress','expired'].includes(p.status) && (
                  <button style={s.btn('#6B7280', true)} onClick={() => resend(p)}>Resend Link</button>
                )}
                {p.status === 'submitted' && !p.gusto_synced_at && (
                  <button style={s.btn('#F59E0B')} onClick={() => downloadCsv(p)}>Download Gusto CSV</button>
                )}
              </div>
            </div>
          </div>
        );
      })}

      {detail && (
        <div style={s.backdrop} onClick={(e) => { if (e.target === e.currentTarget) setDetail(null); }}>
          <div style={s.modal}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
              <h2 style={{ margin: 0, fontSize: '1.25rem', fontWeight: 800 }}>
                {detailLoading ? 'Loading…' : `${detail.legal_first_name || detail.first_name} ${detail.legal_last_name || detail.last_name}`}
              </h2>
              <button style={s.btn('#6B7280', true)} onClick={() => setDetail(null)}>✕</button>
            </div>

            {!detailLoading && detail.id && (
              <>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem', marginBottom: '1rem' }}>
                  <div>
                    <span style={s.label}>Preferred Name</span>
                    <div style={s.value}>{detail.preferred_name || '—'}</div>
                  </div>
                  <div>
                    <span style={s.label}>Pronouns</span>
                    <div style={s.value}>{detail.pronouns || '—'}</div>
                  </div>
                  <div>
                    <span style={s.label}>Legal Full Name</span>
                    <div style={s.value}>{[detail.legal_first_name, detail.legal_middle_name, detail.legal_last_name].filter(Boolean).join(' ') || '—'}</div>
                  </div>
                  <div>
                    <span style={s.label}>Date of Birth</span>
                    <div style={s.value}>{fmtDate(detail.date_of_birth)}</div>
                  </div>
                  <div style={{ gridColumn: '1 / -1' }}>
                    <span style={s.label}>Address</span>
                    <div style={s.value}>
                      {detail.address ? `${detail.address}, ${detail.city || ''} ${detail.state || ''} ${detail.zip || ''}` : '—'}
                    </div>
                  </div>
                  <div>
                    <span style={s.label}>Driver's License</span>
                    <div style={s.value}>{detail.drivers_license_number ? `${detail.drivers_license_number} (${detail.drivers_license_state || '—'})` : '—'}</div>
                  </div>
                  <div>
                    <span style={s.label}>Emergency Contact</span>
                    <div style={s.value}>
                      {detail.emergency_contact_name
                        ? `${detail.emergency_contact_name} (${detail.emergency_contact_relationship || '—'}) · ${detail.emergency_contact_phone || '—'}`
                        : '—'}
                    </div>
                  </div>
                </div>

                {/* BGC consent attestation */}
                <div style={{ padding: '0.9rem 1rem', background: '#F0FDF4', border: '1px solid #BBF7D0', borderRadius: 10, marginBottom: '1rem' }}>
                  <div style={{ fontWeight: 700, color: '#065F46', marginBottom: 4 }}>
                    {detail.bgc_consent_signed_at ? '✅ Background check consent on file' : '⚠️ Consent not yet signed'}
                  </div>
                  {detail.bgc_consent_signed_at && (
                    <div style={{ fontSize: '0.82rem', color: '#374151' }}>
                      Signed by <strong>{detail.bgc_consent_signature}</strong> on {fmtDT(detail.bgc_consent_signed_at)}<br/>
                      IP: {detail.bgc_consent_ip || '—'} · Disclosure v{detail.bgc_consent_version || '—'}
                    </div>
                  )}
                </div>

                {/* Eligibility card pulls its own data */}
                <EligibilityCard caregiverId={detail.caregiver_id} token={token} />

                {/* Gusto sync task */}
                <div style={{ ...s.card, marginBottom: '1rem', background: detail.gusto_synced_at ? '#ECFDF5' : '#FFFBEB', border: `1px solid ${detail.gusto_synced_at ? '#BBF7D0' : '#FDE68A'}` }}>
                  <div style={{ fontWeight: 800, marginBottom: 6 }}>
                    {detail.gusto_synced_at ? '✅ Synced to Gusto' : '📤 Add to Gusto'}
                  </div>
                  {detail.gusto_synced_at ? (
                    <div style={{ fontSize: '0.85rem', color: '#374151' }}>
                      Employee ID: <strong>{detail.gusto_employee_id || '—'}</strong> · Marked {fmtDT(detail.gusto_synced_at)}
                    </div>
                  ) : (
                    <>
                      <p style={{ margin: '4px 0 10px', fontSize: '0.88rem', color: '#92400E' }}>
                        Gusto does not offer API access for agencies to auto-create employees.
                        Download the CSV, upload it in Gusto (<strong>Team &gt; Add Employees &gt; CSV Import</strong>),
                        then paste the Gusto employee ID below and click Mark Synced. Gusto will
                        email the caregiver their W-4, I-9, and direct-deposit onboarding.
                      </p>
                      <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                        <button style={s.btn('#F59E0B')} onClick={() => downloadCsv({ id: detail.id, last_name: detail.legal_last_name || detail.last_name })}>
                          Download Gusto CSV
                        </button>
                        <input
                          placeholder="Paste Gusto employee ID"
                          style={{ flex: 1, minWidth: 180, padding: '0.45rem 0.75rem', border: '1px solid #D1D5DB', borderRadius: 8, fontSize: '0.85rem' }}
                          value={gustoInput}
                          onChange={e => setGustoInput(e.target.value)}
                        />
                        <button style={s.btn('#059669')} onClick={markGustoSynced}>Mark Synced</button>
                      </div>
                    </>
                  )}
                </div>

                {/* Event log */}
                {detail.events && detail.events.length > 0 && (
                  <div style={s.card}>
                    <div style={{ fontWeight: 800, marginBottom: 8 }}>Audit Trail</div>
                    <div style={{ fontSize: '0.82rem' }}>
                      {detail.events.map(ev => (
                        <div key={ev.id} style={{ padding: '4px 0', borderBottom: '1px solid #F3F4F6', color: '#374151' }}>
                          <strong>{ev.event_type}</strong> — {fmtDT(ev.created_at)}
                          {ev.ip_address && <span style={{ color: '#9CA3AF' }}> · {ev.ip_address}</span>}
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default OnboardingPacketsAdmin;
