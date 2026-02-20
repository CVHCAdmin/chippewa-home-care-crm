// src/components/admin/CaregiverDetail.jsx
// Complete caregiver record: edit all info, hours, earnings, schedule, background checks
import React, { useState, useEffect, useCallback } from 'react';
import { API_BASE_URL } from '../../config';
import { toast } from '../Toast';

const fmt$ = (n) => n != null ? `$${parseFloat(n||0).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g,',')}` : '—';
const fmtHrs = (n) => n != null ? `${parseFloat(n||0).toFixed(1)}h` : '—';
const fmtDate = (d) => d ? new Date(d).toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'}) : '—';
const fmtDateTime = (d) => d ? new Date(d).toLocaleString('en-US',{month:'short',day:'numeric',hour:'numeric',minute:'2-digit'}) : '—';
const DAYS = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];

const s = {
  page: { maxWidth: 960, margin: '0 auto', fontFamily: "'DM Sans', system-ui, sans-serif" },
  header: { background: 'linear-gradient(135deg, #0F172A 0%, #1E293B 100%)', borderRadius: 16, padding: '1.75rem 2rem', marginBottom: '1.25rem', color: '#fff', position: 'relative', overflow: 'hidden' },
  headerAccent: { position: 'absolute', right: -40, top: -40, width: 220, height: 220, borderRadius: '50%', background: 'rgba(42,187,167,0.12)', pointerEvents: 'none' },
  avatar: { width: 64, height: 64, borderRadius: '50%', background: 'linear-gradient(135deg,#2ABBA7,#0891B2)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '1.5rem', fontWeight: 800, color: '#fff', flexShrink: 0 },
  tab: (active) => ({ padding: '0.55rem 1.1rem', border: 'none', background: 'none', cursor: 'pointer', fontWeight: active ? 800 : 500, fontSize: '0.85rem', color: active ? '#2ABBA7' : '#6B7280', borderBottom: `2px solid ${active ? '#2ABBA7' : 'transparent'}`, marginBottom: -2, whiteSpace: 'nowrap', transition: 'all 0.15s' }),
  card: { background: '#fff', borderRadius: 14, border: '1px solid #E5E7EB', padding: '1.25rem', marginBottom: '1rem' },
  label: { display: 'block', fontWeight: 700, fontSize: '0.75rem', color: '#6B7280', marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.04em' },
  input: { width: '100%', padding: '0.55rem 0.75rem', border: '1px solid #D1D5DB', borderRadius: 8, fontSize: '0.875rem', boxSizing: 'border-box', background: '#fff', outline: 'none', transition: 'border-color 0.15s' },
  btn: (color='#2ABBA7', outline=false) => ({ padding: '0.55rem 1.25rem', background: outline?'#fff':color, color: outline?color:'#fff', border: outline?`2px solid ${color}`:'none', borderRadius: 8, cursor: 'pointer', fontWeight: 700, fontSize: '0.85rem' }),
  statBox: (accent='#2ABBA7') => ({ padding: '1rem', background: '#F9FAFB', borderRadius: 12, borderLeft: `4px solid ${accent}`, flex: 1, minWidth: 120 }),
  badge: (color='#2ABBA7', bg='#D1FAE5') => ({ padding: '2px 10px', borderRadius: 99, fontSize: '0.72rem', fontWeight: 700, color, background: bg }),
};

const TABS = [
  { id: 'overview', label: '📊 Overview' },
  { id: 'personal', label: '👤 Personal Info' },
  { id: 'schedule', label: '📅 Schedule' },
  { id: 'shifts', label: '🕐 Shifts' },
  { id: 'background', label: '🔍 Background Check' },
  { id: 'evv', label: '📍 EVV / Geofence' },
];

export default function CaregiverDetail({ caregiverId, token, onBack, onHireComplete }) {
  const [tab, setTab] = useState('overview');
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [editing, setEditing] = useState(false);
  const [bgChecks, setBgChecks] = useState([]);
  const [payers, setPayers] = useState([]);

  // Edit form state
  const [form, setForm] = useState({});
  const [bgForm, setBgForm] = useState({ checkType: 'criminal', provider: '', cost: '', notes: '', status: 'pending' });
  const [showBgForm, setShowBgForm] = useState(false);
  const [geocoding, setGeocoding] = useState(false);
  const [shiftFilter, setShiftFilter] = useState({ start: '', end: '' });
  const [allShifts, setAllShifts] = useState(null);

  const hdr = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [sumRes, bgRes, profRes] = await Promise.all([
        fetch(`${API_BASE_URL}/api/caregivers/${caregiverId}/summary`, { headers: hdr }),
        fetch(`${API_BASE_URL}/api/background-checks/caregiver/${caregiverId}`, { headers: hdr }),
        fetch(`${API_BASE_URL}/api/caregiver-profile/${caregiverId}`, { headers: hdr }),
      ]);
      const sum = sumRes.ok ? await sumRes.json() : {};
      const bg = bgRes.ok ? await bgRes.json() : [];
      const prof = profRes.ok ? await profRes.json() : {};
      setData(sum);
      setBgChecks(Array.isArray(bg) ? bg : []);
      // Populate form from profile - merge summary profile + separate profile endpoint
      const p = sum.profile || {};
      setForm({
        firstName: p.first_name || '',
        lastName: p.last_name || '',
        email: p.email || '',
        phone: p.phone || '',
        payRate: p.default_pay_rate || '',
        address: p.address || '',
        city: p.city || '',
        state: p.state || '',
        zip: p.zip || '',
        hireDate: p.hire_date ? p.hire_date.split('T')[0] : '',
        emergencyContactName: p.emergency_contact_name || '',
        emergencyContactPhone: p.emergency_contact_phone || '',
        isActive: p.is_active !== false,
        notes: p.notes || prof.notes || '',
        capabilities: p.capabilities || prof.capabilities || '',
        limitations: p.limitations || prof.limitations || '',
        npiNumber: p.npi_number || prof.npi_number || '',
        evvWorkerId: p.evv_worker_id || prof.evv_worker_id || '',
      });
    } catch (e) { toast('Failed to load caregiver', 'error'); }
    setLoading(false);
  }, [caregiverId]);

  useEffect(() => { load(); }, [load]);

  const save = async () => {
    setSaving(true);
    try {
      const r = await fetch(`${API_BASE_URL}/api/caregivers/${caregiverId}`, {
        method: 'PUT', headers: hdr,
        body: JSON.stringify({
          firstName: form.firstName, lastName: form.lastName, email: form.email,
          phone: form.phone, payRate: parseFloat(form.payRate) || null,
          address: form.address, city: form.city, state: form.state, zip: form.zip,
          hireDate: form.hireDate || null,
          emergencyContactName: form.emergencyContactName,
          emergencyContactPhone: form.emergencyContactPhone,
          isActive: form.isActive,
        })
      });
      // Also save profile notes
      await fetch(`${API_BASE_URL}/api/caregiver-profile/${caregiverId}`, {
        method: 'PATCH', headers: hdr,
        body: JSON.stringify({ notes: form.notes, capabilities: form.capabilities, limitations: form.limitations })
      });
      if (r.ok) { toast('Saved successfully', 'success'); setEditing(false); load(); }
      else { const d = await r.json(); toast(d.error || 'Save failed', 'error'); }
    } catch (e) { toast('Save failed', 'error'); }
    setSaving(false);
  };

  const geocodeAddress = async () => {
    if (!form.address) return toast('Enter an address first', 'error');
    setGeocoding(true);
    try {
      const r = await fetch(`${API_BASE_URL}/api/route-optimizer/geocode`, {
        method: 'POST', headers: hdr,
        body: JSON.stringify({ address: form.address, city: form.city, state: form.state, zip: form.zip, entityType: 'caregiver', entityId: caregiverId })
      });
      const d = await r.json();
      if (r.ok) toast(`📍 Geocoded: ${d.formattedAddress}`, 'success');
      else toast(d.error || 'Geocoding failed', 'error');
    } catch(e) { toast('Geocoding failed', 'error'); }
    setGeocoding(false);
  };

  const addBgCheck = async () => {
    try {
      const r = await fetch(`${API_BASE_URL}/api/background-checks`, {
        method: 'POST', headers: hdr,
        body: JSON.stringify({ caregiverId, ...bgForm })
      });
      if (r.ok) { toast('Background check added', 'success'); setShowBgForm(false); setBgForm({ checkType: 'criminal', provider: '', cost: '', notes: '', status: 'pending' }); load(); }
      else { const d = await r.json(); toast(d.error || 'Failed', 'error'); }
    } catch(e) { toast('Failed', 'error'); }
  };

  const deactivate = async () => {
    if (!window.confirm(`${form.isActive ? 'Deactivate' : 'Reactivate'} this caregiver?`)) return;
    const r = await fetch(`${API_BASE_URL}/api/caregivers/${caregiverId}`, {
      method: 'PUT', headers: hdr, body: JSON.stringify({ isActive: !form.isActive })
    });
    if (r.ok) { toast(`Caregiver ${form.isActive ? 'deactivated' : 'reactivated'}`, 'success'); load(); }
  };

  const resetPassword = async () => {
    const newPwd = `CVHC${form.lastName.charAt(0).toUpperCase()}${Math.random().toString(36).slice(-6)}`;
    const r = await fetch(`${API_BASE_URL}/api/users/${caregiverId}/reset-password`, {
      method: 'POST', headers: hdr, body: JSON.stringify({ newPassword: newPwd })
    });
    if (r.ok) toast(`New temp password: ${newPwd} — send to caregiver`, 'success');
    else toast('Password reset failed', 'error');
  };

  if (loading) return <div style={{textAlign:'center',padding:'3rem',color:'#6B7280'}}>Loading caregiver...</div>;
  if (!data) return <div style={{textAlign:'center',padding:'3rem',color:'#EF4444'}}>Could not load caregiver data.</div>;

  const { profile, earnings, clients, recentShifts, schedule, payRates } = data;
  const fullName = `${profile?.first_name || ''} ${profile?.last_name || ''}`.trim();
  const initials = `${(profile?.first_name||'')[0]||''}${(profile?.last_name||'')[0]||''}`.toUpperCase();

  // ── OVERVIEW ─────────────────────────────────────────────────────────────────
  const renderOverview = () => (
    <div>
      <div style={{ display: 'flex', gap: '0.75rem', marginBottom: '1rem', flexWrap: 'wrap' }}>
        {[
          { label: 'Hours This Month', val: fmtHrs(earnings?.hours_this_month), accent: '#2ABBA7' },
          { label: 'Earnings This Month', val: fmt$(earnings?.earnings_this_month), accent: '#6366F1' },
          { label: 'Hours This Week', val: fmtHrs(earnings?.hours_this_week), accent: '#0891B2' },
          { label: 'Total Hours (All Time)', val: fmtHrs(earnings?.total_hours), accent: '#F59E0B' },
          { label: 'Avg Shift', val: fmtHrs(earnings?.avg_shift_hours), accent: '#8B5CF6' },
        ].map(s2 => (
          <div key={s2.label} style={s.statBox(s2.accent)}>
            <div style={{ fontSize: '1.3rem', fontWeight: 800, color: s2.accent }}>{s2.val}</div>
            <div style={{ fontSize: '0.72rem', color: '#6B7280', marginTop: 2 }}>{s2.label}</div>
          </div>
        ))}
      </div>

      {/* Clients served */}
      <div style={s.card}>
        <div style={{ fontWeight: 800, marginBottom: '0.75rem', fontSize: '0.9rem' }}>🧑‍🤝‍🧑 Clients Served ({clients?.length || 0})</div>
        {clients?.length > 0 ? (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(220px,1fr))', gap: '0.6rem' }}>
            {clients.map(c => (
              <div key={c.id} style={{ padding: '0.75rem', background: '#F9FAFB', borderRadius: 10, border: '1px solid #E5E7EB' }}>
                <div style={{ fontWeight: 700, fontSize: '0.875rem' }}>{c.first_name} {c.last_name}</div>
                <div style={{ fontSize: '0.78rem', color: '#6B7280' }}>{c.address}, {c.city}</div>
                <div style={{ fontSize: '0.78rem', color: '#374151', marginTop: 4 }}>
                  {c.shift_count} shifts · {fmtHrs(c.total_hours)} · Last: {fmtDate(c.last_visit)}
                </div>
              </div>
            ))}
          </div>
        ) : <p style={{ color: '#9CA3AF', fontSize: '0.875rem' }}>No completed shifts yet.</p>}
      </div>

      {/* Recent shifts */}
      <div style={s.card}>
        <div style={{ fontWeight: 800, marginBottom: '0.75rem', fontSize: '0.9rem' }}>🕐 Recent Shifts</div>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.82rem' }}>
          <thead>
            <tr style={{ background: '#F9FAFB' }}>
              {['Client', 'Date', 'Start', 'End', 'Hours', 'Status'].map(h => (
                <th key={h} style={{ padding: '0.4rem 0.75rem', textAlign: 'left', fontWeight: 700, color: '#374151', borderBottom: '1px solid #E5E7EB' }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {recentShifts?.map(sh => (
              <tr key={sh.id} style={{ borderBottom: '1px solid #F3F4F6' }}>
                <td style={{ padding: '0.4rem 0.75rem', fontWeight: 600 }}>{sh.client_first} {sh.client_last}</td>
                <td style={{ padding: '0.4rem 0.75rem', color: '#6B7280' }}>{fmtDate(sh.start_time)}</td>
                <td style={{ padding: '0.4rem 0.75rem' }}>{new Date(sh.start_time).toLocaleTimeString('en-US',{hour:'numeric',minute:'2-digit'})}</td>
                <td style={{ padding: '0.4rem 0.75rem' }}>{sh.end_time ? new Date(sh.end_time).toLocaleTimeString('en-US',{hour:'numeric',minute:'2-digit'}) : '—'}</td>
                <td style={{ padding: '0.4rem 0.75rem', fontWeight: 700 }}>{sh.hours ? fmtHrs(sh.hours) : '—'}</td>
                <td style={{ padding: '0.4rem 0.75rem' }}>
                  <span style={s.badge(sh.is_complete?'#065F46':'#92400E', sh.is_complete?'#D1FAE5':'#FEF3C7')}>
                    {sh.is_complete ? 'Complete' : 'Active'}
                  </span>
                </td>
              </tr>
            ))}
            {!recentShifts?.length && <tr><td colSpan={6} style={{ padding: '1.5rem', textAlign: 'center', color: '#9CA3AF' }}>No shifts yet</td></tr>}
          </tbody>
        </table>
      </div>

      {/* Upcoming schedule */}
      <div style={s.card}>
        <div style={{ fontWeight: 800, marginBottom: '0.75rem', fontSize: '0.9rem' }}>📅 Upcoming Schedule ({schedule?.length || 0} shifts)</div>
        {schedule?.length > 0 ? (
          <div style={{ display: 'grid', gap: '0.4rem' }}>
            {schedule.map(sc => (
              <div key={sc.id} style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', padding: '0.6rem 0.75rem', background: '#F0FDFB', borderRadius: 8, border: '1px solid #A7F3D0' }}>
                <div style={{ fontWeight: 700, fontSize: '0.82rem', minWidth: 80, color: '#065F46' }}>{fmtDate(sc.date)}</div>
                <div style={{ fontSize: '0.82rem', color: '#374151' }}>{sc.start_time?.slice(0,5)} – {sc.end_time?.slice(0,5)}</div>
                <div style={{ fontSize: '0.82rem', fontWeight: 600 }}>{sc.client_first} {sc.client_last}</div>
                {sc.care_type_name && <span style={{ fontSize: '0.72rem', color: '#6B7280' }}>{sc.care_type_name}</span>}
              </div>
            ))}
          </div>
        ) : <p style={{ color: '#9CA3AF', fontSize: '0.875rem' }}>No upcoming shifts scheduled.</p>}
      </div>
    </div>
  );

  // ── PERSONAL INFO ─────────────────────────────────────────────────────────────
  const F = ({ label, field, type='text', half=false }) => (
    <div style={{ gridColumn: half ? 'span 1' : 'span 1' }}>
      <label style={s.label}>{label}</label>
      {editing ? (
        <input
          type={type}
          value={form[field] ?? ''}
          onChange={e => setForm(p => ({ ...p, [field]: type === 'checkbox' ? e.target.checked : e.target.value }))}
          style={s.input}
        />
      ) : (
        <div style={{ padding: '0.55rem 0', fontSize: '0.875rem', color: form[field] ? '#111827' : '#9CA3AF', borderBottom: '1px solid #F3F4F6' }}>
          {form[field] || '—'}
        </div>
      )}
    </div>
  );

  const renderPersonal = () => (
    <div>
      <div style={{ ...s.card }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.25rem' }}>
          <div style={{ fontWeight: 800, fontSize: '0.95rem' }}>Personal Information</div>
          <div style={{ display: 'flex', gap: '0.5rem' }}>
            {editing ? (
              <>
                <button style={s.btn()} onClick={save} disabled={saving}>{saving ? 'Saving...' : '💾 Save'}</button>
                <button style={s.btn('#6B7280', true)} onClick={() => { setEditing(false); load(); }}>Cancel</button>
              </>
            ) : (
              <button style={s.btn()} onClick={() => setEditing(true)}>✏️ Edit All</button>
            )}
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
          <F label="First Name" field="firstName" />
          <F label="Last Name" field="lastName" />
          <F label="Email Address" field="email" type="email" />
          <F label="Phone" field="phone" type="tel" />
          <F label="Hourly Pay Rate ($)" field="payRate" type="number" />
          <F label="Hire Date" field="hireDate" type="date" />
          <F label="Address" field="address" />
          <F label="City" field="city" />
          <F label="State" field="state" half />
          <F label="Zip" field="zip" half />
          <F label="Emergency Contact Name" field="emergencyContactName" />
          <F label="Emergency Contact Phone" field="emergencyContactPhone" type="tel" />
        </div>

        {editing && (
          <div style={{ marginTop: '1rem', paddingTop: '1rem', borderTop: '1px solid #F3F4F6' }}>
            <button style={{ ...s.btn('#6366F1'), marginRight: '0.5rem' }} onClick={geocodeAddress} disabled={geocoding}>
              {geocoding ? '📍 Geocoding...' : '📍 Geocode Address (for GPS clock-in)'}
            </button>
            <span style={{ fontSize: '0.78rem', color: '#6B7280' }}>Sets GPS coordinates so geofence auto clock-in works</span>
          </div>
        )}
      </div>

      {/* Profile notes */}
      <div style={s.card}>
        <div style={{ fontWeight: 800, fontSize: '0.95rem', marginBottom: '1rem' }}>Professional Details</div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
          <F label="NPI Number (billing)" field="npiNumber" />
          <F label="EVV Worker ID (Sandata)" field="evvWorkerId" />
          <div style={{ gridColumn: 'span 2' }}>
            <label style={s.label}>Capabilities / Skills</label>
            {editing ? <textarea value={form.capabilities} onChange={e=>setForm(p=>({...p,capabilities:e.target.value}))} style={{...s.input, minHeight:80, resize:'vertical'}} /> : <div style={{padding:'0.55rem 0',fontSize:'0.875rem',color:form.capabilities?'#111827':'#9CA3AF'}}>{form.capabilities||'—'}</div>}
          </div>
          <div style={{ gridColumn: 'span 2' }}>
            <label style={s.label}>Limitations / Notes</label>
            {editing ? <textarea value={form.limitations} onChange={e=>setForm(p=>({...p,limitations:e.target.value}))} style={{...s.input, minHeight:60, resize:'vertical'}} /> : <div style={{padding:'0.55rem 0',fontSize:'0.875rem',color:form.limitations?'#111827':'#9CA3AF'}}>{form.limitations||'—'}</div>}
          </div>
        </div>
      </div>

      {/* Status & account */}
      <div style={s.card}>
        <div style={{ fontWeight: 800, fontSize: '0.95rem', marginBottom: '1rem' }}>Account Actions</div>
        <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
          <button style={s.btn(form.isActive ? '#EF4444' : '#2ABBA7', true)} onClick={deactivate}>
            {form.isActive ? '🔴 Deactivate' : '🟢 Reactivate'}
          </button>
          <button style={s.btn('#6366F1', true)} onClick={resetPassword}>🔑 Reset Password</button>
        </div>
        <p style={{ fontSize: '0.78rem', color: '#9CA3AF', marginTop: '0.5rem' }}>
          Member since {fmtDate(profile?.created_at)} · Hire date: {fmtDate(profile?.hire_date) || 'not set'}
        </p>
      </div>

      {/* Pay rate history */}
      {payRates?.length > 0 && (
        <div style={s.card}>
          <div style={{ fontWeight: 800, fontSize: '0.95rem', marginBottom: '0.75rem' }}>💰 Pay Rate History</div>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.82rem' }}>
            <thead><tr style={{background:'#F9FAFB'}}>{['Rate','Effective Date','Notes'].map(h=><th key={h} style={{padding:'0.4rem 0.75rem',textAlign:'left',fontWeight:700,borderBottom:'1px solid #E5E7EB'}}>{h}</th>)}</tr></thead>
            <tbody>{payRates.map(r=><tr key={r.id} style={{borderBottom:'1px solid #F3F4F6'}}><td style={{padding:'0.4rem 0.75rem',fontWeight:700,color:'#2ABBA7'}}>{fmt$(r.rate)}</td><td style={{padding:'0.4rem 0.75rem',color:'#6B7280'}}>{fmtDate(r.effective_date)}</td><td style={{padding:'0.4rem 0.75rem',color:'#374151'}}>{r.notes||'—'}</td></tr>)}</tbody>
          </table>
        </div>
      )}
    </div>
  );

  // ── SCHEDULE TAB ──────────────────────────────────────────────────────────────
  const renderSchedule = () => (
    <div style={s.card}>
      <div style={{ fontWeight: 800, fontSize: '0.95rem', marginBottom: '1rem' }}>📅 Upcoming Schedule</div>
      {schedule?.length > 0 ? (
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.82rem' }}>
          <thead><tr style={{background:'#F9FAFB'}}>{['Date','Day','Time','Client','Type','Notes'].map(h=><th key={h} style={{padding:'0.5rem 0.75rem',textAlign:'left',fontWeight:700,color:'#374151',borderBottom:'1px solid #E5E7EB'}}>{h}</th>)}</tr></thead>
          <tbody>
            {schedule.map(sc => (
              <tr key={sc.id} style={{borderBottom:'1px solid #F3F4F6'}}>
                <td style={{padding:'0.5rem 0.75rem',fontWeight:600}}>{fmtDate(sc.date)}</td>
                <td style={{padding:'0.5rem 0.75rem',color:'#6B7280'}}>{sc.date ? DAYS[new Date(sc.date).getDay()] : '—'}</td>
                <td style={{padding:'0.5rem 0.75rem'}}>{sc.start_time?.slice(0,5)} – {sc.end_time?.slice(0,5)}</td>
                <td style={{padding:'0.5rem 0.75rem',fontWeight:600}}>{sc.client_first} {sc.client_last}</td>
                <td style={{padding:'0.5rem 0.75rem',color:'#6B7280'}}>{sc.care_type_name||'—'}</td>
                <td style={{padding:'0.5rem 0.75rem',color:'#374151'}}>{sc.notes||'—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : <p style={{color:'#9CA3AF',fontSize:'0.875rem'}}>No upcoming shifts scheduled.</p>}
    </div>
  );

  // ── SHIFTS TAB ─────────────────────────────────────────────────────────────────
  const loadShifts = async () => {
    const params = new URLSearchParams();
    if (shiftFilter.start) params.set('startDate', shiftFilter.start + 'T00:00:00');
    if (shiftFilter.end) params.set('endDate', shiftFilter.end + 'T23:59:59');
    params.set('limit', '100');
    const r = await fetch(`${API_BASE_URL}/api/time-entries/caregiver-history/${caregiverId}?${params}`, { headers: hdr });
    if (r.ok) setAllShifts(await r.json());
  };

  const renderShifts = () => {
    const shifts = allShifts || recentShifts || [];
    const totalHrs = shifts.filter(s=>s.is_complete).reduce((sum,s)=>sum+parseFloat(s.hours||0),0);
    const totalEarn = totalHrs * parseFloat(profile?.default_pay_rate || 0);
    return (
      <div>
        <div style={{...s.card, display:'flex', gap:'0.75rem', alignItems:'flex-end', flexWrap:'wrap'}}>
          <div><label style={s.label}>From</label><input type="date" value={shiftFilter.start} onChange={e=>setShiftFilter(p=>({...p,start:e.target.value}))} style={{...s.input,width:'auto'}}/></div>
          <div><label style={s.label}>To</label><input type="date" value={shiftFilter.end} onChange={e=>setShiftFilter(p=>({...p,end:e.target.value}))} style={{...s.input,width:'auto'}}/></div>
          <button style={s.btn()} onClick={loadShifts}>Search</button>
          {allShifts && <button style={s.btn('#6B7280',true)} onClick={()=>setAllShifts(null)}>Clear</button>}
        </div>
        {allShifts && (
          <div style={{display:'flex',gap:'0.75rem',marginBottom:'1rem',flexWrap:'wrap'}}>
            <div style={s.statBox('#2ABBA7')}><div style={{fontSize:'1.2rem',fontWeight:800,color:'#2ABBA7'}}>{fmtHrs(totalHrs)}</div><div style={{fontSize:'0.72rem',color:'#6B7280'}}>Hours in Period</div></div>
            <div style={s.statBox('#6366F1')}><div style={{fontSize:'1.2rem',fontWeight:800,color:'#6366F1'}}>{fmt$(totalEarn)}</div><div style={{fontSize:'0.72rem',color:'#6B7280'}}>Est. Earnings</div></div>
            <div style={s.statBox('#F59E0B')}><div style={{fontSize:'1.2rem',fontWeight:800,color:'#F59E0B'}}>{shifts.length}</div><div style={{fontSize:'0.72rem',color:'#6B7280'}}>Total Shifts</div></div>
          </div>
        )}
        <div style={s.card}>
          <table style={{width:'100%',borderCollapse:'collapse',fontSize:'0.82rem'}}>
            <thead><tr style={{background:'#F9FAFB'}}>{['Client','Date','Start','End','Hours','Est. Pay','GPS','Status'].map(h=><th key={h} style={{padding:'0.5rem 0.75rem',textAlign:'left',fontWeight:700,color:'#374151',borderBottom:'1px solid #E5E7EB'}}>{h}</th>)}</tr></thead>
            <tbody>
              {shifts.map(sh=>(
                <tr key={sh.id} style={{borderBottom:'1px solid #F3F4F6'}}>
                  <td style={{padding:'0.5rem 0.75rem',fontWeight:600}}>{sh.client_first_name||sh.client_first} {sh.client_last_name||sh.client_last}</td>
                  <td style={{padding:'0.5rem 0.75rem',color:'#6B7280'}}>{fmtDate(sh.start_time)}</td>
                  <td style={{padding:'0.5rem 0.75rem'}}>{new Date(sh.start_time).toLocaleTimeString('en-US',{hour:'numeric',minute:'2-digit'})}</td>
                  <td style={{padding:'0.5rem 0.75rem'}}>{sh.end_time?new Date(sh.end_time).toLocaleTimeString('en-US',{hour:'numeric',minute:'2-digit'}):'Active'}</td>
                  <td style={{padding:'0.5rem 0.75rem',fontWeight:700}}>{sh.hours||sh.duration_hours?fmtHrs(sh.hours||sh.duration_hours):'—'}</td>
                  <td style={{padding:'0.5rem 0.75rem',color:'#2ABBA7'}}>{sh.hours&&profile?.default_pay_rate?fmt$(parseFloat(sh.hours)*parseFloat(profile.default_pay_rate)):'—'}</td>
                  <td style={{padding:'0.5rem 0.75rem'}}>{parseInt(sh.gps_point_count||0)>0?`✅ ${sh.gps_point_count} pts`:'⚠️ No GPS'}</td>
                  <td style={{padding:'0.5rem 0.75rem'}}><span style={s.badge(sh.is_complete?'#065F46':'#92400E',sh.is_complete?'#D1FAE5':'#FEF3C7')}>{sh.is_complete?'Complete':'Active'}</span></td>
                </tr>
              ))}
              {!shifts.length&&<tr><td colSpan={8} style={{padding:'2rem',textAlign:'center',color:'#9CA3AF'}}>{allShifts?'No shifts in this date range':'Showing last 10 shifts — use search to filter'}</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    );
  };

  // ── BACKGROUND CHECKS ─────────────────────────────────────────────────────────
  const renderBackground = () => (
    <div>
      <div style={{...s.card}}>
        <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:'1rem'}}>
          <div style={{fontWeight:800,fontSize:'0.95rem'}}>🔍 Background Checks</div>
          <button style={s.btn()} onClick={()=>setShowBgForm(p=>!p)}>{showBgForm?'Cancel':'+ New Check'}</button>
        </div>

        {showBgForm && (
          <div style={{background:'#F9FAFB',borderRadius:10,padding:'1rem',marginBottom:'1rem',display:'grid',gridTemplateColumns:'1fr 1fr',gap:'0.75rem'}}>
            <div><label style={s.label}>Check Type</label>
              <select value={bgForm.checkType} onChange={e=>setBgForm(p=>({...p,checkType:e.target.value}))} style={s.input}>
                <option value="criminal">Criminal Background</option>
                <option value="sex_offender">Sex Offender Registry</option>
                <option value="driving">Driving Record (MVR)</option>
                <option value="drug">Drug Screening</option>
                <option value="reference">Reference Check</option>
                <option value="oig">OIG Exclusion Check</option>
                <option value="worcs">WORCs Registry (Wisconsin)</option>
                <option value="full">Full Package</option>
              </select>
            </div>
            <div><label style={s.label}>Provider / Vendor</label>
              <input value={bgForm.provider} onChange={e=>setBgForm(p=>({...p,provider:e.target.value}))} placeholder="e.g. Checkr, Sterling" style={s.input}/>
            </div>
            <div><label style={s.label}>Cost</label>
              <input type="number" value={bgForm.cost} onChange={e=>setBgForm(p=>({...p,cost:e.target.value}))} placeholder="0.00" style={s.input}/>
            </div>
            <div><label style={s.label}>Status</label>
              <select value={bgForm.status} onChange={e=>setBgForm(p=>({...p,status:e.target.value}))} style={s.input}>
                <option value="pending">Pending</option>
                <option value="clear">Clear / Passed</option>
                <option value="flagged">Flagged</option>
                <option value="failed">Failed</option>
              </select>
            </div>
            <div style={{gridColumn:'span 2'}}><label style={s.label}>Notes</label>
              <textarea value={bgForm.notes} onChange={e=>setBgForm(p=>({...p,notes:e.target.value}))} style={{...s.input,minHeight:60,resize:'vertical'}}/>
            </div>
            <div style={{gridColumn:'span 2'}}><button style={s.btn()} onClick={addBgCheck}>Save Background Check</button></div>
          </div>
        )}

        <div style={{background:'#EEF2FF',border:'1px solid #C7D2FE',borderRadius:10,padding:'0.875rem 1rem',marginBottom:'1rem',fontSize:'0.82rem',color:'#3730A3'}}>
          <strong>Wisconsin Requirements:</strong> WORCs registry check required. OIG exclusion check recommended. Background checks should be renewed every 2 years per Wisconsin DHS guidelines.
        </div>

        {bgChecks.length > 0 ? (
          <table style={{width:'100%',borderCollapse:'collapse',fontSize:'0.82rem'}}>
            <thead><tr style={{background:'#F9FAFB'}}>{['Type','Provider','Date','Status','Expires','Notes'].map(h=><th key={h} style={{padding:'0.5rem 0.75rem',textAlign:'left',fontWeight:700,borderBottom:'1px solid #E5E7EB'}}>{h}</th>)}</tr></thead>
            <tbody>
              {bgChecks.map(bg=>{
                const expired = bg.expiration_date && new Date(bg.expiration_date) < new Date();
                const expiring = bg.expiration_date && new Date(bg.expiration_date) < new Date(Date.now()+30*86400000) && !expired;
                return (
                  <tr key={bg.id} style={{borderBottom:'1px solid #F3F4F6'}}>
                    <td style={{padding:'0.5rem 0.75rem',fontWeight:600,textTransform:'capitalize'}}>{(bg.check_type||'').replace(/_/g,' ')}</td>
                    <td style={{padding:'0.5rem 0.75rem',color:'#6B7280'}}>{bg.provider||'—'}</td>
                    <td style={{padding:'0.5rem 0.75rem'}}>{fmtDate(bg.initiated_date||bg.check_date)}</td>
                    <td style={{padding:'0.5rem 0.75rem'}}>
                      <span style={s.badge(bg.status==='clear'?'#065F46':bg.status==='pending'?'#92400E':'#991B1B',bg.status==='clear'?'#D1FAE5':bg.status==='pending'?'#FEF3C7':'#FEE2E2')}>
                        {bg.status?.toUpperCase()}
                      </span>
                    </td>
                    <td style={{padding:'0.5rem 0.75rem',color:expired?'#DC2626':expiring?'#F59E0B':'#374151'}}>
                      {bg.expiration_date ? (expired?'⛔ Expired':expiring?'⚠️ Expiring':fmtDate(bg.expiration_date)) : '—'}
                    </td>
                    <td style={{padding:'0.5rem 0.75rem',color:'#6B7280'}}>{bg.notes||'—'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        ) : <p style={{color:'#9CA3AF',fontSize:'0.875rem'}}>No background checks on file. Add one above.</p>}
      </div>
    </div>
  );

  // ── EVV / GEOFENCE TAB ────────────────────────────────────────────────────────
  const renderEVV = () => (
    <div>
      <div style={s.card}>
        <div style={{fontWeight:800,fontSize:'0.95rem',marginBottom:'1rem'}}>📍 GPS & Geofence Settings</div>
        <div style={{background:'#F0FDFB',border:'1px solid #A7F3D0',borderRadius:10,padding:'0.875rem 1rem',marginBottom:'1rem',fontSize:'0.82rem',color:'#065F46'}}>
          <strong>How auto clock-in works:</strong> When the caregiver's app detects they're within the geofence radius of a client's address, the system prompts (or automatically) clocks them in. Requires: (1) client address geocoded, (2) caregiver home address geocoded, (3) caregiver phone GPS permissions enabled.
        </div>

        <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:'1rem',marginBottom:'1rem'}}>
          <div style={{padding:'0.875rem',background:'#F9FAFB',borderRadius:10}}>
            <div style={{fontWeight:700,fontSize:'0.82rem',marginBottom:'0.25rem',color:'#374151'}}>Caregiver Home GPS</div>
            <div style={{fontSize:'0.875rem',color:profile?.latitude?'#065F46':'#DC2626',fontWeight:600}}>
              {profile?.latitude ? `✅ Set (${parseFloat(profile.latitude).toFixed(4)}, ${parseFloat(profile.longitude).toFixed(4)})` : '⚠️ Not geocoded — geofence routing won\'t work'}
            </div>
            {!profile?.latitude && (
              <button style={{...s.btn('#6366F1'),marginTop:'0.5rem',fontSize:'0.78rem',padding:'0.35rem 0.75rem'}} onClick={()=>{setEditing(true);setTab('personal');}}>
                Go to Personal Info → Geocode Address
              </button>
            )}
          </div>
          <div style={{padding:'0.875rem',background:'#F9FAFB',borderRadius:10}}>
            <div style={{fontWeight:700,fontSize:'0.82rem',marginBottom:'0.25rem',color:'#374151'}}>EVV Worker ID (Sandata)</div>
            <div style={{fontSize:'0.875rem',color:profile?.evv_worker_id?'#065F46':'#92400E',fontWeight:600}}>
              {profile?.evv_worker_id || '⚠️ Not set — needed for Sandata EVV submission'}
            </div>
          </div>
        </div>

        <div style={{background:'#FEF3C7',border:'1px solid #FCD34D',borderRadius:10,padding:'0.875rem 1rem',fontSize:'0.82rem',color:'#92400E'}}>
          <strong>To set up auto clock-in for this caregiver's clients:</strong><br/>
          Go to <strong>Route Optimizer → Geofence tab</strong> → select each client → enable Auto Clock-In and set radius (default 300ft). Each client needs their address geocoded too.
        </div>
      </div>
    </div>
  );

  return (
    <div style={s.page}>
      {/* Header */}
      <div style={s.header}>
        <div style={s.headerAccent} />
        <button onClick={onBack} style={{background:'rgba(255,255,255,0.1)',border:'1px solid rgba(255,255,255,0.2)',color:'#fff',borderRadius:8,padding:'0.4rem 0.875rem',cursor:'pointer',fontSize:'0.82rem',fontWeight:600,marginBottom:'1rem'}}>
          ← Back
        </button>
        <div style={{display:'flex',alignItems:'center',gap:'1rem'}}>
          <div style={s.avatar}>{initials}</div>
          <div style={{flex:1}}>
            <h2 style={{margin:0,fontSize:'1.4rem',fontWeight:800}}>{fullName}</h2>
            <div style={{display:'flex',gap:'0.75rem',marginTop:'0.25rem',flexWrap:'wrap'}}>
              <span style={{fontSize:'0.82rem',color:'rgba(255,255,255,0.7)'}}>{profile?.email}</span>
              <span style={{fontSize:'0.82rem',color:'rgba(255,255,255,0.7)'}}>📞 {profile?.phone || '—'}</span>
              <span style={{...s.badge(profile?.is_active?'#065F46':'#6B7280',profile?.is_active?'#D1FAE5':'#F3F4F6')}}>
                {profile?.is_active ? '● Active' : '○ Inactive'}
              </span>
            </div>
          </div>
          <div style={{textAlign:'right'}}>
            <div style={{fontSize:'1.5rem',fontWeight:800,color:'#2ABBA7'}}>{fmt$(earnings?.earnings_this_month)}</div>
            <div style={{fontSize:'0.72rem',color:'rgba(255,255,255,0.6)'}}>This month</div>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div style={{display:'flex',gap:0,borderBottom:'2px solid #E5E7EB',marginBottom:'1.25rem',overflowX:'auto'}}>
        {TABS.map(t => <button key={t.id} style={s.tab(tab===t.id)} onClick={()=>setTab(t.id)}>{t.label}</button>)}
      </div>

      {tab === 'overview' && renderOverview()}
      {tab === 'personal' && renderPersonal()}
      {tab === 'schedule' && renderSchedule()}
      {tab === 'shifts' && renderShifts()}
      {tab === 'background' && renderBackground()}
      {tab === 'evv' && renderEVV()}
    </div>
  );
}
