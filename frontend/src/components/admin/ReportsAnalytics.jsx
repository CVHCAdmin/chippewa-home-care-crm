// src/components/admin/ReportsAnalytics.jsx
import React, { useState, useEffect } from 'react';
import { API_BASE_URL } from '../../config';

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
      const caregiverData = await cgRes.json();
      const clientData = await clRes.json();
      setCaregivers(caregiverData);
      setClients(clientData);
    } catch (error) {
      console.error('Failed to load filters:', error);
    }
  };

  const generateReport = async () => {
    setLoading(true);
    try {
      const response = await fetch(`${API_BASE_URL}/api/reports/${reportType}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          startDate: dateRange.startDate,
          endDate: dateRange.endDate,
          caregiverId: caregiverFilter || null,
          clientId: clientFilter || null
        })
      });
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
      const response = await fetch(`${API_BASE_URL}/api/reports/${reportType}/export`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          startDate: dateRange.startDate,
          endDate: dateRange.endDate,
          caregiverId: caregiverFilter || null,
          clientId: clientFilter || null,
          format
        })
      });

      if (!response.ok) throw new Error('Export failed');

      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `report-${reportType}-${new Date().toISOString().split('T')[0]}.${format}`;
      a.click();
    } catch (error) {
      alert('Failed to export: ' + error.message);
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
            <div className="value">{(parseFloat(summary.totalHours) || 0).toFixed(1)}</div>
            <p className="stat-subtext">Across all caregivers</p>
          </div>
          <div className="stat-card">
            <h3>Total Revenue</h3>
            <div className="value value-success">
              ${(parseFloat(summary.totalRevenue) || 0).toFixed(2)}
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
              {summary.avgSatisfaction ? `${parseFloat(summary.avgSatisfaction).toFixed(1)}⭐` : 'N/A'}
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
                  <th>Revenue</th>
                  <th>Avg Rating</th>
                  <th>Clients</th>
                </tr>
              </thead>
              <tbody>
                {topCaregivers.map(cg => (
                  <tr key={cg.id}>
                    <td><strong>{cg.first_name} {cg.last_name}</strong></td>
                    <td>{(parseFloat(cg.total_hours) || 0).toFixed(1)} hrs</td>
                    <td>${(parseFloat(cg.total_revenue) || 0).toFixed(2)}</td>
                    <td>
                      {cg.avg_satisfaction ? (
                        <span>⭐ {parseFloat(cg.avg_satisfaction).toFixed(1)}</span>
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
                  <th>Cost</th>
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
                    <td>{(parseFloat(cl.total_hours) || 0).toFixed(1)} hrs</td>
                    <td>${(parseFloat(cl.total_cost) || 0).toFixed(2)}</td>
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
                      <td>{(parseFloat(type.hours) || 0).toFixed(1)}</td>
                      <td>
                        <div style={{ width: '100px', height: '6px', background: '#e0e0e0', borderRadius: '3px', overflow: 'hidden' }}>
                          <div style={{ width: `${parseFloat(type.percentage) || 0}%`, height: '100%', background: '#2196f3' }}></div>
                        </div>
                        <small>{(parseFloat(type.percentage) || 0).toFixed(1)}%</small>
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
                      <td>{(parseFloat(week.hours) || 0).toFixed(1)}</td>
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
                      <td>{regularHours.toFixed(1)}</td>
                      <td className={overtimeHours > 0 ? 'value-warning' : ''}>{overtimeHours.toFixed(1)}</td>
                      <td><strong>{totalHours.toFixed(1)}</strong></td>
                      <td>
                        <div style={{ width: '100px', height: '6px', background: '#e0e0e0', borderRadius: '3px', overflow: 'hidden' }}>
                          <div style={{ 
                            width: `${Math.min((totalHours / 40) * 100, 100)}%`, 
                            height: '100%', 
                            background: totalHours > 40 ? '#ff9800' : '#4caf50' 
                          }}></div>
                        </div>
                        <small>{((totalHours / 40) * 100).toFixed(0)}%</small>
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
                            ⭐ {avgRating.toFixed(1)} ({perf.rating_count || 0})
                          </span>
                        ) : (
                          'N/A'
                        )}
                      </td>
                      <td>
                        <span className={attendanceRate >= 95 ? 'value-success' : 'value-warning'}>
                          {attendanceRate.toFixed(1)}%
                        </span>
                      </td>
                      <td>
                        {(perf.incident_count || 0) > 0 ? (
                          <span className="value-danger">{perf.incident_count}</span>
                        ) : (
                          '0 ✓'
                        )}
                      </td>
                      <td>{trainingHours.toFixed(1)}</td>
                      <td>
                        <span className={`badge ${performanceScore >= 85 ? 'badge-success' : performanceScore >= 70 ? 'badge-warning' : 'badge-danger'}`}>
                          {performanceScore.toFixed(0)}/100
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
              {satisfaction.overall ? (parseFloat(satisfaction.overall) || 0).toFixed(1) : 'N/A'}⭐
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
                      <td>⭐ {rating.toFixed(2)}</td>
                      <td>
                        {change > 0 ? (
                          <span style={{ color: '#4caf50' }}>↑ {change.toFixed(2)}</span>
                        ) : change < 0 ? (
                          <span style={{ color: '#f44336' }}>↓ {Math.abs(change).toFixed(2)}</span>
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

  const renderRevenueReport = () => {
    if (!reportData) return null;
    const { revenue = {}, byClient, byServiceType } = reportData;
    const revenueTotal = parseFloat(revenue.total) || 0;

    return (
      <div>
        <div className="grid" style={{ gridTemplateColumns: '1fr 1fr 1fr' }}>
          <div className="stat-card">
            <h3>Total Revenue</h3>
            <div className="value value-success">
              ${revenueTotal.toFixed(2)}
            </div>
          </div>
          <div className="stat-card">
            <h3>Avg Per Hour</h3>
            <div className="value">
              ${(parseFloat(revenue.avgPerHour) || 0).toFixed(2)}
            </div>
          </div>
          <div className="stat-card">
            <h3>Billable Hours</h3>
            <div className="value">
              {(parseFloat(revenue.billableHours) || 0).toFixed(1)}
            </div>
          </div>
        </div>

        <div className="grid" style={{ gridTemplateColumns: '1fr 1fr' }}>
          <div className="card">
            <h3>Revenue by Service Type</h3>
            {byServiceType && byServiceType.length > 0 ? (
              <table className="table">
                <thead>
                  <tr>
                    <th>Service Type</th>
                    <th>Hours</th>
                    <th>Revenue</th>
                    <th>%</th>
                  </tr>
                </thead>
                <tbody>
                  {byServiceType.map((st, idx) => {
                    const stRevenue = parseFloat(st.revenue) || 0;
                    return (
                      <tr key={idx}>
                        <td>{st.service_type?.replace('_', ' ').toUpperCase() || 'N/A'}</td>
                        <td>{(parseFloat(st.hours) || 0).toFixed(1)}</td>
                        <td><strong>${stRevenue.toFixed(2)}</strong></td>
                        <td>{revenueTotal > 0 ? ((stRevenue / revenueTotal) * 100).toFixed(1) : 0}%</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            ) : (
              <p>No data available</p>
            )}
          </div>

          <div className="card">
            <h3>Top Clients by Revenue</h3>
            {byClient && byClient.length > 0 ? (
              <table className="table">
                <thead>
                  <tr>
                    <th>Client</th>
                    <th>Revenue</th>
                  </tr>
                </thead>
                <tbody>
                  {byClient.slice(0, 10).map(cl => (
                    <tr key={cl.id}>
                      <td>{cl.first_name} {cl.last_name}</td>
                      <td><strong>${(parseFloat(cl.revenue) || 0).toFixed(2)}</strong></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <p>No client data available</p>
            )}
          </div>
        </div>
      </div>
    );
  };

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
            { value: 'revenue', label: 'Revenue' }
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
