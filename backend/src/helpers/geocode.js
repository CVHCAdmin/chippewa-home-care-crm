// helpers/geocode.js — turn a client's address into map coordinates and save them.
//
// The GPS checks (geofence clock-in, time-correction location check, route planning)
// compare a caregiver's phone location to clients.latitude/longitude. Those were only
// filled when someone clicked "geocode" in the route optimizer, so most clients had none.
// Now every client save re-geocodes from the address (fire-and-forget, never blocks the
// save), and audits/backfill_client_geocodes.js fills in existing clients.
//
// Google (when GOOGLE_MAPS_API_KEY is set) → US Census Bureau → OpenStreetMap, house-level
// matches only. Only the street address is sent — never the client's name.
const db = require('../db');

const fullAddress = ({ address, city, state, zip }) =>
  [address, city, state, zip].map(s => String(s || '').trim()).filter(Boolean).join(', ');

// An apartment/unit number sits in the same building — drop it for the lookup
// ("509 N High St APT 208" → "509 N High St"); geocoders often fail on it.
const stripUnit = (addr) => String(addr || '')
  .replace(/\s*,?\s*(?:\b(?:apt|apartment|unit|ste|suite|rm|room|lot)\b\.?|#)\s*[\w-]+/ig, '')
  .replace(/\s{2,}/g, ' ').trim();

// Only house-level matches are returned. A street-only or town-level match can be
// hundreds of feet to miles off, which would make a caregiver at the door look absent.
async function geocodeAddress(addr) {
  if (!addr) return null;
  const q = stripUnit(addr);
  const key = process.env.GOOGLE_MAPS_API_KEY;
  if (key) {
    try {
      const r = await fetch(`https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(q)}&key=${key}&components=country:US`);
      const d = await r.json();
      const hit = d.status === 'OK' && d.results && d.results[0];
      if (hit && ['ROOFTOP', 'RANGE_INTERPOLATED'].includes(hit.geometry.location_type)) {
        const { lat, lng } = hit.geometry.location;
        return { latitude: lat, longitude: lng, source: 'google', matched: hit.formatted_address };
      }
    } catch (e) { console.error('[geocode] google:', e.message); }
  }
  // US Census Bureau geocoder: free, no key, built on the national address ranges —
  // good with rural Wisconsin addresses ("E9084 570th Ave") that OpenStreetMap misses.
  try {
    const r = await fetch(`https://geocoding.geo.census.gov/geocoder/locations/onelineaddress?address=${encodeURIComponent(q)}&benchmark=Public_AR_Current&format=json`);
    const d = await r.json();
    const m = d && d.result && d.result.addressMatches && d.result.addressMatches[0];
    if (m && m.coordinates) {
      return { latitude: Number(m.coordinates.y), longitude: Number(m.coordinates.x), source: 'census', matched: m.matchedAddress };
    }
  } catch (e) { console.error('[geocode] census:', e.message); }
  try {
    const r = await fetch(`https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(q)}&format=json&limit=1&countrycodes=us&addressdetails=1`,
      { headers: { 'User-Agent': 'ChippewaValleyHomeCare/1.0' } });
    const d = await r.json();
    if (Array.isArray(d) && d[0] && d[0].address && d[0].address.house_number) {
      return { latitude: parseFloat(d[0].lat), longitude: parseFloat(d[0].lon), source: 'nominatim', matched: d[0].display_name };
    }
  } catch (e) { console.error('[geocode] nominatim:', e.message); }
  return null;
}

// Geocode one client from its saved address and store the result. Returns the result
// (or null). A client with no usable address is left alone.
async function geocodeClient(clientId, { save = true } = {}) {
  const c = await db.query(`SELECT address, city, state, zip FROM clients WHERE id = $1`, [clientId]);
  if (!c.rows[0]) return null;
  const addr = fullAddress(c.rows[0]);
  if (!c.rows[0].address || !addr) return null;
  const g = await geocodeAddress(addr);
  if (g && save) {
    await db.query(`UPDATE clients SET latitude = $1, longitude = $2 WHERE id = $3`, [g.latitude, g.longitude, clientId]);
  }
  return g ? { ...g, address: addr } : null;
}

// Fire-and-forget after a client save: never slows or fails the save.
function geocodeClientInBackground(clientId) {
  geocodeClient(clientId).catch(e => console.error('[geocode] client', clientId, e.message));
}

// Distance in feet between two lat/lng points (haversine).
function distanceFeet(lat1, lng1, lat2, lng2) {
  const R = 20902231; // earth radius in feet
  const toRad = (d) => (Number(d) * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1), dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return Math.round(2 * R * Math.asin(Math.sqrt(a)));
}

module.exports = { fullAddress, stripUnit, geocodeAddress, geocodeClient, geocodeClientInBackground, distanceFeet };
