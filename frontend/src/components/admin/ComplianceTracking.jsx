// src/components/admin/ComplianceTracking.jsx
import React, { useState, useEffect } from 'react';
import { API_BASE_URL } from '../../config';

const ComplianceTracking = ({ token }) => {
  const [caregivers, setCaregivers] = useState([]);
  const [selectedCaregiverId, setSelectedCaregiverId] = useState('');
  const [backgroundCheck, setBackgroundCheck] = useState(null);
  const [trainingRecords, setTrainingRecords] = useState([]);
  const [complianceDocuments, setComplianceDocuments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState('');
  const [showBackgroundForm, setShowBackgroundForm] = useState(false);
  const [showTrainingForm, setShowTrainingForm] = useState(false);
  const [tab, setTab] = useState('background'); // background, training, documents, overview

  const [backgroundFormData, setBackgroundFormData] = useState({
    checkDate: '',
    expirationDate: '',
    status: 'pending', // pending, cleared, conditional, denied
    clearanceNumber: '',
    notes: ''
  });

  const [trainingFormData, setTrainingFormData] = useState({
    trainingType: 'cpr',
    completionDate: '',
    expirationDate: '',
    certificationNumber: '',
    provider: '',
    status: 'completed' // completed, in_progress, expired
  });

  const trainingTypes = [
    { value: 'cpr', label: 'CPR Certification' },
    { value: 'first_aid', label: 'First Aid' },
    { value: 'hipaa', label: 'HIPAA Training' },
    { value: 'infection_control', label: 'Infection Control' },
    { value: 'bloodborne_pathogen', label: 'Bloodborne Pathogen' },
    { value: 'safety', label: 'Workplace Safety' },
    { value: 'dementia_care', label: 'Dementia Care' },
    { value: 'fall_prevention', label: 'Fall Prevention' },
    { value: 'manual_handling', label: 'Manual Handling' },
    { value: 'other', label: 'Other' }
  ];

  useEffect(() => {
    loadCaregivers();
  }, []);

  const loadCaregivers = async () => {
    try {
      const response = await fetch(`${API_BASE_URL}/api/users/caregivers`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      const data = await response.json();
      setCaregivers(data);
      setLoading(false);
    } catch (error) {
      console.error('Failed to load caregivers:', error);
      setLoading(false);
    }
  };

  const handleCaregiverSelect = async (caregiverId) => {
    setSelectedCaregiverId(caregiverId);
    setMessage('');
    
    try {
      const [bgRes, trainingRes, docsRes] = await Promise.all([
        fetch(`${API_BASE_URL}/api/caregivers/${caregiverId}/background-check`, {
          headers: { 'Authorization': `Bearer ${token}` }
        }),
        fetch(`${API_BASE_URL}/api/caregivers/${caregiverId}/training-records`, {
          headers: { 'Authorization': `Bearer ${token}` }
        }),
        fetch(`${API_BASE_URL}/api/caregivers/${caregiverId}/compliance-documents`, {
          headers: { 'Authorization': `Bearer ${token}` }
        })
      ]);

      const bgData = await bgRes.json();
      const trainingData = await trainingRes.json();
      const docsData = await docsRes.json();

      setBackgroundCheck(bgData || null);
      setTrainingRecords(Array.isArray(trainingData) ? trainingData : []);
      setComplianceDocuments(Array.isArray(docsData) ? docsData : []);
    } catch (error) {
      console.error('Failed to load compliance data:', error);
    }
  };

  const handleSaveBackgroundCheck = async (e) => {
    e.preventDefault();
    
    if (!backgroundFormData.checkDate) {
      setMessage('Check date is required');
      return;
    }

    try {
      const response = await fetch(`${API_BASE_URL}/api/caregivers/${selectedCaregiverId}/background-check`, {
        method: backgroundCheck ? 'PUT' : 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify(backgroundFormData)
      });

      if (!response.ok) throw new Error('Failed to save background check');

      setMessage('Background check record saved!');
      setTimeout(() => setMessage(''), 2000);
      setShowBackgroundForm(false);
      handleCaregiverSelect(selectedCaregiverId);
    } catch (error) {
      setMessage('Error: ' + error.message);
    }
  };

  const handleAddTraining = async (e) => {
    e.preventDefault();
    
    if (!trainingFormData.completionDate) {
      setMessage('Completion date is required');
      return;
    }

    try {
      const response = await fetch(`${API_BASE_URL}/api/caregivers/${selectedCaregiverId}/training-records`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify(trainingFormData)
      });

      if (!response.ok) throw new Error('Failed to add training record');

      setMessage('Training record added!');
      setTimeout(() => setMessage(''), 2000);
      setTrainingFormData({
        trainingType: 'cpr',
        completionDate: '',
        expirationDate: '',
        certificationNumber: '',
        provider: '',
        status: 'completed'
      });
      setShowTrainingForm(false);
      handleCaregiverSelect(selectedCaregiverId);
    } catch (error) {
      setMessage('Error: ' + error.message);
    }
  };

  const handleDeleteTraining = async (trainingId) => {
    if (!window.confirm('Delete this training record?')) return;

    try {
      const response = await fetch(`${API_BASE_URL}/api/training-records/${trainingId}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${token}` }
      });

      if (!response.ok) throw new Error('Failed to delete');

      setMessage('Training record deleted');
      setTimeout(() => setMessage(''), 2000);
      handleCaregiverSelect(selectedCaregiverId);
    } catch (error) {
      setMessage('Error: ' + error.message);
    }
  };

  const isExpiringSoon = (expirationDate) => {
    if (!expirationDate) return false;
    const expDate = new Date(expirationDate);
    const today = new Date();
    const daysUntilExpire = Math.floor((expDate - today) / (1000 * 60 * 60 * 24));
    return daysUntilExpire < 30 && daysUntilExpire >= 0;
  };

  const isExpired = (expirationDate) => {
    if (!expirationDate) return false;
    const expDate = new Date(expirationDate);
    const today = new Date();
    return expDate < today;
  };

  const getStatusColor = (status) => {
    switch (status) {
      case 'cleared':
        return '#4caf50';
      case 'completed':
        return '#4caf50';
      case 'conditional':
        return '#ff9800';
      case 'in_progress':
        return '#2196f3';
      case 'pending':
        return '#fbc02d';
      case 'denied':
        return '#d32f2f';
      case 'expired':
        return '#d32f2f';
      default:
        return '#999';
    }
  };

  const getTrainingTypeLabel = (type) => {
    const training = trainingTypes.find(t => t.value === type);
    return training ? training.label : type;
  };

  const getCaregiverName = (caregiverId) => {
    const cg = caregivers.find(c => c.id === caregiverId);
    return cg ? `${cg.first_name} ${cg.last_name}` : '';
  };

  const getComplianceOverview = () => {
    let status = 'compliant';
    let issues = [];

    if (!backgroundCheck) {
      issues.push('No background check on file');
      status = 'non-compliant';
    } else if (backgroundCheck.status === 'denied') {
      issues.push('Background check denied');
      status = 'non-compliant';
    } else if (backgroundCheck.status === 'pending') {
      issues.push('Background check pending');
      status = 'incomplete';
    } else if (isExpired(backgroundCheck.expiration_date)) {
      issues.push('Background check expired');
      status = 'non-compliant';
    } else if (isExpiringSoon(backgroundCheck.expiration_date)) {
      issues.push('Background check expiring soon');
      status = 'at-risk';
    }

    const expiredTraining = trainingRecords.filter(t => isExpired(t.expiration_date));
    if (expiredTraining.length > 0) {
      issues.push(`${expiredTraining.length} training certification(s) expired`);
      status = status === 'non-compliant' ? 'non-compliant' : 'at-risk';
    }

    const expiringTraining = trainingRecords.filter(t => !isExpired(t.expiration_date) && isExpiringSoon(t.expiration_date));
    if (expiringTraining.length > 0) {
      issues.push(`${expiringTraining.length} training certification(s) expiring soon`);
      status = status === 'non-compliant' ? 'non-compliant' : 'at-risk';
    }

    return { status, issues };
  };

  if (loading) {
    return (
      <div className="loading">
        <div className="spinner"></div>
      </div>
    );
  }

  const overview = selectedCaregiverId ? getComplianceOverview() : null;

  return (
    <div>
      <div className="page-header">
        <h2>Compliance & Training Tracking</h2>
      </div>

      {message && (
        <div className={`alert ${message.includes('Error') ? 'alert-error' : 'alert-success'}`}>
          {message}
        </div>
      )}

      {/* Caregiver Selection */}
      <div className="card">
        <h3>Select Caregiver</h3>
        <select
          value={selectedCaregiverId}
          onChange={(e) => handleCaregiverSelect(e.target.value)}
          style={{ width: '100%', padding: '0.75rem', fontSize: '1rem', borderRadius: '4px', border: '1px solid #ddd' }}
        >
          <option value="">Select a caregiver...</option>
          {caregivers.map(cg => (
            <option key={cg.id} value={cg.id}>
              {cg.first_name} {cg.last_name}
            </option>
          ))}
        </select>
      </div>

      {selectedCaregiverId && (
        <>
          {/* Compliance Overview Card */}
          {overview && (
            <div className="card" style={{ marginBottom: '1.5rem' }}>
              <h3>Compliance Status</h3>
              <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
                <div style={{
                  padding: '1rem',
                  borderRadius: '50%',
                  background: overview.status === 'compliant' ? '#4caf50' : overview.status === 'at-risk' ? '#ff9800' : '#d32f2f',
                  color: 'white',
                  fontSize: '1.2rem',
                  fontWeight: 'bold',
                  minWidth: '80px',
                  textAlign: 'center'
                }}>
                  {overview.status === 'compliant' ? '✓' : '⚠'}
                </div>
                <div>
                  <strong>{overview.status.toUpperCase()}</strong>
                  {overview.issues.length > 0 && (
                    <ul style={{ margin: '0.5rem 0 0 0', paddingLeft: '1.5rem' }}>
                      {overview.issues.map((issue, idx) => (
                        <li key={idx} style={{ color: '#d32f2f' }}>{issue}</li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* Tab Navigation */}
          <div className="card" style={{ marginBottom: '1.5rem' }}>
            <div style={{ display: 'flex', gap: '0.5rem', borderBottom: '1px solid #ddd', marginBottom: '1rem' }}>
              {['background', 'training', 'documents', 'overview'].map(t => (
                <button
                  key={t}
                  onClick={() => setTab(t)}
                  style={{
                    padding: '1rem',
                    background: tab === t ? '#2196f3' : 'transparent',
                    color: tab === t ? 'white' : 'inherit',
                    border: 'none',
                    cursor: 'pointer',
                    fontSize: '0.95rem',
                    fontWeight: tab === t ? 'bold' : 'normal'
                  }}
                >
                  {t.charAt(0).toUpperCase() + t.slice(1)}
                </button>
              ))}
            </div>
          </div>

          {/* Background Check Tab */}
          {tab === 'background' && (
            <div className="card">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem', paddingBottom: '1rem', borderBottom: '1px solid #ddd' }}>
                <h3 style={{ margin: 0 }}>Background Check</h3>
                <button
                  className="btn btn-sm btn-primary"
                  onClick={() => setShowBackgroundForm(!showBackgroundForm)}
                >
                  {showBackgroundForm ? 'Cancel' : backgroundCheck ? 'Edit' : 'Add'}
                </button>
              </div>

              {showBackgroundForm && (
                <form onSubmit={handleSaveBackgroundCheck} style={{ marginBottom: '1.5rem', paddingBottom: '1.5rem', borderBottom: '1px solid #ddd' }}>
                  <div className="form-grid-2">
                    <div className="form-group">
                      <label>Check Date *</label>
                      <input
                        type="date"
                        value={backgroundFormData.checkDate}
                        onChange={(e) => setBackgroundFormData({ ...backgroundFormData, checkDate: e.target.value })}
                        required
                      />
                    </div>

                    <div className="form-group">
                      <label>Expiration Date</label>
                      <input
                        type="date"
                        value={backgroundFormData.expirationDate}
                        onChange={(e) => setBackgroundFormData({ ...backgroundFormData, expirationDate: e.target.value })}
                      />
                    </div>

                    <div className="form-group">
                      <label>Status *</label>
                      <select
                        value={backgroundFormData.status}
                        onChange={(e) => setBackgroundFormData({ ...backgroundFormData, status: e.target.value })}
                      >
                        <option value="pending">Pending</option>
                        <option value="cleared">Cleared</option>
                        <option value="conditional">Conditional</option>
                        <option value="denied">Denied</option>
                      </select>
                    </div>

                    <div className="form-group">
                      <label>Clearance Number</label>
                      <input
                        type="text"
                        value={backgroundFormData.clearanceNumber}
                        onChange={(e) => setBackgroundFormData({ ...backgroundFormData, clearanceNumber: e.target.value })}
                        placeholder="Reference number..."
                      />
                    </div>
                  </div>

                  <div className="form-group">
                    <label>Notes</label>
                    <textarea
                      value={backgroundFormData.notes}
                      onChange={(e) => setBackgroundFormData({ ...backgroundFormData, notes: e.target.value })}
                      placeholder="Any notes or conditions..."
                      rows="2"
                    ></textarea>
                  </div>

                  <div className="form-actions">
                    <button type="submit" className="btn btn-primary">Save Background Check</button>
                    <button type="button" className="btn btn-secondary" onClick={() => setShowBackgroundForm(false)}>Cancel</button>
                  </div>
                </form>
              )}

              {backgroundCheck ? (
                <div style={{
                  padding: '1rem',
                  background: '#f9f9f9',
                  borderLeft: `4px solid ${getStatusColor(backgroundCheck.status)}`,
                  borderRadius: '4px'
                }}>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                    <div>
                      <strong>Check Date:</strong>
                      <p>{new Date(backgroundCheck.check_date).toLocaleDateString()}</p>
                    </div>
                    <div>
                      <strong>Status:</strong>
                      <p>
                        <span className="badge" style={{ background: getStatusColor(backgroundCheck.status), color: 'white' }}>
                          {backgroundCheck.status.toUpperCase()}
                        </span>
                      </p>
                    </div>
                    {backgroundCheck.expiration_date && (
                      <div>
                        <strong>Expiration:</strong>
                        <p>
                          {new Date(backgroundCheck.expiration_date).toLocaleDateString()}
                          {isExpired(backgroundCheck.expiration_date) && <span style={{ color: '#d32f2f' }}> (EXPIRED)</span>}
                          {isExpiringSoon(backgroundCheck.expiration_date) && <span style={{ color: '#ff9800' }}> (EXPIRING SOON)</span>}
                        </p>
                      </div>
                    )}
                    {backgroundCheck.clearance_number && (
                      <div>
                        <strong>Clearance #:</strong>
                        <p>{backgroundCheck.clearance_number}</p>
                      </div>
                    )}
                  </div>
                  {backgroundCheck.notes && (
                    <div style={{ marginTop: '1rem', paddingTop: '1rem', borderTop: '1px solid #ddd' }}>
                      <strong>Notes:</strong>
                      <p>{backgroundCheck.notes}</p>
                    </div>
                  )}
                </div>
              ) : (
                <p style={{ color: '#999', textAlign: 'center', padding: '1rem' }}>
                  No background check on file.
                </p>
              )}
            </div>
          )}

          {/* Training Tab */}
          {tab === 'training' && (
            <div className="card">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem', paddingBottom: '1rem', borderBottom: '1px solid #ddd' }}>
                <h3 style={{ margin: 0 }}>Training Records</h3>
                <button
                  className="btn btn-sm btn-primary"
                  onClick={() => setShowTrainingForm(!showTrainingForm)}
                >
                  {showTrainingForm ? 'Cancel' : 'Add Training'}
                </button>
              </div>

              {showTrainingForm && (
                <form onSubmit={handleAddTraining} style={{ marginBottom: '1.5rem', paddingBottom: '1.5rem', borderBottom: '1px solid #ddd' }}>
                  <div className="form-grid-2">
                    <div className="form-group">
                      <label>Training Type *</label>
                      <select
                        value={trainingFormData.trainingType}
                        onChange={(e) => setTrainingFormData({ ...trainingFormData, trainingType: e.target.value })}
                      >
                        {trainingTypes.map(t => (
                          <option key={t.value} value={t.value}>{t.label}</option>
                        ))}
                      </select>
                    </div>

                    <div className="form-group">
                      <label>Completion Date *</label>
                      <input
                        type="date"
                        value={trainingFormData.completionDate}
                        onChange={(e) => setTrainingFormData({ ...trainingFormData, completionDate: e.target.value })}
                        required
                      />
                    </div>

                    <div className="form-group">
                      <label>Expiration Date</label>
                      <input
                        type="date"
                        value={trainingFormData.expirationDate}
                        onChange={(e) => setTrainingFormData({ ...trainingFormData, expirationDate: e.target.value })}
                      />
                    </div>

                    <div className="form-group">
                      <label>Certification #</label>
                      <input
                        type="text"
                        value={trainingFormData.certificationNumber}
                        onChange={(e) => setTrainingFormData({ ...trainingFormData, certificationNumber: e.target.value })}
                        placeholder="Reference number..."
                      />
                    </div>

                    <div className="form-group">
                      <label>Provider</label>
                      <input
                        type="text"
                        value={trainingFormData.provider}
                        onChange={(e) => setTrainingFormData({ ...trainingFormData, provider: e.target.value })}
                        placeholder="Training provider name..."
                      />
                    </div>

                    <div className="form-group">
                      <label>Status</label>
                      <select
                        value={trainingFormData.status}
                        onChange={(e) => setTrainingFormData({ ...trainingFormData, status: e.target.value })}
                      >
                        <option value="completed">Completed</option>
                        <option value="in_progress">In Progress</option>
                        <option value="expired">Expired</option>
                      </select>
                    </div>
                  </div>

                  <div className="form-actions">
                    <button type="submit" className="btn btn-primary">Add Training Record</button>
                    <button type="button" className="btn btn-secondary" onClick={() => setShowTrainingForm(false)}>Cancel</button>
                  </div>
                </form>
              )}

              {trainingRecords.length === 0 ? (
                <p style={{ color: '#999', textAlign: 'center', padding: '1rem' }}>
                  No training records on file.
                </p>
              ) : (
                <div style={{ display: 'grid', gap: '0.75rem' }}>
                  {trainingRecords
                    .sort((a, b) => new Date(b.completion_date) - new Date(a.completion_date))
                    .map(training => (
                      <div
                        key={training.id}
                        style={{
                          padding: '1rem',
                          background: '#f9f9f9',
                          borderLeft: `4px solid ${getStatusColor(training.status)}`,
                          borderRadius: '4px',
                          display: 'flex',
                          justifyContent: 'space-between',
                          alignItems: 'start'
                        }}
                      >
                        <div>
                          <strong>{getTrainingTypeLabel(training.training_type)}</strong>
                          <div style={{ fontSize: '0.9rem', color: '#666', marginTop: '0.25rem' }}>
                            Completed: {new Date(training.completion_date).toLocaleDateString()}
                          </div>
                          {training.expiration_date && (
                            <div style={{ fontSize: '0.9rem', color: '#666' }}>
                              Expires: {new Date(training.expiration_date).toLocaleDateString()}
                              {isExpired(training.expiration_date) && <span style={{ color: '#d32f2f' }}> (EXPIRED)</span>}
                              {isExpiringSoon(training.expiration_date) && <span style={{ color: '#ff9800' }}> (EXPIRING SOON)</span>}
                            </div>
                          )}
                          {training.certification_number && (
                            <div style={{ fontSize: '0.9rem', color: '#666' }}>
                              Cert #: {training.certification_number}
                            </div>
                          )}
                          {training.provider && (
                            <div style={{ fontSize: '0.9rem', color: '#666' }}>
                              Provider: {training.provider}
                            </div>
                          )}
                        </div>
                        <button
                          className="btn btn-sm btn-danger"
                          onClick={() => handleDeleteTraining(training.id)}
                        >
                          Delete
                        </button>
                      </div>
                    ))}
                </div>
              )}
            </div>
          )}

          {/* Documents Tab */}
          {tab === 'documents' && (
            <div className="card">
              <h3>Compliance Documents</h3>
              <p style={{ color: '#666', marginBottom: '1rem' }}>
                Scans of background check clearance, certifications, training documentation, etc.
              </p>
              
              {complianceDocuments.length === 0 ? (
                <p style={{ color: '#999', textAlign: 'center', padding: '2rem' }}>
                  No documents uploaded yet.
                </p>
              ) : (
                <div style={{ display: 'grid', gap: '0.75rem' }}>
                  {complianceDocuments.map(doc => (
                    <div
                      key={doc.id}
                      style={{
                        padding: '1rem',
                        background: '#f9f9f9',
                        borderRadius: '4px',
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center'
                      }}
                    >
                      <div>
                        <strong>{doc.document_name}</strong>
                        <div style={{ fontSize: '0.9rem', color: '#666', marginTop: '0.25rem' }}>
                          Uploaded: {new Date(doc.uploaded_date).toLocaleDateString()}
                        </div>
                      </div>
                      <a
                        href={doc.file_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="btn btn-sm btn-primary"
                      >
                        View
                      </a>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Overview Tab */}
          {tab === 'overview' && (
            <div className="card">
              <h3>Compliance Summary</h3>
              <div style={{ display: 'grid', gap: '1rem' }}>
                <div style={{ padding: '1rem', background: '#f9f9f9', borderRadius: '4px' }}>
                  <strong>Background Check</strong>
                  <p style={{ margin: '0.5rem 0 0 0' }}>
                    {backgroundCheck ? (
                      <>
                        Status: <span style={{ color: getStatusColor(backgroundCheck.status) }}>●</span> {backgroundCheck.status.toUpperCase()}
                        {backgroundCheck.expiration_date && (
                          <>
                            <br/>Expires: {new Date(backgroundCheck.expiration_date).toLocaleDateString()}
                          </>
                        )}
                      </>
                    ) : (
                      <span style={{ color: '#d32f2f' }}>NO BACKGROUND CHECK ON FILE</span>
                    )}
                  </p>
                </div>

                <div style={{ padding: '1rem', background: '#f9f9f9', borderRadius: '4px' }}>
                  <strong>Training Records</strong>
                  <p style={{ margin: '0.5rem 0 0 0' }}>
                    {trainingRecords.length} training(s) on file
                    <br/>
                    {trainingRecords.filter(t => isExpired(t.expiration_date)).length} expired
                    <br/>
                    {trainingRecords.filter(t => isExpiringSoon(t.expiration_date)).length} expiring soon
                  </p>
                </div>

                <div style={{ padding: '1rem', background: '#f9f9f9', borderRadius: '4px' }}>
                  <strong>Documents</strong>
                  <p style={{ margin: '0.5rem 0 0 0' }}>
                    {complianceDocuments.length} document(s) on file
                  </p>
                </div>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
};

export default ComplianceTracking;
