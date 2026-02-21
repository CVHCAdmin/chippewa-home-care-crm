import { confirm } from '../ConfirmModal';
import { toast } from '../Toast';
// src/components/admin/DocumentsManagement.jsx
import React, { useState, useEffect } from 'react';
import { API_BASE_URL } from '../../config';

const DocumentsManagement = ({ token }) => {
  const [documents, setDocuments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState({ entityType: '', category: '' });
  const [showUploadModal, setShowUploadModal] = useState(false);
  const [clients, setClients] = useState([]);
  const [caregivers, setCaregivers] = useState([]);

  useEffect(() => {
    loadDocuments();
    loadClients();
    loadCaregivers();
  }, [filter]);

  const loadDocuments = async () => {
    try {
      const params = new URLSearchParams();
      if (filter.entityType) params.append('entityType', filter.entityType);
      if (filter.category) params.append('category', filter.category);
      
      const res = await fetch(`${API_BASE_URL}/api/documents?${params}`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      const data = await res.json();
      setDocuments(Array.isArray(data) ? data : []);
    } catch (error) {
      console.error('Failed to load documents:', error);
    } finally {
      setLoading(false);
    }
  };

  const loadClients = async () => {
    try {
      const res = await fetch(`${API_BASE_URL}/api/clients`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      const data = await res.json();
      setClients(Array.isArray(data) ? data : []);
    } catch (error) {
      console.error('Failed to load clients:', error);
    }
  };

  const loadCaregivers = async () => {
    try {
      const res = await fetch(`${API_BASE_URL}/api/caregivers`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      const data = await res.json();
      setCaregivers(Array.isArray(data) ? data : []);
    } catch (error) {
      console.error('Failed to load caregivers:', error);
    }
  };

  const uploadDocument = async (formData) => {
    try {
      const res = await fetch(`${API_BASE_URL}/api/documents`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}` },
        body: formData
      });
      if (res.ok) {
        setShowUploadModal(false);
        loadDocuments();
      } else {
        const err = await res.json();
        toast('Failed: ' + err.error, 'error');
      }
    } catch (error) {
      toast('Failed to upload: ' + error.message, 'error');
    }
  };

  const deleteDocument = async (docId) => {
    const _cok = await confirm('Delete this document? This cannot be undone.', {danger: true}); if (!_cok) return;
    try {
      const res = await fetch(`${API_BASE_URL}/api/documents/${docId}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (res.ok) {
        loadDocuments();
      }
    } catch (error) {
      toast('Failed: ' + error.message, 'error');
    }
  };

  const downloadDocument = async (doc) => {
    try {
      const res = await fetch(`${API_BASE_URL}/api/documents/${doc.id}/download`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (res.ok) {
        const blob = await res.blob();
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = doc.file_name;
        a.click();
        window.URL.revokeObjectURL(url);
      }
    } catch (error) {
      toast('Failed to download: ' + error.message, 'error');
    }
  };

  const getCategoryBadge = (category) => {
    const colors = {
      medical: '#e91e63',
      legal: '#9c27b0',
      insurance: '#3f51b5',
      care_plan: '#00bcd4',
      assessment: '#009688',
      contract: '#ff9800',
      certification: '#8bc34a',
      background_check: '#795548',
      other: '#9e9e9e'
    };
    return (
      <span style={{
        padding: '2px 6px',
        borderRadius: '4px',
        fontSize: '0.7rem',
        fontWeight: 'bold',
        color: 'white',
        backgroundColor: colors[category] || '#9e9e9e'
      }}>
        {category?.replace('_', ' ').toUpperCase()}
      </span>
    );
  };

  const getFileIcon = (fileName) => {
    const ext = fileName?.split('.').pop()?.toLowerCase();
    const icons = {
      pdf: '📄',
      doc: '📝',
      docx: '📝',
      xls: '📊',
      xlsx: '📊',
      jpg: '🖼️',
      jpeg: '🖼️',
      png: '🖼️',
      txt: '📃'
    };
    return icons[ext] || '📁';
  };

  const formatFileSize = (bytes) => {
    if (!bytes) return '-';
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(2) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(2) + ' MB';
  };

  const clientDocs = documents.filter(d => d.entity_type === 'client');
  const caregiverDocs = documents.filter(d => d.entity_type === 'caregiver');

  return (
    <div>
      <div className="page-header">
        <h2>📁 Document Management</h2>
        <button className="btn btn-primary" onClick={() => setShowUploadModal(true)}>
          + Upload Document
        </button>
      </div>

      {/* Summary Cards */}
      <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', marginBottom: '1rem' }}>
        <div 
          className="stat-card" 
          onClick={() => setFilter({ ...filter, entityType: '' })}
          style={{ cursor: 'pointer' }}
        >
          <h4>Total</h4>
          <div className="value">{documents.length}</div>
        </div>
        <div 
          className="stat-card" 
          onClick={() => setFilter({ ...filter, entityType: 'client' })}
          style={{ cursor: 'pointer' }}
        >
          <h4>Client Docs</h4>
          <div className="value" style={{ color: '#2196f3' }}>{clientDocs.length}</div>
        </div>
        <div 
          className="stat-card" 
          onClick={() => setFilter({ ...filter, entityType: 'caregiver' })}
          style={{ cursor: 'pointer' }}
        >
          <h4>Caregiver Docs</h4>
          <div className="value" style={{ color: '#4caf50' }}>{caregiverDocs.length}</div>
        </div>
      </div>

      {/* Filters */}
      <div className="card" style={{ marginBottom: '1rem' }}>
        <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap' }}>
          <div className="form-group" style={{ margin: 0 }}>
            <label>Type</label>
            <select value={filter.entityType} onChange={(e) => setFilter({ ...filter, entityType: e.target.value })}>
              <option value="">All Types</option>
              <option value="client">Client</option>
              <option value="caregiver">Caregiver</option>
            </select>
          </div>
          <div className="form-group" style={{ margin: 0 }}>
            <label>Category</label>
            <select value={filter.category} onChange={(e) => setFilter({ ...filter, category: e.target.value })}>
              <option value="">All Categories</option>
              <option value="medical">Medical</option>
              <option value="legal">Legal</option>
              <option value="insurance">Insurance</option>
              <option value="care_plan">Care Plan</option>
              <option value="assessment">Assessment</option>
              <option value="contract">Contract</option>
              <option value="certification">Certification</option>
              <option value="background_check">Background Check</option>
              <option value="other">Other</option>
            </select>
          </div>
        </div>
      </div>

      {/* Documents Table */}
      <div className="card">
        {loading ? (
          <div className="loading"><div className="spinner"></div></div>
        ) : documents.length === 0 ? (
          <p>No documents found. Upload a document to get started.</p>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th style={{ width: '40px' }}></th>
                <th>Document Name</th>
                <th>For</th>
                <th>Category</th>
                <th>Size</th>
                <th>Uploaded</th>
                <th>Expires</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {documents.map(doc => (
                <tr key={doc.id}>
                  <td style={{ fontSize: '1.5rem' }}>{getFileIcon(doc.file_name)}</td>
                  <td>
                    <strong>{doc.document_name || doc.file_name}</strong>
                    <div style={{ fontSize: '0.8rem', color: '#666' }}>{doc.file_name}</div>
                  </td>
                  <td>
                    <span style={{ 
                      padding: '2px 6px', 
                      borderRadius: '4px', 
                      fontSize: '0.7rem',
                      backgroundColor: doc.entity_type === 'client' ? '#e3f2fd' : '#e8f5e9',
                      color: doc.entity_type === 'client' ? '#1565c0' : '#2e7d32'
                    }}>
                      {doc.entity_type?.toUpperCase()}
                    </span>
                    <div style={{ fontWeight: 'bold', marginTop: '2px' }}>
                      {doc.entity_first_name} {doc.entity_last_name}
                    </div>
                  </td>
                  <td>{getCategoryBadge(doc.category)}</td>
                  <td>{formatFileSize(doc.file_size)}</td>
                  <td style={{ fontSize: '0.85rem' }}>
                    {new Date(doc.uploaded_at).toLocaleDateString()}
                  </td>
                  <td>
                    {doc.expiration_date ? (
                      <span style={{ 
                        color: new Date(doc.expiration_date) < new Date() ? '#f44336' : '#333'
                      }}>
                        {new Date(doc.expiration_date).toLocaleDateString()}
                      </span>
                    ) : '-'}
                  </td>
                  <td>
                    <div style={{ display: 'flex', gap: '0.25rem' }}>
                      <button 
                        className="btn btn-sm btn-secondary"
                        onClick={() => downloadDocument(doc)}
                        title="Download"
                      >
                        ⬇️
                      </button>
                      <button 
                        className="btn btn-sm btn-danger"
                        onClick={() => deleteDocument(doc.id)}
                        title="Delete"
                      >
                        🗑️
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Upload Modal */}
      {showUploadModal && (
        <div className="modal-overlay" onClick={() => setShowUploadModal(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3>Upload Document</h3>
              <button className="modal-close" onClick={() => setShowUploadModal(false)}>×</button>
            </div>
            <UploadForm 
              clients={clients}
              caregivers={caregivers}
              onSubmit={uploadDocument}
              onCancel={() => setShowUploadModal(false)}
            />
          </div>
        </div>
      )}
    </div>
  );
};

// Upload Form Component
const UploadForm = ({ clients, caregivers, onSubmit, onCancel }) => {
  const [formData, setFormData] = useState({
    entityType: 'client',
    entityId: '',
    category: 'other',
    documentName: '',
    expirationDate: '',
    notes: ''
  });
  const [file, setFile] = useState(null);

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!file) {
      toast('Please select a file');
      return;
    }
    if (!formData.entityId) {
      toast('Please select a client or caregiver');
      return;
    }

    const data = new FormData();
    data.append('file', file);
    data.append('entityType', formData.entityType);
    data.append('entityId', formData.entityId);
    data.append('category', formData.category);
    data.append('documentName', formData.documentName || file.name);
    if (formData.expirationDate) data.append('expirationDate', formData.expirationDate);
    if (formData.notes) data.append('notes', formData.notes);

    onSubmit(data);
  };

  const entities = formData.entityType === 'client' ? clients : caregivers;

  return (
    <form onSubmit={handleSubmit}>
      <div className="form-group">
        <label>Document Type *</label>
        <select 
          value={formData.entityType}
          onChange={(e) => setFormData({ ...formData, entityType: e.target.value, entityId: '' })}
        >
          <option value="client">Client Document</option>
          <option value="caregiver">Caregiver Document</option>
        </select>
      </div>

      <div className="form-group">
        <label>{formData.entityType === 'client' ? 'Client' : 'Caregiver'} *</label>
        <select 
          value={formData.entityId}
          onChange={(e) => setFormData({ ...formData, entityId: e.target.value })}
          required
        >
          <option value="">Select {formData.entityType === 'client' ? 'Client' : 'Caregiver'}</option>
          {entities.map(e => (
            <option key={e.id} value={e.id}>{e.first_name} {e.last_name}</option>
          ))}
        </select>
      </div>

      <div className="form-group">
        <label>Category</label>
        <select 
          value={formData.category}
          onChange={(e) => setFormData({ ...formData, category: e.target.value })}
        >
          <option value="medical">Medical</option>
          <option value="legal">Legal</option>
          <option value="insurance">Insurance</option>
          <option value="care_plan">Care Plan</option>
          <option value="assessment">Assessment</option>
          <option value="contract">Contract</option>
          <option value="certification">Certification</option>
          <option value="background_check">Background Check</option>
          <option value="other">Other</option>
        </select>
      </div>

      <div className="form-group">
        <label>Document Name</label>
        <input 
          type="text"
          value={formData.documentName}
          onChange={(e) => setFormData({ ...formData, documentName: e.target.value })}
          placeholder="Optional display name"
        />
      </div>

      <div className="form-group">
        <label>Expiration Date</label>
        <input 
          type="date"
          value={formData.expirationDate}
          onChange={(e) => setFormData({ ...formData, expirationDate: e.target.value })}
        />
      </div>

      <div className="form-group">
        <label>File *</label>
        <input 
          type="file"
          onChange={(e) => setFile(e.target.files[0])}
          accept=".pdf,.doc,.docx,.xls,.xlsx,.jpg,.jpeg,.png,.txt"
          required
        />
        <small style={{ color: '#666' }}>Max 10MB. Accepted: PDF, Word, Excel, Images, Text</small>
      </div>

      <div className="form-group">
        <label>Notes</label>
        <textarea 
          value={formData.notes}
          onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
          placeholder="Optional notes about this document"
        />
      </div>

      <div className="modal-actions">
        <button type="button" className="btn btn-secondary" onClick={onCancel}>Cancel</button>
        <button type="submit" className="btn btn-primary">Upload</button>
      </div>
    </form>
  );
};

export default DocumentsManagement;
