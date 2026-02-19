import { confirm } from '../ConfirmModal';
// src/components/admin/CarePlans.jsx
import React, { useState, useEffect, useCallback } from 'react';
import { API_BASE_URL } from '../../config';

const CarePlans = ({ token }) => {
  const [clients, setClients] = useState([]);
  const [carePlans, setCarePlans] = useState({});
  $1
  const [isDirty, setIsDirty] = useState(false);
  const [expandedClient, setExpandedClient] = useState(null);
  const [showForm, setShowForm] = useState(false);
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

  $1Data();
  }, []);

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

      const clientsData = await clientsRes.json();
      const plansData = await plansRes.json();

      setClients(clientsData);

      // Group plans by client
      const plansByClient = {};
      clientsData.forEach(client => {
        plansByClient[client.id] = [];
      });

      plansData.forEach(plan => {
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
        <button
          className="btn btn-primary"
          onClick={() => setShowForm(!showForm)}
        >
          {showForm ? 'Cancel' : 'Add Care Plan'}
        </button>
      </div>

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
    </div>
  );
};

export default CarePlans;
