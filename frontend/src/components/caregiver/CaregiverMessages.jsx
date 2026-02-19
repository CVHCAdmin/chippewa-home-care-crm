// src/components/caregiver/CaregiverMessages.jsx
// Mobile-first message inbox for caregivers
import React, { useState, useEffect, useRef, useCallback } from 'react';
import { API_BASE_URL } from '../../config';
import { toast } from '../Toast';

const CaregiverMessages = ({ token, onClose }) => {
  const [view, setView] = useState('inbox');
  const [threads, setThreads] = useState([]);
  const [activeThread, setActiveThread] = useState(null);
  const [messages, setMessages] = useState([]);
  const [replyBody, setReplyBody] = useState('');
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const messagesEndRef = useRef(null);
  const pollRef = useRef(null);

  const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` };

  // Decode user id from JWT
  const myId = (() => { try { return JSON.parse(atob(token.split('.')[1])).id; } catch { return null; } })();

  const loadInbox = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE_URL}/api/messages/inbox`, { headers });
      if (res.ok) setThreads(await res.json());
    } catch (e) { /* silent */ }
    finally { setLoading(false); }
  }, [token]);

  useEffect(() => {
    loadInbox();
    pollRef.current = setInterval(loadInbox, 20000);
    return () => clearInterval(pollRef.current);
  }, [loadInbox]);

  useEffect(() => {
    if (view === 'thread') messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, view]);

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
    if (!replyBody.trim() || sending) return;
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

  const formatTime = (ts) => {
    if (!ts) return '';
    const d = new Date(ts);
    const now = new Date();
    const diff = now - d;
    if (diff < 60000) return 'just now';
    if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
    if (diff < 86400000) return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    if (diff < 604800000) return d.toLocaleDateString([], { weekday: 'short' });
    return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
  };

  const totalUnread = threads.reduce((sum, t) => sum + (parseInt(t.unread_count) || 0), 0);

  // ─── INBOX ───────────────────────────────────────────────────────────────
  if (view === 'inbox') return (
    <div style={{ position: 'fixed', inset: 0, background: '#fff', zIndex: 9999, display: 'flex', flexDirection: 'column' }}>
      {/* Header */}
      <div style={{ padding: '1rem', borderBottom: '1px solid #E5E7EB', display: 'flex', alignItems: 'center', gap: '0.875rem', flexShrink: 0 }}>
        <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#6B7280', fontSize: '1.25rem', padding: 0 }}>✕</button>
        <div style={{ flex: 1 }}>
          <h2 style={{ margin: 0, fontSize: '1.1rem', fontWeight: '800', color: '#111827' }}>
            💬 Messages
            {totalUnread > 0 && <span style={{ background: '#EF4444', color: '#fff', borderRadius: '99px', fontSize: '0.65rem', padding: '2px 7px', marginLeft: '0.4rem', verticalAlign: 'middle' }}>{totalUnread}</span>}
          </h2>
          <p style={{ margin: 0, fontSize: '0.78rem', color: '#6B7280' }}>From your team</p>
        </div>
      </div>

      {/* List */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '0.75rem' }}>
        {loading ? (
          <div style={{ textAlign: 'center', padding: '3rem', color: '#9CA3AF' }}>Loading...</div>
        ) : threads.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '4rem 1rem', color: '#9CA3AF' }}>
            <div style={{ fontSize: '3rem', marginBottom: '0.75rem' }}>📭</div>
            <p style={{ fontWeight: '700', margin: '0 0 0.5rem', color: '#374151' }}>No messages yet</p>
            <p style={{ margin: 0, fontSize: '0.85rem' }}>Your supervisor will send messages here.</p>
          </div>
        ) : threads.map(thread => {
          const unread = parseInt(thread.unread_count) || 0;
          const others = thread.other_participants || [];
          const sender = thread.is_broadcast ? 'Admin Broadcast'
            : others.length === 1 ? `${others[0].first_name} ${others[0].last_name}`
            : others.length === 0 ? thread.sender_first + ' ' + thread.sender_last
            : `${others[0].first_name} +${others.length - 1}`;

          return (
            <div key={thread.id} onClick={() => openThread(thread)}
              style={{ display: 'flex', gap: '0.875rem', padding: '0.875rem', background: unread > 0 ? '#F0FDFB' : '#fff', border: `1px solid ${unread > 0 ? '#A7F3D0' : '#F3F4F6'}`, borderRadius: '12px', marginBottom: '0.5rem', cursor: 'pointer', alignItems: 'center' }}>
              <div style={{ width: '44px', height: '44px', borderRadius: '50%', background: unread > 0 ? '#2ABBA7' : '#E5E7EB', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '1.2rem', flexShrink: 0 }}>
                {thread.is_broadcast ? '📢' : '💬'}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.2rem' }}>
                  <span style={{ fontWeight: unread > 0 ? '800' : '600', fontSize: '0.9rem', color: '#111827' }}>{sender}</span>
                  <span style={{ fontSize: '0.72rem', color: '#9CA3AF' }}>{formatTime(thread.last_message_at)}</span>
                </div>
                <div style={{ fontSize: '0.82rem', color: '#374151', fontWeight: unread > 0 ? '700' : '500', marginBottom: '0.1rem' }}>{thread.subject}</div>
                <div style={{ fontSize: '0.78rem', color: '#6B7280', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {thread.last_message || 'No messages yet'}
                </div>
              </div>
              {unread > 0 && <div style={{ background: '#EF4444', color: '#fff', borderRadius: '99px', fontSize: '0.65rem', fontWeight: '700', padding: '2px 7px', flexShrink: 0 }}>{unread}</div>}
            </div>
          );
        })}
      </div>
    </div>
  );

  // ─── THREAD / CHAT VIEW ──────────────────────────────────────────────────
  return (
    <div style={{ position: 'fixed', inset: 0, background: '#fff', zIndex: 9999, display: 'flex', flexDirection: 'column' }}>
      {/* Header */}
      <div style={{ padding: '0.875rem 1rem', borderBottom: '1px solid #E5E7EB', display: 'flex', alignItems: 'center', gap: '0.75rem', flexShrink: 0 }}>
        <button onClick={() => { setView('inbox'); loadInbox(); }} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#2ABBA7', fontWeight: '700', fontSize: '1rem', padding: 0 }}>←</button>
        <div style={{ flex: 1 }}>
          <h3 style={{ margin: 0, fontSize: '0.95rem', fontWeight: '800', color: '#111827' }}>{activeThread?.subject}</h3>
          <p style={{ margin: 0, fontSize: '0.75rem', color: '#6B7280' }}>
            {activeThread?.is_broadcast ? '📢 Sent to all staff' : (activeThread?.other_participants || []).map(p => `${p.first_name} ${p.last_name}`).join(', ')}
          </p>
        </div>
      </div>

      {/* Messages */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '1rem', display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
        {messages.map(msg => {
          const isMe = msg.sender_id === myId;
          return (
            <div key={msg.id} style={{ display: 'flex', flexDirection: 'column', alignItems: isMe ? 'flex-end' : 'flex-start' }}>
              <div style={{ fontSize: '0.72rem', color: '#9CA3AF', marginBottom: '0.2rem', paddingLeft: isMe ? 0 : '0.25rem', paddingRight: isMe ? '0.25rem' : 0 }}>
                {isMe ? 'You' : `${msg.first_name} ${msg.last_name}`} · {formatTime(msg.created_at)}
              </div>
              <div style={{ maxWidth: '80%', padding: '0.75rem 1rem', borderRadius: isMe ? '18px 18px 4px 18px' : '18px 18px 18px 4px', background: isMe ? '#2ABBA7' : '#F3F4F6', color: isMe ? '#fff' : '#111827', fontSize: '0.9rem', lineHeight: 1.6 }}>
                {msg.body}
              </div>
            </div>
          );
        })}
        <div ref={messagesEndRef} />
      </div>

      {/* Reply bar */}
      <div style={{ padding: '0.75rem 1rem', borderTop: '1px solid #E5E7EB', display: 'flex', gap: '0.5rem', background: '#fff', flexShrink: 0 }}>
        <textarea
          value={replyBody}
          onChange={e => setReplyBody(e.target.value)}
          placeholder="Reply..."
          rows={1}
          style={{ flex: 1, padding: '0.75rem 1rem', border: '1px solid #D1D5DB', borderRadius: '24px', resize: 'none', fontSize: '0.9rem', outline: 'none', fontFamily: 'inherit', lineHeight: 1.5 }}
          onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendReply(); } }}
        />
        <button onClick={sendReply} disabled={sending || !replyBody.trim()}
          style={{ width: '44px', height: '44px', borderRadius: '50%', background: replyBody.trim() ? '#2ABBA7' : '#E5E7EB', border: 'none', cursor: replyBody.trim() ? 'pointer' : 'default', fontSize: '1.1rem', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
          {sending ? '⋯' : '↑'}
        </button>
      </div>
    </div>
  );
};

export default CaregiverMessages;
