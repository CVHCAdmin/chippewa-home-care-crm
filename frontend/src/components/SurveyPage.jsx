// SurveyPage.jsx — anonymous staff survey behind the emailed link /survey/:token (no login).
import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { API_BASE_URL } from '../config';

const box = { background: '#fff', borderRadius: 12, padding: '1rem 1.1rem', marginBottom: '1rem', boxShadow: '0 1px 3px rgba(0,0,0,0.08)' };

function Scale({ value, onChange, min, max, lowLabel, highLabel }) {
  const nums = []; for (let n = min; n <= max; n++) nums.push(n);
  return (
    <div>
      <div style={{ display: 'flex', gap: 4, marginTop: 8 }}>
        {nums.map(n => (
          <button key={n} type="button" onClick={() => onChange(n)}
            style={{ flex: 1, minWidth: 0, padding: '0.6rem 0', fontWeight: 800, fontSize: '1rem', borderRadius: 8, cursor: 'pointer',
              border: `2px solid ${value === n ? '#1D4ED8' : '#CBD5E1'}`, background: value === n ? '#1D4ED8' : '#fff', color: value === n ? '#fff' : '#334155' }}>{n}</button>
        ))}
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.75rem', color: '#64748B', marginTop: 4 }}>
        <span>{lowLabel}</span><span>{highLabel}</span>
      </div>
    </div>
  );
}

export default function SurveyPage() {
  const { token } = useParams();
  const [info, setInfo] = useState(null);
  const [loadError, setLoadError] = useState('');
  const [answers, setAnswers] = useState({});
  const [contactName, setContactName] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const base = `${API_BASE_URL}/api/surveys/public/${token}`;

  useEffect(() => { (async () => {
    try {
      const r = await fetch(base); const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || 'This link could not be opened.');
      setInfo(j);
    } catch (e) { setLoadError(e.message); }
  })(); }, [base]);

  const submit = async () => {
    setError('');
    const missing = info.questions.filter(q => q.type !== 'text' && answers[q.key] == null).length;
    if (missing) { setError(`Please answer every rating question (${missing} left).`); return; }
    setBusy(true);
    try {
      const r = await fetch(`${base}/submit`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ answers, contactName }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || 'Could not send — please try again.');
      setDone(true); window.scrollTo(0, 0);
    } catch (e) { setError(e.message); }
    setBusy(false);
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
  if (done || info.responded) return shell(
    <div style={{ ...box, textAlign: 'center' }}><div style={{ fontSize: '2.5rem' }}>🙏</div><h2>Thank you!</h2>
      <p style={{ color: '#475569' }}>Your answers were sent anonymously. We read every one.</p></div>);
  if (info.closed) return shell(<div style={box}>This survey is closed. Thank you!</div>);

  return shell(
    <>
      <div style={box}>
        <h2 style={{ margin: '0 0 0.5rem', fontSize: '1.2rem' }}>{info.title}</h2>
        <p style={{ color: '#475569', fontSize: '0.92rem', margin: 0 }}>{info.intro}</p>
        <div style={{ marginTop: '0.75rem', padding: '0.6rem 0.75rem', background: '#ECFDF5', color: '#065F46', borderRadius: 8, fontSize: '0.85rem' }}>
          🔒 <strong>Anonymous.</strong> Your answers are saved without your name. The office can see that you finished, but not what you said.
        </div>
      </div>
      {info.questions.map((q, i) => (
        <div key={q.key} style={box}>
          <div style={{ fontWeight: 700 }}>{i + 1}. {q.label}</div>
          {q.type === 'scale5' && <Scale value={answers[q.key]} onChange={v => setAnswers({ ...answers, [q.key]: v })} min={1} max={5} lowLabel="Strongly disagree / Not happy" highLabel="Strongly agree / Very happy" />}
          {q.type === 'nps' && <Scale value={answers[q.key]} onChange={v => setAnswers({ ...answers, [q.key]: v })} min={0} max={10} lowLabel="Not at all likely" highLabel="Extremely likely" />}
          {q.type === 'text' && <textarea value={answers[q.key] || ''} onChange={e => setAnswers({ ...answers, [q.key]: e.target.value })} placeholder="Optional"
            style={{ width: '100%', minHeight: 90, marginTop: 8, padding: '0.6rem', fontSize: '1rem', border: '1px solid #CBD5E1', borderRadius: 8, boxSizing: 'border-box' }} />}
        </div>
      ))}
      <div style={box}>
        <div style={{ fontWeight: 700 }}>Want us to follow up with you? (optional)</div>
        <p style={{ color: '#64748B', fontSize: '0.85rem', margin: '0.25rem 0 0.5rem' }}>Leave this blank to stay anonymous. If you type your name, the owners will see it next to your written comments so they can reach out.</p>
        <input value={contactName} onChange={e => setContactName(e.target.value)} placeholder="Your name (optional)"
          style={{ width: '100%', padding: '0.6rem', fontSize: '1rem', border: '1px solid #CBD5E1', borderRadius: 8, boxSizing: 'border-box' }} />
      </div>
      {error && <div style={{ ...box, background: '#FEF2F2', color: '#B91C1C' }}>{error}</div>}
      <button type="button" onClick={submit} disabled={busy}
        style={{ width: '100%', padding: '0.9rem', background: '#1D4ED8', color: '#fff', border: 'none', borderRadius: 10, fontSize: '1.1rem', fontWeight: 800, cursor: 'pointer', marginBottom: '2rem' }}>
        {busy ? 'Sending…' : 'Send my answers'}
      </button>
    </>
  );
}
