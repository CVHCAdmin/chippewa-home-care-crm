// src/components/admin/OpenShifts.jsx
import React, { useState, useEffect } from 'react';
import { API_BASE_URL } from '../../config';

const OpenShifts = ({ token }) => {
  const [shifts, setShifts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState({ status: 'open', urgency: '' });
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showClaimsModal, setShowClaimsModal] = useState(false);
  const [currentShift, setCurrentShift] = useState(null);
  const [claims, setClaims] = useState([]);
  const [clients, setClients] = useState([]);
  const [careTypes, setCareTypes] = useState([]);

  useEffect(() => {
    loadShifts();
    loadClients();
    loadCareTypes();
  }, [filter]);

  const loadShifts = async () => {
    try {
      const params = new URLSearchParams();
      if (filter.status) params.append('status', filter.status);
      if (filter.urgency) params.append('urgency', filter.urgency);
      
      const res = await fetch(`${API_BASE_URL}/api/open-shifts?${params}`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      const data = await res.json();
      setShifts(Array.isArray(data) ? data : []);
    } catch (error) {
      console.error('Failed to load shifts:', error);
    } finally {
      setLoading(false);
    }
  };

  const loadClients = async () => {
    try {
      const res = await fetch(`${API_BASE_URL}/api/clients`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      const data = await res.json();
      setClients(Array.isArray(data) ? data : []);
    } catch (error) {
      console.error('Failed to load clients:', error);
    }
  };

  const loadCareTypes = async () => {
    try {
      const res = await fetch(`${API_BASE_URL}/api/care-types`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      const data = await res.json();
      setCareTypes(Array.isArray(data) ? data : []);
    } catch (error) {
      console.error('Failed to load care types:', error);
    }
  };

  const loadClaims = async (shiftId) => {
    try {
      const res = await fetch(`${API_BASE_URL}/api/open-shifts/${shiftId}/claims`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      const data = await res.json();
      setClaims(Array.isArray(data) ? data : []);
    } catch (error) {
      console.error('Failed to load claims:', error);
    }
  };

  const createShift = async (formData) => {
    try {
      const res = await fetch(`${API_BASE_URL}/api/open-shifts`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify(formData)
      });
      if (res.ok) {
        setShowCreateModal(false);
        loadShifts();
      } else {
        const err = await res.json();
        alert('Failed: ' + err.error);
      }
    } catch (error) {
      alert('Failed to create shift: ' + error.message);
    }
  };

  const approveShift = async (shiftId) => {
    try {
      const res = await fetch(`${API_BASE_URL}/api/open-shifts/${shiftId}/approve`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (res.ok) {
        loadShifts();
        setShowClaimsModal(false);
      } else {
        const err = await res.json();
        alert('Failed: ' + err.error);
      }
    } catch (error) {
      alert('Failed to approve: ' + error.message);
    }
  };

  const rejectShift = async (shiftId) => {
    const reason = prompt('Rejection reason (optional):');
    try {
      const res = await fetch(`${API_BASE_URL}/api/open-shifts/${shiftId}/reject`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ reason })
      });
      if (res.ok) {
        loadShifts();
        setShowClaimsModal(false);
      }
    } catch (error) {
      alert('Failed to reject: ' + error.message);
    }
  };

  const broadcastShift = async (shiftId) => {
    if (!confirm('Send SMS to all available caregivers?')) return;
    try {
      const res = await fetch(`${API_BASE_URL}/api/open-shifts/${shiftId}/broadcast`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}` }
      });
      const data = await res.json();
      if (res.ok) {
        alert(`Broadcast sent to ${data.caregiverCount} caregivers`);
        loadShifts();
      }
    } catch (error) {
      alert('Failed to broadcast: ' + error.message);
    }
  };

  const getUrgencyBadge = (urgency) => {
    const colors = {
      normal: '#4caf50',
      high: '#ff9800',
      critical: '#f44336'
    };
    return (
      <span style={{
        padding: '2px 6px',
        borderRadius: '4px',
        fontSize: '0.75rem',
        fontWeight: 'bold',
        color: 'white',
        backgroundColor: colors[urgency] || '#9e9e9e'
      }}>
        {urgency?.toUpperCase()}
      </span>
    );
  };

  const getStatusBadge = (status) => {
    const colors = {
      open: '#2196f3',
      claimed: '#ff9800',
      filled: '#4caf50',
      cancelled: '#9e9e9e'
    };
    return (
      <span style={{
        padding: '2px 6px',
        borderRadius: '4px',
        fontSize: '0.75rem',
        fontWeight: 'bold',
        color: 'white',
        backgroundColor: colors[status] || '#9e9e9e'
      }}>
        {status?.toUpperCase()}
      </span>
    );
  };

  const openShiftCount = shifts.filter(s => s.status === 'open').length;
  const claimedCount = shifts.filter(s => s.status === 'claimed').length;

  return (
    <div>
      <div className="page-header">
        <h2>📋 Open Shift Board</h2>
        <button className="btn btn-primary" onClick={() => setShowCreateModal(true)}>
          + Post Open Shift
        </button>
      </div>

      {/* Summary Cards */}
      <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', marginBottom: '1rem' }}>
        <div className="stat-card" onClick={() => setFilter({ ...filter, status: 'open' })} style={{ cursor: 'pointer' }}>
          <h4>Open</h4>
          <div className="value" style={{ color: '#2196f3' }}>{openShiftCount}</div>
        </div>
        <div className="stat-card" onClick={() => setFilter({ ...filter, status: 'claimed' })} style={{ cursor: 'pointer' }}>
          <h4>Claimed (Pending)</h4>
          <div className="value" style={{ color: '#ff9800' }}>{claimedCount}</div>
        </div>
        <div className="stat-card" onClick={() => setFilter({ ...filter, status: '' })} style={{ cursor: 'pointer' }}>
          <h4>Total</h4>
          <div className="value">{shifts.length}</div>
        </div>
      </div>

      {/* Filters */}
      <div className="card" style={{ marginBottom: '1rem' }}>
        <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap' }}>
          <div className="form-group" style={{ margin: 0 }}>
            <label>Status</label>
            <select value={filter.status} onChange={(e) => setFilter({ ...filter, status: e.target.value })}>
              <option value="">All</option>
              <option value="open">Open</option>
              <option value="claimed">Claimed</option>
              <option value="filled">Filled</option>
              <option value="cancelled">Cancelled</option>
            </select>
          </div>
          <div className="form-group" style={{ margin: 0 }}>
            <label>Urgency</label>
            <select value={filter.urgency} onChange={(e) => setFilter({ ...filter, urgency: e.target.value })}>
              <option value="">All</option>
              <option value="critical">Critical</option>
              <option value="high">High</option>
              <option value="normal">Normal</option>
            </select>
          </div>
        </div>
      </div>

      {/* Shifts Table */}
      <div className="card">
        {loading ? (
          <div className="loading"><div className="spinner"></div></div>
        ) : shifts.length === 0 ? (
          <p>No open shifts found.</p>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>Date</th>
                <th>Time</th>
                <th>Client</th>
                <th>Care Type</th>
                <th>Rate</th>
                <th>Bonus</th>
                <th>Urgency</th>
                <th>Status</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {shifts.map(shift => (
                <tr key={shift.id}>
                  <td>
                    <strong>{new Date(shift.shift_date).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}</strong>
                  </td>
                  <td>{shift.start_time?.slice(0,5)} - {shift.end_time?.slice(0,5)}</td>
                  <td>{shift.client_first_name} {shift.client_last_name}</td>
                  <td>{shift.care_type_name || '-'}</td>
                  <td>${(parseFloat(shift.hourly_rate) || 0).toFixed(2)}/hr</td>
                  <td>
                    {parseFloat(shift.bonus_amount) > 0 ? (
                      <span style={{ color: '#4caf50', fontWeight: 'bold' }}>+${shift.bonus_amount}</span>
                    ) : '-'}
                  </td>
                  <td>{getUrgencyBadge(shift.urgency)}</td>
                  <td>
                    {getStatusBadge(shift.status)}
                    {shift.status === 'claimed' && (
                      <div style={{ fontSize: '0.8rem', marginTop: '2px' }}>
                        by {shift.claimed_by_first} {shift.claimed_by_last}
                      </div>
                    )}
                  </td>
                  <td>
                    <div style={{ display: 'flex', gap: '0.25rem', flexWrap: 'wrap' }}>
                      {shift.status === 'open' && (
                        <>
                          <button 
                            className="btn btn-sm btn-secondary"
                            onClick={() => broadcastShift(shift.id)}
                            title="Send SMS to caregivers"
                          >
                            📢
                          </button>
                        </>
                      )}
                      {shift.status === 'claimed' && (
                        <>
                          <button 
                            className="btn btn-sm btn-success"
                            onClick={() => approveShift(shift.id)}
                          >
                            ✓ Approve
                          </button>
                          <button 
                            className="btn btn-sm btn-danger"
                            onClick={() => rejectShift(shift.id)}
                          >
                            ✗
                          </button>
                        </>
                      )}
                      <button 
                        className="btn btn-sm btn-secondary"
                        onClick={() => { setCurrentShift(shift); loadClaims(shift.id); setShowClaimsModal(true); }}
                      >
                        View
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Create Shift Modal */}
      {showCreateModal && (
        <div className="modal-overlay" onClick={() => setShowCreateModal(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3>Post Open Shift</h3>
              <button className="modal-close" onClick={() => setShowCreateModal(false)}>×</button>
            </div>
            <CreateShiftForm 
              clients={clients}
              careTypes={careTypes}
              onSubmit={createShift} 
              onCancel={() => setShowCreateModal(false)} 
            />
          </div>
        </div>
      )}

      {/* View Claims Modal */}
      {showClaimsModal && currentShift && (
        <div className="modal-overlay" onClick={() => setShowClaimsModal(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3>Shift Details</h3>
              <button className="modal-close" onClick={() => setShowClaimsModal(false)}>×</button>
            </div>
            <div>
              <p><strong>Client:</strong> {currentShift.client_first_name} {currentShift.client_last_name}</p>
              <p><strong>Date:</strong> {new Date(currentShift.shift_date).toLocaleDateString()}</p>
              <p><strong>Time:</strong> {currentShift.start_time?.slice(0,5)} - {currentShift.end_time?.slice(0,5)}</p>
              <p><strong>Rate:</strong> ${(parseFloat(currentShift.hourly_rate) || 0).toFixed(2)}/hr</p>
              {parseFloat(currentShift.bonus_amount) > 0 && (
                <p><strong>Bonus:</strong> <span style={{ color: '#4caf50' }}>+${currentShift.bonus_amount}</span></p>
              )}
              <p><strong>Status:</strong> {getStatusBadge(currentShift.status)}</p>
              {currentShift.notes && <p><strong>Notes:</strong> {currentShift.notes}</p>}

              <hr style={{ margin: '1rem 0' }} />
              
              <h4>Claims ({claims.length})</h4>
              {claims.length === 0 ? (
                <p style={{ color: '#666' }}>No caregivers have claimed this shift yet.</p>
              ) : (
                <table className="table">
                  <thead>
                    <tr>
                      <th>Caregiver</th>
                      <th>Phone</th>
                      <th>Status</th>
                      <th>Submitted</th>
                    </tr>
                  </thead>
                  <tbody>
                    {claims.map(claim => (
                      <tr key={claim.id}>
                        <td>{claim.first_name} {claim.last_name}</td>
                        <td>{claim.phone}</td>
                        <td>{claim.status}</td>
                        <td>{new Date(claim.created_at).toLocaleString()}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

// Create Shift Form Component
const CreateShiftForm = ({ clients, careTypes, onSubmit, onCancel }) => {
  const [formData, setFormData] = useState({
    clientId: '',
    shiftDate: '',
    startTime: '08:00',
    endTime: '16:00',
    careTypeId: '',
    hourlyRate: '',
    bonusAmount: '0',
    urgency: 'normal',
    notes: ''
  });

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!formData.clientId || !formData.shiftDate) {
      alert('Client and date are required');
      return;
    }
    onSubmit(formData);
  };

  return (
    <form onSubmit={handleSubmit}>
      <div className="form-group">
        <label>Client *</label>
        <select 
          value={formData.clientId} 
          onChange={(e) => setFormData({ ...formData, clientId: e.target.value })}
          required
        >
          <option value="">Select Client</option>
          {clients.filter(c => c.status === 'active').map(c => (
            <option key={c.id} value={c.id}>{c.first_name} {c.last_name}</option>
          ))}
        </select>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '1rem' }}>
        <div className="form-group">
          <label>Date *</label>
          <input 
            type="date" 
            value={formData.shiftDate}
            onChange={(e) => setFormData({ ...formData, shiftDate: e.target.value })}
            required
          />
        </div>
        <div className="form-group">
          <label>Start Time</label>
          <input 
            type="time" 
            value={formData.startTime}
            onChange={(e) => setFormData({ ...formData, startTime: e.target.value })}
          />
        </div>
        <div className="form-group">
          <label>End Time</label>
          <input 
            type="time" 
            value={formData.endTime}
            onChange={(e) => setFormData({ ...formData, endTime: e.target.value })}
          />
        </div>
      </div>

      <div className="form-group">
        <label>Care Type</label>
        <select 
          value={formData.careTypeId}
          onChange={(e) => setFormData({ ...formData, careTypeId: e.target.value })}
        >
          <option value="">Select Care Type</option>
          {careTypes.map(ct => (
            <option key={ct.id} value={ct.id}>{ct.name}</option>
          ))}
        </select>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '1rem' }}>
        <div className="form-group">
          <label>Hourly Rate ($)</label>
          <input 
            type="number" 
            step="0.01"
            value={formData.hourlyRate}
            onChange={(e) => setFormData({ ...formData, hourlyRate: e.target.value })}
            placeholder="20.00"
          />
        </div>
        <div className="form-group">
          <label>Bonus ($)</label>
          <input 
            type="number" 
            step="0.01"
            value={formData.bonusAmount}
            onChange={(e) => setFormData({ ...formData, bonusAmount: e.target.value })}
            placeholder="0.00"
          />
        </div>
        <div className="form-group">
          <label>Urgency</label>
          <select 
            value={formData.urgency}
            onChange={(e) => setFormData({ ...formData, urgency: e.target.value })}
          >
            <option value="normal">Normal</option>
            <option value="high">High</option>
            <option value="critical">Critical</option>
          </select>
        </div>
      </div>

      <div className="form-group">
        <label>Notes</label>
        <textarea 
          value={formData.notes}
          onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
          placeholder="Any special requirements..."
        />
      </div>

      <div className="modal-actions">
        <button type="button" className="btn btn-secondary" onClick={onCancel}>Cancel</button>
        <button type="submit" className="btn btn-primary">Post Shift</button>
      </div>
    </form>
  );
};

export default OpenShifts;
