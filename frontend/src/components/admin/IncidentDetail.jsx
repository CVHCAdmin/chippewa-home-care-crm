// src/components/admin/IncidentDetail.jsx — one incident's case file
// Opened from IncidentReporting (same list → detail pattern as CaregiverManagement →
// CaregiverDetail). Everything here reads/writes /api/incidents/:id/* in clinicalRoutes.
import React, { useState, useEffect, useCallback } from 'react';
import { API_BASE_URL } from '../../config';
import { toast } from '../Toast';
import { confirm } from '../ConfirmModal';
import SignaturePad from '../SignaturePad';
import { formatDate, formatDateTime } from '../../utils/datetime';
import { getTodayCT } from '../../utils/timezone';
import {
  INCIDENT_TYPES, SEVERITIES, INCIDENT_STATUSES, DISPOSITIONS, MANDATORY_REPORT_STATUSES,
  ENTRY_TYPES, ATTACHMENT_CATEGORIES, TRAINING_ACK_METHODS, incidentLabel,
  ATTACHMENT_MAX_BYTES, ATTACHMENT_ACCEPT,
} from '../../utils/incidentOptions';

const DAY = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

// "09:00:00" → "9:00 AM" (schedule times are plain clock times)
const clock = (t) => {
  if (!t) return '';
  const [h, m] = String(t).split(':').map(Number);
  return `${h % 12 === 0 ? 12 : h % 12}:${String(m).padStart(2, '0')} ${h >= 12 ? 'PM' : 'AM'}`;
};
const fileSize = (n) => (n == null ? '' : n > 1_000_000 ? `${(n / 1_000_000).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1000))} KB`);

const toForm = (i) => ({
  clientId: i.client_id || '',
  caregiverId: i.caregiver_id || '',
  incidentType: i.incident_type || 'other',
  severity: i.severity || 'moderate',
  incidentDate: i.incident_date_ymd || '',
  incidentTime: i.incident_time_hhmm || '',
  description: i.description || '',
  witnesses: i.witnesses || '',
  injuriesOrDamage: i.injuries_or_damage || '',
  actionsTaken: i.actions_taken || '',
  followUpRequired: !!i.follow_up_required,
  followUpNotes: i.follow_up_notes || '',
  reportedBy: i.reported_by || '',
  reportedDate: i.reported_date_ymd || '',
  reporterContactName: i.reporter_contact_name || '',
  reporterPhone: i.reporter_phone || '',
  reporterEmail: i.reporter_email || '',
  responseDueDate: i.response_due_date_ymd || '',
  responseSentDate: i.response_sent_date_ymd || '',
  status: i.status || 'open',
  disposition: i.disposition || '',
  findings: i.findings || '',
  payerResponseNotes: i.payer_response_notes || '',
  mandatoryReportStatus: i.mandatory_report_status || '',
  mandatoryReportDetails: i.mandatory_report_details || '',
  closedDate: i.closed_date_ymd || '',
});

const STATUS_COLORS = { open: '#DC2626', investigating: '#D97706', closed: '#059669' };

export default function IncidentDetail({ incidentId, token, onBack }) {
  const [loading, setLoading] = useState(true);
  const [incident, setIncident] = useState(null);
  const [form, setForm] = useState(null);
  const [notes, setNotes] = useState([]);
  const [attachments, setAttachments] = useState([]);
  const [schedule, setSchedule] = useState(null);
  const [clients, setClients] = useState([]);
  const [caregivers, setCaregivers] = useState([]);
  const [saving, setSaving] = useState(false);
  const [downloading, setDownloading] = useState('');
  const [includeSchedule, setIncludeSchedule] = useState(false); // packet Exhibit A; off unless the payer asked for visit records
  const [noteForm, setNoteForm] = useState({ entryDate: getTodayCT(), entryType: 'interview', summary: '' });
  const [uploadForm, setUploadForm] = useState({ category: 'payer_notice', description: '' });
  const [uploading, setUploading] = useState(false);
  const [removalForm, setRemovalForm] = useState({ fromDate: getTodayCT(), postOpenShifts: true, coverageWeeks: 4 });
  const [scheduleBusy, setScheduleBusy] = useState(false);
  const [ackForm, setAckForm] = useState({ supervisorName: '', method: 'in_person' });
  const [sigOpen, setSigOpen] = useState(false);

  const api = useCallback(async (path, opts = {}) => {
    const res = await fetch(`${API_BASE_URL}${path}`, {
      ...opts,
      headers: { Authorization: `Bearer ${token}`, ...(opts.body ? { 'Content-Type': 'application/json' } : {}) },
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body.error || `Request failed (${res.status})`);
    return body;
  }, [token]);

  const loadCase = useCallback(async () => {
    try {
      const [inc, n, a, s] = await Promise.all([
        api(`/api/incidents/${incidentId}`),
        api(`/api/incidents/${incidentId}/notes`),
        api(`/api/incidents/${incidentId}/attachments`),
        api(`/api/incidents/${incidentId}/caregiver-schedule`),
      ]);
      setIncident(inc);
      setForm(toForm(inc));
      setNotes(Array.isArray(n) ? n : []);
      setAttachments(Array.isArray(a) ? a : []);
      setSchedule(s);
    } catch (e) {
      toast(e.message, 'error');
    } finally {
      setLoading(false);
    }
  }, [api, incidentId]);

  useEffect(() => { loadCase(); }, [loadCase]);
  useEffect(() => {
    // Same lists the create form uses (IncidentReporting.loadData).
    Promise.all([api('/api/clients').catch(() => []), api('/api/users/caregivers').catch(() => [])])
      .then(([c, cg]) => { setClients(Array.isArray(c) ? c : []); setCaregivers(Array.isArray(cg) ? cg : []); });
  }, [api]);

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const saveCase = async (overrides = {}) => {
    const body = { ...form, ...overrides };
    setSaving(true);
    try {
      await api(`/api/incidents/${incidentId}`, { method: 'PUT', body: JSON.stringify(body) });
      toast('Incident saved');
      await loadCase();
    } catch (e) {
      toast(e.message, 'error');
    } finally {
      setSaving(false);
    }
  };

  const downloadPdf = async (kind) => {
    setDownloading(kind);
    try {
      const path = kind === 'packet' ? `response-packet${includeSchedule ? '?includeSchedule=1' : ''}` : 'pdf';
      const res = await fetch(`${API_BASE_URL}/api/incidents/${incidentId}/${path}`, { headers: { Authorization: `Bearer ${token}` } });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'PDF generation failed');
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${kind === 'packet' ? 'incident-response-packet' : 'incident-report'}-${incident.incident_number || incidentId}.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      toast('PDF downloaded');
    } catch (e) {
      toast('Download failed: ' + e.message, 'error');
    } finally {
      setDownloading('');
    }
  };

  // ── Timeline ──
  const addNote = async () => {
    if (!noteForm.summary.trim()) { toast('Describe what happened', 'error'); return; }
    try {
      await api(`/api/incidents/${incidentId}/notes`, { method: 'POST', body: JSON.stringify(noteForm) });
      setNoteForm({ entryDate: getTodayCT(), entryType: noteForm.entryType, summary: '' });
      const n = await api(`/api/incidents/${incidentId}/notes`);
      setNotes(n);
    } catch (e) { toast(e.message, 'error'); }
  };
  const deleteNote = async (noteId) => {
    if (!(await confirm('Delete this investigation entry?', { danger: true }))) return;
    try {
      await api(`/api/incidents/${incidentId}/notes/${noteId}`, { method: 'DELETE' });
      setNotes(prev => prev.filter(n => n.id !== noteId));
    } catch (e) { toast(e.message, 'error'); }
  };

  // ── Attachments ──
  const uploadFile = async (file) => {
    if (!file) return;
    if (file.size > ATTACHMENT_MAX_BYTES) { toast('File is too large (7 MB max)', 'error'); return; }
    setUploading(true);
    try {
      const dataUri = await new Promise((resolve, reject) => {
        const r = new FileReader(); r.onload = () => resolve(r.result); r.onerror = reject; r.readAsDataURL(file);
      });
      await api(`/api/incidents/${incidentId}/attachments`, {
        method: 'POST',
        body: JSON.stringify({ category: uploadForm.category, fileName: file.name, dataUri, description: uploadForm.description }),
      });
      setUploadForm(f => ({ ...f, description: '' }));
      setAttachments(await api(`/api/incidents/${incidentId}/attachments`));
      toast('Attached');
    } catch (e) {
      toast('Upload failed: ' + e.message, 'error');
    } finally {
      setUploading(false);
    }
  };
  const viewAttachment = async (att) => {
    try {
      const res = await fetch(`${API_BASE_URL}/api/incidents/${incidentId}/attachments/${att.id}`, { headers: { Authorization: `Bearer ${token}` } });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'Could not open file');
      const url = URL.createObjectURL(await res.blob());
      const a = document.createElement('a');
      a.href = url; a.target = '_blank'; a.rel = 'noopener'; a.download = att.file_name;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (e) { toast(e.message, 'error'); }
  };
  const deleteAttachment = async (att) => {
    if (!(await confirm(`Delete ${att.file_name}? This cannot be undone.`, { danger: true }))) return;
    try {
      await api(`/api/incidents/${incidentId}/attachments/${att.id}`, { method: 'DELETE' });
      setAttachments(prev => prev.filter(a => a.id !== att.id));
    } catch (e) { toast(e.message, 'error'); }
  };

  // ── Caregiver schedule ──
  const removeCaregiver = async () => {
    const msg = `Remove ${incident.caregiver_name} from ${incident.client_name}'s schedule starting ${formatDate(removalForm.fromDate)}?\n\n`
      + `Their visits with this client stop being scheduled, billed, and paid from that date.`
      + (removalForm.postOpenShifts ? ` Visits for the next ${removalForm.coverageWeeks} weeks are posted as open shifts for coverage.` : ' No open shifts will be posted, so arrange coverage yourself.')
      + `\n\nYou can return them to the schedule later from this page.`;
    if (!(await confirm(msg, { danger: true }))) return;
    setScheduleBusy(true);
    try {
      const r = await api(`/api/incidents/${incidentId}/remove-caregiver`, { method: 'POST', body: JSON.stringify(removalForm) });
      toast(r.summary || 'Caregiver removed from this client');
      await loadCase();
    } catch (e) { toast(e.message, 'error'); } finally { setScheduleBusy(false); }
  };
  const returnCaregiver = async () => {
    if (!(await confirm(`Return ${incident.caregiver_name} to ${incident.client_name}'s schedule today? Unclaimed coverage shifts are cancelled. Visits a replacement already took stay with the replacement.`))) return;
    setScheduleBusy(true);
    try {
      const r = await api(`/api/incidents/${incidentId}/return-caregiver`, { method: 'POST', body: JSON.stringify({}) });
      toast(r.summary || 'Caregiver returned to the schedule');
      await loadCase();
    } catch (e) { toast(e.message, 'error'); } finally { setScheduleBusy(false); }
  };

  // ── Training acknowledgement ──
  const startSigning = () => {
    if (!ackForm.supervisorName.trim()) { toast('Enter who is reviewing it with the caregiver', 'error'); return; }
    setSigOpen(true);
  };
  const onSign = async (dataUri, typedName) => {
    // SignaturePad shows a thrown error in its own dialog and stays open.
    await api(`/api/incidents/${incidentId}/training-acknowledgement`, {
      method: 'POST',
      body: JSON.stringify({ signature: dataUri, signerName: typedName, supervisorName: ackForm.supervisorName, method: ackForm.method }),
    });
    setSigOpen(false);
    toast('Signed and added to the caregiver\'s training record');
    await loadCase();
  };

  if (loading) return <div className="loading"><div className="spinner"></div></div>;
  if (!incident || !form) {
    return (
      <div className="card card-centered">
        <p>This incident could not be loaded.</p>
        <button className="btn btn-secondary" onClick={onBack}>Back to incidents</button>
      </div>
    );
  }

  const today = getTodayCT();
  const removalActive = !!(incident.caregiver_removed_from_ymd && !incident.caregiver_returned_on_ymd);
  const dueSoon = form.responseDueDate && !incident.response_sent_date_ymd && incident.status !== 'closed';
  const removal = schedule?.removal || null;

  return (
    <div>
      <div className="page-header" style={{ flexWrap: 'wrap', gap: '0.75rem' }}>
        <div>
          <button className="btn btn-secondary btn-sm" onClick={onBack} style={{ marginBottom: '0.5rem' }}>← Back to incidents</button>
          <h2 style={{ margin: 0 }}>
            {incident.incident_number || 'Incident'} · {incident.client_name}
          </h2>
          <div style={{ color: '#6B7280', marginTop: '0.25rem' }}>
            {incidentLabel('type', incident.incident_type)} · {formatDate(incident.incident_date_ymd)}
            {incident.reported_by_role === 'caregiver' && ' · Reported from the caregiver app'}
          </div>
        </div>
        <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
          <span className="badge" style={{ background: STATUS_COLORS[incident.status || 'open'], color: '#fff' }}>
            {incidentLabel('status', incident.status || 'open').toUpperCase()}
          </span>
          <button className="btn btn-secondary" onClick={() => downloadPdf('report')} disabled={!!downloading}>
            {downloading === 'report' ? 'Generating…' : '🖨️ Print Incident Report'}
          </button>
          <button className="btn btn-primary" onClick={() => downloadPdf('packet')} disabled={!!downloading}>
            {downloading === 'packet' ? 'Generating…' : '📄 Payer Response Packet'}
          </button>
          <label style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', fontSize: '0.85rem', color: '#374151' }}
            title="Adds every scheduled visit at the client's home this year. Only include it if the payer asked for visit records.">
            <input type="checkbox" checked={includeSchedule} onChange={e => setIncludeSchedule(e.target.checked)} />
            Include visit schedule
          </label>
        </div>
      </div>

      {dueSoon && (
        <div className={`alert ${form.responseDueDate <= today ? 'alert-error' : 'alert-warning'}`}>
          Response to {incident.reported_by || 'the reporter'} is due {formatDate(form.responseDueDate)}.
          {' '}When it has been sent, use “Mark response sent” below.
        </div>
      )}

      {/* ── Case details ── */}
      <div className="card card-form">
        <h3>Case Details</h3>
        <div className="form-grid-2">
          <div className="form-group">
            <label>Client *</label>
            <select value={form.clientId} onChange={e => set('clientId', e.target.value)} disabled={removalActive}>
              <option value="">Select client...</option>
              {clients.map(c => <option key={c.id} value={c.id}>{c.first_name} {c.last_name}</option>)}
              {!clients.some(c => c.id === form.clientId) && form.clientId && <option value={form.clientId}>{incident.client_name}</option>}
            </select>
          </div>
          <div className="form-group">
            <label>Caregiver Involved</label>
            <select value={form.caregiverId} onChange={e => set('caregiverId', e.target.value)} disabled={removalActive}>
              <option value="">None</option>
              {caregivers.map(cg => <option key={cg.id} value={cg.id}>{cg.first_name} {cg.last_name}</option>)}
              {!caregivers.some(cg => cg.id === form.caregiverId) && form.caregiverId && <option value={form.caregiverId}>{incident.caregiver_name}</option>}
            </select>
          </div>
          <div className="form-group">
            <label>Incident Type *</label>
            <select value={form.incidentType} onChange={e => set('incidentType', e.target.value)}>
              {INCIDENT_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
            </select>
          </div>
          <div className="form-group">
            <label>Severity</label>
            <select value={form.severity} onChange={e => set('severity', e.target.value)}>
              {SEVERITIES.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
            </select>
          </div>
          <div className="form-group">
            <label>Date It Happened *</label>
            <input type="date" value={form.incidentDate} onChange={e => set('incidentDate', e.target.value)} />
          </div>
          <div className="form-group">
            <label>Time</label>
            <input type="time" value={form.incidentTime} onChange={e => set('incidentTime', e.target.value)} />
          </div>
          <div className="form-group">
            <label>Reported By</label>
            <input type="text" value={form.reportedBy} onChange={e => set('reportedBy', e.target.value)} placeholder="Person or organization" />
          </div>
          <div className="form-group">
            <label>Date Reported</label>
            <input type="date" value={form.reportedDate} onChange={e => set('reportedDate', e.target.value)} />
          </div>
          <div className="form-group">
            <label>Reporter Contact Name</label>
            <input type="text" value={form.reporterContactName} onChange={e => set('reporterContactName', e.target.value)} placeholder="e.g. the care manager's name" />
          </div>
          <div className="form-group">
            <label>Reporter Phone</label>
            <input type="tel" value={form.reporterPhone} onChange={e => set('reporterPhone', e.target.value)} />
          </div>
          <div className="form-group">
            <label>Reporter Email</label>
            <input type="email" value={form.reporterEmail} onChange={e => set('reporterEmail', e.target.value)} />
          </div>
          <div className="form-group">
            <label>Response Due Date</label>
            <input type="date" value={form.responseDueDate} onChange={e => set('responseDueDate', e.target.value)} />
          </div>
        </div>
        <div className="form-group">
          <label>Description *</label>
          <textarea rows="4" value={form.description} onChange={e => set('description', e.target.value)} />
        </div>
        <div className="form-group">
          <label>Witnesses</label>
          <textarea rows="2" value={form.witnesses} onChange={e => set('witnesses', e.target.value)} />
        </div>
        <div className="form-group">
          <label>Injuries or Damage</label>
          <textarea rows="2" value={form.injuriesOrDamage} onChange={e => set('injuriesOrDamage', e.target.value)} />
        </div>
        <div className="form-group">
          <label>Actions Taken</label>
          <textarea rows="2" value={form.actionsTaken} onChange={e => set('actionsTaken', e.target.value)} />
        </div>
        <div className="form-group">
          <label style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
            <input type="checkbox" checked={form.followUpRequired} onChange={e => set('followUpRequired', e.target.checked)} />
            <span>Follow-up Required</span>
          </label>
        </div>
        {form.followUpRequired && (
          <div className="form-group">
            <label>Follow-up Notes</label>
            <textarea rows="2" value={form.followUpNotes} onChange={e => set('followUpNotes', e.target.value)} />
          </div>
        )}
        {removalActive && (
          <p className="text-muted" style={{ fontSize: '0.85rem' }}>Client and caregiver are locked while the caregiver is removed from the schedule.</p>
        )}
        <div className="form-actions">
          <button className="btn btn-primary" onClick={() => saveCase()} disabled={saving}>{saving ? 'Saving…' : 'Save Case Details'}</button>
        </div>
      </div>

      {/* ── Investigation timeline ── */}
      <div className="card">
        <h3>Investigation Timeline</h3>
        {notes.length === 0 ? (
          <p className="text-muted">No entries yet. Log every call, interview, document reviewed, and action taken.</p>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table className="table">
              <thead><tr><th>Date</th><th>Type</th><th>What happened</th><th>Logged by</th><th></th></tr></thead>
              <tbody>
                {notes.map(n => (
                  <tr key={n.id}>
                    <td style={{ whiteSpace: 'nowrap' }}>{formatDate(n.entry_date_ymd)}</td>
                    <td style={{ whiteSpace: 'nowrap' }}>{incidentLabel('entry', n.entry_type)}</td>
                    <td style={{ whiteSpace: 'pre-wrap' }}>{n.summary}</td>
                    <td style={{ whiteSpace: 'nowrap' }}>{n.created_by_name || '—'}</td>
                    <td><button className="btn btn-sm btn-danger" onClick={() => deleteNote(n.id)}>Delete</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <div className="form-grid-2" style={{ marginTop: '1rem' }}>
          <div className="form-group">
            <label>Date</label>
            <input type="date" value={noteForm.entryDate} onChange={e => setNoteForm(f => ({ ...f, entryDate: e.target.value }))} />
          </div>
          <div className="form-group">
            <label>Type</label>
            <select value={noteForm.entryType} onChange={e => setNoteForm(f => ({ ...f, entryType: e.target.value }))}>
              {ENTRY_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
            </select>
          </div>
        </div>
        <div className="form-group">
          <label>What happened</label>
          <textarea rows="3" value={noteForm.summary} onChange={e => setNoteForm(f => ({ ...f, summary: e.target.value }))}
            placeholder="Who you spoke with and what they said, what you reviewed, what you did. Facts only." />
        </div>
        <div className="form-actions">
          <button className="btn btn-primary" onClick={addNote}>Add Entry</button>
        </div>
      </div>

      {/* ── Caregiver & schedule ── */}
      <div className="card">
        <h3>Caregiver &amp; Schedule</h3>
        {!schedule?.caregiverId ? (
          <p className="text-muted">No caregiver is named on this incident. Pick one in Case Details to manage their schedule here.</p>
        ) : (
          <>
            <p style={{ marginTop: 0 }}>
              <strong>{incident.caregiver_name}</strong> with <strong>{incident.client_name}</strong>
              {schedule.lastVisit ? <> · last clocked visit {formatDate(schedule.lastVisit)}</> : ' · no clocked visits on record'}
              {' '}· {schedule.upcomingVisits} visit{schedule.upcomingVisits === 1 ? '' : 's'} scheduled in the next 4 weeks
            </p>
            {schedule.schedules.length > 0 ? (
              <div style={{ overflowX: 'auto' }}>
                <table className="table">
                  <thead><tr><th>When</th><th>Time</th><th>Status</th></tr></thead>
                  <tbody>
                    {schedule.schedules.map(s => (
                      <tr key={s.id}>
                        <td>{s.day_of_week != null ? `Every ${s.frequency === 'biweekly' ? 'other ' : ''}${DAY[s.day_of_week]}` : formatDate(s.date)}</td>
                        <td>{clock(s.start_time)} – {clock(s.end_time)}</td>
                        <td>
                          {s.suspended_from
                            ? <span className="badge badge-warning">Paused from {formatDate(s.suspended_from)}</span>
                            : <span className="badge badge-success">Active</span>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="text-muted">This caregiver has no current or upcoming schedule with this client.</p>
            )}

            {removalActive ? (
              <div className="alert alert-warning" style={{ marginTop: '1rem' }}>
                <div>
                  <strong>Removed from this client's schedule effective {formatDate(incident.caregiver_removed_from_ymd)}</strong> pending investigation.
                  {removal?.open_shifts?.length ? ` ${removal.open_shifts.length} visit${removal.open_shifts.length === 1 ? '' : 's'} were posted as open shifts for coverage.` : ''}
                </div>
                <div style={{ marginTop: '0.75rem' }}>
                  <button className="btn btn-secondary" onClick={returnCaregiver} disabled={scheduleBusy}>
                    {scheduleBusy ? 'Working…' : 'Return caregiver to schedule'}
                  </button>
                </div>
              </div>
            ) : (
              <div style={{ marginTop: '1rem', paddingTop: '1rem', borderTop: '1px solid #E5E7EB' }}>
                {incident.caregiver_returned_on_ymd && (
                  <p className="text-muted" style={{ marginTop: 0 }}>
                    Previously removed {formatDate(incident.caregiver_removed_from_ymd)} and returned {formatDate(incident.caregiver_returned_on_ymd)}.
                  </p>
                )}
                <h4 style={{ margin: '0 0 0.5rem' }}>Remove from this client pending investigation</h4>
                <div className="form-grid-3">
                  <div className="form-group">
                    <label>Starting</label>
                    <input type="date" min={today} value={removalForm.fromDate} onChange={e => setRemovalForm(f => ({ ...f, fromDate: e.target.value }))} />
                  </div>
                  <div className="form-group">
                    <label>Post visits for coverage</label>
                    <select value={removalForm.postOpenShifts ? 'yes' : 'no'} onChange={e => setRemovalForm(f => ({ ...f, postOpenShifts: e.target.value === 'yes' }))}>
                      <option value="yes">Yes, post as open shifts</option>
                      <option value="no">No, I will arrange coverage</option>
                    </select>
                  </div>
                  {removalForm.postOpenShifts && (
                    <div className="form-group">
                      <label>For the next</label>
                      <select value={removalForm.coverageWeeks} onChange={e => setRemovalForm(f => ({ ...f, coverageWeeks: Number(e.target.value) }))}>
                        {[1, 2, 3, 4, 6, 8].map(w => <option key={w} value={w}>{w} week{w === 1 ? '' : 's'}</option>)}
                      </select>
                    </div>
                  )}
                </div>
                <button className="btn btn-danger" onClick={removeCaregiver} disabled={scheduleBusy || schedule.schedules.length === 0}>
                  {scheduleBusy ? 'Working…' : 'Remove caregiver from this client'}
                </button>
              </div>
            )}
          </>
        )}
      </div>

      {/* ── Training acknowledgement ── */}
      <div className="card">
        <h3>Training Acknowledgement: Medication Handling &amp; Misappropriation</h3>
        {!incident.caregiver_id ? (
          <p className="text-muted">No caregiver is named on this incident.</p>
        ) : incident.training_ack_signed_at ? (
          <div>
            <p style={{ marginTop: 0 }}>
              Signed by <strong>{incident.training_ack_signer_name}</strong> on {formatDateTime(incident.training_ack_signed_at)},
              reviewed with {incident.training_ack_supervisor} ({incidentLabel('method', incident.training_ack_method).toLowerCase()}).
              It is on the caregiver's training record.
            </p>
            {incident.training_ack_signature && (
              <img src={incident.training_ack_signature} alt="Caregiver signature" style={{ maxWidth: 320, border: '1px solid #E5E7EB', borderRadius: 6, background: '#fff' }} />
            )}
          </div>
        ) : (
          <div>
            <ol style={{ paddingLeft: '1.25rem', lineHeight: 1.5 }}>
              <li>CVHC caregivers may remind a client a medication is due. They do not administer, set up, count, store, or remove medications.</li>
              <li>Caregivers do not touch or handle a client's controlled medications, and report any request to the office the same day.</li>
              <li>Zero tolerance for taking, borrowing, holding, or removing any client property, including medications, even if offered.</li>
              <li>Missing or disturbed medications, or a client's concern about them, are reported to the office the same day.</li>
              <li>Every visit is clocked in and out so records show exactly when the caregiver was in the home.</li>
            </ol>
            <div className="form-grid-2">
              <div className="form-group">
                <label>Reviewed with (supervisor name and title)</label>
                <input type="text" value={ackForm.supervisorName} onChange={e => setAckForm(f => ({ ...f, supervisorName: e.target.value }))} />
              </div>
              <div className="form-group">
                <label>How it was reviewed</label>
                <select value={ackForm.method} onChange={e => setAckForm(f => ({ ...f, method: e.target.value }))}>
                  {TRAINING_ACK_METHODS.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
                </select>
              </div>
            </div>
            <button className="btn btn-primary" onClick={startSigning}>✍️ Caregiver signs now</button>
            <p className="text-muted" style={{ fontSize: '0.85rem', marginBottom: 0 }}>
              Hand the device to {incident.caregiver_name}. Signing adds completed training records to their file.
            </p>
          </div>
        )}
      </div>

      {/* ── Attachments ── */}
      <div className="card">
        <h3>Attachments</h3>
        {attachments.length === 0 ? (
          <p className="text-muted">Nothing attached yet. Add the payer's notice, signed statements, and the background check letter.</p>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table className="table">
              <thead><tr><th>File</th><th>Kind</th><th>Size</th><th>Added</th><th></th></tr></thead>
              <tbody>
                {attachments.map(a => (
                  <tr key={a.id}>
                    <td>
                      <div style={{ fontWeight: 600 }}>{a.file_name}</div>
                      {a.description && <div className="text-muted" style={{ fontSize: '0.8rem' }}>{a.description}</div>}
                    </td>
                    <td>{incidentLabel('category', a.category)}</td>
                    <td>{fileSize(a.file_size)}</td>
                    <td style={{ whiteSpace: 'nowrap' }}>{formatDateTime(a.created_at)}{a.uploaded_by_name ? ` · ${a.uploaded_by_name}` : ''}</td>
                    <td style={{ whiteSpace: 'nowrap' }}>
                      <button className="btn btn-sm btn-secondary" onClick={() => viewAttachment(a)}>Open</button>{' '}
                      <button className="btn btn-sm btn-danger" onClick={() => deleteAttachment(a)}>Delete</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <div className="form-grid-3" style={{ marginTop: '1rem' }}>
          <div className="form-group">
            <label>Kind of document</label>
            <select value={uploadForm.category} onChange={e => setUploadForm(f => ({ ...f, category: e.target.value }))}>
              {ATTACHMENT_CATEGORIES.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
            </select>
          </div>
          <div className="form-group">
            <label>Note (optional)</label>
            <input type="text" value={uploadForm.description} onChange={e => setUploadForm(f => ({ ...f, description: e.target.value }))} />
          </div>
          <div className="form-group">
            <label>File (PDF or image, 7 MB max)</label>
            <input type="file" accept={ATTACHMENT_ACCEPT} disabled={uploading}
              onChange={e => { uploadFile(e.target.files?.[0]); e.target.value = ''; }} />
          </div>
        </div>
        {uploading && <p className="text-muted">Uploading…</p>}
      </div>

      {/* ── Conclusion & response ── */}
      <div className="card card-form">
        <h3>Conclusion &amp; Response</h3>
        <div className="form-grid-2">
          <div className="form-group">
            <label>Status</label>
            <select value={form.status} onChange={e => set('status', e.target.value)}>
              {INCIDENT_STATUSES.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
            </select>
          </div>
          <div className="form-group">
            <label>Conclusion</label>
            <select value={form.disposition} onChange={e => set('disposition', e.target.value)}>
              <option value="">Not yet determined</option>
              {DISPOSITIONS.map(d => <option key={d.value} value={d.value}>{d.label}</option>)}
            </select>
          </div>
          <div className="form-group">
            <label>Mandatory Report Decision</label>
            <select value={form.mandatoryReportStatus} onChange={e => set('mandatoryReportStatus', e.target.value)}>
              <option value="">Not recorded</option>
              {MANDATORY_REPORT_STATUSES.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
            </select>
          </div>
          <div className="form-group">
            <label>Response Sent On</label>
            <input type="date" value={form.responseSentDate} onChange={e => set('responseSentDate', e.target.value)} />
          </div>
        </div>
        <div className="form-group">
          <label>Mandatory Report Details</label>
          <textarea rows="2" value={form.mandatoryReportDetails} onChange={e => set('mandatoryReportDetails', e.target.value)}
            placeholder="Agency, date, confirmation number, or why a report was not required" />
        </div>
        <div className="form-group">
          <label>Findings</label>
          <textarea rows="4" value={form.findings} onChange={e => set('findings', e.target.value)}
            placeholder="What the investigation found. This text goes into the payer response letter." />
        </div>
        <div className="form-group">
          <label>Additional Information for the Payer</label>
          <textarea rows="3" value={form.payerResponseNotes} onChange={e => set('payerResponseNotes', e.target.value)}
            placeholder="Anything the payer asked that the case file has no field for. Printed in the response letter as its own numbered item." />
        </div>
        {form.status === 'closed' && (
          <div className="form-group" style={{ maxWidth: 260 }}>
            <label>Date Closed</label>
            <input type="date" value={form.closedDate} onChange={e => set('closedDate', e.target.value)} />
          </div>
        )}
        <div className="form-actions">
          <button className="btn btn-primary" onClick={() => saveCase()} disabled={saving}>{saving ? 'Saving…' : 'Save'}</button>
          {!incident.response_sent_date_ymd && (
            <button className="btn btn-secondary" onClick={() => saveCase({ responseSentDate: today })} disabled={saving}>Mark response sent today</button>
          )}
        </div>
      </div>

      <SignaturePad
        open={sigOpen}
        onClose={() => setSigOpen(false)}
        documentName="Medication Handling & Misappropriation Acknowledgement"
        onSign={onSign}
      />
    </div>
  );
}
