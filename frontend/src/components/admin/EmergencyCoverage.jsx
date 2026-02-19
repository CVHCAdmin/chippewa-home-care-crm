// src/components/admin/EmergencyCoverage.jsx
import React, { useState, useEffect } from 'react';
import { API_BASE_URL } from '../../config';
import { toast } from '../Toast';
import { confirm } from '../ConfirmModal';

const EmergencyCoverage = ({ token }) => {
  const [missReports, setMissReports] = useState([]);
  const [availableCaregivers, setAvailableCaregivers] = useState([]);
  const [clients, setClients] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searching, setSearching] = useState(false);
  const [selectedReport, setSelectedReport] = useState(null);
  const [searchForm, setSearchForm] = useState({
    date: new Date().toISOString().split('T')[0],
    startTime: '08:00',
    endTime: '16:00',
    clientId: '',
  });

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    try {
      const [reportsRes, clientsRes] = await Promise.all([
        fetch(`${API_BASE_URL}/api/emergency/miss-reports`, { headers: { Authorization: `Bearer ${token}` } }),
        fetch(`${API_BASE_URL}/api/clients`, { headers: { Authorization: `Bearer ${token}` } }),
      ]);
      const reports = await reportsRes.json();
      const clientList = await clientsRes.json();
      setMissReports(Array.isArray(reports) ? reports : []);
      setClients(Array.isArray(clientList) ? clientList : []);
    } catch (e) {
      toast('Failed to load data', 'error');
    } finally {
      setLoading(false);
    }
  };

  const searchCoverage = async (report = null) => {
    const form = report ? {
      date: report.date?.split('T')[0] || searchForm.date,
      startTime: report.start_time || searchForm.startTime,
      endTime: report.end_time || searchForm.endTime,
      clientId: report.client_id || searchForm.clientId,
    } : searchForm;

    setSearching(true);
    if (report) setSelectedReport(report);

    try {
      const params = new URLSearchParams({
        date: form.date,
        startTime: form.startTime,
        endTime: form.endTime,
        ...(form.clientId && { clientId: form.clientId }),
      });
      const res = await fetch(`${API_BASE_URL}/api/emergency/available-caregivers?${params}`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      const data = await res.json();
      setAvailableCaregivers(Array.isArray(data) ? data : []);
    } catch (e) {
      toast('Failed to search for available caregivers', 'error');
    } finally {
      setSearching(false);
    }
  };

  const assignCoverage = async (caregiver) => {
    const ok = await confirm(
      `Assign ${caregiver.first_name} ${caregiver.last_name} as emergency coverage?`,
      { confirmLabel: 'Assign', danger: false }
    );
    if (!ok) return;

    try {
      const form = selectedReport ? {
        date: selectedReport.date?.split('T')[0] || searchForm.date,
        startTime: selectedReport.start_time || searchForm.startTime,
        endTime: selectedReport.end_time || searchForm.endTime,
        clientId: selectedReport.client_id || searchForm.clientId,
      } : searchForm;

      await fetch(`${API_BASE_URL}/api/emergency/assign-coverage`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          absenceId: selectedReport?.id,
          caregiverId: caregiver.id,
          ...form,
        }),
      });
      toast(`Coverage assigned to ${caregiver.first_name} ${caregiver.last_name}. They have been notified.`, 'success');
      loadData();
      setAvailableCaregivers([]);
      setSelectedReport(null);
    } catch (e) {
      toast('Failed to assign coverage', 'error');
    }
  };

  const statusBadge = (hours) => {
    if (hours > 35) return { color: '#DC2626', label: 'Near Overtime' };
    if (hours > 25) return { color: '#D97706', label: 'Moderate Hours' };
    return { color: '#16A34A', label: 'Available' };
  };

  if (loading) return <div style={{ textAlign: 'center', padding: '3rem', color: '#6B7280' }}>Loading...</div>;

  return (
    <div>
      <div style={{ marginBottom: '1.5rem' }}>
        <h2 style={{ margin: 0, fontSize: '1.25rem', color: '#111827' }}>🚨 Emergency Coverage</h2>
        <p style={{ margin: '0.25rem 0 0 0', color: '#6B7280', fontSize: '0.9rem' }}>
          Find available caregivers to cover uncovered shifts
        </p>
      </div>

      {/* Pending Miss Reports */}
      {missReports.length > 0 && (
        <div className="card" style={{ marginBottom: '1.5rem', border: '1px solid #FCA5A5' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '1rem' }}>
            <span style={{ fontSize: '1.2rem' }}>🔴</span>
            <h3 style={{ margin: 0, fontSize: '1rem', color: '#991B1B' }}>
              {missReports.length} Shift{missReports.length !== 1 ? 's' : ''} Need Coverage
            </h3>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
            {missReports.map(report => (
              <div key={report.id} style={{
                padding: '0.875rem', background: '#FEF2F2', borderRadius: '8px',
                border: '1px solid #FCA5A5', display: 'flex', justifyContent: 'space-between',
                alignItems: 'center', flexWrap: 'wrap', gap: '0.75rem'
              }}>
                <div>
                  <div style={{ fontWeight: '700', color: '#111827' }}>
                    {report.first_name} {report.last_name} — Called Out
                  </div>
                  <div style={{ fontSize: '0.85rem', color: '#6B7280', marginTop: '0.25rem' }}>
                    📅 {new Date(report.date).toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' })}
                    {report.start_time && ` • ${report.start_time} – ${report.end_time}`}
                    {report.client_name && ` • Client: ${report.client_name}`}
                  </div>
                  <div style={{ fontSize: '0.82rem', color: '#B91C1C', marginTop: '0.2rem' }}>
                    Reason: {report.reason || 'No reason provided'}
                  </div>
                </div>
                <button
                  onClick={() => searchCoverage(report)}
                  style={{
                    padding: '0.5rem 1rem', background: '#DC2626', color: '#fff',
                    border: 'none', borderRadius: '8px', cursor: 'pointer', fontWeight: '600', fontSize: '0.85rem'
                  }}
                >
                  Find Coverage
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Manual Search */}
      <div className="card" style={{ marginBottom: '1.5rem' }}>
        <h3 style={{ margin: '0 0 1rem 0', fontSize: '1rem', color: '#374151' }}>🔍 Find Available Caregivers</h3>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '0.75rem', marginBottom: '1rem' }}>
          <div>
            <label style={{ display: 'block', fontSize: '0.82rem', fontWeight: '600', color: '#374151', marginBottom: '0.3rem' }}>Date *</label>
            <input type="date" value={searchForm.date}
              onChange={e => setSearchForm(p => ({ ...p, date: e.target.value }))}
              style={{ width: '100%', padding: '0.5rem', border: '1px solid #D1D5DB', borderRadius: '6px', fontSize: '0.9rem' }} />
          </div>
          <div>
            <label style={{ display: 'block', fontSize: '0.82rem', fontWeight: '600', color: '#374151', marginBottom: '0.3rem' }}>Start Time *</label>
            <input type="time" value={searchForm.startTime}
              onChange={e => setSearchForm(p => ({ ...p, startTime: e.target.value }))}
              style={{ width: '100%', padding: '0.5rem', border: '1px solid #D1D5DB', borderRadius: '6px', fontSize: '0.9rem' }} />
          </div>
          <div>
            <label style={{ display: 'block', fontSize: '0.82rem', fontWeight: '600', color: '#374151', marginBottom: '0.3rem' }}>End Time *</label>
            <input type="time" value={searchForm.endTime}
              onChange={e => setSearchForm(p => ({ ...p, endTime: e.target.value }))}
              style={{ width: '100%', padding: '0.5rem', border: '1px solid #D1D5DB', borderRadius: '6px', fontSize: '0.9rem' }} />
          </div>
          <div>
            <label style={{ display: 'block', fontSize: '0.82rem', fontWeight: '600', color: '#374151', marginBottom: '0.3rem' }}>Client (optional)</label>
            <select value={searchForm.clientId}
              onChange={e => setSearchForm(p => ({ ...p, clientId: e.target.value }))}
              style={{ width: '100%', padding: '0.5rem', border: '1px solid #D1D5DB', borderRadius: '6px', fontSize: '0.9rem' }}>
              <option value="">Any client</option>
              {clients.map(c => <option key={c.id} value={c.id}>{c.first_name} {c.last_name}</option>)}
            </select>
          </div>
        </div>
        <button
          onClick={() => searchCoverage()}
          disabled={searching}
          style={{
            padding: '0.6rem 1.5rem', background: '#2ABBA7', color: '#fff',
            border: 'none', borderRadius: '8px', cursor: 'pointer', fontWeight: '600', fontSize: '0.9rem',
            opacity: searching ? 0.7 : 1
          }}
        >
          {searching ? 'Searching...' : '🔍 Search Available Caregivers'}
        </button>
      </div>

      {/* Results */}
      {availableCaregivers.length > 0 && (
        <div className="card">
          <h3 style={{ margin: '0 0 1rem 0', fontSize: '1rem', color: '#374151' }}>
            ✅ {availableCaregivers.length} Caregiver{availableCaregivers.length !== 1 ? 's' : ''} Available
            {selectedReport && <span style={{ fontWeight: '400', color: '#6B7280' }}> for {new Date(selectedReport.date).toLocaleDateString()}</span>}
          </h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
            {availableCaregivers.map(cg => {
              const sb = statusBadge(parseFloat(cg.scheduled_hours_this_week) || 0);
              return (
                <div key={cg.id} style={{
                  padding: '0.875rem', background: '#F9FAFB', borderRadius: '8px',
                  border: '1px solid #E5E7EB', display: 'flex', justifyContent: 'space-between',
                  alignItems: 'center', flexWrap: 'wrap', gap: '0.75rem'
                }}>
                  <div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.25rem' }}>
                      <span style={{ fontWeight: '700', color: '#111827', fontSize: '0.95rem' }}>
                        {cg.first_name} {cg.last_name}
                      </span>
                      {cg.is_preferred && (
                        <span style={{ padding: '0.1rem 0.4rem', background: '#FEF3C7', color: '#92400E', borderRadius: '4px', fontSize: '0.72rem', fontWeight: '600' }}>
                          ⭐ Preferred
                        </span>
                      )}
                      <span style={{ padding: '0.1rem 0.4rem', background: '#F0FDF4', color: sb.color, borderRadius: '4px', fontSize: '0.72rem', fontWeight: '600', border: `1px solid ${sb.color}20` }}>
                        {sb.label}
                      </span>
                    </div>
                    <div style={{ fontSize: '0.82rem', color: '#6B7280', display: 'flex', gap: '1rem', flexWrap: 'wrap' }}>
                      {cg.phone && <span>📞 {cg.phone}</span>}
                      <span>📊 {parseFloat(cg.scheduled_hours_this_week || 0).toFixed(1)}h this week</span>
                      {parseFloat(cg.avg_rating) > 0 && <span>⭐ {cg.avg_rating} avg rating</span>}
                      {cg.certifications?.length > 0 && <span>🎓 {cg.certifications.join(', ')}</span>}
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: '0.5rem' }}>
                    {cg.phone && (
                      <a href={`tel:${cg.phone}`} style={{
                        padding: '0.5rem 0.875rem', background: '#fff', color: '#374151',
                        border: '1px solid #D1D5DB', borderRadius: '8px', cursor: 'pointer',
                        fontWeight: '500', fontSize: '0.85rem', textDecoration: 'none'
                      }}>📞 Call</a>
                    )}
                    <button
                      onClick={() => assignCoverage(cg)}
                      style={{
                        padding: '0.5rem 0.875rem', background: '#2ABBA7', color: '#fff',
                        border: 'none', borderRadius: '8px', cursor: 'pointer', fontWeight: '600', fontSize: '0.85rem'
                      }}
                    >
                      Assign Coverage
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {!searching && availableCaregivers.length === 0 && missReports.length === 0 && (
        <div className="card" style={{ padding: '2rem', textAlign: 'center', color: '#6B7280' }}>
          <div style={{ fontSize: '2.5rem', marginBottom: '0.75rem' }}>✅</div>
          <p style={{ fontWeight: '600', color: '#374151' }}>No coverage issues reported</p>
          <p style={{ fontSize: '0.85rem' }}>Use the search above to find available caregivers for a specific shift.</p>
        </div>
      )}
    </div>
  );
};

export default EmergencyCoverage;
