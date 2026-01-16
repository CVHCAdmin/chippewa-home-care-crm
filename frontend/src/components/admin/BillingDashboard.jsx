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
        <div className="card" style={{ maxWidth: 'none' }}>
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
              gap: '0.5rem', 
              alignItems: 'center', 
              marginTop: '1.5rem', 
              marginBottom: '1rem',
              padding: '0.75rem',
              background: '#f8f9fa',
              borderRadius: '8px',
              flexWrap: 'wrap'
            }}>
              <label style={{ fontWeight: '600', margin: 0, marginRight: '0.5rem' }}>Format:</label>
              <button 
                type="button" 
                className={`btn btn-sm ${!detailedMode ? 'btn-primary' : 'btn-secondary'}`}
                onClick={() => setDetailedMode(false)}
              >
                Summary
              </button>
              <button 
                type="button" 
                className={`btn btn-sm ${detailedMode ? 'btn-primary' : 'btn-secondary'}`}
                onClick={() => setDetailedMode(true)}
              >
                Detailed ✓
              </button>
            </div>
            
            <h4 style={{ marginTop: '1rem', marginBottom: '1rem' }}>Line Items</h4>
            
            {/* Card-based line items for better responsiveness */}
            {manualLineItems.map((item, index) => (
              <div key={index} style={{ 
                border: '1px solid #ddd', 
                borderRadius: '8px', 
                padding: '1rem', 
                marginBottom: '0.75rem',
                background: '#fafafa'
              }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
                  <strong style={{ color: '#666' }}>Line Item {index + 1}</strong>
                  {manualLineItems.length > 1 && (
                    <button type="button" className="btn btn-sm btn-danger" onClick={() => removeManualLineItem(index)}>✕ Remove</button>
                  )}
                </div>
                
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: '0.75rem', alignItems: 'end' }}>
                  {detailedMode && (
                    <div className="form-group" style={{ margin: 0 }}>
                      <label style={{ fontSize: '0.8rem' }}>Date *</label>
                      <input 
                        type="date" 
                        value={item.serviceDate} 
                        onChange={(e) => updateManualLineItem(index, 'serviceDate', e.target.value)}
                        required={detailedMode}
                      />
                    </div>
                  )}
                  
                  <div className="form-group" style={{ margin: 0 }}>
                    <label style={{ fontSize: '0.8rem' }}>Caregiver</label>
                    <select 
                      value={item.caregiverId} 
                      onChange={(e) => updateManualLineItem(index, 'caregiverId', e.target.value)}
                    >
                      <option value="">Select...</option>
                      {caregivers.map(cg => (
                        <option key={cg.id} value={cg.id}>{cg.first_name} {cg.last_name}</option>
                      ))}
                    </select>
                  </div>
                  
                  <div className="form-group" style={{ margin: 0, gridColumn: 'span 2' }}>
                    <label style={{ fontSize: '0.8rem' }}>Description</label>
                    <input 
                      type="text" 
                      value={item.description} 
                      onChange={(e) => updateManualLineItem(index, 'description', e.target.value)}
                      placeholder="Home Care Services"
                    />
                  </div>
                  
                  {detailedMode && (
                    <>
                      <div className="form-group" style={{ margin: 0 }}>
                        <label style={{ fontSize: '0.8rem' }}>Start Time</label>
                        <input 
                          type="time" 
                          value={item.startTime} 
                          onChange={(e) => updateManualLineItem(index, 'startTime', e.target.value)}
                        />
                      </div>
                      <div className="form-group" style={{ margin: 0 }}>
                        <label style={{ fontSize: '0.8rem' }}>End Time</label>
                        <input 
                          type="time" 
                          value={item.endTime} 
                          onChange={(e) => updateManualLineItem(index, 'endTime', e.target.value)}
                        />
                      </div>
                    </>
                  )}
                  
                  <div className="form-group" style={{ margin: 0 }}>
                    <label style={{ fontSize: '0.8rem' }}>Hours *</label>
                    <input 
                      type="number" 
                      step="0.25" 
                      min="0" 
                      value={item.hours} 
                      onChange={(e) => updateManualLineItem(index, 'hours', e.target.value)}
                      placeholder="0.00"
                      required
                    />
                  </div>
                  
                  <div className="form-group" style={{ margin: 0 }}>
                    <label style={{ fontSize: '0.8rem' }}>Rate *</label>
                    <input 
                      type="number" 
                      step="0.01" 
                      min="0" 
                      value={item.rate} 
                      onChange={(e) => updateManualLineItem(index, 'rate', e.target.value)}
                      placeholder="0.00"
                      required
                    />
                  </div>
                  
                  <div className="form-group" style={{ margin: 0 }}>
                    <label style={{ fontSize: '0.8rem' }}>Amount</label>
                    <div style={{ padding: '0.6rem', background: '#e8f5e9', borderRadius: '6px', fontWeight: '600', color: '#2e7d32' }}>
                      {formatCurrency((parseFloat(item.hours) || 0) * (parseFloat(item.rate) || 0))}
                    </div>
                  </div>
                </div>
              </div>
            ))}
            
            {/* Totals row */}
            <div style={{ 
              display: 'flex', 
              justifyContent: 'space-between', 
              alignItems: 'center',
              padding: '1rem',
              background: '#e3f2fd',
              borderRadius: '8px',
              marginBottom: '1rem'
            }}>
              <button type="button" className="btn btn-secondary" onClick={addManualLineItem}>
                + Add Line Item
              </button>
              <div style={{ textAlign: 'right' }}>
                <span style={{ color: '#666', marginRight: '1rem' }}>Total:</span>
                <strong style={{ fontSize: '1.3rem', color: '#1565c0' }}>{formatCurrency(calculateManualTotal())}</strong>
              </div>
            </div>

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
            
            {/* Printable Invoice - Zoho Style */}
            <div id="printable-invoice" className="invoice-print-container">
              <style>{`
                @media print {
                  @page {
                    margin: 10mm;
                    size: letter;
                  }
                  body * { visibility: hidden; }
                  #printable-invoice, #printable-invoice * { visibility: visible; }
                  html, body { height: auto !important; overflow: visible !important; }
                  #root, .main-content, .container { overflow: visible !important; height: auto !important; }
                  .sidebar { display: none !important; }
                  .main-content { margin-left: 0 !important; width: 100% !important; }
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
                  #printable-invoice {
                    position: relative !important;
                    width: 100% !important;
                    padding: 0 !important;
                    margin: 0 !important;
                  }
                  .no-print { display: none !important; visibility: hidden !important; }
                  .invoice-table tr { page-break-inside: avoid; break-inside: avoid; }
                }
                .invoice-print-container {
                  font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
                  color: #333;
                  background: white;
                  padding: 20px;
                  line-height: 1.3;
                  font-size: 12px;
                }
                /* Header: Logo+Company LEFT, Invoice Info RIGHT */
                .invoice-header-row {
                  display: flex;
                  justify-content: space-between;
                  align-items: flex-start;
                  margin-bottom: 20px;
                }
                .invoice-header-left {
                  display: flex;
                  flex-direction: column;
                }
                .invoice-logo-large {
                  max-width: 180px;
                  max-height: 120px;
                  margin-bottom: 15px;
                }
                .invoice-company-info {
                  font-size: 12px;
                  color: #555;
                  line-height: 1.5;
                }
                .invoice-company-name {
                  font-size: 16px;
                  font-weight: 600;
                  color: #333;
                  margin-bottom: 3px;
                }
                .invoice-header-right {
                  text-align: right;
                }
                .invoice-title-large {
                  font-size: 36px;
                  font-weight: 300;
                  color: #333;
                  margin: 0;
                  letter-spacing: 2px;
                }
                .invoice-number-display {
                  font-size: 14px;
                  color: #666;
                  margin-top: 5px;
                }
                .invoice-balance-box {
                  margin-top: 15px;
                  text-align: right;
                }
                .invoice-balance-label {
                  font-size: 11px;
                  color: #888;
                  text-transform: uppercase;
                }
                .invoice-balance-amount {
                  font-size: 28px;
                  font-weight: 600;
                  color: #2ABBA7;
                }
                /* Bill To LEFT, Invoice Dates RIGHT */
                .invoice-details-row {
                  display: flex;
                  justify-content: space-between;
                  margin-bottom: 15px;
                  padding-bottom: 15px;
                }
                .invoice-bill-to {
                  flex: 1;
                }
                .invoice-bill-to-label {
                  font-size: 11px;
                  color: #888;
                  margin-bottom: 5px;
                }
                .invoice-bill-to-name {
                  font-size: 15px;
                  font-weight: 600;
                  color: #333;
                  margin-bottom: 3px;
                }
                .invoice-bill-to-address {
                  font-size: 12px;
                  color: #555;
                  line-height: 1.5;
                }
                .invoice-dates {
                  text-align: right;
                }
                .invoice-date-row {
                  display: flex;
                  justify-content: flex-end;
                  gap: 20px;
                  margin-bottom: 6px;
                  font-size: 13px;
                }
                .invoice-date-label {
                  color: #666;
                }
                .invoice-date-value {
                  font-weight: 500;
                  min-width: 100px;
                  text-align: right;
                }
                /* Table - Zoho Style */
                .invoice-table {
                  width: 100%;
                  border-collapse: collapse;
                  margin-bottom: 0;
                }
                .invoice-table thead {
                  background: #2ABBA7;
                }
                .invoice-table th {
                  color: white;
                  padding: 8px 12px;
                  text-align: left;
                  font-size: 11px;
                  font-weight: 600;
                  text-transform: uppercase;
                  border: none;
                }
                .invoice-table th:first-child { width: 30px; text-align: center; }
                .invoice-table th:nth-child(2) { width: auto; }
                .invoice-table th:nth-child(3) { width: 60px; text-align: right; }
                .invoice-table th:nth-child(4) { width: 70px; text-align: right; }
                .invoice-table th:last-child { width: 90px; text-align: right; }
                .invoice-table td {
                  padding: 6px 12px;
                  border-bottom: 1px solid #eee;
                  font-size: 13px;
                  vertical-align: middle;
                }
                .invoice-table td:first-child { text-align: center; color: #888; }
                .invoice-table td:nth-child(3) { text-align: right; }
                .invoice-table td:nth-child(4) { text-align: right; }
                .invoice-table td:last-child { text-align: right; font-weight: 500; }
                .invoice-item-description {
                  font-weight: 500;
                  color: #333;
                }
                .invoice-item-details {
                  font-size: 11px;
                  color: #888;
                  margin-top: 3px;
                  line-height: 1.4;
                }
                /* Totals Section */
                .invoice-totals-section {
                  display: flex;
                  justify-content: flex-end;
                  margin-top: 0;
                }
                .invoice-totals-box {
                  width: 280px;
                }
                .invoice-total-row {
                  display: flex;
                  justify-content: space-between;
                  padding: 8px 12px;
                  border-bottom: 1px solid #eee;
                  font-size: 13px;
                }
                .invoice-total-row:last-child {
                  border-bottom: none;
                }
                .invoice-total-label { color: #555; }
                .invoice-total-value { font-weight: 500; text-align: right; min-width: 80px; }
                .invoice-total-row.grand-total {
                  background: #2ABBA7;
                  color: white;
                  font-weight: 600;
                  font-size: 14px;
                }
                .invoice-total-row.grand-total .invoice-total-label,
                .invoice-total-row.grand-total .invoice-total-value {
                  color: white;
                  font-weight: 600;
                }
                /* Notes */
                .invoice-notes-section {
                  margin-top: 20px;
                  padding-top: 10px;
                }
                .invoice-notes-label {
                  font-size: 12px;
                  font-weight: 600;
                  color: #333;
                  margin-bottom: 5px;
                }
                .invoice-notes-text {
                  font-size: 12px;
                  color: #555;
                }
                /* Footer */
                .invoice-footer-section {
                  margin-top: 25px;
                  padding-top: 10px;
                  border-top: 1px solid #ddd;
                  text-align: center;
                  color: #888;
                  font-size: 11px;
                }
              `}</style>
              
              {/* Header Row: Logo+Company on Left, Invoice Title+Balance on Right */}
              <div className="invoice-header-row">
                <div className="invoice-header-left">
                  <img 
                    src="/logo.png" 
                    alt="Chippewa Valley Home Care" 
                    className="invoice-logo-large"
                    onError={(e) => { e.target.style.display = 'none'; }}
                  />
                  <div className="invoice-company-info">
                    <div className="invoice-company-name">Chippewa Valley Home Care</div>
                    <div>2607 Beverly Hills Dr</div>
                    <div>Eau Claire, Wisconsin 54701</div>
                    <div>U.S.A</div>
                    <div>715-491-1254</div>
                    <div>chippewavalleyhomecare@gmail.com</div>
                  </div>
                </div>
                <div className="invoice-header-right">
                  <h1 className="invoice-title-large">INVOICE</h1>
                  <div className="invoice-number-display"># {selectedInvoice.invoice_number}</div>
                  <div className="invoice-balance-box">
                    <div className="invoice-balance-label">Balance Due</div>
                    <div className="invoice-balance-amount">{formatCurrency(parseFloat(selectedInvoice.total || 0) - parseFloat(selectedInvoice.amount_paid || 0))}</div>
                  </div>
                </div>
              </div>

              {/* Details Row: Bill To on Left, Dates on Right */}
              <div className="invoice-details-row">
                <div className="invoice-bill-to">
                  <div className="invoice-bill-to-label">Bill To</div>
                  <div className="invoice-bill-to-name">{selectedInvoice.first_name} {selectedInvoice.last_name}</div>
                  <div className="invoice-bill-to-address">
                    {selectedInvoice.address && <>{selectedInvoice.address}<br /></>}
                    {selectedInvoice.city && <>{selectedInvoice.city}<br /></>}
                    {selectedInvoice.state && <>{selectedInvoice.state}<br /></>}
                    U.S.A
                  </div>
                </div>
                <div className="invoice-dates">
                  <div className="invoice-date-row">
                    <span className="invoice-date-label">Invoice Date :</span>
                    <span className="invoice-date-value">{new Date(selectedInvoice.created_at).toLocaleDateString('en-US', { day: '2-digit', month: 'short', year: 'numeric' })}</span>
                  </div>
                  <div className="invoice-date-row">
                    <span className="invoice-date-label">Terms :</span>
                    <span className="invoice-date-value">Due on Receipt</span>
                  </div>
                  <div className="invoice-date-row">
                    <span className="invoice-date-label">Due Date :</span>
                    <span className="invoice-date-value">{new Date(selectedInvoice.payment_due_date).toLocaleDateString('en-US', { day: '2-digit', month: 'short', year: 'numeric' })}</span>
                  </div>
                </div>
              </div>

              {/* Line Items Table */}
              <table className="invoice-table">
                <thead>
                  <tr>
                    <th>#</th>
                    <th>Item & Description</th>
                    <th>Qty</th>
                    <th>Rate</th>
                    <th>Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {selectedInvoice.line_items?.length > 0 ? (
                    selectedInvoice.line_items.map((item, idx) => (
                      <tr key={idx}>
                        <td>{idx + 1}</td>
                        <td>
                          <div className="invoice-item-description">{item.description || 'Home Care Services'}</div>
                          {item.service_date && (
                            <div className="invoice-item-details">
                              {new Date(item.service_date).toLocaleDateString('en-US', { month: '2-digit', day: '2-digit' })}
                              {item.caregiver_first_name && ` - ${item.caregiver_first_name} ${item.caregiver_last_name}`}
                              {item.time_range && ` ${item.time_range}`}
                            </div>
                          )}
                        </td>
                        <td>{parseFloat(item.hours).toFixed(2)} <span style={{ fontSize: '10px', color: '#888' }}>Hr</span></td>
                        <td>{parseFloat(item.rate).toFixed(2)}</td>
                        <td>{parseFloat(item.amount).toFixed(2)}</td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td>1</td>
                      <td>
                        <div className="invoice-item-description">Home Care Services</div>
                        <div className="invoice-item-details">
                          {new Date(selectedInvoice.billing_period_start).toLocaleDateString()} - {new Date(selectedInvoice.billing_period_end).toLocaleDateString()}
                        </div>
                      </td>
                      <td>{selectedInvoice.total_hours?.toFixed(2) || '0.00'} <span style={{ fontSize: '10px', color: '#888' }}>Hr</span></td>
                      <td>{selectedInvoice.line_items?.[0]?.rate?.toFixed(2) || '33.00'}</td>
                      <td>{parseFloat(selectedInvoice.total).toFixed(2)}</td>
                    </tr>
                  )}
                </tbody>
              </table>

              {/* Totals */}
              <div className="invoice-totals-section">
                <div className="invoice-totals-box">
                  <div className="invoice-total-row">
                    <span className="invoice-total-label">Sub Total</span>
                    <span className="invoice-total-value">{parseFloat(selectedInvoice.subtotal || selectedInvoice.total).toFixed(2)}</span>
                  </div>
                  <div className="invoice-total-row">
                    <span className="invoice-total-label">Total</span>
                    <span className="invoice-total-value"><strong>${parseFloat(selectedInvoice.total).toFixed(2)}</strong></span>
                  </div>
                  {parseFloat(selectedInvoice.amount_paid || 0) > 0 && (
                    <div className="invoice-total-row">
                      <span className="invoice-total-label">Amount Paid</span>
                      <span className="invoice-total-value" style={{ color: '#28a745' }}>-${parseFloat(selectedInvoice.amount_paid).toFixed(2)}</span>
                    </div>
                  )}
                  <div className="invoice-total-row grand-total">
                    <span className="invoice-total-label">Balance Due</span>
                    <span className="invoice-total-value">${(parseFloat(selectedInvoice.total || 0) - parseFloat(selectedInvoice.amount_paid || 0)).toFixed(2)}</span>
                  </div>
                </div>
              </div>

              {/* Notes */}
              {selectedInvoice.notes ? (
                <div className="invoice-notes-section">
                  <div className="invoice-notes-label">Notes</div>
                  <div className="invoice-notes-text">{selectedInvoice.notes}</div>
                </div>
              ) : (
                <div className="invoice-notes-section">
                  <div className="invoice-notes-label">Notes</div>
                  <div className="invoice-notes-text">Thanks for your business.</div>
                </div>
              )}

              {/* Footer */}
              <div className="invoice-footer-section">
                <div>Chippewa Valley Home Care</div>
                <div>Thank you for choosing us for your home care needs.</div>
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
