// routes/authorizationRoutes.js
// MIDAS Authorization Management - import, track, burn-down alerts

const express = require('express');
const router = express.Router();
const db = require('../db');
const auth = require('../middleware/auth');
const requireAdmin = require('../middleware/authorizeAdmin');
const { v4: uuidv4 } = require('uuid');

// ─── GET ALL AUTHORIZATIONS ───────────────────────────────────────────────────
router.get('/', auth, requireAdmin, async (req, res) => {
  try {
    const { clientId, status, payerId, expiringSoon } = req.query;
    let query = `
      SELECT a.*,
        c.first_name as client_first, c.last_name as client_last,
        rs.name as payer_name, rs.payer_type,
        ROUND((a.used_units / NULLIF(a.authorized_units, 0)) * 100, 1) as pct_used,
        a.authorized_units - a.used_units as remaining_units,
        CASE
          WHEN a.end_date < CURRENT_DATE THEN 'expired'
          WHEN a.authorized_units - a.used_units <= a.low_units_alert_threshold THEN 'low'
          WHEN a.end_date <= CURRENT_DATE + 30 THEN 'expiring_soon'
          ELSE 'ok'
        END as health_status
      FROM authorizations a
      JOIN clients c ON a.client_id = c.id
      LEFT JOIN referral_sources rs ON a.payer_id = rs.id
      WHERE 1=1
    `;
    const params = [];

    if (clientId) { params.push(clientId); query += ` AND a.client_id = $${params.length}`; }
    if (status) { params.push(status); query += ` AND a.status = $${params.length}`; }
    if (payerId) { params.push(payerId); query += ` AND a.payer_id = $${params.length}`; }
    if (expiringSoon) { query += ` AND a.end_date BETWEEN CURRENT_DATE AND CURRENT_DATE + 30`; }

    query += ` ORDER BY a.end_date ASC, c.last_name ASC`;
    const result = await db.query(query, params);
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ─── GET AUTH DASHBOARD SUMMARY ───────────────────────────────────────────────
router.get('/summary', auth, requireAdmin, async (req, res) => {
  try {
    const result = await db.query(`
      SELECT
        COUNT(*) as total,
        COUNT(CASE WHEN status = 'active' THEN 1 END) as active,
        COUNT(CASE WHEN end_date < CURRENT_DATE THEN 1 END) as expired,
        COUNT(CASE WHEN end_date BETWEEN CURRENT_DATE AND CURRENT_DATE + 30 AND status = 'active' THEN 1 END) as expiring_soon,
        COUNT(CASE WHEN (authorized_units - used_units) <= low_units_alert_threshold AND status = 'active' THEN 1 END) as low_units,
        COUNT(CASE WHEN status = 'exhausted' THEN 1 END) as exhausted
      FROM authorizations
    `);
    res.json(result.rows[0]);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ─── CREATE AUTHORIZATION (manual entry) ────────────────────────────────────
router.post('/', auth, requireAdmin, async (req, res) => {
  try {
    const {
      clientId, payerId, authNumber, midasAuthId,
      procedureCode, modifier, authorizedUnits, unitType,
      startDate, endDate, notes, lowUnitsThreshold
    } = req.body;

    if (!clientId || !authorizedUnits || !startDate || !endDate) {
      return res.status(400).json({ error: 'Client, authorized units, and date range are required' });
    }

    const result = await db.query(`
      INSERT INTO authorizations (
        id, client_id, payer_id, auth_number, midas_auth_id,
        procedure_code, modifier, authorized_units, unit_type,
        start_date, end_date, notes, low_units_alert_threshold, created_by
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
      RETURNING *
    `, [
      uuidv4(), clientId, payerId || null, authNumber || null, midasAuthId || null,
      procedureCode || 'T1019', modifier || null,
      authorizedUnits, unitType || '15min',
      startDate, endDate, notes || null,
      lowUnitsThreshold || 20, req.user.id
    ]);

    res.status(201).json(result.rows[0]);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ─── IMPORT FROM MIDAS CSV ────────────────────────────────────────────────────
// MIDAS doesn't have an API - export CSV from portal, import here
// Expected columns: MemberID, AuthNumber, ServiceCode, AuthorizedUnits, StartDate, EndDate
router.post('/import-csv', auth, requireAdmin, async (req, res) => {
  try {
    const { rows } = req.body; // Array of parsed CSV rows from frontend
    if (!rows || !rows.length) return res.status(400).json({ error: 'No data provided' });

    let imported = 0, skipped = 0, errors = [];

    for (const row of rows) {
      try {
        // Match member ID to client
        const client = await db.query(`
          SELECT id FROM clients
          WHERE medicaid_id = $1 OR mco_member_id = $1
          LIMIT 1
        `, [row.MemberID || row.member_id || row['Member ID']]);

        if (!client.rows.length) {
          skipped++;
          errors.push(`No client found for Member ID: ${row.MemberID || row.member_id}`);
          continue;
        }

        const clientId = client.rows[0].id;
        const authNumber = row.AuthNumber || row.auth_number || row['Auth Number'];
        const procedureCode = row.ServiceCode || row.service_code || row['Service Code'] || 'T1019';
        const authorizedUnits = parseFloat(row.AuthorizedUnits || row.authorized_units || row['Authorized Units'] || 0);
        const startDate = row.StartDate || row.start_date || row['Start Date'];
        const endDate = row.EndDate || row.end_date || row['End Date'];

        if (!authorizedUnits || !startDate || !endDate) {
          skipped++;
          errors.push(`Missing data for auth ${authNumber}`);
          continue;
        }

        // Check for existing auth with same number
        const existing = await db.query(
          `SELECT id FROM authorizations WHERE auth_number = $1 AND client_id = $2`,
          [authNumber, clientId]
        );

        if (existing.rows.length) {
          // Update existing
          await db.query(`
            UPDATE authorizations SET
              authorized_units = $1, start_date = $2, end_date = $3,
              status = CASE WHEN $3::date < CURRENT_DATE THEN 'expired' ELSE 'active' END,
              imported_from = 'midas_csv', updated_at = NOW()
            WHERE id = $4
          `, [authorizedUnits, startDate, endDate, existing.rows[0].id]);
        } else {
          await db.query(`
            INSERT INTO authorizations (id, client_id, auth_number, procedure_code,
              authorized_units, unit_type, start_date, end_date, status, imported_from, created_by)
            VALUES ($1,$2,$3,$4,$5,'15min',$6,$7,
              CASE WHEN $7::date < CURRENT_DATE THEN 'expired' ELSE 'active' END,
              'midas_csv',$8)
          `, [uuidv4(), clientId, authNumber, procedureCode, authorizedUnits, startDate, endDate, req.user.id]);
        }
        imported++;
      } catch (e) {
        errors.push(`Row error: ${e.message}`);
        skipped++;
      }
    }

    res.json({ imported, skipped, errors: errors.slice(0, 20) });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ─── UPDATE AUTHORIZATION ────────────────────────────────────────────────────
router.put('/:id', auth, requireAdmin, async (req, res) => {
  try {
    const { authorizedUnits, startDate, endDate, status, notes, lowUnitsThreshold } = req.body;
    await db.query(`
      UPDATE authorizations SET
        authorized_units = COALESCE($1, authorized_units),
        start_date = COALESCE($2, start_date),
        end_date = COALESCE($3, end_date),
        status = COALESCE($4, status),
        notes = COALESCE($5, notes),
        low_units_alert_threshold = COALESCE($6, low_units_alert_threshold),
        updated_at = NOW()
      WHERE id = $7
    `, [authorizedUnits, startDate, endDate, status, notes, lowUnitsThreshold, req.params.id]);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ─── GET CLIENT AUTHORIZATIONS ────────────────────────────────────────────────
router.get('/client/:clientId', auth, async (req, res) => {
  try {
    const result = await db.query(`
      SELECT a.*,
        rs.name as payer_name,
        a.authorized_units - a.used_units as remaining_units,
        ROUND((a.used_units / NULLIF(a.authorized_units, 0)) * 100, 1) as pct_used
      FROM authorizations a
      LEFT JOIN referral_sources rs ON a.payer_id = rs.id
      WHERE a.client_id = $1
      ORDER BY a.status ASC, a.end_date ASC
    `, [req.params.clientId]);
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
