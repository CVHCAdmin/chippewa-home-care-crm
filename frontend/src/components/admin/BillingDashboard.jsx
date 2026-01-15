// src/components/admin/BillingDashboard.jsx
// Complete billing system: Invoicing, A/R Aging, Authorizations, Claims, Payments
import React, { useState, useEffect } from 'react';
import { API_BASE_URL } from '../../config';

const BillingDashboard = ({ token }) => {
  const [activeTab, setActiveTab] = useState('invoices');
  const [invoices, setInvoices] = useState([]);
  const [clients, setClients] = useState([]);
  const [referralSources, setReferralSources] = useState([]);
  const [careTypes, setCareTypes] = useState([]);
  const [rates, setRates] = useState([]);
  const [authorizations, setAuthorizations] = useState([]);
  const [payments, setPayments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showGenerateForm, setShowGenerateForm] = useState(false);
  const [showBatchForm, setShowBatchForm] = useState(false);
  const [showInvoiceModal, setShowInvoiceModal] = useState(false);
  const [showPaymentModal, setShowPaymentModal] = useState(false);
  const [showAuthModal, setShowAuthModal] = useState(false);
  const [showAdjustmentModal, setShowAdjustmentModal] = useState(false);
  const [selectedInvoice, setSelectedInvoice] = useState(null);
  const [showRateForm, setShowRateForm] = useState(false);
  const [message, setMessage] = useState('');
  
  const [formData, setFormData] = useState({
    clientId: '',
    billingPeriodStart: '',
    billingPeriodEnd: '',
    notes: ''
  });

  const [batchFormData, setBatchFormData] = useState({
    billingPeriodStart: '',
    billingPeriodEnd: '',
    clientFilter: 'all',
    referralSourceId: ''
  });

  const [rateFormData, setRateFormData] = useState({
    referralSourceId: '',
    careTypeId: '',
    rateAmount: '',
    rateType: 'hourly'
  });

  const [authFormData, setAuthFormData] = useState({
    clientId: '',
    referralSourceId: '',
    authorizationNumber: '',
    serviceType: '',
    authorizedUnits: '',
    unitType: 'hours',
    startDate: '',
    endDate: '',
    notes: ''
  });

  const [paymentFormData, setPaymentFormData] = useState({
    invoiceId: '',
    amount: '',
    paymentDate: new Date().toISOString().split('T')[0],
    paymentMethod: 'check',
    referenceNumber: '',
    notes: ''
  });

  const [adjustmentFormData, setAdjustmentFormData] = useState({
    invoiceId: '',
    amount: '',
    type: 'write_off',
    reason: '',
    notes: ''
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

      // Try loading optional endpoints
      try {
        const authRes = await fetch(`${API_BASE_URL}/api/authorizations`, { headers: { 'Authorization': `Bearer ${token}` } });
        if (authRes.ok) setAuthorizations(await authRes.json());
      } catch (e) { console.log('Authorizations endpoint not available'); }

      try {
        const payRes = await fetch(`${API_BASE_URL}/api/invoice-payments`, { headers: { 'Authorization': `Bearer ${token}` } });
        if (payRes.ok) setPayments(await payRes.json());
      } catch (e) { console.log('Payments endpoint not available'); }

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
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
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
      setSelectedInvoice(invoice);
      setShowInvoiceModal(true);
    } catch (error) {
      alert('Failed to generate invoice: ' + error.message);
    }
  };

  const handleBatchGenerate = async (e) => {
    e.preventDefault();
    setLoading(true);
    try {
      const response = await fetch(`${API_BASE_URL}/api/invoices/batch-generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify(batchFormData)
      });
      if (!response.ok) throw new Error('Batch generation failed');
      const result = await response.json();
      setBatchFormData({ billingPeriodStart: '', billingPeriodEnd: '', clientFilter: 'all', referralSourceId: '' });
      setShowBatchForm(false);
      loadData();
      setMessage(`✓ Generated ${result.count} invoices totaling ${formatCurrency(result.total)}`);
      setTimeout(() => setMessage(''), 5000);
    } catch (error) {
      alert('Failed: ' + error.message);
    } finally {
      setLoading(false);
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
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({ status: 'paid', paymentDate: new Date() })
      });
      loadData();
      if (selectedInvoice?.id === invoiceId) {
        setSelectedInvoice({ ...selectedInvoice, payment_status: 'paid' });
      }
    } catch (error) {
      alert('Failed: ' + error.message);
    }
  };

  const handleRecordPayment = async (e) => {
    e.preventDefault();
    try {
      const response = await fetch(`${API_BASE_URL}/api/invoice-payments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify(paymentFormData)
      });
      if (!response.ok) throw new Error('Failed to record payment');
      setPaymentFormData({ invoiceId: '', amount: '', paymentDate: new Date().toISOString().split('T')[0], paymentMethod: 'check', referenceNumber: '', notes: '' });
      setShowPaymentModal(false);
      loadData();
      setMessage('✓ Payment recorded');
      setTimeout(() => setMessage(''), 3000);
    } catch (error) {
      alert('Failed: ' + error.message);
    }
  };

  const handleAddAuthorization = async (e) => {
    e.preventDefault();
    try {
      const response = await fetch(`${API_BASE_URL}/api/authorizations`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify(authFormData)
      });
      if (!response.ok) throw new Error('Failed to add authorization');
      setAuthFormData({ clientId: '', referralSourceId: '', authorizationNumber: '', serviceType: '', authorizedUnits: '', unitType: 'hours', startDate: '', endDate: '', notes: '' });
      setShowAuthModal(false);
      loadData();
      setMessage('✓ Authorization added');
      setTimeout(() => setMessage(''), 3000);
    } catch (error) {
      alert('Failed: ' + error.message);
    }
  };

  const handleRecordAdjustment = async (e) => {
    e.preventDefault();
    try {
      const response = await fetch(`${API_BASE_URL}/api/invoice-adjustments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify(adjustmentFormData)
      });
      if (!response.ok) throw new Error('Failed to record adjustment');
      setAdjustmentFormData({ invoiceId: '', amount: '', type: 'write_off', reason: '', notes: '' });
      setShowAdjustmentModal(false);
      loadData();
      setMessage('✓ Adjustment recorded');
      setTimeout(() => setMessage(''), 3000);
    } catch (error) {
      alert('Failed: ' + error.message);
    }
  };

  const handleAddRate = async (e) => {
    e.preventDefault();
    try {
      const response = await fetch(`${API_BASE_URL}/api/referral-source-rates`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify(rateFormData)
      });
      if (!response.ok) throw new Error('Failed to add rate');
      setRateFormData({ referralSourceId: '', careTypeId: '', rateAmount: '', rateType: 'hourly' });
      setShowRateForm(false);
      loadData();
    } catch (error) {
      alert('Failed: ' + error.message);
    }
  };

  const handleDeleteRate = async (rateId) => {
    if (!window.confirm('Delete this rate?')) return;
    try {
      await fetch(`${API_BASE_URL}/api/referral-source-rates/${rateId}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${token}` }
      });
      loadData();
    } catch (error) {
      alert('Failed: ' + error.message);
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

  const handleExportEVV = async () => {
    try {
      const response = await fetch(`${API_BASE_URL}/api/export/evv`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `evv-export-${new Date().toISOString().split('T')[0]}.csv`;
      a.click();
    } catch (error) {
      alert('Failed to export EVV: ' + error.message);
    }
  };

  const calculateAgingBuckets = () => {
    const today = new Date();
    const buckets = { current: 0, thirtyDays: 0, sixtyDays: 0, ninetyDays: 0, over90: 0 };
    invoices.filter(inv => inv.payment_status !== 'paid').forEach(inv => {
      const dueDate = new Date(inv.payment_due_date);
      const daysOverdue = Math.floor((today - dueDate) / (1000 * 60 * 60 * 24));
      const amount = parseFloat(inv.total || 0) - parseFloat(inv.amount_paid || 0);
      if (daysOverdue <= 0) buckets.current += amount;
      else if (daysOverdue <= 30) buckets.thirtyDays += amount;
      else if (daysOverdue <= 60) buckets.sixtyDays += amount;
      else if (daysOverdue <= 90) buckets.ninetyDays += amount;
      else buckets.over90 += amount;
    });
    return buckets;
  };

  const getAuthUsage = (auth) => {
    const used = parseFloat(auth.used_units || 0);
    const authorized = parseFloat(auth.authorized_units || 0);
    return { used, authorized, remaining: authorized - used, percentage: authorized > 0 ? (used / authorized) * 100 : 0 };
  };

  const pendingTotal = invoices.filter(inv => inv.payment_status === 'pending').reduce((sum, inv) => sum + parseFloat(inv.total || 0), 0);
  const paidTotal = invoices.filter(inv => inv.payment_status === 'paid').reduce((sum, inv) => sum + parseFloat(inv.total || 0), 0);
  const agingBuckets = calculateAgingBuckets();

  const formatCurrency = (amount) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(amount || 0);
  const getClientName = (clientId) => { const c = clients.find(c => c.id === clientId); return c ? `${c.first_name} ${c.last_name}` : 'Unknown'; };
  const getRSName = (rsId) => { const rs = referralSources.find(r => r.id === rsId); return rs ? rs.name : 'Unknown'; };

  const tabs = [
    { id: 'invoices', label: '📄 Invoices' },
    { id: 'aging', label: '📊 A/R Aging' },
    { id: 'authorizations', label: '📋 Authorizations' },
    { id: 'payments', label: '💳 Payments' },
    { id: 'rates', label: '💰 Rates' }
  ];

  if (loading) return <div className="loading"><div className="spinner"></div></div>;

  return (
    <div>
      <div className="page-header">
        <h2>💰 Billing & Invoicing</h2>
        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
          <button className="btn btn-primary" onClick={() => setShowGenerateForm(!showGenerateForm)}>📄 New Invoice</button>
          <button className="btn btn-secondary" onClick={() => setShowBatchForm(!showBatchForm)}>📋 Batch Generate</button>
          <button className="btn btn-secondary" onClick={handleExportCSV}>📥 Export CSV</button>
          <button className="btn btn-secondary" onClick={handleExportEVV}>📤 EVV Export</button>
        </div>
      </div>

      {message && <div className="alert alert-success">{message}</div>}

      {/* Summary Cards */}
      <div className="grid">
        <div className="stat-card">
          <h3>Outstanding A/R</h3>
          <div className="value" style={{ color: '#dc3545' }}>{formatCurrency(pendingTotal)}</div>
        </div>
        <div className="stat-card">
          <h3>Collected (All Time)</h3>
          <div className="value" style={{ color: '#28a745' }}>{formatCurrency(paidTotal)}</div>
        </div>
        <div className="stat-card">
          <h3>Over 90 Days</h3>
          <div className="value" style={{ color: agingBuckets.over90 > 0 ? '#dc3545' : '#28a745' }}>{formatCurrency(agingBuckets.over90)}</div>
        </div>
        <div className="stat-card">
          <h3>Active Authorizations</h3>
          <div className="value">{authorizations.filter(a => new Date(a.end_date) >= new Date()).length}</div>
        </div>
      </div>

      {/* Tabs */}
      <div className="card">
        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', marginBottom: '1rem' }}>
          {tabs.map(tab => (
            <button key={tab.id} className={`btn ${activeTab === tab.id ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setActiveTab(tab.id)}>{tab.label}</button>
          ))}
        </div>
      </div>

      {/* Generate Invoice Form */}
      {showGenerateForm && (
        <div className="card card-form">
          <h3>Generate Invoice</h3>
          <form onSubmit={handleGenerateInvoice}>
            <div className="form-grid">
              <div className="form-group">
                <label>Client *</label>
                <select value={formData.clientId} onChange={(e) => setFormData({ ...formData, clientId: e.target.value })} required>
                  <option value="">Select client...</option>
                  {clients.map(client => <option key={client.id} value={client.id}>{client.first_name} {client.last_name}</option>)}
                </select>
              </div>
              <div className="form-group">
                <label>Billing Period Start *</label>
                <input type="date" value={formData.billingPeriodStart} onChange={(e) => setFormData({ ...formData, billingPeriodStart: e.target.value })} required />
              </div>
              <div className="form-group">
                <label>Billing Period End *</label>
                <input type="date" value={formData.billingPeriodEnd} onChange={(e) => setFormData({ ...formData, billingPeriodEnd: e.target.value })} required />
              </div>
            </div>
            <div className="form-actions">
              <button type="submit" className="btn btn-primary">Generate</button>
              <button type="button" className="btn btn-secondary" onClick={() => setShowGenerateForm(false)}>Cancel</button>
            </div>
          </form>
        </div>
      )}

      {/* Batch Generate Form */}
      {showBatchForm && (
        <div className="card card-form">
          <h3>Batch Generate Invoices</h3>
          <p className="text-muted">Generate invoices for all clients with billable hours in the selected period.</p>
          <form onSubmit={handleBatchGenerate}>
            <div className="form-grid">
              <div className="form-group">
                <label>Start Date *</label>
                <input type="date" value={batchFormData.billingPeriodStart} onChange={(e) => setBatchFormData({ ...batchFormData, billingPeriodStart: e.target.value })} required />
              </div>
              <div className="form-group">
                <label>End Date *</label>
                <input type="date" value={batchFormData.billingPeriodEnd} onChange={(e) => setBatchFormData({ ...batchFormData, billingPeriodEnd: e.target.value })} required />
              </div>
              <div className="form-group">
                <label>Client Type</label>
                <select value={batchFormData.clientFilter} onChange={(e) => setBatchFormData({ ...batchFormData, clientFilter: e.target.value })}>
                  <option value="all">All Clients</option>
                  <option value="insurance">Insurance Only</option>
                  <option value="private">Private Pay Only</option>
                </select>
              </div>
              <div className="form-group">
                <label>Specific Payer</label>
                <select value={batchFormData.referralSourceId} onChange={(e) => setBatchFormData({ ...batchFormData, referralSourceId: e.target.value })}>
                  <option value="">All Payers</option>
                  {referralSources.map(rs => <option key={rs.id} value={rs.id}>{rs.name}</option>)}
                </select>
              </div>
            </div>
            <div className="form-actions">
              <button type="submit" className="btn btn-primary" disabled={loading}>{loading ? 'Generating...' : 'Generate All'}</button>
              <button type="button" className="btn btn-secondary" onClick={() => setShowBatchForm(false)}>Cancel</button>
            </div>
          </form>
        </div>
      )}

      {/* INVOICES TAB */}
      {activeTab === 'invoices' && (
        invoices.length === 0 ? (
          <div className="card card-centered"><p>No invoices yet. Generate your first invoice above.</p></div>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>Invoice #</th>
                <th>Client</th>
                <th>Payer</th>
                <th>Period</th>
                <th>Total</th>
                <th>Paid</th>
                <th>Balance</th>
                <th>Status</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {invoices.map(invoice => {
                const paid = parseFloat(invoice.amount_paid || 0);
                const total = parseFloat(invoice.total || 0);
                const balance = total - paid;
                return (
                  <tr key={invoice.id}>
                    <td><strong>{invoice.invoice_number}</strong></td>
                    <td>{invoice.first_name} {invoice.last_name}</td>
                    <td>{invoice.referral_source_name || <span className="badge badge-info">Private</span>}</td>
                    <td>{new Date(invoice.billing_period_start).toLocaleDateString()} - {new Date(invoice.billing_period_end).toLocaleDateString()}</td>
                    <td><strong>{formatCurrency(total)}</strong></td>
                    <td style={{ color: '#28a745' }}>{formatCurrency(paid)}</td>
                    <td style={{ color: balance > 0 ? '#dc3545' : '#28a745' }}>{formatCurrency(balance)}</td>
                    <td>
                      <span className={`badge ${invoice.payment_status === 'paid' ? 'badge-success' : invoice.payment_status === 'partial' ? 'badge-warning' : 'badge-danger'}`}>
                        {invoice.payment_status?.toUpperCase()}
                      </span>
                    </td>
                    <td>
                      <div style={{ display: 'flex', gap: '0.25rem' }}>
                        <button className="btn btn-sm btn-primary" onClick={() => handleViewInvoice(invoice.id)}>View</button>
                        {invoice.payment_status !== 'paid' && (
                          <button className="btn btn-sm btn-success" onClick={() => { setPaymentFormData({ ...paymentFormData, invoiceId: invoice.id }); setShowPaymentModal(true); }}>Pay</button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )
      )}

      {/* A/R AGING TAB */}
      {activeTab === 'aging' && (
        <>
          <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))' }}>
            <div className="stat-card" style={{ borderLeftColor: '#28a745' }}><h3>Current</h3><div className="value">{formatCurrency(agingBuckets.current)}</div></div>
            <div className="stat-card" style={{ borderLeftColor: '#ffc107' }}><h3>1-30 Days</h3><div className="value">{formatCurrency(agingBuckets.thirtyDays)}</div></div>
            <div className="stat-card" style={{ borderLeftColor: '#fd7e14' }}><h3>31-60 Days</h3><div className="value">{formatCurrency(agingBuckets.sixtyDays)}</div></div>
            <div className="stat-card" style={{ borderLeftColor: '#dc3545' }}><h3>61-90 Days</h3><div className="value">{formatCurrency(agingBuckets.ninetyDays)}</div></div>
            <div className="stat-card" style={{ borderLeftColor: '#721c24', background: agingBuckets.over90 > 0 ? '#f8d7da' : undefined }}><h3>Over 90</h3><div className="value">{formatCurrency(agingBuckets.over90)}</div></div>
          </div>
          <div className="card">
            <h3>Outstanding Invoices</h3>
            <table className="table">
              <thead>
                <tr><th>Invoice #</th><th>Client</th><th>Payer</th><th>Due Date</th><th>Days Overdue</th><th>Balance</th><th>Actions</th></tr>
              </thead>
              <tbody>
                {invoices.filter(inv => inv.payment_status !== 'paid').sort((a, b) => new Date(a.payment_due_date) - new Date(b.payment_due_date)).map(invoice => {
                  const daysOverdue = Math.floor((new Date() - new Date(invoice.payment_due_date)) / (1000 * 60 * 60 * 24));
                  const balance = parseFloat(invoice.total || 0) - parseFloat(invoice.amount_paid || 0);
                  return (
                    <tr key={invoice.id}>
                      <td><strong>{invoice.invoice_number}</strong></td>
                      <td>{invoice.first_name} {invoice.last_name}</td>
                      <td>{invoice.referral_source_name || 'Private Pay'}</td>
                      <td>{new Date(invoice.payment_due_date).toLocaleDateString()}</td>
                      <td><span className={`badge ${daysOverdue <= 0 ? 'badge-success' : daysOverdue <= 30 ? 'badge-warning' : 'badge-danger'}`}>{daysOverdue <= 0 ? 'Current' : `${daysOverdue} days`}</span></td>
                      <td><strong>{formatCurrency(balance)}</strong></td>
                      <td>
                        <button className="btn btn-sm btn-success" onClick={() => { setPaymentFormData({ ...paymentFormData, invoiceId: invoice.id }); setShowPaymentModal(true); }}>Pay</button>
                        <button className="btn btn-sm btn-secondary" onClick={() => { setAdjustmentFormData({ ...adjustmentFormData, invoiceId: invoice.id }); setShowAdjustmentModal(true); }}>Adjust</button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}

      {/* AUTHORIZATIONS TAB */}
      {activeTab === 'authorizations' && (
        <div className="card">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
            <h3 style={{ margin: 0 }}>Service Authorizations</h3>
            <button className="btn btn-primary" onClick={() => setShowAuthModal(true)}>+ Add Authorization</button>
          </div>
          {authorizations.length === 0 ? (
            <p className="text-muted text-center">No authorizations on file.</p>
          ) : (
            <table className="table">
              <thead>
                <tr><th>Client</th><th>Payer</th><th>Auth #</th><th>Service</th><th>Authorized</th><th>Used</th><th>Remaining</th><th>Period</th><th>Status</th></tr>
              </thead>
              <tbody>
                {authorizations.map(auth => {
                  const usage = getAuthUsage(auth);
                  const isExpired = new Date(auth.end_date) < new Date();
                  const isLow = usage.percentage >= 80;
                  return (
                    <tr key={auth.id} style={{ background: isExpired ? '#f8d7da' : isLow ? '#fff3cd' : undefined }}>
                      <td><strong>{getClientName(auth.client_id)}</strong></td>
                      <td>{getRSName(auth.referral_source_id)}</td>
                      <td>{auth.authorization_number}</td>
                      <td>{auth.service_type}</td>
                      <td>{usage.authorized} {auth.unit_type}</td>
                      <td>{usage.used.toFixed(1)} ({usage.percentage.toFixed(0)}%)</td>
                      <td style={{ color: usage.remaining < 10 ? '#dc3545' : '#28a745', fontWeight: 'bold' }}>{usage.remaining.toFixed(1)}</td>
                      <td>{new Date(auth.start_date).toLocaleDateString()} - {new Date(auth.end_date).toLocaleDateString()}</td>
                      <td>{isExpired ? <span className="badge badge-danger">EXPIRED</span> : isLow ? <span className="badge badge-warning">LOW</span> : <span className="badge badge-success">ACTIVE</span>}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      )}

      {/* PAYMENTS TAB */}
      {activeTab === 'payments' && (
        <div className="card">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
            <h3 style={{ margin: 0 }}>Payment History</h3>
            <button className="btn btn-primary" onClick={() => setShowPaymentModal(true)}>+ Record Payment</button>
          </div>
          {payments.length === 0 ? (
            <p className="text-muted text-center">No payments recorded.</p>
          ) : (
            <table className="table">
              <thead>
                <tr><th>Date</th><th>Invoice #</th><th>Client</th><th>Amount</th><th>Method</th><th>Reference #</th><th>Notes</th></tr>
              </thead>
              <tbody>
                {payments.map(payment => (
                  <tr key={payment.id}>
                    <td>{new Date(payment.payment_date).toLocaleDateString()}</td>
                    <td><strong>{payment.invoice_number}</strong></td>
                    <td>{payment.client_name}</td>
                    <td style={{ color: '#28a745', fontWeight: 'bold' }}>{formatCurrency(payment.amount)}</td>
                    <td><span className="badge badge-info">{payment.payment_method?.toUpperCase()}</span></td>
                    <td>{payment.reference_number || '-'}</td>
                    <td>{payment.notes || '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {/* RATES TAB */}
      {activeTab === 'rates' && (
        <div className="card">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
            <h3 style={{ margin: 0 }}>Payer Contract Rates</h3>
            <button className="btn btn-primary" onClick={() => setShowRateForm(!showRateForm)}>{showRateForm ? 'Cancel' : '+ Add Rate'}</button>
          </div>
          {showRateForm && (
            <form onSubmit={handleAddRate} style={{ marginBottom: '1.5rem', padding: '1rem', background: '#f9f9f9', borderRadius: '8px' }}>
              <div className="form-grid">
                <div className="form-group">
                  <label>Payer *</label>
                  <select value={rateFormData.referralSourceId} onChange={(e) => setRateFormData({ ...rateFormData, referralSourceId: e.target.value })} required>
                    <option value="">Select payer...</option>
                    {referralSources.map(rs => <option key={rs.id} value={rs.id}>{rs.name}</option>)}
                  </select>
                </div>
                <div className="form-group">
                  <label>Care Type *</label>
                  <select value={rateFormData.careTypeId} onChange={(e) => setRateFormData({ ...rateFormData, careTypeId: e.target.value })} required>
                    <option value="">Select care type...</option>
                    {careTypes.map(ct => <option key={ct.id} value={ct.id}>{ct.name}</option>)}
                  </select>
                </div>
                <div className="form-group">
                  <label>Rate Type *</label>
                  <select value={rateFormData.rateType} onChange={(e) => setRateFormData({ ...rateFormData, rateType: e.target.value })}>
                    <option value="hourly">Per Hour</option>
                    <option value="15min">Per 15 Minutes</option>
                  </select>
                </div>
                <div className="form-group">
                  <label>Rate Amount *</label>
                  <input type="number" step="0.01" min="0" value={rateFormData.rateAmount} onChange={(e) => setRateFormData({ ...rateFormData, rateAmount: e.target.value })} required />
                </div>
              </div>
              <div className="form-actions"><button type="submit" className="btn btn-primary">Add Rate</button></div>
            </form>
          )}
          {rates.length === 0 ? (
            <p className="text-muted text-center">No rates configured.</p>
          ) : (
            <table className="table">
              <thead><tr><th>Payer</th><th>Care Type</th><th>Rate</th><th>Type</th><th>Effective</th><th>Actions</th></tr></thead>
              <tbody>
                {rates.map(rate => (
                  <tr key={rate.id}>
                    <td><strong>{rate.referral_source_name}</strong></td>
                    <td>{rate.care_type_name}</td>
                    <td><strong>{formatCurrency(rate.rate_amount)}</strong></td>
                    <td><span className="badge badge-info">{rate.rate_type === 'hourly' ? 'Per Hour' : 'Per 15 Min'}</span></td>
                    <td>{new Date(rate.effective_date).toLocaleDateString()}</td>
                    <td><button className="btn btn-sm btn-danger" onClick={() => handleDeleteRate(rate.id)}>Delete</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {/* PAYMENT MODAL */}
      {showPaymentModal && (
        <div className="modal active">
          <div className="modal-content">
            <div className="modal-header">
              <h2>Record Payment</h2>
              <button className="close-btn" onClick={() => setShowPaymentModal(false)}>×</button>
            </div>
            <form onSubmit={handleRecordPayment}>
              <div className="form-group">
                <label>Invoice *</label>
                <select value={paymentFormData.invoiceId} onChange={(e) => setPaymentFormData({ ...paymentFormData, invoiceId: e.target.value })} required>
                  <option value="">Select invoice...</option>
                  {invoices.filter(i => i.payment_status !== 'paid').map(inv => (
                    <option key={inv.id} value={inv.id}>{inv.invoice_number} - {inv.first_name} {inv.last_name} - {formatCurrency(inv.total)}</option>
                  ))}
                </select>
              </div>
              <div className="form-grid-2">
                <div className="form-group"><label>Amount *</label><input type="number" step="0.01" min="0" value={paymentFormData.amount} onChange={(e) => setPaymentFormData({ ...paymentFormData, amount: e.target.value })} required /></div>
                <div className="form-group"><label>Payment Date *</label><input type="date" value={paymentFormData.paymentDate} onChange={(e) => setPaymentFormData({ ...paymentFormData, paymentDate: e.target.value })} required /></div>
                <div className="form-group">
                  <label>Payment Method</label>
                  <select value={paymentFormData.paymentMethod} onChange={(e) => setPaymentFormData({ ...paymentFormData, paymentMethod: e.target.value })}>
                    <option value="check">Check</option><option value="ach">ACH</option><option value="credit_card">Credit Card</option><option value="cash">Cash</option><option value="eft">EFT</option>
                  </select>
                </div>
                <div className="form-group"><label>Reference #</label><input type="text" value={paymentFormData.referenceNumber} onChange={(e) => setPaymentFormData({ ...paymentFormData, referenceNumber: e.target.value })} placeholder="Check # or transaction ID" /></div>
              </div>
              <div className="form-group"><label>Notes</label><textarea value={paymentFormData.notes} onChange={(e) => setPaymentFormData({ ...paymentFormData, notes: e.target.value })} rows="2" /></div>
              <div className="modal-actions">
                <button type="submit" className="btn btn-primary">Record Payment</button>
                <button type="button" className="btn btn-secondary" onClick={() => setShowPaymentModal(false)}>Cancel</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* AUTHORIZATION MODAL */}
      {showAuthModal && (
        <div className="modal active">
          <div className="modal-content modal-large">
            <div className="modal-header">
              <h2>Add Authorization</h2>
              <button className="close-btn" onClick={() => setShowAuthModal(false)}>×</button>
            </div>
            <form onSubmit={handleAddAuthorization}>
              <div className="form-grid-2">
                <div className="form-group">
                  <label>Client *</label>
                  <select value={authFormData.clientId} onChange={(e) => setAuthFormData({ ...authFormData, clientId: e.target.value })} required>
                    <option value="">Select client...</option>
                    {clients.map(c => <option key={c.id} value={c.id}>{c.first_name} {c.last_name}</option>)}
                  </select>
                </div>
                <div className="form-group">
                  <label>Payer *</label>
                  <select value={authFormData.referralSourceId} onChange={(e) => setAuthFormData({ ...authFormData, referralSourceId: e.target.value })} required>
                    <option value="">Select payer...</option>
                    {referralSources.map(rs => <option key={rs.id} value={rs.id}>{rs.name}</option>)}
                  </select>
                </div>
                <div className="form-group"><label>Authorization # *</label><input type="text" value={authFormData.authorizationNumber} onChange={(e) => setAuthFormData({ ...authFormData, authorizationNumber: e.target.value })} required /></div>
                <div className="form-group"><label>Service Type</label><input type="text" value={authFormData.serviceType} onChange={(e) => setAuthFormData({ ...authFormData, serviceType: e.target.value })} placeholder="e.g., Personal Care" /></div>
                <div className="form-group"><label>Authorized Units *</label><input type="number" step="0.25" min="0" value={authFormData.authorizedUnits} onChange={(e) => setAuthFormData({ ...authFormData, authorizedUnits: e.target.value })} required /></div>
                <div className="form-group">
                  <label>Unit Type</label>
                  <select value={authFormData.unitType} onChange={(e) => setAuthFormData({ ...authFormData, unitType: e.target.value })}>
                    <option value="hours">Hours</option><option value="visits">Visits</option><option value="days">Days</option>
                  </select>
                </div>
                <div className="form-group"><label>Start Date *</label><input type="date" value={authFormData.startDate} onChange={(e) => setAuthFormData({ ...authFormData, startDate: e.target.value })} required /></div>
                <div className="form-group"><label>End Date *</label><input type="date" value={authFormData.endDate} onChange={(e) => setAuthFormData({ ...authFormData, endDate: e.target.value })} required /></div>
              </div>
              <div className="form-group"><label>Notes</label><textarea value={authFormData.notes} onChange={(e) => setAuthFormData({ ...authFormData, notes: e.target.value })} rows="2" /></div>
              <div className="modal-actions">
                <button type="submit" className="btn btn-primary">Add Authorization</button>
                <button type="button" className="btn btn-secondary" onClick={() => setShowAuthModal(false)}>Cancel</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ADJUSTMENT MODAL */}
      {showAdjustmentModal && (
        <div className="modal active">
          <div className="modal-content">
            <div className="modal-header">
              <h2>Record Adjustment</h2>
              <button className="close-btn" onClick={() => setShowAdjustmentModal(false)}>×</button>
            </div>
            <form onSubmit={handleRecordAdjustment}>
              <div className="form-group">
                <label>Invoice *</label>
                <select value={adjustmentFormData.invoiceId} onChange={(e) => setAdjustmentFormData({ ...adjustmentFormData, invoiceId: e.target.value })} required>
                  <option value="">Select invoice...</option>
                  {invoices.filter(i => i.payment_status !== 'paid').map(inv => <option key={inv.id} value={inv.id}>{inv.invoice_number} - {formatCurrency(inv.total)}</option>)}
                </select>
              </div>
              <div className="form-grid-2">
                <div className="form-group">
                  <label>Type *</label>
                  <select value={adjustmentFormData.type} onChange={(e) => setAdjustmentFormData({ ...adjustmentFormData, type: e.target.value })}>
                    <option value="write_off">Write Off</option><option value="adjustment">Adjustment</option><option value="discount">Discount</option><option value="refund">Refund</option>
                  </select>
                </div>
                <div className="form-group"><label>Amount *</label><input type="number" step="0.01" min="0" value={adjustmentFormData.amount} onChange={(e) => setAdjustmentFormData({ ...adjustmentFormData, amount: e.target.value })} required /></div>
              </div>
              <div className="form-group"><label>Reason *</label><input type="text" value={adjustmentFormData.reason} onChange={(e) => setAdjustmentFormData({ ...adjustmentFormData, reason: e.target.value })} placeholder="e.g., Uncollectable" required /></div>
              <div className="form-group"><label>Notes</label><textarea value={adjustmentFormData.notes} onChange={(e) => setAdjustmentFormData({ ...adjustmentFormData, notes: e.target.value })} rows="2" /></div>
              <div className="modal-actions">
                <button type="submit" className="btn btn-primary">Record Adjustment</button>
                <button type="button" className="btn btn-secondary" onClick={() => setShowAdjustmentModal(false)}>Cancel</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* INVOICE DETAIL MODAL */}
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
                <p style={{ margin: 0 }}><strong>{selectedInvoice.first_name} {selectedInvoice.last_name}</strong><br />{selectedInvoice.referral_source_name || <span className="badge badge-info">Private Pay</span>}</p>
              </div>
              <div className="card" style={{ margin: 0 }}>
                <h4 style={{ margin: '0 0 0.5rem 0' }}>Details</h4>
                <p style={{ margin: 0 }}>
                  <strong>Period:</strong> {new Date(selectedInvoice.billing_period_start).toLocaleDateString()} - {new Date(selectedInvoice.billing_period_end).toLocaleDateString()}<br />
                  <strong>Due:</strong> {new Date(selectedInvoice.payment_due_date).toLocaleDateString()}<br />
                  <strong>Status:</strong> <span className={`badge ${selectedInvoice.payment_status === 'paid' ? 'badge-success' : 'badge-warning'}`}>{selectedInvoice.payment_status?.toUpperCase()}</span>
                </p>
              </div>
            </div>
            {selectedInvoice.line_items?.length > 0 && (
              <table className="table">
                <thead><tr><th>Date</th><th>Caregiver</th><th>Description</th><th>Hours</th><th>Rate</th><th>Amount</th></tr></thead>
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
                  <tr><td colSpan="5" style={{ textAlign: 'right' }}><strong>Total:</strong></td><td><strong style={{ fontSize: '1.2rem' }}>{formatCurrency(selectedInvoice.total)}</strong></td></tr>
                  {parseFloat(selectedInvoice.amount_paid || 0) > 0 && (
                    <>
                      <tr><td colSpan="5" style={{ textAlign: 'right' }}>Paid:</td><td style={{ color: '#28a745' }}>{formatCurrency(selectedInvoice.amount_paid)}</td></tr>
                      <tr><td colSpan="5" style={{ textAlign: 'right' }}><strong>Balance:</strong></td><td style={{ color: '#dc3545' }}><strong>{formatCurrency(parseFloat(selectedInvoice.total || 0) - parseFloat(selectedInvoice.amount_paid || 0))}</strong></td></tr>
                    </>
                  )}
                </tfoot>
              </table>
            )}
            <div className="modal-actions">
              {selectedInvoice.payment_status !== 'paid' && (
                <>
                  <button className="btn btn-success" onClick={() => { setPaymentFormData({ ...paymentFormData, invoiceId: selectedInvoice.id }); setShowInvoiceModal(false); setShowPaymentModal(true); }}>Record Payment</button>
                  <button className="btn btn-warning" onClick={() => handleMarkPaid(selectedInvoice.id)}>Mark Paid</button>
                </>
              )}
              <button className="btn btn-primary" onClick={() => window.print()}>🖨️ Print</button>
              <button className="btn btn-secondary" onClick={() => setShowInvoiceModal(false)}>Close</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default BillingDashboard;
