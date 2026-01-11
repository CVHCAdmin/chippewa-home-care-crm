// src/components/admin/AbsenceManagement.jsx
import React, { useState, useEffect } from 'react';
import { API_BASE_URL } from '../../config';

const AbsenceManagement = ({ token }) => {
  const [absences, setAbsences] = useState([]);
  const [caregivers, setCaregivers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [filter, setFilter] = useState('all'); // all, pending, approved, denied
  const [formData, setFormData] = useState({
    caregiverId: '',
    absenceDate: '',
    absenceType: 'call_out', // call_out, no_show, sick, personal
    reason: '',
    status: 'pending'
  });

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    try {
      const [absencesRes, caregiversRes] = await Promise.all([
        fetch(`${API_BASE_URL}/api/absences`, {
          headers: { 'Authorization': `Bearer ${token}` }
        }),
        fetch(`${API_BASE_URL}/api/users/caregivers`, {
          headers: { 'Authorization': `Bearer ${token}` }
        })
      ]);

      const absencesData = await absencesRes.json();
      const caregiversData = await caregiversRes.json();

      setAbsences(absencesData);
      setCaregivers(caregiversData);
    } catch (error) {
      console.error('Failed to load data:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    try {
      const response = await fetch(`${API_BASE_URL}/api/absences`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify(formData)
      });

      if (!response.ok) throw new Error('Failed to record absence');

      setFormData({
        caregiverId: '',
        absenceDate: '',
        absenceType: 'call_out',
        reason: '',
        status: 'pending'
      });
      setShowForm(false);
      loadData();
      alert('Absence recorded successfully!');
    } catch (error) {
      alert('Failed to record absence: ' + error.message);
    }
  };

  const handleApprove = async (absenceId) => {
    try {
      const response = await fetch(`${API_BASE_URL}/api/absences/${absenceId}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ status: 'approved' })
      });

      if (!response.ok) throw new Error('Failed to approve');
      loadData();
      alert('Absence approved!');
    } catch (error) {
      alert('Failed: ' + error.message);
    }
  };

  const handleDeny = async (absenceId) => {
    try {
      const response = await fetch(`${API_BASE_URL}/api/absences/${absenceId}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ status: 'denied' })
      });

      if (!response.ok) throw new Error('Failed to deny');
      loadData();
      alert('Absence denied!');
    } catch (error) {
      alert('Failed: ' + error.message);
    }
  };

  const getTypeColor = (type) => {
    switch (type) {
      case 'call_out':
        return 'badge-warning';
      case 'no_show':
        return 'badge-danger';
      case 'sick':
        return 'badge-info';
      case 'personal':
        return 'badge-primary';
      default:
        return 'badge-secondary';
    }
  };

  const getStatusColor = (status) => {
    switch (status) {
      case 'approved':
        return 'badge-success';
      case 'denied':
        return 'badge-danger';
      case 'pending':
        return 'badge-warning';
      default:
        return 'badge-secondary';
    }
  };

  const getTypeLabel = (type) => {
    return type.replace('_', ' ').toUpperCase();
  };

  const filteredAbsences = absences.filter(absence => {
    if (filter === 'all') return true;
    return absence.status === filter;
  });

  const getCaregiverName = (id) => {
    const cg = caregivers.find(c => c.id === id);
    return cg ? `${cg.first_name} ${cg.last_name}` : 'Unknown';
  };

  return (
    <div>
      <div className="page-header">
        <h2>📋 Absence Management</h2>
        <button 
          className="btn btn-primary"
          onClick={() => setShowForm(!showForm)}
        >
          {showForm ? '✕ Cancel' : '➕ Record Absence'}
        </button>
      </div>

      {showForm && (
        <div className="card card-form">
          <h3>Record Caregiver Absence</h3>
          <form onSubmit={handleSubmit}>
            <div className="form-grid">
              <div className="form-group">
                <label>Caregiver *</label>
                <select
                  value={formData.caregiverId}
                  onChange={(e) => setFormData({ ...formData, caregiverId: e.target.value })}
                  required
                >
                  <option value="">Select a caregiver...</option>
                  {caregivers.map(cg => (
                    <option key={cg.id} value={cg.id}>
                      {cg.first_name} {cg.last_name}
                    </option>
                  ))}
                </select>
              </div>

              <div className="form-group">
                <label>Absence Date *</label>
                <input
                  type="date"
                  value={formData.absenceDate}
                  onChange={(e) => setFormData({ ...formData, absenceDate: e.target.value })}
                  required
                />
              </div>

              <div className="form-group">
                <label>Absence Type *</label>
                <select
                  value={formData.absenceType}
                  onChange={(e) => setFormData({ ...formData, absenceType: e.target.value })}
                >
                  <option value="call_out">Call Out</option>
                  <option value="no_show">No Show</option>
                  <option value="sick">Sick Leave</option>
                  <option value="personal">Personal</option>
                </select>
              </div>

              <div className="form-group">
                <label>Status *</label>
                <select
                  value={formData.status}
                  onChange={(e) => setFormData({ ...formData, status: e.target.value })}
                >
                  <option value="pending">Pending</option>
                  <option value="approved">Approved</option>
                  <option value="denied">Denied</option>
                </select>
              </div>

              <div className="form-group" style={{ gridColumn: '1 / -1' }}>
                <label>Reason</label>
                <textarea
                  value={formData.reason}
                  onChange={(e) => setFormData({ ...formData, reason: e.target.value })}
                  placeholder="Reason for absence..."
                  rows="3"
                ></textarea>
              </div>
            </div>

            <div className="form-actions">
              <button type="submit" className="btn btn-primary">Record Absence</button>
              <button type="button" className="btn btn-secondary" onClick={() => setShowForm(false)}>Cancel</button>
            </div>
          </form>
        </div>
      )}

      {/* Filter Tabs */}
      <div className="filter-tabs">
        {['all', 'pending', 'approved', 'denied'].map(f => (
          <button
            key={f}
            className={`filter-tab ${filter === f ? 'active' : ''}`}
            onClick={() => setFilter(f)}
          >
            {f.charAt(0).toUpperCase() + f.slice(1)}
          </button>
        ))}
      </div>

      {/* Absences Table */}
      {loading ? (
        <div className="loading"><div className="spinner"></div></div>
      ) : filteredAbsences.length === 0 ? (
        <div className="card card-centered">
          <p>No absences recorded.</p>
        </div>
      ) : (
        <table className="table">
          <thead>
            <tr>
              <th>Caregiver</th>
              <th>Date</th>
              <th>Type</th>
              <th>Reason</th>
              <th>Status</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {filteredAbsences.map(absence => (
              <tr key={absence.id}>
                <td><strong>{getCaregiverName(absence.caregiver_id)}</strong></td>
                <td>{new Date(absence.absence_date).toLocaleDateString()}</td>
                <td>
                  <span className={`badge ${getTypeColor(absence.absence_type)}`}>
                    {getTypeLabel(absence.absence_type)}
                  </span>
                </td>
                <td>{absence.reason || 'N/A'}</td>
                <td>
                  <span className={`badge ${getStatusColor(absence.status)}`}>
                    {absence.status.toUpperCase()}
                  </span>
                </td>
                <td>
                  {absence.status === 'pending' && (
                    <>
                      <button
                        className="btn btn-sm btn-success"
                        onClick={() => handleApprove(absence.id)}
                      >
                        Approve
                      </button>
                      <button
                        className="btn btn-sm btn-danger"
                        onClick={() => handleDeny(absence.id)}
                      >
                        Deny
                      </button>
                    </>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
};

export default AbsenceManagement;
