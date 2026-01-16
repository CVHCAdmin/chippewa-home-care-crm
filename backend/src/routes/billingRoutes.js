// routes/billingRoutes.js
// Consolidated billing routes - invoices, payments, authorizations, rates
// All billing-related endpoints in one place

const express = require('express');
const router = express.Router();
const db = require('../db');
const auth = require('../middleware/auth');

// ==================== HELPER FUNCTIONS ====================

/**
 * Generate line items for a client's billing period
 */
async function generateLineItems(clientId, referralSourceId, careTypeId, billingPeriodStart, billingPeriodEnd) {
  const entriesResult = await db.query(`
    SELECT 
      te.id as time_entry_id,
      te.caregiver_id,
      u.first_name as caregiver_first_name,
      u.last_name as caregiver_last_name,
      DATE(te.start_time) as service_date,
      te.start_time,
      te.end_time,
      te.duration_minutes,
      te.notes
    FROM time_entries te
    JOIN users u ON te.caregiver_id = u.id
    WHERE te.client_id = $1
      AND te.start_time >= $2
      AND te.start_time < ($3::date + INTERVAL '1 day')
      AND te.is_complete = true
    ORDER BY te.start_time
  `, [clientId, billingPeriodStart, billingPeriodEnd]);

  let rate = 25.00;
  let rateType = 'hourly';

  if (referralSourceId) {
    const rateResult = await db.query(`
      SELECT rate_amount, rate_type 
      FROM referral_source_rates 
      WHERE referral_source_id = $1 
        AND (care_type_id = $2 OR care_type_id IS NULL)
        AND (is_active = true OR is_active IS NULL)
        AND (effective_date IS NULL OR effective_date <= $3)
        AND (end_date IS NULL OR end_date >= $4)
      ORDER BY 
        CASE WHEN care_type_id = $2 THEN 0 ELSE 1 END,
        effective_date DESC NULLS LAST
      LIMIT 1
    `, [referralSourceId, careTypeId, billingPeriodEnd, billingPeriodStart]);

    if (rateResult.rows.length > 0) {
      rate = parseFloat(rateResult.rows[0].rate_amount);
      rateType = rateResult.rows[0].rate_type || 'hourly';
    }
  }

  const lineItems = [];
  let invoiceTotal = 0;

  for (const entry of entriesResult.rows) {
    let hours = 0;
    if (entry.duration_minutes) {
      hours = entry.duration_minutes / 60.0;
    } else if (entry.start_time && entry.end_time) {
      const start = new Date(entry.start_time);
      const end = new Date(entry.end_time);
      hours = (end - start) / (1000 * 60 * 60);
    }

    if (hours <= 0) continue;

    const amount = rateType === 'hourly' ? hours * rate : rate;
    invoiceTotal += amount;

    // Format times for display
    const startTime = new Date(entry.start_time);
    const endTime = entry.end_time ? new Date(entry.end_time) : null;
    const timeRange = endTime 
      ? `${startTime.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })} - ${endTime.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })}`
      : '';

    lineItems.push({
      time_entry_id: entry.time_entry_id,
      caregiver_id: entry.caregiver_id,
      caregiver_first_name: entry.caregiver_first_name,
      caregiver_last_name: entry.caregiver_last_name,
      service_date: entry.service_date,
      start_time: entry.start_time,
      end_time: entry.end_time,
      time_range: timeRange,
      description: entry.notes || 'Home Care Services',
      hours: hours,
      rate: rate,
      rate_type: rateType,
      amount: amount
    });
  }

  return { lineItems, total: invoiceTotal };
}

/**
 * Insert line items into database
 */
async function insertLineItems(invoiceId, lineItems) {
  for (const item of lineItems) {
    await db.query(`
      INSERT INTO invoice_line_items (
        invoice_id, time_entry_id, caregiver_id, description, hours, rate, amount, service_date
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
    `, [
      invoiceId,
      item.time_entry_id,
      item.caregiver_id,
      item.description,
      item.hours,
      item.rate,
      item.amount,
      item.service_date || null
    ]);
  }
}

/**
 * Generate unique invoice number
 */
function generateInvoiceNumber(clientId) {
  const timestamp = Date.now().toString(36).toUpperCase();
  const clientPart = clientId.slice(0, 4).toUpperCase();
  return `INV-${timestamp}-${clientPart}`;
}

// ==================== INVOICES ====================

// List all invoices
router.get('/invoices', auth, async (req, res) => {
  try {
    const result = await db.query(`
      SELECT i.*, 
        c.first_name, c.last_name,
        rs.name as referral_source_name,
        (SELECT COALESCE(SUM(hours), 0) FROM invoice_line_items WHERE invoice_id = i.id) as total_hours
      FROM invoices i
      JOIN clients c ON i.client_id = c.id
      LEFT JOIN referral_sources rs ON i.referral_source_id = rs.id
      ORDER BY i.created_at DESC
    `);
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching invoices:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get single invoice with line items
router.get('/invoices/:id', auth, async (req, res) => {
  try {
    const invoiceResult = await db.query(`
      SELECT i.*, 
        c.first_name, c.last_name, c.referral_source_id, c.care_type_id,
        c.email, c.phone, c.address, c.city, c.state, c.zip,
        rs.name as referral_source_name
      FROM invoices i
      JOIN clients c ON i.client_id = c.id
      LEFT JOIN referral_sources rs ON c.referral_source_id = rs.id
      WHERE i.id = $1
    `, [req.params.id]);

    if (invoiceResult.rows.length === 0) {
      return res.status(404).json({ error: 'Invoice not found' });
    }

    const invoice = invoiceResult.rows[0];

    const lineItemsResult = await db.query(`
      SELECT 
        ili.*,
        u.first_name as caregiver_first_name,
        u.last_name as caregiver_last_name,
        COALESCE(ili.service_date, DATE(te.start_time)) as service_date
      FROM invoice_line_items ili
      LEFT JOIN users u ON ili.caregiver_id = u.id
      LEFT JOIN time_entries te ON ili.time_entry_id = te.id
      WHERE ili.invoice_id = $1
      ORDER BY COALESCE(ili.service_date, DATE(te.start_time)), u.last_name
    `, [req.params.id]);

    let lineItems = lineItemsResult.rows;

    if (lineItems.length === 0) {
      const regenerated = await generateLineItems(
        invoice.client_id,
        invoice.referral_source_id,
        invoice.care_type_id,
        invoice.billing_period_start,
        invoice.billing_period_end
      );
      lineItems = regenerated.lineItems;
    }

    res.json({
      ...invoice,
      line_items: lineItems,
      total_hours: lineItems.reduce((sum, item) => sum + parseFloat(item.hours || 0), 0)
    });

  } catch (error) {
    console.error('Error fetching invoice:', error);
    res.status(500).json({ error: error.message });
  }
});

// Generate single invoice
router.post('/invoices/generate-with-rates', auth, async (req, res) => {
  const { clientId, billingPeriodStart, billingPeriodEnd, notes } = req.body;

  if (!clientId || !billingPeriodStart || !billingPeriodEnd) {
    return res.status(400).json({ error: 'Client and billing period are required' });
  }

  try {
    const clientResult = await db.query(`
      SELECT id, first_name, last_name, referral_source_id, care_type_id,
             is_private_pay, private_pay_rate, private_pay_rate_type
      FROM clients WHERE id = $1
    `, [clientId]);

    if (clientResult.rows.length === 0) {
      return res.status(404).json({ error: 'Client not found' });
    }

    const client = clientResult.rows[0];

    const existingResult = await db.query(`
      SELECT id, invoice_number FROM invoices 
      WHERE client_id = $1 
        AND billing_period_start = $2 
        AND billing_period_end = $3
    `, [clientId, billingPeriodStart, billingPeriodEnd]);

    if (existingResult.rows.length > 0) {
      return res.status(400).json({ 
        error: `Invoice ${existingResult.rows[0].invoice_number} already exists for this period` 
      });
    }

    const { lineItems, total } = await generateLineItems(
      clientId, 
      client.referral_source_id,
      client.care_type_id,
      billingPeriodStart, 
      billingPeriodEnd
    );

    if (lineItems.length === 0) {
      return res.status(400).json({ 
        error: 'No completed time entries found for this client in the selected period' 
      });
    }

    const dueDate = new Date(billingPeriodEnd);
    dueDate.setDate(dueDate.getDate() + 30);

    const invoiceNumber = generateInvoiceNumber(clientId);
    
    const invoiceResult = await db.query(`
      INSERT INTO invoices (
        client_id, invoice_number, billing_period_start, billing_period_end,
        subtotal, total, payment_status, payment_due_date, notes,
        referral_source_id, invoice_type
      ) VALUES ($1, $2, $3, $4, $5, $6, 'pending', $7, $8, $9, $10)
      RETURNING *
    `, [
      clientId, invoiceNumber, billingPeriodStart, billingPeriodEnd,
      total, total, dueDate, notes,
      client.referral_source_id,
      client.is_private_pay ? 'private_pay' : 'insurance'
    ]);

    const invoice = invoiceResult.rows[0];
    await insertLineItems(invoice.id, lineItems);

    let referralSourceName = null;
    if (client.referral_source_id) {
      const rsResult = await db.query(
        'SELECT name FROM referral_sources WHERE id = $1',
        [client.referral_source_id]
      );
      referralSourceName = rsResult.rows[0]?.name;
    }

    res.json({
      ...invoice,
      first_name: client.first_name,
      last_name: client.last_name,
      referral_source_name: referralSourceName,
      line_items: lineItems,
      total_hours: lineItems.reduce((sum, item) => sum + parseFloat(item.hours), 0)
    });

  } catch (error) {
    console.error('Error generating invoice:', error);
    res.status(500).json({ error: error.message });
  }
});

// Create manual invoice with custom line items
router.post('/invoices/manual', auth, async (req, res) => {
  const { clientId, billingPeriodStart, billingPeriodEnd, notes, lineItems, detailedMode } = req.body;

  if (!clientId || !billingPeriodStart || !billingPeriodEnd) {
    return res.status(400).json({ error: 'Client and billing period are required' });
  }

  if (!lineItems || lineItems.length === 0) {
    return res.status(400).json({ error: 'At least one line item is required' });
  }

  try {
    // Get client info
    const clientResult = await db.query(`
      SELECT id, first_name, last_name, referral_source_id, care_type_id, is_private_pay
      FROM clients WHERE id = $1
    `, [clientId]);

    if (clientResult.rows.length === 0) {
      return res.status(404).json({ error: 'Client not found' });
    }

    const client = clientResult.rows[0];

    // Check for existing invoice
    const existingResult = await db.query(`
      SELECT id, invoice_number FROM invoices 
      WHERE client_id = $1 
        AND billing_period_start = $2 
        AND billing_period_end = $3
    `, [clientId, billingPeriodStart, billingPeriodEnd]);

    if (existingResult.rows.length > 0) {
      return res.status(400).json({ 
        error: `Invoice ${existingResult.rows[0].invoice_number} already exists for this period` 
      });
    }

    // Calculate total from line items
    let total = 0;
    for (const item of lineItems) {
      const amount = parseFloat(item.hours || 0) * parseFloat(item.rate || 0);
      total += amount;
    }

    // Generate invoice number
    const timestamp = Date.now().toString(36).toUpperCase();
    const clientPart = clientId.slice(0, 4).toUpperCase();
    const invoiceNumber = `INV-${timestamp}-${clientPart}`;

    // Calculate due date
    const dueDate = new Date(billingPeriodEnd);
    dueDate.setDate(dueDate.getDate() + 30);

    // Create invoice
    const invoiceResult = await db.query(`
      INSERT INTO invoices (
        client_id, invoice_number, billing_period_start, billing_period_end,
        subtotal, total, payment_status, payment_due_date, notes,
        referral_source_id, invoice_type
      ) VALUES ($1, $2, $3, $4, $5, $6, 'pending', $7, $8, $9, $10)
      RETURNING *
    `, [
      clientId, invoiceNumber, billingPeriodStart, billingPeriodEnd,
      total, total, dueDate, notes,
      client.referral_source_id,
      client.is_private_pay ? 'private_pay' : 'insurance'
    ]);

    const invoice = invoiceResult.rows[0];

    // Insert line items with optional service_date and times
    const insertedLineItems = [];
    for (const item of lineItems) {
      const amount = parseFloat(item.hours || 0) * parseFloat(item.rate || 0);
      
      // Build description with time info if provided
      let description = item.description || 'Home Care Services';
      if (detailedMode && item.startTime && item.endTime) {
        description = `${description} (${item.startTime} - ${item.endTime})`;
      }
      
      await db.query(`
        INSERT INTO invoice_line_items (
          invoice_id, caregiver_id, description, hours, rate, amount, service_date
        ) VALUES ($1, $2, $3, $4, $5, $6, $7)
      `, [
        invoice.id,
        item.caregiverId || null,
        description,
        item.hours,
        item.rate,
        amount,
        item.serviceDate || null
      ]);

      insertedLineItems.push({
        caregiver_id: item.caregiverId,
        caregiver_first_name: item.caregiverName?.split(' ')[0] || '',
        caregiver_last_name: item.caregiverName?.split(' ').slice(1).join(' ') || '',
        description: description,
        service_date: item.serviceDate,
        hours: item.hours,
        rate: item.rate,
        amount: amount
      });
    }

    // Get referral source name
    let referralSourceName = null;
    if (client.referral_source_id) {
      const rsResult = await db.query(
        'SELECT name FROM referral_sources WHERE id = $1',
        [client.referral_source_id]
      );
      referralSourceName = rsResult.rows[0]?.name;
    }

    res.json({
      ...invoice,
      first_name: client.first_name,
      last_name: client.last_name,
      referral_source_name: referralSourceName,
      line_items: insertedLineItems,
      total_hours: insertedLineItems.reduce((sum, item) => sum + parseFloat(item.hours), 0)
    });

  } catch (error) {
    console.error('Error creating manual invoice:', error);
    res.status(500).json({ error: error.message });
  }
});

// Batch generate invoices
router.post('/invoices/batch-generate', auth, async (req, res) => {
  const { billingPeriodStart, billingPeriodEnd, clientFilter, referralSourceId } = req.body;

  if (!billingPeriodStart || !billingPeriodEnd) {
    return res.status(400).json({ error: 'Billing period is required' });
  }

  try {
    let clientQuery = `
      SELECT DISTINCT c.id, c.first_name, c.last_name, c.referral_source_id, c.care_type_id,
                      c.is_private_pay
      FROM clients c
      JOIN time_entries te ON te.client_id = c.id
      WHERE te.start_time >= $1 
        AND te.start_time < ($2::date + INTERVAL '1 day')
        AND te.is_complete = true
        AND (c.status = 'active' OR c.is_active = true)
    `;
    const params = [billingPeriodStart, billingPeriodEnd];

    if (clientFilter === 'insurance') {
      clientQuery += ` AND c.referral_source_id IS NOT NULL AND c.is_private_pay IS NOT TRUE`;
    } else if (clientFilter === 'private') {
      clientQuery += ` AND (c.referral_source_id IS NULL OR c.is_private_pay = TRUE)`;
    }

    if (referralSourceId) {
      clientQuery += ` AND c.referral_source_id = $${params.length + 1}`;
      params.push(referralSourceId);
    }

    clientQuery += ` ORDER BY c.last_name, c.first_name`;

    const clientsResult = await db.query(clientQuery, params);

    let generatedCount = 0;
    let skippedCount = 0;
    let totalAmount = 0;
    let totalHours = 0;
    const generatedInvoices = [];
    const skippedClients = [];

    for (const client of clientsResult.rows) {
      const existingResult = await db.query(`
        SELECT id, invoice_number FROM invoices 
        WHERE client_id = $1 
          AND billing_period_start = $2 
          AND billing_period_end = $3
      `, [client.id, billingPeriodStart, billingPeriodEnd]);

      if (existingResult.rows.length > 0) {
        skippedCount++;
        skippedClients.push({
          name: `${client.first_name} ${client.last_name}`,
          reason: `Invoice ${existingResult.rows[0].invoice_number} already exists`
        });
        continue;
      }

      const { lineItems, total } = await generateLineItems(
        client.id,
        client.referral_source_id,
        client.care_type_id,
        billingPeriodStart,
        billingPeriodEnd
      );

      if (lineItems.length === 0 || total <= 0) {
        skippedCount++;
        skippedClients.push({
          name: `${client.first_name} ${client.last_name}`,
          reason: 'No billable hours found'
        });
        continue;
      }

      const dueDate = new Date(billingPeriodEnd);
      dueDate.setDate(dueDate.getDate() + 30);

      const invoiceNumber = generateInvoiceNumber(client.id);

      const invoiceResult = await db.query(`
        INSERT INTO invoices (
          client_id, invoice_number, billing_period_start, billing_period_end,
          subtotal, total, payment_status, payment_due_date,
          referral_source_id, invoice_type
        ) VALUES ($1, $2, $3, $4, $5, $6, 'pending', $7, $8, $9)
        RETURNING *
      `, [
        client.id, invoiceNumber, billingPeriodStart, billingPeriodEnd,
        total, total, dueDate,
        client.referral_source_id,
        client.is_private_pay ? 'private_pay' : 'insurance'
      ]);

      const invoice = invoiceResult.rows[0];
      await insertLineItems(invoice.id, lineItems);

      const hours = lineItems.reduce((sum, item) => sum + parseFloat(item.hours), 0);

      generatedCount++;
      totalAmount += total;
      totalHours += hours;

      generatedInvoices.push({
        invoiceNumber,
        clientName: `${client.first_name} ${client.last_name}`,
        total,
        hours
      });
    }

    res.json({
      count: generatedCount,
      skipped: skippedCount,
      total: totalAmount,
      totalHours: totalHours,
      invoices: generatedInvoices,
      skippedClients: skippedClients
    });

  } catch (error) {
    console.error('Error in batch generation:', error);
    res.status(500).json({ error: error.message });
  }
});

// Update invoice payment status
router.put('/invoices/:id/payment-status', auth, async (req, res) => {
  const { status, paymentDate } = req.body;
  
  try {
    const result = await db.query(`
      UPDATE invoices 
      SET payment_status = $1,
          payment_date = $2,
          paid_at = CASE WHEN $1 = 'paid' THEN NOW() ELSE paid_at END,
          amount_paid = CASE WHEN $1 = 'paid' THEN total ELSE amount_paid END,
          updated_at = NOW()
      WHERE id = $3
      RETURNING *
    `, [status, paymentDate || new Date(), req.params.id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Invoice not found' });
    }

    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error updating invoice status:', error);
    res.status(500).json({ error: error.message });
  }
});

// Delete invoice
router.delete('/invoices/:id', auth, async (req, res) => {
  try {
    // Check if invoice exists
    const invoiceCheck = await db.query('SELECT id, invoice_number FROM invoices WHERE id = $1', [req.params.id]);
    if (invoiceCheck.rows.length === 0) {
      return res.status(404).json({ error: 'Invoice not found' });
    }
    
    const invoiceNumber = invoiceCheck.rows[0].invoice_number;

    // Delete line items first (foreign key constraint)
    await db.query('DELETE FROM invoice_line_items WHERE invoice_id = $1', [req.params.id]);
    
    // Delete payments if table exists
    try {
      await db.query('DELETE FROM invoice_payments WHERE invoice_id = $1', [req.params.id]);
    } catch (e) { /* table might not exist */ }
    
    // Delete adjustments if table exists
    try {
      await db.query('DELETE FROM invoice_adjustments WHERE invoice_id = $1', [req.params.id]);
    } catch (e) { /* table might not exist */ }
    
    // Delete invoice
    await db.query('DELETE FROM invoices WHERE id = $1', [req.params.id]);

    res.json({ message: `Invoice ${invoiceNumber} deleted successfully` });
  } catch (error) {
    console.error('Error deleting invoice:', error);
    res.status(500).json({ error: error.message });
  }
});

// ==================== AUTHORIZATIONS ====================

router.get('/authorizations', auth, async (req, res) => {
  try {
    const result = await db.query(`
      SELECT a.*, 
        c.first_name as client_first_name, c.last_name as client_last_name,
        rs.name as referral_source_name,
        COALESCE((
          SELECT SUM(
            CASE 
              WHEN te.duration_minutes IS NOT NULL THEN te.duration_minutes / 60.0
              WHEN te.end_time IS NOT NULL THEN 
                EXTRACT(EPOCH FROM (te.end_time - te.start_time)) / 3600.0
              ELSE 0
            END
          )
          FROM time_entries te
          WHERE te.client_id = a.client_id 
            AND te.start_time >= a.start_date 
            AND te.start_time <= a.end_date
            AND te.is_complete = true
        ), 0) as used_units
      FROM authorizations a
      LEFT JOIN clients c ON a.client_id = c.id
      LEFT JOIN referral_sources rs ON a.referral_source_id = rs.id
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

router.put('/authorizations/:id', auth, async (req, res) => {
  const { authorizationNumber, serviceType, authorizedUnits, unitType, startDate, endDate, notes } = req.body;
  try {
    const result = await db.query(`
      UPDATE authorizations 
      SET authorization_number = COALESCE($1, authorization_number),
          service_type = COALESCE($2, service_type),
          authorized_units = COALESCE($3, authorized_units),
          unit_type = COALESCE($4, unit_type),
          start_date = COALESCE($5, start_date),
          end_date = COALESCE($6, end_date),
          notes = COALESCE($7, notes),
          updated_at = NOW()
      WHERE id = $8
      RETURNING *
    `, [authorizationNumber, serviceType, authorizedUnits, unitType, startDate, endDate, notes, req.params.id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Authorization not found' });
    }
    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error updating authorization:', error);
    res.status(500).json({ error: error.message });
  }
});

router.delete('/authorizations/:id', auth, async (req, res) => {
  try {
    const result = await db.query('DELETE FROM authorizations WHERE id = $1 RETURNING *', [req.params.id]);
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Authorization not found' });
    }
    res.json({ message: 'Authorization deleted' });
  } catch (error) {
    console.error('Error deleting authorization:', error);
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
      INSERT INTO invoice_payments (invoice_id, amount, payment_date, payment_method, reference_number, notes)
      VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING *
    `, [invoiceId, amount, paymentDate, paymentMethod, referenceNumber, notes]);

    await db.query(`
      UPDATE invoices 
      SET amount_paid = COALESCE(amount_paid, 0) + $1,
          payment_status = CASE 
            WHEN COALESCE(amount_paid, 0) + $1 >= total THEN 'paid'
            WHEN COALESCE(amount_paid, 0) + $1 > 0 THEN 'partial'
            ELSE 'pending'
          END,
          payment_date = CASE WHEN COALESCE(amount_paid, 0) + $1 >= total THEN $2 ELSE payment_date END,
          paid_at = CASE WHEN COALESCE(amount_paid, 0) + $1 >= total THEN NOW() ELSE paid_at END
      WHERE id = $3
    `, [amount, paymentDate, invoiceId]);

    res.json(paymentResult.rows[0]);
  } catch (error) {
    console.error('Error recording payment:', error);
    res.status(500).json({ error: error.message });
  }
});

// ==================== INVOICE ADJUSTMENTS ====================

router.get('/invoice-adjustments', auth, async (req, res) => {
  try {
    const result = await db.query(`
      SELECT ia.*, i.invoice_number,
        CONCAT(c.first_name, ' ', c.last_name) as client_name
      FROM invoice_adjustments ia
      JOIN invoices i ON ia.invoice_id = i.id
      JOIN clients c ON i.client_id = c.id
      ORDER BY ia.created_at DESC
    `);
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching adjustments:', error);
    res.status(500).json({ error: error.message });
  }
});

router.post('/invoice-adjustments', auth, async (req, res) => {
  const { invoiceId, amount, type, reason, notes } = req.body;
  try {
    const result = await db.query(`
      INSERT INTO invoice_adjustments (invoice_id, amount, adjustment_type, reason, notes)
      VALUES ($1, $2, $3, $4, $5)
      RETURNING *
    `, [invoiceId, amount, type, reason, notes]);

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

// ==================== REFERRAL SOURCE RATES ====================

router.get('/referral-source-rates', auth, async (req, res) => {
  try {
    const result = await db.query(`
      SELECT rsr.*, 
        rs.name as referral_source_name,
        ct.name as care_type_name
      FROM referral_source_rates rsr
      LEFT JOIN referral_sources rs ON rsr.referral_source_id = rs.id
      LEFT JOIN care_types ct ON rsr.care_type_id = ct.id
      ORDER BY rs.name, ct.name
    `);
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching rates:', error);
    res.status(500).json({ error: error.message });
  }
});

router.post('/referral-source-rates', auth, async (req, res) => {
  const { referralSourceId, careTypeId, rateAmount, rateType, effectiveDate } = req.body;
  try {
    const existing = await db.query(`
      SELECT id FROM referral_source_rates 
      WHERE referral_source_id = $1 
        AND (care_type_id = $2 OR (care_type_id IS NULL AND $2 IS NULL))
        AND (is_active = true OR is_active IS NULL)
    `, [referralSourceId, careTypeId || null]);

    if (existing.rows.length > 0) {
      await db.query(`
        UPDATE referral_source_rates 
        SET is_active = false, end_date = $1
        WHERE id = $2
      `, [effectiveDate || new Date(), existing.rows[0].id]);
    }

    const result = await db.query(`
      INSERT INTO referral_source_rates (referral_source_id, care_type_id, rate_amount, rate_type, effective_date, is_active)
      VALUES ($1, $2, $3, $4, $5, true)
      RETURNING *
    `, [referralSourceId, careTypeId || null, rateAmount, rateType || 'hourly', effectiveDate || new Date()]);
    
    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error creating rate:', error);
    res.status(500).json({ error: error.message });
  }
});

router.delete('/referral-source-rates/:id', auth, async (req, res) => {
  try {
    const result = await db.query('DELETE FROM referral_source_rates WHERE id = $1 RETURNING *', [req.params.id]);
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Rate not found' });
    }
    res.json({ message: 'Rate deleted' });
  } catch (error) {
    console.error('Error deleting rate:', error);
    res.status(500).json({ error: error.message });
  }
});

// ==================== EXPORTS ====================

router.get('/export/invoices-csv', auth, async (req, res) => {
  try {
    const result = await db.query(`
      SELECT 
        i.invoice_number,
        i.billing_period_start,
        i.billing_period_end,
        c.first_name || ' ' || c.last_name as client_name,
        COALESCE(rs.name, 'Private Pay') as payer,
        i.total,
        COALESCE(i.amount_paid, 0) as amount_paid,
        i.total - COALESCE(i.amount_paid, 0) - COALESCE(i.amount_adjusted, 0) as balance,
        i.payment_status,
        i.payment_due_date,
        i.created_at
      FROM invoices i
      JOIN clients c ON i.client_id = c.id
      LEFT JOIN referral_sources rs ON i.referral_source_id = rs.id
      ORDER BY i.created_at DESC
    `);

    const headers = [
      'Invoice Number', 'Period Start', 'Period End', 'Client', 'Payer',
      'Total', 'Paid', 'Balance', 'Status', 'Due Date', 'Created'
    ];

    const rows = result.rows.map(row => [
      row.invoice_number,
      row.billing_period_start,
      row.billing_period_end,
      row.client_name,
      row.payer,
      row.total,
      row.amount_paid,
      row.balance,
      row.payment_status,
      row.payment_due_date,
      row.created_at
    ]);

    const csv = [
      headers.join(','),
      ...rows.map(r => r.map(cell => `"${cell || ''}"`).join(','))
    ].join('\n');

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename=invoices-${new Date().toISOString().split('T')[0]}.csv`);
    res.send(csv);
  } catch (error) {
    console.error('Error exporting invoices:', error);
    res.status(500).json({ error: error.message });
  }
});

router.get('/export/evv', auth, async (req, res) => {
  try {
    const result = await db.query(`
      SELECT 
        te.id,
        te.start_time,
        te.end_time,
        CASE 
          WHEN te.duration_minutes IS NOT NULL THEN te.duration_minutes / 60.0
          WHEN te.end_time IS NOT NULL THEN 
            EXTRACT(EPOCH FROM (te.end_time - te.start_time)) / 3600.0
          ELSE 0
        END as hours,
        te.clock_in_location,
        te.clock_out_location,
        c.first_name as client_first_name,
        c.last_name as client_last_name,
        c.medicaid_id,
        u.first_name as caregiver_first_name,
        u.last_name as caregiver_last_name,
        cp.npi_number
      FROM time_entries te
      JOIN clients c ON te.client_id = c.id
      JOIN users u ON te.caregiver_id = u.id
      LEFT JOIN caregiver_profiles cp ON cp.caregiver_id = u.id
      WHERE te.start_time >= CURRENT_DATE - INTERVAL '30 days'
        AND te.is_complete = true
      ORDER BY te.start_time DESC
    `);

    const headers = [
      'ServiceDate', 'ClientFirstName', 'ClientLastName', 'MedicaidID',
      'ProviderFirstName', 'ProviderLastName', 'NPI',
      'ClockInTime', 'ClockOutTime', 'TotalHours',
      'ClockInLatitude', 'ClockInLongitude', 'ClockOutLatitude', 'ClockOutLongitude',
      'VerificationMethod'
    ];

    const rows = result.rows.map(row => {
      const clockInLoc = row.clock_in_location || {};
      const clockOutLoc = row.clock_out_location || {};
      return [
        new Date(row.start_time).toISOString().split('T')[0],
        row.client_first_name,
        row.client_last_name,
        row.medicaid_id || '',
        row.caregiver_first_name,
        row.caregiver_last_name,
        row.npi_number || '',
        new Date(row.start_time).toISOString(),
        row.end_time ? new Date(row.end_time).toISOString() : '',
        parseFloat(row.hours).toFixed(2),
        clockInLoc.latitude || clockInLoc.lat || '',
        clockInLoc.longitude || clockInLoc.lng || '',
        clockOutLoc.latitude || clockOutLoc.lat || '',
        clockOutLoc.longitude || clockOutLoc.lng || '',
        'GPS'
      ];
    });

    const csv = [
      headers.join(','),
      ...rows.map(r => r.map(cell => `"${cell}"`).join(','))
    ].join('\n');

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename=evv-export-${new Date().toISOString().split('T')[0]}.csv`);
    res.send(csv);
  } catch (error) {
    console.error('Error exporting EVV:', error);
    res.status(500).json({ error: error.message });
  }
});

// ==================== BILLING SUMMARY ====================

router.get('/billing-summary', auth, async (req, res) => {
  const { startDate, endDate } = req.query;
  
  try {
    const billedResult = await db.query(`
      SELECT 
        COUNT(*) as invoice_count,
        COALESCE(SUM(total), 0) as total_billed,
        COALESCE(SUM(amount_paid), 0) as total_collected,
        COALESCE(SUM(total - COALESCE(amount_paid, 0) - COALESCE(amount_adjusted, 0)), 0) as total_outstanding
      FROM invoices
      WHERE ($1::date IS NULL OR created_at >= $1)
        AND ($2::date IS NULL OR created_at <= $2)
    `, [startDate || null, endDate || null]);

    const byPayerResult = await db.query(`
      SELECT 
        COALESCE(rs.name, 'Private Pay') as payer,
        COUNT(*) as invoice_count,
        COALESCE(SUM(i.total), 0) as total_billed,
        COALESCE(SUM(i.amount_paid), 0) as total_collected
      FROM invoices i
      LEFT JOIN referral_sources rs ON i.referral_source_id = rs.id
      WHERE ($1::date IS NULL OR i.created_at >= $1)
        AND ($2::date IS NULL OR i.created_at <= $2)
      GROUP BY rs.name
      ORDER BY total_billed DESC
    `, [startDate || null, endDate || null]);

    const byCaregiverResult = await db.query(`
      SELECT 
        u.first_name || ' ' || u.last_name as caregiver_name,
        COALESCE(SUM(ili.hours), 0) as total_hours,
        COALESCE(SUM(ili.amount), 0) as total_billed
      FROM invoice_line_items ili
      JOIN invoices i ON ili.invoice_id = i.id
      LEFT JOIN users u ON ili.caregiver_id = u.id
      WHERE ($1::date IS NULL OR i.created_at >= $1)
        AND ($2::date IS NULL OR i.created_at <= $2)
      GROUP BY u.first_name, u.last_name
      ORDER BY total_hours DESC
    `, [startDate || null, endDate || null]);

    res.json({
      summary: billedResult.rows[0],
      byPayer: byPayerResult.rows,
      byCaregiver: byCaregiverResult.rows
    });
  } catch (error) {
    console.error('Error generating billing summary:', error);
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
