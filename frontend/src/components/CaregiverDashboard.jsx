// src/components/CaregiverDashboard.jsx
// Professional caregiver app modeled after Homebase / When I Work / CareSmartz360
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

  // Timer for active session
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

  // Close sidebar on page change (mobile)
  useEffect(() => {
    if (window.innerWidth <= 768) {
      setSidebarOpen(false);
    }
  }, [currentPage]);

  const loadData = async () => {
    try {
      // Load all data in parallel
      const [schedulesRes, clientsRes, activeRes, visitsRes] = await Promise.all([
        fetch(`${API_BASE_URL}/api/schedules/${user.id}`, {
          headers: { 'Authorization': `Bearer ${token}` }
        }),
        fetch(`${API_BASE_URL}/api/clients`, {
          headers: { 'Authorization': `Bearer ${token}` }
        }),
        fetch(`${API_BASE_URL}/api/time-entries/active`, {
          headers: { 'Authorization': `Bearer ${token}` }
        }),
        fetch(`${API_BASE_URL}/api/time-entries/recent?limit=5`, {
          headers: { 'Authorization': `Bearer ${token}` }
        })
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
          console.error('GPS error:', error);
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
      alert('GPS location not available. Please enable location services and try again.');
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

  const handleClockOut = async () => {
    if (!activeSession) {
      alert('No active session to clock out from.');
      return;
    }

    // Show note modal before clocking out
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
      loadData(); // Refresh data
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
          console.error('Failed to track GPS:', error);
        }
      }
    }, 60000); // Every 60 seconds

    return () => clearInterval(interval);
  };

  // Helper functions
  const getClientName = (clientId) => {
    const client = clients.find(c => c.id === clientId);
    return client ? `${client.first_name} ${client.last_name}` : 'Unknown Client';
  };

  const getClientAddress = (clientId) => {
    const client = clients.find(c => c.id === clientId);
    if (!client) return '';
    return client.address || '';
  };

  const formatTime = (timeStr) => {
    if (!timeStr) return '';
    const [hours, minutes] = timeStr.split(':');
    const h = parseInt(hours);
    const ampm = h >= 12 ? 'pm' : 'am';
    const hour12 = h % 12 || 12;
    return `${hour12}:${minutes}${ampm}`;
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

  const getDayName = (dayOfWeek) => {
    const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    return days[dayOfWeek] || '';
  };

  // Get today's schedules
  const getTodaySchedules = () => {
    const today = new Date();
    const todayDayOfWeek = today.getDay();
    const todayStr = today.toISOString().split('T')[0];

    return schedules.filter(schedule => {
      // Check recurring (day of week matches)
      if (schedule.day_of_week !== null && schedule.day_of_week !== undefined) {
        return schedule.day_of_week === todayDayOfWeek;
      }
      // Check one-time (date matches)
      if (schedule.date) {
        return schedule.date.split('T')[0] === todayStr;
      }
      return false;
    }).sort((a, b) => (a.start_time || '').localeCompare(b.start_time || ''));
  };

  // Get upcoming schedules (next 7 days)
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

  const calculateHours = (start, end) => {
    if (!start || !end) return 0;
    const startDate = new Date(`2000-01-01T${start}`);
    const endDate = new Date(`2000-01-01T${end}`);
    return ((endDate - startDate) / (1000 * 60 * 60)).toFixed(1);
  };

  // Render Home Page
  const renderHomePage = () => {
    const todaySchedules = getTodaySchedules();

    return (
      <div >
        {/* Clock In/Out Card - The Hero */}
        <div style={{
          background: activeSession 
            ? 'linear-gradient(135deg, #DC2626 0%, #B91C1C 100%)' 
            : 'linear-gradient(135deg, #059669 0%, #047857 100%)',
          borderRadius: '16px',
          padding: '2rem',
          color: 'white',
          marginBottom: '1.5rem',
          boxShadow: '0 4px 20px rgba(0,0,0,0.15)'
        }}>
          {!activeSession ? (
            <>
              <h2 style={{ margin: '0 0 1.5rem 0', fontSize: '1.5rem', fontWeight: '600' }}>
                Ready to Clock In?
              </h2>

              {/* Client Selector */}
              <div style={{ marginBottom: '1.5rem' }}>
                <label style={{ 
                  display: 'block', 
                  marginBottom: '0.5rem', 
                  fontSize: '0.9rem',
                  opacity: 0.9
                }}>
                  Select Client
                </label>
                <select
                  value={selectedClient}
                  onChange={(e) => setSelectedClient(e.target.value)}
                  style={{
                    width: '100%',
                    padding: '1rem',
                    borderRadius: '10px',
                    border: 'none',
                    fontSize: '1rem',
                    background: 'rgba(255,255,255,0.95)',
                    color: '#1F2937'
                  }}
                >
                  <option value="">Choose a client...</option>
                  {clients.map(client => (
                    <option key={client.id} value={client.id}>
                      {client.first_name} {client.last_name}
                    </option>
                  ))}
                </select>
              </div>

              {/* GPS Status */}
              <div style={{ 
                display: 'flex', 
                alignItems: 'center', 
                gap: '0.5rem',
                marginBottom: '1.5rem',
                fontSize: '0.9rem'
              }}>
                <span style={{
                  width: '10px',
                  height: '10px',
                  borderRadius: '50%',
                  background: location ? '#4ADE80' : '#FCD34D',
                  boxShadow: location ? '0 0 8px #4ADE80' : 'none'
                }} />
                {location ? (
                  <span>GPS Active • ±{location.accuracy.toFixed(0)}m accuracy</span>
                ) : (
                  <span>Waiting for GPS...</span>
                )}
              </div>

              {/* Clock In Button */}
              <button
                onClick={handleClockIn}
                disabled={!selectedClient || !location}
                style={{
                  width: '100%',
                  padding: '1.25rem',
                  borderRadius: '12px',
                  border: 'none',
                  background: 'white',
                  color: '#059669',
                  fontSize: '1.25rem',
                  fontWeight: '700',
                  cursor: selectedClient && location ? 'pointer' : 'not-allowed',
                  opacity: selectedClient && location ? 1 : 0.7,
                  transition: 'transform 0.2s'
                }}
              >
                🟢 CLOCK IN
              </button>
            </>
          ) : (
            <>
              {/* Active Session Display */}
              <div style={{ textAlign: 'center' }}>
                <p style={{ margin: '0 0 0.5rem 0', opacity: 0.9, fontSize: '0.9rem' }}>
                  Currently with
                </p>
                <h2 style={{ margin: '0 0 1rem 0', fontSize: '1.5rem' }}>
                  {getClientName(activeSession.client_id)}
                </h2>

                {/* Timer */}
                <div style={{
                  fontSize: '3rem',
                  fontWeight: '700',
                  fontFamily: 'monospace',
                  margin: '1.5rem 0',
                  letterSpacing: '2px'
                }}>
                  {formatElapsedTime(elapsedTime)}
                </div>

                <p style={{ margin: '0 0 1.5rem 0', opacity: 0.9, fontSize: '0.85rem' }}>
                  Started at {new Date(activeSession.start_time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </p>

                {/* Clock Out Button */}
                <button
                  onClick={handleClockOut}
                  style={{
                    width: '100%',
                    padding: '1.25rem',
                    borderRadius: '12px',
                    border: 'none',
                    background: 'white',
                    color: '#DC2626',
                    fontSize: '1.25rem',
                    fontWeight: '700',
                    cursor: 'pointer'
                  }}
                >
                  🔴 CLOCK OUT
                </button>
              </div>
            </>
          )}
        </div>

        {/* Today's Schedule */}
        <div className="card" style={{ marginBottom: '1.5rem' }}>
          <h3 style={{ 
            margin: '0 0 1rem 0', 
            fontSize: '1.1rem',
            display: 'flex',
            alignItems: 'center',
            gap: '0.5rem'
          }}>
            <span>📅</span> Today's Schedule
            <span style={{
              fontSize: '0.75rem',
              background: '#E5E7EB',
              padding: '0.25rem 0.5rem',
              borderRadius: '10px',
              marginLeft: 'auto'
            }}>
              {todaySchedules.length} shift{todaySchedules.length !== 1 ? 's' : ''}
            </span>
          </h3>

          {todaySchedules.length === 0 ? (
            <p style={{ color: '#6B7280', textAlign: 'center', padding: '1rem 0' }}>
              No shifts scheduled for today
            </p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
              {todaySchedules.map((schedule, idx) => (
                <div 
                  key={schedule.id || idx}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '1rem',
                    padding: '1rem',
                    background: '#F9FAFB',
                    borderRadius: '10px',
                    borderLeft: '4px solid #3B82F6'
                  }}
                >
                  <div style={{ 
                    minWidth: '70px',
                    textAlign: 'center'
                  }}>
                    <div style={{ fontWeight: '700', color: '#1D4ED8' }}>
                      {formatTime(schedule.start_time)}
                    </div>
                    <div style={{ fontSize: '0.8rem', color: '#6B7280' }}>
                      {formatTime(schedule.end_time)}
                    </div>
                  </div>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontWeight: '600', marginBottom: '0.25rem' }}>
                      {getClientName(schedule.client_id)}
                    </div>
                    <div style={{ fontSize: '0.8rem', color: '#6B7280' }}>
                      {calculateHours(schedule.start_time, schedule.end_time)}h
                      {schedule.day_of_week !== null && (
                        <span style={{
                          marginLeft: '0.5rem',
                          background: '#DBEAFE',
                          color: '#1D4ED8',
                          padding: '0.125rem 0.5rem',
                          borderRadius: '10px',
                          fontSize: '0.7rem'
                        }}>
                          Weekly
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Quick Stats */}
        <div style={{ 
          display: 'grid', 
          gridTemplateColumns: '1fr 1fr',
          gap: '1rem',
          marginBottom: '1.5rem'
        }}>
          <div className="card" style={{ textAlign: 'center', padding: '1.25rem' }}>
            <div style={{ fontSize: '2rem', fontWeight: '700', color: '#059669' }}>
              {todaySchedules.reduce((total, s) => total + parseFloat(calculateHours(s.start_time, s.end_time)), 0).toFixed(1)}h
            </div>
            <div style={{ fontSize: '0.85rem', color: '#6B7280' }}>Today's Hours</div>
          </div>
          <div className="card" style={{ textAlign: 'center', padding: '1.25rem' }}>
            <div style={{ fontSize: '2rem', fontWeight: '700', color: '#3B82F6' }}>
              {getUpcomingSchedules().reduce((total, day) => 
                total + day.schedules.reduce((t, s) => t + parseFloat(calculateHours(s.start_time, s.end_time)), 0)
              , 0).toFixed(1)}h
            </div>
            <div style={{ fontSize: '0.85rem', color: '#6B7280' }}>This Week</div>
          </div>
        </div>
      </div>
    );
  };

  // Render Schedule Page
  const renderSchedulePage = () => {
    const upcoming = getUpcomingSchedules();

    return (
      <div >
        <h2 style={{ margin: '0 0 1.5rem 0', fontSize: '1.25rem' }}>
          Upcoming Schedule
        </h2>

        {upcoming.length === 0 ? (
          <div className="card" style={{ textAlign: 'center', padding: '3rem 1rem' }}>
            <p style={{ color: '#6B7280' }}>No upcoming shifts scheduled</p>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            {upcoming.map((day, idx) => (
              <div key={idx} className="card" style={{ padding: 0, overflow: 'hidden' }}>
                {/* Day Header */}
                <div style={{
                  padding: '0.75rem 1rem',
                  background: idx === 0 ? '#DBEAFE' : '#F3F4F6',
                  borderBottom: '1px solid #E5E7EB',
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center'
                }}>
                  <div>
                    <span style={{ fontWeight: '700', color: idx === 0 ? '#1D4ED8' : '#374151' }}>
                      {idx === 0 ? 'Today' : day.date.toLocaleDateString('en-US', { weekday: 'long' })}
                    </span>
                    <span style={{ marginLeft: '0.5rem', fontSize: '0.85rem', color: '#6B7280' }}>
                      {day.date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                    </span>
                  </div>
                  <span style={{ 
                    fontSize: '0.8rem',
                    color: idx === 0 ? '#1D4ED8' : '#6B7280'
                  }}>
                    {day.schedules.reduce((t, s) => t + parseFloat(calculateHours(s.start_time, s.end_time)), 0).toFixed(1)}h
                  </span>
                </div>

                {/* Schedules */}
                <div style={{ padding: '0.5rem' }}>
                  {day.schedules.map((schedule, sIdx) => (
                    <div 
                      key={schedule.id || sIdx}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '1rem',
                        padding: '0.75rem',
                        borderBottom: sIdx < day.schedules.length - 1 ? '1px solid #F3F4F6' : 'none'
                      }}
                    >
                      <div style={{ minWidth: '70px', textAlign: 'center' }}>
                        <div style={{ fontWeight: '600', fontSize: '0.9rem' }}>
                          {formatTime(schedule.start_time)}
                        </div>
                        <div style={{ fontSize: '0.75rem', color: '#6B7280' }}>
                          {formatTime(schedule.end_time)}
                        </div>
                      </div>
                      <div style={{ flex: 1 }}>
                        <div style={{ fontWeight: '600', marginBottom: '0.125rem' }}>
                          {getClientName(schedule.client_id)}
                        </div>
                        {schedule.notes && (
                          <div style={{ fontSize: '0.8rem', color: '#6B7280' }}>
                            {schedule.notes}
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    );
  };

  // Render History Page
  const renderHistoryPage = () => (
    <div >
      <h2 style={{ margin: '0 0 1.5rem 0', fontSize: '1.25rem' }}>
        Recent Visits
      </h2>

      {recentVisits.length === 0 ? (
        <div className="card" style={{ textAlign: 'center', padding: '3rem 1rem' }}>
          <p style={{ color: '#6B7280' }}>No recent visits</p>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
          {recentVisits.map((visit, idx) => (
            <div key={visit.id || idx} className="card" style={{ padding: '1rem' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.5rem' }}>
                <span style={{ fontWeight: '600' }}>{getClientName(visit.client_id)}</span>
                <span style={{ fontSize: '0.85rem', color: '#6B7280' }}>
                  {formatDate(visit.start_time)}
                </span>
              </div>
              <div style={{ fontSize: '0.9rem', color: '#6B7280', marginBottom: '0.5rem' }}>
                {new Date(visit.start_time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                {' - '}
                {visit.end_time ? new Date(visit.end_time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : 'In Progress'}
              </div>
              {visit.notes && (
                <div style={{ 
                  fontSize: '0.85rem', 
                  color: '#4B5563',
                  background: '#F9FAFB',
                  padding: '0.75rem',
                  borderRadius: '8px',
                  marginTop: '0.5rem'
                }}>
                  {visit.notes}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );

  // Render Settings Page
  const renderSettingsPage = () => (
    <div >
      <h2 style={{ margin: '0 0 1.5rem 0', fontSize: '1.25rem' }}>
        Settings
      </h2>

      <div className="card">
        <h3 style={{ margin: '0 0 1rem 0', fontSize: '1rem' }}>Profile</h3>
        <div style={{ marginBottom: '1rem' }}>
          <div style={{ fontWeight: '600' }}>{user.name || `${user.first_name} ${user.last_name}`}</div>
          <div style={{ fontSize: '0.9rem', color: '#6B7280' }}>{user.email}</div>
        </div>
      </div>

      <div className="card" style={{ marginTop: '1rem' }}>
        <h3 style={{ margin: '0 0 1rem 0', fontSize: '1rem' }}>GPS Status</h3>
        <div style={{ 
          display: 'flex', 
          alignItems: 'center', 
          gap: '0.75rem',
          padding: '1rem',
          background: location ? '#D1FAE5' : '#FEE2E2',
          borderRadius: '8px'
        }}>
          <span style={{
            width: '12px',
            height: '12px',
            borderRadius: '50%',
            background: location ? '#059669' : '#DC2626'
          }} />
          <div>
            <div style={{ fontWeight: '600', color: location ? '#059669' : '#DC2626' }}>
              {location ? 'GPS Active' : 'GPS Not Available'}
            </div>
            {location && (
              <div style={{ fontSize: '0.8rem', color: '#6B7280' }}>
                Accuracy: ±{location.accuracy.toFixed(0)}m
              </div>
            )}
            {locationError && (
              <div style={{ fontSize: '0.8rem', color: '#DC2626' }}>
                {locationError}
              </div>
            )}
          </div>
        </div>
      </div>

      <button 
        onClick={onLogout}
        className="btn btn-danger"
        style={{ width: '100%', marginTop: '2rem' }}
      >
        Log Out
      </button>
    </div>
  );

  if (loading) {
    return (
      <div style={{ 
        display: 'flex', 
        alignItems: 'center', 
        justifyContent: 'center', 
        height: '100vh',
        background: '#F3F4F6'
      }}>
        <div className="spinner" />
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', minHeight: '100vh' }}>
      {/* Overlay for mobile sidebar */}
      {sidebarOpen && (
        <div
          className="sidebar-overlay active"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Sidebar */}
      <div className={`sidebar ${sidebarOpen ? 'open' : ''}`}>
        <div className="sidebar-logo">
          CVHC CRM
        </div>
        <ul className="sidebar-nav">
          <li>
            <a
              href="#home"
              className={currentPage === 'home' ? 'active' : ''}
              onClick={(e) => { e.preventDefault(); setCurrentPage('home'); }}
            >
              Home
            </a>
          </li>
          <li>
            <a
              href="#schedule"
              className={currentPage === 'schedule' ? 'active' : ''}
              onClick={(e) => { e.preventDefault(); setCurrentPage('schedule'); }}
            >
              My Schedule
            </a>
          </li>
          <li>
            <a
              href="#history"
              className={currentPage === 'history' ? 'active' : ''}
              onClick={(e) => { e.preventDefault(); setCurrentPage('history'); }}
            >
              Visit History
            </a>
          </li>
          <li>
            <a
              href="#settings"
              className={currentPage === 'settings' ? 'active' : ''}
              onClick={(e) => { e.preventDefault(); setCurrentPage('settings'); }}
            >
              Settings
            </a>
          </li>
        </ul>

        <div className="sidebar-user">
          <div className="sidebar-user-name">{user.name || `${user.first_name} ${user.last_name}`}</div>
          <div className="sidebar-user-role">Caregiver</div>
          <button className="btn-logout" onClick={onLogout}>
            Logout
          </button>
        </div>
      </div>

      {/* Main Content */}
      <div className="main-content">
        <div className="header">
          <div>
            <h1>Chippewa Valley Home Care</h1>
            <p>Caregiver Portal</p>
          </div>
          <button
            className="hamburger-btn"
            onClick={() => setSidebarOpen(!sidebarOpen)}
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
        <div 
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            background: 'rgba(0,0,0,0.5)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 2000,
            padding: '1rem'
          }}
        >
          <div style={{
            background: 'white',
            borderRadius: '16px',
            padding: '1.5rem',
            width: '100%',
            maxWidth: '400px'
          }}>
            <h3 style={{ margin: '0 0 1rem 0' }}>Visit Notes</h3>
            <p style={{ color: '#6B7280', fontSize: '0.9rem', marginBottom: '1rem' }}>
              Add any notes about this visit (optional)
            </p>
            <textarea
              value={visitNote}
              onChange={(e) => setVisitNote(e.target.value)}
              placeholder="How did the visit go? Any concerns or updates?"
              rows={4}
              style={{
                width: '100%',
                padding: '0.75rem',
                borderRadius: '8px',
                border: '2px solid #E5E7EB',
                fontSize: '1rem',
                resize: 'vertical',
                marginBottom: '1rem'
              }}
            />
            <div style={{ display: 'flex', gap: '0.75rem' }}>
              <button
                onClick={() => setShowNoteModal(false)}
                className="btn btn-secondary"
                style={{ flex: 1 }}
              >
                Cancel
              </button>
              <button
                onClick={completeClockOut}
                className="btn btn-primary"
                style={{ flex: 1 }}
              >
                Clock Out
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default CaregiverDashboard;
