import { confirm } from '../ConfirmModal';
import { toast } from '../Toast';
// src/components/admin/ADLTracking.jsx
import React, { useState, useEffect, useCallback } from 'react';
import { API_BASE_URL } from '../../config';

const ADLTracking = ({ token }) => {
  const [clients, setClients] = useState([]);
  const [selectedClient, setSelectedClient] = useState('');
  const [requirements, setRequirements] = useState([]);
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(false);
  const [activeTab, setActiveTab] = useState('logs');
  const [showAddReqModal, setShowAddReqModal] = useState(false);
  const [showLogModal, setShowLogModal] = useState(false);
  const [dateRange, setDateRange] = useState({
    start: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
    end: new Date().toISOString().split('T')[0]
  });

  const adlCategories = [
    { id: 'bathing', name: 'Bathing', icon: '🛁' },
    { id: 'dressing', name: 'Dressing', icon: '👕' },
    { id: 'grooming', name: 'Grooming', icon: '💇' },
    { id: 'feeding', name: 'Feeding/Eating', icon: '🍽️' },
    { id: 'toileting', name: 'Toileting', icon: '🚽' },
    { id: 'transferring', name: 'Transferring', icon: '🧑‍🦽' },
    { id: 'mobility', name: 'Mobility', icon: '🚶' },
    { id: 'medication', name: 'Medication Reminders', icon: '💊' },
    { id: 'housekeeping', name: 'Light Housekeeping', icon: '🧹' },
    { id: 'laundry', name: 'Laundry', icon: '🧺' },
    { id: 'meal_prep', name: 'Meal Preparation', icon: '👨‍🍳' },
    { id: 'companionship', name: 'Companionship', icon: '💬' },
    { id: 'errands', name: 'Errands/Shopping', icon: '🛒' },
    { id: 'transportation', name: 'Transportation', icon: '🚗' }
  ];

  useEffect(() => {
    const fn = (e) => { if (isDirty) { e.preventDefault(); e.returnValue = "You have unsaved changes. Leave anyway?"; return e.returnValue; } };
    window.addEventListener("beforeunload", fn);
    return () => window.removeEventListener("beforeunload", fn);
  }, [isDirty]);

  $1Clients();
  }, []);

  useEffect(() => {
    if (selectedClient) {
      loadRequirements();
      loadLogs();
    }
  }, [selectedClient, dateRange]);

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

  const loadRequirements = async () => {
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE_URL}/api/adl/client/${selectedClient}/requirements`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      const data = await res.json();
      setRequirements(Array.isArray(data) ? data : []);
    } catch (error) {
      console.error('Failed to load requirements:', error);
    } finally {
      setLoading(false);
    }
  };

  const loadLogs = async () => {
    try {
      const res = await fetch(
        `${API_BASE_URL}/api/adl/client/${selectedClient}/logs?startDate=${dateRange.start}&endDate=${dateRange.end}`, 
        { headers: { 'Authorization': `Bearer ${token}` } }
      );
      const data = await res.json();
      setLogs(Array.isArray(data) ? data : []);
    } catch (error) {
      console.error('Failed to load logs:', error);
    }
  };

  const saveRequirement = async (formData) => {
    try {
      const res = await fetch(`${API_BASE_URL}/api/adl/requirements`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ ...formData, clientId: selectedClient })
      });
      if (res.ok) {
        setShowAddReqModal(false);
        loadRequirements();
      } else {
        const err = await res.json();
        toast('Failed: ' + err.error, 'error');
      }
    } catch (error) {
      toast('Failed: ' + error.message, 'error');
    }
  };

  const logADL = async (formData) => {
    try {
      const res = await fetch(`${API_BASE_URL}/api/adl/log`, {
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
      } else {
        const err = await res.json();
        toast('Failed: ' + err.error, 'error');
      }
    } catch (error) {
      toast('Failed: ' + error.message, 'error');
    }
  };

  const deleteRequirement = async (reqId) => {
    const _cok = await confirm('Remove this ADL requirement?', {danger: true}); if (!_cok) return;
    try {
      const res = await fetch(`${API_BASE_URL}/api/adl/requirements/${reqId}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (res.ok) {
        loadRequirements();
      }
    } catch (error) {
      toast('Failed: ' + error.message, 'error');
    }
  };

  const getAssistanceBadge = (level) => {
    const colors = {
      independent: '#4caf50',
      supervision: '#8bc34a',
      limited_assistance: '#ffeb3b',
      extensive_assistance: '#ff9800',
      total_dependence: '#f44336'
    };
    return (
      <span style={{
        padding: '2px 6px',
        borderRadius: '4px',
        fontSize: '0.7rem',
        fontWeight: 'bold',
        color: level === 'limited_assistance' ? '#333' : 'white',
        backgroundColor: colors[level] || '#9e9e9e'
      }}>
        {level?.replace(/_/g, ' ').toUpperCase()}
      </span>
    );
  };

  const getStatusBadge = (status) => {
    const colors = {
      completed: '#4caf50',
      partial: '#ff9800',
      refused: '#f44336',
      not_needed: '#9e9e9e'
    };
    return (
      <span style={{
        padding: '2px 6px',
        borderRadius: '4px',
        fontSize: '0.7rem',
        fontWeight: 'bold',
        color: 'white',
        backgroundColor: colors[status] || '#9e9e9e'
      }}>
        {status?.replace(/_/g, ' ').toUpperCase()}
      </span>
    );
  };

  const getCategoryIcon = (categoryId) => {
    const cat = adlCategories.find(c => c.id === categoryId);
    return cat?.icon || '📋';
  };

  const getCategoryName = (categoryId) => {
    const cat = adlCategories.find(c => c.id === categoryId);
    return cat?.name || categoryId;
  };

  // Group logs by date
  const logsByDate = logs.reduce((acc, log) => {
    const date = new Date(log.performed_at).toLocaleDateString();
    if (!acc[date]) acc[date] = [];
    acc[date].push(log);
    return acc;
  }, {});

  return (
    <div>
      <div className="page-header">
        <h2>🏠 ADL Tracking</h2>
      </div>

      {/* Client Selector */}
      <div className="card" style={{ marginBottom: '1rem' }}>
        <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <div className="form-group" style={{ margin: 0, minWidth: '250px' }}>
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
          {selectedClient && (
            <>
              <div className="form-group" style={{ margin: 0 }}>
                <label>From</label>
                <input 
                  type="date" 
                  value={dateRange.start}
                  onChange={(e) => setDateRange({ ...dateRange, start: e.target.value })}
                />
              </div>
              <div className="form-group" style={{ margin: 0 }}>
                <label>To</label>
                <input 
                  type="date" 
                  value={dateRange.end}
                  onChange={(e) => setDateRange({ ...dateRange, end: e.target.value })}
                />
              </div>
            </>
          )}
        </div>
      </div>

      {!selectedClient ? (
        <div className="card">
          <p style={{ color: '#666' }}>Select a client to view their ADL requirements and logs.</p>
        </div>
      ) : (
        <>
          {/* Tabs */}
          <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1rem' }}>
            <button 
              className={`btn ${activeTab === 'logs' ? 'btn-primary' : 'btn-secondary'}`}
              onClick={() => setActiveTab('logs')}
            >
              Daily Logs ({logs.length})
            </button>
            <button 
              className={`btn ${activeTab === 'requirements' ? 'btn-primary' : 'btn-secondary'}`}
              onClick={() => setActiveTab('requirements')}
            >
              Care Requirements ({requirements.length})
            </button>
            <div style={{ marginLeft: 'auto' }}>
              {activeTab === 'logs' && (
                <button className="btn btn-primary" onClick={() => setShowLogModal(true)}>
                  + Log ADL
                </button>
              )}
              {activeTab === 'requirements' && (
                <button className="btn btn-primary" onClick={() => setShowAddReqModal(true)}>
                  + Add Requirement
                </button>
              )}
            </div>
          </div>

          {/* Logs Tab */}
          {activeTab === 'logs' && (
            <div className="card">
              {loading ? (
                <div className="loading"><div className="spinner"></div></div>
              ) : logs.length === 0 ? (
                <p>No ADL logs for this date range.</p>
              ) : (
                Object.entries(logsByDate).map(([date, dateLogs]) => (
                  <div key={date} style={{ marginBottom: '1.5rem' }}>
                    <h4 style={{ borderBottom: '1px solid #eee', paddingBottom: '0.5rem', marginBottom: '0.5rem' }}>
                      {date}
                    </h4>
                    <table className="table">
                      <thead>
                        <tr>
                          <th style={{ width: '40px' }}></th>
                          <th>Activity</th>
                          <th>Status</th>
                          <th>Assistance</th>
                          <th>Time</th>
                          <th>Caregiver</th>
                          <th>Notes</th>
                        </tr>
                      </thead>
                      <tbody>
                        {dateLogs.map(log => (
                          <tr key={log.id}>
                            <td style={{ fontSize: '1.3rem' }}>{getCategoryIcon(log.adl_category)}</td>
                            <td><strong>{getCategoryName(log.adl_category)}</strong></td>
                            <td>{getStatusBadge(log.status)}</td>
                            <td>{getAssistanceBadge(log.assistance_level)}</td>
                            <td>{new Date(log.performed_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</td>
                            <td>{log.caregiver_first} {log.caregiver_last}</td>
                            <td style={{ maxWidth: '200px', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                              {log.notes || '-'}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ))
              )}
            </div>
          )}

          {/* Requirements Tab */}
          {activeTab === 'requirements' && (
            <div className="card">
              {loading ? (
                <div className="loading"><div className="spinner"></div></div>
              ) : requirements.length === 0 ? (
                <p>No ADL requirements set for this client. Add requirements to define their care needs.</p>
              ) : (
                <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: '1rem' }}>
                  {requirements.map(req => (
                    <div key={req.id} style={{ 
                      border: '1px solid #ddd', 
                      borderRadius: '8px', 
                      padding: '1rem',
                      backgroundColor: '#fafafa'
                    }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                          <span style={{ fontSize: '1.5rem' }}>{getCategoryIcon(req.adl_category)}</span>
                          <strong>{getCategoryName(req.adl_category)}</strong>
                        </div>
                        <button 
                          className="btn btn-sm btn-danger"
                          onClick={() => deleteRequirement(req.id)}
                        >
                          ×
                        </button>
                      </div>
                      <div style={{ marginTop: '0.5rem' }}>
                        {getAssistanceBadge(req.assistance_level)}
                      </div>
                      <div style={{ marginTop: '0.5rem', fontSize: '0.9rem' }}>
                        <strong>Frequency:</strong> {req.frequency || 'As needed'}
                      </div>
                      {req.special_instructions && (
                        <div style={{ marginTop: '0.5rem', fontSize: '0.85rem', color: '#666' }}>
                          {req.special_instructions}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </>
      )}

      {/* Add Requirement Modal */}
      {showAddReqModal && (
        <div className="modal-overlay" onClick={() => setShowAddReqModal(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3>Add ADL Requirement</h3>
              <button className="modal-close" onClick={() => setShowAddReqModal(false)}>×</button>
            </div>
            <RequirementForm 
              categories={adlCategories}
              existingCategories={requirements.map(r => r.adl_category)}
              onSubmit={saveRequirement}
              onCancel={() => setShowAddReqModal(false)}
            />
          </div>
        </div>
      )}

      {/* Log ADL Modal */}
      {showLogModal && (
        <div className="modal-overlay" onClick={() => setShowLogModal(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3>Log ADL Activity</h3>
              <button className="modal-close" onClick={() => setShowLogModal(false)}>×</button>
            </div>
            <LogADLForm 
              categories={adlCategories}
              requirements={requirements}
              onSubmit={logADL}
              onCancel={() => setShowLogModal(false)}
            />
          </div>
        </div>
      )}
    </div>
  );
};

// Requirement Form Component
const RequirementForm = ({ categories, existingCategories, onSubmit, onCancel }) => {
  const [formData, setFormData] = useState({
    adlCategory: '',
    assistanceLevel: 'limited_assistance',
    frequency: '',
    specialInstructions: ''
  });

  const availableCategories = categories.filter(c => !existingCategories.includes(c.id));

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!formData.adlCategory) {
      toast('Please select an ADL category');
      return;
    }
    onSubmit(formData);
  };

  return (
    <form onSubmit={handleSubmit}>
      <div className="form-group">
        <label>ADL Category *</label>
        <select 
          value={formData.adlCategory}
          onChange={(e) => setFormData({ ...formData, adlCategory: e.target.value })}
          required
        >
          <option value="">Select Category</option>
          {availableCategories.map(cat => (
            <option key={cat.id} value={cat.id}>{cat.icon} {cat.name}</option>
          ))}
        </select>
      </div>

      <div className="form-group">
        <label>Assistance Level *</label>
        <select 
          value={formData.assistanceLevel}
          onChange={(e) => setFormData({ ...formData, assistanceLevel: e.target.value })}
        >
          <option value="independent">Independent - No help needed</option>
          <option value="supervision">Supervision - Standby/cueing only</option>
          <option value="limited_assistance">Limited Assistance - Some hands-on help</option>
          <option value="extensive_assistance">Extensive Assistance - Significant help needed</option>
          <option value="total_dependence">Total Dependence - Full assistance required</option>
        </select>
      </div>

      <div className="form-group">
        <label>Frequency</label>
        <input 
          type="text"
          value={formData.frequency}
          onChange={(e) => setFormData({ ...formData, frequency: e.target.value })}
          placeholder="e.g., Daily, Twice daily, As needed"
        />
      </div>

      <div className="form-group">
        <label>Special Instructions</label>
        <textarea 
          value={formData.specialInstructions}
          onChange={(e) => setFormData({ ...formData, specialInstructions: e.target.value })}
          placeholder="Any specific instructions for caregivers..."
        />
      </div>

      <div className="modal-actions">
        <button type="button" className="btn btn-secondary" onClick={onCancel}>Cancel</button>
        <button type="submit" className="btn btn-primary">Add Requirement</button>
      </div>
    </form>
  );
};

// Log ADL Form Component
const LogADLForm = ({ categories, requirements, onSubmit, onCancel }) => {
  const [formData, setFormData] = useState({
    adlCategory: '',
    status: 'completed',
    assistanceLevel: 'limited_assistance',
    notes: ''
  });

  // Use requirements to pre-fill assistance level when category is selected
  const handleCategoryChange = (categoryId) => {
    const req = requirements.find(r => r.adl_category === categoryId);
    setFormData({ 
      ...formData, 
      adlCategory: categoryId,
      assistanceLevel: req?.assistance_level || 'limited_assistance'
    });
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!formData.adlCategory) {
      toast('Please select an ADL category');
      return;
    }
    onSubmit({
      ...formData,
      performedAt: new Date().toISOString()
    });
  };

  return (
    <form onSubmit={handleSubmit}>
      <div className="form-group">
        <label>ADL Activity *</label>
        <select 
          value={formData.adlCategory}
          onChange={(e) => handleCategoryChange(e.target.value)}
          required
        >
          <option value="">Select Activity</option>
          {categories.map(cat => (
            <option key={cat.id} value={cat.id}>{cat.icon} {cat.name}</option>
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
            <option value="completed">Completed</option>
            <option value="partial">Partial</option>
            <option value="refused">Refused</option>
            <option value="not_needed">Not Needed</option>
          </select>
        </div>

        <div className="form-group">
          <label>Assistance Level</label>
          <select 
            value={formData.assistanceLevel}
            onChange={(e) => setFormData({ ...formData, assistanceLevel: e.target.value })}
          >
            <option value="independent">Independent</option>
            <option value="supervision">Supervision</option>
            <option value="limited_assistance">Limited Assistance</option>
            <option value="extensive_assistance">Extensive Assistance</option>
            <option value="total_dependence">Total Dependence</option>
          </select>
        </div>
      </div>

      <div className="form-group">
        <label>Notes</label>
        <textarea 
          value={formData.notes}
          onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
          placeholder="Any observations or notes..."
        />
      </div>

      <div className="modal-actions">
        <button type="button" className="btn btn-secondary" onClick={onCancel}>Cancel</button>
        <button type="submit" className="btn btn-primary">Log Activity</button>
      </div>
    </form>
  );
};

export default ADLTracking;
