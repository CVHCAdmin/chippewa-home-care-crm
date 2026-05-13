// src/components/CareTaskChecklist.jsx
// During an active shift, shows the client's care tasks and lets the caregiver
// tap to mark each completed / skipped / refused, with optional notes.
import React, { useState, useEffect } from 'react';
import { API_BASE_URL } from './../config';

const CATEGORY_LABELS = {
  adl: 'ADL',
  iadl: 'IADL',
  medication: 'Med',
  companion: 'Companion',
  safety: 'Safety',
  other: 'Other'
};

const STATUS_COLORS = {
  pending:   { bg: '#fff',    border: '#D1D5DB', label: '⬜ Pending',   text: '#6B7280' },
  completed: { bg: '#D1FAE5', border: '#10B981', label: '✅ Done',      text: '#065F46' },
  skipped:   { bg: '#FEF3C7', border: '#F59E0B', label: '↪️ Skipped',   text: '#92400E' },
  refused:   { bg: '#FEE2E2', border: '#EF4444', label: '🚫 Refused',  text: '#991B1B' }
};

export default function CareTaskChecklist({ token, timeEntryId, compact = false, onChange }) {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [notesFor, setNotesFor] = useState(null); // { taskId, currentNotes }
  const [notesDraft, setNotesDraft] = useState('');

  const hdr = { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` };

  const load = async () => {
    try {
      const r = await fetch(`${API_BASE_URL}/api/time-entries/${timeEntryId}/task-completions`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (r.ok) setItems(await r.json());
    } catch (e) { console.error('Task list load:', e); }
    finally { setLoading(false); }
  };

  useEffect(() => { if (timeEntryId) load(); /* eslint-disable-line */ }, [timeEntryId]);

  const setStatus = async (taskId, status, notes) => {
    try {
      const r = await fetch(`${API_BASE_URL}/api/time-entries/${timeEntryId}/task-completions/${taskId}`, {
        method: 'PUT', headers: hdr,
        body: JSON.stringify({ status, notes: notes ?? null })
      });
      if (r.ok) {
        setItems(prev => prev.map(it => it.task_id === taskId ? { ...it, status, notes: notes ?? it.notes } : it));
        onChange?.();
      }
    } catch (e) { console.error('Task update:', e); }
  };

  const openNotes = (task) => {
    setNotesFor(task);
    setNotesDraft(task.notes || '');
  };

  const saveNotes = async () => {
    if (!notesFor) return;
    await setStatus(notesFor.task_id, notesFor.status, notesDraft);
    setNotesFor(null);
    setNotesDraft('');
  };

  if (loading) {
    return <div style={{ padding: '0.75rem', color: '#9CA3AF', fontSize: '0.85rem', textAlign: 'center' }}>Loading tasks…</div>;
  }

  if (items.length === 0) {
    return compact ? null : (
      <div style={{ padding: '0.75rem', color: '#9CA3AF', fontSize: '0.85rem', textAlign: 'center', background: '#F9FAFB', borderRadius: 8 }}>
        No care tasks set up for this client.
      </div>
    );
  }

  const counts = items.reduce((acc, it) => { acc[it.status] = (acc[it.status] || 0) + 1; return acc; }, {});
  const done = counts.completed || 0;
  const total = items.length;
  const pct = Math.round((done / total) * 100);

  return (
    <div style={{ padding: compact ? '0.5rem 0' : '0.75rem' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.5rem' }}>
        <strong style={{ fontSize: '0.95rem', color: '#111827' }}>📋 Care Tasks</strong>
        <span style={{ fontSize: '0.78rem', color: '#6B7280' }}>
          {done} of {total} done ({pct}%)
        </span>
      </div>
      <div style={{ height: 6, background: '#E5E7EB', borderRadius: 4, marginBottom: '0.6rem', overflow: 'hidden' }}>
        <div style={{ height: '100%', width: `${pct}%`, background: pct === 100 ? '#10B981' : '#3B82F6', transition: 'width 0.3s' }} />
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
        {items.map(t => {
          const sc = STATUS_COLORS[t.status] || STATUS_COLORS.pending;
          return (
            <div key={t.task_id} style={{
              background: sc.bg, border: `1.5px solid ${sc.border}`, borderRadius: 10,
              padding: '0.6rem 0.75rem'
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.3rem' }}>
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 600, fontSize: '0.93rem', color: '#111827' }}>{t.task_name}</div>
                  <div style={{ fontSize: '0.72rem', color: '#6B7280' }}>
                    {CATEGORY_LABELS[t.category] || t.category}
                    {t.allotted_minutes > 0 && ` · ${t.allotted_minutes} min`}
                  </div>
                </div>
                <span style={{ fontSize: '0.72rem', fontWeight: 700, color: sc.text }}>{sc.label}</span>
              </div>

              {t.description && (
                <div style={{ fontSize: '0.78rem', color: '#4B5563', marginBottom: '0.4rem' }}>{t.description}</div>
              )}

              {t.notes && (
                <div style={{ fontSize: '0.78rem', color: '#374151', background: 'rgba(0,0,0,0.04)', padding: '0.3rem 0.5rem', borderRadius: 6, marginBottom: '0.4rem' }}>
                  📝 {t.notes}
                </div>
              )}

              <div style={{ display: 'flex', gap: '0.3rem', flexWrap: 'wrap' }}>
                {t.status !== 'completed' && (
                  <button onClick={() => setStatus(t.task_id, 'completed', t.notes)}
                    style={{ padding: '0.35rem 0.65rem', background: '#10B981', color: '#fff', border: 'none', borderRadius: 6, fontSize: '0.8rem', fontWeight: 600, cursor: 'pointer' }}>
                    ✓ Done
                  </button>
                )}
                {t.status !== 'skipped' && (
                  <button onClick={() => setStatus(t.task_id, 'skipped', t.notes)}
                    style={{ padding: '0.35rem 0.65rem', background: '#fff', color: '#92400E', border: '1px solid #F59E0B', borderRadius: 6, fontSize: '0.8rem', fontWeight: 600, cursor: 'pointer' }}>
                    Skip
                  </button>
                )}
                {t.status !== 'refused' && (
                  <button onClick={() => setStatus(t.task_id, 'refused', t.notes)}
                    style={{ padding: '0.35rem 0.65rem', background: '#fff', color: '#991B1B', border: '1px solid #EF4444', borderRadius: 6, fontSize: '0.8rem', fontWeight: 600, cursor: 'pointer' }}>
                    Refused
                  </button>
                )}
                {t.status !== 'pending' && (
                  <button onClick={() => setStatus(t.task_id, 'pending', t.notes)}
                    style={{ padding: '0.35rem 0.65rem', background: '#fff', color: '#6B7280', border: '1px solid #D1D5DB', borderRadius: 6, fontSize: '0.8rem', cursor: 'pointer' }}>
                    Reset
                  </button>
                )}
                <button onClick={() => openNotes(t)}
                  style={{ padding: '0.35rem 0.65rem', background: '#fff', color: '#374151', border: '1px solid #D1D5DB', borderRadius: 6, fontSize: '0.8rem', cursor: 'pointer', marginLeft: 'auto' }}>
                  {t.notes ? '📝 Edit Note' : '📝 Add Note'}
                </button>
              </div>
            </div>
          );
        })}
      </div>

      {notesFor && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 2400, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1rem' }}
          onClick={(e) => { if (e.target === e.currentTarget) setNotesFor(null); }}>
          <div style={{ background: '#fff', borderRadius: 12, width: '100%', maxWidth: 480, padding: '1.25rem' }}>
            <h4 style={{ margin: '0 0 0.5rem', fontSize: '1rem' }}>Note for: {notesFor.task_name}</h4>
            <textarea
              value={notesDraft}
              onChange={(e) => setNotesDraft(e.target.value)}
              placeholder="e.g. Client refused — said she'd shower tomorrow"
              rows={4}
              style={{ width: '100%', padding: '0.5rem', borderRadius: 6, border: '1px solid #D1D5DB', resize: 'vertical', fontFamily: 'inherit', fontSize: '0.9rem', marginBottom: '0.75rem' }}
            />
            <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end' }}>
              <button onClick={() => setNotesFor(null)} className="btn btn-secondary btn-sm">Cancel</button>
              <button onClick={saveNotes} className="btn btn-primary btn-sm">Save Note</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
