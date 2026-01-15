// routes/claimsRoutes.js
// Claims Management: Submit, track, export 837P

const express = require('express');
const router = express.Router();
const db = require('../../db');
const auth = require('../../middleware/auth');

// Get all claims
router.get('/', auth, async (req, res) => {
  const { status, payerId, startDate, endDate } = req.query;
  try {
    let query = `
      SELECT c.*, 
        rs.name as payer_name,
        cl.first_name as client_first_name, cl.last_name as client_last_name,
        i.invoice_number
      FROM claims c
      LEFT JOIN referral_sources rs ON c.payer_id = rs.id
      LEFT JOIN clients cl ON c.client_id = cl.id
      LEFT JOIN invoices i ON c.invoice_id = i.id
      WHERE 1=1
    `;
    const params = [];

    if (status) {
      params.push(status);
      query += ` AND c.status = $${params.length}`;
    }
    if (payerId) {
      params.push(payerId);
      query += ` AND c.payer_id = $${params.length}`;
    }
    if (startDate) {
      params.push(startDate);
      query += ` AND c.service_date_from >= $${params.length}`;
    }
    if (endDate) {
      params.push(endDate);
      query += ` AND c.service_date_to <= $${params.length}`;
    }

    query += ` ORDER BY c.created_at DESC`;
    const result = await db.query(query, params);
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get claim by ID
router.get('/:id', auth, async (req, res) => {
  try {
    const result = await db.query(`
      SELECT c.*, 
        rs.name as payer_name, rs.billing_address, rs.billing_contact,
        cl.first_name as client_first_name, cl.last_name as client_last_name,
        cl.medicaid_id, cl.insurance_id,
        i.invoice_number, i.total as invoice_total
      FROM claims c
      LEFT JOIN referral_sources rs ON c.payer_id = rs.id
      LEFT JOIN clients cl ON c.client_id = cl.id
      LEFT JOIN invoices i ON c.invoice_id = i.id
      WHERE c.id = $1
    `, [req.params.id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Claim not found' });
    }

    // Get status history
    const history = await db.query(`
      SELECT * FROM claim_status_history 
      WHERE claim_id = $1 
      ORDER BY created_at DESC
    `, [req.params.id]);

    res.json({ ...result.rows[0], status_history: history.rows });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Create claim from invoice
router.post('/', auth, async (req, res) => {
  const { invoiceId, procedureCode, diagnosisCode, modifier, placeOfService } = req.body;
  
  try {
    // Get invoice details
    const invoice = await db.query(`
      SELECT i.*, c.referral_source_id, c.medicaid_id,
        c.first_name, c.last_name
      FROM invoices i
      JOIN clients c ON i.client_id = c.id
      WHERE i.id = $1
    `, [invoiceId]);

    if (invoice.rows.length === 0) {
      return res.status(404).json({ error: 'Invoice not found' });
    }

    const inv = invoice.rows[0];
    const claimNumber = `CLM-${Date.now()}`;

    const result = await db.query(`
      INSERT INTO claims (
        invoice_id, claim_number, payer_id, client_id,
        service_date_from, service_date_to, place_of_service,
        procedure_code, modifier, diagnosis_code,
        units, charge_amount, status, created_by
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, 'draft', $13)
      RETURNING *
    `, [
      invoiceId, claimNumber, inv.referral_source_id, inv.client_id,
      inv.billing_period_start, inv.billing_period_end, placeOfService || '12',
      procedureCode, modifier, diagnosisCode,
      inv.total_hours || inv.total, inv.total, req.user.id
    ]);

    // Log status
    await db.query(`
      INSERT INTO claim_status_history (claim_id, status, notes, created_by)
      VALUES ($1, 'draft', 'Claim created', $2)
    `, [result.rows[0].id, req.user.id]);

    res.json(result.rows[0]);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Update claim status
router.put('/:id/status', auth, async (req, res) => {
  const { status, notes, paidAmount, denialReason } = req.body;
  
  try {
    let updateFields = ['status = $1', 'updated_at = NOW()'];
    let params = [status];
    let paramIndex = 2;

    if (status === 'submitted') {
      updateFields.push(`submitted_date = NOW()`);
    }
    if (status === 'accepted') {
      updateFields.push(`accepted_date = NOW()`);
    }
    if (status === 'paid' && paidAmount) {
      updateFields.push(`paid_date = NOW()`, `paid_amount = $${paramIndex}`);
      params.push(paidAmount);
      paramIndex++;
    }
    if (status === 'denied' && denialReason) {
      updateFields.push(`denial_reason = $${paramIndex}`);
      params.push(denialReason);
      paramIndex++;
    }

    params.push(req.params.id);
    
    await db.query(`
      UPDATE claims SET ${updateFields.join(', ')} WHERE id = $${paramIndex}
    `, params);

    // Log status change
    await db.query(`
      INSERT INTO claim_status_history (claim_id, status, notes, created_by)
      VALUES ($1, $2, $3, $4)
    `, [req.params.id, status, notes, req.user.id]);

    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Generate 837P file
router.post('/export/837p', auth, async (req, res) => {
  const { claimIds } = req.body;
  
  try {
    const claims = await db.query(`
      SELECT c.*, 
        rs.name as payer_name, rs.payer_id as payer_identifier,
        cl.first_name, cl.last_name, cl.medicaid_id, cl.date_of_birth,
        cl.address, cl.city, cl.state, cl.zip
      FROM claims c
      JOIN referral_sources rs ON c.payer_id = rs.id
      JOIN clients cl ON c.client_id = cl.id
      WHERE c.id = ANY($1)
    `, [claimIds]);

    // Generate 837P EDI format (simplified)
    let edi = '';
    edi += `ISA*00*          *00*          *ZZ*SENDERID       *ZZ*RECEIVERID     *${formatDate(new Date())}*${formatTime(new Date())}*^*00501*000000001*0*P*:~\n`;
    edi += `GS*HC*SENDERID*RECEIVERID*${formatDateShort(new Date())}*${formatTime(new Date())}*1*X*005010X222A1~\n`;
    edi += `ST*837*0001*005010X222A1~\n`;
    edi += `BHT*0019*00*${Date.now()}*${formatDateShort(new Date())}*${formatTime(new Date())}*CH~\n`;

    // Add claim segments
    let claimIndex = 1;
    for (const claim of claims.rows) {
      edi += `CLM*${claim.claim_number}*${claim.charge_amount}***${claim.place_of_service}:B:1*Y*A*Y*Y~\n`;
      edi += `HI*ABK:${claim.diagnosis_code || 'Z7689'}~\n`;
      edi += `SV1*HC:${claim.procedure_code || 'T1019'}${claim.modifier ? ':' + claim.modifier : ''}*${claim.charge_amount}*UN*${claim.units}***1~\n`;
      edi += `DTP*472*D8*${formatDateShort(new Date(claim.service_date_from))}~\n`;
      claimIndex++;
    }

    edi += `SE*${10 + (claimIndex * 4)}*0001~\n`;
    edi += `GE*1*1~\n`;
    edi += `IEA*1*000000001~\n`;

    // Update claims as submitted
    await db.query(`
      UPDATE claims SET status = 'submitted', submitted_date = NOW()
      WHERE id = ANY($1) AND status IN ('draft', 'ready')
    `, [claimIds]);

    res.setHeader('Content-Type', 'text/plain');
    res.setHeader('Content-Disposition', `attachment; filename=claims-837p-${Date.now()}.edi`);
    res.send(edi);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get claims summary/dashboard
router.get('/reports/summary', auth, async (req, res) => {
  try {
    const summary = await db.query(`
      SELECT 
        status,
        COUNT(*) as count,
        SUM(charge_amount) as total_charged,
        SUM(paid_amount) as total_paid
      FROM claims
      GROUP BY status
    `);

    const byPayer = await db.query(`
      SELECT 
        rs.name as payer_name,
        COUNT(*) as claim_count,
        SUM(c.charge_amount) as total_charged,
        SUM(c.paid_amount) as total_paid,
        SUM(CASE WHEN c.status = 'denied' THEN c.charge_amount ELSE 0 END) as total_denied
      FROM claims c
      JOIN referral_sources rs ON c.payer_id = rs.id
      GROUP BY rs.id, rs.name
      ORDER BY total_charged DESC
    `);

    const aging = await db.query(`
      SELECT
        SUM(CASE WHEN submitted_date > NOW() - INTERVAL '30 days' THEN charge_amount ELSE 0 END) as under_30,
        SUM(CASE WHEN submitted_date BETWEEN NOW() - INTERVAL '60 days' AND NOW() - INTERVAL '30 days' THEN charge_amount ELSE 0 END) as days_30_60,
        SUM(CASE WHEN submitted_date BETWEEN NOW() - INTERVAL '90 days' AND NOW() - INTERVAL '60 days' THEN charge_amount ELSE 0 END) as days_60_90,
        SUM(CASE WHEN submitted_date < NOW() - INTERVAL '90 days' THEN charge_amount ELSE 0 END) as over_90
      FROM claims
      WHERE status IN ('submitted', 'accepted')
    `);

    res.json({
      byStatus: summary.rows,
      byPayer: byPayer.rows,
      aging: aging.rows[0]
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Helper functions
function formatDate(date) {
  return date.toISOString().slice(2, 10).replace(/-/g, '');
}

function formatDateShort(date) {
  return date.toISOString().slice(0, 10).replace(/-/g, '');
}

function formatTime(date) {
  return date.toISOString().slice(11, 16).replace(/:/g, '');
}

module.exports = router;
