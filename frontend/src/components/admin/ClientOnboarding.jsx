// src/components/admin/ClientOnboarding.jsx
import React, { useState, useEffect } from 'react';
import { API_BASE_URL } from '../../config';

const ClientOnboarding = ({ token }) => {
  const [clients, setClients] = useState([]);
  const [expandedClient, setExpandedClient] = useState(null);
  const [expandedStep, setExpandedStep] = useState(null);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState('');
  const [clientData, setClientData] = useState({});

  useEffect(() => {
    loadClients();
  }, []);

  const loadClients = async () => {
    try {
      const response = await fetch(`${API_BASE_URL}/api/clients`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      const data = await response.json();
      setClients(data);
      
      // Load onboarding data for each client
      data.forEach(client => {
        loadClientData(client.id);
      });
    } catch (error) {
      console.error('Failed to load clients:', error);
    } finally {
      setLoading(false);
    }
  };

  const loadClientData = async (clientId) => {
    try {
      const response = await fetch(`${API_BASE_URL}/api/clients/${clientId}/onboarding`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      const data = await response.json();
      setClientData(prev => ({
        ...prev,
        [clientId]: data || {}
      }));
    } catch (error) {
      console.error('Failed to load client onboarding data:', error);
    }
  };

  const onboardingSteps = [
    {
      id: 'emergency_contacts',
      label: 'Emergency Contacts',
      description: 'Primary and secondary emergency contact information',
      fields: ['emergency_contact_1_name', 'emergency_contact_1_phone', 'emergency_contact_1_relationship', 
               'emergency_contact_2_name', 'emergency_contact_2_phone', 'emergency_contact_2_relationship']
    },
    {
      id: 'medical_history',
      label: 'Medical History',
      description: 'Conditions, medications, allergies, and medical alerts',
      fields: ['medical_conditions', 'current_medications', 'medication_allergies', 'medical_alerts']
    },
    {
      id: 'insurance_info',
      label: 'Insurance Information',
      description: 'Insurance provider and policy details',
      fields: ['insurance_provider', 'insurance_policy_number', 'insurance_group_number', 'insurance_contact']
    },
    {
      id: 'care_preferences',
      label: 'Care Preferences',
      description: 'Client preferences and preferred caregivers',
      fields: ['care_preferences', 'preferred_caregivers', 'mobility_assistance_needs', 'communication_preferences']
    },
    {
      id: 'family_communication',
      label: 'Family Communication Plan',
      description: 'How and when to contact family',
      fields: ['family_contact_name', 'family_contact_phone', 'family_contact_email', 'communication_frequency', 'communication_method']
    },
    {
      id: 'initial_assessment',
      label: 'Initial Assessment',
      description: 'Comprehensive care assessment and goals',
      fields: ['assessment_date', 'functional_status', 'care_goals', 'assessment_notes']
    }
  ];

  const handleSaveStep = async (clientId, stepId, formValues) => {
    try {
      const response = await fetch(`${API_BASE_URL}/api/clients/${clientId}/onboarding/${stepId}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify(formValues)
      });

      if (!response.ok) throw new Error('Failed to save');

      await loadClientData(clientId);
      setMessage('Onboarding step saved successfully!');
      setTimeout(() => setMessage(''), 2000);
      setExpandedStep(null);
    } catch (error) {
      setMessage('Error: ' + error.message);
    }
  };

  const calculateProgress = (client) => {
    const data = clientData[client.id] || {};
    const completedSteps = onboardingSteps.filter(step => {
      const hasData = step.fields.some(field => data[field]);
      return hasData;
    }).length;
    return Math.round((completedSteps / onboardingSteps.length) * 100);
  };

  const getStepStatus = (client, stepId) => {
    const data = clientData[client.id] || {};
    const step = onboardingSteps.find(s => s.id === stepId);
    if (!step) return false;
    return step.fields.some(field => data[field]);
  };

  const renderStepForm = (client, step) => {
    const data = clientData[client.id] || {};

    const renderField = (fieldName, label, type = 'text') => (
      <div key={fieldName} className="form-group">
        <label>{label}</label>
        {type === 'textarea' ? (
          <textarea
            id={fieldName}
            defaultValue={data[fieldName] || ''}
            rows="3"
          ></textarea>
        ) : (
          <input
            id={fieldName}
            type={type}
            defaultValue={data[fieldName] || ''}
          />
        )}
      </div>
    );

    const getFormValues = () => {
      const values = {};
      step.fields.forEach(field => {
        const element = document.getElementById(field);
        if (element) {
          values[field] = element.value;
        }
      });
      return values;
    };

    return (
      <div className="card card-form">
        <h4>{step.label}</h4>

        {step.id === 'emergency_contacts' && (
          <div>
            <h5 style={{ marginTop: '1rem', marginBottom: '0.5rem' }}>Primary Contact</h5>
            <div className="form-grid-2">
              {renderField('emergency_contact_1_name', 'Name')}
              {renderField('emergency_contact_1_phone', 'Phone', 'tel')}
              {renderField('emergency_contact_1_relationship', 'Relationship')}
            </div>

            <h5 style={{ marginTop: '1rem', marginBottom: '0.5rem' }}>Secondary Contact</h5>
            <div className="form-grid-2">
              {renderField('emergency_contact_2_name', 'Name')}
              {renderField('emergency_contact_2_phone', 'Phone', 'tel')}
              {renderField('emergency_contact_2_relationship', 'Relationship')}
            </div>
          </div>
        )}

        {step.id === 'medical_history' && (
          <div className="form-grid">
            {renderField('medical_conditions', 'Medical Conditions', 'textarea')}
            {renderField('current_medications', 'Current Medications', 'textarea')}
            {renderField('medication_allergies', 'Medication Allergies', 'textarea')}
            {renderField('medical_alerts', 'Medical Alerts / Special Needs', 'textarea')}
          </div>
        )}

        {step.id === 'insurance_info' && (
          <div className="form-grid-2">
            {renderField('insurance_provider', 'Insurance Provider')}
            {renderField('insurance_policy_number', 'Policy Number')}
            {renderField('insurance_group_number', 'Group Number')}
            {renderField('insurance_contact', 'Insurance Contact Phone', 'tel')}
          </div>
        )}

        {step.id === 'care_preferences' && (
          <div className="form-grid">
            {renderField('care_preferences', 'Care Preferences & Routines', 'textarea')}
            {renderField('preferred_caregivers', 'Preferred Caregivers', 'textarea')}
            {renderField('mobility_assistance_needs', 'Mobility Assistance Needs', 'textarea')}
            {renderField('communication_preferences', 'Communication Preferences', 'textarea')}
          </div>
        )}

        {step.id === 'family_communication' && (
          <div className="form-grid-2">
            {renderField('family_contact_name', 'Family Contact Name')}
            {renderField('family_contact_phone', 'Phone', 'tel')}
            {renderField('family_contact_email', 'Email', 'email')}
            {renderField('communication_frequency', 'Communication Frequency')}
            <div className="form-group" style={{ gridColumn: '1 / -1' }}>
              <label>Communication Method</label>
              <textarea id="communication_method" defaultValue={data.communication_method || ''} rows="2"></textarea>
            </div>
          </div>
        )}

        {step.id === 'initial_assessment' && (
          <div className="form-grid">
            {renderField('assessment_date', 'Assessment Date', 'date')}
            {renderField('functional_status', 'Functional Status', 'textarea')}
            {renderField('care_goals', 'Care Goals', 'textarea')}
            {renderField('assessment_notes', 'Assessment Notes', 'textarea')}
          </div>
        )}

        <div className="form-actions" style={{ marginTop: '1rem' }}>
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => handleSaveStep(client.id, step.id, getFormValues())}
          >
            Save {step.label}
          </button>
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => setExpandedStep(null)}
          >
            Cancel
          </button>
        </div>
      </div>
    );
  };

  return (
    <div>
      <div className="page-header">
        <h2>Client Onboarding</h2>
      </div>

      {message && (
        <div className={`alert ${message.includes('Error') ? 'alert-error' : 'alert-success'}`}>
          {message}
        </div>
      )}

      {loading ? (
        <div className="loading">
          <div className="spinner"></div>
        </div>
      ) : clients.length === 0 ? (
        <div className="card card-centered">
          <p>No clients yet. Create a client to begin onboarding.</p>
        </div>
      ) : (
        <div className="onboarding-list">
          {clients.map(client => {
            const progress = calculateProgress(client);
            const isExpanded = expandedClient === client.id;

            return (
              <div key={client.id} className="card" style={{ marginBottom: '1.5rem' }}>
                <div 
                  className="onboarding-header"
                  onClick={() => setExpandedClient(isExpanded ? null : client.id)}
                  style={{ cursor: 'pointer', paddingBottom: '1rem', borderBottom: '1px solid #ddd' }}
                >
                  <div className="onboarding-info">
                    <h3 style={{ margin: '0 0 0.25rem 0' }}>{client.first_name} {client.last_name}</h3>
                    <p style={{ margin: 0, fontSize: '0.9rem', color: '#666' }}>
                      {client.service_type?.replace('_', ' ').toUpperCase()} - {client.city || 'No city'}
                    </p>
                  </div>

                  <div className="onboarding-status" style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '0.5rem' }}>
                    <div style={{ display: 'flex', gap: '1rem', alignItems: 'center' }}>
                      <div style={{ 
                        width: '100px',
                        height: '6px',
                        background: '#e0e0e0',
                        borderRadius: '3px',
                        overflow: 'hidden'
                      }}>
                        <div 
                          style={{ 
                            width: `${progress}%`,
                            height: '100%',
                            background: progress === 100 ? '#4caf50' : '#2196f3',
                            transition: 'width 0.3s'
                          }}
                        ></div>
                      </div>
                      <span style={{ fontSize: '0.9rem', fontWeight: 'bold', minWidth: '40px' }}>
                        {progress}%
                      </span>
                    </div>
                    {progress === 100 && <span className="badge badge-success">Complete</span>}
                  </div>

                  <span style={{ fontSize: '1.2rem' }}>
                    {isExpanded ? '▼' : '▶'}
                  </span>
                </div>

                {isExpanded && (
                  <div style={{ paddingTop: '1rem' }}>
                    {onboardingSteps.map(step => {
                      const stepCompleted = getStepStatus(client, step.id);
                      const stepExpanded = expandedStep === `${client.id}-${step.id}`;

                      return (
                        <div key={step.id} style={{ marginBottom: '1rem' }}>
                          <div
                            onClick={() => setExpandedStep(stepExpanded ? null : `${client.id}-${step.id}`)}
                            style={{
                              padding: '1rem',
                              background: stepCompleted ? '#f0f8f0' : '#f5f5f5',
                              borderLeft: `4px solid ${stepCompleted ? '#4caf50' : '#ccc'}`,
                              cursor: 'pointer',
                              display: 'flex',
                              justifyContent: 'space-between',
                              alignItems: 'center',
                              borderRadius: '4px'
                            }}
                          >
                            <div>
                              <strong>{step.label}</strong>
                              <p style={{ margin: '0.25rem 0 0 0', fontSize: '0.85rem', color: '#666' }}>
                                {step.description}
                              </p>
                            </div>
                            <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                              {stepCompleted && <span style={{ color: '#4caf50', fontSize: '1.2rem' }}>✓</span>}
                              <span style={{ fontSize: '1rem' }}>
                                {stepExpanded ? '▼' : '▶'}
                              </span>
                            </div>
                          </div>

                          {stepExpanded && (
                            <div style={{ paddingTop: '1rem' }}>
                              {renderStepForm(client, step)}
                            </div>
                          )}
                        </div>
                      );
                    })}
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

export default ClientOnboarding;
