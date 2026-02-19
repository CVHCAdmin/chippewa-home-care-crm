// routes/sandataRoutes.js
// Sandata Alt-EVV API integration
// Credentials set via env vars: SANDATA_USERNAME, SANDATA_PASSWORD, SANDATA_ACCOUNT_ID
// API docs: Wisconsin DHS Alt-EVV Technical Specification
// Contact: (833) 931-2035 / VDXC.ContactEVV@wisconsin.gov

const express = require('express');
const router = express.Router();
const db = require('../db');
const auth = require('../middleware/auth');
const requireAdmin = require('../middleware/authorizeAdmin');
const { v4: uuidv4 } = require('uuid');

// ─── API CLIENT ───────────────────────────────────────────────────────────────
function getSandataConfig() {
  return {
    baseUrl: process.env.SANDATA_API_URL || 'https://openevv.sandata.com/api/v1',
    username: process.env.SANDATA_USERNAME,
    password: process.env.SANDATA_PASSWORD,
    accountId: process.env.SANDATA_ACCOUNT_ID,
    isConfigured: !!(process.env.SANDATA_USERNAME && process.env.SANDATA_PASSWORD && process.env.SANDATA_ACCOUNT_ID)
  };
}

async function sandataRequest(method, endpoint, body = null) {
  const cfg = getSandataConfig();
  if (!cfg.isConfigured) {
    throw new Error('Sandata credentials not configured. Set SANDATA_USERNAME, SANDATA_PASSWORD, SANDATA_ACCOUNT_ID in environment variables.');
  }

  const credentials = Buffer.from(`${cfg.username}:${cfg.password}`).toString('base64');
  const options = {
    method,
    headers: {
      'Authorization': `Basic ${credentials}`,
      'Account': cfg.accountId,
      'Content-Type': 'application/json',
      'Accept': 'application/json'
    }
  };
  if (body) options.body = JSON.stringify(body);

  const response = await fetch(`${cfg.baseUrl}${endpoint}`, options);
  const data = await response.json();
  return { ok: response.ok, status: response.status, data };
}

// ─── CALCULATE UNITS ─────────────────────────────────────────────────────────
function calcUnits(startTime, endTime, unitType) {
  if (!endTime) return 0;
  const mins = (new Date(endTime) - new Date(startTime)) / 60000;
  if (unitType === '15min') return Math.round(mins / 15 * 100) / 100;
  if (unitType === 'hour') return Math.round(mins / 60 * 100) / 100;
  if (unitType === 'visit') return 1;
  return Math.round(mins / 15 * 100) / 100; // default 15min
}

// ─── AUTO-CREATE EVV VISIT FROM TIME ENTRY ───────────────────────────────────
// Called automatically when a shift clocks out
async function createEVVFromTimeEntry(timeEntryId) {
  try {
    // Get full time entry with client and caregiver details
    const te = await db.query(`
      SELECT te.*, 
        c.medicaid_id, c.evv_client_id, c.first_name as client_first, c.last_name as client_last,
        c.referral_source_id as client_payer_id,
        u.first_name as cg_first, u.last_name as cg_last,
        cp.evv_worker_id, cp.npi_number, cp.taxonomy_code,
        ct.default_service_code, ct.default_modifier, ct.requires_evv,
        rs.payer_type
      FROM time_entries te
      JOIN clients c ON te.client_id = c.id
      JOIN users u ON te.caregiver_id = u.id
      LEFT JOIN caregiver_profiles cp ON cp.caregiver_id = u.id
      LEFT JOIN care_types ct ON te.care_type_id = ct.id
      LEFT JOIN referral_sources rs ON c.referral_source_id = rs.id
      WHERE te.id = $1
    `, [timeEntryId]);

    if (!te.rows.length) return null;
    const entry = te.rows[0];

    // Find active authorization for this client/service
    const auth = await db.query(`
      SELECT * FROM authorizations
      WHERE client_id = $1
        AND status = 'active'
        AND start_date <= $2::date
        AND end_date >= $2::date
        AND (procedure_code = $3 OR procedure_code IS NULL)
      ORDER BY end_date ASC
      LIMIT 1
    `, [entry.client_id, entry.start_time, entry.default_service_code]);

    const authorization = auth.rows[0] || null;

    // Parse GPS locations
    const gpsIn = entry.clock_in_location || {};
    const gpsOut = entry.clock_out_location || {};

    // Calculate units
    const serviceCode = entry.default_service_code || 'T1019';
    const unitType = authorization?.unit_type || '15min';
    const units = calcUnits(entry.start_time, entry.end_time, unitType);

    // Determine issues
    const issues = [];
    if (!entry.medicaid_id) issues.push({ code: 'NO_MEDICAID_ID', msg: 'Client has no Medicaid ID on file' });
    if (!entry.evv_worker_id && !entry.npi_number) issues.push({ code: 'NO_WORKER_ID', msg: 'Caregiver has no EVV Worker ID or NPI' });
    if (!authorization) issues.push({ code: 'NO_AUTH', msg: 'No active authorization found for this service/date' });
    if (!gpsIn.latitude && !gpsIn.lat) issues.push({ code: 'NO_GPS_IN', msg: 'No GPS on clock-in' });
    if (!gpsOut.latitude && !gpsOut.lat) issues.push({ code: 'NO_GPS_OUT', msg: 'No GPS on clock-out' });

    // Upsert EVV visit record
    const result = await db.query(`
      INSERT INTO evv_visits (
        id, time_entry_id, client_id, caregiver_id, authorization_id,
        service_code, modifier, service_date, actual_start, actual_end,
        units_of_service,
        gps_in_lat, gps_in_lng, gps_out_lat, gps_out_lng,
        sandata_status, evv_method, is_verified, verification_issues
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,
        $16,'gps',$17,$18)
      ON CONFLICT (time_entry_id) DO UPDATE SET
        actual_end = EXCLUDED.actual_end,
        units_of_service = EXCLUDED.units_of_service,
        gps_out_lat = EXCLUDED.gps_out_lat,
        gps_out_lng = EXCLUDED.gps_out_lng,
        verification_issues = EXCLUDED.verification_issues,
        is_verified = EXCLUDED.is_verified,
        updated_at = NOW()
      RETURNING *
    `, [
      uuidv4(), timeEntryId, entry.client_id, entry.caregiver_id,
      authorization?.id || null,
      serviceCode, entry.default_modifier || null,
      new Date(entry.start_time).toISOString().split('T')[0],
      entry.start_time, entry.end_time,
      units,
      gpsIn.latitude || gpsIn.lat || null,
      gpsIn.longitude || gpsIn.lng || null,
      gpsOut.latitude || gpsOut.lat || null,
      gpsOut.longitude || gpsOut.lng || null,
      issues.length === 0 ? 'ready' : 'pending',
      issues.length === 0,
      JSON.stringify(issues)
    ]);

    // Update authorization used units
    if (authorization && units > 0) {
      await db.query(`
        UPDATE authorizations SET 
          used_units = used_units + $1,
          status = CASE 
            WHEN used_units + $1 >= authorized_units THEN 'exhausted'
            ELSE status END,
          updated_at = NOW()
        WHERE id = $2
      `, [units, authorization.id]);

      // Check if low units alert needed
      const updatedAuth = await db.query('SELECT * FROM authorizations WHERE id = $1', [authorization.id]);
      const a = updatedAuth.rows[0];
      if (a && a.authorized_units - a.used_units <= a.low_units_alert_threshold) {
        const remaining = a.authorized_units - a.used_units;
        const admins = await db.query(`SELECT id FROM users WHERE role = 'admin' AND is_active = true`);
        const clientInfo = await db.query(`SELECT first_name, last_name FROM clients WHERE id = $1`, [entry.client_id]);
        const clientName = clientInfo.rows[0] ? `${clientInfo.rows[0].first_name} ${clientInfo.rows[0].last_name}` : 'Client';
        for (const admin of admins.rows) {
          await db.query(`
            INSERT INTO notifications (id, user_id, type, title, message, is_read, created_at)
            VALUES ($1,$2,'authorization_low','⚠️ Low Authorization Units',$3,false,NOW())
          `, [uuidv4(), admin.id,
            `${clientName}: Only ${remaining.toFixed(1)} units remaining on auth #${a.auth_number || a.id.slice(0,8)} (expires ${new Date(a.end_date).toLocaleDateString()})`
          ]);
        }
      }
    }

    return result.rows[0];
  } catch (e) {
    console.error('[EVV] createEVVFromTimeEntry error:', e.message);
    return null;
  }
}

// Export for use in other routes (called from clock-out endpoint)
module.exports.createEVVFromTimeEntry = createEVVFromTimeEntry;

// ─── GET EVV STATUS DASHBOARD ────────────────────────────────────────────────
router.get('/status', auth, requireAdmin, async (req, res) => {
  try {
    const cfg = getSandataConfig();
    const { startDate, endDate } = req.query;
    const start = startDate || new Date(Date.now() - 7 * 86400000).toISOString().split('T')[0];
    const end = endDate || new Date().toISOString().split('T')[0];

    const visits = await db.query(`
      SELECT ev.*,
        c.first_name as client_first, c.last_name as client_last, c.medicaid_id,
        u.first_name as cg_first, u.last_name as cg_last,
        cp.evv_worker_id, cp.npi_number
      FROM evv_visits ev
      JOIN clients c ON ev.client_id = c.id
      JOIN users u ON ev.caregiver_id = u.id
      LEFT JOIN caregiver_profiles cp ON cp.caregiver_id = u.id
      WHERE ev.service_date BETWEEN $1 AND $2
      ORDER BY ev.service_date DESC, ev.actual_start DESC
    `, [start, end]);

    const summary = {
      total: visits.rows.length,
      verified: visits.rows.filter(v => v.is_verified).length,
      pending: visits.rows.filter(v => v.sandata_status === 'pending').length,
      ready: visits.rows.filter(v => v.sandata_status === 'ready').length,
      submitted: visits.rows.filter(v => v.sandata_status === 'submitted').length,
      accepted: visits.rows.filter(v => v.sandata_status === 'accepted').length,
      exceptions: visits.rows.filter(v => v.sandata_status === 'exception').length,
      hasIssues: visits.rows.filter(v => v.verification_issues?.length > 0).length,
    };

    res.json({ sandataConfigured: cfg.isConfigured, summary, visits: visits.rows });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ─── SUBMIT VISITS TO SANDATA ────────────────────────────────────────────────
router.post('/submit', auth, requireAdmin, async (req, res) => {
  try {
    const { visitIds } = req.body;
    const cfg = getSandataConfig();

    if (!cfg.isConfigured) {
      return res.status(400).json({
        error: 'Sandata credentials not configured',
        setup: 'Add SANDATA_USERNAME, SANDATA_PASSWORD, SANDATA_ACCOUNT_ID to your Render environment variables. Call (833) 931-2035 to get credentials.'
      });
    }

    const visits = await db.query(`
      SELECT ev.*,
        c.medicaid_id, c.evv_client_id, c.first_name as client_first, c.last_name as client_last,
        c.date_of_birth, c.gender,
        u.first_name as cg_first, u.last_name as cg_last,
        cp.evv_worker_id, cp.npi_number, cp.taxonomy_code
      FROM evv_visits ev
      JOIN clients c ON ev.client_id = c.id
      JOIN users u ON ev.caregiver_id = u.id
      LEFT JOIN caregiver_profiles cp ON cp.caregiver_id = u.id
      WHERE ev.id = ANY($1)
        AND ev.sandata_status IN ('ready', 'pending')
    `, [visitIds]);

    const results = [];
    for (const v of visits.rows) {
      // Build Sandata Alt-EVV visit payload
      const payload = {
        ClientID: v.evv_client_id || v.medicaid_id,
        EmployeeID: v.evv_worker_id || v.npi_number,
        ServiceCode: v.service_code,
        Modifier: v.modifier || null,
        ServiceDate: v.service_date,
        ActualStartTime: new Date(v.actual_start).toISOString(),
        ActualEndTime: v.actual_end ? new Date(v.actual_end).toISOString() : null,
        UnitsOfService: v.units_of_service,
        GPSInLatitude: v.gps_in_lat,
        GPSInLongitude: v.gps_in_lng,
        GPSOutLatitude: v.gps_out_lat,
        GPSOutLongitude: v.gps_out_lng,
        VerificationMethod: 'GPS',
      };

      try {
        const response = await sandataRequest('POST', '/visits', payload);
        const newStatus = response.ok ? 'submitted' : 'exception';
        const sandataVisitId = response.data?.VisitID || response.data?.visitId || null;

        await db.query(`
          UPDATE evv_visits SET
            sandata_status = $1,
            sandata_visit_id = $2,
            sandata_submitted_at = NOW(),
            sandata_response = $3,
            sandata_exception_code = $4,
            sandata_exception_desc = $5,
            updated_at = NOW()
          WHERE id = $6
        `, [
          newStatus, sandataVisitId,
          JSON.stringify(response.data),
          response.ok ? null : (response.data?.ExceptionCode || 'ERR'),
          response.ok ? null : (response.data?.Message || response.data?.message || 'Submission failed'),
          v.id
        ]);

        results.push({ visitId: v.id, status: newStatus, sandataVisitId });
      } catch (e) {
        await db.query(`UPDATE evv_visits SET sandata_status='exception', sandata_exception_desc=$1 WHERE id=$2`, [e.message, v.id]);
        results.push({ visitId: v.id, status: 'error', error: e.message });
      }
    }

    res.json({ submitted: results.filter(r => r.status === 'submitted').length, results });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ─── GET EVV VISIT DETAIL ────────────────────────────────────────────────────
router.get('/visit/:id', auth, requireAdmin, async (req, res) => {
  try {
    const result = await db.query(`
      SELECT ev.*,
        c.first_name as client_first, c.last_name as client_last, c.medicaid_id, c.evv_client_id,
        u.first_name as cg_first, u.last_name as cg_last,
        cp.evv_worker_id, cp.npi_number,
        a.auth_number, a.authorized_units, a.used_units, a.end_date as auth_expires
      FROM evv_visits ev
      JOIN clients c ON ev.client_id = c.id
      JOIN users u ON ev.caregiver_id = u.id
      LEFT JOIN caregiver_profiles cp ON cp.caregiver_id = u.id
      LEFT JOIN authorizations a ON ev.authorization_id = a.id
      WHERE ev.id = $1
    `, [req.params.id]);
    if (!result.rows.length) return res.status(404).json({ error: 'EVV visit not found' });
    res.json(result.rows[0]);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ─── MANUAL CORRECT EVV VISIT ────────────────────────────────────────────────
router.put('/visit/:id', auth, requireAdmin, async (req, res) => {
  try {
    const { serviceCode, modifier, authorizationId, actualStart, actualEnd, notes } = req.body;
    await db.query(`
      UPDATE evv_visits SET
        service_code = COALESCE($1, service_code),
        modifier = COALESCE($2, modifier),
        authorization_id = COALESCE($3, authorization_id),
        actual_start = COALESCE($4, actual_start),
        actual_end = COALESCE($5, actual_end),
        sandata_status = CASE WHEN sandata_status = 'exception' THEN 'ready' ELSE sandata_status END,
        updated_at = NOW()
      WHERE id = $6
    `, [serviceCode, modifier, authorizationId, actualStart, actualEnd, req.params.id]);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ─── SYNC CLIENT TO SANDATA ──────────────────────────────────────────────────
router.post('/sync-client/:clientId', auth, requireAdmin, async (req, res) => {
  const cfg = getSandataConfig();
  if (!cfg.isConfigured) return res.status(400).json({ error: 'Sandata not configured' });
  try {
    const client = await db.query(`SELECT * FROM clients WHERE id = $1`, [req.params.clientId]);
    if (!client.rows.length) return res.status(404).json({ error: 'Client not found' });
    const c = client.rows[0];

    const payload = {
      ClientID: c.evv_client_id || c.medicaid_id || c.id,
      FirstName: c.first_name,
      LastName: c.last_name,
      DateOfBirth: c.date_of_birth,
      Gender: c.gender,
      MedicaidID: c.medicaid_id,
      Address: c.address,
      City: c.city,
      State: c.state || 'WI',
      Zip: c.zip,
    };

    const response = await sandataRequest('POST', '/clients', payload);
    if (response.ok) {
      const sandataClientId = response.data?.ClientID || response.data?.clientId;
      if (sandataClientId) {
        await db.query(`UPDATE clients SET evv_client_id = $1 WHERE id = $2`, [sandataClientId, req.params.clientId]);
      }
    }
    res.json({ ok: response.ok, data: response.data });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ─── SYNC CAREGIVER TO SANDATA ───────────────────────────────────────────────
router.post('/sync-caregiver/:caregiverId', auth, requireAdmin, async (req, res) => {
  const cfg = getSandataConfig();
  if (!cfg.isConfigured) return res.status(400).json({ error: 'Sandata not configured' });
  try {
    const user = await db.query(`
      SELECT u.*, cp.npi_number, cp.evv_worker_id, cp.taxonomy_code
      FROM users u LEFT JOIN caregiver_profiles cp ON cp.caregiver_id = u.id
      WHERE u.id = $1
    `, [req.params.caregiverId]);
    if (!user.rows.length) return res.status(404).json({ error: 'Caregiver not found' });
    const u = user.rows[0];

    const payload = {
      EmployeeID: u.evv_worker_id || u.npi_number || u.id,
      FirstName: u.first_name,
      LastName: u.last_name,
      NPI: u.npi_number,
      TaxonomyCode: u.taxonomy_code || '374700000X',
      Phone: u.phone,
    };

    const response = await sandataRequest('POST', '/employees', payload);
    if (response.ok) {
      const workerId = response.data?.EmployeeID || response.data?.employeeId;
      if (workerId) {
        await db.query(`
          INSERT INTO caregiver_profiles (caregiver_id, evv_worker_id) VALUES ($1, $2)
          ON CONFLICT (caregiver_id) DO UPDATE SET evv_worker_id = $2
        `, [req.params.caregiverId, workerId]);
      }
    }
    res.json({ ok: response.ok, data: response.data });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ─── CONFIG STATUS ────────────────────────────────────────────────────────────
router.get('/config', auth, requireAdmin, async (req, res) => {
  const cfg = getSandataConfig();
  res.json({
    isConfigured: cfg.isConfigured,
    hasUsername: !!cfg.username,
    hasPassword: !!cfg.password,
    hasAccountId: !!cfg.accountId,
    setupInstructions: cfg.isConfigured ? null : {
      step1: 'Call Wisconsin EVV Customer Care: (833) 931-2035',
      step2: 'Request Alt-EVV API credentials for your agency',
      step3: 'Add to Render environment variables: SANDATA_USERNAME, SANDATA_PASSWORD, SANDATA_ACCOUNT_ID',
      step4: 'Use Sandata sandbox to test before going live'
    }
  });
});

router.createEVVFromTimeEntry = createEVVFromTimeEntry;
module.exports = router;
