// src/components/CaregiverDashboard.jsx
import React, { useState, useEffect } from 'react';
import { getSchedules, clockIn, clockOut, trackGPS } from '../config';

const CaregiverDashboard = ({ user, token, onLogout }) => {
  const [currentPage, setCurrentPage] = useState('home');
  const [schedules, setSchedules] = useState([]);
  const [activeSession, setActiveSession] = useState(null);
  const [loading, setLoading] = useState(true);
  const [location, setLocation] = useState(null);
  const [selectedClient, setSelectedClient] = useState('');

  useEffect(() => {
    loadSchedules();
    startGPSTracking();
  }, []);

  const loadSchedules = async () => {
    try {
      const data = await getSchedules(user.id, token);
      setSchedules(data);
    } catch (error) {
      console.error('Failed to load schedules:', error);
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
        },
        (error) => console.error('GPS error:', error),
        { enableHighAccuracy: true, maximumAge: 5000, timeout: 10000 }
      );
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
      const session = await clockIn({
        clientId: selectedClient,
        latitude: location.lat,
        longitude: location.lng
      }, token);
      setActiveSession(session);
      startContinuousGPSTracking(session.id);
    } catch (error) {
      alert('Failed to clock in: ' + error.message);
    }
  };

  const handleClockOut = async () => {
    if (!activeSession || !location) {
      alert('Clock out failed. Location not available.');
      return;
    }

    try {
      await clockOut(activeSession.id, {
        latitude: location.lat,
        longitude: location.lng
      }, token);
      setActiveSession(null);
      loadSchedules();
      alert('Clocked out successfully!');
    } catch (error) {
      alert('Failed to clock out: ' + error.message);
    }
  };

  const startContinuousGPSTracking = (timeEntryId) => {
    const interval = setInterval(async () => {
      if (location && timeEntryId) {
        try {
          await trackGPS({
            timeEntryId,
            latitude: location.lat,
            longitude: location.lng,
            accuracy: location.accuracy
          }, token);
        } catch (error) {
          console.error('Failed to track GPS:', error);
        }
      }
    }, 60000); // Every 60 seconds

    return () => clearInterval(interval);
  };

  const renderHomePage = () => (
    <>
      {/* Current Location Status */}
      <div className="card card-info">
        <div className="card-header-status">
          <h3>📍 Location Status</h3>
          <div className={`status-indicator ${location ? 'active' : 'inactive'}`}></div>
        </div>
        {location ? (
          <p>
            <strong>GPS Active</strong><br/>
            Latitude: {location.lat.toFixed(6)}<br/>
            Longitude: {location.lng.toFixed(6)}<br/>
            Accuracy: ±{location.accuracy.toFixed(0)}m
          </p>
        ) : (
          <p className="text-error">🔴 GPS Location not available. Enable location services.</p>
        )}
      </div>

      {/* Time Tracking Section */}
      {!activeSession ? (
        <div className="card card-action">
          <h3>⏱️ Clock In</h3>
          
          <div className="form-group">
            <label>Select Client *</label>
            <select
              value={selectedClient}
              onChange={(e) => setSelectedClient(e.target.value)}
            >
              <option value="">Choose a client...</option>
              <option value="client-1">John Doe</option>
              <option value="client-2">Jane Smith</option>
              <option value="client-3">Robert Johnson</option>
            </select>
          </div>

          <button 
            className="btn btn-primary btn-block btn-large"
            onClick={handleClockIn}
          >
            🟢 CLOCK IN
          </button>
        </div>
      ) : (
        <div className="card card-warning">
          <h3>⏰ Currently Clocked In</h3>
          <p>
            <strong>Started at:</strong> {new Date(activeSession.start_time).toLocaleTimeString()}<br/>
            <strong>Client ID:</strong> {activeSession.client_id}
          </p>
          <button 
            className="btn btn-danger btn-block btn-large"
            onClick={handleClockOut}
          >
            🔴 CLOCK OUT
          </button>
        </div>
      )}

      {/* Today's Schedule */}
      <div className="card">
        <h3>📅 Today's Schedule</h3>
        {schedules.length === 0 ? (
          <p>No scheduled shifts for today.</p>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>Time</th>
                <th>Type</th>
                <th>Hours</th>
              </tr>
            </thead>
            <tbody>
              {schedules.map(schedule => (
                <tr key={schedule.id}>
                  <td>{schedule.start_time} - {schedule.end_time}</td>
                  <td>{schedule.day_of_week ? 'Recurring' : 'One-time'}</td>
                  <td>{Math.round((new Date(`2000-01-01T${schedule.end_time}`) - new Date(`2000-01-01T${schedule.start_time}`)) / 3600000)} hours</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  );

  const renderSettingsPage = () => (
    <div className="card">
      <h3>⚙️ Notification Settings</h3>
      
      <form className="settings-form">
        <div className="form-group">
          <label className="checkbox-label">
            <input type="checkbox" defaultChecked className="form-checkbox" />
            <span>Email Notifications</span>
          </label>
        </div>

        <div className="form-group">
          <label className="checkbox-label">
            <input type="checkbox" defaultChecked className="form-checkbox" />
            <span>Push Notifications</span>
          </label>
        </div>

        <div className="form-group">
          <label className="checkbox-label">
            <input type="checkbox" defaultChecked className="form-checkbox" />
            <span>Schedule Alerts</span>
          </label>
        </div>

        <button className="btn btn-primary btn-top-margin">
          Save Settings
        </button>
      </form>
    </div>
  );

  return (
    <div style={{ display: 'flex', height: '100vh' }}>
      {/* Sidebar */}
      <div className="sidebar">
        <div className="sidebar-logo">
          🏥 CVHC
        </div>
        <ul className="sidebar-nav">
          <li>
            <a 
              href="#home"
              className={currentPage === 'home' ? 'active' : ''}
              onClick={() => setCurrentPage('home')}
            >
              🏠 Home
            </a>
          </li>
          <li>
            <a 
              href="#settings"
              className={currentPage === 'settings' ? 'active' : ''}
              onClick={() => setCurrentPage('settings')}
            >
              ⚙️ Settings
            </a>
          </li>
        </ul>

        <div className="sidebar-user">
          <div className="sidebar-user-name">{user.name}</div>
          <div className="sidebar-user-role">Caregiver</div>
          <button className="btn-logout" onClick={onLogout}>
            Logout
          </button>
        </div>
      </div>

      {/* Main Content */}
      <div className="main-content">
        <div className="header">
          <h1>Caregiver Dashboard</h1>
          <p>Time tracking and schedule management</p>
        </div>

        <div className="container">
          {loading ? (
            <div className="loading">
              <div className="spinner"></div>
            </div>
          ) : currentPage === 'home' ? (
            renderHomePage()
          ) : (
            renderSettingsPage()
          )}
        </div>
      </div>
    </div>
  );
};

export default CaregiverDashboard;
