// routes/billingRoutes.js
// Enhanced billing routes: Authorizations, Payments, Adjustments, Batch Generation, EVV Export
// FIXED: Uses caregiver_profiles instead of caregivers

const express = require('express');
const router = express.Router();
const db = require('../db');
const auth = require('../middleware/auth');

// ==================== AUTHORIZATIONS ====================

router.get('/authorizations', auth, async (req, res) => {
  try {
    const result = await db.query(`
      SELECT a.*, 
        c.first_name as client_first_name, c.last_name as client_last_name,
        rs.name as referral_source_name,
        COALESCE(SUM(te.hours), 0) as used_units
      FROM authorizations a
      LEFT JOIN clients c ON a.client_id = c.id
      LEFT JOIN referral_sources rs ON a.referral_source_id = rs.id
      LEFT JOIN time_entries te ON te.client_id = a.client_id 
        AND te.clock_in >= a.start_date 
        AND te.clock_in <= a.end_date
        AND te.status = 'approved'
      GROUP BY a.id, c.first_name, c.last_name, rs.name
      ORDER BY a.end_date ASC
    `);
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching authorizations:', error);
    res.status(500).json({ error: error.message });
  }
});

router.post('/authorizations', auth, async (req, res) => {
  const { clientId, referralSourceId, authorizationNumber, serviceType, authorizedUnits, unitType, startDate, endDate, notes } = req.body;
  try {
    const result = await db.query(`
      INSERT INTO authorizations (client_id, referral_source_id, authorization_number, service_type, authorized_units, unit_type, start_date, end_date, notes)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      RETURNING *
    `, [clientId, referralSourceId, authorizationNumber, serviceType, authorizedUnits, unitType || 'hours', startDate, endDate, notes]);
    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error creating authorization:', error);
    res.status(500).json({ error: error.message });
  }
});

// ==================== INVOICE PAYMENTS ====================

router.get('/invoice-payments', auth, async (req, res) => {
  try {
    const result = await db.query(`
      SELECT ip.*, i.invoice_number,
        CONCAT(c.first_name, ' ', c.last_name) as client_name
      FROM invoice_payments ip
      JOIN invoices i ON ip.invoice_id = i.id
      JOIN clients c ON i.client_id = c.id
      ORDER BY ip.payment_date DESC
    `);
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching payments:', error);
    res.status(500).json({ error: error.message });
  }
});

router.post('/invoice-payments', auth, async (req, res) => {
  const { invoiceId, amount, paymentDate, paymentMethod, referenceNumber, notes } = req.body;
  try {
    const paymentResult = await db.query(`
      INSERT INTO invoice_payments (invoice_id, amount, payment_date, payment_method, reference_number, notes, created_by)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      RETURNING *
    `, [invoiceId, amount, paymentDate, paymentMethod, referenceNumber, notes, req.user.id]);

    await db.query(`
      UPDATE invoices 
      SET amount_paid = COALESCE(amount_paid, 0) + $1,
          payment_status = CASE 
            WHEN COALESCE(amount_paid, 0) + $1 >= total THEN 'paid'
            WHEN COALESCE(amount_paid, 0) + $1 > 0 THEN 'partial'
            ELSE 'pending'
          END,
          payment_date = CASE WHEN COALESCE(amount_paid, 0) + $1 >= total THEN $2 ELSE payment_date END
      WHERE id = $3
    `, [amount, paymentDate, invoiceId]);

    res.json(paymentResult.rows[0]);
  } catch (error) {
    console.error('Error recording payment:', error);
    res.status(500).json({ error: error.message });
  }
});

// ==================== INVOICE ADJUSTMENTS ====================

router.post('/invoice-adjustments', auth, async (req, res) => {
  const { invoiceId, amount, type, reason, notes } = req.body;
  try {
    const result = await db.query(`
      INSERT INTO invoice_adjustments (invoice_id, amount, adjustment_type, reason, notes, created_by)
      VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING *
    `, [invoiceId, amount, type, reason, notes, req.user.id]);

    if (type === 'write_off' || type === 'discount') {
      await db.query(`
        UPDATE invoices 
        SET amount_adjusted = COALESCE(amount_adjusted, 0) + $1,
            payment_status = CASE 
              WHEN COALESCE(amount_paid, 0) + COALESCE(amount_adjusted, 0) + $1 >= total THEN 'paid'
              ELSE payment_status
            END
        WHERE id = $2
      `, [amount, invoiceId]);
    }

    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error recording adjustment:', error);
    res.status(500).json({ error: error.message });
  }
});

// ==================== BATCH INVOICE GENERATION ====================

router.post('/invoices/batch-generate', auth, async (req, res) => {
  const { billingPeriodStart, billingPeriodEnd, clientFilter, referralSourceId } = req.body;
  
  try {
    let clientQuery = `
      SELECT DISTINCT c.id, c.first_name, c.last_name, c.referral_source_id
      FROM clients c
      JOIN time_entries te ON te.client_id = c.id
      WHERE te.clock_in >= $1 AND te.clock_in <= $2
      AND te.status = 'approved'
      AND c.status = 'active'
    `;
    const params = [billingPeriodStart, billingPeriodEnd];

    if (clientFilter === 'insurance') {
      clientQuery += ` AND c.referral_source_id IS NOT NULL`;
    } else if (clientFilter === 'private') {
      clientQuery += ` AND c.referral_source_id IS NULL`;
    }

    if (referralSourceId) {
      clientQuery += ` AND c.referral_source_id = $${params.length + 1}`;
      params.push(referralSourceId);
    }

    const clientsResult = await db.query(clientQuery, params);
    
    let generatedCount = 0;
    let totalAmount = 0;

    for (const client of clientsResult.rows) {
      const existingInvoice = await db.query(`
        SELECT id FROM invoices 
        WHERE client_id = $1 AND billing_period_start = $2 AND billing_period_end = $3
      `, [client.id, billingPeriodStart, billingPeriodEnd]);

      if (existingInvoice.rows.length > 0) continue;

      const invoiceNumber = `INV-${Date.now()}-${client.id.slice(0, 8)}`;
      const dueDate = new Date(billingPeriodEnd);
      dueDate.setDate(dueDate.getDate() + 30);

      const totalResult = await db.query(`
        SELECT COALESCE(SUM(
          te.hours * COALESCE(rsr.rate_amount, 25)
        ), 0) as total
        FROM time_entries te
        LEFT JOIN referral_source_rates rsr ON rsr.referral_source_id = $4
        WHERE te.client_id = $1 
        AND te.clock_in >= $2 AND te.clock_in <= $3
        AND te.status = 'approved'
      `, [client.id, billingPeriodStart, billingPeriodEnd, client.referral_source_id]);

      const total = parseFloat(totalResult.rows[0]?.total || 0);
      if (total <= 0) continue;

      await db.query(`
        INSERT INTO invoices (client_id, invoice_number, billing_period_start, billing_period_end, total, payment_status, payment_due_date, created_by)
        VALUES ($1, $2, $3, $4, $5, 'pending', $6, $7)
      `, [client.id, invoiceNumber, billingPeriodStart, billingPeriodEnd, total, dueDate, req.user.id]);

      generatedCount++;
      totalAmount += total;
    }

    res.json({ count: generatedCount, total: totalAmount });
  } catch (error) {
    console.error('Error in batch generation:', error);
    res.status(500).json({ error: error.message });
  }
});

// ==================== EVV EXPORT ====================

router.get('/export/evv', auth, async (req, res) => {
  try {
    const result = await db.query(`
      SELECT 
        te.id,
        te.clock_in,
        te.clock_out,
        te.hours,
        te.clock_in_latitude,
        te.clock_in_longitude,
        te.clock_out_latitude,
        te.clock_out_longitude,
        c.first_name as client_first_name,
        c.last_name as client_last_name,
        c.medicaid_id,
        cp.first_name as caregiver_first_name,
        cp.last_name as caregiver_last_name,
        cp.npi_number
      FROM time_entries te
      JOIN clients c ON te.client_id = c.id
      JOIN caregiver_profiles cp ON te.caregiver_id = cp.id
      WHERE te.clock_in >= CURRENT_DATE - INTERVAL '30 days'
      AND te.status = 'approved'
      ORDER BY te.clock_in DESC
    `);

    const headers = [
      'ServiceDate', 'ClientFirstName', 'ClientLastName', 'MedicaidID',
      'ProviderFirstName', 'ProviderLastName', 'NPI',
      'ClockInTime', 'ClockOutTime', 'TotalHours',
      'ClockInLatitude', 'ClockInLongitude', 'ClockOutLatitude', 'ClockOutLongitude',
      'VerificationMethod'
    ];

    const rows = result.rows.map(row => [
      new Date(row.clock_in).toISOString().split('T')[0],
      row.client_first_name,
      row.client_last_name,
      row.medicaid_id || '',
      row.caregiver_first_name,
      row.caregiver_last_name,
      row.npi_number || '',
      new Date(row.clock_in).toISOString(),
      row.clock_out ? new Date(row.clock_out).toISOString() : '',
      row.hours || '',
      row.clock_in_latitude || '',
      row.clock_in_longitude || '',
      row.clock_out_latitude || '',
      row.clock_out_longitude || '',
      'GPS'
    ]);

    const csv = [headers.join(','), ...rows.map(r => r.map(cell => `"${cell}"`).join(','))].join('\n');

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename=evv-export.csv');
    res.send(csv);
  } catch (error) {
    console.error('Error exporting EVV:', error);
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
