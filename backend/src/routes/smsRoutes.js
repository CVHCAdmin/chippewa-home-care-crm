// routes/smsRoutes.js
// SMS Notifications via Twilio

const express = require('express');
const router = express.Router();
const db = require('../db');
const auth = require('../middleware/auth');

// Initialize Twilio (set in env vars)
let twilioClient = null;
if (process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN) {
  const twilio = require('twilio');
  twilioClient = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
}

// ==================== MESSAGES ====================

// Get all messages (for admin view)
router.get('/messages', auth, async (req, res) => {
  const { direction, status, limit = 100 } = req.query;
  try {
    let query = `
      SELECT sm.*,
        CASE 
          WHEN sm.recipient_type = 'caregiver' THEN (SELECT CONCAT(first_name, ' ', last_name) FROM caregiver_profiles WHERE id = sm.recipient_id)
          WHEN sm.recipient_type = 'client' THEN (SELECT CONCAT(first_name, ' ', last_name) FROM clients WHERE id = sm.recipient_id)
          ELSE NULL
        END as recipient_name
      FROM sms_messages sm
      WHERE 1=1
    `;
    const params = [];

    if (direction) {
      params.push(direction);
      query += ` AND sm.direction = $${params.length}`;
    }
    if (status) {
      params.push(status);
      query += ` AND sm.status = $${params.length}`;
    }

    params.push(limit);
    query += ` ORDER BY sm.created_at DESC LIMIT $${params.length}`;

    const result = await db.query(query, params);
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Send single SMS
router.post('/send', auth, async (req, res) => {
  const { to, body, recipientType, recipientId } = req.body;
  
  try {
    let phone = to;
    
    // Get phone number from recipient if not provided
    if (!phone && recipientType && recipientId) {
      let phoneQuery;
      if (recipientType === 'caregiver') {
        phoneQuery = await db.query('SELECT phone FROM caregiver_profiles WHERE id = $1', [recipientId]);
      } else if (recipientType === 'client') {
        phoneQuery = await db.query('SELECT phone FROM clients WHERE id = $1', [recipientId]);
      }
      if (phoneQuery?.rows[0]?.phone) {
        phone = phoneQuery.rows[0].phone;
      }
    }

    if (!phone) {
      return res.status(400).json({ error: 'No phone number provided' });
    }

    // Log the message
    const smsRecord = await db.query(`
      INSERT INTO sms_messages (recipient_type, recipient_id, to_number, from_number, body, direction, status)
      VALUES ($1, $2, $3, $4, $5, 'outbound', 'pending')
      RETURNING *
    `, [recipientType || null, recipientId || null, phone, process.env.TWILIO_PHONE_NUMBER, body]);

    // Send via Twilio
    if (twilioClient && process.env.TWILIO_PHONE_NUMBER) {
      try {
        const twilioMessage = await twilioClient.messages.create({
          body: body,
          from: process.env.TWILIO_PHONE_NUMBER,
          to: phone
        });

        await db.query(`
          UPDATE sms_messages 
          SET status = 'sent', twilio_sid = $1, sent_at = NOW()
          WHERE id = $2
        `, [twilioMessage.sid, smsRecord.rows[0].id]);

        res.json({ success: true, sid: twilioMessage.sid, messageId: smsRecord.rows[0].id });
      } catch (twilioError) {
        await db.query(`
          UPDATE sms_messages SET status = 'failed', error_message = $1 WHERE id = $2
        `, [twilioError.message, smsRecord.rows[0].id]);
        res.status(500).json({ error: 'SMS send failed', details: twilioError.message });
      }
    } else {
      // No Twilio configured - just log it
      await db.query(`UPDATE sms_messages SET status = 'logged' WHERE id = $1`, [smsRecord.rows[0].id]);
      res.json({ success: true, messageId: smsRecord.rows[0].id, sid: 'NO_TWILIO', note: 'Twilio not configured - message logged only' });
    }
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Send bulk SMS
router.post('/send-bulk', auth, async (req, res) => {
  const { recipientType, recipientIds, body } = req.body;
  
  try {
    const results = { sent: 0, failed: 0, errors: [] };

    for (const recipientId of recipientIds) {
      try {
        let phoneQuery;
        if (recipientType === 'caregiver') {
          phoneQuery = await db.query('SELECT id, phone, first_name, last_name FROM caregiver_profiles WHERE id = $1', [recipientId]);
        } else if (recipientType === 'client') {
          phoneQuery = await db.query('SELECT id, phone, first_name, last_name FROM clients WHERE id = $1', [recipientId]);
        }

        if (!phoneQuery?.rows[0]?.phone) {
          results.failed++;
          results.errors.push({ recipientId, error: 'No phone number' });
          continue;
        }

        const phone = phoneQuery.rows[0].phone;

        // Log message
        const smsRecord = await db.query(`
          INSERT INTO sms_messages (recipient_type, recipient_id, to_number, from_number, body, direction, status)
          VALUES ($1, $2, $3, $4, $5, 'outbound', 'pending')
          RETURNING id
        `, [recipientType, recipientId, phone, process.env.TWILIO_PHONE_NUMBER, body]);

        // Send via Twilio
        if (twilioClient && process.env.TWILIO_PHONE_NUMBER) {
          const twilioMessage = await twilioClient.messages.create({
            body: body,
            from: process.env.TWILIO_PHONE_NUMBER,
            to: phone
          });

          await db.query(`
            UPDATE sms_messages SET status = 'sent', twilio_sid = $1, sent_at = NOW() WHERE id = $2
          `, [twilioMessage.sid, smsRecord.rows[0].id]);
        } else {
          await db.query(`UPDATE sms_messages SET status = 'logged' WHERE id = $1`, [smsRecord.rows[0].id]);
        }

        results.sent++;
      } catch (err) {
        results.failed++;
        results.errors.push({ recipientId, error: err.message });
      }
    }

    res.json(results);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ==================== TEMPLATES ====================

// Get all templates
router.get('/templates', auth, async (req, res) => {
  try {
    const result = await db.query('SELECT * FROM sms_templates WHERE is_active = true ORDER BY name');
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Create template
router.post('/templates', auth, async (req, res) => {
  const { name, body, category, variables } = req.body;
  try {
    const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '_');
    const result = await db.query(`
      INSERT INTO sms_templates (name, slug, body, category, variables)
      VALUES ($1, $2, $3, $4, $5)
      RETURNING *
    `, [name, slug, body, category || 'general', variables]);
    res.json(result.rows[0]);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Update template
router.put('/templates/:id', auth, async (req, res) => {
  const { name, body, category, variables } = req.body;
  try {
    const result = await db.query(`
      UPDATE sms_templates SET
        name = COALESCE($1, name),
        body = COALESCE($2, body),
        category = COALESCE($3, category),
        variables = COALESCE($4, variables),
        updated_at = NOW()
      WHERE id = $5
      RETURNING *
    `, [name, body, category, variables, req.params.id]);
    res.json(result.rows[0]);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Delete template
router.delete('/templates/:id', auth, async (req, res) => {
  try {
    await db.query('UPDATE sms_templates SET is_active = false WHERE id = $1', [req.params.id]);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ==================== LEGACY/COMPATIBILITY ====================

// Get SMS history (legacy endpoint)
router.get('/history', auth, async (req, res) => {
  const { recipientType, recipientId, limit = 50 } = req.query;
  try {
    let query = `SELECT * FROM sms_messages WHERE 1=1`;
    const params = [];

    if (recipientType) {
      params.push(recipientType);
      query += ` AND recipient_type = $${params.length}`;
    }
    if (recipientId) {
      params.push(recipientId);
      query += ` AND recipient_id = $${params.length}`;
    }

    params.push(limit);
    query += ` ORDER BY created_at DESC LIMIT $${params.length}`;

    const result = await db.query(query, params);
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Broadcast to caregivers (legacy endpoint)
router.post('/broadcast', auth, async (req, res) => {
  const { caregiverIds, message } = req.body;
  return router.handle({ 
    ...req, 
    body: { recipientType: 'caregiver', recipientIds: caregiverIds, body: message }
  }, res);
});

// ==================== WEBHOOKS & AUTOMATION ====================

// Send shift reminders (called by cron job)
router.post('/shift-reminders', auth, async (req, res) => {
  try {
    const schedules = await db.query(`
      SELECT s.*, 
        cp.id as caregiver_id, cp.phone, cp.first_name as cg_first,
        c.first_name as client_first, c.last_name as client_last
      FROM schedules s
      JOIN caregiver_profiles cp ON s.caregiver_id = cp.id
      JOIN clients c ON s.client_id = c.id
      WHERE s.scheduled_date = CURRENT_DATE + INTERVAL '1 day'
      AND s.status = 'scheduled'
      AND cp.sms_enabled = true
    `);

    let sent = 0;
    for (const schedule of schedules.rows) {
      if (!schedule.phone) continue;

      const message = `Reminder: You have a shift with ${schedule.client_first} ${schedule.client_last} tomorrow at ${schedule.start_time}.`;
      
      await db.query(`
        INSERT INTO sms_messages (recipient_type, recipient_id, to_number, body, direction, status, sent_at)
        VALUES ('caregiver', $1, $2, $3, 'outbound', 'sent', NOW())
      `, [schedule.caregiver_id, schedule.phone, message]);

      if (twilioClient && process.env.TWILIO_PHONE_NUMBER) {
        await twilioClient.messages.create({
          body: message,
          from: process.env.TWILIO_PHONE_NUMBER,
          to: schedule.phone
        });
      }
      sent++;
    }

    res.json({ sent, total: schedules.rows.length });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Twilio webhook for incoming messages
router.post('/webhook/incoming', async (req, res) => {
  const { From, Body } = req.body;
  
  try {
    await db.query(`
      INSERT INTO sms_messages (from_number, body, direction, status)
      VALUES ($1, $2, 'inbound', 'received')
    `, [From, Body]);

    res.type('text/xml');
    res.send('<?xml version="1.0" encoding="UTF-8"?><Response></Response>');
  } catch (error) {
    console.error('SMS webhook error:', error);
    res.type('text/xml');
    res.send('<?xml version="1.0" encoding="UTF-8"?><Response></Response>');
  }
});

module.exports = router;
