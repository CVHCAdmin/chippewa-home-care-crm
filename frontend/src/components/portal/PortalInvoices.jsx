// components/portal/PortalInvoices.jsx
// Client billing and invoice history
import React, { useState, useEffect } from 'react';
import { apiCall } from '../../config';

const statusBadge = (status) => {
  const map = {
    pending:  { bg: '#fef9e7', color: '#d68910', label: 'Pending'  },
    paid:     { bg: '#eafaf1', color: '#1e8449', label: 'Paid'     },
    overdue:  { bg: '#fdf2f2', color: '#c0392b', label: 'Overdue'  },
    partial:  { bg: '#eaf4fd', color: '#1a5276', label: 'Partial'  },
  };
  const s = map[status] || map.pending;
  return (
    <span style={{
      background: s.bg, color: s.color,
      padding: '3px 10px', borderRadius: '12px',
      fontSize: '0.75rem', fontWeight: 600,
    }}>
      {s.label}
    </span>
  );
};

const formatDate = (dateStr) => {
  if (!dateStr) return '—';
  return new Date(dateStr + 'T00:00:00').toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric',
  });
};

const formatMoney = (amount) => {
  if (amount == null) return '—';
  return `$${Number(parseFloat(amount || 0)).toFixed(2)}`;
};

const PortalInvoices = ({ token }) => {
  const [invoices, setInvoices] = useState([]);
  const [loading, setLoading]   = useState(true);
  const [error, setError]       = useState('');
  const [expanded, setExpanded] = useState({}); // invoiceId -> show daily breakdown
  const toggleExpanded = (id) => setExpanded(prev => ({ ...prev, [id]: !prev[id] }));

  useEffect(() => {
    apiCall('/api/client-portal/portal/invoices', { method: 'GET' }, token)
      .then(data => { if (data) setInvoices(data); })
      .catch(err => setError(err.message))
      .finally(() => setLoading(false));
  }, [token]);

  const totalOwed = invoices
    .filter(i => i.payment_status === 'pending' || i.payment_status === 'overdue')
    .reduce((sum, i) => sum + parseFloat(i.total || 0), 0);

  if (loading) return <div style={{ textAlign: 'center', padding: '40px', color: '#888' }}>Loading billing...</div>;
  if (error)   return <div className="alert alert-error">{error}</div>;

  return (
    <div>
      <h2 style={{ margin: '0 0 20px', fontSize: '1.3rem', color: '#1a5276' }}>
        📄 Billing & Invoices
      </h2>

      {/* Summary card */}
      {totalOwed > 0 && (
        <div style={{
          background: 'linear-gradient(135deg, #1a5276 0%, #2980b9 100%)',
          borderRadius: '12px', padding: '20px 24px', marginBottom: '20px',
          color: '#fff', display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        }}>
          <div>
            <div style={{ fontSize: '0.8rem', opacity: 0.85, marginBottom: '4px' }}>TOTAL BALANCE DUE</div>
            <div style={{ fontSize: '2rem', fontWeight: 700 }}>{formatMoney(totalOwed)}</div>
          </div>
          <span style={{ fontSize: '2.5rem' }}>💳</span>
        </div>
      )}

      {invoices.length === 0 ? (
        <div style={{
          background: '#fff', borderRadius: '12px', padding: '48px',
          textAlign: 'center', color: '#888', boxShadow: '0 1px 4px rgba(0,0,0,0.08)',
        }}>
          <div style={{ fontSize: '3rem', marginBottom: '12px' }}>📄</div>
          <div>No invoices yet.</div>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
          {invoices.map(inv => (
            <div
              key={inv.id}
              style={{
                background: '#fff', borderRadius: '12px', padding: '18px 20px',
                boxShadow: '0 1px 4px rgba(0,0,0,0.08)',
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '8px' }}>
                <div>
                  <div style={{ fontWeight: 700, color: '#333', marginBottom: '3px' }}>
                    Invoice #{inv.invoice_number}
                  </div>
                  <div style={{ fontSize: '0.83rem', color: '#777' }}>
                    {formatDate(inv.billing_period_start)} – {formatDate(inv.billing_period_end)}
                  </div>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <div style={{ fontWeight: 700, fontSize: '1.1rem', color: '#1a5276', marginBottom: '4px' }}>
                    {formatMoney(inv.total)}
                  </div>
                  {statusBadge(inv.payment_status)}
                </div>
              </div>

              {Array.isArray(inv.line_items) && inv.line_items.length > 0 && (
                <div style={{ marginTop: '12px', paddingTop: '12px', borderTop: '1px solid #f0f0f0' }}>
                  <button
                    onClick={() => toggleExpanded(inv.id)}
                    style={{ background: 'none', border: 'none', color: '#1a5276', fontWeight: 600, fontSize: '0.85rem', cursor: 'pointer', padding: 0 }}
                  >
                    {expanded[inv.id] ? '▾ Hide hours & days' : '▸ Show hours & days'}
                  </button>
                  {expanded[inv.id] && (
                    <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: '10px' }}>
                      <thead>
                        <tr style={{ textAlign: 'left', color: '#999', fontSize: '0.72rem' }}>
                          <th style={{ padding: '4px 6px', borderBottom: '1px solid #eee' }}>Date</th>
                          <th style={{ padding: '4px 6px', borderBottom: '1px solid #eee' }}>Service</th>
                          <th style={{ padding: '4px 6px', borderBottom: '1px solid #eee', textAlign: 'right' }}>Hours</th>
                          <th style={{ padding: '4px 6px', borderBottom: '1px solid #eee', textAlign: 'right' }}>Amount</th>
                        </tr>
                      </thead>
                      <tbody>
                        {inv.line_items.map((li, i) => (
                          <tr key={i} style={{ fontSize: '0.8rem', color: '#555' }}>
                            <td style={{ padding: '4px 6px', borderBottom: '1px solid #f5f5f5' }}>{li.service_date ? formatDate(String(li.service_date).slice(0, 10)) : '—'}</td>
                            <td style={{ padding: '4px 6px', borderBottom: '1px solid #f5f5f5' }}>{li.description || 'Home Care Services'}</td>
                            <td style={{ padding: '4px 6px', borderBottom: '1px solid #f5f5f5', textAlign: 'right' }}>{Number(parseFloat(li.hours || 0)).toFixed(2)}</td>
                            <td style={{ padding: '4px 6px', borderBottom: '1px solid #f5f5f5', textAlign: 'right' }}>{formatMoney(li.amount)}</td>
                          </tr>
                        ))}
                        <tr style={{ fontSize: '0.8rem', fontWeight: 700, color: '#333' }}>
                          <td style={{ padding: '6px 6px' }} colSpan={2}>Total</td>
                          <td style={{ padding: '6px 6px', textAlign: 'right' }}>{Number(inv.line_items.reduce((s, li) => s + parseFloat(li.hours || 0), 0)).toFixed(2)}</td>
                          <td style={{ padding: '6px 6px', textAlign: 'right' }}>{formatMoney(inv.total)}</td>
                        </tr>
                      </tbody>
                    </table>
                  )}
                </div>
              )}

              {(inv.payment_due_date || inv.payment_date) && (
                <div style={{
                  marginTop: '12px', paddingTop: '12px', borderTop: '1px solid #f0f0f0',
                  display: 'flex', gap: '24px', fontSize: '0.82rem', color: '#777',
                }}>
                  {inv.payment_due_date && (
                    <span>Due: <strong style={{ color: '#333' }}>{formatDate(inv.payment_due_date)}</strong></span>
                  )}
                  {inv.payment_date && (
                    <span>Paid: <strong style={{ color: '#1e8449' }}>{formatDate(inv.payment_date)}</strong></span>
                  )}
                </div>
              )}

              {(inv.payment_status === 'pending' || inv.payment_status === 'overdue' || inv.payment_status === 'partial') && (
                <div style={{ marginTop: '12px', paddingTop: '12px', borderTop: '1px solid #f0f0f0', textAlign: 'right' }}>
                  <a
                    href={`/pay/${inv.id}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{
                      display: 'inline-block',
                      background: '#1a5276', color: '#fff',
                      padding: '8px 18px', borderRadius: '8px',
                      fontWeight: 600, fontSize: '0.9rem',
                      textDecoration: 'none',
                    }}
                  >
                    💳 Pay {formatMoney(inv.total)}
                  </a>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default PortalInvoices;
