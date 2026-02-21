// src/components/admin/DashboardOverview.jsx
import React, { useState, useEffect } from 'react';
import { getDashboardReferrals, getDashboardHours } from '../../config';

const DashboardOverview = ({ summary, token, onNavigate }) => {
  const [referrals, setReferrals] = useState([]);
  const [caregiverHours, setCaregiverHours] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadAnalytics();
  }, []);

  const loadAnalytics = async () => {
    try {
      const [refData, hourData] = await Promise.all([
        getDashboardReferrals(token),
        getDashboardHours(token)
      ]);
      setReferrals(refData);
      setCaregiverHours(hourData);
    } catch (error) {
      console.error('Failed to load analytics:', error);
    } finally {
      setLoading(false);
    }
  };

  // Helper to safely format currency (handles strings from PostgreSQL)
  const formatCurrency = (value) => {
    const num = parseFloat(value) || 0;
    return num.toFixed(2);
  };

  if (loading) return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: "1rem" }}>
      {[1,2,3,4].map(i => (
        <div key={i} style={{ height: "80px", borderRadius: "10px", background: "linear-gradient(90deg, #f0f0f0 25%, #e8e8e8 50%, #f0f0f0 75%)", backgroundSize: "200% 100%", animation: "shimmer 1.5s infinite" }} />
      ))}
      <style>{"@keyframes shimmer { 0%{background-position:200% 0} 100%{background-position:-200% 0} }"}</style>
    </div>
  );

  return (
    <>
      {/* Key Metrics */}
      <div className="grid">
        <div className="stat-card">
          <h3>Active Clients</h3>
          <div className="value">{summary?.totalClients || 0}</div>
        </div>
        <div className="stat-card">
          <h3>Active Caregivers</h3>
          <div className="value">{summary?.activeCaregivers || 0}</div>
        </div>
        <div className="stat-card">
          <h3>Pending Invoices</h3>
          <div className="value value-danger">
            ${formatCurrency(summary?.pendingInvoices?.amount)}
          </div>
          <p className="stat-subtext">
            {summary?.pendingInvoices?.count || 0} invoices
          </p>
        </div>
        <div className="stat-card">
          <h3>This Month Revenue</h3>
          <div className="value value-success">
            ${formatCurrency(summary?.thisMonthRevenue)}
          </div>
        </div>
      </div>

      {/* Referral Sources Performance */}
      <div className="card">
        <div className="card-title">🏥 Referral Sources Performance</div>
        
        {referrals.length === 0 ? (
          <p className="card-empty-state">No referral data yet</p>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>Referral Source</th>
                <th>Type</th>
                <th>Referrals</th>
                <th>Revenue</th>
              </tr>
            </thead>
            <tbody>
              {referrals.map(ref => (
                <tr key={ref.name}>
                  <td><strong>{ref.name}</strong></td>
                  <td>
                    <span className="badge badge-info">
                      {ref.type || 'General'}
                    </span>
                  </td>
                  <td>{ref.referral_count || 0}</td>
                  <td>${formatCurrency(ref.total_revenue)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Caregiver Hours & Performance */}
      <div className="card">
        <div className="card-title">👔 Caregiver Hours & Performance</div>
        
        {caregiverHours.length === 0 ? (
          <p className="card-empty-state">No caregiver data yet</p>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>Caregiver</th>
                <th>Shifts</th>
                <th>Total Hours</th>
                <th>Avg Satisfaction</th>
              </tr>
            </thead>
            <tbody>
              {caregiverHours.map(cg => (
                <tr key={cg.id}>
                  <td><strong>{cg.first_name} {cg.last_name}</strong></td>
                  <td>{cg.shifts || 0}</td>
                  <td>{cg.total_hours || 0} hrs</td>
                  <td>
                    {cg.avg_satisfaction ? (
                      <>
                        <span className="star-icon">★</span> {parseFloat(cg.avg_satisfaction).toFixed(2)}
                      </>
                    ) : (
                      'N/A'
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Today Panel */}
      <div className="card" style={{ marginBottom: '1rem' }}>
        <div className="card-title">📅 Today — {new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '0.75rem' }}>
          {[
            { label: 'Shifts Today', value: summary?.todayShifts || 0, icon: '📋', color: '#2563EB' },
            { label: 'Clocked In Now', value: summary?.activeCaregivers || 0, icon: '✅', color: '#16A34A' },
            { label: 'Shifts Remaining', value: summary?.remainingShifts || 0, icon: '⏰', color: '#D97706' },
            { label: 'Coverage Gaps', value: summary?.coverageGaps || 0, icon: '🚨', color: summary?.coverageGaps > 0 ? '#DC2626' : '#16A34A' },
          ].map(s => (
            <div key={s.label} style={{ padding: '0.75rem', background: '#F9FAFB', borderRadius: '8px', textAlign: 'center', border: '1px solid #E5E7EB' }}>
              <div style={{ fontSize: '1.3rem' }}>{s.icon}</div>
              <div style={{ fontSize: '1.5rem', fontWeight: '800', color: s.color, lineHeight: 1.1 }}>{s.value}</div>
              <div style={{ fontSize: '0.72rem', color: '#6B7280', fontWeight: '600', marginTop: '0.2rem' }}>{s.label}</div>
            </div>
          ))}
        </div>
        {summary?.coverageGaps > 0 && (
          <div style={{ marginTop: '0.75rem', padding: '0.6rem 0.875rem', background: '#FEF2F2', borderRadius: '6px', border: '1px solid #FCA5A5', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: '0.875rem', color: '#DC2626', fontWeight: '600' }}>
              ⚠️ {summary.coverageGaps} shift{summary.coverageGaps !== 1 ? 's' : ''} need{summary.coverageGaps === 1 ? 's' : ''} coverage
            </span>
            <button onClick={() => onNavigate && onNavigate('emergency-coverage')}
              style={{ padding: '0.3rem 0.75rem', background: '#DC2626', color: '#fff', border: 'none', borderRadius: '6px', cursor: 'pointer', fontSize: '0.8rem', fontWeight: '600' }}>
              Find Coverage →
            </button>
          </div>
        )}
      </div>

      {/* Quick Actions */}
      <div className="card">
        <div className="card-title">⚡ Quick Actions</div>
        <div className="quick-actions-grid">
          <button className="btn btn-primary" onClick={() => onNavigate && onNavigate('onboarding')}>➕ New Client</button>
          <button className="btn btn-primary" onClick={() => onNavigate && onNavigate('caregivers')}>➕ New Caregiver</button>
          <button className="btn btn-primary" onClick={() => onNavigate && onNavigate('billing')}>📄 Billing</button>
          <button className="btn btn-primary" onClick={() => onNavigate && onNavigate('reports')}>📊 Reports</button>
          <button className="btn btn-primary" onClick={() => onNavigate && onNavigate('emergency-coverage')}>🚨 Emergency Coverage</button>
          <button className="btn btn-primary" onClick={() => onNavigate && onNavigate('background-checks')}>🔍 Background Checks</button>
        </div>
      </div>
    </>
  );
};

export default DashboardOverview;
