// src/components/admin/BillingDashboard.jsx
import React, { useState, useEffect } from 'react';
import { getInvoices, generateInvoice, updateInvoiceStatus, getClients, exportInvoicesCSV } from '../../config';

const BillingDashboard = ({ token }) => {
  const [invoices, setInvoices] = useState([]);
  const [clients, setClients] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showGenerateForm, setShowGenerateForm] = useState(false);
  const [formData, setFormData] = useState({
    clientId: '',
    billingPeriodStart: '',
    billingPeriodEnd: ''
  });

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    try {
      const [invoiceData, clientData] = await Promise.all([
        getInvoices(token),
        getClients(token)
      ]);
      setInvoices(invoiceData);
      setClients(clientData);
    } catch (error) {
      console.error('Failed to load data:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleGenerateInvoice = async (e) => {
    e.preventDefault();
    try {
      await generateInvoice(formData, token);
      setFormData({ clientId: '', billingPeriodStart: '', billingPeriodEnd: '' });
      setShowGenerateForm(false);
      loadData();
      alert('Invoice generated successfully!');
    } catch (error) {
      alert('Failed to generate invoice: ' + error.message);
    }
  };

  const handleMarkPaid = async (invoiceId) => {
    try {
      await updateInvoiceStatus(invoiceId, { status: 'paid', paymentDate: new Date() }, token);
      loadData();
      alert('Invoice marked as paid!');
    } catch (error) {
      alert('Failed to update invoice: ' + error.message);
    }
  };

  const handleExportCSV = async () => {
    try {
      const blob = await exportInvoicesCSV(token);
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
          <div className="value value-danger">
            ${pendingTotal.toFixed(2)}
          </div>
        </div>
        <div className="stat-card">
          <h3>Paid This Month</h3>
          <div className="value value-success">
            ${paidTotal.toFixed(2)}
          </div>
        </div>
        <div className="stat-card">
          <h3>Total Invoices</h3>
          <div className="value">{invoices.length}</div>
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
            </div>

            <div className="form-actions">
              <button type="submit" className="btn btn-primary">Generate Invoice</button>
              <button type="button" className="btn btn-secondary" onClick={() => setShowGenerateForm(false)}>Cancel</button>
            </div>
          </form>
        </div>
      )}

      {/* Invoices Table */}
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
                  {new Date(invoice.billing_period_start).toLocaleDateString()} - {new Date(invoice.billing_period_end).toLocaleDateString()}
                </td>
                <td><strong>${parseFloat(invoice.total).toFixed(2)}</strong></td>
                <td>
                  <span className={`badge ${
                    invoice.payment_status === 'paid' ? 'badge-success' : 'badge-warning'
                  }`}>
                    {invoice.payment_status.toUpperCase()}
                  </span>
                </td>
                <td>
                  {invoice.payment_status !== 'paid' && (
                    <button 
                      className="btn btn-sm btn-primary"
                      onClick={() => handleMarkPaid(invoice.id)}
                    >
                      Mark Paid
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
};

export default BillingDashboard;
