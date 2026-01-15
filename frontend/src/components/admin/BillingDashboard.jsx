// src/components/admin/BillingDashboard.jsx
import React, { useState, useEffect } from 'react';
import { API_BASE_URL } from '../../config';

const BillingDashboard = ({ token }) => {
  const [activeTab, setActiveTab] = useState('invoices');
  const [invoices, setInvoices] = useState([]);
  const [clients, setClients] = useState([]);
  const [referralSources, setReferralSources] = useState([]);
  const [careTypes, setCareTypes] = useState([]);
  const [rates, setRates] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showGenerateForm, setShowGenerateForm] = useState(false);
  const [showInvoiceModal, setShowInvoiceModal] = useState(false);
  const [selectedInvoice, setSelectedInvoice] = useState(null);
  const [showRateForm, setShowRateForm] = useState(false);
  
  const [formData, setFormData] = useState({
    clientId: '',
    billingPeriodStart: '',
    billingPeriodEnd: '',
    notes: ''
  });

  const [rateFormData, setRateFormData] = useState({
    referralSourceId: '',
    careTypeId: '',
    rateAmount: '',
    rateType: 'hourly'
  });

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    try {
      const [invoiceRes, clientRes, rsRes, ctRes, ratesRes] = await Promise.all([
        fetch(`${API_BASE_URL}/api/invoices`, { headers: { 'Authorization': `Bearer ${token}` } }),
        fetch(`${API_BASE_URL}/api/clients`, { headers: { 'Authorization': `Bearer ${token}` } }),
        fetch(`${API_BASE_URL}/api/referral-sources`, { headers: { 'Authorization': `Bearer ${token}` } }),
        fetch(`${API_BASE_URL}/api/care-types`, { headers: { 'Authorization': `Bearer ${token}` } }),
        fetch(`${API_BASE_URL}/api/referral-source-rates`, { headers: { 'Authorization': `Bearer ${token}` } })
      ]);

      setInvoices(await invoiceRes.json());
      setClients(await clientRes.json());
      setReferralSources(await rsRes.json());
      setCareTypes(await ctRes.json());
      setRates(await ratesRes.json());
    } catch (error) {
      console.error('Failed to load data:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleGenerateInvoice = async (e) => {
    e.preventDefault();
    try {
      const response = await fetch(`${API_BASE_URL}/api/invoices/generate-with-rates`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify(formData)
      });

      if (!response.ok) {
        const err = await response.json();
        throw new Error(err.error || 'Failed to generate invoice');
      }

      const invoice = await response.json();
      setFormData({ clientId: '', billingPeriodStart: '', billingPeriodEnd: '', notes: '' });
      setShowGenerateForm(false);
      loadData();
      
      // Show the generated invoice
      setSelectedInvoice(invoice);
      setShowInvoiceModal(true);
    } catch (error) {
      alert('Failed to generate invoice: ' + error.message);
    }
  };

  const handleViewInvoice = async (invoiceId) => {
    try {
      const response = await fetch(`${API_BASE_URL}/api/invoices/${invoiceId}`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      const invoice = await response.json();
      setSelectedInvoice(invoice);
      setShowInvoiceModal(true);
    } catch (error) {
      alert('Failed to load invoice: ' + error.message);
    }
  };

  const handleMarkPaid = async (invoiceId) => {
    try {
      await fetch(`${API_BASE_URL}/api/invoices/${invoiceId}/payment-status`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ status: 'paid', paymentDate: new Date() })
      });
      loadData();
      if (selectedInvoice && selectedInvoice.id === invoiceId) {
        setSelectedInvoice({ ...selectedInvoice, payment_status: 'paid' });
      }
    } catch (error) {
      alert('Failed to update invoice: ' + error.message);
    }
  };

  const handleAddRate = async (e) => {
    e.preventDefault();
    try {
      const response = await fetch(`${API_BASE_URL}/api/referral-source-rates`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify(rateFormData)
      });

      if (!response.ok) throw new Error('Failed to add rate');

      setRateFormData({ referralSourceId: '', careTypeId: '', rateAmount: '', rateType: 'hourly' });
      setShowRateForm(false);
      loadData();
      alert('Rate added successfully!');
    } catch (error) {
      alert('Failed to add rate: ' + error.message);
    }
  };

  const handleDeleteRate = async (rateId) => {
    if (!window.confirm('Are you sure you want to delete this rate?')) return;
    
    try {
      await fetch(`${API_BASE_URL}/api/referral-source-rates/${rateId}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${token}` }
      });
      loadData();
    } catch (error) {
      alert('Failed to delete rate: ' + error.message);
    }
  };

  const handleExportCSV = async () => {
    try {
      const response = await fetch(`${API_BASE_URL}/api/export/invoices-csv`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'invoices.csv';
      a.click();
    } catch (error) {
      alert('Failed to export: ' + error.message);
    }
  };

  const pendingTotal = invoices
    .filter(inv => inv.payment_status === 'pending')
    .reduce((sum, inv) => sum + parseFloat(inv.total || 0), 0);

  const paidTotal = invoices
    .filter(inv => inv.payment_status === 'paid')
    .reduce((sum, inv) => sum + parseFloat(inv.total || 0), 0);

  const formatCurrency = (amount) => {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(amount || 0);
  };

  return (
    <div>
      <div className="page-header">
        <h2>💰 Billing & Invoicing</h2>
        <div className="button-group">
          <button 
            className="btn btn-primary"
            onClick={() => setShowGenerateForm(!showGenerateForm)}
          >
            {showGenerateForm ? '✕ Cancel' : '📄 Generate Invoice'}
          </button>
          <button className="btn btn-secondary" onClick={handleExportCSV}>
            📥 Export CSV
          </button>
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid">
        <div className="stat-card">
          <h3>Pending Invoices</h3>
          <div className="value value-danger">{formatCurrency(pendingTotal)}</div>
        </div>
        <div className="stat-card">
          <h3>Paid This Month</h3>
          <div className="value value-success">{formatCurrency(paidTotal)}</div>
        </div>
        <div className="stat-card">
          <h3>Total Invoices</h3>
          <div className="value">{invoices.length}</div>
        </div>
      </div>

      {/* Tabs */}
      <div className="card">
        <div className="filter-tabs">
          <button
            className={`filter-tab ${activeTab === 'invoices' ? 'active' : ''}`}
            onClick={() => setActiveTab('invoices')}
          >
            Invoices
          </button>
          <button
            className={`filter-tab ${activeTab === 'rates' ? 'active' : ''}`}
            onClick={() => setActiveTab('rates')}
          >
            Billing Rates
          </button>
        </div>
      </div>

      {showGenerateForm && (
        <div className="card card-form">
          <h3>Generate New Invoice</h3>
          <form onSubmit={handleGenerateInvoice}>
            <div className="form-grid">
              <div className="form-group">
                <label>Client *</label>
                <select
                  value={formData.clientId}
                  onChange={(e) => setFormData({ ...formData, clientId: e.target.value })}
                  required
                >
                  <option value="">Select a client...</option>
                  {clients.map(c => (
                    <option key={c.id} value={c.id}>
                      {c.first_name} {c.last_name}
                      {c.is_private_pay ? ' (Private Pay)' : ''}
                    </option>
                  ))}
                </select>
              </div>

              <div className="form-group">
                <label>Billing Period Start *</label>
                <input
                  type="date"
                  value={formData.billingPeriodStart}
                  onChange={(e) => setFormData({ ...formData, billingPeriodStart: e.target.value })}
                  required
                />
              </div>

              <div className="form-group">
                <label>Billing Period End *</label>
                <input
                  type="date"
                  value={formData.billingPeriodEnd}
                  onChange={(e) => setFormData({ ...formData, billingPeriodEnd: e.target.value })}
                  required
                />
              </div>

              <div className="form-group" style={{ gridColumn: '1 / -1' }}>
                <label>Notes</label>
                <textarea
                  value={formData.notes}
                  onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
                  placeholder="Optional notes for the invoice..."
                  rows="2"
                />
              </div>
            </div>

            <div className="form-actions">
              <button type="submit" className="btn btn-primary">Generate Invoice</button>
              <button type="button" className="btn btn-secondary" onClick={() => setShowGenerateForm(false)}>Cancel</button>
            </div>
          </form>
        </div>
      )}

      {/* INVOICES TAB */}
      {activeTab === 'invoices' && (
        <>
          {loading ? (
            <div className="loading"><div className="spinner"></div></div>
          ) : invoices.length === 0 ? (
            <div className="card card-centered">
              <p>No invoices yet. Generate one to get started.</p>
            </div>
          ) : (
            <table className="table">
              <thead>
                <tr>
                  <th>Invoice #</th>
                  <th>Client</th>
                  <th>Payer</th>
                  <th>Billing Period</th>
                  <th>Total</th>
                  <th>Status</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {invoices.map(invoice => (
                  <tr key={invoice.id}>
                    <td><strong>{invoice.invoice_number}</strong></td>
                    <td>{invoice.first_name} {invoice.last_name}</td>
                    <td>
                      {invoice.referral_source_name || (
                        <span className="badge badge-info">Private Pay</span>
                      )}
                    </td>
                    <td>
                      {new Date(invoice.billing_period_start).toLocaleDateString()} - {new Date(invoice.billing_period_end).toLocaleDateString()}
                    </td>
                    <td><strong>{formatCurrency(invoice.total)}</strong></td>
                    <td>
                      <span className={`badge ${
                        invoice.payment_status === 'paid' ? 'badge-success' : 'badge-warning'
                      }`}>
                        {invoice.payment_status?.toUpperCase()}
                      </span>
                    </td>
                    <td>
                      <div style={{ display: 'flex', gap: '0.5rem' }}>
                        <button 
                          className="btn btn-sm btn-primary"
                          onClick={() => handleViewInvoice(invoice.id)}
                        >
                          View
                        </button>
                        {invoice.payment_status !== 'paid' && (
                          <button 
                            className="btn btn-sm btn-success"
                            onClick={() => handleMarkPaid(invoice.id)}
                          >
                            Mark Paid
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </>
      )}

      {/* RATES TAB */}
      {activeTab === 'rates' && (
        <>
          <div className="card">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
              <h3 style={{ margin: 0 }}>Referral Source Billing Rates</h3>
              <button className="btn btn-primary" onClick={() => setShowRateForm(!showRateForm)}>
                {showRateForm ? '✕ Cancel' : '➕ Add Rate'}
              </button>
            </div>
            <p className="text-muted">
              Set billing rates for each referral source and care type combination. 
              Rates can be hourly or per 15-minute increment.
            </p>
          </div>

          {showRateForm && (
            <div className="card card-form">
              <h3>Add Billing Rate</h3>
              <form onSubmit={handleAddRate}>
                <div className="form-grid">
                  <div className="form-group">
                    <label>Referral Source *</label>
                    <select
                      value={rateFormData.referralSourceId}
                      onChange={(e) => setRateFormData({ ...rateFormData, referralSourceId: e.target.value })}
                      required
                    >
                      <option value="">Select referral source...</option>
                      {referralSources.map(rs => (
                        <option key={rs.id} value={rs.id}>{rs.name}</option>
                      ))}
                    </select>
                  </div>

                  <div className="form-group">
                    <label>Care Type *</label>
                    <select
                      value={rateFormData.careTypeId}
                      onChange={(e) => setRateFormData({ ...rateFormData, careTypeId: e.target.value })}
                      required
                    >
                      <option value="">Select care type...</option>
                      {careTypes.map(ct => (
                        <option key={ct.id} value={ct.id}>{ct.name}</option>
                      ))}
                    </select>
                  </div>

                  <div className="form-group">
                    <label>Rate Type *</label>
                    <select
                      value={rateFormData.rateType}
                      onChange={(e) => setRateFormData({ ...rateFormData, rateType: e.target.value })}
                      required
                    >
                      <option value="hourly">Per Hour</option>
                      <option value="15min">Per 15 Minutes</option>
                    </select>
                  </div>

                  <div className="form-group">
                    <label>Rate Amount *</label>
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      value={rateFormData.rateAmount}
                      onChange={(e) => setRateFormData({ ...rateFormData, rateAmount: e.target.value })}
                      placeholder={rateFormData.rateType === '15min' ? 'e.g., 6.25' : 'e.g., 25.00'}
                      required
                    />
                  </div>
                </div>

                <div className="form-actions">
                  <button type="submit" className="btn btn-primary">Add Rate</button>
                  <button type="button" className="btn btn-secondary" onClick={() => setShowRateForm(false)}>Cancel</button>
                </div>
              </form>
            </div>
          )}

          {rates.length === 0 ? (
            <div className="card card-centered">
              <p>No billing rates configured. Add rates to start billing.</p>
            </div>
          ) : (
            <table className="table">
              <thead>
                <tr>
                  <th>Referral Source</th>
                  <th>Care Type</th>
                  <th>Rate</th>
                  <th>Type</th>
                  <th>Effective Date</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {rates.map(rate => (
                  <tr key={rate.id}>
                    <td><strong>{rate.referral_source_name}</strong></td>
                    <td>{rate.care_type_name}</td>
                    <td><strong>{formatCurrency(rate.rate_amount)}</strong></td>
                    <td>
                      <span className={`badge ${rate.rate_type === 'hourly' ? 'badge-info' : 'badge-secondary'}`}>
                        {rate.rate_type === 'hourly' ? 'Per Hour' : 'Per 15 Min'}
                      </span>
                    </td>
                    <td>{new Date(rate.effective_date).toLocaleDateString()}</td>
                    <td>
                      <button 
                        className="btn btn-sm btn-danger"
                        onClick={() => handleDeleteRate(rate.id)}
                      >
                        Delete
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </>
      )}

      {/* Invoice Detail Modal */}
      {showInvoiceModal && selectedInvoice && (
        <div className="modal active">
          <div className="modal-content modal-large">
            <div className="modal-header">
              <h2>Invoice {selectedInvoice.invoice_number}</h2>
              <button className="close-btn" onClick={() => setShowInvoiceModal(false)}>×</button>
            </div>

            <div className="grid" style={{ gridTemplateColumns: '1fr 1fr', gap: '1rem', marginBottom: '1.5rem' }}>
              <div className="card" style={{ margin: 0 }}>
                <h4 style={{ margin: '0 0 0.5rem 0' }}>Bill To</h4>
                <p style={{ margin: 0 }}>
                  <strong>{selectedInvoice.first_name} {selectedInvoice.last_name}</strong><br />
                  {selectedInvoice.referral_source_name ? (
                    <>Payer: {selectedInvoice.referral_source_name}</>
                  ) : (
                    <span className="badge badge-info">Private Pay</span>
                  )}
                </p>
              </div>
              <div className="card" style={{ margin: 0 }}>
                <h4 style={{ margin: '0 0 0.5rem 0' }}>Invoice Details</h4>
                <p style={{ margin: 0 }}>
                  <strong>Period:</strong> {new Date(selectedInvoice.billing_period_start).toLocaleDateString()} - {new Date(selectedInvoice.billing_period_end).toLocaleDateString()}<br />
                  <strong>Due:</strong> {new Date(selectedInvoice.payment_due_date).toLocaleDateString()}<br />
                  <strong>Status:</strong>{' '}
                  <span className={`badge ${selectedInvoice.payment_status === 'paid' ? 'badge-success' : 'badge-warning'}`}>
                    {selectedInvoice.payment_status?.toUpperCase()}
                  </span>
                </p>
              </div>
            </div>

            {selectedInvoice.line_items && selectedInvoice.line_items.length > 0 ? (
              <table className="table">
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Caregiver</th>
                    <th>Description</th>
                    <th>Hours</th>
                    <th>Rate</th>
                    <th>Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {selectedInvoice.line_items.map((item, idx) => (
                    <tr key={idx}>
                      <td>{item.service_date ? new Date(item.service_date).toLocaleDateString() : '-'}</td>
                      <td>{item.caregiver_first_name} {item.caregiver_last_name}</td>
                      <td>{item.description}</td>
                      <td>{parseFloat(item.hours).toFixed(2)}</td>
                      <td>{formatCurrency(item.rate)}</td>
                      <td><strong>{formatCurrency(item.amount)}</strong></td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr>
                    <td colSpan="5" style={{ textAlign: 'right' }}><strong>Total:</strong></td>
                    <td><strong style={{ fontSize: '1.2rem' }}>{formatCurrency(selectedInvoice.total)}</strong></td>
                  </tr>
                </tfoot>
              </table>
            ) : (
              <div className="card card-centered">
                <p>No line items for this invoice.</p>
                <p className="text-muted">Total: <strong>{formatCurrency(selectedInvoice.total)}</strong></p>
              </div>
            )}

            {selectedInvoice.notes && (
              <div className="card" style={{ background: '#f9f9f9' }}>
                <h4 style={{ margin: '0 0 0.5rem 0' }}>Notes</h4>
                <p style={{ margin: 0 }}>{selectedInvoice.notes}</p>
              </div>
            )}

            <div className="modal-actions">
              {selectedInvoice.payment_status !== 'paid' && (
                <button 
                  className="btn btn-success"
                  onClick={() => handleMarkPaid(selectedInvoice.id)}
                >
                  ✓ Mark as Paid
                </button>
              )}
              <button 
                className="btn btn-primary"
                onClick={() => window.print()}
              >
                🖨️ Print
              </button>
              <button className="btn btn-secondary" onClick={() => setShowInvoiceModal(false)}>
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default BillingDashboard;
