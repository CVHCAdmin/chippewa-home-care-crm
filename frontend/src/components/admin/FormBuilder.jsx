// FormBuilder.jsx — Create custom forms, fill & submit against clients/caregivers

import { useState, useEffect } from 'react';

const API = import.meta.env.VITE_API_URL || '';

const FIELD_TYPES = [
  { value: 'text',     label: 'Text Input',     icon: '✏️' },
  { value: 'textarea', label: 'Long Text',       icon: '📄' },
  { value: 'select',   label: 'Dropdown',        icon: '🔽' },
  { value: 'checkbox', label: 'Checkbox',        icon: '☑️' },
  { value: 'radio',    label: 'Multiple Choice', icon: '🔘' },
  { value: 'number',   label: 'Number',          icon: '🔢' },
];

const CATEGORIES = ['assessment','incident','physician_order','consent','intake','hr','general'];

const genId = () => Math.random().toString(36).slice(2, 8);

export default function FormBuilder({ token }) {
  const [tab, setTab] = useState('templates');
  const [templates, setTemplates] = useState([]);
  const [submissions, setSubmissions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [editTemplate, setEditTemplate] = useState(null); // null = list, obj = edit
  const [viewSubmission, setViewSubmission] = useState(null);
  const [fillModal, setFillModal] = useState(null); // { template, entityType, entityId }
  const [clients, setClients] = useState([]);
  const [caregivers, setCaregivers] = useState([]);
  const [msg, setMsg] = useState('');
  const [filterCat, setFilterCat] = useState('');

  const h = { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` };
  const flash = (m, ok = true) => { setMsg({ text: m, ok }); setTimeout(() => setMsg(''), 3500); };

  const load = async () => {
    setLoading(true);
    try {
      const [tR, sR, cR, cgR] = await Promise.all([
        fetch(`${API}/api/forms/templates?active=all`, { headers: h }),
        fetch(`${API}/api/forms/submissions?limit=100`, { headers: h }),
        fetch(`${API}/api/clients`, { headers: h }),
        fetch(`${API}/api/caregivers`, { headers: h }),
      ]);
      setTemplates(await tR.json());
      setSubmissions(await sR.json());
      const cData = await cR.json(); setClients(Array.isArray(cData) ? cData : cData.clients || []);
      const cgData = await cgR.json(); setCaregivers(Array.isArray(cgData) ? cgData : cgData.caregivers || []);
    } catch (e) {}
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const newTemplate = () => setEditTemplate({
    id: null, name: '', description: '', category: 'general',
    requires_signature: false, auto_attach_to: 'client', is_active: true,
    fields: []
  });

  const saveTemplate = async () => {
    if (!editTemplate.name) return flash('Name is required', false);
    try {
      const method = editTemplate.id ? 'PUT' : 'POST';
      const url = editTemplate.id ? `${API}/api/forms/templates/${editTemplate.id}` : `${API}/api/forms/templates`;
      const body = { name: editTemplate.name, description: editTemplate.description, category: editTemplate.category,
        fields: editTemplate.fields, requiresSignature: editTemplate.requires_signature,
        autoAttachTo: editTemplate.auto_attach_to, isActive: editTemplate.is_active };
      await fetch(url, { method, headers: h, body: JSON.stringify(body) });
      flash('Template saved');
      setEditTemplate(null);
      load();
    } catch (e) { flash('Error saving', false); }
  };

  const deleteTemplate = async (id) => {
    if (!confirm('Deactivate this template?')) return;
    await fetch(`${API}/api/forms/templates/${id}`, { method: 'DELETE', headers: h });
    flash('Deactivated'); load();
  };

  // Field editing
  const addField = () => {
    const field = { id: genId(), type: 'text', label: '', required: false, options: [] };
    setEditTemplate(t => ({ ...t, fields: [...t.fields, field] }));
  };
  const updateField = (idx, updates) => setEditTemplate(t => {
    const fields = [...t.fields]; fields[idx] = { ...fields[idx], ...updates }; return { ...t, fields };
  });
  const removeField = (idx) => setEditTemplate(t => ({ ...t, fields: t.fields.filter((_, i) => i !== idx) }));
  const moveField = (idx, dir) => setEditTemplate(t => {
    const fields = [...t.fields];
    const swap = idx + dir;
    if (swap < 0 || swap >= fields.length) return t;
    [fields[idx], fields[swap]] = [fields[swap], fields[idx]];
    return { ...t, fields };
  });

  const catColor = (c) => ({ assessment:'#3B82F6', incident:'#EF4444', physician_order:'#8B5CF6', consent:'#F59E0B', intake:'#10B981', hr:'#6366F1', general:'#6B7280' }[c] || '#6B7280');

  const tabStyle = (t) => ({ padding: '0.5rem 1rem', border: 'none', borderBottom: `3px solid ${tab === t ? '#3B82F6' : 'transparent'}`, background: 'none', cursor: 'pointer', fontWeight: tab === t ? 700 : 400, color: tab === t ? '#1D4ED8' : '#6B7280', fontSize: '0.92rem' });

  const filteredTemplates = filterCat ? templates.filter(t => t.category === filterCat) : templates;

  // ── FORM FILLER ──
  const FormFiller = ({ template, onClose }) => {
    const [formData, setFormData] = useState({});
    const [entityType, setEntityType] = useState(template.auto_attach_to === 'caregiver' ? 'caregiver' : 'client');
    const [entityId, setEntityId] = useState('');
    const [signature, setSignature] = useState('');
    const [saving, setSaving] = useState(false);

    const submit = async () => {
      setSaving(true);
      try {
        await fetch(`${API}/api/forms/submissions`, {
          method: 'POST', headers: h,
          body: JSON.stringify({ templateId: template.id, entityType, entityId: entityId || null, data: formData, status: 'submitted', signature: template.requires_signature ? signature : undefined })
        });
        flash('Form submitted');
        onClose(); load();
      } catch (e) { flash('Error submitting', false); }
      setSaving(false);
    };

    return (
      <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 2000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1rem' }} onClick={onClose}>
        <div style={{ background: '#fff', borderRadius: '12px', padding: '1.5rem', maxWidth: '560px', width: '100%', maxHeight: '90vh', overflowY: 'auto', boxShadow: '0 20px 60px rgba(0,0,0,0.3)' }} onClick={e => e.stopPropagation()}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '1.25rem' }}>
            <div>
              <h3 style={{ margin: 0 }}>{template.name}</h3>
              {template.description && <p style={{ margin: '0.25rem 0 0', color: '#6B7280', fontSize: '0.85rem' }}>{template.description}</p>}
            </div>
            <button onClick={onClose} style={{ background: 'none', border: 'none', fontSize: '1.2rem', cursor: 'pointer', color: '#9CA3AF' }}>✕</button>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem', marginBottom: '1.25rem', paddingBottom: '1.25rem', borderBottom: '1px solid #E5E7EB' }}>
            <div>
              <label style={{ display: 'block', fontWeight: 600, fontSize: '0.85rem', marginBottom: '0.3rem' }}>Attach to</label>
              <select value={entityType} onChange={e => { setEntityType(e.target.value); setEntityId(''); }}
                style={{ width: '100%', padding: '0.5rem', borderRadius: '6px', border: '1px solid #D1D5DB', fontSize: '0.88rem' }}>
                <option value='client'>Client</option>
                <option value='caregiver'>Caregiver</option>
              </select>
            </div>
            <div>
              <label style={{ display: 'block', fontWeight: 600, fontSize: '0.85rem', marginBottom: '0.3rem' }}>
                {entityType === 'client' ? 'Client' : 'Caregiver'}
              </label>
              <select value={entityId} onChange={e => setEntityId(e.target.value)}
                style={{ width: '100%', padding: '0.5rem', borderRadius: '6px', border: '1px solid #D1D5DB', fontSize: '0.88rem' }}>
                <option value=''>Select...</option>
                {(entityType === 'client' ? clients : caregivers).map(e => (
                  <option key={e.id} value={e.id}>{e.first_name} {e.last_name}</option>
                ))}
              </select>
            </div>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', marginBottom: '1.25rem' }}>
            {template.fields.map((field) => (
              <div key={field.id}>
                <label style={{ display: 'block', fontWeight: 600, fontSize: '0.88rem', marginBottom: '0.3rem', color: '#374151' }}>
                  {field.label} {field.required && <span style={{ color: '#EF4444' }}>*</span>}
                </label>
                {field.type === 'textarea' && (
                  <textarea value={formData[field.id] || ''} onChange={e => setFormData(d => ({ ...d, [field.id]: e.target.value }))}
                    rows={3} style={{ width: '100%', padding: '0.5rem', borderRadius: '6px', border: '1px solid #D1D5DB', fontSize: '0.88rem', resize: 'vertical', boxSizing: 'border-box' }} />
                )}
                {(field.type === 'text' || field.type === 'number') && (
                  <input type={field.inputType || field.type} value={formData[field.id] || ''}
                    onChange={e => setFormData(d => ({ ...d, [field.id]: e.target.value }))}
                    style={{ width: '100%', padding: '0.5rem', borderRadius: '6px', border: '1px solid #D1D5DB', fontSize: '0.88rem', boxSizing: 'border-box' }} />
                )}
                {field.type === 'select' && (
                  <select value={formData[field.id] || ''} onChange={e => setFormData(d => ({ ...d, [field.id]: e.target.value }))}
                    style={{ width: '100%', padding: '0.5rem', borderRadius: '6px', border: '1px solid #D1D5DB', fontSize: '0.88rem' }}>
                    <option value=''>Select...</option>
                    {(field.options || []).map(o => <option key={o} value={o}>{o}</option>)}
                  </select>
                )}
                {field.type === 'checkbox' && (
                  <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer' }}>
                    <input type='checkbox' checked={!!formData[field.id]} onChange={e => setFormData(d => ({ ...d, [field.id]: e.target.checked }))} />
                    <span style={{ fontSize: '0.88rem' }}>Yes</span>
                  </label>
                )}
                {field.type === 'radio' && (
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem' }}>
                    {(field.options || []).map(o => (
                      <label key={o} style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', cursor: 'pointer', padding: '0.3rem 0.75rem', border: `1px solid ${formData[field.id] === o ? '#3B82F6' : '#D1D5DB'}`, borderRadius: '20px', background: formData[field.id] === o ? '#EFF6FF' : '#fff', fontSize: '0.85rem' }}>
                        <input type='radio' name={field.id} value={o} checked={formData[field.id] === o} onChange={() => setFormData(d => ({ ...d, [field.id]: o }))} style={{ display: 'none' }} />
                        {o}
                      </label>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>

          {template.requires_signature && (
            <div style={{ marginBottom: '1.25rem', padding: '0.85rem', background: '#FFF7ED', border: '1px solid #FED7AA', borderRadius: '8px' }}>
              <label style={{ display: 'block', fontWeight: 700, fontSize: '0.88rem', marginBottom: '0.35rem', color: '#92400E' }}>✍️ Signature Required</label>
              <input value={signature} onChange={e => setSignature(e.target.value)} placeholder='Type full name to sign...'
                style={{ width: '100%', padding: '0.5rem', borderRadius: '6px', border: '1px solid #FCD34D', fontSize: '0.95rem', fontFamily: 'cursive', boxSizing: 'border-box' }} />
            </div>
          )}

          <div style={{ display: 'flex', gap: '0.5rem' }}>
            <button onClick={submit} disabled={saving || (template.requires_signature && !signature)}
              style={{ flex: 1, padding: '0.7rem', borderRadius: '8px', border: 'none', background: '#3B82F6', color: '#fff', cursor: 'pointer', fontWeight: 700, fontSize: '0.92rem', opacity: saving ? 0.7 : 1 }}>
              {saving ? 'Submitting...' : '✓ Submit Form'}
            </button>
          </div>
        </div>
      </div>
    );
  };

  // ── TEMPLATE EDITOR ──
  if (editTemplate) return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '1.5rem', paddingBottom: '1rem', borderBottom: '2px solid #E5E7EB' }}>
        <button onClick={() => setEditTemplate(null)} style={{ background: '#F3F4F6', border: 'none', borderRadius: '8px', padding: '0.5rem 0.85rem', cursor: 'pointer', fontWeight: 600 }}>← Back</button>
        <h2 style={{ margin: 0 }}>{editTemplate.id ? 'Edit Template' : 'New Template'}</h2>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', maxWidth: '700px', marginBottom: '1.25rem' }}>
        <div>
          <label style={{ display: 'block', fontWeight: 600, fontSize: '0.88rem', marginBottom: '0.3rem' }}>Form Name *</label>
          <input value={editTemplate.name} onChange={e => setEditTemplate(t => ({ ...t, name: e.target.value }))}
            placeholder='e.g. Initial Client Assessment'
            style={{ width: '100%', padding: '0.6rem', borderRadius: '8px', border: '2px solid #E5E7EB', fontSize: '0.92rem', boxSizing: 'border-box' }} />
        </div>
        <div>
          <label style={{ display: 'block', fontWeight: 600, fontSize: '0.88rem', marginBottom: '0.3rem' }}>Category</label>
          <select value={editTemplate.category} onChange={e => setEditTemplate(t => ({ ...t, category: e.target.value }))}
            style={{ width: '100%', padding: '0.6rem', borderRadius: '8px', border: '2px solid #E5E7EB', fontSize: '0.92rem' }}>
            {CATEGORIES.map(c => <option key={c} value={c}>{c.replace(/_/g, ' ')}</option>)}
          </select>
        </div>
        <div style={{ gridColumn: '1 / -1' }}>
          <label style={{ display: 'block', fontWeight: 600, fontSize: '0.88rem', marginBottom: '0.3rem' }}>Description</label>
          <input value={editTemplate.description || ''} onChange={e => setEditTemplate(t => ({ ...t, description: e.target.value }))}
            placeholder='Brief description...'
            style={{ width: '100%', padding: '0.6rem', borderRadius: '8px', border: '2px solid #E5E7EB', fontSize: '0.92rem', boxSizing: 'border-box' }} />
        </div>
        <div style={{ display: 'flex', gap: '1.5rem', alignItems: 'center', gridColumn: '1 / -1' }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer' }}>
            <input type='checkbox' checked={editTemplate.requires_signature} onChange={e => setEditTemplate(t => ({ ...t, requires_signature: e.target.checked }))} />
            <span style={{ fontSize: '0.88rem', fontWeight: 600 }}>Requires Signature</span>
          </label>
          <div>
            <select value={editTemplate.auto_attach_to || 'client'} onChange={e => setEditTemplate(t => ({ ...t, auto_attach_to: e.target.value }))}
              style={{ padding: '0.4rem 0.65rem', borderRadius: '6px', border: '1px solid #D1D5DB', fontSize: '0.85rem' }}>
              <option value='client'>Attach to Client</option>
              <option value='caregiver'>Attach to Caregiver</option>
              <option value='both'>Both</option>
            </select>
          </div>
        </div>
      </div>

      <div style={{ maxWidth: '700px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
          <h4 style={{ margin: 0 }}>Fields ({editTemplate.fields.length})</h4>
          <button onClick={addField} style={{ padding: '0.4rem 0.9rem', borderRadius: '8px', border: 'none', background: '#3B82F6', color: '#fff', cursor: 'pointer', fontWeight: 600, fontSize: '0.85rem' }}>+ Add Field</button>
        </div>

        {editTemplate.fields.length === 0 && (
          <div style={{ textAlign: 'center', padding: '2rem', color: '#9CA3AF', background: '#F9FAFB', borderRadius: '10px', border: '2px dashed #E5E7EB', marginBottom: '1rem' }}>
            No fields yet — click "Add Field" to start building
          </div>
        )}

        {editTemplate.fields.map((field, idx) => (
          <div key={field.id} style={{ background: '#F9FAFB', border: '1px solid #E5E7EB', borderRadius: '10px', padding: '1rem', marginBottom: '0.6rem' }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 140px auto', gap: '0.6rem', alignItems: 'center', marginBottom: '0.6rem' }}>
              <input value={field.label} onChange={e => updateField(idx, { label: e.target.value })} placeholder={`Field ${idx + 1} label...`}
                style={{ padding: '0.5rem', borderRadius: '6px', border: '1px solid #D1D5DB', fontSize: '0.88rem' }} />
              <select value={field.type} onChange={e => updateField(idx, { type: e.target.value })}
                style={{ padding: '0.5rem', borderRadius: '6px', border: '1px solid #D1D5DB', fontSize: '0.85rem' }}>
                {FIELD_TYPES.map(t => <option key={t.value} value={t.value}>{t.icon} {t.label}</option>)}
              </select>
              <div style={{ display: 'flex', gap: '0.3rem' }}>
                <button onClick={() => moveField(idx, -1)} disabled={idx === 0} style={{ background: 'none', border: '1px solid #E5E7EB', borderRadius: '4px', cursor: 'pointer', padding: '0.25rem 0.4rem', opacity: idx === 0 ? 0.3 : 1 }}>↑</button>
                <button onClick={() => moveField(idx, 1)} disabled={idx === editTemplate.fields.length - 1} style={{ background: 'none', border: '1px solid #E5E7EB', borderRadius: '4px', cursor: 'pointer', padding: '0.25rem 0.4rem', opacity: idx === editTemplate.fields.length - 1 ? 0.3 : 1 }}>↓</button>
                <button onClick={() => removeField(idx)} style={{ background: 'none', border: '1px solid #FCA5A5', borderRadius: '4px', cursor: 'pointer', padding: '0.25rem 0.4rem', color: '#EF4444' }}>✕</button>
              </div>
            </div>
            <div style={{ display: 'flex', gap: '1rem', alignItems: 'center', flexWrap: 'wrap' }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', fontSize: '0.82rem', cursor: 'pointer' }}>
                <input type='checkbox' checked={field.required} onChange={e => updateField(idx, { required: e.target.checked })} />
                Required
              </label>
              {(field.type === 'select' || field.type === 'radio') && (
                <div style={{ flex: 1 }}>
                  <input value={(field.options || []).join(', ')} onChange={e => updateField(idx, { options: e.target.value.split(',').map(s => s.trim()).filter(Boolean) })}
                    placeholder='Options: Option 1, Option 2, Option 3'
                    style={{ width: '100%', padding: '0.4rem 0.6rem', borderRadius: '6px', border: '1px solid #D1D5DB', fontSize: '0.82rem', boxSizing: 'border-box' }} />
                </div>
              )}
            </div>
          </div>
        ))}

        <div style={{ display: 'flex', gap: '0.75rem', marginTop: '1.25rem' }}>
          <button onClick={saveTemplate} style={{ padding: '0.7rem 1.5rem', borderRadius: '8px', border: 'none', background: '#3B82F6', color: '#fff', cursor: 'pointer', fontWeight: 700, fontSize: '0.92rem' }}>✓ Save Template</button>
          <button onClick={() => setEditTemplate(null)} style={{ padding: '0.7rem 1.25rem', borderRadius: '8px', border: '1px solid #D1D5DB', background: '#fff', color: '#374151', cursor: 'pointer', fontWeight: 600, fontSize: '0.92rem' }}>Cancel</button>
        </div>
      </div>
    </div>
  );

  // ── MAIN VIEW ──
  return (
    <div>
      {msg && <div style={{ position: 'fixed', top: '1rem', right: '1rem', background: msg.ok ? '#D1FAE5' : '#FEE2E2', color: msg.ok ? '#065F46' : '#991B1B', padding: '0.75rem 1.25rem', borderRadius: '8px', zIndex: 9999, fontWeight: 600, boxShadow: '0 4px 12px rgba(0,0,0,0.15)' }}>{msg.text}</div>}
      {fillModal && <FormFiller template={fillModal} onClose={() => setFillModal(null)} />}

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.25rem', flexWrap: 'wrap', gap: '0.5rem' }}>
        <h2 style={{ margin: 0 }}>📝 Form Builder</h2>
        <button onClick={newTemplate} style={{ padding: '0.5rem 1.1rem', borderRadius: '8px', border: 'none', background: '#3B82F6', color: '#fff', cursor: 'pointer', fontWeight: 700, fontSize: '0.88rem' }}>+ New Template</button>
      </div>

      <div style={{ display: 'flex', borderBottom: '2px solid #E5E7EB', marginBottom: '1.25rem' }}>
        <button style={tabStyle('templates')} onClick={() => setTab('templates')}>📋 Templates ({templates.length})</button>
        <button style={tabStyle('submissions')} onClick={() => setTab('submissions')}>📨 Submissions ({submissions.length})</button>
      </div>

      {tab === 'templates' && (
        <>
          <div style={{ display: 'flex', gap: '0.4rem', marginBottom: '1rem', flexWrap: 'wrap' }}>
            <button onClick={() => setFilterCat('')} style={{ padding: '0.3rem 0.8rem', borderRadius: '20px', border: `1px solid ${!filterCat ? '#3B82F6' : '#E5E7EB'}`, background: !filterCat ? '#3B82F6' : '#fff', color: !filterCat ? '#fff' : '#374151', cursor: 'pointer', fontSize: '0.8rem', fontWeight: !filterCat ? 700 : 400 }}>All</button>
            {CATEGORIES.map(c => (
              <button key={c} onClick={() => setFilterCat(c === filterCat ? '' : c)} style={{ padding: '0.3rem 0.8rem', borderRadius: '20px', border: `1px solid ${filterCat === c ? catColor(c) : '#E5E7EB'}`, background: filterCat === c ? catColor(c) : '#fff', color: filterCat === c ? '#fff' : '#374151', cursor: 'pointer', fontSize: '0.8rem', fontWeight: filterCat === c ? 700 : 400 }}>{c.replace(/_/g,' ')}</button>
            ))}
          </div>

          {loading ? <div style={{ textAlign: 'center', padding: '3rem', color: '#9CA3AF' }}>Loading...</div>
          : filteredTemplates.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '3rem', color: '#9CA3AF', background: '#F9FAFB', borderRadius: '10px', border: '2px dashed #E5E7EB' }}>
              <div style={{ fontSize: '2rem', marginBottom: '0.5rem' }}>📝</div>
              No templates yet — click "New Template" to create one
            </div>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '0.75rem' }}>
              {filteredTemplates.map(t => (
                <div key={t.id} style={{ background: '#fff', border: `1px solid ${t.is_active ? '#E5E7EB' : '#F3F4F6'}`, borderTop: `3px solid ${catColor(t.category)}`, borderRadius: '10px', padding: '1rem', opacity: t.is_active ? 1 : 0.6 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '0.5rem' }}>
                    <span style={{ fontWeight: 700, fontSize: '0.95rem', color: '#111827' }}>{t.name}</span>
                    <span style={{ background: catColor(t.category) + '18', color: catColor(t.category), padding: '0.1rem 0.45rem', borderRadius: '10px', fontSize: '0.7rem', fontWeight: 700, whiteSpace: 'nowrap', marginLeft: '0.5rem' }}>{t.category.replace(/_/g,' ')}</span>
                  </div>
                  {t.description && <p style={{ margin: '0 0 0.5rem', fontSize: '0.8rem', color: '#6B7280', lineHeight: 1.4 }}>{t.description}</p>}
                  <div style={{ fontSize: '0.75rem', color: '#9CA3AF', marginBottom: '0.75rem', display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
                    <span>{t.fields?.length || 0} fields</span>
                    <span>{t.submission_count || 0} submissions</span>
                    {t.requires_signature && <span>✍️ Signature</span>}
                  </div>
                  <div style={{ display: 'flex', gap: '0.4rem' }}>
                    <button onClick={() => setFillModal(t)} style={{ flex: 1, padding: '0.4rem', borderRadius: '6px', border: 'none', background: '#3B82F6', color: '#fff', cursor: 'pointer', fontWeight: 600, fontSize: '0.8rem' }}>Fill Out</button>
                    <button onClick={() => setEditTemplate({ ...t, fields: typeof t.fields === 'string' ? JSON.parse(t.fields) : t.fields })} style={{ padding: '0.4rem 0.65rem', borderRadius: '6px', border: '1px solid #E5E7EB', background: '#fff', color: '#374151', cursor: 'pointer', fontSize: '0.8rem' }}>Edit</button>
                    <button onClick={() => deleteTemplate(t.id)} style={{ padding: '0.4rem 0.65rem', borderRadius: '6px', border: '1px solid #FCA5A5', background: '#fff', color: '#EF4444', cursor: 'pointer', fontSize: '0.8rem' }}>✕</button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {tab === 'submissions' && (
        loading ? <div style={{ textAlign: 'center', padding: '3rem', color: '#9CA3AF' }}>Loading...</div>
        : submissions.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '3rem', color: '#9CA3AF', background: '#F9FAFB', borderRadius: '10px', border: '2px dashed #E5E7EB' }}>
            <div style={{ fontSize: '2rem', marginBottom: '0.5rem' }}>📨</div>
            No submissions yet
          </div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.88rem' }}>
            <thead>
              <tr style={{ background: '#F9FAFB', borderBottom: '2px solid #E5E7EB' }}>
                {['Form','Category','Attached To','Submitted By','Date','Status'].map(h => (
                  <th key={h} style={{ textAlign: 'left', padding: '0.65rem 0.85rem', fontWeight: 700, color: '#374151', fontSize: '0.82rem' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {submissions.map((s, i) => (
                <tr key={s.id} style={{ borderBottom: '1px solid #F3F4F6', background: i % 2 === 0 ? '#fff' : '#FAFAFA' }}>
                  <td style={{ padding: '0.65rem 0.85rem', fontWeight: 600 }}>{s.template_name || s.form_name}</td>
                  <td style={{ padding: '0.65rem 0.85rem' }}><span style={{ background: catColor(s.category) + '18', color: catColor(s.category), padding: '0.1rem 0.45rem', borderRadius: '10px', fontSize: '0.72rem', fontWeight: 700 }}>{(s.category || 'general').replace(/_/g,' ')}</span></td>
                  <td style={{ padding: '0.65rem 0.85rem', color: '#6B7280' }}>{s.entity_type || '—'}</td>
                  <td style={{ padding: '0.65rem 0.85rem', color: '#6B7280' }}>{s.submitted_by_name}</td>
                  <td style={{ padding: '0.65rem 0.85rem', color: '#6B7280' }}>{new Date(s.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</td>
                  <td style={{ padding: '0.65rem 0.85rem' }}>
                    <span style={{ background: s.status === 'signed' ? '#D1FAE5' : '#EFF6FF', color: s.status === 'signed' ? '#065F46' : '#1D4ED8', padding: '0.15rem 0.5rem', borderRadius: '10px', fontSize: '0.75rem', fontWeight: 700 }}>{s.status}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )
      )}
    </div>
  );
}
