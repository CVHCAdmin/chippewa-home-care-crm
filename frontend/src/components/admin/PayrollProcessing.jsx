// src/components/admin/PayrollProcessing.jsx
import React, { useState, useEffect } from 'react';
import { API_BASE_URL } from '../../config';

const PayrollProcessing = ({ token }) => {
  const [payPeriod, setPayPeriod] = useState({
    startDate: new Date(new Date().setDate(new Date().getDate() - 14)).toISOString().split('T')[0],
    endDate: new Date().toISOString().split('T')[0]
  });
  const [payrollData, setPayrollData] = useState([]);
  const [loading, setLoading] = useState(false);
  const [payrollStatus, setPayrollStatus] = useState('draft'); // draft, review, processed, paid
  const [showPayrollSummary, setShowPayrollSummary] = useState(false);
  const [selectedPayroll, setSelectedPayroll] = useState(null);
  const [payRates, setPayRates] = useState({});
  const [filter, setFilter] = useState('all'); // all, pending, approved, processed
  const [message, setMessage] = useState('');

  useEffect(() => {
    calculatePayroll();
  }, []);

  const calculatePayroll = async () => {
    setLoading(true);
    setMessage('');
    try {
      const response = await fetch(`${API_BASE_URL}/api/payroll/calculate`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          startDate: payPeriod.startDate,
          endDate: payPeriod.endDate
        })
      });

      const data = await response.json();
      setPayrollData(data.payrollData || []);
      setPayrollStatus(data.status || 'draft');
      setShowPayrollSummary(false);
    } catch (error) {
      setMessage('Error: Failed to calculate payroll');
      console.error('Failed to calculate payroll:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleUpdatePayRate = async (caregiverId, newRate) => {
    try {
      const response = await fetch(`${API_BASE_URL}/api/caregivers/${caregiverId}/pay-rate`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ hourlyRate: newRate })
      });

      if (!response.ok) throw new Error('Failed to update pay rate');

      setPayRates({ ...payRates, [caregiverId]: newRate });
      setMessage('Pay rate updated');
      setTimeout(() => setMessage(''), 2000);
      calculatePayroll();
    } catch (error) {
      setMessage('Error: ' + error.message);
    }
  };

  const handleApprovePayroll = async (caregiverId) => {
    try {
      const response = await fetch(`${API_BASE_URL}/api/payroll/${caregiverId}/approve`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });

      if (!response.ok) throw new Error('Failed to approve');

      setPayrollData(payrollData.map(p => 
        p.caregiver_id === caregiverId ? { ...p, status: 'approved' } : p
      ));
      setMessage('Payroll approved');
      setTimeout(() => setMessage(''), 2000);
    } catch (error) {
      setMessage('Error: ' + error.message);
    }
  };

  const handleProcessPaycheck = async (caregiverId) => {
    try {
      const response = await fetch(`${API_BASE_URL}/api/payroll/${caregiverId}/process`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });

      if (!response.ok) throw new Error('Failed to process paycheck');

      const result = await response.json();
      setPayrollData(payrollData.map(p => 
        p.caregiver_id === caregiverId ? { ...p, status: 'processed', check_number: result.checkNumber } : p
      ));
      setMessage(`Paycheck processed - Check #${result.checkNumber}`);
      setTimeout(() => setMessage(''), 3000);
    } catch (error) {
      setMessage('Error: ' + error.message);
    }
  };

  const handleExportPayroll = async (format) => {
    try {
      const response = await fetch(`${API_BASE_URL}/api/payroll/export`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          startDate: payPeriod.startDate,
          endDate: payPeriod.endDate,
          format
        })
      });

      if (!response.ok) throw new Error('Export failed');

      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `payroll-${payPeriod.startDate}-to-${payPeriod.endDate}.${format}`;
      a.click();
    } catch (error) {
      alert('Failed to export: ' + error.message);
    }
  };

  const calculateTotals = () => {
    return {
      totalHours: payrollData.reduce((sum, p) => sum + (p.total_hours || 0), 0),
      totalOvertimeHours: payrollData.reduce((sum, p) => sum + (p.overtime_hours || 0), 0),
      totalGrossPay: payrollData.reduce((sum, p) => sum + (p.gross_pay || 0), 0),
      totalDeductions: payrollData.reduce((sum, p) => sum + (p.total_deductions || 0), 0),
      totalNetPay: payrollData.reduce((sum, p) => sum + (p.net_pay || 0), 0)
    };
  };

  const filteredPayroll = payrollData.filter(p => {
    if (filter === 'all') return true;
    return p.status === filter;
  });

  const totals = calculateTotals();

  const getStatusBadge = (status) => {
    switch (status) {
      case 'draft':
        return 'badge-secondary';
      case 'approved':
        return 'badge-warning';
      case 'processed':
        return 'badge-info';
      case 'paid':
        return 'badge-success';
      default:
        return 'badge-secondary';
    }
  };

  return (
    <div>
      <div className="page-header">
        <h2>💰 Payroll Processing</h2>
        <div className="button-group">
          <button className="btn btn-primary" onClick={() => setShowPayrollSummary(true)}>
            📊 Summary
          </button>
          <button className="btn btn-secondary" onClick={() => handleExportPayroll('csv')}>
            📥 Export CSV
          </button>
          <button className="btn btn-secondary" onClick={() => handleExportPayroll('pdf')}>
            📄 Export PDF
          </button>
        </div>
      </div>

      {message && (
        <div className={`alert ${message.includes('Error') ? 'alert-error' : 'alert-success'}`}>
          {message}
        </div>
      )}

      {/* Payroll Summary Modal */}
      {showPayrollSummary && (
        <div className="modal active">
          <div className="modal-content modal-large">
            <div className="modal-header">
              <h2>Payroll Summary</h2>
              <button className="close-btn" onClick={() => setShowPayrollSummary(false)}>×</button>
            </div>

            <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))' }}>
              <div className="stat-card">
                <h3>Total Hours</h3>
                <div className="value">{totals.totalHours.toFixed(1)}</div>
              </div>
              <div className="stat-card">
                <h3>Overtime Hours</h3>
                <div className="value value-warning">{totals.totalOvertimeHours.toFixed(1)}</div>
              </div>
              <div className="stat-card">
                <h3>Gross Pay</h3>
                <div className="value">${totals.totalGrossPay.toFixed(2)}</div>
              </div>
              <div className="stat-card">
                <h3>Deductions</h3>
                <div className="value value-danger">${totals.totalDeductions.toFixed(2)}</div>
              </div>
              <div className="stat-card">
                <h3>Net Pay</h3>
                <div className="value value-success">${totals.totalNetPay.toFixed(2)}</div>
              </div>
              <div className="stat-card">
                <h3>Avg Hourly Rate</h3>
                <div className="value">
                  ${totals.totalHours > 0 ? (totals.totalGrossPay / totals.totalHours).toFixed(2) : '0.00'}
                </div>
              </div>
            </div>

            <div className="modal-actions">
              <button className="btn btn-secondary" onClick={() => setShowPayrollSummary(false)}>
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Payroll Details Modal */}
      {selectedPayroll && (
        <div className="modal active">
          <div className="modal-content modal-large">
            <div className="modal-header">
              <h2>{selectedPayroll.first_name} {selectedPayroll.last_name}</h2>
              <button className="close-btn" onClick={() => setSelectedPayroll(null)}>×</button>
            </div>

            <div className="grid" style={{ gridTemplateColumns: '1fr 1fr' }}>
              <div className="card">
                <h3>Hours</h3>
                <p><strong>Regular Hours:</strong> {selectedPayroll.regular_hours.toFixed(1)} hrs</p>
                <p><strong>Overtime Hours:</strong> {selectedPayroll.overtime_hours.toFixed(1)} hrs</p>
                <p><strong>Total Hours:</strong> {selectedPayroll.total_hours.toFixed(1)} hrs</p>
              </div>

              <div className="card">
                <h3>Pay Rates</h3>
                <p><strong>Regular Rate:</strong> ${selectedPayroll.hourly_rate.toFixed(2)}/hr</p>
                <p><strong>Overtime Rate:</strong> ${(selectedPayroll.hourly_rate * 1.5).toFixed(2)}/hr</p>
              </div>
            </div>

            <div className="grid" style={{ gridTemplateColumns: '1fr 1fr' }}>
              <div className="card">
                <h3>Pay Calculation</h3>
                <p><strong>Regular Pay:</strong> ${selectedPayroll.regular_pay.toFixed(2)}</p>
                <p><strong>Overtime Pay:</strong> ${selectedPayroll.overtime_pay.toFixed(2)}</p>
                <p><strong>Bonuses:</strong> ${selectedPayroll.bonuses.toFixed(2)}</p>
                <div style={{ borderTop: '1px solid #ddd', paddingTop: '0.5rem', marginTop: '0.5rem' }}>
                  <p><strong>Gross Pay:</strong> ${selectedPayroll.gross_pay.toFixed(2)}</p>
                </div>
              </div>

              <div className="card">
                <h3>Deductions</h3>
                <p><strong>Federal Tax:</strong> ${selectedPayroll.federal_tax.toFixed(2)}</p>
                <p><strong>Social Security:</strong> ${selectedPayroll.social_security_tax.toFixed(2)}</p>
                <p><strong>Medicare:</strong> ${selectedPayroll.medicare_tax.toFixed(2)}</p>
                {selectedPayroll.other_deductions > 0 && (
                  <p><strong>Other:</strong> ${selectedPayroll.other_deductions.toFixed(2)}</p>
                )}
                <div style={{ borderTop: '1px solid #ddd', paddingTop: '0.5rem', marginTop: '0.5rem' }}>
                  <p><strong>Total Deductions:</strong> ${selectedPayroll.total_deductions.toFixed(2)}</p>
                </div>
              </div>
            </div>

            <div className="card" style={{ background: '#f0f8f0' }}>
              <h3 style={{ margin: 0 }}>
                Net Pay: <span style={{ color: '#4caf50', fontSize: '1.5em' }}>
                  ${selectedPayroll.net_pay.toFixed(2)}
                </span>
              </h3>
            </div>

            {selectedPayroll.check_number && (
              <div className="card" style={{ background: '#e8f5e9' }}>
                <p><strong>Check #:</strong> {selectedPayroll.check_number}</p>
                <p><strong>Status:</strong> <span className={`badge ${getStatusBadge(selectedPayroll.status)}`}>
                  {selectedPayroll.status.toUpperCase()}
                </span></p>
              </div>
            )}

            <div className="modal-actions">
              {selectedPayroll.status === 'draft' && (
                <button 
                  className="btn btn-primary" 
                  onClick={() => {
                    handleApprovePayroll(selectedPayroll.caregiver_id);
                    setSelectedPayroll(null);
                  }}
                >
                  Approve
                </button>
              )}
              {selectedPayroll.status === 'approved' && (
                <button 
                  className="btn btn-primary" 
                  onClick={() => {
                    handleProcessPaycheck(selectedPayroll.caregiver_id);
                    setSelectedPayroll(null);
                  }}
                >
                  Process Paycheck
                </button>
              )}
              <button className="btn btn-secondary" onClick={() => setSelectedPayroll(null)}>
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Pay Period Selection */}
      <div className="card">
        <h3>Select Pay Period</h3>
        <div className="filter-controls" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '1rem', alignItems: 'flex-end' }}>
          <div className="form-group">
            <label>Start Date</label>
            <input
              type="date"
              value={payPeriod.startDate}
              onChange={(e) => setPayPeriod({ ...payPeriod, startDate: e.target.value })}
            />
          </div>

          <div className="form-group">
            <label>End Date</label>
            <input
              type="date"
              value={payPeriod.endDate}
              onChange={(e) => setPayPeriod({ ...payPeriod, endDate: e.target.value })}
            />
          </div>

          <button className="btn btn-primary" onClick={calculatePayroll} disabled={loading}>
            {loading ? 'Calculating...' : 'Calculate'}
          </button>
        </div>
      </div>

      {/* Status Filters */}
      <div className="card">
        <div className="filter-tabs">
          {['all', 'draft', 'approved', 'processed'].map(f => (
            <button
              key={f}
              className={`filter-tab ${filter === f ? 'active' : ''}`}
              onClick={() => setFilter(f)}
            >
              {f.charAt(0).toUpperCase() + f.slice(1)}
              <span className="filter-count">
                ({payrollData.filter(p => f === 'all' || p.status === f).length})
              </span>
            </button>
          ))}
        </div>
      </div>

      {/* Payroll Table */}
      {loading ? (
        <div className="loading">
          <div className="spinner"></div>
        </div>
      ) : filteredPayroll.length === 0 ? (
        <div className="card card-centered">
          <p>No payroll data for this period.</p>
        </div>
      ) : (
        <table className="table">
          <thead>
            <tr>
              <th>Caregiver</th>
              <th>Regular Hours</th>
              <th>Overtime Hours</th>
              <th>Hourly Rate</th>
              <th>Gross Pay</th>
              <th>Deductions</th>
              <th>Net Pay</th>
              <th>Status</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {filteredPayroll.map(payroll => (
              <tr key={payroll.caregiver_id}>
                <td>
                  <strong>{payroll.first_name} {payroll.last_name}</strong>
                </td>
                <td>{payroll.regular_hours.toFixed(1)}</td>
                <td className={payroll.overtime_hours > 0 ? 'value-warning' : ''}>
                  {payroll.overtime_hours.toFixed(1)}
                </td>
                <td>${payroll.hourly_rate.toFixed(2)}</td>
                <td className="value-success">${payroll.gross_pay.toFixed(2)}</td>
                <td className="value-danger">${payroll.total_deductions.toFixed(2)}</td>
                <td>
                  <strong className="value-success">
                    ${payroll.net_pay.toFixed(2)}
                  </strong>
                </td>
                <td>
                  <span className={`badge ${getStatusBadge(payroll.status)}`}>
                    {payroll.status.toUpperCase()}
                  </span>
                </td>
                <td>
                  <div style={{ display: 'flex', gap: '0.5rem' }}>
                    <button
                      className="btn btn-sm btn-primary"
                      onClick={() => setSelectedPayroll(payroll)}
                    >
                      Details
                    </button>
                    {payroll.status === 'draft' && (
                      <button
                        className="btn btn-sm btn-secondary"
                        onClick={() => handleApprovePayroll(payroll.caregiver_id)}
                      >
                        Approve
                      </button>
                    )}
                    {payroll.status === 'approved' && (
                      <button
                        className="btn btn-sm btn-success"
                        onClick={() => handleProcessPaycheck(payroll.caregiver_id)}
                      >
                        Process
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {/* Totals Row */}
      {filteredPayroll.length > 0 && (
        <div className="card" style={{ marginTop: '2rem', background: '#f5f5f5' }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '1rem' }}>
            <div>
              <p style={{ margin: 0, fontSize: '0.9rem', color: '#666' }}>Total Hours</p>
              <p style={{ margin: '0.5rem 0 0 0', fontSize: '1.5rem', fontWeight: 'bold' }}>
                {filteredPayroll.reduce((sum, p) => sum + (p.total_hours || 0), 0).toFixed(1)}
              </p>
            </div>
            <div>
              <p style={{ margin: 0, fontSize: '0.9rem', color: '#666' }}>Total Gross Pay</p>
              <p style={{ margin: '0.5rem 0 0 0', fontSize: '1.5rem', fontWeight: 'bold', color: '#4caf50' }}>
                ${filteredPayroll.reduce((sum, p) => sum + (p.gross_pay || 0), 0).toFixed(2)}
              </p>
            </div>
            <div>
              <p style={{ margin: 0, fontSize: '0.9rem', color: '#666' }}>Total Deductions</p>
              <p style={{ margin: '0.5rem 0 0 0', fontSize: '1.5rem', fontWeight: 'bold', color: '#f44336' }}>
                ${filteredPayroll.reduce((sum, p) => sum + (p.total_deductions || 0), 0).toFixed(2)}
              </p>
            </div>
            <div>
              <p style={{ margin: 0, fontSize: '0.9rem', color: '#666' }}>Total Net Pay</p>
              <p style={{ margin: '0.5rem 0 0 0', fontSize: '1.5rem', fontWeight: 'bold', color: '#2196f3' }}>
                ${filteredPayroll.reduce((sum, p) => sum + (p.net_pay || 0), 0).toFixed(2)}
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default PayrollProcessing;
