// src/components/CaregiverClientModal.jsx
// What caregivers see when they click on a client - care-focused info only, no admin/billing
import React, { useState, useEffect } from 'react';
import { API_BASE_URL } from '../config';

const CaregiverClientModal = ({ clientId, isOpen, onClose, token }) => {
  const [client, setClient] = useState(null);
  const [visitNotes, setVisitNotes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('info');
  const [newNote, setNewNote] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (isOpen && clientId) {
      loadClientData();
    }
  }, [isOpen, clientId]);

  const loadClientData = async () => {
    setLoading(true);
    try {
      const [clientRes, notesRes] = await Promise.all([
        fetch(`${API_BASE_URL}/api/clients/${clientId}/caregiver-view`, {
          headers: { 'Authorization': `Bearer ${token}` }
        }),
        fetch(`${API_BASE_URL}/api/clients/${clientId}/visit-notes`, {
          headers: { 'Authorization': `Bearer ${token}` }
        })
      ]);

      if (clientRes.ok) {
        setClient(await clientRes.json());
      }
      if (notesRes.ok) {
        setVisitNotes(await notesRes.json());
      }
    } catch (error) {
      console.error('Failed to load client data:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleAddNote = async (e) => {
    e.preventDefault();
    if (!newNote.trim()) return;

    setSubmitting(true);
    try {
      const response = await fetch(`${API_BASE_URL}/api/clients/${clientId}/visit-notes`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ note: newNote })
      });

      if (!response.ok) throw new Error('Failed to add note');

      setNewNote('');
      loadClientData();
    } catch (error) {
      alert('Failed to add note: ' + error.message);
    } finally {
      setSubmitting(false);
    }
  };

  if (!isOpen) return null;

  const tabs = [
    { id: 'info', label: '📋 Info' },
    { id: 'medical', label: '🏥 Medical' },
    { id: 'notes', label: '📝 Notes' }
  ];

  return (
    <div className="modal active">
      <div className="modal-content modal-large">
        <div className="modal-header">
          <h2>
            {loading ? 'Loading...' : `${client?.first_name} ${client?.last_name}`}
          </h2>
          <button className="close-btn" onClick={onClose}>×</button>
        </div>

        {loading ? (
          <div className="loading"><div className="spinner"></div></div>
        ) : !client ? (
          <p>Client not found</p>
        ) : (
          <>
            {/* Tabs */}
            <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1.5rem', borderBottom: '2px solid #eee', paddingBottom: '0.5rem' }}>
              {tabs.map(tab => (
                <button
                  key={tab.id}
                  type="button"
                  className={`btn ${activeTab === tab.id ? 'btn-primary' : 'btn-secondary'}`}
                  onClick={() => setActiveTab(tab.id)}
                  style={{ flex: 1 }}
                >
                  {tab.label}
                </button>
              ))}
            </div>

            {/* Info Tab */}
            {activeTab === 'info' && (
              <div>
                {/* Basic Info Card */}
                <div className="card" style={{ background: '#f8f9fa', marginBottom: '1rem' }}>
                  <h4 style={{ marginTop: 0 }}>👤 Basic Information</h4>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem' }}>
                    <p><strong>Phone:</strong> <a href={`tel:${client.phone}`}>{client.phone || 'N/A'}</a></p>
                    <p><strong>DOB:</strong> {client.date_of_birth ? new Date(client.date_of_birth).toLocaleDateString() : 'N/A'}</p>
                    <p style={{ gridColumn: '1 / -1' }}>
                      <strong>Address:</strong> {client.address ? `${client.address}, ${client.city}, ${client.state} ${client.zip}` : 'N/A'}
                    </p>
                  </div>
                </div>

                {/* Emergency Contact - IMPORTANT */}
                <div className="card" style={{ background: '#fff3cd', border: '2px solid #ffc107', marginBottom: '1rem' }}>
                  <h4 style={{ marginTop: 0, color: '#856404' }}>🚨 Emergency Contact</h4>
                  {client.emergency_contact_name ? (
                    <div>
                      <p style={{ margin: '0.25rem 0' }}>
                        <strong>{client.emergency_contact_name}</strong>
                        {client.emergency_contact_relationship && ` (${client.emergency_contact_relationship})`}
                      </p>
                      <p style={{ margin: '0.25rem 0', fontSize: '1.1rem' }}>
                        📞 <a href={`tel:${client.emergency_contact_phone}`} style={{ fontWeight: 'bold' }}>
                          {client.emergency_contact_phone}
                        </a>
                      </p>
                    </div>
                  ) : (
                    <p style={{ color: '#856404' }}>No emergency contact on file</p>
                  )}
                </div>

                {/* Care Preferences */}
                {client.care_preferences && (
                  <div className="card" style={{ marginBottom: '1rem' }}>
                    <h4 style={{ marginTop: 0 }}>💡 Care Preferences</h4>
                    <p style={{ whiteSpace: 'pre-wrap' }}>{client.care_preferences}</p>
                  </div>
                )}

                {/* General Notes for Caregivers */}
                {client.notes && (
                  <div className="card" style={{ marginBottom: '1rem' }}>
                    <h4 style={{ marginTop: 0 }}>📋 Care Instructions</h4>
                    <p style={{ whiteSpace: 'pre-wrap' }}>{client.notes}</p>
                  </div>
                )}
              </div>
            )}

            {/* Medical Tab */}
            {activeTab === 'medical' && (
              <div>
                {/* Allergies - CRITICAL */}
                <div className="card" style={{ background: client.allergies ? '#f8d7da' : '#f8f9fa', border: client.allergies ? '2px solid #dc3545' : '1px solid #ddd', marginBottom: '1rem' }}>
                  <h4 style={{ marginTop: 0, color: client.allergies ? '#721c24' : 'inherit' }}>
                    ⚠️ Allergies
                  </h4>
                  <p style={{ whiteSpace: 'pre-wrap', margin: 0 }}>
                    {client.allergies || 'No known allergies'}
                  </p>
                </div>

                {/* Medical Conditions */}
                <div className="card" style={{ marginBottom: '1rem' }}>
                  <h4 style={{ marginTop: 0 }}>🏥 Medical Conditions</h4>
                  <p style={{ whiteSpace: 'pre-wrap', margin: 0 }}>
                    {client.medical_conditions || 'None on file'}
                  </p>
                </div>

                {/* Medications */}
                <div className="card" style={{ marginBottom: '1rem' }}>
                  <h4 style={{ marginTop: 0 }}>💊 Medications</h4>
                  <p style={{ whiteSpace: 'pre-wrap', margin: 0 }}>
                    {client.medications || 'None on file'}
                  </p>
                </div>

                {/* Medical Notes */}
                {client.medical_notes && (
                  <div className="card" style={{ marginBottom: '1rem' }}>
                    <h4 style={{ marginTop: 0 }}>📝 Medical Notes</h4>
                    <p style={{ whiteSpace: 'pre-wrap', margin: 0 }}>{client.medical_notes}</p>
                  </div>
                )}

                {/* Mobility/Assistance Needs */}
                {client.mobility_assistance_needs && (
                  <div className="card" style={{ marginBottom: '1rem' }}>
                    <h4 style={{ marginTop: 0 }}>🚶 Mobility & Assistance</h4>
                    <p style={{ whiteSpace: 'pre-wrap', margin: 0 }}>{client.mobility_assistance_needs}</p>
                  </div>
                )}
              </div>
            )}

            {/* Notes Tab */}
            {activeTab === 'notes' && (
              <div>
                {/* Add New Note */}
                <div className="card" style={{ marginBottom: '1rem' }}>
                  <h4 style={{ marginTop: 0 }}>➕ Add Visit Note</h4>
                  <form onSubmit={handleAddNote}>
                    <div className="form-group">
                      <textarea
                        value={newNote}
                        onChange={(e) => setNewNote(e.target.value)}
                        placeholder="How was the visit? Any observations, concerns, or updates about the client..."
                        rows="3"
                        required
                      />
                    </div>
                    <button 
                      type="submit" 
                      className="btn btn-primary"
                      disabled={submitting || !newNote.trim()}
                    >
                      {submitting ? 'Saving...' : 'Add Note'}
                    </button>
                  </form>
                </div>

                {/* Previous Notes */}
                <div className="card">
                  <h4 style={{ marginTop: 0 }}>📜 Recent Visit Notes</h4>
                  {visitNotes.length === 0 ? (
                    <p style={{ color: '#666' }}>No visit notes yet</p>
                  ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                      {visitNotes.map((note, idx) => (
                        <div 
                          key={note.id || idx} 
                          style={{ 
                            padding: '1rem', 
                            background: '#f8f9fa', 
                            borderRadius: '6px',
                            borderLeft: '4px solid #007bff'
                          }}
                        >
                          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.5rem', fontSize: '0.85rem', color: '#666' }}>
                            <span><strong>{note.caregiver_name || 'Caregiver'}</strong></span>
                            <span>{new Date(note.created_at).toLocaleString()}</span>
                          </div>
                          <p style={{ margin: 0, whiteSpace: 'pre-wrap' }}>{note.note}</p>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}
          </>
        )}

        <div className="modal-actions" style={{ marginTop: '1rem' }}>
          <button className="btn btn-secondary" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
};

export default CaregiverClientModal;
