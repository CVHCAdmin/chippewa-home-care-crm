// src/components/admin/VisitDocumentation.jsx
// Office-entered care notes for each scheduled visit, and an invoice built from the
// visits you tick — with a printable packet (invoice + the notes for those visits).
// Built for VA clients whose caregiver doesn't use the app: visits come from the
// schedule, so a cancelled visit never appears and a date can't be typed in.
import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { API_BASE_URL } from '../../config';
import { confirm } from '../ConfirmModal';

const todayStr = () => new Date().toLocaleDateString('en-CA');
const daysAgo = (n) => { const d = new Date(); d.setDate(d.getDate() - n); return d.toLocaleDateString('en-CA'); };
const fmtDate = (s) => { const [y, m, d] = s.split('-'); return `${Number(m)}/${Number(d)}/${y}`; };
const weekday = (s) => new Date(`${s}T12:00:00`).toLocaleDateString('en-US', { weekday: 'short' });
const fmtTime = (t) => {
  const [h, m] = t.split(':').map(Number);
  return `${h === 0 ? 12 : h > 12 ? h - 12 : h}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`;
};
const vkey = (v) => `${v.visit_date}|${v.start_time}|${v.caregiver_id}`;
const money = (n) => `$${Number(n).toFixed(2)}`;
// Same rounding the server uses: hours to 2 places, amount = hours × rate.
const visitAmount = (v, rate) => v.split.reduce((s, p) => s + Math.round(Math.round(p.minutes / 60 * 100) / 100 * rate * 100) / 100, 0);

const VisitDocumentation = ({ token }) => {
  const [clients, setClients] = useState([]);
  const [clientId, setClientId] = useState('');
  const [from, setFrom] = useState(daysAgo(30));
  const [to, setTo] = useState(todayStr());
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState(null); // { type: 'error'|'success', text }
  const [openKey, setOpenKey] = useState(null);
  const [draft, setDraft] = useState({ tasks: [], note: '' });
  const [saving, setSaving] = useState(false);
  const [selected, setSelected] = useState(new Set());
  const [creating, setCreating] = useState(false);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [bulkNote, setBulkNote] = useState('Personal care provided. Walked hallways with assistance. Vacuumed and dusted.');
  const [bulkBusy, setBulkBusy] = useState(false);

  const headers = useMemo(() => ({ Authorization: `Bearer ${token}` }), [token]);

  useEffect(() => {
    fetch(`${API_BASE_URL}/api/clients`, { headers })
      .then((r) => (r.ok ? r.json() : []))
      .then((rows) => setClients((Array.isArray(rows) ? rows : [])
        .filter((c) => c.is_active !== false)
        .sort((a, b) => `${a.last_name} ${a.first_name}`.localeCompare(`${b.last_name} ${b.first_name}`))))
      .catch(() => setClients([]));
  }, [headers]);

  // keepMessage: a reload right after saving/invoicing must not wipe the result
  // message the user is waiting to read.
  const load = useCallback(async (keepMessage) => {
    if (!clientId || !from || !to) return;
    setLoading(true);
    if (keepMessage !== true) setMessage(null);
    try {
      const r = await fetch(`${API_BASE_URL}/api/visit-docs/clients/${clientId}?from=${from}&to=${to}`, { headers });
      const body = await r.json();
      if (!r.ok) throw new Error(body.error || `HTTP ${r.status}`);
      setData(body);
      setSelected(new Set());
    } catch (e) {
      setData(null);
      setMessage({ type: 'error', text: `Could not load visits: ${e.message}` });
    } finally { setLoading(false); }
  }, [clientId, from, to, headers]);

  useEffect(() => { load(); }, [load]);

  const openVisit = (v) => {
    const k = vkey(v);
    if (openKey === k) { setOpenKey(null); return; }
    const saved = v.doc?.tasks || [];
    // A new note starts with every care-plan task ticked (these are done every
    // visit); untick anything that didn't happen. A saved note shows what was saved.
    const tasks = (data.tasks || []).map((t) => {
      const s = saved.find((x) => x.taskId === t.id);
      return { taskId: t.id, taskName: t.task_name, done: v.doc ? !!s?.done : true };
    });
    for (const s of saved) if (!tasks.some((t) => t.taskId === s.taskId)) tasks.push(s);
    setDraft({ tasks, note: v.doc?.note || '' });
    setOpenKey(k);
  };

  const saveVisit = async (v) => {
    setSaving(true); setMessage(null);
    try {
      const r = await fetch(`${API_BASE_URL}/api/visit-docs/clients/${clientId}/visits`, {
        method: 'PUT', headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ visitDate: v.visit_date, startTime: v.start_time, caregiverId: v.caregiver_id, tasks: draft.tasks, note: draft.note }),
      });
      const body = await r.json();
      if (!r.ok) throw new Error(body.error || `HTTP ${r.status}`);
      setData((d) => ({ ...d, visits: d.visits.map((x) => (vkey(x) === vkey(v) ? { ...x, doc: body } : x)) }));
      setOpenKey(null);
      setMessage({ type: 'success', text: `Saved note for ${fmtDate(v.visit_date)}.` });
    } catch (e) {
      setMessage({ type: 'error', text: `Save failed: ${e.message}` });
    } finally { setSaving(false); }
  };

  const billable = (data?.visits || []).filter((v) => !v.invoiced);
  const toggle = (v) => setSelected((s) => { const n = new Set(s); n.has(vkey(v)) ? n.delete(vkey(v)) : n.add(vkey(v)); return n; });
  const pickedVisits = (data?.visits || []).filter((v) => selected.has(vkey(v)));
  const rate = data?.rate?.rate || 0;
  const pickedTotal = pickedVisits.reduce((s, v) => s + visitAmount(v, rate), 0);
  const pickedUndocumented = pickedVisits.filter((v) => !v.doc).length;

  const createInvoice = async () => {
    if (!pickedVisits.length) return;
    const ok = await confirm(
      `Create a draft invoice for ${pickedVisits.length} visit${pickedVisits.length === 1 ? '' : 's'} (${money(pickedTotal)})?` +
      (pickedUndocumented ? `\n\n${pickedUndocumented} of them ha${pickedUndocumented === 1 ? 's' : 've'} no note yet — the packet will say "No note recorded".` : '') +
      '\n\nNothing is emailed; it is saved as a draft.');
    if (!ok) return;
    setCreating(true); setMessage(null);
    try {
      const r = await fetch(`${API_BASE_URL}/api/visit-docs/clients/${clientId}/invoice`, {
        method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ visits: pickedVisits.map((v) => ({ visitDate: v.visit_date, startTime: v.start_time, caregiverId: v.caregiver_id })) }),
      });
      const body = await r.json();
      if (!r.ok) throw new Error(body.error || `HTTP ${r.status}`);
      setMessage({ type: 'success', text: `Created draft invoice ${body.invoice_number} — ${money(body.total)}. Download its packet below.` });
      await load(true);
    } catch (e) {
      setMessage({ type: 'error', text: `Invoice not created: ${e.message}` });
    } finally { setCreating(false); }
  };

  // Writes the same note (with every care task ticked) to visits that have none.
  // Visits that already have a note are left alone.
  const bulkFill = async () => {
    setBulkBusy(true); setMessage(null);
    try {
      const r = await fetch(`${API_BASE_URL}/api/visit-docs/clients/${clientId}/visits/bulk`, {
        method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ from, to, note: bulkNote, onlyMissing: true }),
      });
      const body = await r.json();
      if (!r.ok) throw new Error(body.error || `HTTP ${r.status}`);
      setBulkOpen(false);
      setMessage({ type: 'success', text: `Filled ${body.written} visit${body.written === 1 ? '' : 's'}${body.skipped ? `, left ${body.skipped} that already had a note` : ''}. Edit any day that was different.` });
      await load(true);
    } catch (e) {
      setMessage({ type: 'error', text: `Bulk fill failed: ${e.message}` });
    } finally { setBulkBusy(false); }
  };

  // The care notes on their own, for the date range on screen — no invoice.
  const downloadNotes = async () => {
    try {
      const r = await fetch(`${API_BASE_URL}/api/visit-docs/clients/${clientId}/notes.pdf?from=${from}&to=${to}`, { headers });
      if (!r.ok) { const b = await r.json().catch(() => ({})); throw new Error(b.error || `HTTP ${r.status}`); }
      const url = window.URL.createObjectURL(await r.blob());
      const a = document.createElement('a');
      a.href = url; a.download = `care-notes-${data?.client?.name?.replace(/\s+/g, '-') || 'client'}-${from}-to-${to}.pdf`; a.click();
      window.URL.revokeObjectURL(url);
    } catch (e) { setMessage({ type: 'error', text: `Care notes PDF failed: ${e.message}` }); }
  };

  const downloadPacket = async (inv) => {
    try {
      const r = await fetch(`${API_BASE_URL}/api/visit-docs/invoices/${inv.id}/packet.pdf`, { headers });
      if (!r.ok) { const b = await r.json().catch(() => ({})); throw new Error(b.error || `HTTP ${r.status}`); }
      const url = window.URL.createObjectURL(await r.blob());
      const a = document.createElement('a');
      a.href = url; a.download = `invoice-packet-${inv.invoice_number}.pdf`; a.click();
      window.URL.revokeObjectURL(url);
    } catch (e) { setMessage({ type: 'error', text: `Packet download failed: ${e.message}` }); }
  };

  const documented = (data?.visits || []).filter((v) => v.doc).length;

  return (
    <div>
      <div className="page-header">
        <h2>📝 Visit Documentation</h2>
      </div>
      <p style={{ color: '#6B7280', marginTop: 0 }}>
        Enter the care note for each scheduled visit, then tick visits to put on an invoice. The invoice packet PDF prints the invoice followed by the notes for exactly those visits.
      </p>

      <div className="card" style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', alignItems: 'flex-end' }}>
        <div className="form-group" style={{ minWidth: 220, flex: '1 1 220px', marginBottom: 0 }}>
          <label>Client</label>
          <select value={clientId} onChange={(e) => { setClientId(e.target.value); setOpenKey(null); }}>
            <option value="">Select a client…</option>
            {clients.map((c) => <option key={c.id} value={c.id}>{c.last_name}, {c.first_name}</option>)}
          </select>
        </div>
        <div className="form-group" style={{ marginBottom: 0 }}>
          <label>From</label>
          <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        </div>
        <div className="form-group" style={{ marginBottom: 0 }}>
          <label>To</label>
          <input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        </div>
      </div>

      {message && (
        <div className={`alert ${message.type === 'error' ? 'alert-error' : 'alert-success'}`}
          style={{ margin: '0.75rem 0', padding: '0.6rem 0.9rem', borderRadius: 6, whiteSpace: 'pre-wrap',
                   background: message.type === 'error' ? '#FEF2F2' : '#ECFDF5', color: message.type === 'error' ? '#991B1B' : '#065F46' }}>
          {message.text}
        </div>
      )}

      {!clientId && <div className="card" style={{ color: '#6B7280' }}>Pick a client to see their scheduled visits.</div>}
      {clientId && loading && <div className="card">Loading visits…</div>}

      {clientId && !loading && data && (
        <>
          <div className="card" style={{ display: 'flex', gap: '1.5rem', flexWrap: 'wrap', alignItems: 'center' }}>
            <div><strong>{data.client.name}</strong>{data.client.payer ? ` · ${data.client.payer}` : ''}</div>
            <div>{data.visits.length} visits · {documented} with notes</div>
            <div>Rate: {data.rate ? `${money(data.rate.rate)}/hr` : <span style={{ color: '#B91C1C' }}>none set — invoices can't be created</span>}</div>
            {data.homemakingMinutesPerVisit > 0 && (
              <div style={{ color: '#6B7280' }}>Each visit bills {data.homemakingMinutesPerVisit} min homemaking, the rest home health aide</div>
            )}
            <button className="btn btn-sm btn-secondary" style={{ marginLeft: 'auto' }} onClick={downloadNotes}
              title="Print the care notes for this date range, with no invoice">
              📄 Print care notes ({from} – {to})
            </button>
          </div>

          <div className="card" style={{ position: 'sticky', top: 'env(safe-area-inset-top, 0px)', zIndex: 5, display: 'flex', gap: '0.75rem', flexWrap: 'wrap', alignItems: 'center' }}>
            <button className="btn btn-sm btn-secondary" disabled={!billable.length}
              onClick={() => setSelected(new Set(billable.map(vkey)))}>Select all not invoiced ({billable.length})</button>
            <button className="btn btn-sm btn-secondary" disabled={!selected.size} onClick={() => setSelected(new Set())}>Clear</button>
            <button className="btn btn-sm btn-secondary" disabled={!data.visits.some((v) => !v.doc)}
              onClick={() => setBulkOpen(true)}
              title="Write one note, with the care-plan tasks ticked, to every visit that has no note yet">
              Fill notes for visits without one ({data.visits.filter((v) => !v.doc).length})
            </button>
            <span style={{ flex: '1 1 auto' }}>
              {selected.size ? <>{selected.size} selected · <strong>{money(pickedTotal)}</strong>{pickedUndocumented ? <span style={{ color: '#B45309' }}> · {pickedUndocumented} without a note</span> : null}</> : 'Tick visits to invoice'}
            </span>
            <button className="btn btn-primary" disabled={!selected.size || !data.rate || creating} onClick={createInvoice}>
              {creating ? 'Creating…' : `Create invoice from ${selected.size || ''} selected`}
            </button>
          </div>

          {bulkOpen && (
            <div className="card" style={{ border: '1px solid #93C5FD', background: '#EFF6FF' }}>
              <strong>Fill {data.visits.filter((v) => !v.doc).length} visits without a note</strong>
              <p style={{ margin: '0.4rem 0', color: '#374151' }}>
                This note is written to each of those visits, with every care task ticked. Visits that already have a note are left alone. Edit any day that was different afterwards.
              </p>
              <textarea rows={3} style={{ width: '100%' }} value={bulkNote} onChange={(e) => setBulkNote(e.target.value)} />
              <div style={{ display: 'flex', gap: 8, marginTop: 6 }}>
                <button className="btn btn-primary btn-sm" disabled={bulkBusy || !bulkNote.trim()} onClick={bulkFill}>
                  {bulkBusy ? 'Filling…' : `Fill ${data.visits.filter((v) => !v.doc).length} visits`}
                </button>
                <button className="btn btn-secondary btn-sm" onClick={() => setBulkOpen(false)}>Cancel</button>
              </div>
            </div>
          )}

          <div className="card" style={{ overflowX: 'auto', padding: 0 }}>
            <table className="table" style={{ width: '100%', borderCollapse: 'collapse', minWidth: 640 }}>
              <thead>
                <tr style={{ background: '#F9FAFB', textAlign: 'left' }}>
                  <th style={{ padding: '0.5rem', width: 36 }}></th>
                  <th style={{ padding: '0.5rem' }}>Date</th>
                  <th style={{ padding: '0.5rem' }}>Time</th>
                  <th style={{ padding: '0.5rem' }}>Caregiver</th>
                  <th style={{ padding: '0.5rem' }}>Note</th>
                  <th style={{ padding: '0.5rem' }}>Invoice</th>
                  <th style={{ padding: '0.5rem' }}></th>
                </tr>
              </thead>
              <tbody>
                {data.visits.length === 0 && (
                  <tr><td colSpan={7} style={{ padding: '1rem', color: '#6B7280' }}>No scheduled visits in this date range.</td></tr>
                )}
                {data.visits.map((v) => {
                  const k = vkey(v);
                  const odd = v.minutes > 480; // e.g. 6/19 entered as 1:00 AM – 3:00 PM
                  return (
                    <React.Fragment key={k}>
                      <tr style={{ borderTop: '1px solid #E5E7EB', background: openKey === k ? '#EFF6FF' : undefined }}>
                        <td style={{ padding: '0.5rem' }}>
                          <input type="checkbox" disabled={!!v.invoiced} checked={selected.has(k)} onChange={() => toggle(v)}
                            title={v.invoiced ? `Already on invoice ${v.invoiced.invoiceNumber}` : 'Include on the next invoice'} />
                        </td>
                        <td style={{ padding: '0.5rem', whiteSpace: 'nowrap' }}>{weekday(v.visit_date)} {fmtDate(v.visit_date)}</td>
                        <td style={{ padding: '0.5rem', whiteSpace: 'nowrap' }}>
                          {fmtTime(v.start_time)} – {fmtTime(v.end_time)}
                          {odd && <span title="Unusually long — check the schedule" style={{ color: '#B91C1C', marginLeft: 6 }}>⚠ {(v.minutes / 60).toFixed(1)} h</span>}
                        </td>
                        <td style={{ padding: '0.5rem' }}>{v.caregiver_name}</td>
                        <td style={{ padding: '0.5rem', maxWidth: 280 }}>
                          {v.doc
                            ? <span style={{ color: '#065F46' }}>✓ {v.doc.note ? (v.doc.note.length > 60 ? `${v.doc.note.slice(0, 60)}…` : v.doc.note) : 'Tasks only'}</span>
                            : <span style={{ color: '#9CA3AF' }}>No note</span>}
                        </td>
                        <td style={{ padding: '0.5rem', whiteSpace: 'nowrap' }}>{v.invoiced ? v.invoiced.invoiceNumber : '—'}</td>
                        <td style={{ padding: '0.5rem' }}>
                          <button className="btn btn-sm btn-secondary" onClick={() => openVisit(v)}>{openKey === k ? 'Close' : v.doc ? 'Edit note' : 'Add note'}</button>
                        </td>
                      </tr>
                      {openKey === k && (
                        <tr style={{ background: '#EFF6FF' }}>
                          <td></td>
                          <td colSpan={6} style={{ padding: '0.5rem 0.5rem 1rem' }}>
                            {draft.tasks.length === 0 && <div style={{ color: '#6B7280', marginBottom: 6 }}>This client has no care tasks set (Clients → Care Tasks).</div>}
                            {draft.tasks.map((t, i) => (
                              <label key={t.taskId} style={{ display: 'flex', gap: 8, alignItems: 'center', margin: '4px 0', cursor: 'pointer' }}>
                                <input type="checkbox" checked={t.done}
                                  onChange={(e) => setDraft((d) => ({ ...d, tasks: d.tasks.map((x, j) => (j === i ? { ...x, done: e.target.checked } : x)) }))} />
                                {t.taskName}
                              </label>
                            ))}
                            <textarea rows={3} style={{ width: '100%', marginTop: 6 }} placeholder="What happened on this visit…"
                              value={draft.note} onChange={(e) => setDraft((d) => ({ ...d, note: e.target.value }))} />
                            <div style={{ display: 'flex', gap: 8, marginTop: 6 }}>
                              <button className="btn btn-primary btn-sm" disabled={saving} onClick={() => saveVisit(v)}>{saving ? 'Saving…' : 'Save note'}</button>
                              <button className="btn btn-secondary btn-sm" onClick={() => setOpenKey(null)}>Cancel</button>
                              {v.doc?.updated_at && <span style={{ color: '#6B7280', alignSelf: 'center', fontSize: '0.85rem' }}>
                                Saved by {v.doc.entered_by_name || 'office'}</span>}
                            </div>
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="card">
            <h3 style={{ marginTop: 0 }}>Invoices in this date range</h3>
            {data.invoices.length === 0 ? <div style={{ color: '#6B7280' }}>None yet.</div> : (
              <div style={{ overflowX: 'auto' }}>
                <table className="table" style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead><tr style={{ textAlign: 'left' }}><th>Invoice</th><th>Period</th><th>Total</th><th>Status</th><th></th></tr></thead>
                  <tbody>
                    {data.invoices.map((inv) => (
                      <tr key={inv.id} style={{ borderTop: '1px solid #E5E7EB' }}>
                        <td style={{ padding: '0.4rem 0' }}>{inv.invoice_number}</td>
                        <td>{fmtDate(inv.start)} – {fmtDate(inv.end)}</td>
                        <td>{money(inv.total)}</td>
                        <td>{inv.payment_status}{inv.sent_at ? '' : ' (draft)'}</td>
                        <td><button className="btn btn-sm btn-secondary" onClick={() => downloadPacket(inv)}>📄 Invoice + notes PDF</button></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
};

export default VisitDocumentation;
