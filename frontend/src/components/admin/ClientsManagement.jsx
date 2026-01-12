// src/components/admin/ClientsManagement.jsx
import React, { useState, useEffect } from 'react';
import { getClients, createClient } from '../../config';
import EditClientModal from './EditClientModal';

const ClientsManagement = ({ token }) => {
  const [clients, setClients] = useState([]);
  const [showForm, setShowForm] = useState(false);
  const [loading, setLoading] = useState(true);
  const [selectedClient, setSelectedClient] = useState(null);
  const [showEditModal, setShowEditModal] = useState(false);
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
    serviceType: 'personal_care'
  });

  useEffect(() => {
    loadClients();
  }, []);

  const loadClients = async () => {
    try {
      const data = await getClients(token);
      setClients(data);
    } catch (error) {
      console.error('Failed to load clients:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    try {
      await createClient(formData, token);
      setFormData({
        firstName: '',
        lastName: '',
        dateOfBirth: '',
        phone: '',
        email: '',
        address: '',
        city: '',
        state: 'WI',
        zip: '',
        serviceType: 'personal_care'
      });
      setShowForm(false);
      loadClients();
    } catch (error) {
      alert('Failed to create client: ' + error.message);
    }
  };

  const handleViewClient = (client) => {
    setSelectedClient(client);
    setShowEditModal(true);
  };

  return (
    <div>
      <div className="page-header">
        <h2>Clients</h2>
        <button 
          className="btn btn-primary"
          onClick={() => setShowForm(!showForm)}
        >
          {showForm ? 'Cancel' : 'Add Client'}
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
                <label>Service Type *</label>
                <select
                  value={formData.serviceType}
                  onChange={(e) => setFormData({ ...formData, serviceType: e.target.value })}
                >
                  <option value="personal_care">Personal Care</option>
                  <option value="companionship">Companionship</option>
                  <option value="respite_care">Respite Care</option>
                  <option value="medication_management">Medication Management</option>
                </select>
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
              <th>Service Type</th>
              <th>City</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {clients.map(client => (
              <tr key={client.id}>
                <td>
                  <strong>{client.first_name} {client.last_name}</strong>
                </td>
                <td><a href={`tel:${client.phone}`}>{client.phone || 'N/A'}</a></td>
                <td>
                  <span className="badge badge-success">
                    {client.service_type?.replace('_', ' ').toUpperCase()}
                  </span>
                </td>
                <td>{client.city || 'N/A'}</td>
                <td>
                  <button 
                    className="btn btn-sm btn-primary"
                    onClick={() => handleViewClient(client)}
                  >
                    Edit
                  </button>
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
        onSuccess={loadClients}
        token={token}
      />
    </div>
  );
};

export default ClientsManagement;
