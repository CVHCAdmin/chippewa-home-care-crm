// src/components/admin/CaregiverManagement.jsx
import React, { useState, useEffect } from 'react';
import { getCaregivers, convertToAdmin } from '../../config';
import AddCaregiverModal from './AddCaregiverModal';

const CaregiverManagement = ({ token, onViewProfile })=> {
  const [caregivers, setCaregivers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);

  useEffect(() => {
    loadCaregivers();
  }, []);

  const loadCaregivers = async () => {
    try {
      const data = await getCaregivers(token);
      setCaregivers(data);
    } catch (error) {
      console.error('Failed to load caregivers:', error);
    } finally {
      setLoading(false);
    }
  };

  const handlePromoteToAdmin = async (userId) => {
    if (window.confirm('Promote this caregiver to admin?')) {
      try {
        await convertToAdmin(userId, token);
        loadCaregivers();
        alert('Caregiver promoted to admin!');
      } catch (error) {
        alert('Failed to promote: ' + error.message);
      }
    }
  };

  return (
    <div>
      <div className="page-header">
        <h2>👔 Caregiver Management</h2>
        <button 
          className="btn btn-primary"
          onClick={() => setShowModal(true)}
        >
          ➕ Add Caregiver
        </button>
      </div>

      {loading ? (
        <div className="loading"><div className="spinner"></div></div>
      ) : caregivers.length === 0 ? (
        <div className="card card-centered">
          <p>No caregivers yet.</p>
        </div>
      ) : (
        <table className="table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Email</th>
              <th>Phone</th>
              <th>Hire Date</th>
              <th>Role</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {caregivers.map(caregiver => (
              <tr key={caregiver.id}>
                <td><strong>{caregiver.first_name} {caregiver.last_name}</strong></td>
                <td>{caregiver.email}</td>
                <td><a href={`tel:${caregiver.phone}`}>{caregiver.phone || 'N/A'}</a></td>
                <td>{caregiver.hire_date || 'N/A'}</td>
                <td>
                  <span className={`badge ${caregiver.role === 'admin' ? 'badge-danger' : 'badge-info'}`}>
                    {caregiver.role.toUpperCase()}
                  </span>
                </td>
                <td>
                  <div style={{ display: 'flex', gap: '0.5rem' }}>
                    <button 
                      className="btn btn-sm btn-primary"
                      onClick={() => onViewProfile && onViewProfile(caregiver.id)}
                    >
                      View Profile
                    </button>
                    {caregiver.role !== 'admin' && (
                      <button 
                        className="btn btn-sm btn-primary"
                        onClick={() => handlePromoteToAdmin(caregiver.id)}
                      >
                        Make Admin
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <AddCaregiverModal 
        isOpen={showModal}
        onClose={() => setShowModal(false)}
        onSuccess={loadCaregivers}
        token={token}
      />
    </div>
  );
};
export default CaregiverManagement;
