// src/components/admin/ReferralSources.jsx
import React, { useState, useEffect } from 'react';
import { getReferralSources, createReferralSource } from '../../config';

const ReferralSources = ({ token }) => {
  const [sources, setSources] = useState([]);
  const [showForm, setShowForm] = useState(false);
  const [loading, setLoading] = useState(true);
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

  const handleSubmit = async (e) => {
    e.preventDefault();
    try {
      await createReferralSource(formData, token);
      setFormData({
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
      setShowForm(false);
      loadSources();
    } catch (error) {
      alert('Failed to create referral source: ' + error.message);
    }
  };

  return (
    <div>
      <div className="page-header">
        <h2>🏥 Referral Sources</h2>
        <button 
          className="btn btn-primary"
          onClick={() => setShowForm(!showForm)}
        >
          {showForm ? '✕ Cancel' : '➕ Add Referral Source'}
        </button>
      </div>

      {showForm && (
        <div className="card card-form">
          <h3>Add New Referral Source</h3>
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
                <label>City</label>
                <input
                  type="text"
                  value={formData.city}
                  onChange={(e) => setFormData({ ...formData, city: e.target.value })}
                />
              </div>
            </div>

            <div className="form-actions">
              <button type="submit" className="btn btn-primary">Save Referral Source</button>
              <button type="button" className="btn btn-secondary" onClick={() => setShowForm(false)}>Cancel</button>
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
              {source.city && <p><strong>Location:</strong> {source.city}, {source.state}</p>}

              <div className="source-card-footer">
                <p><strong>{source.referral_count || 0} referrals</strong></p>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default ReferralSources;
