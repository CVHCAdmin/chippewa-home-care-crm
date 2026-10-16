// StaffSurveys.jsx — send the anonymous staff survey and read the results.
// The office sees WHO has answered (to send reminders) but never WHAT any one person said;
// results appear once at least 3 people have answered, with comments shuffled.
import { useEffect, useState } from 'react';
import { API_BASE_URL } from '../../config';

const Bar = ({ value, max, color = '#3B82F6' }) => (
  <div style={{ background: '#E2E8F0', borderRadius: 4, height: 10, flex: 1 }}>
    <div style={{ width: `${max ? (value / max) * 100 : 0}%`, background: color, height: '100%', borderRadius: 4 }} />
  </div>
);

function Results({ id, token }) {
  const [r, setR] = useState(null); const [err, setErr] = useState('');
  useEffect(() => { (async () => {
    const res = await fetch(`${API_BASE_URL}/api/surveys/${id}/results`, { headers: { Authorization: `Bearer ${token}` } });
    const j = await res.json().catch(() => ({})); if (res.ok) setR(j); else setErr(j.error || 'Could not load results.');
  })(); }, [id, token]);
  if (err) return <div style={{ color: '#B91C1C' }}>{err}</div>;
  if (!r) return <p>Loading…</p>;
  if (r.hidden) return <div style={{ padding: '1rem', background: '#F8FAFC', borderRadius: 8 }}>🔒 {r.count} answer{r.count === 1 ? '' : 's'} so far. Results show once at least {r.minimum} people have answered, so no single answer can be traced to whoever just finished.</div>;
  return (
    <div>
      <p style={{ color: '#475569' }}><strong>{r.count}</strong> anonymous responses.</p>
      {r.questions.filter(q => q.type !== 'text').map(q => {
        const max = q.type === 'nps' ? 10 : 5;
        const top = Math.max(1, ...Object.values(q.distribution || {}));
        const color = q.average >= (q.type === 'nps' ? 8 : 4) ? '#059669' : q.average >= (q.type === 'nps' ? 6 : 3) ? '#D97706' : '#DC2626';
        return (
          <div key={q.key} style={{ border: '1px solid #E2E8F0', borderRadius: 10, padding: '0.75rem', marginBottom: '0.6rem', background: '#fff' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: '1rem' }}>
              <span style={{ fontWeight: 600 }}>{q.label}</span>
              <span style={{ fontWeight: 800, color, whiteSpace: 'nowrap' }}>{q.average} / {max}</span>
            </div>
            {q.type === 'nps' && <div style={{ fontSize: '0.82rem', color: '#475569' }}>Score {q.score} · {q.promoters} would recommend (9–10) · {q.passives} neutral (7–8) · {q.detractors} unlikely (0–6)</div>}
            <div style={{ marginTop: 6 }}>
              {Array.from({ length: max - (q.type === 'nps' ? -1 : 0) }, (_, i) => (q.type === 'nps' ? i : i + 1)).reverse().map(n => (
                <div key={n} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: '0.78rem' }}>
                  <span style={{ width: 18, textAlign: 'right', color: '#64748B' }}>{n}</span>
                  <Bar value={(q.distribution || {})[n] || 0} max={top} color={color} />
                  <span style={{ width: 18, color: '#64748B' }}>{(q.distribution || {})[n] || ''}</span>
                </div>
              ))}
            </div>
          </div>
        );
      })}
      {r.questions.filter(q => q.type === 'text').map(q => (
        <div key={q.key} style={{ border: '1px solid #E2E8F0', borderRadius: 10, padding: '0.75rem', marginBottom: '0.6rem', background: '#fff' }}>
          <div style={{ fontWeight: 600, marginBottom: 6 }}>{q.label} <span style={{ color: '#64748B', fontWeight: 400 }}>({q.answers.length})</span></div>
          {q.answers.length === 0 ? <div style={{ color: '#64748B' }}>No comments.</div> : q.answers.map((a, i) => (
            <div key={i} style={{ padding: '0.5rem 0.6rem', background: '#F8FAFC', borderRadius: 6, marginBottom: 6, whiteSpace: 'pre-wrap' }}>"{a}"</div>
          ))}
        </div>
      ))}
      {r.contacts.length > 0 && (
        <div style={{ border: '1px solid #FDE68A', borderRadius: 10, padding: '0.75rem', background: '#FFFBEB' }}>
          <div style={{ fontWeight: 700, marginBottom: 6 }}>Asked you to follow up ({r.contacts.length})</div>
          {r.contacts.map((c, i) => (
            <div key={i} style={{ marginBottom: 8 }}><strong>{c.name}</strong>{c.comments.length ? <div style={{ whiteSpace: 'pre-wrap', color: '#475569' }}>{c.comments.map(x => `"${x}"`).join('\n')}</div> : <span style={{ color: '#64748B' }}> — no written comments</span>}</div>
          ))}
        </div>
      )}
    </div>
  );
}

export default function StaffSurveys({ token }) {
  const auth = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
  const api = `${API_BASE_URL}/api/surveys`;
  const [surveys, setSurveys] = useState(null);
  const [current, setCurrent] = useState(null);
  const [people, setPeople] = useState([]);
  const [picked, setPicked] = useState({});
  const [tab, setTab] = useState('people');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);

  const load = async (keep) => {
    const r = await fetch(api, { headers: auth }); const j = await r.json().catch(() => []);
    if (!r.ok) { setMsg({ type: 'error', text: j.error || 'Could not load surveys.' }); return; }
    setSurveys(j); setCurrent(j.find(s => s.id === (keep || (current && current.id))) || j[0] || null);
  };
  const loadPeople = async (s) => {
    if (!s) return;
    const r = await fetch(`${api}/${s.id}/people`, { headers: auth }); const j = await r.json().catch(() => []);
    if (r.ok) setPeople(j);
  };
  useEffect(() => { load(); /* eslint-disable-next-line */ }, []);
  useEffect(() => { setPicked({}); loadPeople(current); /* eslint-disable-next-line */ }, [current && current.id]);

  const call = async (url, body, okText) => {
    setBusy(true); setMsg(null);
    try {
      const r = await fetch(url, { method: 'POST', headers: auth, body: JSON.stringify(body || {}) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || 'Failed');
      if (j.results) {
        const bad = j.results.filter(x => !x.emailSent);
        setMsg({ type: bad.length ? 'warn' : 'success', text: `Emailed ${j.results.length - bad.length} of ${j.results.length}.` + (bad.length ? ' Not emailed: ' + bad.map(b => `${b.name} (${b.skipped || b.emailError || b.error})${b.url ? ' — link: ' + b.url : ''}`).join('; ') : '') });
      } else if (j.url && !j.emailSent) setMsg({ type: 'warn', text: `Email not sent: ${j.emailError}. Their link: ${j.url}` });
      else setMsg({ type: 'success', text: okText });
      await load(current && current.id); await loadPeople(current);
      return j;
    } catch (e) { setMsg({ type: 'error', text: e.message }); }
    finally { setBusy(false); }
  };

  const notInvited = people.filter(p => !p.invitation_id);
  const colors = { success: ['#ECFDF5', '#047857'], warn: ['#FEF3C7', '#92400E'], error: ['#FEF2F2', '#B91C1C'] };
  const td = { padding: '0.45rem 0.6rem', borderBottom: '1px solid #F1F5F9', fontSize: '0.88rem' };

  return (
    <div style={{ padding: '1rem', maxWidth: 1000 }}>
      <h2 style={{ marginBottom: '0.25rem' }}>Staff Survey</h2>
      <p style={{ color: '#64748B', marginTop: 0 }}>Anonymous feedback from caregivers on how the owners are doing. You see who has answered (to send reminders), never who said what.</p>
      {msg && <div style={{ padding: '0.7rem', borderRadius: 8, marginBottom: '1rem', background: colors[msg.type][0], color: colors[msg.type][1], wordBreak: 'break-word' }}>{msg.text}</div>}

      <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', marginBottom: '1rem' }}>
        {(surveys || []).map(s => (
          <button key={s.id} onClick={() => setCurrent(s)} style={{ textAlign: 'left', padding: '0.55rem 0.8rem', borderRadius: 10, cursor: 'pointer',
            border: `2px solid ${current && current.id === s.id ? '#1D4ED8' : '#E2E8F0'}`, background: current && current.id === s.id ? '#EFF6FF' : '#fff' }}>
            <div style={{ fontWeight: 700, fontSize: '0.88rem' }}>{new Date(s.created_at).toLocaleDateString()}{s.status === 'closed' ? ' (closed)' : ''}</div>
            <div style={{ fontSize: '0.78rem', color: '#64748B' }}>{s.responded} of {s.invited} answered</div>
          </button>
        ))}
        <button className="btn btn-primary" disabled={busy} onClick={async () => { const j = await call(api, {}, 'Survey created — pick people and send it.'); if (j && j.id) load(j.id); }}>＋ New survey</button>
      </div>

      {current && (
        <div style={{ background: '#fff', border: '1px solid #E2E8F0', borderRadius: 10, overflow: 'hidden' }}>
          <div style={{ padding: '0.6rem 0.9rem', display: 'flex', gap: '0.5rem', alignItems: 'center', background: '#F8FAFC', flexWrap: 'wrap' }}>
            <strong>{current.title}</strong><span style={{ flex: 1 }} />
            <button className={`btn ${tab === 'people' ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setTab('people')}>Who's answered</button>
            <button className={`btn ${tab === 'results' ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setTab('results')}>Results</button>
            {current.status === 'open' && <button className="btn btn-secondary" disabled={busy} onClick={() => call(`${api}/${current.id}/close`, {}, 'Survey closed.')}>Close survey</button>}
          </div>
          {tab === 'results' ? <div style={{ padding: '0.9rem' }}><Results id={current.id} token={token} /></div> : (
            <>
              {current.status === 'open' && (
                <div style={{ padding: '0.6rem 0.9rem', display: 'flex', gap: '0.75rem', alignItems: 'center', flexWrap: 'wrap' }}>
                  <label style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                    <input type="checkbox" disabled={!notInvited.length} checked={notInvited.length > 0 && notInvited.every(p => picked[p.user_id])}
                      onChange={e => setPicked(e.target.checked ? Object.fromEntries(notInvited.map(p => [p.user_id, true])) : {})} />
                    Select everyone not sent yet ({notInvited.length})
                  </label>
                  <button className="btn btn-primary" disabled={busy || !Object.values(picked).some(Boolean)}
                    onClick={() => call(`${api}/${current.id}/send`, { userIds: Object.keys(picked).filter(k => picked[k]) }).then(() => setPicked({}))}>
                    ✉️ Email to {Object.values(picked).filter(Boolean).length} selected
                  </button>
                </div>
              )}
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <tbody>
                  {people.map(p => (
                    <tr key={p.user_id}>
                      <td style={td}>{!p.invitation_id && current.status === 'open' && <input type="checkbox" checked={!!picked[p.user_id]} onChange={e => setPicked({ ...picked, [p.user_id]: e.target.checked })} />}</td>
                      <td style={td}><strong>{p.first_name} {p.last_name}</strong></td>
                      <td style={td}>{!p.invitation_id ? <span style={{ color: '#64748B' }}>Not sent</span> : p.responded ? <span style={{ color: '#047857', fontWeight: 700 }}>✓ Answered</span> : <span style={{ color: '#B45309' }}>Sent, not answered{p.reminder_count ? ` · ${p.reminder_count} reminder${p.reminder_count > 1 ? 's' : ''}` : ''}</span>}</td>
                      <td style={td}>{p.invitation_id && !p.responded && current.status === 'open' && <button className="btn btn-secondary" disabled={busy} onClick={() => call(`${api}/invitations/${p.invitation_id}/remind`, {}, 'Reminder emailed.')}>Remind</button>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}
        </div>
      )}
      {surveys && surveys.length === 0 && <p>No surveys yet — click <strong>＋ New survey</strong>.</p>}
    </div>
  );
}
