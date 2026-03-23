// admin/TimeOffManagement.jsx — View/approve time-off requests + find coverage
import React, { useState, useEffect } from 'react';
import { API_BASE_URL } from '../../config';

const TimeOffManagement = ({ token }) => {
  const [requests, setRequests] = useState([]);
  const [filter, setFilter] = useState('pending');
  const [loading, setLoading] = useState(true);
  const [selectedRequest, setSelectedRequest] = useState(null);
  const [affectedShifts, setAffectedShifts] = useState([]);
  const [coverageCaregivers, setCoverageCaregivers] = useState({});
  const [loadingShifts, setLoadingShifts] = useState(false);
  const [loadingCoverage, setLoadingCoverage] = useState({});
  const [message, setMessage] = useState('');

  useEffect(() => { loadRequests(); }, [filter]);

  const loadRequests = async () => {
    setLoading(true);
    try {
      const params = filter !== 'all' ? `?status=${filter}` : '';
      const res = await fetch(`${API_BASE_URL}/api/time-off${params}`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (res.ok) setRequests(await res.json());
    } catch (error) {
      console.error('Failed to load time-off requests:', error);
    }
    setLoading(false);
  };

  const handleAction = async (id, status) => {
    try {
      const res = await fetch(`${API_BASE_URL}/api/time-off/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({ status })
      });
      if (!res.ok) throw new Error('Failed');
      setMessage(`Request ${status}`);
      loadRequests();
      if (selectedRequest?.id === id) {
        setSelectedRequest(prev => ({ ...prev, status }));
      }
      setTimeout(() => setMessage(''), 3000);
    } catch (error) {
      setMessage('Error: ' + error.message);
    }
  };

  const viewDetails = async (request) => {
    setSelectedRequest(request);
    setAffectedShifts([]);
    setCoverageCaregivers({});
    setLoadingShifts(true);
    try {
      const res = await fetch(`${API_BASE_URL}/api/time-off/${request.id}/affected-shifts`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (res.ok) setAffectedShifts(await res.json());
    } catch (error) {
      console.error('Failed to load affected shifts:', error);
    }
    setLoadingShifts(false);
  };

  const findCoverage = async (shift) => {
    const key = `${shift.date}_${shift.start_time}`;
    setLoadingCoverage(prev => ({ ...prev, [key]: true }));
    try {
      const res = await fetch(
        `${API_BASE_URL}/api/time-off/${selectedRequest.id}/available-coverage?date=${shift.date}&startTime=${shift.start_time}&endTime=${shift.end_time}`,
        { headers: { 'Authorization': `Bearer ${token}` } }
      );
      if (res.ok) {
        const data = await res.json();
        setCoverageCaregivers(prev => ({ ...prev, [key]: data }));
      }
    } catch (error) {
      console.error('Failed to load coverage:', error);
    }
    setLoadingCoverage(prev => ({ ...prev, [key]: false }));
  };

  const formatDate = (d) => d ? new Date(d + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '';
  const formatTime = (t) => {
    if (!t) return '';
    const [h, m] = t.split(':');
    const hr = parseInt(h);
    return `${hr > 12 ? hr - 12 : hr || 12}:${m} ${hr >= 12 ? 'PM' : 'AM'}`;
  };
  const getDayName = (dateStr) => new Date(dateStr + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'short' });

  const statusColor = (s) => {
    switch (s) {
      case 'approved': return { bg: '#D1FAE5', badge: '#059669' };
      case 'denied': return { bg: '#FEE2E2', badge: '#DC2626' };
      default: return { bg: '#FEF3C7', badge: '#D97706' };
    }
  };

  const typeLabel = (t) => {
    const labels = { vacation: 'Vacation', sick: 'Sick Leave', personal: 'Personal', other: 'Other' };
    return labels[t] || t || 'Other';
  };

  const countDays = (start, end) => {
    const s = new Date(start + 'T12:00:00');
    const e = new Date(end + 'T12:00:00');
    return Math.round((e - s) / (1000 * 60 * 60 * 24)) + 1;
  };

  const pendingCount = requests.filter(r => r.status === 'pending').length;

  return (
    <div>
      {message && (
        <div style={{ padding: '0.75rem 1rem', marginBottom: '1rem', borderRadius: '8px', background: message.startsWith('Error') ? '#FEE2E2' : '#D1FAE5', color: message.startsWith('Error') ? '#DC2626' : '#059669', fontWeight: '500' }}>
          {message}
        </div>
      )}

      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem', flexWrap: 'wrap', gap: '1rem' }}>
        <div>
          <h2 style={{ margin: 0 }}>Time Off Requests</h2>
          {pendingCount > 0 && filter !== 'pending' && (
            <span style={{ fontSize: '0.85rem', color: '#D97706' }}>{pendingCount} pending request{pendingCount !== 1 ? 's' : ''}</span>
          )}
        </div>
        <div style={{ display: 'flex', gap: '0.5rem' }}>
          {['pending', 'approved', 'denied', 'all'].map(f => (
            <button key={f} onClick={() => setFilter(f)}
              className={`btn ${filter === f ? 'btn-primary' : ''}`}
              style={filter !== f ? { background: '#f3f4f6', border: '1px solid #d1d5db', borderRadius: '6px', padding: '0.4rem 0.75rem', cursor: 'pointer' } : {}}>
              {f.charAt(0).toUpperCase() + f.slice(1)}
              {f === 'pending' && pendingCount > 0 && ` (${pendingCount})`}
            </button>
          ))}
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: selectedRequest ? '1fr 1.2fr' : '1fr', gap: '1.5rem' }}>
        {/* Request List */}
        <div>
          {loading ? (
            <div className="card" style={{ textAlign: 'center', padding: '2rem', color: '#888' }}>Loading...</div>
          ) : requests.length === 0 ? (
            <div className="card" style={{ textAlign: 'center', padding: '2rem', color: '#888' }}>No {filter !== 'all' ? filter : ''} requests</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
              {requests.map(r => {
                const sc = statusColor(r.status);
                const isSelected = selectedRequest?.id === r.id;
                return (
                  <div key={r.id} onClick={() => viewDetails(r)}
                    className="card" style={{
                      cursor: 'pointer', padding: '1rem',
                      border: isSelected ? '2px solid #2563EB' : '1px solid #e5e7eb',
                      background: isSelected ? '#EFF6FF' : '#fff',
                      transition: 'all 0.15s'
                    }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '0.5rem' }}>
                      <div>
                        <div style={{ fontWeight: '600', fontSize: '1rem' }}>{r.first_name} {r.last_name}</div>
                        <div style={{ fontSize: '0.85rem', color: '#666', marginTop: '0.2rem' }}>
                          {typeLabel(r.type)} · {countDays(r.start_date, r.end_date)} day{countDays(r.start_date, r.end_date) !== 1 ? 's' : ''}
                        </div>
                      </div>
                      <span style={{ padding: '0.25rem 0.75rem', borderRadius: '12px', fontSize: '0.75rem', fontWeight: '600', background: sc.badge, color: '#fff', whiteSpace: 'nowrap' }}>
                        {(r.status || 'pending').toUpperCase()}
                      </span>
                    </div>
                    <div style={{ fontSize: '0.9rem', color: '#374151' }}>
                      {formatDate(r.start_date)} — {formatDate(r.end_date)}
                    </div>
                    {r.reason && <div style={{ fontSize: '0.85rem', color: '#666', marginTop: '0.25rem' }}>{r.reason}</div>}

                    {r.status === 'pending' && (
                      <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.75rem' }}>
                        <button className="btn btn-primary" style={{ fontSize: '0.85rem', padding: '0.35rem 0.75rem' }}
                          onClick={(e) => { e.stopPropagation(); handleAction(r.id, 'approved'); }}>
                          Approve
                        </button>
                        <button className="btn" style={{ fontSize: '0.85rem', padding: '0.35rem 0.75rem', background: '#FEE2E2', color: '#DC2626', border: '1px solid #FECACA', borderRadius: '6px', cursor: 'pointer' }}
                          onClick={(e) => { e.stopPropagation(); handleAction(r.id, 'denied'); }}>
                          Deny
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Detail Panel — Affected Shifts & Coverage */}
        {selectedRequest && (
          <div>
            <div className="card" style={{ marginBottom: '1rem' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
                <h3 style={{ margin: 0 }}>Affected Shifts</h3>
                <button onClick={() => setSelectedRequest(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '1.2rem', color: '#666' }}>✕</button>
              </div>
              <div style={{ padding: '0.75rem', background: '#F9FAFB', borderRadius: '8px', marginBottom: '1rem' }}>
                <strong>{selectedRequest.first_name} {selectedRequest.last_name}</strong> — {typeLabel(selectedRequest.type)}<br />
                <span style={{ fontSize: '0.9rem', color: '#555' }}>
                  {formatDate(selectedRequest.start_date)} — {formatDate(selectedRequest.end_date)} ({countDays(selectedRequest.start_date, selectedRequest.end_date)} days)
                </span>
                {selectedRequest.reason && <div style={{ fontSize: '0.85rem', color: '#666', marginTop: '0.25rem' }}>{selectedRequest.reason}</div>}
              </div>

              {loadingShifts ? (
                <p style={{ color: '#888', textAlign: 'center' }}>Loading shifts...</p>
              ) : affectedShifts.length === 0 ? (
                <p style={{ color: '#888', textAlign: 'center' }}>No scheduled shifts during this period</p>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                  {affectedShifts.map((shift, idx) => {
                    const key = `${shift.date}_${shift.start_time}`;
                    const coverage = coverageCaregivers[key];
                    const isLoadingCov = loadingCoverage[key];
                    return (
                      <div key={idx} style={{ border: '1px solid #e5e7eb', borderRadius: '8px', overflow: 'hidden' }}>
                        <div style={{ padding: '0.75rem', background: '#fff', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                          <div>
                            <div style={{ fontWeight: '500' }}>
                              {getDayName(shift.date)}, {formatDate(shift.date)}
                            </div>
                            <div style={{ fontSize: '0.9rem', color: '#555' }}>
                              {formatTime(shift.start_time)} — {formatTime(shift.end_time)}
                              {' · '}{shift.client_first} {shift.client_last}
                            </div>
                          </div>
                          <button
                            className="btn"
                            style={{ fontSize: '0.8rem', padding: '0.3rem 0.6rem', background: '#EFF6FF', color: '#2563EB', border: '1px solid #BFDBFE', borderRadius: '6px', cursor: 'pointer', whiteSpace: 'nowrap' }}
                            onClick={() => findCoverage(shift)}
                            disabled={isLoadingCov}
                          >
                            {isLoadingCov ? 'Searching...' : coverage ? 'Refresh' : 'Find Coverage'}
                          </button>
                        </div>

                        {/* Available caregivers for this shift */}
                        {coverage && (
                          <div style={{ borderTop: '1px solid #e5e7eb', padding: '0.75rem', background: '#F9FAFB' }}>
                            {coverage.length === 0 ? (
                              <p style={{ margin: 0, color: '#DC2626', fontSize: '0.85rem' }}>No available caregivers for this time slot</p>
                            ) : (
                              <>
                                <div style={{ fontSize: '0.8rem', fontWeight: '600', color: '#374151', marginBottom: '0.5rem' }}>
                                  {coverage.length} caregiver{coverage.length !== 1 ? 's' : ''} available:
                                </div>
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
                                  {coverage.map(cg => (
                                    <div key={cg.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0.5rem 0.75rem', background: '#fff', borderRadius: '6px', border: '1px solid #e5e7eb' }}>
                                      <div>
                                        <span style={{ fontWeight: '500' }}>{cg.first_name} {cg.last_name}</span>
                                        {cg.phone && <span style={{ fontSize: '0.8rem', color: '#888', marginLeft: '0.5rem' }}>{cg.phone}</span>}
                                      </div>
                                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', fontSize: '0.8rem' }}>
                                        <span style={{ color: '#666' }}>
                                          Available {formatTime(cg.avail_start)}–{formatTime(cg.avail_end)}
                                        </span>
                                        <span style={{ color: parseFloat(cg.weekly_hours) >= (cg.max_hours_per_week || 40) ? '#DC2626' : '#059669' }}>
                                          {cg.weekly_hours}h/wk
                                        </span>
                                      </div>
                                    </div>
                                  ))}
                                </div>
                              </>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default TimeOffManagement;
