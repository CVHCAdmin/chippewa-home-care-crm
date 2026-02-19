// src/components/admin/MessageBoard.jsx
// Company message board — send individual, group, or broadcast messages
import React, { useState, useEffect, useRef, useCallback } from 'react';
import { API_BASE_URL } from '../../config';
import { toast } from '../Toast';

const MessageBoard = ({ token }) => {
  const [view, setView] = useState('inbox'); // inbox | thread | compose
  const [threads, setThreads] = useState([]);
  const [activeThread, setActiveThread] = useState(null);
  const [messages, setMessages] = useState([]);
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [replyBody, setReplyBody] = useState('');
  const [compose, setCompose] = useState({ subject: '', body: '', recipientIds: [] });
  const [broadcastMode, setBroadcastMode] = useState(false);
  const [userSearch, setUserSearch] = useState('');
  const messagesEndRef = useRef(null);
  const pollRef = useRef(null);

  const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` };

  const loadInbox = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE_URL}/api/messages/inbox`, { headers });
      if (res.ok) setThreads(await res.json());
    } catch (e) { /* silent */ }
    finally { setLoading(false); }
  }, [token]);

  const loadUsers = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE_URL}/api/messages/users`, { headers });
      if (res.ok) setUsers(await res.json());
    } catch (e) { /* silent */ }
  }, [token]);

  useEffect(() => {
    loadInbox();
    loadUsers();
    pollRef.current = setInterval(loadInbox, 15000);
    return () => clearInterval(pollRef.current);
  }, [loadInbox, loadUsers]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const openThread = async (thread) => {
    setActiveThread(thread);
    setView('thread');
    try {
      const res = await fetch(`${API_BASE_URL}/api/messages/thread/${thread.id}`, { headers });
      if (res.ok) {
        const data = await res.json();
        setMessages(data.messages);
        setThreads(prev => prev.map(t => t.id === thread.id ? { ...t, unread_count: 0 } : t));
      }
    } catch (e) { toast('Could not load messages', 'error'); }
  };

  const sendReply = async () => {
    if (!replyBody.trim()) return;
    setSending(true);
    try {
      const res = await fetch(`${API_BASE_URL}/api/messages/thread/${activeThread.id}/reply`, {
        method: 'POST', headers, body: JSON.stringify({ body: replyBody })
      });
      if (res.ok) {
        const msg = await res.json();
        setMessages(prev => [...prev, msg]);
        setReplyBody('');
      } else toast('Failed to send', 'error');
    } catch (e) { toast('Failed to send', 'error'); }
    finally { setSending(false); }
  };

  const sendNew = async () => {
    if (!compose.body.trim()) return toast('Message body is required', 'error');
    const recipients = broadcastMode ? 'all' : compose.recipientIds;
    if (!broadcastMode && recipients.length === 0) return toast('Select at least one recipient', 'error');
    setSending(true);
    try {
      const res = await fetch(`${API_BASE_URL}/api/messages/send`, {
        method: 'POST', headers,
        body: JSON.stringify({ subject: compose.subject || 'New Message', body: compose.body, recipientIds: recipients })
      });
      if (res.ok) {
        const data = await res.json();
        toast(`Sent to ${data.recipientCount} recipient${data.recipientCount !== 1 ? 's' : ''}`, 'success');
        setCompose({ subject: '', body: '', recipientIds: [] });
        setBroadcastMode(false);
        await loadInbox();
        setView('inbox');
      } else toast('Failed to send message', 'error');
    } catch (e) { toast('Failed to send message', 'error'); }
    finally { setSending(false); }
  };

  const toggleRecipient = (userId) => {
    setCompose(prev => ({
      ...prev,
      recipientIds: prev.recipientIds.includes(userId)
        ? prev.recipientIds.filter(id => id !== userId)
        : [...prev.recipientIds, userId]
    }));
  };

  const formatTime = (ts) => {
    if (!ts) return '';
    const d = new Date(ts);
    const now = new Date();
    const diff = now - d;
    if (diff < 60000) return 'just now';
    if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
    if (diff < 86400000) return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
  };

  const totalUnread = threads.reduce((sum, t) => sum + (parseInt(t.unread_count) || 0), 0);
  const filteredUsers = users.filter(u =>
    !userSearch || `${u.first_name} ${u.last_name}`.toLowerCase().includes(userSearch.toLowerCase()) || u.role.includes(userSearch.toLowerCase())
  );

  const roleColor = (role) => role === 'admin' ? '#7C3AED' : '#2ABBA7';
  const roleLabel = (role) => role === 'admin' ? 'Admin' : 'Caregiver';

  // ─── INBOX ────────────────────────────────────────────────────────────────
  if (view === 'inbox') return (
    <div style={{ maxWidth: '800px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.25rem' }}>
        <div>
          <h2 style={{ margin: 0, fontSize: '1.3rem', fontWeight: '800' }}>
            💬 Messages {totalUnread > 0 && <span style={{ background: '#EF4444', color: '#fff', borderRadius: '99px', fontSize: '0.7rem', padding: '2px 8px', marginLeft: '0.4rem', verticalAlign: 'middle' }}>{totalUnread}</span>}
          </h2>
          <p style={{ margin: '0.1rem 0 0', fontSize: '0.82rem', color: '#6B7280' }}>Company message board</p>
        </div>
        <button onClick={() => setView('compose')}
          style={{ padding: '0.6rem 1.25rem', background: '#2ABBA7', color: '#fff', border: 'none', borderRadius: '10px', cursor: 'pointer', fontWeight: '700', fontSize: '0.9rem' }}>
          ✏️ New Message
        </button>
      </div>

      {loading ? (
        <div style={{ textAlign: 'center', padding: '3rem', color: '#9CA3AF' }}>Loading...</div>
      ) : threads.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '4rem 2rem', color: '#9CA3AF' }}>
          <div style={{ fontSize: '3rem', marginBottom: '0.75rem' }}>💬</div>
          <p style={{ fontWeight: '700', margin: '0 0 0.5rem', color: '#374151' }}>No messages yet</p>
          <p style={{ margin: 0, fontSize: '0.875rem' }}>Click "New Message" to send one to the team.</p>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
          {threads.map(thread => {
            const unread = parseInt(thread.unread_count) || 0;
            const others = thread.other_participants || [];
            const label = thread.is_broadcast ? '📢 All Staff'
              : others.length === 0 ? 'Just you'
              : others.length === 1 ? `${others[0].first_name} ${others[0].last_name}`
              : `${others[0].first_name} +${others.length - 1} others`;

            return (
              <div key={thread.id} onClick={() => openThread(thread)}
                style={{ padding: '1rem 1.25rem', background: unread > 0 ? '#F0FDFB' : '#fff', border: `1px solid ${unread > 0 ? '#A7F3D0' : '#E5E7EB'}`, borderRadius: '12px', cursor: 'pointer', transition: 'all 0.15s', display: 'flex', gap: '1rem', alignItems: 'center' }}>
                <div style={{ width: '42px', height: '42px', borderRadius: '50%', background: unread > 0 ? '#2ABBA7' : '#E5E7EB', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '1.1rem', flexShrink: 0 }}>
                  {thread.is_broadcast ? '📢' : '💬'}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.2rem' }}>
                    <span style={{ fontWeight: unread > 0 ? '800' : '600', fontSize: '0.9rem', color: '#111827' }}>{label}</span>
                    <span style={{ fontSize: '0.75rem', color: '#9CA3AF', flexShrink: 0, marginLeft: '0.5rem' }}>{formatTime(thread.last_message_at)}</span>
                  </div>
                  <div style={{ fontSize: '0.82rem', color: '#374151', fontWeight: unread > 0 ? '600' : '400' }}>{thread.subject}</div>
                  <div style={{ fontSize: '0.8rem', color: '#6B7280', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{thread.last_message || 'No messages yet'}</div>
                </div>
                {unread > 0 && (
                  <div style={{ background: '#EF4444', color: '#fff', borderRadius: '99px', fontSize: '0.7rem', fontWeight: '700', padding: '2px 8px', flexShrink: 0 }}>{unread}</div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );

  // ─── THREAD VIEW ──────────────────────────────────────────────────────────
  if (view === 'thread') return (
    <div style={{ maxWidth: '800px', display: 'flex', flexDirection: 'column', height: 'calc(100vh - 200px)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.875rem', marginBottom: '1rem' }}>
        <button onClick={() => { setView('inbox'); loadInbox(); }}
          style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#2ABBA7', fontWeight: '700', fontSize: '1rem', padding: 0 }}>← Inbox</button>
        <div style={{ flex: 1 }}>
          <h3 style={{ margin: 0, fontSize: '1rem', fontWeight: '800' }}>{activeThread?.subject}</h3>
          <p style={{ margin: 0, fontSize: '0.78rem', color: '#6B7280' }}>
            {activeThread?.is_broadcast ? 'Sent to all staff' : `${(activeThread?.other_participants || []).map(p => `${p.first_name} ${p.last_name}`).join(', ')}`}
          </p>
        </div>
      </div>

      {/* Messages */}
      <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '0.75rem', padding: '0.5rem 0', marginBottom: '1rem' }}>
        {messages.map(msg => {
          const isMe = msg.sender_id === (token && JSON.parse(atob(token.split('.')[1])).id);
          return (
            <div key={msg.id} style={{ display: 'flex', flexDirection: 'column', alignItems: isMe ? 'flex-end' : 'flex-start' }}>
              <div style={{ fontSize: '0.75rem', color: '#9CA3AF', marginBottom: '0.2rem', paddingLeft: isMe ? 0 : '0.5rem', paddingRight: isMe ? '0.5rem' : 0 }}>
                {isMe ? 'You' : `${msg.first_name} ${msg.last_name}`} · {formatTime(msg.created_at)}
              </div>
              <div style={{ maxWidth: '75%', padding: '0.75rem 1rem', borderRadius: isMe ? '18px 18px 4px 18px' : '18px 18px 18px 4px', background: isMe ? '#2ABBA7' : '#F3F4F6', color: isMe ? '#fff' : '#111827', fontSize: '0.9rem', lineHeight: 1.6 }}>
                {msg.body}
              </div>
            </div>
          );
        })}
        <div ref={messagesEndRef} />
      </div>

      {/* Reply */}
      <div style={{ display: 'flex', gap: '0.5rem', borderTop: '1px solid #E5E7EB', paddingTop: '1rem' }}>
        <textarea
          value={replyBody}
          onChange={e => setReplyBody(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendReply(); } }}
          placeholder="Type a reply... (Enter to send, Shift+Enter for new line)"
          rows={2}
          style={{ flex: 1, padding: '0.75rem', border: '1px solid #D1D5DB', borderRadius: '10px', resize: 'none', fontSize: '0.9rem', outline: 'none', fontFamily: 'inherit' }}
        />
        <button onClick={sendReply} disabled={sending || !replyBody.trim()}
          style={{ padding: '0.75rem 1.25rem', background: replyBody.trim() ? '#2ABBA7' : '#D1D5DB', color: '#fff', border: 'none', borderRadius: '10px', cursor: replyBody.trim() ? 'pointer' : 'default', fontWeight: '700', alignSelf: 'flex-end' }}>
          {sending ? '...' : '→'}
        </button>
      </div>
    </div>
  );

  // ─── COMPOSE ──────────────────────────────────────────────────────────────
  return (
    <div style={{ maxWidth: '700px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.875rem', marginBottom: '1.5rem' }}>
        <button onClick={() => setView('inbox')}
          style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#2ABBA7', fontWeight: '700', fontSize: '1rem', padding: 0 }}>← Inbox</button>
        <h2 style={{ margin: 0, fontSize: '1.2rem', fontWeight: '800' }}>✏️ New Message</h2>
      </div>

      {/* Broadcast toggle */}
      <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1.25rem' }}>
        <button onClick={() => setBroadcastMode(false)}
          style={{ padding: '0.5rem 1rem', borderRadius: '8px', border: `2px solid ${!broadcastMode ? '#2ABBA7' : '#E5E7EB'}`, background: !broadcastMode ? '#F0FDFB' : '#fff', color: !broadcastMode ? '#2ABBA7' : '#374151', fontWeight: '700', cursor: 'pointer', fontSize: '0.85rem' }}>
          👤 Individual / Group
        </button>
        <button onClick={() => setBroadcastMode(true)}
          style={{ padding: '0.5rem 1rem', borderRadius: '8px', border: `2px solid ${broadcastMode ? '#2ABBA7' : '#E5E7EB'}`, background: broadcastMode ? '#F0FDFB' : '#fff', color: broadcastMode ? '#2ABBA7' : '#374151', fontWeight: '700', cursor: 'pointer', fontSize: '0.85rem' }}>
          📢 Send to Everyone
        </button>
      </div>

      {broadcastMode && (
        <div style={{ background: '#FEF3C7', border: '1px solid #FCD34D', borderRadius: '10px', padding: '0.875rem 1rem', marginBottom: '1.25rem' }}>
          <p style={{ margin: 0, fontSize: '0.875rem', color: '#92400E', fontWeight: '600' }}>📢 Broadcast to all {users.length} active staff members. Everyone will receive this message and a push notification.</p>
        </div>
      )}

      {/* Recipient picker */}
      {!broadcastMode && (
        <div style={{ marginBottom: '1.25rem' }}>
          <label style={{ display: 'block', fontWeight: '700', fontSize: '0.875rem', marginBottom: '0.5rem', color: '#374151' }}>
            Recipients {compose.recipientIds.length > 0 && <span style={{ background: '#2ABBA7', color: '#fff', borderRadius: '99px', padding: '1px 8px', fontSize: '0.75rem', marginLeft: '0.4rem' }}>{compose.recipientIds.length}</span>}
          </label>
          <input
            placeholder="Search by name or role..."
            value={userSearch}
            onChange={e => setUserSearch(e.target.value)}
            style={{ width: '100%', padding: '0.6rem 0.875rem', border: '1px solid #D1D5DB', borderRadius: '8px', marginBottom: '0.5rem', fontSize: '0.875rem', boxSizing: 'border-box', outline: 'none' }}
          />
          <div style={{ border: '1px solid #E5E7EB', borderRadius: '10px', maxHeight: '200px', overflowY: 'auto' }}>
            {filteredUsers.map((user, i) => {
              const selected = compose.recipientIds.includes(user.id);
              return (
                <div key={user.id} onClick={() => toggleRecipient(user.id)}
                  style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', padding: '0.625rem 1rem', cursor: 'pointer', background: selected ? '#F0FDFB' : i % 2 === 0 ? '#fff' : '#F9FAFB', borderBottom: i < filteredUsers.length - 1 ? '1px solid #F3F4F6' : 'none' }}>
                  <div style={{ width: '20px', height: '20px', borderRadius: '4px', border: `2px solid ${selected ? '#2ABBA7' : '#D1D5DB'}`, background: selected ? '#2ABBA7' : '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                    {selected && <span style={{ color: '#fff', fontSize: '0.75rem', fontWeight: '800' }}>✓</span>}
                  </div>
                  <div style={{ flex: 1 }}>
                    <span style={{ fontWeight: '600', fontSize: '0.875rem', color: '#111827' }}>{user.first_name} {user.last_name}</span>
                    <span style={{ marginLeft: '0.5rem', fontSize: '0.75rem', background: `${roleColor(user.role)}22`, color: roleColor(user.role), borderRadius: '4px', padding: '1px 6px', fontWeight: '600' }}>{roleLabel(user.role)}</span>
                  </div>
                </div>
              );
            })}
            {filteredUsers.length === 0 && <div style={{ padding: '1rem', textAlign: 'center', color: '#9CA3AF', fontSize: '0.875rem' }}>No staff found</div>}
          </div>
          {compose.recipientIds.length > 0 && (
            <div style={{ marginTop: '0.5rem', display: 'flex', flexWrap: 'wrap', gap: '0.4rem' }}>
              {compose.recipientIds.map(id => {
                const u = users.find(u => u.id === id);
                return u ? (
                  <span key={id} style={{ background: '#2ABBA7', color: '#fff', borderRadius: '99px', padding: '3px 10px', fontSize: '0.78rem', fontWeight: '600', display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
                    {u.first_name} {u.last_name}
                    <button onClick={() => toggleRecipient(id)} style={{ background: 'none', border: 'none', color: '#fff', cursor: 'pointer', padding: 0, fontSize: '0.9rem', lineHeight: 1 }}>×</button>
                  </span>
                ) : null;
              })}
            </div>
          )}
        </div>
      )}

      {/* Subject */}
      <div style={{ marginBottom: '1rem' }}>
        <label style={{ display: 'block', fontWeight: '700', fontSize: '0.875rem', marginBottom: '0.4rem', color: '#374151' }}>Subject</label>
        <input
          placeholder="e.g. Schedule change this week, Team reminder..."
          value={compose.subject}
          onChange={e => setCompose(p => ({ ...p, subject: e.target.value }))}
          style={{ width: '100%', padding: '0.6rem 0.875rem', border: '1px solid #D1D5DB', borderRadius: '8px', fontSize: '0.875rem', boxSizing: 'border-box', outline: 'none' }}
        />
      </div>

      {/* Body */}
      <div style={{ marginBottom: '1.25rem' }}>
        <label style={{ display: 'block', fontWeight: '700', fontSize: '0.875rem', marginBottom: '0.4rem', color: '#374151' }}>Message *</label>
        <textarea
          placeholder="Type your message here..."
          value={compose.body}
          onChange={e => setCompose(p => ({ ...p, body: e.target.value }))}
          rows={6}
          style={{ width: '100%', padding: '0.75rem', border: '1px solid #D1D5DB', borderRadius: '8px', fontSize: '0.9rem', resize: 'vertical', boxSizing: 'border-box', outline: 'none', fontFamily: 'inherit' }}
        />
      </div>

      <div style={{ display: 'flex', gap: '0.75rem' }}>
        <button onClick={() => setView('inbox')}
          style={{ padding: '0.75rem 1.5rem', border: '1px solid #D1D5DB', borderRadius: '10px', background: '#fff', cursor: 'pointer', fontWeight: '600', color: '#374151' }}>
          Cancel
        </button>
        <button onClick={sendNew} disabled={sending}
          style={{ padding: '0.75rem 2rem', background: '#2ABBA7', color: '#fff', border: 'none', borderRadius: '10px', cursor: sending ? 'default' : 'pointer', fontWeight: '700', fontSize: '0.9rem' }}>
          {sending ? 'Sending...' : `📤 Send${broadcastMode ? ' to Everyone' : compose.recipientIds.length > 0 ? ` (${compose.recipientIds.length})` : ''}`}
        </button>
      </div>
    </div>
  );
};

export default MessageBoard;
