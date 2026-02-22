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
  return `$${parseFloat(amount).toFixed(2)}`;
};

const PortalInvoices = ({ token }) => {
  const [invoices, setInvoices] = useState([]);
  const [loading, setLoading]   = useState(true);
  const [error, setError]       = useState('');

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
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default PortalInvoices;
