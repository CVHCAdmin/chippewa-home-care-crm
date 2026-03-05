// src/components/admin/BillingImport.jsx
// CSV import wizard for Midas / My Choice Wisconsin billing data
import React, { useState, useEffect, useCallback, useRef } from 'react';
import { API_BASE_URL, apiCall } from '../../config';
import { toast } from '../Toast';

// Column header aliases → canonical field names
const HEADER_MAP = {
  'member id': 'medicaidId', 'medicaid id': 'medicaidId', 'medicaid #': 'medicaidId',
  'mco id': 'medicaidId', 'mco member id': 'medicaidId', 'memberid': 'medicaidId',
  'member name': 'memberName', 'client name': 'memberName', 'patient name': 'memberName',
  'first name': 'firstName', 'firstname': 'firstName',
  'last name': 'lastName', 'lastname': 'lastName',
  'service date': 'serviceDate', 'date of service': 'serviceDate', 'dos': 'serviceDate', 'date': 'serviceDate',
  'units': 'hours', 'hours': 'hours', 'qty': 'hours', 'quantity': 'hours',
  'rate': 'rate', 'hourly rate': 'rate', 'unit rate': 'rate',
  'amount': 'amount', 'total': 'amount', 'charge': 'amount', 'billed amount': 'amount',
  'procedure code': 'procedureCode', 'service code': 'procedureCode', 'hcpcs': 'procedureCode',
  'provider': 'providerName', 'provider name': 'providerName', 'caregiver': 'providerName',
  'description': 'description', 'service description': 'description',
};

function parseCSV(text) {
  const lines = text.split(/\r?\n/).filter(l => l.trim());
  if (lines.length < 2) return { headers: [], rows: [] };

  // Handle quoted fields
  function splitRow(line) {
    const fields = [];
    let current = '', inQuotes = false;
    for (const ch of line) {
      if (ch === '"') { inQuotes = !inQuotes; continue; }
      if (ch === ',' && !inQuotes) { fields.push(current.trim()); current = ''; continue; }
      current += ch;
    }
    fields.push(current.trim());
    return fields;
  }

  const headers = splitRow(lines[0]);
  const rows = lines.slice(1).map(l => {
    const vals = splitRow(l);
    const obj = {};
    headers.forEach((h, i) => { obj[h] = vals[i] || ''; });
    return obj;
  }).filter(r => Object.values(r).some(v => v)); // skip empty rows

  return { headers, rows };
}

function mapHeaders(rawHeaders) {
  const mapping = {};
  for (const h of rawHeaders) {
    const key = h.toLowerCase().trim();
    if (HEADER_MAP[key]) mapping[h] = HEADER_MAP[key];
  }
  return mapping;
}

function normalizeRow(raw, headerMapping) {
  const mapped = {};
  for (const [rawHeader, value] of Object.entries(raw)) {
    const canonical = headerMapping[rawHeader];
    if (canonical) mapped[canonical] = value;
  }
  // Split "Member Name" into first/last if no separate first/last
  if (mapped.memberName && !mapped.firstName) {
    const parts = mapped.memberName.trim().split(/[,\s]+/);
    if (parts.length >= 2 && mapped.memberName.includes(',')) {
      // "Last, First" format
      mapped.lastName = parts[0];
      mapped.firstName = parts.slice(1).join(' ');
    } else {
      mapped.firstName = parts[0];
      mapped.lastName = parts.slice(1).join(' ');
    }
  }
  return mapped;
}

function matchClient(row, clients, medicaidMap, nameMap) {
  // 1. Try Medicaid ID match
  if (row.medicaidId) {
    const id = row.medicaidId.trim();
    if (medicaidMap[id]) return { client: medicaidMap[id], matchType: 'Medicaid ID' };
  }
  // 2. Try name match
  if (row.firstName && row.lastName) {
    const key = `${row.firstName.trim().toLowerCase()}|${row.lastName.trim().toLowerCase()}`;
    if (nameMap[key]) return { client: nameMap[key], matchType: 'Name' };
  }
  return null;
}

const BillingImport = ({ token }) => {
  const [step, setStep] = useState(1);
  const [clients, setClients] = useState([]);
  const [rawCSV, setRawCSV] = useState({ headers: [], rows: [] });
  const [headerMapping, setHeaderMapping] = useState({});
  const [mappedRows, setMappedRows] = useState([]);
  const [fileName, setFileName] = useState('');
  const [importing, setImporting] = useState(false);
  const [results, setResults] = useState(null);
  const [source, setSource] = useState('');
  const fileRef = useRef();

  // Load clients on mount
  useEffect(() => {
    apiCall('/api/clients', { method: 'GET' }, token)
      .then(data => setClients(Array.isArray(data) ? data : []))
      .catch(() => {});
  }, [token]);

  // Build lookup maps
  const medicaidMap = {};
  const nameMap = {};
  for (const c of clients) {
    if (c.medicaid_id) medicaidMap[c.medicaid_id.trim()] = c;
    if (c.mco_member_id) medicaidMap[c.mco_member_id.trim()] = c;
    const key = `${(c.first_name || '').toLowerCase()}|${(c.last_name || '').toLowerCase()}`;
    nameMap[key] = c;
  }

  const handleFileUpload = useCallback((e) => {
    const file = e.target.files[0];
    if (!file) return;
    setFileName(file.name);
    // Auto-detect source from filename
    if (file.name.toLowerCase().includes('midas')) setSource('Midas');
    else if (file.name.toLowerCase().includes('mychoice') || file.name.toLowerCase().includes('my choice')) setSource('My Choice Wisconsin');
    else setSource('CSV Import');

    const reader = new FileReader();
    reader.onload = (ev) => {
      const { headers, rows } = parseCSV(ev.target.result);
      setRawCSV({ headers, rows });
      const mapping = mapHeaders(headers);
      setHeaderMapping(mapping);

      // Normalize and match
      const mapped = rows.map((raw, idx) => {
        const norm = normalizeRow(raw, mapping);
        const match = matchClient(norm, clients, medicaidMap, nameMap);
        return {
          idx: idx + 1,
          raw,
          ...norm,
          clientId: match?.client?.id || null,
          clientName: match ? `${match.client.first_name} ${match.client.last_name}` : null,
          matchType: match?.matchType || null,
          included: !!match,
        };
      });
      setMappedRows(mapped);
      setStep(2);
    };
    reader.readAsText(file);
  }, [clients, medicaidMap, nameMap]);

  const toggleRow = (idx) => {
    setMappedRows(prev => prev.map((r, i) => i === idx ? { ...r, included: !r.included } : r));
  };

  const assignClient = (rowIdx, clientId) => {
    const client = clients.find(c => c.id === clientId);
    setMappedRows(prev => prev.map((r, i) => i === rowIdx ? {
      ...r,
      clientId: client?.id || null,
      clientName: client ? `${client.first_name} ${client.last_name}` : null,
      matchType: client ? 'Manual' : null,
      included: !!client,
    } : r));
  };

  const matchedCount = mappedRows.filter(r => r.clientId).length;
  const includedCount = mappedRows.filter(r => r.included && r.clientId).length;

  const handleImport = async () => {
    const toImport = mappedRows
      .filter(r => r.included && r.clientId)
      .map(r => ({
        clientId: r.clientId,
        serviceDate: r.serviceDate || null,
        hours: r.hours || '0',
        rate: r.rate || '0',
        amount: r.amount || '0',
        description: r.procedureCode || r.description || '',
        caregiverName: r.providerName || '',
      }));

    if (toImport.length === 0) {
      toast('No rows to import', 'warning');
      return;
    }

    setImporting(true);
    try {
      const res = await apiCall('/api/billing/import-csv', {
        method: 'POST',
        body: JSON.stringify({ rows: toImport, source }),
      }, token);

      if (!res) {
        toast('Import failed — rate limited, try again', 'error');
        return;
      }

      setResults(res);
      setStep(3);
      toast(`Imported ${res.imported} line items into ${res.invoicesCreated} invoices`, 'success');
    } catch (err) {
      toast(err.message || 'Import failed', 'error');
    } finally {
      setImporting(false);
    }
  };

  const reset = () => {
    setStep(1);
    setRawCSV({ headers: [], rows: [] });
    setHeaderMapping({});
    setMappedRows([]);
    setFileName('');
    setResults(null);
    setSource('');
    if (fileRef.current) fileRef.current.value = '';
  };

  // ── Step 1: Upload ──────────────────────────────────────────────────────────
  if (step === 1) {
    return (
      <div style={{ padding: '1.5rem' }}>
        <h2 style={{ marginBottom: '0.5rem' }}>Billing Import</h2>
        <p style={{ color: '#6B7280', marginBottom: '1.5rem' }}>
          Upload a CSV exported from Midas or My Choice Wisconsin to import billing records.
        </p>

        <div style={{
          border: '2px dashed #D1D5DB', borderRadius: 12, padding: '3rem',
          textAlign: 'center', background: '#F9FAFB', cursor: 'pointer',
        }} onClick={() => fileRef.current?.click()}>
          <div style={{ fontSize: 48, marginBottom: 12 }}>📄</div>
          <p style={{ fontWeight: 600, marginBottom: 4 }}>Click to select a CSV file</p>
          <p style={{ fontSize: 13, color: '#9CA3AF' }}>
            Supports Midas and My Choice Wisconsin export formats
          </p>
          <input
            ref={fileRef}
            type="file"
            accept=".csv"
            onChange={handleFileUpload}
            style={{ display: 'none' }}
          />
        </div>

        <div style={{ marginTop: '1.5rem', padding: '1rem', background: '#F0F9FF', borderRadius: 8, fontSize: 13 }}>
          <strong>Supported columns:</strong> Member ID / Medicaid ID, Member Name, Service Date, Units/Hours, Rate, Amount, Procedure Code, Provider Name
        </div>
      </div>
    );
  }

  // ── Step 2: Preview & Match ─────────────────────────────────────────────────
  if (step === 2) {
    return (
      <div style={{ padding: '1.5rem' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
          <div>
            <h2 style={{ marginBottom: 4 }}>Preview Import</h2>
            <p style={{ color: '#6B7280', fontSize: 13 }}>
              {fileName} — {source} — {mappedRows.length} rows
            </p>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={reset} style={btnStyle('#6B7280')}>Cancel</button>
            <button
              onClick={handleImport}
              disabled={importing || includedCount === 0}
              style={btnStyle(includedCount > 0 ? '#10B981' : '#9CA3AF')}
            >
              {importing ? 'Importing...' : `Import ${includedCount} rows`}
            </button>
          </div>
        </div>

        {/* Summary bar */}
        <div style={{
          display: 'flex', gap: '1.5rem', marginBottom: '1rem', padding: '0.75rem 1rem',
          background: '#F3F4F6', borderRadius: 8, fontSize: 14,
        }}>
          <span><strong>{mappedRows.length}</strong> total rows</span>
          <span style={{ color: '#059669' }}><strong>{matchedCount}</strong> matched</span>
          <span style={{ color: '#DC2626' }}><strong>{mappedRows.length - matchedCount}</strong> unmatched</span>
          <span style={{ color: '#2563EB' }}><strong>{includedCount}</strong> ready to import</span>
        </div>

        {/* Detected column mapping */}
        {Object.keys(headerMapping).length > 0 && (
          <div style={{ marginBottom: '1rem', fontSize: 12, color: '#6B7280' }}>
            <strong>Detected columns:</strong>{' '}
            {Object.entries(headerMapping).map(([raw, mapped]) => `${raw} → ${mapped}`).join(', ')}
          </div>
        )}

        {/* Preview table */}
        <div style={{ overflowX: 'auto', maxHeight: '60vh', overflowY: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ background: '#F9FAFB', position: 'sticky', top: 0, zIndex: 1 }}>
                <th style={thStyle}>Include</th>
                <th style={thStyle}>#</th>
                <th style={thStyle}>CSV Name / ID</th>
                <th style={thStyle}>Matched Client</th>
                <th style={thStyle}>Match Type</th>
                <th style={thStyle}>Service Date</th>
                <th style={thStyle}>Hours</th>
                <th style={thStyle}>Rate</th>
                <th style={thStyle}>Amount</th>
                <th style={thStyle}>Status</th>
              </tr>
            </thead>
            <tbody>
              {mappedRows.map((row, i) => (
                <tr key={i} style={{ borderBottom: '1px solid #E5E7EB', background: row.included ? '#fff' : '#FEF2F2' }}>
                  <td style={tdStyle}>
                    <input
                      type="checkbox"
                      checked={row.included}
                      onChange={() => toggleRow(i)}
                      disabled={!row.clientId}
                    />
                  </td>
                  <td style={tdStyle}>{row.idx}</td>
                  <td style={tdStyle}>
                    {row.memberName || `${row.firstName || ''} ${row.lastName || ''}`.trim() || row.medicaidId || '—'}
                  </td>
                  <td style={tdStyle}>
                    {row.clientId ? (
                      <span style={{ color: '#059669', fontWeight: 500 }}>{row.clientName}</span>
                    ) : (
                      <select
                        value=""
                        onChange={(e) => assignClient(i, e.target.value)}
                        style={{ fontSize: 12, padding: '2px 4px', maxWidth: 180 }}
                      >
                        <option value="">-- Assign client --</option>
                        {clients.map(c => (
                          <option key={c.id} value={c.id}>
                            {c.first_name} {c.last_name} {c.medicaid_id ? `(${c.medicaid_id})` : ''}
                          </option>
                        ))}
                      </select>
                    )}
                  </td>
                  <td style={tdStyle}>
                    {row.matchType && (
                      <span style={{
                        padding: '2px 6px', borderRadius: 4, fontSize: 11, fontWeight: 600,
                        background: row.matchType === 'Medicaid ID' ? '#D1FAE5' : row.matchType === 'Name' ? '#DBEAFE' : '#FEF3C7',
                        color: row.matchType === 'Medicaid ID' ? '#065F46' : row.matchType === 'Name' ? '#1E40AF' : '#92400E',
                      }}>
                        {row.matchType}
                      </span>
                    )}
                  </td>
                  <td style={tdStyle}>{row.serviceDate || '—'}</td>
                  <td style={tdStyle}>{row.hours || '—'}</td>
                  <td style={tdStyle}>{row.rate ? `$${row.rate}` : '—'}</td>
                  <td style={tdStyle}>{row.amount ? `$${Number(parseFloat(row.amount || 0)).toFixed(2)}` : '—'}</td>
                  <td style={tdStyle}>
                    {row.clientId ? (
                      <span style={{ color: '#059669', fontWeight: 600, fontSize: 12 }}>Matched</span>
                    ) : (
                      <span style={{ color: '#DC2626', fontWeight: 600, fontSize: 12 }}>Unmatched</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    );
  }

  // ── Step 3: Results ─────────────────────────────────────────────────────────
  if (step === 3 && results) {
    return (
      <div style={{ padding: '1.5rem' }}>
        <h2 style={{ marginBottom: '1rem' }}>Import Complete</h2>

        <div style={{ display: 'flex', gap: '1rem', marginBottom: '1.5rem' }}>
          <StatCard label="Line Items Imported" value={results.imported} color="#059669" />
          <StatCard label="Invoices Created" value={results.invoicesCreated} color="#2563EB" />
          <StatCard label="Rows Skipped" value={results.skipped} color="#F59E0B" />
        </div>

        {results.errors?.length > 0 && (
          <div style={{ marginBottom: '1.5rem' }}>
            <h3 style={{ marginBottom: 8, fontSize: 14 }}>Errors ({results.errors.length})</h3>
            <div style={{ maxHeight: 200, overflowY: 'auto', background: '#FEF2F2', borderRadius: 8, padding: '0.75rem', fontSize: 13 }}>
              {results.errors.map((err, i) => (
                <div key={i} style={{ padding: '4px 0', borderBottom: '1px solid #FECACA' }}>
                  {err.row ? `Row ${err.row}: ` : ''}{err.error}
                </div>
              ))}
            </div>
          </div>
        )}

        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={reset} style={btnStyle('#3B82F6')}>Import Another File</button>
        </div>
      </div>
    );
  }

  return null;
};

// ── Style helpers ─────────────────────────────────────────────────────────────

const thStyle = {
  padding: '8px 10px', textAlign: 'left', fontWeight: 600,
  borderBottom: '2px solid #E5E7EB', whiteSpace: 'nowrap',
};

const tdStyle = {
  padding: '6px 10px', whiteSpace: 'nowrap',
};

const btnStyle = (bg) => ({
  padding: '8px 16px', borderRadius: 6, border: 'none',
  background: bg, color: '#fff', fontWeight: 600, fontSize: 13,
  cursor: 'pointer',
});

const StatCard = ({ label, value, color }) => (
  <div style={{
    padding: '1rem 1.5rem', borderRadius: 8, background: '#F9FAFB',
    border: '1px solid #E5E7EB', flex: 1,
  }}>
    <div style={{ fontSize: 28, fontWeight: 700, color }}>{value}</div>
    <div style={{ fontSize: 13, color: '#6B7280' }}>{label}</div>
  </div>
);

export default BillingImport;
