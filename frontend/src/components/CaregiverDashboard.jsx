// src/components/CaregiverDashboard.jsx
import React, { useState, useEffect, useRef } from 'react';
import { API_BASE_URL } from '../config';

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
          // Silent fail for GPS tracking
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

  // Helper functions
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

  // Render Home Page
  const renderHomePage = () => {
    const todaySchedules = getTodaySchedules();
    const weeklyHours = getUpcomingSchedules().reduce((total, day) => 
      total + day.schedules.reduce((t, s) => t + parseFloat(calculateHours(s.start_time, s.end_time)), 0)
    , 0);

    return (
      <>
        {/* Stats Row */}
        <div className="grid">
          <div className="stat-card">
            <h3>Today's Shifts</h3>
            <div className="value">{todaySchedules.length}</div>
          </div>
          <div className="stat-card">
            <h3>Hours This Week</h3>
            <div className="value">{weeklyHours.toFixed(1)}</div>
          </div>
          <div className="stat-card">
            <h3>GPS Status</h3>
            <div className="value">
              <span className={location ? 'badge badge-success' : 'badge badge-danger'}>
                {location ? 'Active' : 'Inactive'}
              </span>
            </div>
          </div>
        </div>

        {/* Clock In/Out Card */}
        <div className="card">
          <div className="card-title">
            {activeSession ? 'Currently Working' : 'Clock In'}
          </div>

          {!activeSession ? (
            <>
              <div className="form-group">
                <label>Select Client *</label>
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

              {location && (
                <p className="text-muted">
                  GPS Active (±{location.accuracy.toFixed(0)}m accuracy)
                </p>
              )}

              <button
                className="btn btn-primary btn-block"
                onClick={handleClockIn}
                disabled={!selectedClient || !location}
              >
                CLOCK IN
              </button>
            </>
          ) : (
            <>
              <p className="text-muted">Working with</p>
              <h3>{getClientName(activeSession.client_id)}</h3>
              
              <div className="timer-display">
                {formatElapsedTime(elapsedTime)}
              </div>

              <p className="text-muted">
                Started at {new Date(activeSession.start_time).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', hour12: true })}
              </p>

              <button
                className="btn btn-danger btn-block"
                onClick={handleClockOut}
              >
                CLOCK OUT
              </button>
            </>
          )}
        </div>

        {/* Today's Schedule */}
        <div className="card">
          <div className="card-title">Today's Schedule</div>
          
          {todaySchedules.length === 0 ? (
            <p className="text-muted text-center">No shifts scheduled for today</p>
          ) : (
            <table className="table">
              <thead>
                <tr>
                  <th>Time</th>
                  <th>Client</th>
                  <th>Hours</th>
                </tr>
              </thead>
              <tbody>
                {todaySchedules.map((schedule, idx) => (
                  <tr key={schedule.id || idx}>
                    <td>{formatTime(schedule.start_time)} - {formatTime(schedule.end_time)}</td>
                    <td>{getClientName(schedule.client_id)}</td>
                    <td>{calculateHours(schedule.start_time, schedule.end_time)}h</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </>
    );
  };

  // Render Schedule Page
  const renderSchedulePage = () => {
    const upcoming = getUpcomingSchedules();

    return (
      <>
        <div className="card">
          <div className="card-title">Upcoming Schedule (Next 7 Days)</div>
          
          {upcoming.length === 0 ? (
            <p className="text-muted text-center">No upcoming shifts scheduled</p>
          ) : (
            <table className="table">
              <thead>
                <tr>
                  <th>Day</th>
                  <th>Time</th>
                  <th>Client</th>
                  <th>Hours</th>
                </tr>
              </thead>
              <tbody>
                {upcoming.map((day, dayIdx) => 
                  day.schedules.map((schedule, idx) => (
                    <tr key={`${dayIdx}-${schedule.id || idx}`}>
                      <td>
                        {idx === 0 ? (
                          dayIdx === 0 ? 'Today' : day.date.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
                        ) : ''}
                      </td>
                      <td>{formatTime(schedule.start_time)} - {formatTime(schedule.end_time)}</td>
                      <td>{getClientName(schedule.client_id)}</td>
                      <td>{calculateHours(schedule.start_time, schedule.end_time)}h</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          )}
        </div>
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
                <td>{visit.client_name || getClientName(visit.client_id)}</td>
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
        <div className="sidebar-logo">
          CVHC CRM
        </div>
        <ul className="sidebar-nav">
          <li>
            <a
              href="#home"
              className={currentPage === 'home' ? 'active' : ''}
              onClick={() => handlePageClick('home')}
            >
              Home
            </a>
          </li>
          <li>
            <a
              href="#schedule"
              className={currentPage === 'schedule' ? 'active' : ''}
              onClick={() => handlePageClick('schedule')}
            >
              My Schedule
            </a>
          </li>
          <li>
            <a
              href="#history"
              className={currentPage === 'history' ? 'active' : ''}
              onClick={() => handlePageClick('history')}
            >
              Visit History
            </a>
          </li>
          <li>
            <a
              href="#settings"
              className={currentPage === 'settings' ? 'active' : ''}
              onClick={() => handlePageClick('settings')}
            >
              Settings
            </a>
          </li>
        </ul>

        <div className="sidebar-user">
          <div className="sidebar-user-name">{user.name || `${user.first_name || ''} ${user.last_name || ''}`}</div>
          <div className="sidebar-user-role">Caregiver</div>
          <button className="btn-logout" onClick={onLogout}>
            Logout
          </button>
        </div>
      </div>

      <div className="main-content">
        <div className="header">
          <div>
            <h1>Chippewa Valley Home Care</h1>
            <p>Caregiver Portal</p>
          </div>
          <button
            className="hamburger-btn"
            onClick={() => setSidebarOpen(!sidebarOpen)}
            title="Menu"
          >
            Menu
          </button>
        </div>

        <div className="container">
          {currentPage === 'home' && renderHomePage()}
          {currentPage === 'schedule' && renderSchedulePage()}
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
              <button className="btn btn-secondary" onClick={() => setShowNoteModal(false)}>
                Cancel
              </button>
              <button className="btn btn-primary" onClick={completeClockOut}>
                Complete Clock Out
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default CaregiverDashboard;
