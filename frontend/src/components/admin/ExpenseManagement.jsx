// src/components/admin/ExpenseManagement.jsx
import React, { useState, useEffect } from 'react';
import { API_BASE_URL } from '../../config';

const ExpenseManagement = ({ token }) => {
  const [expenses, setExpenses] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [totalAmount, setTotalAmount] = useState(0);
  const [formData, setFormData] = useState({
    expenseDate: '',
    category: 'equipment',
    description: '',
    amount: '',
    paymentMethod: 'cash',
    notes: '',
    receiptUrl: ''
  });

  useEffect(() => {
    loadExpenses();
  }, []);

  const loadExpenses = async () => {
    try {
      const response = await fetch(`${API_BASE_URL}/api/expenses`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });

      const data = await response.json();
      setExpenses(data);
      
      // Calculate total
      const total = data.reduce((sum, exp) => sum + (parseFloat(exp.amount) || 0), 0);
      setTotalAmount(total);
    } catch (error) {
      console.error('Failed to load expenses:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    try {
      const response = await fetch(`${API_BASE_URL}/api/expenses`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          ...formData,
          amount: parseFloat(formData.amount)
        })
      });

      if (!response.ok) throw new Error('Failed to record expense');

      setFormData({
        expenseDate: '',
        category: 'equipment',
        description: '',
        amount: '',
        paymentMethod: 'cash',
        notes: '',
        receiptUrl: ''
      });
      setShowForm(false);
      loadExpenses();
      alert('Expense recorded successfully!');
    } catch (error) {
      alert('Failed to record expense: ' + error.message);
    }
  };

  const getCategoryColor = (category) => {
    switch (category) {
      case 'supplies':
        return 'badge-primary';
      case 'equipment':
        return 'badge-info';
      case 'utilities':
        return 'badge-warning';
      case 'maintenance':
        return 'badge-secondary';
      case 'training':
        return 'badge-success';
      case 'other':
        return 'badge-dark';
      default:
        return 'badge-secondary';
    }
  };

  const getCategoryLabel = (category) => {
    return category.charAt(0).toUpperCase() + category.slice(1);
  };

  const getPaymentMethodLabel = (method) => {
    const map = {
      'cash': '💵 Cash',
      'check': '🏦 Check',
      'credit_card': '💳 Credit Card',
      'bank_transfer': '🏦 Bank Transfer',
      'other': 'Other'
    };
    return map[method] || method;
  };

  return (
    <div>
      <div className="page-header">
        <div>
          <h2>💰 Expense Management</h2>
          <div style={{ marginTop: '10px', fontSize: '16px', color: '#666' }}>
            Total: <strong style={{ fontSize: '20px', color: '#28a745' }}>${totalAmount.toFixed(2)}</strong>
          </div>
        </div>
        <button 
          className="btn btn-primary"
          onClick={() => setShowForm(!showForm)}
        >
          {showForm ? '✕ Cancel' : '➕ Record Expense'}
        </button>
      </div>

      {showForm && (
        <div className="card card-form">
          <h3>Record New Expense</h3>
          <form onSubmit={handleSubmit}>
            <div className="form-grid">
              <div className="form-group">
                <label>Expense Date *</label>
                <input
                  type="date"
                  value={formData.expenseDate}
                  onChange={(e) => setFormData({ ...formData, expenseDate: e.target.value })}
                  required
                />
              </div>

              <div className="form-group">
                <label>Category *</label>
                <select
                  value={formData.category}
                  onChange={(e) => setFormData({ ...formData, category: e.target.value })}
                  required
                >
                  <option value="equipment">Equipment</option>
                  <option value="supplies">Supplies</option>
                  <option value="utilities">Utilities</option>
                  <option value="maintenance">Maintenance</option>
                  <option value="training">Training</option>
                  <option value="other">Other</option>
                </select>
              </div>

              <div className="form-group">
                <label>Amount *</label>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  value={formData.amount}
                  onChange={(e) => setFormData({ ...formData, amount: e.target.value })}
                  placeholder="0.00"
                  required
                />
              </div>

              <div className="form-group">
                <label>Payment Method</label>
                <select
                  value={formData.paymentMethod}
                  onChange={(e) => setFormData({ ...formData, paymentMethod: e.target.value })}
                >
                  <option value="cash">Cash</option>
                  <option value="check">Check</option>
                  <option value="credit_card">Credit Card</option>
                  <option value="bank_transfer">Bank Transfer</option>
                  <option value="other">Other</option>
                </select>
              </div>

              <div className="form-group" style={{ gridColumn: '1 / -1' }}>
                <label>Description</label>
                <input
                  type="text"
                  value={formData.description}
                  onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                  placeholder="What is this expense for?"
                />
              </div>

              <div className="form-group" style={{ gridColumn: '1 / -1' }}>
                <label>Notes</label>
                <textarea
                  value={formData.notes}
                  onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
                  placeholder="Additional notes..."
                  rows="2"
                ></textarea>
              </div>

              <div className="form-group" style={{ gridColumn: '1 / -1' }}>
                <label>Receipt URL</label>
                <input
                  type="url"
                  value={formData.receiptUrl}
                  onChange={(e) => setFormData({ ...formData, receiptUrl: e.target.value })}
                  placeholder="https://..."
                />
              </div>
            </div>

            <div className="form-actions">
              <button type="submit" className="btn btn-primary">Record Expense</button>
              <button type="button" className="btn btn-secondary" onClick={() => setShowForm(false)}>Cancel</button>
            </div>
          </form>
        </div>
      )}

      {/* Expenses Table */}
      {loading ? (
        <div className="loading"><div className="spinner"></div></div>
      ) : expenses.length === 0 ? (
        <div className="card card-centered">
          <p>No expenses recorded.</p>
        </div>
      ) : (
        <table className="table">
          <thead>
            <tr>
              <th>Date</th>
              <th>Category</th>
              <th>Description</th>
              <th>Amount</th>
              <th>Payment Method</th>
              <th>Notes</th>
            </tr>
          </thead>
          <tbody>
            {expenses.map(expense => (
              <tr key={expense.id}>
                <td>{new Date(expense.expense_date).toLocaleDateString()}</td>
                <td>
                  <span className={`badge ${getCategoryColor(expense.category)}`}>
                    {getCategoryLabel(expense.category)}
                  </span>
                </td>
                <td>{expense.description || 'N/A'}</td>
                <td><strong>${parseFloat(expense.amount).toFixed(2)}</strong></td>
                <td>{getPaymentMethodLabel(expense.payment_method)}</td>
                <td>{expense.notes || 'N/A'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
};

export default ExpenseManagement;
