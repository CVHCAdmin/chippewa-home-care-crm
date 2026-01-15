// src/components/CaregiverDashboard.jsx
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

      if (schedulesRes.ok) {
        const data = await schedulesRes.json();
        setSchedules(Array.isArray(data) ? data : []);
      }

      if (clientsRes.ok) {
        const data = await clientsRes.json();
        setClients(Array.isArray(data) ? data : []);
      }

      if (activeRes.ok) {
        const data = await activeRes.json();
        if (data && data.id) {
          setActiveSession(data);
          setSelectedClient(data.client_id);
        }
      }

      if (visitsRes.ok) {
        const data = await visitsRes.json();
        setRecentVisits(Array.isArray(data) ? data : []);
      }
    } catch (error) {
      console.error('Failed to load data:', error);
    } finally {
      setLoading(false);
    }
  };

  const startGPSTracking = () => {
    if ('geolocation' in navigator) {
      navigator.geolocation.watchPosition(
        (position) => {
          setLocation({
            lat: position.coords.latitude,
            lng: position.coords.longitude,
            accuracy: position.coords.accuracy
          });
          setLocationError(null);
        },
        (error) => {
          setLocationError(error.message);
        },
        { enableHighAccuracy: true, maximumAge: 5000, timeout: 10000 }
      );
    } else {
      setLocationError('Geolocation not supported');
    }
  };

  const handleClockIn = async () => {
    if (!location) {
      alert('GPS location not available. Please enable location services.');
      return;
    }
    if (!selectedClient) {
      alert('Please select a client before clocking in.');
      return;
    }

    try {
      const response = await fetch(`${API_BASE_URL}/api/time-entries/clock-in`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          clientId: selectedClient,
          latitude: location.lat,
          longitude: location.lng
        })
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to clock in');
      }

      const session = await response.json();
      setActiveSession(session);
      startContinuousGPSTracking(session.id);
    } catch (error) {
      alert('Failed to clock in: ' + error.message);
    }
  };

  const handleClockOut = () => {
    if (!activeSession) {
      alert('No active session to clock out from.');
      return;
    }
    setShowNoteModal(true);
  };

  const completeClockOut = async () => {
    try {
      const response = await fetch(`${API_BASE_URL}/api/time-entries/${activeSession.id}/clock-out`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          latitude: location?.lat,
          longitude: location?.lng,
          notes: visitNote
        })
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to clock out');
      }

      setActiveSession(null);
      setSelectedClient('');
      setVisitNote('');
      setShowNoteModal(false);
      loadData();
    } catch (error) {
      alert('Failed to clock out: ' + error.message);
    }
  };

  const startContinuousGPSTracking = (timeEntryId) => {
    const interval = setInterval(async () => {
      if (location && timeEntryId) {
        try {
          await fetch(`${API_BASE_URL}/api/time-entries/${timeEntryId}/gps`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify({
              latitude: location.lat,
              longitude: location.lng,
              accuracy: location.accuracy
            })
          });
        } catch (error) {
          // Silent fail
        }
      }
    }, 60000);

    return () => clearInterval(interval);
  };

  const handlePageClick = (page) => {
    setCurrentPage(page);
    if (window.innerWidth <= 768) {
      setSidebarOpen(false);
    }
  };

  const getClientName = (clientId) => {
    const client = clients.find(c => c.id === clientId);
    return client ? `${client.first_name} ${client.last_name}` : 'Unknown Client';
  };

  const formatTime = (timeStr) => {
    if (!timeStr) return '';
    const [hours, minutes] = timeStr.split(':');
    const h = parseInt(hours);
    const ampm = h >= 12 ? 'PM' : 'AM';
    const hour12 = h % 12 || 12;
    return `${hour12}:${minutes} ${ampm}`;
  };

  const formatElapsedTime = (seconds) => {
    const hrs = Math.floor(seconds / 3600);
    const mins = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;
    return `${hrs.toString().padStart(2, '0')}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  const formatDate = (dateStr) => {
    if (!dateStr) return '';
    return new Date(dateStr).toLocaleDateString('en-US', {
      weekday: 'short',
      month: 'short',
      day: 'numeric'
    });
  };

  const calculateHours = (start, end) => {
    if (!start || !end) return 0;
    const startDate = new Date(`2000-01-01T${start}`);
    const endDate = new Date(`2000-01-01T${end}`);
    return ((endDate - startDate) / (1000 * 60 * 60)).toFixed(1);
  };

  const getTodaySchedules = () => {
    const today = new Date();
    const todayDayOfWeek = today.getDay();
    const todayStr = today.toISOString().split('T')[0];

    return schedules.filter(schedule => {
      if (schedule.day_of_week !== null && schedule.day_of_week !== undefined) {
        return schedule.day_of_week === todayDayOfWeek;
      }
      if (schedule.date) {
        return schedule.date.split('T')[0] === todayStr;
      }
      return false;
    }).sort((a, b) => (a.start_time || '').localeCompare(b.start_time || ''));
  };

  const getUpcomingSchedules = () => {
    const upcoming = [];
    const today = new Date();
    
    for (let i = 0; i < 7; i++) {
      const date = new Date(today);
      date.setDate(date.getDate() + i);
      const dayOfWeek = date.getDay();
      const dateStr = date.toISOString().split('T')[0];

      const daySchedules = schedules.filter(schedule => {
        if (schedule.day_of_week !== null && schedule.day_of_week !== undefined) {
          return schedule.day_of_week === dayOfWeek;
        }
        if (schedule.date) {
          return schedule.date.split('T')[0] === dateStr;
        }
        return false;
      });

      if (daySchedules.length > 0) {
        upcoming.push({
          date: date,
          dateStr: dateStr,
          schedules: daySchedules.sort((a, b) => (a.start_time || '').localeCompare(b.start_time || ''))
        });
      }
    }

    return upcoming;
  };

  const handleClientClick = (clientId, e) => {
    e.stopPropagation();
    setViewingClientId(clientId);
  };

  // Render Home Page
  const renderHomePage = () => {
    const todaySchedules = getTodaySchedules();
    const weeklyHours = getUpcomingSchedules().reduce((total, day) => 
      total + day.schedules.reduce((t, s) => t + parseFloat(calculateHours(s.start_time, s.end_time)), 0)
    , 0);

    return (
      <>
        {/* Clock In/Out Card */}
        <div className={`clock-card ${activeSession ? 'active' : 'ready'}`}>
          {!activeSession ? (
            <>
              <h2>Ready to Clock In?</h2>

              <div className="form-group">
                <label>Select Client</label>
                <select
                  value={selectedClient}
                  onChange={(e) => setSelectedClient(e.target.value)}
                >
                  <option value="">Choose a client...</option>
                  {clients.map(client => (
                    <option key={client.id} value={client.id}>
                      {client.first_name} {client.last_name}
                    </option>
                  ))}
                </select>
              </div>

              {selectedClient && (
                <button
                  className="btn btn-secondary"
                  onClick={() => setViewingClientId(selectedClient)}
                  style={{ marginBottom: '1rem' }}
                >
                  📋 View Client Info
                </button>
              )}

              <div className="gps-status">
                <span className={`gps-dot ${location ? '' : 'inactive'}`}></span>
                {location ? (
                  <span>GPS Active • ±{location.accuracy.toFixed(0)}m accuracy</span>
                ) : (
                  <span>Waiting for GPS...</span>
                )}
              </div>

              <button
                className="clock-btn clock-in"
                onClick={handleClockIn}
                disabled={!selectedClient || !location}
              >
                🟢 CLOCK IN
              </button>
            </>
          ) : (
            <div className="active-info">
              <p>Currently with</p>
              <h2 
                onClick={() => setViewingClientId(activeSession.client_id)}
                style={{ cursor: 'pointer', textDecoration: 'underline' }}
              >
                {getClientName(activeSession.client_id)}
              </h2>
              <small style={{ color: 'rgba(255,255,255,0.8)' }}>Tap name for client info</small>
              
              <div className="timer-display">
                {formatElapsedTime(elapsedTime)}
              </div>

              <p>Started at {new Date(activeSession.start_time).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', hour12: true })}</p>

              <button
                className="clock-btn clock-out"
                onClick={handleClockOut}
              >
                🔴 CLOCK OUT
              </button>
            </div>
          )}
        </div>

        {/* Mileage Tracker */}
        <MileageTracker token={token} caregiverId={user.id} />

        {/* Today's Schedule */}
        <div className="card">
          <div className="schedule-header">
            <h3>📅 Today's Schedule</h3>
            <span className="schedule-count">
              {todaySchedules.length} shift{todaySchedules.length !== 1 ? 's' : ''}
            </span>
          </div>
          
          {todaySchedules.length === 0 ? (
            <p className="text-muted text-center">No shifts scheduled for today</p>
          ) : (
            <div className="schedule-list">
              {todaySchedules.map((schedule, idx) => (
                <div key={schedule.id || idx} className="schedule-item">
                  <div className="schedule-time">
                    <div className="schedule-time-start">{formatTime(schedule.start_time)}</div>
                    <div className="schedule-time-end">{formatTime(schedule.end_time)}</div>
                  </div>
                  <div className="schedule-details">
                    <div 
                      className="schedule-client"
                      onClick={(e) => handleClientClick(schedule.client_id, e)}
                      style={{ cursor: 'pointer', color: '#007bff', textDecoration: 'underline' }}
                    >
                      {getClientName(schedule.client_id)}
                    </div>
                    <div className="schedule-meta">
                      {calculateHours(schedule.start_time, schedule.end_time)}h
                      {schedule.day_of_week !== null && (
                        <span className="badge-weekly">Weekly</span>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Quick Stats */}
        <div className="stats-grid-2">
          <div className="card text-center">
            <div className="stat-value-large stat-value-green">
              {todaySchedules.reduce((total, s) => total + parseFloat(calculateHours(s.start_time, s.end_time)), 0).toFixed(1)}h
            </div>
            <div className="stat-label">Today's Hours</div>
          </div>
          <div className="card text-center">
            <div className="stat-value-large stat-value-blue">
              {weeklyHours.toFixed(1)}h
            </div>
            <div className="stat-label">This Week</div>
          </div>
        </div>
      </>
    );
  };

  // Render Schedule Page
  const renderSchedulePage = () => {
    const upcoming = getUpcomingSchedules();

    return (
      <>
        <div className="schedule-header">
          <h3>📅 Upcoming Schedule</h3>
        </div>

        {upcoming.length === 0 ? (
          <div className="card text-center">
            <p className="text-muted">No upcoming shifts scheduled</p>
          </div>
        ) : (
          <div className="schedule-list">
            {upcoming.map((day, idx) => (
              <div key={idx} className="card schedule-day-card">
                <div className={`schedule-day-header ${idx === 0 ? 'today' : ''}`}>
                  <div>
                    <span className="schedule-day-name">
                      {idx === 0 ? 'Today' : day.date.toLocaleDateString('en-US', { weekday: 'long' })}
                    </span>
                    <span className="schedule-day-date">
                      {day.date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                    </span>
                  </div>
                  <span className="schedule-day-hours">
                    {day.schedules.reduce((t, s) => t + parseFloat(calculateHours(s.start_time, s.end_time)), 0).toFixed(1)}h
                  </span>
                </div>
                <div className="schedule-day-list">
                  {day.schedules.map((schedule, sIdx) => (
                    <div key={schedule.id || sIdx} className="schedule-day-item">
                      <div className="schedule-time">
                        <div className="schedule-time-start">{formatTime(schedule.start_time)}</div>
                        <div className="schedule-time-end">{formatTime(schedule.end_time)}</div>
                      </div>
                      <div className="schedule-details">
                        <div 
                          className="schedule-client"
                          onClick={(e) => handleClientClick(schedule.client_id, e)}
                          style={{ cursor: 'pointer', color: '#007bff', textDecoration: 'underline' }}
                        >
                          {getClientName(schedule.client_id)}
                        </div>
                        {schedule.notes && (
                          <div className="schedule-meta">{schedule.notes}</div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </>
    );
  };

  // Render History Page
  const renderHistoryPage = () => (
    <div className="card">
      <div className="card-title">Recent Visits</div>
      
      {recentVisits.length === 0 ? (
        <p className="text-muted text-center">No recent visits</p>
      ) : (
        <table className="table">
          <thead>
            <tr>
              <th>Date</th>
              <th>Client</th>
              <th>Time</th>
              <th>Hours</th>
            </tr>
          </thead>
          <tbody>
            {recentVisits.map((visit, idx) => (
              <tr key={visit.id || idx}>
                <td>{formatDate(visit.start_time)}</td>
                <td>
                  <span 
                    onClick={() => setViewingClientId(visit.client_id)}
                    style={{ cursor: 'pointer', color: '#007bff', textDecoration: 'underline' }}
                  >
                    {visit.client_name || getClientName(visit.client_id)}
                  </span>
                </td>
                <td>
                  {new Date(visit.start_time).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', hour12: true })}
                  {visit.end_time && ` - ${new Date(visit.end_time).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', hour12: true })}`}
                </td>
                <td>{visit.hours_worked ? `${parseFloat(visit.hours_worked).toFixed(1)}h` : '-'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );

  // Render Clients Page
  const renderClientsPage = () => {
    const myClientIds = [...new Set(schedules.map(s => s.client_id))];
    const myClients = clients.filter(c => myClientIds.includes(c.id));

    return (
      <>
        <div className="schedule-header">
          <h3>👥 My Clients</h3>
        </div>

        {myClients.length === 0 ? (
          <div className="card text-center">
            <p className="text-muted">No clients assigned yet</p>
          </div>
        ) : (
          <div style={{ display: 'grid', gap: '1rem' }}>
            {myClients.map(client => (
              <div 
                key={client.id} 
                className="card"
                onClick={() => setViewingClientId(client.id)}
                style={{ cursor: 'pointer' }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div>
                    <h4 style={{ margin: 0 }}>{client.first_name} {client.last_name}</h4>
                    <p style={{ margin: '0.25rem 0 0 0', color: '#666', fontSize: '0.9rem' }}>
                      📞 {client.phone || 'No phone'} • 📍 {client.city || 'No city'}
                    </p>
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

  // Render Settings Page
  const renderSettingsPage = () => (
    <>
      <div className="card">
        <div className="card-title">Profile</div>
        <div className="form-group">
          <label>Name</label>
          <input type="text" value={user.name || `${user.first_name} ${user.last_name}`} disabled />
        </div>
        <div className="form-group">
          <label>Email</label>
          <input type="text" value={user.email} disabled />
        </div>
      </div>

      <div className="card">
        <div className="card-title">GPS Status</div>
        <div className={`alert ${location ? 'alert-success' : 'alert-error'}`}>
          {location ? (
            <>
              <strong>GPS Active</strong><br />
              Accuracy: ±{location.accuracy.toFixed(0)} meters
            </>
          ) : (
            <>
              <strong>GPS Not Available</strong><br />
              {locationError || 'Please enable location services'}
            </>
          )}
        </div>
      </div>

      <button className="btn btn-danger btn-block" onClick={onLogout}>
        Log Out
      </button>
    </>
  );

  if (loading) {
    return (
      <div className="loading">
        <div className="spinner"></div>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', width: '100%', height: '100%' }}>
      {sidebarOpen && window.innerWidth <= 768 && (
        <div
          className="sidebar-overlay active"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      <div className={`sidebar ${sidebarOpen ? 'open' : ''}`}>
        <div className="sidebar-logo">CVHC CRM</div>
        <ul className="sidebar-nav">
          <li>
            <a href="#home" className={currentPage === 'home' ? 'active' : ''} onClick={() => handlePageClick('home')}>
              Home
            </a>
          </li>
          <li>
            <a href="#schedule" className={currentPage === 'schedule' ? 'active' : ''} onClick={() => handlePageClick('schedule')}>
              My Schedule
            </a>
          </li>
          <li>
            <a href="#clients" className={currentPage === 'clients' ? 'active' : ''} onClick={() => handlePageClick('clients')}>
              My Clients
            </a>
          </li>
          <li>
            <a href="#history" className={currentPage === 'history' ? 'active' : ''} onClick={() => handlePageClick('history')}>
              Visit History
            </a>
          </li>
          <li>
            <a href="#settings" className={currentPage === 'settings' ? 'active' : ''} onClick={() => handlePageClick('settings')}>
              Settings
            </a>
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
          <div>
            <h1>Chippewa Valley Home Care</h1>
            <p>Caregiver Portal</p>
          </div>
          <button className="hamburger-btn" onClick={() => setSidebarOpen(!sidebarOpen)} title="Menu">
            Menu
          </button>
        </div>

        <div className="container">
          {currentPage === 'home' && renderHomePage()}
          {currentPage === 'schedule' && renderSchedulePage()}
          {currentPage === 'clients' && renderClientsPage()}
          {currentPage === 'history' && renderHistoryPage()}
          {currentPage === 'settings' && renderSettingsPage()}
        </div>
      </div>

      {/* Visit Note Modal */}
      {showNoteModal && (
        <div className="modal active">
          <div className="modal-content">
            <div className="modal-header">
              <h2>Visit Notes</h2>
              <button className="close-btn" onClick={() => setShowNoteModal(false)}>×</button>
            </div>
            
            <p className="text-muted">Add any notes about this visit (optional)</p>
            
            <div className="form-group">
              <textarea
                value={visitNote}
                onChange={(e) => setVisitNote(e.target.value)}
                placeholder="How did the visit go? Any concerns or updates?"
                rows={4}
              />
            </div>

            <div className="form-actions">
              <button className="btn btn-secondary" onClick={() => setShowNoteModal(false)}>Cancel</button>
              <button className="btn btn-primary" onClick={completeClockOut}>Complete Clock Out</button>
            </div>
          </div>
        </div>
      )}

      {/* Client Info Modal */}
      <CaregiverClientModal
        clientId={viewingClientId}
        isOpen={!!viewingClientId}
        onClose={() => setViewingClientId(null)}
        token={token}
      />
    </div>
  );
};

export default CaregiverDashboard;
