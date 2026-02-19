import { confirm } from '../ConfirmModal';
import { toast } from '../Toast';
// src/components/admin/MedicationsManagement.jsx
import React, { useState, useEffect, useCallback } from 'react';
import { API_BASE_URL } from '../../config';

const MedicationsManagement = ({ token }) => {
  const [clients, setClients] = useState([]);
  const [selectedClient, setSelectedClient] = useState('');
  const [medications, setMedications] = useState([]);
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(false);
  const [activeTab, setActiveTab] = useState('medications');
  const [showAddModal, setShowAddModal] = useState(false);
  const [showLogModal, setShowLogModal] = useState(false);
  const [editingMed, setEditingMed] = useState(null);

  useEffect(() => {
    const fn = (e) => { if (isDirty) { e.preventDefault(); e.returnValue = "You have unsaved changes. Leave anyway?"; return e.returnValue; } };
    window.addEventListener("beforeunload", fn);
    return () => window.removeEventListener("beforeunload", fn);
  }, [isDirty]);

  $1Clients();
  }, []);

  useEffect(() => {
    if (selectedClient) {
      loadMedications();
      loadLogs();
    }
  }, [selectedClient]);

  const loadClients = async () => {
    try {
      const res = await fetch(`${API_BASE_URL}/api/clients`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      const data = await res.json();
      setClients(Array.isArray(data) ? data.filter(c => c.status === 'active') : []);
    } catch (error) {
      console.error('Failed to load clients:', error);
    }
  };

  const loadMedications = async () => {
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE_URL}/api/medications/client/${selectedClient}`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      const data = await res.json();
      setMedications(Array.isArray(data) ? data : []);
    } catch (error) {
      console.error('Failed to load medications:', error);
    } finally {
      setLoading(false);
    }
  };

  const loadLogs = async () => {
    try {
      const res = await fetch(`${API_BASE_URL}/api/medications/logs/client/${selectedClient}?startDate=${getDateRange().start}&endDate=${getDateRange().end}`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      const data = await res.json();
      setLogs(Array.isArray(data) ? data : []);
    } catch (error) {
      console.error('Failed to load logs:', error);
    }
  };

  const getDateRange = () => {
    const end = new Date();
    const start = new Date();
    start.setDate(start.getDate() - 30);
    return {
      start: start.toISOString().split('T')[0],
      end: end.toISOString().split('T')[0]
    };
  };

  const saveMedication = async (formData) => {
    try {
      const url = editingMed 
        ? `${API_BASE_URL}/api/medications/${editingMed.id}`
        : `${API_BASE_URL}/api/medications`;
      
      const res = await fetch(url, {
        method: editingMed ? 'PUT' : 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ ...formData, clientId: selectedClient })
      });
      
      if (res.ok) {
        setShowAddModal(false);
        setEditingMed(null);
        loadMedications();
      } else {
        const err = await res.json();
        toast('Failed: ' + err.error, 'error');
      }
    } catch (error) {
      toast('Failed to save: ' + error.message, 'error');
    }
  };

  const discontinueMedication = async (medId) => {
    const _cok = await confirm('Discontinue this medication?', {danger: true}); if (!_cok) return;
    try {
      const res = await fetch(`${API_BASE_URL}/api/medications/${medId}/discontinue`, {
        method: 'PUT',
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (res.ok) {
        loadMedications();
      }
    } catch (error) {
      toast('Failed: ' + error.message, 'error');
    }
  };

  const logAdministration = async (formData) => {
    try {
      const res = await fetch(`${API_BASE_URL}/api/medications/log`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ ...formData, clientId: selectedClient })
      });
      if (res.ok) {
        setShowLogModal(false);
        loadLogs();
      }
    } catch (error) {
      toast('Failed: ' + error.message, 'error');
    }
  };

  const getStatusBadge = (isActive) => (
    <span style={{
      padding: '2px 6px',
      borderRadius: '4px',
      fontSize: '0.75rem',
      fontWeight: 'bold',
      color: 'white',
      backgroundColor: isActive ? '#4caf50' : '#9e9e9e'
    }}>
      {isActive ? 'ACTIVE' : 'DISCONTINUED'}
    </span>
  );

  const getLogStatusBadge = (status) => {
    const colors = {
      administered: '#4caf50',
      refused: '#ff9800',
      missed: '#f44336',
      held: '#9e9e9e'
    };
    return (
      <span style={{
        padding: '2px 6px',
        borderRadius: '4px',
        fontSize: '0.75rem',
        fontWeight: 'bold',
        color: 'white',
        backgroundColor: colors[status] || '#9e9e9e'
      }}>
        {status?.toUpperCase()}
      </span>
    );
  };

  const activeMeds = medications.filter(m => m.is_active);
  const inactiveMeds = medications.filter(m => !m.is_active);

  return (
    <div>
      <div className="page-header">
        <h2>💊 Medication Management</h2>
      </div>

      {/* Client Selector */}
      <div className="card" style={{ marginBottom: '1rem' }}>
        <div className="form-group" style={{ margin: 0, maxWidth: '400px' }}>
          <label>Select Client</label>
          <select 
            value={selectedClient} 
            onChange={(e) => setSelectedClient(e.target.value)}
          >
            <option value="">-- Select a Client --</option>
            {clients.map(c => (
              <option key={c.id} value={c.id}>{c.first_name} {c.last_name}</option>
            ))}
          </select>
        </div>
      </div>

      {!selectedClient ? (
        <div className="card">
          <p style={{ color: '#666' }}>Select a client to view their medications.</p>
        </div>
      ) : (
        <>
          {/* Tabs */}
          <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1rem' }}>
            <button 
              className={`btn ${activeTab === 'medications' ? 'btn-primary' : 'btn-secondary'}`}
              onClick={() => setActiveTab('medications')}
            >
              Medications ({activeMeds.length})
            </button>
            <button 
              className={`btn ${activeTab === 'logs' ? 'btn-primary' : 'btn-secondary'}`}
              onClick={() => setActiveTab('logs')}
            >
              Administration Log ({logs.length})
            </button>
            <div style={{ marginLeft: 'auto' }}>
              {activeTab === 'medications' && (
                <button className="btn btn-primary" onClick={() => { setEditingMed(null); setShowAddModal(true); }}>
                  + Add Medication
                </button>
              )}
              {activeTab === 'logs' && (
                <button className="btn btn-primary" onClick={() => setShowLogModal(true)}>
                  + Log Administration
                </button>
              )}
            </div>
          </div>

          {/* Medications Tab */}
          {activeTab === 'medications' && (
            <div className="card">
              {loading ? (
                <div className="loading"><div className="spinner"></div></div>
              ) : activeMeds.length === 0 && inactiveMeds.length === 0 ? (
                <p>No medications recorded for this client.</p>
              ) : (
                <>
                  {activeMeds.length > 0 && (
                    <>
                      <h4 style={{ marginBottom: '1rem' }}>Active Medications</h4>
                      <table className="table">
                        <thead>
                          <tr>
                            <th>Medication</th>
                            <th>Dosage</th>
                            <th>Frequency</th>
                            <th>Route</th>
                            <th>Prescriber</th>
                            <th>PRN</th>
                            <th>Actions</th>
                          </tr>
                        </thead>
                        <tbody>
                          {activeMeds.map(med => (
                            <tr key={med.id}>
                              <td>
                                <strong>{med.medication_name}</strong>
                                {med.instructions && (
                                  <div style={{ fontSize: '0.8rem', color: '#666' }}>{med.instructions}</div>
                                )}
                              </td>
                              <td>{med.dosage || '-'}</td>
                              <td>{med.frequency || '-'}</td>
                              <td>{med.route || '-'}</td>
                              <td>{med.prescriber || '-'}</td>
                              <td>{med.is_prn ? '✓ Yes' : 'No'}</td>
                              <td>
                                <div style={{ display: 'flex', gap: '0.25rem' }}>
                                  <button 
                                    className="btn btn-sm btn-secondary"
                                    onClick={() => { setEditingMed(med); setShowAddModal(true); }}
                                  >
                                    Edit
                                  </button>
                                  <button 
                                    className="btn btn-sm btn-danger"
                                    onClick={() => discontinueMedication(med.id)}
                                  >
                                    D/C
                                  </button>
                                </div>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </>
                  )}

                  {inactiveMeds.length > 0 && (
                    <>
                      <h4 style={{ marginTop: '2rem', marginBottom: '1rem', color: '#666' }}>Discontinued Medications</h4>
                      <table className="table">
                        <thead>
                          <tr>
                            <th>Medication</th>
                            <th>Dosage</th>
                            <th>End Date</th>
                            <th>Status</th>
                          </tr>
                        </thead>
                        <tbody>
                          {inactiveMeds.map(med => (
                            <tr key={med.id} style={{ opacity: 0.6 }}>
                              <td>{med.medication_name}</td>
                              <td>{med.dosage || '-'}</td>
                              <td>{med.end_date ? new Date(med.end_date).toLocaleDateString() : '-'}</td>
                              <td>{getStatusBadge(false)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </>
                  )}
                </>
              )}
            </div>
          )}

          {/* Logs Tab */}
          {activeTab === 'logs' && (
            <div className="card">
              {logs.length === 0 ? (
                <p>No administration logs for the past 30 days.</p>
              ) : (
                <table className="table">
                  <thead>
                    <tr>
                      <th>Date/Time</th>
                      <th>Medication</th>
                      <th>Dosage</th>
                      <th>Status</th>
                      <th>Caregiver</th>
                      <th>Notes</th>
                    </tr>
                  </thead>
                  <tbody>
                    {logs.map(log => (
                      <tr key={log.id}>
                        <td>{new Date(log.administered_time).toLocaleString()}</td>
                        <td><strong>{log.medication_name}</strong></td>
                        <td>{log.dosage_given || log.dosage || '-'}</td>
                        <td>{getLogStatusBadge(log.status)}</td>
                        <td>{log.caregiver_first} {log.caregiver_last}</td>
                        <td>{log.notes || '-'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          )}
        </>
      )}

      {/* Add/Edit Medication Modal */}
      {showAddModal && (
        <div className="modal-overlay" onClick={() => setShowAddModal(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: '600px' }}>
            <div className="modal-header">
              <h3>{editingMed ? 'Edit Medication' : 'Add Medication'}</h3>
              <button className="modal-close" onClick={() => setShowAddModal(false)}>×</button>
            </div>
            <MedicationForm 
              medication={editingMed}
              onSubmit={saveMedication}
              onCancel={() => setShowAddModal(false)}
            />
          </div>
        </div>
      )}

      {/* Log Administration Modal */}
      {showLogModal && (
        <div className="modal-overlay" onClick={() => setShowLogModal(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3>Log Medication Administration</h3>
              <button className="modal-close" onClick={() => setShowLogModal(false)}>×</button>
            </div>
            <LogForm 
              medications={activeMeds}
              onSubmit={logAdministration}
              onCancel={() => setShowLogModal(false)}
            />
          </div>
        </div>
      )}
    </div>
  );
};

// Medication Form Component
const MedicationForm = ({ medication, onSubmit, onCancel }) => {
  const [formData, setFormData] = useState({
    medicationName: medication?.medication_name || '',
    dosage: medication?.dosage || '',
    frequency: medication?.frequency || '',
    route: medication?.route || 'oral',
    prescriber: medication?.prescriber || '',
    pharmacy: medication?.pharmacy || '',
    rxNumber: medication?.rx_number || '',
    startDate: medication?.start_date?.split('T')[0] || '',
    endDate: medication?.end_date?.split('T')[0] || '',
    instructions: medication?.instructions || '',
    sideEffects: medication?.side_effects || '',
    isPrn: medication?.is_prn || false,
    isActive: medication?.is_active ?? true
  });

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!formData.medicationName) {
      toast('Medication name is required');
      return;
    }
    onSubmit(formData);
  };

  return (
    <form onSubmit={handleSubmit}>
      <div className="form-group">
        <label>Medication Name *</label>
        <input 
          type="text"
          value={formData.medicationName}
          onChange={(e) => setFormData({ ...formData, medicationName: e.target.value })}
          placeholder="e.g., Metformin"
          required
        />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '1rem' }}>
        <div className="form-group">
          <label>Dosage</label>
          <input 
            type="text"
            value={formData.dosage}
            onChange={(e) => setFormData({ ...formData, dosage: e.target.value })}
            placeholder="e.g., 500mg"
          />
        </div>
        <div className="form-group">
          <label>Frequency</label>
          <input 
            type="text"
            value={formData.frequency}
            onChange={(e) => setFormData({ ...formData, frequency: e.target.value })}
            placeholder="e.g., Twice daily"
          />
        </div>
        <div className="form-group">
          <label>Route</label>
          <select 
            value={formData.route}
            onChange={(e) => setFormData({ ...formData, route: e.target.value })}
          >
            <option value="oral">Oral</option>
            <option value="topical">Topical</option>
            <option value="injection">Injection</option>
            <option value="inhaled">Inhaled</option>
            <option value="sublingual">Sublingual</option>
            <option value="rectal">Rectal</option>
            <option value="other">Other</option>
          </select>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
        <div className="form-group">
          <label>Prescriber</label>
          <input 
            type="text"
            value={formData.prescriber}
            onChange={(e) => setFormData({ ...formData, prescriber: e.target.value })}
            placeholder="Dr. Smith"
          />
        </div>
        <div className="form-group">
          <label>Pharmacy</label>
          <input 
            type="text"
            value={formData.pharmacy}
            onChange={(e) => setFormData({ ...formData, pharmacy: e.target.value })}
            placeholder="Walgreens"
          />
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '1rem' }}>
        <div className="form-group">
          <label>RX Number</label>
          <input 
            type="text"
            value={formData.rxNumber}
            onChange={(e) => setFormData({ ...formData, rxNumber: e.target.value })}
          />
        </div>
        <div className="form-group">
          <label>Start Date</label>
          <input 
            type="date"
            value={formData.startDate}
            onChange={(e) => setFormData({ ...formData, startDate: e.target.value })}
          />
        </div>
        <div className="form-group">
          <label>End Date</label>
          <input 
            type="date"
            value={formData.endDate}
            onChange={(e) => setFormData({ ...formData, endDate: e.target.value })}
          />
        </div>
      </div>

      <div className="form-group">
        <label>Instructions</label>
        <textarea 
          value={formData.instructions}
          onChange={(e) => setFormData({ ...formData, instructions: e.target.value })}
          placeholder="Take with food..."
        />
      </div>

      <div className="form-group">
        <label>Side Effects</label>
        <textarea 
          value={formData.sideEffects}
          onChange={(e) => setFormData({ ...formData, sideEffects: e.target.value })}
          placeholder="May cause drowsiness..."
        />
      </div>

      <div className="form-group">
        <label>
          <input 
            type="checkbox"
            checked={formData.isPrn}
            onChange={(e) => setFormData({ ...formData, isPrn: e.target.checked })}
            style={{ marginRight: '0.5rem' }}
          />
          PRN (As Needed)
        </label>
      </div>

      <div className="modal-actions">
        <button type="button" className="btn btn-secondary" onClick={onCancel}>Cancel</button>
        <button type="submit" className="btn btn-primary">Save Medication</button>
      </div>
    </form>
  );
};

// Log Administration Form
const LogForm = ({ medications, onSubmit, onCancel }) => {
  const [formData, setFormData] = useState({
    medicationId: '',
    status: 'administered',
    dosageGiven: '',
    notes: ''
  });

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!formData.medicationId) {
      toast('Select a medication');
      return;
    }
    onSubmit({
      ...formData,
      administeredTime: new Date().toISOString()
    });
  };

  return (
    <form onSubmit={handleSubmit}>
      <div className="form-group">
        <label>Medication *</label>
        <select 
          value={formData.medicationId}
          onChange={(e) => setFormData({ ...formData, medicationId: e.target.value })}
          required
        >
          <option value="">Select Medication</option>
          {medications.map(med => (
            <option key={med.id} value={med.id}>
              {med.medication_name} - {med.dosage}
            </option>
          ))}
        </select>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
        <div className="form-group">
          <label>Status *</label>
          <select 
            value={formData.status}
            onChange={(e) => setFormData({ ...formData, status: e.target.value })}
          >
            <option value="administered">Administered</option>
            <option value="refused">Refused</option>
            <option value="missed">Missed</option>
            <option value="held">Held</option>
          </select>
        </div>
        <div className="form-group">
          <label>Dosage Given</label>
          <input 
            type="text"
            value={formData.dosageGiven}
            onChange={(e) => setFormData({ ...formData, dosageGiven: e.target.value })}
            placeholder="e.g., 500mg"
          />
        </div>
      </div>

      <div className="form-group">
        <label>Notes</label>
        <textarea 
          value={formData.notes}
          onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
          placeholder="Any observations..."
        />
      </div>

      <div className="modal-actions">
        <button type="button" className="btn btn-secondary" onClick={onCancel}>Cancel</button>
        <button type="submit" className="btn btn-primary">Log Administration</button>
      </div>
    </form>
  );
};

export default MedicationsManagement;
