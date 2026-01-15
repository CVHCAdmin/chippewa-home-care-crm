// src/components/admin/CaregiverManagement.jsx
import React, { useState, useEffect } from 'react';
import { API_BASE_URL } from '../../config';
import AddCaregiverModal from './AddCaregiverModal';

// Mobile-friendly caregiver card
const CaregiverCard = ({ caregiver, formatCurrency, onEdit, onRates, onProfile, onPromote }) => (
  <div className="card" style={{ marginBottom: '0.75rem', padding: '1rem' }}>
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '0.75rem' }}>
      <div>
        <strong style={{ fontSize: '1.1rem' }}>{caregiver.first_name} {caregiver.last_name}</strong>
        <div style={{ fontSize: '0.85rem', color: '#666' }}>{caregiver.email}</div>
      </div>
      <span className={`badge ${caregiver.role === 'admin' ? 'badge-danger' : 'badge-info'}`}>
        {caregiver.role.toUpperCase()}
      </span>
    </div>
    
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem', fontSize: '0.9rem', marginBottom: '0.75rem' }}>
      <div>
        <span style={{ color: '#666' }}>📞</span>{' '}
        {caregiver.phone ? (
          <a href={`tel:${caregiver.phone}`}>{caregiver.phone}</a>
        ) : (
          <span style={{ color: '#999' }}>N/A</span>
        )}
      </div>
      <div>
        <span style={{ color: '#666' }}>💰</span>{' '}
        <strong>{formatCurrency(caregiver.default_pay_rate)}</strong>/hr
      </div>
    </div>
    
    <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
      <button className="btn btn-sm btn-primary" onClick={() => onEdit(caregiver)}>✏️ Edit</button>
      <button className="btn btn-sm btn-secondary" onClick={() => onRates(caregiver)}>💰 Rates</button>
      {onProfile && (
        <button className="btn btn-sm btn-secondary" onClick={() => onProfile(caregiver.id)}>👤 Profile</button>
      )}
      {caregiver.role !== 'admin' && (
        <button className="btn btn-sm btn-warning" onClick={() => onPromote(caregiver.id)}>⬆️ Admin</button>
      )}
    </div>
  </div>
);

const CaregiverManagement = ({ token, onViewProfile }) => {
  const [caregivers, setCaregivers] = useState([]);
  const [careTypes, setCareTypes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [showRatesModal, setShowRatesModal] = useState(false);
  const [selectedCaregiver, setSelectedCaregiver] = useState(null);
  const [caregiverRates, setCaregiverRates] = useState([]);
  const [isMobile, setIsMobile] = useState(window.innerWidth < 768);
  
  const [editData, setEditData] = useState({
    firstName: '',
    lastName: '',
    phone: '',
    payRate: ''
  });

  const [rateFormData, setRateFormData] = useState({
    careTypeId: '',
    hourlyRate: ''
  });

  // Listen for window resize
  useEffect(() => {
    const handleResize = () => setIsMobile(window.innerWidth < 768);
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    try {
      const [cgRes, ctRes] = await Promise.all([
        fetch(`${API_BASE_URL}/api/caregivers`, { headers: { 'Authorization': `Bearer ${token}` } }),
        fetch(`${API_BASE_URL}/api/care-types`, { headers: { 'Authorization': `Bearer ${token}` } })
      ]);
      setCaregivers(await cgRes.json());
      setCareTypes(await ctRes.json());
    } catch (error) {
      console.error('Failed to load data:', error);
    } finally {
      setLoading(false);
    }
  };

  const handlePromoteToAdmin = async (userId) => {
    if (window.confirm('Promote this caregiver to admin?')) {
      try {
        const response = await fetch(`${API_BASE_URL}/api/users/convert-to-admin`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`
          },
          body: JSON.stringify({ userId })
        });
        if (!response.ok) throw new Error('Failed to promote');
        loadData();
        alert('Caregiver promoted to admin!');
      } catch (error) {
        alert('Failed to promote: ' + error.message);
      }
    }
  };

  const handleOpenEdit = (caregiver) => {
    setSelectedCaregiver(caregiver);
    setEditData({
      firstName: caregiver.first_name || '',
      lastName: caregiver.last_name || '',
      phone: caregiver.phone || '',
      payRate: caregiver.default_pay_rate || ''
    });
    setShowEditModal(true);
  };

  const handleSaveEdit = async (e) => {
    e.preventDefault();
    try {
      const response = await fetch(`${API_BASE_URL}/api/caregivers/${selectedCaregiver.id}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          firstName: editData.firstName,
          lastName: editData.lastName,
          phone: editData.phone,
          payRate: parseFloat(editData.payRate) || null
        })
      });

      if (!response.ok) throw new Error('Failed to update caregiver');

      setShowEditModal(false);
      setSelectedCaregiver(null);
      loadData();
      alert('Caregiver updated!');
    } catch (error) {
      alert('Failed to update: ' + error.message);
    }
  };

  const handleOpenRates = async (caregiver) => {
    setSelectedCaregiver(caregiver);
    try {
      const response = await fetch(`${API_BASE_URL}/api/caregiver-care-type-rates?caregiverId=${caregiver.id}`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      setCaregiverRates(await response.json());
      setShowRatesModal(true);
    } catch (error) {
      alert('Failed to load rates: ' + error.message);
    }
  };

  const handleAddRate = async (e) => {
    e.preventDefault();
    try {
      const response = await fetch(`${API_BASE_URL}/api/caregiver-care-type-rates`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          caregiverId: selectedCaregiver.id,
          careTypeId: rateFormData.careTypeId,
          hourlyRate: parseFloat(rateFormData.hourlyRate)
        })
      });

      if (!response.ok) throw new Error('Failed to add rate');

      setRateFormData({ careTypeId: '', hourlyRate: '' });
      
      const ratesRes = await fetch(`${API_BASE_URL}/api/caregiver-care-type-rates?caregiverId=${selectedCaregiver.id}`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      setCaregiverRates(await ratesRes.json());
    } catch (error) {
      alert('Failed to add rate: ' + error.message);
    }
  };

  const handleDeleteRate = async (rateId) => {
    if (!window.confirm('Remove this rate?')) return;
    
    try {
      await fetch(`${API_BASE_URL}/api/caregiver-care-type-rates/${rateId}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${token}` }
      });
      
      const ratesRes = await fetch(`${API_BASE_URL}/api/caregiver-care-type-rates?caregiverId=${selectedCaregiver.id}`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      setCaregiverRates(await ratesRes.json());
    } catch (error) {
      alert('Failed to delete rate: ' + error.message);
    }
  };

  const getAvailableCareTypes = () => {
    const assignedIds = caregiverRates.map(r => r.care_type_id);
    return careTypes.filter(ct => !assignedIds.includes(ct.id));
  };

  const formatCurrency = (amount) => {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(amount || 0);
  };

  return (
    <div>
      <div className="page-header">
        <h2>👤 Caregivers</h2>
        <button className="btn btn-primary" onClick={() => setShowModal(true)}>
          ➕ Add
        </button>
      </div>

      {loading ? (
        <div className="loading"><div className="spinner"></div></div>
      ) : caregivers.length === 0 ? (
        <div className="card card-centered">
          <p>No caregivers yet.</p>
        </div>
      ) : isMobile ? (
        <div>
          {caregivers.map(caregiver => (
            <CaregiverCard
              key={caregiver.id}
              caregiver={caregiver}
              formatCurrency={formatCurrency}
              onEdit={handleOpenEdit}
              onRates={handleOpenRates}
              onProfile={onViewProfile}
              onPromote={handlePromoteToAdmin}
            />
          ))}
        </div>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table className="table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Email</th>
                <th>Phone</th>
                <th>Default Rate</th>
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
                  <td><strong>{formatCurrency(caregiver.default_pay_rate)}</strong>/hr</td>
                  <td>
                    <span className={`badge ${caregiver.role === 'admin' ? 'badge-danger' : 'badge-info'}`}>
                      {caregiver.role.toUpperCase()}
                    </span>
                  </td>
                  <td>
                    <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                      <button className="btn btn-sm btn-primary" onClick={() => handleOpenEdit(caregiver)}>Edit</button>
                      <button className="btn btn-sm btn-secondary" onClick={() => handleOpenRates(caregiver)}>💰 Pay Rates</button>
                      {onViewProfile && (
                        <button className="btn btn-sm btn-secondary" onClick={() => onViewProfile(caregiver.id)}>Profile</button>
                      )}
                      {caregiver.role !== 'admin' && (
                        <button className="btn btn-sm btn-warning" onClick={() => handlePromoteToAdmin(caregiver.id)}>Make Admin</button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <AddCaregiverModal 
        isOpen={showModal}
        onClose={() => setShowModal(false)}
        onSuccess={loadData}
        token={token}
      />

      {/* Edit Caregiver Modal */}
      {showEditModal && selectedCaregiver && (
        <div className="modal active" onClick={() => setShowEditModal(false)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()} style={{ maxWidth: isMobile ? '95%' : '500px' }}>
            <div className="modal-header">
              <h2>Edit Caregiver</h2>
              <button className="close-btn" onClick={() => setShowEditModal(false)}>×</button>
            </div>

            <form onSubmit={handleSaveEdit}>
              <div className="form-group">
                <label>First Name</label>
                <input type="text" value={editData.firstName} onChange={(e) => setEditData({ ...editData, firstName: e.target.value })} />
              </div>

              <div className="form-group">
                <label>Last Name</label>
                <input type="text" value={editData.lastName} onChange={(e) => setEditData({ ...editData, lastName: e.target.value })} />
              </div>

              <div className="form-group">
                <label>Phone</label>
                <input type="tel" value={editData.phone} onChange={(e) => setEditData({ ...editData, phone: e.target.value })} />
              </div>

              <div className="form-group">
                <label>Default Hourly Pay Rate</label>
                <input type="number" step="0.01" min="0" value={editData.payRate} onChange={(e) => setEditData({ ...editData, payRate: e.target.value })} placeholder="15.00" />
                <small className="text-muted">Used when no care-type-specific rate is set</small>
              </div>

              <div className="modal-actions">
                <button type="submit" className="btn btn-primary">Save Changes</button>
                <button type="button" className="btn btn-secondary" onClick={() => setShowEditModal(false)}>Cancel</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Pay Rates by Care Type Modal */}
      {showRatesModal && selectedCaregiver && (
        <div className="modal active" onClick={() => setShowRatesModal(false)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()} style={{ maxWidth: isMobile ? '95%' : '700px' }}>
            <div className="modal-header">
              <h2>💰 Pay Rates</h2>
              <button className="close-btn" onClick={() => setShowRatesModal(false)}>×</button>
            </div>

            <div style={{ marginBottom: '1rem' }}>
              <strong>{selectedCaregiver.first_name} {selectedCaregiver.last_name}</strong>
            </div>

            <div className="card" style={{ background: '#f9f9f9', marginBottom: '1.5rem', padding: '1rem' }}>
              <p style={{ margin: 0 }}>
                <strong>Default Rate:</strong> {formatCurrency(selectedCaregiver.default_pay_rate)}/hr
              </p>
              <small className="text-muted">
                Used when no care-type-specific rate is set
              </small>
            </div>

            <h4>Care Type Rates</h4>

            {getAvailableCareTypes().length > 0 && (
              <form onSubmit={handleAddRate} style={{ marginBottom: '1.5rem' }}>
                <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '2fr 1fr auto', gap: '0.75rem', alignItems: 'end' }}>
                  <div className="form-group" style={{ marginBottom: 0 }}>
                    <label>Care Type</label>
                    <select value={rateFormData.careTypeId} onChange={(e) => setRateFormData({ ...rateFormData, careTypeId: e.target.value })} required>
                      <option value="">Select care type...</option>
                      {getAvailableCareTypes().map(ct => (
                        <option key={ct.id} value={ct.id}>{ct.name}</option>
                      ))}
                    </select>
                  </div>

                  <div className="form-group" style={{ marginBottom: 0 }}>
                    <label>Hourly Rate</label>
                    <input type="number" step="0.01" min="0" value={rateFormData.hourlyRate} onChange={(e) => setRateFormData({ ...rateFormData, hourlyRate: e.target.value })} placeholder="15.00" required />
                  </div>

                  <button type="submit" className="btn btn-primary" style={{ height: 'fit-content' }}>Add</button>
                </div>
              </form>
            )}

            {caregiverRates.length === 0 ? (
              <div className="card card-centered">
                <p>No care-type-specific rates. Default rate will be used.</p>
              </div>
            ) : isMobile ? (
              <div>
                {caregiverRates.map(rate => (
                  <div key={rate.id} className="card" style={{ marginBottom: '0.5rem', padding: '0.75rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div>
                      <strong>{rate.care_type_name}</strong>
                      <div style={{ fontSize: '0.9rem' }}>{formatCurrency(rate.hourly_rate)}/hr</div>
                    </div>
                    <button className="btn btn-sm btn-danger" onClick={() => handleDeleteRate(rate.id)}>✕</button>
                  </div>
                ))}
              </div>
            ) : (
              <table className="table">
                <thead>
                  <tr>
                    <th>Care Type</th>
                    <th>Hourly Rate</th>
                    <th>Effective Date</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {caregiverRates.map(rate => (
                    <tr key={rate.id}>
                      <td><strong>{rate.care_type_name}</strong></td>
                      <td><strong>{formatCurrency(rate.hourly_rate)}</strong>/hr</td>
                      <td>{new Date(rate.effective_date).toLocaleDateString()}</td>
                      <td>
                        <button className="btn btn-sm btn-danger" onClick={() => handleDeleteRate(rate.id)}>Remove</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}

            <div className="modal-actions" style={{ marginTop: '1rem' }}>
              <button className="btn btn-secondary" onClick={() => setShowRatesModal(false)}>Close</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default CaregiverManagement;
