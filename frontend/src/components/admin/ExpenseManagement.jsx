// src/components/admin/ExpenseManagement.jsx
// Complete expense tracking: Categories, Filtering, Reports, Receipt Management, Budgets
import React, { useState, useEffect } from 'react';
import { API_BASE_URL } from '../../config';

const ExpenseManagement = ({ token }) => {
  const [expenses, setExpenses] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [showBudgetModal, setShowBudgetModal] = useState(false);
  const [editingExpense, setEditingExpense] = useState(null);
  const [message, setMessage] = useState('');
  
  // Filters
  const [dateRange, setDateRange] = useState({
    startDate: new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().split('T')[0],
    endDate: new Date().toISOString().split('T')[0]
  });
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [searchTerm, setSearchTerm] = useState('');

  // Budget tracking
  const [budgets, setBudgets] = useState({
    equipment: 5000,
    supplies: 2000,
    utilities: 1500,
    maintenance: 1000,
    training: 3000,
    marketing: 1500,
    office: 1000,
    travel: 2000,
    insurance: 5000,
    other: 1000
  });

  const [formData, setFormData] = useState({
    expenseDate: new Date().toISOString().split('T')[0],
    category: 'supplies',
    vendor: '',
    description: '',
    amount: '',
    paymentMethod: 'credit_card',
    reimbursable: false,
    reimbursedTo: '',
    taxDeductible: true,
    notes: '',
    receiptUrl: ''
  });

  const categories = [
    { id: 'equipment', label: 'Equipment', icon: '🖥️', color: '#3498db' },
    { id: 'supplies', label: 'Supplies', icon: '📦', color: '#9b59b6' },
    { id: 'utilities', label: 'Utilities', icon: '💡', color: '#f39c12' },
    { id: 'maintenance', label: 'Maintenance', icon: '🔧', color: '#95a5a6' },
    { id: 'training', label: 'Training', icon: '📚', color: '#27ae60' },
    { id: 'marketing', label: 'Marketing', icon: '📣', color: '#e74c3c' },
    { id: 'office', label: 'Office', icon: '🏢', color: '#1abc9c' },
    { id: 'travel', label: 'Travel', icon: '✈️', color: '#e67e22' },
    { id: 'insurance', label: 'Insurance', icon: '🛡️', color: '#2c3e50' },
    { id: 'payroll', label: 'Payroll Tax', icon: '💰', color: '#16a085' },
    { id: 'professional', label: 'Professional Services', icon: '👔', color: '#8e44ad' },
    { id: 'other', label: 'Other', icon: '📋', color: '#7f8c8d' }
  ];

  const paymentMethods = [
    { id: 'cash', label: '💵 Cash' },
    { id: 'check', label: '🏦 Check' },
    { id: 'credit_card', label: '💳 Credit Card' },
    { id: 'debit_card', label: '💳 Debit Card' },
    { id: 'bank_transfer', label: '🏦 Bank Transfer' },
    { id: 'paypal', label: '📱 PayPal' },
    { id: 'other', label: '📋 Other' }
  ];

  useEffect(() => {
    loadExpenses();
  }, [dateRange]);

  const loadExpenses = async () => {
    try {
      const response = await fetch(`${API_BASE_URL}/api/expenses?startDate=${dateRange.startDate}&endDate=${dateRange.endDate}`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      const data = await response.json();
      setExpenses(Array.isArray(data) ? data : []);
    } catch (error) {
      console.error('Failed to load expenses:', error);
      setExpenses([]);
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    try {
      const url = editingExpense 
        ? `${API_BASE_URL}/api/expenses/${editingExpense.id}`
        : `${API_BASE_URL}/api/expenses`;
      
      const response = await fetch(url, {
        method: editingExpense ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({ ...formData, amount: parseFloat(formData.amount) })
      });

      if (!response.ok) throw new Error('Failed to save expense');

      resetForm();
      loadExpenses();
      setMessage(editingExpense ? '✓ Expense updated' : '✓ Expense recorded');
      setTimeout(() => setMessage(''), 3000);
    } catch (error) {
      alert('Failed: ' + error.message);
    }
  };

  const handleEdit = (expense) => {
    setEditingExpense(expense);
    setFormData({
      expenseDate: expense.expense_date?.split('T')[0] || '',
      category: expense.category || 'other',
      vendor: expense.vendor || '',
      description: expense.description || '',
      amount: expense.amount?.toString() || '',
      paymentMethod: expense.payment_method || 'credit_card',
      reimbursable: expense.reimbursable || false,
      reimbursedTo: expense.reimbursed_to || '',
      taxDeductible: expense.tax_deductible !== false,
      notes: expense.notes || '',
      receiptUrl: expense.receipt_url || ''
    });
    setShowForm(true);
  };

  const handleDelete = async (expenseId) => {
    if (!window.confirm('Delete this expense?')) return;
    try {
      await fetch(`${API_BASE_URL}/api/expenses/${expenseId}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${token}` }
      });
      loadExpenses();
      setMessage('✓ Expense deleted');
      setTimeout(() => setMessage(''), 2000);
    } catch (error) {
      alert('Failed: ' + error.message);
    }
  };

  const resetForm = () => {
    setFormData({
      expenseDate: new Date().toISOString().split('T')[0],
      category: 'supplies',
      vendor: '',
      description: '',
      amount: '',
      paymentMethod: 'credit_card',
      reimbursable: false,
      reimbursedTo: '',
      taxDeductible: true,
      notes: '',
      receiptUrl: ''
    });
    setEditingExpense(null);
    setShowForm(false);
  };

  const handleExportCSV = () => {
    const headers = ['Date', 'Category', 'Vendor', 'Description', 'Amount', 'Payment Method', 'Tax Deductible', 'Notes'];
    const rows = filteredExpenses.map(e => [
      e.expense_date?.split('T')[0],
      e.category,
      e.vendor || '',
      e.description || '',
      e.amount,
      e.payment_method,
      e.tax_deductible ? 'Yes' : 'No',
      e.notes || ''
    ]);
    
    const csv = [headers.join(','), ...rows.map(r => r.map(cell => `"${cell}"`).join(','))].join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `expenses-${dateRange.startDate}-to-${dateRange.endDate}.csv`;
    a.click();
  };

  // Filter expenses
  const filteredExpenses = expenses.filter(expense => {
    const matchesCategory = categoryFilter === 'all' || expense.category === categoryFilter;
    const matchesSearch = !searchTerm || 
      expense.description?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      expense.vendor?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      expense.notes?.toLowerCase().includes(searchTerm.toLowerCase());
    return matchesCategory && matchesSearch;
  });

  // Calculate totals
  const calculateTotals = () => {
    const byCategory = {};
    categories.forEach(c => { byCategory[c.id] = 0; });
    
    let total = 0;
    let taxDeductible = 0;
    let reimbursable = 0;

    filteredExpenses.forEach(expense => {
      const amount = parseFloat(expense.amount) || 0;
      total += amount;
      if (expense.category) byCategory[expense.category] = (byCategory[expense.category] || 0) + amount;
      if (expense.tax_deductible) taxDeductible += amount;
      if (expense.reimbursable) reimbursable += amount;
    });

    return { total, byCategory, taxDeductible, reimbursable };
  };

  const totals = calculateTotals();

  const getCategoryInfo = (categoryId) => {
    return categories.find(c => c.id === categoryId) || { label: categoryId, icon: '📋', color: '#999' };
  };

  const getPaymentMethodLabel = (methodId) => {
    const method = paymentMethods.find(m => m.id === methodId);
    return method ? method.label : methodId;
  };

  const formatCurrency = (amount) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(amount || 0);

  const getBudgetStatus = (category, spent) => {
    const budget = budgets[category] || 0;
    if (budget === 0) return { percentage: 0, status: 'none' };
    const percentage = (spent / budget) * 100;
    return {
      percentage,
      status: percentage >= 100 ? 'over' : percentage >= 80 ? 'warning' : 'good'
    };
  };

  if (loading) return <div className="loading"><div className="spinner"></div></div>;

  return (
    <div>
      <div className="page-header">
        <h2>💰 Expense Management</h2>
        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
          <button className="btn btn-primary" onClick={() => { resetForm(); setShowForm(!showForm); }}>
            {showForm ? '✕ Cancel' : '➕ Add Expense'}
          </button>
          <button className="btn btn-secondary" onClick={() => setShowBudgetModal(true)}>📊 Budgets</button>
          <button className="btn btn-secondary" onClick={handleExportCSV}>📥 Export CSV</button>
        </div>
      </div>

      {message && <div className="alert alert-success">{message}</div>}

      {/* Summary Cards */}
      <div className="grid">
        <div className="stat-card">
          <h3>Total Expenses</h3>
          <div className="value" style={{ color: '#dc3545' }}>{formatCurrency(totals.total)}</div>
          <div className="stat-subtext">{filteredExpenses.length} transactions</div>
        </div>
        <div className="stat-card">
          <h3>Tax Deductible</h3>
          <div className="value" style={{ color: '#28a745' }}>{formatCurrency(totals.taxDeductible)}</div>
        </div>
        <div className="stat-card">
          <h3>Reimbursable</h3>
          <div className="value" style={{ color: '#17a2b8' }}>{formatCurrency(totals.reimbursable)}</div>
        </div>
        <div className="stat-card">
          <h3>Avg per Transaction</h3>
          <div className="value">{formatCurrency(filteredExpenses.length > 0 ? totals.total / filteredExpenses.length : 0)}</div>
        </div>
      </div>

      {/* Category Breakdown */}
      <div className="card">
        <h3>Spending by Category</h3>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: '1rem', marginTop: '1rem' }}>
          {categories.filter(c => totals.byCategory[c.id] > 0).map(category => {
            const spent = totals.byCategory[category.id];
            const budget = getBudgetStatus(category.id, spent);
            return (
              <div key={category.id} style={{ padding: '1rem', background: '#f9f9f9', borderRadius: '8px', borderLeft: `4px solid ${category.color}` }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span>{category.icon} {category.label}</span>
                  <strong>{formatCurrency(spent)}</strong>
                </div>
                {budgets[category.id] > 0 && (
                  <div style={{ marginTop: '0.5rem' }}>
                    <div style={{ height: '6px', background: '#e0e0e0', borderRadius: '3px', overflow: 'hidden' }}>
                      <div style={{ 
                        width: `${Math.min(budget.percentage, 100)}%`, 
                        height: '100%', 
                        background: budget.status === 'over' ? '#dc3545' : budget.status === 'warning' ? '#ffc107' : '#28a745',
                        transition: 'width 0.3s'
                      }} />
                    </div>
                    <small className="text-muted">{budget.percentage.toFixed(0)}% of {formatCurrency(budgets[category.id])} budget</small>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Expense Form */}
      {showForm && (
        <div className="card card-form">
          <h3>{editingExpense ? 'Edit Expense' : 'Record New Expense'}</h3>
          <form onSubmit={handleSubmit}>
            <div className="form-grid">
              <div className="form-group">
                <label>Date *</label>
                <input type="date" value={formData.expenseDate} onChange={(e) => setFormData({ ...formData, expenseDate: e.target.value })} required />
              </div>
              <div className="form-group">
                <label>Category *</label>
                <select value={formData.category} onChange={(e) => setFormData({ ...formData, category: e.target.value })} required>
                  {categories.map(c => <option key={c.id} value={c.id}>{c.icon} {c.label}</option>)}
                </select>
              </div>
              <div className="form-group">
                <label>Amount *</label>
                <input type="number" step="0.01" min="0" value={formData.amount} onChange={(e) => setFormData({ ...formData, amount: e.target.value })} placeholder="0.00" required />
              </div>
              <div className="form-group">
                <label>Payment Method</label>
                <select value={formData.paymentMethod} onChange={(e) => setFormData({ ...formData, paymentMethod: e.target.value })}>
                  {paymentMethods.map(m => <option key={m.id} value={m.id}>{m.label}</option>)}
                </select>
              </div>
              <div className="form-group">
                <label>Vendor</label>
                <input type="text" value={formData.vendor} onChange={(e) => setFormData({ ...formData, vendor: e.target.value })} placeholder="e.g., Amazon, Office Depot" />
              </div>
              <div className="form-group">
                <label>Description</label>
                <input type="text" value={formData.description} onChange={(e) => setFormData({ ...formData, description: e.target.value })} placeholder="What was purchased?" />
              </div>
            </div>
            
            <div className="form-grid-2" style={{ marginTop: '1rem' }}>
              <div className="form-group">
                <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <input type="checkbox" checked={formData.taxDeductible} onChange={(e) => setFormData({ ...formData, taxDeductible: e.target.checked })} />
                  Tax Deductible
                </label>
              </div>
              <div className="form-group">
                <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <input type="checkbox" checked={formData.reimbursable} onChange={(e) => setFormData({ ...formData, reimbursable: e.target.checked })} />
                  Reimbursable
                </label>
              </div>
            </div>

            {formData.reimbursable && (
              <div className="form-group">
                <label>Reimburse To</label>
                <input type="text" value={formData.reimbursedTo} onChange={(e) => setFormData({ ...formData, reimbursedTo: e.target.value })} placeholder="Employee name" />
              </div>
            )}

            <div className="form-group">
              <label>Notes</label>
              <textarea value={formData.notes} onChange={(e) => setFormData({ ...formData, notes: e.target.value })} rows="2" placeholder="Additional details..." />
            </div>

            <div className="form-group">
              <label>Receipt URL</label>
              <input type="url" value={formData.receiptUrl} onChange={(e) => setFormData({ ...formData, receiptUrl: e.target.value })} placeholder="https://..." />
            </div>

            <div className="form-actions">
              <button type="submit" className="btn btn-primary">{editingExpense ? 'Update' : 'Record'} Expense</button>
              <button type="button" className="btn btn-secondary" onClick={resetForm}>Cancel</button>
            </div>
          </form>
        </div>
      )}

      {/* Filters */}
      <div className="card">
        <div className="filter-controls">
          <div className="form-group" style={{ marginBottom: 0 }}>
            <label>Start Date</label>
            <input type="date" value={dateRange.startDate} onChange={(e) => setDateRange({ ...dateRange, startDate: e.target.value })} />
          </div>
          <div className="form-group" style={{ marginBottom: 0 }}>
            <label>End Date</label>
            <input type="date" value={dateRange.endDate} onChange={(e) => setDateRange({ ...dateRange, endDate: e.target.value })} />
          </div>
          <div className="form-group" style={{ marginBottom: 0 }}>
            <label>Category</label>
            <select value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value)}>
              <option value="all">All Categories</option>
              {categories.map(c => <option key={c.id} value={c.id}>{c.icon} {c.label}</option>)}
            </select>
          </div>
          <div className="form-group" style={{ marginBottom: 0, flex: 1 }}>
            <label>Search</label>
            <input type="text" value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} placeholder="Search description, vendor..." />
          </div>
        </div>
      </div>

      {/* Expenses Table */}
      {filteredExpenses.length === 0 ? (
        <div className="card card-centered">
          <p>No expenses found for the selected filters.</p>
        </div>
      ) : (
        <table className="table">
          <thead>
            <tr>
              <th>Date</th>
              <th>Category</th>
              <th>Vendor</th>
              <th>Description</th>
              <th>Amount</th>
              <th>Payment</th>
              <th>Tax Ded.</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {filteredExpenses.map(expense => {
              const categoryInfo = getCategoryInfo(expense.category);
              return (
                <tr key={expense.id}>
                  <td>{new Date(expense.expense_date).toLocaleDateString()}</td>
                  <td>
                    <span style={{ 
                      display: 'inline-flex', 
                      alignItems: 'center', 
                      gap: '0.25rem',
                      padding: '0.25rem 0.5rem',
                      background: categoryInfo.color + '20',
                      borderRadius: '4px',
                      fontSize: '0.85rem'
                    }}>
                      {categoryInfo.icon} {categoryInfo.label}
                    </span>
                  </td>
                  <td>{expense.vendor || '-'}</td>
                  <td>{expense.description || '-'}</td>
                  <td><strong style={{ color: '#dc3545' }}>{formatCurrency(expense.amount)}</strong></td>
                  <td>{getPaymentMethodLabel(expense.payment_method)}</td>
                  <td>{expense.tax_deductible ? <span className="badge badge-success">Yes</span> : <span className="badge badge-secondary">No</span>}</td>
                  <td>
                    <div style={{ display: 'flex', gap: '0.25rem' }}>
                      <button className="btn btn-sm btn-secondary" onClick={() => handleEdit(expense)}>Edit</button>
                      <button className="btn btn-sm btn-danger" onClick={() => handleDelete(expense.id)}>Delete</button>
                      {expense.receipt_url && (
                        <a href={expense.receipt_url} target="_blank" rel="noopener noreferrer" className="btn btn-sm btn-primary">📎</a>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr style={{ background: '#f5f5f5', fontWeight: 'bold' }}>
              <td colSpan="4" style={{ textAlign: 'right' }}>Total:</td>
              <td style={{ color: '#dc3545' }}>{formatCurrency(totals.total)}</td>
              <td colSpan="3"></td>
            </tr>
          </tfoot>
        </table>
      )}

      {/* Budget Modal */}
      {showBudgetModal && (
        <div className="modal active">
          <div className="modal-content modal-large">
            <div className="modal-header">
              <h2>📊 Monthly Budgets</h2>
              <button className="close-btn" onClick={() => setShowBudgetModal(false)}>×</button>
            </div>
            
            <p className="text-muted">Set monthly budget limits for each category to track spending.</p>
            
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(250px, 1fr))', gap: '1rem', marginTop: '1rem' }}>
              {categories.map(category => {
                const spent = totals.byCategory[category.id] || 0;
                const budget = budgets[category.id] || 0;
                const status = getBudgetStatus(category.id, spent);
                
                return (
                  <div key={category.id} style={{ padding: '1rem', border: '1px solid #e0e0e0', borderRadius: '8px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
                      <span style={{ fontWeight: 'bold' }}>{category.icon} {category.label}</span>
                      <span style={{ color: status.status === 'over' ? '#dc3545' : status.status === 'warning' ? '#ffc107' : '#28a745' }}>
                        {formatCurrency(spent)} spent
                      </span>
                    </div>
                    <div className="form-group" style={{ marginBottom: 0 }}>
                      <label style={{ fontSize: '0.85rem' }}>Monthly Budget</label>
                      <input 
                        type="number" 
                        step="100" 
                        min="0" 
                        value={budgets[category.id] || ''} 
                        onChange={(e) => setBudgets({ ...budgets, [category.id]: parseFloat(e.target.value) || 0 })}
                        placeholder="0.00"
                      />
                    </div>
                    {budget > 0 && (
                      <div style={{ marginTop: '0.5rem' }}>
                        <div style={{ height: '8px', background: '#e0e0e0', borderRadius: '4px', overflow: 'hidden' }}>
                          <div style={{ 
                            width: `${Math.min(status.percentage, 100)}%`, 
                            height: '100%', 
                            background: status.status === 'over' ? '#dc3545' : status.status === 'warning' ? '#ffc107' : '#28a745'
                          }} />
                        </div>
                        <small style={{ color: status.status === 'over' ? '#dc3545' : '#666' }}>
                          {status.percentage.toFixed(0)}% used ({formatCurrency(budget - spent)} remaining)
                        </small>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            <div className="modal-actions">
              <button className="btn btn-primary" onClick={() => setShowBudgetModal(false)}>Save Budgets</button>
              <button className="btn btn-secondary" onClick={() => setShowBudgetModal(false)}>Close</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default ExpenseManagement;
