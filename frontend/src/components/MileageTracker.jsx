// src/components/MileageTracker.jsx
// Simple start/stop mileage tracking for caregivers
import React, { useState } from 'react';
import { API_BASE_URL } from '../config';

// Calculate distance between two GPS points (Haversine formula)
const calculateDistance = (lat1, lon1, lat2, lon2) => {
  const R = 3959; // Earth's radius in miles
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = 
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  const straightLine = R * c;
  // Multiply by 1.3 to approximate road distance (roads aren't straight)
  return straightLine * 1.3;
};

const MileageTracker = ({ token, caregiverId }) => {
  const [tripState, setTripState] = useState('idle'); // idle, started, ended
  const [startPoint, setStartPoint] = useState(null);
  const [endPoint, setEndPoint] = useState(null);
  const [startLocation, setStartLocation] = useState('');
  const [endLocation, setEndLocation] = useState('');
  const [calculatedMiles, setCalculatedMiles] = useState(0);
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);
  const [gettingLocation, setGettingLocation] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [history, setHistory] = useState([]);
  const [loadingHistory, setLoadingHistory] = useState(false);

  const getCurrentPosition = () => {
    return new Promise((resolve, reject) => {
      if (!navigator.geolocation) {
        reject(new Error('Geolocation not supported'));
        return;
      }
      navigator.geolocation.getCurrentPosition(
        (position) => resolve({
          lat: position.coords.latitude,
          lon: position.coords.longitude,
          accuracy: position.coords.accuracy
        }),
        (err) => reject(err),
        { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }
      );
    });
  };

  const reverseGeocode = async (lat, lon) => {
    try {
      const response = await fetch(
        `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lon}&format=json`,
        { headers: { 'User-Agent': 'CVHC-CRM' } }
      );
      if (response.ok) {
        const data = await response.json();
        const parts = [];
        if (data.address?.house_number && data.address?.road) {
          parts.push(`${data.address.house_number} ${data.address.road}`);
        } else if (data.address?.road) {
          parts.push(data.address.road);
        }
        if (data.address?.city || data.address?.town || data.address?.village) {
          parts.push(data.address.city || data.address.town || data.address.village);
        }
        return parts.join(', ') || 'Unknown location';
      }
    } catch (e) {
      console.error('Reverse geocode failed:', e);
    }
    return 'Unknown location';
  };

  const handleStartTrip = async () => {
    setError(null);
    setGettingLocation(true);
    
    try {
      const position = await getCurrentPosition();
      setStartPoint(position);
      
      const address = await reverseGeocode(position.lat, position.lon);
      setStartLocation(address);
      
      setTripState('started');
    } catch (err) {
      if (err.code === 1) {
        setError('Location access denied. Please enable location permissions.');
      } else if (err.code === 2) {
        setError('Unable to get location. Please try again.');
      } else {
        setError('Location timeout. Make sure GPS is enabled.');
      }
    } finally {
      setGettingLocation(false);
    }
  };

  const handleEndTrip = async () => {
    setError(null);
    setGettingLocation(true);
    
    try {
      const position = await getCurrentPosition();
      setEndPoint(position);
      
      const address = await reverseGeocode(position.lat, position.lon);
      setEndLocation(address);
      
      // Calculate distance
      const miles = calculateDistance(
        startPoint.lat, startPoint.lon,
        position.lat, position.lon
      );
      setCalculatedMiles(Math.round(miles * 10) / 10);
      
      setTripState('ended');
    } catch (err) {
      if (err.code === 1) {
        setError('Location access denied. Please enable location permissions.');
      } else {
        setError('Unable to get location. Please try again.');
      }
    } finally {
      setGettingLocation(false);
    }
  };

  const handleSaveTrip = async () => {
    if (calculatedMiles < 0.1) {
      alert('Trip too short to save');
      return;
    }

    setSaving(true);
    try {
      const response = await fetch(`${API_BASE_URL}/api/payroll/mileage`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          caregiverId,
          date: new Date().toISOString().split('T')[0],
          miles: calculatedMiles,
          fromLocation: startLocation,
          toLocation: endLocation,
          notes: `GPS tracked: ${startLocation} → ${endLocation}`
        })
      });

      if (!response.ok) throw new Error('Failed to save mileage');

      alert(`Saved ${calculatedMiles} miles!`);
      handleReset();
      
    } catch (error) {
      alert('Failed to save: ' + error.message);
    } finally {
      setSaving(false);
    }
  };

  const handleReset = () => {
    setTripState('idle');
    setStartPoint(null);
    setEndPoint(null);
    setStartLocation('');
    setEndLocation('');
    setCalculatedMiles(0);
    setError(null);
  };

  const loadHistory = async () => {
    setLoadingHistory(true);
    try {
      const response = await fetch(
        `${API_BASE_URL}/api/payroll/mileage?caregiverId=${caregiverId}`,
        { headers: { 'Authorization': `Bearer ${token}` } }
      );
      if (response.ok) {
        setHistory(await response.json());
      }
    } catch (error) {
      console.error('Failed to load history:', error);
    } finally {
      setLoadingHistory(false);
    }
  };

  const handleToggleHistory = () => {
    if (!showHistory) loadHistory();
    setShowHistory(!showHistory);
  };

  return (
    <div className="card" style={{ marginBottom: '1rem' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
        <h3 style={{ margin: 0 }}>🚗 Mileage Tracker</h3>
        <button 
          className="btn btn-sm btn-secondary"
          onClick={handleToggleHistory}
        >
          {showHistory ? 'Hide' : 'History'}
        </button>
      </div>

      {error && (
        <div style={{ 
          background: '#f8d7da', 
          color: '#721c24', 
          padding: '0.75rem', 
          borderRadius: '6px',
          marginBottom: '1rem'
        }}>
          ⚠️ {error}
        </div>
      )}

      {/* IDLE STATE */}
      {tripState === 'idle' && (
        <div style={{ textAlign: 'center', padding: '1rem' }}>
          <p style={{ color: '#666', marginBottom: '1rem' }}>
            Tap when leaving to start tracking
          </p>
          <button 
            className="btn btn-primary"
            onClick={handleStartTrip}
            disabled={gettingLocation}
            style={{ padding: '1rem 2rem', fontSize: '1.1rem', width: '100%' }}
          >
            {gettingLocation ? '📍 Getting location...' : '🚗 Start Trip'}
          </button>
        </div>
      )}

      {/* STARTED STATE */}
      {tripState === 'started' && (
        <div style={{ textAlign: 'center' }}>
          <div style={{ 
            background: '#d4edda', 
            padding: '1rem', 
            borderRadius: '8px',
            marginBottom: '1rem'
          }}>
            <div style={{ color: '#155724', fontWeight: 'bold' }}>📍 Trip Started</div>
            <div style={{ color: '#666', fontSize: '0.9rem', marginTop: '0.5rem' }}>
              From: {startLocation}
            </div>
          </div>
          
          <p style={{ color: '#666', marginBottom: '1rem' }}>
            Drive to your destination, then tap End Trip
          </p>
          
          <button 
            className="btn btn-danger"
            onClick={handleEndTrip}
            disabled={gettingLocation}
            style={{ padding: '1rem 2rem', fontSize: '1.1rem', width: '100%' }}
          >
            {gettingLocation ? '📍 Getting location...' : '🏁 End Trip'}
          </button>
          
          <button 
            className="btn btn-secondary"
            onClick={handleReset}
            style={{ marginTop: '0.5rem', width: '100%' }}
          >
            Cancel
          </button>
        </div>
      )}

      {/* ENDED STATE - Show results */}
      {tripState === 'ended' && (
        <div style={{ textAlign: 'center' }}>
          <div style={{ 
            background: '#f8f9fa', 
            padding: '1.5rem', 
            borderRadius: '12px',
            marginBottom: '1rem'
          }}>
            <div style={{ fontSize: '2.5rem', fontWeight: 'bold', color: '#007bff' }}>
              {calculatedMiles} miles
            </div>
            
            <div style={{ 
              marginTop: '1rem', 
              fontSize: '0.9rem', 
              color: '#666',
              textAlign: 'left',
              padding: '0 1rem'
            }}>
              <div style={{ marginBottom: '0.5rem' }}>
                <strong>From:</strong> {startLocation}
              </div>
              <div>
                <strong>To:</strong> {endLocation}
              </div>
            </div>
          </div>

          <p style={{ fontSize: '0.8rem', color: '#999', marginBottom: '1rem' }}>
            *Estimated road distance
          </p>

          <div style={{ display: 'flex', gap: '0.5rem' }}>
            <button 
              className="btn btn-primary"
              onClick={handleSaveTrip}
              disabled={saving}
              style={{ flex: 1 }}
            >
              {saving ? 'Saving...' : '💾 Save'}
            </button>
            <button 
              className="btn btn-secondary"
              onClick={handleReset}
              style={{ flex: 1 }}
            >
              🗑️ Discard
            </button>
          </div>
        </div>
      )}

      {/* History Section */}
      {showHistory && (
        <div style={{ marginTop: '1.5rem', borderTop: '1px solid #ddd', paddingTop: '1rem' }}>
          <h4 style={{ marginTop: 0 }}>Recent Trips</h4>
          {loadingHistory ? (
            <p>Loading...</p>
          ) : history.length === 0 ? (
            <p style={{ color: '#666' }}>No trips recorded yet</p>
          ) : (
            <div style={{ maxHeight: '200px', overflowY: 'auto' }}>
              {history.slice(0, 10).map((trip, idx) => (
                <div 
                  key={trip.id || idx}
                  style={{ 
                    padding: '0.5rem',
                    background: idx % 2 === 0 ? '#f8f9fa' : '#fff',
                    borderRadius: '4px',
                    marginBottom: '0.25rem',
                    fontSize: '0.9rem'
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <strong>{trip.miles} mi</strong>
                    <span style={{ color: '#666' }}>
                      {new Date(trip.date).toLocaleDateString()}
                    </span>
                  </div>
                  {(trip.from_location || trip.to_location) && (
                    <div style={{ fontSize: '0.8rem', color: '#666', marginTop: '2px' }}>
                      {trip.from_location} → {trip.to_location}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default MileageTracker;
