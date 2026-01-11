// src/components/admin/ClientOnboarding.jsx
import React, { useState, useEffect } from 'react';
import { API_BASE_URL } from '../../config';

const ClientOnboarding = ({ token }) => {
  const [clients, setClients] = useState([]);
  const [expandedClient, setExpandedClient] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saveMessage, setSaveMessage] = useState('');

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
    } catch (error) {
      console.error('Failed to load clients:', error);
    } finally {
      setLoading(false);
    }
  };

  const onboardingItems = [
    {
      id: 'emergency_contacts_completed',
      label: 'Emergency Contacts',
      description: 'Primary and secondary emergency contact information'
    },
    {
      id: 'medical_history_completed',
      label: 'Medical History',
      description: 'Conditions, medications, allergies'
    },
    {
      id: 'insurance_info_completed',
      label: 'Insurance Information',
      description: 'Insurance provider, policy details'
    },
    {
      id: 'care_preferences_completed',
      label: 'Care Preferences',
      description: 'Client preferences, preferred caregivers'
    },
    {
      id: 'family_communication_plan_completed',
      label: 'Family Communication Plan',
      description: 'How and when to contact family'
    },
    {
      id: 'initial_assessment_completed',
      label: 'Initial Assessment',
      description: 'Comprehensive care assessment'
    }
  ];

  const handleCheckboxChange = async (clientId, itemId) => {
    try {
      const response = await fetch(`${API_BASE_URL}/api/client-onboarding/${clientId}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          [itemId]: true
        })
      });

      if (!response.ok) throw new Error('Failed to update');

      // Update local state
      setClients(clients.map(client => {
        if (client.id === clientId) {
          return {
            ...client,
            onboarding: {
              ...client.onboarding,
              [itemId]: true,
              updated_at: new Date()
            }
          };
        }
        return client;
      }));

      setSaveMessage('✓ Updated');
      setTimeout(() => setSaveMessage(''), 2000);
    } catch (error) {
      alert('Failed to update: ' + error.message);
    }
  };

  const calculateProgress = (client) => {
    if (!client.onboarding) return 0;
    const completed = onboardingItems.filter(item => 
      client.onboarding[item.id]
    ).length;
    return Math.round((completed / onboardingItems.length) * 100);
  };

  const getStatusBadge = (progress) => {
    if (progress === 100) return <span className="badge badge-success">Complete</span>;
    if (progress > 0) return <span className="badge badge-warning">In Progress</span>;
    return <span className="badge badge-danger">Not Started</span>;
  };

  return (
    <div>
      <div className="page-header">
        <h2>📋 Client Onboarding</h2>
      </div>

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
              <div key={client.id} className="onboarding-card">
                <div 
                  className="onboarding-header"
                  onClick={() => setExpandedClient(isExpanded ? null : client.id)}
                >
                  <div className="onboarding-info">
                    <h3>{client.first_name} {client.last_name}</h3>
                    <p>{client.service_type || 'Care Service'}</p>
                  </div>

                  <div className="onboarding-status">
                    <div className="progress-bar">
                      <div 
                        className="progress-fill" 
                        style={{ width: `${progress}%` }}
                      ></div>
                    </div>
                    <span className="progress-text">{progress}%</span>
                    {getStatusBadge(progress)}
                  </div>

                  <span className="expand-icon">
                    {isExpanded ? '▼' : '▶'}
                  </span>
                </div>

                {isExpanded && (
                  <div className="onboarding-checklist">
                    {onboardingItems.map(item => (
                      <div key={item.id} className="checklist-item">
                        <label className="checkbox-label">
                          <input
                            type="checkbox"
                            checked={client.onboarding?.[item.id] || false}
                            onChange={() => handleCheckboxChange(client.id, item.id)}
                            className="form-checkbox"
                          />
                          <span>
                            <strong>{item.label}</strong><br/>
                            <small>{item.description}</small>
                          </span>
                        </label>
                        {client.onboarding?.[item.id] && (
                          <span className="check-icon">✓</span>
                        )}
                      </div>
                    ))}

                    {saveMessage && (
                      <p className="success-message">{saveMessage}</p>
                    )}

                    {client.onboarding?.all_completed && (
                      <div className="completion-banner">
                        <h4>✅ Onboarding Complete!</h4>
                        <p>Completed on: {new Date(client.onboarding.completed_at).toLocaleDateString()}</p>
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

export default ClientOnboarding;