import { toast } from '../Toast';
// src/components/admin/PayrollProcessing.jsx
// Professional payroll: Shift Review -> Approve -> Payroll Calculate -> Process
import React, { useState, useEffect } from 'react';
import { API_BASE_URL } from '../../config';

const PayrollProcessing = ({ token }) => {
  const [payPeriod, setPayPeriod] = useState(() => {
    // Pay periods are weekly Sun–Sat. Default to the last COMPLETED week so the
    // screen lands on a real, consistent period (and matches reconciled data)
    // instead of a rolling 14-day window whose dates never line up with a week.
    const t = new Date(); t.setHours(0, 0, 0, 0);
    const end = new Date(t); end.setDate(t.getDate() - t.getDay() - 1); // last Saturday
    const start = new Date(end); start.setDate(end.getDate() - 6);       // its Sunday
    const fmt = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    return { startDate: fmt(start), endDate: fmt(end) };
  });
  const [payrollData, setPayrollData] = useState([]);
  const [shiftData, setShiftData] = useState({ shifts: [], stats: {} });
  const [analytics, setAnalytics] = useState({ analytics: [], totals: {} });
  const [analyticsLoading, setAnalyticsLoading] = useState(false);
  const [loading, setLoading] = useState(false);
  const [shiftLoading, setShiftLoading] = useState(false);
  const [selectedPayroll, setSelectedPayroll] = useState(null);
  const [filter, setFilter] = useState('all');
  const [shiftFilter, setShiftFilter] = useState('all');
  const [caregiverFilter, setCaregiverFilter] = useState('all');
  const [message, setMessage] = useState('');
  const [showPayStubModal, setShowPayStubModal] = useState(false);
  const [showMileageModal, setShowMileageModal] = useState(false);
  const [showPTOModal, setShowPTOModal] = useState(false);
  const [showSettingsModal, setShowSettingsModal] = useState(false);
  const [showResolveModal, setShowResolveModal] = useState(false);
  const [resolveShift, setResolveShift] = useState(null);
  const [caregivers, setCaregivers] = useState([]);
  const [activeTab, setActiveTab] = useState('shifts');

  // Payroll settings
  const [settings, setSettings] = useState({
    overtimeThreshold: 40,
    overtimeRate: 1.5,
    weekendDifferential: 0,
    nightDifferential: 0,
    mileageRate: 0.67,
    federalTaxRate: 0.22,
    stateTaxRate: 0.0765,
    socialSecurityRate: 0.062,
    medicareRate: 0.0145
  });

  // Resolve form
  const [resolveForm, setResolveForm] = useState({
    status: 'manual_entry',
    payableMinutes: '',
    resolutionNotes: ''
  });

  // Mileage form
  const [mileageForm, setMileageForm] = useState({
    caregiverId: '', date: new Date().toISOString().split('T')[0],
    miles: '', fromLocation: '', toLocation: '', notes: ''
  });

  // PTO form
  const [ptoForm, setPtoForm] = useState({
    caregiverId: '', type: 'vacation', startDate: '', endDate: '', hours: '', notes: ''
  });

  useEffect(() => {
    loadCaregivers();
  }, []);

  const loadCaregivers = async () => {
    try {
      const response = await fetch(`${API_BASE_URL}/api/caregivers`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (!response.ok) { setCaregivers([]); return; }
      setCaregivers(await response.json());
    } catch (error) {
      console.error('Failed to load caregivers:', error);
    }
  };

  // ==================== SHIFT RECONCILIATION ====================

  const generateShifts = async () => {
    setShiftLoading(true);
    setMessage('');
    try {
      // Step 1: Generate/refresh shift review records
      const genResponse = await fetch(`${API_BASE_URL}/api/payroll/generate-shifts`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({ startDate: payPeriod.startDate, endDate: payPeriod.endDate })
      });
      if (!genResponse.ok) {
        // Surface the backend's real reason (e.g. 409 overlap guard names the
        // conflicting pay periods + how to proceed) instead of a generic error.
        const err = await genResponse.json().catch(() => ({}));
        let msg = err.error || 'Failed to generate shifts';
        if (Array.isArray(err.overlapping_periods) && err.overlapping_periods.length) {
          msg += ` Overlaps: ${err.overlapping_periods.join(', ')}.`;
        }
        if (err.hint) msg += ` ${err.hint}`;
        throw new Error(msg);
      }
      const genResult = await genResponse.json();

      // Step 2: Load shift data
      await loadShifts();
      setMessage(`Reconciled ${genResult.totalShifts} shifts (${genResult.created} new, ${genResult.updated} updated)`);
      setTimeout(() => setMessage(''), 4000);
    } catch (error) {
      setMessage('Error: ' + error.message);
      console.error('Generate shifts error:', error);
    } finally {
      setShiftLoading(false);
    }
  };

  const loadShifts = async () => {
    try {
      const r = await fetch(`${API_BASE_URL}/api/payroll/shifts?startDate=${payPeriod.startDate}&endDate=${payPeriod.endDate}`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (r.ok) setShiftData(await r.json());
    } catch (e) {
      console.error('Load shifts error:', e);
    }
  };

  const loadAnalytics = async () => {
    setAnalyticsLoading(true);
    try {
      const r = await fetch(`${API_BASE_URL}/api/payroll/analytics?startDate=${payPeriod.startDate}&endDate=${payPeriod.endDate}`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (r.ok) setAnalytics(await r.json());
    } catch (e) {
      console.error('Load analytics error:', e);
    } finally {
      setAnalyticsLoading(false);
    }
  };

  // Load the attendance report when its tab opens or the pay period changes.
  useEffect(() => {
    if (activeTab === 'analytics') loadAnalytics();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, payPeriod.startDate, payPeriod.endDate]);

  const handleShiftAction = async (shiftId, status, extras = {}) => {
    try {
      const r = await fetch(`${API_BASE_URL}/api/payroll/shifts/${shiftId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({ status, ...extras })
      });
      if (!r.ok) throw new Error('Failed to update shift');
      await loadShifts();
    } catch (error) {
      toast('Failed: ' + error.message, 'error');
    }
  };

  const handleBulkApproveShifts = async (mode = 'clocked') => {
    try {
      const r = await fetch(`${API_BASE_URL}/api/payroll/shifts/approve-all`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({ startDate: payPeriod.startDate, endDate: payPeriod.endDate, mode })
      });
      if (!r.ok) throw new Error('Failed to bulk approve');
      const result = await r.json();
      await loadShifts();
      const msg = mode === 'all'
        ? `Approved ${result.approvedCount} shifts (${result.approvedClocked} clocked + ${result.approvedScheduled} at scheduled hours)`
        : `Approved ${result.approvedCount} clocked shifts`;
      setMessage(msg);
      setTimeout(() => setMessage(''), 5000);
    } catch (error) {
      toast('Failed: ' + error.message, 'error');
    }
  };

  const openResolveModal = (shift) => {
    setResolveShift(shift);
    setResolveForm({
      status: 'manual_entry',
      payableMinutes: shift.scheduled_minutes || '',
      resolutionNotes: ''
    });
    setShowResolveModal(true);
  };

  const handleResolveShift = async (e) => {
    e.preventDefault();
    await handleShiftAction(resolveShift.id, resolveForm.status, {
      payableMinutes: resolveForm.status === 'excused' ? 0 : parseInt(resolveForm.payableMinutes) || 0,
      resolutionNotes: resolveForm.resolutionNotes
    });
    setShowResolveModal(false);
    setResolveShift(null);
  };

  // ==================== PAYROLL CALCULATION ====================

  const calculatePayroll = async () => {
    setLoading(true);
    setMessage('');
    try {
      const response = await fetch(`${API_BASE_URL}/api/payroll/calculate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({ startDate: payPeriod.startDate, endDate: payPeriod.endDate })
      });
      if (!response.ok) throw new Error('Failed to calculate payroll');
      const data = await response.json();

      const enhanced = (data.payrollData || []).map(p => {
        const totalHours = parseFloat(p.total_hours || 0);
        const regularHours = Math.min(totalHours, settings.overtimeThreshold);
        const overtimeHours = Math.max(totalHours - settings.overtimeThreshold, 0);
        const hourlyRate = parseFloat(p.hourly_rate || 15);

        const regularPay = regularHours * hourlyRate;
        const overtimePay = overtimeHours * hourlyRate * settings.overtimeRate;
        const mileageReimbursement = parseFloat(p.total_miles || 0) * settings.mileageRate;
        const weekendPay = parseFloat(p.weekend_hours || 0) * settings.weekendDifferential;
        const nightPay = parseFloat(p.night_hours || 0) * settings.nightDifferential;
        const ptoPay = parseFloat(p.pto_hours || 0) * hourlyRate;

        const grossPay = regularPay + overtimePay + mileageReimbursement + weekendPay + nightPay + ptoPay;
        const federalTax = grossPay * settings.federalTaxRate;
        const stateTax = grossPay * settings.stateTaxRate;
        const socialSecurity = grossPay * settings.socialSecurityRate;
        const medicare = grossPay * settings.medicareRate;
        const totalDeductions = federalTax + stateTax + socialSecurity + medicare;
        const taxableGross = regularPay + overtimePay + weekendPay + nightPay + ptoPay;
        const netPay = taxableGross - totalDeductions + mileageReimbursement;

        return {
          ...p,
          regular_hours: regularHours, overtime_hours: overtimeHours,
          regular_pay: regularPay, overtime_pay: overtimePay,
          mileage_reimbursement: mileageReimbursement,
          weekend_pay: weekendPay, night_pay: nightPay, pto_pay: ptoPay,
          gross_pay: grossPay, federal_tax: federalTax, state_tax: stateTax,
          social_security: socialSecurity, medicare: medicare,
          total_deductions: totalDeductions, net_pay: netPay,
          status: p.payroll_status || 'draft'
        };
      });

      setPayrollData(enhanced);
    } catch (error) {
      setMessage('Error: Failed to calculate payroll');
      console.error(error);
    } finally {
      setLoading(false);
    }
  };

  // ==================== PAYROLL ACTIONS ====================

  const handleApprovePayroll = async (caregiverId) => {
    try {
      const r = await fetch(`${API_BASE_URL}/api/payroll/${caregiverId}/approve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({ startDate: payPeriod.startDate, endDate: payPeriod.endDate })
      });
      if (!r.ok) {
        const err = await r.json();
        toast(err.error || 'Failed to approve', 'error');
        return;
      }
      setPayrollData(payrollData.map(p => p.caregiver_id === caregiverId ? { ...p, status: 'approved' } : p));
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
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` }
      });
      if (!response.ok) throw new Error('Failed to process paycheck');
      const result = await response.json();
      setPayrollData(payrollData.map(p => p.caregiver_id === caregiverId ? { ...p, status: 'processed', check_number: result.checkNumber } : p));
      setMessage(`Check #${result.checkNumber} processed`);
      setTimeout(() => setMessage(''), 3000);
    } catch (error) {
      setMessage('Error: ' + error.message);
    }
  };

  const handleAddMileage = async (e) => {
    e.preventDefault();
    try {
      await fetch(`${API_BASE_URL}/api/payroll/mileage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify(mileageForm)
      });
      setMileageForm({ caregiverId: '', date: new Date().toISOString().split('T')[0], miles: '', fromLocation: '', toLocation: '', notes: '' });
      setShowMileageModal(false);
      setMessage('Mileage recorded');
      setTimeout(() => setMessage(''), 2000);
    } catch (error) { toast('Failed: ' + error.message, 'error'); }
  };

  const handleAddPTO = async (e) => {
    e.preventDefault();
    try {
      await fetch(`${API_BASE_URL}/api/payroll/pto`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify(ptoForm)
      });
      setPtoForm({ caregiverId: '', type: 'vacation', startDate: '', endDate: '', hours: '', notes: '' });
      setShowPTOModal(false);
      setMessage('PTO recorded');
      setTimeout(() => setMessage(''), 2000);
    } catch (error) { toast('Failed: ' + error.message, 'error'); }
  };

  const handleExportPayroll = async (format) => {
    try {
      const response = await fetch(`${API_BASE_URL}/api/payroll/export`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({ startDate: payPeriod.startDate, endDate: payPeriod.endDate, format, payrollData })
      });
      if (!response.ok) throw new Error('Export failed');
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = format === 'quickbooks'
        ? `quickbooks-payroll-${payPeriod.startDate}.iif`
        : `payroll-${payPeriod.startDate}-to-${payPeriod.endDate}.csv`;
      a.click();
    } catch (error) { toast('Failed to export: ' + error.message, 'error'); }
  };

  const generatePayStub = (payroll) => { setSelectedPayroll(payroll); setShowPayStubModal(true); };

  // ==================== COMPUTED VALUES ====================

  const filteredPayroll = payrollData.filter(p => filter === 'all' || p.status === filter);

  // Get unique caregivers from shift data
  const shiftCaregivers = [...new Map(
    shiftData.shifts.map(s => [s.caregiver_id, { id: s.caregiver_id, name: `${s.caregiver_first} ${s.caregiver_last}` }])
  ).values()].sort((a, b) => a.name.localeCompare(b.name));

  const filteredShifts = shiftData.shifts.filter(s => {
    if (shiftFilter !== 'all' && s.status !== shiftFilter) return false;
    if (caregiverFilter !== 'all' && s.caregiver_id !== caregiverFilter) return false;
    return true;
  });

  const totals = {
    totalHours: payrollData.reduce((sum, p) => sum + parseFloat(p.total_hours || 0), 0),
    totalScheduledHours: payrollData.reduce((sum, p) => sum + parseFloat(p.scheduled_hours || 0), 0),
    totalClockedHours: payrollData.reduce((sum, p) => sum + parseFloat(p.clocked_hours || 0), 0),
    totalOvertimeHours: payrollData.reduce((sum, p) => sum + (p.overtime_hours || 0), 0),
    totalGrossPay: payrollData.reduce((sum, p) => sum + (p.gross_pay || 0), 0),
    totalDeductions: payrollData.reduce((sum, p) => sum + (p.total_deductions || 0), 0),
    totalNetPay: payrollData.reduce((sum, p) => sum + (p.net_pay || 0), 0),
    totalMileageReimbursement: payrollData.reduce((sum, p) => sum + (p.mileage_reimbursement || 0), 0)
  };

  const getStatusBadge = (status) => {
    switch (status) {
      case 'draft': return 'badge-secondary';
      case 'approved': return 'badge-warning';
      case 'processed': return 'badge-info';
      case 'paid': return 'badge-success';
      default: return 'badge-secondary';
    }
  };

  const formatCurrency = (amount) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(amount || 0);
  const formatTime = (time) => time ? time.substring(0, 5) : '--:--';
  // Show durations as "2h 16m" instead of decimal hours.
  const formatMinutes = (min) => {
    if (min == null || isNaN(min)) return '--';
    const total = Math.round(Math.abs(min));
    const h = Math.floor(total / 60), m = total % 60;
    const sign = min < 0 ? '-' : '';
    if (h && m) return `${sign}${h}h ${m}m`;
    if (h) return `${sign}${h}h`;
    return `${sign}${m}m`;
  };
  // Same, but the input is decimal hours (e.g. 2.32 -> "2h 19m").
  const formatHoursHM = (hours) => formatMinutes((parseFloat(hours) || 0) * 60);

  const shiftStatusConfig = {
    verified:      { bg: '#D1FAE5', color: '#065F46', label: 'Verified',      icon: '✅' },
    approved:      { bg: '#D1FAE5', color: '#065F46', label: 'Approved',      icon: '✅' },
    pending:       { bg: '#FEF3C7', color: '#92400E', label: 'Pending',       icon: '⏳' },
    missing_punch: { bg: '#FEE2E2', color: '#991B1B', label: 'Missing Punch', icon: '🔴' },
    flagged:       { bg: '#FEE2E2', color: '#991B1B', label: 'Flagged',       icon: '🚩' },
    excused:       { bg: '#E0E7FF', color: '#3730A3', label: 'Excused',       icon: '📋' },
    manual_entry:  { bg: '#DBEAFE', color: '#1E40AF', label: 'Manual Entry',  icon: '✏️' }
  };

  // ==================== RENDER ====================

  return (
    <div>
      <div className="page-header">
        <h2>Payroll Processing</h2>
        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
          <button className="btn btn-primary" onClick={() => setShowMileageModal(true)}>Add Mileage</button>
          <button className="btn btn-primary" onClick={() => setShowPTOModal(true)}>Add PTO</button>
          <button className="btn btn-secondary" onClick={() => setShowSettingsModal(true)}>Settings</button>
          <button className="btn btn-secondary" onClick={() => handleExportPayroll('csv')}>CSV Export</button>
          <button className="btn btn-secondary" onClick={() => handleExportPayroll('quickbooks')}>QuickBooks</button>
        </div>
      </div>

      {message && <div className={`alert ${message.includes('Error') ? 'alert-error' : 'alert-success'}`}>{message}</div>}

      {/* Pay Period & Generate */}
      <div className="card">
        <div style={{ display: 'flex', gap: '1rem', alignItems: 'flex-end', flexWrap: 'wrap' }}>
          <div className="form-group" style={{ marginBottom: 0 }}>
            <label>Pay Period Start</label>
            <input type="date" value={payPeriod.startDate} onChange={(e) => setPayPeriod({ ...payPeriod, startDate: e.target.value })} />
          </div>
          <div className="form-group" style={{ marginBottom: 0 }}>
            <label>Pay Period End</label>
            <input type="date" value={payPeriod.endDate} onChange={(e) => setPayPeriod({ ...payPeriod, endDate: e.target.value })} />
          </div>
          <button className="btn btn-primary" onClick={generateShifts} disabled={shiftLoading}>
            {shiftLoading ? 'Reconciling...' : '1. Reconcile Shifts'}
          </button>
          <button className="btn btn-success" onClick={calculatePayroll} disabled={loading}>
            {loading ? 'Calculating...' : '2. Calculate Payroll'}
          </button>
        </div>
        <div style={{ marginTop: '0.75rem', padding: '0.75rem 1rem', background: '#EFF6FF', borderLeft: '4px solid #2563EB', borderRadius: 6, fontSize: '0.85rem', color: '#1E3A8A' }}>
          <strong>How this works:</strong> <strong>Step 1 — Reconcile Shifts</strong> matches your schedule against caregiver clock-ins for the pay period selected above. Each match becomes a reviewable row. <strong>Step 2 — Calculate Payroll</strong> rolls up only the <em>approved</em> rows into pay totals. Use the Shift Approvals page to handle anything flagged BEFORE running Step 2 — pending/missing-punch rows are silently excluded from pay, not paid out.
        </div>
        {((shiftData.stats.pending || 0) + (shiftData.stats.missing_punch || 0) + (shiftData.stats.flagged || 0)) > 0 && (
          <div style={{ marginTop: '0.75rem', padding: '0.75rem 1rem', background: '#FEF3C7', borderLeft: '4px solid #D97706', borderRadius: 6, fontSize: '0.85rem', color: '#92400E' }}>
            ⚠️ <strong>{(shiftData.stats.pending || 0) + (shiftData.stats.missing_punch || 0) + (shiftData.stats.flagged || 0)} shifts still need review</strong>
            {shiftData.stats.pending > 0 && ` — ${shiftData.stats.pending} pending`}
            {shiftData.stats.missing_punch > 0 && `, ${shiftData.stats.missing_punch} missing punch`}
            {shiftData.stats.flagged > 0 && `, ${shiftData.stats.flagged} flagged`}.
            Resolve them in the Shift Review tab below (or in Shift Approvals) before clicking Calculate Payroll, or they won't be paid.
          </div>
        )}
      </div>

      {/* Tab selector */}
      <div style={{ display: 'flex', gap: 0, borderBottom: '2px solid #E5E7EB', marginBottom: '1.25rem' }}>
        {[
          ['shifts', 'Shift Review'],
          ['payroll', 'Payroll'],
          ['analytics', 'Attendance'],
        ].map(([id, label]) => (
          <button key={id} onClick={() => setActiveTab(id)}
            style={{ padding: '0.55rem 1.25rem', border: 'none', background: 'none', cursor: 'pointer',
              fontWeight: activeTab === id ? 800 : 500, fontSize: '0.875rem',
              color: activeTab === id ? '#2ABBA7' : '#6B7280',
              borderBottom: `2px solid ${activeTab === id ? '#2ABBA7' : 'transparent'}`,
              marginBottom: -2 }}>
            {label}
            {id === 'shifts' && shiftData.stats.needsAttention > 0 && (
              <span style={{ marginLeft: 6, background: '#EF4444', color: '#fff', borderRadius: 10, padding: '1px 7px', fontSize: '0.7rem', fontWeight: 700 }}>
                {shiftData.stats.needsAttention}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* ==================== SHIFT REVIEW TAB ==================== */}
      {activeTab === 'shifts' && (
        <div>
          {/* Shift Stats */}
          {shiftData.shifts.length > 0 && (
            <div style={{ display: 'flex', gap: '0.75rem', marginBottom: '1rem', flexWrap: 'wrap' }}>
              {[
                { label: 'Total Shifts', val: shiftData.stats.total || 0, color: '#6366F1' },
                { label: 'Approved', val: (shiftData.stats.verified || 0) + (shiftData.stats.approved || 0), color: '#10B981' },
                { label: 'Pending Review', val: shiftData.stats.pending || 0, color: '#F59E0B' },
                { label: 'Missing Punch', val: shiftData.stats.missing_punch || 0, color: '#EF4444' },
                { label: 'Flagged', val: shiftData.stats.flagged || 0, color: '#DC2626' },
                { label: 'Payable Hours', val: formatMinutes(shiftData.stats.totalPayableMinutes || 0), color: '#2ABBA7' },
              ].map(s => (
                <div key={s.label} style={{ flex: 1, minWidth: 120, padding: '0.75rem 1rem', background: '#F9FAFB', borderRadius: 12, borderLeft: `4px solid ${s.color}` }}>
                  <div style={{ fontSize: '1.25rem', fontWeight: 800, color: s.color }}>{s.val}</div>
                  <div style={{ fontSize: '0.7rem', color: '#6B7280', marginTop: 2 }}>{s.label}</div>
                </div>
              ))}
            </div>
          )}

          {/* Shift Filters */}
          {shiftData.shifts.length > 0 && (
            <div className="card" style={{ padding: '0.75rem 1rem' }}>
              <div style={{ display: 'flex', gap: '1rem', alignItems: 'center', flexWrap: 'wrap' }}>
                <div style={{ display: 'flex', gap: '0.25rem', flexWrap: 'wrap' }}>
                  {[
                    ['all', 'All'],
                    ['missing_punch', 'Missing Punch'],
                    ['pending', 'Pending'],
                    ['flagged', 'Flagged'],
                    ['verified', 'Verified'],
                    ['approved', 'Approved'],
                    ['manual_entry', 'Manual'],
                    ['excused', 'Excused'],
                  ].map(([val, label]) => (
                    <button key={val}
                      className={`filter-tab ${shiftFilter === val ? 'active' : ''}`}
                      onClick={() => setShiftFilter(val)}
                      style={{ fontSize: '0.78rem', padding: '0.3rem 0.6rem' }}>
                      {label}
                    </button>
                  ))}
                </div>
                <select value={caregiverFilter} onChange={e => setCaregiverFilter(e.target.value)}
                  style={{ padding: '0.35rem 0.5rem', borderRadius: 6, border: '1px solid #D1D5DB', fontSize: '0.82rem' }}>
                  <option value="all">All Caregivers</option>
                  {shiftCaregivers.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
                <button className="btn btn-sm btn-success" onClick={() => handleBulkApproveShifts('clocked')}
                  disabled={!shiftData.shifts.some(s => ['verified', 'pending'].includes(s.status) && s.time_entry_id)}>
                  Approve Clocked Shifts
                </button>
                <button className="btn btn-sm btn-warning" onClick={() => handleBulkApproveShifts('all')}
                  disabled={!shiftData.shifts.some(s => ['verified', 'pending', 'missing_punch'].includes(s.status))}>
                  Approve All at Scheduled Hours
                </button>
              </div>
            </div>
          )}

          {/* Shift Table */}
          {shiftData.shifts.length === 0 ? (
            <div className="card card-centered">
              <p>No shift data. Click "Reconcile Shifts" to match schedules against clock-ins for this pay period.</p>
            </div>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table className="table" style={{ fontSize: '0.82rem' }}>
                <thead>
                  <tr>
                    <th>Caregiver</th>
                    <th>Client</th>
                    <th>Date</th>
                    <th>Scheduled</th>
                    <th>Clocked</th>
                    <th>Payable</th>
                    <th>Status</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredShifts.map(shift => {
                    const sc = shiftStatusConfig[shift.status] || shiftStatusConfig.pending;
                    const discrepancy = shift.actual_minutes != null && shift.scheduled_minutes != null
                      ? shift.actual_minutes - shift.scheduled_minutes : null;

                    return (
                      <tr key={shift.id} style={{
                        background: shift.status === 'missing_punch' ? '#FFF5F5'
                          : shift.status === 'flagged' ? '#FFF5F5'
                          : shift.status === 'approved' || shift.status === 'verified' ? '#F0FDF4'
                          : undefined
                      }}>
                        <td style={{ fontWeight: 600 }}>{shift.caregiver_first} {shift.caregiver_last}</td>
                        <td>{shift.client_first} {shift.client_last}</td>
                        <td style={{ whiteSpace: 'nowrap' }}>
                          {new Date(String(shift.shift_date).split('T')[0] + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}
                        </td>
                        <td>
                          {shift.scheduled_start ? (
                            <span>{formatTime(shift.scheduled_start)}-{formatTime(shift.scheduled_end)}
                              <span style={{ color: '#6B7280', fontSize: '0.75rem' }}> ({formatMinutes(shift.scheduled_minutes)})</span>
                            </span>
                          ) : <span style={{ color: '#9CA3AF' }}>No schedule</span>}
                        </td>
                        <td>
                          {shift.actual_start ? (
                            <span>
                              {new Date(shift.actual_start).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}
                              {shift.actual_end && <> - {new Date(shift.actual_end).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}</>}
                              <span style={{ color: '#6B7280', fontSize: '0.75rem' }}> ({formatMinutes(shift.actual_minutes)})</span>
                              {discrepancy != null && Math.abs(discrepancy) >= 15 && (
                                <div style={{ fontSize: '0.7rem', fontWeight: 700, color: discrepancy > 0 ? '#DC2626' : '#F59E0B' }}>
                                  {formatMinutes(Math.abs(discrepancy))} {discrepancy > 0 ? 'over' : 'short'}
                                </div>
                              )}
                            </span>
                          ) : <span style={{ color: '#EF4444', fontWeight: 600 }}>-- No clock-in --</span>}
                        </td>
                        <td style={{ fontWeight: 700, color: '#2ABBA7' }}>
                          {shift.payable_minutes != null ? formatMinutes(shift.payable_minutes) : '--'}
                        </td>
                        <td>
                          <span style={{ display: 'inline-block', padding: '2px 8px', borderRadius: 6, fontSize: '0.73rem', fontWeight: 700, background: sc.bg, color: sc.color, whiteSpace: 'nowrap' }}>
                            {sc.icon} {sc.label}
                          </span>
                          {shift.resolution_notes && (
                            <div style={{ fontSize: '0.68rem', color: '#6B7280', marginTop: 2, maxWidth: 140 }} title={shift.resolution_notes}>
                              {shift.resolution_notes.substring(0, 30)}{shift.resolution_notes.length > 30 ? '...' : ''}
                            </div>
                          )}
                        </td>
                        <td>
                          <div style={{ display: 'flex', gap: '0.2rem', flexWrap: 'wrap' }}>
                            {['pending', 'verified'].includes(shift.status) && shift.time_entry_id && (
                              <button className="btn btn-sm btn-success" onClick={() => handleShiftAction(shift.id, 'approved')}>Approve</button>
                            )}
                            {shift.status === 'missing_punch' && (
                              <button className="btn btn-sm btn-warning" onClick={() => openResolveModal(shift)}>Resolve</button>
                            )}
                            {['pending', 'verified'].includes(shift.status) && (
                              <button className="btn btn-sm btn-secondary" onClick={() => handleShiftAction(shift.id, 'flagged', { flagReason: 'Needs review' })} style={{ fontSize: '0.7rem' }}>Flag</button>
                            )}
                            {shift.status === 'flagged' && (
                              <>
                                <button className="btn btn-sm btn-success" onClick={() => handleShiftAction(shift.id, 'approved')}>Approve</button>
                                <button className="btn btn-sm btn-warning" onClick={() => openResolveModal(shift)}>Resolve</button>
                              </>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* ==================== ATTENDANCE / ANALYTICS TAB ==================== */}
      {activeTab === 'analytics' && (
        <div>
          <p style={{ fontSize: '0.85rem', color: '#6B7280', marginBottom: '0.75rem' }}>
            Scheduled vs. clocked hours and punctuality for {payPeriod.startDate} to {payPeriod.endDate},
            from reconciled shifts. Run <strong>Reconcile Shifts</strong> first if this is empty.
          </p>
          {analyticsLoading ? (
            <div className="card card-centered"><p>Loading…</p></div>
          ) : (analytics.analytics || []).length === 0 ? (
            <div className="card card-centered"><p>No reconciled data for this period. Run "1. Reconcile Shifts" first.</p></div>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table className="table" style={{ fontSize: '0.85rem' }}>
                <thead>
                  <tr>
                    <th>Caregiver</th>
                    <th>Scheduled</th>
                    <th>Clocked</th>
                    <th>Payable</th>
                    <th>Reliability</th>
                    <th>Missing punch</th>
                    <th>Late in</th>
                    <th>Left early</th>
                    <th>Stayed late</th>
                  </tr>
                </thead>
                <tbody>
                  {analytics.analytics.map(r => (
                    <tr key={r.id}>
                      <td>{r.first_name} {r.last_name}</td>
                      <td>{formatHoursHM(r.scheduled_hours)}</td>
                      <td>{formatHoursHM(r.clocked_hours)}</td>
                      <td><strong>{formatHoursHM(r.payable_hours)}</strong></td>
                      <td>
                        <span style={{ fontWeight: 700, color:
                          r.reliability_pct == null ? '#9CA3AF'
                          : r.reliability_pct >= 90 ? '#059669'
                          : r.reliability_pct >= 70 ? '#D97706' : '#DC2626' }}>
                          {r.reliability_pct == null ? '—' : `${r.reliability_pct}%`}
                        </span>
                      </td>
                      <td>{parseInt(r.missing_punches) > 0
                        ? <span style={{ color: '#DC2626', fontWeight: 700 }}>{r.missing_punches}</span>
                        : '0'}</td>
                      <td>{parseInt(r.late_arrivals) > 0
                        ? `${r.late_arrivals}${r.avg_late_minutes ? ` (avg ${r.avg_late_minutes}m)` : ''}`
                        : '0'}</td>
                      <td>{r.early_departures}</td>
                      <td>{r.late_departures}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr style={{ fontWeight: 700, borderTop: '2px solid #E5E7EB' }}>
                    <td>Total</td>
                    <td>{formatHoursHM(analytics.totals.scheduled_hours)}</td>
                    <td>{formatHoursHM(analytics.totals.clocked_hours)}</td>
                    <td>{formatHoursHM(analytics.totals.payable_hours)}</td>
                    <td></td>
                    <td>{analytics.totals.missing_punches}</td>
                    <td>{analytics.totals.late_arrivals}</td>
                    <td>{analytics.totals.early_departures}</td>
                    <td></td>
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
        </div>
      )}

      {/* ==================== PAYROLL TAB ==================== */}
      {activeTab === 'payroll' && (
        <div>
          {/* Summary Cards */}
          <div className="grid">
            <div className="stat-card">
              <h3>Scheduled</h3>
              <div className="value">{formatHoursHM(totals.totalScheduledHours)}</div>
            </div>
            <div className="stat-card">
              <h3>Clocked In</h3>
              <div className="value">{formatHoursHM(totals.totalClockedHours)}</div>
            </div>
            <div className="stat-card">
              <h3>Payable Hours</h3>
              <div className="value" style={{ color: '#2ABBA7' }}>{formatHoursHM(totals.totalHours)}</div>
              <div className="stat-subtext">{formatHoursHM(totals.totalOvertimeHours)} overtime</div>
            </div>
            <div className="stat-card">
              <h3>Gross Pay</h3>
              <div className="value">{formatCurrency(totals.totalGrossPay)}</div>
            </div>
            <div className="stat-card">
              <h3>Net Pay</h3>
              <div className="value" style={{ color: '#28a745' }}>{formatCurrency(totals.totalNetPay)}</div>
            </div>
          </div>

          {payrollData.length > 0 && payrollData.some(p => parseInt(p.unresolved_shifts) > 0) && (
            <div style={{ background: '#FEF3C7', border: '1px solid #FCD34D', borderRadius: 12, padding: '0.75rem 1rem', marginBottom: '1rem', fontSize: '0.85rem', color: '#92400E' }}>
              <strong>Note:</strong> Some caregivers have unresolved shifts. Go to Shift Review to approve or resolve them before finalizing payroll.
            </div>
          )}

          {/* Status Filters */}
          <div className="card" style={{ padding: '0.75rem 1rem' }}>
            <div className="filter-tabs">
              {['all', 'draft', 'approved', 'processed', 'paid'].map(f => (
                <button key={f} className={`filter-tab ${filter === f ? 'active' : ''}`} onClick={() => setFilter(f)}>
                  {f.charAt(0).toUpperCase() + f.slice(1)}
                  <span className="filter-count">({payrollData.filter(p => f === 'all' || p.status === f).length})</span>
                </button>
              ))}
            </div>
          </div>

          {/* Payroll Table */}
          {loading ? (
            <div className="loading"><div className="spinner"></div></div>
          ) : payrollData.length === 0 ? (
            <div className="card card-centered"><p>No payroll data. Reconcile shifts first, then calculate payroll.</p></div>
          ) : (
            <table className="table">
              <thead>
                <tr>
                  <th>Caregiver</th>
                  <th>Scheduled</th>
                  <th>Clocked</th>
                  <th>Payable</th>
                  <th>OT</th>
                  <th>Shifts</th>
                  <th>Rate</th>
                  <th>Gross</th>
                  <th>Net</th>
                  <th>Status</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredPayroll.map(payroll => {
                  const hasUnresolved = parseInt(payroll.unresolved_shifts) > 0;
                  return (
                    <tr key={payroll.caregiver_id} style={{ background: hasUnresolved ? '#FFFBEB' : undefined }}>
                      <td><strong>{payroll.first_name} {payroll.last_name}</strong></td>
                      <td>{formatHoursHM(payroll.scheduled_hours)}</td>
                      <td>{formatHoursHM(payroll.clocked_hours)}</td>
                      <td style={{ color: '#2ABBA7', fontWeight: 700 }}>{formatHoursHM(payroll.total_hours)}</td>
                      <td style={{ color: payroll.overtime_hours > 0 ? '#fd7e14' : undefined }}>
                        {formatHoursHM(payroll.overtime_hours)}
                      </td>
                      <td>
                        <span style={{ color: '#10B981' }}>{payroll.approved_shifts}</span>
                        <span style={{ color: '#9CA3AF' }}>/{payroll.scheduled_shifts}</span>
                        {hasUnresolved && (
                          <div style={{ fontSize: '0.68rem', color: '#DC2626', fontWeight: 600 }}>
                            {payroll.unresolved_shifts} unresolved
                          </div>
                        )}
                      </td>
                      <td>${parseFloat(payroll.hourly_rate || 0).toFixed(2)}</td>
                      <td style={{ color: '#28a745' }}>{formatCurrency(payroll.gross_pay)}</td>
                      <td><strong style={{ color: '#2196f3' }}>{formatCurrency(payroll.net_pay)}</strong></td>
                      <td><span className={`badge ${getStatusBadge(payroll.status)}`}>{payroll.status?.toUpperCase()}</span></td>
                      <td>
                        <div style={{ display: 'flex', gap: '0.25rem', flexWrap: 'wrap' }}>
                          <button className="btn btn-sm btn-primary" onClick={() => generatePayStub(payroll)}>Stub</button>
                          {payroll.status === 'draft' && !hasUnresolved && (
                            <button className="btn btn-sm btn-warning" onClick={() => handleApprovePayroll(payroll.caregiver_id)}>Approve</button>
                          )}
                          {payroll.status === 'draft' && hasUnresolved && (
                            <button className="btn btn-sm btn-secondary" disabled title="Resolve shifts first">Review</button>
                          )}
                          {payroll.status === 'approved' && (
                            <button className="btn btn-sm btn-success" onClick={() => handleProcessPaycheck(payroll.caregiver_id)}>Process</button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}

          {/* Totals Footer */}
          {filteredPayroll.length > 0 && (
            <div className="card" style={{ marginTop: '1rem', background: '#f5f5f5' }}>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: '1rem' }}>
                <div><p style={{ margin: 0, fontSize: '0.85rem', color: '#666' }}>Scheduled</p><p style={{ margin: '0.25rem 0 0', fontSize: '1.2rem', fontWeight: 'bold' }}>{formatHoursHM(totals.totalScheduledHours)}</p></div>
                <div><p style={{ margin: 0, fontSize: '0.85rem', color: '#666' }}>Clocked</p><p style={{ margin: '0.25rem 0 0', fontSize: '1.2rem', fontWeight: 'bold' }}>{formatHoursHM(totals.totalClockedHours)}</p></div>
                <div><p style={{ margin: 0, fontSize: '0.85rem', color: '#666' }}>Payable</p><p style={{ margin: '0.25rem 0 0', fontSize: '1.2rem', fontWeight: 'bold', color: '#2ABBA7' }}>{formatHoursHM(totals.totalHours)}</p></div>
                <div><p style={{ margin: 0, fontSize: '0.85rem', color: '#666' }}>Overtime</p><p style={{ margin: '0.25rem 0 0', fontSize: '1.2rem', fontWeight: 'bold', color: '#fd7e14' }}>{formatHoursHM(totals.totalOvertimeHours)}</p></div>
                <div><p style={{ margin: 0, fontSize: '0.85rem', color: '#666' }}>Gross Pay</p><p style={{ margin: '0.25rem 0 0', fontSize: '1.2rem', fontWeight: 'bold', color: '#28a745' }}>{formatCurrency(totals.totalGrossPay)}</p></div>
                <div><p style={{ margin: 0, fontSize: '0.85rem', color: '#666' }}>Net Pay</p><p style={{ margin: '0.25rem 0 0', fontSize: '1.2rem', fontWeight: 'bold', color: '#2196f3' }}>{formatCurrency(totals.totalNetPay)}</p></div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ==================== RESOLVE MISSING PUNCH MODAL ==================== */}
      {showResolveModal && resolveShift && (
        <div className="modal active">
          <div className="modal-content">
            <div className="modal-header">
              <h2>Resolve Shift</h2>
              <button className="close-btn" onClick={() => setShowResolveModal(false)}>x</button>
            </div>
            <div style={{ background: '#FEF3C7', borderRadius: 8, padding: '0.75rem', marginBottom: '1rem', fontSize: '0.85rem' }}>
              <strong>{resolveShift.caregiver_first} {resolveShift.caregiver_last}</strong> was scheduled for{' '}
              <strong>{resolveShift.client_first} {resolveShift.client_last}</strong> on{' '}
              <strong>{new Date(String(resolveShift.shift_date).split('T')[0] + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}</strong>
              {resolveShift.scheduled_start && <> ({formatTime(resolveShift.scheduled_start)} - {formatTime(resolveShift.scheduled_end)}, {formatMinutes(resolveShift.scheduled_minutes)})</>}
              {' '}but did not clock in.
            </div>
            <form onSubmit={handleResolveShift}>
              <div className="form-group">
                <label>Resolution</label>
                <select value={resolveForm.status} onChange={e => setResolveForm({ ...resolveForm, status: e.target.value })}>
                  <option value="manual_entry">Manual Entry - They worked, enter hours</option>
                  <option value="excused">Excused Absence - No pay</option>
                  <option value="approved">Approve as Scheduled - Pay full scheduled hours</option>
                </select>
              </div>
              {resolveForm.status !== 'excused' && (
                <div className="form-group">
                  <label>Payable Minutes</label>
                  <input type="number" min="0" value={resolveForm.payableMinutes}
                    onChange={e => setResolveForm({ ...resolveForm, payableMinutes: e.target.value })} required />
                  <small style={{ color: '#6B7280' }}>
                    Scheduled: {resolveShift.scheduled_minutes || 0} min ({formatMinutes(resolveShift.scheduled_minutes)})
                  </small>
                </div>
              )}
              <div className="form-group">
                <label>Notes *</label>
                <textarea value={resolveForm.resolutionNotes}
                  onChange={e => setResolveForm({ ...resolveForm, resolutionNotes: e.target.value })}
                  rows="3" placeholder="Reason for resolution..." required />
              </div>
              <div className="modal-actions">
                <button type="submit" className="btn btn-primary">Resolve</button>
                <button type="button" className="btn btn-secondary" onClick={() => setShowResolveModal(false)}>Cancel</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ==================== PAY STUB MODAL ==================== */}
      {showPayStubModal && selectedPayroll && (
        <div className="modal active">
          <div className="modal-content modal-large" id="pay-stub">
            <div className="modal-header">
              <h2>Pay Stub</h2>
              <button className="close-btn" onClick={() => setShowPayStubModal(false)}>x</button>
            </div>
            <div style={{ border: '2px solid #333', padding: '1.5rem', background: 'white' }}>
              <div style={{ textAlign: 'center', marginBottom: '1.5rem', borderBottom: '2px solid #333', paddingBottom: '1rem' }}>
                <h2 style={{ margin: 0, color: '#1E9A89' }}>Chippewa Valley Home Care</h2>
                <p style={{ margin: '0.25rem 0 0', color: '#666' }}>Pay Statement</p>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', marginBottom: '1.5rem' }}>
                <div>
                  <p style={{ margin: 0 }}><strong>Employee:</strong> {selectedPayroll.first_name} {selectedPayroll.last_name}</p>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <p style={{ margin: 0 }}><strong>Pay Period:</strong> {payPeriod.startDate} to {payPeriod.endDate}</p>
                  <p style={{ margin: '0.25rem 0 0' }}><strong>Pay Date:</strong> {new Date().toLocaleDateString()}</p>
                  {selectedPayroll.check_number && <p style={{ margin: '0.25rem 0 0' }}><strong>Check #:</strong> {selectedPayroll.check_number}</p>}
                </div>
              </div>
              <div style={{ marginBottom: '1.5rem' }}>
                <h4 style={{ borderBottom: '1px solid #333', paddingBottom: '0.25rem', marginBottom: '0.5rem' }}>Earnings</h4>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr style={{ background: '#f0f0f0' }}>
                      <th style={{ padding: '0.5rem', textAlign: 'left', border: '1px solid #ddd' }}>Description</th>
                      <th style={{ padding: '0.5rem', textAlign: 'right', border: '1px solid #ddd' }}>Hours</th>
                      <th style={{ padding: '0.5rem', textAlign: 'right', border: '1px solid #ddd' }}>Rate</th>
                      <th style={{ padding: '0.5rem', textAlign: 'right', border: '1px solid #ddd' }}>Amount</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      <td style={{ padding: '0.5rem', border: '1px solid #ddd' }}>Regular Hours</td>
                      <td style={{ padding: '0.5rem', textAlign: 'right', border: '1px solid #ddd' }}>{(selectedPayroll.regular_hours || 0).toFixed(2)}</td>
                      <td style={{ padding: '0.5rem', textAlign: 'right', border: '1px solid #ddd' }}>${parseFloat(selectedPayroll.hourly_rate || 0).toFixed(2)}</td>
                      <td style={{ padding: '0.5rem', textAlign: 'right', border: '1px solid #ddd' }}>{formatCurrency(selectedPayroll.regular_pay)}</td>
                    </tr>
                    {selectedPayroll.overtime_hours > 0 && (
                      <tr>
                        <td style={{ padding: '0.5rem', border: '1px solid #ddd' }}>Overtime (1.5x)</td>
                        <td style={{ padding: '0.5rem', textAlign: 'right', border: '1px solid #ddd' }}>{(selectedPayroll.overtime_hours || 0).toFixed(2)}</td>
                        <td style={{ padding: '0.5rem', textAlign: 'right', border: '1px solid #ddd' }}>${(parseFloat(selectedPayroll.hourly_rate || 0) * settings.overtimeRate).toFixed(2)}</td>
                        <td style={{ padding: '0.5rem', textAlign: 'right', border: '1px solid #ddd' }}>{formatCurrency(selectedPayroll.overtime_pay)}</td>
                      </tr>
                    )}
                    {selectedPayroll.pto_pay > 0 && (
                      <tr>
                        <td style={{ padding: '0.5rem', border: '1px solid #ddd' }}>PTO</td>
                        <td style={{ padding: '0.5rem', textAlign: 'right', border: '1px solid #ddd' }}>{parseFloat(selectedPayroll.pto_hours || 0).toFixed(2)}</td>
                        <td style={{ padding: '0.5rem', textAlign: 'right', border: '1px solid #ddd' }}>${parseFloat(selectedPayroll.hourly_rate || 0).toFixed(2)}</td>
                        <td style={{ padding: '0.5rem', textAlign: 'right', border: '1px solid #ddd' }}>{formatCurrency(selectedPayroll.pto_pay)}</td>
                      </tr>
                    )}
                    {selectedPayroll.mileage_reimbursement > 0 && (
                      <tr>
                        <td style={{ padding: '0.5rem', border: '1px solid #ddd' }}>Mileage Reimbursement</td>
                        <td style={{ padding: '0.5rem', textAlign: 'right', border: '1px solid #ddd' }}>{parseFloat(selectedPayroll.total_miles || 0).toFixed(2)} mi</td>
                        <td style={{ padding: '0.5rem', textAlign: 'right', border: '1px solid #ddd' }}>${settings.mileageRate}/mi</td>
                        <td style={{ padding: '0.5rem', textAlign: 'right', border: '1px solid #ddd' }}>{formatCurrency(selectedPayroll.mileage_reimbursement)}</td>
                      </tr>
                    )}
                  </tbody>
                  <tfoot>
                    <tr style={{ background: '#f0f0f0', fontWeight: 'bold' }}>
                      <td colSpan="3" style={{ padding: '0.5rem', textAlign: 'right', border: '1px solid #ddd' }}>Gross Pay</td>
                      <td style={{ padding: '0.5rem', textAlign: 'right', border: '1px solid #ddd' }}>{formatCurrency(selectedPayroll.gross_pay)}</td>
                    </tr>
                  </tfoot>
                </table>
              </div>
              <div style={{ marginBottom: '1.5rem' }}>
                <h4 style={{ borderBottom: '1px solid #333', paddingBottom: '0.25rem', marginBottom: '0.5rem' }}>Deductions</h4>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <tbody>
                    <tr><td style={{ padding: '0.5rem', border: '1px solid #ddd' }}>Federal Income Tax</td><td style={{ padding: '0.5rem', textAlign: 'right', border: '1px solid #ddd' }}>{formatCurrency(selectedPayroll.federal_tax)}</td></tr>
                    <tr><td style={{ padding: '0.5rem', border: '1px solid #ddd' }}>State Income Tax (WI)</td><td style={{ padding: '0.5rem', textAlign: 'right', border: '1px solid #ddd' }}>{formatCurrency(selectedPayroll.state_tax)}</td></tr>
                    <tr><td style={{ padding: '0.5rem', border: '1px solid #ddd' }}>Social Security</td><td style={{ padding: '0.5rem', textAlign: 'right', border: '1px solid #ddd' }}>{formatCurrency(selectedPayroll.social_security)}</td></tr>
                    <tr><td style={{ padding: '0.5rem', border: '1px solid #ddd' }}>Medicare</td><td style={{ padding: '0.5rem', textAlign: 'right', border: '1px solid #ddd' }}>{formatCurrency(selectedPayroll.medicare)}</td></tr>
                  </tbody>
                  <tfoot>
                    <tr style={{ background: '#f0f0f0', fontWeight: 'bold' }}>
                      <td style={{ padding: '0.5rem', textAlign: 'right', border: '1px solid #ddd' }}>Total Deductions</td>
                      <td style={{ padding: '0.5rem', textAlign: 'right', border: '1px solid #ddd', color: '#dc3545' }}>{formatCurrency(selectedPayroll.total_deductions)}</td>
                    </tr>
                  </tfoot>
                </table>
              </div>
              <div style={{ background: '#e8f5e9', padding: '1rem', borderRadius: '8px', textAlign: 'center' }}>
                <h3 style={{ margin: 0, color: '#666' }}>Net Pay</h3>
                <p style={{ margin: '0.5rem 0 0', fontSize: '2rem', fontWeight: 'bold', color: '#28a745' }}>{formatCurrency(selectedPayroll.net_pay)}</p>
              </div>
            </div>
            <div className="modal-actions">
              <button className="btn btn-primary" onClick={() => window.print()}>Print</button>
              <button className="btn btn-secondary" onClick={() => setShowPayStubModal(false)}>Close</button>
            </div>
          </div>
        </div>
      )}

      {/* ==================== MILEAGE MODAL ==================== */}
      {showMileageModal && (
        <div className="modal active">
          <div className="modal-content">
            <div className="modal-header">
              <h2>Add Mileage</h2>
              <button className="close-btn" onClick={() => setShowMileageModal(false)}>x</button>
            </div>
            <form onSubmit={handleAddMileage}>
              <div className="form-group">
                <label>Caregiver *</label>
                <select value={mileageForm.caregiverId} onChange={(e) => setMileageForm({ ...mileageForm, caregiverId: e.target.value })} required>
                  <option value="">Select caregiver...</option>
                  {caregivers.map(c => <option key={c.id} value={c.id}>{c.first_name} {c.last_name}</option>)}
                </select>
              </div>
              <div className="form-grid-2">
                <div className="form-group"><label>Date *</label><input type="date" value={mileageForm.date} onChange={(e) => setMileageForm({ ...mileageForm, date: e.target.value })} required /></div>
                <div className="form-group"><label>Miles *</label><input type="number" step="0.1" min="0" value={mileageForm.miles} onChange={(e) => setMileageForm({ ...mileageForm, miles: e.target.value })} required /></div>
                <div className="form-group"><label>From</label><input type="text" value={mileageForm.fromLocation} onChange={(e) => setMileageForm({ ...mileageForm, fromLocation: e.target.value })} placeholder="Starting location" /></div>
                <div className="form-group"><label>To</label><input type="text" value={mileageForm.toLocation} onChange={(e) => setMileageForm({ ...mileageForm, toLocation: e.target.value })} placeholder="Destination" /></div>
              </div>
              <div className="form-group"><label>Notes</label><textarea value={mileageForm.notes} onChange={(e) => setMileageForm({ ...mileageForm, notes: e.target.value })} rows="2" /></div>
              <p className="text-muted">Current IRS rate: ${settings.mileageRate}/mile</p>
              <div className="modal-actions">
                <button type="submit" className="btn btn-primary">Add Mileage</button>
                <button type="button" className="btn btn-secondary" onClick={() => setShowMileageModal(false)}>Cancel</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ==================== PTO MODAL ==================== */}
      {showPTOModal && (
        <div className="modal active">
          <div className="modal-content">
            <div className="modal-header">
              <h2>Add PTO / Time Off</h2>
              <button className="close-btn" onClick={() => setShowPTOModal(false)}>x</button>
            </div>
            <form onSubmit={handleAddPTO}>
              <div className="form-group">
                <label>Caregiver *</label>
                <select value={ptoForm.caregiverId} onChange={(e) => setPtoForm({ ...ptoForm, caregiverId: e.target.value })} required>
                  <option value="">Select caregiver...</option>
                  {caregivers.map(c => <option key={c.id} value={c.id}>{c.first_name} {c.last_name}</option>)}
                </select>
              </div>
              <div className="form-group">
                <label>Type *</label>
                <select value={ptoForm.type} onChange={(e) => setPtoForm({ ...ptoForm, type: e.target.value })}>
                  <option value="vacation">Vacation</option>
                  <option value="sick">Sick Leave</option>
                  <option value="personal">Personal Day</option>
                  <option value="bereavement">Bereavement</option>
                  <option value="jury_duty">Jury Duty</option>
                  <option value="unpaid">Unpaid Leave</option>
                </select>
              </div>
              <div className="form-grid-2">
                <div className="form-group"><label>Start Date *</label><input type="date" value={ptoForm.startDate} onChange={(e) => setPtoForm({ ...ptoForm, startDate: e.target.value })} required /></div>
                <div className="form-group"><label>End Date *</label><input type="date" value={ptoForm.endDate} onChange={(e) => setPtoForm({ ...ptoForm, endDate: e.target.value })} required /></div>
              </div>
              <div className="form-group"><label>Hours *</label><input type="number" step="0.5" min="0" value={ptoForm.hours} onChange={(e) => setPtoForm({ ...ptoForm, hours: e.target.value })} required /></div>
              <div className="form-group"><label>Notes</label><textarea value={ptoForm.notes} onChange={(e) => setPtoForm({ ...ptoForm, notes: e.target.value })} rows="2" /></div>
              <div className="modal-actions">
                <button type="submit" className="btn btn-primary">Add PTO</button>
                <button type="button" className="btn btn-secondary" onClick={() => setShowPTOModal(false)}>Cancel</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ==================== SETTINGS MODAL ==================== */}
      {showSettingsModal && (
        <div className="modal active">
          <div className="modal-content modal-large">
            <div className="modal-header">
              <h2>Payroll Settings</h2>
              <button className="close-btn" onClick={() => setShowSettingsModal(false)}>x</button>
            </div>
            <div className="form-section">
              <h3>Overtime Rules</h3>
              <div className="form-grid-2">
                <div className="form-group"><label>Weekly OT Threshold (hours)</label><input type="number" value={settings.overtimeThreshold} onChange={(e) => setSettings({ ...settings, overtimeThreshold: parseFloat(e.target.value) })} /></div>
                <div className="form-group"><label>OT Rate Multiplier</label><input type="number" step="0.1" value={settings.overtimeRate} onChange={(e) => setSettings({ ...settings, overtimeRate: parseFloat(e.target.value) })} /></div>
              </div>
            </div>
            <div className="form-section">
              <h3>Shift Differentials</h3>
              <div className="form-grid-2">
                <div className="form-group"><label>Weekend Differential ($/hr)</label><input type="number" step="0.25" value={settings.weekendDifferential} onChange={(e) => setSettings({ ...settings, weekendDifferential: parseFloat(e.target.value) })} /></div>
                <div className="form-group"><label>Night Differential ($/hr)</label><input type="number" step="0.25" value={settings.nightDifferential} onChange={(e) => setSettings({ ...settings, nightDifferential: parseFloat(e.target.value) })} /></div>
              </div>
            </div>
            <div className="form-section">
              <h3>Mileage</h3>
              <div className="form-group"><label>Mileage Rate ($/mile)</label><input type="number" step="0.01" value={settings.mileageRate} onChange={(e) => setSettings({ ...settings, mileageRate: parseFloat(e.target.value) })} /><small className="text-muted">2024 IRS standard rate is $0.67/mile</small></div>
            </div>
            <div className="form-section">
              <h3>Tax Rates</h3>
              <div className="form-grid-2">
                <div className="form-group"><label>Federal Tax Rate (%)</label><input type="number" step="0.01" value={(settings.federalTaxRate * 100).toFixed(2)} onChange={(e) => setSettings({ ...settings, federalTaxRate: parseFloat(e.target.value) / 100 })} /></div>
                <div className="form-group"><label>State Tax Rate (%)</label><input type="number" step="0.01" value={(settings.stateTaxRate * 100).toFixed(2)} onChange={(e) => setSettings({ ...settings, stateTaxRate: parseFloat(e.target.value) / 100 })} /></div>
                <div className="form-group"><label>Social Security (%)</label><input type="number" step="0.01" value={(settings.socialSecurityRate * 100).toFixed(2)} onChange={(e) => setSettings({ ...settings, socialSecurityRate: parseFloat(e.target.value) / 100 })} /></div>
                <div className="form-group"><label>Medicare (%)</label><input type="number" step="0.01" value={(settings.medicareRate * 100).toFixed(2)} onChange={(e) => setSettings({ ...settings, medicareRate: parseFloat(e.target.value) / 100 })} /></div>
              </div>
            </div>
            <div className="modal-actions">
              <button className="btn btn-primary" onClick={() => { setShowSettingsModal(false); calculatePayroll(); }}>Save & Recalculate</button>
              <button className="btn btn-secondary" onClick={() => setShowSettingsModal(false)}>Cancel</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default PayrollProcessing;
