// src/components/CaregiverDashboard.jsx
// Enhanced with self-service: availability, open shifts pickup, time off requests
import React, { useState, useEffect, useRef } from 'react';
import { API_BASE_URL } from '../config';
import CaregiverClientModal from './CaregiverClientModal';
import MileageTracker from './MileageTracker';

const CaregiverDashboard = ({ user, token, onLogout }) => {
  const [currentPage, setCurrentPage] = useState('home');
  const [schedules, setSchedules] = useState([]);
  const [clients, setClients] = useState([]);
  const [activeSession, setActiveSession] = useState(null);
  const [loading, setLoading] = useState(true);
  const [location, setLocation] = useState(null);
  const [locationError, setLocationError] = useState(null);
  const [selectedClient, setSelectedClient] = useState('');
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [elapsedTime, setElapsedTime] = useState(0);
  const [visitNote, setVisitNote] = useState('');
  const [showNoteModal, setShowNoteModal] = useState(false);
  const [recentVisits, setRecentVisits] = useState([]);
  const [viewingClientId, setViewingClientId] = useState(null);
  const timerRef = useRef(null);

  // Self-service state
  const [openShifts, setOpenShifts] = useState([]);
  const [myHoursThisWeek, setMyHoursThisWeek] = useState(0);
  const [availability, setAvailability] = useState({
    status: 'available',
    maxHoursPerWeek: 40,
    weeklyAvailability: {
      0: { available: false, start: '09:00', end: '17:00' },
      1: { available: true, start: '09:00', end: '17:00' },
      2: { available: true, start: '09:00', end: '17:00' },
      3: { available: true, start: '09:00', end: '17:00' },
      4: { available: true, start: '09:00', end: '17:00' },
      5: { available: true, start: '09:00', end: '17:00' },
      6: { available: false, start: '09:00', end: '17:00' }
    },
    notes: ''
  });
  const [timeOffRequests, setTimeOffRequests] = useState([]);
  const [newTimeOff, setNewTimeOff] = useState({ startDate: '', endDate: '', reason: '' });
  const [message, setMessage] = useState({ text: '', type: '' });

  useEffect(() => {
    loadData();
    startGPSTracking();
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, []);

  useEffect(() => {
    if (activeSession) {
      timerRef.current = setInterval(() => {
        const start = new Date(activeSession.start_time);
        const now = new Date();
        setElapsedTime(Math.floor((now - start) / 1000));
      }, 1000);
    } else {
      if (timerRef.current) clearInterval(timerRef.current);
      setElapsedTime(0);
    }
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [activeSession]);

  useEffect(() => {
    if (window.innerWidth <= 768) {
      setSidebarOpen(false);
    }
  }, [currentPage]);

  useEffect(() => {
    if (currentPage === 'open-shifts') loadOpenShifts();
    if (currentPage === 'availability') loadAvailability();
    if (currentPage === 'time-off') loadTimeOffRequests();
  }, [currentPage]);

  const loadData = async () => {
    try {
      const [schedulesRes, clientsRes, activeRes, visitsRes] = await Promise.all([
        fetch(`${API_BASE_URL}/api/schedules/${user.id}`, {
          headers: { 'Authorization': `Bearer ${token}` }
        }),
        fetch(`${API_BASE_URL}/api/clients`, {
          headers: { 'Authorization': `Bearer ${token}` }
        }),
        fetch(`${API_BASE_URL}/api/time-entries/active`, {
          headers: { 'Authorization': `Bearer ${token}` }
        }).catch(() => ({ ok: false })),
        fetch(`${API_BASE_URL}/api/time-entries/recent?limit=10`, {
          headers: { 'Authorization': `Bearer ${token}` }
        }).catch(() => ({ ok: false }))
      ]);

      if (schedulesRes.ok) setSchedules(await schedulesRes.json());
      if (clientsRes.ok) setClients(await clientsRes.json());
      if (activeRes.ok) {
        const data = await activeRes.json();
        if (data?.id) {
          setActiveSession(data);
          setSelectedClient(data.client_id);
        }
      }
      if (visitsRes.ok) setRecentVisits(await visitsRes.json());
      loadMyHours();
    } catch (error) {
      console.error('Failed to load data:', error);
    } finally {
      setLoading(false);
    }
  };

  const loadOpenShifts = async () => {
    try {
      const res = await fetch(`${API_BASE_URL}/api/open-shifts/available`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (res.ok) setOpenShifts(await res.json());
    } catch (error) {
      console.error('Failed to load open shifts:', error);
    }
  };

  const loadAvailability = async () => {
    try {
      const res = await fetch(`${API_BASE_URL}/api/caregivers/${user.id}/availability`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (res.ok) {
        const data = await res.json();
        if (data) {
          setAvailability(prev => ({
            status: data.status || prev.status,
            maxHoursPerWeek: data.max_hours_per_week || prev.maxHoursPerWeek,
            weeklyAvailability: data.weekly_availability ? 
              (typeof data.weekly_availability === 'string' ? JSON.parse(data.weekly_availability) : data.weekly_availability) 
              : prev.weeklyAvailability,
            notes: data.notes || ''
          }));
        }
      }
    } catch (error) {
      console.error('Failed to load availability:', error);
    }
  };

  const loadTimeOffRequests = async () => {
    try {
      const res = await fetch(`${API_BASE_URL}/api/absences/my`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (res.ok) setTimeOffRequests(await res.json());
    } catch (error) {
      console.error('Failed to load time off:', error);
    }
  };

  const loadMyHours = async () => {
    try {
      const res = await fetch(`${API_BASE_URL}/api/scheduling/caregiver-hours/${user.id}`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (res.ok) {
        const data = await res.json();
        setMyHoursThisWeek(parseFloat(data.totalHours) || 0);
      }
    } catch (error) {
      console.error('Failed to load hours:', error);
    }
  };

  const showMsg = (text, type = 'success') => {
    setMessage({ text, type });
    setTimeout(() => setMessage({ text: '', type: '' }), 4000);
  };

  const startGPSTracking = () => {
    if ('geolocation' in navigator) {
      navigator.geolocation.watchPosition(
        (pos) => {
          setLocation({ lat: pos.coords.latitude, lng: pos.coords.longitude, accuracy: pos.coords.accuracy });
          setLocationError(null);
        },
        (err) => setLocationError(err.message),
        { enableHighAccuracy: true, maximumAge: 5000, timeout: 10000 }
      );
    } else {
      setLocationError('Geolocation not supported');
    }
  };

  const handleClockIn = async () => {
    if (!location) return alert('GPS not available. Enable location services.');
    if (!selectedClient) return alert('Please select a client.');

    try {
      const res = await fetch(`${API_BASE_URL}/api/time-entries/clock-in`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({ clientId: selectedClient, latitude: location.lat, longitude: location.lng })
      });
      if (!res.ok) throw new Error((await res.json()).error || 'Failed');
      setActiveSession(await res.json());
    } catch (error) {
      alert('Failed to clock in: ' + error.message);
    }
  };

  const handleClockOut = () => {
    if (!activeSession) return alert('No active session.');
    setShowNoteModal(true);
  };

  const completeClockOut = async () => {
    try {
      const res = await fetch(`${API_BASE_URL}/api/time-entries/${activeSession.id}/clock-out`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({ latitude: location?.lat, longitude: location?.lng, notes: visitNote })
      });
      if (!res.ok) throw new Error((await res.json()).error || 'Failed');
      setActiveSession(null);
      setSelectedClient('');
      setVisitNote('');
      setShowNoteModal(false);
      loadData();
    } catch (error) {
      alert('Failed to clock out: ' + error.message);
    }
  };

  const handlePickupShift = async (shiftId) => {
    try {
      const res = await fetch(`${API_BASE_URL}/api/open-shifts/${shiftId}/claim`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` }
      });
      if (!res.ok) throw new Error((await res.json()).error || 'Failed');
      showMsg('Shift claimed!');
      loadOpenShifts();
      loadData();
    } catch (error) {
      showMsg(error.message, 'error');
    }
  };

  const handleSaveAvailability = async () => {
    try {
      const res = await fetch(`${API_BASE_URL}/api/caregiver-availability/${user.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({
          status: availability.status,
          maxHoursPerWeek: availability.maxHoursPerWeek,
          weeklyAvailability: availability.weeklyAvailability,
          notes: availability.notes
        })
      });
      if (!res.ok) throw new Error('Failed');
      showMsg('Availability saved!');
    } catch (error) {
      showMsg(error.message, 'error');
    }
  };

  const handleRequestTimeOff = async (e) => {
    e.preventDefault();
    if (!newTimeOff.startDate || !newTimeOff.endDate) return showMsg('Select dates', 'error');

    try {
      const res = await fetch(`${API_BASE_URL}/api/absences`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({
          caregiverId: user.id,
          absenceType: 'time_off_request',
          startDate: newTimeOff.startDate,
          endDate: newTimeOff.endDate,
          reason: newTimeOff.reason,
          status: 'pending'
        })
      });
      if (!res.ok) throw new Error('Failed');
      showMsg('Request submitted!');
      setNewTimeOff({ startDate: '', endDate: '', reason: '' });
      loadTimeOffRequests();
    } catch (error) {
      showMsg(error.message, 'error');
    }
  };

  const handlePageClick = (page) => {
    setCurrentPage(page);
    if (window.innerWidth <= 768) setSidebarOpen(false);
  };

  const getClientName = (id) => {
    const c = clients.find(c => c.id === id);
    return c ? `${c.first_name} ${c.last_name}` : 'Unknown';
  };

  const formatTime = (t) => {
    if (!t) return '';
    const [h, m] = t.split(':');
    const hr = parseInt(h);
    return `${hr % 12 || 12}:${m} ${hr >= 12 ? 'PM' : 'AM'}`;
  };

  const formatElapsed = (s) => {
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = s % 60;
    return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${sec.toString().padStart(2, '0')}`;
  };

  const formatDate = (d) => d ? new Date(d).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }) : '';
  const getDayName = (n) => ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][n] || '';

  // RENDER PAGES
  const renderHomePage = () => (
    <>
      <div className="card" style={{ background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)', color: '#fff', marginBottom: '1rem' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <div style={{ fontSize: '0.9rem', opacity: 0.9 }}>Hours This Week</div>
            <div style={{ fontSize: '2rem', fontWeight: 'bold' }}>{myHoursThisWeek.toFixed(1)}h</div>
          </div>
          <div style={{ fontSize: '3rem', opacity: 0.5 }}>⏱️</div>
        </div>
        {myHoursThisWeek > 35 && (
          <div style={{ marginTop: '0.5rem', padding: '0.5rem', background: 'rgba(255,255,255,0.2)', borderRadius: '6px', fontSize: '0.85rem' }}>
            ⚠️ Approaching 40 hour limit
          </div>
        )}
      </div>

      <div className="card">
        <div className="card-title">{activeSession ? '🟢 Clocked In' : '⏰ Clock In/Out'}</div>
        {activeSession ? (
          <div style={{ textAlign: 'center', padding: '1rem 0' }}>
            <div style={{ fontSize: '0.9rem', color: '#666' }}>Working with: <strong>{getClientName(activeSession.client_id)}</strong></div>
            <div style={{ fontSize: '3rem', fontWeight: 'bold', fontFamily: 'monospace', color: '#2563eb' }}>{formatElapsed(elapsedTime)}</div>
            <button className="btn btn-danger btn-block" style={{ marginTop: '1rem' }} onClick={handleClockOut}>🛑 Clock Out</button>
          </div>
        ) : (
          <>
            <div className="form-group">
              <label>Select Client</label>
              <select value={selectedClient} onChange={(e) => setSelectedClient(e.target.value)}>
                <option value="">Choose client...</option>
                {clients.map(c => <option key={c.id} value={c.id}>{c.first_name} {c.last_name}</option>)}
              </select>
            </div>
            <div className={`alert ${location ? 'alert-success' : 'alert-warning'}`} style={{ marginBottom: '1rem' }}>
              {location ? `📍 GPS Active (±${location.accuracy?.toFixed(0)}m)` : '⚠️ ' + (locationError || 'Getting location...')}
            </div>
            <button className="btn btn-primary btn-block" onClick={handleClockIn} disabled={!location || !selectedClient}>▶️ Clock In</button>
          </>
        )}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem', marginTop: '1rem' }}>
        <div className="card" style={{ textAlign: 'center', cursor: 'pointer', padding: '1rem' }} onClick={() => handlePageClick('open-shifts')}>
          <div style={{ fontSize: '2rem' }}>📋</div>
          <div style={{ fontWeight: '600' }}>Open Shifts</div>
        </div>
        <div className="card" style={{ textAlign: 'center', cursor: 'pointer', padding: '1rem' }} onClick={() => handlePageClick('availability')}>
          <div style={{ fontSize: '2rem' }}>⏰</div>
          <div style={{ fontWeight: '600' }}>Availability</div>
        </div>
      </div>
    </>
  );

  const renderOpenShiftsPage = () => (
    <>
      <div className="schedule-header"><h3>📋 Available Shifts</h3></div>
      {openShifts.length === 0 ? (
        <div className="card text-center"><p style={{ fontSize: '3rem', margin: '1rem 0' }}>✅</p><p className="text-muted">No open shifts</p></div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
          {openShifts.map(shift => (
            <div key={shift.id} className="card" style={{ padding: '1rem' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <div>
                  <div style={{ fontWeight: '600' }}>{shift.client_first_name} {shift.client_last_name}</div>
                  <div style={{ fontSize: '0.9rem', color: '#666' }}>📅 {formatDate(shift.date)}</div>
                  <div style={{ fontSize: '0.9rem', color: '#666' }}>🕐 {formatTime(shift.start_time)} - {formatTime(shift.end_time)}</div>
                </div>
                <button className="btn btn-sm btn-primary" onClick={() => handlePickupShift(shift.id)}>Claim</button>
              </div>
            </div>
          ))}
        </div>
      )}
    </>
  );

  const renderAvailabilityPage = () => (
    <>
      <div className="schedule-header"><h3>⏰ My Availability</h3></div>
      <div className="card">
        <div className="form-group">
          <label>Status</label>
          <select value={availability.status} onChange={(e) => setAvailability({ ...availability, status: e.target.value })}>
            <option value="available">✅ Available</option>
            <option value="limited">⚠️ Limited</option>
            <option value="unavailable">❌ Unavailable</option>
          </select>
        </div>
        <div className="form-group">
          <label>Max Hours/Week: {availability.maxHoursPerWeek}</label>
          <input type="range" min="0" max="60" value={availability.maxHoursPerWeek} onChange={(e) => setAvailability({ ...availability, maxHoursPerWeek: parseInt(e.target.value) })} style={{ width: '100%' }} />
        </div>
        <div className="form-group">
          <label>Weekly Schedule</label>
          {[0,1,2,3,4,5,6].map(day => {
            const d = availability.weeklyAvailability[day] || { available: false, start: '09:00', end: '17:00' };
            return (
              <div key={day} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.5rem', background: d.available ? '#D1FAE5' : '#F3F4F6', borderRadius: '6px', marginBottom: '0.25rem' }}>
                <input type="checkbox" checked={d.available} onChange={(e) => {
                  const u = { ...availability.weeklyAvailability };
                  u[day] = { ...d, available: e.target.checked };
                  setAvailability({ ...availability, weeklyAvailability: u });
                }} style={{ width: 'auto' }} />
                <span style={{ width: '60px', fontWeight: '500' }}>{getDayName(day).slice(0,3)}</span>
                {d.available && (
                  <>
                    <input type="time" value={d.start} onChange={(e) => {
                      const u = { ...availability.weeklyAvailability };
                      u[day] = { ...d, start: e.target.value };
                      setAvailability({ ...availability, weeklyAvailability: u });
                    }} style={{ padding: '0.25rem' }} />
                    <span>-</span>
                    <input type="time" value={d.end} onChange={(e) => {
                      const u = { ...availability.weeklyAvailability };
                      u[day] = { ...d, end: e.target.value };
                      setAvailability({ ...availability, weeklyAvailability: u });
                    }} style={{ padding: '0.25rem' }} />
                  </>
                )}
              </div>
            );
          })}
        </div>
        <div className="form-group">
          <label>Notes</label>
          <textarea value={availability.notes} onChange={(e) => setAvailability({ ...availability, notes: e.target.value })} rows={2} placeholder="Any notes..." />
        </div>
        <button className="btn btn-primary btn-block" onClick={handleSaveAvailability}>💾 Save</button>
      </div>
    </>
  );

  const renderTimeOffPage = () => (
    <>
      <div className="schedule-header"><h3>🏖️ Time Off</h3></div>
      <div className="card" style={{ marginBottom: '1rem' }}>
        <h4 style={{ margin: '0 0 1rem 0' }}>Request Time Off</h4>
        <form onSubmit={handleRequestTimeOff}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
            <div className="form-group" style={{ margin: 0 }}>
              <label>Start</label>
              <input type="date" value={newTimeOff.startDate} onChange={(e) => setNewTimeOff({ ...newTimeOff, startDate: e.target.value })} min={new Date().toISOString().split('T')[0]} required />
            </div>
            <div className="form-group" style={{ margin: 0 }}>
              <label>End</label>
              <input type="date" value={newTimeOff.endDate} onChange={(e) => setNewTimeOff({ ...newTimeOff, endDate: e.target.value })} min={newTimeOff.startDate || new Date().toISOString().split('T')[0]} required />
            </div>
          </div>
          <div className="form-group">
            <label>Reason</label>
            <input type="text" value={newTimeOff.reason} onChange={(e) => setNewTimeOff({ ...newTimeOff, reason: e.target.value })} placeholder="Vacation, etc." />
          </div>
          <button type="submit" className="btn btn-primary">Submit</button>
        </form>
      </div>
      <div className="card">
        <h4 style={{ margin: '0 0 1rem 0' }}>My Requests</h4>
        {timeOffRequests.length === 0 ? <p className="text-muted text-center">None</p> : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
            {timeOffRequests.map(r => (
              <div key={r.id} style={{ padding: '0.75rem', borderRadius: '6px', background: r.status === 'approved' ? '#D1FAE5' : r.status === 'denied' ? '#FEE2E2' : '#FEF3C7', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                  <div style={{ fontWeight: '500' }}>{formatDate(r.start_date)} - {formatDate(r.end_date)}</div>
                  {r.reason && <div style={{ fontSize: '0.85rem', color: '#666' }}>{r.reason}</div>}
                </div>
                <span style={{ padding: '0.25rem 0.75rem', borderRadius: '12px', fontSize: '0.75rem', fontWeight: '600', background: r.status === 'approved' ? '#059669' : r.status === 'denied' ? '#DC2626' : '#D97706', color: '#fff' }}>
                  {(r.status || 'pending').toUpperCase()}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </>
  );

  const renderSchedulePage = () => {
    const recurring = schedules.filter(s => s.day_of_week != null);
    const oneTime = schedules.filter(s => s.date);
    const grouped = {};
    recurring.forEach(s => { if (!grouped[s.day_of_week]) grouped[s.day_of_week] = []; grouped[s.day_of_week].push(s); });

    return (
      <>
        <div className="schedule-header"><h3>📅 My Schedule</h3></div>
        {schedules.length === 0 ? <div className="card text-center"><p className="text-muted">No schedules</p></div> : (
          <div>
            {Object.keys(grouped).sort().map(day => (
              <div key={day} className="card" style={{ marginBottom: '0.75rem' }}>
                <div style={{ fontWeight: '600', color: '#2563eb' }}>{getDayName(parseInt(day))}s</div>
                {grouped[day].map(s => (
                  <div key={s.id} style={{ padding: '0.5rem 0', borderTop: '1px solid #eee' }}>
                    <div style={{ fontWeight: '500' }}>{getClientName(s.client_id)}</div>
                    <div style={{ fontSize: '0.9rem', color: '#666' }}>{formatTime(s.start_time)} - {formatTime(s.end_time)}</div>
                  </div>
                ))}
              </div>
            ))}
            {oneTime.length > 0 && (
              <div className="card">
                <div style={{ fontWeight: '600', color: '#059669' }}>Upcoming</div>
                {oneTime.sort((a,b) => new Date(a.date) - new Date(b.date)).map(s => (
                  <div key={s.id} style={{ padding: '0.5rem 0', borderTop: '1px solid #eee' }}>
                    <div style={{ fontWeight: '500' }}>{formatDate(s.date)}</div>
                    <div>{getClientName(s.client_id)}</div>
                    <div style={{ fontSize: '0.9rem', color: '#666' }}>{formatTime(s.start_time)} - {formatTime(s.end_time)}</div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </>
    );
  };

  const renderHistoryPage = () => (
    <div className="card">
      <div className="card-title">Recent Visits</div>
      {recentVisits.length === 0 ? <p className="text-muted text-center">None</p> : (
        <div style={{ overflowX: 'auto' }}>
          <table className="table">
            <thead><tr><th>Date</th><th>Client</th><th>Hours</th></tr></thead>
            <tbody>
              {recentVisits.map((v, i) => (
                <tr key={v.id || i}>
                  <td>{formatDate(v.start_time)}</td>
                  <td><span onClick={() => setViewingClientId(v.client_id)} style={{ cursor: 'pointer', color: '#007bff' }}>{v.client_name || getClientName(v.client_id)}</span></td>
                  <td>{v.hours_worked ? `${parseFloat(v.hours_worked).toFixed(1)}h` : '-'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );

  const renderClientsPage = () => {
    const myClients = clients.filter(c => schedules.some(s => s.client_id === c.id));
    return (
      <>
        <div className="schedule-header"><h3>👥 My Clients</h3></div>
        {myClients.length === 0 ? <div className="card text-center"><p className="text-muted">No clients</p></div> : (
          <div style={{ display: 'grid', gap: '0.75rem' }}>
            {myClients.map(c => (
              <div key={c.id} className="card" onClick={() => setViewingClientId(c.id)} style={{ cursor: 'pointer' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div>
                    <h4 style={{ margin: 0 }}>{c.first_name} {c.last_name}</h4>
                    <p style={{ margin: '0.25rem 0 0 0', color: '#666', fontSize: '0.9rem' }}>📞 {c.phone || 'N/A'} • 📍 {c.city || 'N/A'}</p>
                  </div>
                  <span style={{ color: '#007bff', fontSize: '1.2rem' }}>→</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </>
    );
  };

  const renderSettingsPage = () => (
    <>
      <div className="card">
        <div className="card-title">Profile</div>
        <div className="form-group"><label>Name</label><input type="text" value={user.name || `${user.first_name} ${user.last_name}`} disabled /></div>
        <div className="form-group"><label>Email</label><input type="text" value={user.email} disabled /></div>
      </div>
      <div className="card">
        <div className="card-title">GPS Status</div>
        <div className={`alert ${location ? 'alert-success' : 'alert-error'}`}>
          {location ? <>GPS Active (±{location.accuracy?.toFixed(0)}m)</> : <>{locationError || 'Enable location'}</>}
        </div>
      </div>
      <button className="btn btn-danger btn-block" onClick={onLogout}>Log Out</button>
    </>
  );

  if (loading) return <div className="loading"><div className="spinner"></div></div>;

  return (
    <div style={{ display: 'flex', width: '100%', height: '100%' }}>
      {message.text && (
        <div style={{ position: 'fixed', top: '1rem', right: '1rem', padding: '1rem 1.5rem', borderRadius: '8px', zIndex: 1001, background: message.type === 'error' ? '#FEE2E2' : '#D1FAE5', color: message.type === 'error' ? '#DC2626' : '#059669', boxShadow: '0 4px 12px rgba(0,0,0,0.15)' }}>
          {message.text}
        </div>
      )}

      {sidebarOpen && window.innerWidth <= 768 && <div className="sidebar-overlay active" onClick={() => setSidebarOpen(false)} />}

      <div className={`sidebar ${sidebarOpen ? 'open' : ''}`}>
        <div className="sidebar-logo">CVHC</div>
        <ul className="sidebar-nav">
          <li><a href="#" className={currentPage === 'home' ? 'active' : ''} onClick={() => handlePageClick('home')}>🏠 Home</a></li>
          <li><a href="#" className={currentPage === 'schedule' ? 'active' : ''} onClick={() => handlePageClick('schedule')}>📅 Schedule</a></li>
          <li><a href="#" className={currentPage === 'clients' ? 'active' : ''} onClick={() => handlePageClick('clients')}>👥 Clients</a></li>
          <li><a href="#" className={currentPage === 'history' ? 'active' : ''} onClick={() => handlePageClick('history')}>📜 History</a></li>
          <li style={{ paddingTop: '1rem', borderTop: '1px solid rgba(255,255,255,0.1)', marginTop: '0.5rem' }}>
            <span style={{ fontSize: '0.65rem', textTransform: 'uppercase', color: 'rgba(255,255,255,0.4)', display: 'block', padding: '0.5rem 1rem' }}>Self Service</span>
          </li>
          <li><a href="#" className={currentPage === 'open-shifts' ? 'active' : ''} onClick={() => handlePageClick('open-shifts')}>📋 Open Shifts</a></li>
          <li><a href="#" className={currentPage === 'availability' ? 'active' : ''} onClick={() => handlePageClick('availability')}>⏰ Availability</a></li>
          <li><a href="#" className={currentPage === 'time-off' ? 'active' : ''} onClick={() => handlePageClick('time-off')}>🏖️ Time Off</a></li>
          <li style={{ paddingTop: '1rem', borderTop: '1px solid rgba(255,255,255,0.1)', marginTop: '0.5rem' }}>
            <a href="#" className={currentPage === 'settings' ? 'active' : ''} onClick={() => handlePageClick('settings')}>⚙️ Settings</a>
          </li>
        </ul>
        <div className="sidebar-user">
          <div className="sidebar-user-name">{user.name || `${user.first_name || ''} ${user.last_name || ''}`}</div>
          <div className="sidebar-user-role">Caregiver</div>
          <button className="btn-logout" onClick={onLogout}>Logout</button>
        </div>
      </div>

      <div className="main-content">
        <div className="header">
          <div><h1>Chippewa Valley Home Care</h1><p>Caregiver Portal</p></div>
          <button className="hamburger-btn" onClick={() => setSidebarOpen(!sidebarOpen)}>Menu</button>
        </div>
        <div className="container">
          {currentPage === 'home' && renderHomePage()}
          {currentPage === 'schedule' && renderSchedulePage()}
          {currentPage === 'clients' && renderClientsPage()}
          {currentPage === 'history' && renderHistoryPage()}
          {currentPage === 'open-shifts' && renderOpenShiftsPage()}
          {currentPage === 'availability' && renderAvailabilityPage()}
          {currentPage === 'time-off' && renderTimeOffPage()}
          {currentPage === 'settings' && renderSettingsPage()}
        </div>
      </div>

      {showNoteModal && (
        <div className="modal active">
          <div className="modal-content">
            <div className="modal-header"><h2>Visit Notes</h2><button className="close-btn" onClick={() => setShowNoteModal(false)}>×</button></div>
            <p className="text-muted">Add notes (optional)</p>
            <div className="form-group"><textarea value={visitNote} onChange={(e) => setVisitNote(e.target.value)} placeholder="How did the visit go?" rows={4} /></div>
            <div className="form-actions">
              <button className="btn btn-secondary" onClick={() => setShowNoteModal(false)}>Cancel</button>
              <button className="btn btn-primary" onClick={completeClockOut}>Clock Out</button>
            </div>
          </div>
        </div>
      )}

      <CaregiverClientModal clientId={viewingClientId} isOpen={!!viewingClientId} onClose={() => setViewingClientId(null)} token={token} />
    </div>
  );
};

export default CaregiverDashboard;
