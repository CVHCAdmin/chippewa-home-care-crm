import { confirm } from '../ConfirmModal';
import { toast } from '../Toast';
// src/components/admin/AbsenceManagement.jsx
import React, { useState, useEffect } from 'react';
import { API_BASE_URL } from '../../config';

const AbsenceManagement = ({ token }) => {
  const [absences, setAbsences] = useState([]);
  const [caregivers, setCaregivers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [formData, setFormData] = useState({
    caregiverId: '',
    date: '',
    type: 'call_out',
    reason: ''
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
        date: '',
        type: 'call_out',
        reason: ''
      });
      setShowForm(false);
      loadData();
      toast('Absence recorded successfully!');
    } catch (error) {
      toast('Failed to record absence: ' + error.message, 'error');
    }
  };

  const handleDelete = async (absenceId) => {
    const _cok = await confirm('Are you sure you want to delete this absence?', {danger: true}); if (!_cok) return;
    
    try {
      const response = await fetch(`${API_BASE_URL}/api/absences/${absenceId}`, {
        method: 'DELETE',
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });

      if (!response.ok) throw new Error('Failed to delete');
      loadData();
      toast('Absence deleted!');
    } catch (error) {
      toast('Failed: ' + error.message, 'error');
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

  const getTypeLabel = (type) => {
    return type.replace('_', ' ').toUpperCase();
  };

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
                  value={formData.date}
                  onChange={(e) => setFormData({ ...formData, date: e.target.value })}
                  required
                />
              </div>

              <div className="form-group">
                <label>Absence Type *</label>
                <select
                  value={formData.type}
                  onChange={(e) => setFormData({ ...formData, type: e.target.value })}
                >
                  <option value="call_out">Call Out</option>
                  <option value="no_show">No Show</option>
                  <option value="sick">Sick Leave</option>
                  <option value="personal">Personal</option>
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

      {/* Absences Table */}
      {loading ? (
        <div className="loading"><div className="spinner"></div></div>
      ) : absences.length === 0 ? (
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
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {absences.map(absence => (
              <tr key={absence.id}>
                <td><strong>{getCaregiverName(absence.caregiver_id)}</strong></td>
                <td>{new Date(absence.date).toLocaleDateString()}</td>
                <td>
                  <span className={`badge ${getTypeColor(absence.type)}`}>
                    {getTypeLabel(absence.type)}
                  </span>
                </td>
                <td>{absence.reason || 'N/A'}</td>
                <td>
                  <button
                    className="btn btn-sm btn-danger"
                    onClick={() => handleDelete(absence.id)}
                  >
                    Delete
                  </button>
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
