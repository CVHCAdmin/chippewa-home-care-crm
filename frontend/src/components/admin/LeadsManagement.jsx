// src/components/admin/LeadsManagement.jsx
//
// Shows prospects (leads) captured by the website contact form and any
// manually-added prospects. Admin can update status, add notes, convert
// a lead to a client, or mark it inactive (soft delete).

import React, { useState, useEffect, useCallback } from 'react';
import { API_BASE_URL } from '../../config';

const STATUS_OPTIONS = [
  { value: 'new',        label: 'New',        fg: '#065F46', bg: '#D1FAE5' },
  { value: 'contacted',  label: 'Contacted',  fg: '#1E40AF', bg: '#DBEAFE' },
  { value: 'qualified',  label: 'Qualified',  fg: '#5B21B6', bg: '#EDE9FE' },
  { value: 'converted',  label: 'Converted',  fg: '#047857', bg: '#A7F3D0' },
  { value: 'lost',       label: 'Lost',       fg: '#991B1B', bg: '#FEE2E2' },
];
const statusMeta = (s) => STATUS_OPTIONS.find(o => o.value === s) || { label: s || 'new', fg: '#374151', bg: '#F3F4F6' };

const fmtDateTime = (t) => {
  if (!t) return '—';
  const d = new Date(t);
  return d.toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });
};

export default function LeadsManagement({ token }) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [filter, setFilter] = useState('all');
  const [selected, setSelected] = useState(null);
  const [busy, setBusy] = useState(false);

  const hdr = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const r = await fetch(`${API_BASE_URL}/api/prospects`, { headers: hdr });
      if (!r.ok) throw new Error(`Request failed (${r.status})`);
      const data = await r.json();
      setRows(Array.isArray(data) ? data : []);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => { load(); }, [load]);

  const updateStatus = async (id, status) => {
    setBusy(true);
    try {
      const r = await fetch(`${API_BASE_URL}/api/prospects/${id}`, {
        method: 'PUT', headers: hdr, body: JSON.stringify({ status })
      });
      if (!r.ok) throw new Error('Update failed');
      await load();
      if (selected?.id === id) setSelected({ ...selected, status });
    } catch (e) { alert(e.message); } finally { setBusy(false); }
  };

  const saveNotes = async (id, notes) => {
    setBusy(true);
    try {
      const r = await fetch(`${API_BASE_URL}/api/prospects/${id}`, {
        method: 'PUT', headers: hdr, body: JSON.stringify({ notes })
      });
      if (!r.ok) throw new Error('Save failed');
      await load();
      if (selected?.id === id) setSelected({ ...selected, notes });
    } catch (e) { alert(e.message); } finally { setBusy(false); }
  };

  const convertToClient = async (id) => {
    if (!window.confirm('Convert this lead to a client? A new client record will be created and the lead marked Converted.')) return;
    setBusy(true);
    try {
      const r = await fetch(`${API_BASE_URL}/api/prospects/${id}/convert`, {
        method: 'POST', headers: hdr
      });
      if (!r.ok) {
        const err = await r.json().catch(() => ({}));
        throw new Error(err.error || 'Convert failed');
      }
      await load();
      setSelected(null);
      alert('Lead converted to client. You can find them under Clients.');
    } catch (e) { alert(e.message); } finally { setBusy(false); }
  };

  const archive = async (id) => {
    if (!window.confirm('Mark this lead inactive? It will be hidden from the list but retained in the database.')) return;
    setBusy(true);
    try {
      const r = await fetch(`${API_BASE_URL}/api/prospects/${id}`, { method: 'DELETE', headers: hdr });
      if (!r.ok) throw new Error('Archive failed');
      await load();
      setSelected(null);
    } catch (e) { alert(e.message); } finally { setBusy(false); }
  };

  const filtered = filter === 'all' ? rows : rows.filter(r => (r.status || 'new') === filter);
  const newCount = rows.filter(r => (r.status || 'new') === 'new').length;

  const card = { background: '#fff', borderRadius: 12, padding: '1rem', boxShadow: '0 1px 3px rgba(0,0,0,0.05)', marginBottom: '0.75rem' };
  const thStyle = { padding: '0.5rem 0.75rem', textAlign: 'left', fontWeight: 700, color: '#374151', borderBottom: '1px solid #E5E7EB', fontSize: '0.78rem' };
  const tdStyle = { padding: '0.5rem 0.75rem', fontSize: '0.82rem', verticalAlign: 'top' };
  const btn = (bg = '#2ABBA7', outline = false) => outline
    ? { padding: '0.4rem 0.75rem', background: '#fff', color: bg, border: `1px solid ${bg}`, borderRadius: 6, fontSize: '0.78rem', fontWeight: 600, cursor: 'pointer' }
    : { padding: '0.4rem 0.75rem', background: bg, color: '#fff', border: 'none', borderRadius: 6, fontSize: '0.78rem', fontWeight: 600, cursor: 'pointer' };
  const badge = (fg, bg) => ({ padding: '0.2rem 0.6rem', background: bg, color: fg, borderRadius: 12, fontSize: '0.72rem', fontWeight: 700, display: 'inline-block' });

  if (loading) return <div style={{ padding: '2rem', textAlign: 'center', color: '#6B7280' }}>Loading leads…</div>;
  if (error) return <div style={{ padding: '2rem', textAlign: 'center', color: '#EF4444' }}>Error: {error}</div>;

  return (
    <div style={{ padding: '1rem', maxWidth: '1400px', margin: '0 auto' }}>
      <div style={{ marginBottom: '1rem', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', flexWrap: 'wrap', gap: '0.5rem' }}>
        <div>
          <h1 style={{ fontSize: '1.5rem', fontWeight: 800, margin: 0, marginBottom: '0.25rem' }}>📬 Leads</h1>
          <p style={{ color: '#6B7280', fontSize: '0.88rem', margin: 0 }}>
            Potential clients from the website contact form and manual entries.
            {newCount > 0 && <span style={{ marginLeft: 8, ...badge('#065F46', '#D1FAE5') }}>{newCount} new</span>}
          </p>
        </div>
        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'center' }}>
          <label style={{ fontSize: '0.82rem', color: '#6B7280' }}>Status:</label>
          <select value={filter} onChange={e => setFilter(e.target.value)} style={{ padding: '0.35rem 0.5rem', border: '1px solid #D1D5DB', borderRadius: 6, fontSize: '0.82rem' }}>
            <option value="all">All</option>
            {STATUS_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
          <button style={btn('#6366F1', true)} onClick={load} disabled={busy}>Refresh</button>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: selected ? '1fr 1fr' : '1fr', gap: '1rem' }}>
        {/* List */}
        <div style={card}>
          {filtered.length === 0 ? (
            <div style={{ padding: '2rem', textAlign: 'center', color: '#6B7280' }}>
              {filter === 'all' ? 'No leads yet — website submissions will appear here.' : `No leads with status "${filter}".`}
            </div>
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ background: '#F9FAFB' }}>
                  <th style={thStyle}>Name</th>
                  <th style={thStyle}>Contact</th>
                  <th style={thStyle}>Source</th>
                  <th style={thStyle}>Received</th>
                  <th style={thStyle}>Status</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map(r => {
                  const m = statusMeta(r.status || 'new');
                  const isSel = selected?.id === r.id;
                  return (
                    <tr key={r.id}
                        onClick={() => setSelected(r)}
                        style={{ borderBottom: '1px solid #F3F4F6', cursor: 'pointer', background: isSel ? '#ECFDF5' : 'transparent' }}>
                      <td style={{ ...tdStyle, fontWeight: 600 }}>{r.first_name} {r.last_name}</td>
                      <td style={tdStyle}>
                        {r.phone && <div>📞 {r.phone}</div>}
                        {r.email && <div style={{ color: '#6B7280', fontSize: '0.76rem' }}>✉ {r.email}</div>}
                      </td>
                      <td style={{ ...tdStyle, color: '#6B7280' }}>{r.source || '—'}</td>
                      <td style={{ ...tdStyle, color: '#6B7280' }}>{fmtDateTime(r.created_at)}</td>
                      <td style={tdStyle}><span style={badge(m.fg, m.bg)}>{m.label}</span></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>

        {/* Detail pane */}
        {selected && (
          <LeadDetail
            key={selected.id}
            lead={selected}
            busy={busy}
            onClose={() => setSelected(null)}
            onStatusChange={(s) => updateStatus(selected.id, s)}
            onSaveNotes={(n) => saveNotes(selected.id, n)}
            onConvert={() => convertToClient(selected.id)}
            onArchive={() => archive(selected.id)}
            btn={btn}
            badge={badge}
            card={card}
          />
        )}
      </div>
    </div>
  );
}

function LeadDetail({ lead, busy, onClose, onStatusChange, onSaveNotes, onConvert, onArchive, btn, badge, card }) {
  const [notes, setNotes] = useState(lead.notes || '');
  const [dirty, setDirty] = useState(false);

  useEffect(() => { setNotes(lead.notes || ''); setDirty(false); }, [lead.id]);

  return (
    <div style={card}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '0.75rem' }}>
        <div>
          <div style={{ fontSize: '1.2rem', fontWeight: 800 }}>{lead.first_name} {lead.last_name}</div>
          <div style={{ color: '#6B7280', fontSize: '0.82rem' }}>
            Received {new Date(lead.created_at).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' })}
            {lead.source && <> · via {lead.source}</>}
          </div>
        </div>
        <button onClick={onClose} style={{ background: 'none', border: 'none', fontSize: '1.2rem', cursor: 'pointer', color: '#6B7280' }}>✕</button>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem 1rem', marginBottom: '1rem', fontSize: '0.86rem' }}>
        <div><strong>Phone:</strong> {lead.phone ? <a href={`tel:${lead.phone}`}>{lead.phone}</a> : '—'}</div>
        <div><strong>Email:</strong> {lead.email ? <a href={`mailto:${lead.email}`}>{lead.email}</a> : '—'}</div>
        <div><strong>City:</strong> {lead.city || '—'}</div>
        <div><strong>State:</strong> {lead.state || '—'}</div>
      </div>

      <div style={{ marginBottom: '1rem' }}>
        <label style={{ display: 'block', fontSize: '0.78rem', fontWeight: 700, color: '#374151', marginBottom: 4 }}>Status</label>
        <select value={lead.status || 'new'} onChange={e => onStatusChange(e.target.value)} disabled={busy}
          style={{ width: '100%', padding: '0.4rem 0.5rem', border: '1px solid #D1D5DB', borderRadius: 6, fontSize: '0.86rem' }}>
          {STATUS_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      </div>

      <div style={{ marginBottom: '1rem' }}>
        <label style={{ display: 'block', fontSize: '0.78rem', fontWeight: 700, color: '#374151', marginBottom: 4 }}>Notes</label>
        <textarea
          value={notes}
          onChange={e => { setNotes(e.target.value); setDirty(true); }}
          rows={8}
          style={{ width: '100%', padding: '0.5rem', border: '1px solid #D1D5DB', borderRadius: 6, fontSize: '0.82rem', fontFamily: 'inherit', whiteSpace: 'pre-wrap' }}
        />
        <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.5rem' }}>
          <button style={btn('#2ABBA7')} disabled={busy || !dirty} onClick={() => { onSaveNotes(notes); setDirty(false); }}>Save Notes</button>
          {dirty && <button style={btn('#6B7280', true)} disabled={busy} onClick={() => { setNotes(lead.notes || ''); setDirty(false); }}>Discard</button>}
        </div>
      </div>

      <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', paddingTop: '0.75rem', borderTop: '1px solid #E5E7EB' }}>
        <button style={btn('#047857')} disabled={busy || lead.status === 'converted'} onClick={onConvert}>→ Convert to Client</button>
        <button style={btn('#EF4444', true)} disabled={busy} onClick={onArchive}>Archive</button>
      </div>
    </div>
  );
}
