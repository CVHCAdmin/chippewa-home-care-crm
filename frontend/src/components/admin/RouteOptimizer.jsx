// src/components/admin/RouteOptimizer.jsx
// Route & Schedule Optimizer with real addresses, mileage tracking, hours dashboard, GPS geofence
import React, { useState, useEffect, useCallback, useRef } from 'react';
import { API_BASE_URL } from '../../config';

const RouteOptimizer = ({ token }) => {
  // Core state
  const [activeTab, setActiveTab] = useState('planner'); // 'planner', 'daily', 'hours', 'geofence'
  const [caregivers, setCaregivers] = useState([]);
  const [clients, setClients] = useState([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState({ text: '', type: '' });

  // Route planner state
  const [selectedCaregiver, setSelectedCaregiver] = useState('');
  const [selectedDate, setSelectedDate] = useState(new Date().toISOString().split('T')[0]);
  const [routeStops, setRouteStops] = useState([]);
  const [optimizedRoute, setOptimizedRoute] = useState(null);
  const [optimizing, setOptimizing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [startTime, setStartTime] = useState('08:00');

  // Daily view state
  const [dailyDate, setDailyDate] = useState(new Date().toISOString().split('T')[0]);
  const [dailyRoutes, setDailyRoutes] = useState([]);
  const [dailyLoading, setDailyLoading] = useState(false);

  // Hours dashboard state
  const [hoursData, setHoursData] = useState(null);
  const [hoursLoading, setHoursLoading] = useState(false);
  const [hoursStartDate, setHoursStartDate] = useState(() => {
    const d = new Date(); d.setDate(d.getDate() - d.getDay());
    return d.toISOString().split('T')[0];
  });
  const [hoursEndDate, setHoursEndDate] = useState(() => {
    const d = new Date(); d.setDate(d.getDate() + (6 - d.getDay()));
    return d.toISOString().split('T')[0];
  });

  // Geofence state
  const [geofenceSettings, setGeofenceSettings] = useState([]);
  const [geofenceLoading, setGeofenceLoading] = useState(false);
  const [editGeofence, setEditGeofence] = useState(null);

  // Geocoding state
  const [geocoding, setGeocoding] = useState(false);
  const [geocodeResults, setGeocodeResults] = useState(null);

  // Drag state
  const dragItem = useRef(null);
  const dragOverItem = useRef(null);

  // ============================================================
  // Load initial data
  // ============================================================
  // Google API status
  const [apiStatus, setApiStatus] = useState(null);
  
  useEffect(() => {
    // Check Google API config
    fetch(`${API_BASE_URL}/api/route-optimizer/config-status`, {
      headers: { 'Authorization': `Bearer ${token}` }
    }).then(r => r.ok ? r.json() : null).then(setApiStatus).catch(() => {});
  }, []);

  useEffect(() => { loadData(); }, []);

  useEffect(() => {
    if (activeTab === 'daily') loadDailyView();
    if (activeTab === 'hours') loadHoursSummary();
    if (activeTab === 'geofence') loadGeofenceSettings();
  }, [activeTab]);

  const loadData = async () => {
    try {
      const [cgRes, clRes] = await Promise.all([
        fetch(`${API_BASE_URL}/api/caregivers`, { headers: { 'Authorization': `Bearer ${token}` } }),
        fetch(`${API_BASE_URL}/api/clients`, { headers: { 'Authorization': `Bearer ${token}` } })
      ]);
      const cgData = await cgRes.json();
      const clData = await clRes.json();
      setCaregivers(Array.isArray(cgData) ? cgData : []);
      setClients(Array.isArray(clData) ? clData : []);
    } catch (e) {
      console.error('Load error:', e);
    } finally {
      setLoading(false);
    }
  };

  const showMsg = (text, type = 'success') => {
    setMessage({ text, type });
    setTimeout(() => setMessage({ text: '', type: '' }), 5000);
  };

  // ============================================================
  // Route Planner Functions
  // ============================================================
  const addStopToRoute = (clientId) => {
    if (routeStops.find(s => s.clientId === clientId)) {
      showMsg('Client already in route', 'error');
      return;
    }
    const client = clients.find(c => c.id === clientId);
    if (!client) return;
    setRouteStops(prev => [...prev, {
      clientId: client.id,
      clientName: `${client.first_name} ${client.last_name}`,
      address: [client.address, client.city, client.state, client.zip].filter(Boolean).join(', '),
      latitude: client.latitude,
      longitude: client.longitude,
      serviceUnits: client.weekly_authorized_units ? Math.min(client.weekly_authorized_units, 16) : 4,
      weeklyAuthorizedUnits: client.weekly_authorized_units || 0,
      startTime: '',
      endTime: '',
      hasCoords: !!(client.latitude && client.longitude)
    }]);
    setOptimizedRoute(null);
  };

  const removeStop = (idx) => {
    setRouteStops(prev => prev.filter((_, i) => i !== idx));
    setOptimizedRoute(null);
  };

  const updateStopUnits = (idx, units) => {
    setRouteStops(prev => prev.map((s, i) => i === idx ? { ...s, serviceUnits: parseInt(units) || 0 } : s));
    setOptimizedRoute(null);
  };

  const updateStopTime = (idx, field, value) => {
    setRouteStops(prev => prev.map((s, i) => i === idx ? { ...s, [field]: value } : s));
    setOptimizedRoute(null);
  };

  // Drag and drop reorder
  const handleDragStart = (idx) => { dragItem.current = idx; };
  const handleDragEnter = (idx) => { dragOverItem.current = idx; };
  const handleDragEnd = () => {
    if (dragItem.current === null || dragOverItem.current === null) return;
    const items = [...routeStops];
    const dragged = items.splice(dragItem.current, 1)[0];
    items.splice(dragOverItem.current, 0, dragged);
    setRouteStops(items);
    setOptimizedRoute(null);
    dragItem.current = null;
    dragOverItem.current = null;
  };

  // Optimize route
  const optimizeRoute = async () => {
    if (!selectedCaregiver) { showMsg('Select a caregiver first', 'error'); return; }
    if (routeStops.length === 0) { showMsg('Add at least one client', 'error'); return; }
    
    const missingCoords = routeStops.filter(s => !s.hasCoords);
    if (missingCoords.length > 0) {
      showMsg(`${missingCoords.length} client(s) need geocoded addresses. Use "Geocode All" first.`, 'error');
      return;
    }

    setOptimizing(true);
    try {
      const res = await fetch(`${API_BASE_URL}/api/route-optimizer/optimize`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({
          caregiverId: selectedCaregiver,
          date: selectedDate,
          stops: routeStops.map(s => ({
            clientId: s.clientId,
            serviceUnits: s.serviceUnits,
            startTime: s.startTime || undefined,
            endTime: s.endTime || undefined
          }))
        })
      });
      if (!res.ok) {
        const err = await res.json();
        showMsg(err.error || 'Optimization failed', 'error');
        return;
      }
      const data = await res.json();
      setOptimizedRoute(data);
      // Update stop order to match optimized
      setRouteStops(data.stops.map(s => ({
        clientId: s.clientId,
        clientName: s.clientName,
        address: s.address,
        latitude: s.latitude,
        longitude: s.longitude,
        serviceUnits: s.serviceUnits,
        weeklyAuthorizedUnits: s.weeklyAuthorizedUnits,
        startTime: s.requestedStartTime || '',
        endTime: s.requestedEndTime || '',
        hasCoords: true
      })));
      showMsg(`Route optimized: ${data.summary.totalMiles} miles, ${data.summary.totalStops} stops`);
    } catch (e) {
      showMsg('Optimization failed: ' + e.message, 'error');
    } finally {
      setOptimizing(false);
    }
  };

  // Save route plan
  const saveRoute = async (status = 'draft') => {
    if (!optimizedRoute) { showMsg('Optimize the route first', 'error'); return; }
    setSaving(true);
    try {
      const res = await fetch(`${API_BASE_URL}/api/route-optimizer/save-route`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({
          caregiverId: selectedCaregiver,
          date: selectedDate,
          stops: optimizedRoute.stops,
          totalMiles: optimizedRoute.summary.totalMiles,
          totalDriveMinutes: optimizedRoute.summary.totalDriveMinutes,
          totalServiceMinutes: optimizedRoute.summary.totalServiceMinutes,
          status
        })
      });
      if (res.ok) {
        showMsg(`Route ${status === 'published' ? 'published' : 'saved as draft'}!`);
      } else {
        const err = await res.json();
        showMsg(err.error || 'Save failed', 'error');
      }
    } catch (e) {
      showMsg('Save failed', 'error');
    } finally {
      setSaving(false);
    }
  };

  // ============================================================
  // Daily View
  // ============================================================
  const loadDailyView = async () => {
    setDailyLoading(true);
    try {
      const res = await fetch(`${API_BASE_URL}/api/route-optimizer/daily/${dailyDate}`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (res.ok) {
        const data = await res.json();
        setDailyRoutes(data.routes || []);
      }
    } catch (e) { console.error(e); }
    finally { setDailyLoading(false); }
  };

  useEffect(() => {
    if (activeTab === 'daily') loadDailyView();
  }, [dailyDate]);

  // ============================================================
  // Hours Summary
  // ============================================================
  const loadHoursSummary = async () => {
    setHoursLoading(true);
    try {
      const res = await fetch(
        `${API_BASE_URL}/api/route-optimizer/hours-summary?startDate=${hoursStartDate}&endDate=${hoursEndDate}`,
        { headers: { 'Authorization': `Bearer ${token}` } }
      );
      if (res.ok) setHoursData(await res.json());
    } catch (e) { console.error(e); }
    finally { setHoursLoading(false); }
  };

  useEffect(() => {
    if (activeTab === 'hours') loadHoursSummary();
  }, [hoursStartDate, hoursEndDate]);

  // ============================================================
  // Geofence
  // ============================================================
  const loadGeofenceSettings = async () => {
    setGeofenceLoading(true);
    try {
      const res = await fetch(`${API_BASE_URL}/api/route-optimizer/geofence`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (res.ok) setGeofenceSettings(await res.json());
    } catch (e) { console.error(e); }
    finally { setGeofenceLoading(false); }
  };

  const saveGeofence = async (data) => {
    try {
      const res = await fetch(`${API_BASE_URL}/api/route-optimizer/geofence`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify(data)
      });
      if (res.ok) {
        showMsg('Geofence saved');
        loadGeofenceSettings();
        setEditGeofence(null);
      }
    } catch (e) { showMsg('Save failed', 'error'); }
  };

  // ============================================================
  // Geocoding
  // ============================================================
  const geocodeAll = async (type) => {
    setGeocoding(true);
    try {
      const res = await fetch(`${API_BASE_URL}/api/route-optimizer/geocode-all`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({ entityType: type })
      });
      if (res.ok) {
        const data = await res.json();
        setGeocodeResults(data);
        showMsg(`Geocoded ${data.success} of ${data.total} ${type}`);
        loadData(); // Refresh
      }
    } catch (e) { showMsg('Geocoding failed', 'error'); }
    finally { setGeocoding(false); }
  };

  const geocodeSingle = async (entityType, entityId, address, city, state, zip) => {
    try {
      const res = await fetch(`${API_BASE_URL}/api/route-optimizer/geocode`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({ address, city, state, zip, entityType, entityId })
      });
      if (res.ok) {
        showMsg('Address geocoded');
        loadData();
      } else {
        const err = await res.json();
        showMsg(err.error || 'Geocode failed', 'error');
      }
    } catch (e) { showMsg('Geocode failed', 'error'); }
  };

  // ============================================================
  // Styles
  // ============================================================
  const s = {
    page: { padding: '1.5rem', maxWidth: '1400px', margin: '0 auto', fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif' },
    header: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '1rem', marginBottom: '1.5rem' },
    title: { fontSize: '1.5rem', fontWeight: '700', color: '#1a1a2e', margin: 0, display: 'flex', alignItems: 'center', gap: '0.5rem' },
    tabs: { display: 'flex', gap: '0.25rem', background: '#f0f0f4', borderRadius: '10px', padding: '4px', marginBottom: '1.5rem' },
    tab: (active) => ({
      padding: '0.6rem 1.2rem', borderRadius: '8px', border: 'none', cursor: 'pointer', fontWeight: '600',
      fontSize: '0.85rem', transition: 'all 0.2s',
      background: active ? '#fff' : 'transparent', color: active ? '#1a1a2e' : '#666',
      boxShadow: active ? '0 1px 3px rgba(0,0,0,0.12)' : 'none'
    }),
    card: { background: '#fff', borderRadius: '12px', border: '1px solid #e8e8ee', padding: '1.25rem', marginBottom: '1rem' },
    cardTitle: { fontSize: '1rem', fontWeight: '700', color: '#1a1a2e', marginBottom: '0.75rem', display: 'flex', alignItems: 'center', gap: '0.5rem' },
    row: { display: 'flex', gap: '1rem', flexWrap: 'wrap', marginBottom: '0.75rem' },
    col: (flex = 1) => ({ flex, minWidth: '200px' }),
    label: { display: 'block', fontSize: '0.78rem', fontWeight: '600', color: '#555', marginBottom: '4px', textTransform: 'uppercase', letterSpacing: '0.3px' },
    select: { width: '100%', padding: '0.6rem', border: '1px solid #ddd', borderRadius: '8px', fontSize: '0.9rem', background: '#fff' },
    input: { width: '100%', padding: '0.6rem', border: '1px solid #ddd', borderRadius: '8px', fontSize: '0.9rem', boxSizing: 'border-box' },
    inputSm: { width: '70px', padding: '0.5rem', border: '1px solid #ddd', borderRadius: '6px', fontSize: '0.85rem', textAlign: 'center' },
    btn: (color = '#2563eb') => ({
      padding: '0.6rem 1.2rem', borderRadius: '8px', border: 'none', cursor: 'pointer',
      fontWeight: '600', fontSize: '0.85rem', color: '#fff', background: color, transition: 'all 0.2s'
    }),
    btnSm: (color = '#2563eb') => ({
      padding: '0.35rem 0.75rem', borderRadius: '6px', border: 'none', cursor: 'pointer',
      fontWeight: '600', fontSize: '0.78rem', color: '#fff', background: color
    }),
    btnOutline: { padding: '0.6rem 1.2rem', borderRadius: '8px', border: '2px solid #2563eb', cursor: 'pointer', fontWeight: '600', fontSize: '0.85rem', color: '#2563eb', background: '#fff' },
    msg: (type) => ({
      padding: '0.75rem 1rem', borderRadius: '8px', marginBottom: '1rem', fontWeight: '500', fontSize: '0.88rem',
      background: type === 'error' ? '#fef2f2' : '#f0fdf4', color: type === 'error' ? '#dc2626' : '#16a34a',
      border: `1px solid ${type === 'error' ? '#fecaca' : '#bbf7d0'}`
    }),
    table: { width: '100%', borderCollapse: 'separate', borderSpacing: 0, fontSize: '0.85rem' },
    th: { padding: '0.65rem 0.75rem', textAlign: 'left', fontWeight: '700', color: '#555', fontSize: '0.75rem', textTransform: 'uppercase', letterSpacing: '0.5px', borderBottom: '2px solid #e8e8ee', background: '#fafafa' },
    td: { padding: '0.65rem 0.75rem', borderBottom: '1px solid #f0f0f4', verticalAlign: 'middle' },
    badge: (color) => ({
      display: 'inline-block', padding: '0.2rem 0.6rem', borderRadius: '20px', fontSize: '0.72rem',
      fontWeight: '700', background: color + '18', color
    }),
    stat: { textAlign: 'center', padding: '1rem' },
    statValue: { fontSize: '1.75rem', fontWeight: '800', color: '#1a1a2e', lineHeight: 1 },
    statLabel: { fontSize: '0.72rem', fontWeight: '600', color: '#888', textTransform: 'uppercase', letterSpacing: '0.5px', marginTop: '4px' },
    stopCard: (isDragging) => ({
      display: 'flex', alignItems: 'center', gap: '0.75rem', padding: '0.75rem', marginBottom: '0.5rem',
      background: isDragging ? '#eff6ff' : '#fafafa', borderRadius: '10px', border: '1px solid #e4e4e9',
      cursor: 'grab', transition: 'all 0.15s', userSelect: 'none'
    }),
    progressBar: (pct, color = '#2563eb') => ({
      height: '6px', borderRadius: '3px', background: '#e8e8ee', overflow: 'hidden', position: 'relative',
      '::after': { content: '""', position: 'absolute', left: 0, top: 0, height: '100%', width: `${pct}%`, background: color, borderRadius: '3px' }
    }),
    grid2: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: '1rem' },
    grid4: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: '0.75rem' },
    emptyState: { textAlign: 'center', padding: '3rem 1rem', color: '#999' }
  };

  // ============================================================
  // Render: Message banner
  // ============================================================
  const MessageBanner = () => message.text ? (
    <div style={s.msg(message.type)}>{message.text}</div>
  ) : null;

  // ============================================================
  // Render: Stats card row
  // ============================================================
  const StatsRow = ({ stats }) => (
    <div style={{ display: 'grid', gridTemplateColumns: `repeat(${stats.length}, 1fr)`, gap: '0.75rem', marginBottom: '1rem' }}>
      {stats.map((st, i) => (
        <div key={i} style={{ ...s.card, ...s.stat, marginBottom: 0 }}>
          <div style={{ ...s.statValue, color: st.color || '#1a1a2e' }}>{st.value}</div>
          <div style={s.statLabel}>{st.label}</div>
        </div>
      ))}
    </div>
  );

  // ============================================================
  // RENDER: Route Planner Tab
  // ============================================================
  const renderPlanner = () => {
    const cg = caregivers.find(c => c.id === selectedCaregiver);
    const cgHasCoords = cg && cg.latitude && cg.longitude;
    const availableClients = clients.filter(c => c.is_active !== false && !routeStops.find(s => s.clientId === c.id));
    const totalUnits = routeStops.reduce((sum, s) => sum + s.serviceUnits, 0);
    const totalHours = totalUnits * 0.25;

    return (
      <div>
        {/* Config bar */}
        <div style={s.card}>
          <div style={s.cardTitle}>⚙️ Route Configuration</div>
          <div style={s.row}>
            <div style={s.col(2)}>
              <label style={s.label}>Caregiver</label>
              <select style={s.select} value={selectedCaregiver} onChange={e => { setSelectedCaregiver(e.target.value); setOptimizedRoute(null); }}>
                <option value="">— Select Caregiver —</option>
                {caregivers.filter(c => c.is_active !== false).map(c => (
                  <option key={c.id} value={c.id}>
                    {c.first_name} {c.last_name} {c.latitude ? '📍' : '⚠️ No address'}
                  </option>
                ))}
              </select>
            </div>
            <div style={s.col(1)}>
              <label style={s.label}>Date</label>
              <input type="date" style={s.input} value={selectedDate} onChange={e => { setSelectedDate(e.target.value); setOptimizedRoute(null); }} />
            </div>
            <div style={s.col(1)}>
              <label style={s.label}>Start Time</label>
              <input type="time" style={s.input} value={startTime} onChange={e => setStartTime(e.target.value)} />
            </div>
          </div>
          {cg && !cgHasCoords && (
            <div style={{ background: '#fffbeb', border: '1px solid #fde68a', borderRadius: '8px', padding: '0.75rem', fontSize: '0.85rem', color: '#92400e' }}>
              ⚠️ <strong>{cg.first_name} {cg.last_name}</strong> has no geocoded home address. 
              <button style={{ ...s.btnSm('#d97706'), marginLeft: '0.5rem' }}
                onClick={() => geocodeSingle('caregiver', cg.id, cg.address, cg.city, cg.state, cg.zip)}>
                Geocode Now
              </button>
            </div>
          )}
          {cg && cgHasCoords && (
            <div style={{ fontSize: '0.82rem', color: '#666', marginTop: '0.25rem' }}>
              📍 Home: {[cg.address, cg.city, cg.state, cg.zip].filter(Boolean).join(', ') || 'Address on file'}
            </div>
          )}
        </div>

        <div style={s.grid2}>
          {/* Left: Client picker + stops */}
          <div>
            {/* Add client */}
            <div style={s.card}>
              <div style={s.cardTitle}>➕ Add Client to Route</div>
              <select style={s.select} onChange={e => { if (e.target.value) { addStopToRoute(e.target.value); e.target.value = ''; } }}>
                <option value="">— Select a client to add —</option>
                {availableClients.map(c => (
                  <option key={c.id} value={c.id}>
                    {c.first_name} {c.last_name} — {c.weekly_authorized_units || 0}u/wk {c.latitude ? '📍' : '⚠️'}
                  </option>
                ))}
              </select>
            </div>

            {/* Stops list */}
            <div style={s.card}>
              <div style={{ ...s.cardTitle, justifyContent: 'space-between' }}>
                <span>🗺️ Route Stops ({routeStops.length})</span>
                <span style={{ fontSize: '0.8rem', fontWeight: '600', color: '#2563eb' }}>
                  {totalUnits} units · {totalHours}h
                </span>
              </div>
              
              {routeStops.length === 0 ? (
                <div style={s.emptyState}>
                  <div style={{ fontSize: '2rem', marginBottom: '0.5rem' }}>🗺️</div>
                  <div style={{ fontWeight: '600' }}>No stops added yet</div>
                  <div style={{ fontSize: '0.82rem' }}>Select clients above to build the route</div>
                </div>
              ) : (
                <>
                  <div style={{ fontSize: '0.78rem', color: '#888', marginBottom: '0.75rem' }}>
                    Drag to reorder, or click "Optimize" to auto-sort by shortest route
                  </div>
                  {routeStops.map((stop, idx) => (
                    <div key={stop.clientId} style={s.stopCard(false)}
                      draggable
                      onDragStart={() => handleDragStart(idx)}
                      onDragEnter={() => handleDragEnter(idx)}
                      onDragEnd={handleDragEnd}
                      onDragOver={e => e.preventDefault()}
                    >
                      {/* Drag handle + number */}
                      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', minWidth: '32px' }}>
                        <div style={{ fontSize: '0.7rem', color: '#aaa', cursor: 'grab' }}>⋮⋮</div>
                        <div style={{ width: '24px', height: '24px', borderRadius: '50%', background: '#2563eb', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.72rem', fontWeight: '800' }}>
                          {idx + 1}
                        </div>
                      </div>

                      {/* Client info */}
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontWeight: '700', fontSize: '0.88rem', color: '#1a1a2e' }}>
                          {stop.clientName}
                          {!stop.hasCoords && <span style={{ ...s.badge('#dc2626'), marginLeft: '0.5rem' }}>No GPS</span>}
                        </div>
                        <div style={{ fontSize: '0.78rem', color: '#888', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {stop.address || 'No address'}
                        </div>
                        {stop.weeklyAuthorizedUnits > 0 && (
                          <div style={{ fontSize: '0.72rem', color: '#2563eb', marginTop: '2px' }}>
                            Auth: {stop.weeklyAuthorizedUnits} units/wk
                          </div>
                        )}
                      </div>

                      {/* Units + time inputs */}
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', alignItems: 'flex-end' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                          <span style={{ fontSize: '0.72rem', color: '#888' }}>Units:</span>
                          <input type="number" min="1" max="96" value={stop.serviceUnits}
                            style={s.inputSm} onClick={e => e.stopPropagation()}
                            onChange={e => updateStopUnits(idx, e.target.value)} />
                          <span style={{ fontSize: '0.72rem', color: '#666' }}>({(stop.serviceUnits * 0.25).toFixed(1)}h)</span>
                        </div>
                        <div style={{ display: 'flex', gap: '4px' }}>
                          <input type="time" value={stop.startTime} placeholder="Auto"
                            style={{ ...s.inputSm, width: '90px', fontSize: '0.75rem' }}
                            onClick={e => e.stopPropagation()}
                            onChange={e => updateStopTime(idx, 'startTime', e.target.value)} />
                          <span style={{ fontSize: '0.72rem', color: '#888', alignSelf: 'center' }}>–</span>
                          <input type="time" value={stop.endTime} placeholder="Auto"
                            style={{ ...s.inputSm, width: '90px', fontSize: '0.75rem' }}
                            onClick={e => e.stopPropagation()}
                            onChange={e => updateStopTime(idx, 'endTime', e.target.value)} />
                        </div>
                      </div>

                      {/* Remove */}
                      <button onClick={() => removeStop(idx)}
                        style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '1.1rem', color: '#dc2626', padding: '4px' }}>
                        ✕
                      </button>
                    </div>
                  ))}
                </>
              )}

              {/* Action buttons */}
              {routeStops.length > 0 && (
                <div style={{ display: 'flex', gap: '0.5rem', marginTop: '1rem', flexWrap: 'wrap' }}>
                  <button style={s.btn('#2563eb')} onClick={optimizeRoute} disabled={optimizing}>
                    {optimizing ? '⏳ Optimizing...' : '🧠 Optimize Route'}
                  </button>
                  <button style={s.btn('#16a34a')} onClick={() => saveRoute('draft')} disabled={saving || !optimizedRoute}>
                    💾 Save Draft
                  </button>
                  <button style={s.btn('#7c3aed')} onClick={() => saveRoute('published')} disabled={saving || !optimizedRoute}>
                    📤 Publish Route
                  </button>
                  <button style={{ ...s.btnOutline, color: '#dc2626', borderColor: '#dc2626' }}
                    onClick={() => { setRouteStops([]); setOptimizedRoute(null); }}>
                    Clear All
                  </button>
                </div>
              )}
            </div>
          </div>

          {/* Right: Optimized results */}
          <div>
            {optimizedRoute ? (
              <>
                {/* Summary stats */}
                <StatsRow stats={[
                  { value: `${optimizedRoute.summary.totalMiles}`, label: 'Total Miles', color: '#2563eb' },
                  { value: `${optimizedRoute.summary.totalStops}`, label: 'Stops', color: '#7c3aed' },
                  { value: `${optimizedRoute.summary.totalServiceHours}h`, label: 'Service Time', color: '#16a34a' },
                  { value: `${optimizedRoute.summary.totalDriveMinutes}m`, label: 'Drive Time', color: '#ea580c' }
                ]} />

                {/* Route detail */}
                <div style={s.card}>
                  <div style={s.cardTitle}>📋 Optimized Route Detail</div>
                  <div style={{ fontSize: '0.82rem', color: '#666', marginBottom: '1rem', display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
                    <span>{optimizedRoute.caregiver.name} · {selectedDate} · Est. {optimizedRoute.summary.estimatedStartTime} – {optimizedRoute.summary.estimatedEndTime}</span>
                    <span style={{
                      ...s.badge(optimizedRoute.summary.googleApiUsed ? '#16a34a' : '#d97706'),
                      fontSize: '0.68rem'
                    }}>
                      {optimizedRoute.summary.googleApiUsed ? '🗺️ Google Routes API — Real Road Miles' : '📐 Haversine Estimate — Straight Line'}
                    </span>
                  </div>

                  {/* Start: Home */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', padding: '0.6rem', background: '#f0fdf4', borderRadius: '8px', marginBottom: '0.25rem' }}>
                    <div style={{ width: '28px', height: '28px', borderRadius: '50%', background: '#16a34a', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.82rem' }}>🏠</div>
                    <div>
                      <div style={{ fontWeight: '700', fontSize: '0.85rem', color: '#16a34a' }}>Start: Home</div>
                      <div style={{ fontSize: '0.75rem', color: '#666' }}>{optimizedRoute.caregiver.homeAddress}</div>
                    </div>
                  </div>

                  {optimizedRoute.stops.map((stop, idx) => (
                    <React.Fragment key={stop.clientId}>
                      {/* Drive segment */}
                      <div style={{ display: 'flex', alignItems: 'center', paddingLeft: '13px', height: '32px' }}>
                        <div style={{ width: '2px', height: '100%', background: '#ddd', marginRight: '1.5rem' }} />
                        <span style={{ fontSize: '0.72rem', color: '#999' }}>
                          🚗 {stop.milesFromPrevious} mi · ~{stop.driveMinutesFromPrevious} min drive
                        </span>
                      </div>
                      {/* Stop */}
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', padding: '0.6rem', background: '#fafafa', borderRadius: '8px', border: '1px solid #eee' }}>
                        <div style={{ width: '28px', height: '28px', borderRadius: '50%', background: '#2563eb', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.72rem', fontWeight: '800' }}>
                          {idx + 1}
                        </div>
                        <div style={{ flex: 1 }}>
                          <div style={{ fontWeight: '700', fontSize: '0.85rem' }}>{stop.clientName}</div>
                          <div style={{ fontSize: '0.75rem', color: '#666' }}>{stop.address}</div>
                        </div>
                        <div style={{ textAlign: 'right' }}>
                          <div style={{ fontWeight: '700', fontSize: '0.82rem', color: '#2563eb' }}>
                            {stop.calculatedArrival} – {stop.calculatedDeparture}
                          </div>
                          <div style={{ fontSize: '0.72rem', color: '#888' }}>
                            {stop.serviceUnits} units ({stop.serviceMinutes} min)
                          </div>
                        </div>
                      </div>
                    </React.Fragment>
                  ))}

                  {/* Return home */}
                  <div style={{ display: 'flex', alignItems: 'center', paddingLeft: '13px', height: '32px' }}>
                    <div style={{ width: '2px', height: '100%', background: '#ddd', marginRight: '1.5rem' }} />
                    <span style={{ fontSize: '0.72rem', color: '#999' }}>
                      🚗 {optimizedRoute.summary.returnMiles} mi · ~{optimizedRoute.summary.returnDriveMinutes} min return
                    </span>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', padding: '0.6rem', background: '#f0fdf4', borderRadius: '8px' }}>
                    <div style={{ width: '28px', height: '28px', borderRadius: '50%', background: '#16a34a', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.82rem' }}>🏠</div>
                    <div style={{ fontWeight: '700', fontSize: '0.85rem', color: '#16a34a' }}>Return Home · ~{optimizedRoute.summary.estimatedEndTime}</div>
                  </div>
                </div>
              </>
            ) : (
              <div style={{ ...s.card, ...s.emptyState }}>
                <div style={{ fontSize: '3rem', marginBottom: '0.75rem' }}>🧭</div>
                <div style={{ fontWeight: '700', fontSize: '1.1rem', color: '#555' }}>Route Not Optimized Yet</div>
                <div style={{ fontSize: '0.85rem', color: '#888', maxWidth: '300px', margin: '0.5rem auto' }}>
                  Add clients to the route, set their units, then click <strong>"Optimize Route"</strong> to calculate the shortest path with mileage
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    );
  };

  // ============================================================
  // RENDER: Daily Overview Tab
  // ============================================================
  const renderDaily = () => (
    <div>
      <div style={{ ...s.card, display: 'flex', alignItems: 'center', gap: '1rem', flexWrap: 'wrap' }}>
        <div style={s.cardTitle}>📅 Daily Route Overview</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginLeft: 'auto' }}>
          <button style={s.btnSm('#666')} onClick={() => {
            const d = new Date(dailyDate); d.setDate(d.getDate() - 1);
            setDailyDate(d.toISOString().split('T')[0]);
          }}>◀</button>
          <input type="date" style={s.input} value={dailyDate} onChange={e => setDailyDate(e.target.value)} />
          <button style={s.btnSm('#666')} onClick={() => {
            const d = new Date(dailyDate); d.setDate(d.getDate() + 1);
            setDailyDate(d.toISOString().split('T')[0]);
          }}>▶</button>
        </div>
      </div>

      {dailyLoading ? (
        <div style={s.emptyState}>Loading...</div>
      ) : dailyRoutes.length === 0 ? (
        <div style={{ ...s.card, ...s.emptyState }}>
          <div style={{ fontSize: '2.5rem', marginBottom: '0.5rem' }}>📭</div>
          <div style={{ fontWeight: '600' }}>No routes scheduled for {dailyDate}</div>
        </div>
      ) : (
        <>
          <StatsRow stats={[
            { value: dailyRoutes.length, label: 'Caregivers', color: '#2563eb' },
            { value: dailyRoutes.reduce((s, r) => s + r.visits.length, 0), label: 'Total Visits', color: '#7c3aed' },
            { value: `${dailyRoutes.reduce((s, r) => s + r.totalMiles, 0).toFixed(1)}`, label: 'Total Miles', color: '#ea580c' },
            { value: `${(dailyRoutes.reduce((s, r) => s + r.totalServiceMinutes, 0) / 60).toFixed(1)}h`, label: 'Service Hours', color: '#16a34a' }
          ]} />
          
          {dailyRoutes.map(route => (
            <div key={route.caregiverId} style={s.card}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
                <div>
                  <div style={{ fontWeight: '700', fontSize: '1.05rem', color: '#1a1a2e' }}>
                    {route.caregiverName}
                  </div>
                  <div style={{ fontSize: '0.78rem', color: '#888' }}>
                    {route.homeAddress || 'No home address'} · {route.visits.length} visits
                  </div>
                </div>
                <div style={{ display: 'flex', gap: '1rem', textAlign: 'center' }}>
                  <div>
                    <div style={{ fontWeight: '800', fontSize: '1.1rem', color: '#ea580c' }}>{route.totalMiles} mi</div>
                    <div style={{ fontSize: '0.7rem', color: '#888' }}>Total Miles</div>
                  </div>
                  <div>
                    <div style={{ fontWeight: '800', fontSize: '1.1rem', color: '#16a34a' }}>{(route.totalServiceMinutes / 60).toFixed(1)}h</div>
                    <div style={{ fontSize: '0.7rem', color: '#888' }}>Service</div>
                  </div>
                  <div>
                    <div style={{ fontWeight: '800', fontSize: '1.1rem', color: '#2563eb' }}>~{route.totalDriveMinutes}m</div>
                    <div style={{ fontSize: '0.7rem', color: '#888' }}>Drive</div>
                  </div>
                </div>
              </div>
              
              <table style={s.table}>
                <thead>
                  <tr>
                    <th style={s.th}>#</th>
                    <th style={s.th}>Client</th>
                    <th style={s.th}>Address</th>
                    <th style={s.th}>Time</th>
                    <th style={s.th}>Units</th>
                    <th style={s.th}>Miles</th>
                  </tr>
                </thead>
                <tbody>
                  {route.visits.map((v, idx) => (
                    <tr key={v.scheduleId || idx}>
                      <td style={s.td}>
                        <span style={{ ...s.badge('#2563eb'), minWidth: '20px', textAlign: 'center' }}>{idx + 1}</span>
                      </td>
                      <td style={{ ...s.td, fontWeight: '600' }}>{v.clientName}</td>
                      <td style={{ ...s.td, fontSize: '0.8rem', color: '#666', maxWidth: '200px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {v.address || '—'}
                      </td>
                      <td style={s.td}>{v.startTime?.slice(0,5)} – {v.endTime?.slice(0,5)}</td>
                      <td style={s.td}>{v.serviceUnits}</td>
                      <td style={{ ...s.td, fontWeight: '700', color: '#ea580c' }}>{v.milesFromPrevious}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}
        </>
      )}
    </div>
  );

  // ============================================================
  // RENDER: Hours Dashboard Tab
  // ============================================================
  const renderHours = () => (
    <div>
      <div style={{ ...s.card, display: 'flex', alignItems: 'center', gap: '1rem', flexWrap: 'wrap' }}>
        <div style={s.cardTitle}>⏱️ Hours Dashboard</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginLeft: 'auto' }}>
          <label style={{ ...s.label, marginBottom: 0 }}>From</label>
          <input type="date" style={{ ...s.input, width: 'auto' }} value={hoursStartDate} onChange={e => setHoursStartDate(e.target.value)} />
          <label style={{ ...s.label, marginBottom: 0 }}>To</label>
          <input type="date" style={{ ...s.input, width: 'auto' }} value={hoursEndDate} onChange={e => setHoursEndDate(e.target.value)} />
          <button style={s.btnSm('#2563eb')} onClick={loadHoursSummary}>Refresh</button>
        </div>
      </div>

      {hoursLoading ? (
        <div style={s.emptyState}>Loading...</div>
      ) : hoursData ? (
        <>
          <StatsRow stats={[
            { value: hoursData.totals.totalCaregivers, label: 'Caregivers', color: '#2563eb' },
            { value: `${hoursData.totals.totalScheduledHours.toFixed(1)}`, label: 'Scheduled Hours', color: '#7c3aed' },
            { value: `${hoursData.totals.totalClockedHours.toFixed(1)}`, label: 'Clocked Hours', color: '#16a34a' },
            { value: `${hoursData.totals.totalMiles.toFixed(0)}`, label: 'Total Miles', color: '#ea580c' },
            { value: `${hoursData.totals.totalCompletedVisits}/${hoursData.totals.totalScheduledVisits}`, label: 'Visits Done', color: '#0891b2' },
            { value: hoursData.totals.activeCaregivers, label: 'Active Now', color: '#16a34a' }
          ]} />

          <div style={s.card}>
            <div style={{ overflowX: 'auto' }}>
              <table style={s.table}>
                <thead>
                  <tr>
                    <th style={s.th}>Caregiver</th>
                    <th style={s.th}>Scheduled</th>
                    <th style={s.th}>Clocked</th>
                    <th style={s.th}>Remaining</th>
                    <th style={s.th}>Overtime</th>
                    <th style={{ ...s.th, minWidth: '160px' }}>Utilization</th>
                    <th style={s.th}>Visits</th>
                    <th style={s.th}>Miles</th>
                    <th style={s.th}>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {hoursData.caregivers.map(cg => {
                    const utilPct = Math.min(cg.utilizationPct, 100);
                    const utilColor = utilPct >= 90 ? '#dc2626' : utilPct >= 70 ? '#ea580c' : utilPct >= 40 ? '#2563eb' : '#999';
                    return (
                      <tr key={cg.id}>
                        <td style={{ ...s.td, fontWeight: '700' }}>
                          {cg.name}
                          {cg.activeShift && (
                            <span style={{ ...s.badge('#16a34a'), marginLeft: '0.5rem' }}>LIVE</span>
                          )}
                        </td>
                        <td style={{ ...s.td, fontWeight: '700' }}>{cg.scheduledHours}h</td>
                        <td style={{ ...s.td, fontWeight: '700', color: '#16a34a' }}>{cg.clockedHours}h</td>
                        <td style={s.td}>{cg.remainingHours}h</td>
                        <td style={{ ...s.td, color: cg.overtimeHours > 0 ? '#dc2626' : '#999', fontWeight: cg.overtimeHours > 0 ? '700' : '400' }}>
                          {cg.overtimeHours > 0 ? `${cg.overtimeHours}h ⚠️` : '—'}
                        </td>
                        <td style={s.td}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                            <div style={{ flex: 1, height: '8px', borderRadius: '4px', background: '#e8e8ee', overflow: 'hidden' }}>
                              <div style={{ height: '100%', width: `${utilPct}%`, background: utilColor, borderRadius: '4px', transition: 'width 0.3s' }} />
                            </div>
                            <span style={{ fontSize: '0.78rem', fontWeight: '700', color: utilColor, minWidth: '35px' }}>{cg.utilizationPct}%</span>
                          </div>
                        </td>
                        <td style={s.td}>
                          <span style={{ fontWeight: '600' }}>{cg.completedVisits}</span>
                          <span style={{ color: '#888' }}>/{cg.scheduledVisits}</span>
                        </td>
                        <td style={{ ...s.td, fontWeight: '600', color: '#ea580c' }}>{cg.totalMiles || '—'}</td>
                        <td style={s.td}>
                          {cg.activeShift ? (
                            <div style={{ fontSize: '0.75rem' }}>
                              <div style={{ color: '#16a34a', fontWeight: '600' }}>🟢 Clocked In</div>
                              <div style={{ color: '#888' }}>{cg.activeShift.client_name}</div>
                            </div>
                          ) : (
                            <span style={{ color: '#999', fontSize: '0.8rem' }}>⚪ Off</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </>
      ) : null}
    </div>
  );

  // ============================================================
  // RENDER: Geofence Settings Tab
  // ============================================================
  const renderGeofence = () => {
    const clientsWithoutGeofence = clients.filter(c => 
      c.is_active !== false && !geofenceSettings.find(g => g.client_id === c.id)
    );

    return (
      <div>
        <div style={s.card}>
          <div style={{ ...s.cardTitle, justifyContent: 'space-between' }}>
            <span>📍 GPS Geofence Auto Clock-In/Out</span>
            <div style={{ display: 'flex', gap: '0.5rem' }}>
              <button style={s.btn('#2563eb')} onClick={() => geocodeAll('clients')} disabled={geocoding}>
                {geocoding ? '⏳...' : '🌍 Geocode All Clients'}
              </button>
              <button style={s.btn('#7c3aed')} onClick={() => geocodeAll('caregivers')} disabled={geocoding}>
                {geocoding ? '⏳...' : '🌍 Geocode All Caregivers'}
              </button>
            </div>
          </div>
          <p style={{ fontSize: '0.85rem', color: '#666', margin: '0 0 1rem' }}>
            When a caregiver's GPS enters the geofence radius around a client's home, the system can auto clock-in. 
            When they leave the radius, it auto clocks-out. Set radius per client based on property size and GPS accuracy.
          </p>

          {geocodeResults && (
            <div style={{ ...s.msg(geocodeResults.failed > 0 ? 'error' : 'success'), marginBottom: '1rem' }}>
              Geocoded {geocodeResults.success} of {geocodeResults.total}. 
              {geocodeResults.failed > 0 && ` Failed: ${geocodeResults.failed}`}
            </div>
          )}
        </div>

        {/* Add new geofence */}
        <div style={s.card}>
          <div style={s.cardTitle}>➕ Add Client Geofence</div>
          <div style={s.row}>
            <div style={s.col(2)}>
              <select style={s.select} onChange={e => {
                if (e.target.value) {
                  setEditGeofence({
                    clientId: e.target.value,
                    radiusFeet: 300,
                    autoClockIn: true,
                    autoClockOut: true,
                    requireGps: true,
                    notifyAdminOnOverride: true
                  });
                  e.target.value = '';
                }
              }}>
                <option value="">— Select client to configure —</option>
                {clientsWithoutGeofence.map(c => (
                  <option key={c.id} value={c.id}>
                    {c.first_name} {c.last_name} {c.latitude ? '📍' : '⚠️ No GPS'}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {editGeofence && (
            <div style={{ background: '#f8f9ff', borderRadius: '10px', padding: '1rem', marginTop: '0.75rem', border: '1px solid #e0e4f2' }}>
              <div style={{ fontWeight: '700', marginBottom: '0.75rem', color: '#1a1a2e' }}>
                Configure Geofence for {clients.find(c => c.id === editGeofence.clientId)?.first_name || 'Client'}
              </div>
              <div style={s.row}>
                <div style={s.col(1)}>
                  <label style={s.label}>Radius (feet)</label>
                  <input type="number" style={s.input} value={editGeofence.radiusFeet}
                    onChange={e => setEditGeofence(p => ({ ...p, radiusFeet: parseInt(e.target.value) || 300 }))} />
                  <div style={{ fontSize: '0.72rem', color: '#888', marginTop: '2px' }}>
                    ~{Math.round(editGeofence.radiusFeet / 3.28)} meters · Good for: {editGeofence.radiusFeet <= 200 ? 'apartment' : editGeofence.radiusFeet <= 500 ? 'house' : 'large property'}
                  </div>
                </div>
                <div style={s.col(1)}>
                  <label style={s.label}>Auto Clock-In</label>
                  <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer' }}>
                    <input type="checkbox" checked={editGeofence.autoClockIn}
                      onChange={e => setEditGeofence(p => ({ ...p, autoClockIn: e.target.checked }))} />
                    <span style={{ fontSize: '0.85rem' }}>Auto clock-in when entering geofence</span>
                  </label>
                </div>
                <div style={s.col(1)}>
                  <label style={s.label}>Auto Clock-Out</label>
                  <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer' }}>
                    <input type="checkbox" checked={editGeofence.autoClockOut}
                      onChange={e => setEditGeofence(p => ({ ...p, autoClockOut: e.target.checked }))} />
                    <span style={{ fontSize: '0.85rem' }}>Auto clock-out when leaving geofence</span>
                  </label>
                </div>
              </div>
              <div style={s.row}>
                <div style={s.col(1)}>
                  <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer' }}>
                    <input type="checkbox" checked={editGeofence.requireGps}
                      onChange={e => setEditGeofence(p => ({ ...p, requireGps: e.target.checked }))} />
                    <span style={{ fontSize: '0.85rem' }}>Require GPS (block clock-in without location)</span>
                  </label>
                </div>
                <div style={s.col(1)}>
                  <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer' }}>
                    <input type="checkbox" checked={editGeofence.notifyAdminOnOverride}
                      onChange={e => setEditGeofence(p => ({ ...p, notifyAdminOnOverride: e.target.checked }))} />
                    <span style={{ fontSize: '0.85rem' }}>Notify admin on manual override</span>
                  </label>
                </div>
              </div>
              <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.75rem' }}>
                <button style={s.btn('#16a34a')} onClick={() => saveGeofence(editGeofence)}>Save Geofence</button>
                <button style={s.btnOutline} onClick={() => setEditGeofence(null)}>Cancel</button>
              </div>
            </div>
          )}
        </div>

        {/* Existing geofence settings */}
        <div style={s.card}>
          <div style={s.cardTitle}>📋 Client Geofence Settings ({geofenceSettings.length})</div>
          {geofenceLoading ? (
            <div style={s.emptyState}>Loading...</div>
          ) : geofenceSettings.length === 0 ? (
            <div style={s.emptyState}>
              <div style={{ fontSize: '2rem', marginBottom: '0.5rem' }}>📍</div>
              <div style={{ fontWeight: '600' }}>No geofences configured yet</div>
              <div style={{ fontSize: '0.82rem' }}>Select a client above to set up auto clock-in/out</div>
            </div>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table style={s.table}>
                <thead>
                  <tr>
                    <th style={s.th}>Client</th>
                    <th style={s.th}>Address</th>
                    <th style={s.th}>Radius</th>
                    <th style={s.th}>Auto In</th>
                    <th style={s.th}>Auto Out</th>
                    <th style={s.th}>Require GPS</th>
                    <th style={s.th}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {geofenceSettings.map(gs => (
                    <tr key={gs.id}>
                      <td style={{ ...s.td, fontWeight: '700' }}>{gs.first_name} {gs.last_name}</td>
                      <td style={{ ...s.td, fontSize: '0.8rem', color: '#666', maxWidth: '200px' }}>
                        {[gs.address, gs.city, gs.state, gs.zip].filter(Boolean).join(', ')}
                        {gs.latitude ? ' 📍' : ' ⚠️'}
                      </td>
                      <td style={{ ...s.td, fontWeight: '700' }}>{gs.radius_feet} ft</td>
                      <td style={s.td}>{gs.auto_clock_in ? '✅' : '❌'}</td>
                      <td style={s.td}>{gs.auto_clock_out ? '✅' : '❌'}</td>
                      <td style={s.td}>{gs.require_gps ? '✅' : '❌'}</td>
                      <td style={s.td}>
                        <button style={s.btnSm('#2563eb')} onClick={() => setEditGeofence({
                          clientId: gs.client_id,
                          radiusFeet: gs.radius_feet,
                          autoClockIn: gs.auto_clock_in,
                          autoClockOut: gs.auto_clock_out,
                          requireGps: gs.require_gps,
                          notifyAdminOnOverride: gs.notify_admin_on_override
                        })}>Edit</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    );
  };

  // ============================================================
  // Main Render
  // ============================================================
  if (loading) return <div style={{ ...s.page, textAlign: 'center', padding: '3rem' }}>Loading...</div>;

  return (
    <div style={s.page}>
      <div style={s.header}>
        <h1 style={s.title}>🗺️ Route & Schedule Optimizer</h1>
        {apiStatus && (
          <div style={{
            display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.4rem 0.8rem',
            borderRadius: '8px', fontSize: '0.78rem', fontWeight: '600',
            background: apiStatus.googleApiKeyConfigured ? '#f0fdf4' : '#fffbeb',
            color: apiStatus.googleApiKeyConfigured ? '#16a34a' : '#92400e',
            border: `1px solid ${apiStatus.googleApiKeyConfigured ? '#bbf7d0' : '#fde68a'}`
          }}>
            {apiStatus.googleApiKeyConfigured ? '🟢 Google Routes API Active' : '🟡 Using Haversine Estimates'}
            <span style={{ fontWeight: '400', color: '#888' }}>·</span>
            <span style={{ fontWeight: '400', fontSize: '0.72rem', color: '#888' }}>
              {apiStatus.geocodingSource}
            </span>
          </div>
        )}
      </div>

      <MessageBanner />

      {/* Tabs */}
      <div style={s.tabs}>
        {[
          { id: 'planner', icon: '🧭', label: 'Route Planner' },
          { id: 'daily', icon: '📅', label: 'Daily Overview' },
          { id: 'hours', icon: '⏱️', label: 'Hours Dashboard' },
          { id: 'geofence', icon: '📍', label: 'GPS & Geofence' },
        ].map(t => (
          <button key={t.id} style={s.tab(activeTab === t.id)} onClick={() => setActiveTab(t.id)}>
            {t.icon} {t.label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      {activeTab === 'planner' && renderPlanner()}
      {activeTab === 'daily' && renderDaily()}
      {activeTab === 'hours' && renderHours()}
      {activeTab === 'geofence' && renderGeofence()}
    </div>
  );
};

export default RouteOptimizer;
