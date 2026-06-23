// src/components/admin/CareTasksManager.jsx
// Admin modal: manage the recurring per-shift care tasks for a client.
// Supports bulk import from a parsed MIDAS SHC Homemaking assessment.
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

const emptyForm = { taskName: '', description: '', category: 'iadl', allottedMinutes: 15, weeklyFrequency: 1, daysOfWeek: '', timeOfDay: 'any', cadence: 'daily' };

export default function CareTasksManager({ client, token, onClose }) {
  const [tasks, setTasks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [form, setForm] = useState(emptyForm);
  const [editingId, setEditingId] = useState(null);

  // MIDAS import panel state
  const [showImport, setShowImport] = useState(false);
  const [rawJson, setRawJson] = useState('');
  const [parsed, setParsed] = useState(null);
  const [parseError, setParseError] = useState('');
  const [replaceExisting, setReplaceExisting] = useState(true);
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState(null);

  // Adherence report state ("what's getting done")
  const [showAdherence, setShowAdherence] = useState(false);
  const [adherence, setAdherence] = useState(null);
  const [adherenceDays, setAdherenceDays] = useState(30);
  const [adherenceLoading, setAdherenceLoading] = useState(false);

  const hdr = { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` };

  const loadAdherence = async (days) => {
    const d = days ?? adherenceDays;
    setAdherenceLoading(true);
    try {
      const r = await fetch(`${API_BASE_URL}/api/clients/${client.id}/care-tasks/adherence?days=${d}`, { headers: { Authorization: `Bearer ${token}` } });
      if (r.ok) setAdherence(await r.json());
    } catch (e) { /* non-fatal */ }
    finally { setAdherenceLoading(false); }
  };

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

  const reset = () => { setForm(emptyForm); setEditingId(null); setError(''); };

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
      allottedMinutes: t.allotted_minutes || 0,
      weeklyFrequency: t.weekly_frequency || 1,
      daysOfWeek: t.days_of_week || '',
      timeOfDay: t.time_of_day || 'any',
      cadence: t.cadence || 'daily'
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

  // ── MIDAS import ────────────────────────────────────────────────────────
  const parseJson = () => {
    setParseError(''); setImportResult(null);
    try {
      const obj = JSON.parse(rawJson);
      if (!obj || !Array.isArray(obj.tasks) || obj.tasks.length === 0) {
        throw new Error('JSON must have a non-empty "tasks" array');
      }
      setParsed(obj);
    } catch (e) {
      setParsed(null);
      setParseError(e.message);
    }
  };

  const previewMinsPerWeek = parsed
    ? parsed.tasks.reduce((s, t) => s + (parseInt(t.weeklyFrequency, 10) || 1) * (parseInt(t.allottedMinutes, 10) || 0), 0)
    : 0;
  const expectedMins = parsed?.assessmentTotals?.minsPerWeek;
  const reconcileOk = expectedMins == null ? null : Number(expectedMins) === previewMinsPerWeek;

  const runImport = async () => {
    if (!parsed) return;
    setImporting(true); setParseError(''); setImportResult(null);
    try {
      const r = await fetch(`${API_BASE_URL}/api/clients/${client.id}/care-tasks/import`, {
        method: 'POST', headers: hdr,
        body: JSON.stringify({
          tasks: parsed.tasks,
          replaceExisting,
          source: parsed.source || 'midas_shc_homemaking',
          assessmentTotals: parsed.assessmentTotals || null
        })
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || 'Import failed');
      setImportResult(data);
      setRawJson(''); setParsed(null);
      load();
    } catch (e) { setParseError(e.message); }
    finally { setImporting(false); }
  };

  const weeklyMinutes = tasks.reduce(
    (sum, t) => sum + ((parseInt(t.weekly_frequency, 10) || 1) * (parseInt(t.allotted_minutes, 10) || 0)), 0);

  const inp = { padding: '0.5rem', borderRadius: 6, border: '1px solid #D1D5DB', fontSize: '0.9rem' };

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 2300, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1rem' }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div style={{ background: '#fff', borderRadius: 12, width: '100%', maxWidth: 760, maxHeight: '92vh', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
        <div style={{ padding: '1rem 1.25rem', borderBottom: '1px solid #E5E7EB', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <h3 style={{ margin: 0, fontSize: '1.1rem' }}>📋 Care Tasks — {client.first_name} {client.last_name}</h3>
            <p style={{ margin: '0.25rem 0 0', fontSize: '0.82rem', color: '#6B7280' }}>
              {tasks.length} task{tasks.length !== 1 ? 's' : ''} · {weeklyMinutes} min/week · {(weeklyMinutes / 15).toFixed(2)} units/week
            </p>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', fontSize: '1.5rem', cursor: 'pointer', color: '#9CA3AF' }}>×</button>
        </div>

        <div style={{ flex: 1, overflow: 'auto', padding: '1rem 1.25rem' }}>
          {/* MIDAS import toggle */}
          <button
            onClick={() => setShowImport(v => !v)}
            className="btn btn-sm btn-secondary"
            style={{ marginBottom: '0.75rem' }}>
            {showImport ? '▾ Hide MIDAS import' : '▸ Import from MIDAS assessment'}
          </button>
          <button
            onClick={() => { const next = !showAdherence; setShowAdherence(next); if (next && !adherence) loadAdherence(); }}
            className="btn btn-sm btn-secondary"
            style={{ marginBottom: '0.75rem', marginLeft: '0.5rem' }}>
            {showAdherence ? "▾ Hide what's getting done" : "📊 What's getting done"}
          </button>

          {showAdherence && (
            <div style={{ background: '#FFFBEB', border: '1px solid #FDE68A', borderRadius: 10, padding: '0.9rem', marginBottom: '1rem' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.5rem', flexWrap: 'wrap', gap: '0.5rem' }}>
                <div style={{ fontWeight: 700, fontSize: '0.92rem' }}>📊 Task completion — last {adherence?.days || adherenceDays} days</div>
                <select value={adherenceDays} onChange={(e) => { const d = parseInt(e.target.value); setAdherenceDays(d); loadAdherence(d); }} style={{ padding: '0.3rem 0.5rem', borderRadius: 6, border: '1px solid #D1D5DB', fontSize: '0.82rem' }}>
                  <option value={7}>Last 7 days</option>
                  <option value={30}>Last 30 days</option>
                  <option value={90}>Last 90 days</option>
                </select>
              </div>
              {adherenceLoading ? (
                <div style={{ color: '#92400E', fontSize: '0.85rem' }}>Loading…</div>
              ) : !adherence || adherence.tasks.length === 0 ? (
                <div style={{ color: '#92400E', fontSize: '0.85rem' }}>No active tasks to report on.</div>
              ) : (
                <>
                  <div style={{ fontSize: '0.78rem', color: '#92400E', marginBottom: '0.5rem' }}>
                    {adherence.totalShifts} shift{adherence.totalShifts !== 1 ? 's' : ''} in this period · "Not addressed" = daily tasks with no entry on a shift. Rows where misses outweigh completions are highlighted.
                  </div>
                  <div style={{ overflow: 'auto' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.8rem' }}>
                      <thead>
                        <tr style={{ textAlign: 'left', color: '#78350F' }}>
                          <th style={{ padding: '0.3rem 0.4rem' }}>Task</th>
                          <th>When</th>
                          <th style={{ textAlign: 'right' }}>Done</th>
                          <th style={{ textAlign: 'right' }}>Skipped</th>
                          <th style={{ textAlign: 'right' }}>Refused</th>
                          <th style={{ textAlign: 'right' }}>Not addressed</th>
                          <th>Last done</th>
                        </tr>
                      </thead>
                      <tbody>
                        {adherence.tasks.map(t => {
                          const completed = t.completed || 0, skipped = t.skipped || 0, refused = t.refused || 0;
                          const notAddressed = t.cadence === 'weekly' ? null : Math.max(0, (adherence.totalShifts || 0) - completed - skipped - refused);
                          const flag = (skipped + refused) > completed || (notAddressed != null && notAddressed > completed);
                          return (
                            <tr key={t.task_id} style={{ borderTop: '1px solid #FEF3C7', background: flag ? '#FEF2F2' : undefined }}>
                              <td style={{ padding: '0.3rem 0.4rem', fontWeight: 600 }}>{t.task_name}</td>
                              <td>{t.cadence === 'weekly' ? '🗓️ Weekly' : '📅 Daily'}</td>
                              <td style={{ textAlign: 'right', color: '#065F46', fontWeight: 700 }}>{completed}</td>
                              <td style={{ textAlign: 'right', color: '#92400E' }}>{skipped}</td>
                              <td style={{ textAlign: 'right', color: '#991B1B' }}>{refused}</td>
                              <td style={{ textAlign: 'right', color: notAddressed ? '#991B1B' : '#9CA3AF', fontWeight: notAddressed ? 700 : 400 }}>{notAddressed == null ? '—' : notAddressed}</td>
                              <td style={{ color: '#6B7280' }}>{t.last_completed ? new Date(t.last_completed).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : 'never'}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </>
              )}
            </div>
          )}

          {showImport && (
            <div style={{ background: '#EFF6FF', border: '1px solid #BFDBFE', borderRadius: 10, padding: '0.9rem', marginBottom: '1rem' }}>
              <div style={{ fontWeight: 700, fontSize: '0.92rem', marginBottom: '0.35rem' }}>📥 Import from MIDAS SHC Homemaking assessment</div>
              <div style={{ fontSize: '0.8rem', color: '#1E40AF', marginBottom: '0.5rem' }}>
                Paste the JSON produced by Claude reading the MIDAS assessment, then Parse → review the reconciliation → Import.
              </div>
              <textarea
                placeholder='{ "source": "midas_shc_homemaking", "assessmentTotals": { "minsPerWeek": 291 }, "tasks": [ … ] }'
                value={rawJson}
                onChange={(e) => setRawJson(e.target.value)}
                rows={5}
                style={{ width: '100%', padding: '0.5rem', borderRadius: 6, border: '1px solid #93C5FD', fontFamily: 'monospace', fontSize: '0.78rem', resize: 'vertical', marginBottom: '0.5rem' }}
              />
              <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
                <button onClick={parseJson} className="btn btn-sm btn-secondary" disabled={!rawJson.trim()}>Parse &amp; preview</button>
                <label style={{ fontSize: '0.82rem', display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
                  <input type="checkbox" checked={replaceExisting} onChange={(e) => setReplaceExisting(e.target.checked)} />
                  Replace existing tasks (re-import of updated assessment)
                </label>
              </div>
              {parseError && <div style={{ marginTop: '0.5rem', color: '#B91C1C', fontSize: '0.83rem' }}>{parseError}</div>}

              {parsed && (
                <div style={{ marginTop: '0.6rem' }}>
                  <div style={{
                    padding: '0.5rem 0.7rem', borderRadius: 6, fontSize: '0.83rem', marginBottom: '0.5rem',
                    background: reconcileOk === false ? '#FEE2E2' : reconcileOk === true ? '#D1FAE5' : '#F3F4F6',
                    color: reconcileOk === false ? '#991B1B' : reconcileOk === true ? '#065F46' : '#374151'
                  }}>
                    {parsed.tasks.length} task(s) · computed <b>{previewMinsPerWeek} min/week</b> ({(previewMinsPerWeek / 15).toFixed(2)} units)
                    {expectedMins != null && (reconcileOk
                      ? ` · ✅ matches assessment total (${expectedMins})`
                      : ` · ⚠️ assessment says ${expectedMins} — mismatch, recheck the read`)}
                  </div>
                  <div style={{ maxHeight: 180, overflow: 'auto', border: '1px solid #BFDBFE', borderRadius: 6, background: '#fff' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.78rem' }}>
                      <thead><tr style={{ background: '#DBEAFE', textAlign: 'left' }}>
                        <th style={{ padding: '0.3rem 0.5rem' }}>Task</th><th>Cat</th><th>x/wk</th><th>min</th><th>Days</th><th>Time</th>
                      </tr></thead>
                      <tbody>
                        {parsed.tasks.map((t, i) => (
                          <tr key={i} style={{ borderTop: '1px solid #EFF6FF' }}>
                            <td style={{ padding: '0.3rem 0.5rem' }}>{t.taskName}</td>
                            <td>{t.category || 'iadl'}</td>
                            <td>{t.weeklyFrequency || 1}</td>
                            <td>{t.allottedMinutes || 0}</td>
                            <td>{t.daysOfWeek || '—'}</td>
                            <td>{t.timeOfDay || 'any'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <button onClick={runImport} className="btn btn-sm btn-primary" disabled={importing} style={{ marginTop: '0.5rem' }}>
                    {importing ? 'Importing…' : `Import ${parsed.tasks.length} task(s)${replaceExisting ? ' (replace current)' : ''}`}
                  </button>
                </div>
              )}

              {importResult && (
                <div style={{ marginTop: '0.5rem', color: '#065F46', fontSize: '0.83rem' }}>
                  ✅ Imported {importResult.imported} task(s){importResult.replacedExisting ? ', replaced previous list' : ''}.
                  {importResult.reconciliation?.match === false && ' (⚠️ totals did not reconcile — review tasks below.)'}
                </div>
              )}
            </div>
          )}

          {/* Add/Edit form */}
          <div style={{ background: editingId ? '#FEF3C7' : '#F9FAFB', borderRadius: 10, padding: '0.9rem', marginBottom: '1rem' }}>
            <div style={{ fontWeight: 700, marginBottom: '0.5rem', fontSize: '0.92rem' }}>
              {editingId ? '✏️ Edit Task' : '+ Add Task'}
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr', gap: '0.5rem', marginBottom: '0.5rem' }}>
              <input
                placeholder="Task name (e.g. Dust/Vacuum)"
                value={form.taskName}
                onChange={(e) => setForm({ ...form, taskName: e.target.value })}
                style={inp}
              />
              <select value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} style={inp}>
                {CATEGORIES.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
              </select>
              <input
                type="number" min="0" step="5"
                placeholder="Min/task"
                value={form.allottedMinutes}
                onChange={(e) => setForm({ ...form, allottedMinutes: parseInt(e.target.value) || 0 })}
                style={inp}
              />
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 2fr 1fr', gap: '0.5rem', marginBottom: '0.5rem' }}>
              <select value={form.cadence} onChange={(e) => setForm({ ...form, cadence: e.target.value })} style={inp} title="Daily = every shift; Weekly = once per week">
                <option value="daily">📅 Daily</option>
                <option value="weekly">🗓️ Weekly</option>
              </select>
              <input
                type="number" min="1" step="1"
                placeholder="x / week"
                value={form.weeklyFrequency}
                onChange={(e) => setForm({ ...form, weeklyFrequency: parseInt(e.target.value) || 1 })}
                style={inp}
              />
              <input
                placeholder="Days (e.g. Mon,Wed,Fri or Daily)"
                value={form.daysOfWeek}
                onChange={(e) => setForm({ ...form, daysOfWeek: e.target.value })}
                style={inp}
              />
              <select value={form.timeOfDay} onChange={(e) => setForm({ ...form, timeOfDay: e.target.value })} style={inp}>
                <option value="any">Any time</option>
                <option value="AM">AM</option>
                <option value="PM">PM</option>
              </select>
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
              No care tasks yet. Add tasks above, import a MIDAS assessment, and caregivers will see them as a checklist during the shift.
            </div>
          ) : (
            <div>
              {tasks.map(t => (
                <div key={t.id} style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', padding: '0.7rem 0.9rem', border: '1px solid #E5E7EB', borderRadius: 10, marginBottom: '0.4rem', background: '#fff' }}>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontWeight: 600, fontSize: '0.95rem' }}>{t.task_name}</div>
                    {t.description && <div style={{ color: '#6B7280', fontSize: '0.82rem', marginTop: '0.15rem' }}>{t.description}</div>}
                    <div style={{ color: '#9CA3AF', fontSize: '0.75rem', marginTop: '0.2rem' }}>
                      <b style={{ color: t.cadence === 'weekly' ? '#7C3AED' : '#2563EB' }}>{t.cadence === 'weekly' ? '🗓️ Weekly' : '📅 Daily'}</b>
                      {' · '}{CATEGORIES.find(c => c.value === t.category)?.label || t.category}
                      {' · '}{t.weekly_frequency || 1}×/wk × {t.allotted_minutes} min = <b>{(t.weekly_frequency || 1) * (t.allotted_minutes || 0)} min/wk</b>
                      {t.days_of_week ? ` · ${t.days_of_week}` : ''}
                      {t.time_of_day && t.time_of_day !== 'any' ? ` · ${t.time_of_day}` : ''}
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
