// SignRequestPage.jsx — public page behind the emailed link /sign/:token (no login).
// kind 'bid'         → the Wisconsin DHS F-82064 Background Information Disclosure, asked
//                      question by question in the state's wording; the server fills the
//                      official form with the answers and the drawn signature.
// kind 'acknowledge' → read the attached document (a policy), confirm, sign.
import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { API_BASE_URL } from '../config';
import SignaturePad from './SignaturePad';

// Question key → [title, question, what to describe if Yes (null = no details asked)]
const BID_QUESTIONS = {
  pending: ['1. Pending criminal charges', 'Do you have any criminal charges pending against you, including in federal, state, local, military, and tribal courts?', 'Describe the charge and give the name of the court, the state, city, and month and year you were charged.'],
  convictions: ['2. Convictions for crimes', 'Were you ever convicted of any crime anywhere, including in federal, state, local, military, and tribal courts, or in another country?', 'Describe the crime and give the name of the court, the state, city, and month and year you were convicted.'],
  abuseChild: ['3. Abuse or neglect of a child', 'Has a government or regulatory agency (other than the police) ever found that you abused or neglected a child?', 'Describe the conduct and give the agency that made the finding, the state, city, and month and year of the finding.'],
  abuseAdult: ['4. Abuse or neglect of an adult', 'Has a government or regulatory agency (other than the police) ever found that you abused or neglected an adult?', 'Describe the conduct and give the agency that made the finding, the state, city, and month and year of the finding.'],
  stealing: ['5. Stealing or other misappropriation', 'Has a government or regulatory agency (other than the police) ever found that you stole or misappropriated (improperly took or used) a person\'s property (e.g., money, medications, etc.), identity, or financial information (e.g., credit card, checks, etc.)?', 'Describe the conduct and give the agency that made the finding, the state, city, and month and year it occurred.'],
  credential: ['6. Restriction on credential', 'Do you have a government issued credential that is not current or has been revoked, suspended, or that limits you in any way from providing care to clients?', 'Give the type of credential, the credentialing agency, the restriction, and the state, city, and month and year it was issued.'],
  license: ['7. Denial, revocation, or limitation on license, certification, or registration', 'Has a government or regulatory agency ever denied, revoked, or limited your license, certification, or registration to provide care, treatment, or educational services?', 'Give the license, certification, or registration type and the issuing agency, a description of the denial, revocation, or limitation, and the state, city, and month and year it was issued.'],
  premises: ['8. Denial, revocation, or limitation on ability to reside on certain premises', 'Has a government or regulatory agency ever denied, revoked or limited your ability to live on the premises of a facility that provides care or treatment?', 'Describe it and give the issuing agency, the state, city, and month and year issued.'],
  rehab: ['9. Rehabilitation review', 'Have you ever requested a rehabilitation review from the Wisconsin Department of Health Services, a county department, private child placing agency, school board, or DHS-designated tribe?', 'Give the agency that did the review, the outcome, and the month and year of the review. (You must give the office a copy of your rehabilitation review letter.)'],
  armed: ['10. Armed forces', 'Have you been discharged from a branch of the US Armed Forces, including any reserve component?', 'Month and year of discharge. (If discharged in the last 3 years, give the office your DD214.)'],
  outOfState: ['11. Out-of-state residence', 'Have you lived outside of Wisconsin in the last three (3) years?', 'List each state, city, and the dates you lived there.'],
  govEmployee: ['12. Government employee', 'Are you applying or renewing eligibility to work as a government employee for the State of Wisconsin (e.g., a state agency, treatment facility, institute)?', null],
  outsideWi7: ['12b. Outside Wisconsin, last 7 years', 'Have you lived outside of Wisconsin in the last seven (7) years?', 'List each state, city, and the dates you lived there.'],
};

const box = { background: '#fff', borderRadius: 12, padding: '1rem 1.1rem', marginBottom: '1rem', boxShadow: '0 1px 3px rgba(0,0,0,0.08)' };
const label = { display: 'block', fontSize: '0.85rem', fontWeight: 600, color: '#334155', margin: '0.6rem 0 0.25rem' };
const input = { width: '100%', padding: '0.6rem 0.7rem', fontSize: '1rem', border: '1px solid #CBD5E1', borderRadius: 8, boxSizing: 'border-box' };

function YesNo({ value, onChange }) {
  const btn = (v, text) => (
    <button type="button" onClick={() => onChange(v)}
      style={{ flex: 1, padding: '0.6rem', fontSize: '1rem', fontWeight: 700, borderRadius: 8, cursor: 'pointer',
        border: `2px solid ${value === v ? '#1D4ED8' : '#CBD5E1'}`, background: value === v ? '#EFF6FF' : '#fff', color: value === v ? '#1D4ED8' : '#334155' }}>
      {text}
    </button>
  );
  return <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.5rem' }}>{btn(true, 'Yes')}{btn(false, 'No')}</div>;
}

export default function SignRequestPage() {
  const { token } = useParams();
  const [info, setInfo] = useState(null);
  const [loadError, setLoadError] = useState('');
  const [a, setA] = useState({});           // BID answers
  const [q, setQ] = useState({});           // BID disclosure answers { key: { yes, describe } }
  const [agree, setAgree] = useState(false);
  const [padOpen, setPadOpen] = useState(false);
  const [formError, setFormError] = useState('');
  const [done, setDone] = useState(null);

  const base = `${API_BASE_URL}/api/sign-requests/public/${token}`;

  useEffect(() => {
    (async () => {
      try {
        const r = await fetch(base);
        const j = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(j.error || 'This link could not be opened.');
        setInfo(j);
        if (j.prefill) setA({ ...j.prefill, middleName: '', otherNames: null, otherNamesList: '', ssn: '', dob: '', sex: '' });
      } catch (e) { setLoadError(e.message); }
    })();
  }, [base]);

  const setAns = (k, v) => setA(prev => ({ ...prev, [k]: v }));
  const setQ1 = (k, patch) => setQ(prev => ({ ...prev, [k]: { ...(prev[k] || {}), ...patch } }));

  // Client-side check before opening the signature pad (the server checks again).
  const checkBid = () => {
    const miss = [];
    if (!a.firstName) miss.push('first name'); if (!a.lastName) miss.push('last name');
    if (a.otherNames == null) miss.push('other names (yes/no)');
    if (a.otherNames && !String(a.otherNamesList || '').trim()) miss.push('the other names you have used');
    if (String(a.ssn || '').replace(/\D/g, '').length !== 9) miss.push('Social Security number (9 digits)');
    if (!/^\d{2}\/\d{2}\/\d{4}$/.test(a.dob || '')) miss.push('date of birth (MM/DD/YYYY)');
    if (!a.sex) miss.push('sex'); if (!a.phone) miss.push('phone');
    if (!a.street || !a.city || !a.state || !a.zip) miss.push('full address');
    for (const key of Object.keys(BID_QUESTIONS)) {
      if (key === 'outsideWi7' && !(q.govEmployee && q.govEmployee.yes)) continue;
      const v = q[key] || {};
      if (v.yes == null) { miss.push(`question ${BID_QUESTIONS[key][0].split('.')[0]}`); continue; }
      if (v.yes && BID_QUESTIONS[key][2] && !String(v.describe || '').trim()) miss.push(`details for question ${BID_QUESTIONS[key][0].split('.')[0]}`);
    }
    return miss;
  };

  const startSign = () => {
    setFormError('');
    if (info.kind === 'bid') {
      const miss = checkBid();
      if (miss.length) { setFormError(`Please complete: ${miss.join(', ')}.`); return; }
    }
    if (!agree) { setFormError('Please check the box to confirm.'); return; }
    setPadOpen(true);
  };

  const submit = async (signaturePng, typedName) => {
    const body = { signaturePng, typedName, agree: true };
    if (info.kind === 'bid') body.answers = { ...a, questions: q };
    const r = await fetch(`${base}/sign`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || 'Could not save your signature — please try again.');
    setPadOpen(false);
    setDone(j.signedAt || true);
    window.scrollTo(0, 0);
  };

  const shell = (children) => (
    <div style={{ minHeight: '100vh', background: '#F1F5F9', padding: '1rem' }}>
      <div style={{ maxWidth: 640, margin: '0 auto' }}>
        <div style={{ textAlign: 'center', margin: '0.5rem 0 1rem', color: '#1D4ED8', fontWeight: 800, fontSize: '1.15rem' }}>Chippewa Valley Home Care</div>
        {children}
      </div>
    </div>
  );

  if (loadError) return shell(<div style={{ ...box, color: '#B91C1C' }}>{loadError}</div>);
  if (!info) return shell(<div style={box}>Loading…</div>);
  if (done || info.signed) return shell(
    <div style={{ ...box, textAlign: 'center' }}>
      <div style={{ fontSize: '2.5rem' }}>✅</div>
      <h2 style={{ margin: '0.5rem 0' }}>Signed — thank you!</h2>
      <p style={{ color: '#475569' }}>"{info.title}" has been signed and sent to the office. You can close this page.</p>
    </div>
  );

  return shell(
    <>
      <div style={box}>
        <h2 style={{ margin: '0 0 0.25rem', fontSize: '1.2rem' }}>{info.title}</h2>
        <div style={{ color: '#64748B', fontSize: '0.9rem' }}>For: <strong>{info.signerName}</strong>{info.version ? ` · ${info.version}` : ''}</div>
        {info.description && <p style={{ color: '#475569', fontSize: '0.92rem' }}>{info.description}</p>}
        <a href={`${base}/document.pdf`} target="_blank" rel="noreferrer"
          style={{ display: 'inline-block', marginTop: '0.5rem', padding: '0.6rem 1rem', background: info.kind === 'bid' ? '#F1F5F9' : '#1D4ED8', color: info.kind === 'bid' ? '#1D4ED8' : '#fff', borderRadius: 8, fontWeight: 700, textDecoration: 'none' }}>
          📄 {info.kind === 'bid' ? 'View the blank state form' : 'Open the document to read'}
        </a>
      </div>

      {info.kind === 'bid' && (
        <>
          <div style={box}>
            <h3 style={{ marginTop: 0 }}>About you</h3>
            <p style={{ color: '#64748B', fontSize: '0.85rem', marginTop: 0 }}>Wisconsin requires this form for everyone who works with our clients. Your answers go on the official DHS form F-82064. Your Social Security number is kept encrypted and only the office can see it.</p>
            <label style={label}>Position</label>
            <input style={input} value={a.position || ''} onChange={e => setAns('position', e.target.value)} />
            <label style={label}>First name</label>
            <input style={input} value={a.firstName || ''} onChange={e => setAns('firstName', e.target.value)} autoComplete="given-name" />
            <label style={label}>Middle name</label>
            <input style={input} value={a.middleName || ''} onChange={e => setAns('middleName', e.target.value)} autoComplete="additional-name" />
            <label style={label}>Last name</label>
            <input style={input} value={a.lastName || ''} onChange={e => setAns('lastName', e.target.value)} autoComplete="family-name" />
            <label style={label}>Have you had or used any other names, including before marriage?</label>
            <YesNo value={a.otherNames} onChange={v => setAns('otherNames', v)} />
            {a.otherNames && (<><label style={label}>List each name fully</label>
              <input style={input} value={a.otherNamesList || ''} onChange={e => setAns('otherNamesList', e.target.value)} /></>)}
            <label style={label}>Social Security number</label>
            <input style={input} inputMode="numeric" autoComplete="off" placeholder="123-45-6789" value={a.ssn || ''}
              onChange={e => { const d = e.target.value.replace(/\D/g, '').slice(0, 9); setAns('ssn', d.length > 5 ? `${d.slice(0, 3)}-${d.slice(3, 5)}-${d.slice(5)}` : d.length > 3 ? `${d.slice(0, 3)}-${d.slice(3)}` : d); }} />
            <label style={label}>Date of birth (MM/DD/YYYY)</label>
            <input style={input} inputMode="numeric" placeholder="MM/DD/YYYY" value={a.dob || ''}
              onChange={e => { const d = e.target.value.replace(/\D/g, '').slice(0, 8); setAns('dob', d.length > 4 ? `${d.slice(0, 2)}/${d.slice(2, 4)}/${d.slice(4)}` : d.length > 2 ? `${d.slice(0, 2)}/${d.slice(2)}` : d); }} />
            <label style={label}>Sex (as the state form asks)</label>
            <div style={{ display: 'flex', gap: '0.5rem' }}>
              {['Female', 'Male'].map(s => (
                <button key={s} type="button" onClick={() => setAns('sex', s)}
                  style={{ flex: 1, padding: '0.6rem', fontWeight: 700, borderRadius: 8, cursor: 'pointer', border: `2px solid ${a.sex === s ? '#1D4ED8' : '#CBD5E1'}`, background: a.sex === s ? '#EFF6FF' : '#fff' }}>{s}</button>
              ))}
            </div>
            <label style={label}>Phone number</label>
            <input style={input} inputMode="tel" value={a.phone || ''} onChange={e => setAns('phone', e.target.value)} autoComplete="tel" />
            <label style={label}>Street address</label>
            <input style={input} value={a.street || ''} onChange={e => setAns('street', e.target.value)} autoComplete="street-address" />
            <div style={{ display: 'flex', gap: '0.5rem' }}>
              <div style={{ flex: 2 }}><label style={label}>City</label><input style={input} value={a.city || ''} onChange={e => setAns('city', e.target.value)} /></div>
              <div style={{ flex: 1 }}><label style={label}>State</label><input style={input} maxLength={2} value={a.state || ''} onChange={e => setAns('state', e.target.value.toUpperCase())} /></div>
              <div style={{ flex: 1.3 }}><label style={label}>ZIP</label><input style={input} inputMode="numeric" value={a.zip || ''} onChange={e => setAns('zip', e.target.value)} /></div>
            </div>
          </div>

          <div style={box}>
            <h3 style={{ marginTop: 0 }}>Disclosures</h3>
            <p style={{ color: '#64748B', fontSize: '0.85rem', marginTop: 0 }}>Answer every question honestly. Answering "Yes" does not automatically disqualify you — the office reviews each answer. Leaving something out can lead to a state penalty.</p>
            {Object.entries(BID_QUESTIONS).map(([key, [title, question, describe]]) => {
              if (key === 'outsideWi7' && !(q.govEmployee && q.govEmployee.yes)) return null;
              const v = q[key] || {};
              return (
                <div key={key} style={{ borderTop: '1px solid #E2E8F0', padding: '0.8rem 0' }}>
                  <div style={{ fontWeight: 700, fontSize: '0.92rem' }}>{title}</div>
                  <div style={{ fontSize: '0.92rem', color: '#334155', marginTop: 4 }}>{question}</div>
                  <YesNo value={v.yes} onChange={val => setQ1(key, { yes: val })} />
                  {v.yes && describe && (<>
                    <label style={label}>{describe}</label>
                    <textarea style={{ ...input, minHeight: 80 }} value={v.describe || ''} onChange={e => setQ1(key, { describe: e.target.value })} />
                  </>)}
                </div>
              );
            })}
          </div>
        </>
      )}

      <div style={box}>
        <label style={{ display: 'flex', gap: '0.6rem', alignItems: 'flex-start', fontSize: '0.95rem', cursor: 'pointer' }}>
          <input type="checkbox" checked={agree} onChange={e => setAgree(e.target.checked)} style={{ width: 22, height: 22, marginTop: 2 }} />
          <span>{info.kind === 'bid'
            ? 'I have completed and reviewed this form. The information I provided is accurate and complete. I understand that providing inaccurate or incomplete information may result in a forfeiture or other sanction (Wis. Stat. § 50.065(6)(c)).'
            : 'I have received and read this document, I understand it, and I agree to follow it as a condition of my employment.'}</span>
        </label>
        {formError && <div style={{ marginTop: '0.75rem', padding: '0.6rem', background: '#FEF2F2', color: '#B91C1C', borderRadius: 8, fontSize: '0.9rem' }}>{formError}</div>}
        <button type="button" onClick={startSign}
          style={{ marginTop: '1rem', width: '100%', padding: '0.9rem', background: '#1D4ED8', color: '#fff', border: 'none', borderRadius: 10, fontSize: '1.1rem', fontWeight: 800, cursor: 'pointer' }}>
          ✍️ Sign
        </button>
        <p style={{ fontSize: '0.78rem', color: '#64748B', marginBottom: 0 }}>By signing electronically you agree your electronic signature is the same as your handwritten signature. The date, time, and your IP address are recorded.</p>
      </div>

      <SignaturePad open={padOpen} onClose={() => setPadOpen(false)} documentName={info.title} onSign={submit} />
    </>
  );
}
