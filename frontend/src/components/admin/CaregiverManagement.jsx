import { confirm } from '../ConfirmModal';
import { toast } from '../Toast';
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
      <div style={{ gridColumn: '1 / -1', fontSize: '0.82rem' }}>
        {caregiver.address ? (
          <span>📍 {[caregiver.address, caregiver.city, caregiver.state, caregiver.zip].filter(Boolean).join(', ')}
            {caregiver.latitude ? ' ✅' : ' ⚠️ Not geocoded'}
          </span>
        ) : (
          <span style={{ color: '#d97706' }}>⚠️ No home address — needed for route optimization</span>
        )}
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

const CaregiverManagement = ({ token, onViewProfile, onViewHistory }) => {
  const [isMobile, setIsMobile] = useState(window.innerWidth < 768);
  const [caregivers, setCaregivers] = useState([]);
  const [careTypes, setCareTypes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [showRatesModal, setShowRatesModal] = useState(false);
  const [selectedCaregiver, setSelectedCaregiver] = useState(null);
  const [caregiverRates, setCaregiverRates] = useState([]);
  const [selectedIds, setSelectedIds] = useState([]);
  const [bulkMessage, setBulkMessage] = useState('');
  const [showBulkMsg, setShowBulkMsg] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('all'); // all, active, inactive
  
  const [editData, setEditData] = useState({
    firstName: '',
    lastName: '',
    phone: '',
    payRate: '',
    address: '',
    city: '',
    state: '',
    zip: ''
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
    if (await confirm('Promote this caregiver to admin?')) {
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
        toast('Caregiver promoted to admin!');
      } catch (error) {
        toast('Failed to promote: ' + error.message, 'error');
      }
    }
  };

  const handleOpenEdit = (caregiver) => {
    setSelectedCaregiver(caregiver);
    setEditData({
      firstName: caregiver.first_name || '',
      lastName: caregiver.last_name || '',
      phone: caregiver.phone || '',
      payRate: caregiver.default_pay_rate || '',
      address: caregiver.address || '',
      city: caregiver.city || '',
      state: caregiver.state || '',
      zip: caregiver.zip || ''
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
          payRate: parseFloat(editData.payRate) || null,
          address: editData.address || null,
          city: editData.city || null,
          state: editData.state || null,
          zip: editData.zip || null
        })
      });

      if (!response.ok) throw new Error('Failed to update caregiver');

      setShowEditModal(false);
      setSelectedCaregiver(null);
      loadData();
      toast('Caregiver updated!');
    } catch (error) {
      toast('Failed to update: ' + error.message, 'error');
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
      toast('Failed to load rates: ' + error.message, 'error');
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
      toast('Failed to add rate: ' + error.message, 'error');
    }
  };

  const handleDeleteRate = async (rateId) => {
    const _cok = await confirm('Remove this rate?', {danger: true}); if (!_cok) return;
    
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
      toast('Failed to delete rate: ' + error.message, 'error');
    }
  };

  const getAvailableCareTypes = () => {
    const assignedIds = caregiverRates.map(r => r.care_type_id);
    return careTypes.filter(ct => !assignedIds.includes(ct.id));
  };

  const formatCurrency = (amount) => {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(amount || 0);
  };

  const filteredCaregivers = caregivers.filter(cg => {
    const q = searchQuery.toLowerCase();
    const matchesSearch = !q || 
      (cg.first_name + " " + cg.last_name).toLowerCase().includes(q) ||
      (cg.email || "").toLowerCase().includes(q) ||
      (cg.phone || "").includes(q) ||
      (cg.city || "").toLowerCase().includes(q);
    const matchesStatus = statusFilter === "all" ||
      (statusFilter === "active" && cg.is_active !== false) ||
      (statusFilter === "inactive" && cg.is_active === false);
    return matchesSearch && matchesStatus;
  });

  return (
    <div>
      <div className="page-header">
        <h2>👤 Caregivers</h2>
        <button className="btn btn-primary" onClick={() => setShowModal(true)}>
          ➕ Add
        </button>
      </div>

      <div style={{ display: "flex", gap: "0.75rem", marginBottom: "1rem", flexWrap: "wrap", alignItems: "center" }}>
          <input placeholder="🔍 Search caregivers..." value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            style={{ flex: "1", minWidth: "180px", padding: "0.5rem 0.75rem", border: "1px solid #D1D5DB", borderRadius: "8px", fontSize: "0.9rem" }} />
          <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)}
            style={{ padding: "0.5rem 0.75rem", border: "1px solid #D1D5DB", borderRadius: "8px", fontSize: "0.9rem" }}>
            <option value="all">All Status</option>
            <option value="active">Active</option>
            <option value="inactive">Inactive</option>
          </select>
          <span style={{ fontSize: "0.85rem", color: "#6B7280" }}>{filteredCaregivers.length} of {caregivers.length}</span>
        </div>

        {/* Bulk Actions Bar */}
        {selectedIds.length > 0 && (
          <div style={{ display: "flex", alignItems: "center", gap: "0.75rem", padding: "0.6rem 0.875rem", background: "#EFF6FF", border: "1px solid #BFDBFE", borderRadius: "8px", marginBottom: "0.75rem", flexWrap: "wrap" }}>
            <span style={{ fontSize: "0.875rem", fontWeight: "600", color: "#1D4ED8" }}>
              ✅ {selectedIds.length} selected
            </span>
            <button onClick={() => {
              // Export selected as CSV
              const selected = caregivers.filter(c => selectedIds.includes(c.id));
              const csv = ['Name,Email,Phone,Pay Rate,Status'].concat(
                selected.map(c => `"${c.first_name} ${c.last_name}","${c.email}","${c.phone || ''}","${c.default_pay_rate || ''}","${c.is_active ? 'Active' : 'Inactive'}"`)
              ).join('\n');
              const blob = new Blob([csv], { type: 'text/csv' });
              const url = URL.createObjectURL(blob);
              const a = document.createElement('a'); a.href = url; a.download = 'caregivers.csv'; a.click();
              URL.revokeObjectURL(url);
              toast(`Exported ${selected.length} caregivers`, 'success');
            }} style={{ padding: "0.35rem 0.75rem", background: "#fff", border: "1px solid #D1D5DB", borderRadius: "6px", cursor: "pointer", fontSize: "0.82rem", fontWeight: "600" }}>
              📥 Export CSV
            </button>
            <button onClick={() => setShowBulkMsg(true)}
              style={{ padding: "0.35rem 0.75rem", background: "#2ABBA7", color: "#fff", border: "none", borderRadius: "6px", cursor: "pointer", fontSize: "0.82rem", fontWeight: "600" }}>
              📱 Send SMS
            </button>
            <button onClick={() => setSelectedIds([])} style={{ padding: "0.35rem 0.75rem", background: "none", border: "1px solid #D1D5DB", borderRadius: "6px", cursor: "pointer", fontSize: "0.82rem", color: "#6B7280" }}>
              Clear
            </button>
          </div>
        )}

        {/* Bulk SMS Modal */}
        {showBulkMsg && (
          <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", zIndex: 9999, display: "flex", alignItems: "center", justifyContent: "center", padding: "1rem" }}>
            <div style={{ background: "#fff", borderRadius: "12px", padding: "1.5rem", maxWidth: "420px", width: "100%" }}>
              <h3 style={{ margin: "0 0 0.75rem 0" }}>📱 Send SMS to {selectedIds.length} Caregiver{selectedIds.length !== 1 ? 's' : ''}</h3>
              <textarea
                placeholder="Type your message here..."
                value={bulkMessage}
                onChange={e => setBulkMessage(e.target.value)}
                rows={4}
                style={{ width: "100%", padding: "0.75rem", border: "1px solid #D1D5DB", borderRadius: "8px", fontSize: "0.9rem", resize: "vertical", boxSizing: "border-box" }}
              />
              <div style={{ display: "flex", gap: "0.75rem", marginTop: "1rem", justifyContent: "flex-end" }}>
                <button onClick={() => setShowBulkMsg(false)} style={{ padding: "0.5rem 1rem", border: "1px solid #D1D5DB", borderRadius: "8px", background: "#fff", cursor: "pointer" }}>Cancel</button>
                <button onClick={async () => {
                  if (!bulkMessage.trim()) { toast('Enter a message', 'warning'); return; }
                  try {
                    const phones = caregivers.filter(c => selectedIds.includes(c.id) && c.phone).map(c => c.phone);
                    await fetch(`${API_BASE_URL}/api/sms/bulk`, {
                      method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
                      body: JSON.stringify({ phones, message: bulkMessage })
                    });
                    toast(`SMS sent to ${phones.length} caregivers`, 'success');
                    setShowBulkMsg(false); setBulkMessage(''); setSelectedIds([]);
                  } catch { toast('SMS send failed', 'error'); }
                }} style={{ padding: "0.5rem 1rem", background: "#2ABBA7", color: "#fff", border: "none", borderRadius: "8px", cursor: "pointer", fontWeight: "600" }}>Send</button>
              </div>
            </div>
          </div>
        )}

        {loading ? (
          <div className="spinner"></div>
        ) : caregivers.length === 0 ? (
        <div className="card card-centered">
          <p>No caregivers yet.</p>
        </div>
      ) : isMobile ? (
        <div>
          {filteredCaregivers.map(caregiver => (
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
                <th style={{ width: '36px' }}>
                  <input type="checkbox" checked={selectedIds.length === filteredCaregivers.length && filteredCaregivers.length > 0}
                    onChange={e => setSelectedIds(e.target.checked ? filteredCaregivers.map(c => c.id) : [])} />
                </th>
                <th>Name</th>
                <th>Email</th>
                <th>Phone</th>
                <th>Address</th>
                <th>Default Rate</th>
                <th>Role</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filteredCaregivers.map(caregiver => (
                <tr key={caregiver.id} style={{ background: selectedIds.includes(caregiver.id) ? '#EFF6FF' : undefined }}>
                  <td>
                    <input type="checkbox" checked={selectedIds.includes(caregiver.id)}
                      onChange={e => setSelectedIds(prev => e.target.checked ? [...prev, caregiver.id] : prev.filter(id => id !== caregiver.id))} />
                  </td>
                  <td><strong>{caregiver.first_name} {caregiver.last_name}</strong></td>
                  <td>{caregiver.email}</td>
                  <td><a href={`tel:${caregiver.phone}`}>{caregiver.phone || 'N/A'}</a></td>
                  <td style={{ fontSize: '0.85rem' }}>
                    {caregiver.address ? (
                      <span>{[caregiver.city, caregiver.state].filter(Boolean).join(', ')} {caregiver.latitude ? '📍' : '⚠️'}</span>
                    ) : (
                      <span style={{ color: '#d97706' }}>⚠️ Missing</span>
                    )}
                  </td>
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
                      {onViewHistory && (
                        <button className="btn btn-sm btn-secondary" onClick={() => onViewHistory(caregiver.id, caregiver.first_name + " " + caregiver.last_name)}>🕐 History</button>
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

              <div style={{ borderTop: '1px solid #e2e8f0', paddingTop: '1rem', marginTop: '0.5rem' }}>
                <label style={{ fontWeight: '700', fontSize: '0.9rem', marginBottom: '0.5rem', display: 'block' }}>
                  📍 Home Address <small style={{ fontWeight: '400', color: '#666' }}>(needed for route optimization)</small>
                </label>
              </div>

              <div className="form-group">
                <label>Street Address</label>
                <input type="text" value={editData.address} onChange={(e) => setEditData({ ...editData, address: e.target.value })} placeholder="123 Main St" />
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '2fr 1fr 1fr', gap: '0.75rem' }}>
                <div className="form-group">
                  <label>City</label>
                  <input type="text" value={editData.city} onChange={(e) => setEditData({ ...editData, city: e.target.value })} placeholder="Eau Claire" />
                </div>
                <div className="form-group">
                  <label>State</label>
                  <input type="text" value={editData.state} onChange={(e) => setEditData({ ...editData, state: e.target.value })} placeholder="WI" maxLength="2" />
                </div>
                <div className="form-group">
                  <label>Zip</label>
                  <input type="text" value={editData.zip} onChange={(e) => setEditData({ ...editData, zip: e.target.value })} placeholder="54701" maxLength="10" />
                </div>
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
