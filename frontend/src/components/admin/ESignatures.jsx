// ESignatures.jsx — send documents for e-signature and track who has signed.
// BID (DHS F-82064) is built in; policies are uploaded as PDFs. Each person gets their own
// emailed link; signed copies are stored encrypted and downloadable one by one or all
// together (e.g. "BID form for all staff" for an MCO).
import { useEffect, useState } from 'react';
import { API_BASE_URL } from '../../config';

const fmt = (ts) => ts ? new Date(ts).toLocaleString('en-US', { month: 'numeric', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '';
const STATUS = {
  signed: ['Signed', '#047857', '#ECFDF5'],
  opened: ['Opened, not signed', '#B45309', '#FEF3C7'],
  sent: ['Sent, not opened', '#1D4ED8', '#EFF6FF'],
  none: ['Not sent', '#64748B', '#F1F5F9'],
};

export default function ESignatures({ token }) {
  const auth = { Authorization: `Bearer ${token}` };
  const api = `${API_BASE_URL}/api/sign-requests`;
  const [templates, setTemplates] = useState([]);
  const [current, setCurrent] = useState(null);
  const [people, setPeople] = useState([]);
  const [picked, setPicked] = useState({});
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);       // { type, text }
  const [results, setResults] = useState(null);
  const [upload, setUpload] = useState({ open: false, title: '', version: '', description: '', file: null });

  const loadTemplates = async (keepId) => {
    const r = await fetch(`${api}/templates`, { headers: auth });
    const j = await r.json().catch(() => []);
    if (!r.ok) { setMsg({ type: 'error', text: j.error || 'Could not load documents.' }); return; }
    setTemplates(j);
    const next = j.find(t => t.id === (keepId || (current && current.id))) || j[0] || null;
    setCurrent(next);
  };
  const loadPeople = async (t) => {
    if (!t) return;
    const r = await fetch(`${api}/templates/${t.id}/people`, { headers: auth });
    const j = await r.json().catch(() => []);
    if (r.ok) setPeople(j); else setMsg({ type: 'error', text: j.error || 'Could not load staff.' });
  };
  useEffect(() => { loadTemplates(); /* eslint-disable-next-line */ }, []);
  useEffect(() => { setPicked({}); setResults(null); loadPeople(current); /* eslint-disable-next-line */ }, [current && current.id]);

  const openPdf = async (url, filename) => {
    setMsg(null);
    const r = await fetch(url, { headers: auth });
    if (!r.ok) { const j = await r.json().catch(() => ({})); setMsg({ type: 'error', text: j.error || `Download failed (${r.status})` }); return; }
    const blob = await r.blob();
    const href = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = href; a.target = '_blank'; a.rel = 'noreferrer';
    if (filename) a.download = filename;
    a.click();
    setTimeout(() => URL.revokeObjectURL(href), 60000);
  };

  const send = async () => {
    const userIds = Object.keys(picked).filter(k => picked[k]);
    if (!userIds.length) return;
    setBusy(true); setMsg(null); setResults(null);
    try {
      const r = await fetch(`${api}/send`, { method: 'POST', headers: { ...auth, 'Content-Type': 'application/json' }, body: JSON.stringify({ templateId: current.id, userIds }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || 'Send failed');
      setResults(j.results);
      const sent = j.results.filter(x => x.emailSent).length;
      setMsg({ type: sent === userIds.length ? 'success' : 'warn', text: `Emailed ${sent} of ${userIds.length}. ${sent < userIds.length ? 'See details below.' : ''}` });
      setPicked({});
      await loadPeople(current); await loadTemplates(current.id);
    } catch (e) { setMsg({ type: 'error', text: e.message }); }
    setBusy(false);
  };

  const act = async (requestId, action) => {
    setBusy(true); setMsg(null);
    try {
      const r = await fetch(`${api}/requests/${requestId}/${action}`, { method: 'POST', headers: auth });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || `${action} failed`);
      if (action === 'remind') setMsg(j.emailSent ? { type: 'success', text: 'Reminder emailed.' } : { type: 'warn', text: `Email not sent: ${j.emailError || 'unknown'}. Link to send yourself: ${j.url}` });
      else setMsg({ type: 'success', text: 'Request cancelled.' });
      await loadPeople(current); await loadTemplates(current.id);
    } catch (e) { setMsg({ type: 'error', text: e.message }); }
    setBusy(false);
  };

  const doUpload = async () => {
    if (!upload.title.trim() || !upload.file) { setMsg({ type: 'error', text: 'Title and a PDF file are required.' }); return; }
    setBusy(true); setMsg(null);
    try {
      const dataUri = await new Promise((res, rej) => { const fr = new FileReader(); fr.onload = () => res(fr.result); fr.onerror = rej; fr.readAsDataURL(upload.file); });
      const r = await fetch(`${api}/templates`, { method: 'POST', headers: { ...auth, 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: upload.title, version: upload.version, description: upload.description, pdfDataUri: dataUri }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || 'Upload failed');
      setUpload({ open: false, title: '', version: '', description: '', file: null });
      setMsg({ type: 'success', text: `Added "${j.title}". Pick people below and send it.` });
      await loadTemplates(j.id);
    } catch (e) { setMsg({ type: 'error', text: e.message }); }
    setBusy(false);
  };

  const notSent = people.filter(p => !p.status);
  const allPicked = notSent.length > 0 && notSent.every(p => picked[p.user_id]);
  const msgColors = { success: ['#ECFDF5', '#047857'], warn: ['#FEF3C7', '#92400E'], error: ['#FEF2F2', '#B91C1C'] };
  const td = { padding: '0.5rem 0.6rem', borderBottom: '1px solid #F1F5F9', fontSize: '0.88rem', verticalAlign: 'top' };

  return (
    <div style={{ padding: '1rem', maxWidth: 1100 }}>
      <h2 style={{ marginBottom: '0.25rem' }}>E-Signatures</h2>
      <p style={{ color: '#64748B', marginTop: 0 }}>Email documents to staff to sign on their phone. Each person gets their own private link — no login. Signed copies are saved here.</p>

      {msg && <div style={{ padding: '0.7rem 0.9rem', borderRadius: 8, marginBottom: '1rem', background: msgColors[msg.type][0], color: msgColors[msg.type][1], wordBreak: 'break-word' }}>{msg.text}</div>}

      <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', marginBottom: '1rem' }}>
        {templates.map(t => (
          <button key={t.id} onClick={() => setCurrent(t)}
            style={{ textAlign: 'left', padding: '0.6rem 0.8rem', borderRadius: 10, cursor: 'pointer', minWidth: 220, opacity: t.is_active ? 1 : 0.5,
              border: `2px solid ${current && current.id === t.id ? '#1D4ED8' : '#E2E8F0'}`, background: current && current.id === t.id ? '#EFF6FF' : '#fff' }}>
            <div style={{ fontWeight: 700, fontSize: '0.9rem' }}>{t.kind === 'bid' ? '🛡️ ' : '📄 '}{t.title}</div>
            <div style={{ fontSize: '0.78rem', color: '#64748B' }}>{t.version || ''} · {t.signed} signed / {t.sent} sent</div>
          </button>
        ))}
        <button onClick={() => setUpload(u => ({ ...u, open: !u.open }))} className="btn btn-secondary">＋ Add a policy (PDF)</button>
      </div>

      {upload.open && (
        <div style={{ border: '1px solid #E2E8F0', borderRadius: 10, padding: '1rem', marginBottom: '1rem', background: '#fff' }}>
          <div className="form-group"><label>Title</label><input value={upload.title} onChange={e => setUpload({ ...upload, title: e.target.value })} placeholder="e.g. Background Check Policy (WORCS)" /></div>
          <div className="form-group"><label>Version / effective date</label><input value={upload.version} onChange={e => setUpload({ ...upload, version: e.target.value })} placeholder="e.g. v1.0 — effective 1/1/2026" /></div>
          <div className="form-group"><label>Note shown to staff (optional)</label><input value={upload.description} onChange={e => setUpload({ ...upload, description: e.target.value })} /></div>
          <div className="form-group"><label>PDF file</label><input type="file" accept="application/pdf" onChange={e => setUpload({ ...upload, file: e.target.files[0] || null })} /></div>
          <button className="btn btn-primary" onClick={doUpload} disabled={busy}>{busy ? 'Uploading…' : 'Save document'}</button>
          <small style={{ display: 'block', color: '#64748B', marginTop: 6 }}>Staff read the PDF and sign an acknowledgement page that's added to the end. For a revised policy, upload it again with the new version so everyone re-signs.</small>
        </div>
      )}

      {current && (
        <div style={{ background: '#fff', border: '1px solid #E2E8F0', borderRadius: 10, overflow: 'hidden' }}>
          <div style={{ padding: '0.75rem 0.9rem', display: 'flex', flexWrap: 'wrap', gap: '0.5rem', alignItems: 'center', background: '#F8FAFC' }}>
            <strong>{current.title}</strong>
            <span style={{ flex: 1 }} />
            <button className="btn btn-secondary" onClick={() => openPdf(`${api}/templates/${current.id}/document.pdf`)}>View blank</button>
            <button className="btn btn-secondary" disabled={!current.signed} onClick={() => openPdf(`${api}/templates/${current.id}/all-signed.pdf`, `${current.title.replace(/[^\w]+/g, '-')}-all-signed.pdf`)}>⬇ All signed (one PDF)</button>
            <button className="btn btn-secondary" onClick={async () => {
              await fetch(`${api}/templates/${current.id}`, { method: 'PATCH', headers: { ...auth, 'Content-Type': 'application/json' }, body: JSON.stringify({ isActive: !current.is_active }) });
              loadTemplates(current.id);
            }}>{current.is_active ? 'Retire' : 'Reactivate'}</button>
          </div>

          <div style={{ padding: '0.6rem 0.9rem', display: 'flex', gap: '0.75rem', alignItems: 'center', flexWrap: 'wrap', borderTop: '1px solid #E2E8F0' }}>
            <label style={{ display: 'flex', gap: 6, alignItems: 'center', cursor: 'pointer' }}>
              <input type="checkbox" checked={allPicked} disabled={!notSent.length || !current.is_active}
                onChange={e => setPicked(e.target.checked ? Object.fromEntries(notSent.map(p => [p.user_id, true])) : {})} />
              Select everyone not sent yet ({notSent.length})
            </label>
            <button className="btn btn-primary" disabled={busy || !current.is_active || !Object.values(picked).some(Boolean)} onClick={send}>
              {busy ? 'Sending…' : `✉️ Email to ${Object.values(picked).filter(Boolean).length} selected`}
            </button>
          </div>

          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr style={{ background: '#F8FAFC', fontSize: '0.8rem', color: '#475569', textAlign: 'left' }}>
              <th style={td}></th><th style={td}>Name</th><th style={td}>Status</th><th style={td}>Dates</th><th style={td}></th>
            </tr></thead>
            <tbody>
              {people.map(p => {
                const [label, color, bg] = STATUS[p.status || 'none'];
                return (
                  <tr key={p.user_id}>
                    <td style={td}>{!p.status && <input type="checkbox" checked={!!picked[p.user_id]} disabled={!current.is_active} onChange={e => setPicked({ ...picked, [p.user_id]: e.target.checked })} />}</td>
                    <td style={td}><strong>{p.first_name} {p.last_name}</strong>{p.role === 'admin' ? ' (admin)' : ''}<div style={{ color: '#64748B', fontSize: '0.78rem' }}>{p.email}</div></td>
                    <td style={td}>
                      <span style={{ padding: '2px 8px', borderRadius: 999, background: bg, color, fontWeight: 700, fontSize: '0.78rem' }}>{label}</span>
                      {p.disclosures_yes && <div style={{ color: '#B91C1C', fontSize: '0.78rem', fontWeight: 700, marginTop: 4 }}>⚠ answered Yes to a disclosure — review</div>}
                    </td>
                    <td style={{ ...td, fontSize: '0.78rem', color: '#475569' }}>
                      {p.sent_at && <div>Sent {fmt(p.sent_at)}{p.reminder_count ? ` · ${p.reminder_count} reminder${p.reminder_count > 1 ? 's' : ''}` : ''}</div>}
                      {p.opened_at && <div>Opened {fmt(p.opened_at)}</div>}
                      {p.signed_at && <div>Signed {fmt(p.signed_at)} as "{p.signer_typed_name}"</div>}
                    </td>
                    <td style={{ ...td, whiteSpace: 'nowrap' }}>
                      {p.status === 'signed' && <button className="btn btn-secondary" onClick={() => openPdf(`${api}/requests/${p.request_id}/signed.pdf`)}>View signed</button>}
                      {(p.status === 'sent' || p.status === 'opened') && <>
                        <button className="btn btn-secondary" disabled={busy} onClick={() => act(p.request_id, 'remind')}>Remind</button>{' '}
                        <button className="btn btn-secondary" disabled={busy} onClick={() => act(p.request_id, 'cancel')}>Cancel</button>
                      </>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>

          {results && results.some(r => !r.emailSent) && (
            <div style={{ padding: '0.75rem 0.9rem', borderTop: '1px solid #E2E8F0', fontSize: '0.85rem' }}>
              <strong>Not emailed:</strong>
              {results.filter(r => !r.emailSent).map(r => (
                <div key={r.userId} style={{ marginTop: 4, wordBreak: 'break-all' }}>
                  {r.name}: {r.skipped || r.emailError || r.error}
                  {r.url && <> — <a href={r.url} target="_blank" rel="noreferrer">their link</a> (copy and text it to them)</>}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
