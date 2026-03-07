// components/portal/FamilyPortal.jsx
// Family member portal dashboard — view client info based on permissions
import React, { useState, useEffect } from 'react';
import { apiCall } from '../../config';

const CARD = {
  background: '#fff',
  borderRadius: '10px',
  padding: '20px',
  boxShadow: '0 1px 4px rgba(0,0,0,0.08)',
  marginBottom: '16px',
};

const BADGE = (color) => ({
  display: 'inline-block',
  padding: '2px 10px',
  borderRadius: '12px',
  fontSize: '0.75rem',
  fontWeight: 600,
  background: color === 'green' ? '#d4edda' : color === 'blue' ? '#d1ecf1' : color === 'yellow' ? '#fff3cd' : '#f8d7da',
  color: color === 'green' ? '#155724' : color === 'blue' ? '#0c5460' : color === 'yellow' ? '#856404' : '#721c24',
});

// ── Schedule Tab ──────────────────────────────────────────────
const ScheduleView = ({ token }) => {
  const [visits, setVisits] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    apiCall('/api/family-portal/portal/schedule', { method: 'GET' }, token)
      .then(data => { if (data) setVisits(data); })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [token]);

  if (loading) return <div style={{ textAlign: 'center', padding: '40px', color: '#888' }}>Loading schedule...</div>;

  if (visits.length === 0) {
    return (
      <div style={{ ...CARD, textAlign: 'center', padding: '40px', color: '#888' }}>
        No upcoming visits scheduled.
      </div>
    );
  }

  return (
    <div>
      <h3 style={{ margin: '0 0 16px', fontSize: '1.1rem' }}>Upcoming Visits</h3>
      {visits.map(v => {
        const date = new Date(v.date || v.scheduled_date);
        const isToday = date.toDateString() === new Date().toDateString();
        return (
          <div key={v.id} style={{
            ...CARD,
            borderLeft: isToday ? '4px solid #27ae60' : '4px solid #3498db',
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
              <strong style={{ fontSize: '0.95rem' }}>
                {date.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}
                {isToday && <span style={{ ...BADGE('green'), marginLeft: '8px' }}>Today</span>}
              </strong>
              <span style={{ color: '#555', fontSize: '0.85rem' }}>
                {v.start_time?.slice(0, 5)} - {v.end_time?.slice(0, 5)}
              </span>
            </div>
            {(v.caregiver_first || v.caregiver_last) && (
              <div style={{ color: '#555', fontSize: '0.88rem' }}>
                Caregiver: {v.caregiver_first} {v.caregiver_last}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
};

// ── Care Plan Tab ─────────────────────────────────────────────
const CarePlanView = ({ token }) => {
  const [plan, setPlan] = useState(null);
  const [notes, setNotes] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      apiCall('/api/family-portal/portal/care-plan', { method: 'GET' }, token).catch(() => null),
      apiCall('/api/family-portal/portal/notes', { method: 'GET' }, token).catch(() => []),
    ]).then(([p, n]) => {
      if (p) setPlan(p);
      if (n) setNotes(n);
    }).finally(() => setLoading(false));
  }, [token]);

  if (loading) return <div style={{ textAlign: 'center', padding: '40px', color: '#888' }}>Loading care plan...</div>;

  return (
    <div>
      <h3 style={{ margin: '0 0 16px', fontSize: '1.1rem' }}>Care Plan</h3>
      {plan ? (
        <div style={CARD}>
          {plan.title && <div style={{ fontWeight: 700, marginBottom: '8px', fontSize: '1rem' }}>{plan.title}</div>}
          {plan.goals && (
            <div style={{ marginBottom: '12px' }}>
              <div style={{ fontWeight: 600, color: '#333', marginBottom: '4px', fontSize: '0.85rem' }}>Goals</div>
              <div style={{ color: '#555', fontSize: '0.88rem', whiteSpace: 'pre-wrap' }}>{plan.goals}</div>
            </div>
          )}
          {plan.instructions && (
            <div style={{ marginBottom: '12px' }}>
              <div style={{ fontWeight: 600, color: '#333', marginBottom: '4px', fontSize: '0.85rem' }}>Instructions</div>
              <div style={{ color: '#555', fontSize: '0.88rem', whiteSpace: 'pre-wrap' }}>{plan.instructions}</div>
            </div>
          )}
          {plan.notes && (
            <div>
              <div style={{ fontWeight: 600, color: '#333', marginBottom: '4px', fontSize: '0.85rem' }}>Notes</div>
              <div style={{ color: '#555', fontSize: '0.88rem', whiteSpace: 'pre-wrap' }}>{plan.notes}</div>
            </div>
          )}
        </div>
      ) : (
        <div style={{ ...CARD, textAlign: 'center', color: '#888' }}>No active care plan found.</div>
      )}

      {notes.length > 0 && (
        <>
          <h3 style={{ margin: '24px 0 16px', fontSize: '1.1rem' }}>Recent Visit Notes</h3>
          {notes.slice(0, 10).map(n => (
            <div key={n.id} style={CARD}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '6px' }}>
                <strong style={{ fontSize: '0.88rem' }}>
                  {n.caregiver_first} {n.caregiver_last}
                </strong>
                <span style={{ color: '#888', fontSize: '0.8rem' }}>
                  {new Date(n.start_time).toLocaleDateString()}
                  {n.duration_minutes ? ` · ${n.duration_minutes} min` : ''}
                </span>
              </div>
              {n.notes && <div style={{ color: '#555', fontSize: '0.85rem', whiteSpace: 'pre-wrap' }}>{n.notes}</div>}
            </div>
          ))}
        </>
      )}
    </div>
  );
};

// ── Medications Tab ───────────────────────────────────────────
const MedicationsView = ({ token }) => {
  const [meds, setMeds] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    apiCall('/api/family-portal/portal/medications', { method: 'GET' }, token)
      .then(data => { if (data) setMeds(data); })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [token]);

  if (loading) return <div style={{ textAlign: 'center', padding: '40px', color: '#888' }}>Loading medications...</div>;

  if (meds.length === 0) {
    return (
      <div style={{ ...CARD, textAlign: 'center', padding: '40px', color: '#888' }}>
        No active medications on file.
      </div>
    );
  }

  return (
    <div>
      <h3 style={{ margin: '0 0 16px', fontSize: '1.1rem' }}>Active Medications</h3>
      {meds.map(m => (
        <div key={m.id} style={CARD}>
          <div style={{ fontWeight: 700, fontSize: '0.95rem', marginBottom: '4px' }}>
            {m.medication_name}
          </div>
          {m.dosage && <div style={{ color: '#555', fontSize: '0.85rem' }}>Dosage: {m.dosage}</div>}
          {m.frequency && <div style={{ color: '#555', fontSize: '0.85rem' }}>Frequency: {m.frequency}</div>}
          {m.route && <div style={{ color: '#555', fontSize: '0.85rem' }}>Route: {m.route}</div>}
          {m.prescriber && <div style={{ color: '#555', fontSize: '0.85rem' }}>Prescriber: {m.prescriber}</div>}
          {m.notes && <div style={{ color: '#888', fontSize: '0.82rem', marginTop: '6px', fontStyle: 'italic' }}>{m.notes}</div>}
        </div>
      ))}
    </div>
  );
};

// ── Messages Tab ──────────────────────────────────────────────
const MessagesView = ({ token }) => {
  const [messages, setMessages] = useState([]);
  const [loading, setLoading] = useState(true);
  const [subject, setSubject] = useState('');
  const [message, setMessage] = useState('');
  const [sending, setSending] = useState(false);

  const fetchMessages = () => {
    apiCall('/api/family-portal/portal/messages', { method: 'GET' }, token)
      .then(data => { if (data) setMessages(data); })
      .catch(() => {})
      .finally(() => setLoading(false));
  };

  useEffect(() => { fetchMessages(); }, [token]);

  const handleSend = async (e) => {
    e.preventDefault();
    if (!message.trim()) return;
    setSending(true);
    try {
      await apiCall('/api/family-portal/portal/messages', {
        method: 'POST',
        body: JSON.stringify({ subject: subject.trim() || 'General Inquiry', message: message.trim() }),
      }, token);
      setSubject('');
      setMessage('');
      fetchMessages();
    } catch {
      // silent
    } finally {
      setSending(false);
    }
  };

  if (loading) return <div style={{ textAlign: 'center', padding: '40px', color: '#888' }}>Loading messages...</div>;

  return (
    <div>
      <h3 style={{ margin: '0 0 16px', fontSize: '1.1rem' }}>Send a Message</h3>
      <div style={CARD}>
        <form onSubmit={handleSend}>
          <div style={{ marginBottom: '10px' }}>
            <input
              type="text"
              placeholder="Subject (optional)"
              value={subject}
              onChange={e => setSubject(e.target.value)}
              style={{
                width: '100%', padding: '8px 12px', border: '1px solid #ddd',
                borderRadius: '6px', fontSize: '0.88rem', boxSizing: 'border-box',
              }}
            />
          </div>
          <div style={{ marginBottom: '10px' }}>
            <textarea
              placeholder="Type your message..."
              value={message}
              onChange={e => setMessage(e.target.value)}
              rows={3}
              required
              style={{
                width: '100%', padding: '8px 12px', border: '1px solid #ddd',
                borderRadius: '6px', fontSize: '0.88rem', resize: 'vertical',
                boxSizing: 'border-box',
              }}
            />
          </div>
          <button
            type="submit"
            disabled={sending || !message.trim()}
            style={{
              background: '#27ae60', color: '#fff', border: 'none',
              padding: '8px 20px', borderRadius: '6px', cursor: 'pointer',
              fontWeight: 600, fontSize: '0.85rem',
              opacity: sending || !message.trim() ? 0.6 : 1,
            }}
          >
            {sending ? 'Sending...' : 'Send Message'}
          </button>
        </form>
      </div>

      {messages.length > 0 && (
        <>
          <h3 style={{ margin: '24px 0 16px', fontSize: '1.1rem' }}>Message History</h3>
          {messages.map(m => (
            <div key={m.id} style={{
              ...CARD,
              borderLeft: m.direction === 'inbound' ? '4px solid #3498db' : '4px solid #27ae60',
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '6px' }}>
                <span style={{
                  ...BADGE(m.direction === 'inbound' ? 'blue' : 'green'),
                }}>
                  {m.direction === 'inbound' ? 'You' : 'Care Team'}
                </span>
                <span style={{ color: '#888', fontSize: '0.8rem' }}>
                  {new Date(m.created_at).toLocaleDateString('en-US', {
                    month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
                  })}
                </span>
              </div>
              {m.subject && <div style={{ fontWeight: 600, fontSize: '0.88rem', marginBottom: '4px' }}>{m.subject}</div>}
              <div style={{ color: '#555', fontSize: '0.85rem', whiteSpace: 'pre-wrap' }}>{m.message}</div>
              {m.direction === 'inbound' && m.reply && (
                <div style={{
                  marginTop: '10px', padding: '10px', background: '#f0f8f0',
                  borderRadius: '6px', borderLeft: '3px solid #27ae60',
                }}>
                  <div style={{ fontSize: '0.75rem', fontWeight: 600, color: '#27ae60', marginBottom: '4px' }}>Reply from Care Team</div>
                  <div style={{ color: '#555', fontSize: '0.85rem', whiteSpace: 'pre-wrap' }}>{m.reply}</div>
                </div>
              )}
            </div>
          ))}
        </>
      )}
    </div>
  );
};

// ── Main Family Portal ────────────────────────────────────────
const FamilyPortal = ({ user, token, onLogout, permissions }) => {
  const [activeTab, setActiveTab] = useState('overview');
  const [client, setClient] = useState(null);

  useEffect(() => {
    apiCall('/api/family-portal/portal/client', { method: 'GET' }, token)
      .then(data => { if (data) setClient(data); })
      .catch(() => {});
  }, [token]);

  const tabs = [
    { key: 'overview', label: 'Overview', icon: '🏠' },
  ];
  if (permissions.can_view_schedule)  tabs.push({ key: 'schedule',    label: 'Schedule',    icon: '📅' });
  if (permissions.can_view_care_plan) tabs.push({ key: 'care-plan',   label: 'Care Plan',   icon: '📋' });
  if (permissions.can_view_medications) tabs.push({ key: 'medications', label: 'Medications', icon: '💊' });
  if (permissions.can_message)        tabs.push({ key: 'messages',    label: 'Messages',    icon: '💬' });

  const userName = user?.first_name
    ? `${user.first_name} ${user.last_name}`
    : 'Family Member';

  const renderView = () => {
    switch (activeTab) {
      case 'schedule':    return <ScheduleView token={token} />;
      case 'care-plan':   return <CarePlanView token={token} />;
      case 'medications': return <MedicationsView token={token} />;
      case 'messages':    return <MessagesView token={token} />;
      default:            return <OverviewView client={client} userName={userName} permissions={permissions} setActiveTab={setActiveTab} />;
    }
  };

  return (
    <div style={{ minHeight: '100vh', background: '#f5f7fa' }}>
      {/* Header */}
      <div style={{
        background: 'linear-gradient(135deg, #2d5016 0%, #4a8c1c 100%)',
        color: '#fff',
        padding: '0 20px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        height: '60px',
        boxShadow: '0 2px 8px rgba(0,0,0,0.15)',
        position: 'sticky',
        top: 0,
        zIndex: 100,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <span style={{ fontSize: '1.4rem' }}>🏠</span>
          <div>
            <div style={{ fontWeight: 700, fontSize: '0.95rem', lineHeight: 1.2 }}>
              Chippewa Valley Home Care
            </div>
            <div style={{ fontSize: '0.75rem', opacity: 0.85 }}>Family Portal</div>
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
          <span style={{ fontSize: '0.85rem', opacity: 0.9 }}>{userName}</span>
          <button
            onClick={onLogout}
            style={{
              background: 'rgba(255,255,255,0.15)',
              border: '1px solid rgba(255,255,255,0.3)',
              color: '#fff',
              padding: '5px 12px',
              borderRadius: '6px',
              cursor: 'pointer',
              fontSize: '0.8rem',
            }}
          >
            Sign Out
          </button>
        </div>
      </div>

      {/* Nav Tabs */}
      <div style={{
        background: '#fff',
        borderBottom: '1px solid #e8ecf0',
        display: 'flex',
        padding: '0 20px',
        gap: '4px',
        overflowX: 'auto',
      }}>
        {tabs.map(tab => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            style={{
              background: 'none',
              border: 'none',
              padding: '14px 18px',
              cursor: 'pointer',
              fontSize: '0.88rem',
              fontWeight: activeTab === tab.key ? 600 : 400,
              color: activeTab === tab.key ? '#2d5016' : '#555',
              borderBottom: activeTab === tab.key ? '3px solid #2d5016' : '3px solid transparent',
              whiteSpace: 'nowrap',
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
            }}
          >
            <span>{tab.icon}</span>
            {tab.label}
          </button>
        ))}
      </div>

      {/* Content */}
      <div style={{ maxWidth: '900px', margin: '0 auto', padding: '24px 16px' }}>
        {renderView()}
      </div>
    </div>
  );
};

// ── Overview / Home Tab ───────────────────────────────────────
const OverviewView = ({ client, userName, permissions, setActiveTab }) => {
  const quickLinks = [];
  if (permissions.can_view_schedule)    quickLinks.push({ key: 'schedule',    label: 'View Schedule',    icon: '📅', color: '#3498db' });
  if (permissions.can_view_care_plan)   quickLinks.push({ key: 'care-plan',   label: 'View Care Plan',   icon: '📋', color: '#e67e22' });
  if (permissions.can_view_medications) quickLinks.push({ key: 'medications', label: 'View Medications', icon: '💊', color: '#9b59b6' });
  if (permissions.can_message)          quickLinks.push({ key: 'messages',    label: 'Send Message',     icon: '💬', color: '#27ae60' });

  return (
    <div>
      {/* Welcome */}
      <div style={{ ...CARD, background: 'linear-gradient(135deg, #d5f5e3 0%, #e8f8f5 100%)' }}>
        <h2 style={{ margin: '0 0 8px', fontSize: '1.2rem', color: '#2d5016' }}>
          Welcome, {userName}
        </h2>
        {client && (
          <p style={{ margin: 0, color: '#555', fontSize: '0.9rem' }}>
            Viewing care information for <strong>{client.first_name} {client.last_name}</strong>
          </p>
        )}
      </div>

      {/* Client Info */}
      {client && (
        <div style={CARD}>
          <h3 style={{ margin: '0 0 12px', fontSize: '1rem' }}>Client Information</h3>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px', fontSize: '0.88rem' }}>
            <div><span style={{ color: '#888' }}>Name:</span> {client.first_name} {client.last_name}</div>
            {client.date_of_birth && (
              <div><span style={{ color: '#888' }}>DOB:</span> {new Date(client.date_of_birth).toLocaleDateString()}</div>
            )}
            {client.phone && <div><span style={{ color: '#888' }}>Phone:</span> {client.phone}</div>}
            {client.address && (
              <div style={{ gridColumn: '1 / -1' }}>
                <span style={{ color: '#888' }}>Address:</span> {client.address}
                {client.city && `, ${client.city}`}
                {client.state && `, ${client.state}`}
                {client.zip && ` ${client.zip}`}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Quick Links */}
      {quickLinks.length > 0 && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: '12px' }}>
          {quickLinks.map(link => (
            <button
              key={link.key}
              onClick={() => setActiveTab(link.key)}
              style={{
                ...CARD,
                border: 'none',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: '12px',
                textAlign: 'left',
                transition: 'box-shadow 0.15s',
                marginBottom: 0,
              }}
              onMouseEnter={e => e.currentTarget.style.boxShadow = '0 2px 12px rgba(0,0,0,0.12)'}
              onMouseLeave={e => e.currentTarget.style.boxShadow = '0 1px 4px rgba(0,0,0,0.08)'}
            >
              <span style={{
                fontSize: '1.5rem',
                width: '44px', height: '44px',
                background: link.color + '18',
                borderRadius: '10px',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                flexShrink: 0,
              }}>
                {link.icon}
              </span>
              <span style={{ fontWeight: 600, fontSize: '0.9rem', color: '#333' }}>{link.label}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
};

export default FamilyPortal;
