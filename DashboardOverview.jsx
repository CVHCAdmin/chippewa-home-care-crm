// src/components/admin/DashboardOverview.jsx
import React, { useState, useEffect } from 'react';
import { getDashboardReferrals, getDashboardHours } from '../../config';

const DashboardOverview = ({ summary, token }) => {
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
          <div className="value" style={{ color: '#dc3545' }}>
            ${summary?.pendingInvoices?.amount?.toFixed(2) || '0.00'}
          </div>
          <p style={{ fontSize: '0.85rem', marginTop: '0.5rem' }}>
            {summary?.pendingInvoices?.count || 0} invoices
          </p>
        </div>
        <div className="stat-card">
          <h3>This Month Revenue</h3>
          <div className="value" style={{ color: '#28a745' }}>
            ${summary?.thisMonthRevenue?.toFixed(2) || '0.00'}
          </div>
        </div>
      </div>

      {/* Referral Sources Performance */}
      <div className="card">
        <div className="card-title">🏥 Referral Sources Performance</div>
        
        {referrals.length === 0 ? (
          <p style={{ textAlign: 'center', color: 'var(--color-text-light)' }}>No referral data yet</p>
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
                  <td>${(ref.total_revenue || 0).toFixed(2)}</td>
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
          <p style={{ textAlign: 'center', color: 'var(--color-text-light)' }}>No caregiver data yet</p>
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
                        <span style={{ color: '#FFB800' }}>★</span> {cg.avg_satisfaction.toFixed(1)}
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

      {/* Quick Actions */}
      <div className="card">
        <div className="card-title">⚡ Quick Actions</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '1rem' }}>
          <button className="btn btn-primary">
            ➕ Add New Client
          </button>
          <button className="btn btn-primary">
            ➕ Add New Caregiver
          </button>
          <button className="btn btn-primary">
            📄 Generate Invoices
          </button>
          <button className="btn btn-primary">
            📊 Export Reports
          </button>
        </div>
      </div>
    </>
  );
};

export default DashboardOverview;
