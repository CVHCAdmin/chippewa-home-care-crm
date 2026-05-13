// src/components/admin/CareTasksManager.jsx
// Admin modal: manage the recurring per-shift care tasks for a client.
import React, { useState, useEffect } from 'react';
import { API_BASE_URL } from '../../config';

const CATEGORIES = [
  { value: 'adl', label: 'ADL (bathing, dressing…)' },
  { value: 'iadl', label: 'IADL (meals, housekeeping…)' },
  { value: 'medication', label: 'Medication Reminder' },
  { value: 'companion', label: 'Companion / Social' },
  { value: 'safety', label: 'Safety Check' },
  { value: 'other', label: 'Other' }
];

export default function CareTasksManager({ client, token, onClose }) {
  const [tasks, setTasks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [form, setForm] = useState({ taskName: '', description: '', category: 'adl', allottedMinutes: 15 });
  const [editingId, setEditingId] = useState(null);

  const hdr = { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` };

  const load = async () => {
    try {
      setLoading(true);
      const r = await fetch(`${API_BASE_URL}/api/clients/${client.id}/care-tasks`, { headers: { Authorization: `Bearer ${token}` } });
      if (!r.ok) throw new Error('Failed to load tasks');
      setTasks(await r.json());
    } catch (e) { setError(e.message); }
    finally { setLoading(false); }
  };

  useEffect(() => { if (client?.id) load(); /* eslint-disable-line */ }, [client?.id]);

  const reset = () => { setForm({ taskName: '', description: '', category: 'adl', allottedMinutes: 15 }); setEditingId(null); setError(''); };

  const save = async () => {
    if (!form.taskName.trim()) { setError('Task name required'); return; }
    setError('');
    try {
      if (editingId) {
        const r = await fetch(`${API_BASE_URL}/api/care-tasks/${editingId}`, {
          method: 'PUT', headers: hdr, body: JSON.stringify(form)
        });
        if (!r.ok) throw new Error((await r.json()).error || 'Update failed');
      } else {
        const r = await fetch(`${API_BASE_URL}/api/clients/${client.id}/care-tasks`, {
          method: 'POST', headers: hdr, body: JSON.stringify(form)
        });
        if (!r.ok) throw new Error((await r.json()).error || 'Create failed');
      }
      reset();
      load();
    } catch (e) { setError(e.message); }
  };

  const edit = (t) => {
    setEditingId(t.id);
    setForm({
      taskName: t.task_name,
      description: t.description || '',
      category: t.category || 'other',
      allottedMinutes: t.allotted_minutes || 0
    });
  };

  const remove = async (t) => {
    if (!window.confirm(`Remove "${t.task_name}" from this client's task list?`)) return;
    try {
      const r = await fetch(`${API_BASE_URL}/api/care-tasks/${t.id}`, { method: 'DELETE', headers: hdr });
      if (!r.ok) throw new Error('Delete failed');
      if (editingId === t.id) reset();
      load();
    } catch (e) { setError(e.message); }
  };

  const totalMinutes = tasks.reduce((sum, t) => sum + (parseInt(t.allotted_minutes) || 0), 0);

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 2300, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1rem' }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div style={{ background: '#fff', borderRadius: 12, width: '100%', maxWidth: 720, maxHeight: '92vh', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
        <div style={{ padding: '1rem 1.25rem', borderBottom: '1px solid #E5E7EB', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <h3 style={{ margin: 0, fontSize: '1.1rem' }}>📋 Care Tasks — {client.first_name} {client.last_name}</h3>
            <p style={{ margin: '0.25rem 0 0', fontSize: '0.82rem', color: '#6B7280' }}>
              {tasks.length} task{tasks.length !== 1 ? 's' : ''} · {totalMinutes} min total allotted
            </p>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', fontSize: '1.5rem', cursor: 'pointer', color: '#9CA3AF' }}>×</button>
        </div>

        <div style={{ flex: 1, overflow: 'auto', padding: '1rem 1.25rem' }}>
          {/* Add/Edit form */}
          <div style={{ background: editingId ? '#FEF3C7' : '#F9FAFB', borderRadius: 10, padding: '0.9rem', marginBottom: '1rem' }}>
            <div style={{ fontWeight: 700, marginBottom: '0.5rem', fontSize: '0.92rem' }}>
              {editingId ? '✏️ Edit Task' : '+ Add Task'}
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr', gap: '0.5rem', marginBottom: '0.5rem' }}>
              <input
                placeholder="Task name (e.g. Bathing assistance)"
                value={form.taskName}
                onChange={(e) => setForm({ ...form, taskName: e.target.value })}
                style={{ padding: '0.5rem', borderRadius: 6, border: '1px solid #D1D5DB', fontSize: '0.9rem' }}
              />
              <select value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}
                style={{ padding: '0.5rem', borderRadius: 6, border: '1px solid #D1D5DB', fontSize: '0.9rem' }}>
                {CATEGORIES.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
              </select>
              <input
                type="number" min="0" step="5"
                placeholder="Minutes"
                value={form.allottedMinutes}
                onChange={(e) => setForm({ ...form, allottedMinutes: parseInt(e.target.value) || 0 })}
                style={{ padding: '0.5rem', borderRadius: 6, border: '1px solid #D1D5DB', fontSize: '0.9rem' }}
              />
            </div>
            <textarea
              placeholder="Optional description / instructions"
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
              rows={2}
              style={{ width: '100%', padding: '0.5rem', borderRadius: 6, border: '1px solid #D1D5DB', resize: 'vertical', fontSize: '0.88rem', fontFamily: 'inherit', marginBottom: '0.5rem' }}
            />
            <div style={{ display: 'flex', gap: '0.5rem' }}>
              <button onClick={save} className="btn btn-primary btn-sm">{editingId ? 'Save Changes' : 'Add Task'}</button>
              {editingId && <button onClick={reset} className="btn btn-secondary btn-sm">Cancel</button>}
            </div>
            {error && <div style={{ marginTop: '0.5rem', color: '#B91C1C', fontSize: '0.85rem' }}>{error}</div>}
          </div>

          {/* Existing tasks */}
          {loading ? (
            <div style={{ textAlign: 'center', padding: '2rem', color: '#9CA3AF' }}>Loading…</div>
          ) : tasks.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '2rem', color: '#9CA3AF', background: '#F9FAFB', borderRadius: 10 }}>
              No care tasks yet. Add tasks above and caregivers will see them as a checklist during the shift.
            </div>
          ) : (
            <div>
              {tasks.map(t => (
                <div key={t.id} style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', padding: '0.7rem 0.9rem', border: '1px solid #E5E7EB', borderRadius: 10, marginBottom: '0.4rem', background: '#fff' }}>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontWeight: 600, fontSize: '0.95rem' }}>{t.task_name}</div>
                    {t.description && <div style={{ color: '#6B7280', fontSize: '0.82rem', marginTop: '0.15rem' }}>{t.description}</div>}
                    <div style={{ color: '#9CA3AF', fontSize: '0.75rem', marginTop: '0.2rem' }}>
                      {CATEGORIES.find(c => c.value === t.category)?.label || t.category} · {t.allotted_minutes} min
                    </div>
                  </div>
                  <button onClick={() => edit(t)} className="btn btn-sm btn-secondary" style={{ fontSize: '0.78rem' }}>Edit</button>
                  <button onClick={() => remove(t)} className="btn btn-sm" style={{ background: '#fff', color: '#B91C1C', border: '1px solid #FCA5A5', fontSize: '0.78rem' }}>Remove</button>
                </div>
              ))}
            </div>
          )}
        </div>

        <div style={{ padding: '0.75rem 1.25rem', borderTop: '1px solid #E5E7EB', display: 'flex', justifyContent: 'flex-end' }}>
          <button onClick={onClose} className="btn btn-secondary">Close</button>
        </div>
      </div>
    </div>
  );
}
