// src/components/admin/BillingDashboard.jsx
// Complete billing system: Invoicing, A/R Aging, Authorizations, Claims, Payments
import React, { useState, useEffect } from 'react';
import { API_BASE_URL } from '../../config';

const BillingDashboard = ({ token }) => {
  const [activeTab, setActiveTab] = useState('invoices');
  const [invoices, setInvoices] = useState([]);
  const [clients, setClients] = useState([]);
  const [caregivers, setCaregivers] = useState([]);
  const [referralSources, setReferralSources] = useState([]);
  const [careTypes, setCareTypes] = useState([]);
  const [rates, setRates] = useState([]);
  const [authorizations, setAuthorizations] = useState([]);
  const [payments, setPayments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showGenerateForm, setShowGenerateForm] = useState(false);
  const [showManualForm, setShowManualForm] = useState(false);
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

  const [manualFormData, setManualFormData] = useState({
    clientId: '',
    billingPeriodStart: '',
    billingPeriodEnd: '',
    notes: ''
  });

  const [detailedMode, setDetailedMode] = useState(true); // Default to detailed (best practice)
  
  const [manualLineItems, setManualLineItems] = useState([
    { caregiverId: '', caregiverName: '', description: 'Home Care Services', hours: '', rate: '', serviceDate: '', startTime: '', endTime: '' }
  ]);

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    try {
      const [invoiceRes, clientRes, rsRes, ctRes, ratesRes, caregiversRes] = await Promise.all([
        fetch(`${API_BASE_URL}/api/invoices`, { headers: { 'Authorization': `Bearer ${token}` } }),
        fetch(`${API_BASE_URL}/api/clients`, { headers: { 'Authorization': `Bearer ${token}` } }),
        fetch(`${API_BASE_URL}/api/referral-sources`, { headers: { 'Authorization': `Bearer ${token}` } }),
        fetch(`${API_BASE_URL}/api/care-types`, { headers: { 'Authorization': `Bearer ${token}` } }),
        fetch(`${API_BASE_URL}/api/referral-source-rates`, { headers: { 'Authorization': `Bearer ${token}` } }),
        fetch(`${API_BASE_URL}/api/users?role=caregiver`, { headers: { 'Authorization': `Bearer ${token}` } })
      ]);

      setInvoices(await invoiceRes.json());
      setClients(await clientRes.json());
      setReferralSources(await rsRes.json());
      setCareTypes(await ctRes.json());
      setRates(await ratesRes.json());
      
      try {
        const caregiversData = await caregiversRes.json();
        setCaregivers(Array.isArray(caregiversData) ? caregiversData : []);
      } catch (e) { setCaregivers([]); }

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

  const handleManualInvoice = async (e) => {
    e.preventDefault();
    
    // Validate line items
    const validLineItems = manualLineItems.filter(item => 
      parseFloat(item.hours) > 0 && parseFloat(item.rate) > 0
    );
    
    if (validLineItems.length === 0) {
      alert('Please add at least one line item with hours and rate');
      return;
    }

    // In detailed mode, require date for each line item
    if (detailedMode) {
      const missingDates = validLineItems.some(item => !item.serviceDate);
      if (missingDates) {
        alert('Please enter a date for each line item in detailed mode');
        return;
      }
    }

    try {
      const response = await fetch(`${API_BASE_URL}/api/invoices/manual`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({
          ...manualFormData,
          detailedMode,
          lineItems: validLineItems
        })
      });
      if (!response.ok) {
        const err = await response.json();
        throw new Error(err.error || 'Failed to create invoice');
      }
      const invoice = await response.json();
      setManualFormData({ clientId: '', billingPeriodStart: '', billingPeriodEnd: '', notes: '' });
      setManualLineItems([{ caregiverId: '', caregiverName: '', description: 'Home Care Services', hours: '', rate: '', serviceDate: '', startTime: '', endTime: '' }]);
      setShowManualForm(false);
      loadData();
      setSelectedInvoice(invoice);
      setShowInvoiceModal(true);
      setMessage('✓ Manual invoice created successfully');
      setTimeout(() => setMessage(''), 3000);
    } catch (error) {
      alert('Failed to create invoice: ' + error.message);
    }
  };

  const addManualLineItem = () => {
    setManualLineItems([...manualLineItems, { caregiverId: '', caregiverName: '', description: 'Home Care Services', hours: '', rate: '', serviceDate: '', startTime: '', endTime: '' }]);
  };

  const removeManualLineItem = (index) => {
    if (manualLineItems.length > 1) {
      setManualLineItems(manualLineItems.filter((_, i) => i !== index));
    }
  };

  const updateManualLineItem = (index, field, value) => {
    const updated = [...manualLineItems];
    updated[index][field] = value;
    
    // If selecting a caregiver, also store their name
    if (field === 'caregiverId' && value) {
      const caregiver = caregivers.find(c => c.id === value);
      if (caregiver) {
        updated[index].caregiverName = `${caregiver.first_name} ${caregiver.last_name}`;
      }
    }
    
    setManualLineItems(updated);
  };

  const calculateManualTotal = () => {
    return manualLineItems.reduce((sum, item) => {
      return sum + (parseFloat(item.hours || 0) * parseFloat(item.rate || 0));
    }, 0);
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
const handleDeleteInvoice = async (invoiceId, invoiceNumber) => {
  if (!window.confirm(`Are you sure you want to delete invoice ${invoiceNumber}? This cannot be undone.`)) {
    return;
  }
  
  try {
    const response = await fetch(`${API_BASE_URL}/api/invoices/${invoiceId}`, {
      method: 'DELETE',
      headers: { 'Authorization': `Bearer ${token}` }
    });
    
    if (!response.ok) {
      const err = await response.json();
      throw new Error(err.error || 'Failed to delete invoice');
    }
    
    setMessage(`✓ Invoice ${invoiceNumber} deleted`);
    setTimeout(() => setMessage(''), 3000);
    loadData();
  } catch (error) {
    alert('Failed to delete invoice: ' + error.message);
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
          <button className="btn btn-primary" onClick={() => setShowManualForm(!showManualForm)}>✏️ Manual Invoice</button>
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

      {/* Manual Invoice Form */}
      {showManualForm && (
        <div className="card card-form">
          <h3>✏️ Manual Invoice Entry</h3>
          <p className="text-muted">Create an invoice with manually entered line items (no time entries required).</p>
          <form onSubmit={handleManualInvoice}>
            <div className="form-grid">
              <div className="form-group">
                <label>Client *</label>
                <select value={manualFormData.clientId} onChange={(e) => setManualFormData({ ...manualFormData, clientId: e.target.value })} required>
                  <option value="">Select client...</option>
                  {clients.map(client => <option key={client.id} value={client.id}>{client.first_name} {client.last_name}</option>)}
                </select>
              </div>
              <div className="form-group">
                <label>Billing Period Start *</label>
                <input type="date" value={manualFormData.billingPeriodStart} onChange={(e) => setManualFormData({ ...manualFormData, billingPeriodStart: e.target.value })} required />
              </div>
              <div className="form-group">
                <label>Billing Period End *</label>
                <input type="date" value={manualFormData.billingPeriodEnd} onChange={(e) => setManualFormData({ ...manualFormData, billingPeriodEnd: e.target.value })} required />
              </div>
            </div>
            
            {/* Mode Toggle */}
            <div style={{ 
              display: 'flex', 
              gap: '1rem', 
              alignItems: 'center', 
              marginTop: '1.5rem', 
              marginBottom: '1rem',
              padding: '0.75rem',
              background: '#f8f9fa',
              borderRadius: '8px'
            }}>
              <label style={{ fontWeight: '600', margin: 0 }}>Invoice Format:</label>
              <button 
                type="button" 
                className={`btn ${!detailedMode ? 'btn-primary' : 'btn-secondary'}`}
                onClick={() => setDetailedMode(false)}
                style={{ padding: '0.4rem 1rem' }}
              >
                Summary (Total Hours)
              </button>
              <button 
                type="button" 
                className={`btn ${detailedMode ? 'btn-primary' : 'btn-secondary'}`}
                onClick={() => setDetailedMode(true)}
                style={{ padding: '0.4rem 1rem' }}
              >
                Detailed (Daily Breakdown) ✓ Recommended
              </button>
            </div>
            
            <h4 style={{ marginTop: '1rem', marginBottom: '1rem' }}>Line Items</h4>
            <div style={{ overflowX: 'auto' }}>
              <table className="table" style={{ marginBottom: '1rem', minWidth: detailedMode ? '900px' : '600px' }}>
                <thead>
                  <tr>
                    {detailedMode && <th style={{ width: '120px' }}>Date *</th>}
                    <th>Caregiver</th>
                    <th>Description</th>
                    {detailedMode && <th style={{ width: '100px' }}>Start Time</th>}
                    {detailedMode && <th style={{ width: '100px' }}>End Time</th>}
                    <th style={{ width: '80px' }}>Hours *</th>
                    <th style={{ width: '80px' }}>Rate *</th>
                    <th style={{ width: '100px' }}>Amount</th>
                    <th style={{ width: '40px' }}></th>
                  </tr>
                </thead>
                <tbody>
                  {manualLineItems.map((item, index) => (
                    <tr key={index}>
                      {detailedMode && (
                        <td>
                          <input 
                            type="date" 
                            value={item.serviceDate} 
                            onChange={(e) => updateManualLineItem(index, 'serviceDate', e.target.value)}
                            style={{ width: '100%' }}
                            required={detailedMode}
                          />
                        </td>
                      )}
                      <td>
                        <select 
                          value={item.caregiverId} 
                          onChange={(e) => updateManualLineItem(index, 'caregiverId', e.target.value)}
                          style={{ minWidth: '130px' }}
                        >
                          <option value="">Select...</option>
                          {caregivers.map(cg => (
                            <option key={cg.id} value={cg.id}>{cg.first_name} {cg.last_name}</option>
                          ))}
                        </select>
                      </td>
                      <td>
                        <input 
                          type="text" 
                          value={item.description} 
                          onChange={(e) => updateManualLineItem(index, 'description', e.target.value)}
                          placeholder="Home Care Services"
                          style={{ minWidth: '120px' }}
                        />
                      </td>
                      {detailedMode && (
                        <td>
                          <input 
                            type="time" 
                            value={item.startTime} 
                            onChange={(e) => updateManualLineItem(index, 'startTime', e.target.value)}
                            style={{ width: '100%' }}
                          />
                        </td>
                      )}
                      {detailedMode && (
                        <td>
                          <input 
                            type="time" 
                            value={item.endTime} 
                            onChange={(e) => updateManualLineItem(index, 'endTime', e.target.value)}
                            style={{ width: '100%' }}
                          />
                        </td>
                      )}
                      <td>
                        <input 
                          type="number" 
                          step="0.25" 
                          min="0" 
                          value={item.hours} 
                          onChange={(e) => updateManualLineItem(index, 'hours', e.target.value)}
                          placeholder="0.00"
                          style={{ width: '70px' }}
                          required
                        />
                      </td>
                      <td>
                        <input 
                          type="number" 
                          step="0.01" 
                          min="0" 
                          value={item.rate} 
                          onChange={(e) => updateManualLineItem(index, 'rate', e.target.value)}
                          placeholder="0.00"
                          style={{ width: '70px' }}
                          required
                        />
                      </td>
                      <td>
                        <strong>{formatCurrency((parseFloat(item.hours) || 0) * (parseFloat(item.rate) || 0))}</strong>
                      </td>
                      <td>
                        {manualLineItems.length > 1 && (
                          <button type="button" className="btn btn-sm btn-danger" onClick={() => removeManualLineItem(index)}>✕</button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr>
                    <td colSpan={detailedMode ? 7 : 4} style={{ textAlign: 'right' }}><strong>Total:</strong></td>
                    <td colSpan="2"><strong style={{ fontSize: '1.2rem' }}>{formatCurrency(calculateManualTotal())}</strong></td>
                  </tr>
                </tfoot>
              </table>
            </div>
            
            <button type="button" className="btn btn-secondary" onClick={addManualLineItem} style={{ marginBottom: '1rem' }}>
              + Add Line Item
            </button>

            <div className="form-group">
              <label>Notes</label>
              <textarea 
                value={manualFormData.notes} 
                onChange={(e) => setManualFormData({ ...manualFormData, notes: e.target.value })}
                rows="2"
                placeholder="Optional notes..."
              />
            </div>
            
            <div className="form-actions">
              <button type="submit" className="btn btn-primary">Create Invoice</button>
              <button type="button" className="btn btn-secondary" onClick={() => { setShowManualForm(false); setManualLineItems([{ caregiverId: '', caregiverName: '', description: 'Home Care Services', hours: '', rate: '', serviceDate: '', startTime: '', endTime: '' }]); }}>Cancel</button>
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
  <button className="btn btn-sm btn-danger" onClick={() => handleDeleteInvoice(invoice.id, invoice.invoice_number)}>🗑️</button>
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

      {/* INVOICE DETAIL MODAL - Professional Print Layout */}
      {showInvoiceModal && selectedInvoice && (
        <div className="modal active">
          <div className="modal-content modal-large" style={{ maxWidth: '900px' }}>
            {/* Screen-only header */}
            <div className="modal-header no-print">
              <h2>Invoice {selectedInvoice.invoice_number}</h2>
              <button className="close-btn" onClick={() => setShowInvoiceModal(false)}>×</button>
            </div>
            
            {/* Printable Invoice */}
            <div id="printable-invoice" className="invoice-print-container">
              <style>{`
                @media print {
                  @page {
                    margin: 15mm;
                    size: letter;
                  }
                  
                  /* Hide everything first */
                  body * {
                    visibility: hidden;
                  }
                  
                  /* Show only the invoice */
                  #printable-invoice,
                  #printable-invoice * {
                    visibility: visible;
                  }
                  
                  /* Reset containers */
                  html, body {
                    height: auto !important;
                    overflow: visible !important;
                  }
                  
                  #root, .main-content, .container {
                    overflow: visible !important;
                    height: auto !important;
                  }
                  
                  /* Hide sidebar completely */
                  .sidebar {
                    display: none !important;
                  }
                  
                  .main-content {
                    margin-left: 0 !important;
                    width: 100% !important;
                  }
                  
                  /* Reset modal to flow normally */
                  .modal, .modal.active {
                    position: absolute !important;
                    left: 0 !important;
                    top: 0 !important;
                    width: 100% !important;
                    height: auto !important;
                    overflow: visible !important;
                    background: none !important;
                    padding: 0 !important;
                    display: block !important;
                  }
                  
                  .modal-content, .modal-large {
                    position: relative !important;
                    overflow: visible !important;
                    max-height: none !important;
                    height: auto !important;
                    box-shadow: none !important;
                    padding: 0 !important;
                    margin: 0 !important;
                    max-width: 100% !important;
                    width: 100% !important;
                  }
                  
                  /* Invoice container - NO absolute positioning */
                  #printable-invoice {
                    position: relative !important;
                    width: 100% !important;
                    padding: 0 !important;
                    margin: 0 !important;
                    background: white !important;
                  }
                  
                  .invoice-print-container {
                    padding: 0 !important;
                  }
                  
                  /* Hide non-print elements */
                  .no-print {
                    display: none !important;
                    visibility: hidden !important;
                  }
                  
                  /* Prevent page breaks inside key sections */
                  .invoice-header {
                    page-break-inside: avoid;
                    break-inside: avoid;
                  }
                  
                  .invoice-title-section {
                    page-break-inside: avoid;
                    break-inside: avoid;
                  }
                  
                  .invoice-parties {
                    page-break-inside: avoid;
                    break-inside: avoid;
                  }
                  
                  .invoice-totals {
                    page-break-inside: avoid;
                    break-inside: avoid;
                  }
                  
                  .invoice-footer {
                    page-break-inside: avoid;
                    break-inside: avoid;
                  }
                  
                  .invoice-notes {
                    page-break-inside: avoid;
                    break-inside: avoid;
                  }
                  
                  /* Table handling */
                  .invoice-table {
                    page-break-inside: auto;
                  }
                  
                  .invoice-table tr {
                    page-break-inside: avoid;
                    break-inside: avoid;
                  }
                }
                .invoice-print-container {
                  font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
                  color: #1a1a2e;
                  background: white;
                  padding: 40px;
                  line-height: 1.6;
                }
                .invoice-header {
                  display: flex;
                  justify-content: space-between;
                  align-items: flex-start;
                  margin-bottom: 40px;
                  padding-bottom: 30px;
                  border-bottom: 3px solid #c9a227;
                }
                .invoice-logo img {
                  max-height: 100px;
                  width: auto;
                }
                .invoice-company {
                  text-align: right;
                  color: #555;
                  font-size: 14px;
                }
                .invoice-company h1 {
                  color: #c9a227;
                  font-size: 28px;
                  margin: 0 0 8px 0;
                  font-weight: 600;
                  letter-spacing: -0.5px;
                }
                .invoice-title-section {
                  display: flex;
                  justify-content: space-between;
                  margin-bottom: 40px;
                }
                .invoice-title {
                  font-size: 42px;
                  font-weight: 700;
                  color: #1a1a2e;
                  letter-spacing: -1px;
                }
                .invoice-meta {
                  text-align: right;
                }
                .invoice-meta-item {
                  margin-bottom: 8px;
                }
                .invoice-meta-label {
                  color: #888;
                  font-size: 12px;
                  text-transform: uppercase;
                  letter-spacing: 1px;
                }
                .invoice-meta-value {
                  font-size: 16px;
                  font-weight: 600;
                  color: #1a1a2e;
                }
                .invoice-parties {
                  display: grid;
                  grid-template-columns: 1fr 1fr;
                  gap: 60px;
                  margin-bottom: 40px;
                }
                .invoice-party h3 {
                  font-size: 11px;
                  text-transform: uppercase;
                  letter-spacing: 2px;
                  color: #888;
                  margin: 0 0 12px 0;
                  font-weight: 600;
                }
                .invoice-party-name {
                  font-size: 18px;
                  font-weight: 600;
                  color: #1a1a2e;
                  margin-bottom: 4px;
                }
                .invoice-party-detail {
                  color: #555;
                  font-size: 14px;
                  line-height: 1.5;
                }
                .invoice-table {
                  width: 100%;
                  border-collapse: collapse;
                  margin-bottom: 30px;
                }
                .invoice-table th {
                  background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%);
                  color: white;
                  padding: 14px 16px;
                  text-align: left;
                  font-size: 11px;
                  text-transform: uppercase;
                  letter-spacing: 1px;
                  font-weight: 600;
                }
                .invoice-table th:last-child {
                  text-align: right;
                }
                .invoice-table td {
                  padding: 16px;
                  border-bottom: 1px solid #eee;
                  font-size: 14px;
                }
                .invoice-table td:last-child {
                  text-align: right;
                  font-weight: 600;
                }
                .invoice-table tbody tr:hover {
                  background: #fafafa;
                }
                .invoice-table tbody tr:last-child td {
                  border-bottom: 2px solid #1a1a2e;
                }
                .invoice-totals {
                  display: flex;
                  justify-content: flex-end;
                  margin-bottom: 40px;
                }
                .invoice-totals-table {
                  width: 300px;
                }
                .invoice-totals-row {
                  display: flex;
                  justify-content: space-between;
                  padding: 10px 0;
                  border-bottom: 1px solid #eee;
                }
                .invoice-totals-row.total {
                  border-bottom: none;
                  border-top: 2px solid #1a1a2e;
                  margin-top: 10px;
                  padding-top: 15px;
                }
                .invoice-totals-label {
                  color: #555;
                  font-size: 14px;
                }
                .invoice-totals-value {
                  font-weight: 600;
                  font-size: 14px;
                }
                .invoice-totals-row.total .invoice-totals-label,
                .invoice-totals-row.total .invoice-totals-value {
                  font-size: 20px;
                  font-weight: 700;
                  color: #1a1a2e;
                }
                .invoice-status {
                  display: inline-block;
                  padding: 6px 16px;
                  border-radius: 20px;
                  font-size: 12px;
                  font-weight: 600;
                  text-transform: uppercase;
                  letter-spacing: 1px;
                }
                .invoice-status.paid {
                  background: #d4edda;
                  color: #155724;
                }
                .invoice-status.pending {
                  background: #fff3cd;
                  color: #856404;
                }
                .invoice-status.partial {
                  background: #cce5ff;
                  color: #004085;
                }
                .invoice-footer {
                  margin-top: 50px;
                  padding-top: 30px;
                  border-top: 1px solid #eee;
                  text-align: center;
                  color: #888;
                  font-size: 12px;
                }
                .invoice-footer-brand {
                  color: #c9a227;
                  font-weight: 600;
                  font-size: 14px;
                  margin-bottom: 8px;
                }
                .invoice-notes {
                  background: #f8f9fa;
                  padding: 20px;
                  border-radius: 8px;
                  margin-bottom: 30px;
                  border-left: 4px solid #c9a227;
                }
                .invoice-notes h4 {
                  margin: 0 0 8px 0;
                  font-size: 12px;
                  text-transform: uppercase;
                  letter-spacing: 1px;
                  color: #888;
                }
                .invoice-notes p {
                  margin: 0;
                  color: #555;
                  font-size: 14px;
                }
              `}</style>
              
              {/* Invoice Header with Logo */}
              <div className="invoice-header">
                <div className="invoice-logo">
                  <img src="/logo.png" alt="Chippewa Valley Home Care" onError={(e) => { e.target.style.display = 'none'; e.target.nextSibling.style.display = 'block'; }} />
                  <div style={{ display: 'none' }}>
                    <h1 style={{ color: '#c9a227', fontSize: '24px', margin: 0 }}>Chippewa Valley</h1>
                    <p style={{ color: '#4ecdc4', fontStyle: 'italic', margin: 0 }}>Home Care</p>
                  </div>
                </div>
                <div className="invoice-company">
                  <h1>Chippewa Valley Home Care</h1>
                  <div>Eau Claire, Wisconsin</div>
                  <div>info@chippewavalleyhomecare.com</div>
                  <div>(715) 555-0100</div>
                </div>
              </div>

              {/* Invoice Title & Meta */}
              <div className="invoice-title-section">
                <div>
                  <div className="invoice-title">INVOICE</div>
                  <span className={`invoice-status ${selectedInvoice.payment_status}`}>
                    {selectedInvoice.payment_status}
                  </span>
                </div>
                <div className="invoice-meta">
                  <div className="invoice-meta-item">
                    <div className="invoice-meta-label">Invoice Number</div>
                    <div className="invoice-meta-value">{selectedInvoice.invoice_number}</div>
                  </div>
                  <div className="invoice-meta-item">
                    <div className="invoice-meta-label">Invoice Date</div>
                    <div className="invoice-meta-value">{new Date(selectedInvoice.created_at).toLocaleDateString()}</div>
                  </div>
                  <div className="invoice-meta-item">
                    <div className="invoice-meta-label">Due Date</div>
                    <div className="invoice-meta-value">{new Date(selectedInvoice.payment_due_date).toLocaleDateString()}</div>
                  </div>
                </div>
              </div>

              {/* Bill To / Service Period */}
              <div className="invoice-parties">
                <div className="invoice-party">
                  <h3>Bill To</h3>
                  <div className="invoice-party-name">{selectedInvoice.first_name} {selectedInvoice.last_name}</div>
                  <div className="invoice-party-detail">
                    {selectedInvoice.address && <>{selectedInvoice.address}<br /></>}
                    {selectedInvoice.city && <>{selectedInvoice.city}, {selectedInvoice.state} {selectedInvoice.zip}<br /></>}
                    {selectedInvoice.email && <>{selectedInvoice.email}<br /></>}
                    {selectedInvoice.phone && <>{selectedInvoice.phone}</>}
                  </div>
                </div>
                <div className="invoice-party">
                  <h3>Service Period</h3>
                  <div className="invoice-party-name">
                    {new Date(selectedInvoice.billing_period_start).toLocaleDateString()} — {new Date(selectedInvoice.billing_period_end).toLocaleDateString()}
                  </div>
                  <div className="invoice-party-detail">
                    {selectedInvoice.referral_source_name ? (
                      <>Payer: {selectedInvoice.referral_source_name}</>
                    ) : (
                      <>Payment Type: Private Pay</>
                    )}
                  </div>
                </div>
              </div>

              {/* Line Items Table */}
              {selectedInvoice.line_items?.length > 0 && (
                <table className="invoice-table">
                  <thead>
                    <tr>
                      <th style={{ width: '15%' }}>Date</th>
                      <th style={{ width: '25%' }}>Caregiver</th>
                      <th style={{ width: '30%' }}>Description</th>
                      <th style={{ width: '10%', textAlign: 'center' }}>Hours</th>
                      <th style={{ width: '10%', textAlign: 'right' }}>Rate</th>
                      <th style={{ width: '10%', textAlign: 'right' }}>Amount</th>
                    </tr>
                  </thead>
                  <tbody>
                    {selectedInvoice.line_items.map((item, idx) => (
                      <tr key={idx}>
                        <td>{item.service_date ? new Date(item.service_date).toLocaleDateString() : '—'}</td>
                        <td>{item.caregiver_first_name} {item.caregiver_last_name}</td>
                        <td>{item.description}</td>
                        <td style={{ textAlign: 'center' }}>{parseFloat(item.hours).toFixed(2)}</td>
                        <td style={{ textAlign: 'right' }}>{formatCurrency(item.rate)}</td>
                        <td style={{ textAlign: 'right' }}>{formatCurrency(item.amount)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}

              {/* Totals */}
              <div className="invoice-totals">
                <div className="invoice-totals-table">
                  <div className="invoice-totals-row">
                    <span className="invoice-totals-label">Subtotal</span>
                    <span className="invoice-totals-value">{formatCurrency(selectedInvoice.subtotal || selectedInvoice.total)}</span>
                  </div>
                  <div className="invoice-totals-row">
                    <span className="invoice-totals-label">Total Hours</span>
                    <span className="invoice-totals-value">{selectedInvoice.line_items?.reduce((sum, item) => sum + parseFloat(item.hours || 0), 0).toFixed(2) || '0.00'}</span>
                  </div>
                  {parseFloat(selectedInvoice.amount_paid || 0) > 0 && (
                    <div className="invoice-totals-row">
                      <span className="invoice-totals-label">Amount Paid</span>
                      <span className="invoice-totals-value" style={{ color: '#28a745' }}>-{formatCurrency(selectedInvoice.amount_paid)}</span>
                    </div>
                  )}
                  <div className="invoice-totals-row total">
                    <span className="invoice-totals-label">{parseFloat(selectedInvoice.amount_paid || 0) > 0 ? 'Balance Due' : 'Total Due'}</span>
                    <span className="invoice-totals-value">{formatCurrency(parseFloat(selectedInvoice.total || 0) - parseFloat(selectedInvoice.amount_paid || 0))}</span>
                  </div>
                </div>
              </div>

              {/* Notes */}
              {selectedInvoice.notes && (
                <div className="invoice-notes">
                  <h4>Notes</h4>
                  <p>{selectedInvoice.notes}</p>
                </div>
              )}

              {/* Footer */}
              <div className="invoice-footer">
                <div className="invoice-footer-brand">Chippewa Valley Home Care</div>
                <div>Thank you for choosing us for your home care needs.</div>
                <div style={{ marginTop: '8px' }}>Payment is due within 30 days of invoice date. Please include invoice number with payment.</div>
              </div>
            </div>

            {/* Action Buttons (screen only) */}
            <div className="modal-actions no-print" style={{ marginTop: '20px', paddingTop: '20px', borderTop: '1px solid #eee' }}>
              {selectedInvoice.payment_status !== 'paid' && (
                <>
                  <button className="btn btn-success" onClick={() => { setPaymentFormData({ ...paymentFormData, invoiceId: selectedInvoice.id }); setShowInvoiceModal(false); setShowPaymentModal(true); }}>💳 Record Payment</button>
                  <button className="btn btn-warning" onClick={() => handleMarkPaid(selectedInvoice.id)}>✓ Mark Paid</button>
                </>
              )}
              <button className="btn btn-primary" onClick={() => window.print()}>🖨️ Print Invoice</button>
              <button className="btn btn-secondary" onClick={() => setShowInvoiceModal(false)}>Close</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default BillingDashboard;
