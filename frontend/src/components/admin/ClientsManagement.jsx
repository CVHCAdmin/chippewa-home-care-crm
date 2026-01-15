// src/components/admin/ClientsManagement.jsx
import React, { useState, useEffect } from 'react';
import { API_BASE_URL } from '../../config';
import EditClientModal from './EditClientModal';

// AddressLink component - opens Google Maps
const AddressLink = ({ address, city, state, zip }) => {
  if (!address && !city) return <span>-</span>;
  
  const fullAddress = [address, city, state, zip].filter(Boolean).join(', ');
  const mapsUrl = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(fullAddress)}`;
  
  return (
    <a 
      href={mapsUrl} 
      target="_blank" 
      rel="noopener noreferrer"
      title={`Open in Google Maps: ${fullAddress}`}
      style={{ display: 'flex', alignItems: 'center', gap: '4px' }}
    >
      📍 {city || address}
    </a>
  );
};

const ClientsManagement = ({ token }) => {
  const [clients, setClients] = useState([]);
  const [referralSources, setReferralSources] = useState([]);
  const [careTypes, setCareTypes] = useState([]);
  const [showForm, setShowForm] = useState(false);
  const [loading, setLoading] = useState(true);
  const [selectedClient, setSelectedClient] = useState(null);
  const [showEditModal, setShowEditModal] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [filterReferral, setFilterReferral] = useState('');
  const [filterCareType, setFilterCareType] = useState('');
  
  const initialFormData = {
    // Basic Info
    firstName: '',
    lastName: '',
    dateOfBirth: '',
    gender: '',
    phone: '',
    email: '',
    // Address
    address: '',
    city: '',
    state: 'WI',
    zip: '',
    // Billing/Referral
    referralSourceId: '',
    careTypeId: '',
    isPrivatePay: false,
    privatePayRate: '',
    privatePayRateType: 'hourly',
    // Emergency Contact
    emergencyContactName: '',
    emergencyContactPhone: '',
    emergencyContactRelationship: '',
    // Notes
    notes: ''
  };

  const [formData, setFormData] = useState(initialFormData);

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    try {
      const [clientRes, rsRes, ctRes] = await Promise.all([
        fetch(`${API_BASE_URL}/api/clients`, { headers: { 'Authorization': `Bearer ${token}` } }),
        fetch(`${API_BASE_URL}/api/referral-sources`, { headers: { 'Authorization': `Bearer ${token}` } }),
        fetch(`${API_BASE_URL}/api/care-types`, { headers: { 'Authorization': `Bearer ${token}` } })
      ]);

      setClients(await clientRes.json());
      setReferralSources(await rsRes.json());
      setCareTypes(await ctRes.json());
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
        gender: formData.gender || null,
        phone: formData.phone || null,
        email: formData.email || null,
        address: formData.address || null,
        city: formData.city || null,
        state: formData.state || null,
        zip: formData.zip || null,
        referralSourceId: formData.referralSourceId || null,
        careTypeId: formData.careTypeId || null,
        isPrivatePay: formData.isPrivatePay,
        privatePayRate: formData.isPrivatePay ? parseFloat(formData.privatePayRate) : null,
        privatePayRateType: formData.privatePayRateType,
        emergencyContactName: formData.emergencyContactName || null,
        emergencyContactPhone: formData.emergencyContactPhone || null,
        emergencyContactRelationship: formData.emergencyContactRelationship || null,
        notes: formData.notes || null
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

      setFormData(initialFormData);
      setShowForm(false);
      loadData();
      alert('Client added successfully!');
    } catch (error) {
      alert('Failed to create client: ' + error.message);
    }
  };

  const handleViewClient = (client) => {
    setSelectedClient(client);
    setShowEditModal(true);
  };

  const getReferralSourceName = (id) => {
    const rs = referralSources.find(r => r.id === id);
    return rs ? rs.name : '-';
  };

  const getCareTypeName = (id) => {
    const ct = careTypes.find(c => c.id === id);
    return ct ? ct.name : '-';
  };

  // Filter clients
  const filteredClients = clients.filter(client => {
    const matchesSearch = !searchTerm || 
      `${client.first_name} ${client.last_name}`.toLowerCase().includes(searchTerm.toLowerCase()) ||
      (client.phone && client.phone.includes(searchTerm)) ||
      (client.email && client.email.toLowerCase().includes(searchTerm.toLowerCase()));
    
    const matchesReferral = !filterReferral || client.referral_source_id === filterReferral;
    const matchesCareType = !filterCareType || client.care_type_id === filterCareType;
    
    return matchesSearch && matchesReferral && matchesCareType;
  });

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

      {/* Add Client Form */}
      {showForm && (
        <div className="card card-form">
          <h3>Add New Client</h3>
          <form onSubmit={handleSubmit}>
            
            {/* Basic Information */}
            <h4 style={{ borderBottom: '2px solid #007bff', paddingBottom: '0.5rem', marginTop: '1rem', marginBottom: '1rem' }}>📋 Basic Information</h4>
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
                <label>Gender</label>
                <select
                  value={formData.gender}
                  onChange={(e) => setFormData({ ...formData, gender: e.target.value })}
                >
                  <option value="">Select...</option>
                  <option value="M">Male</option>
                  <option value="F">Female</option>
                  <option value="Other">Other</option>
                </select>
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
            </div>

            {/* Address */}
            <h4 style={{ borderBottom: '2px solid #007bff', paddingBottom: '0.5rem', marginTop: '1rem', marginBottom: '1rem' }}>🏠 Address</h4>
            <div className="form-grid">
              <div className="form-group" style={{ gridColumn: '1 / -1' }}>
                <label>Street Address</label>
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
                <label>Zip Code</label>
                <input
                  type="text"
                  value={formData.zip}
                  onChange={(e) => setFormData({ ...formData, zip: e.target.value })}
                />
              </div>
            </div>

            {/* Billing & Referral */}
            <h4 style={{ borderBottom: '2px solid #007bff', paddingBottom: '0.5rem', marginTop: '1rem', marginBottom: '1rem' }}>💰 Billing & Referral</h4>
            <div className="form-grid">
              <div className="form-group" style={{ gridColumn: '1 / -1' }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <input
                    type="checkbox"
                    checked={formData.isPrivatePay}
                    onChange={(e) => setFormData({ ...formData, isPrivatePay: e.target.checked })}
                  />
                  Private Pay (Client pays directly, no referral source)
                </label>
              </div>

              {!formData.isPrivatePay ? (
                <>
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
                </>
              ) : (
                <>
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
                      min="0"
                      value={formData.privatePayRate}
                      onChange={(e) => setFormData({ ...formData, privatePayRate: e.target.value })}
                      placeholder={formData.privatePayRateType === '15min' ? 'e.g., 6.25' : 'e.g., 25.00'}
                      required={formData.isPrivatePay}
                    />
                  </div>
                </>
              )}
            </div>

            {/* Emergency Contact */}
            <h4 style={{ borderBottom: '2px solid #007bff', paddingBottom: '0.5rem', marginTop: '1rem', marginBottom: '1rem' }}>🚨 Emergency Contact</h4>
            <div className="form-grid">
              <div className="form-group">
                <label>Contact Name</label>
                <input
                  type="text"
                  value={formData.emergencyContactName}
                  onChange={(e) => setFormData({ ...formData, emergencyContactName: e.target.value })}
                />
              </div>
              <div className="form-group">
                <label>Phone</label>
                <input
                  type="tel"
                  value={formData.emergencyContactPhone}
                  onChange={(e) => setFormData({ ...formData, emergencyContactPhone: e.target.value })}
                />
              </div>
              <div className="form-group">
                <label>Relationship</label>
                <input
                  type="text"
                  value={formData.emergencyContactRelationship}
                  onChange={(e) => setFormData({ ...formData, emergencyContactRelationship: e.target.value })}
                  placeholder="e.g., Spouse, Son, Daughter"
                />
              </div>
            </div>

            {/* Notes */}
            <h4 style={{ borderBottom: '2px solid #007bff', paddingBottom: '0.5rem', marginTop: '1rem', marginBottom: '1rem' }}>📝 Notes</h4>
            <div className="form-group">
              <textarea
                value={formData.notes}
                onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
                placeholder="Any initial notes about the client..."
                rows="3"
              />
            </div>

            <div className="form-actions">
              <button type="submit" className="btn btn-primary">Add Client</button>
              <button type="button" className="btn btn-secondary" onClick={() => setShowForm(false)}>Cancel</button>
            </div>
          </form>
        </div>
      )}

      {/* Search and Filters */}
      <div className="card" style={{ marginBottom: '1rem', padding: '1rem' }}>
        <div className="form-grid" style={{ gridTemplateColumns: '2fr 1fr 1fr', gap: '1rem' }}>
          <div className="form-group" style={{ marginBottom: 0 }}>
            <input
              type="text"
              placeholder="🔍 Search by name, phone, or email..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
            />
          </div>
          <div className="form-group" style={{ marginBottom: 0 }}>
            <select
              value={filterReferral}
              onChange={(e) => setFilterReferral(e.target.value)}
            >
              <option value="">All Referral Sources</option>
              {referralSources.map(rs => (
                <option key={rs.id} value={rs.id}>{rs.name}</option>
              ))}
            </select>
          </div>
          <div className="form-group" style={{ marginBottom: 0 }}>
            <select
              value={filterCareType}
              onChange={(e) => setFilterCareType(e.target.value)}
            >
              <option value="">All Care Types</option>
              {careTypes.map(ct => (
                <option key={ct.id} value={ct.id}>{ct.name}</option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {/* Clients Table */}
      {loading ? (
        <div className="loading"><div className="spinner"></div></div>
      ) : filteredClients.length === 0 ? (
        <div className="card card-centered">
          <p>{clients.length === 0 ? 'No clients yet. Add one to get started.' : 'No clients match your filters.'}</p>
        </div>
      ) : (
        <table className="table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Phone</th>
              <th>Address</th>
              <th>Referral Source</th>
              <th>Care Type</th>
              <th>Status</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {filteredClients.map(client => (
              <tr key={client.id}>
                <td>
                  <strong>{client.first_name} {client.last_name}</strong>
                  {client.date_of_birth && (
                    <small style={{ display: 'block', color: '#666' }}>
                      DOB: {new Date(client.date_of_birth).toLocaleDateString()}
                    </small>
                  )}
                </td>
                <td><a href={`tel:${client.phone}`}>{client.phone || 'N/A'}</a></td>
                <td>
                  <AddressLink 
                    address={client.address}
                    city={client.city}
                    state={client.state}
                    zip={client.zip}
                  />
                </td>
                <td>
                  {client.is_private_pay ? (
                    <span className="text-muted">-</span>
                  ) : (
                    getReferralSourceName(client.referral_source_id)
                  )}
                </td>
                <td>{getCareTypeName(client.care_type_id)}</td>
                <td>
                  {client.is_private_pay ? (
                    <span className="badge badge-info">Private Pay</span>
                  ) : (
                    <span className="badge badge-success">Referred</span>
                  )}
                </td>
                <td>
                  <button 
                    className="btn btn-sm btn-primary"
                    onClick={() => handleViewClient(client)}
                  >
                    View / Edit
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {/* Summary */}
      {!loading && clients.length > 0 && (
        <div style={{ marginTop: '1rem', fontSize: '0.9rem', color: '#666' }}>
          Showing {filteredClients.length} of {clients.length} clients
        </div>
      )}

      <EditClientModal
        client={selectedClient}
        referralSources={referralSources}
        careTypes={careTypes}
        isOpen={showEditModal}
        onClose={() => {
          setShowEditModal(false);
          setSelectedClient(null);
        }}
        onSuccess={loadData}
        token={token}
      />
    </div>
  );
};

export default ClientsManagement;
