import { toast } from '../Toast';
// src/components/admin/ClientsManagement.jsx
import React, { useState, useEffect } from 'react';
import { API_BASE_URL } from '../../config';
import EditClientModal from './EditClientModal';
import ClientReportModal from './ClientReportModal';
import CareTasksManager from './CareTasksManager';

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

// Mobile-friendly client card
const ClientCard = ({ client, getReferralSourceName, getCareTypeName, onEdit, onReport }) => (
  <div className="card" style={{ marginBottom: '0.75rem', padding: '1rem' }}>
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '0.75rem' }}>
      <div>
        <strong style={{ fontSize: '1.1rem' }}>{client.first_name} {client.last_name}</strong>
        {client.date_of_birth && (
          <div style={{ color: '#666', fontSize: '0.85rem' }}>
            DOB: {new Date(client.date_of_birth).toLocaleDateString()}
          </div>
        )}
      </div>
      <div style={{ display: 'flex', gap: '0.25rem', flexShrink: 0 }}>
        <button
          className="btn btn-sm btn-secondary"
          onClick={() => onReport(client)}
          title="Generate comprehensive report"
        >
          📄 Report
        </button>
        <button
          className="btn btn-sm btn-primary"
          onClick={() => onEdit(client)}
        >
          ✏️ Edit
        </button>
      </div>
    </div>
    
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem', fontSize: '0.9rem' }}>
      <div>
        <span style={{ color: '#666' }}>📞</span>{' '}
        {client.phone ? (
          <a href={`tel:${client.phone}`}>{client.phone}</a>
        ) : (
          <span style={{ color: '#999' }}>N/A</span>
        )}
      </div>
      <div>
        <AddressLink 
          address={client.address}
          city={client.city}
          state={client.state}
          zip={client.zip}
        />
      </div>
    </div>
    
    <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.75rem', flexWrap: 'wrap' }}>
      {client.is_private_pay ? (
        <span className="badge badge-info">Private Pay</span>
      ) : (
        <>
          <span className="badge badge-success">Referred</span>
          <span className="badge" style={{ backgroundColor: '#e0e0e0', color: '#333' }}>
            {getReferralSourceName(client.referral_source_id)}
          </span>
        </>
      )}
      {client.care_type_id && (
        <span className="badge" style={{ backgroundColor: '#fff3cd', color: '#856404' }}>
          {getCareTypeName(client.care_type_id)}
        </span>
      )}
    </div>
  </div>
);

const ClientsManagement = ({ token }) => {
  const [clients, setClients] = useState([]);
  const [referralSources, setReferralSources] = useState([]);
  const [careTypes, setCareTypes] = useState([]);
  const [showForm, setShowForm] = useState(false);
  const [loading, setLoading] = useState(true);
  const [selectedClient, setSelectedClient] = useState(null);
  const [showEditModal, setShowEditModal] = useState(false);
  const [selectedIds, setSelectedIds] = useState([]);
  const [bulkAction, setBulkAction] = useState(null); // 'activate' | 'deactivate' | 'assign-payer'
  const [bulkPayerId, setBulkPayerId] = useState('');
  const [bulkBusy, setBulkBusy] = useState(false);
  const [reportClient, setReportClient] = useState(null);
  const [careTasksClient, setCareTasksClient] = useState(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [filterReferral, setFilterReferral] = useState('');
  const [filterCareType, setFilterCareType] = useState('');
  const [isMobile, setIsMobile] = useState(window.innerWidth < 768);
  const [showMedicaidImport, setShowMedicaidImport] = useState(false);
  const [medicaidImportResults, setMedicaidImportResults] = useState(null);
  const [medicaidImporting, setMedicaidImporting] = useState(false);
  const medicaidFileRef = React.useRef();
  
  // Listen for window resize
  useEffect(() => {
    const handleResize = () => setIsMobile(window.innerWidth < 768);
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  const initialFormData = {
    firstName: '',
    lastName: '',
    dateOfBirth: '',
    gender: '',
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
    privatePayRateType: 'hourly',
    weeklyAuthorizedUnits: '',
    medicaidId: '',
    mcoMemberId: '',
    emergencyContactName: '',
    emergencyContactPhone: '',
    emergencyContactRelationship: '',
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

      setClients(clientRes.ok ? await clientRes.json() : []);
      setReferralSources(rsRes.ok ? await rsRes.json() : []);
      setCareTypes(ctRes.ok ? await ctRes.json() : []);
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
        weeklyAuthorizedUnits: formData.weeklyAuthorizedUnits ? parseInt(formData.weeklyAuthorizedUnits) : null,
        medicaidId: formData.medicaidId || null,
        mcoMemberId: formData.mcoMemberId || null,
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
      toast('Client added successfully!');
    } catch (error) {
      toast('Failed to create client: ' + error.message, 'error');
    }
  };

  const handleViewClient = (client) => {
    setSelectedClient(client);
    setShowEditModal(true);
  };

  const handleGenerateReport = (client) => {
    setReportClient(client);
  };

  const getReferralSourceName = (id) => {
    const rs = referralSources.find(r => r.id === id);
    return rs ? rs.name : '-';
  };

  const getCareTypeName = (id) => {
    const ct = careTypes.find(c => c.id === id);
    return ct ? ct.name : '-';
  };

  const handleMedicaidCSV = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async (ev) => {
      let text = ev.target.result;
      // Handle UTF-16 encoding (double-spaced chars from WPS/Midas exports)
      if (text.charCodeAt(0) === 0xFFFE || text.charCodeAt(0) === 0xFEFF || text.includes('\x00')) {
        const decoder = new TextDecoder('utf-16le');
        text = decoder.decode(await file.arrayBuffer());
      }
      // Parse tab-separated or comma-separated
      const sep = text.includes('\t') ? '\t' : ',';
      const lines = text.split(/\r?\n/).filter(l => l.trim());
      if (lines.length < 2) { toast('No data rows found', 'error'); return; }

      const headers = lines[0].split(sep).map(h => h.trim().replace(/"/g, ''));
      // Find Member ID and Member Name columns
      const idCol = headers.findIndex(h => /member\s*id|medicaid\s*id/i.test(h));
      const nameCol = headers.findIndex(h => /member\s*name|client\s*name|patient\s*name/i.test(h));

      if (idCol === -1) { toast('Could not find "Member ID" column in CSV', 'error'); return; }
      if (nameCol === -1) { toast('Could not find "Member Name" column in CSV', 'error'); return; }

      const entries = [];
      for (let i = 1; i < lines.length; i++) {
        const cols = lines[i].split(sep).map(c => c.trim().replace(/"/g, ''));
        const medicaidId = cols[idCol];
        const name = cols[nameCol];
        if (medicaidId && name && !entries.find(e => e.medicaidId === medicaidId)) {
          entries.push({ medicaidId, name });
        }
      }

      if (!entries.length) { toast('No valid entries found', 'error'); return; }

      setMedicaidImporting(true);
      try {
        const res = await fetch(`${API_BASE_URL}/api/clients/bulk-assign-medicaid-ids`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
          body: JSON.stringify({ entries })
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error);
        setMedicaidImportResults(data);
        toast(`Updated ${data.updated} clients with Medicaid IDs`, 'success');
        loadData();
      } catch (err) {
        toast('Import failed: ' + err.message, 'error');
      } finally {
        setMedicaidImporting(false);
        if (medicaidFileRef.current) medicaidFileRef.current.value = '';
      }
    };
    reader.readAsText(file);
  };

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
        <div style={{ display: 'flex', gap: '0.5rem' }}>
          <button
            className="btn btn-secondary"
            onClick={() => { setShowMedicaidImport(!showMedicaidImport); setMedicaidImportResults(null); }}
          >
            {showMedicaidImport ? '✕ Close' : '🔗 Import Medicaid IDs'}
          </button>
          <button
            className="btn btn-primary"
            onClick={() => setShowForm(!showForm)}
          >
            {showForm ? '✕ Cancel' : '➕ Add'}
          </button>
        </div>
      </div>

      {showMedicaidImport && (
        <div className="card" style={{ marginBottom: '1rem', padding: '1.5rem' }}>
          <h3 style={{ marginBottom: '0.5rem' }}>Import Medicaid IDs from CSV</h3>
          <p style={{ color: '#6B7280', fontSize: '0.9rem', marginBottom: '1rem' }}>
            Upload a Midas or WPS CSV. The system will match Member Names to existing clients and assign their Medicaid IDs automatically.
          </p>
          <div style={{ display: 'flex', gap: '1rem', alignItems: 'center', marginBottom: '1rem' }}>
            <input
              ref={medicaidFileRef}
              type="file"
              accept=".csv,.txt"
              onChange={handleMedicaidCSV}
              disabled={medicaidImporting}
            />
            {medicaidImporting && <span style={{ color: '#6B7280' }}>Processing...</span>}
          </div>

          {medicaidImportResults && (
            <div style={{ background: '#F9FAFB', borderRadius: 8, padding: '1rem' }}>
              <div style={{ display: 'flex', gap: '1.5rem', marginBottom: '0.75rem', fontSize: '0.9rem' }}>
                <span style={{ color: '#059669', fontWeight: 600 }}>{medicaidImportResults.updated} updated</span>
                <span style={{ color: '#2563EB', fontWeight: 600 }}>{medicaidImportResults.alreadySet} already set</span>
                <span style={{ color: '#DC2626', fontWeight: 600 }}>{medicaidImportResults.notFound?.length || 0} not found</span>
              </div>
              {medicaidImportResults.details?.length > 0 && (
                <div style={{ fontSize: '0.85rem', marginBottom: '0.5rem' }}>
                  {medicaidImportResults.details.map((d, i) => (
                    <div key={i} style={{ padding: '3px 0', color: d.status === 'updated' ? '#059669' : '#6B7280' }}>
                      {d.status === 'updated' ? '✓' : '—'} {d.name} → {d.medicaidId}
                    </div>
                  ))}
                </div>
              )}
              {medicaidImportResults.notFound?.length > 0 && (
                <div style={{ fontSize: '0.85rem', color: '#DC2626' }}>
                  <strong>No match found:</strong>
                  {medicaidImportResults.notFound.map((nf, i) => (
                    <div key={i} style={{ padding: '2px 0' }}>✕ {nf.name} (ID: {nf.medicaidId})</div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {showForm && (
        <div className="card card-form">
          <h3>Add New Client</h3>
          <form onSubmit={handleSubmit}>
            <h4 style={{ borderBottom: '2px solid #007bff', paddingBottom: '0.5rem', marginTop: '1rem', marginBottom: '1rem' }}>📋 Basic Information</h4>
            <div className="form-grid">
              <div className="form-group">
                <label>First Name *</label>
                <input type="text" value={formData.firstName} onChange={(e) => setFormData({ ...formData, firstName: e.target.value })} required />
              </div>
              <div className="form-group">
                <label>Last Name *</label>
                <input type="text" value={formData.lastName} onChange={(e) => setFormData({ ...formData, lastName: e.target.value })} required />
              </div>
              <div className="form-group">
                <label>Date of Birth</label>
                <input type="date" value={formData.dateOfBirth} onChange={(e) => setFormData({ ...formData, dateOfBirth: e.target.value })} />
              </div>
              <div className="form-group">
                <label>Gender</label>
                <select value={formData.gender} onChange={(e) => setFormData({ ...formData, gender: e.target.value })}>
                  <option value="">Select...</option>
                  <option value="M">Male</option>
                  <option value="F">Female</option>
                  <option value="Other">Other</option>
                </select>
              </div>
              <div className="form-group">
                <label>Phone</label>
                <input type="tel" value={formData.phone} onChange={(e) => setFormData({ ...formData, phone: e.target.value })} />
              </div>
              <div className="form-group">
                <label>Email</label>
                <input type="email" value={formData.email} onChange={(e) => setFormData({ ...formData, email: e.target.value })} />
              </div>
            </div>

            <h4 style={{ borderBottom: '2px solid #007bff', paddingBottom: '0.5rem', marginTop: '1rem', marginBottom: '1rem' }}>🏠 Address</h4>
            <div className="form-grid">
              <div className="form-group" style={{ gridColumn: isMobile ? 'span 1' : 'span 2' }}>
                <label>Street Address</label>
                <input type="text" value={formData.address} onChange={(e) => setFormData({ ...formData, address: e.target.value })} />
              </div>
              <div className="form-group">
                <label>City</label>
                <input type="text" value={formData.city} onChange={(e) => setFormData({ ...formData, city: e.target.value })} />
              </div>
              <div className="form-group">
                <label>State</label>
                <input type="text" value={formData.state} onChange={(e) => setFormData({ ...formData, state: e.target.value })} maxLength="2" />
              </div>
              <div className="form-group">
                <label>ZIP Code</label>
                <input type="text" value={formData.zip} onChange={(e) => setFormData({ ...formData, zip: e.target.value })} />
              </div>
            </div>

            <h4 style={{ borderBottom: '2px solid #007bff', paddingBottom: '0.5rem', marginTop: '1rem', marginBottom: '1rem' }}>💰 Billing Information</h4>
            <div className="form-grid">
              <div className="form-group">
                <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <input type="checkbox" checked={formData.isPrivatePay} onChange={(e) => setFormData({ ...formData, isPrivatePay: e.target.checked })} style={{ width: 'auto' }} />
                  Private Pay Client
                </label>
              </div>
              
              {!formData.isPrivatePay ? (
                <>
                  <div className="form-group">
                    <label>Referral Source</label>
                    <select value={formData.referralSourceId} onChange={(e) => setFormData({ ...formData, referralSourceId: e.target.value })}>
                      <option value="">Select referral source...</option>
                      {referralSources.map(rs => (<option key={rs.id} value={rs.id}>{rs.name}</option>))}
                    </select>
                  </div>
                  <div className="form-group">
                    <label>Care Type</label>
                    <select value={formData.careTypeId} onChange={(e) => setFormData({ ...formData, careTypeId: e.target.value })}>
                      <option value="">Select care type...</option>
                      {careTypes.map(ct => (<option key={ct.id} value={ct.id}>{ct.name}</option>))}
                    </select>
                  </div>
                  <div className="form-group">
                    <label>Medicaid ID (Member ID)</label>
                    <input type="text" value={formData.medicaidId} onChange={(e) => setFormData({ ...formData, medicaidId: e.target.value })} placeholder="e.g., 3886255573" />
                  </div>
                  <div className="form-group">
                    <label>MCO Member ID</label>
                    <input type="text" value={formData.mcoMemberId} onChange={(e) => setFormData({ ...formData, mcoMemberId: e.target.value })} placeholder="MCO-specific member ID" />
                  </div>
                </>
              ) : (
                <>
                  <div className="form-group">
                    <label>Care Type</label>
                    <select value={formData.careTypeId} onChange={(e) => setFormData({ ...formData, careTypeId: e.target.value })}>
                      <option value="">Select care type...</option>
                      {careTypes.map(ct => (<option key={ct.id} value={ct.id}>{ct.name}</option>))}
                    </select>
                  </div>
                  <div className="form-group">
                    <label>Rate Type</label>
                    <select value={formData.privatePayRateType} onChange={(e) => setFormData({ ...formData, privatePayRateType: e.target.value })}>
                      <option value="hourly">Per Hour</option>
                      <option value="15min">Per 15 Minutes</option>
                    </select>
                  </div>
                  <div className="form-group">
                    <label>Rate Amount *</label>
                    <input type="number" step="0.01" min="0" value={formData.privatePayRate} onChange={(e) => setFormData({ ...formData, privatePayRate: e.target.value })} placeholder={formData.privatePayRateType === '15min' ? 'e.g., 6.25' : 'e.g., 25.00'} required={formData.isPrivatePay} />
                  </div>
                </>
              )}
            </div>

            <div className="form-group" style={{ marginTop: '1rem' }}>
              <label>Weekly Authorized Units</label>
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
                  = <strong>{Number(parseFloat(formData.weeklyAuthorizedUnits || 0) * 0.25).toFixed(2)} hours</strong> per week
                </div>
              )}
              <small style={{ color: '#666', display: 'block', marginTop: '0.25rem' }}>
                1 unit = 15 minutes. Used to track scheduling coverage.
              </small>
            </div>

            <h4 style={{ borderBottom: '2px solid #007bff', paddingBottom: '0.5rem', marginTop: '1rem', marginBottom: '1rem' }}>🚨 Emergency Contact</h4>
            <div className="form-grid">
              <div className="form-group">
                <label>Contact Name</label>
                <input type="text" value={formData.emergencyContactName} onChange={(e) => setFormData({ ...formData, emergencyContactName: e.target.value })} />
              </div>
              <div className="form-group">
                <label>Phone</label>
                <input type="tel" value={formData.emergencyContactPhone} onChange={(e) => setFormData({ ...formData, emergencyContactPhone: e.target.value })} />
              </div>
              <div className="form-group">
                <label>Relationship</label>
                <input type="text" value={formData.emergencyContactRelationship} onChange={(e) => setFormData({ ...formData, emergencyContactRelationship: e.target.value })} placeholder="e.g., Spouse, Son, Daughter" />
              </div>
            </div>

            <h4 style={{ borderBottom: '2px solid #007bff', paddingBottom: '0.5rem', marginTop: '1rem', marginBottom: '1rem' }}>📝 Notes</h4>
            <div className="form-group">
              <textarea value={formData.notes} onChange={(e) => setFormData({ ...formData, notes: e.target.value })} placeholder="Any initial notes about the client..." rows="3" />
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
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
          <input type="text" placeholder="🔍 Search by name, phone, or email..." value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} style={{ width: '100%' }} />
          <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr', gap: '0.75rem' }}>
            <select value={filterReferral} onChange={(e) => setFilterReferral(e.target.value)}>
              <option value="">All Referral Sources</option>
              {referralSources.map(rs => (<option key={rs.id} value={rs.id}>{rs.name}</option>))}
            </select>
            <select value={filterCareType} onChange={(e) => setFilterCareType(e.target.value)}>
              <option value="">All Care Types</option>
              {careTypes.map(ct => (<option key={ct.id} value={ct.id}>{ct.name}</option>))}
            </select>
          </div>
        </div>
      </div>

      {/* Clients List */}
      {loading ? (
        <div className="loading"><div className="spinner"></div></div>
      ) : filteredClients.length === 0 ? (
        <div className="card card-centered">
          <p>{clients.length === 0 ? 'No clients yet. Add one to get started.' : 'No clients match your filters.'}</p>
        </div>
      ) : isMobile ? (
        <div>
          {filteredClients.map(client => (
            <ClientCard key={client.id} client={client} getReferralSourceName={getReferralSourceName} getCareTypeName={getCareTypeName} onEdit={handleViewClient} onReport={handleGenerateReport} />
          ))}
        </div>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          {/* Bulk actions bar — only shown when at least one client is selected */}
          {selectedIds.length > 0 && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.6rem 0.875rem', background: '#EFF6FF', border: '1px solid #BFDBFE', borderRadius: 8, marginBottom: '0.75rem', flexWrap: 'wrap' }}>
              <span style={{ fontSize: '0.875rem', fontWeight: 600, color: '#1D4ED8' }}>
                ✅ {selectedIds.length} selected
              </span>
              <button onClick={() => setBulkAction('activate')}
                style={{ padding: '0.35rem 0.75rem', background: '#059669', color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer', fontSize: '0.82rem', fontWeight: 600 }}>
                ✓ Activate
              </button>
              <button onClick={() => setBulkAction('deactivate')}
                style={{ padding: '0.35rem 0.75rem', background: '#DC2626', color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer', fontSize: '0.82rem', fontWeight: 600 }}>
                ✕ Deactivate
              </button>
              <button onClick={() => { setBulkPayerId(''); setBulkAction('assign-payer'); }}
                style={{ padding: '0.35rem 0.75rem', background: '#6366F1', color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer', fontSize: '0.82rem', fontWeight: 600 }}>
                🏥 Assign Payer
              </button>
              <button onClick={() => setSelectedIds([])} style={{ padding: '0.35rem 0.75rem', background: 'none', border: '1px solid #D1D5DB', borderRadius: 6, cursor: 'pointer', fontSize: '0.82rem', color: '#6B7280' }}>
                Clear
              </button>
            </div>
          )}

          <table className="table">
            <thead>
              <tr>
                <th style={{ width: 32 }}>
                  <input type="checkbox"
                    checked={filteredClients.length > 0 && selectedIds.length === filteredClients.length}
                    onChange={(e) => setSelectedIds(e.target.checked ? filteredClients.map(c => c.id) : [])} />
                </th>
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
                <tr key={client.id} style={{ background: selectedIds.includes(client.id) ? '#EFF6FF' : undefined }}>
                  <td>
                    <input type="checkbox"
                      checked={selectedIds.includes(client.id)}
                      onChange={(e) => setSelectedIds(prev => e.target.checked ? [...prev, client.id] : prev.filter(id => id !== client.id))} />
                  </td>
                  <td>
                    <strong>{client.first_name} {client.last_name}</strong>
                    {client.date_of_birth && (<small style={{ display: 'block', color: '#666' }}>DOB: {new Date(client.date_of_birth).toLocaleDateString()}</small>)}
                  </td>
                  <td><a href={`tel:${client.phone}`}>{client.phone || 'N/A'}</a></td>
                  <td><AddressLink address={client.address} city={client.city} state={client.state} zip={client.zip} /></td>
                  <td>{client.is_private_pay ? (<span className="text-muted">-</span>) : (getReferralSourceName(client.referral_source_id))}</td>
                  <td>{getCareTypeName(client.care_type_id)}</td>
                  <td>{client.is_private_pay ? (<span className="badge badge-info">Private Pay</span>) : (<span className="badge badge-success">Referred</span>)}</td>
                  <td>
                    <div style={{ display: 'flex', gap: '0.25rem', flexWrap: 'wrap' }}>
                      <button className="btn btn-sm btn-secondary" onClick={() => setCareTasksClient(client)} title="Care tasks checklist">📋 Tasks</button>
                      <button className="btn btn-sm btn-secondary" onClick={() => handleGenerateReport(client)} title="Generate comprehensive report">📄 Report</button>
                      <button className="btn btn-sm btn-primary" onClick={() => handleViewClient(client)}>✏️ Edit</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {!loading && clients.length > 0 && (
        <div style={{ marginTop: '1rem', fontSize: '0.9rem', color: '#666' }}>
          Showing {filteredClients.length} of {clients.length} clients
        </div>
      )}

      {/* Bulk action modal — activate, deactivate, or assign payer */}
      {bulkAction && (() => {
        const selected = clients.filter(c => selectedIds.includes(c.id));
        const isActDeact = bulkAction === 'activate' || bulkAction === 'deactivate';
        const verb = bulkAction === 'activate' ? 'Activate' : bulkAction === 'deactivate' ? 'Deactivate' : 'Assign payer to';
        const apply = async () => {
          if (bulkAction === 'assign-payer' && !bulkPayerId) { alert('Pick a payer'); return; }
          setBulkBusy(true);
          let succ = 0, fail = 0;
          for (const c of selected) {
            try {
              let r;
              if (bulkAction === 'activate' || bulkAction === 'deactivate') {
                r = await fetch(`${API_BASE_URL}/api/clients/${c.id}/status`, {
                  method: 'PATCH',
                  headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
                  body: JSON.stringify({ isActive: bulkAction === 'activate' }),
                });
              } else {
                r = await fetch(`${API_BASE_URL}/api/clients/${c.id}`, {
                  method: 'PUT',
                  headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
                  body: JSON.stringify({ referralSourceId: bulkPayerId, isPrivatePay: false }),
                });
              }
              if (r.ok) succ++; else fail++;
            } catch { fail++; }
          }
          setBulkBusy(false);
          setBulkAction(null);
          setSelectedIds([]);
          alert(`Updated ${succ}${fail ? ` (${fail} failed)` : ''}`);
          loadData();
        };
        return (
          <div className="modal active" onClick={() => !bulkBusy && setBulkAction(null)}>
            <div className="modal-content" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 520 }}>
              <h3 style={{ margin: 0 }}>{verb} {selected.length} client{selected.length !== 1 ? 's' : ''}?</h3>
              {bulkAction === 'assign-payer' && (
                <div className="form-group" style={{ marginTop: '0.75rem' }}>
                  <label>Payer / Referral Source</label>
                  <select value={bulkPayerId} onChange={(e) => setBulkPayerId(e.target.value)}>
                    <option value="">Select…</option>
                    {referralSources.filter(rs => rs.is_active !== false).map(rs => (
                      <option key={rs.id} value={rs.id}>{rs.name}{rs.type ? ` (${rs.type})` : ''}</option>
                    ))}
                  </select>
                </div>
              )}
              <div style={{ maxHeight: 200, overflow: 'auto', border: '1px solid #E5E7EB', borderRadius: 6, marginTop: '0.5rem', padding: '0.5rem', fontSize: '0.85rem' }}>
                {selected.map(c => <div key={c.id}>{c.first_name} {c.last_name}</div>)}
              </div>
              <div className="modal-actions" style={{ marginTop: '0.75rem' }}>
                <button className="btn btn-secondary" disabled={bulkBusy} onClick={() => setBulkAction(null)}>Cancel</button>
                <button className="btn btn-primary" disabled={bulkBusy || (bulkAction === 'assign-payer' && !bulkPayerId)} onClick={apply}>
                  {bulkBusy ? 'Applying…' : (isActDeact ? `${verb} ${selected.length}` : `Assign to ${selected.length}`)}
                </button>
              </div>
            </div>
          </div>
        );
      })()}

      <EditClientModal client={selectedClient} referralSources={referralSources} careTypes={careTypes} isOpen={showEditModal} onClose={() => { setShowEditModal(false); setSelectedClient(null); }} onSuccess={loadData} token={token} />

      <ClientReportModal client={reportClient} isOpen={!!reportClient} onClose={() => setReportClient(null)} token={token} />

      {careTasksClient && (
        <CareTasksManager client={careTasksClient} token={token} onClose={() => setCareTasksClient(null)} />
      )}
    </div>
  );
};

export default ClientsManagement;
