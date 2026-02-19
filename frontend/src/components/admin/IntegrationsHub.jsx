// src/components/admin/IntegrationsHub.jsx
// Unified command center: EVV, Authorizations, EDI 837, Remittance, Gusto
import React, { useState, useEffect, useCallback, useRef } from 'react';
import { API_BASE_URL } from '../../config';
import { toast } from '../Toast';

// ─── HELPERS ──────────────────────────────────────────────────────────────────
const fmt$ = (n) => n != null ? `$${parseFloat(n||0).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g,',')}` : '—';
const fmtDate = (d) => d ? new Date(d).toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'}) : '—';
const fmtNum = (n) => n != null ? parseFloat(n||0).toFixed(1) : '—';

const STATUS_COLORS = {
  accepted: ['#D1FAE5','#065F46'], submitted: ['#DBEAFE','#1E40AF'],
  ready: ['#D1FAE5','#065F46'], pending: ['#FEF3C7','#92400E'],
  exception: ['#FEE2E2','#991B1B'], rejected: ['#FEE2E2','#991B1B'],
  matched: ['#D1FAE5','#065F46'], partial: ['#FEF3C7','#92400E'],
  unmatched: ['#F3F4F6','#374151'], pending_match: ['#DBEAFE','#1E40AF'],
  active: ['#D1FAE5','#065F46'], expired: ['#FEE2E2','#991B1B'],
  exhausted: ['#FEE2E2','#991B1B'], low: ['#FEF3C7','#92400E'],
  ok: ['#D1FAE5','#065F46'], expiring_soon: ['#FEF3C7','#92400E'],
};

const Badge = ({ status, label }) => {
  const [bg, color] = STATUS_COLORS[status] || ['#F3F4F6','#374151'];
  return <span style={{padding:'2px 10px',borderRadius:'99px',fontSize:'0.72rem',fontWeight:'700',background:bg,color}}>{label||status}</span>;
};

const Card = ({children, style}) => (
  <div style={{background:'#fff',borderRadius:'14px',border:'1px solid #E5E7EB',padding:'1.25rem',...style}}>{children}</div>
);

const SectionHeader = ({icon, title, sub, action}) => (
  <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',marginBottom:'1.25rem'}}>
    <div>
      <h3 style={{margin:0,fontSize:'1rem',fontWeight:'800',color:'#111827'}}>{icon} {title}</h3>
      {sub && <p style={{margin:'0.15rem 0 0',fontSize:'0.78rem',color:'#6B7280'}}>{sub}</p>}
    </div>
    {action}
  </div>
);

const Btn = ({onClick,children,color='#2ABBA7',disabled,small,outline}) => (
  <button onClick={onClick} disabled={disabled} style={{
    padding: small?'0.35rem 0.75rem':'0.6rem 1.25rem',
    background: outline?'#fff':disabled?'#D1D5DB':color,
    color: outline?color:disabled?'#9CA3AF':'#fff',
    border: outline?`2px solid ${color}`:'none',
    borderRadius:'8px', cursor:disabled?'not-allowed':'pointer',
    fontWeight:'700', fontSize:small?'0.78rem':'0.85rem', whiteSpace:'nowrap'
  }}>{children}</button>
);

// ─── TABS ─────────────────────────────────────────────────────────────────────
const TABS = [
  { id: 'overview', label: '📊 Overview' },
  { id: 'evv', label: '🏠 EVV' },
  { id: 'authorizations', label: '📋 Authorizations' },
  { id: 'claims', label: '📄 EDI Claims' },
  { id: 'remittance', label: '💵 Remittance' },
  { id: 'payroll', label: '💰 Payroll' },
];

// ─── MAIN COMPONENT ───────────────────────────────────────────────────────────
const IntegrationsHub = ({ token }) => {
  const [tab, setTab] = useState('overview');
  const [sandataConfig, setSandataConfig] = useState(null);
  const [gustoConfig, setGustoConfig] = useState(null);
  const [evvData, setEvvData] = useState(null);
  const [authSummary, setAuthSummary] = useState(null);
  const [authorizations, setAuthorizations] = useState([]);
  const [ediBatches, setEdiBatches] = useState([]);
  const [remittanceBatches, setRemittanceBatches] = useState([]);
  const [payerSummary, setPayerSummary] = useState([]);
  const [payrollPreview, setPayrollPreview] = useState(null);
  const [clients, setClients] = useState([]);
  const [payers, setPayers] = useState([]);
  const [serviceCodes, setServiceCodes] = useState([]);
  const [openIssues, setOpenIssues] = useState([]);
  const [loading, setLoading] = useState({});
  const [selected, setSelected] = useState([]);

  const headers = { 'Content-Type':'application/json', Authorization:`Bearer ${token}` };
  const get = useCallback(async (url) => {
    try {
      const r = await fetch(`${API_BASE_URL}${url}`,{headers:{Authorization:`Bearer ${token}`}});
      if (r.status === 429) { console.warn('[Rate limited]', url); return null; }
      return r.ok ? r.json() : null;
    } catch(e) { return null; }
  }, [token]);

  // Payroll form
  const [payPeriod, setPayPeriod] = useState({ start: '', end: '' });

  // Authorization form
  const [authForm, setAuthForm] = useState({ clientId:'', payerId:'', authNumber:'', procedureCode:'T1019', authorizedUnits:'', startDate:'', endDate:'', notes:'' });
  const [showAuthForm, setShowAuthForm] = useState(false);

  // Remittance upload
  const [uploadState, setUploadState] = useState(null); // null | 'uploading' | result
  const [remitForm, setRemitForm] = useState({ payerId:'', payerName:'', checkNumber:'', checkDate:'', paymentDate:'', totalAmount:'', notes:'', lineItems:[] });
  const fileRef = useRef(null);

  // Stagger requests to avoid rate limiting on Render free tier
  useEffect(() => {
    const delay = (ms) => new Promise(r => setTimeout(r, ms));
    const loadCore = async () => {
      // Batch 1: small config calls
      await Promise.all([
        get('/api/sandata/config').then(d => d && setSandataConfig(d)),
        get('/api/gusto/config').then(d => d && setGustoConfig(d)),
      ]);
      await delay(400);
      // Batch 2: summary data
      await Promise.all([
        get('/api/authorizations/summary').then(d => d && setAuthSummary(d)),
        get('/api/remittance/payer-summary').then(d => d && setPayerSummary(d)).catch(() => {}),
      ]);
      await delay(400);
      // Batch 3: list data
      await Promise.all([
        get('/api/clients').then(d => d && setClients(d)),
        get('/api/remittance/payers').then(d => d && setPayers(d)),
      ]);
      await delay(400);
      // Batch 4: integration-specific (graceful fail until migration_v4.sql runs)
      get('/api/sandata/status').then(d => d && setEvvData(d)).catch(() => {});
      get('/api/failsafe/issues').then(d => d && setOpenIssues(d)).catch(() => {});
      get('/api/edi/service-codes').then(d => d && setServiceCodes(d)).catch(() => {});
    };
    loadCore();
  }, []);

  useEffect(() => {
    const delay = (ms) => new Promise(r => setTimeout(r, ms));
    const loadTab = async () => {
      await delay(300);
      if (tab === 'authorizations') get('/api/authorizations').then(d => d && setAuthorizations(d)).catch(() => {});
      if (tab === 'claims') get('/api/edi/batches').then(d => d && setEdiBatches(d)).catch(() => {});
      if (tab === 'remittance') get('/api/remittance/batches').then(d => d && setRemittanceBatches(d)).catch(() => {});
    };
    loadTab();
  }, [tab]);

  const setLoad = (key, val) => setLoading(p => ({...p,[key]:val}));

  // ── Overview Tab ─────────────────────────────────────────────────────────────
  const renderOverview = () => {
    const totalOutstanding = payerSummary.reduce((s,p) => s+parseFloat(p.total_outstanding||0),0);
    const totalBilled = payerSummary.reduce((s,p) => s+parseFloat(p.total_billed||0),0);
    const totalReceived = payerSummary.reduce((s,p) => s+parseFloat(p.total_received||0),0);

    return (
      <div style={{display:'grid',gap:'1rem'}}>
        {/* Integration status row */}
        <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(200px,1fr))',gap:'0.75rem'}}>
          {/* Sandata */}
          <Card style={{borderLeft:`4px solid ${sandataConfig?.isConfigured?'#2ABBA7':'#F59E0B'}`}}>
            <div style={{fontWeight:'700',fontSize:'0.85rem',marginBottom:'0.4rem'}}>🏠 Sandata EVV</div>
            {sandataConfig?.isConfigured
              ? <><Badge status="active" label="✓ Connected"/><p style={{fontSize:'0.78rem',color:'#6B7280',margin:'0.4rem 0 0'}}>{evvData?.summary?.accepted||0} accepted · {evvData?.summary?.exceptions||0} exceptions</p></>
              : <><Badge status="pending" label="⚠ Not Configured"/><p style={{fontSize:'0.75rem',color:'#92400E',margin:'0.4rem 0 0'}}>Call (833) 931-2035 to get credentials</p></>
            }
          </Card>
          {/* Gusto */}
          <Card style={{borderLeft:`4px solid ${gustoConfig?.isConfigured?'#2ABBA7':'#6B7280'}`}}>
            <div style={{fontWeight:'700',fontSize:'0.85rem',marginBottom:'0.4rem'}}>💰 Gusto Payroll</div>
            {gustoConfig?.isConfigured
              ? <Badge status="active" label="✓ Connected"/>
              : <><Badge status="unmatched" label="Not Connected"/><p style={{fontSize:'0.75rem',color:'#6B7280',margin:'0.4rem 0 0'}}>Add GUSTO_API_KEY to connect</p></>
            }
          </Card>
          {/* Open issues */}
          <Card style={{borderLeft:`4px solid ${openIssues.filter(i=>i.status==='fail').length>0?'#EF4444':'#2ABBA7'}`}}>
            <div style={{fontWeight:'700',fontSize:'0.85rem',marginBottom:'0.4rem'}}>🛡️ Failsafe</div>
            {openIssues.filter(i=>i.status==='fail').length > 0
              ? <><Badge status="exception" label={`${openIssues.filter(i=>i.status==='fail').length} Blocking Issues`}/><p style={{fontSize:'0.75rem',color:'#991B1B',margin:'0.4rem 0 0'}}>Fix before submitting claims</p></>
              : <Badge status="active" label="✓ All Clear"/>
            }
          </Card>
          {/* Authorizations */}
          <Card style={{borderLeft:`4px solid ${parseInt(authSummary?.expiring_soon||0)+parseInt(authSummary?.expired||0)>0?'#F59E0B':'#2ABBA7'}`}}>
            <div style={{fontWeight:'700',fontSize:'0.85rem',marginBottom:'0.4rem'}}>📋 Authorizations</div>
            <p style={{margin:0,fontSize:'1.1rem',fontWeight:'800',color:'#111827'}}>{authSummary?.active||0} Active</p>
            <p style={{margin:'0.15rem 0 0',fontSize:'0.78rem',color:parseInt(authSummary?.expiring_soon||0)>0?'#92400E':'#6B7280'}}>
              {authSummary?.expiring_soon||0} expiring soon · {authSummary?.low_units||0} low units
            </p>
          </Card>
        </div>

        {/* Payer AR summary */}
        <Card>
          <SectionHeader icon="💵" title="Accounts Receivable by Payer" sub="Outstanding balances and aging" />
          <div style={{display:'grid',gridTemplateColumns:'repeat(3,1fr)',gap:'0.75rem',marginBottom:'1rem'}}>
            <div style={{padding:'0.75rem',background:'#F9FAFB',borderRadius:'10px',textAlign:'center'}}>
              <div style={{fontSize:'1.4rem',fontWeight:'800',color:'#111827'}}>{fmt$(totalBilled)}</div>
              <div style={{fontSize:'0.75rem',color:'#6B7280'}}>Total Billed</div>
            </div>
            <div style={{padding:'0.75rem',background:'#F0FDFB',borderRadius:'10px',textAlign:'center'}}>
              <div style={{fontSize:'1.4rem',fontWeight:'800',color:'#2ABBA7'}}>{fmt$(totalReceived)}</div>
              <div style={{fontSize:'0.75rem',color:'#6B7280'}}>Received</div>
            </div>
            <div style={{padding:'0.75rem',background:'#FEF3C7',borderRadius:'10px',textAlign:'center'}}>
              <div style={{fontSize:'1.4rem',fontWeight:'800',color:'#92400E'}}>{fmt$(totalOutstanding)}</div>
              <div style={{fontSize:'0.75rem',color:'#6B7280'}}>Outstanding</div>
            </div>
          </div>
          <div style={{overflowX:'auto'}}>
            <table style={{width:'100%',borderCollapse:'collapse',fontSize:'0.82rem'}}>
              <thead>
                <tr style={{background:'#F9FAFB'}}>
                  {['Payer','Billed','Paid','Outstanding','0-30d','31-60d','61-90d','90d+','Last Payment'].map(h=>(
                    <th key={h} style={{padding:'0.5rem 0.75rem',textAlign:'left',fontWeight:'700',color:'#374151',borderBottom:'1px solid #E5E7EB'}}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {payerSummary.map(p => (
                  <tr key={p.payer_id} style={{borderBottom:'1px solid #F3F4F6'}}>
                    <td style={{padding:'0.5rem 0.75rem',fontWeight:'600',color:'#111827'}}>{p.payer_name}</td>
                    <td style={{padding:'0.5rem 0.75rem',color:'#374151'}}>{fmt$(p.total_billed)}</td>
                    <td style={{padding:'0.5rem 0.75rem',color:'#2ABBA7'}}>{fmt$(p.total_paid)}</td>
                    <td style={{padding:'0.5rem 0.75rem',fontWeight:'700',color:parseFloat(p.total_outstanding)>0?'#92400E':'#065F46'}}>{fmt$(p.total_outstanding)}</td>
                    <td style={{padding:'0.5rem 0.75rem',color:'#374151'}}>{fmt$(p.days_0_30)}</td>
                    <td style={{padding:'0.5rem 0.75rem',color:parseFloat(p.days_31_60)>0?'#92400E':'#374151'}}>{fmt$(p.days_31_60)}</td>
                    <td style={{padding:'0.5rem 0.75rem',color:parseFloat(p.days_61_90)>0?'#DC2626':'#374151'}}>{fmt$(p.days_61_90)}</td>
                    <td style={{padding:'0.5rem 0.75rem',fontWeight:'700',color:parseFloat(p.over_90_days)>0?'#DC2626':'#374151'}}>{fmt$(p.over_90_days)}</td>
                    <td style={{padding:'0.5rem 0.75rem',color:'#6B7280'}}>{fmtDate(p.last_payment_date)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>

        {/* Open issues */}
        {openIssues.length > 0 && (
          <Card style={{border:'1px solid #FCA5A5'}}>
            <SectionHeader icon="⚠️" title="Open Validation Issues" sub="Fix these before generating claims" />
            {openIssues.slice(0,10).map(issue => (
              <div key={issue.id} style={{display:'flex',justifyContent:'space-between',alignItems:'center',padding:'0.6rem 0.75rem',marginBottom:'0.4rem',background:issue.status==='fail'?'#FEF2F2':'#FFFBEB',borderRadius:'8px',border:`1px solid ${issue.status==='fail'?'#FCA5A5':'#FCD34D'}`}}>
                <div>
                  <span style={{fontWeight:'700',fontSize:'0.82rem',color:issue.status==='fail'?'#991B1B':'#92400E'}}>{issue.validation_type}</span>
                  <span style={{marginLeft:'0.5rem',fontSize:'0.82rem',color:'#374151'}}>{issue.message}</span>
                </div>
                <Btn small onClick={async()=>{await fetch(`${API_BASE_URL}/api/failsafe/issues/${issue.id}/resolve`,{method:'PUT',headers});setOpenIssues(p=>p.filter(i=>i.id!==issue.id));toast('Issue resolved','success');}}>Resolve</Btn>
              </div>
            ))}
          </Card>
        )}
      </div>
    );
  };

  // ── EVV Tab ──────────────────────────────────────────────────────────────────
  const renderEVV = () => (
    <div style={{display:'grid',gap:'1rem'}}>
      {!sandataConfig?.isConfigured && (
        <Card style={{background:'#FFFBEB',border:'1px solid #FCD34D'}}>
          <h4 style={{margin:'0 0 0.5rem',color:'#92400E'}}>⚠️ Sandata Credentials Not Configured</h4>
          <p style={{margin:'0 0 0.5rem',fontSize:'0.875rem',color:'#92400E'}}>EVV records are being created automatically when caregivers clock out, but visits can't be submitted to Sandata yet.</p>
          <div style={{fontSize:'0.82rem',color:'#78350F',display:'grid',gap:'0.2rem'}}>
            <div><strong>Step 1:</strong> Call Wisconsin EVV Customer Care: <strong>(833) 931-2035</strong></div>
            <div><strong>Step 2:</strong> Request Alt-EVV API credentials for your agency</div>
            <div><strong>Step 3:</strong> In Render → Environment → add: SANDATA_USERNAME, SANDATA_PASSWORD, SANDATA_ACCOUNT_ID</div>
          </div>
        </Card>
      )}

      {/* Summary cards */}
      {evvData && (
        <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(120px,1fr))',gap:'0.75rem'}}>
          {[
            {label:'Total',val:evvData.summary?.total||0,color:'#374151'},
            {label:'Verified',val:evvData.summary?.verified||0,color:'#2ABBA7'},
            {label:'Ready to Submit',val:evvData.summary?.ready||0,color:'#6366F1'},
            {label:'Submitted',val:evvData.summary?.submitted||0,color:'#2563EB'},
            {label:'Accepted',val:evvData.summary?.accepted||0,color:'#16A34A'},
            {label:'Exceptions',val:evvData.summary?.exceptions||0,color:'#DC2626'},
          ].map(s=>(
            <div key={s.label} style={{padding:'0.75rem',background:'#F9FAFB',borderRadius:'10px',textAlign:'center'}}>
              <div style={{fontSize:'1.5rem',fontWeight:'800',color:s.color}}>{s.val}</div>
              <div style={{fontSize:'0.72rem',color:'#6B7280'}}>{s.label}</div>
            </div>
          ))}
        </div>
      )}

      {/* EVV table */}
      <Card>
        <SectionHeader icon="🏠" title="EVV Visits" sub="Last 7 days"
          action={
            <Btn disabled={!sandataConfig?.isConfigured||selected.length===0}
              onClick={async()=>{
                setLoad('submit',true);
                const r = await fetch(`${API_BASE_URL}/api/sandata/submit`,{method:'POST',headers,body:JSON.stringify({visitIds:selected})});
                const d = await r.json();
                if(r.ok){toast(`Submitted ${d.submitted} visits to Sandata`,'success');setSelected([]);}
                else toast(d.error||'Submission failed','error');
                setLoad('submit',false);
              }}>
              {loading.submit?'Submitting...':'📤 Submit to Sandata'}{selected.length>0?` (${selected.length})`:''}
            </Btn>
          }
        />
        <div style={{overflowX:'auto'}}>
          <table style={{width:'100%',borderCollapse:'collapse',fontSize:'0.82rem'}}>
            <thead>
              <tr style={{background:'#F9FAFB'}}>
                <th style={{padding:'0.5rem',width:'32px'}}><input type="checkbox" onChange={e=>{if(e.target.checked)setSelected((evvData?.visits||[]).filter(v=>v.sandata_status==='ready').map(v=>v.id));else setSelected([]);}}/></th>
                {['Date','Client','Caregiver','Code','Units','GPS','EVV Status','Sandata'].map(h=>(
                  <th key={h} style={{padding:'0.5rem 0.75rem',textAlign:'left',fontWeight:'700',color:'#374151',borderBottom:'1px solid #E5E7EB'}}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {(evvData?.visits||[]).map(v=>(
                <tr key={v.id} style={{borderBottom:'1px solid #F3F4F6',background:selected.includes(v.id)?'#F0FDFB':'#fff'}}>
                  <td style={{padding:'0.5rem',textAlign:'center'}}>
                    {v.sandata_status==='ready'&&<input type="checkbox" checked={selected.includes(v.id)} onChange={e=>setSelected(p=>e.target.checked?[...p,v.id]:p.filter(id=>id!==v.id))}/>}
                  </td>
                  <td style={{padding:'0.5rem 0.75rem'}}>{fmtDate(v.service_date)}</td>
                  <td style={{padding:'0.5rem 0.75rem',fontWeight:'600'}}>{v.client_first} {v.client_last}</td>
                  <td style={{padding:'0.5rem 0.75rem'}}>{v.cg_first} {v.cg_last}</td>
                  <td style={{padding:'0.5rem 0.75rem'}}><code style={{fontSize:'0.78rem',background:'#F3F4F6',padding:'1px 5px',borderRadius:'4px'}}>{v.service_code}{v.modifier?` ${v.modifier}`:''}</code></td>
                  <td style={{padding:'0.5rem 0.75rem'}}>{fmtNum(v.units_of_service)}</td>
                  <td style={{padding:'0.5rem 0.75rem'}}>{v.gps_in_lat?'✅ In':'⚠️'} {v.gps_out_lat?'/ Out':''}</td>
                  <td style={{padding:'0.5rem 0.75rem'}}><Badge status={v.is_verified?'active':'pending'} label={v.is_verified?'Verified':'Pending'}/></td>
                  <td style={{padding:'0.5rem 0.75rem'}}><Badge status={v.sandata_status} label={v.sandata_status}/></td>
                </tr>
              ))}
              {(!evvData?.visits||evvData.visits.length===0)&&<tr><td colSpan="9" style={{padding:'2rem',textAlign:'center',color:'#9CA3AF'}}>No EVV visits in this period</td></tr>}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );

  // ── Authorizations Tab ────────────────────────────────────────────────────────
  const renderAuthorizations = () => (
    <div style={{display:'grid',gap:'1rem'}}>
      <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(130px,1fr))',gap:'0.75rem'}}>
        {[
          {label:'Active',val:authSummary?.active||0,color:'#2ABBA7'},
          {label:'Expiring Soon',val:authSummary?.expiring_soon||0,color:'#F59E0B'},
          {label:'Low Units',val:authSummary?.low_units||0,color:'#EF4444'},
          {label:'Exhausted',val:authSummary?.exhausted||0,color:'#DC2626'},
          {label:'Expired',val:authSummary?.expired||0,color:'#6B7280'},
        ].map(s=>(
          <div key={s.label} style={{padding:'0.75rem',background:'#F9FAFB',borderRadius:'10px',textAlign:'center'}}>
            <div style={{fontSize:'1.5rem',fontWeight:'800',color:s.color}}>{s.val}</div>
            <div style={{fontSize:'0.72rem',color:'#6B7280'}}>{s.label}</div>
          </div>
        ))}
      </div>

      {/* MIDAS import info */}
      <Card style={{background:'#EEF2FF',border:'1px solid #C7D2FE'}}>
        <div style={{display:'flex',gap:'0.75rem',alignItems:'flex-start'}}>
          <span style={{fontSize:'1.5rem'}}>📥</span>
          <div>
            <p style={{margin:'0 0 0.25rem',fontWeight:'700',color:'#3730A3',fontSize:'0.875rem'}}>Import from MIDAS</p>
            <p style={{margin:'0 0 0.5rem',fontSize:'0.82rem',color:'#4338CA'}}>Export authorizations from the MIDAS portal as CSV, then import here. Expected columns: MemberID, AuthNumber, ServiceCode, AuthorizedUnits, StartDate, EndDate</p>
            <label style={{padding:'0.4rem 0.875rem',background:'#6366F1',color:'#fff',borderRadius:'8px',cursor:'pointer',fontWeight:'700',fontSize:'0.82rem'}}>
              📂 Import MIDAS CSV
              <input type="file" accept=".csv" style={{display:'none'}} onChange={async e=>{
                const file = e.target.files[0]; if(!file) return;
                const text = await file.text();
                const lines = text.split('\n'); const headers = lines[0].split(',').map(h=>h.trim());
                const rows = lines.slice(1).filter(l=>l.trim()).map(l=>{
                  const vals = l.split(','); const obj={};
                  headers.forEach((h,i)=>obj[h]=vals[i]?.trim()||''); return obj;
                });
                const r = await fetch(`${API_BASE_URL}/api/authorizations/import-csv`,{method:'POST',headers,body:JSON.stringify({rows})});
                const d = await r.json();
                if(r.ok){toast(`Imported ${d.imported} authorizations`,'success');get('/api/authorizations').then(d=>d&&setAuthorizations(d));}
                else toast(d.error||'Import failed','error');
              }}/>
            </label>
          </div>
        </div>
      </Card>

      <Card>
        <SectionHeader icon="📋" title="Authorization Tracker" sub="MIDAS authorizations and burn-down"
          action={<Btn onClick={()=>setShowAuthForm(p=>!p)}>{showAuthForm?'Cancel':'+ Add Auth'}</Btn>}
        />

        {showAuthForm && (
          <div style={{background:'#F9FAFB',borderRadius:'10px',padding:'1rem',marginBottom:'1rem',display:'grid',gridTemplateColumns:'1fr 1fr',gap:'0.75rem'}}>
            <div><label style={{display:'block',fontWeight:'600',fontSize:'0.78rem',marginBottom:'0.3rem'}}>Client *</label>
              <select value={authForm.clientId} onChange={e=>setAuthForm(p=>({...p,clientId:e.target.value}))} style={{width:'100%',padding:'0.5rem',border:'1px solid #D1D5DB',borderRadius:'6px',fontSize:'0.85rem'}}>
                <option value="">Select client...</option>
                {clients.map(c=><option key={c.id} value={c.id}>{c.first_name} {c.last_name}</option>)}
              </select>
            </div>
            <div><label style={{display:'block',fontWeight:'600',fontSize:'0.78rem',marginBottom:'0.3rem'}}>Payer</label>
              <select value={authForm.payerId} onChange={e=>setAuthForm(p=>({...p,payerId:e.target.value}))} style={{width:'100%',padding:'0.5rem',border:'1px solid #D1D5DB',borderRadius:'6px',fontSize:'0.85rem'}}>
                <option value="">Select payer...</option>
                {payers.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </div>
            <div><label style={{display:'block',fontWeight:'600',fontSize:'0.78rem',marginBottom:'0.3rem'}}>Auth Number</label>
              <input value={authForm.authNumber} onChange={e=>setAuthForm(p=>({...p,authNumber:e.target.value}))} placeholder="e.g. 12345678" style={{width:'100%',padding:'0.5rem',border:'1px solid #D1D5DB',borderRadius:'6px',fontSize:'0.85rem',boxSizing:'border-box'}}/>
            </div>
            <div><label style={{display:'block',fontWeight:'600',fontSize:'0.78rem',marginBottom:'0.3rem'}}>Service Code</label>
              <select value={authForm.procedureCode} onChange={e=>setAuthForm(p=>({...p,procedureCode:e.target.value}))} style={{width:'100%',padding:'0.5rem',border:'1px solid #D1D5DB',borderRadius:'6px',fontSize:'0.85rem'}}>
                {serviceCodes.map(sc=><option key={sc.id} value={sc.code}>{sc.code}{sc.modifier1?` ${sc.modifier1}`:''} — {sc.description}</option>)}
              </select>
            </div>
            <div><label style={{display:'block',fontWeight:'600',fontSize:'0.78rem',marginBottom:'0.3rem'}}>Authorized Units *</label>
              <input type="number" value={authForm.authorizedUnits} onChange={e=>setAuthForm(p=>({...p,authorizedUnits:e.target.value}))} placeholder="e.g. 312" style={{width:'100%',padding:'0.5rem',border:'1px solid #D1D5DB',borderRadius:'6px',fontSize:'0.85rem',boxSizing:'border-box'}}/>
            </div>
            <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:'0.5rem'}}>
              <div><label style={{display:'block',fontWeight:'600',fontSize:'0.78rem',marginBottom:'0.3rem'}}>Start Date *</label>
                <input type="date" value={authForm.startDate} onChange={e=>setAuthForm(p=>({...p,startDate:e.target.value}))} style={{width:'100%',padding:'0.5rem',border:'1px solid #D1D5DB',borderRadius:'6px',fontSize:'0.85rem',boxSizing:'border-box'}}/>
              </div>
              <div><label style={{display:'block',fontWeight:'600',fontSize:'0.78rem',marginBottom:'0.3rem'}}>End Date *</label>
                <input type="date" value={authForm.endDate} onChange={e=>setAuthForm(p=>({...p,endDate:e.target.value}))} style={{width:'100%',padding:'0.5rem',border:'1px solid #D1D5DB',borderRadius:'6px',fontSize:'0.85rem',boxSizing:'border-box'}}/>
              </div>
            </div>
            <div style={{gridColumn:'span 2'}}>
              <Btn onClick={async()=>{
                const r = await fetch(`${API_BASE_URL}/api/authorizations`,{method:'POST',headers,body:JSON.stringify(authForm)});
                const d = await r.json();
                if(r.ok){toast('Authorization saved','success');setShowAuthForm(false);setAuthForm({clientId:'',payerId:'',authNumber:'',procedureCode:'T1019',authorizedUnits:'',startDate:'',endDate:'',notes:''});get('/api/authorizations').then(d=>d&&setAuthorizations(d));}
                else toast(d.error||'Failed','error');
              }}>Save Authorization</Btn>
            </div>
          </div>
        )}

        <div style={{overflowX:'auto'}}>
          <table style={{width:'100%',borderCollapse:'collapse',fontSize:'0.82rem'}}>
            <thead>
              <tr style={{background:'#F9FAFB'}}>
                {['Client','Payer','Auth #','Code','Units Used/Auth','Remaining','Expires','Status'].map(h=>(
                  <th key={h} style={{padding:'0.5rem 0.75rem',textAlign:'left',fontWeight:'700',color:'#374151',borderBottom:'1px solid #E5E7EB',whiteSpace:'nowrap'}}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {authorizations.map(a=>{
                const pctUsed = a.authorized_units > 0 ? (a.used_units/a.authorized_units*100) : 0;
                const barColor = pctUsed>90?'#EF4444':pctUsed>70?'#F59E0B':'#2ABBA7';
                return (
                  <tr key={a.id} style={{borderBottom:'1px solid #F3F4F6'}}>
                    <td style={{padding:'0.5rem 0.75rem',fontWeight:'600'}}>{a.client_first} {a.client_last}</td>
                    <td style={{padding:'0.5rem 0.75rem',color:'#6B7280'}}>{a.payer_name||'—'}</td>
                    <td style={{padding:'0.5rem 0.75rem'}}><code style={{fontSize:'0.78rem',background:'#F3F4F6',padding:'1px 5px',borderRadius:'4px'}}>{a.auth_number||'—'}</code></td>
                    <td style={{padding:'0.5rem 0.75rem'}}><code style={{fontSize:'0.78rem',background:'#F3F4F6',padding:'1px 5px',borderRadius:'4px'}}>{a.procedure_code}</code></td>
                    <td style={{padding:'0.5rem 0.75rem',minWidth:'140px'}}>
                      <div style={{display:'flex',alignItems:'center',gap:'0.5rem'}}>
                        <div style={{flex:1,height:'6px',background:'#E5E7EB',borderRadius:'99px',overflow:'hidden'}}>
                          <div style={{width:`${Math.min(pctUsed,100)}%`,height:'100%',background:barColor,borderRadius:'99px'}}/>
                        </div>
                        <span style={{fontSize:'0.72rem',color:'#374151',whiteSpace:'nowrap'}}>{fmtNum(a.used_units)}/{fmtNum(a.authorized_units)}</span>
                      </div>
                    </td>
                    <td style={{padding:'0.5rem 0.75rem',fontWeight:'700',color:parseFloat(a.remaining_units||0)<20?'#DC2626':'#374151'}}>{fmtNum(a.remaining_units)}</td>
                    <td style={{padding:'0.5rem 0.75rem',color:new Date(a.end_date)<new Date(Date.now()+30*86400000)?'#DC2626':'#374151'}}>{fmtDate(a.end_date)}</td>
                    <td style={{padding:'0.5rem 0.75rem'}}><Badge status={a.health_status} label={a.health_status==='ok'?'Good':a.health_status==='low'?'⚠ Low':a.health_status==='expiring_soon'?'Expiring':a.health_status}/></td>
                  </tr>
                );
              })}
              {authorizations.length===0&&<tr><td colSpan="8" style={{padding:'2rem',textAlign:'center',color:'#9CA3AF'}}>No authorizations yet. Add one manually or import from MIDAS.</td></tr>}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );

  // ── Claims / EDI Tab ──────────────────────────────────────────────────────────
  const renderClaims = () => (
    <div style={{display:'grid',gap:'1rem'}}>
      <Card>
        <SectionHeader icon="📄" title="EDI 837 Claim Batches" sub="Generated claim files for WPS/clearinghouse"
          action={
            <div style={{display:'flex',gap:'0.5rem'}}>
              <Btn outline onClick={()=>{toast('Select claims from Billing → Claims first, then generate','info')}}>ℹ️ How to Use</Btn>
            </div>
          }
        />
        <div style={{background:'#F0FDFB',border:'1px solid #A7F3D0',borderRadius:'10px',padding:'0.875rem 1rem',marginBottom:'1rem',fontSize:'0.82rem',color:'#065F46'}}>
          <strong>Workflow:</strong> Billing → Claims → select approved claims → Generate EDI 837 → download .edi file → upload to WPS Provider Portal or your clearinghouse (Availity, Change Healthcare, etc.)
        </div>
        <table style={{width:'100%',borderCollapse:'collapse',fontSize:'0.82rem'}}>
          <thead>
            <tr style={{background:'#F9FAFB'}}>
              {['Batch #','Payer','Claims','Total Billed','Generated','Status',''].map(h=>(
                <th key={h} style={{padding:'0.5rem 0.75rem',textAlign:'left',fontWeight:'700',color:'#374151',borderBottom:'1px solid #E5E7EB'}}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {ediBatches.map(b=>(
              <tr key={b.id} style={{borderBottom:'1px solid #F3F4F6'}}>
                <td style={{padding:'0.5rem 0.75rem'}}><code style={{fontSize:'0.78rem',background:'#F3F4F6',padding:'1px 5px',borderRadius:'4px'}}>{b.batch_number}</code></td>
                <td style={{padding:'0.5rem 0.75rem'}}>{b.payer_name||'—'}</td>
                <td style={{padding:'0.5rem 0.75rem'}}>{b.claim_count}</td>
                <td style={{padding:'0.5rem 0.75rem',fontWeight:'700'}}>{fmt$(b.total_billed)}</td>
                <td style={{padding:'0.5rem 0.75rem',color:'#6B7280'}}>{fmtDate(b.created_at)}</td>
                <td style={{padding:'0.5rem 0.75rem'}}><Badge status={b.status} label={b.status}/></td>
                <td style={{padding:'0.5rem 0.75rem'}}>
                  <a href={`${API_BASE_URL}/api/edi/batch/${b.id}/download`} download style={{color:'#2ABBA7',fontWeight:'700',fontSize:'0.78rem',textDecoration:'none'}}>⬇ Download .edi</a>
                </td>
              </tr>
            ))}
            {ediBatches.length===0&&<tr><td colSpan="7" style={{padding:'2rem',textAlign:'center',color:'#9CA3AF'}}>No EDI batches yet</td></tr>}
          </tbody>
        </table>
      </Card>

      {/* Service codes reference */}
      <Card>
        <SectionHeader icon="🗂️" title="Service Code Reference" sub="Wisconsin Medicaid procedure codes in your system"/>
        <div style={{overflowX:'auto'}}>
          <table style={{width:'100%',borderCollapse:'collapse',fontSize:'0.78rem'}}>
            <thead>
              <tr style={{background:'#F9FAFB'}}>
                {['Code','Modifier','Description','Category','Payer','Unit','EVV Required'].map(h=>(
                  <th key={h} style={{padding:'0.4rem 0.75rem',textAlign:'left',fontWeight:'700',color:'#374151',borderBottom:'1px solid #E5E7EB'}}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {serviceCodes.map(sc=>(
                <tr key={sc.id} style={{borderBottom:'1px solid #F3F4F6'}}>
                  <td style={{padding:'0.4rem 0.75rem'}}><code style={{fontWeight:'800',color:'#6366F1'}}>{sc.code}</code></td>
                  <td style={{padding:'0.4rem 0.75rem'}}>{sc.modifier1||'—'}</td>
                  <td style={{padding:'0.4rem 0.75rem',color:'#374151'}}>{sc.description}</td>
                  <td style={{padding:'0.4rem 0.75rem',color:'#6B7280'}}>{sc.service_category}</td>
                  <td style={{padding:'0.4rem 0.75rem'}}>{sc.payer_type==='all'?'All':sc.payer_type}</td>
                  <td style={{padding:'0.4rem 0.75rem'}}>{sc.unit_type}</td>
                  <td style={{padding:'0.4rem 0.75rem'}}>{sc.requires_evv?'✅ Yes':'No'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );

  // ── Remittance Tab ────────────────────────────────────────────────────────────
  const renderRemittance = () => (
    <div style={{display:'grid',gap:'1rem'}}>
      <Card>
        <SectionHeader icon="📷" title="Upload Remittance / Check"
          sub="Photo or scan → OCR reads it → match to claims automatically"
          action={<Btn onClick={()=>fileRef.current?.click()} disabled={uploadState==='uploading'}>📷 Upload Check / Statement</Btn>}
        />
        <input ref={fileRef} type="file" accept="image/*,application/pdf" style={{display:'none'}} onChange={async e=>{
          const file = e.target.files[0]; if(!file) return;
          setUploadState('uploading');
          const fd = new FormData(); fd.append('remittance', file);
          try {
            const r = await fetch(`${API_BASE_URL}/api/remittance/upload`,{method:'POST',headers:{Authorization:`Bearer ${token}`},body:fd});
            const d = await r.json();
            if(r.ok){
              setUploadState(d);
              setRemitForm(p=>({...p,
                payerName:d.ocr.payerName||'',checkNumber:d.ocr.checkNumber||'',
                checkDate:d.ocr.checkDate||'',totalAmount:d.ocr.totalAmount||'',
                payerId:d.suggestedPayer?.id||'',
                lineItems:(d.ocr.lineItems||[]).map(li=>({...li,clientId:'',invoiceId:''}))
              }));
            } else { toast(d.error||'OCR failed','error'); setUploadState(null); }
          } catch(e){ toast('Upload failed','error'); setUploadState(null); }
        }}/>

        {uploadState && uploadState !== 'uploading' && (
          <div style={{background:'#F0FDFB',border:'1px solid #A7F3D0',borderRadius:'10px',padding:'1rem',marginBottom:'1rem'}}>
            <p style={{margin:'0 0 0.75rem',fontWeight:'700',color:'#065F46'}}>✅ OCR Complete — Verify and Save</p>
            <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:'0.75rem'}}>
              <div>
                <label style={{display:'block',fontWeight:'600',fontSize:'0.78rem',marginBottom:'0.3rem'}}>Payer Name *</label>
                <input value={remitForm.payerName} onChange={e=>setRemitForm(p=>({...p,payerName:e.target.value}))} style={{width:'100%',padding:'0.5rem',border:'1px solid #D1D5DB',borderRadius:'6px',fontSize:'0.85rem',boxSizing:'border-box'}}/>
              </div>
              <div>
                <label style={{display:'block',fontWeight:'600',fontSize:'0.78rem',marginBottom:'0.3rem'}}>Match to Existing Payer</label>
                <select value={remitForm.payerId} onChange={e=>setRemitForm(p=>({...p,payerId:e.target.value}))} style={{width:'100%',padding:'0.5rem',border:'1px solid #D1D5DB',borderRadius:'6px',fontSize:'0.85rem'}}>
                  <option value="">— Select payer —</option>
                  {payers.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
              </div>
              <div>
                <label style={{display:'block',fontWeight:'600',fontSize:'0.78rem',marginBottom:'0.3rem'}}>Check Number</label>
                <input value={remitForm.checkNumber} onChange={e=>setRemitForm(p=>({...p,checkNumber:e.target.value}))} style={{width:'100%',padding:'0.5rem',border:'1px solid #D1D5DB',borderRadius:'6px',fontSize:'0.85rem',boxSizing:'border-box'}}/>
              </div>
              <div>
                <label style={{display:'block',fontWeight:'600',fontSize:'0.78rem',marginBottom:'0.3rem'}}>Total Amount *</label>
                <input type="number" value={remitForm.totalAmount} onChange={e=>setRemitForm(p=>({...p,totalAmount:e.target.value}))} style={{width:'100%',padding:'0.5rem',border:'1px solid #D1D5DB',borderRadius:'6px',fontSize:'0.85rem',boxSizing:'border-box'}}/>
              </div>
              <div>
                <label style={{display:'block',fontWeight:'600',fontSize:'0.78rem',marginBottom:'0.3rem'}}>Check Date</label>
                <input type="date" value={remitForm.checkDate} onChange={e=>setRemitForm(p=>({...p,checkDate:e.target.value}))} style={{width:'100%',padding:'0.5rem',border:'1px solid #D1D5DB',borderRadius:'6px',fontSize:'0.85rem',boxSizing:'border-box'}}/>
              </div>
              <div>
                <label style={{display:'block',fontWeight:'600',fontSize:'0.78rem',marginBottom:'0.3rem'}}>Payment Date</label>
                <input type="date" value={remitForm.paymentDate} onChange={e=>setRemitForm(p=>({...p,paymentDate:e.target.value}))} style={{width:'100%',padding:'0.5rem',border:'1px solid #D1D5DB',borderRadius:'6px',fontSize:'0.85rem',boxSizing:'border-box'}}/>
              </div>
            </div>
            <div style={{marginTop:'0.75rem',display:'flex',gap:'0.5rem'}}>
              <Btn onClick={async()=>{
                const r = await fetch(`${API_BASE_URL}/api/remittance/batch`,{method:'POST',headers,body:JSON.stringify(remitForm)});
                const d = await r.json();
                if(r.ok){toast(`Saved. ${d.matchedCount} of ${d.totalItems} line items matched.`,'success');setUploadState(null);setRemitForm({payerId:'',payerName:'',checkNumber:'',checkDate:'',paymentDate:'',totalAmount:'',notes:'',lineItems:[]});get('/api/remittance/batches').then(d=>d&&setRemittanceBatches(d));}
                else toast(d.error||'Save failed','error');
              }}>💾 Save Remittance</Btn>
              <Btn outline onClick={()=>setUploadState(null)}>Cancel</Btn>
            </div>
          </div>
        )}

        <table style={{width:'100%',borderCollapse:'collapse',fontSize:'0.82rem'}}>
          <thead>
            <tr style={{background:'#F9FAFB'}}>
              {['Payer','Check #','Date','Amount','Items Matched','Status'].map(h=>(
                <th key={h} style={{padding:'0.5rem 0.75rem',textAlign:'left',fontWeight:'700',color:'#374151',borderBottom:'1px solid #E5E7EB'}}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {remittanceBatches.map(b=>(
              <tr key={b.id} style={{borderBottom:'1px solid #F3F4F6'}}>
                <td style={{padding:'0.5rem 0.75rem',fontWeight:'600'}}>{b.payer_display_name||b.payer_name}</td>
                <td style={{padding:'0.5rem 0.75rem'}}>{b.check_number||'—'}</td>
                <td style={{padding:'0.5rem 0.75rem',color:'#6B7280'}}>{fmtDate(b.payment_date)}</td>
                <td style={{padding:'0.5rem 0.75rem',fontWeight:'700',color:'#2ABBA7'}}>{fmt$(b.total_amount)}</td>
                <td style={{padding:'0.5rem 0.75rem'}}>{b.line_item_count||0}</td>
                <td style={{padding:'0.5rem 0.75rem'}}><Badge status={b.status} label={b.status}/></td>
              </tr>
            ))}
            {remittanceBatches.length===0&&<tr><td colSpan="6" style={{padding:'2rem',textAlign:'center',color:'#9CA3AF'}}>No remittances recorded yet. Upload a check to get started.</td></tr>}
          </tbody>
        </table>
      </Card>
    </div>
  );

  // ── Payroll Tab ───────────────────────────────────────────────────────────────
  const renderPayroll = () => (
    <div style={{display:'grid',gap:'1rem'}}>
      {!gustoConfig?.isConfigured && (
        <Card style={{background:'#F9FAFB',border:'1px solid #E5E7EB'}}>
          <h4 style={{margin:'0 0 0.5rem',color:'#374151'}}>💰 Gusto Not Connected</h4>
          <p style={{margin:'0 0 0.75rem',fontSize:'0.875rem',color:'#6B7280'}}>You can still export hours as CSV for manual payroll. To connect Gusto:</p>
          <div style={{fontSize:'0.82rem',color:'#374151',display:'grid',gap:'0.25rem',marginBottom:'0.75rem'}}>
            <div>1. Sign up at <strong>gusto.com</strong> — starts at $40/mo + $6/caregiver/mo</div>
            <div>2. Settings → Integrations → API → create API key</div>
            <div>3. Add <code style={{background:'#E5E7EB',padding:'1px 4px',borderRadius:'3px'}}>GUSTO_API_KEY</code> and <code style={{background:'#E5E7EB',padding:'1px 4px',borderRadius:'3px'}}>GUSTO_COMPANY_ID</code> to Render env vars</div>
          </div>
        </Card>
      )}

      <Card>
        <SectionHeader icon="💰" title="Payroll Export" sub="Based on verified clock-in/out records"/>
        <div style={{display:'flex',gap:'0.75rem',alignItems:'flex-end',marginBottom:'1rem',flexWrap:'wrap'}}>
          <div>
            <label style={{display:'block',fontWeight:'600',fontSize:'0.78rem',marginBottom:'0.3rem'}}>Pay Period Start</label>
            <input type="date" value={payPeriod.start} onChange={e=>setPayPeriod(p=>({...p,start:e.target.value}))} style={{padding:'0.5rem',border:'1px solid #D1D5DB',borderRadius:'6px',fontSize:'0.85rem'}}/>
          </div>
          <div>
            <label style={{display:'block',fontWeight:'600',fontSize:'0.78rem',marginBottom:'0.3rem'}}>Pay Period End</label>
            <input type="date" value={payPeriod.end} onChange={e=>setPayPeriod(p=>({...p,end:e.target.value}))} style={{padding:'0.5rem',border:'1px solid #D1D5DB',borderRadius:'6px',fontSize:'0.85rem'}}/>
          </div>
          <Btn disabled={!payPeriod.start||!payPeriod.end||loading.preview} onClick={async()=>{
            setLoad('preview',true);
            const d = await get(`/api/gusto/preview?startDate=${payPeriod.start}&endDate=${payPeriod.end}`);
            if(d) setPayrollPreview(d); else toast('Could not load preview','error');
            setLoad('preview',false);
          }}>{loading.preview?'Loading...':'Preview'}</Btn>
          {payrollPreview && <>
            <a href={`${API_BASE_URL}/api/gusto/export-csv?startDate=${payPeriod.start}&endDate=${payPeriod.end}`} download style={{textDecoration:'none'}}>
              <Btn outline>⬇ CSV Export</Btn>
            </a>
            {gustoConfig?.isConfigured && (
              <Btn color="#7C3AED" disabled={loading.gusto} onClick={async()=>{
                setLoad('gusto',true);
                const r = await fetch(`${API_BASE_URL}/api/gusto/export`,{method:'POST',headers,body:JSON.stringify({startDate:payPeriod.start,endDate:payPeriod.end})});
                const d = await r.json();
                if(r.ok) toast(`Exported ${d.exported} caregivers to Gusto`,'success');
                else toast(d.error||'Export failed','error');
                setLoad('gusto',false);
              }}>{loading.gusto?'Exporting...':'🚀 Send to Gusto'}</Btn>
            )}
          </>}
        </div>

        {payrollPreview && (
          <>
            <div style={{display:'grid',gridTemplateColumns:'repeat(3,1fr)',gap:'0.75rem',marginBottom:'1rem'}}>
              <div style={{padding:'0.75rem',background:'#F9FAFB',borderRadius:'10px',textAlign:'center'}}>
                <div style={{fontSize:'1.3rem',fontWeight:'800'}}>{payrollPreview.totals.employees}</div>
                <div style={{fontSize:'0.72rem',color:'#6B7280'}}>Caregivers</div>
              </div>
              <div style={{padding:'0.75rem',background:'#F9FAFB',borderRadius:'10px',textAlign:'center'}}>
                <div style={{fontSize:'1.3rem',fontWeight:'800'}}>{payrollPreview.totals.totalHours}h</div>
                <div style={{fontSize:'0.72rem',color:'#6B7280'}}>Total Hours</div>
              </div>
              <div style={{padding:'0.75rem',background:'#F0FDFB',borderRadius:'10px',textAlign:'center'}}>
                <div style={{fontSize:'1.3rem',fontWeight:'800',color:'#2ABBA7'}}>{fmt$(payrollPreview.totals.totalGross)}</div>
                <div style={{fontSize:'0.72rem',color:'#6B7280'}}>Gross Pay</div>
              </div>
            </div>
            {payrollPreview.totals.unmapped > 0 && (
              <div style={{background:'#FEF3C7',border:'1px solid #FCD34D',borderRadius:'8px',padding:'0.75rem',marginBottom:'1rem',fontSize:'0.82rem',color:'#92400E'}}>
                ⚠️ {payrollPreview.totals.unmapped} caregiver(s) not mapped to Gusto — CSV export still works, Gusto sync will skip them.
              </div>
            )}
            <table style={{width:'100%',borderCollapse:'collapse',fontSize:'0.82rem'}}>
              <thead>
                <tr style={{background:'#F9FAFB'}}>
                  {['Caregiver','Hours','Weekend Hrs','Rate','Gross Pay','Gusto'].map(h=>(
                    <th key={h} style={{padding:'0.5rem 0.75rem',textAlign:'left',fontWeight:'700',color:'#374151',borderBottom:'1px solid #E5E7EB'}}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {payrollPreview.preview.map(r=>(
                  <tr key={r.id} style={{borderBottom:'1px solid #F3F4F6'}}>
                    <td style={{padding:'0.5rem 0.75rem',fontWeight:'600'}}>{r.first_name} {r.last_name}</td>
                    <td style={{padding:'0.5rem 0.75rem'}}>{r.total_hours}h</td>
                    <td style={{padding:'0.5rem 0.75rem',color:'#6B7280'}}>{r.weekend_hours}h</td>
                    <td style={{padding:'0.5rem 0.75rem'}}>{r.hourly_rate?fmt$(r.hourly_rate)+'/hr':'—'}</td>
                    <td style={{padding:'0.5rem 0.75rem',fontWeight:'700',color:'#2ABBA7'}}>{fmt$(r.gross_pay)}</td>
                    <td style={{padding:'0.5rem 0.75rem'}}>{r.gusto_mapped?<Badge status="active" label="✓ Mapped"/>:<Badge status="pending" label="Not Mapped"/>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}
      </Card>
    </div>
  );

  return (
    <div style={{maxWidth:'1100px'}}>
      <div style={{marginBottom:'1.25rem'}}>
        <h2 style={{margin:'0 0 0.25rem',fontSize:'1.3rem',fontWeight:'800',color:'#111827'}}>🔌 Integrations Hub</h2>
        <p style={{margin:0,fontSize:'0.82rem',color:'#6B7280'}}>EVV · MIDAS Authorizations · EDI 837 Claims · Remittance · Payroll</p>
      </div>

      {/* Tabs */}
      <div style={{display:'flex',gap:'0.25rem',marginBottom:'1.25rem',borderBottom:'2px solid #E5E7EB',paddingBottom:'0'}}>
        {TABS.map(t=>(
          <button key={t.id} onClick={()=>setTab(t.id)} style={{
            padding:'0.6rem 1rem', border:'none', background:'none', cursor:'pointer',
            fontWeight:tab===t.id?'800':'500', fontSize:'0.85rem',
            color:tab===t.id?'#2ABBA7':'#6B7280',
            borderBottom:tab===t.id?'2px solid #2ABBA7':'2px solid transparent',
            marginBottom:'-2px', whiteSpace:'nowrap', transition:'all 0.15s'
          }}>{t.label}</button>
        ))}
      </div>

      {tab==='overview' && renderOverview()}
      {tab==='evv' && renderEVV()}
      {tab==='authorizations' && renderAuthorizations()}
      {tab==='claims' && renderClaims()}
      {tab==='remittance' && renderRemittance()}
      {tab==='payroll' && renderPayroll()}
    </div>
  );
};

export default IntegrationsHub;
