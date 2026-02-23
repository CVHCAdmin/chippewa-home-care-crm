// CommunicationLog.jsx
// Timestamped notes/calls/emails per client or caregiver
// Can be embedded inside ClientDetail, CaregiverProfile, or used standalone

import { useState, useEffect } from 'react';

const API = import.meta.env.VITE_API_URL || '';

const LOG_TYPES = [
  { value: 'note',       label: 'Note',       icon: '📝', color: '#6B7280' },
  { value: 'call',       label: 'Call',        icon: '📞', color: '#3B82F6' },
  { value: 'email',      label: 'Email',       icon: '📧', color: '#8B5CF6' },
  { value: 'text',       label: 'Text',        icon: '💬', color: '#10B981' },
  { value: 'visit',      label: 'Visit',       icon: '🏠', color: '#F59E0B' },
  { value: 'incident',   label: 'Incident',    icon: '⚠️', color: '#EF4444' },
  { value: 'complaint',  label: 'Complaint',   icon: '🚨', color: '#DC2626' },
  { value: 'compliment', label: 'Compliment',  icon: '⭐', color: '#F59E0B' },
  { value: 'other',      label: 'Other',       icon: '📋', color: '#9CA3AF' },
];

const DIRECTIONS = ['inbound', 'outbound', 'internal'];

export default function CommunicationLog({ token, entityType, entityId, entityName, compact = false }) {
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [filterType, setFilterType] = useState('');
  const [followUps, setFollowUps] = useState([]);
  const [form, setForm] = useState({ logType: 'note', direction: 'internal', subject: '', body: '', followUpDate: '' });
  const [saving, setSaving] = useState(false);
  const [editId, setEditId] = useState(null);
  const [msg, setMsg] = useState('');

  const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` };

  const load = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ limit: 100 });
      if (filterType) params.set('type', filterType);
      const r = await fetch(`${API}/api/communication-log/${entityType}/${entityId}?${params}`, { headers });
      setLogs(await r.json());
    } catch (e) { console.error(e); }
    setLoading(false);
  };

  const loadFollowUps = async () => {
    try {
      const r = await fetch(`${API}/api/communication-log/follow-ups/pending`, { headers });
      const data = await r.json();
      setFollowUps(data.filter(f => f.entity_id === entityId));
    } catch (e) {}
  };

  useEffect(() => { load(); loadFollowUps(); }, [entityId, filterType]);

  const flash = (m) => { setMsg(m); setTimeout(() => setMsg(''), 3000); };

  const save = async () => {
    if (!form.body.trim()) return;
    setSaving(true);
    try {
      const url = editId ? `${API}/api/communication-log/${editId}` : `${API}/api/communication-log`;
      const method = editId ? 'PUT' : 'POST';
      const body = editId ? { body: form.body, subject: form.subject } : { entityType, entityId, ...form };
      await fetch(url, { method, headers, body: JSON.stringify(body) });
      flash(editId ? 'Updated' : 'Entry saved');
      setForm({ logType: 'note', direction: 'internal', subject: '', body: '', followUpDate: '' });
      setEditId(null);
      setShowForm(false);
      load();
    } catch (e) { flash('Error saving'); }
    setSaving(false);
  };

  const togglePin = async (log) => {
    await fetch(`${API}/api/communication-log/${log.id}`, {
      method: 'PUT', headers, body: JSON.stringify({ isPinned: !log.is_pinned })
    });
    load();
  };

  const markFollowUpDone = async (id) => {
    await fetch(`${API}/api/communication-log/${id}`, {
      method: 'PUT', headers, body: JSON.stringify({ followUpDone: true })
    });
    load(); loadFollowUps();
  };

  const deleteLog = async (id) => {
    if (!confirm('Delete this entry?')) return;
    await fetch(`${API}/api/communication-log/${id}`, { method: 'DELETE', headers });
    load();
  };

  const startEdit = (log) => {
    setEditId(log.id);
    setForm({ ...form, body: log.body, subject: log.subject || '' });
    setShowForm(true);
    window.scrollTo(0, 0);
  };

  const typeInfo = (t) => LOG_TYPES.find(l => l.value === t) || LOG_TYPES[0];

  const fmt = (dt) => {
    const d = new Date(dt);
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
      + ' ' + d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  };

  return (
    <div style={{ fontFamily: 'inherit' }}>
      {msg && <div style={{ position: 'fixed', top: '1rem', right: '1rem', background: '#D1FAE5', color: '#065F46', padding: '0.75rem 1.25rem', borderRadius: '8px', zIndex: 9999, fontWeight: 600, boxShadow: '0 4px 12px rgba(0,0,0,0.15)' }}>{msg}</div>}

      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem', flexWrap: 'wrap', gap: '0.5rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
          <h3 style={{ margin: 0, fontSize: compact ? '1rem' : '1.15rem' }}>📋 Communication Log</h3>
          {entityName && <span style={{ color: '#6B7280', fontSize: '0.88rem' }}>— {entityName}</span>}
          <span style={{ background: '#F3F4F6', borderRadius: '12px', padding: '0.15rem 0.6rem', fontSize: '0.8rem', color: '#374151', fontWeight: 600 }}>{logs.length}</span>
        </div>
        <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
          <select value={filterType} onChange={e => setFilterType(e.target.value)}
            style={{ padding: '0.4rem 0.65rem', borderRadius: '6px', border: '1px solid #D1D5DB', fontSize: '0.85rem', color: '#374151' }}>
            <option value=''>All types</option>
            {LOG_TYPES.map(t => <option key={t.value} value={t.value}>{t.icon} {t.label}</option>)}
          </select>
          <button onClick={() => { setShowForm(!showForm); setEditId(null); }}
            style={{ padding: '0.45rem 1rem', borderRadius: '8px', border: 'none', background: showForm ? '#E5E7EB' : '#3B82F6', color: showForm ? '#374151' : '#fff', cursor: 'pointer', fontWeight: 600, fontSize: '0.88rem' }}>
            {showForm ? '✕ Cancel' : '+ Add Entry'}
          </button>
        </div>
      </div>

      {/* Pending follow-ups banner */}
      {followUps.length > 0 && (
        <div style={{ background: '#FEF3C7', border: '1px solid #FCD34D', borderRadius: '8px', padding: '0.75rem 1rem', marginBottom: '1rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.5rem' }}>
          <span style={{ fontWeight: 600, color: '#92400E', fontSize: '0.88rem' }}>⏰ {followUps.length} follow-up{followUps.length > 1 ? 's' : ''} pending</span>
          <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
            {followUps.slice(0, 3).map(f => (
              <span key={f.id} style={{ background: '#fff', border: '1px solid #FCD34D', borderRadius: '6px', padding: '0.2rem 0.6rem', fontSize: '0.78rem', color: '#374151' }}>
                {f.subject || f.body.slice(0, 30)}
                <button onClick={() => markFollowUpDone(f.id)} style={{ marginLeft: '0.4rem', background: 'none', border: 'none', color: '#10B981', cursor: 'pointer', fontWeight: 700, fontSize: '0.8rem' }}>✓</button>
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Add / Edit form */}
      {showForm && (
        <div style={{ background: '#F9FAFB', border: '1px solid #E5E7EB', borderRadius: '10px', padding: '1rem', marginBottom: '1.25rem' }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem', marginBottom: '0.75rem' }}>
            {!editId && (
              <>
                <div>
                  <label style={{ display: 'block', fontSize: '0.82rem', fontWeight: 600, marginBottom: '0.3rem', color: '#374151' }}>Type</label>
                  <select value={form.logType} onChange={e => setForm(f => ({ ...f, logType: e.target.value }))}
                    style={{ width: '100%', padding: '0.5rem', borderRadius: '6px', border: '1px solid #D1D5DB', fontSize: '0.88rem' }}>
                    {LOG_TYPES.map(t => <option key={t.value} value={t.value}>{t.icon} {t.label}</option>)}
                  </select>
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: '0.82rem', fontWeight: 600, marginBottom: '0.3rem', color: '#374151' }}>Direction</label>
                  <select value={form.direction} onChange={e => setForm(f => ({ ...f, direction: e.target.value }))}
                    style={{ width: '100%', padding: '0.5rem', borderRadius: '6px', border: '1px solid #D1D5DB', fontSize: '0.88rem' }}>
                    {DIRECTIONS.map(d => <option key={d} value={d}>{d.charAt(0).toUpperCase() + d.slice(1)}</option>)}
                  </select>
                </div>
              </>
            )}
            <div style={{ gridColumn: editId ? '1 / -1' : '1 / -1' }}>
              <label style={{ display: 'block', fontSize: '0.82rem', fontWeight: 600, marginBottom: '0.3rem', color: '#374151' }}>Subject (optional)</label>
              <input value={form.subject} onChange={e => setForm(f => ({ ...f, subject: e.target.value }))}
                placeholder='Brief subject...'
                style={{ width: '100%', padding: '0.5rem', borderRadius: '6px', border: '1px solid #D1D5DB', fontSize: '0.88rem', boxSizing: 'border-box' }} />
            </div>
          </div>
          <div style={{ marginBottom: '0.75rem' }}>
            <label style={{ display: 'block', fontSize: '0.82rem', fontWeight: 600, marginBottom: '0.3rem', color: '#374151' }}>Notes *</label>
            <textarea value={form.body} onChange={e => setForm(f => ({ ...f, body: e.target.value }))}
              placeholder='Enter your notes here...' rows={4}
              style={{ width: '100%', padding: '0.6rem', borderRadius: '6px', border: '1px solid #D1D5DB', fontSize: '0.88rem', resize: 'vertical', boxSizing: 'border-box' }} />
          </div>
          {!editId && (
            <div style={{ marginBottom: '0.75rem' }}>
              <label style={{ display: 'block', fontSize: '0.82rem', fontWeight: 600, marginBottom: '0.3rem', color: '#374151' }}>Follow-up Date (optional)</label>
              <input type='date' value={form.followUpDate} onChange={e => setForm(f => ({ ...f, followUpDate: e.target.value }))}
                style={{ padding: '0.5rem', borderRadius: '6px', border: '1px solid #D1D5DB', fontSize: '0.88rem' }} />
            </div>
          )}
          <div style={{ display: 'flex', gap: '0.5rem' }}>
            <button onClick={save} disabled={saving || !form.body.trim()}
              style={{ padding: '0.55rem 1.25rem', borderRadius: '8px', border: 'none', background: '#3B82F6', color: '#fff', cursor: 'pointer', fontWeight: 600, fontSize: '0.88rem', opacity: saving ? 0.7 : 1 }}>
              {saving ? 'Saving...' : editId ? '✓ Update' : '✓ Save Entry'}
            </button>
          </div>
        </div>
      )}

      {/* Log entries */}
      {loading ? (
        <div style={{ textAlign: 'center', padding: '2rem', color: '#9CA3AF' }}>Loading...</div>
      ) : logs.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '3rem', color: '#9CA3AF', background: '#F9FAFB', borderRadius: '10px', border: '2px dashed #E5E7EB' }}>
          <div style={{ fontSize: '2rem', marginBottom: '0.5rem' }}>📋</div>
          No communication log entries yet
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
          {logs.map(log => {
            const ti = typeInfo(log.log_type);
            const isPinned = log.is_pinned;
            return (
              <div key={log.id} style={{
                background: isPinned ? '#FFFBEB' : '#fff',
                border: `1px solid ${isPinned ? '#FCD34D' : '#E5E7EB'}`,
                borderLeft: `4px solid ${ti.color}`,
                borderRadius: '8px', padding: '0.85rem 1rem',
                position: 'relative'
              }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '0.4rem', flexWrap: 'wrap', gap: '0.4rem' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
                    <span style={{ fontSize: '0.82rem', fontWeight: 700, background: ti.color + '18', color: ti.color, padding: '0.15rem 0.5rem', borderRadius: '12px' }}>
                      {ti.icon} {ti.label}
                    </span>
                    {log.direction && log.direction !== 'internal' && (
                      <span style={{ fontSize: '0.75rem', color: '#6B7280', background: '#F3F4F6', padding: '0.1rem 0.4rem', borderRadius: '10px' }}>
                        {log.direction === 'inbound' ? '↙ In' : '↗ Out'}
                      </span>
                    )}
                    {isPinned && <span style={{ fontSize: '0.75rem' }}>📌</span>}
                    {log.follow_up_date && !log.follow_up_done && (
                      <span style={{ fontSize: '0.75rem', background: '#FEF3C7', color: '#92400E', padding: '0.1rem 0.45rem', borderRadius: '10px', fontWeight: 600 }}>
                        ⏰ Follow-up: {new Date(log.follow_up_date + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                      </span>
                    )}
                  </div>
                  <div style={{ display: 'flex', gap: '0.35rem' }}>
                    <button onClick={() => togglePin(log)} title={isPinned ? 'Unpin' : 'Pin'}
                      style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '0.85rem', opacity: 0.6, padding: '0.1rem' }}>📌</button>
                    {log.follow_up_date && !log.follow_up_done && (
                      <button onClick={() => markFollowUpDone(log.id)} title='Mark follow-up done'
                        style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '0.85rem', color: '#10B981', padding: '0.1rem' }}>✓</button>
                    )}
                    <button onClick={() => startEdit(log)} title='Edit'
                      style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '0.82rem', opacity: 0.5, padding: '0.1rem' }}>✏️</button>
                    <button onClick={() => deleteLog(log.id)} title='Delete'
                      style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '0.82rem', color: '#EF4444', opacity: 0.6, padding: '0.1rem' }}>🗑</button>
                  </div>
                </div>
                {log.subject && <div style={{ fontWeight: 600, fontSize: '0.9rem', marginBottom: '0.3rem', color: '#111827' }}>{log.subject}</div>}
                <div style={{ fontSize: '0.88rem', color: '#374151', lineHeight: 1.5, whiteSpace: 'pre-wrap' }}>{log.body}</div>
                <div style={{ marginTop: '0.5rem', fontSize: '0.75rem', color: '#9CA3AF' }}>
                  {log.logged_by_name || 'Admin'} · {fmt(log.created_at)}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
