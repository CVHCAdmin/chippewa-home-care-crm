// src/components/admin/ClaimsManagement.jsx
import React, { useState, useEffect } from 'react';
import { API_BASE_URL } from '../../config';

const ClaimsManagement = ({ token }) => {
  const [claims, setClaims] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState({ status: '', payerId: '' });
  const [payers, setPayers] = useState([]);
  const [selectedClaims, setSelectedClaims] = useState([]);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showStatusModal, setShowStatusModal] = useState(false);
  const [currentClaim, setCurrentClaim] = useState(null);
  const [invoices, setInvoices] = useState([]);
  const [summary, setSummary] = useState(null);

  useEffect(() => {
    loadClaims();
    loadPayers();
    loadSummary();
  }, [filter]);

  const loadClaims = async () => {
    try {
      const params = new URLSearchParams();
      if (filter.status) params.append('status', filter.status);
      if (filter.payerId) params.append('payerId', filter.payerId);
      
      const res = await fetch(`${API_BASE_URL}/api/claims?${params}`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      const data = await res.json();
      setClaims(Array.isArray(data) ? data : []);
    } catch (error) {
      console.error('Failed to load claims:', error);
    } finally {
      setLoading(false);
    }
  };

  const loadPayers = async () => {
    try {
      const res = await fetch(`${API_BASE_URL}/api/referral-sources`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      const data = await res.json();
      setPayers(Array.isArray(data) ? data : []);
    } catch (error) {
      console.error('Failed to load payers:', error);
    }
  };

  const loadSummary = async () => {
    try {
      const res = await fetch(`${API_BASE_URL}/api/claims/reports/summary`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      const data = await res.json();
      setSummary(data);
    } catch (error) {
      console.error('Failed to load summary:', error);
    }
  };

  const loadInvoices = async () => {
    try {
      const res = await fetch(`${API_BASE_URL}/api/invoices?status=pending`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      const data = await res.json();
      setInvoices(Array.isArray(data) ? data : []);
    } catch (error) {
      console.error('Failed to load invoices:', error);
    }
  };

  const createClaim = async (formData) => {
    try {
      const res = await fetch(`${API_BASE_URL}/api/claims`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify(formData)
      });
      if (res.ok) {
        setShowCreateModal(false);
        loadClaims();
        loadSummary();
      }
    } catch (error) {
      alert('Failed to create claim: ' + error.message);
    }
  };

  const updateClaimStatus = async (status, additionalData = {}) => {
    try {
      const res = await fetch(`${API_BASE_URL}/api/claims/${currentClaim.id}/status`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ status, ...additionalData })
      });
      if (res.ok) {
        setShowStatusModal(false);
        setCurrentClaim(null);
        loadClaims();
        loadSummary();
      }
    } catch (error) {
      alert('Failed to update status: ' + error.message);
    }
  };

  const export837P = async () => {
    if (selectedClaims.length === 0) {
      alert('Select at least one claim to export');
      return;
    }
    try {
      const res = await fetch(`${API_BASE_URL}/api/claims/export/837p`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ claimIds: selectedClaims })
      });
      if (res.ok) {
        const blob = await res.blob();
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `claims-837p-${new Date().toISOString().split('T')[0]}.edi`;
        a.click();
        loadClaims();
        setSelectedClaims([]);
      }
    } catch (error) {
      alert('Failed to export: ' + error.message);
    }
  };

  const toggleClaimSelection = (claimId) => {
    setSelectedClaims(prev => 
      prev.includes(claimId) 
        ? prev.filter(id => id !== claimId)
        : [...prev, claimId]
    );
  };

  const selectAllDraft = () => {
    const draftIds = claims.filter(c => c.status === 'draft' || c.status === 'ready').map(c => c.id);
    setSelectedClaims(draftIds);
  };

  const getStatusBadge = (status) => {
    const colors = {
      draft: '#9e9e9e',
      ready: '#2196f3',
      submitted: '#ff9800',
      accepted: '#8bc34a',
      paid: '#4caf50',
      rejected: '#f44336',
      denied: '#f44336'
    };
    return (
      <span style={{
        padding: '4px 8px',
        borderRadius: '4px',
        fontSize: '0.8rem',
        fontWeight: 'bold',
        color: 'white',
        backgroundColor: colors[status] || '#9e9e9e'
      }}>
        {status?.toUpperCase()}
      </span>
    );
  };

  return (
    <div>
      <div className="page-header">
        <h2>💼 Claims Management</h2>
        <div style={{ display: 'flex', gap: '0.5rem' }}>
          <button className="btn btn-primary" onClick={() => { loadInvoices(); setShowCreateModal(true); }}>
            + New Claim
          </button>
          <button 
            className="btn btn-secondary" 
            onClick={export837P}
            disabled={selectedClaims.length === 0}
          >
            📤 Export 837P ({selectedClaims.length})
          </button>
        </div>
      </div>

      {/* Summary Cards */}
      {summary && (
        <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', marginBottom: '1rem' }}>
          <div className="stat-card">
            <h4>Pending</h4>
            <div className="value">${(parseFloat(summary.aging?.under_30) || 0).toLocaleString()}</div>
            <small>&lt; 30 days</small>
          </div>
          <div className="stat-card">
            <h4>30-60 Days</h4>
            <div className="value" style={{ color: '#ff9800' }}>${(parseFloat(summary.aging?.days_30_60) || 0).toLocaleString()}</div>
          </div>
          <div className="stat-card">
            <h4>60-90 Days</h4>
            <div className="value" style={{ color: '#f44336' }}>${(parseFloat(summary.aging?.days_60_90) || 0).toLocaleString()}</div>
          </div>
          <div className="stat-card">
            <h4>90+ Days</h4>
            <div className="value" style={{ color: '#b71c1c' }}>${(parseFloat(summary.aging?.over_90) || 0).toLocaleString()}</div>
          </div>
        </div>
      )}

      {/* Filters */}
      <div className="card" style={{ marginBottom: '1rem' }}>
        <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap', alignItems: 'center' }}>
          <div className="form-group" style={{ margin: 0 }}>
            <label>Status</label>
            <select value={filter.status} onChange={(e) => setFilter({ ...filter, status: e.target.value })}>
              <option value="">All Statuses</option>
              <option value="draft">Draft</option>
              <option value="ready">Ready</option>
              <option value="submitted">Submitted</option>
              <option value="accepted">Accepted</option>
              <option value="paid">Paid</option>
              <option value="rejected">Rejected</option>
              <option value="denied">Denied</option>
            </select>
          </div>
          <div className="form-group" style={{ margin: 0 }}>
            <label>Payer</label>
            <select value={filter.payerId} onChange={(e) => setFilter({ ...filter, payerId: e.target.value })}>
              <option value="">All Payers</option>
              {payers.map(p => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          </div>
          <button className="btn btn-secondary" onClick={selectAllDraft} style={{ marginTop: '1.5rem' }}>
            Select All Draft/Ready
          </button>
        </div>
      </div>

      {/* Claims Table */}
      <div className="card">
        {loading ? (
          <div className="loading"><div className="spinner"></div></div>
        ) : claims.length === 0 ? (
          <p>No claims found. Create a claim from an invoice to get started.</p>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th style={{ width: '40px' }}>
                  <input 
                    type="checkbox" 
                    onChange={(e) => e.target.checked ? selectAllDraft() : setSelectedClaims([])}
                    checked={selectedClaims.length > 0}
                  />
                </th>
                <th>Claim #</th>
                <th>Client</th>
                <th>Payer</th>
                <th>Service Date</th>
                <th>Amount</th>
                <th>Status</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {claims.map(claim => (
                <tr key={claim.id}>
                  <td>
                    <input 
                      type="checkbox"
                      checked={selectedClaims.includes(claim.id)}
                      onChange={() => toggleClaimSelection(claim.id)}
                      disabled={claim.status === 'paid' || claim.status === 'denied'}
                    />
                  </td>
                  <td><strong>{claim.claim_number}</strong></td>
                  <td>{claim.client_first_name} {claim.client_last_name}</td>
                  <td>{claim.payer_name}</td>
                  <td>{claim.service_date_from ? new Date(claim.service_date_from).toLocaleDateString() : '-'}</td>
                  <td><strong>${(parseFloat(claim.charge_amount) || 0).toFixed(2)}</strong></td>
                  <td>{getStatusBadge(claim.status)}</td>
                  <td>
                    <button 
                      className="btn btn-sm btn-secondary"
                      onClick={() => { setCurrentClaim(claim); setShowStatusModal(true); }}
                    >
                      Update
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Create Claim Modal */}
      {showCreateModal && (
        <div className="modal-overlay" onClick={() => setShowCreateModal(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3>Create Claim from Invoice</h3>
              <button className="modal-close" onClick={() => setShowCreateModal(false)}>×</button>
            </div>
            <CreateClaimForm 
              invoices={invoices} 
              onSubmit={createClaim} 
              onCancel={() => setShowCreateModal(false)} 
            />
          </div>
        </div>
      )}

      {/* Update Status Modal */}
      {showStatusModal && currentClaim && (
        <div className="modal-overlay" onClick={() => setShowStatusModal(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3>Update Claim Status</h3>
              <button className="modal-close" onClick={() => setShowStatusModal(false)}>×</button>
            </div>
            <UpdateStatusForm 
              claim={currentClaim} 
              onSubmit={updateClaimStatus} 
              onCancel={() => setShowStatusModal(false)} 
            />
          </div>
        </div>
      )}
    </div>
  );
};

// Create Claim Form Component
const CreateClaimForm = ({ invoices, onSubmit, onCancel }) => {
  const [formData, setFormData] = useState({
    invoiceId: '',
    procedureCode: 'T1019',
    diagnosisCode: 'Z7689',
    modifier: '',
    placeOfService: '12'
  });

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!formData.invoiceId) {
      alert('Please select an invoice');
      return;
    }
    onSubmit(formData);
  };

  return (
    <form onSubmit={handleSubmit}>
      <div className="form-group">
        <label>Invoice *</label>
        <select 
          value={formData.invoiceId} 
          onChange={(e) => setFormData({ ...formData, invoiceId: e.target.value })}
          required
        >
          <option value="">Select Invoice</option>
          {invoices.map(inv => (
            <option key={inv.id} value={inv.id}>
              {inv.invoice_number} - {inv.client_first_name} {inv.client_last_name} - ${(parseFloat(inv.total) || 0).toFixed(2)}
            </option>
          ))}
        </select>
      </div>
      <div className="form-group">
        <label>Procedure Code (CPT/HCPCS)</label>
        <input 
          type="text" 
          value={formData.procedureCode}
          onChange={(e) => setFormData({ ...formData, procedureCode: e.target.value })}
          placeholder="e.g., T1019, S5125"
        />
      </div>
      <div className="form-group">
        <label>Diagnosis Code (ICD-10)</label>
        <input 
          type="text" 
          value={formData.diagnosisCode}
          onChange={(e) => setFormData({ ...formData, diagnosisCode: e.target.value })}
          placeholder="e.g., Z7689"
        />
      </div>
      <div className="form-group">
        <label>Modifier</label>
        <input 
          type="text" 
          value={formData.modifier}
          onChange={(e) => setFormData({ ...formData, modifier: e.target.value })}
          placeholder="e.g., GT, 95"
        />
      </div>
      <div className="form-group">
        <label>Place of Service</label>
        <select 
          value={formData.placeOfService}
          onChange={(e) => setFormData({ ...formData, placeOfService: e.target.value })}
        >
          <option value="12">12 - Home</option>
          <option value="11">11 - Office</option>
          <option value="99">99 - Other</option>
        </select>
      </div>
      <div className="modal-actions">
        <button type="button" className="btn btn-secondary" onClick={onCancel}>Cancel</button>
        <button type="submit" className="btn btn-primary">Create Claim</button>
      </div>
    </form>
  );
};

// Update Status Form Component
const UpdateStatusForm = ({ claim, onSubmit, onCancel }) => {
  const [status, setStatus] = useState(claim.status);
  const [paidAmount, setPaidAmount] = useState('');
  const [denialReason, setDenialReason] = useState('');
  const [notes, setNotes] = useState('');

  const handleSubmit = (e) => {
    e.preventDefault();
    const additionalData = {};
    if (status === 'paid') additionalData.paidAmount = parseFloat(paidAmount);
    if (status === 'denied') additionalData.denialReason = denialReason;
    additionalData.notes = notes;
    onSubmit(status, additionalData);
  };

  return (
    <form onSubmit={handleSubmit}>
      <p><strong>Claim:</strong> {claim.claim_number}</p>
      <p><strong>Amount:</strong> ${(parseFloat(claim.charge_amount) || 0).toFixed(2)}</p>
      
      <div className="form-group">
        <label>New Status</label>
        <select value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="draft">Draft</option>
          <option value="ready">Ready to Submit</option>
          <option value="submitted">Submitted</option>
          <option value="accepted">Accepted</option>
          <option value="paid">Paid</option>
          <option value="rejected">Rejected</option>
          <option value="denied">Denied</option>
        </select>
      </div>

      {status === 'paid' && (
        <div className="form-group">
          <label>Paid Amount</label>
          <input 
            type="number" 
            step="0.01"
            value={paidAmount}
            onChange={(e) => setPaidAmount(e.target.value)}
            placeholder="Enter amount received"
          />
        </div>
      )}

      {status === 'denied' && (
        <div className="form-group">
          <label>Denial Reason</label>
          <textarea 
            value={denialReason}
            onChange={(e) => setDenialReason(e.target.value)}
            placeholder="Enter denial reason/code"
          />
        </div>
      )}

      <div className="form-group">
        <label>Notes</label>
        <textarea 
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Optional notes"
        />
      </div>

      <div className="modal-actions">
        <button type="button" className="btn btn-secondary" onClick={onCancel}>Cancel</button>
        <button type="submit" className="btn btn-primary">Update Status</button>
      </div>
    </form>
  );
};

export default ClaimsManagement;
