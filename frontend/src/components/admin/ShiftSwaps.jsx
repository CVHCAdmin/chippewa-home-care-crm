// src/components/admin/ShiftSwaps.jsx
import React, { useState, useEffect } from 'react';
import { API_BASE_URL } from '../../config';

const ShiftSwaps = ({ token }) => {
  const [swaps, setSwaps] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState({ status: '' });

  useEffect(() => {
    loadSwaps();
  }, [filter]);

  const loadSwaps = async () => {
    try {
      const params = new URLSearchParams();
      if (filter.status) params.append('status', filter.status);
      
      const res = await fetch(`${API_BASE_URL}/api/shift-swaps?${params}`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      const data = await res.json();
      setSwaps(Array.isArray(data) ? data : []);
    } catch (error) {
      console.error('Failed to load swaps:', error);
    } finally {
      setLoading(false);
    }
  };

  const approveSwap = async (swapId) => {
    if (!confirm('Approve this shift swap? The schedule will be updated.')) return;
    try {
      const res = await fetch(`${API_BASE_URL}/api/shift-swaps/${swapId}/approve`, {
        method: 'PUT',
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (res.ok) {
        loadSwaps();
      } else {
        const err = await res.json();
        alert('Failed: ' + err.error);
      }
    } catch (error) {
      alert('Failed: ' + error.message);
    }
  };

  const rejectSwap = async (swapId) => {
    const reason = prompt('Rejection reason (optional):');
    try {
      const res = await fetch(`${API_BASE_URL}/api/shift-swaps/${swapId}/reject`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ reason })
      });
      if (res.ok) {
        loadSwaps();
      }
    } catch (error) {
      alert('Failed: ' + error.message);
    }
  };

  const getStatusBadge = (status) => {
    const colors = {
      pending: '#ff9800',
      accepted: '#2196f3',
      approved: '#4caf50',
      rejected: '#f44336',
      cancelled: '#9e9e9e'
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
        {status?.toUpperCase()}
      </span>
    );
  };

  const pendingCount = swaps.filter(s => s.status === 'pending').length;
  const acceptedCount = swaps.filter(s => s.status === 'accepted').length;

  return (
    <div>
      <div className="page-header">
        <h2>🔄 Shift Swap Requests</h2>
      </div>

      {/* Summary Cards */}
      <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', marginBottom: '1rem' }}>
        <div 
          className="stat-card" 
          onClick={() => setFilter({ status: 'pending' })} 
          style={{ cursor: 'pointer', border: filter.status === 'pending' ? '2px solid #ff9800' : 'none' }}
        >
          <h4>Pending</h4>
          <div className="value" style={{ color: '#ff9800' }}>{pendingCount}</div>
          <small>Awaiting caregiver response</small>
        </div>
        <div 
          className="stat-card" 
          onClick={() => setFilter({ status: 'accepted' })} 
          style={{ cursor: 'pointer', border: filter.status === 'accepted' ? '2px solid #2196f3' : 'none' }}
        >
          <h4>Needs Approval</h4>
          <div className="value" style={{ color: '#2196f3' }}>{acceptedCount}</div>
          <small>Ready for admin review</small>
        </div>
        <div 
          className="stat-card" 
          onClick={() => setFilter({ status: '' })} 
          style={{ cursor: 'pointer', border: filter.status === '' ? '2px solid #333' : 'none' }}
        >
          <h4>All Requests</h4>
          <div className="value">{swaps.length}</div>
        </div>
      </div>

      {/* Filter */}
      <div className="card" style={{ marginBottom: '1rem' }}>
        <div className="form-group" style={{ margin: 0, maxWidth: '200px' }}>
          <label>Filter by Status</label>
          <select value={filter.status} onChange={(e) => setFilter({ status: e.target.value })}>
            <option value="">All</option>
            <option value="pending">Pending</option>
            <option value="accepted">Accepted (Needs Approval)</option>
            <option value="approved">Approved</option>
            <option value="rejected">Rejected</option>
            <option value="cancelled">Cancelled</option>
          </select>
        </div>
      </div>

      {/* Swaps Table */}
      <div className="card">
        {loading ? (
          <div className="loading"><div className="spinner"></div></div>
        ) : swaps.length === 0 ? (
          <p>No shift swap requests found.</p>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>Shift Date</th>
                <th>Time</th>
                <th>Client</th>
                <th>Requesting</th>
                <th>→</th>
                <th>Target</th>
                <th>Reason</th>
                <th>Status</th>
                <th>Requested</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {swaps.map(swap => (
                <tr key={swap.id}>
                  <td>
                    <strong>
                      {new Date(swap.shift_date).toLocaleDateString('en-US', { 
                        weekday: 'short', 
                        month: 'short', 
                        day: 'numeric' 
                      })}
                    </strong>
                  </td>
                  <td>{swap.start_time?.slice(0,5)} - {swap.end_time?.slice(0,5)}</td>
                  <td>{swap.client_first} {swap.client_last}</td>
                  <td>
                    <strong>{swap.requester_first} {swap.requester_last}</strong>
                  </td>
                  <td style={{ fontSize: '1.2rem' }}>→</td>
                  <td>
                    {swap.target_first ? (
                      <strong>{swap.target_first} {swap.target_last}</strong>
                    ) : (
                      <span style={{ color: '#666', fontStyle: 'italic' }}>Open Swap</span>
                    )}
                  </td>
                  <td style={{ maxWidth: '200px', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {swap.reason || '-'}
                  </td>
                  <td>{getStatusBadge(swap.status)}</td>
                  <td style={{ fontSize: '0.85rem' }}>
                    {new Date(swap.requested_at).toLocaleDateString()}
                  </td>
                  <td>
                    {swap.status === 'accepted' && (
                      <div style={{ display: 'flex', gap: '0.25rem' }}>
                        <button 
                          className="btn btn-sm btn-success"
                          onClick={() => approveSwap(swap.id)}
                          title="Approve swap"
                        >
                          ✓ Approve
                        </button>
                        <button 
                          className="btn btn-sm btn-danger"
                          onClick={() => rejectSwap(swap.id)}
                          title="Reject swap"
                        >
                          ✗
                        </button>
                      </div>
                    )}
                    {swap.status === 'pending' && (
                      <span style={{ color: '#666', fontSize: '0.85rem' }}>
                        Awaiting response
                      </span>
                    )}
                    {swap.status === 'approved' && (
                      <span style={{ color: '#4caf50', fontSize: '0.85rem' }}>
                        ✓ Completed
                      </span>
                    )}
                    {swap.status === 'rejected' && (
                      <span style={{ color: '#f44336', fontSize: '0.85rem' }}>
                        Rejected
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Info Card */}
      <div className="card" style={{ marginTop: '1rem', backgroundColor: '#f5f5f5' }}>
        <h4>How Shift Swaps Work</h4>
        <ol style={{ margin: '0.5rem 0', paddingLeft: '1.5rem' }}>
          <li><strong>Request:</strong> Caregiver A requests to swap their shift with Caregiver B</li>
          <li><strong>Pending:</strong> Caregiver B receives notification and can accept or decline</li>
          <li><strong>Accepted:</strong> If Caregiver B accepts, the swap needs admin approval</li>
          <li><strong>Approved:</strong> Admin approves, schedule is automatically updated</li>
        </ol>
      </div>
    </div>
  );
};

export default ShiftSwaps;
