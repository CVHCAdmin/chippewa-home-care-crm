// src/components/admin/BillingEngine.jsx
// Complete Billing Engine: Claims, Authorizations, Denials, Payments
import React, { useState, useEffect, useCallback } from 'react';
import { API_BASE_URL } from '../../config';
import { toast } from '../Toast';

const BillingEngine = ({ token }) => {
  const [activeTab, setActiveTab] = useState('claims');

  const tabs = [
    { id: 'claims', label: 'Claims', icon: '📑' },
    { id: 'authorizations', label: 'Authorizations', icon: '📋' },
    { id: 'denials', label: 'Denials', icon: '❌' },
    { id: 'payments', label: 'Payments', icon: '💰' },
  ];

  return (
    <div>
      <div className="page-header">
        <h2>Billing Engine</h2>
      </div>

      {/* Tab Bar */}
      <div style={{ display: 'flex', gap: '0.25rem', marginBottom: '1rem', borderBottom: '2px solid #E5E7EB', paddingBottom: 0 }}>
        {tabs.map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            style={{
              padding: '0.6rem 1.25rem', border: 'none', cursor: 'pointer',
              fontSize: '0.9rem', fontWeight: activeTab === tab.id ? '700' : '500',
              color: activeTab === tab.id ? '#2563EB' : '#6B7280',
              background: activeTab === tab.id ? '#EFF6FF' : 'transparent',
              borderBottom: activeTab === tab.id ? '3px solid #2563EB' : '3px solid transparent',
              borderRadius: '6px 6px 0 0', transition: 'all 0.15s',
            }}
          >
            {tab.icon} {tab.label}
          </button>
        ))}
      </div>

      {/* Tab Content */}
      {activeTab === 'claims' && <ClaimsTab token={token} />}
      {activeTab === 'authorizations' && <AuthorizationsTab token={token} />}
      {activeTab === 'denials' && <DenialsTab token={token} />}
      {activeTab === 'payments' && <PaymentsTab token={token} />}
    </div>
  );
};

// ═══════════════════════════════════════════════════════════════════════════════
// CLAIMS TAB
// ═══════════════════════════════════════════════════════════════════════════════
const ClaimsTab = ({ token }) => {
  const [claims, setClaims] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState({ status: '', payerId: '' });
  const [payers, setPayers] = useState([]);
  const [selectedClaims, setSelectedClaims] = useState([]);
  const [summary, setSummary] = useState(null);
  const [showBatchGen, setShowBatchGen] = useState(false);
  const [batchDates, setBatchDates] = useState({ startDate: '', endDate: '' });
  const [showStatusModal, setShowStatusModal] = useState(false);
  const [currentClaim, setCurrentClaim] = useState(null);

  const api = useCallback(async (url, options = {}) => {
    const res = await fetch(`${API_BASE_URL}${url}`, {
      ...options,
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}`, ...options.headers },
    });
    if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error(e.error || 'Request failed'); }
    return res;
  }, [token]);

  useEffect(() => { loadClaims(); loadPayers(); loadSummary(); }, [filter]);

  const loadClaims = async () => {
    try {
      const params = new URLSearchParams();
      if (filter.status) params.append('status', filter.status);
      if (filter.payerId) params.append('payerId', filter.payerId);
      const res = await api(`/api/claims?${params}`);
      setClaims(await res.json());
    } catch (e) { console.error(e); } finally { setLoading(false); }
  };

  const loadPayers = async () => {
    try {
      const res = await api('/api/referral-sources');
      setPayers(await res.json());
    } catch (e) {}
  };

  const loadSummary = async () => {
    try {
      const res = await api('/api/claims/reports/summary');
      setSummary(await res.json());
    } catch (e) {}
  };

  const batchGenerate = async () => {
    if (!batchDates.startDate || !batchDates.endDate) { toast('Select a date range', 'error'); return; }
    try {
      const res = await api('/api/claims/batch-generate', {
        method: 'POST', body: JSON.stringify(batchDates)
      });
      const data = await res.json();
      toast(`Generated ${data.generated} claims. ${data.skipped} skipped.`, 'success');
      setShowBatchGen(false);
      loadClaims(); loadSummary();
    } catch (e) { toast(e.message, 'error'); }
  };

  const exportEDI = async () => {
    if (!selectedClaims.length) { toast('Select claims to export'); return; }
    try {
      const res = await fetch(`${API_BASE_URL}/api/claims/export/837p`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({ claimIds: selectedClaims }),
      });
      if (res.ok) {
        const blob = await res.blob();
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = `claims-837p-${new Date().toISOString().split('T')[0]}.edi`;
        a.click();
        toast('EDI 837P exported', 'success');
        setSelectedClaims([]); loadClaims();
      }
    } catch (e) { toast(e.message, 'error'); }
  };

  const exportMidas = async () => {
    if (!selectedClaims.length) { toast('Select claims to export'); return; }
    try {
      const res = await fetch(`${API_BASE_URL}/api/claims/export/midas`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({ claimIds: selectedClaims }),
      });
      if (res.ok) {
        const blob = await res.blob();
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = `MIDAS-Upload-Packet-${new Date().toISOString().split('T')[0]}.csv`;
        a.click();
        toast('MIDAS packet exported', 'success');
        setSelectedClaims([]); loadClaims();
      }
    } catch (e) { toast(e.message, 'error'); }
  };

  const exportIRIS = async () => {
    if (!selectedClaims.length) { toast('Select claims to export'); return; }
    try {
      const res = await fetch(`${API_BASE_URL}/api/claims/export/iris`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({ claimIds: selectedClaims }),
      });
      if (res.ok) {
        const blob = await res.blob();
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = `IRIS-FEA-Export-${new Date().toISOString().split('T')[0]}.csv`;
        a.click();
        toast('IRIS FEA export complete', 'success');
        setSelectedClaims([]); loadClaims();
      }
    } catch (e) { toast(e.message, 'error'); }
  };

  const toggleClaim = (id) => setSelectedClaims(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);
  const selectAllPending = () => setSelectedClaims(claims.filter(c => ['pending', 'draft', 'ready'].includes(c.status)).map(c => c.id));

  const updateStatus = async (formData) => {
    try {
      await api('/api/claims/update-status', { method: 'POST', body: JSON.stringify(formData) });
      toast('Status updated', 'success');
      setShowStatusModal(false); setCurrentClaim(null);
      loadClaims(); loadSummary();
    } catch (e) { toast(e.message, 'error'); }
  };

  const statusBadge = (status) => {
    const colors = { pending: '#F59E0B', draft: '#9CA3AF', ready: '#3B82F6', submitted: '#8B5CF6', accepted: '#10B981', paid: '#059669', denied: '#EF4444', voided: '#6B7280' };
    return <span style={{ padding: '3px 8px', borderRadius: '4px', fontSize: '0.75rem', fontWeight: '700', color: '#fff', background: colors[status] || '#9CA3AF' }}>{(status || '').toUpperCase()}</span>;
  };

  return (
    <div>
      {/* Summary Cards */}
      {summary && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '0.75rem', marginBottom: '1rem' }}>
          <div className="stat-card">
            <small>Total AR</small>
            <div className="value" style={{ color: '#DC2626' }}>${(summary.totalAR || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}</div>
          </div>
          <div className="stat-card">
            <small>Paid This Month</small>
            <div className="value" style={{ color: '#059669' }}>${parseFloat(summary.paidThisMonth?.amount || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}</div>
            <small>{summary.paidThisMonth?.count || 0} claims</small>
          </div>
          <div className="stat-card">
            <small>Denied</small>
            <div className="value" style={{ color: '#EF4444' }}>{summary.deniedClaims?.count || 0}</div>
            <small>${parseFloat(summary.deniedClaims?.total || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}</small>
          </div>
          <div className="stat-card">
            <small>30-60 Day AR</small>
            <div className="value" style={{ color: '#F59E0B' }}>${parseFloat(summary.aging?.days_30_60 || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}</div>
          </div>
        </div>
      )}

      {/* Actions */}
      <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', marginBottom: '1rem' }}>
        <button className="btn btn-primary" onClick={() => setShowBatchGen(true)}>Generate Claims from EVV</button>
        <button className="btn btn-secondary" onClick={exportEDI} disabled={!selectedClaims.length}>EDI 837P ({selectedClaims.length})</button>
        <button className="btn btn-secondary" onClick={exportMidas} disabled={!selectedClaims.length}>MIDAS Export</button>
        <button className="btn btn-secondary" onClick={exportIRIS} disabled={!selectedClaims.length}>IRIS FEA Export</button>
        <button className="btn btn-secondary" onClick={selectAllPending}>Select All Pending</button>
      </div>

      {/* Batch Generate Modal */}
      {showBatchGen && (
        <div className="modal-overlay" onClick={() => setShowBatchGen(false)}>
          <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: '420px' }}>
            <div className="modal-header">
              <h3>Generate Claims from EVV Visits</h3>
              <button className="modal-close" onClick={() => setShowBatchGen(false)}>x</button>
            </div>
            <p style={{ fontSize: '0.85rem', color: '#6B7280', margin: '0 0 1rem' }}>
              Creates claims for all verified EVV visits that don't already have a claim.
            </p>
            <div className="form-group">
              <label>Start Date</label>
              <input type="date" value={batchDates.startDate} onChange={e => setBatchDates(p => ({ ...p, startDate: e.target.value }))} />
            </div>
            <div className="form-group">
              <label>End Date</label>
              <input type="date" value={batchDates.endDate} onChange={e => setBatchDates(p => ({ ...p, endDate: e.target.value }))} />
            </div>
            <div className="modal-actions">
              <button className="btn btn-secondary" onClick={() => setShowBatchGen(false)}>Cancel</button>
              <button className="btn btn-primary" onClick={batchGenerate}>Generate</button>
            </div>
          </div>
        </div>
      )}

      {/* Filters */}
      <div className="card" style={{ marginBottom: '1rem' }}>
        <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <div className="form-group" style={{ margin: 0 }}>
            <label>Status</label>
            <select value={filter.status} onChange={e => setFilter(p => ({ ...p, status: e.target.value }))}>
              <option value="">All</option>
              {['pending', 'draft', 'ready', 'submitted', 'accepted', 'paid', 'denied', 'voided'].map(s => (
                <option key={s} value={s}>{s.charAt(0).toUpperCase() + s.slice(1)}</option>
              ))}
            </select>
          </div>
          <div className="form-group" style={{ margin: 0 }}>
            <label>Payer</label>
            <select value={filter.payerId} onChange={e => setFilter(p => ({ ...p, payerId: e.target.value }))}>
              <option value="">All Payers</option>
              {payers.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </div>
        </div>
      </div>

      {/* Claims Table */}
      <div className="card">
        {loading ? <div className="loading"><div className="spinner"></div></div> : claims.length === 0 ? (
          <p style={{ color: '#9CA3AF', textAlign: 'center', padding: '2rem' }}>No claims found. Generate claims from verified EVV visits to get started.</p>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table className="table">
              <thead>
                <tr>
                  <th style={{ width: '36px' }}><input type="checkbox" onChange={e => e.target.checked ? selectAllPending() : setSelectedClaims([])} checked={selectedClaims.length > 0} /></th>
                  <th>Claim #</th>
                  <th>Client</th>
                  <th>Payer</th>
                  <th>Service Date</th>
                  <th>Units</th>
                  <th>Amount</th>
                  <th>Status</th>
                  <th>Age</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {claims.map(c => (
                  <tr key={c.id}>
                    <td><input type="checkbox" checked={selectedClaims.includes(c.id)} onChange={() => toggleClaim(c.id)} disabled={c.status === 'paid' || c.status === 'voided'} /></td>
                    <td><strong style={{ fontSize: '0.82rem' }}>{c.claim_number}</strong></td>
                    <td>{c.client_first_name} {c.client_last_name}</td>
                    <td style={{ fontSize: '0.82rem' }}>{c.payer_name || '-'}</td>
                    <td>{c.service_date ? new Date(c.service_date).toLocaleDateString() : c.service_date_from ? new Date(c.service_date_from).toLocaleDateString() : '-'}</td>
                    <td>{c.units_billed || c.units || '-'}</td>
                    <td><strong>${Number(parseFloat(c.charge_amount || 0)).toFixed(2)}</strong></td>
                    <td>{statusBadge(c.status)}</td>
                    <td style={{ fontSize: '0.82rem', color: c.days_since_submission > 60 ? '#EF4444' : c.days_since_submission > 30 ? '#F59E0B' : '#6B7280' }}>
                      {c.days_since_submission ? `${Math.floor(c.days_since_submission)}d` : '-'}
                    </td>
                    <td>
                      <button className="btn btn-sm btn-secondary" onClick={() => { setCurrentClaim(c); setShowStatusModal(true); }}>Update</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Update Status Modal */}
      {showStatusModal && currentClaim && (
        <div className="modal-overlay" onClick={() => setShowStatusModal(false)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h3>Update Claim Status</h3>
              <button className="modal-close" onClick={() => setShowStatusModal(false)}>x</button>
            </div>
            <StatusUpdateForm claim={currentClaim} onSubmit={updateStatus} onCancel={() => setShowStatusModal(false)} />
          </div>
        </div>
      )}
    </div>
  );
};

const StatusUpdateForm = ({ claim, onSubmit, onCancel }) => {
  const [form, setForm] = useState({ claimId: claim.id, status: claim.status, paidAmount: '', denialCode: '', denialReason: '', eobNotes: '' });

  return (
    <form onSubmit={e => { e.preventDefault(); onSubmit(form); }}>
      <p><strong>Claim:</strong> {claim.claim_number} | <strong>Amount:</strong> ${parseFloat(claim.charge_amount || 0).toFixed(2)}</p>
      <div className="form-group">
        <label>New Status</label>
        <select value={form.status} onChange={e => setForm(p => ({ ...p, status: e.target.value }))}>
          {['pending', 'draft', 'ready', 'submitted', 'accepted', 'paid', 'denied', 'voided'].map(s => (
            <option key={s} value={s}>{s.charAt(0).toUpperCase() + s.slice(1)}</option>
          ))}
        </select>
      </div>
      {form.status === 'paid' && (
        <div className="form-group">
          <label>Paid Amount</label>
          <input type="number" step="0.01" value={form.paidAmount} onChange={e => setForm(p => ({ ...p, paidAmount: e.target.value }))} placeholder="Enter amount received" />
        </div>
      )}
      {form.status === 'denied' && (
        <>
          <div className="form-group">
            <label>Denial Code</label>
            <input value={form.denialCode} onChange={e => setForm(p => ({ ...p, denialCode: e.target.value }))} placeholder="e.g. CO-197" />
          </div>
          <div className="form-group">
            <label>Denial Reason</label>
            <textarea value={form.denialReason} onChange={e => setForm(p => ({ ...p, denialReason: e.target.value }))} placeholder="Denial reason" />
          </div>
        </>
      )}
      <div className="form-group">
        <label>EOB Notes</label>
        <textarea value={form.eobNotes} onChange={e => setForm(p => ({ ...p, eobNotes: e.target.value }))} placeholder="Optional notes from EOB" />
      </div>
      <div className="modal-actions">
        <button type="button" className="btn btn-secondary" onClick={onCancel}>Cancel</button>
        <button type="submit" className="btn btn-primary">Update Status</button>
      </div>
    </form>
  );
};

// ═══════════════════════════════════════════════════════════════════════════════
// AUTHORIZATIONS TAB
// ═══════════════════════════════════════════════════════════════════════════════
const AuthorizationsTab = ({ token }) => {
  const [auths, setAuths] = useState([]);
  const [summary, setSummary] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => { loadAuths(); loadSummary(); }, []);

  const loadAuths = async () => {
    try {
      const res = await fetch(`${API_BASE_URL}/api/authorizations?status=active`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (res.ok) setAuths(await res.json());
    } catch (e) {} finally { setLoading(false); }
  };

  const loadSummary = async () => {
    try {
      const res = await fetch(`${API_BASE_URL}/api/authorizations/summary`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (res.ok) setSummary(await res.json());
    } catch (e) {}
  };

  const getHealthColor = (health) => {
    switch (health) {
      case 'ok': return '#059669';
      case 'expiring_soon': return '#F59E0B';
      case 'low': return '#EF4444';
      case 'expired': return '#6B7280';
      default: return '#9CA3AF';
    }
  };

  if (loading) return <div className="loading"><div className="spinner"></div></div>;

  return (
    <div>
      {/* Summary */}
      {summary && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: '0.75rem', marginBottom: '1rem' }}>
          <div className="stat-card"><small>Active</small><div className="value" style={{ color: '#059669' }}>{summary.active || 0}</div></div>
          <div className="stat-card"><small>Expiring Soon</small><div className="value" style={{ color: '#F59E0B' }}>{summary.expiring_soon || 0}</div></div>
          <div className="stat-card"><small>Low Units</small><div className="value" style={{ color: '#EF4444' }}>{summary.low_units || 0}</div></div>
          <div className="stat-card"><small>Exhausted</small><div className="value" style={{ color: '#6B7280' }}>{summary.exhausted || 0}</div></div>
          <div className="stat-card"><small>Expired</small><div className="value">{summary.expired || 0}</div></div>
        </div>
      )}

      {/* Auth Cards with Progress Bars */}
      <div style={{ display: 'grid', gap: '0.75rem' }}>
        {auths.length === 0 ? (
          <p style={{ color: '#9CA3AF', textAlign: 'center', padding: '2rem' }}>No active authorizations.</p>
        ) : auths.map(a => {
          const total = parseFloat(a.authorized_units || 0);
          const used = parseFloat(a.used_units || 0);
          const remaining = Math.max(0, total - used);
          const pct = total > 0 ? Math.min(100, (used / total) * 100) : 0;
          const daysLeft = a.end_date ? Math.ceil((new Date(a.end_date) - new Date()) / 86400000) : null;

          return (
            <div key={a.id} className="card" style={{ padding: '1rem', borderLeft: `4px solid ${getHealthColor(a.health_status)}` }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '0.5rem' }}>
                <div>
                  <strong>{a.client_first} {a.client_last}</strong>
                  <span style={{ color: '#6B7280', fontSize: '0.82rem', marginLeft: '0.75rem' }}>
                    Auth #{a.auth_number || 'N/A'} | {a.payer_name || 'Unknown Payer'}
                  </span>
                </div>
                <span style={{
                  padding: '2px 8px', borderRadius: '4px', fontSize: '0.72rem', fontWeight: '700',
                  color: '#fff', background: getHealthColor(a.health_status),
                }}>
                  {(a.health_status || 'ok').replace('_', ' ').toUpperCase()}
                </span>
              </div>

              {/* Progress Bar */}
              <div style={{ marginBottom: '0.5rem' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.78rem', color: '#6B7280', marginBottom: '4px' }}>
                  <span>{used.toFixed(1)} / {total.toFixed(1)} units used</span>
                  <span style={{ fontWeight: '600', color: remaining < total * 0.1 ? '#EF4444' : '#059669' }}>
                    {remaining.toFixed(1)} remaining
                  </span>
                </div>
                <div style={{ background: '#E5E7EB', borderRadius: '99px', height: '10px', overflow: 'hidden' }}>
                  <div style={{
                    width: `${pct}%`, height: '100%', borderRadius: '99px', transition: 'width 0.3s',
                    background: pct > 90 ? '#EF4444' : pct > 75 ? '#F59E0B' : '#10B981',
                  }} />
                </div>
              </div>

              <div style={{ display: 'flex', gap: '1rem', fontSize: '0.78rem', color: '#6B7280' }}>
                <span>Code: {a.procedure_code || 'T1019'}</span>
                <span>Expires: {a.end_date ? new Date(a.end_date).toLocaleDateString() : 'N/A'}</span>
                {daysLeft !== null && daysLeft <= 30 && (
                  <span style={{ color: daysLeft <= 0 ? '#EF4444' : '#F59E0B', fontWeight: '600' }}>
                    {daysLeft <= 0 ? 'EXPIRED' : `${daysLeft} days left`}
                  </span>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

// ═══════════════════════════════════════════════════════════════════════════════
// DENIALS TAB
// ═══════════════════════════════════════════════════════════════════════════════
const DenialsTab = ({ token }) => {
  const [denials, setDenials] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => { loadDenials(); }, []);

  const loadDenials = async () => {
    try {
      const res = await fetch(`${API_BASE_URL}/api/claims/denial-queue`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (res.ok) setDenials(await res.json());
    } catch (e) {} finally { setLoading(false); }
  };

  const resubmit = async (claimId) => {
    try {
      const res = await fetch(`${API_BASE_URL}/api/claims/${claimId}/resubmit`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }
      });
      if (res.ok) {
        toast('Claim resubmitted', 'success');
        loadDenials();
      } else {
        const data = await res.json();
        toast(data.error || 'Resubmit failed', 'error');
      }
    } catch (e) { toast(e.message, 'error'); }
  };

  if (loading) return <div className="loading"><div className="spinner"></div></div>;

  return (
    <div>
      {denials.length === 0 ? (
        <div className="card" style={{ textAlign: 'center', padding: '2rem', color: '#059669' }}>
          No denied claims. All clear!
        </div>
      ) : (
        <div style={{ display: 'grid', gap: '0.75rem' }}>
          {denials.map(d => (
            <div key={d.id} className="card" style={{ padding: '1rem', borderLeft: '4px solid #EF4444' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '0.5rem' }}>
                <div>
                  <strong>{d.claim_number}</strong>
                  <span style={{ color: '#6B7280', fontSize: '0.85rem', marginLeft: '0.75rem' }}>
                    {d.client_first_name} {d.client_last_name}
                  </span>
                </div>
                <strong style={{ color: '#EF4444' }}>${parseFloat(d.charge_amount || 0).toFixed(2)}</strong>
              </div>

              {/* Denial info */}
              <div style={{ background: '#FEF2F2', borderRadius: '6px', padding: '0.75rem', marginBottom: '0.5rem' }}>
                <div style={{ fontWeight: '600', color: '#991B1B', fontSize: '0.85rem', marginBottom: '0.25rem' }}>
                  {d.denial_code || 'No Code'}: {d.denial_description || d.denial_reason || 'No reason provided'}
                </div>
                {d.common_fix && (
                  <div style={{ fontSize: '0.8rem', color: '#6B7280' }}>
                    Suggested fix: {d.common_fix}
                  </div>
                )}
              </div>

              <div style={{ display: 'flex', gap: '1rem', fontSize: '0.78rem', color: '#6B7280', alignItems: 'center' }}>
                <span>Payer: {d.payer_name || '-'}</span>
                <span>Date: {d.service_date ? new Date(d.service_date).toLocaleDateString() : '-'}</span>
                <span>Auth: {d.auth_number || '-'}</span>
                <div style={{ flex: 1 }} />
                <button className="btn btn-sm btn-primary" onClick={() => resubmit(d.id)}>Resubmit</button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

// ═══════════════════════════════════════════════════════════════════════════════
// PAYMENTS TAB
// ═══════════════════════════════════════════════════════════════════════════════
const PaymentsTab = ({ token }) => {
  const [payments, setPayments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showScanner, setShowScanner] = useState(false);
  const [showManual, setShowManual] = useState(false);
  const [scanResult, setScanResult] = useState(null);
  const [scanning, setScanning] = useState(false);
  const [reconcSummary, setReconcSummary] = useState(null);

  useEffect(() => { loadPayments(); loadReconcSummary(); }, []);

  const loadPayments = async () => {
    try {
      const res = await fetch(`${API_BASE_URL}/api/payments`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (res.ok) setPayments(await res.json());
    } catch (e) {} finally { setLoading(false); }
  };

  const loadReconcSummary = async () => {
    try {
      const res = await fetch(`${API_BASE_URL}/api/payments/reports/reconciliation`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (res.ok) setReconcSummary(await res.json());
    } catch (e) {}
  };

  const scanCheck = async (file) => {
    setScanning(true);
    try {
      const formData = new FormData();
      formData.append('check', file);
      const res = await fetch(`${API_BASE_URL}/api/payments/scan-check`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: formData,
      });
      if (res.ok) {
        const data = await res.json();
        setScanResult(data);
        toast('Check scanned successfully', 'success');
      } else {
        const err = await res.json().catch(() => ({}));
        toast(err.error || 'Scan failed', 'error');
      }
    } catch (e) { toast(e.message, 'error'); }
    finally { setScanning(false); }
  };

  const recordPayment = async (paymentData) => {
    try {
      const res = await fetch(`${API_BASE_URL}/api/payments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(paymentData),
      });
      if (res.ok) {
        const data = await res.json();
        toast(`Payment recorded. ${data.claimsUpdated} claims matched.`, 'success');
        setShowScanner(false); setShowManual(false); setScanResult(null);
        loadPayments(); loadReconcSummary();
      } else {
        const err = await res.json().catch(() => ({}));
        toast(err.error || 'Failed to record payment', 'error');
      }
    } catch (e) { toast(e.message, 'error'); }
  };

  return (
    <div>
      {/* Reconciliation Summary */}
      {reconcSummary?.summary && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: '0.75rem', marginBottom: '1rem' }}>
          <div className="stat-card"><small>Total Received</small><div className="value" style={{ color: '#059669' }}>${parseFloat(reconcSummary.summary.total_received || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}</div></div>
          <div className="stat-card"><small>Matched</small><div className="value">${parseFloat(reconcSummary.summary.total_matched || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}</div></div>
          <div className="stat-card"><small>Underpayments</small><div className="value" style={{ color: '#F59E0B' }}>${parseFloat(reconcSummary.summary.total_underpayments || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}</div></div>
          <div className="stat-card"><small>Reconciled</small><div className="value">{reconcSummary.summary.reconciled_count || 0}</div></div>
        </div>
      )}

      {/* Actions */}
      <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1rem' }}>
        <button className="btn btn-primary" onClick={() => setShowScanner(true)}>Scan Check</button>
        <button className="btn btn-secondary" onClick={() => setShowManual(true)}>Manual Payment</button>
      </div>

      {/* Check Scanner Modal */}
      {showScanner && (
        <div className="modal-overlay" onClick={() => { setShowScanner(false); setScanResult(null); }}>
          <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: '600px' }}>
            <div className="modal-header">
              <h3>AI Check Scanner</h3>
              <button className="modal-close" onClick={() => { setShowScanner(false); setScanResult(null); }}>x</button>
            </div>

            {!scanResult ? (
              <div>
                <p style={{ fontSize: '0.85rem', color: '#6B7280', marginBottom: '1rem' }}>
                  Upload a photo of the check front. AI will extract payer, amount, and match to open claims.
                </p>
                <div style={{ border: '2px dashed #D1D5DB', borderRadius: '8px', padding: '2rem', textAlign: 'center' }}>
                  <input
                    type="file"
                    accept="image/*"
                    onChange={e => e.target.files[0] && scanCheck(e.target.files[0])}
                    style={{ display: 'none' }}
                    id="check-upload"
                  />
                  <label htmlFor="check-upload" style={{ cursor: 'pointer', color: '#2563EB', fontWeight: '600' }}>
                    {scanning ? 'Scanning...' : 'Click to upload check image'}
                  </label>
                  {scanning && <div className="spinner" style={{ margin: '1rem auto' }}></div>}
                </div>
              </div>
            ) : (
              <ScanResultForm
                scanResult={scanResult}
                onSubmit={recordPayment}
                onCancel={() => { setShowScanner(false); setScanResult(null); }}
              />
            )}
          </div>
        </div>
      )}

      {/* Manual Payment Modal */}
      {showManual && (
        <div className="modal-overlay" onClick={() => setShowManual(false)}>
          <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: '500px' }}>
            <div className="modal-header">
              <h3>Record Payment</h3>
              <button className="modal-close" onClick={() => setShowManual(false)}>x</button>
            </div>
            <ManualPaymentForm token={token} onSubmit={recordPayment} onCancel={() => setShowManual(false)} />
          </div>
        </div>
      )}

      {/* Payments List */}
      <div className="card">
        {loading ? <div className="loading"><div className="spinner"></div></div> : payments.length === 0 ? (
          <p style={{ color: '#9CA3AF', textAlign: 'center', padding: '2rem' }}>No payments recorded yet.</p>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>Date</th>
                <th>Payer</th>
                <th>Check #</th>
                <th>Amount</th>
                <th>Matched</th>
                <th>Status</th>
                <th>Claims</th>
              </tr>
            </thead>
            <tbody>
              {payments.map(p => (
                <tr key={p.id}>
                  <td>{p.payment_date ? new Date(p.payment_date).toLocaleDateString() : '-'}</td>
                  <td>{p.payer_display_name || p.payer_name}</td>
                  <td>{p.check_number || '-'}</td>
                  <td><strong>${parseFloat(p.check_amount || 0).toFixed(2)}</strong></td>
                  <td>${parseFloat(p.total_matched || 0).toFixed(2)}</td>
                  <td>
                    <span style={{
                      padding: '2px 6px', borderRadius: '4px', fontSize: '0.72rem', fontWeight: '700', color: '#fff',
                      background: p.reconciliation_status === 'reconciled' ? '#059669' : p.reconciliation_status === 'partial' ? '#F59E0B' : '#EF4444',
                    }}>
                      {(p.reconciliation_status || '').toUpperCase()}
                    </span>
                  </td>
                  <td>{p.match_count || 0}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
};

const ScanResultForm = ({ scanResult, onSubmit, onCancel }) => {
  const ex = scanResult.extracted || {};
  const [form, setForm] = useState({
    payerId: scanResult.suggestedPayer?.id || '',
    payerName: ex.payerName || scanResult.suggestedPayer?.name || '',
    checkNumber: ex.checkNumber || '',
    checkDate: ex.checkDate || '',
    checkAmount: ex.amount || '',
    paymentMethod: 'check',
    claimMatches: (scanResult.suggestedMatches || []).map(m => ({
      claimId: m.claimId, amount: m.chargeAmount, claimNumber: m.claimNumber, matchType: 'auto'
    })),
  });

  return (
    <form onSubmit={e => { e.preventDefault(); onSubmit(form); }}>
      <div style={{ background: '#F0FDF4', borderRadius: '6px', padding: '0.75rem', marginBottom: '1rem', fontSize: '0.85rem' }}>
        <strong>AI Extracted:</strong> {ex.payerName || 'Unknown'} | ${ex.amount || '?'} | Check #{ex.checkNumber || '?'} | {ex.checkDate || '?'}
        {ex.confidence && <span style={{ marginLeft: '0.5rem', opacity: 0.7 }}>({ex.confidence} confidence)</span>}
      </div>

      <div className="form-group">
        <label>Payer Name</label>
        <input value={form.payerName} onChange={e => setForm(p => ({ ...p, payerName: e.target.value }))} />
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
        <div className="form-group">
          <label>Check #</label>
          <input value={form.checkNumber} onChange={e => setForm(p => ({ ...p, checkNumber: e.target.value }))} />
        </div>
        <div className="form-group">
          <label>Check Date</label>
          <input type="date" value={form.checkDate} onChange={e => setForm(p => ({ ...p, checkDate: e.target.value }))} />
        </div>
      </div>
      <div className="form-group">
        <label>Amount</label>
        <input type="number" step="0.01" value={form.checkAmount} onChange={e => setForm(p => ({ ...p, checkAmount: e.target.value }))} />
      </div>

      {form.claimMatches.length > 0 && (
        <div style={{ marginBottom: '1rem' }}>
          <label style={{ fontWeight: '600', fontSize: '0.85rem' }}>Auto-Matched Claims:</label>
          {form.claimMatches.map((m, i) => (
            <div key={i} style={{ display: 'flex', justifyContent: 'space-between', padding: '0.4rem 0', borderBottom: '1px solid #E5E7EB', fontSize: '0.85rem' }}>
              <span>{m.claimNumber}</span>
              <strong>${parseFloat(m.amount || 0).toFixed(2)}</strong>
            </div>
          ))}
          {scanResult.unmatchedAmount > 0.01 && (
            <div style={{ color: '#F59E0B', fontSize: '0.82rem', marginTop: '0.25rem' }}>
              ${scanResult.unmatchedAmount.toFixed(2)} unmatched
            </div>
          )}
        </div>
      )}

      <div className="modal-actions">
        <button type="button" className="btn btn-secondary" onClick={onCancel}>Cancel</button>
        <button type="submit" className="btn btn-primary">Record Payment</button>
      </div>
    </form>
  );
};

const ManualPaymentForm = ({ token, onSubmit, onCancel }) => {
  const [form, setForm] = useState({ payerName: '', checkNumber: '', checkDate: '', checkAmount: '', paymentMethod: 'check', notes: '', claimMatches: [] });
  const [openClaims, setOpenClaims] = useState([]);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch(`${API_BASE_URL}/api/claims?status=submitted`, {
          headers: { Authorization: `Bearer ${token}` }
        });
        if (res.ok) setOpenClaims(await res.json());
      } catch (e) {}
    })();
  }, []);

  const toggleMatch = (claim) => {
    setForm(prev => {
      const exists = prev.claimMatches.find(m => m.claimId === claim.id);
      return {
        ...prev,
        claimMatches: exists
          ? prev.claimMatches.filter(m => m.claimId !== claim.id)
          : [...prev.claimMatches, { claimId: claim.id, amount: claim.charge_amount, claimNumber: claim.claim_number, matchType: 'manual' }]
      };
    });
  };

  return (
    <form onSubmit={e => { e.preventDefault(); onSubmit(form); }}>
      <div className="form-group">
        <label>Payer Name</label>
        <input value={form.payerName} onChange={e => setForm(p => ({ ...p, payerName: e.target.value }))} required />
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
        <div className="form-group">
          <label>Check #</label>
          <input value={form.checkNumber} onChange={e => setForm(p => ({ ...p, checkNumber: e.target.value }))} />
        </div>
        <div className="form-group">
          <label>Amount</label>
          <input type="number" step="0.01" value={form.checkAmount} onChange={e => setForm(p => ({ ...p, checkAmount: e.target.value }))} required />
        </div>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
        <div className="form-group">
          <label>Check Date</label>
          <input type="date" value={form.checkDate} onChange={e => setForm(p => ({ ...p, checkDate: e.target.value }))} />
        </div>
        <div className="form-group">
          <label>Method</label>
          <select value={form.paymentMethod} onChange={e => setForm(p => ({ ...p, paymentMethod: e.target.value }))}>
            <option value="check">Check</option>
            <option value="eft">EFT</option>
            <option value="ach">ACH</option>
            <option value="other">Other</option>
          </select>
        </div>
      </div>

      {openClaims.length > 0 && (
        <div style={{ marginBottom: '1rem' }}>
          <label style={{ fontWeight: '600', fontSize: '0.85rem' }}>Match to Open Claims:</label>
          <div style={{ maxHeight: '200px', overflowY: 'auto', border: '1px solid #E5E7EB', borderRadius: '6px', marginTop: '0.25rem' }}>
            {openClaims.slice(0, 20).map(c => {
              const isSelected = form.claimMatches.some(m => m.claimId === c.id);
              return (
                <div key={c.id} onClick={() => toggleMatch(c)} style={{
                  display: 'flex', justifyContent: 'space-between', padding: '0.5rem 0.75rem',
                  cursor: 'pointer', background: isSelected ? '#EFF6FF' : 'transparent',
                  borderBottom: '1px solid #F3F4F6', fontSize: '0.82rem',
                }}>
                  <span>
                    <input type="checkbox" checked={isSelected} readOnly style={{ marginRight: '0.5rem' }} />
                    {c.claim_number} - {c.client_first_name} {c.client_last_name}
                  </span>
                  <strong>${parseFloat(c.charge_amount || 0).toFixed(2)}</strong>
                </div>
              );
            })}
          </div>
        </div>
      )}

      <div className="form-group">
        <label>Notes</label>
        <textarea value={form.notes} onChange={e => setForm(p => ({ ...p, notes: e.target.value }))} placeholder="Optional" />
      </div>

      <div className="modal-actions">
        <button type="button" className="btn btn-secondary" onClick={onCancel}>Cancel</button>
        <button type="submit" className="btn btn-primary">Record Payment</button>
      </div>
    </form>
  );
};

export default BillingEngine;
