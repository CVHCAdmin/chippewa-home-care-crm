import { confirm } from '../ConfirmModal';
// src/components/admin/CarePlans.jsx
import React, { useState, useEffect, useCallback } from 'react';
import { API_BASE_URL } from '../../config';

const CarePlans = ({ token }) => {
  const [clients, setClients] = useState([]);
  const [carePlans, setCarePlans] = useState({});
  const [loading, setLoading] = useState(true);
  const [isDirty, setIsDirty] = useState(false);
  const [expandedClient, setExpandedClient] = useState(null);
  const [showForm, setShowForm] = useState(false);
  const [showGenModal, setShowGenModal] = useState(null);
  const [caregivers, setCaregivers] = useState([]);
  const [templates, setTemplates] = useState([]);
  const [showTemplateModal, setShowTemplateModal] = useState(false);
  const [templateClientId, setTemplateClientId] = useState('');
  const [genForm, setGenForm] = useState({
    caregiverId: '', startTime: '09:00', endTime: '13:00', daysOfWeek: [], startDate: '', endDate: ''
  });
  const [message, setMessage] = useState('');
  const [formData, setFormData] = useState({
    clientId: '',
    serviceType: 'personal_care',
    serviceDescription: '',
    frequency: '',
    careGoals: '',
    specialInstructions: '',
    precautions: '',
    medicationNotes: '',
    mobilityNotes: '',
    dietaryNotes: '',
    communicationNotes: '',
    startDate: new Date().toISOString().split('T')[0],
    endDate: ''
  });

  useEffect(() => {
    const fn = (e) => { if (isDirty) { e.preventDefault(); e.returnValue = "You have unsaved changes. Leave anyway?"; return e.returnValue; } };
    window.addEventListener("beforeunload", fn);
    return () => window.removeEventListener("beforeunload", fn);
  }, [isDirty]);

  useEffect(() => {
    loadData();
    loadCaregivers();
    loadTemplates();
  }, []);

  const loadCaregivers = async () => {
    try {
      const r = await fetch(`${API_BASE_URL}/api/caregivers`, { headers: { 'Authorization': `Bearer ${token}` } });
      if (r.ok) setCaregivers(await r.json());
    } catch (e) {}
  };

  const loadTemplates = async () => {
    try {
      const r = await fetch(`${API_BASE_URL}/api/care-plan-templates`, { headers: { 'Authorization': `Bearer ${token}` } });
      if (r.ok) setTemplates(await r.json());
    } catch (e) {}
  };

  const applyTemplate = async (templateId) => {
    if (!templateClientId) { setMessage('Pick a client first'); return; }
    try {
      const r = await fetch(`${API_BASE_URL}/api/care-plans/from-template/${templateId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({ clientId: templateClientId, startDate: new Date().toISOString().split('T')[0] }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || 'Failed');
      setMessage(`Created draft care plan from "${data.appliedTemplate}"`);
      setShowTemplateModal(false);
      setTemplateClientId('');
      loadData();
      setTimeout(() => setMessage(''), 5000);
    } catch (err) { setMessage('Error: ' + err.message); }
  };

  const handleGenerateSchedule = async (e) => {
    e.preventDefault();
    if (!genForm.caregiverId || !genForm.daysOfWeek.length) {
      setMessage('Select a caregiver and at least one day'); return;
    }
    try {
      const r = await fetch(`${API_BASE_URL}/api/care-plans/${showGenModal.id}/generate-schedule`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify(genForm)
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || 'Failed');
      setMessage(`Created ${data.created} recurring schedule(s)${data.warnings?.length ? '. Warnings: ' + data.warnings.join(', ') : ''}`);
      setShowGenModal(null);
      setTimeout(() => setMessage(''), 5000);
    } catch (err) {
      setMessage('Error: ' + err.message);
    }
  };

  const toggleGenDay = (day) => {
    setGenForm(prev => ({
      ...prev,
      daysOfWeek: prev.daysOfWeek.includes(day) ? prev.daysOfWeek.filter(d => d !== day) : [...prev.daysOfWeek, day]
    }));
  };

  const loadData = async () => {
    try {
      const [clientsRes, plansRes] = await Promise.all([
        fetch(`${API_BASE_URL}/api/clients`, {
          headers: { 'Authorization': `Bearer ${token}` }
        }),
        fetch(`${API_BASE_URL}/api/care-plans`, {
          headers: { 'Authorization': `Bearer ${token}` }
        })
      ]);

      const clientsData = clientsRes.ok ? await clientsRes.json() : [];
      const plansData = plansRes.ok ? await plansRes.json() : [];

      const safeClients = Array.isArray(clientsData) ? clientsData : [];
      const safePlans = Array.isArray(plansData) ? plansData : [];
      setClients(safeClients);

      // Group plans by client
      const plansByClient = {};
      safeClients.forEach(client => {
        plansByClient[client.id] = [];
      });

      safePlans.forEach(plan => {
        if (plansByClient[plan.client_id]) {
          plansByClient[plan.client_id].push(plan);
        }
      });

      setCarePlans(plansByClient);
    } catch (error) {
      console.error('Failed to load data:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleAddPlan = async (e) => {
    e.preventDefault();
    setMessage('');

    if (!formData.clientId || !formData.serviceType) {
      setMessage('Client and service type are required');
      return;
    }

    try {
      const response = await fetch(`${API_BASE_URL}/api/care-plans`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify(formData)
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to create care plan');
      }

      setMessage('Care plan created successfully!');
      setFormData({
        clientId: '',
        serviceType: 'personal_care',
        serviceDescription: '',
        frequency: '',
        careGoals: '',
        specialInstructions: '',
        precautions: '',
        medicationNotes: '',
        mobilityNotes: '',
        dietaryNotes: '',
        communicationNotes: '',
        startDate: new Date().toISOString().split('T')[0],
        endDate: ''
      });
      setShowForm(false);
      loadData();
    } catch (error) {
      setMessage('Error: ' + error.message);
    }
  };

  const handleDeletePlan = async (planId) => {
    const _cok = await confirm('Delete this care plan?', {danger: true}); if (!_cok) return;

    try {
      const response = await fetch(`${API_BASE_URL}/api/care-plans/${planId}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${token}` }
      });

      if (!response.ok) throw new Error('Failed to delete');

      setMessage('Care plan deleted');
      setTimeout(() => setMessage(''), 2000);
      loadData();
    } catch (error) {
      setMessage('Error: ' + error.message);
    }
  };

  const getServiceLabel = (serviceType) => {
    const labels = {
      'personal_care': 'Personal Care',
      'medication_management': 'Medication Management',
      'companionship': 'Companionship',
      'respite_care': 'Respite Care',
      'mobility_assistance': 'Mobility Assistance',
      'meal_prep': 'Meal Preparation',
      'transportation': 'Transportation',
      'other': 'Other'
    };
    return labels[serviceType] || serviceType;
  };

  const isActivePlan = (plan) => {
    const today = new Date().toISOString().split('T')[0];
    const isAfterStart = !plan.start_date || plan.start_date <= today;
    const isBeforeEnd = !plan.end_date || plan.end_date >= today;
    return isAfterStart && isBeforeEnd;
  };

  if (loading) {
    return (
      <div className="loading">
        <div className="spinner"></div>
      </div>
    );
  }

  return (
    <div>
      <div className="page-header">
        <h2>Care Plans & Service Agreements</h2>
        <div style={{ display: 'flex', gap: '0.5rem' }}>
          <button
            className="btn btn-secondary"
            onClick={() => setShowTemplateModal(true)}
            title="Start from a pre-built template"
          >
            📋 Use Template ({templates.length})
          </button>
          <button
            className="btn btn-primary"
            onClick={() => setShowForm(!showForm)}
          >
            {showForm ? 'Cancel' : 'Add Care Plan'}
          </button>
        </div>
      </div>

      {showTemplateModal && (
        <div className="modal active" onClick={() => setShowTemplateModal(false)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()} style={{ maxWidth: '700px' }}>
            <div className="modal-header">
              <h2>📋 Create from Template</h2>
              <button className="close-btn" onClick={() => setShowTemplateModal(false)}>×</button>
            </div>
            <div style={{ padding: '0 1rem 1rem' }}>
              <div className="form-group">
                <label>Client *</label>
                <select value={templateClientId} onChange={(e) => setTemplateClientId(e.target.value)} required>
                  <option value="">Select client...</option>
                  {clients.map(c => <option key={c.id} value={c.id}>{c.first_name} {c.last_name}</option>)}
                </select>
              </div>
              <div style={{ display: 'grid', gap: '0.5rem', maxHeight: '60vh', overflow: 'auto' }}>
                {templates.length === 0 && <p className="text-muted">No templates available.</p>}
                {templates.map(t => (
                  <button
                    key={t.id}
                    type="button"
                    disabled={!templateClientId}
                    onClick={() => applyTemplate(t.id)}
                    style={{
                      textAlign: 'left', padding: '1rem',
                      background: templateClientId ? '#fff' : '#F9FAFB',
                      border: '1px solid #E5E7EB', borderRadius: 8,
                      cursor: templateClientId ? 'pointer' : 'not-allowed',
                      opacity: templateClientId ? 1 : 0.6,
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 4 }}>
                      <strong style={{ fontSize: '1rem' }}>{t.template_name}</strong>
                      {t.is_built_in && <span className="badge badge-info" style={{ fontSize: '0.65rem' }}>built-in</span>}
                    </div>
                    {t.template_description && (
                      <div style={{ fontSize: '0.85rem', color: '#6B7280' }}>{t.template_description}</div>
                    )}
                    <div style={{ fontSize: '0.75rem', color: '#9CA3AF', marginTop: 4 }}>
                      {t.service_type} · {t.frequency}
                    </div>
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {message && (
        <div className={`alert ${message.includes('Error') ? 'alert-error' : 'alert-success'}`}>
          {message}
        </div>
      )}

      {/* Add Care Plan Form */}
      {showForm && (
        <div className="card card-form">
          <h3>Create New Care Plan</h3>
          <form onSubmit={handleAddPlan}>
            <div className="form-grid-2">
              <div className="form-group">
                <label>Client *</label>
                <select
                  value={formData.clientId}
                  onChange={(e) => setFormData({ ...formData, clientId: e.target.value })}
                  required
                >
                  <option value="">Select client...</option>
                  {clients.map(client => (
                    <option key={client.id} value={client.id}>
                      {client.first_name} {client.last_name}
                    </option>
                  ))}
                </select>
              </div>

              <div className="form-group">
                <label>Service Type *</label>
                <select
                  value={formData.serviceType}
                  onChange={(e) => setFormData({ ...formData, serviceType: e.target.value })}
                >
                  <option value="personal_care">Personal Care</option>
                  <option value="medication_management">Medication Management</option>
                  <option value="companionship">Companionship</option>
                  <option value="respite_care">Respite Care</option>
                  <option value="mobility_assistance">Mobility Assistance</option>
                  <option value="meal_prep">Meal Preparation</option>
                  <option value="transportation">Transportation</option>
                  <option value="other">Other</option>
                </select>
              </div>

              <div className="form-group">
                <label>Frequency</label>
                <input
                  type="text"
                  value={formData.frequency}
                  onChange={(e) => setFormData({ ...formData, frequency: e.target.value })}
                  placeholder="e.g., Daily, 3x per week, Monday-Friday"
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
                <label>End Date (if applicable)</label>
                <input
                  type="date"
                  value={formData.endDate}
                  onChange={(e) => setFormData({ ...formData, endDate: e.target.value })}
                />
              </div>
            </div>

            <div className="form-group">
              <label>Service Description</label>
              <textarea
                value={formData.serviceDescription}
                onChange={(e) => setFormData({ ...formData, serviceDescription: e.target.value })}
                placeholder="Detailed description of what this service entails..."
                rows="3"
              ></textarea>
            </div>

            <div className="form-group">
              <label>Care Goals</label>
              <textarea
                value={formData.careGoals}
                onChange={(e) => setFormData({ ...formData, careGoals: e.target.value })}
                placeholder="What are the goals for this care plan? (e.g., improve mobility, maintain independence, manage pain...)"
                rows="3"
              ></textarea>
            </div>

            <div className="form-group">
              <label>Special Instructions</label>
              <textarea
                value={formData.specialInstructions}
                onChange={(e) => setFormData({ ...formData, specialInstructions: e.target.value })}
                placeholder="Any special instructions caregivers should follow..."
                rows="3"
              ></textarea>
            </div>

            <div className="form-group">
              <label>Safety Precautions</label>
              <textarea
                value={formData.precautions}
                onChange={(e) => setFormData({ ...formData, precautions: e.target.value })}
                placeholder="Any safety concerns, fall risks, allergies, or precautions..."
                rows="3"
              ></textarea>
            </div>

            <div className="form-group">
              <label>Medication Notes</label>
              <textarea
                value={formData.medicationNotes}
                onChange={(e) => setFormData({ ...formData, medicationNotes: e.target.value })}
                placeholder="Instructions for medication management, timing, side effects to watch for..."
                rows="2"
              ></textarea>
            </div>

            <div className="form-group">
              <label>Mobility Notes</label>
              <textarea
                value={formData.mobilityNotes}
                onChange={(e) => setFormData({ ...formData, mobilityNotes: e.target.value })}
                placeholder="Mobility assistance needed, equipment (walker, wheelchair), transfer techniques..."
                rows="2"
              ></textarea>
            </div>

            <div className="form-group">
              <label>Dietary Notes</label>
              <textarea
                value={formData.dietaryNotes}
                onChange={(e) => setFormData({ ...formData, dietaryNotes: e.target.value })}
                placeholder="Dietary restrictions, preferences, feeding assistance needed..."
                rows="2"
              ></textarea>
            </div>

            <div className="form-group">
              <label>Communication Notes</label>
              <textarea
                value={formData.communicationNotes}
                onChange={(e) => setFormData({ ...formData, communicationNotes: e.target.value })}
                placeholder="Communication style, hearing/vision issues, cognitive considerations..."
                rows="2"
              ></textarea>
            </div>

            <div className="form-actions">
              <button type="submit" className="btn btn-primary">Create Care Plan</button>
              <button type="button" className="btn btn-secondary" onClick={() => setShowForm(false)}>Cancel</button>
            </div>
          </form>
        </div>
      )}

      {/* Care Plans by Client */}
      {clients.length === 0 ? (
        <div className="card card-centered">
          <p>No clients yet. Create a client to add care plans.</p>
        </div>
      ) : (
        <div style={{ display: 'grid', gap: '1.5rem' }}>
          {clients.map(client => {
            const clientPlans = carePlans[client.id] || [];
            const activePlans = clientPlans.filter(isActivePlan);
            const isExpanded = expandedClient === client.id;

            return (
              <div key={client.id} className="card">
                <div
                  onClick={() => setExpandedClient(isExpanded ? null : client.id)}
                  style={{
                    cursor: 'pointer',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    paddingBottom: '1rem',
                    borderBottom: '1px solid #ddd'
                  }}
                >
                  <div>
                    <h3 style={{ margin: 0 }}>{client.first_name} {client.last_name}</h3>
                    <small style={{ color: '#666' }}>
                      {activePlans.length} active plan{activePlans.length !== 1 ? 's' : ''}
                      {clientPlans.length > activePlans.length && ` • ${clientPlans.length - activePlans.length} archived`}
                    </small>
                  </div>
                  <span style={{ fontSize: '1.2rem' }}>
                    {isExpanded ? '▼' : '▶'}
                  </span>
                </div>

                {isExpanded && (
                  <div style={{ paddingTop: '1rem' }}>
                    {clientPlans.length === 0 ? (
                      <p style={{ color: '#999', textAlign: 'center', padding: '1rem' }}>
                        No care plans yet for this client.
                      </p>
                    ) : (
                      <div style={{ display: 'grid', gap: '1rem' }}>
                        {clientPlans.map(plan => {
                          const active = isActivePlan(plan);

                          return (
                            <div
                              key={plan.id}
                              style={{
                                padding: '1rem',
                                background: active ? '#f0f8ff' : '#f5f5f5',
                                border: `1px solid ${active ? '#2196f3' : '#ddd'}`,
                                borderRadius: '6px',
                                opacity: active ? 1 : 0.7
                              }}
                            >
                              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'start', marginBottom: '0.75rem' }}>
                                <div>
                                  <strong>{getServiceLabel(plan.service_type)}</strong>
                                  {plan.frequency && <div style={{ fontSize: '0.9rem', color: '#666' }}>{plan.frequency}</div>}
                                </div>
                                <div style={{ display: 'flex', gap: '0.5rem' }}>
                                  {active && <span className="badge badge-success">Active</span>}
                                  {!active && <span className="badge badge-secondary">Archived</span>}
                                  <button
                                    className="btn btn-sm btn-primary"
                                    onClick={(e) => { e.stopPropagation(); setShowGenModal(plan); setGenForm({ caregiverId: '', startTime: '09:00', endTime: '13:00', daysOfWeek: [], startDate: plan.start_date?.split('T')[0] || '', endDate: plan.end_date?.split('T')[0] || '' }); }}
                                  >
                                    Generate Schedule
                                  </button>
                                  <button
                                    className="btn btn-sm btn-danger"
                                    onClick={() => handleDeletePlan(plan.id)}
                                  >
                                    Delete
                                  </button>
                                </div>
                              </div>

                              <div style={{ fontSize: '0.9rem', marginBottom: '0.75rem' }}>
                                <strong>Period:</strong> {new Date(plan.start_date).toLocaleDateString()}
                                {plan.end_date && ` - ${new Date(plan.end_date).toLocaleDateString()}`}
                              </div>

                              {plan.service_description && (
                                <div style={{ marginBottom: '0.75rem' }}>
                                  <strong>Description:</strong>
                                  <p style={{ margin: '0.25rem 0', whiteSpace: 'pre-wrap' }}>
                                    {plan.service_description}
                                  </p>
                                </div>
                              )}

                              {plan.care_goals && (
                                <div style={{ marginBottom: '0.75rem' }}>
                                  <strong>Care Goals:</strong>
                                  <p style={{ margin: '0.25rem 0', whiteSpace: 'pre-wrap' }}>
                                    {plan.care_goals}
                                  </p>
                                </div>
                              )}

                              {plan.special_instructions && (
                                <div style={{ marginBottom: '0.75rem' }}>
                                  <strong>Special Instructions:</strong>
                                  <p style={{ margin: '0.25rem 0', whiteSpace: 'pre-wrap' }}>
                                    {plan.special_instructions}
                                  </p>
                                </div>
                              )}

                              {plan.precautions && (
                                <div style={{ marginBottom: '0.75rem', padding: '0.75rem', background: '#ffe6e6', borderRadius: '4px' }}>
                                  <strong style={{ color: '#d32f2f' }}>Safety Precautions:</strong>
                                  <p style={{ margin: '0.25rem 0', whiteSpace: 'pre-wrap' }}>
                                    {plan.precautions}
                                  </p>
                                </div>
                              )}

                              {(plan.medication_notes || plan.mobility_notes || plan.dietary_notes || plan.communication_notes) && (
                                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem', marginTop: '0.75rem' }}>
                                  {plan.medication_notes && (
                                    <div style={{ padding: '0.5rem', background: '#f5f5f5', borderRadius: '4px', fontSize: '0.85rem' }}>
                                      <strong>Medication:</strong>
                                      <p style={{ margin: '0.25rem 0', whiteSpace: 'pre-wrap' }}>
                                        {plan.medication_notes}
                                      </p>
                                    </div>
                                  )}
                                  {plan.mobility_notes && (
                                    <div style={{ padding: '0.5rem', background: '#f5f5f5', borderRadius: '4px', fontSize: '0.85rem' }}>
                                      <strong>Mobility:</strong>
                                      <p style={{ margin: '0.25rem 0', whiteSpace: 'pre-wrap' }}>
                                        {plan.mobility_notes}
                                      </p>
                                    </div>
                                  )}
                                  {plan.dietary_notes && (
                                    <div style={{ padding: '0.5rem', background: '#f5f5f5', borderRadius: '4px', fontSize: '0.85rem' }}>
                                      <strong>Dietary:</strong>
                                      <p style={{ margin: '0.25rem 0', whiteSpace: 'pre-wrap' }}>
                                        {plan.dietary_notes}
                                      </p>
                                    </div>
                                  )}
                                  {plan.communication_notes && (
                                    <div style={{ padding: '0.5rem', background: '#f5f5f5', borderRadius: '4px', fontSize: '0.85rem' }}>
                                      <strong>Communication:</strong>
                                      <p style={{ margin: '0.25rem 0', whiteSpace: 'pre-wrap' }}>
                                        {plan.communication_notes}
                                      </p>
                                    </div>
                                  )}
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Generate Schedule Modal */}
      {showGenModal && (
        <div className="modal active">
          <div className="modal-content">
            <div className="modal-header">
              <h2>Generate Schedule from Care Plan</h2>
              <button className="close-btn" onClick={() => setShowGenModal(null)}>x</button>
            </div>
            <div style={{ background: '#EFF6FF', borderRadius: 8, padding: '0.75rem', marginBottom: '1rem', fontSize: '0.85rem', color: '#1E40AF' }}>
              <strong>{getServiceLabel(showGenModal.service_type)}</strong>
              {showGenModal.frequency && <span> — {showGenModal.frequency}</span>}
            </div>
            <form onSubmit={handleGenerateSchedule}>
              <div className="form-group">
                <label>Caregiver *</label>
                <select value={genForm.caregiverId} onChange={e => setGenForm(p => ({ ...p, caregiverId: e.target.value }))} required>
                  <option value="">Select caregiver...</option>
                  {caregivers.map(cg => <option key={cg.id} value={cg.id}>{cg.first_name} {cg.last_name}</option>)}
                </select>
              </div>
              <div className="form-group">
                <label>Days of Week *</label>
                <div style={{ display: 'flex', gap: '0.35rem', flexWrap: 'wrap' }}>
                  {['Sun','Mon','Tue','Wed','Thu','Fri','Sat'].map((day, i) => (
                    <button key={i} type="button" onClick={() => toggleGenDay(i)}
                      style={{ padding: '0.4rem 0.7rem', borderRadius: 8, border: '1px solid #D1D5DB', cursor: 'pointer',
                        background: genForm.daysOfWeek.includes(i) ? '#2ABBA7' : '#fff',
                        color: genForm.daysOfWeek.includes(i) ? '#fff' : '#374151', fontWeight: 600, fontSize: '0.82rem' }}>
                      {day}
                    </button>
                  ))}
                </div>
              </div>
              <div className="form-grid-2">
                <div className="form-group"><label>Start Time *</label><input type="time" value={genForm.startTime} onChange={e => setGenForm(p => ({ ...p, startTime: e.target.value }))} required /></div>
                <div className="form-group"><label>End Time *</label><input type="time" value={genForm.endTime} onChange={e => setGenForm(p => ({ ...p, endTime: e.target.value }))} required /></div>
              </div>
              <div className="form-grid-2">
                <div className="form-group"><label>Effective Date</label><input type="date" value={genForm.startDate} onChange={e => setGenForm(p => ({ ...p, startDate: e.target.value }))} /></div>
                <div className="form-group"><label>End Date</label><input type="date" value={genForm.endDate} onChange={e => setGenForm(p => ({ ...p, endDate: e.target.value }))} /></div>
              </div>
              <div className="modal-actions">
                <button type="submit" className="btn btn-primary">Generate {genForm.daysOfWeek.length} Schedule{genForm.daysOfWeek.length !== 1 ? 's' : ''}</button>
                <button type="button" className="btn btn-secondary" onClick={() => setShowGenModal(null)}>Cancel</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

export default CarePlans;
