// src/components/admin/ReferralSources.jsx
import React, { useState, useEffect } from 'react';
import { API_BASE_URL, getReferralSources, createReferralSource } from '../../config';

const ReferralSources = ({ token }) => {
  const [sources, setSources] = useState([]);
  const [showForm, setShowForm] = useState(false);
  const [loading, setLoading] = useState(true);
  const [editingId, setEditingId] = useState(null);
  const [formData, setFormData] = useState({
    name: '',
    type: 'doctor',
    contactName: '',
    email: '',
    phone: '',
    address: '',
    city: '',
    state: 'WI',
    zip: ''
  });

  const emptyForm = {
    name: '',
    type: 'doctor',
    contactName: '',
    email: '',
    phone: '',
    address: '',
    city: '',
    state: 'WI',
    zip: ''
  };

  useEffect(() => {
    loadSources();
  }, []);

  const loadSources = async () => {
    try {
      const data = await getReferralSources(token);
      setSources(data);
    } catch (error) {
      console.error('Failed to load referral sources:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleEdit = (source) => {
    setEditingId(source.id);
    setFormData({
      name: source.name || '',
      type: source.type || 'doctor',
      contactName: source.contact_name || '',
      email: source.email || '',
      phone: source.phone || '',
      address: source.address || '',
      city: source.city || '',
      state: source.state || 'WI',
      zip: source.zip || ''
    });
    setShowForm(true);
  };

  const handleCancel = () => {
    setShowForm(false);
    setEditingId(null);
    setFormData(emptyForm);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    try {
      if (editingId) {
        // Update existing
        const response = await fetch(`${API_BASE_URL}/api/referral-sources/${editingId}`, {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`
          },
          body: JSON.stringify(formData)
        });
        if (!response.ok) throw new Error('Failed to update');
      } else {
        // Create new
        await createReferralSource(formData, token);
      }
      
      setFormData(emptyForm);
      setShowForm(false);
      setEditingId(null);
      loadSources();
    } catch (error) {
      alert(`Failed to ${editingId ? 'update' : 'create'} referral source: ` + error.message);
    }
  };

  const handleDelete = async (id, name) => {
    if (!window.confirm(`Are you sure you want to delete "${name}"? This cannot be undone.`)) {
      return;
    }
    
    try {
      const response = await fetch(`${API_BASE_URL}/api/referral-sources/${id}`, {
        method: 'DELETE',
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });
      if (!response.ok) throw new Error('Failed to delete');
      loadSources();
    } catch (error) {
      alert('Failed to delete referral source: ' + error.message);
    }
  };

  return (
    <div>
      <div className="page-header">
        <h2>🏥 Referral Sources</h2>
        <button 
          className="btn btn-primary"
          onClick={() => {
            if (showForm) {
              handleCancel();
            } else {
              setShowForm(true);
            }
          }}
        >
          {showForm ? '✕ Cancel' : '➕ Add Referral Source'}
        </button>
      </div>

      {showForm && (
        <div className="card card-form">
          <h3>{editingId ? 'Edit Referral Source' : 'Add New Referral Source'}</h3>
          <form onSubmit={handleSubmit}>
            <div className="form-grid">
              <div className="form-group">
                <label>Organization Name *</label>
                <input
                  type="text"
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  required
                  placeholder="Hospital, Doctor's Office, etc."
                />
              </div>

              <div className="form-group">
                <label>Type *</label>
                <select
                  value={formData.type}
                  onChange={(e) => setFormData({ ...formData, type: e.target.value })}
                >
                  <option value="hospital">Hospital</option>
                  <option value="doctor">Doctor</option>
                  <option value="agency">Agency</option>
                  <option value="social_services">Social Services</option>
                  <option value="family">Family</option>
                </select>
              </div>

              <div className="form-group">
                <label>Contact Name</label>
                <input
                  type="text"
                  value={formData.contactName}
                  onChange={(e) => setFormData({ ...formData, contactName: e.target.value })}
                  placeholder="John Doe"
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
                <label>Phone</label>
                <input
                  type="tel"
                  value={formData.phone}
                  onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                />
              </div>

              <div className="form-group">
                <label>Address</label>
                <input
                  type="text"
                  value={formData.address}
                  onChange={(e) => setFormData({ ...formData, address: e.target.value })}
                  placeholder="123 Main St"
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
                  maxLength={2}
                />
              </div>

              <div className="form-group">
                <label>ZIP</label>
                <input
                  type="text"
                  value={formData.zip}
                  onChange={(e) => setFormData({ ...formData, zip: e.target.value })}
                  maxLength={10}
                />
              </div>
            </div>

            <div className="form-actions">
              <button type="submit" className="btn btn-primary">
                {editingId ? 'Update Referral Source' : 'Save Referral Source'}
              </button>
              <button type="button" className="btn btn-secondary" onClick={handleCancel}>
                Cancel
              </button>
            </div>
          </form>
        </div>
      )}

      {loading ? (
        <div className="loading"><div className="spinner"></div></div>
      ) : sources.length === 0 ? (
        <div className="card card-centered">
          <p>No referral sources yet. Create one to get started.</p>
        </div>
      ) : (
        <div className="grid">
          {sources.map(source => (
            <div key={source.id} className="card">
              <div className="source-card-header">
                <h4>{source.name}</h4>
                <span className="badge badge-info">{source.type}</span>
              </div>

              {source.contact_name && <p><strong>Contact:</strong> {source.contact_name}</p>}
              {source.phone && <p><strong>Phone:</strong> <a href={`tel:${source.phone}`}>{source.phone}</a></p>}
              {source.email && <p><strong>Email:</strong> <a href={`mailto:${source.email}`}>{source.email}</a></p>}
              {(source.address || source.city) && (
                <p><strong>Location:</strong> {source.address && `${source.address}, `}{source.city}, {source.state} {source.zip}</p>
              )}

              <div className="source-card-footer" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '1rem', paddingTop: '1rem', borderTop: '1px solid #eee' }}>
                <p style={{ margin: 0 }}><strong>{source.referral_count || 0} referrals</strong></p>
                <div style={{ display: 'flex', gap: '0.5rem' }}>
                  <button 
                    className="btn btn-secondary" 
                    style={{ padding: '0.25rem 0.75rem', fontSize: '0.875rem' }}
                    onClick={() => handleEdit(source)}
                  >
                    ✏️ Edit
                  </button>
                  <button 
                    className="btn btn-danger" 
                    style={{ padding: '0.25rem 0.75rem', fontSize: '0.875rem' }}
                    onClick={() => handleDelete(source.id, source.name)}
                  >
                    🗑️ Delete
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default ReferralSources;
