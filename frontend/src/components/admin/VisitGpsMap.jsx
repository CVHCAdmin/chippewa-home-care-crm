// VisitGpsMap — Leaflet-based map of a single visit's GPS trail.
//
// Loads Leaflet from CDN at runtime so we don't add an npm dependency.
// Renders: full polyline of GPS pings + start (green) / end (red) markers +
// the client's home location (blue ★) if known. Calculates rough distance
// from the haversine sum and visit duration. "Open in Google Maps" link
// for a one-click satellite view.

import React, { useEffect, useRef, useState } from 'react';
import { API_BASE_URL } from '../../config';

const LEAFLET_CSS = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';
const LEAFLET_JS  = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js';

let leafletLoadPromise = null;
const ensureLeaflet = () => {
  if (window.L) return Promise.resolve(window.L);
  if (leafletLoadPromise) return leafletLoadPromise;
  leafletLoadPromise = new Promise((resolve, reject) => {
    if (!document.querySelector(`link[href="${LEAFLET_CSS}"]`)) {
      const link = document.createElement('link');
      link.rel = 'stylesheet'; link.href = LEAFLET_CSS;
      document.head.appendChild(link);
    }
    const script = document.createElement('script');
    script.src = LEAFLET_JS; script.async = true;
    script.onload = () => resolve(window.L);
    script.onerror = () => reject(new Error('Failed to load Leaflet'));
    document.head.appendChild(script);
  });
  return leafletLoadPromise;
};

const haversineMi = (a, b) => {
  const R = 3958.8; // miles
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(s), Math.sqrt(1 - s));
};

export default function VisitGpsMap({ token, timeEntryId, clientLat, clientLng, clientName }) {
  const mapDivRef = useRef(null);
  const mapRef = useRef(null);
  const [points, setPoints] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!timeEntryId) return;
    let cancelled = false;
    (async () => {
      try {
        const r = await fetch(`${API_BASE_URL}/api/time-entries/${timeEntryId}/gps`, { headers: { Authorization: `Bearer ${token}` } });
        if (!r.ok) throw new Error('Failed to load GPS trail');
        const data = await r.json();
        if (cancelled) return;
        setPoints(data || []);
      } catch (e) { if (!cancelled) setError(e.message); }
      finally { if (!cancelled) setLoading(false); }
    })();
    return () => { cancelled = true; };
  }, [timeEntryId, token]);

  useEffect(() => {
    if (loading || error) return;
    let mapInstance = null;
    let cancelled = false;
    (async () => {
      try {
        const L = await ensureLeaflet();
        if (cancelled || !mapDivRef.current) return;
        // Tear down any prior map mounted in this element
        if (mapRef.current) { mapRef.current.remove(); mapRef.current = null; }

        const trail = points
          .filter(p => p.latitude != null && p.longitude != null)
          .map(p => ({ lat: parseFloat(p.latitude), lng: parseFloat(p.longitude), t: p.timestamp }));

        const home = (clientLat != null && clientLng != null)
          ? { lat: parseFloat(clientLat), lng: parseFloat(clientLng) }
          : null;

        // If we have no trail and no home, give up
        if (trail.length === 0 && !home) {
          mapDivRef.current.innerHTML = '<div style="padding: 20px; color: #9CA3AF; text-align: center;">No GPS data recorded for this visit.</div>';
          return;
        }

        const center = trail[0] || home;
        mapInstance = L.map(mapDivRef.current).setView([center.lat, center.lng], 15);
        mapRef.current = mapInstance;

        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
          maxZoom: 19,
          attribution: '© OpenStreetMap',
        }).addTo(mapInstance);

        if (home) {
          L.marker([home.lat, home.lng], {
            title: `${clientName || 'Client'} home`,
            icon: L.divIcon({
              className: 'visit-gps-home-marker',
              html: '<div style="background:#2563EB;color:#fff;border-radius:50%;width:28px;height:28px;display:flex;align-items:center;justify-content:center;font-weight:700;border:2px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,0.3);">★</div>',
              iconSize: [28, 28], iconAnchor: [14, 14],
            }),
          }).addTo(mapInstance).bindPopup(`<strong>${clientName || 'Client'}</strong><br/>Home location`);
        }

        if (trail.length > 0) {
          // Trail polyline
          const latlngs = trail.map(p => [p.lat, p.lng]);
          L.polyline(latlngs, { color: '#0F766E', weight: 4, opacity: 0.85 }).addTo(mapInstance);

          // Start + end
          L.marker(latlngs[0], {
            title: 'Clock in',
            icon: L.divIcon({
              className: 'visit-gps-start-marker',
              html: '<div style="background:#10B981;color:#fff;border-radius:50%;width:24px;height:24px;display:flex;align-items:center;justify-content:center;font-weight:700;border:2px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,0.3);">▶</div>',
              iconSize: [24, 24], iconAnchor: [12, 12],
            }),
          }).addTo(mapInstance).bindPopup(`<strong>Clock-in</strong><br/>${new Date(trail[0].t).toLocaleString()}`);
          if (trail.length > 1) {
            const last = trail[trail.length - 1];
            L.marker([last.lat, last.lng], {
              title: 'Clock out',
              icon: L.divIcon({
                className: 'visit-gps-end-marker',
                html: '<div style="background:#DC2626;color:#fff;border-radius:50%;width:24px;height:24px;display:flex;align-items:center;justify-content:center;font-weight:700;border:2px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,0.3);">■</div>',
                iconSize: [24, 24], iconAnchor: [12, 12],
              }),
            }).addTo(mapInstance).bindPopup(`<strong>Last GPS ping</strong><br/>${new Date(last.t).toLocaleString()}`);
          }

          // Fit bounds to include trail + home if any
          const all = home ? [...latlngs, [home.lat, home.lng]] : latlngs;
          mapInstance.fitBounds(all, { padding: [32, 32] });
        } else {
          // Only home — just zoom there
          mapInstance.setView([home.lat, home.lng], 16);
        }
      } catch (e) {
        if (!cancelled) setError(e.message);
      }
    })();

    return () => {
      cancelled = true;
      if (mapInstance) { try { mapInstance.remove(); } catch {} }
      mapRef.current = null;
    };
  }, [loading, error, points, clientLat, clientLng, clientName]);

  // Stats — distance + duration + point count
  const trail = points.filter(p => p.latitude != null && p.longitude != null);
  let distMi = 0;
  if (trail.length > 1) {
    for (let i = 1; i < trail.length; i++) {
      distMi += haversineMi(
        { lat: parseFloat(trail[i - 1].latitude), lng: parseFloat(trail[i - 1].longitude) },
        { lat: parseFloat(trail[i].latitude),     lng: parseFloat(trail[i].longitude) },
      );
    }
  }
  const startT = trail[0]?.timestamp;
  const endT   = trail[trail.length - 1]?.timestamp;
  const durMin = (startT && endT) ? Math.round((new Date(endT) - new Date(startT)) / 60000) : null;

  return (
    <div>
      <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', marginBottom: 8, fontSize: '0.85rem' }}>
        <span><strong>{trail.length}</strong> GPS pings</span>
        {durMin != null && <span><strong>{durMin}</strong> min of tracking</span>}
        {distMi > 0 && <span><strong>{distMi.toFixed(2)}</strong> mi traveled (caregiver position drift)</span>}
        {trail.length > 0 && (
          <a target="_blank" rel="noopener noreferrer"
             href={`https://www.google.com/maps/dir/${trail.map(p => `${p.latitude},${p.longitude}`).join('/')}`}
             style={{ marginLeft: 'auto', color: '#2563EB' }}>
            Open in Google Maps ↗
          </a>
        )}
      </div>
      {loading ? (
        <div style={{ padding: 24, textAlign: 'center', color: '#6B7280' }}>Loading GPS trail…</div>
      ) : error ? (
        <div style={{ padding: 16, background: '#FEE2E2', color: '#991B1B', borderRadius: 6 }}>Error: {error}</div>
      ) : (
        <div ref={mapDivRef} style={{ width: '100%', height: 400, borderRadius: 8, border: '1px solid #E5E7EB', background: '#F3F4F6' }} />
      )}
    </div>
  );
}
