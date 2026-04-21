// src/components/OnboardingPacketPage.jsx
// Public, tokenized page the new hire visits to complete onboarding.
// Captures: deeper personal info, emergency contact, BGC consent (FCRA-style
// standalone disclosure with e-signature + IP + UA), and SSN (used only to
// submit WORCS; scrubbed once WORCS accepts the submission).
import React, { useState, useEffect, useCallback } from 'react';
import { useParams } from 'react-router-dom';
import { API_BASE_URL } from '../config';

const brand = {
  teal: '#2ABBA7', tealDark: '#1E9A89', navy: '#0F172A', slate: '#64748B',
  border: '#E5E7EB', bg: '#F8FAF9', good: '#059669',
};

const s = {
  page: { minHeight: '100vh', background: brand.bg, fontFamily: "'DM Sans', system-ui, sans-serif", padding: '2rem 1rem' },
  wrap: { maxWidth: 720, margin: '0 auto' },
  hero: { background: 'linear-gradient(135deg, #0F172A 0%, #1E293B 100%)', color: '#fff', padding: '1.75rem 2rem', borderRadius: '14px 14px 0 0' },
  heroTitle: { margin: 0, fontSize: '1.5rem', fontWeight: 800 },
  heroSub: { margin: '6px 0 0', color: 'rgba(255,255,255,0.8)', fontSize: '0.92rem' },
  stepBadge: { display: 'inline-block', background: 'rgba(42,187,167,0.2)', color: '#A7F3D0', padding: '3px 10px', borderRadius: 99, fontSize: '0.72rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 10 },

  card: { background: '#fff', padding: '1.5rem 2rem', borderBottom: `1px solid ${brand.border}` },
  cardLast: { background: '#fff', padding: '1.5rem 2rem', borderRadius: '0 0 14px 14px', border: `1px solid ${brand.border}`, borderTop: 'none' },
  section: { margin: 0, fontSize: '1.05rem', fontWeight: 800, color: brand.navy, marginBottom: '0.75rem', paddingBottom: '0.25rem', borderBottom: `2px solid ${brand.teal}`, display: 'inline-block' },
  row: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' },
  field: { marginBottom: '0.75rem' },
  label: { display: 'block', fontWeight: 700, fontSize: '0.72rem', color: '#6B7280', marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.04em' },
  input: { width: '100%', padding: '0.6rem 0.75rem', border: `1px solid #D1D5DB`, borderRadius: 8, fontSize: '0.95rem', boxSizing: 'border-box', background: '#fff', outline: 'none' },
  consent: { background: '#FFFBEB', border: '1px solid #FDE68A', borderRadius: 10, padding: '1rem', marginBottom: '1rem' },
  disclosure: { maxHeight: 260, overflowY: 'auto', padding: '0.75rem 1rem', background: '#fff', border: `1px solid ${brand.border}`, borderRadius: 8, fontSize: '0.82rem', color: '#374151', whiteSpace: 'pre-wrap', lineHeight: 1.55 },
  btn: (color = brand.teal, outline = false) => ({ padding: '0.7rem 1.5rem', background: outline ? '#fff' : color, color: outline ? color : '#fff', border: outline ? `2px solid ${color}` : 'none', borderRadius: 8, cursor: 'pointer', fontWeight: 700, fontSize: '0.95rem' }),
  alert: (kind) => ({
    padding: '0.9rem 1rem', borderRadius: 10, margin: '1rem 0', fontSize: '0.92rem',
    background: kind === 'error' ? '#FEF2F2' : kind === 'success' ? '#F0FDF4' : '#EFF6FF',
    border: `1px solid ${kind === 'error' ? '#FECACA' : kind === 'success' ? '#BBF7D0' : '#BFDBFE'}`,
    color: kind === 'error' ? '#991B1B' : kind === 'success' ? '#065F46' : '#1E40AF',
  }),
};

const emptyForm = {
  preferredName: '', legalFirstName: '', legalMiddleName: '', legalLastName: '',
  pronouns: '',
  address: '', city: '', state: 'WI', zip: '', dateOfBirth: '',
  driversLicenseNumber: '', driversLicenseState: 'WI',
  emergencyContactName: '', emergencyContactRelationship: '',
  emergencyContactPhone: '', emergencyContactEmail: '',
  bgcConsentSignature: '', consentChecked: false, ssn: '',
};

const OnboardingPacketPage = () => {
  const { token } = useParams();
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);
  const [packet, setPacket] = useState(null);
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [savedAt, setSavedAt] = useState(null);
  const [submitted, setSubmitted] = useState(false);
  const [submitError, setSubmitError] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch(`${API_BASE_URL}/api/onboarding-packets/public/${token}`);
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || 'Unable to load packet.');
      setPacket(data);
      setForm(f => ({
        ...f,
        preferredName: data.preferredName || '',
        legalFirstName: data.legalFirstName || data.firstName || '',
        legalMiddleName: data.legalMiddleName || '',
        legalLastName: data.legalLastName || data.lastName || '',
        pronouns: data.pronouns || '',
        address: data.address || '', city: data.city || '', state: data.state || 'WI', zip: data.zip || '',
        dateOfBirth: data.dateOfBirth ? String(data.dateOfBirth).slice(0, 10) : '',
        driversLicenseNumber: data.driversLicenseNumber || '',
        driversLicenseState: data.driversLicenseState || 'WI',
        emergencyContactName: data.emergencyContactName || '',
        emergencyContactRelationship: data.emergencyContactRelationship || '',
        emergencyContactPhone: data.emergencyContactPhone || '',
        emergencyContactEmail: data.emergencyContactEmail || '',
      }));
      if (data.status === 'submitted') setSubmitted(true);
    } catch (err) {
      setLoadError(err.message);
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => { load(); }, [load]);

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const saveDraft = async () => {
    if (!packet) return;
    setSaving(true);
    try {
      const r = await fetch(`${API_BASE_URL}/api/onboarding-packets/public/${token}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          preferredName: form.preferredName, legalFirstName: form.legalFirstName,
          legalMiddleName: form.legalMiddleName, legalLastName: form.legalLastName,
          pronouns: form.pronouns,
          address: form.address, city: form.city, state: form.state, zip: form.zip,
          dateOfBirth: form.dateOfBirth || null,
          driversLicenseNumber: form.driversLicenseNumber,
          driversLicenseState: form.driversLicenseState,
          emergencyContactName: form.emergencyContactName,
          emergencyContactRelationship: form.emergencyContactRelationship,
          emergencyContactPhone: form.emergencyContactPhone,
          emergencyContactEmail: form.emergencyContactEmail,
        })
      });
      if (!r.ok) {
        const err = await r.json().catch(() => ({}));
        throw new Error(err.error || 'Save failed.');
      }
      setSavedAt(new Date());
    } catch (err) {
      setSubmitError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const submit = async (e) => {
    e.preventDefault();
    setSubmitError(null);

    if (!form.consentChecked) { setSubmitError('Please read and acknowledge the background check disclosure.'); return; }
    if (!form.bgcConsentSignature.trim()) { setSubmitError('Please type your full legal name as your electronic signature.'); return; }
    if (!form.dateOfBirth) { setSubmitError('Date of birth is required to run the background check.'); return; }
    const ssnDigits = form.ssn.replace(/\D/g, '');
    if (ssnDigits.length !== 9) { setSubmitError('Please enter a valid 9-digit Social Security Number.'); return; }

    setSubmitting(true);
    try {
      const r = await fetch(`${API_BASE_URL}/api/onboarding-packets/public/${token}/submit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          preferredName: form.preferredName, legalFirstName: form.legalFirstName,
          legalMiddleName: form.legalMiddleName, legalLastName: form.legalLastName,
          pronouns: form.pronouns,
          address: form.address, city: form.city, state: form.state, zip: form.zip,
          dateOfBirth: form.dateOfBirth,
          driversLicenseNumber: form.driversLicenseNumber,
          driversLicenseState: form.driversLicenseState,
          emergencyContactName: form.emergencyContactName,
          emergencyContactRelationship: form.emergencyContactRelationship,
          emergencyContactPhone: form.emergencyContactPhone,
          emergencyContactEmail: form.emergencyContactEmail,
          bgcConsentSignature: form.bgcConsentSignature.trim(),
          ssn: ssnDigits,
        })
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || 'Submission failed.');
      setSubmitted(true);
    } catch (err) {
      setSubmitError(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  // Auto-format SSN as user types (XXX-XX-XXXX)
  const onSsnChange = (v) => {
    const d = v.replace(/\D/g, '').slice(0, 9);
    let formatted = d;
    if (d.length > 5) formatted = `${d.slice(0,3)}-${d.slice(3,5)}-${d.slice(5)}`;
    else if (d.length > 3) formatted = `${d.slice(0,3)}-${d.slice(3)}`;
    set('ssn', formatted);
  };

  if (loading) {
    return <div style={s.page}><div style={s.wrap}><div style={{ textAlign: 'center', padding: '3rem', color: '#6B7280' }}>Loading your onboarding packet…</div></div></div>;
  }

  if (loadError) {
    return (
      <div style={s.page}><div style={s.wrap}>
        <div style={{ ...s.card, borderRadius: 14 }}>
          <h1 style={{ margin: 0, color: '#B91C1C', fontSize: '1.2rem' }}>We couldn't open your packet</h1>
          <p style={{ color: '#374151', marginTop: 8 }}>{loadError}</p>
          <p style={{ color: '#6B7280', fontSize: '0.9rem' }}>Please contact the office at <a href="tel:7154911254">(715) 491-1254</a> for a new link.</p>
        </div>
      </div></div>
    );
  }

  if (submitted) {
    return (
      <div style={s.page}><div style={s.wrap}>
        <div style={s.hero}>
          <div style={s.stepBadge}>Submitted</div>
          <h1 style={s.heroTitle}>You're all set, {packet?.firstName}!</h1>
          <p style={s.heroSub}>Thank you for completing your onboarding packet. We'll be in touch as soon as your background check clears and your schedule is ready.</p>
        </div>
        <div style={s.cardLast}>
          <div style={s.alert('success')}>
            <strong>Your background check is running now.</strong> Most Wisconsin DOJ checks return within 1 business day. We'll let you know if there's anything further we need from you.
          </div>
          <p style={{ color: '#374151' }}>In the meantime, watch your email for your caregiver app login instructions (sent separately). If you have any questions, call the office at <a href="tel:7154911254">(715) 491-1254</a>.</p>
        </div>
      </div></div>
    );
  }

  return (
    <div style={s.page}><div style={s.wrap}>
      <div style={s.hero}>
        <div style={s.stepBadge}>Caregiver Onboarding</div>
        <h1 style={s.heroTitle}>Welcome, {packet?.firstName}</h1>
        <p style={s.heroSub}>This packet takes about 10–15 minutes. Your draft is saved as you go.</p>
      </div>

      <form onSubmit={submit}>
        {/* ── Section 1: Personal info ───────────────────────────────── */}
        <div style={s.card}>
          <h2 style={s.section}>Your legal name & info</h2>
          <div style={s.row}>
            <div style={s.field}>
              <label style={s.label}>Legal First Name *</label>
              <input style={s.input} required value={form.legalFirstName} onChange={e => set('legalFirstName', e.target.value)} />
            </div>
            <div style={s.field}>
              <label style={s.label}>Legal Last Name *</label>
              <input style={s.input} required value={form.legalLastName} onChange={e => set('legalLastName', e.target.value)} />
            </div>
          </div>
          <div style={s.row}>
            <div style={s.field}>
              <label style={s.label}>Middle Name</label>
              <input style={s.input} value={form.legalMiddleName} onChange={e => set('legalMiddleName', e.target.value)} />
            </div>
            <div style={s.field}>
              <label style={s.label}>Preferred Name</label>
              <input style={s.input} value={form.preferredName} onChange={e => set('preferredName', e.target.value)} placeholder="What we'll call you" />
            </div>
          </div>
          <div style={s.row}>
            <div style={s.field}>
              <label style={s.label}>Pronouns</label>
              <input style={s.input} value={form.pronouns} onChange={e => set('pronouns', e.target.value)} placeholder="she/her, he/him, they/them" />
            </div>
            <div style={s.field}>
              <label style={s.label}>Date of Birth *</label>
              <input style={s.input} type="date" required value={form.dateOfBirth} onChange={e => set('dateOfBirth', e.target.value)} />
            </div>
          </div>
        </div>

        {/* ── Section 2: Address ─────────────────────────────────────── */}
        <div style={s.card}>
          <h2 style={s.section}>Where do you live?</h2>
          <div style={s.field}>
            <label style={s.label}>Street Address</label>
            <input style={s.input} value={form.address} onChange={e => set('address', e.target.value)} />
          </div>
          <div style={{ ...s.row, gridTemplateColumns: '2fr 1fr 1fr' }}>
            <div style={s.field}>
              <label style={s.label}>City</label>
              <input style={s.input} value={form.city} onChange={e => set('city', e.target.value)} />
            </div>
            <div style={s.field}>
              <label style={s.label}>State</label>
              <input style={s.input} maxLength={2} value={form.state} onChange={e => set('state', e.target.value.toUpperCase())} />
            </div>
            <div style={s.field}>
              <label style={s.label}>ZIP</label>
              <input style={s.input} maxLength={10} value={form.zip} onChange={e => set('zip', e.target.value)} />
            </div>
          </div>
        </div>

        {/* ── Section 3: License ─────────────────────────────────────── */}
        <div style={s.card}>
          <h2 style={s.section}>Driver's license</h2>
          <div style={s.row}>
            <div style={s.field}>
              <label style={s.label}>License Number</label>
              <input style={s.input} value={form.driversLicenseNumber} onChange={e => set('driversLicenseNumber', e.target.value)} />
            </div>
            <div style={s.field}>
              <label style={s.label}>Issuing State</label>
              <input style={s.input} maxLength={2} value={form.driversLicenseState} onChange={e => set('driversLicenseState', e.target.value.toUpperCase())} />
            </div>
          </div>
        </div>

        {/* ── Section 4: Emergency contact ───────────────────────────── */}
        <div style={s.card}>
          <h2 style={s.section}>Emergency contact</h2>
          <div style={s.row}>
            <div style={s.field}>
              <label style={s.label}>Name</label>
              <input style={s.input} value={form.emergencyContactName} onChange={e => set('emergencyContactName', e.target.value)} />
            </div>
            <div style={s.field}>
              <label style={s.label}>Relationship</label>
              <input style={s.input} value={form.emergencyContactRelationship} onChange={e => set('emergencyContactRelationship', e.target.value)} placeholder="e.g. spouse, parent, friend" />
            </div>
          </div>
          <div style={s.row}>
            <div style={s.field}>
              <label style={s.label}>Phone</label>
              <input style={s.input} type="tel" value={form.emergencyContactPhone} onChange={e => set('emergencyContactPhone', e.target.value)} />
            </div>
            <div style={s.field}>
              <label style={s.label}>Email</label>
              <input style={s.input} type="email" value={form.emergencyContactEmail} onChange={e => set('emergencyContactEmail', e.target.value)} />
            </div>
          </div>

          <div style={{ textAlign: 'right', marginTop: '0.75rem' }}>
            <button type="button" style={s.btn(brand.slate, true)} onClick={saveDraft} disabled={saving}>
              {saving ? 'Saving…' : savedAt ? 'Draft Saved ✓' : 'Save Draft'}
            </button>
          </div>
        </div>

        {/* ── Section 5: BGC consent ─────────────────────────────────── */}
        <div style={s.card}>
          <h2 style={s.section}>Background check disclosure & authorization</h2>

          <div style={s.consent}>
            <p style={{ margin: '0 0 0.75rem', fontSize: '0.88rem', color: '#92400E' }}>
              <strong>Please read this disclosure carefully.</strong> Wisconsin law requires a
              caregiver background check through the Wisconsin DOJ before you can
              be scheduled for shifts with clients.
            </p>
            <div style={s.disclosure}>{packet?.bgcDisclosureText || ''}</div>
          </div>

          <div style={{ ...s.field, marginTop: '1rem' }}>
            <label style={{ display: 'flex', gap: '0.6rem', alignItems: 'flex-start', cursor: 'pointer', fontSize: '0.92rem', color: '#374151' }}>
              <input type="checkbox" checked={form.consentChecked} onChange={e => set('consentChecked', e.target.checked)} style={{ marginTop: 4, transform: 'scale(1.2)' }} />
              <span>I have read the disclosure above, and I authorize Chippewa Valley Home Care LLC to obtain the described background check report about me.</span>
            </label>
          </div>

          <div style={s.row}>
            <div style={s.field}>
              <label style={s.label}>Electronic Signature — Type your full legal name *</label>
              <input style={s.input} value={form.bgcConsentSignature} onChange={e => set('bgcConsentSignature', e.target.value)} placeholder="e.g. Jane Marie Doe" />
            </div>
            <div style={s.field}>
              <label style={s.label}>Social Security Number *</label>
              <input style={s.input} value={form.ssn} onChange={e => onSsnChange(e.target.value)} placeholder="XXX-XX-XXXX" inputMode="numeric" autoComplete="off" />
              <div style={{ fontSize: '0.75rem', color: '#6B7280', marginTop: 4 }}>Used only to submit the WI DOJ check. Not stored long-term.</div>
            </div>
          </div>
        </div>

        {/* ── Submit ─────────────────────────────────────────────────── */}
        <div style={s.cardLast}>
          {submitError && <div style={s.alert('error')}>{submitError}</div>}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.75rem' }}>
            <div style={{ color: '#6B7280', fontSize: '0.85rem' }}>
              By submitting, you authorize the background check above and confirm the information you provided is accurate.
            </div>
            <button type="submit" style={s.btn(brand.good)} disabled={submitting}>
              {submitting ? 'Submitting…' : 'Submit & Authorize'}
            </button>
          </div>
        </div>
      </form>
    </div></div>
  );
};

export default OnboardingPacketPage;
