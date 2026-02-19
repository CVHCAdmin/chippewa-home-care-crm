// src/components/admin/CaregiverHistory.jsx
// Shift timeline + GPS route viewer for admin
import React, { useState, useEffect, useRef } from 'react';
import { API_BASE_URL } from '../../config';

const formatDuration = (minutes) => {
  if (!minutes) return '—';
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
};

const formatDateTime = (dt) => {
  if (!dt) return '—';
  return new Date(dt).toLocaleString('en-US', {
    month: 'short', day: 'numeric',
    hour: '2-digit', minute: '2-digit'
  });
};

const formatTime = (dt) => {
  if (!dt) return '—';
  return new Date(dt).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
};

// Simple inline map using Leaflet via CDN
const GPSRouteMap = ({ timeEntryId, token, onClose }) => {
  const mapRef = useRef(null);
  const [points, setPoints] = useState([]);
  const [loading, setLoading] = useState(true);
  const [mapLoaded, setMapLoaded] = useState(false);
  const mapInstanceRef = useRef(null);

  useEffect(() => {
    // Load Leaflet CSS
    if (!document.getElementById('leaflet-css')) {
      const link = document.createElement('link');
      link.id = 'leaflet-css';
      link.rel = 'stylesheet';
      link.href = 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.css';
      document.head.appendChild(link);
    }
    // Load Leaflet JS
    if (!window.L) {
      const script = document.createElement('script');
      script.src = 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.js';
      script.onload = () => setMapLoaded(true);
      document.head.appendChild(script);
    } else {
      setMapLoaded(true);
    }

    fetch(`${API_BASE_URL}/api/time-entries/${timeEntryId}/gps`, {
      headers: { Authorization: `Bearer ${token}` }
    })
      .then(r => r.json())
      .then(data => { setPoints(Array.isArray(data) ? data : []); setLoading(false); })
      .catch(() => setLoading(false));
  }, [timeEntryId, token]);

  useEffect(() => {
    if (!mapLoaded || loading || !mapRef.current || mapInstanceRef.current) return;
    if (points.length === 0) return;

    const L = window.L;
    const map = L.map(mapRef.current);
    mapInstanceRef.current = map;

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '© OpenStreetMap contributors'
    }).addTo(map);

    const latlngs = points.map(p => [parseFloat(p.latitude), parseFloat(p.longitude)]);

    // Draw route
    const polyline = L.polyline(latlngs, { color: '#2ABBA7', weight: 4, opacity: 0.8 }).addTo(map);

    // Start marker (green)
    if (latlngs.length > 0) {
      L.circleMarker(latlngs[0], { radius: 10, fillColor: '#16A34A', color: '#fff', weight: 2, fillOpacity: 1 })
        .bindPopup(`<b>Clock In</b><br>${new Date(points[0].timestamp).toLocaleTimeString()}`)
        .addTo(map);
    }

    // End marker (red)
    if (latlngs.length > 1) {
      const last = latlngs[latlngs.length - 1];
      L.circleMarker(last, { radius: 10, fillColor: '#DC2626', color: '#fff', weight: 2, fillOpacity: 1 })
        .bindPopup(`<b>Clock Out</b><br>${new Date(points[points.length - 1].timestamp).toLocaleTimeString()}`)
        .addTo(map);
    }

    map.fitBounds(polyline.getBounds(), { padding: [20, 20] });
  }, [mapLoaded, loading, points]);

  useEffect(() => {
    return () => {
      if (mapInstanceRef.current) {
        mapInstanceRef.current.remove();
        mapInstanceRef.current = null;
      }
    };
  }, []);

  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)',
      zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1rem'
    }}>
      <div style={{ background: '#fff', borderRadius: '12px', width: '100%', maxWidth: '800px', maxHeight: '90vh', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '1rem 1.25rem', borderBottom: '1px solid #E5E7EB' }}>
          <h3 style={{ margin: 0, fontSize: '1.05rem' }}>📍 GPS Route — {points.length} location points</h3>
          <button onClick={onClose} style={{ background: 'none', border: 'none', fontSize: '1.5rem', cursor: 'pointer', color: '#6B7280' }}>×</button>
        </div>
        <div style={{ flex: 1, minHeight: '400px' }}>
          {loading && (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '400px', color: '#6B7280' }}>
              Loading GPS data...
            </div>
          )}
          {!loading && points.length === 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '400px', color: '#6B7280' }}>
              <div style={{ fontSize: '2.5rem', marginBottom: '0.75rem' }}>📍</div>
              <p>No GPS data recorded for this shift.</p>
              <p style={{ fontSize: '0.85rem' }}>GPS tracking requires the caregiver to grant location permission on their device.</p>
            </div>
          )}
          {!loading && points.length > 0 && (
            <div ref={mapRef} style={{ width: '100%', height: '450px' }} />
          )}
        </div>
        {!loading && points.length > 0 && (
          <div style={{ padding: '0.75rem 1.25rem', background: '#F9FAFB', borderTop: '1px solid #E5E7EB', display: 'flex', gap: '1.5rem', fontSize: '0.85rem', color: '#6B7280' }}>
            <span>🟢 Start: {formatTime(points[0]?.timestamp)}</span>
            <span>🔴 End: {formatTime(points[points.length - 1]?.timestamp)}</span>
            <span>📍 {points.length} points recorded</span>
          </div>
        )}
      </div>
    </div>
  );
};

const CaregiverHistory = ({ caregiverId, caregiverName, token, onBack }) => {
  const [entries, setEntries] = useState([]);
  const [loading, setLoading] = useState(true);
  const [dateRange, setDateRange] = useState({
    start: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
    end: new Date().toISOString().split('T')[0],
  });
  const [selectedEntryId, setSelectedEntryId] = useState(null);
  const [stats, setStats] = useState({ totalShifts: 0, totalHours: 0, avgDuration: 0, clients: new Set() });

  useEffect(() => { loadHistory(); }, [caregiverId, dateRange]);

  const loadHistory = async () => {
    setLoading(true);
    try {
      const url = `${API_BASE_URL}/api/time-entries/caregiver-history/${caregiverId}?startDate=${dateRange.start}T00:00:00&endDate=${dateRange.end}T23:59:59&limit=100`;
      const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
      const data = await res.json();
      const list = Array.isArray(data) ? data : [];
      setEntries(list);

      // Calculate stats
      const totalMins = list.reduce((sum, e) => sum + (parseInt(e.duration_minutes) || 0), 0);
      const clients = new Set(list.map(e => e.client_id).filter(Boolean));
      setStats({
        totalShifts: list.length,
        totalHours: (totalMins / 60).toFixed(1),
        avgDuration: list.length ? Math.round(totalMins / list.length) : 0,
        clients,
      });
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  const statusColor = (entry) => {
    if (!entry.end_time) return { bg: '#FEF9C3', border: '#CA8A04', text: '#854D0E', label: 'Active' };
    if (entry.duration_minutes > 480) return { bg: '#FEF2F2', border: '#DC2626', text: '#991B1B', label: 'Long Shift' };
    return { bg: '#F0FDF4', border: '#16A34A', text: '#166534', label: 'Complete' };
  };

  return (
    <div>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', marginBottom: '1.5rem', flexWrap: 'wrap' }}>
        <button onClick={onBack} style={{
          display: 'flex', alignItems: 'center', gap: '0.5rem',
          padding: '0.5rem 1rem', borderRadius: '8px',
          border: '1px solid #D1D5DB', background: '#fff',
          color: '#374151', cursor: 'pointer', fontWeight: '500', fontSize: '0.9rem'
        }}>← Back</button>
        <div>
          <h2 style={{ margin: 0, fontSize: '1.25rem', color: '#111827' }}>
            🕐 Shift History — {caregiverName}
          </h2>
          <p style={{ margin: '0.25rem 0 0 0', color: '#6B7280', fontSize: '0.85rem' }}>
            Clock-in/out records with GPS routes
          </p>
        </div>
      </div>

      {/* Date Range Filter */}
      <div className="card" style={{ padding: '1rem', marginBottom: '1rem' }}>
        <div style={{ display: 'flex', gap: '1rem', alignItems: 'center', flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <label style={{ fontSize: '0.85rem', color: '#6B7280', fontWeight: '500' }}>From</label>
            <input type="date" value={dateRange.start}
              onChange={e => setDateRange(p => ({ ...p, start: e.target.value }))}
              style={{ padding: '0.4rem 0.75rem', border: '1px solid #D1D5DB', borderRadius: '6px', fontSize: '0.9rem' }} />
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <label style={{ fontSize: '0.85rem', color: '#6B7280', fontWeight: '500' }}>To</label>
            <input type="date" value={dateRange.end}
              onChange={e => setDateRange(p => ({ ...p, end: e.target.value }))}
              style={{ padding: '0.4rem 0.75rem', border: '1px solid #D1D5DB', borderRadius: '6px', fontSize: '0.9rem' }} />
          </div>
          <button onClick={loadHistory} style={{
            padding: '0.4rem 1rem', background: '#2ABBA7', color: '#fff',
            border: 'none', borderRadius: '6px', cursor: 'pointer', fontWeight: '500', fontSize: '0.85rem'
          }}>Apply</button>
        </div>
      </div>

      {/* Stats */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: '0.75rem', marginBottom: '1.25rem' }}>
        {[
          { label: 'Total Shifts', value: stats.totalShifts, icon: '📋' },
          { label: 'Total Hours', value: `${stats.totalHours}h`, icon: '⏱️' },
          { label: 'Avg Duration', value: formatDuration(stats.avgDuration), icon: '📊' },
          { label: 'Unique Clients', value: stats.clients.size, icon: '👤' },
        ].map(s => (
          <div key={s.label} className="card" style={{ padding: '0.875rem', textAlign: 'center' }}>
            <div style={{ fontSize: '1.4rem', marginBottom: '0.25rem' }}>{s.icon}</div>
            <div style={{ fontSize: '1.4rem', fontWeight: '700', color: '#111827' }}>{s.value}</div>
            <div style={{ fontSize: '0.75rem', color: '#6B7280' }}>{s.label}</div>
          </div>
        ))}
      </div>

      {/* Timeline */}
      {loading ? (
        <div style={{ textAlign: 'center', padding: '3rem', color: '#6B7280' }}>Loading shift history...</div>
      ) : entries.length === 0 ? (
        <div className="card" style={{ padding: '2rem', textAlign: 'center', color: '#6B7280' }}>
          <div style={{ fontSize: '2rem', marginBottom: '0.75rem' }}>📋</div>
          <p>No shifts found for the selected date range.</p>
        </div>
      ) : (
        <div style={{ position: 'relative' }}>
          {/* Timeline line */}
          <div style={{
            position: 'absolute', left: '20px', top: '20px', bottom: '20px',
            width: '2px', background: '#E5E7EB', zIndex: 0
          }} />
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', paddingLeft: '50px' }}>
            {entries.map((entry, idx) => {
              const sc = statusColor(entry);
              const hasGPS = parseInt(entry.gps_point_count) > 0;
              return (
                <div key={entry.id} style={{ position: 'relative' }}>
                  {/* Timeline dot */}
                  <div style={{
                    position: 'absolute', left: '-38px', top: '18px',
                    width: '14px', height: '14px', borderRadius: '50%',
                    background: sc.border, border: '2px solid #fff',
                    boxShadow: '0 0 0 2px ' + sc.border,
                    zIndex: 1
                  }} />
                  <div className="card" style={{
                    padding: '1rem',
                    borderLeft: `3px solid ${sc.border}`,
                    transition: 'box-shadow 0.15s'
                  }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '0.5rem' }}>
                      <div>
                        <div style={{ fontWeight: '700', fontSize: '0.95rem', color: '#111827', marginBottom: '0.25rem' }}>
                          {entry.client_first_name
                            ? `${entry.client_first_name} ${entry.client_last_name}`
                            : 'Unknown Client'}
                        </div>
                        <div style={{ fontSize: '0.85rem', color: '#6B7280' }}>
                          {entry.client_address && `📍 ${entry.client_address}, ${entry.client_city}`}
                        </div>
                      </div>
                      <span style={{
                        padding: '0.2rem 0.6rem', borderRadius: '99px', fontSize: '0.75rem',
                        fontWeight: '600', background: sc.bg, color: sc.text, border: `1px solid ${sc.border}`
                      }}>{sc.label}</span>
                    </div>

                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: '0.75rem', marginTop: '0.75rem' }}>
                      <div>
                        <div style={{ fontSize: '0.72rem', color: '#9CA3AF', fontWeight: '600', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Clock In</div>
                        <div style={{ fontSize: '0.9rem', fontWeight: '600', color: '#374151' }}>{formatDateTime(entry.start_time)}</div>
                      </div>
                      <div>
                        <div style={{ fontSize: '0.72rem', color: '#9CA3AF', fontWeight: '600', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Clock Out</div>
                        <div style={{ fontSize: '0.9rem', fontWeight: '600', color: '#374151' }}>
                          {entry.end_time ? formatDateTime(entry.end_time) : <span style={{ color: '#CA8A04' }}>Still Active</span>}
                        </div>
                      </div>
                      <div>
                        <div style={{ fontSize: '0.72rem', color: '#9CA3AF', fontWeight: '600', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Duration</div>
                        <div style={{ fontSize: '0.9rem', fontWeight: '600', color: '#374151' }}>
                          {entry.duration_minutes ? `${formatDuration(entry.duration_minutes)} (${(entry.duration_minutes / 60).toFixed(2)}h)` : '—'}
                        </div>
                      </div>
                      <div>
                        <div style={{ fontSize: '0.72rem', color: '#9CA3AF', fontWeight: '600', textTransform: 'uppercase', letterSpacing: '0.05em' }}>GPS</div>
                        <div style={{ fontSize: '0.9rem' }}>
                          {hasGPS ? (
                            <button
                              onClick={() => setSelectedEntryId(entry.id)}
                              style={{
                                background: '#EFF6FF', color: '#2563EB', border: '1px solid #BFDBFE',
                                borderRadius: '6px', padding: '0.2rem 0.6rem', cursor: 'pointer',
                                fontSize: '0.8rem', fontWeight: '600'
                              }}
                            >
                              📍 View Route ({entry.gps_point_count} pts)
                            </button>
                          ) : (
                            <span style={{ color: '#9CA3AF', fontSize: '0.85rem' }}>No GPS data</span>
                          )}
                        </div>
                      </div>
                    </div>

                    {entry.notes && (
                      <div style={{
                        marginTop: '0.75rem', padding: '0.5rem 0.75rem',
                        background: '#F9FAFB', borderRadius: '6px', fontSize: '0.85rem', color: '#6B7280',
                        borderLeft: '3px solid #D1D5DB'
                      }}>
                        📝 {entry.notes}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* GPS Route Modal */}
      {selectedEntryId && (
        <GPSRouteMap
          timeEntryId={selectedEntryId}
          token={token}
          onClose={() => setSelectedEntryId(null)}
        />
      )}
    </div>
  );
};

export default CaregiverHistory;
