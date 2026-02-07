// src/components/admin/RouteOptimizer.jsx
// Route & Schedule Optimizer v2 — Complete rebuild
import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { API_BASE_URL } from '../../config';

const RouteOptimizer = ({ token }) => {
  // ── Core state ──────────────────────────────────────────────
  const [activeTab, setActiveTab] = useState('planner');
  const [caregivers, setCaregivers] = useState([]);
  const [clients, setClients] = useState([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState({ text: '', type: '' });
  const [apiStatus, setApiStatus] = useState(null);

  // ── Route Planner state ─────────────────────────────────────
  const [selectedCaregiver, setSelectedCaregiver] = useState('');
  const [selectedDate, setSelectedDate] = useState(new Date().toISOString().split('T')[0]);
  const [routeStops, setRouteStops] = useState([]);
  const [optimizedRoute, setOptimizedRoute] = useState(null);
  const [preOptimizeMiles, setPreOptimizeMiles] = useState(null);
  const [optimizing, setOptimizing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [startTime, setStartTime] = useState('08:00');
  const [bufferMinutes, setBufferMinutes] = useState(10);
  const [mileageRate, setMileageRate] = useState(0.67);
  const [clientSearch, setClientSearch] = useState('');
  const [loadingSchedule, setLoadingSchedule] = useState(false);
  const [existingSavedPlan, setExistingSavedPlan] = useState(null);

  // ── Daily view state ────────────────────────────────────────
  const [dailyDate, setDailyDate] = useState(new Date().toISOString().split('T')[0]);
  const [dailyRoutes, setDailyRoutes] = useState([]);
  const [dailyLoading, setDailyLoading] = useState(false);

  // ── Hours dashboard state ───────────────────────────────────
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

  // ── Saved Routes state ──────────────────────────────────────
  const [savedRoutes, setSavedRoutes] = useState([]);
  const [savedRoutesLoading, setSavedRoutesLoading] = useState(false);
  const [savedFilter, setSavedFilter] = useState({ status: '', caregiverId: '' });

  // ── Geofence state ──────────────────────────────────────────
  const [geofenceSettings, setGeofenceSettings] = useState([]);
  const [geofenceLoading, setGeofenceLoading] = useState(false);
  const [editGeofence, setEditGeofence] = useState(null);
  const [geocoding, setGeocoding] = useState(false);
  const [geocodeResults, setGeocodeResults] = useState(null);

  // ── Drag state ──────────────────────────────────────────────
  const dragItem = useRef(null);
  const dragOverItem = useRef(null);

  // ── Print ref ───────────────────────────────────────────────
  const printRef = useRef(null);

  // ════════════════════════════════════════════════════════════
  // Data Loading
  // ════════════════════════════════════════════════════════════
  useEffect(() => {
    loadData();
    fetch(`${API_BASE_URL}/api/route-optimizer/config-status`, {
      headers: { 'Authorization': `Bearer ${token}` }
    }).then(r => r.ok ? r.json() : null).then(setApiStatus).catch(() => {});
  }, []);

  useEffect(() => {
    if (activeTab === 'daily') loadDailyView();
    if (activeTab === 'hours') loadHoursSummary();
    if (activeTab === 'geofence') loadGeofenceSettings();
    if (activeTab === 'saved') loadSavedRoutes();
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

  const api = async (url, opts = {}) => {
    const res = await fetch(`${API_BASE_URL}${url}`, {
      ...opts,
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}`, ...opts.headers }
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || `Request failed (${res.status})`);
    }
    return res.json();
  };

  // ════════════════════════════════════════════════════════════
  // Route Planner Logic
  // ════════════════════════════════════════════════════════════

  // Load from existing schedule
  const loadFromSchedule = async () => {
    if (!selectedCaregiver) { showMsg('Select a caregiver first', 'error'); return; }
    setLoadingSchedule(true);
    try {
      const data = await api(`/api/route-optimizer/load-schedule/${selectedCaregiver}/${selectedDate}`);
      if (data.stops.length === 0) {
        showMsg(`No schedules found for ${selectedDate}`, 'error');
        return;
      }
      setRouteStops(data.stops);
      setExistingSavedPlan(data.savedPlan);
      setOptimizedRoute(null);
      setPreOptimizeMiles(null);
      showMsg(`Loaded ${data.stops.length} visits from schedule${data.savedPlan ? ' (saved plan exists)' : ''}`);
    } catch (e) {
      showMsg(e.message, 'error');
    } finally {
      setLoadingSchedule(false);
    }
  };

  // Client search filtering
  const filteredClients = useMemo(() => {
    const existing = new Set(routeStops.map(s => s.clientId));
    return clients
      .filter(c => c.is_active !== false && !existing.has(c.id))
      .filter(c => {
        if (!clientSearch.trim()) return true;
        const term = clientSearch.toLowerCase();
        return `${c.first_name} ${c.last_name}`.toLowerCase().includes(term) ||
          (c.address || '').toLowerCase().includes(term) ||
          (c.city || '').toLowerCase().includes(term);
      })
      .slice(0, 15); // Cap dropdown to prevent performance issues
  }, [clients, routeStops, clientSearch]);

  const addStopToRoute = (clientId) => {
    if (routeStops.find(s => s.clientId === clientId)) return;
    const client = clients.find(c => c.id === clientId);
    if (!client) return;
    setRouteStops(prev => [...prev, {
      clientId: client.id,
      clientName: `${client.first_name} ${client.last_name}`,
      address: [client.address, client.city, client.state, client.zip].filter(Boolean).join(', '),
      latitude: client.latitude, longitude: client.longitude,
      serviceUnits: client.weekly_authorized_units ? Math.min(client.weekly_authorized_units, 16) : 4,
      weeklyAuthorizedUnits: client.weekly_authorized_units || 0,
      startTime: '', endTime: '',
      hasCoords: !!(client.latitude && client.longitude)
    }]);
    setOptimizedRoute(null);
    setPreOptimizeMiles(null);
    setClientSearch('');
  };

  const removeStop = (idx) => {
    setRouteStops(prev => prev.filter((_, i) => i !== idx));
    setOptimizedRoute(null);
  };

  const updateStop = (idx, field, value) => {
    setRouteStops(prev => prev.map((s, i) => i === idx ? { ...s, [field]: field === 'serviceUnits' ? (parseInt(value) || 0) : value } : s));
    setOptimizedRoute(null);
  };

  // Drag and drop
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

  // Optimize
  const optimizeRoute = async () => {
    if (!selectedCaregiver) { showMsg('Select a caregiver first', 'error'); return; }
    if (routeStops.length === 0) { showMsg('Add at least one client', 'error'); return; }
    const missingCoords = routeStops.filter(s => !s.hasCoords);
    if (missingCoords.length > 0) {
      showMsg(`${missingCoords.length} client(s) need geocoded addresses. Go to GPS & Geofence tab → Geocode All.`, 'error');
      return;
    }
    setOptimizing(true);
    try {
      const data = await api('/api/route-optimizer/optimize', {
        method: 'POST',
        body: JSON.stringify({
          caregiverId: selectedCaregiver, date: selectedDate, startTime,
          bufferMinutes, mileageRate,
          stops: routeStops.map(s => ({
            clientId: s.clientId, serviceUnits: s.serviceUnits,
            startTime: s.startTime || undefined, endTime: s.endTime || undefined
          }))
        })
      });

      // Store pre-optimization miles from real calculation
      if (data.preOptimization) {
        setPreOptimizeMiles(data.preOptimization.totalMiles);
      }

      setOptimizedRoute(data);
      // Update stops to match optimized order
      setRouteStops(data.stops.map(s => ({
        clientId: s.clientId, clientName: s.clientName, address: s.address,
        latitude: s.latitude, longitude: s.longitude,
        serviceUnits: s.serviceUnits, weeklyAuthorizedUnits: s.weeklyAuthorizedUnits,
        startTime: s.scheduledStartTime || '', endTime: s.scheduledEndTime || '',
        hasCoords: true
      })));
      const savedMsg = data.summary.milesSaved > 0
        ? `Saves ${data.summary.milesSaved} mi vs current schedule!`
        : 'Schedule order is already optimal.';
      showMsg(`Route optimized! ${data.summary.totalMiles} mi · ${data.summary.totalStops} stops · ${savedMsg}`);
    } catch (e) {
      showMsg('Optimization failed: ' + e.message, 'error');
    } finally {
      setOptimizing(false);
    }
  };

  // Save
  const saveRoute = async (status = 'draft') => {
    if (!optimizedRoute) { showMsg('Optimize the route first', 'error'); return; }
    setSaving(true);
    try {
      await api('/api/route-optimizer/save-route', {
        method: 'POST',
        body: JSON.stringify({
          caregiverId: selectedCaregiver, date: selectedDate,
          stops: optimizedRoute.stops,
          totalMiles: optimizedRoute.summary.totalMiles,
          totalDriveMinutes: optimizedRoute.summary.totalDriveMinutes,
          totalServiceMinutes: optimizedRoute.summary.totalServiceMinutes,
          status
        })
      });
      showMsg(`Route ${status === 'published' ? 'published' : 'saved as draft'}!`);
    } catch (e) {
      showMsg('Save failed: ' + e.message, 'error');
    } finally {
      setSaving(false);
    }
  };

  // Print route sheet
  const printRouteSheet = () => {
    if (!optimizedRoute) return;
    const r = optimizedRoute;
    const w = window.open('', '_blank');
    w.document.write(`<!DOCTYPE html><html><head><title>Route Sheet - ${r.caregiver.name} - ${selectedDate}</title>
    <style>
      * { margin: 0; padding: 0; box-sizing: border-box; }
      body { font-family: Arial, sans-serif; padding: 20px; font-size: 12px; }
      h1 { font-size: 18px; margin-bottom: 4px; }
      .meta { color: #666; margin-bottom: 16px; font-size: 11px; }
      .summary { display: flex; gap: 20px; margin-bottom: 16px; padding: 10px; background: #f5f5f5; border-radius: 6px; }
      .summary div { text-align: center; }
      .summary .val { font-size: 18px; font-weight: 800; }
      .summary .lbl { font-size: 9px; text-transform: uppercase; color: #888; }
      table { width: 100%; border-collapse: collapse; margin-bottom: 16px; }
      th { background: #333; color: #fff; padding: 8px; text-align: left; font-size: 10px; text-transform: uppercase; }
      td { padding: 8px; border-bottom: 1px solid #ddd; vertical-align: top; }
      tr:nth-child(even) { background: #f9f9f9; }
      .stop-num { display: inline-block; width: 22px; height: 22px; border-radius: 50%; background: #2563eb; color: #fff; text-align: center; line-height: 22px; font-weight: 800; font-size: 11px; }
      .notes-area { border: 1px solid #ddd; border-radius: 4px; padding: 8px; min-height: 30px; margin-top: 4px; }
      .footer { margin-top: 20px; font-size: 10px; color: #999; border-top: 1px solid #ddd; padding-top: 8px; }
      @media print { body { padding: 10px; } }
    </style></head><body>
    <h1>🗺️ Route Sheet — ${r.caregiver.name}</h1>
    <div class="meta">${selectedDate} · Start: ${r.summary.estimatedStartTime} · End: ~${r.summary.estimatedEndTime} · Home: ${r.caregiver.homeAddress}</div>
    <div class="summary">
      <div><div class="val">${r.summary.totalMiles}</div><div class="lbl">Miles</div></div>
      <div><div class="val">${r.summary.totalStops}</div><div class="lbl">Stops</div></div>
      <div><div class="val">${r.summary.totalServiceHours}h</div><div class="lbl">Service</div></div>
      <div><div class="val">${r.summary.totalDriveMinutes}m</div><div class="lbl">Drive</div></div>
      <div><div class="val">$${r.summary.mileageReimbursement}</div><div class="lbl">Mileage</div></div>
    </div>
    <table>
      <thead><tr><th>#</th><th>Client</th><th>Address</th><th>Arrive</th><th>Depart</th><th>Units</th><th>Miles</th><th>Drive</th><th>Notes / Signature</th></tr></thead>
      <tbody>
        <tr style="background:#e8f5e9"><td>🏠</td><td colspan="2"><strong>START: Home</strong> — ${r.caregiver.homeAddress}</td><td>${r.summary.estimatedStartTime}</td><td></td><td></td><td></td><td></td><td></td></tr>
        ${r.stops.map((s, i) => `
          <tr><td><span class="stop-num">${i + 1}</span></td>
          <td><strong>${s.clientName}</strong></td>
          <td style="font-size:11px">${s.address}</td>
          <td><strong>${s.calculatedArrival}</strong></td>
          <td>${s.calculatedDeparture}</td>
          <td>${s.serviceUnits} (${s.serviceMinutes}m)</td>
          <td>${s.milesFromPrevious} mi</td>
          <td>~${s.driveMinutesFromPrevious}m</td>
          <td><div class="notes-area"></div></td></tr>
        `).join('')}
        <tr style="background:#e8f5e9"><td>🏠</td><td colspan="2"><strong>RETURN: Home</strong></td><td>~${r.summary.estimatedEndTime}</td><td></td><td></td><td>${r.summary.returnMiles} mi</td><td>~${r.summary.returnDriveMinutes}m</td><td></td></tr>
      </tbody>
    </table>
    <div class="footer">
      Generated ${new Date().toLocaleString()} · ${r.summary.routingSource === 'google_routes_api' ? 'Google Routes API (actual road miles)' : 'Estimated distances'} · Mileage rate: $${mileageRate}/mi
    </div>
    <script>window.onload = () => window.print();</script>
    </body></html>`);
    w.document.close();
  };

  // ════════════════════════════════════════════════════════════
  // Daily View
  // ════════════════════════════════════════════════════════════
  const loadDailyView = async () => {
    setDailyLoading(true);
    try {
      const data = await api(`/api/route-optimizer/daily/${dailyDate}`);
      setDailyRoutes(data.routes || []);
    } catch (e) { console.error(e); }
    finally { setDailyLoading(false); }
  };
  useEffect(() => { if (activeTab === 'daily') loadDailyView(); }, [dailyDate]);

  // ════════════════════════════════════════════════════════════
  // Hours Summary
  // ════════════════════════════════════════════════════════════
  const loadHoursSummary = async () => {
    setHoursLoading(true);
    try {
      const data = await api(`/api/route-optimizer/hours-summary?startDate=${hoursStartDate}&endDate=${hoursEndDate}`);
      setHoursData(data);
    } catch (e) { console.error(e); }
    finally { setHoursLoading(false); }
  };
  useEffect(() => { if (activeTab === 'hours') loadHoursSummary(); }, [hoursStartDate, hoursEndDate]);

  // ════════════════════════════════════════════════════════════
  // Saved Routes
  // ════════════════════════════════════════════════════════════
  const loadSavedRoutes = async () => {
    setSavedRoutesLoading(true);
    try {
      const params = new URLSearchParams({ limit: '50' });
      if (savedFilter.status) params.set('status', savedFilter.status);
      if (savedFilter.caregiverId) params.set('caregiverId', savedFilter.caregiverId);
      const data = await api(`/api/route-optimizer/saved-routes?${params}`);
      setSavedRoutes(data.routes || []);
    } catch (e) { console.error(e); }
    finally { setSavedRoutesLoading(false); }
  };
  useEffect(() => { if (activeTab === 'saved') loadSavedRoutes(); }, [savedFilter]);

  const loadSavedPlanIntoPlanner = async (planId) => {
    try {
      const data = await api(`/api/route-optimizer/plans/${planId}/full`);
      setSelectedCaregiver(data.plan.caregiver_id);
      setSelectedDate(data.plan.route_date);
      setRouteStops(data.stops.map(s => ({
        clientId: s.client_id, clientName: s.clientName,
        address: s.address, latitude: s.latitude, longitude: s.longitude,
        serviceUnits: s.service_units || 4,
        weeklyAuthorizedUnits: s.weekly_authorized_units || 0,
        startTime: s.arrival_time?.slice(0, 5) || '', endTime: s.departure_time?.slice(0, 5) || '',
        hasCoords: !!(s.latitude && s.longitude)
      })));
      setOptimizedRoute(null);
      setActiveTab('planner');
      showMsg(`Loaded saved route: ${data.caregiver.name} · ${data.plan.route_date}`);
    } catch (e) {
      showMsg('Failed to load route: ' + e.message, 'error');
    }
  };

  const deleteSavedPlan = async (planId) => {
    if (!window.confirm('Delete this saved route?')) return;
    try {
      await api(`/api/route-optimizer/plans/${planId}`, { method: 'DELETE' });
      showMsg('Route deleted');
      loadSavedRoutes();
    } catch (e) { showMsg('Delete failed', 'error'); }
  };

  // ════════════════════════════════════════════════════════════
  // Geofence
  // ════════════════════════════════════════════════════════════
  const loadGeofenceSettings = async () => {
    setGeofenceLoading(true);
    try { setGeofenceSettings(await api('/api/route-optimizer/geofence')); }
    catch (e) { console.error(e); }
    finally { setGeofenceLoading(false); }
  };

  const saveGeofence = async (data) => {
    try {
      await api('/api/route-optimizer/geofence', { method: 'POST', body: JSON.stringify(data) });
      showMsg('Geofence saved');
      loadGeofenceSettings();
      setEditGeofence(null);
    } catch (e) { showMsg('Save failed', 'error'); }
  };

  const geocodeAll = async (type) => {
    setGeocoding(true);
    try {
      const data = await api('/api/route-optimizer/geocode-all', { method: 'POST', body: JSON.stringify({ entityType: type }) });
      setGeocodeResults(data);
      showMsg(`Geocoded ${data.success} of ${data.total} ${type} (${data.source})`);
      loadData();
    } catch (e) { showMsg('Geocoding failed', 'error'); }
    finally { setGeocoding(false); }
  };

  const geocodeSingle = async (entityType, entityId, address, city, state, zip) => {
    try {
      await api('/api/route-optimizer/geocode', {
        method: 'POST', body: JSON.stringify({ address, city, state, zip, entityType, entityId })
      });
      showMsg('Address geocoded');
      loadData();
    } catch (e) { showMsg(e.message, 'error'); }
  };

  // ════════════════════════════════════════════════════════════
  // Helper components & computed values
  // ════════════════════════════════════════════════════════════
  const totalUnits = routeStops.reduce((sum, s) => sum + s.serviceUnits, 0);
  const totalHours = (totalUnits * 0.25).toFixed(1);
  const cg = caregivers.find(c => c.id === selectedCaregiver);
  const cgHasCoords = cg && cg.latitude && cg.longitude;

  const dayName = (dateStr) => {
    try { return new Date(dateStr + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' }); }
    catch { return dateStr; }
  };

  // ════════════════════════════════════════════════════════════
  // Styles
  // ════════════════════════════════════════════════════════════
  const s = {
    page: { padding: '1.25rem', maxWidth: '1440px', margin: '0 auto', fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif', color: '#1a1a2e' },
    header: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.75rem', marginBottom: '1.25rem' },
    title: { fontSize: '1.4rem', fontWeight: '800', margin: 0 },
    tabs: { display: 'flex', gap: '2px', background: '#f0f0f4', borderRadius: '10px', padding: '3px', marginBottom: '1.25rem', overflowX: 'auto' },
    tab: (active) => ({
      padding: '0.55rem 1rem', borderRadius: '8px', border: 'none', cursor: 'pointer', fontWeight: '600',
      fontSize: '0.82rem', transition: 'all 0.15s', whiteSpace: 'nowrap',
      background: active ? '#fff' : 'transparent', color: active ? '#1a1a2e' : '#888',
      boxShadow: active ? '0 1px 3px rgba(0,0,0,0.1)' : 'none'
    }),
    card: { background: '#fff', borderRadius: '12px', border: '1px solid #e5e5ec', padding: '1.15rem', marginBottom: '0.85rem' },
    cardTitle: { fontSize: '0.95rem', fontWeight: '700', marginBottom: '0.65rem', display: 'flex', alignItems: 'center', gap: '0.5rem' },
    row: { display: 'flex', gap: '0.75rem', flexWrap: 'wrap', marginBottom: '0.65rem' },
    col: (flex = 1) => ({ flex, minWidth: '180px' }),
    label: { display: 'block', fontSize: '0.72rem', fontWeight: '700', color: '#777', marginBottom: '3px', textTransform: 'uppercase', letterSpacing: '0.4px' },
    select: { width: '100%', padding: '0.55rem', border: '1px solid #ddd', borderRadius: '8px', fontSize: '0.88rem', background: '#fff', color: '#333' },
    input: { width: '100%', padding: '0.55rem', border: '1px solid #ddd', borderRadius: '8px', fontSize: '0.88rem', boxSizing: 'border-box' },
    inputSm: { width: '68px', padding: '0.45rem', border: '1px solid #ddd', borderRadius: '6px', fontSize: '0.82rem', textAlign: 'center' },
    btn: (bg = '#2563eb', disabled = false) => ({
      padding: '0.55rem 1.1rem', borderRadius: '8px', border: 'none', cursor: disabled ? 'not-allowed' : 'pointer',
      fontWeight: '700', fontSize: '0.82rem', color: '#fff', background: disabled ? '#ccc' : bg,
      transition: 'all 0.15s', opacity: disabled ? 0.6 : 1
    }),
    btnSm: (bg = '#2563eb') => ({
      padding: '0.3rem 0.65rem', borderRadius: '6px', border: 'none', cursor: 'pointer',
      fontWeight: '700', fontSize: '0.75rem', color: '#fff', background: bg
    }),
    btnGhost: (color = '#2563eb') => ({
      padding: '0.55rem 1.1rem', borderRadius: '8px', border: `2px solid ${color}`, cursor: 'pointer',
      fontWeight: '700', fontSize: '0.82rem', color, background: 'transparent'
    }),
    msg: (type) => ({
      padding: '0.7rem 1rem', borderRadius: '8px', marginBottom: '0.85rem', fontWeight: '600', fontSize: '0.85rem',
      background: type === 'error' ? '#fef2f2' : type === 'warning' ? '#fffbeb' : '#f0fdf4',
      color: type === 'error' ? '#dc2626' : type === 'warning' ? '#92400e' : '#16a34a',
      border: `1px solid ${type === 'error' ? '#fecaca' : type === 'warning' ? '#fde68a' : '#bbf7d0'}`,
      display: 'flex', alignItems: 'center', gap: '0.5rem'
    }),
    badge: (color) => ({
      display: 'inline-flex', alignItems: 'center', padding: '0.15rem 0.55rem', borderRadius: '20px',
      fontSize: '0.7rem', fontWeight: '800', background: color + '15', color, whiteSpace: 'nowrap'
    }),
    stat: (color = '#1a1a2e') => ({
      background: '#fff', borderRadius: '10px', border: '1px solid #e5e5ec', padding: '0.85rem',
      textAlign: 'center', flex: '1 1 140px'
    }),
    statVal: (color) => ({ fontSize: '1.5rem', fontWeight: '800', color, lineHeight: 1.1 }),
    statLbl: { fontSize: '0.68rem', fontWeight: '700', color: '#999', textTransform: 'uppercase', letterSpacing: '0.3px', marginTop: '3px' },
    table: { width: '100%', borderCollapse: 'separate', borderSpacing: 0, fontSize: '0.83rem' },
    th: { padding: '0.6rem', textAlign: 'left', fontWeight: '800', color: '#666', fontSize: '0.7rem', textTransform: 'uppercase', letterSpacing: '0.5px', borderBottom: '2px solid #e5e5ec', background: '#fafafa' },
    td: { padding: '0.6rem', borderBottom: '1px solid #f0f0f4', verticalAlign: 'middle' },
    emptyState: { textAlign: 'center', padding: '2.5rem 1rem', color: '#aaa' },
    grid2: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.85rem' },
    stopCard: { display: 'flex', alignItems: 'center', gap: '0.65rem', padding: '0.65rem 0.75rem', marginBottom: '6px', background: '#fafafa', borderRadius: '10px', border: '1px solid #e8e8ee', cursor: 'grab', transition: 'all 0.1s', userSelect: 'none' }
  };

  // ════════════════════════════════════════════════════════════
  // RENDER: Route Planner Tab
  // ════════════════════════════════════════════════════════════
  const renderPlanner = () => (
    <div>
      {/* Config bar */}
      <div style={s.card}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '0.5rem' }}>
          <div style={s.cardTitle}>⚙️ Route Setup</div>
          {existingSavedPlan && (
            <span style={s.badge('#7c3aed')}>
              Saved plan exists ({existingSavedPlan.status}) · {existingSavedPlan.total_miles} mi
            </span>
          )}
        </div>
        <div style={s.row}>
          <div style={s.col(2)}>
            <label style={s.label}>Caregiver</label>
            <select style={s.select} value={selectedCaregiver} onChange={e => { setSelectedCaregiver(e.target.value); setOptimizedRoute(null); setRouteStops([]); setExistingSavedPlan(null); }}>
              <option value="">— Select Caregiver —</option>
              {caregivers.filter(c => c.is_active !== false).map(c => (
                <option key={c.id} value={c.id}>
                  {c.first_name} {c.last_name} {c.latitude ? '📍' : '⚠️'}
                </option>
              ))}
            </select>
          </div>
          <div style={s.col(1)}>
            <label style={s.label}>Date</label>
            <input type="date" style={s.input} value={selectedDate} onChange={e => { setSelectedDate(e.target.value); setOptimizedRoute(null); }} />
          </div>
          <div style={s.col(0.7)}>
            <label style={s.label}>Start Time</label>
            <input type="time" style={s.input} value={startTime} onChange={e => setStartTime(e.target.value)} />
          </div>
          <div style={s.col(0.6)}>
            <label style={s.label}>Buffer (min)</label>
            <input type="number" min="0" max="30" style={s.input} value={bufferMinutes} onChange={e => setBufferMinutes(parseInt(e.target.value) || 0)} />
          </div>
          <div style={s.col(0.7)}>
            <label style={s.label}>$/Mile</label>
            <input type="number" step="0.01" min="0" style={s.input} value={mileageRate} onChange={e => setMileageRate(parseFloat(e.target.value) || 0)} />
          </div>
        </div>

        {/* Caregiver status messages */}
        {cg && !cg.address && (
          <div style={s.msg('warning')}>
            ⚠️ <strong>{cg.first_name} {cg.last_name}</strong> has no home address on file. Go to <strong>Caregivers → Edit</strong> to add their address first, then geocode it here.
          </div>
        )}
        {cg && cg.address && !cgHasCoords && (
          <div style={s.msg('warning')}>
            ⚠️ <strong>{cg.first_name} {cg.last_name}</strong> has an address but it's not geocoded yet.
            <button style={s.btnSm('#d97706')} onClick={() => geocodeSingle('caregiver', cg.id, cg.address, cg.city, cg.state, cg.zip)}>Geocode Now</button>
          </div>
        )}
        {cg && cgHasCoords && (
          <div style={{ fontSize: '0.8rem', color: '#666', display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
            <span>📍 Home: {[cg.address, cg.city, cg.state, cg.zip].filter(Boolean).join(', ') || 'On file'}</span>
            <button style={s.btn('#2563eb', loadingSchedule)} onClick={loadFromSchedule} disabled={loadingSchedule}>
              {loadingSchedule ? '⏳ Loading...' : '📅 Load from Schedule'}
            </button>
          </div>
        )}
      </div>

      <div style={{ ...s.grid2, gridTemplateColumns: optimizedRoute ? '1fr 1fr' : '1fr' }}>
        {/* ── Left: Client picker + stops ── */}
        <div>
          {/* Client search */}
          <div style={s.card}>
            <div style={s.cardTitle}>➕ Add Clients</div>
            <div style={{ position: 'relative' }}>
              <input type="text" style={s.input} value={clientSearch}
                onChange={e => setClientSearch(e.target.value)}
                placeholder="Search by name or address..."
              />
              {clientSearch.trim() && filteredClients.length > 0 && (
                <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 10, background: '#fff', border: '1px solid #ddd', borderRadius: '0 0 8px 8px', maxHeight: '260px', overflowY: 'auto', boxShadow: '0 4px 12px rgba(0,0,0,0.1)' }}>
                  {filteredClients.map(c => (
                    <div key={c.id} onClick={() => addStopToRoute(c.id)}
                      style={{ padding: '0.55rem 0.75rem', cursor: 'pointer', borderBottom: '1px solid #f5f5f5', transition: 'background 0.1s' }}
                      onMouseOver={e => e.currentTarget.style.background = '#f0f7ff'}
                      onMouseOut={e => e.currentTarget.style.background = '#fff'}>
                      <div style={{ fontWeight: '600', fontSize: '0.88rem' }}>
                        {c.first_name} {c.last_name}
                        {!c.latitude && <span style={s.badge('#dc2626')}>⚠️ No GPS</span>}
                      </div>
                      <div style={{ fontSize: '0.75rem', color: '#888' }}>
                        {[c.address, c.city].filter(Boolean).join(', ') || 'No address'}
                        {c.weekly_authorized_units ? ` · ${c.weekly_authorized_units} units/wk` : ''}
                      </div>
                    </div>
                  ))}
                </div>
              )}
              {clientSearch.trim() && filteredClients.length === 0 && (
                <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 10, background: '#fff', border: '1px solid #ddd', borderRadius: '0 0 8px 8px', padding: '1rem', textAlign: 'center', color: '#999', fontSize: '0.85rem' }}>
                  No matching clients found
                </div>
              )}
            </div>
            {!clientSearch.trim() && (
              <div style={{ fontSize: '0.75rem', color: '#aaa', marginTop: '4px' }}>
                Type a name or address to search · {clients.filter(c => c.is_active !== false).length - routeStops.length} clients available
              </div>
            )}
          </div>

          {/* Stops list */}
          <div style={s.card}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.65rem' }}>
              <div style={s.cardTitle}>🗺️ Stops ({routeStops.length})</div>
              <div style={{ fontSize: '0.78rem', fontWeight: '700', color: '#2563eb' }}>
                {totalUnits} units · {totalHours}h
              </div>
            </div>

            {routeStops.length === 0 ? (
              <div style={s.emptyState}>
                <div style={{ fontSize: '2rem', marginBottom: '0.5rem' }}>📋</div>
                <div style={{ fontWeight: '700', marginBottom: '0.25rem' }}>No stops yet</div>
                <div style={{ fontSize: '0.82rem' }}>Search for clients above, or click <strong>"Load from Schedule"</strong> to auto-fill</div>
              </div>
            ) : (
              <>
                <div style={{ fontSize: '0.72rem', color: '#aaa', marginBottom: '0.5rem' }}>
                  Drag to reorder · Click Optimize for shortest route
                </div>
                {routeStops.map((stop, idx) => (
                  <div key={stop.clientId} style={s.stopCard}
                    draggable onDragStart={() => handleDragStart(idx)}
                    onDragEnter={() => handleDragEnter(idx)}
                    onDragEnd={handleDragEnd} onDragOver={e => e.preventDefault()}>
                    {/* Number */}
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', minWidth: '28px' }}>
                      <div style={{ fontSize: '0.65rem', color: '#ccc', lineHeight: 1 }}>⋮⋮</div>
                      <div style={{ width: '22px', height: '22px', borderRadius: '50%', background: '#2563eb', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.7rem', fontWeight: '800' }}>
                        {idx + 1}
                      </div>
                    </div>
                    {/* Info */}
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontWeight: '700', fontSize: '0.86rem', display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
                        {stop.clientName}
                        {!stop.hasCoords && <span style={s.badge('#dc2626')}>No GPS</span>}
                      </div>
                      <div style={{ fontSize: '0.73rem', color: '#999', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {stop.address || 'No address'}
                      </div>
                    </div>
                    {/* Inputs */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexShrink: 0 }}>
                      <div style={{ textAlign: 'center' }}>
                        <div style={{ fontSize: '0.62rem', color: '#aaa', fontWeight: '700' }}>UNITS</div>
                        <input type="number" min="1" max="96" value={stop.serviceUnits}
                          style={s.inputSm} onClick={e => e.stopPropagation()}
                          onChange={e => updateStop(idx, 'serviceUnits', e.target.value)} />
                      </div>
                      <div style={{ fontSize: '0.72rem', color: '#666', whiteSpace: 'nowrap' }}>
                        {(stop.serviceUnits * 0.25).toFixed(1)}h
                      </div>
                    </div>
                    {/* Remove */}
                    <button onClick={() => removeStop(idx)}
                      style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '1rem', color: '#dc2626', padding: '2px 4px', borderRadius: '4px' }}>✕</button>
                  </div>
                ))}

                {/* Actions */}
                <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.85rem', flexWrap: 'wrap' }}>
                  <button style={s.btn('#2563eb', optimizing)} onClick={optimizeRoute} disabled={optimizing}>
                    {optimizing ? '⏳ Optimizing...' : '🧠 Optimize Route'}
                  </button>
                  {optimizedRoute && (
                    <>
                      <button style={s.btn('#16a34a', saving)} onClick={() => saveRoute('draft')} disabled={saving}>💾 Save Draft</button>
                      <button style={s.btn('#7c3aed', saving)} onClick={() => saveRoute('published')} disabled={saving}>📤 Publish</button>
                      <button style={s.btnGhost('#333')} onClick={printRouteSheet}>🖨️ Print Sheet</button>
                      {optimizedRoute.googleMapsUrl && (
                        <a href={optimizedRoute.googleMapsUrl} target="_blank" rel="noopener noreferrer"
                          style={{ ...s.btnGhost('#ea580c'), textDecoration: 'none', display: 'inline-flex', alignItems: 'center' }}>
                          📱 Open in Google Maps
                        </a>
                      )}
                    </>
                  )}
                  <button style={{ ...s.btnGhost('#dc2626'), marginLeft: 'auto' }}
                    onClick={() => { setRouteStops([]); setOptimizedRoute(null); setPreOptimizeMiles(null); }}>Clear All</button>
                </div>
              </>
            )}
          </div>
        </div>

        {/* ── Right: Optimized results ── */}
        {optimizedRoute && (
          <div>
            {/* Savings banner */}
            {optimizedRoute.summary.milesSaved > 0 && (
              <div style={{ padding: '0.65rem 0.85rem', background: 'linear-gradient(135deg, #f0fdf4, #ecfdf5)', borderRadius: '10px', border: '1px solid #bbf7d0', marginBottom: '0.85rem', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '1.5rem', flexWrap: 'wrap' }}>
                <span style={{ fontSize: '0.85rem', fontWeight: '800', color: '#16a34a' }}>
                  ✅ Optimization saves {optimizedRoute.summary.milesSaved} mi &amp; {optimizedRoute.summary.drivingMinutesSaved} min driving
                </span>
                <span style={{ fontSize: '0.78rem', color: '#15803d' }}>
                  💰 ${(optimizedRoute.summary.milesSaved * mileageRate).toFixed(2)} less in mileage
                </span>
              </div>
            )}
            {optimizedRoute.summary.milesSaved <= 0 && (
              <div style={{ padding: '0.65rem 0.85rem', background: '#f8fafc', borderRadius: '10px', border: '1px solid #e2e8f0', marginBottom: '0.85rem', textAlign: 'center' }}>
                <span style={{ fontSize: '0.85rem', fontWeight: '700', color: '#64748b' }}>
                  📍 Schedule order is already optimal — no changes needed
                </span>
              </div>
            )}

            {/* Stats */}
            <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', marginBottom: '0.85rem' }}>
              {[
                { val: `${optimizedRoute.summary.totalMiles}`, lbl: 'Miles', color: '#2563eb' },
                { val: `${optimizedRoute.summary.totalStops}`, lbl: 'Stops', color: '#7c3aed' },
                { val: `${optimizedRoute.summary.totalServiceHours}h`, lbl: 'Service', color: '#16a34a' },
                { val: `${optimizedRoute.summary.totalDriveMinutes}m`, lbl: 'Driving', color: '#ea580c' },
                { val: `$${optimizedRoute.summary.mileageReimbursement}`, lbl: 'Mileage $', color: '#0891b2' },
              ].map((st, i) => (
                <div key={i} style={s.stat(st.color)}>
                  <div style={s.statVal(st.color)}>{st.val}</div>
                  <div style={s.statLbl}>{st.lbl}</div>
                </div>
              ))}
            </div>

            {/* Current Schedule vs Optimized comparison */}
            {optimizedRoute.preOptimization && optimizedRoute.summary.milesSaved > 0 && (
              <div style={s.card}>
                <div style={s.cardTitle}>📅 Current Schedule Order</div>
                <div style={{ fontSize: '0.78rem', color: '#888', marginBottom: '0.5rem' }}>
                  {optimizedRoute.preOptimization.totalMiles} mi · {optimizedRoute.preOptimization.totalDriveMinutes}m driving · ${optimizedRoute.preOptimization.mileageReimbursement} mileage
                </div>
                {/* Mini stop list */}
                {optimizedRoute.preOptimization.stops.map((stop, idx) => (
                  <div key={stop.clientId} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.35rem 0.5rem', borderBottom: '1px solid #f0f0f0', fontSize: '0.8rem' }}>
                    <div style={{ width: '20px', height: '20px', borderRadius: '50%', background: '#94a3b8', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.65rem', fontWeight: '800', flexShrink: 0 }}>{idx + 1}</div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <span style={{ fontWeight: '600' }}>{stop.clientName}</span>
                    </div>
                    <div style={{ fontSize: '0.72rem', color: '#999', flexShrink: 0 }}>
                      {stop.scheduledStartTime && stop.scheduledEndTime
                        ? <span>{stop.scheduledStartTime} – {stop.scheduledEndTime} <span style={{ color: '#d97706', fontWeight: '600' }}>scheduled</span></span>
                        : <span>{stop.calculatedArrival} – {stop.calculatedDeparture}</span>
                      }
                    </div>
                    {idx < optimizedRoute.preOptimization.stops.length - 1 && (
                      <div style={{ fontSize: '0.68rem', color: '#ccc', flexShrink: 0 }}>
                        → {optimizedRoute.preOptimization.stops[idx + 1]?.milesFromPrevious} mi
                      </div>
                    )}
                  </div>
                ))}
                <div style={{ padding: '0.35rem 0.5rem', fontSize: '0.72rem', color: '#999' }}>
                  🏠 Return: {optimizedRoute.preOptimization.returnMiles} mi · ~{optimizedRoute.preOptimization.returnDriveMinutes}m
                </div>
              </div>
            )}

            {/* Optimized Route detail */}
            <div style={s.card} ref={printRef}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.5rem', marginBottom: '0.75rem' }}>
                <div style={s.cardTitle}>🧠 Optimized Route</div>
                <span style={s.badge(optimizedRoute.summary.routingSource === 'google_routes_api' ? '#16a34a' : '#d97706')}>
                  {optimizedRoute.summary.routingSource === 'google_routes_api' ? '🗺️ Google Road Miles' : '📐 Estimated'}
                </span>
              </div>
              <div style={{ fontSize: '0.78rem', color: '#888', marginBottom: '0.75rem' }}>
                {optimizedRoute.caregiver.name} · {dayName(selectedDate)} · {optimizedRoute.summary.estimatedStartTime} – ~{optimizedRoute.summary.estimatedEndTime}
                {bufferMinutes > 0 && ` · ${bufferMinutes}min buffer between stops`}
              </div>

              {/* Home start */}
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.65rem', padding: '0.55rem 0.65rem', background: '#f0fdf4', borderRadius: '8px', marginBottom: '2px' }}>
                <div style={{ width: '26px', height: '26px', borderRadius: '50%', background: '#16a34a', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.75rem' }}>🏠</div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: '700', fontSize: '0.82rem', color: '#16a34a' }}>Start: Home</div>
                  <div style={{ fontSize: '0.72rem', color: '#666' }}>{optimizedRoute.caregiver.homeAddress}</div>
                </div>
                <div style={{ fontSize: '0.78rem', fontWeight: '700', color: '#16a34a' }}>{optimizedRoute.summary.estimatedStartTime}</div>
              </div>

              {/* Stops */}
              {optimizedRoute.stops.map((stop, idx) => (
                <React.Fragment key={stop.clientId}>
                  <div style={{ display: 'flex', alignItems: 'center', paddingLeft: '12px', height: '28px' }}>
                    <div style={{ width: '2px', height: '100%', background: '#e0e0e0', marginRight: '1.5rem' }} />
                    <span style={{ fontSize: '0.7rem', color: '#bbb' }}>🚗 {stop.milesFromPrevious} mi · ~{stop.driveMinutesFromPrevious} min</span>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.65rem', padding: '0.55rem 0.65rem', background: '#fafafa', borderRadius: '8px', border: '1px solid #eee' }}>
                    <div style={{ width: '26px', height: '26px', borderRadius: '50%', background: '#2563eb', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.7rem', fontWeight: '800' }}>{idx + 1}</div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontWeight: '700', fontSize: '0.84rem' }}>{stop.clientName}</div>
                      <div style={{ fontSize: '0.72rem', color: '#888', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{stop.address}</div>
                    </div>
                    <div style={{ textAlign: 'right', flexShrink: 0 }}>
                      <div style={{ fontWeight: '700', fontSize: '0.8rem', color: '#2563eb' }}>{stop.calculatedArrival} – {stop.calculatedDeparture}</div>
                      <div style={{ fontSize: '0.68rem', color: '#aaa' }}>{stop.serviceUnits}u · {stop.serviceMinutes}min</div>
                      {stop.scheduledStartTime && stop.scheduledStartTime !== stop.calculatedArrival && (
                        <div style={{ fontSize: '0.65rem', color: '#d97706' }}>was {stop.scheduledStartTime} – {stop.scheduledEndTime}</div>
                      )}
                    </div>
                  </div>
                </React.Fragment>
              ))}

              {/* Return home */}
              <div style={{ display: 'flex', alignItems: 'center', paddingLeft: '12px', height: '28px' }}>
                <div style={{ width: '2px', height: '100%', background: '#e0e0e0', marginRight: '1.5rem' }} />
                <span style={{ fontSize: '0.7rem', color: '#bbb' }}>🚗 {optimizedRoute.summary.returnMiles} mi · ~{optimizedRoute.summary.returnDriveMinutes} min return</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.65rem', padding: '0.55rem 0.65rem', background: '#f0fdf4', borderRadius: '8px' }}>
                <div style={{ width: '26px', height: '26px', borderRadius: '50%', background: '#16a34a', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.75rem' }}>🏠</div>
                <div style={{ fontWeight: '700', fontSize: '0.82rem', color: '#16a34a' }}>Return Home</div>
                <div style={{ marginLeft: 'auto', fontWeight: '700', fontSize: '0.8rem', color: '#16a34a' }}>~{optimizedRoute.summary.estimatedEndTime}</div>
              </div>

              {/* Mileage summary */}
              <div style={{ marginTop: '0.75rem', padding: '0.6rem 0.75rem', background: '#f8fafc', borderRadius: '8px', border: '1px solid #e2e8f0', fontSize: '0.78rem', display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: '0.5rem' }}>
                <span>💰 Mileage: {optimizedRoute.summary.totalMiles} mi × ${mileageRate}/mi = <strong>${optimizedRoute.summary.mileageReimbursement}</strong></span>
                {bufferMinutes > 0 && <span>⏱️ Buffer: {optimizedRoute.summary.totalBufferMinutes} min total</span>}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );

  // ════════════════════════════════════════════════════════════
  // RENDER: Daily Overview Tab
  // ════════════════════════════════════════════════════════════
  const renderDaily = () => (
    <div>
      <div style={{ ...s.card, display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
        <div style={s.cardTitle}>📅 Daily Overview</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', marginLeft: 'auto' }}>
          <button style={s.btnSm('#888')} onClick={() => { const d = new Date(dailyDate); d.setDate(d.getDate() - 1); setDailyDate(d.toISOString().split('T')[0]); }}>◀</button>
          <input type="date" style={{ ...s.input, width: 'auto' }} value={dailyDate} onChange={e => setDailyDate(e.target.value)} />
          <button style={s.btnSm('#888')} onClick={() => { const d = new Date(dailyDate); d.setDate(d.getDate() + 1); setDailyDate(d.toISOString().split('T')[0]); }}>▶</button>
        </div>
        <div style={{ fontSize: '0.82rem', color: '#666', fontWeight: '600' }}>{dayName(dailyDate)}</div>
      </div>

      {dailyLoading ? <div style={s.emptyState}>Loading...</div> : dailyRoutes.length === 0 ? (
        <div style={{ ...s.card, ...s.emptyState }}>
          <div style={{ fontSize: '2.5rem', marginBottom: '0.5rem' }}>📭</div>
          <div style={{ fontWeight: '700' }}>No routes for {dayName(dailyDate)}</div>
        </div>
      ) : (
        <>
          <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', marginBottom: '0.85rem' }}>
            {[
              { val: dailyRoutes.length, lbl: 'Caregivers', color: '#2563eb' },
              { val: dailyRoutes.reduce((s, r) => s + r.visits.length, 0), lbl: 'Visits', color: '#7c3aed' },
              { val: `${dailyRoutes.reduce((s, r) => s + r.totalMiles, 0).toFixed(1)}`, lbl: 'Total Miles', color: '#ea580c' },
              { val: `${(dailyRoutes.reduce((s, r) => s + r.totalServiceMinutes, 0) / 60).toFixed(1)}h`, lbl: 'Service', color: '#16a34a' },
              { val: `$${(dailyRoutes.reduce((s, r) => s + r.totalMiles, 0) * mileageRate).toFixed(2)}`, lbl: 'Mileage $', color: '#0891b2' }
            ].map((st, i) => <div key={i} style={s.stat(st.color)}><div style={s.statVal(st.color)}>{st.val}</div><div style={s.statLbl}>{st.lbl}</div></div>)}
          </div>

          {dailyRoutes.map(route => (
            <div key={route.caregiverId} style={s.card}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.5rem', marginBottom: '0.65rem' }}>
                <div>
                  <div style={{ fontWeight: '700', fontSize: '1rem' }}>{route.caregiverName}</div>
                  <div style={{ fontSize: '0.75rem', color: '#888' }}>{route.visits.length} visits · {route.homeAddress || 'No home address'}</div>
                </div>
                <div style={{ display: 'flex', gap: '1rem' }}>
                  {[
                    { v: `${route.totalMiles} mi`, c: '#ea580c' },
                    { v: `${(route.totalServiceMinutes / 60).toFixed(1)}h`, c: '#16a34a' },
                    { v: `~${route.totalDriveMinutes}m`, c: '#2563eb' }
                  ].map((m, i) => <div key={i} style={{ textAlign: 'center' }}><div style={{ fontWeight: '800', fontSize: '1.05rem', color: m.c }}>{m.v}</div></div>)}
                </div>
              </div>
              <div style={{ overflowX: 'auto' }}>
                <table style={s.table}>
                  <thead><tr>
                    <th style={s.th}>#</th><th style={s.th}>Client</th><th style={s.th}>Address</th>
                    <th style={s.th}>Time</th><th style={s.th}>Units</th><th style={s.th}>Miles</th>
                  </tr></thead>
                  <tbody>
                    {route.visits.map((v, idx) => (
                      <tr key={idx}>
                        <td style={s.td}><span style={s.badge('#2563eb')}>{idx + 1}</span></td>
                        <td style={{ ...s.td, fontWeight: '600' }}>{v.clientName}</td>
                        <td style={{ ...s.td, fontSize: '0.78rem', color: '#888', maxWidth: '180px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{v.address || '—'}</td>
                        <td style={s.td}>{v.startTime?.slice(0, 5)} – {v.endTime?.slice(0, 5)}</td>
                        <td style={s.td}>{v.serviceUnits}</td>
                        <td style={{ ...s.td, fontWeight: '700', color: '#ea580c' }}>{v.milesFromPrevious}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ))}
        </>
      )}
    </div>
  );

  // ════════════════════════════════════════════════════════════
  // RENDER: Hours Dashboard Tab
  // ════════════════════════════════════════════════════════════
  const renderHours = () => (
    <div>
      <div style={{ ...s.card, display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
        <div style={s.cardTitle}>⏱️ Hours Dashboard</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', marginLeft: 'auto', flexWrap: 'wrap' }}>
          <input type="date" style={{ ...s.input, width: 'auto' }} value={hoursStartDate} onChange={e => setHoursStartDate(e.target.value)} />
          <span style={{ color: '#aaa', fontSize: '0.82rem' }}>to</span>
          <input type="date" style={{ ...s.input, width: 'auto' }} value={hoursEndDate} onChange={e => setHoursEndDate(e.target.value)} />
          <button style={s.btnSm('#2563eb')} onClick={loadHoursSummary}>↻</button>
        </div>
      </div>

      {hoursLoading ? <div style={s.emptyState}>Loading...</div> : hoursData ? (
        <>
          <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', marginBottom: '0.85rem' }}>
            {[
              { val: hoursData.totals.totalCaregivers, lbl: 'Caregivers', color: '#2563eb' },
              { val: hoursData.totals.totalScheduledHours.toFixed(1), lbl: 'Scheduled', color: '#7c3aed' },
              { val: hoursData.totals.totalClockedHours.toFixed(1), lbl: 'Clocked', color: '#16a34a' },
              { val: hoursData.totals.totalMiles.toFixed(0), lbl: 'Miles', color: '#ea580c' },
              { val: `${hoursData.totals.totalCompletedVisits}/${hoursData.totals.totalScheduledVisits}`, lbl: 'Visits', color: '#0891b2' },
              { val: hoursData.totals.activeCaregivers, lbl: 'Active Now', color: '#16a34a' }
            ].map((st, i) => <div key={i} style={s.stat(st.color)}><div style={s.statVal(st.color)}>{st.val}</div><div style={s.statLbl}>{st.lbl}</div></div>)}
          </div>

          <div style={s.card}>
            <div style={{ overflowX: 'auto' }}>
              <table style={s.table}>
                <thead><tr>
                  <th style={s.th}>Caregiver</th><th style={s.th}>Scheduled</th><th style={s.th}>Clocked</th>
                  <th style={s.th}>Remaining</th><th style={s.th}>OT</th>
                  <th style={{ ...s.th, minWidth: '180px' }}>Utilization</th>
                  <th style={s.th}>Visits</th><th style={s.th}>Miles</th><th style={s.th}>Status</th>
                </tr></thead>
                <tbody>
                  {hoursData.caregivers.map(cg => {
                    const pct = Math.min(cg.utilizationPct, 100);
                    const barColor = pct >= 90 ? '#dc2626' : pct >= 70 ? '#ea580c' : pct >= 40 ? '#2563eb' : '#ccc';
                    return (
                      <tr key={cg.id}>
                        <td style={{ ...s.td, fontWeight: '700' }}>
                          {cg.name}
                          {cg.activeShift && <span style={{ ...s.badge('#16a34a'), marginLeft: '0.4rem' }}>🔴 LIVE</span>}
                        </td>
                        <td style={{ ...s.td, fontWeight: '700' }}>{cg.scheduledHours}h</td>
                        <td style={{ ...s.td, fontWeight: '700', color: '#16a34a' }}>{cg.clockedHours}h</td>
                        <td style={s.td}>{cg.remainingHours}h</td>
                        <td style={{ ...s.td, color: cg.overtimeHours > 0 ? '#dc2626' : '#ccc', fontWeight: cg.overtimeHours > 0 ? '700' : '400' }}>
                          {cg.overtimeHours > 0 ? `${cg.overtimeHours}h ⚠️` : '—'}
                        </td>
                        <td style={s.td}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                            <div style={{ flex: 1, height: '8px', borderRadius: '4px', background: '#eee', overflow: 'hidden' }}>
                              <div style={{ height: '100%', width: `${pct}%`, background: barColor, borderRadius: '4px', transition: 'width 0.3s' }} />
                            </div>
                            <span style={{ fontSize: '0.75rem', fontWeight: '700', color: barColor, minWidth: '32px' }}>{pct}%</span>
                          </div>
                        </td>
                        <td style={s.td}>{cg.completedVisits}/{cg.scheduledVisits}</td>
                        <td style={{ ...s.td, fontWeight: '600', color: '#ea580c' }}>{cg.totalMiles > 0 ? `${cg.totalMiles} mi` : '—'}</td>
                        <td style={s.td}>
                          {cg.activeShift ? (
                            <span style={{ fontSize: '0.75rem', color: '#16a34a' }}>
                              w/ {cg.activeShift.client_name}
                            </span>
                          ) : cg.clockedHours > 0 ? (
                            <span style={s.badge('#2563eb')}>Done</span>
                          ) : (
                            <span style={{ color: '#ccc', fontSize: '0.78rem' }}>—</span>
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

  // ════════════════════════════════════════════════════════════
  // RENDER: Saved Routes Tab
  // ════════════════════════════════════════════════════════════
  const renderSaved = () => (
    <div>
      <div style={{ ...s.card, display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
        <div style={s.cardTitle}>📁 Saved Routes</div>
        <div style={{ display: 'flex', gap: '0.4rem', marginLeft: 'auto', flexWrap: 'wrap' }}>
          <select style={{ ...s.select, width: 'auto' }} value={savedFilter.status} onChange={e => setSavedFilter(p => ({ ...p, status: e.target.value }))}>
            <option value="">All statuses</option>
            <option value="draft">Drafts</option>
            <option value="published">Published</option>
          </select>
          <select style={{ ...s.select, width: 'auto' }} value={savedFilter.caregiverId} onChange={e => setSavedFilter(p => ({ ...p, caregiverId: e.target.value }))}>
            <option value="">All caregivers</option>
            {caregivers.filter(c => c.is_active !== false).map(c => (
              <option key={c.id} value={c.id}>{c.first_name} {c.last_name}</option>
            ))}
          </select>
          <button style={s.btnSm('#2563eb')} onClick={loadSavedRoutes}>↻</button>
        </div>
      </div>

      {savedRoutesLoading ? <div style={s.emptyState}>Loading...</div> : savedRoutes.length === 0 ? (
        <div style={{ ...s.card, ...s.emptyState }}>
          <div style={{ fontSize: '2.5rem', marginBottom: '0.5rem' }}>📁</div>
          <div style={{ fontWeight: '700' }}>No saved routes found</div>
          <div style={{ fontSize: '0.82rem' }}>Routes you save from the Route Planner will appear here</div>
        </div>
      ) : (
        <div style={s.card}>
          <div style={{ overflowX: 'auto' }}>
            <table style={s.table}>
              <thead><tr>
                <th style={s.th}>Date</th><th style={s.th}>Caregiver</th><th style={s.th}>Stops</th>
                <th style={s.th}>Miles</th><th style={s.th}>Service</th><th style={s.th}>Drive</th>
                <th style={s.th}>Status</th><th style={s.th}>Actions</th>
              </tr></thead>
              <tbody>
                {savedRoutes.map(r => (
                  <tr key={r.id}>
                    <td style={{ ...s.td, fontWeight: '600' }}>{r.route_date}</td>
                    <td style={{ ...s.td, fontWeight: '600' }}>{r.caregiverName}</td>
                    <td style={s.td}>{r.stop_count || r.actual_stop_count}</td>
                    <td style={{ ...s.td, fontWeight: '700', color: '#ea580c' }}>{parseFloat(r.total_miles || 0).toFixed(1)} mi</td>
                    <td style={s.td}>{r.total_service_minutes ? `${(r.total_service_minutes / 60).toFixed(1)}h` : '—'}</td>
                    <td style={s.td}>{r.total_drive_minutes ? `${r.total_drive_minutes}m` : '—'}</td>
                    <td style={s.td}>
                      <span style={s.badge(r.status === 'published' ? '#16a34a' : '#d97706')}>
                        {r.status}
                      </span>
                    </td>
                    <td style={s.td}>
                      <div style={{ display: 'flex', gap: '4px' }}>
                        <button style={s.btnSm('#2563eb')} onClick={() => loadSavedPlanIntoPlanner(r.id)}>Load</button>
                        <button style={s.btnSm('#dc2626')} onClick={() => deleteSavedPlan(r.id)}>✕</button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );

  // ════════════════════════════════════════════════════════════
  // RENDER: GPS & Geofence Tab
  // ════════════════════════════════════════════════════════════
  const renderGeofence = () => {
    const clientsWithoutCoords = clients.filter(c => c.is_active !== false && (!c.latitude || !c.longitude));
    const cgWithoutCoords = caregivers.filter(c => c.is_active !== false && (!c.latitude || !c.longitude));
    const cgWithoutAddress = caregivers.filter(c => c.is_active !== false && !c.address);

    return (
      <div>
        {/* Geocoding */}
        <div style={s.card}>
          <div style={s.cardTitle}>🌐 Address Geocoding</div>
          <div style={{ fontSize: '0.82rem', color: '#666', marginBottom: '0.75rem' }}>
            Convert addresses to GPS coordinates. Required for route optimization and geofencing.
          </div>

          {cgWithoutAddress.length > 0 && (
            <div style={s.msg('warning')}>
              🏠 {cgWithoutAddress.length} caregiver(s) have <strong>no home address</strong> on file — add via Caregivers → Edit before geocoding:
              <div style={{ fontSize: '0.78rem', marginTop: '4px' }}>
                {cgWithoutAddress.map(c => c.first_name + ' ' + c.last_name).join(', ')}
              </div>
            </div>
          )}

          {(clientsWithoutCoords.length > 0 || cgWithoutCoords.length > 0) && (
            <div style={s.msg('warning')}>
              ⚠️ {clientsWithoutCoords.length} client(s) and {cgWithoutCoords.length} caregiver(s) need geocoding
            </div>
          )}

          <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', marginBottom: '0.75rem' }}>
            <button style={s.btn('#2563eb', geocoding)} onClick={() => geocodeAll('clients')} disabled={geocoding}>
              {geocoding ? '⏳ Geocoding...' : `📍 Geocode Clients (${clientsWithoutCoords.length} missing)`}
            </button>
            <button style={s.btn('#7c3aed', geocoding)} onClick={() => geocodeAll('caregivers')} disabled={geocoding}>
              {geocoding ? '⏳ Geocoding...' : `📍 Geocode Caregivers (${cgWithoutCoords.length} missing)`}
            </button>
          </div>

          {geocodeResults && (
            <div style={{ fontSize: '0.82rem', padding: '0.6rem', background: '#f8fafc', borderRadius: '8px', border: '1px solid #e2e8f0' }}>
              ✅ {geocodeResults.success} geocoded · ❌ {geocodeResults.failed} failed · Source: {geocodeResults.source}
              {geocodeResults.errors?.length > 0 && (
                <div style={{ marginTop: '0.5rem', color: '#dc2626' }}>
                  {geocodeResults.errors.slice(0, 5).map((e, i) => (
                    <div key={i} style={{ fontSize: '0.75rem' }}>• {e.address}: {e.error}</div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Geofence setup */}
        <div style={s.card}>
          <div style={s.cardTitle}>📍 Geofence Configuration</div>
          <div style={{ fontSize: '0.82rem', color: '#666', marginBottom: '0.75rem' }}>
            Set up automatic clock-in/out when caregivers arrive at or leave client locations.
          </div>

          {!editGeofence ? (
            <div style={s.row}>
              <div style={s.col(2)}>
                <label style={s.label}>Select Client</label>
                <select style={s.select} onChange={e => {
                  if (!e.target.value) return;
                  const cl = clients.find(c => c.id === e.target.value);
                  const existing = geofenceSettings.find(g => g.client_id === e.target.value);
                  setEditGeofence({
                    clientId: e.target.value, clientName: cl ? `${cl.first_name} ${cl.last_name}` : '',
                    radiusFeet: existing?.radius_feet || 300,
                    autoClockIn: existing?.auto_clock_in ?? true,
                    autoClockOut: existing?.auto_clock_out ?? true,
                    requireGps: existing?.require_gps ?? true,
                    notifyAdminOnOverride: existing?.notify_admin_on_override ?? true
                  });
                  e.target.value = '';
                }}>
                  <option value="">— Select client to configure —</option>
                  {clients.filter(c => c.is_active !== false).map(c => (
                    <option key={c.id} value={c.id}>
                      {c.first_name} {c.last_name} {c.latitude ? '📍' : '⚠️'}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          ) : (
            <div style={{ background: '#f8fafc', borderRadius: '10px', padding: '1rem', border: '1px solid #e2e8f0' }}>
              <div style={{ fontWeight: '700', fontSize: '0.9rem', marginBottom: '0.75rem' }}>
                ✏️ {editGeofence.clientName || 'Configure Geofence'}
              </div>
              <div style={s.row}>
                <div style={s.col(1)}>
                  <label style={s.label}>Radius (feet)</label>
                  <input type="number" min="50" max="1000" style={s.input} value={editGeofence.radiusFeet}
                    onChange={e => setEditGeofence(p => ({ ...p, radiusFeet: parseInt(e.target.value) || 300 }))} />
                  <div style={{ fontSize: '0.7rem', color: '#999', marginTop: '2px' }}>200ft = apartment, 300ft = house, 500ft = rural</div>
                </div>
                <div style={s.col(2)}>
                  <label style={s.label}>Options</label>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                    {[
                      { key: 'autoClockIn', label: 'Auto clock-in when entering geofence' },
                      { key: 'autoClockOut', label: 'Auto clock-out when leaving geofence' },
                      { key: 'requireGps', label: 'Require GPS (block clock-in without location)' },
                      { key: 'notifyAdminOnOverride', label: 'Notify admin on manual override' }
                    ].map(opt => (
                      <label key={opt.key} style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', cursor: 'pointer', fontSize: '0.83rem' }}>
                        <input type="checkbox" checked={editGeofence[opt.key]}
                          onChange={e => setEditGeofence(p => ({ ...p, [opt.key]: e.target.checked }))} />
                        {opt.label}
                      </label>
                    ))}
                  </div>
                </div>
              </div>
              <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.75rem' }}>
                <button style={s.btn('#16a34a')} onClick={() => saveGeofence(editGeofence)}>Save</button>
                <button style={s.btnGhost('#888')} onClick={() => setEditGeofence(null)}>Cancel</button>
              </div>
            </div>
          )}
        </div>

        {/* Existing settings table */}
        <div style={s.card}>
          <div style={s.cardTitle}>📋 Geofence Settings ({geofenceSettings.length})</div>
          {geofenceLoading ? <div style={s.emptyState}>Loading...</div> : geofenceSettings.length === 0 ? (
            <div style={s.emptyState}>
              <div style={{ fontSize: '2rem', marginBottom: '0.5rem' }}>📍</div>
              <div style={{ fontWeight: '700' }}>No geofences yet</div>
              <div style={{ fontSize: '0.82rem' }}>Select a client above to set up auto clock-in/out</div>
            </div>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table style={s.table}>
                <thead><tr>
                  <th style={s.th}>Client</th><th style={s.th}>Radius</th>
                  <th style={s.th}>Auto In</th><th style={s.th}>Auto Out</th>
                  <th style={s.th}>GPS Req</th><th style={s.th}>Actions</th>
                </tr></thead>
                <tbody>
                  {geofenceSettings.map(gs => (
                    <tr key={gs.id}>
                      <td style={{ ...s.td, fontWeight: '600' }}>
                        {gs.first_name} {gs.last_name}
                        <div style={{ fontSize: '0.72rem', color: '#999' }}>{[gs.address, gs.city].filter(Boolean).join(', ')}</div>
                      </td>
                      <td style={{ ...s.td, fontWeight: '700' }}>{gs.radius_feet} ft</td>
                      <td style={s.td}>{gs.auto_clock_in ? '✅' : '❌'}</td>
                      <td style={s.td}>{gs.auto_clock_out ? '✅' : '❌'}</td>
                      <td style={s.td}>{gs.require_gps ? '✅' : '❌'}</td>
                      <td style={s.td}>
                        <button style={s.btnSm('#2563eb')} onClick={() => setEditGeofence({
                          clientId: gs.client_id, clientName: `${gs.first_name} ${gs.last_name}`,
                          radiusFeet: gs.radius_feet, autoClockIn: gs.auto_clock_in,
                          autoClockOut: gs.auto_clock_out, requireGps: gs.require_gps,
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

  // ════════════════════════════════════════════════════════════
  // Main Render
  // ════════════════════════════════════════════════════════════
  if (loading) return <div style={{ ...s.page, textAlign: 'center', padding: '3rem', color: '#aaa' }}>Loading route optimizer...</div>;

  return (
    <div style={s.page}>
      {/* Header */}
      <div style={s.header}>
        <h1 style={s.title}>🗺️ Route & Schedule Optimizer</h1>
        {apiStatus && (
          <div style={{
            display: 'flex', alignItems: 'center', gap: '0.4rem', padding: '0.35rem 0.7rem',
            borderRadius: '8px', fontSize: '0.75rem', fontWeight: '700',
            background: apiStatus.googleApiKeyConfigured ? '#f0fdf4' : '#fffbeb',
            color: apiStatus.googleApiKeyConfigured ? '#16a34a' : '#92400e',
            border: `1px solid ${apiStatus.googleApiKeyConfigured ? '#bbf7d0' : '#fde68a'}`
          }}>
            {apiStatus.googleApiKeyConfigured ? '🟢 Google Routes API' : '🟡 Haversine Estimates'}
          </div>
        )}
      </div>

      {/* Message */}
      {message.text && <div style={s.msg(message.type)}>{message.text}</div>}

      {/* Tabs */}
      <div style={s.tabs}>
        {[
          { id: 'planner', icon: '🧭', label: 'Route Planner' },
          { id: 'daily', icon: '📅', label: 'Daily Overview' },
          { id: 'hours', icon: '⏱️', label: 'Hours' },
          { id: 'saved', icon: '📁', label: 'Saved Routes' },
          { id: 'geofence', icon: '📍', label: 'GPS & Geofence' },
        ].map(t => (
          <button key={t.id} style={s.tab(activeTab === t.id)} onClick={() => setActiveTab(t.id)}>
            {t.icon} {t.label}
          </button>
        ))}
      </div>

      {/* Content */}
      {activeTab === 'planner' && renderPlanner()}
      {activeTab === 'daily' && renderDaily()}
      {activeTab === 'hours' && renderHours()}
      {activeTab === 'saved' && renderSaved()}
      {activeTab === 'geofence' && renderGeofence()}
    </div>
  );
};

export default RouteOptimizer;
