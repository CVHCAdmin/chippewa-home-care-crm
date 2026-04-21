// src/components/admin/JobPostingsAdmin.jsx
// Admin UI for managing job postings that appear on the public careers page.
// Empty/no published postings → careers page shows evergreen "building our pool" copy.
import React, { useState, useEffect, useCallback } from 'react';
import { API_BASE_URL } from '../../config';
import { toast } from '../Toast';

const s = {
  page: { maxWidth: 1100, margin: '0 auto', fontFamily: "'DM Sans', system-ui, sans-serif" },
  header: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.25rem' },
  h1: { margin: 0, fontSize: '1.6rem', fontWeight: 800, color: '#0F172A' },
  sub: { color: '#64748B', fontSize: '0.9rem', marginTop: 4 },
  btn: (color = '#2ABBA7', outline = false) => ({
    padding: '0.55rem 1.1rem',
    background: outline ? '#fff' : color,
    color: outline ? color : '#fff',
    border: outline ? `2px solid ${color}` : 'none',
    borderRadius: 8, cursor: 'pointer', fontWeight: 700, fontSize: '0.85rem',
  }),
  card: { background: '#fff', borderRadius: 14, border: '1px solid #E5E7EB', padding: '1.1rem', marginBottom: '0.75rem' },
  label: { display: 'block', fontWeight: 700, fontSize: '0.72rem', color: '#6B7280', marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.04em' },
  input: { width: '100%', padding: '0.55rem 0.75rem', border: '1px solid #D1D5DB', borderRadius: 8, fontSize: '0.9rem', boxSizing: 'border-box', outline: 'none', background: '#fff' },
  textarea: { width: '100%', padding: '0.55rem 0.75rem', border: '1px solid #D1D5DB', borderRadius: 8, fontSize: '0.9rem', boxSizing: 'border-box', outline: 'none', fontFamily: 'inherit', minHeight: 90, background: '#fff' },
  badge: (color = '#065F46', bg = '#D1FAE5') => ({ padding: '2px 10px', borderRadius: 99, fontSize: '0.72rem', fontWeight: 700, color, background: bg }),
  row: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' },
  modalBackdrop: { position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.55)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100, padding: '1rem' },
  modal: { background: '#fff', borderRadius: 14, maxWidth: 720, width: '100%', maxHeight: '92vh', overflowY: 'auto', padding: '1.5rem' },
  tab: (active) => ({
    padding: '0.5rem 1rem',
    border: 'none',
    background: 'transparent',
    cursor: 'pointer',
    fontWeight: active ? 800 : 500,
    color: active ? '#2ABBA7' : '#6B7280',
    borderBottom: `2px solid ${active ? '#2ABBA7' : 'transparent'}`,
    marginBottom: -2,
    fontSize: '0.85rem',
  }),
};

const EMPTY_FORM = {
  title: '',
  employmentType: 'part_time',
  location: '',
  payRangeMin: '',
  payRangeMax: '',
  payRateUnit: 'hour',
  summary: '',
  description: '',
  responsibilities: '',
  qualifications: '',
  isPublished: false,
  closesAt: '',
};

const STATUS_BADGE = (p) => {
  const now = new Date();
  if (p.closes_at && new Date(p.closes_at) <= now) return { text: 'Closed',    s: { color: '#991B1B', bg: '#FEE2E2' } };
  if (p.is_published)                             return { text: 'Published',  s: { color: '#065F46', bg: '#D1FAE5' } };
  return                                            { text: 'Draft',       s: { color: '#92400E', bg: '#FEF3C7' } };
};

const JobPostingsAdmin = ({ token }) => {
  const [postings, setPostings] = useState([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState('all'); // all | published | draft | closed
  const [editing, setEditing] = useState(null); // null | 'new' | postingObject
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);

  const hdr = { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' };

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const url = tab === 'all'
        ? `${API_BASE_URL}/api/job-postings`
        : `${API_BASE_URL}/api/job-postings?status=${tab}`;
      const r = await fetch(url, { headers: hdr });
      if (!r.ok) throw new Error('Failed to load postings');
      setPostings(await r.json());
    } catch (e) {
      toast('Error: ' + e.message, 'error');
    } finally {
      setLoading(false);
    }
  }, [tab, token]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { load(); }, [load]);

  const openNew = () => {
    setForm(EMPTY_FORM);
    setEditing('new');
  };

  const openEdit = (p) => {
    setForm({
      title: p.title || '',
      employmentType: p.employment_type || 'part_time',
      location: p.location || '',
      payRangeMin: p.pay_range_min ?? '',
      payRangeMax: p.pay_range_max ?? '',
      payRateUnit: p.pay_rate_unit || 'hour',
      summary: p.summary || '',
      description: p.description || '',
      responsibilities: p.responsibilities || '',
      qualifications: p.qualifications || '',
      isPublished: !!p.is_published,
      closesAt: p.closes_at ? p.closes_at.slice(0, 10) : '',
    });
    setEditing(p);
  };

  const save = async () => {
    if (!form.title.trim() || !form.description.trim()) {
      toast('Title and description are required', 'error');
      return;
    }
    setSaving(true);
    try {
      const payload = {
        title: form.title.trim(),
        employmentType: form.employmentType,
        location: form.location.trim() || null,
        payRangeMin: form.payRangeMin === '' ? null : Number(form.payRangeMin),
        payRangeMax: form.payRangeMax === '' ? null : Number(form.payRangeMax),
        payRateUnit: form.payRateUnit,
        summary: form.summary.trim() || null,
        description: form.description.trim(),
        responsibilities: form.responsibilities.trim() || null,
        qualifications: form.qualifications.trim() || null,
        isPublished: form.isPublished,
        closesAt: form.closesAt || null,
      };

      const url = editing === 'new'
        ? `${API_BASE_URL}/api/job-postings`
        : `${API_BASE_URL}/api/job-postings/${editing.id}`;
      const method = editing === 'new' ? 'POST' : 'PUT';

      const r = await fetch(url, { method, headers: hdr, body: JSON.stringify(payload) });
      if (!r.ok) {
        const err = await r.json().catch(() => ({}));
        throw new Error(err.error || 'Save failed');
      }
      toast(editing === 'new' ? 'Posting created' : 'Posting saved', 'success');
      setEditing(null);
      load();
    } catch (e) {
      toast('Error: ' + e.message, 'error');
    } finally {
      setSaving(false);
    }
  };

  const setStatus = async (p, action) => {
    try {
      const r = await fetch(`${API_BASE_URL}/api/job-postings/${p.id}/${action}`, {
        method: 'POST', headers: hdr,
      });
      if (!r.ok) throw new Error('Status change failed');
      load();
    } catch (e) {
      toast('Error: ' + e.message, 'error');
    }
  };

  const remove = async (p) => {
    if (!window.confirm(`Delete "${p.title}"? This cannot be undone.`)) return;
    try {
      const r = await fetch(`${API_BASE_URL}/api/job-postings/${p.id}`, {
        method: 'DELETE', headers: hdr,
      });
      if (!r.ok) throw new Error('Delete failed');
      toast('Posting deleted', 'success');
      load();
    } catch (e) {
      toast('Error: ' + e.message, 'error');
    }
  };

  const publishedCount = postings.filter(p => {
    const closed = p.closes_at && new Date(p.closes_at) <= new Date();
    return p.is_published && !closed;
  }).length;

  return (
    <div style={s.page}>
      <div style={s.header}>
        <div>
          <h1 style={s.h1}>📋 Job Postings</h1>
          <div style={s.sub}>
            {publishedCount === 0
              ? 'No published openings — website shows the evergreen "building our caregiver pool" copy.'
              : `${publishedCount} opening${publishedCount === 1 ? '' : 's'} live on the careers page.`}
          </div>
        </div>
        <button style={s.btn('#2ABBA7')} onClick={openNew}>+ New Posting</button>
      </div>

      <div style={{ display: 'flex', gap: '0.5rem', borderBottom: '1px solid #E5E7EB', marginBottom: '1rem' }}>
        {['all','published','draft','closed'].map(t => (
          <button key={t} style={s.tab(tab === t)} onClick={() => setTab(t)}>
            {t[0].toUpperCase() + t.slice(1)}
          </button>
        ))}
      </div>

      {loading ? (
        <div style={{ padding: '2rem', textAlign: 'center', color: '#6B7280' }}>Loading…</div>
      ) : postings.length === 0 ? (
        <div style={{ ...s.card, textAlign: 'center', color: '#6B7280', padding: '2.5rem' }}>
          <div style={{ fontSize: '2rem', marginBottom: '0.5rem' }}>📭</div>
          <div style={{ fontWeight: 700, color: '#374151' }}>No postings in this view</div>
          <div style={{ fontSize: '0.85rem', marginTop: 4 }}>Create a new posting to publish an opening.</div>
        </div>
      ) : postings.map(p => {
        const badge = STATUS_BADGE(p);
        const closed = p.closes_at && new Date(p.closes_at) <= new Date();
        return (
          <div key={p.id} style={s.card}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '1rem' }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: 4 }}>
                  <div style={{ fontWeight: 800, fontSize: '1.05rem', color: '#0F172A' }}>{p.title}</div>
                  <span style={s.badge(badge.s.color, badge.s.bg)}>{badge.text}</span>
                </div>
                <div style={{ color: '#64748B', fontSize: '0.85rem' }}>
                  {p.employment_type.replace('_',' ')}
                  {p.location ? ` · ${p.location}` : ''}
                  {p.pay_range_min ? ` · $${p.pay_range_min}${p.pay_range_max && p.pay_range_max !== p.pay_range_min ? `–$${p.pay_range_max}` : ''}/${p.pay_rate_unit}` : ''}
                </div>
                {p.summary && <div style={{ color: '#374151', fontSize: '0.88rem', marginTop: 6 }}>{p.summary}</div>}
                <div style={{ color: '#9CA3AF', fontSize: '0.78rem', marginTop: 6 }}>
                  {Number(p.applications_count_live ?? p.applications_count ?? 0)} application{(p.applications_count_live ?? p.applications_count) === 1 ? '' : 's'}
                  {p.published_at && ` · Posted ${new Date(p.published_at).toLocaleDateString()}`}
                  {p.closes_at && ` · Closes ${new Date(p.closes_at).toLocaleDateString()}`}
                </div>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6, minWidth: 120 }}>
                <button style={s.btn('#2ABBA7', true)} onClick={() => openEdit(p)}>Edit</button>
                {p.is_published && !closed && (
                  <button style={s.btn('#6B7280', true)} onClick={() => setStatus(p, 'unpublish')}>Unpublish</button>
                )}
                {!p.is_published && !closed && (
                  <button style={s.btn('#059669', true)} onClick={() => setStatus(p, 'publish')}>Publish</button>
                )}
                {!closed && (
                  <button style={s.btn('#B91C1C', true)} onClick={() => setStatus(p, 'close')}>Close</button>
                )}
                <button style={s.btn('#B91C1C', true)} onClick={() => remove(p)}>Delete</button>
              </div>
            </div>
          </div>
        );
      })}

      {editing && (
        <div style={s.modalBackdrop} onClick={(e) => { if (e.target === e.currentTarget) setEditing(null); }}>
          <div style={s.modal}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
              <h2 style={{ margin: 0, fontSize: '1.25rem', fontWeight: 800 }}>
                {editing === 'new' ? 'New Job Posting' : `Edit: ${editing.title}`}
              </h2>
              <button style={{ ...s.btn('#6B7280', true), padding: '0.3rem 0.7rem' }} onClick={() => setEditing(null)}>✕</button>
            </div>

            <div style={{ marginBottom: '0.75rem' }}>
              <label style={s.label}>Title *</label>
              <input style={s.input} value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))} placeholder="Caregiver — Chippewa Falls Area" />
            </div>

            <div style={s.row}>
              <div>
                <label style={s.label}>Employment Type</label>
                <select style={s.input} value={form.employmentType} onChange={e => setForm(f => ({ ...f, employmentType: e.target.value }))}>
                  <option value="part_time">Part Time</option>
                  <option value="full_time">Full Time</option>
                  <option value="prn">PRN / As Needed</option>
                  <option value="contract">Contract</option>
                </select>
              </div>
              <div>
                <label style={s.label}>Location</label>
                <input style={s.input} value={form.location} onChange={e => setForm(f => ({ ...f, location: e.target.value }))} placeholder="Eau Claire, WI" />
              </div>
            </div>

            <div style={{ ...s.row, gridTemplateColumns: '1fr 1fr 1fr', marginTop: '0.75rem' }}>
              <div>
                <label style={s.label}>Pay Min</label>
                <input type="number" step="0.01" style={s.input} value={form.payRangeMin} onChange={e => setForm(f => ({ ...f, payRangeMin: e.target.value }))} />
              </div>
              <div>
                <label style={s.label}>Pay Max</label>
                <input type="number" step="0.01" style={s.input} value={form.payRangeMax} onChange={e => setForm(f => ({ ...f, payRangeMax: e.target.value }))} />
              </div>
              <div>
                <label style={s.label}>Per</label>
                <select style={s.input} value={form.payRateUnit} onChange={e => setForm(f => ({ ...f, payRateUnit: e.target.value }))}>
                  <option value="hour">hour</option>
                  <option value="visit">visit</option>
                  <option value="week">week</option>
                  <option value="year">year</option>
                </select>
              </div>
            </div>

            <div style={{ marginTop: '0.75rem' }}>
              <label style={s.label}>Short Summary (shown on listing card)</label>
              <input style={s.input} maxLength={240} value={form.summary} onChange={e => setForm(f => ({ ...f, summary: e.target.value }))} placeholder="Flexible hours, paid training, serve clients in the Chippewa Valley." />
            </div>

            <div style={{ marginTop: '0.75rem' }}>
              <label style={s.label}>Full Description *</label>
              <textarea style={{ ...s.textarea, minHeight: 130 }} value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} placeholder="Describe the role, the team, the clients they'll serve…" />
            </div>

            <div style={{ marginTop: '0.75rem' }}>
              <label style={s.label}>Responsibilities (one per line)</label>
              <textarea style={s.textarea} value={form.responsibilities} onChange={e => setForm(f => ({ ...f, responsibilities: e.target.value }))} placeholder={'Bathing, dressing, grooming assistance\nLight housekeeping and meal prep\nEVV clock-in/out on each visit'} />
            </div>

            <div style={{ marginTop: '0.75rem' }}>
              <label style={s.label}>Qualifications (one per line)</label>
              <textarea style={s.textarea} value={form.qualifications} onChange={e => setForm(f => ({ ...f, qualifications: e.target.value }))} placeholder={'Valid driver\'s license and reliable transportation\nAble to pass a Wisconsin caregiver background check\nCompassion and reliability'} />
            </div>

            <div style={{ ...s.row, marginTop: '0.75rem' }}>
              <div>
                <label style={s.label}>Closes On (optional)</label>
                <input type="date" style={s.input} value={form.closesAt} onChange={e => setForm(f => ({ ...f, closesAt: e.target.value }))} />
              </div>
              <div style={{ display: 'flex', alignItems: 'flex-end' }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.9rem', fontWeight: 600 }}>
                  <input type="checkbox" checked={form.isPublished} onChange={e => setForm(f => ({ ...f, isPublished: e.target.checked }))} />
                  Publish immediately (visible on website)
                </label>
              </div>
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.5rem', marginTop: '1.25rem' }}>
              <button style={s.btn('#6B7280', true)} onClick={() => setEditing(null)} disabled={saving}>Cancel</button>
              <button style={s.btn('#2ABBA7')} onClick={save} disabled={saving}>
                {saving ? 'Saving…' : (editing === 'new' ? 'Create Posting' : 'Save Changes')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default JobPostingsAdmin;
