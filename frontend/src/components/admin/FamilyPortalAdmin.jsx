import { toast } from '../Toast';
// src/components/admin/FamilyPortalAdmin.jsx
import React, { useState, useEffect } from 'react';
import { API_BASE_URL } from '../../config';

const FamilyPortalAdmin = ({ token }) => {
  const [familyMembers, setFamilyMembers] = useState([]);
  const [messages, setMessages] = useState([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('members');
  const [filter, setFilter] = useState({ status: '', clientId: '' });
  const [showAddModal, setShowAddModal] = useState(false);
  const [showMessageModal, setShowMessageModal] = useState(false);
  const [selectedMember, setSelectedMember] = useState(null);
  const [clients, setClients] = useState([]);

  useEffect(() => {
    loadFamilyMembers();
    loadClients();
  }, [filter]);

  useEffect(() => {
    if (activeTab === 'messages') {
      loadMessages();
    }
  }, [activeTab]);

  const loadFamilyMembers = async () => {
    try {
      const params = new URLSearchParams();
      if (filter.status) params.append('status', filter.status);
      if (filter.clientId) params.append('clientId', filter.clientId);
      
      const res = await fetch(`${API_BASE_URL}/api/family-portal/admin/members?${params}`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      const data = await res.json();
      setFamilyMembers(Array.isArray(data) ? data : []);
    } catch (error) {
      console.error('Failed to load family members:', error);
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

  const loadMessages = async () => {
    try {
      const res = await fetch(`${API_BASE_URL}/api/family-portal/admin/messages`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      const data = await res.json();
      setMessages(Array.isArray(data) ? data : []);
    } catch (error) {
      console.error('Failed to load messages:', error);
    }
  };

  const createFamilyMember = async (formData) => {
    try {
      const res = await fetch(`${API_BASE_URL}/api/family-portal/admin/members`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify(formData)
      });
      if (res.ok) {
        setShowAddModal(false);
        loadFamilyMembers();
      } else {
        const err = await res.json();
        toast('Failed: ' + err.error, 'error');
      }
    } catch (error) {
      toast('Failed: ' + error.message, 'error');
    }
  };

  const updateMemberStatus = async (memberId, isActive) => {
    try {
      const res = await fetch(`${API_BASE_URL}/api/family-portal/admin/members/${memberId}/status`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ isActive })
      });
      if (res.ok) {
        loadFamilyMembers();
      }
    } catch (error) {
      toast('Failed: ' + error.message, 'error');
    }
  };

  const resetPassword = async (memberId) => {
    const newPassword = prompt('Enter new password (min 8 characters):');
    if (!newPassword || newPassword.length < 8) {
      toast('Password must be at least 8 characters');
      return;
    }
    try {
      const res = await fetch(`${API_BASE_URL}/api/family-portal/admin/members/${memberId}/reset-password`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ password: newPassword })
      });
      if (res.ok) {
        toast('Password reset successfully');
      } else {
        const err = await res.json();
        toast('Failed: ' + err.error, 'error');
      }
    } catch (error) {
      toast('Failed: ' + error.message, 'error');
    }
  };

  const replyToMessage = async (messageId, reply) => {
    try {
      const res = await fetch(`${API_BASE_URL}/api/family-portal/admin/messages/${messageId}/reply`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ reply })
      });
      if (res.ok) {
        setShowMessageModal(false);
        loadMessages();
      } else {
        const err = await res.json();
        toast('Failed: ' + err.error, 'error');
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
      {isActive ? 'ACTIVE' : 'INACTIVE'}
    </span>
  );

  const getRelationshipBadge = (relationship) => {
    const colors = {
      spouse: '#e91e63',
      child: '#2196f3',
      parent: '#9c27b0',
      sibling: '#00bcd4',
      guardian: '#ff9800',
      other: '#9e9e9e'
    };
    return (
      <span style={{
        padding: '2px 6px',
        borderRadius: '4px',
        fontSize: '0.7rem',
        fontWeight: 'bold',
        color: 'white',
        backgroundColor: colors[relationship] || '#9e9e9e'
      }}>
        {relationship?.toUpperCase()}
      </span>
    );
  };

  const activeCount = familyMembers.filter(m => m.is_active).length;
  const unreadMessages = messages.filter(m => !m.is_read).length;

  return (
    <div>
      <div className="page-header">
        <h2>👨‍👩‍👧 Family Portal Management</h2>
        <button className="btn btn-primary" onClick={() => setShowAddModal(true)}>
          + Add Family Member
        </button>
      </div>

      {/* Summary Cards */}
      <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', marginBottom: '1rem' }}>
        <div className="stat-card">
          <h4>Total Members</h4>
          <div className="value">{familyMembers.length}</div>
        </div>
        <div className="stat-card">
          <h4>Active</h4>
          <div className="value" style={{ color: '#4caf50' }}>{activeCount}</div>
        </div>
        <div className="stat-card" onClick={() => setActiveTab('messages')} style={{ cursor: 'pointer' }}>
          <h4>Unread Messages</h4>
          <div className="value" style={{ color: unreadMessages > 0 ? '#f44336' : '#333' }}>
            {unreadMessages}
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1rem' }}>
        <button 
          className={`btn ${activeTab === 'members' ? 'btn-primary' : 'btn-secondary'}`}
          onClick={() => setActiveTab('members')}
        >
          Family Members ({familyMembers.length})
        </button>
        <button 
          className={`btn ${activeTab === 'messages' ? 'btn-primary' : 'btn-secondary'}`}
          onClick={() => setActiveTab('messages')}
        >
          Messages {unreadMessages > 0 && `(${unreadMessages} new)`}
        </button>
      </div>

      {/* Members Tab */}
      {activeTab === 'members' && (
        <>
          {/* Filters */}
          <div className="card" style={{ marginBottom: '1rem' }}>
            <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap' }}>
              <div className="form-group" style={{ margin: 0 }}>
                <label>Status</label>
                <select value={filter.status} onChange={(e) => setFilter({ ...filter, status: e.target.value })}>
                  <option value="">All</option>
                  <option value="active">Active</option>
                  <option value="inactive">Inactive</option>
                </select>
              </div>
              <div className="form-group" style={{ margin: 0 }}>
                <label>Client</label>
                <select value={filter.clientId} onChange={(e) => setFilter({ ...filter, clientId: e.target.value })}>
                  <option value="">All Clients</option>
                  {clients.map(c => (
                    <option key={c.id} value={c.id}>{c.first_name} {c.last_name}</option>
                  ))}
                </select>
              </div>
            </div>
          </div>

          {/* Members Table */}
          <div className="card">
            {loading ? (
              <div className="loading"><div className="spinner"></div></div>
            ) : familyMembers.length === 0 ? (
              <p>No family members found. Add family members to give them portal access.</p>
            ) : (
              <table className="table">
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Email</th>
                    <th>Phone</th>
                    <th>Client</th>
                    <th>Relationship</th>
                    <th>Status</th>
                    <th>Last Login</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {familyMembers.map(member => (
                    <tr key={member.id}>
                      <td><strong>{member.first_name} {member.last_name}</strong></td>
                      <td>{member.email}</td>
                      <td>{member.phone || '-'}</td>
                      <td>{member.client_first_name} {member.client_last_name}</td>
                      <td>{getRelationshipBadge(member.relationship)}</td>
                      <td>{getStatusBadge(member.is_active)}</td>
                      <td style={{ fontSize: '0.85rem' }}>
                        {member.last_login ? new Date(member.last_login).toLocaleString() : 'Never'}
                      </td>
                      <td>
                        <div style={{ display: 'flex', gap: '0.25rem', flexWrap: 'wrap' }}>
                          <button 
                            className="btn btn-sm btn-secondary"
                            onClick={() => resetPassword(member.id)}
                            title="Reset Password"
                          >
                            🔑
                          </button>
                          {member.is_active ? (
                            <button 
                              className="btn btn-sm btn-danger"
                              onClick={() => updateMemberStatus(member.id, false)}
                              title="Deactivate"
                            >
                              ✗
                            </button>
                          ) : (
                            <button 
                              className="btn btn-sm btn-success"
                              onClick={() => updateMemberStatus(member.id, true)}
                              title="Activate"
                            >
                              ✓
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </>
      )}

      {/* Messages Tab */}
      {activeTab === 'messages' && (
        <div className="card">
          {messages.length === 0 ? (
            <p>No messages from family members.</p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              {messages.map(msg => (
                <div 
                  key={msg.id} 
                  style={{ 
                    border: '1px solid #ddd', 
                    borderRadius: '8px', 
                    padding: '1rem',
                    backgroundColor: msg.is_read ? '#fff' : '#fff3e0'
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                    <div>
                      <strong>{msg.sender_first_name} {msg.sender_last_name}</strong>
                      <span style={{ marginLeft: '0.5rem', color: '#666', fontSize: '0.85rem' }}>
                        (Family of {msg.client_first_name} {msg.client_last_name})
                      </span>
                    </div>
                    <span style={{ fontSize: '0.85rem', color: '#666' }}>
                      {new Date(msg.created_at).toLocaleString()}
                    </span>
                  </div>
                  
                  {msg.subject && (
                    <div style={{ fontWeight: 'bold', marginTop: '0.5rem' }}>
                      {msg.subject}
                    </div>
                  )}
                  
                  <div style={{ 
                    marginTop: '0.5rem', 
                    padding: '0.75rem',
                    backgroundColor: '#f5f5f5',
                    borderRadius: '4px'
                  }}>
                    {msg.message}
                  </div>

                  {msg.reply && (
                    <div style={{ 
                      marginTop: '0.5rem', 
                      marginLeft: '1rem',
                      padding: '0.75rem',
                      backgroundColor: '#e3f2fd',
                      borderRadius: '4px',
                      borderLeft: '3px solid #2196f3'
                    }}>
                      <strong>Your Reply:</strong> {msg.reply}
                    </div>
                  )}

                  {!msg.reply && (
                    <button 
                      className="btn btn-sm btn-primary"
                      style={{ marginTop: '0.5rem' }}
                      onClick={() => { setSelectedMember(msg); setShowMessageModal(true); }}
                    >
                      Reply
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Add Family Member Modal */}
      {showAddModal && (
        <div className="modal-overlay" onClick={() => setShowAddModal(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3>Add Family Member</h3>
              <button className="modal-close" onClick={() => setShowAddModal(false)}>×</button>
            </div>
            <AddMemberForm 
              clients={clients}
              onSubmit={createFamilyMember}
              onCancel={() => setShowAddModal(false)}
            />
          </div>
        </div>
      )}

      {/* Reply Modal */}
      {showMessageModal && selectedMember && (
        <div className="modal-overlay" onClick={() => setShowMessageModal(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3>Reply to Message</h3>
              <button className="modal-close" onClick={() => setShowMessageModal(false)}>×</button>
            </div>
            <ReplyForm 
              message={selectedMember}
              onSubmit={(reply) => replyToMessage(selectedMember.id, reply)}
              onCancel={() => setShowMessageModal(false)}
            />
          </div>
        </div>
      )}
    </div>
  );
};

// Add Member Form Component
const AddMemberForm = ({ clients, onSubmit, onCancel }) => {
  const [formData, setFormData] = useState({
    clientId: '',
    firstName: '',
    lastName: '',
    email: '',
    phone: '',
    relationship: 'child',
    password: '',
    canViewSchedule: true,
    canViewCarePlan: true,
    canViewMedications: false,
    canMessage: true
  });

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!formData.clientId || !formData.firstName || !formData.email || !formData.password) {
      toast('Client, name, email and password are required');
      return;
    }
    if (formData.password.length < 8) {
      toast('Password must be at least 8 characters');
      return;
    }
    onSubmit(formData);
  };

  return (
    <form onSubmit={handleSubmit}>
      <div className="form-group">
        <label>Client *</label>
        <select 
          value={formData.clientId}
          onChange={(e) => setFormData({ ...formData, clientId: e.target.value })}
          required
        >
          <option value="">Select Client</option>
          {clients.filter(c => c.status === 'active').map(c => (
            <option key={c.id} value={c.id}>{c.first_name} {c.last_name}</option>
          ))}
        </select>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
        <div className="form-group">
          <label>First Name *</label>
          <input 
            type="text"
            value={formData.firstName}
            onChange={(e) => setFormData({ ...formData, firstName: e.target.value })}
            required
          />
        </div>
        <div className="form-group">
          <label>Last Name *</label>
          <input 
            type="text"
            value={formData.lastName}
            onChange={(e) => setFormData({ ...formData, lastName: e.target.value })}
            required
          />
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
        <div className="form-group">
          <label>Email *</label>
          <input 
            type="email"
            value={formData.email}
            onChange={(e) => setFormData({ ...formData, email: e.target.value })}
            required
          />
        </div>
        <div className="form-group">
          <label>Phone</label>
          <input 
            type="tel"
            value={formData.phone}
            onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
          />
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
        <div className="form-group">
          <label>Relationship *</label>
          <select 
            value={formData.relationship}
            onChange={(e) => setFormData({ ...formData, relationship: e.target.value })}
          >
            <option value="spouse">Spouse</option>
            <option value="child">Child</option>
            <option value="parent">Parent</option>
            <option value="sibling">Sibling</option>
            <option value="guardian">Guardian</option>
            <option value="other">Other</option>
          </select>
        </div>
        <div className="form-group">
          <label>Password *</label>
          <input 
            type="password"
            value={formData.password}
            onChange={(e) => setFormData({ ...formData, password: e.target.value })}
            placeholder="Min 8 characters"
            required
          />
        </div>
      </div>

      <div className="form-group">
        <label>Portal Permissions</label>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '1rem' }}>
          <label>
            <input 
              type="checkbox"
              checked={formData.canViewSchedule}
              onChange={(e) => setFormData({ ...formData, canViewSchedule: e.target.checked })}
              style={{ marginRight: '0.5rem' }}
            />
            View Schedule
          </label>
          <label>
            <input 
              type="checkbox"
              checked={formData.canViewCarePlan}
              onChange={(e) => setFormData({ ...formData, canViewCarePlan: e.target.checked })}
              style={{ marginRight: '0.5rem' }}
            />
            View Care Plan
          </label>
          <label>
            <input 
              type="checkbox"
              checked={formData.canViewMedications}
              onChange={(e) => setFormData({ ...formData, canViewMedications: e.target.checked })}
              style={{ marginRight: '0.5rem' }}
            />
            View Medications
          </label>
          <label>
            <input 
              type="checkbox"
              checked={formData.canMessage}
              onChange={(e) => setFormData({ ...formData, canMessage: e.target.checked })}
              style={{ marginRight: '0.5rem' }}
            />
            Send Messages
          </label>
        </div>
      </div>

      <div className="modal-actions">
        <button type="button" className="btn btn-secondary" onClick={onCancel}>Cancel</button>
        <button type="submit" className="btn btn-primary">Create Account</button>
      </div>
    </form>
  );
};

// Reply Form Component
const ReplyForm = ({ message, onSubmit, onCancel }) => {
  const [reply, setReply] = useState('');

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!reply.trim()) {
      toast('Please enter a reply');
      return;
    }
    onSubmit(reply);
  };

  return (
    <form onSubmit={handleSubmit}>
      <div style={{ marginBottom: '1rem', padding: '0.75rem', backgroundColor: '#f5f5f5', borderRadius: '4px' }}>
        <strong>Original Message from {message.sender_first_name}:</strong>
        <p style={{ margin: '0.5rem 0 0 0' }}>{message.message}</p>
      </div>

      <div className="form-group">
        <label>Your Reply *</label>
        <textarea 
          value={reply}
          onChange={(e) => setReply(e.target.value)}
          placeholder="Type your reply..."
          rows={4}
          required
        />
      </div>

      <div className="modal-actions">
        <button type="button" className="btn btn-secondary" onClick={onCancel}>Cancel</button>
        <button type="submit" className="btn btn-primary">Send Reply</button>
      </div>
    </form>
  );
};

export default FamilyPortalAdmin;
