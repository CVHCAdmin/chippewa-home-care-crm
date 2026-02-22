// src/components/admin/EditClientModal.jsx
import React, { useState, useEffect } from 'react';
import { API_BASE_URL } from '../../config';

const formatDateForInput = (dateString) => {
  if (!dateString) return '';
  const date = new Date(dateString);
  return date.toISOString().split('T')[0];
};

const EditClientModal = ({ client, referralSources = [], careTypes = [], isOpen, onClose, onSuccess, token }) => {
  const [activeTab, setActiveTab] = useState('basic');
  const [formData, setFormData] = useState({});
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');
  const [deleteConfirm, setDeleteConfirm] = useState(false);

  // ── Portal state ──────────────────────────────────────────────────────────
  const [portalStatus, setPortalStatus]   = useState(null);
  const [portalEmail, setPortalEmail]     = useState('');
  const [portalLoading, setPortalLoading] = useState(false);
  const [portalMessage, setPortalMessage] = useState({ text: '', type: '' });
  const [inviteUrl, setInviteUrl]         = useState('');

  useEffect(() => {
    if (client && isOpen) {
      setFormData({
        // Basic Info
        firstName: client.first_name || '',
        lastName: client.last_name || '',
        dateOfBirth: formatDateForInput(client.date_of_birth),
        gender: client.gender || '',
        phone: client.phone || '',
        email: client.email || '',
        // Address
        address: client.address || '',
        city: client.city || '',
        state: client.state || 'WI',
        zip: client.zip || '',
        // Billing/Referral
        referralSourceId: client.referral_source_id || '',
        careTypeId: client.care_type_id || '',
        isPrivatePay: client.is_private_pay || false,
        privatePayRate: client.private_pay_rate || '',
        privatePayRateType: client.private_pay_rate_type || 'hourly',
        billingNotes: client.billing_notes || '',
        weeklyAuthorizedUnits: client.weekly_authorized_units || '',
        // Emergency Contact
        emergencyContactName: client.emergency_contact_name || '',
        emergencyContactPhone: client.emergency_contact_phone || '',
        emergencyContactRelationship: client.emergency_contact_relationship || '',
        // Medical
        medicalConditions: client.medical_conditions || '',
        medications: client.medications || '',
        allergies: client.allergies || '',
        medicalNotes: client.medical_notes || '',
        mobilityAssistanceNeeds: client.mobility_assistance_needs || '',
        // Insurance
        insuranceProvider: client.insurance_provider || '',
        insuranceId: client.insurance_id || '',
        insuranceGroup: client.insurance_group || '',
        // Caregiver Preferences
        carePreferences: client.care_preferences || '',
        preferredCaregivers: client.preferred_caregivers || '',
        doNotUseCaregivers: client.do_not_use_caregivers || '',
        // Notes
        notes: client.notes || ''
      });
      setActiveTab('basic');
      setDeleteConfirm(false);
      setMessage('');

      // Load portal status for this client
      setPortalStatus(null);
      setPortalEmail(client.email || '');
      setInviteUrl('');
      setPortalMessage({ text: '', type: '' });
      fetch(`${API_BASE_URL}/api/client-portal/admin/clients`, {
        headers: { 'Authorization': `Bearer ${token}` }
      })
        .then(r => r.json())
        .then(data => {
          const found = Array.isArray(data) ? data.find(c => c.id === client.id) : null;
          if (found) {
            setPortalStatus(found.portal_status);
            if (found.portal_email) setPortalEmail(found.portal_email);
          } else {
            setPortalStatus('not_invited');
          }
        })
        .catch(() => setPortalStatus('not_invited'));
    }
  }, [client, isOpen]);

  const handleSave = async (e) => {
    e.preventDefault();
    setLoading(true);
    setMessage('');

    try {
      const response = await fetch(`${API_BASE_URL}/api/clients/${client.id}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
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
          billingNotes: formData.billingNotes || null,
          weeklyAuthorizedUnits: formData.weeklyAuthorizedUnits ? parseInt(formData.weeklyAuthorizedUnits) : null,
          emergencyContactName: formData.emergencyContactName || null,
          emergencyContactPhone: formData.emergencyContactPhone || null,
          emergencyContactRelationship: formData.emergencyContactRelationship || null,
          medicalConditions: formData.medicalConditions || null,
          medications: formData.medications || null,
          allergies: formData.allergies || null,
          medicalNotes: formData.medicalNotes || null,
          mobilityAssistanceNeeds: formData.mobilityAssistanceNeeds || null,
          insuranceProvider: formData.insuranceProvider || null,
          insuranceId: formData.insuranceId || null,
          insuranceGroup: formData.insuranceGroup || null,
          carePreferences: formData.carePreferences || null,
          preferredCaregivers: formData.preferredCaregivers || null,
          doNotUseCaregivers: formData.doNotUseCaregivers || null,
          notes: formData.notes || null
        })
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to update client');
      }

      setMessage('Client updated successfully!');
      setTimeout(() => {
        onSuccess();
        onClose();
      }, 1000);
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
        headers: { 'Authorization': `Bearer ${token}` }
      });

      if (!response.ok) throw new Error('Failed to delete client');

      setMessage('Client deleted.');
      setTimeout(() => {
        onSuccess();
        onClose();
      }, 1000);
    } catch (error) {
      setMessage('Error: ' + error.message);
      setDeleteConfirm(false);
    } finally {
      setLoading(false);
    }
  };

  if (!isOpen || !client) return null;

  const tabs = [
    { id: 'basic',     label: '📋 Basic Info' },
    { id: 'billing',   label: '💰 Billing'    },
    { id: 'medical',   label: '🏥 Medical'    },
    { id: 'caregivers',label: '👤 Caregivers' },
    { id: 'portal',    label: '🌐 Portal'     },
  ];

  // ── Portal handlers ───────────────────────────────────────────────────────
  const handleSendInvite = async () => {
    if (!portalEmail.trim()) {
      return setPortalMessage({ text: 'Enter an email address first.', type: 'error' });
    }
    setPortalLoading(true);
    setPortalMessage({ text: '', type: '' });
    setInviteUrl('');
    try {
      const res = await fetch(`${API_BASE_URL}/api/client-portal/admin/invite`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({ clientId: client.id, email: portalEmail.trim() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to create invite');
      setInviteUrl(data.inviteUrl);
      setPortalStatus('invite_pending');
      setPortalMessage({ text: `Invite created for ${portalEmail}. Copy the link below and send it to the client.`, type: 'success' });
    } catch (err) {
      setPortalMessage({ text: err.message, type: 'error' });
    } finally {
      setPortalLoading(false);
    }
  };

  const handleTogglePortal = async (enable) => {
    setPortalLoading(true);
    try {
      const res = await fetch(`${API_BASE_URL}/api/client-portal/admin/clients/${client.id}/toggle`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({ enabled: enable }),
      });
      if (!res.ok) throw new Error('Failed to update portal access');
      setPortalStatus(enable ? 'active' : 'disabled');
      setPortalMessage({ text: `Portal access ${enable ? 'enabled' : 'disabled'}.`, type: enable ? 'success' : 'warning' });
    } catch (err) {
      setPortalMessage({ text: err.message, type: 'error' });
    } finally {
      setPortalLoading(false);
    }
  };

  const copyInviteUrl = () => {
    navigator.clipboard.writeText(inviteUrl).then(() => {
      setPortalMessage({ text: 'Invite link copied to clipboard!', type: 'success' });
    });
  };

  const portalStatusDisplay = () => {
    const map = {
      not_invited:    { bg: '#f5f5f5', color: '#666',    icon: '○', label: 'Not Invited'    },
      invite_pending: { bg: '#fef9e7', color: '#d68910', icon: '⏳', label: 'Invite Sent'    },
      invite_expired: { bg: '#fdf2f2', color: '#c0392b', icon: '⚠️', label: 'Invite Expired' },
      active:         { bg: '#eafaf1', color: '#1e8449', icon: '✓', label: 'Active'          },
      disabled:       { bg: '#f0f0f0', color: '#888',    icon: '✕', label: 'Disabled'        },
    };
    const s = map[portalStatus] || map.not_invited;
    return (
      <span style={{
        background: s.bg, color: s.color,
        padding: '4px 12px', borderRadius: '12px',
        fontSize: '0.82rem', fontWeight: 700,
      }}>
        {s.icon} {s.label}
      </span>
    );
  };

  return (
    <div className="modal active">
      <div className="modal-content modal-large">
        <div className="modal-header">
          <h2>Edit: {client.first_name} {client.last_name}</h2>
          <button className="close-btn" onClick={onClose}>×</button>
        </div>

        {message && (
          <div className={`alert ${message.includes('Error') ? 'alert-error' : 'alert-success'}`}>
            {message}
          </div>
        )}

        {/* Tabs */}
        <div className="tabs" style={{ display: 'flex', gap: '0.5rem', marginBottom: '1.5rem', borderBottom: '2px solid #eee', paddingBottom: '0.5rem' }}>
          {tabs.map(tab => (
            <button
              key={tab.id}
              type="button"
              className={`btn ${activeTab === tab.id ? 'btn-primary' : 'btn-secondary'}`}
              onClick={() => setActiveTab(tab.id)}
              style={{ flex: 1 }}
            >
              {tab.label}
            </button>
          ))}
        </div>

        <form onSubmit={handleSave}>
          
          {/* Basic Info Tab */}
          {activeTab === 'basic' && (
            <div>
              <h4 style={{ borderBottom: '2px solid #007bff', paddingBottom: '0.5rem', marginTop: '1rem', marginBottom: '1rem' }}>Personal Information</h4>
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

              <h4 style={{ borderBottom: '2px solid #007bff', paddingBottom: '0.5rem', marginTop: '1rem', marginBottom: '1rem' }}>Address</h4>
              <div className="form-grid-2">
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

              <h4 style={{ borderBottom: '2px solid #007bff', paddingBottom: '0.5rem', marginTop: '1rem', marginBottom: '1rem' }}>Emergency Contact</h4>
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

              <h4 style={{ borderBottom: '2px solid #007bff', paddingBottom: '0.5rem', marginTop: '1rem', marginBottom: '1rem' }}>Notes</h4>
              <div className="form-group">
                <textarea
                  value={formData.notes}
                  onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
                  placeholder="General notes about the client..."
                  rows="3"
                />
              </div>
            </div>
          )}

          {/* Billing Tab */}
          {activeTab === 'billing' && (
            <div>
              <h4 style={{ borderBottom: '2px solid #007bff', paddingBottom: '0.5rem', marginTop: '1rem', marginBottom: '1rem' }}>Billing Type</h4>
              <div className="form-group">
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
                  <h4 style={{ borderBottom: '2px solid #007bff', paddingBottom: '0.5rem', marginTop: '1rem', marginBottom: '1rem' }}>Referral Information</h4>
                  <div className="form-grid-2">
                    <div className="form-group">
                      <label>Referral Source</label>
                      <select
                        value={formData.referralSourceId}
                        onChange={(e) => setFormData({ ...formData, referralSourceId: e.target.value })}
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
                        value={formData.careTypeId}
                        onChange={(e) => setFormData({ ...formData, careTypeId: e.target.value })}
                      >
                        <option value="">Select care type...</option>
                        {careTypes.map(ct => (
                          <option key={ct.id} value={ct.id}>{ct.name}</option>
                        ))}
                      </select>
                    </div>
                  </div>
                  <div className="alert alert-info">
                    <strong>Rate:</strong> Billing rate is determined by the Referral Source + Care Type combination. 
                    Manage rates in the Billing Dashboard.
                  </div>
                </>
              ) : (
                <>
                  <h4 style={{ borderBottom: '2px solid #007bff', paddingBottom: '0.5rem', marginTop: '1rem', marginBottom: '1rem' }}>Private Pay Rate</h4>
                  <div className="form-grid-2">
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
                      <label>Rate Amount</label>
                      <input
                        type="number"
                        step="0.01"
                        min="0"
                        value={formData.privatePayRate}
                        onChange={(e) => setFormData({ ...formData, privatePayRate: e.target.value })}
                        placeholder="e.g., 25.00"
                      />
                    </div>
                  </div>
                </>
              )}

              <h4 style={{ borderBottom: '2px solid #007bff', paddingBottom: '0.5rem', marginTop: '1rem', marginBottom: '1rem' }}>Insurance Information</h4>
              <div className="form-grid-2">
                <div className="form-group">
                  <label>Insurance Provider</label>
                  <input
                    type="text"
                    value={formData.insuranceProvider}
                    onChange={(e) => setFormData({ ...formData, insuranceProvider: e.target.value })}
                  />
                </div>
                <div className="form-group">
                  <label>Policy Number</label>
                  <input
                    type="text"
                    value={formData.insuranceId}
                    onChange={(e) => setFormData({ ...formData, insuranceId: e.target.value })}
                  />
                </div>
                <div className="form-group">
                  <label>Group Number</label>
                  <input
                    type="text"
                    value={formData.insuranceGroup}
                    onChange={(e) => setFormData({ ...formData, insuranceGroup: e.target.value })}
                  />
                </div>
              </div>

              <h4 style={{ borderBottom: '2px solid #007bff', paddingBottom: '0.5rem', marginTop: '1rem', marginBottom: '1rem' }}>Weekly Authorized Units</h4>
              <div className="form-group">
                <label>Authorized Units Per Week</label>
                <input
                  type="number"
                  step="1"
                  min="0"
                  max="672"
                  value={formData.weeklyAuthorizedUnits}
                  onChange={(e) => setFormData({ ...formData, weeklyAuthorizedUnits: e.target.value })}
                  placeholder="e.g., 80 units"
                />
                {formData.weeklyAuthorizedUnits && (
                  <div style={{ 
                    marginTop: '0.5rem', 
                    padding: '0.5rem', 
                    background: '#E0F2FE', 
                    borderRadius: '4px',
                    fontSize: '0.9rem',
                    color: '#0369A1'
                  }}>
                    = <strong>{(parseFloat(formData.weeklyAuthorizedUnits) * 0.25).toFixed(2)} hours</strong> per week
                  </div>
                )}
                <small style={{ color: '#666', display: 'block', marginTop: '0.25rem' }}>
                  1 unit = 15 minutes. Used to track if client is fully scheduled.
                </small>
              </div>

              <h4 style={{ borderBottom: '2px solid #007bff', paddingBottom: '0.5rem', marginTop: '1rem', marginBottom: '1rem' }}>Billing Notes</h4>
              <div className="form-group">
                <textarea
                  value={formData.billingNotes}
                  onChange={(e) => setFormData({ ...formData, billingNotes: e.target.value })}
                  placeholder="Any special billing instructions..."
                  rows="3"
                />
              </div>
            </div>
          )}

          {/* Medical Tab */}
          {activeTab === 'medical' && (
            <div>
              <h4 style={{ borderBottom: '2px solid #007bff', paddingBottom: '0.5rem', marginTop: '1rem', marginBottom: '1rem' }}>Medical Conditions</h4>
              <div className="form-group">
                <textarea
                  value={formData.medicalConditions}
                  onChange={(e) => setFormData({ ...formData, medicalConditions: e.target.value })}
                  placeholder="List any medical conditions (diabetes, heart disease, etc.)..."
                  rows="3"
                />
              </div>

              <h4 style={{ borderBottom: '2px solid #007bff', paddingBottom: '0.5rem', marginTop: '1rem', marginBottom: '1rem' }}>Medications</h4>
              <div className="form-group">
                <textarea
                  value={formData.medications}
                  onChange={(e) => setFormData({ ...formData, medications: e.target.value })}
                  placeholder="List current medications and dosages..."
                  rows="3"
                />
              </div>

              <h4 style={{ borderBottom: '2px solid #007bff', paddingBottom: '0.5rem', marginTop: '1rem', marginBottom: '1rem' }}>Allergies</h4>
              <div className="form-group">
                <textarea
                  value={formData.allergies}
                  onChange={(e) => setFormData({ ...formData, allergies: e.target.value })}
                  placeholder="List any allergies (medications, foods, etc.)..."
                  rows="2"
                />
              </div>

              <h4 style={{ borderBottom: '2px solid #007bff', paddingBottom: '0.5rem', marginTop: '1rem', marginBottom: '1rem' }}>Mobility & Assistance Needs</h4>
              <div className="form-group">
                <textarea
                  value={formData.mobilityAssistanceNeeds}
                  onChange={(e) => setFormData({ ...formData, mobilityAssistanceNeeds: e.target.value })}
                  placeholder="Describe mobility limitations, equipment needs (walker, wheelchair), transfer assistance..."
                  rows="3"
                />
              </div>

              <h4 style={{ borderBottom: '2px solid #007bff', paddingBottom: '0.5rem', marginTop: '1rem', marginBottom: '1rem' }}>Medical Notes</h4>
              <div className="form-group">
                <textarea
                  value={formData.medicalNotes}
                  onChange={(e) => setFormData({ ...formData, medicalNotes: e.target.value })}
                  placeholder="Additional medical notes, care instructions, doctor contacts..."
                  rows="4"
                />
              </div>
            </div>
          )}

          {/* Caregivers Tab */}
          {activeTab === 'caregivers' && (
            <div>
              <h4 style={{ borderBottom: '2px solid #007bff', paddingBottom: '0.5rem', marginTop: '1rem', marginBottom: '1rem' }}>Care Preferences & Routines</h4>
              <div className="form-group">
                <textarea
                  value={formData.carePreferences}
                  onChange={(e) => setFormData({ ...formData, carePreferences: e.target.value })}
                  placeholder="Client preferences, daily routines, likes/dislikes, communication style..."
                  rows="4"
                />
              </div>

              <h4 style={{ borderBottom: '2px solid #007bff', paddingBottom: '0.5rem', marginTop: '1rem', marginBottom: '1rem' }}>Preferred Caregivers</h4>
              <div className="form-group">
                <textarea
                  value={formData.preferredCaregivers}
                  onChange={(e) => setFormData({ ...formData, preferredCaregivers: e.target.value })}
                  placeholder="List preferred caregivers or qualities the client prefers..."
                  rows="3"
                />
              </div>

              <h4 style={{ borderBottom: '2px solid #007bff', paddingBottom: '0.5rem', marginTop: '1rem', marginBottom: '1rem' }}>Do Not Assign</h4>
              <div className="form-group">
                <textarea
                  value={formData.doNotUseCaregivers}
                  onChange={(e) => setFormData({ ...formData, doNotUseCaregivers: e.target.value })}
                  placeholder="List any caregivers who should NOT be assigned to this client..."
                  rows="3"
                />
              </div>

              <div className="alert alert-info">
                <strong>Note:</strong> Caregiver pay rates are set by care type in Caregiver Management. 
                When a caregiver works with this client, they'll be paid based on the client's care type.
              </div>
            </div>
          )}

          {/* Portal Tab */}
          {activeTab === 'portal' && (
            <div style={{ padding: '0.5rem 0' }}>
              <h4 style={{ borderBottom: '2px solid #007bff', paddingBottom: '0.5rem', marginBottom: '1.5rem' }}>
                🌐 Client Portal Access
              </h4>

              {/* Status row */}
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '1.5rem' }}>
                <span style={{ fontWeight: 600, color: '#444' }}>Status:</span>
                {portalStatus ? portalStatusDisplay() : (
                  <span style={{ color: '#aaa', fontSize: '0.85rem' }}>Loading...</span>
                )}
              </div>

              {/* Portal message */}
              {portalMessage.text && (
                <div className={`alert ${portalMessage.type === 'error' ? 'alert-error' : portalMessage.type === 'warning' ? 'alert-warning' : 'alert-success'}`}
                  style={{ marginBottom: '1.5rem' }}>
                  {portalMessage.text}
                </div>
              )}

              {/* Invite link display */}
              {inviteUrl && (
                <div style={{
                  background: '#f8f9fa', border: '1px solid #dee2e6',
                  borderRadius: '8px', padding: '14px 16px', marginBottom: '1.5rem',
                }}>
                  <div style={{ fontSize: '0.8rem', color: '#666', marginBottom: '6px', fontWeight: 600 }}>
                    INVITE LINK (expires in 48 hours)
                  </div>
                  <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                    <input
                      type="text"
                      readOnly
                      value={inviteUrl}
                      style={{ flex: 1, fontSize: '0.8rem', background: '#fff', color: '#333' }}
                      onClick={e => e.target.select()}
                    />
                    <button
                      type="button"
                      className="btn btn-secondary"
                      onClick={copyInviteUrl}
                      style={{ flexShrink: 0 }}
                    >
                      📋 Copy
                    </button>
                  </div>
                </div>
              )}

              {/* Invite form — shown when not yet invited or expired */}
              {(portalStatus === 'not_invited' || portalStatus === 'invite_expired' || portalStatus === 'invite_pending') && (
                <div style={{ marginBottom: '1.5rem' }}>
                  <h5 style={{ marginBottom: '0.75rem', color: '#333' }}>
                    {portalStatus === 'invite_pending' ? 'Resend Invite' : 'Invite Client to Portal'}
                  </h5>
                  <div style={{ display: 'flex', gap: '8px' }}>
                    <div className="form-group" style={{ flex: 1, margin: 0 }}>
                      <input
                        type="email"
                        value={portalEmail}
                        onChange={e => setPortalEmail(e.target.value)}
                        placeholder="client@email.com"
                      />
                    </div>
                    <button
                      type="button"
                      className="btn btn-primary"
                      onClick={handleSendInvite}
                      disabled={portalLoading}
                      style={{ flexShrink: 0 }}
                    >
                      {portalLoading ? 'Creating...' : '✉️ Create Invite'}
                    </button>
                  </div>
                  <small style={{ color: '#666', marginTop: '6px', display: 'block' }}>
                    An invite link will be generated. Copy it and send it to the client — they'll set their own password.
                  </small>
                </div>
              )}

              {/* Enable/Disable toggle — shown when portal account exists */}
              {(portalStatus === 'active' || portalStatus === 'disabled') && (
                <div style={{
                  background: '#f8f9fa', borderRadius: '8px',
                  padding: '16px', marginBottom: '1.5rem',
                }}>
                  <div style={{ fontWeight: 600, marginBottom: '8px', color: '#333' }}>
                    Portal Access Control
                  </div>
                  {portalStatus === 'active' ? (
                    <button
                      type="button"
                      className="btn btn-danger"
                      onClick={() => handleTogglePortal(false)}
                      disabled={portalLoading}
                    >
                      {portalLoading ? 'Updating...' : '🚫 Disable Portal Access'}
                    </button>
                  ) : (
                    <button
                      type="button"
                      className="btn btn-primary"
                      onClick={() => handleTogglePortal(true)}
                      disabled={portalLoading}
                    >
                      {portalLoading ? 'Updating...' : '✓ Re-enable Portal Access'}
                    </button>
                  )}
                </div>
              )}

              {/* What the client can see */}
              <div style={{
                background: '#eaf4fd', borderRadius: '8px',
                padding: '14px 16px', fontSize: '0.85rem', color: '#1a5276',
              }}>
                <div style={{ fontWeight: 700, marginBottom: '8px' }}>What clients see in their portal:</div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px' }}>
                  {['📅 Upcoming scheduled visits', '🕐 Visit history', '👤 Assigned caregivers', '📄 Invoices & billing', '🔔 Notifications & alerts', '📞 Caregiver contact info'].map(item => (
                    <div key={item} style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                      {item}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* Actions */}
          <div className="modal-actions" style={{ marginTop: '1.5rem', borderTop: '1px solid #eee', paddingTop: '1rem' }}>
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
                style={{ marginLeft: 'auto' }}
              >
                Delete Client
              </button>
            ) : (
              <button
                type="button"
                className="btn btn-danger"
                onClick={handleDelete}
                disabled={loading}
                style={{ marginLeft: 'auto', background: '#8B0000' }}
              >
                ⚠️ Confirm Delete
              </button>
            )}
          </div>
        </form>
      </div>
    </div>
  );
};

export default EditClientModal;
