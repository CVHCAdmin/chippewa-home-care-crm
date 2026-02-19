import { toast } from '../Toast';
// src/components/admin/BackgroundChecks.jsx
import React, { useState, useEffect } from 'react';
import { API_BASE_URL } from '../../config';

const BackgroundChecks = ({ token }) => {
  const [checks, setChecks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState({ status: '', type: '' });
  const [showAddModal, setShowAddModal] = useState(false);
  const [showDetailModal, setShowDetailModal] = useState(false);
  const [currentCheck, setCurrentCheck] = useState(null);
  const [caregivers, setCaregivers] = useState([]);

  const checkTypes = [
    { id: 'criminal', name: 'Criminal Background', icon: '🔍' },
    { id: 'sex_offender', name: 'Sex Offender Registry', icon: '⚠️' },
    { id: 'caregiver_registry', name: 'Caregiver Registry (WI)', icon: '📋' },
    { id: 'oci', name: 'OCI Misconduct', icon: '🏛️' },
    { id: 'driving', name: 'Driving Record', icon: '🚗' },
    { id: 'drug_screen', name: 'Drug Screen', icon: '🧪' },
    { id: 'reference', name: 'Reference Check', icon: '📞' },
    { id: 'employment_verification', name: 'Employment Verification', icon: '💼' },
    { id: 'education_verification', name: 'Education Verification', icon: '🎓' },
    { id: 'professional_license', name: 'Professional License', icon: '📜' }
  ];

  useEffect(() => {
    loadChecks();
    loadCaregivers();
  }, [filter]);

  const loadChecks = async () => {
    try {
      const params = new URLSearchParams();
      if (filter.status) params.append('status', filter.status);
      if (filter.type) params.append('type', filter.type);
      
      const res = await fetch(`${API_BASE_URL}/api/background-checks?${params}`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      const data = await res.json();
      setChecks(Array.isArray(data) ? data : []);
    } catch (error) {
      console.error('Failed to load checks:', error);
    } finally {
      setLoading(false);
    }
  };

  const loadCaregivers = async () => {
    try {
      const res = await fetch(`${API_BASE_URL}/api/caregivers`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      const data = await res.json();
      setCaregivers(Array.isArray(data) ? data : []);
    } catch (error) {
      console.error('Failed to load caregivers:', error);
    }
  };

  const createCheck = async (formData) => {
    try {
      const res = await fetch(`${API_BASE_URL}/api/background-checks`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify(formData)
      });
      if (res.ok) {
        setShowAddModal(false);
        loadChecks();
      } else {
        const err = await res.json();
        toast('Failed: ' + err.error, 'error');
      }
    } catch (error) {
      toast('Failed: ' + error.message, 'error');
    }
  };

  const updateCheck = async (checkId, updateData) => {
    try {
      const res = await fetch(`${API_BASE_URL}/api/background-checks/${checkId}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify(updateData)
      });
      if (res.ok) {
        setShowDetailModal(false);
        setCurrentCheck(null);
        loadChecks();
      } else {
        const err = await res.json();
        toast('Failed: ' + err.error, 'error');
      }
    } catch (error) {
      toast('Failed: ' + error.message, 'error');
    }
  };

  const getStatusBadge = (status) => {
    const colors = {
      pending: '#ff9800',
      in_progress: '#2196f3',
      completed: '#4caf50',
      failed: '#f44336',
      expired: '#9e9e9e'
    };
    return (
      <span style={{
        padding: '3px 8px',
        borderRadius: '4px',
        fontSize: '0.75rem',
        fontWeight: 'bold',
        color: 'white',
        backgroundColor: colors[status] || '#9e9e9e'
      }}>
        {status?.replace(/_/g, ' ').toUpperCase()}
      </span>
    );
  };

  const getResultBadge = (result) => {
    if (!result) return null;
    const colors = {
      clear: '#4caf50',
      flagged: '#ff9800',
      disqualifying: '#f44336'
    };
    return (
      <span style={{
        padding: '3px 8px',
        borderRadius: '4px',
        fontSize: '0.75rem',
        fontWeight: 'bold',
        color: 'white',
        backgroundColor: colors[result] || '#9e9e9e'
      }}>
        {result?.toUpperCase()}
      </span>
    );
  };

  const getTypeIcon = (typeId) => {
    const type = checkTypes.find(t => t.id === typeId);
    return type?.icon || '📋';
  };

  const getTypeName = (typeId) => {
    const type = checkTypes.find(t => t.id === typeId);
    return type?.name || typeId;
  };

  const isExpiringSoon = (expirationDate) => {
    if (!expirationDate) return false;
    const expDate = new Date(expirationDate);
    const thirtyDaysFromNow = new Date();
    thirtyDaysFromNow.setDate(thirtyDaysFromNow.getDate() + 30);
    return expDate <= thirtyDaysFromNow && expDate > new Date();
  };

  const isExpired = (expirationDate) => {
    if (!expirationDate) return false;
    return new Date(expirationDate) < new Date();
  };

  const pendingCount = checks.filter(c => c.status === 'pending').length;
  const expiringSoonCount = checks.filter(c => isExpiringSoon(c.expiration_date)).length;
  const expiredCount = checks.filter(c => isExpired(c.expiration_date)).length;

  return (
    <div>
      <div className="page-header">
        <h2>🔒 Background Checks</h2>
        <button className="btn btn-primary" onClick={() => setShowAddModal(true)}>
          + New Background Check
        </button>
      </div>

      {/* Summary Cards */}
      <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', marginBottom: '1rem' }}>
        <div 
          className="stat-card" 
          onClick={() => setFilter({ ...filter, status: 'pending' })}
          style={{ cursor: 'pointer' }}
        >
          <h4>Pending</h4>
          <div className="value" style={{ color: '#ff9800' }}>{pendingCount}</div>
        </div>
        <div 
          className="stat-card" 
          onClick={() => setFilter({ ...filter, status: '' })}
          style={{ cursor: 'pointer' }}
        >
          <h4>Expiring Soon</h4>
          <div className="value" style={{ color: '#ff9800' }}>{expiringSoonCount}</div>
          <small>Within 30 days</small>
        </div>
        <div 
          className="stat-card" 
          style={{ cursor: 'pointer' }}
        >
          <h4>Expired</h4>
          <div className="value" style={{ color: '#f44336' }}>{expiredCount}</div>
        </div>
        <div 
          className="stat-card" 
          onClick={() => setFilter({ status: '', type: '' })}
          style={{ cursor: 'pointer' }}
        >
          <h4>Total</h4>
          <div className="value">{checks.length}</div>
        </div>
      </div>

      {/* Filters */}
      <div className="card" style={{ marginBottom: '1rem' }}>
        <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap' }}>
          <div className="form-group" style={{ margin: 0 }}>
            <label>Status</label>
            <select value={filter.status} onChange={(e) => setFilter({ ...filter, status: e.target.value })}>
              <option value="">All Statuses</option>
              <option value="pending">Pending</option>
              <option value="in_progress">In Progress</option>
              <option value="completed">Completed</option>
              <option value="failed">Failed</option>
            </select>
          </div>
          <div className="form-group" style={{ margin: 0 }}>
            <label>Check Type</label>
            <select value={filter.type} onChange={(e) => setFilter({ ...filter, type: e.target.value })}>
              <option value="">All Types</option>
              {checkTypes.map(t => (
                <option key={t.id} value={t.id}>{t.name}</option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {/* Checks Table */}
      <div className="card">
        {loading ? (
          <div className="loading"><div className="spinner"></div></div>
        ) : checks.length === 0 ? (
          <p>No background checks found.</p>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th style={{ width: '40px' }}></th>
                <th>Caregiver</th>
                <th>Check Type</th>
                <th>Status</th>
                <th>Result</th>
                <th>Initiated</th>
                <th>Completed</th>
                <th>Expires</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {checks.map(check => (
                <tr key={check.id} style={{ 
                  backgroundColor: isExpired(check.expiration_date) ? '#ffebee' : 
                                   isExpiringSoon(check.expiration_date) ? '#fff3e0' : 'transparent'
                }}>
                  <td style={{ fontSize: '1.3rem' }}>{getTypeIcon(check.check_type)}</td>
                  <td><strong>{check.caregiver_first} {check.caregiver_last}</strong></td>
                  <td>{getTypeName(check.check_type)}</td>
                  <td>{getStatusBadge(check.status)}</td>
                  <td>{getResultBadge(check.result)}</td>
                  <td style={{ fontSize: '0.85rem' }}>
                    {check.initiated_date ? new Date(check.initiated_date).toLocaleDateString() : '-'}
                  </td>
                  <td style={{ fontSize: '0.85rem' }}>
                    {check.completed_date ? new Date(check.completed_date).toLocaleDateString() : '-'}
                  </td>
                  <td>
                    {check.expiration_date ? (
                      <span style={{ 
                        color: isExpired(check.expiration_date) ? '#f44336' : 
                               isExpiringSoon(check.expiration_date) ? '#ff9800' : '#333',
                        fontWeight: isExpired(check.expiration_date) || isExpiringSoon(check.expiration_date) ? 'bold' : 'normal'
                      }}>
                        {new Date(check.expiration_date).toLocaleDateString()}
                        {isExpired(check.expiration_date) && ' ⚠️'}
                      </span>
                    ) : '-'}
                  </td>
                  <td>
                    <button 
                      className="btn btn-sm btn-secondary"
                      onClick={() => { setCurrentCheck(check); setShowDetailModal(true); }}
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

      {/* Add Check Modal */}
      {showAddModal && (
        <div className="modal-overlay" onClick={() => setShowAddModal(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3>New Background Check</h3>
              <button className="modal-close" onClick={() => setShowAddModal(false)}>×</button>
            </div>
            <AddCheckForm 
              caregivers={caregivers}
              checkTypes={checkTypes}
              onSubmit={createCheck}
              onCancel={() => setShowAddModal(false)}
            />
          </div>
        </div>
      )}

      {/* Update Check Modal */}
      {showDetailModal && currentCheck && (
        <div className="modal-overlay" onClick={() => setShowDetailModal(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3>Update Background Check</h3>
              <button className="modal-close" onClick={() => setShowDetailModal(false)}>×</button>
            </div>
            <UpdateCheckForm 
              check={currentCheck}
              onSubmit={(data) => updateCheck(currentCheck.id, data)}
              onCancel={() => setShowDetailModal(false)}
            />
          </div>
        </div>
      )}
    </div>
  );
};

// Add Check Form Component
const AddCheckForm = ({ caregivers, checkTypes, onSubmit, onCancel }) => {
  const [formData, setFormData] = useState({
    caregiverId: '',
    checkType: '',
    provider: '',
    cost: '',
    notes: ''
  });

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!formData.caregiverId || !formData.checkType) {
      toast('Please select caregiver and check type');
      return;
    }
    onSubmit(formData);
  };

  return (
    <form onSubmit={handleSubmit}>
      <div className="form-group">
        <label>Caregiver *</label>
        <select 
          value={formData.caregiverId}
          onChange={(e) => setFormData({ ...formData, caregiverId: e.target.value })}
          required
        >
          <option value="">Select Caregiver</option>
          {caregivers.map(c => (
            <option key={c.id} value={c.id}>{c.first_name} {c.last_name}</option>
          ))}
        </select>
      </div>

      <div className="form-group">
        <label>Check Type *</label>
        <select 
          value={formData.checkType}
          onChange={(e) => setFormData({ ...formData, checkType: e.target.value })}
          required
        >
          <option value="">Select Type</option>
          {checkTypes.map(t => (
            <option key={t.id} value={t.id}>{t.icon} {t.name}</option>
          ))}
        </select>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
        <div className="form-group">
          <label>Provider</label>
          <input 
            type="text"
            value={formData.provider}
            onChange={(e) => setFormData({ ...formData, provider: e.target.value })}
            placeholder="e.g., Checkr, GoodHire"
          />
        </div>
        <div className="form-group">
          <label>Cost ($)</label>
          <input 
            type="number"
            step="0.01"
            value={formData.cost}
            onChange={(e) => setFormData({ ...formData, cost: e.target.value })}
            placeholder="0.00"
          />
        </div>
      </div>

      <div className="form-group">
        <label>Notes</label>
        <textarea 
          value={formData.notes}
          onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
          placeholder="Any notes..."
        />
      </div>

      <div className="modal-actions">
        <button type="button" className="btn btn-secondary" onClick={onCancel}>Cancel</button>
        <button type="submit" className="btn btn-primary">Create Check</button>
      </div>
    </form>
  );
};

// Update Check Form Component
const UpdateCheckForm = ({ check, onSubmit, onCancel }) => {
  const [formData, setFormData] = useState({
    status: check.status || 'pending',
    result: check.result || '',
    completedDate: check.completed_date?.split('T')[0] || '',
    expirationDate: check.expiration_date?.split('T')[0] || '',
    referenceNumber: check.reference_number || '',
    findings: check.findings || '',
    notes: check.notes || ''
  });

  const handleSubmit = (e) => {
    e.preventDefault();
    onSubmit(formData);
  };

  return (
    <form onSubmit={handleSubmit}>
      <p><strong>Caregiver:</strong> {check.caregiver_first} {check.caregiver_last}</p>
      <p><strong>Check Type:</strong> {check.check_type}</p>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
        <div className="form-group">
          <label>Status</label>
          <select 
            value={formData.status}
            onChange={(e) => setFormData({ ...formData, status: e.target.value })}
          >
            <option value="pending">Pending</option>
            <option value="in_progress">In Progress</option>
            <option value="completed">Completed</option>
            <option value="failed">Failed</option>
          </select>
        </div>
        <div className="form-group">
          <label>Result</label>
          <select 
            value={formData.result}
            onChange={(e) => setFormData({ ...formData, result: e.target.value })}
          >
            <option value="">Not Yet</option>
            <option value="clear">Clear</option>
            <option value="flagged">Flagged (Review Required)</option>
            <option value="disqualifying">Disqualifying</option>
          </select>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
        <div className="form-group">
          <label>Completed Date</label>
          <input 
            type="date"
            value={formData.completedDate}
            onChange={(e) => setFormData({ ...formData, completedDate: e.target.value })}
          />
        </div>
        <div className="form-group">
          <label>Expiration Date</label>
          <input 
            type="date"
            value={formData.expirationDate}
            onChange={(e) => setFormData({ ...formData, expirationDate: e.target.value })}
          />
        </div>
      </div>

      <div className="form-group">
        <label>Reference Number</label>
        <input 
          type="text"
          value={formData.referenceNumber}
          onChange={(e) => setFormData({ ...formData, referenceNumber: e.target.value })}
          placeholder="External reference/case number"
        />
      </div>

      <div className="form-group">
        <label>Findings</label>
        <textarea 
          value={formData.findings}
          onChange={(e) => setFormData({ ...formData, findings: e.target.value })}
          placeholder="Document any findings..."
          rows={3}
        />
      </div>

      <div className="form-group">
        <label>Notes</label>
        <textarea 
          value={formData.notes}
          onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
          placeholder="Additional notes..."
        />
      </div>

      <div className="modal-actions">
        <button type="button" className="btn btn-secondary" onClick={onCancel}>Cancel</button>
        <button type="submit" className="btn btn-primary">Update Check</button>
      </div>
    </form>
  );
};

export default BackgroundChecks;
