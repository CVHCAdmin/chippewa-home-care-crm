// src/components/admin/SMSManagement.jsx
import React, { useState, useEffect } from 'react';
import { API_BASE_URL } from '../../config';

const SMSManagement = ({ token }) => {
  const [messages, setMessages] = useState([]);
  const [templates, setTemplates] = useState([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('messages');
  const [filter, setFilter] = useState({ direction: '', status: '' });
  const [showSendModal, setShowSendModal] = useState(false);
  const [showTemplateModal, setShowTemplateModal] = useState(false);
  const [editingTemplate, setEditingTemplate] = useState(null);
  const [caregivers, setCaregivers] = useState([]);
  const [clients, setClients] = useState([]);

  useEffect(() => {
    loadMessages();
    loadTemplates();
    loadCaregivers();
    loadClients();
  }, [filter]);

  const loadMessages = async () => {
    try {
      const params = new URLSearchParams();
      if (filter.direction) params.append('direction', filter.direction);
      if (filter.status) params.append('status', filter.status);
      
      const res = await fetch(`${API_BASE_URL}/api/sms/messages?${params}`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      const data = await res.json();
      setMessages(Array.isArray(data) ? data : []);
    } catch (error) {
      console.error('Failed to load messages:', error);
    } finally {
      setLoading(false);
    }
  };

  const loadTemplates = async () => {
    try {
      const res = await fetch(`${API_BASE_URL}/api/sms/templates`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      const data = await res.json();
      setTemplates(Array.isArray(data) ? data : []);
    } catch (error) {
      console.error('Failed to load templates:', error);
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

  const sendMessage = async (formData) => {
    try {
      const res = await fetch(`${API_BASE_URL}/api/sms/send`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify(formData)
      });
      if (res.ok) {
        const result = await res.json();
        alert(`Message sent successfully! SID: ${result.sid}`);
        setShowSendModal(false);
        loadMessages();
      } else {
        const err = await res.json();
        alert('Failed: ' + err.error);
      }
    } catch (error) {
      alert('Failed to send: ' + error.message);
    }
  };

  const sendBulk = async (formData) => {
    try {
      const res = await fetch(`${API_BASE_URL}/api/sms/send-bulk`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify(formData)
      });
      if (res.ok) {
        const result = await res.json();
        alert(`Sent ${result.sent} messages successfully!`);
        setShowSendModal(false);
        loadMessages();
      } else {
        const err = await res.json();
        alert('Failed: ' + err.error);
      }
    } catch (error) {
      alert('Failed to send: ' + error.message);
    }
  };

  const saveTemplate = async (formData) => {
    try {
      const url = editingTemplate 
        ? `${API_BASE_URL}/api/sms/templates/${editingTemplate.id}`
        : `${API_BASE_URL}/api/sms/templates`;
      
      const res = await fetch(url, {
        method: editingTemplate ? 'PUT' : 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify(formData)
      });
      if (res.ok) {
        setShowTemplateModal(false);
        setEditingTemplate(null);
        loadTemplates();
      } else {
        const err = await res.json();
        alert('Failed: ' + err.error);
      }
    } catch (error) {
      alert('Failed to save: ' + error.message);
    }
  };

  const deleteTemplate = async (templateId) => {
    if (!confirm('Delete this template?')) return;
    try {
      const res = await fetch(`${API_BASE_URL}/api/sms/templates/${templateId}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (res.ok) {
        loadTemplates();
      }
    } catch (error) {
      alert('Failed: ' + error.message);
    }
  };

  const getStatusBadge = (status) => {
    const colors = {
      queued: '#9e9e9e',
      sending: '#2196f3',
      sent: '#4caf50',
      delivered: '#4caf50',
      failed: '#f44336',
      undelivered: '#ff9800',
      received: '#8bc34a'
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
        {status?.toUpperCase()}
      </span>
    );
  };

  const getDirectionIcon = (direction) => {
    return direction === 'outbound' ? '📤' : '📥';
  };

  const sentCount = messages.filter(m => m.direction === 'outbound').length;
  const receivedCount = messages.filter(m => m.direction === 'inbound').length;
  const failedCount = messages.filter(m => m.status === 'failed' || m.status === 'undelivered').length;

  return (
    <div>
      <div className="page-header">
        <h2>📱 SMS Management</h2>
        <button className="btn btn-primary" onClick={() => setShowSendModal(true)}>
          + Send Message
        </button>
      </div>

      {/* Summary Cards */}
      <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', marginBottom: '1rem' }}>
        <div className="stat-card" onClick={() => setFilter({ ...filter, direction: '' })} style={{ cursor: 'pointer' }}>
          <h4>Total</h4>
          <div className="value">{messages.length}</div>
        </div>
        <div className="stat-card" onClick={() => setFilter({ ...filter, direction: 'outbound' })} style={{ cursor: 'pointer' }}>
          <h4>Sent</h4>
          <div className="value" style={{ color: '#2196f3' }}>{sentCount}</div>
        </div>
        <div className="stat-card" onClick={() => setFilter({ ...filter, direction: 'inbound' })} style={{ cursor: 'pointer' }}>
          <h4>Received</h4>
          <div className="value" style={{ color: '#4caf50' }}>{receivedCount}</div>
        </div>
        <div className="stat-card" onClick={() => setFilter({ ...filter, status: 'failed' })} style={{ cursor: 'pointer' }}>
          <h4>Failed</h4>
          <div className="value" style={{ color: '#f44336' }}>{failedCount}</div>
        </div>
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1rem' }}>
        <button 
          className={`btn ${activeTab === 'messages' ? 'btn-primary' : 'btn-secondary'}`}
          onClick={() => setActiveTab('messages')}
        >
          Messages ({messages.length})
        </button>
        <button 
          className={`btn ${activeTab === 'templates' ? 'btn-primary' : 'btn-secondary'}`}
          onClick={() => setActiveTab('templates')}
        >
          Templates ({templates.length})
        </button>
        {activeTab === 'templates' && (
          <button 
            className="btn btn-primary" 
            style={{ marginLeft: 'auto' }}
            onClick={() => { setEditingTemplate(null); setShowTemplateModal(true); }}
          >
            + New Template
          </button>
        )}
      </div>

      {/* Messages Tab */}
      {activeTab === 'messages' && (
        <>
          {/* Filters */}
          <div className="card" style={{ marginBottom: '1rem' }}>
            <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap' }}>
              <div className="form-group" style={{ margin: 0 }}>
                <label>Direction</label>
                <select value={filter.direction} onChange={(e) => setFilter({ ...filter, direction: e.target.value })}>
                  <option value="">All</option>
                  <option value="outbound">Sent</option>
                  <option value="inbound">Received</option>
                </select>
              </div>
              <div className="form-group" style={{ margin: 0 }}>
                <label>Status</label>
                <select value={filter.status} onChange={(e) => setFilter({ ...filter, status: e.target.value })}>
                  <option value="">All</option>
                  <option value="sent">Sent</option>
                  <option value="delivered">Delivered</option>
                  <option value="failed">Failed</option>
                  <option value="received">Received</option>
                </select>
              </div>
            </div>
          </div>

          {/* Messages Table */}
          <div className="card">
            {loading ? (
              <div className="loading"><div className="spinner"></div></div>
            ) : messages.length === 0 ? (
              <p>No messages found.</p>
            ) : (
              <table className="table">
                <thead>
                  <tr>
                    <th style={{ width: '40px' }}></th>
                    <th>To/From</th>
                    <th>Message</th>
                    <th>Status</th>
                    <th>Date</th>
                  </tr>
                </thead>
                <tbody>
                  {messages.map(msg => (
                    <tr key={msg.id}>
                      <td style={{ fontSize: '1.3rem' }}>{getDirectionIcon(msg.direction)}</td>
                      <td>
                        <strong>{msg.direction === 'outbound' ? msg.to_number : msg.from_number}</strong>
                        {msg.recipient_name && (
                          <div style={{ fontSize: '0.8rem', color: '#666' }}>{msg.recipient_name}</div>
                        )}
                      </td>
                      <td style={{ maxWidth: '400px' }}>
                        <div style={{ 
                          overflow: 'hidden', 
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap'
                        }}>
                          {msg.body}
                        </div>
                      </td>
                      <td>{getStatusBadge(msg.status)}</td>
                      <td style={{ fontSize: '0.85rem' }}>
                        {new Date(msg.created_at).toLocaleString()}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </>
      )}

      {/* Templates Tab */}
      {activeTab === 'templates' && (
        <div className="card">
          {templates.length === 0 ? (
            <p>No templates found. Create templates to quickly send common messages.</p>
          ) : (
            <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: '1rem' }}>
              {templates.map(template => (
                <div key={template.id} style={{ 
                  border: '1px solid #ddd', 
                  borderRadius: '8px', 
                  padding: '1rem',
                  backgroundColor: '#fafafa'
                }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                    <strong>{template.name}</strong>
                    <div style={{ display: 'flex', gap: '0.25rem' }}>
                      <button 
                        className="btn btn-sm btn-secondary"
                        onClick={() => { setEditingTemplate(template); setShowTemplateModal(true); }}
                      >
                        ✏️
                      </button>
                      <button 
                        className="btn btn-sm btn-danger"
                        onClick={() => deleteTemplate(template.id)}
                      >
                        🗑️
                      </button>
                    </div>
                  </div>
                  <div style={{ 
                    marginTop: '0.5rem', 
                    padding: '0.5rem',
                    backgroundColor: '#fff',
                    borderRadius: '4px',
                    fontSize: '0.9rem',
                    color: '#333'
                  }}>
                    {template.body}
                  </div>
                  <div style={{ marginTop: '0.5rem', fontSize: '0.8rem', color: '#666' }}>
                    <strong>Category:</strong> {template.category || 'General'}
                  </div>
                  {template.variables && (
                    <div style={{ marginTop: '0.25rem', fontSize: '0.75rem', color: '#999' }}>
                      Variables: {template.variables}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Send Message Modal */}
      {showSendModal && (
        <div className="modal-overlay" onClick={() => setShowSendModal(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: '600px' }}>
            <div className="modal-header">
              <h3>Send SMS</h3>
              <button className="modal-close" onClick={() => setShowSendModal(false)}>×</button>
            </div>
            <SendMessageForm 
              templates={templates}
              caregivers={caregivers}
              clients={clients}
              onSend={sendMessage}
              onSendBulk={sendBulk}
              onCancel={() => setShowSendModal(false)}
            />
          </div>
        </div>
      )}

      {/* Template Modal */}
      {showTemplateModal && (
        <div className="modal-overlay" onClick={() => setShowTemplateModal(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3>{editingTemplate ? 'Edit Template' : 'New Template'}</h3>
              <button className="modal-close" onClick={() => setShowTemplateModal(false)}>×</button>
            </div>
            <TemplateForm 
              template={editingTemplate}
              onSubmit={saveTemplate}
              onCancel={() => setShowTemplateModal(false)}
            />
          </div>
        </div>
      )}
    </div>
  );
};

// Send Message Form Component
const SendMessageForm = ({ templates, caregivers, clients, onSend, onSendBulk, onCancel }) => {
  const [mode, setMode] = useState('single'); // single or bulk
  const [formData, setFormData] = useState({
    to: '',
    body: '',
    recipientType: 'caregiver',
    recipientIds: []
  });
  const [selectedTemplate, setSelectedTemplate] = useState('');

  const handleTemplateSelect = (templateId) => {
    setSelectedTemplate(templateId);
    const template = templates.find(t => t.id === parseInt(templateId));
    if (template) {
      setFormData({ ...formData, body: template.body });
    }
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    if (mode === 'single') {
      if (!formData.to || !formData.body) {
        alert('Phone number and message are required');
        return;
      }
      onSend({ to: formData.to, body: formData.body });
    } else {
      if (formData.recipientIds.length === 0 || !formData.body) {
        alert('Select recipients and enter a message');
        return;
      }
      onSendBulk({ 
        recipientType: formData.recipientType,
        recipientIds: formData.recipientIds,
        body: formData.body 
      });
    }
  };

  const recipients = formData.recipientType === 'caregiver' ? caregivers : clients;

  const toggleRecipient = (id) => {
    setFormData(prev => ({
      ...prev,
      recipientIds: prev.recipientIds.includes(id)
        ? prev.recipientIds.filter(r => r !== id)
        : [...prev.recipientIds, id]
    }));
  };

  const selectAll = () => {
    setFormData({ ...formData, recipientIds: recipients.map(r => r.id) });
  };

  return (
    <form onSubmit={handleSubmit}>
      {/* Mode Toggle */}
      <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1rem' }}>
        <button 
          type="button"
          className={`btn ${mode === 'single' ? 'btn-primary' : 'btn-secondary'}`}
          onClick={() => setMode('single')}
        >
          Single Message
        </button>
        <button 
          type="button"
          className={`btn ${mode === 'bulk' ? 'btn-primary' : 'btn-secondary'}`}
          onClick={() => setMode('bulk')}
        >
          Bulk Message
        </button>
      </div>

      {mode === 'single' ? (
        <div className="form-group">
          <label>Phone Number *</label>
          <input 
            type="tel"
            value={formData.to}
            onChange={(e) => setFormData({ ...formData, to: e.target.value })}
            placeholder="+1234567890"
            required
          />
        </div>
      ) : (
        <>
          <div className="form-group">
            <label>Recipient Type</label>
            <select 
              value={formData.recipientType}
              onChange={(e) => setFormData({ ...formData, recipientType: e.target.value, recipientIds: [] })}
            >
              <option value="caregiver">Caregivers</option>
              <option value="client">Clients</option>
            </select>
          </div>
          <div className="form-group">
            <label>
              Recipients ({formData.recipientIds.length} selected)
              <button type="button" className="btn btn-sm btn-secondary" style={{ marginLeft: '0.5rem' }} onClick={selectAll}>
                Select All
              </button>
            </label>
            <div style={{ 
              maxHeight: '150px', 
              overflowY: 'auto', 
              border: '1px solid #ddd', 
              borderRadius: '4px',
              padding: '0.5rem'
            }}>
              {recipients.map(r => (
                <label key={r.id} style={{ display: 'block', padding: '0.25rem', cursor: 'pointer' }}>
                  <input 
                    type="checkbox"
                    checked={formData.recipientIds.includes(r.id)}
                    onChange={() => toggleRecipient(r.id)}
                    style={{ marginRight: '0.5rem' }}
                  />
                  {r.first_name} {r.last_name} {r.phone ? `(${r.phone})` : '(no phone)'}
                </label>
              ))}
            </div>
          </div>
        </>
      )}

      <div className="form-group">
        <label>Template (Optional)</label>
        <select value={selectedTemplate} onChange={(e) => handleTemplateSelect(e.target.value)}>
          <option value="">-- Select Template --</option>
          {templates.map(t => (
            <option key={t.id} value={t.id}>{t.name}</option>
          ))}
        </select>
      </div>

      <div className="form-group">
        <label>Message *</label>
        <textarea 
          value={formData.body}
          onChange={(e) => setFormData({ ...formData, body: e.target.value })}
          placeholder="Type your message..."
          rows={4}
          required
        />
        <small style={{ color: '#666' }}>{formData.body.length} characters</small>
      </div>

      <div className="modal-actions">
        <button type="button" className="btn btn-secondary" onClick={onCancel}>Cancel</button>
        <button type="submit" className="btn btn-primary">
          {mode === 'single' ? 'Send Message' : `Send to ${formData.recipientIds.length} Recipients`}
        </button>
      </div>
    </form>
  );
};

// Template Form Component
const TemplateForm = ({ template, onSubmit, onCancel }) => {
  const [formData, setFormData] = useState({
    name: template?.name || '',
    body: template?.body || '',
    category: template?.category || 'general',
    variables: template?.variables || ''
  });

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!formData.name || !formData.body) {
      alert('Name and message body are required');
      return;
    }
    onSubmit(formData);
  };

  const insertVariable = (variable) => {
    setFormData({ ...formData, body: formData.body + `{{${variable}}}` });
  };

  return (
    <form onSubmit={handleSubmit}>
      <div className="form-group">
        <label>Template Name *</label>
        <input 
          type="text"
          value={formData.name}
          onChange={(e) => setFormData({ ...formData, name: e.target.value })}
          placeholder="e.g., Shift Reminder"
          required
        />
      </div>

      <div className="form-group">
        <label>Category</label>
        <select 
          value={formData.category}
          onChange={(e) => setFormData({ ...formData, category: e.target.value })}
        >
          <option value="general">General</option>
          <option value="scheduling">Scheduling</option>
          <option value="reminder">Reminder</option>
          <option value="emergency">Emergency</option>
          <option value="payroll">Payroll</option>
        </select>
      </div>

      <div className="form-group">
        <label>
          Message Body *
          <span style={{ marginLeft: '1rem', fontSize: '0.8rem' }}>
            Insert: 
            <button type="button" className="btn btn-sm btn-secondary" style={{ marginLeft: '0.25rem' }} onClick={() => insertVariable('first_name')}>First Name</button>
            <button type="button" className="btn btn-sm btn-secondary" style={{ marginLeft: '0.25rem' }} onClick={() => insertVariable('last_name')}>Last Name</button>
            <button type="button" className="btn btn-sm btn-secondary" style={{ marginLeft: '0.25rem' }} onClick={() => insertVariable('date')}>Date</button>
            <button type="button" className="btn btn-sm btn-secondary" style={{ marginLeft: '0.25rem' }} onClick={() => insertVariable('time')}>Time</button>
          </span>
        </label>
        <textarea 
          value={formData.body}
          onChange={(e) => setFormData({ ...formData, body: e.target.value })}
          placeholder="Hi {{first_name}}, your shift is scheduled for {{date}} at {{time}}."
          rows={4}
          required
        />
        <small style={{ color: '#666' }}>{formData.body.length} characters</small>
      </div>

      <div className="modal-actions">
        <button type="button" className="btn btn-secondary" onClick={onCancel}>Cancel</button>
        <button type="submit" className="btn btn-primary">Save Template</button>
      </div>
    </form>
  );
};

export default SMSManagement;
