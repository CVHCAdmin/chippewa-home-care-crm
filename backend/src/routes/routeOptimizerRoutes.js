// routes/routeOptimizerRoutes.js
// Route Optimization, Mileage Tracking, Hours Dashboard, GPS Geofence
// Uses Google Routes API for real driving distances + Google Geocoding API
const express = require('express');
const router = express.Router();
const db = require('../db');
const { v4: uuidv4 } = require('uuid');
const jwt = require('jsonwebtoken');

const GOOGLE_API_KEY = process.env.GOOGLE_MAPS_API_KEY;

// ============================================================
// Auth Middleware
// ============================================================
const verifyToken = (req, res, next) => {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'No token provided' });
  try {
    req.user = jwt.verify(token, process.env.JWT_SECRET || 'your-secret-key-change-in-production');
    next();
  } catch (error) {
    return res.status(401).json({ error: 'Invalid token' });
  }
};

const requireAdmin = (req, res, next) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admin access required' });
  next();
};

// ============================================================
// Google API Helpers
// ============================================================

// Google Routes API: Get driving distance + duration between two points
// Returns { distanceMiles, durationMinutes } or null on failure
const googleRoute = async (originLat, originLng, destLat, destLng) => {
  if (!GOOGLE_API_KEY) return null;
  try {
    const res = await fetch('https://routes.googleapis.com/directions/v2:computeRoutes', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': GOOGLE_API_KEY,
        'X-Goog-FieldMask': 'routes.distanceMeters,routes.duration'
      },
      body: JSON.stringify({
        origin: { location: { latLng: { latitude: originLat, longitude: originLng } } },
        destination: { location: { latLng: { latitude: destLat, longitude: destLng } } },
        travelMode: 'DRIVE',
        routingPreference: 'TRAFFIC_UNAWARE', // Essentials tier = $5/1k requests
        units: 'IMPERIAL'
      })
    });
    const data = await res.json();
    if (data.routes && data.routes.length > 0) {
      const route = data.routes[0];
      const meters = route.distanceMeters || 0;
      const seconds = parseInt(route.duration?.replace('s', '')) || 0;
      return {
        distanceMiles: Math.round((meters / 1609.344) * 100) / 100,
        durationMinutes: Math.round(seconds / 60)
      };
    }
    return null;
  } catch (e) {
    console.error('Google Routes API error:', e.message);
    return null;
  }
};

// Google Routes API: Compute Route Matrix (multiple origins x destinations in 1 call)
// Returns a map of "originIdx-destIdx" -> { distanceMiles, durationMinutes }
const googleRouteMatrix = async (origins, destinations) => {
  if (!GOOGLE_API_KEY) return null;
  try {
    const res = await fetch('https://routes.googleapis.com/distanceMatrix/v2:computeRouteMatrix', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': GOOGLE_API_KEY,
        'X-Goog-FieldMask': 'originIndex,destinationIndex,distanceMeters,duration,status'
      },
      body: JSON.stringify({
        origins: origins.map(o => ({
          waypoint: { location: { latLng: { latitude: o.latitude, longitude: o.longitude } } }
        })),
        destinations: destinations.map(d => ({
          waypoint: { location: { latLng: { latitude: d.latitude, longitude: d.longitude } } }
        })),
        travelMode: 'DRIVE',
        routingPreference: 'TRAFFIC_UNAWARE'
      })
    });
    const data = await res.json();
    const matrix = {};
    if (Array.isArray(data)) {
      for (const entry of data) {
        if (entry.status && entry.status.code && entry.status.code !== 0) continue;
        const key = `${entry.originIndex}-${entry.destinationIndex}`;
        const meters = entry.distanceMeters || 0;
        const seconds = parseInt(entry.duration?.replace('s', '')) || 0;
        matrix[key] = {
          distanceMiles: Math.round((meters / 1609.344) * 100) / 100,
          durationMinutes: Math.round(seconds / 60)
        };
      }
    }
    return Object.keys(matrix).length > 0 ? matrix : null;
  } catch (e) {
    console.error('Google Route Matrix API error:', e.message);
    return null;
  }
};

// Google Geocoding API: Convert address to lat/lng
const googleGeocode = async (address) => {
  if (!GOOGLE_API_KEY) return null;
  try {
    const encoded = encodeURIComponent(address);
    const res = await fetch(
      `https://maps.googleapis.com/maps/api/geocode/json?address=${encoded}&key=${GOOGLE_API_KEY}&components=country:US`
    );
    const data = await res.json();
    if (data.status === 'OK' && data.results?.length > 0) {
      const { lat, lng } = data.results[0].geometry.location;
      return {
        latitude: lat,
        longitude: lng,
        formattedAddress: data.results[0].formatted_address,
        placeId: data.results[0].place_id
      };
    }
    return null;
  } catch (e) {
    console.error('Google Geocoding error:', e.message);
    return null;
  }
};

// ============================================================
// Fallback Helpers (when Google API key not configured)
// ============================================================

// Haversine distance in miles (straight-line fallback)
const haversine = (lat1, lon1, lat2, lon2) => {
  if (!lat1 || !lon1 || !lat2 || !lon2) return null;
  const R = 3959;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
};

const estimateDriveMinutes = (miles) => {
  if (!miles) return 0;
  return Math.round(miles * 2); // ~30mph fallback
};

// Distance in feet between two coordinates
const distanceFeet = (lat1, lon1, lat2, lon2) => {
  const miles = haversine(lat1, lon1, lat2, lon2);
  return miles ? miles * 5280 : null;
};

// Nearest-neighbor TSP with a distance matrix
const solveRouteWithMatrix = (startIdx, distMatrix, nodeCount) => {
  const visited = new Set([startIdx]);
  const order = [];
  let current = startIdx;

  while (order.length < nodeCount - 1) {
    let nearestIdx = -1;
    let nearestDist = Infinity;

    for (let i = 1; i < nodeCount; i++) {
      if (visited.has(i)) continue;
      const key = `${current}-${i}`;
      const dist = distMatrix[key]?.distanceMiles ?? Infinity;
      if (dist < nearestDist) {
        nearestDist = dist;
        nearestIdx = i;
      }
    }

    if (nearestIdx === -1) break;
    visited.add(nearestIdx);
    
    const key = `${current}-${nearestIdx}`;
    const segment = distMatrix[key] || { distanceMiles: 0, durationMinutes: 0 };
    
    order.push({
      stopIndex: nearestIdx - 1,
      milesFromPrevious: segment.distanceMiles,
      driveMinutesFromPrevious: segment.durationMinutes
    });

    current = nearestIdx;
  }

  return order;
};

// 2-opt improvement using distance matrix
const improve2OptMatrix = (order, distMatrix) => {
  if (order.length < 3) return order;
  let improved = true;
  let route = [...order];

  while (improved) {
    improved = false;
    for (let i = 0; i < route.length - 1; i++) {
      for (let j = i + 2; j < route.length; j++) {
        const prevI = i === 0 ? 0 : route[i - 1].stopIndex + 1;
        const iIdx = route[i].stopIndex + 1;
        const jMinusIdx = route[j - 1].stopIndex + 1;
        const jIdx = route[j].stopIndex + 1;

        const currentDist =
          (distMatrix[`${prevI}-${iIdx}`]?.distanceMiles || Infinity) +
          (distMatrix[`${jMinusIdx}-${jIdx}`]?.distanceMiles || Infinity);

        const newDist =
          (distMatrix[`${prevI}-${jMinusIdx}`]?.distanceMiles || Infinity) +
          (distMatrix[`${iIdx}-${jIdx}`]?.distanceMiles || Infinity);

        if (newDist < currentDist) {
          const reversed = route.slice(i, j).reverse();
          route = [...route.slice(0, i), ...reversed, ...route.slice(j)];
          improved = true;
        }
      }
    }
  }
  return route;
};

// Audit log helper
const auditLog = async (userId, action, tableName, recordId, oldData, newData) => {
  try {
    await db.query(
      `INSERT INTO audit_logs (user_id, action, table_name, record_id, old_data, new_data, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, NOW())`,
      [userId, action, tableName, recordId, JSON.stringify(oldData), JSON.stringify(newData)]
    );
  } catch (e) { /* silent */ }
};

// Time helpers
function timeToMinutes(timeStr) {
  if (!timeStr) return 480;
  const [h, m] = timeStr.split(':').map(Number);
  return h * 60 + (m || 0);
}
function minutesToTime(minutes) {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${String(h).padStart(2, '0')}:${String(Math.round(m)).padStart(2, '0')}`;
}

// ============================================================
// ROUTE 1: Optimize a route (Google Routes API for real road miles)
// POST /api/route-optimizer/optimize
// ============================================================
router.post('/optimize', verifyToken, requireAdmin, async (req, res) => {
  try {
    const { caregiverId, date, stops } = req.body;
    const bufferMinutes = parseInt(req.body.bufferMinutes) || 0;
    const mileageRate = parseFloat(req.body.mileageRate) || 0.67; // IRS 2024 rate
    
    if (!caregiverId || !date || !stops?.length) {
      return res.status(400).json({ error: 'caregiverId, date, and stops[] required' });
    }

    // Get caregiver home location
    const cgResult = await db.query(
      `SELECT id, first_name, last_name, latitude, longitude, address, city, state, zip
       FROM users WHERE id = $1 AND role = 'caregiver'`,
      [caregiverId]
    );
    if (!cgResult.rows.length) return res.status(404).json({ error: 'Caregiver not found' });
    const caregiver = cgResult.rows[0];

    if (!caregiver.latitude || !caregiver.longitude) {
      return res.status(400).json({ 
        error: 'Caregiver has no home address geocoded. Please update their address first.',
        field: 'caregiver_address'
      });
    }

    // Get client details for all stops
    const clientIds = stops.map(s => s.clientId);
    const clientsResult = await db.query(
      `SELECT id, first_name, last_name, latitude, longitude, address, city, state, zip, weekly_authorized_units
       FROM clients WHERE id = ANY($1)`,
      [clientIds]
    );
    const clientMap = {};
    clientsResult.rows.forEach(c => { clientMap[c.id] = c; });

    // Build stop list
    const stopList = stops.map(s => {
      const client = clientMap[s.clientId];
      if (!client) return null;
      return {
        clientId: client.id,
        clientName: `${client.first_name} ${client.last_name}`,
        latitude: parseFloat(client.latitude),
        longitude: parseFloat(client.longitude),
        address: [client.address, client.city, client.state, client.zip].filter(Boolean).join(', '),
        serviceUnits: s.serviceUnits || 0,
        serviceMinutes: (s.serviceUnits || 0) * 15,
        requestedStartTime: s.startTime || null,
        requestedEndTime: s.endTime || null,
        weeklyAuthorizedUnits: client.weekly_authorized_units || 0
      };
    }).filter(Boolean);

    // Check for missing coordinates
    const missingCoords = stopList.filter(s => !s.latitude || !s.longitude);
    if (missingCoords.length > 0) {
      return res.status(400).json({ 
        error: 'Some clients are missing geocoded addresses',
        missingClients: missingCoords.map(s => ({ clientId: s.clientId, name: s.clientName }))
      });
    }

    // Build all nodes: index 0 = caregiver home, 1..N = stops
    const allNodes = [
      { latitude: parseFloat(caregiver.latitude), longitude: parseFloat(caregiver.longitude) },
      ...stopList.map(s => ({ latitude: s.latitude, longitude: s.longitude }))
    ];

    // Build distance matrix
    let distMatrix = {};
    let usingGoogle = false;

    // Try Google Route Matrix (1 API call for all pairs, billed per element)
    if (GOOGLE_API_KEY && allNodes.length <= 26) {
      console.log(`[RouteOptimizer] Calling Google Route Matrix: ${allNodes.length} nodes = ${allNodes.length * allNodes.length} elements`);
      const googleMatrix = await googleRouteMatrix(allNodes, allNodes);
      if (googleMatrix) {
        distMatrix = googleMatrix;
        usingGoogle = true;
        console.log(`[RouteOptimizer] Google Matrix returned ${Object.keys(googleMatrix).length} entries`);
      } else {
        console.log('[RouteOptimizer] Google Matrix failed, falling back to Haversine');
      }
    }

    // Haversine fallback
    if (!usingGoogle) {
      console.log(`[RouteOptimizer] Using Haversine fallback for ${allNodes.length} nodes`);
      for (let i = 0; i < allNodes.length; i++) {
        for (let j = 0; j < allNodes.length; j++) {
          if (i === j) continue;
          const miles = haversine(allNodes[i].latitude, allNodes[i].longitude,
                                  allNodes[j].latitude, allNodes[j].longitude) || 0;
          distMatrix[`${i}-${j}`] = {
            distanceMiles: Math.round(miles * 100) / 100,
            durationMinutes: estimateDriveMinutes(miles)
          };
        }
      }
    }

    // Solve TSP
    const rawOrder = solveRouteWithMatrix(0, distMatrix, allNodes.length);
    const improvedOrder = improve2OptMatrix(rawOrder, distMatrix);
    
    // Recalculate totals with improved order
    let totalMiles = 0;
    let totalDriveMinutes = 0;
    let prevIdx = 0;
    const recalculated = improvedOrder.map(item => {
      const matrixIdx = item.stopIndex + 1;
      const key = `${prevIdx}-${matrixIdx}`;
      const segment = distMatrix[key] || { distanceMiles: 0, durationMinutes: 0 };
      totalMiles += segment.distanceMiles;
      totalDriveMinutes += segment.durationMinutes;
      prevIdx = matrixIdx;
      return { ...item, milesFromPrevious: segment.distanceMiles, driveMinutesFromPrevious: segment.durationMinutes };
    });
    
    // Return home
    const returnKey = `${prevIdx}-0`;
    const returnSegment = distMatrix[returnKey] || { distanceMiles: 0, durationMinutes: 0 };
    totalMiles += returnSegment.distanceMiles;
    totalDriveMinutes += returnSegment.durationMinutes;

    // Build final stops with scheduled times
    let totalServiceMinutes = 0;
    let runningTime = req.body.startTime || '08:00';

    const finalStops = recalculated.map((item, idx) => {
      const stop = stopList[item.stopIndex];
      totalServiceMinutes += stop.serviceMinutes;

      const arrivalMinutes = timeToMinutes(runningTime) + item.driveMinutesFromPrevious + (idx > 0 ? bufferMinutes : 0);
      const arrivalTime = minutesToTime(arrivalMinutes);
      const departureMinutes = arrivalMinutes + stop.serviceMinutes;
      const departureTime = minutesToTime(departureMinutes);
      runningTime = departureTime;

      return {
        ...stop,
        stopOrder: idx + 1,
        milesFromPrevious: item.milesFromPrevious,
        driveMinutesFromPrevious: item.driveMinutesFromPrevious,
        calculatedArrival: stop.requestedStartTime || arrivalTime,
        calculatedDeparture: stop.requestedEndTime || departureTime,
      };
    });

    // Build Google Maps URL for the route
    const gmapsParts = ['https://www.google.com/maps/dir'];
    gmapsParts.push(`${caregiver.latitude},${caregiver.longitude}`);
    finalStops.forEach(s => gmapsParts.push(`${s.latitude},${s.longitude}`));
    gmapsParts.push(`${caregiver.latitude},${caregiver.longitude}`);

    res.json({
      caregiver: {
        id: caregiver.id,
        name: `${caregiver.first_name} ${caregiver.last_name}`,
        homeAddress: [caregiver.address, caregiver.city, caregiver.state, caregiver.zip].filter(Boolean).join(', '),
        latitude: parseFloat(caregiver.latitude),
        longitude: parseFloat(caregiver.longitude)
      },
      date,
      stops: finalStops,
      googleMapsUrl: gmapsParts.join('/'),
      summary: {
        totalStops: finalStops.length,
        totalMiles: Math.round(totalMiles * 100) / 100,
        totalDriveMinutes,
        totalServiceMinutes,
        totalServiceHours: Math.round(totalServiceMinutes / 60 * 100) / 100,
        totalBufferMinutes: bufferMinutes * Math.max(0, finalStops.length - 1),
        returnMiles: Math.round(returnSegment.distanceMiles * 100) / 100,
        returnDriveMinutes: returnSegment.durationMinutes,
        estimatedStartTime: finalStops[0]?.calculatedArrival || '08:00',
        estimatedEndTime: minutesToTime(
          timeToMinutes(finalStops[finalStops.length - 1]?.calculatedDeparture || '08:00') +
          returnSegment.durationMinutes
        ),
        mileageReimbursement: Math.round(totalMiles * mileageRate * 100) / 100,
        mileageRate,
        routingSource: usingGoogle ? 'google_routes_api' : 'haversine_estimate',
        googleApiUsed: usingGoogle
      }
    });
  } catch (error) {
    console.error('Route optimization error:', error);
    res.status(500).json({ error: error.message });
  }
});

// ============================================================
// ROUTE 2: Save a route plan
// POST /api/route-optimizer/save-route
// ============================================================
router.post('/save-route', verifyToken, requireAdmin, async (req, res) => {
  try {
    const { caregiverId, date, stops, totalMiles, totalDriveMinutes, totalServiceMinutes, notes, status } = req.body;
    const planId = uuidv4();

    await db.query(`DELETE FROM route_plans WHERE caregiver_id = $1 AND route_date = $2`, [caregiverId, date]);

    const planResult = await db.query(
      `INSERT INTO route_plans (id, caregiver_id, route_date, total_miles, total_drive_minutes, 
       total_service_minutes, stop_count, status, notes, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING *`,
      [planId, caregiverId, date, totalMiles, totalDriveMinutes, totalServiceMinutes, 
       stops.length, status || 'draft', notes || null, req.user.id]
    );

    for (const stop of stops) {
      await db.query(
        `INSERT INTO route_plan_stops (id, route_plan_id, stop_order, client_id, arrival_time, departure_time,
         service_units, miles_from_previous, drive_minutes_from_previous, latitude, longitude, address, notes)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
        [uuidv4(), planId, stop.stopOrder, stop.clientId, stop.calculatedArrival, stop.calculatedDeparture,
         stop.serviceUnits, stop.milesFromPrevious, stop.driveMinutesFromPrevious,
         stop.latitude, stop.longitude, stop.address, stop.notes || null]
      );
    }

    await auditLog(req.user.id, 'CREATE', 'route_plans', planId, null, planResult.rows[0]);
    res.status(201).json({ id: planId, ...planResult.rows[0] });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ============================================================
// ROUTE 3: Get saved route plans
// GET /api/route-optimizer/plans?date=YYYY-MM-DD&caregiverId=uuid
// ============================================================
router.get('/plans', verifyToken, async (req, res) => {
  try {
    const { date, caregiverId } = req.query;
    let query = `
      SELECT rp.*, 
             u.first_name as caregiver_first_name, u.last_name as caregiver_last_name,
             u.latitude as cg_lat, u.longitude as cg_lng, u.address as cg_address,
             u.city as cg_city, u.state as cg_state, u.zip as cg_zip
      FROM route_plans rp
      JOIN users u ON rp.caregiver_id = u.id
      WHERE 1=1
    `;
    const params = [];
    if (date) { params.push(date); query += ` AND rp.route_date = $${params.length}`; }
    if (caregiverId) { params.push(caregiverId); query += ` AND rp.caregiver_id = $${params.length}`; }
    query += ' ORDER BY rp.route_date DESC, u.first_name';
    
    const plans = await db.query(query, params);
    const results = [];
    for (const plan of plans.rows) {
      const planStops = await db.query(
        `SELECT rps.*, c.first_name as client_first_name, c.last_name as client_last_name,
                c.phone as client_phone, c.weekly_authorized_units
         FROM route_plan_stops rps
         JOIN clients c ON rps.client_id = c.id
         WHERE rps.route_plan_id = $1
         ORDER BY rps.stop_order`,
        [plan.id]
      );
      results.push({ ...plan, stops: planStops.rows });
    }
    res.json(results);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ============================================================
// ROUTE 4: Delete a route plan
// ============================================================
router.delete('/plans/:id', verifyToken, requireAdmin, async (req, res) => {
  try {
    const result = await db.query('DELETE FROM route_plans WHERE id = $1 RETURNING *', [req.params.id]);
    if (!result.rows.length) return res.status(404).json({ error: 'Route plan not found' });
    await auditLog(req.user.id, 'DELETE', 'route_plans', req.params.id, result.rows[0], null);
    res.json({ message: 'Route plan deleted' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ============================================================
// ROUTE 5: Hours Summary Dashboard
// GET /api/route-optimizer/hours-summary?startDate=&endDate=
// ============================================================
router.get('/hours-summary', verifyToken, async (req, res) => {
  try {
    const { startDate, endDate } = req.query;
    const now = new Date();
    const weekStart = startDate || (() => {
      const d = new Date(now); d.setDate(d.getDate() - d.getDay());
      return d.toISOString().split('T')[0];
    })();
    const weekEnd = endDate || (() => {
      const d = new Date(now); d.setDate(d.getDate() + (6 - d.getDay()));
      return d.toISOString().split('T')[0];
    })();

    const result = await db.query(`
      SELECT 
        u.id, u.first_name, u.last_name, u.phone,
        COALESCE(ca.max_hours_per_week, 40) as max_hours_per_week,
        COALESCE((
          SELECT SUM(EXTRACT(EPOCH FROM (s.end_time::time - s.start_time::time)) / 3600)
          FROM schedules s WHERE s.caregiver_id = u.id AND s.is_active = true
            AND (s.date >= $1 AND s.date <= $2)
        ), 0) as scheduled_hours,
        COALESCE((
          SELECT SUM(COALESCE(s.service_units, 0))
          FROM schedules s WHERE s.caregiver_id = u.id AND s.is_active = true
            AND (s.date >= $1 AND s.date <= $2)
        ), 0) as scheduled_units,
        COALESCE((
          SELECT SUM(te.duration_minutes) / 60.0
          FROM time_entries te WHERE te.caregiver_id = u.id AND te.is_complete = true
            AND te.start_time >= ($1 || ' 00:00:00')::timestamptz
            AND te.start_time <= ($2 || ' 23:59:59')::timestamptz
        ), 0) as clocked_hours,
        (
          SELECT json_build_object('id', te.id, 'client_id', te.client_id, 'start_time', te.start_time,
            'client_name', c.first_name || ' ' || c.last_name)
          FROM time_entries te LEFT JOIN clients c ON te.client_id = c.id
          WHERE te.caregiver_id = u.id AND te.is_complete = false AND te.end_time IS NULL
          ORDER BY te.start_time DESC LIMIT 1
        ) as active_shift,
        COALESCE((
          SELECT SUM(rp.total_miles) FROM route_plans rp
          WHERE rp.caregiver_id = u.id AND rp.route_date >= $1 AND rp.route_date <= $2
        ), 0) as total_miles,
        COALESCE((
          SELECT COUNT(*) FROM schedules s
          WHERE s.caregiver_id = u.id AND s.is_active = true AND (s.date >= $1 AND s.date <= $2)
        ), 0) as scheduled_visits,
        COALESCE((
          SELECT COUNT(*) FROM time_entries te
          WHERE te.caregiver_id = u.id AND te.is_complete = true
            AND te.start_time >= ($1 || ' 00:00:00')::timestamptz
            AND te.start_time <= ($2 || ' 23:59:59')::timestamptz
        ), 0) as completed_visits
      FROM users u
      LEFT JOIN caregiver_availability ca ON u.id = ca.caregiver_id
      WHERE u.role = 'caregiver' AND u.is_active = true
      ORDER BY u.first_name, u.last_name
    `, [weekStart, weekEnd]);

    const caregivers = result.rows.map(cg => {
      const scheduled = parseFloat(cg.scheduled_hours) || 0;
      const clocked = parseFloat(cg.clocked_hours) || 0;
      const maxHours = parseFloat(cg.max_hours_per_week) || 40;
      return {
        id: cg.id, name: `${cg.first_name} ${cg.last_name}`, phone: cg.phone,
        maxHoursPerWeek: maxHours,
        scheduledHours: Math.round(scheduled * 100) / 100,
        clockedHours: Math.round(clocked * 100) / 100,
        remainingHours: Math.round(Math.max(0, maxHours - scheduled) * 100) / 100,
        overtimeHours: Math.round(Math.max(0, clocked - 40) * 100) / 100,
        scheduledUnits: parseInt(cg.scheduled_units) || 0,
        scheduledVisits: parseInt(cg.scheduled_visits) || 0,
        completedVisits: parseInt(cg.completed_visits) || 0,
        totalMiles: Math.round(parseFloat(cg.total_miles || 0) * 100) / 100,
        activeShift: cg.active_shift,
        utilizationPct: maxHours > 0 ? Math.round((scheduled / maxHours) * 100) : 0,
        clockedVsScheduledPct: scheduled > 0 ? Math.round((clocked / scheduled) * 100) : 0
      };
    });

    const totals = {
      totalCaregivers: caregivers.length,
      totalScheduledHours: caregivers.reduce((s, c) => s + c.scheduledHours, 0),
      totalClockedHours: caregivers.reduce((s, c) => s + c.clockedHours, 0),
      totalMiles: caregivers.reduce((s, c) => s + c.totalMiles, 0),
      totalScheduledVisits: caregivers.reduce((s, c) => s + c.scheduledVisits, 0),
      totalCompletedVisits: caregivers.reduce((s, c) => s + c.completedVisits, 0),
      activeCaregivers: caregivers.filter(c => c.activeShift).length
    };

    res.json({ startDate: weekStart, endDate: weekEnd, caregivers, totals });
  } catch (error) {
    console.error('Hours summary error:', error);
    res.status(500).json({ error: error.message });
  }
});

// ============================================================
// ROUTE 6: Daily route view (all caregivers for a date)
// GET /api/route-optimizer/daily/:date
// ============================================================
router.get('/daily/:date', verifyToken, async (req, res) => {
  try {
    const { date } = req.params;
    const dayOfWeek = new Date(date + 'T12:00:00').getDay();

    const schedulesResult = await db.query(`
      SELECT s.*, 
             u.first_name as cg_first, u.last_name as cg_last, 
             u.latitude as cg_lat, u.longitude as cg_lng,
             u.address as cg_address, u.city as cg_city, u.state as cg_state, u.zip as cg_zip,
             c.first_name as cl_first, c.last_name as cl_last,
             c.latitude as cl_lat, c.longitude as cl_lng,
             c.address as cl_address, c.city as cl_city, c.state as cl_state, c.zip as cl_zip,
             c.weekly_authorized_units
      FROM schedules s
      JOIN users u ON s.caregiver_id = u.id
      JOIN clients c ON s.client_id = c.id
      WHERE s.is_active = true AND (s.date = $1 OR s.day_of_week = $2)
      ORDER BY u.first_name, s.start_time
    `, [date, dayOfWeek]);

    // Group by caregiver
    const caregiverMap = {};
    for (const row of schedulesResult.rows) {
      if (!caregiverMap[row.caregiver_id]) {
        caregiverMap[row.caregiver_id] = {
          caregiverId: row.caregiver_id,
          caregiverName: `${row.cg_first} ${row.cg_last}`,
          homeLatitude: parseFloat(row.cg_lat),
          homeLongitude: parseFloat(row.cg_lng),
          homeAddress: [row.cg_address, row.cg_city, row.cg_state, row.cg_zip].filter(Boolean).join(', '),
          visits: []
        };
      }
      const serviceMinutes = (new Date(`2000-01-01T${row.end_time}`) - new Date(`2000-01-01T${row.start_time}`)) / 60000;
      caregiverMap[row.caregiver_id].visits.push({
        scheduleId: row.id, clientId: row.client_id,
        clientName: `${row.cl_first} ${row.cl_last}`,
        latitude: parseFloat(row.cl_lat), longitude: parseFloat(row.cl_lng),
        address: [row.cl_address, row.cl_city, row.cl_state, row.cl_zip].filter(Boolean).join(', '),
        startTime: row.start_time, endTime: row.end_time,
        serviceUnits: row.service_units || Math.round(serviceMinutes / 15),
        serviceMinutes, weeklyAuthorizedUnits: row.weekly_authorized_units
      });
    }

    // Calculate route metrics using Google or Haversine
    const routes = [];
    for (const cg of Object.values(caregiverMap)) {
      let totalMiles = 0;
      let totalDriveMinutes = 0;
      let prevLat = cg.homeLatitude;
      let prevLng = cg.homeLongitude;

      const visitsWithDistance = [];
      for (const v of cg.visits) {
        let miles, driveMin;
        if (GOOGLE_API_KEY && prevLat && prevLng && v.latitude && v.longitude) {
          const gResult = await googleRoute(prevLat, prevLng, v.latitude, v.longitude);
          if (gResult) { miles = gResult.distanceMiles; driveMin = gResult.durationMinutes; }
        }
        if (miles === undefined) {
          miles = haversine(prevLat, prevLng, v.latitude, v.longitude) || 0;
          driveMin = estimateDriveMinutes(miles);
        }
        totalMiles += miles;
        totalDriveMinutes += driveMin;
        visitsWithDistance.push({ ...v, milesFromPrevious: Math.round(miles * 100) / 100, driveMinutesFromPrevious: driveMin });
        prevLat = v.latitude; prevLng = v.longitude;
      }

      // Return trip
      if (visitsWithDistance.length > 0) {
        const last = visitsWithDistance[visitsWithDistance.length - 1];
        let rm, rd;
        if (GOOGLE_API_KEY && last.latitude && last.longitude && cg.homeLatitude && cg.homeLongitude) {
          const gr = await googleRoute(last.latitude, last.longitude, cg.homeLatitude, cg.homeLongitude);
          if (gr) { rm = gr.distanceMiles; rd = gr.durationMinutes; }
        }
        if (rm === undefined) {
          rm = haversine(last.latitude, last.longitude, cg.homeLatitude, cg.homeLongitude) || 0;
          rd = estimateDriveMinutes(rm);
        }
        totalMiles += rm; totalDriveMinutes += rd;
      }

      routes.push({
        ...cg, visits: visitsWithDistance,
        totalMiles: Math.round(totalMiles * 100) / 100,
        totalServiceMinutes: cg.visits.reduce((s, v) => s + v.serviceMinutes, 0),
        totalDriveMinutes
      });
    }

    res.json({ date, routes, routingSource: GOOGLE_API_KEY ? 'google_routes_api' : 'haversine_estimate' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ============================================================
// ROUTE 7: Geofence settings
// ============================================================
router.get('/geofence', verifyToken, async (req, res) => {
  try {
    const result = await db.query(`
      SELECT gs.*, c.first_name, c.last_name, c.address, c.city, c.state, c.zip, c.latitude, c.longitude
      FROM geofence_settings gs JOIN clients c ON gs.client_id = c.id
      WHERE c.is_active = true ORDER BY c.first_name
    `);
    res.json(result.rows);
  } catch (error) { res.status(500).json({ error: error.message }); }
});

router.post('/geofence', verifyToken, requireAdmin, async (req, res) => {
  try {
    const { clientId, radiusFeet, autoClockIn, autoClockOut, requireGps, notifyAdminOnOverride } = req.body;
    const result = await db.query(`
      INSERT INTO geofence_settings (id, client_id, radius_feet, auto_clock_in, auto_clock_out, require_gps, notify_admin_on_override)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      ON CONFLICT (client_id) DO UPDATE SET
        radius_feet = $3, auto_clock_in = $4, auto_clock_out = $5, 
        require_gps = $6, notify_admin_on_override = $7, updated_at = NOW()
      RETURNING *
    `, [uuidv4(), clientId, radiusFeet || 300, autoClockIn !== false, autoClockOut !== false,
        requireGps !== false, notifyAdminOnOverride !== false]);
    res.json(result.rows[0]);
  } catch (error) { res.status(500).json({ error: error.message }); }
});

router.post('/geofence/check', verifyToken, async (req, res) => {
  try {
    const { clientId, latitude, longitude } = req.body;
    const client = await db.query(
      `SELECT c.latitude, c.longitude, c.first_name, c.last_name,
              COALESCE(gs.radius_feet, 300) as radius_feet,
              COALESCE(gs.auto_clock_in, true) as auto_clock_in,
              COALESCE(gs.auto_clock_out, true) as auto_clock_out
       FROM clients c LEFT JOIN geofence_settings gs ON c.id = gs.client_id WHERE c.id = $1`, [clientId]
    );
    if (!client.rows.length) return res.status(404).json({ error: 'Client not found' });
    const cl = client.rows[0];
    if (!cl.latitude || !cl.longitude) return res.json({ withinGeofence: false, error: 'Client has no geocoded address' });
    const feet = distanceFeet(latitude, longitude, parseFloat(cl.latitude), parseFloat(cl.longitude));
    const withinGeofence = feet !== null && feet <= cl.radius_feet;
    res.json({
      withinGeofence, distanceFeet: feet ? Math.round(feet) : null, radiusFeet: cl.radius_feet,
      autoClockIn: cl.auto_clock_in, autoClockOut: cl.auto_clock_out,
      clientName: `${cl.first_name} ${cl.last_name}`
    });
  } catch (error) { res.status(500).json({ error: error.message }); }
});

// ============================================================
// ROUTE 8: Geocode (Google -> Nominatim fallback)
// POST /api/route-optimizer/geocode
// ============================================================
router.post('/geocode', verifyToken, async (req, res) => {
  try {
    const { address, city, state, zip, entityType, entityId } = req.body;
    const fullAddress = [address, city, state, zip].filter(Boolean).join(', ');
    if (!fullAddress) return res.status(400).json({ error: 'Address required' });

    // Try Google first
    let result = await googleGeocode(fullAddress);
    let source = 'google';

    // Fallback to Nominatim
    if (!result) {
      source = 'nominatim';
      try {
        const encoded = encodeURIComponent(fullAddress);
        const response = await fetch(
          `https://nominatim.openstreetmap.org/search?q=${encoded}&format=json&limit=1&countrycodes=us`,
          { headers: { 'User-Agent': 'ChippewaValleyHomeCare/1.0' } }
        );
        const data = await response.json();
        if (data.length) {
          result = { latitude: parseFloat(data[0].lat), longitude: parseFloat(data[0].lon), formattedAddress: data[0].display_name };
        }
      } catch (e) { /* fallback failed */ }
    }

    if (!result) return res.status(404).json({ error: 'Address not found', address: fullAddress });

    if (entityType && entityId) {
      const table = entityType === 'client' ? 'clients' : 'users';
      await db.query(`UPDATE ${table} SET latitude = $1, longitude = $2, updated_at = NOW() WHERE id = $3`,
        [result.latitude, result.longitude, entityId]);
    }

    res.json({ latitude: result.latitude, longitude: result.longitude, formattedAddress: result.formattedAddress, searchedAddress: fullAddress, source });
  } catch (error) { res.status(500).json({ error: error.message }); }
});

// ============================================================
// ROUTE 9: Bulk geocode
// POST /api/route-optimizer/geocode-all
// ============================================================
router.post('/geocode-all', verifyToken, requireAdmin, async (req, res) => {
  try {
    const { entityType } = req.body;
    const table = entityType === 'caregivers' ? 'users' : 'clients';
    const whereClause = entityType === 'caregivers' ? `role = 'caregiver' AND is_active = true` : `is_active = true`;

    const result = await db.query(
      `SELECT id, address, city, state, zip FROM ${table} 
       WHERE (latitude IS NULL OR longitude IS NULL) AND address IS NOT NULL AND ${whereClause}`
    );

    const results = { success: 0, failed: 0, errors: [], source: GOOGLE_API_KEY ? 'google' : 'nominatim' };
    
    for (const row of result.rows) {
      const fullAddress = [row.address, row.city, row.state, row.zip].filter(Boolean).join(', ');
      try {
        let geo = GOOGLE_API_KEY ? await googleGeocode(fullAddress) : null;

        if (!geo) {
          await new Promise(r => setTimeout(r, 1100)); // Nominatim rate limit
          const encoded = encodeURIComponent(fullAddress);
          const response = await fetch(
            `https://nominatim.openstreetmap.org/search?q=${encoded}&format=json&limit=1&countrycodes=us`,
            { headers: { 'User-Agent': 'ChippewaValleyHomeCare/1.0' } }
          );
          const data = await response.json();
          if (data.length) geo = { latitude: parseFloat(data[0].lat), longitude: parseFloat(data[0].lon) };
        }
        
        if (geo) {
          await db.query(`UPDATE ${table} SET latitude = $1, longitude = $2, updated_at = NOW() WHERE id = $3`,
            [geo.latitude, geo.longitude, row.id]);
          results.success++;
        } else {
          results.failed++;
          results.errors.push({ id: row.id, address: fullAddress, error: 'Not found' });
        }
      } catch (e) {
        results.failed++;
        results.errors.push({ id: row.id, address: fullAddress, error: e.message });
      }
    }

    res.json({ total: result.rows.length, ...results });
  } catch (error) { res.status(500).json({ error: error.message }); }
});

// ============================================================
// ROUTE 10: Update stop status (live route tracking)
// ============================================================
router.put('/stops/:stopId/status', verifyToken, async (req, res) => {
  try {
    const { status } = req.body;
    const validStatuses = ['pending', 'en_route', 'arrived', 'in_progress', 'completed', 'skipped'];
    if (!validStatuses.includes(status)) {
      return res.status(400).json({ error: `Invalid status. Must be one of: ${validStatuses.join(', ')}` });
    }
    const updates = [`status = $1`];
    const params = [status, req.params.stopId];
    if (status === 'arrived') updates.push(`actual_arrival = NOW()`);
    else if (status === 'completed') updates.push(`actual_departure = NOW()`);

    const result = await db.query(
      `UPDATE route_plan_stops SET ${updates.join(', ')} WHERE id = $${params.length} RETURNING *`, params
    );
    if (!result.rows.length) return res.status(404).json({ error: 'Stop not found' });
    res.json(result.rows[0]);
  } catch (error) { res.status(500).json({ error: error.message }); }
});

// ============================================================
// ROUTE 11: Config status check
// GET /api/route-optimizer/config-status
// ============================================================
router.get('/config-status', verifyToken, requireAdmin, async (req, res) => {
  const status = {
    googleApiKeyConfigured: !!GOOGLE_API_KEY,
    googleApiKeyPrefix: GOOGLE_API_KEY ? GOOGLE_API_KEY.substring(0, 10) + '...' : null,
    routingSource: GOOGLE_API_KEY ? 'Google Routes API (real road miles + drive times)' : 'Haversine (straight-line estimate)',
    geocodingSource: GOOGLE_API_KEY ? 'Google Geocoding API' : 'Nominatim (OpenStreetMap)',
    enabledApis: GOOGLE_API_KEY ? ['Routes API', 'Geocoding API'] : ['Nominatim (free)']
  };

  if (GOOGLE_API_KEY) {
    try {
      const testResult = await googleGeocode('1600 Pennsylvania Ave NW, Washington, DC 20500');
      status.googleApiKeyValid = !!testResult;
      status.testResult = testResult ? 'API key working — Geocoding OK' : 'API key may be invalid or APIs not enabled';
    } catch (e) {
      status.googleApiKeyValid = false;
      status.testResult = e.message;
    }
  }

  res.json(status);
});

// ============================================================
// ROUTE 12: Load existing schedule into route planner
// GET /api/route-optimizer/load-schedule/:caregiverId/:date
// ============================================================
router.get('/load-schedule/:caregiverId/:date', verifyToken, async (req, res) => {
  try {
    const { caregiverId, date } = req.params;
    const dayOfWeek = new Date(date + 'T12:00:00').getDay();

    const result = await db.query(`
      SELECT s.id, s.client_id, s.start_time, s.end_time, s.service_units,
             c.first_name, c.last_name, c.latitude, c.longitude,
             c.address, c.city, c.state, c.zip, c.weekly_authorized_units
      FROM schedules s
      JOIN clients c ON s.client_id = c.id
      WHERE s.caregiver_id = $1 AND s.is_active = true 
        AND (s.date = $2 OR s.day_of_week = $3)
      ORDER BY s.start_time
    `, [caregiverId, date, dayOfWeek]);

    const stops = result.rows.map(r => {
      const serviceMinutes = (new Date(`2000-01-01T${r.end_time}`) - new Date(`2000-01-01T${r.start_time}`)) / 60000;
      return {
        clientId: r.client_id,
        clientName: `${r.first_name} ${r.last_name}`,
        address: [r.address, r.city, r.state, r.zip].filter(Boolean).join(', '),
        latitude: r.latitude ? parseFloat(r.latitude) : null,
        longitude: r.longitude ? parseFloat(r.longitude) : null,
        serviceUnits: r.service_units || Math.round(serviceMinutes / 15),
        weeklyAuthorizedUnits: r.weekly_authorized_units || 0,
        startTime: r.start_time?.slice(0, 5) || '',
        endTime: r.end_time?.slice(0, 5) || '',
        hasCoords: !!(r.latitude && r.longitude),
        scheduleId: r.id
      };
    });

    // Also check if a saved route plan exists for this caregiver+date
    const savedPlan = await db.query(
      `SELECT id, status, total_miles, total_drive_minutes, total_service_minutes, 
              stop_count, created_at, notes
       FROM route_plans WHERE caregiver_id = $1 AND route_date = $2
       ORDER BY created_at DESC LIMIT 1`,
      [caregiverId, date]
    );

    res.json({
      stops,
      scheduledVisits: stops.length,
      savedPlan: savedPlan.rows[0] || null
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ============================================================
// ROUTE 13: Build Google Maps directions URL
// POST /api/route-optimizer/google-maps-url
// ============================================================
router.post('/google-maps-url', verifyToken, async (req, res) => {
  try {
    const { origin, destination, waypoints } = req.body;
    // Build a Google Maps directions URL that opens in browser/app
    // Format: https://www.google.com/maps/dir/origin/wp1/wp2/.../destination
    const parts = ['https://www.google.com/maps/dir'];
    
    // Add origin
    if (origin.latitude && origin.longitude) {
      parts.push(`${origin.latitude},${origin.longitude}`);
    } else if (origin.address) {
      parts.push(encodeURIComponent(origin.address));
    }
    
    // Add waypoints
    if (waypoints) {
      for (const wp of waypoints) {
        if (wp.latitude && wp.longitude) {
          parts.push(`${wp.latitude},${wp.longitude}`);
        } else if (wp.address) {
          parts.push(encodeURIComponent(wp.address));
        }
      }
    }
    
    // Add destination (back to origin for round trip)
    if (destination) {
      if (destination.latitude && destination.longitude) {
        parts.push(`${destination.latitude},${destination.longitude}`);
      } else if (destination.address) {
        parts.push(encodeURIComponent(destination.address));
      }
    }

    res.json({ url: parts.join('/') });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ============================================================
// ROUTE 14: Load a saved route plan with stops
// GET /api/route-optimizer/plans/:id/full
// ============================================================
router.get('/plans/:id/full', verifyToken, async (req, res) => {
  try {
    const plan = await db.query(`
      SELECT rp.*, 
             u.first_name as cg_first, u.last_name as cg_last,
             u.latitude as cg_lat, u.longitude as cg_lng,
             u.address as cg_address, u.city as cg_city, u.state as cg_state, u.zip as cg_zip
      FROM route_plans rp
      JOIN users u ON rp.caregiver_id = u.id
      WHERE rp.id = $1
    `, [req.params.id]);
    
    if (!plan.rows.length) return res.status(404).json({ error: 'Route plan not found' });
    
    const stops = await db.query(`
      SELECT rps.*, c.first_name, c.last_name, c.phone, c.weekly_authorized_units
      FROM route_plan_stops rps
      JOIN clients c ON rps.client_id = c.id
      WHERE rps.route_plan_id = $1
      ORDER BY rps.stop_order
    `, [req.params.id]);

    const p = plan.rows[0];
    res.json({
      plan: p,
      caregiver: {
        id: p.caregiver_id,
        name: `${p.cg_first} ${p.cg_last}`,
        homeAddress: [p.cg_address, p.cg_city, p.cg_state, p.cg_zip].filter(Boolean).join(', '),
        latitude: parseFloat(p.cg_lat),
        longitude: parseFloat(p.cg_lng)
      },
      stops: stops.rows.map(s => ({
        ...s,
        clientName: `${s.first_name} ${s.last_name}`,
        latitude: parseFloat(s.latitude),
        longitude: parseFloat(s.longitude)
      }))
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ============================================================
// ROUTE 15: Get all saved route plans (browse/manage)
// GET /api/route-optimizer/saved-routes?limit=20&offset=0&status=published
// ============================================================
router.get('/saved-routes', verifyToken, async (req, res) => {
  try {
    const { limit = 20, offset = 0, status, caregiverId, startDate, endDate } = req.query;
    let query = `
      SELECT rp.*, 
             u.first_name as cg_first, u.last_name as cg_last,
             (SELECT COUNT(*) FROM route_plan_stops rps WHERE rps.route_plan_id = rp.id) as actual_stop_count
      FROM route_plans rp
      JOIN users u ON rp.caregiver_id = u.id
      WHERE 1=1
    `;
    const params = [];
    if (status) { params.push(status); query += ` AND rp.status = $${params.length}`; }
    if (caregiverId) { params.push(caregiverId); query += ` AND rp.caregiver_id = $${params.length}`; }
    if (startDate) { params.push(startDate); query += ` AND rp.route_date >= $${params.length}`; }
    if (endDate) { params.push(endDate); query += ` AND rp.route_date <= $${params.length}`; }
    
    // Get total count
    const countResult = await db.query(`SELECT COUNT(*) FROM (${query}) sub`, params);
    const total = parseInt(countResult.rows[0].count);
    
    params.push(parseInt(limit));
    query += ` ORDER BY rp.route_date DESC, u.first_name LIMIT $${params.length}`;
    params.push(parseInt(offset));
    query += ` OFFSET $${params.length}`;

    const result = await db.query(query, params);
    
    res.json({
      routes: result.rows.map(r => ({
        ...r,
        caregiverName: `${r.cg_first} ${r.cg_last}`
      })),
      total,
      limit: parseInt(limit),
      offset: parseInt(offset)
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
