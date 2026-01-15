// src/components/admin/ClientsManagement.jsx
import React, { useState, useEffect } from 'react';
import { API_BASE_URL } from '../../config';
import EditClientModal from './EditClientModal';

const ClientsManagement = ({ token }) => {
  const [clients, setClients] = useState([]);
  const [referralSources, setReferralSources] = useState([]);
  const [careTypes, setCareTypes] = useState([]);
  const [caregivers, setCaregivers] = useState([]);
  const [showForm, setShowForm] = useState(false);
  const [loading, setLoading] = useState(true);
  const [selectedClient, setSelectedClient] = useState(null);
  const [showEditModal, setShowEditModal] = useState(false);
  const [showBillingModal, setShowBillingModal] = useState(false);
  const [showCaregiverRateModal, setShowCaregiverRateModal] = useState(false);
  const [caregiverRates, setCaregiverRates] = useState([]);
  
  const [formData, setFormData] = useState({
    firstName: '',
    lastName: '',
    dateOfBirth: '',
    phone: '',
    email: '',
    address: '',
    city: '',
    state: 'WI',
    zip: '',
    referralSourceId: '',
    careTypeId: '',
    isPrivatePay: false,
    privatePayRate: '',
    privatePayRateType: 'hourly'
  });

  const [billingData, setBillingData] = useState({
    referralSourceId: '',
    careTypeId: '',
    isPrivatePay: false,
    privatePayRate: '',
    privatePayRateType: 'hourly',
    billingNotes: ''
  });

  const [caregiverRateData, setCaregiverRateData] = useState({
    caregiverId: '',
    hourlyRate: '',
    notes: ''
  });

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    try {
      const [clientRes, rsRes, ctRes, cgRes] = await Promise.all([
        fetch(`${API_BASE_URL}/api/clients`, { headers: { 'Authorization': `Bearer ${token}` } }),
        fetch(`${API_BASE_URL}/api/referral-sources`, { headers: { 'Authorization': `Bearer ${token}` } }),
        fetch(`${API_BASE_URL}/api/care-types`, { headers: { 'Authorization': `Bearer ${token}` } }),
        fetch(`${API_BASE_URL}/api/caregivers`, { headers: { 'Authorization': `Bearer ${token}` } })
      ]);

      setClients(await clientRes.json());
      setReferralSources(await rsRes.json());
      setCareTypes(await ctRes.json());
      setCaregivers(await cgRes.json());
    } catch (error) {
      console.error('Failed to load data:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    try {
      const cleanedData = {
        firstName: formData.firstName,
        lastName: formData.lastName,
        dateOfBirth: formData.dateOfBirth || null,
        phone: formData.phone || null,
        email: formData.email || null,
        address: formData.address || null,
        city: formData.city || null,
        state: formData.state || null,
        zip: formData.zip || null,
        referralSourceId: formData.referralSourceId || null,
        careTypeId: formData.careTypeId || null,
        isPrivatePay: formData.isPrivatePay,
        privatePayRate: formData.isPrivatePay ? formData.privatePayRate : null,
        privatePayRateType: formData.privatePayRateType
      };

      const response = await fetch(`${API_BASE_URL}/api/clients`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify(cleanedData)
      });

      if (!response.ok) throw new Error('Failed to create client');

      setFormData({
        firstName: '', lastName: '', dateOfBirth: '', phone: '', email: '',
        address: '', city: '', state: 'WI', zip: '',
        referralSourceId: '', careTypeId: '', isPrivatePay: false,
        privatePayRate: '', privatePayRateType: 'hourly'
      });
      setShowForm(false);
      loadData();
    } catch (error) {
      alert('Failed to create client: ' + error.message);
    }
  };

  const handleViewClient = (client) => {
    setSelectedClient(client);
    setShowEditModal(true);
  };

  const handleOpenBilling = (client) => {
    setSelectedClient(client);
    setBillingData({
      referralSourceId: client.referral_source_id || '',
      careTypeId: client.care_type_id || '',
      isPrivatePay: client.is_private_pay || false,
      privatePayRate: client.private_pay_rate || '',
      privatePayRateType: client.private_pay_rate_type || 'hourly',
      billingNotes: client.billing_notes || ''
    });
    setShowBillingModal(true);
  };

  const handleSaveBilling = async (e) => {
    e.preventDefault();
    try {
      const response = await fetch(`${API_BASE_URL}/api/clients/${selectedClient.id}/billing`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify(billingData)
      });

      if (!response.ok) throw new Error('Failed to update billing');

      setShowBillingModal(false);
      loadData();
      alert('Billing settings updated!');
    } catch (error) {
      alert('Failed to update billing: ' + error.message);
    }
  };

  const handleOpenCaregiverRates = async (client) => {
    setSelectedClient(client);
    try {
      const response = await fetch(`${API_BASE_URL}/api/caregiver-client-rates?clientId=${client.id}`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      setCaregiverRates(await response.json());
      setShowCaregiverRateModal(true);
    } catch (error) {
      alert('Failed to load rates: ' + error.message);
    }
  };

  const handleAddCaregiverRate = async (e) => {
    e.preventDefault();
    try {
      const response = await fetch(`${API_BASE_URL}/api/caregiver-client-rates`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          caregiverId: caregiverRateData.caregiverId,
          clientId: selectedClient.id,
          hourlyRate: caregiverRateData.hourlyRate,
          notes: caregiverRateData.notes
        })
      });

      if (!response.ok) throw new Error('Failed to add rate');

      setCaregiverRateData({ caregiverId: '', hourlyRate: '', notes: '' });
      
      // Reload rates
      const ratesRes = await fetch(`${API_BASE_URL}/api/caregiver-client-rates?clientId=${selectedClient.id}`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      setCaregiverRates(await ratesRes.json());
    } catch (error) {
      alert('Failed to add rate: ' + error.message);
    }
  };

  const handleDeleteCaregiverRate = async (rateId) => {
    if (!window.confirm('End this rate?')) return;
    
    try {
      await fetch(`${API_BASE_URL}/api/caregiver-client-rates/${rateId}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${token}` }
      });
      
      const ratesRes = await fetch(`${API_BASE_URL}/api/caregiver-client-rates?clientId=${selectedClient.id}`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      setCaregiverRates(await ratesRes.json());
    } catch (error) {
      alert('Failed to delete rate: ' + error.message);
    }
  };

  const getReferralSourceName = (id) => {
    const rs = referralSources.find(r => r.id === id);
    return rs ? rs.name : '-';
  };

  const getCareTypeName = (id) => {
    const ct = careTypes.find(c => c.id === id);
    return ct ? ct.name : '-';
  };

  return (
    <div>
      <div className="page-header">
        <h2>👥 Clients</h2>
        <button 
          className="btn btn-primary"
          onClick={() => setShowForm(!showForm)}
        >
          {showForm ? '✕ Cancel' : '➕ Add Client'}
        </button>
      </div>

      {showForm && (
        <div className="card card-form">
          <h3>New Client Onboarding</h3>
          <form onSubmit={handleSubmit}>
            <div className="form-grid">
              <div className="form-group">
                <label>First Name *</label>
                <input
                  type="text"
                  value={formData.firstName}
                  onChange={(e) => setFormData({ ...formData, firstName: e.target.value })}
                  required
                />
              </div>

              <div className="form-group">
                <label>Last Name *</label>
                <input
                  type="text"
                  value={formData.lastName}
                  onChange={(e) => setFormData({ ...formData, lastName: e.target.value })}
                  required
                />
              </div>

              <div className="form-group">
                <label>Date of Birth</label>
                <input
                  type="date"
                  value={formData.dateOfBirth}
                  onChange={(e) => setFormData({ ...formData, dateOfBirth: e.target.value })}
                />
              </div>

              <div className="form-group">
                <label>Phone</label>
                <input
                  type="tel"
                  value={formData.phone}
                  onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                />
              </div>

              <div className="form-group">
                <label>Email</label>
                <input
                  type="email"
                  value={formData.email}
                  onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                />
              </div>

              <div className="form-group">
                <label>Address</label>
                <input
                  type="text"
                  value={formData.address}
                  onChange={(e) => setFormData({ ...formData, address: e.target.value })}
                />
              </div>

              <div className="form-group">
                <label>City</label>
                <input
                  type="text"
                  value={formData.city}
                  onChange={(e) => setFormData({ ...formData, city: e.target.value })}
                />
              </div>

              <div className="form-group">
                <label>State</label>
                <input
                  type="text"
                  value={formData.state}
                  onChange={(e) => setFormData({ ...formData, state: e.target.value })}
                  maxLength="2"
                />
              </div>

              <div className="form-group">
                <label>Zip</label>
                <input
                  type="text"
                  value={formData.zip}
                  onChange={(e) => setFormData({ ...formData, zip: e.target.value })}
                />
              </div>
            </div>

            <h4 style={{ marginTop: '1.5rem', marginBottom: '1rem', borderTop: '1px solid #eee', paddingTop: '1rem' }}>
              💰 Billing Information
            </h4>

            <div className="form-grid">
              <div className="form-group">
                <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <input
                    type="checkbox"
                    checked={formData.isPrivatePay}
                    onChange={(e) => setFormData({ ...formData, isPrivatePay: e.target.checked })}
                  />
                  Private Pay (No Referral Source)
                </label>
              </div>
            </div>

            {!formData.isPrivatePay ? (
              <div className="form-grid">
                <div className="form-group">
                  <label>Referral Source *</label>
                  <select
                    value={formData.referralSourceId}
                    onChange={(e) => setFormData({ ...formData, referralSourceId: e.target.value })}
                    required={!formData.isPrivatePay}
                  >
                    <option value="">Select referral source...</option>
                    {referralSources.map(rs => (
                      <option key={rs.id} value={rs.id}>{rs.name}</option>
                    ))}
                  </select>
                </div>

                <div className="form-group">
                  <label>Care Type *</label>
                  <select
                    value={formData.careTypeId}
                    onChange={(e) => setFormData({ ...formData, careTypeId: e.target.value })}
                    required={!formData.isPrivatePay}
                  >
                    <option value="">Select care type...</option>
                    {careTypes.map(ct => (
                      <option key={ct.id} value={ct.id}>{ct.name}</option>
                    ))}
                  </select>
                </div>
              </div>
            ) : (
              <div className="form-grid">
                <div className="form-group">
                  <label>Care Type</label>
                  <select
                    value={formData.careTypeId}
                    onChange={(e) => setFormData({ ...formData, careTypeId: e.target.value })}
                  >
                    <option value="">Select care type...</option>
                    {careTypes.map(ct => (
                      <option key={ct.id} value={ct.id}>{ct.name}</option>
                    ))}
                  </select>
                </div>

                <div className="form-group">
                  <label>Rate Type</label>
                  <select
                    value={formData.privatePayRateType}
                    onChange={(e) => setFormData({ ...formData, privatePayRateType: e.target.value })}
                  >
                    <option value="hourly">Per Hour</option>
                    <option value="15min">Per 15 Minutes</option>
                  </select>
                </div>

                <div className="form-group">
                  <label>Rate Amount *</label>
                  <input
                    type="number"
                    step="0.01"
                    value={formData.privatePayRate}
                    onChange={(e) => setFormData({ ...formData, privatePayRate: e.target.value })}
                    placeholder={formData.privatePayRateType === '15min' ? 'e.g., 6.25' : 'e.g., 25.00'}
                    required={formData.isPrivatePay}
                  />
                </div>
              </div>
            )}

            <div className="form-actions">
              <button type="submit" className="btn btn-primary">Add Client</button>
              <button type="button" className="btn btn-secondary" onClick={() => setShowForm(false)}>Cancel</button>
            </div>
          </form>
        </div>
      )}

      {loading ? (
        <div className="loading"><div className="spinner"></div></div>
      ) : clients.length === 0 ? (
        <div className="card card-centered">
          <p>No clients yet. Create one to get started.</p>
        </div>
      ) : (
        <table className="table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Phone</th>
              <th>Referral Source</th>
              <th>Care Type</th>
              <th>Pay Type</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {clients.map(client => (
              <tr key={client.id}>
                <td><strong>{client.first_name} {client.last_name}</strong></td>
                <td><a href={`tel:${client.phone}`}>{client.phone || 'N/A'}</a></td>
                <td>{client.is_private_pay ? '-' : getReferralSourceName(client.referral_source_id)}</td>
                <td>{getCareTypeName(client.care_type_id)}</td>
                <td>
                  {client.is_private_pay ? (
                    <span className="badge badge-info">Private Pay</span>
                  ) : (
                    <span className="badge badge-success">Referral</span>
                  )}
                </td>
                <td>
                  <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                    <button 
                      className="btn btn-sm btn-primary"
                      onClick={() => handleViewClient(client)}
                    >
                      Edit
                    </button>
                    <button 
                      className="btn btn-sm btn-secondary"
                      onClick={() => handleOpenBilling(client)}
                    >
                      💰 Billing
                    </button>
                    <button 
                      className="btn btn-sm btn-secondary"
                      onClick={() => handleOpenCaregiverRates(client)}
                    >
                      👤 Pay Rates
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <EditClientModal
        client={selectedClient}
        isOpen={showEditModal}
        onClose={() => {
          setShowEditModal(false);
          setSelectedClient(null);
        }}
        onSuccess={loadData}
        token={token}
      />

      {/* Billing Settings Modal */}
      {showBillingModal && selectedClient && (
        <div className="modal active">
          <div className="modal-content">
            <div className="modal-header">
              <h2>💰 Billing Settings - {selectedClient.first_name} {selectedClient.last_name}</h2>
              <button className="close-btn" onClick={() => setShowBillingModal(false)}>×</button>
            </div>

            <form onSubmit={handleSaveBilling}>
              <div className="form-group">
                <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <input
                    type="checkbox"
                    checked={billingData.isPrivatePay}
                    onChange={(e) => setBillingData({ ...billingData, isPrivatePay: e.target.checked })}
                  />
                  Private Pay (No Referral Source)
                </label>
              </div>

              {!billingData.isPrivatePay ? (
                <>
                  <div className="form-group">
                    <label>Referral Source</label>
                    <select
                      value={billingData.referralSourceId}
                      onChange={(e) => setBillingData({ ...billingData, referralSourceId: e.target.value })}
                    >
                      <option value="">Select referral source...</option>
                      {referralSources.map(rs => (
                        <option key={rs.id} value={rs.id}>{rs.name}</option>
                      ))}
                    </select>
                  </div>

                  <div className="form-group">
                    <label>Care Type</label>
                    <select
                      value={billingData.careTypeId}
                      onChange={(e) => setBillingData({ ...billingData, careTypeId: e.target.value })}
                    >
                      <option value="">Select care type...</option>
                      {careTypes.map(ct => (
                        <option key={ct.id} value={ct.id}>{ct.name}</option>
                      ))}
                    </select>
                  </div>
                </>
              ) : (
                <>
                  <div className="form-group">
                    <label>Care Type</label>
                    <select
                      value={billingData.careTypeId}
                      onChange={(e) => setBillingData({ ...billingData, careTypeId: e.target.value })}
                    >
                      <option value="">Select care type...</option>
                      {careTypes.map(ct => (
                        <option key={ct.id} value={ct.id}>{ct.name}</option>
                      ))}
                    </select>
                  </div>

                  <div className="form-group">
                    <label>Rate Type</label>
                    <select
                      value={billingData.privatePayRateType}
                      onChange={(e) => setBillingData({ ...billingData, privatePayRateType: e.target.value })}
                    >
                      <option value="hourly">Per Hour</option>
                      <option value="15min">Per 15 Minutes</option>
                    </select>
                  </div>

                  <div className="form-group">
                    <label>Rate Amount</label>
                    <input
                      type="number"
                      step="0.01"
                      value={billingData.privatePayRate}
                      onChange={(e) => setBillingData({ ...billingData, privatePayRate: e.target.value })}
                      placeholder="e.g., 25.00"
                    />
                  </div>
                </>
              )}

              <div className="form-group">
                <label>Billing Notes</label>
                <textarea
                  value={billingData.billingNotes}
                  onChange={(e) => setBillingData({ ...billingData, billingNotes: e.target.value })}
                  rows="3"
                  placeholder="Any special billing instructions..."
                />
              </div>

              <div className="modal-actions">
                <button type="submit" className="btn btn-primary">Save Billing Settings</button>
                <button type="button" className="btn btn-secondary" onClick={() => setShowBillingModal(false)}>Cancel</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Caregiver Pay Rates Modal */}
      {showCaregiverRateModal && selectedClient && (
        <div className="modal active">
          <div className="modal-content modal-large">
            <div className="modal-header">
              <h2>👤 Caregiver Pay Rates - {selectedClient.first_name} {selectedClient.last_name}</h2>
              <button className="close-btn" onClick={() => setShowCaregiverRateModal(false)}>×</button>
            </div>

            <p className="text-muted" style={{ marginBottom: '1rem' }}>
              Set custom pay rates for caregivers working with this client. 
              If no rate is set, the caregiver's default rate will be used.
            </p>

            <form onSubmit={handleAddCaregiverRate} style={{ marginBottom: '1.5rem' }}>
              <div className="form-grid" style={{ gridTemplateColumns: '1fr 1fr 2fr auto' }}>
                <div className="form-group">
                  <label>Caregiver</label>
                  <select
                    value={caregiverRateData.caregiverId}
                    onChange={(e) => setCaregiverRateData({ ...caregiverRateData, caregiverId: e.target.value })}
                    required
                  >
                    <option value="">Select...</option>
                    {caregivers.map(cg => (
                      <option key={cg.id} value={cg.id}>
                        {cg.first_name} {cg.last_name}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="form-group">
                  <label>Hourly Rate</label>
                  <input
                    type="number"
                    step="0.01"
                    value={caregiverRateData.hourlyRate}
                    onChange={(e) => setCaregiverRateData({ ...caregiverRateData, hourlyRate: e.target.value })}
                    placeholder="e.g., 15.00"
                    required
                  />
                </div>

                <div className="form-group">
                  <label>Notes</label>
                  <input
                    type="text"
                    value={caregiverRateData.notes}
                    onChange={(e) => setCaregiverRateData({ ...caregiverRateData, notes: e.target.value })}
                    placeholder="Optional notes..."
                  />
                </div>

                <div className="form-group" style={{ display: 'flex', alignItems: 'flex-end' }}>
                  <button type="submit" className="btn btn-primary">Add Rate</button>
                </div>
              </div>
            </form>

            {caregiverRates.length === 0 ? (
              <div className="card card-centered">
                <p>No custom rates set. Caregivers will use their default rates.</p>
              </div>
            ) : (
              <table className="table">
                <thead>
                  <tr>
                    <th>Caregiver</th>
                    <th>Hourly Rate</th>
                    <th>Effective Date</th>
                    <th>Notes</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {caregiverRates.map(rate => (
                    <tr key={rate.id}>
                      <td><strong>{rate.caregiver_first_name} {rate.caregiver_last_name}</strong></td>
                      <td><strong>${parseFloat(rate.hourly_rate).toFixed(2)}</strong>/hr</td>
                      <td>{new Date(rate.effective_date).toLocaleDateString()}</td>
                      <td>{rate.notes || '-'}</td>
                      <td>
                        <button 
                          className="btn btn-sm btn-danger"
                          onClick={() => handleDeleteCaregiverRate(rate.id)}
                        >
                          End Rate
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}

            <div className="modal-actions">
              <button className="btn btn-secondary" onClick={() => setShowCaregiverRateModal(false)}>Close</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default ClientsManagement;
