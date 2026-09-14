// src/components/caregiver/IncidentReportForm.jsx - caregiver reports an incident from the field
// Posts to POST /api/incidents/caregiver-report. The office gets an incident_alert
// notification and the report lands in Clinical → Incidents as an open case.
import React, { useState } from 'react';
import { API_BASE_URL } from '../../config';
import { toast } from '../Toast';
import { INCIDENT_TYPES } from '../../utils/incidentOptions';
import { getTodayCT } from '../../utils/timezone';

const MAX_PHOTOS = 3;

const labelStyle = { display: 'block', fontWeight: '700', marginBottom: '0.5rem', fontSize: '0.9rem', color: '#374151' };
const inputStyle = { width: '100%', padding: '0.75rem', border: '2px solid #E5E7EB', borderRadius: '8px', fontSize: '1rem', boxSizing: 'border-box' };

const IncidentReportForm = ({ token, clients = [], onClose }) => {
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [photos, setPhotos] = useState([]); // [{ dataUri, fileName }]
  const [form, setForm] = useState({
    clientId: '',
    incidentType: '',
    incidentDate: getTodayCT(),
    incidentTime: '',
    description: '',
    injuriesOrDamage: '',
    actionsTaken: '',
    witnesses: '',
  });
  const set = (k, v) => setForm(p => ({ ...p, [k]: v }));

  // Same downscale-to-JPEG approach as the clock-out visit photos (CaregiverDashboard
  // handlePhotoFile): max 1600px, ~82% quality, keeps the upload well under the limit.
  const addPhoto = async (file) => {
    if (!file) return;
    if (photos.length >= MAX_PHOTOS) { toast(`Up to ${MAX_PHOTOS} photos`, 'warning'); return; }
    if (!file.type.startsWith('image/')) { toast('Pick an image file', 'error'); return; }
    if (file.size > 15_000_000) { toast('Photo too large (15MB max)', 'error'); return; }
    try {
      const dataUrl = await new Promise((resolve, reject) => {
        const r = new FileReader(); r.onload = () => resolve(r.result); r.onerror = reject; r.readAsDataURL(file);
      });
      const img = new Image();
      await new Promise((resolve, reject) => { img.onload = resolve; img.onerror = reject; img.src = dataUrl; });
      const MAX = 1600;
      const scale = Math.min(1, MAX / Math.max(img.width, img.height));
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(img.width * scale);
      canvas.height = Math.round(img.height * scale);
      canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
      const compressed = canvas.toDataURL('image/jpeg', 0.82);
      if (compressed.length * 0.75 > 5_000_000) { toast('Photo too large after compression', 'error'); return; }
      setPhotos(prev => [...prev, { dataUri: compressed, fileName: (file.name || 'photo').replace(/\.[^.]+$/, '') + '.jpg' }]);
    } catch {
      toast('Could not read that photo', 'error');
    }
  };

  const handleSubmit = async () => {
    if (!form.clientId) { toast('Please pick the client', 'warning'); return; }
    if (!form.incidentType) { toast('Please pick what happened', 'warning'); return; }
    if (!form.incidentDate) { toast('Please enter the date', 'warning'); return; }
    if (!form.description.trim()) { toast('Please describe what happened', 'warning'); return; }

    setSubmitting(true);
    try {
      const res = await fetch(`${API_BASE_URL}/api/incidents/caregiver-report`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...form, photos }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || 'Failed');
      setSubmitted(true);
    } catch (e) {
      toast(`${e.message === 'Failed' ? 'Failed to submit.' : e.message} Please call the office directly.`, 'error');
    } finally {
      setSubmitting(false);
    }
  };

  if (submitted) return (
    <div style={{ textAlign: 'center', padding: '2rem' }}>
      <div style={{ fontSize: '3rem', marginBottom: '1rem' }}>✅</div>
      <h3 style={{ margin: '0 0 0.5rem', color: '#111827' }}>Incident Reported</h3>
      <p style={{ color: '#6B7280', marginBottom: '1.5rem' }}>
        The office has been notified and will follow up with you.
      </p>
      <p style={{ fontSize: '0.85rem', color: '#9CA3AF' }}>
        If anyone is hurt or in danger, call 911 first, then call the office.
      </p>
      <button onClick={onClose} style={{
        marginTop: '1rem', padding: '0.75rem 1.5rem', background: '#2ABBA7', color: '#fff',
        border: 'none', borderRadius: '10px', cursor: 'pointer', fontWeight: '700', fontSize: '1rem'
      }}>Done</button>
    </div>
  );

  const canSubmit = !submitting && form.clientId && form.incidentType && form.incidentDate && form.description.trim();

  return (
    <div>
      <div style={{ textAlign: 'center', marginBottom: '1.5rem' }}>
        <div style={{ fontSize: '2.5rem', marginBottom: '0.5rem' }}>⚠️</div>
        <h3 style={{ margin: 0, fontSize: '1.2rem', color: '#111827' }}>Report an Incident</h3>
        <p style={{ margin: '0.5rem 0 0', color: '#6B7280', fontSize: '0.9rem' }}>
          Falls, injuries, medication problems, missing property, or anything unsafe. Report it the same day.
        </p>
      </div>

      <div style={{ marginBottom: '1rem' }}>
        <label style={labelStyle}>Client *</label>
        <select value={form.clientId} onChange={e => set('clientId', e.target.value)} style={inputStyle}>
          <option value="">Select client...</option>
          {clients.map(c => <option key={c.id} value={c.id}>{c.first_name} {c.last_name}</option>)}
        </select>
      </div>

      <div style={{ marginBottom: '1rem' }}>
        <label style={labelStyle}>What happened? *</label>
        <select value={form.incidentType} onChange={e => set('incidentType', e.target.value)} style={inputStyle}>
          <option value="">Select type...</option>
          {INCIDENT_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
        </select>
      </div>

      <div style={{ display: 'flex', gap: '0.75rem', marginBottom: '1rem' }}>
        <div style={{ flex: 1 }}>
          <label style={labelStyle}>Date *</label>
          <input type="date" value={form.incidentDate} max={getTodayCT()} onChange={e => set('incidentDate', e.target.value)} style={inputStyle} />
        </div>
        <div style={{ flex: 1 }}>
          <label style={labelStyle}>Time</label>
          <input type="time" value={form.incidentTime} onChange={e => set('incidentTime', e.target.value)} style={inputStyle} />
        </div>
      </div>

      <div style={{ marginBottom: '1rem' }}>
        <label style={labelStyle}>Describe what happened *</label>
        <textarea rows={4} value={form.description} onChange={e => set('description', e.target.value)}
          placeholder="Facts only: what you saw, heard, and did."
          style={{ ...inputStyle, fontSize: '0.95rem', resize: 'vertical' }} />
      </div>

      <div style={{ marginBottom: '1rem' }}>
        <label style={labelStyle}>Injuries or damage</label>
        <textarea rows={2} value={form.injuriesOrDamage} onChange={e => set('injuriesOrDamage', e.target.value)}
          placeholder="Who was hurt, what was damaged or missing" style={{ ...inputStyle, fontSize: '0.95rem', resize: 'vertical' }} />
      </div>

      <div style={{ marginBottom: '1rem' }}>
        <label style={labelStyle}>What you did about it</label>
        <textarea rows={2} value={form.actionsTaken} onChange={e => set('actionsTaken', e.target.value)}
          placeholder="Called 911, called family, helped the client up, etc." style={{ ...inputStyle, fontSize: '0.95rem', resize: 'vertical' }} />
      </div>

      <div style={{ marginBottom: '1rem' }}>
        <label style={labelStyle}>Anyone else there?</label>
        <input type="text" value={form.witnesses} onChange={e => set('witnesses', e.target.value)}
          placeholder="Names of anyone who saw it" style={inputStyle} />
      </div>

      <div style={{ marginBottom: '1.25rem' }}>
        <label style={labelStyle}>Photos (optional, up to {MAX_PHOTOS})</label>
        {photos.length > 0 && (
          <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', marginBottom: '0.5rem' }}>
            {photos.map((ph, i) => (
              <div key={i} style={{ position: 'relative' }}>
                <img src={ph.dataUri} alt="" style={{ width: 72, height: 72, objectFit: 'cover', borderRadius: 8, border: '1px solid #E5E7EB' }} />
                <button onClick={() => setPhotos(prev => prev.filter((_, j) => j !== i))}
                  style={{ position: 'absolute', top: -6, right: -6, width: 22, height: 22, borderRadius: '50%', border: 'none', background: '#DC2626', color: '#fff', cursor: 'pointer', fontSize: 12 }}>×</button>
              </div>
            ))}
          </div>
        )}
        {photos.length < MAX_PHOTOS && (
          <input type="file" accept="image/*" capture="environment"
            onChange={e => { addPhoto(e.target.files?.[0]); e.target.value = ''; }} />
        )}
      </div>

      <div style={{ padding: '0.875rem', background: '#FEF2F2', borderRadius: '8px', border: '1px solid #FCA5A5', marginBottom: '1.25rem' }}>
        <p style={{ margin: 0, fontSize: '0.85rem', color: '#B91C1C', fontWeight: '600' }}>
          ⚠️ If anyone is hurt or in danger, call 911 first. This report notifies the office right away.
        </p>
      </div>

      <div style={{ display: 'flex', gap: '0.75rem' }}>
        <button onClick={onClose} style={{
          flex: 1, padding: '0.875rem', background: '#fff', color: '#374151',
          border: '2px solid #D1D5DB', borderRadius: '10px', cursor: 'pointer', fontWeight: '600', fontSize: '1rem'
        }}>Cancel</button>
        <button onClick={handleSubmit} disabled={!canSubmit}
          style={{
            flex: 2, padding: '0.875rem', background: '#DC2626', color: '#fff',
            border: 'none', borderRadius: '10px', cursor: 'pointer', fontWeight: '700', fontSize: '1rem',
            opacity: canSubmit ? 1 : 0.6
          }}>
          {submitting ? 'Submitting...' : '⚠️ Submit Incident Report'}
        </button>
      </div>
    </div>
  );
};

export default IncidentReportForm;
