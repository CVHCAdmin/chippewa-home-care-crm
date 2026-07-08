import { toast } from '../Toast';
// src/components/admin/ReportsAnalytics.jsx
import React, { useState, useEffect } from 'react';
import { API_BASE_URL } from '../../config';
import { formatDate } from '../../utils/datetime';

const ReportsAnalytics = ({ token }) => {
  const [reportType, setReportType] = useState('overview');
  const [dateRange, setDateRange] = useState({
    startDate: new Date(new Date().setMonth(new Date().getMonth() - 1)).toISOString().split('T')[0],
    endDate: new Date().toISOString().split('T')[0]
  });
  const [reportData, setReportData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [caregiverFilter, setCaregiverFilter] = useState('');
  const [clientFilter, setClientFilter] = useState('');
  const [caregivers, setCaregivers] = useState([]);
  const [clients, setClients] = useState([]);

  useEffect(() => {
    loadFilters();
  }, []);

  useEffect(() => {
    if (reportType) {
      generateReport();
    }
  }, [reportType, dateRange, caregiverFilter, clientFilter]);

  const loadFilters = async () => {
    try {
      const [cgRes, clRes] = await Promise.all([
        fetch(`${API_BASE_URL}/api/users/caregivers`, {
          headers: { 'Authorization': `Bearer ${token}` }
        }),
        fetch(`${API_BASE_URL}/api/clients`, {
          headers: { 'Authorization': `Bearer ${token}` }
        })
      ]);
      if (!cgRes.ok || !clRes.ok) throw new Error('Failed to load filters');
      const caregiverData = await cgRes.json();
      const clientData = await clRes.json();
      setCaregivers(Array.isArray(caregiverData) ? caregiverData : []);
      setClients(Array.isArray(clientData) ? clientData : []);
    } catch (error) {
      console.error('Failed to load filters:', error);
    }
  };

  // New GET-style drill-down reports added later — different endpoint shape
  const GET_REPORTS = new Set(['pnl', 'hours-by-payer', 'caregiver-utilization', 'client-visits-summary', 'client-revenue-by-month', 'client-incidents']);

  const generateReport = async () => {
    setLoading(true);
    try {
      const isGet = GET_REPORTS.has(reportType);
      const url = isGet
        ? `${API_BASE_URL}/api/reports/${reportType}?startDate=${encodeURIComponent(dateRange.startDate)}&endDate=${encodeURIComponent(dateRange.endDate)}`
        : `${API_BASE_URL}/api/reports/${reportType}`;
      const response = await fetch(url, {
        method: isGet ? 'GET' : 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: isGet ? undefined : JSON.stringify({
          startDate: dateRange.startDate,
          endDate: dateRange.endDate,
          caregiverId: caregiverFilter || null,
          clientId: clientFilter || null
        })
      });
      if (!response.ok) throw new Error('Failed to generate report');
      const data = await response.json();
      setReportData(data);
    } catch (error) {
      console.error('Failed to generate report:', error);
    } finally {
      setLoading(false);
    }
  };

  const exportReport = async (format) => {
    try {
      // GET-style drill-downs support ?format=csv directly; everything else
      // goes through the legacy POST /export endpoint.
      let url, method = 'GET', body = undefined;
      if (GET_REPORTS.has(reportType) && format === 'csv') {
        url = `${API_BASE_URL}/api/reports/${reportType}?startDate=${encodeURIComponent(dateRange.startDate)}&endDate=${encodeURIComponent(dateRange.endDate)}&format=csv`;
      } else {
        url = format === 'pdf'
          ? `${API_BASE_URL}/api/reports/${reportType}/export-pdf`
          : `${API_BASE_URL}/api/reports/${reportType}/export`;
        method = 'POST';
        body = JSON.stringify({ startDate: dateRange.startDate, endDate: dateRange.endDate,
          caregiverId: caregiverFilter || null, clientId: clientFilter || null, format });
      }
      const response = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body,
      });
      if (!response.ok) throw new Error('Export failed');
      const blob = await response.blob();
      const blobUrl = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = blobUrl;
      a.download = `cvhc-${reportType}-report-${dateRange.startDate}-to-${dateRange.endDate}.${format}`;
      a.click();
      window.URL.revokeObjectURL(blobUrl);
      toast(`${format.toUpperCase()} export downloaded!`, 'success');
    } catch (error) {
      toast('Failed to export: ' + error.message, 'error');
    }
  };

  const renderOverviewReport = () => {
    if (!reportData) return null;
    const { summary = {}, topCaregivers, topClients } = reportData;

    return (
      <div>
        {/* Key Metrics */}
        <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))' }}>
          <div className="stat-card">
            <h3>Total Hours</h3>
            <div className="value">{Number(parseFloat(summary.totalHours || 0)).toFixed(2)}</div>
            <p className="stat-subtext">Across all caregivers</p>
          </div>
          <div className="stat-card">
            <h3>Total Revenue</h3>
            <div className="value value-success">
              ${Number(parseFloat(summary.totalRevenue || 0)).toFixed(2)}
            </div>
            <p className="stat-subtext">Billable hours</p>
          </div>
          <div className="stat-card">
            <h3>Active Shifts</h3>
            <div className="value">{summary.totalShifts || 0}</div>
            <p className="stat-subtext">Completed</p>
          </div>
          <div className="stat-card">
            <h3>Avg Satisfaction</h3>
            <div className="value">
              {summary.avgSatisfaction ? `${Number(parseFloat(summary.avgSatisfaction || 0)).toFixed(2)}⭐` : 'N/A'}
            </div>
            <p className="stat-subtext">Client ratings</p>
          </div>
        </div>

        {/* Top Caregivers */}
        <div className="card">
          <h3>📊 Top Performing Caregivers</h3>
          {topCaregivers && topCaregivers.length > 0 ? (
            <table className="table">
              <thead>
                <tr>
                  <th>Caregiver</th>
                  <th>Hours</th>
                  <th>Est. Labor Cost</th>
                  <th>Avg Rating</th>
                  <th>Clients</th>
                </tr>
              </thead>
              <tbody>
                {topCaregivers.map(cg => (
                  <tr key={cg.id}>
                    <td><strong>{cg.first_name} {cg.last_name}</strong></td>
                    <td>{Number(parseFloat(cg.total_hours || 0)).toFixed(2)} hrs</td>
                    <td>${Number(parseFloat(cg.est_labor_cost || 0)).toFixed(2)}</td>
                    <td>
                      {cg.avg_satisfaction ? (
                        <span>⭐ {Number(parseFloat(cg.avg_satisfaction || 0)).toFixed(2)}</span>
                      ) : (
                        'N/A'
                      )}
                    </td>
                    <td>{cg.clients_served || 0}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p>No caregiver data available</p>
          )}
        </div>

        {/* Top Clients */}
        <div className="card">
          <h3>👥 Most Active Clients</h3>
          {topClients && topClients.length > 0 ? (
            <table className="table">
              <thead>
                <tr>
                  <th>Client</th>
                  <th>Service Type</th>
                  <th>Hours</th>
                  <th>Revenue (billed)</th>
                  <th>Assigned Caregivers</th>
                </tr>
              </thead>
              <tbody>
                {topClients.map(cl => (
                  <tr key={cl.id}>
                    <td><strong>{cl.first_name} {cl.last_name}</strong></td>
                    <td>
                      <span className="badge badge-success">
                        {cl.service_type?.replace('_', ' ').toUpperCase() || 'N/A'}
                      </span>
                    </td>
                    <td>{Number(parseFloat(cl.total_hours || 0)).toFixed(2)} hrs</td>
                    <td>${Number(parseFloat(cl.revenue || 0)).toFixed(2)}</td>
                    <td>{cl.caregiver_count || 0}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p>No client data available</p>
          )}
        </div>
      </div>
    );
  };

  const renderHoursReport = () => {
    if (!reportData) return null;
    const { hoursByWeek, hoursByType, caregiverBreakdown } = reportData;

    return (
      <div>
        <div className="grid" style={{ gridTemplateColumns: '1fr 1fr' }}>
          <div className="card">
            <h3>Hours by Service Type</h3>
            {hoursByType && hoursByType.length > 0 ? (
              <table className="table">
                <thead>
                  <tr>
                    <th>Service Type</th>
                    <th>Hours</th>
                    <th>Percentage</th>
                  </tr>
                </thead>
                <tbody>
                  {hoursByType.map((type, idx) => (
                    <tr key={idx}>
                      <td>{type.service_type?.replace('_', ' ').toUpperCase() || 'N/A'}</td>
                      <td>{Number(parseFloat(type.hours || 0)).toFixed(2)}</td>
                      <td>
                        <div style={{ width: '100px', height: '6px', background: '#e0e0e0', borderRadius: '3px', overflow: 'hidden' }}>
                          <div style={{ width: `${parseFloat(type.percentage) || 0}%`, height: '100%', background: '#2196f3' }}></div>
                        </div>
                        <small>{Number(parseFloat(type.percentage || 0)).toFixed(2)}%</small>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <p>No data available</p>
            )}
          </div>

          <div className="card">
            <h3>Hours by Week</h3>
            {hoursByWeek && hoursByWeek.length > 0 ? (
              <table className="table">
                <thead>
                  <tr>
                    <th>Week</th>
                    <th>Hours</th>
                  </tr>
                </thead>
                <tbody>
                  {hoursByWeek.map((week, idx) => (
                    <tr key={idx}>
                      <td>{week.week}</td>
                      <td>{Number(parseFloat(week.hours || 0)).toFixed(2)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <p>No data available</p>
            )}
          </div>
        </div>

        <div className="card">
          <h3>Caregiver Hours Breakdown</h3>
          {caregiverBreakdown && caregiverBreakdown.length > 0 ? (
            <table className="table">
              <thead>
                <tr>
                  <th>Caregiver</th>
                  <th>Regular Hours</th>
                  <th>Overtime Hours</th>
                  <th>Total</th>
                  <th>Utilization</th>
                </tr>
              </thead>
              <tbody>
                {caregiverBreakdown.map(cg => {
                  const regularHours = parseFloat(cg.regular_hours) || 0;
                  const overtimeHours = parseFloat(cg.overtime_hours) || 0;
                  const totalHours = parseFloat(cg.total_hours) || 0;
                  return (
                    <tr key={cg.id}>
                      <td><strong>{cg.first_name} {cg.last_name}</strong></td>
                      <td>{Number(parseFloat(regularHours || 0)).toFixed(2)}</td>
                      <td className={overtimeHours > 0 ? 'value-warning' : ''}>{Number(parseFloat(overtimeHours || 0)).toFixed(2)}</td>
                      <td><strong>{Number(parseFloat(totalHours || 0)).toFixed(2)}</strong></td>
                      <td>
                        <div style={{ width: '100px', height: '6px', background: '#e0e0e0', borderRadius: '3px', overflow: 'hidden' }}>
                          <div style={{ 
                            width: `${Math.min((totalHours / 40) * 100, 100)}%`, 
                            height: '100%', 
                            background: totalHours > 40 ? '#ff9800' : '#4caf50' 
                          }}></div>
                        </div>
                        <small>{Number((totalHours / 40) * 100).toFixed(0)}%</small>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          ) : (
            <p>No caregiver data available</p>
          )}
        </div>
      </div>
    );
  };

  const renderPerformanceReport = () => {
    if (!reportData) return null;
    const { performance } = reportData;

    return (
      <div>
        <div className="card">
          <h3>Caregiver Performance Metrics</h3>
          {performance && performance.length > 0 ? (
            <table className="table">
              <thead>
                <tr>
                  <th>Caregiver</th>
                  <th>Avg Rating</th>
                  <th>Attendance</th>
                  <th>Incidents</th>
                  <th>Training Hours</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {performance.map(perf => {
                  const avgRating = parseFloat(perf.avg_rating) || 0;
                  const attendanceRate = parseFloat(perf.attendance_rate) || 0;
                  const trainingHours = parseFloat(perf.training_hours) || 0;
                  const performanceScore = parseFloat(perf.performance_score) || 0;
                  return (
                    <tr key={perf.id}>
                      <td><strong>{perf.first_name} {perf.last_name}</strong></td>
                      <td>
                        {perf.avg_rating ? (
                          <span style={{ fontSize: '1.1em' }}>
                            ⭐ {Number(parseFloat(avgRating || 0)).toFixed(2)} ({perf.rating_count || 0})
                          </span>
                        ) : (
                          'N/A'
                        )}
                      </td>
                      <td>
                        <span className={attendanceRate >= 95 ? 'value-success' : 'value-warning'}>
                          {Number(parseFloat(attendanceRate || 0)).toFixed(2)}%
                        </span>
                      </td>
                      <td>
                        {(perf.incident_count || 0) > 0 ? (
                          <span className="value-danger">{perf.incident_count}</span>
                        ) : (
                          '0 ✓'
                        )}
                      </td>
                      <td>{Number(parseFloat(trainingHours || 0)).toFixed(2)}</td>
                      <td>
                        <span className={`badge ${performanceScore >= 85 ? 'badge-success' : performanceScore >= 70 ? 'badge-warning' : 'badge-danger'}`}>
                          {Number(parseFloat(performanceScore || 0)).toFixed(0)}/100
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          ) : (
            <p>No performance data available</p>
          )}
        </div>
      </div>
    );
  };

  const renderSatisfactionReport = () => {
    if (!reportData) return null;
    const { satisfaction = {}, trends } = reportData;
    const distribution = satisfaction.distribution || {};

    return (
      <div>
        <div className="grid" style={{ gridTemplateColumns: '1fr 1fr' }}>
          <div className="stat-card">
            <h3>Overall Satisfaction</h3>
            <div className="value" style={{ fontSize: '3rem' }}>
              {satisfaction.overall ? Number(parseFloat(satisfaction.overall || 0)).toFixed(2) : 'N/A'}⭐
            </div>
            <p className="stat-subtext">{satisfaction.total_ratings || 0} ratings</p>
          </div>

          <div className="stat-card">
            <h3>Satisfaction Distribution</h3>
            <div style={{ fontSize: '0.9rem' }}>
              <p>5 ⭐: {distribution[5] || 0}</p>
              <p>4 ⭐: {distribution[4] || 0}</p>
              <p>3 ⭐: {distribution[3] || 0}</p>
              <p>2 ⭐: {distribution[2] || 0}</p>
              <p>1 ⭐: {distribution[1] || 0}</p>
            </div>
          </div>
        </div>

        <div className="card">
          <h3>Satisfaction Trends</h3>
          {trends && trends.length > 0 ? (
            <table className="table">
              <thead>
                <tr>
                  <th>Period</th>
                  <th>Avg Rating</th>
                  <th>Trend</th>
                  <th>Ratings</th>
                </tr>
              </thead>
              <tbody>
                {trends.map((trend, idx) => {
                  const rating = parseFloat(trend.rating) || 0;
                  const change = parseFloat(trend.change) || 0;
                  return (
                    <tr key={idx}>
                      <td>{trend.period}</td>
                      <td>⭐ {Number(parseFloat(rating || 0)).toFixed(2)}</td>
                      <td>
                        {change > 0 ? (
                          <span style={{ color: '#4caf50' }}>↑ {Number(parseFloat(change || 0)).toFixed(2)}</span>
                        ) : change < 0 ? (
                          <span style={{ color: '#f44336' }}>↓ {Number(parseFloat(Math.abs(change) || 0)).toFixed(2)}</span>
                        ) : (
                          <span style={{ color: '#999' }}>→ Stable</span>
                        )}
                      </td>
                      <td>{trend.count || 0}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          ) : (
            <p>No satisfaction data available</p>
          )}
        </div>

        <div className="card">
          <h3>Feedback Themes</h3>
          {satisfaction.feedback_themes && satisfaction.feedback_themes.length > 0 ? (
            <div style={{ display: 'grid', gap: '1rem' }}>
              {satisfaction.feedback_themes.map((theme, idx) => (
                <div key={idx} style={{ padding: '1rem', background: '#f5f5f5', borderRadius: '6px' }}>
                  <strong>{theme.theme}</strong>
                  <p style={{ margin: '0.5rem 0 0 0', fontSize: '0.9rem', color: '#666' }}>
                    Mentioned {theme.count || 0} times
                  </p>
                </div>
              ))}
            </div>
          ) : (
            <p>No feedback themes available</p>
          )}
        </div>
      </div>
    );
  };

  const money = (n) => `$${Number(parseFloat(n || 0)).toFixed(2)}`;
  const renderRevenueReport = () => {
    if (!reportData) return null;
    const { revenue = {}, ar = {}, byPayer = [], byClient = [], byServiceType = [] } = reportData;
    const revenueTotal = parseFloat(revenue.total) || 0;
    const collectionRate = revenueTotal > 0 ? (parseFloat(revenue.collected || 0) / revenueTotal * 100) : 0;

    return (
      <div>
        {/* Billed / collected / outstanding — all from real invoices */}
        <div className="grid" style={{ gridTemplateColumns: 'repeat(4, 1fr)' }}>
          <div className="stat-card">
            <h3>Billed</h3>
            <div className="value">{money(revenue.total)}</div>
            <div className="stat-subtext">{revenue.invoiceCount || 0} invoices</div>
          </div>
          <div className="stat-card">
            <h3>Collected</h3>
            <div className="value value-success">{money(revenue.collected)}</div>
            <div className="stat-subtext">{collectionRate.toFixed(1)}% collected</div>
          </div>
          <div className="stat-card">
            <h3>Outstanding</h3>
            <div className="value" style={{ color: parseFloat(revenue.outstanding) > 0 ? '#DC2626' : undefined }}>{money(revenue.outstanding)}</div>
          </div>
          <div className="stat-card">
            <h3>Scheduled Hours</h3>
            <div className="value">{Number(parseFloat(revenue.scheduledHours || 0)).toFixed(1)}</div>
            <div className="stat-subtext">{money(revenue.avgPerScheduledHour)}/scheduled hr</div>
          </div>
        </div>

        {/* Accounts Receivable — aging */}
        <div className="card">
          <h3>📅 Accounts Receivable — Aging</h3>
          <div style={{ overflowX: 'auto' }}>
            <table className="table">
              <thead><tr>
                <th>Current (not due)</th><th>1–30 days</th><th>31–60</th><th>61–90</th><th>90+ days</th><th>Total Outstanding</th>
              </tr></thead>
              <tbody><tr>
                <td>{money(ar.current_not_due)}</td>
                <td>{money(ar.d1_30)}</td>
                <td style={{ color: parseFloat(ar.d31_60) > 0 ? '#D97706' : undefined }}>{money(ar.d31_60)}</td>
                <td style={{ color: parseFloat(ar.d61_90) > 0 ? '#D97706' : undefined }}>{money(ar.d61_90)}</td>
                <td style={{ color: parseFloat(ar.d90_plus) > 0 ? '#DC2626' : undefined, fontWeight: 700 }}>{money(ar.d90_plus)}</td>
                <td><strong>{money(ar.total_outstanding)}</strong></td>
              </tr></tbody>
            </table>
          </div>
          <p style={{ fontSize: '0.8rem', color: '#6B7280', margin: '0.5rem 0 0' }}>Snapshot of all unpaid invoice balances as of today (not limited to the selected period).</p>
        </div>

        <div className="grid" style={{ gridTemplateColumns: '1fr 1fr' }}>
          {/* Revenue by payer */}
          <div className="card">
            <h3>Revenue by Payer</h3>
            {byPayer.length > 0 ? (
              <table className="table">
                <thead><tr><th>Payer</th><th>Billed</th><th>Collected</th><th>Outstanding</th></tr></thead>
                <tbody>
                  {byPayer.map((p, i) => (
                    <tr key={i}>
                      <td><strong>{p.payer}</strong></td>
                      <td>{money(p.billed)}</td>
                      <td>{money(p.collected)}</td>
                      <td style={{ color: parseFloat(p.outstanding) > 0 ? '#DC2626' : undefined }}>{money(p.outstanding)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : <p>No data available</p>}
          </div>

          {/* Revenue by service type — real invoice revenue */}
          <div className="card">
            <h3>Revenue by Service Type</h3>
            {byServiceType.length > 0 ? (
              <table className="table">
                <thead><tr><th>Service Type</th><th>Revenue</th><th>%</th></tr></thead>
                <tbody>
                  {byServiceType.map((st, idx) => {
                    const r = parseFloat(st.revenue) || 0;
                    return (
                      <tr key={idx}>
                        <td>{st.service_type?.replace('_', ' ').toUpperCase() || 'N/A'}</td>
                        <td><strong>{money(r)}</strong></td>
                        <td>{revenueTotal > 0 ? ((r / revenueTotal) * 100).toFixed(1) : 0}%</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            ) : <p>No data available</p>}
          </div>
        </div>

        {/* Top clients by revenue */}
        <div className="card">
          <h3>Top Clients by Revenue</h3>
          {byClient.length > 0 ? (
            <table className="table">
              <thead><tr><th>Client</th><th>Revenue</th><th>Outstanding</th></tr></thead>
              <tbody>
                {byClient.slice(0, 15).map(cl => (
                  <tr key={cl.id}>
                    <td>{cl.first_name} {cl.last_name}</td>
                    <td><strong>{money(cl.revenue)}</strong></td>
                    <td style={{ color: parseFloat(cl.outstanding) > 0 ? '#DC2626' : undefined }}>{money(cl.outstanding)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : <p>No client data available</p>}
        </div>
      </div>
    );
  };

  const renderPnlReport = () => {
    if (!reportData) return null;
    const { revenue = {}, revenueByPayer = [], expenses = {}, payroll = {}, netIncome = 0, margin = 0 } = reportData;
    const net = parseFloat(netIncome) || 0;
    return (
      <div>
        <div className="card" style={{ background: '#FEF3C7', borderLeft: '4px solid #D97706', marginBottom: '1rem' }}>
          <strong>⚠️ Revenue = private-pay invoices + MCO/Medicaid claims recorded in the system.</strong> MCO
          revenue (My Choice, etc.) only appears once claims are generated for the period in the Claims &amp; EVV
          Engine — if claims haven&apos;t been entered, that revenue is <strong>missing here</strong> and Net
          Income is understated. Payroll is an estimate from cleaned clock times, not the finalized payroll run.
          Directional view, not a filed P&amp;L.
        </div>
        <div className="grid" style={{ gridTemplateColumns: 'repeat(4, 1fr)' }}>
          <div className="stat-card">
            <h3>Revenue (collected)</h3>
            <div className="value value-success">{money(revenue.total_collected)}</div>
            <div className="stat-subtext">{money(revenue.total_billed)} billed</div>
          </div>
          <div className="stat-card">
            <h3>Payroll</h3>
            <div className="value">{money(payroll.total)}</div>
            <div className="stat-subtext">{money(payroll.gross)} gross + est. tax</div>
          </div>
          <div className="stat-card">
            <h3>Expenses</h3>
            <div className="value">{money(expenses.total)}</div>
          </div>
          <div className="stat-card">
            <h3>Net Income</h3>
            <div className="value" style={{ color: net >= 0 ? '#059669' : '#DC2626' }}>{money(net)}</div>
            <div className="stat-subtext">{parseFloat(margin).toFixed(1)}% margin</div>
          </div>
        </div>

        <div className="grid" style={{ gridTemplateColumns: '1fr 1fr' }}>
          <div className="card">
            <h3>Revenue by Payer</h3>
            {revenueByPayer.length > 0 ? (
              <table className="table">
                <thead><tr><th>Payer</th><th>Invoices</th><th>Billed</th><th>Collected</th></tr></thead>
                <tbody>
                  {revenueByPayer.map((p, i) => (
                    <tr key={i}><td><strong>{p.payer_name}</strong></td><td>{p.invoice_count}</td><td>{money(p.billed)}</td><td>{money(p.collected)}</td></tr>
                  ))}
                </tbody>
              </table>
            ) : <p>No revenue data</p>}
          </div>
          <div className="card">
            <h3>Expenses by Category</h3>
            {(expenses.byCategory || []).length > 0 ? (
              <table className="table">
                <thead><tr><th>Category</th><th>Amount</th></tr></thead>
                <tbody>
                  {expenses.byCategory.map((e, i) => (
                    <tr key={i}><td>{e.category || 'Uncategorized'}</td><td>{money(e.category_total)}</td></tr>
                  ))}
                </tbody>
              </table>
            ) : <p>No expenses recorded</p>}
          </div>
        </div>

        <div className="card">
          <h3>P&amp;L Summary</h3>
          <table className="table">
            <tbody>
              <tr><td>Revenue (collected)</td><td style={{ textAlign: 'right' }}>{money(revenue.total_collected)}</td></tr>
              <tr><td>&minus; Payroll (incl. est. taxes)</td><td style={{ textAlign: 'right' }}>&minus;{money(payroll.total)}</td></tr>
              <tr><td>&minus; Expenses</td><td style={{ textAlign: 'right' }}>&minus;{money(expenses.total)}</td></tr>
              <tr style={{ fontWeight: 700, borderTop: '2px solid #E5E7EB' }}>
                <td>Net Income</td>
                <td style={{ textAlign: 'right', color: net >= 0 ? '#059669' : '#DC2626' }}>{money(net)}</td>
              </tr>
            </tbody>
          </table>
          <p style={{ fontSize: '0.8rem', color: '#6B7280', margin: '0.5rem 0 0' }}>
            Revenue = collections from invoices. Payroll = actual clocked pay from time entries + 7.65% est. employer tax.
          </p>
        </div>
      </div>
    );
  };

  const fmtNum = (n) => n == null ? '—' : (typeof n === 'number' ? n.toLocaleString() : n);
  const fmtPct = (n) => n == null ? '—' : `${parseFloat(n).toFixed(1)}%`;

  // Generic table renderer for the new GET-style drill-down reports.
  // Pass column defs; reads from reportData.rows.
  const renderTable = (columns) => {
    const rows = reportData?.rows || [];
    if (rows.length === 0) return <p className="text-muted text-center">No data for this period.</p>;
    return (
      <div style={{ overflowX: 'auto' }}>
        <table className="table">
          <thead><tr>{columns.map(c => <th key={c.key} style={{ textAlign: c.right ? 'right' : 'left' }}>{c.label}</th>)}</tr></thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i}>
                {columns.map(c => {
                  let v = r[c.key];
                  if (c.format === 'num') v = fmtNum(v);
                  else if (c.format === 'pct') v = fmtPct(v);
                  else if (c.format === 'hr') v = v != null ? `${parseFloat(v).toFixed(2)}h` : '—';
                  else if (c.format === 'date' && v) v = formatDate(v);
                  return <td key={c.key} style={{ textAlign: c.right ? 'right' : 'left', fontWeight: c.bold ? 700 : 400 }}>{v ?? '—'}</td>;
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  };

  const renderHoursByPayer = () => renderTable([
    { key: 'payer_name', label: 'Payer', bold: true },
    { key: 'payer_type', label: 'Type' },
    { key: 'active_clients', label: 'Clients', right: true, format: 'num' },
    { key: 'visits', label: 'Visits', right: true, format: 'num' },
    { key: 'total_hours', label: 'Total Hrs', right: true, format: 'hr' },
    { key: 'billable_hours', label: 'Billable Hrs', right: true, format: 'hr' },
    { key: 'avg_visit_hours', label: 'Avg Visit', right: true, format: 'hr' },
    { key: 'first_visit', label: 'First', format: 'date' },
    { key: 'last_visit', label: 'Last', format: 'date' },
  ]);

  const renderCaregiverUtilization = () => renderTable([
    { key: 'first_name', label: 'First', bold: true },
    { key: 'last_name',  label: 'Last',  bold: true },
    { key: 'max_hours_per_week', label: 'Max/wk', right: true, format: 'num' },
    { key: 'capacity_hours',     label: 'Capacity (hrs)', right: true, format: 'num' },
    { key: 'actual_hours',       label: 'Actual (hrs)', right: true, format: 'hr' },
    { key: 'visits',             label: 'Visits', right: true, format: 'num' },
    { key: 'utilization_pct',    label: 'Util %', right: true, format: 'pct' },
  ]);

  const renderClientIncidents = () => renderTable([
    { key: 'first_name',     label: 'First', bold: true },
    { key: 'last_name',      label: 'Last',  bold: true },
    { key: 'incident_count', label: 'Total',     right: true, format: 'num' },
    { key: 'critical_count', label: 'Critical',  right: true, format: 'num' },
    { key: 'severe_count',   label: 'Severe',    right: true, format: 'num' },
    { key: 'moderate_count', label: 'Moderate',  right: true, format: 'num' },
    { key: 'minor_count',    label: 'Minor',     right: true, format: 'num' },
    { key: 'followup_count', label: 'Follow-up', right: true, format: 'num' },
    { key: 'earliest',       label: 'First',     format: 'date' },
    { key: 'latest',         label: 'Last',      format: 'date' },
  ]);

  const renderClientRevenueByMonth = () => renderTable([
    { key: 'month',         label: 'Month', bold: true },
    { key: 'first_name',    label: 'First', bold: true },
    { key: 'last_name',     label: 'Last',  bold: true },
    { key: 'invoice_count', label: 'Invoices',    right: true, format: 'num' },
    { key: 'total_billed',  label: 'Billed ($)',  right: true, format: 'num' },
    { key: 'total_paid',    label: 'Paid ($)',    right: true, format: 'num' },
    { key: 'outstanding',   label: 'Outstanding ($)', right: true, format: 'num' },
    { key: 'paid_count',    label: 'Paid',        right: true, format: 'num' },
    { key: 'overdue_count', label: 'Overdue',     right: true, format: 'num' },
  ]);

  const renderClientVisitsSummary = () => renderTable([
    { key: 'first_name', label: 'First', bold: true },
    { key: 'last_name',  label: 'Last',  bold: true },
    { key: 'payer_name', label: 'Payer' },
    { key: 'care_type_name', label: 'Care Type' },
    { key: 'visits',           label: 'Visits',     right: true, format: 'num' },
    { key: 'distinct_caregivers', label: 'Caregivers', right: true, format: 'num' },
    { key: 'total_hours',      label: 'Total Hrs',  right: true, format: 'hr' },
    { key: 'billable_hours',   label: 'Billable',   right: true, format: 'hr' },
    { key: 'first_visit',      label: 'First',      format: 'date' },
    { key: 'last_visit',       label: 'Last',       format: 'date' },
  ]);

  const renderReport = () => {
    switch (reportType) {
      case 'overview':
        return renderOverviewReport();
      case 'hours':
        return renderHoursReport();
      case 'performance':
        return renderPerformanceReport();
      case 'satisfaction':
        return renderSatisfactionReport();
      case 'revenue':
        return renderRevenueReport();
      case 'pnl':
        return renderPnlReport();
      case 'hours-by-payer':
        return renderHoursByPayer();
      case 'caregiver-utilization':
        return renderCaregiverUtilization();
      case 'client-visits-summary':
        return renderClientVisitsSummary();
      case 'client-revenue-by-month':
        return renderClientRevenueByMonth();
      case 'client-incidents':
        return renderClientIncidents();
      default:
        return null;
    }
  };

  return (
    <div>
      <div className="page-header">
        <h2>📊 Reports & Analytics</h2>
      </div>

      {/* Report Type Selection */}
      <div className="card">
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '0.75rem', marginBottom: '1rem' }}>
          {[
            { value: 'overview', label: 'Overview' },
            { value: 'hours', label: 'Hours Worked' },
            { value: 'performance', label: 'Performance' },
            { value: 'satisfaction', label: 'Satisfaction' },
            { value: 'revenue', label: 'Revenue' },
            { value: 'pnl', label: 'Profit & Loss' },
            { value: 'hours-by-payer', label: 'Hours by Payer' },
            { value: 'caregiver-utilization', label: 'Caregiver Utilization' },
            { value: 'client-visits-summary', label: 'Client Visits Summary' },
            { value: 'client-revenue-by-month', label: 'Client Revenue by Month' },
            { value: 'client-incidents', label: 'Client Incidents' }
          ].map(type => (
            <button
              key={type.value}
              className={`btn ${reportType === type.value ? 'btn-primary' : 'btn-secondary'}`}
              onClick={() => setReportType(type.value)}
            >
              {type.label}
            </button>
          ))}
        </div>
      </div>

      {/* Filters */}
      <div className="card">
        <div className="filter-controls" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '1rem' }}>
          <div className="form-group">
            <label>Start Date</label>
            <input
              type="date"
              value={dateRange.startDate}
              onChange={(e) => setDateRange({ ...dateRange, startDate: e.target.value })}
            />
          </div>

          <div className="form-group">
            <label>End Date</label>
            <input
              type="date"
              value={dateRange.endDate}
              onChange={(e) => setDateRange({ ...dateRange, endDate: e.target.value })}
            />
          </div>

          <div className="form-group">
            <label>Caregiver (Optional)</label>
            <select value={caregiverFilter} onChange={(e) => setCaregiverFilter(e.target.value)}>
              <option value="">All Caregivers</option>
              {caregivers.map(cg => (
                <option key={cg.id} value={cg.id}>
                  {cg.first_name} {cg.last_name}
                </option>
              ))}
            </select>
          </div>

          <div className="form-group">
            <label>Client (Optional)</label>
            <select value={clientFilter} onChange={(e) => setClientFilter(e.target.value)}>
              <option value="">All Clients</option>
              {clients.map(cl => (
                <option key={cl.id} value={cl.id}>
                  {cl.first_name} {cl.last_name}
                </option>
              ))}
            </select>
          </div>

          <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'flex-end' }}>
            <button className="btn btn-secondary" onClick={() => exportReport('csv')}>
              📥 CSV
            </button>
            <button className="btn btn-secondary" onClick={() => exportReport('pdf')}>
              📄 PDF
            </button>
          </div>
        </div>
      </div>

      {/* Report Content */}
      {loading ? (
        <div className="loading">
          <div className="spinner"></div>
        </div>
      ) : (
        renderReport()
      )}
    </div>
  );
};

export default ReportsAnalytics;
