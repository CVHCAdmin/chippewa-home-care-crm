// src/components/admin/EditClientModal.jsx
import React, { useState, useEffect } from 'react';
import { API_BASE_URL } from '../../config';

const EditClientModal = ({ client, isOpen, onClose, onSuccess, token }) => {
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
    serviceType: 'personal_care',
    emergencyContactName: '',
    emergencyContactPhone: '',
    emergencyContactRelationship: '',
    medicalNotes: '',
    allergies: '',
    preferredCaregivers: ''
  });
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');
  const [deleteConfirm, setDeleteConfirm] = useState(false);

  useEffect(() => {
    if (client && isOpen) {
      setFormData({
        firstName: client.first_name || '',
        lastName: client.last_name || '',
        dateOfBirth: client.date_of_birth || '',
        phone: client.phone || '',
        email: client.email || '',
        address: client.address || '',
        city: client.city || '',
        state: client.state || 'WI',
        zip: client.zip || '',
        serviceType: client.service_type || 'personal_care',
        emergencyContactName: client.emergency_contact_name || '',
        emergencyContactPhone: client.emergency_contact_phone || '',
        emergencyContactRelationship: client.emergency_contact_relationship || '',
        medicalNotes: client.medical_notes || '',
        allergies: client.allergies || '',
        preferredCaregivers: client.preferred_caregivers || ''
      });
      setDeleteConfirm(false);
      setMessage('');
    }
  }, [client, isOpen]);

  const handleSave = async (e) => {
  e.preventDefault();
  setLoading(true);
  setMessage('');

  try {
    // Clean up empty fields - convert empty strings to null for optional fields
    const cleanedData = {
      firstName: formData.firstName,
      lastName: formData.lastName,
      serviceType: formData.serviceType,
      // Optional fields - only send if not empty
      dateOfBirth: formData.dateOfBirth || null,
      phone: formData.phone || null,
      email: formData.email || null,
      address: formData.address || null,
      city: formData.city || null,
      state: formData.state || null,
      zip: formData.zip || null,
      emergencyContactName: formData.emergencyContactName || null,
      emergencyContactPhone: formData.emergencyContactPhone || null,
      emergencyContactRelationship: formData.emergencyContactRelationship || null,
      medicalNotes: formData.medicalNotes || null,
      allergies: formData.allergies || null,
      preferredCaregivers: formData.preferredCaregivers || null
    };

    const response = await fetch(`${API_BASE_URL}/api/clients/${client.id}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify(cleanedData)
    });

    if (!response.ok) {
      throw new Error('Failed to update client');
    }

    setMessage('Client updated successfully!');
    setTimeout(() => {
      onSuccess();
      onClose();
    }, 1500);
  } catch (error) {
    setMessage('Error: ' + error.message);
  } finally {
    setLoading(false);
  }
};

      if (!response.ok) {
        throw new Error('Failed to update client');
      }

      setMessage('Client updated successfully!');
      setTimeout(() => {
        onSuccess();
        onClose();
      }, 1500);
    } catch (error) {
      setMessage('Error: ' + error.message);
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async () => {
    if (!deleteConfirm) {
      setDeleteConfirm(true);
      return;
    }

    setLoading(true);

    try {
      const response = await fetch(`${API_BASE_URL}/api/clients/${client.id}`, {
        method: 'DELETE',
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });

      if (!response.ok) {
        throw new Error('Failed to delete client');
      }

      setMessage('Client deleted. Closing...');
      setTimeout(() => {
        onSuccess();
        onClose();
      }, 1500);
    } catch (error) {
      setMessage('Error: ' + error.message);
      setDeleteConfirm(false);
    } finally {
      setLoading(false);
    }
  };

  if (!isOpen || !client) return null;

  return (
    <div className="modal active">
      <div className="modal-content">
        <div className="modal-header">
          <h2>Edit Client: {client.first_name} {client.last_name}</h2>
          <button className="close-btn" onClick={onClose}>×</button>
        </div>

        {message && (
          <div className={`alert ${message.includes('Error') ? 'alert-error' : 'alert-success'}`}>
            {message}
          </div>
        )}

        <form onSubmit={handleSave}>
          {/* Basic Info */}
          <div style={{ marginBottom: '1.5rem' }}>
            <h4 style={{ borderBottom: '1px solid #ddd', paddingBottom: '0.5rem', marginBottom: '1rem' }}>
              Basic Information
            </h4>
            <div className="form-grid-2">
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
            </div>
          </div>

          {/* Contact Info */}
          <div style={{ marginBottom: '1.5rem' }}>
            <h4 style={{ borderBottom: '1px solid #ddd', paddingBottom: '0.5rem', marginBottom: '1rem' }}>
              Contact Information
            </h4>
            <div className="form-grid-2">
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
          </div>

          {/* Emergency Contact */}
          <div style={{ marginBottom: '1.5rem' }}>
            <h4 style={{ borderBottom: '1px solid #ddd', paddingBottom: '0.5rem', marginBottom: '1rem' }}>
              Emergency Contact
            </h4>
            <div className="form-grid-2">
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
          </div>

          {/* Medical Information */}
          <div style={{ marginBottom: '1.5rem' }}>
            <h4 style={{ borderBottom: '1px solid #ddd', paddingBottom: '0.5rem', marginBottom: '1rem' }}>
              Medical Information
            </h4>
            <div className="form-group">
              <label>Allergies</label>
              <textarea
                value={formData.allergies}
                onChange={(e) => setFormData({ ...formData, allergies: e.target.value })}
                placeholder="List any allergies..."
                rows="2"
              ></textarea>
            </div>

            <div className="form-group">
              <label>Medical Notes</label>
              <textarea
                value={formData.medicalNotes}
                onChange={(e) => setFormData({ ...formData, medicalNotes: e.target.value })}
                placeholder="Conditions, medications, care instructions..."
                rows="3"
              ></textarea>
            </div>

            <div className="form-group">
              <label>Preferred Caregivers / Notes</label>
              <textarea
                value={formData.preferredCaregivers}
                onChange={(e) => setFormData({ ...formData, preferredCaregivers: e.target.value })}
                placeholder="Any caregiver preferences or special notes..."
                rows="2"
              ></textarea>
            </div>
          </div>

          {/* Actions */}
          <div className="modal-actions">
            <button type="submit" className="btn btn-primary" disabled={loading}>
              {loading ? 'Saving...' : 'Save Changes'}
            </button>
            <button type="button" className="btn btn-secondary" onClick={onClose} disabled={loading}>
              Cancel
            </button>
            {!deleteConfirm ? (
              <button
                type="button"
                className="btn btn-danger"
                onClick={handleDelete}
                disabled={loading}
              >
                Delete Client
              </button>
            ) : (
              <button
                type="button"
                className="btn btn-danger"
                onClick={handleDelete}
                disabled={loading}
                style={{ background: '#8B0000' }}
              >
                Confirm Delete
              </button>
            )}
          </div>
        </form>
      </div>
    </div>
  );
};

export default EditClientModal;
