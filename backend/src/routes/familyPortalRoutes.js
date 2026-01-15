// routes/familyPortalRoutes.js
// Family Portal - Allow families to view client info

const express = require('express');
const router = express.Router();
const db = require('../db');
const auth = require('../middleware/auth');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

// ==================== ADMIN ENDPOINTS ====================

// Get all family members (admin view)
router.get('/admin/members', auth, async (req, res) => {
  const { status, clientId } = req.query;
  try {
    let query = `
      SELECT fm.*, 
        c.first_name as client_first_name, c.last_name as client_last_name,
        u.email as login_email
      FROM family_members fm
      JOIN clients c ON fm.client_id = c.id
      LEFT JOIN users u ON fm.user_id = u.id
      WHERE 1=1
    `;
    const params = [];

    if (status === 'active') {
      query += ` AND fm.is_active = true`;
    } else if (status === 'inactive') {
      query += ` AND fm.is_active = false`;
    }

    if (clientId) {
      params.push(clientId);
      query += ` AND fm.client_id = $${params.length}`;
    }

    query += ` ORDER BY c.last_name, c.first_name, fm.is_primary_contact DESC`;
    
    const result = await db.query(query, params);
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Add family member (admin)
router.post('/admin/members', auth, async (req, res) => {
  const { 
    clientId, firstName, lastName, email, phone, relationship, password,
    canViewSchedule, canViewCarePlan, canViewMedications, canMessage 
  } = req.body;
  
  try {
    let userId = null;

    // Create user account for portal access
    if (email && password) {
      const hashedPassword = await bcrypt.hash(password, 10);
      
      const userResult = await db.query(`
        INSERT INTO users (email, password, first_name, last_name, role, status)
        VALUES ($1, $2, $3, $4, 'family', 'active')
        RETURNING id
      `, [email, hashedPassword, firstName, lastName]);
      
      userId = userResult.rows[0].id;
    }

    const result = await db.query(`
      INSERT INTO family_members 
      (client_id, user_id, first_name, last_name, email, phone, relationship, 
       can_view_schedule, can_view_care_plan, can_view_medications, can_message, is_active)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, true)
      RETURNING *
    `, [
      clientId, userId, firstName, lastName, email, phone, relationship,
      canViewSchedule !== false, canViewCarePlan !== false, 
      canViewMedications === true, canMessage !== false
    ]);

    res.json(result.rows[0]);
  } catch (error) {
    if (error.code === '23505') {
      res.status(400).json({ error: 'Email already exists' });
    } else {
      res.status(500).json({ error: error.message });
    }
  }
});

// Update family member status (admin)
router.put('/admin/members/:id/status', auth, async (req, res) => {
  const { isActive } = req.body;
  try {
    await db.query(`
      UPDATE family_members SET is_active = $1, updated_at = NOW() WHERE id = $2
    `, [isActive, req.params.id]);

    // Also update user status if linked
    const fm = await db.query('SELECT user_id FROM family_members WHERE id = $1', [req.params.id]);
    if (fm.rows[0]?.user_id) {
      await db.query(`
        UPDATE users SET status = $1 WHERE id = $2
      `, [isActive ? 'active' : 'inactive', fm.rows[0].user_id]);
    }

    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Reset family member password (admin)
router.put('/admin/members/:id/reset-password', auth, async (req, res) => {
  const { password } = req.body;
  try {
    const fm = await db.query('SELECT user_id FROM family_members WHERE id = $1', [req.params.id]);
    if (!fm.rows[0]?.user_id) {
      return res.status(400).json({ error: 'No user account linked to this family member' });
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    await db.query('UPDATE users SET password = $1 WHERE id = $2', [hashedPassword, fm.rows[0].user_id]);
    
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get all family messages (admin)
router.get('/admin/messages', auth, async (req, res) => {
  try {
    const result = await db.query(`
      SELECT fm.*, 
        fam.first_name as sender_first_name, fam.last_name as sender_last_name,
        c.first_name as client_first_name, c.last_name as client_last_name
      FROM family_messages fm
      JOIN family_members fam ON fm.family_member_id = fam.id
      JOIN clients c ON fm.client_id = c.id
      WHERE fm.direction = 'inbound'
      ORDER BY fm.is_read ASC, fm.created_at DESC
    `);
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Reply to family message (admin)
router.post('/admin/messages/:id/reply', auth, async (req, res) => {
  const { reply } = req.body;
  try {
    // Mark original as read and add reply
    await db.query(`
      UPDATE family_messages 
      SET is_read = true, reply = $1, replied_at = NOW(), replied_by = $2
      WHERE id = $3
    `, [reply, req.user.id, req.params.id]);

    // Get original message details for creating reply record
    const original = await db.query('SELECT * FROM family_messages WHERE id = $1', [req.params.id]);
    if (original.rows[0]) {
      await db.query(`
        INSERT INTO family_messages (client_id, family_member_id, direction, message)
        VALUES ($1, $2, 'outbound', $3)
      `, [original.rows[0].client_id, original.rows[0].family_member_id, reply]);
    }

    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Update family member (admin)
router.put('/admin/members/:id', auth, async (req, res) => {
  const { firstName, lastName, email, phone, relationship, canViewSchedule, canViewCarePlan, canViewMedications, canMessage } = req.body;
  
  try {
    const result = await db.query(`
      UPDATE family_members SET
        first_name = COALESCE($1, first_name),
        last_name = COALESCE($2, last_name),
        email = COALESCE($3, email),
        phone = COALESCE($4, phone),
        relationship = COALESCE($5, relationship),
        can_view_schedule = COALESCE($6, can_view_schedule),
        can_view_care_plan = COALESCE($7, can_view_care_plan),
        can_view_medications = COALESCE($8, can_view_medications),
        can_message = COALESCE($9, can_message),
        updated_at = NOW()
      WHERE id = $10
      RETURNING *
    `, [firstName, lastName, email, phone, relationship, canViewSchedule, canViewCarePlan, canViewMedications, canMessage, req.params.id]);
    res.json(result.rows[0]);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get family members for a specific client (admin)
router.get('/client/:clientId/members', auth, async (req, res) => {
  try {
    const result = await db.query(`
      SELECT fm.*, u.email as login_email
      FROM family_members fm
      LEFT JOIN users u ON fm.user_id = u.id
      WHERE fm.client_id = $1
      ORDER BY fm.is_primary_contact DESC, fm.first_name
    `, [req.params.clientId]);
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ==================== FAMILY PORTAL ENDPOINTS ====================

// Family login
router.post('/login', async (req, res) => {
  const { email, password } = req.body;
  
  try {
    const user = await db.query(`
      SELECT u.*, fm.id as family_member_id, fm.client_id
      FROM users u
      JOIN family_members fm ON fm.user_id = u.id
      WHERE u.email = $1 AND u.role = 'family' AND u.status = 'active'
    `, [email]);

    if (user.rows.length === 0) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const valid = await bcrypt.compare(password, user.rows[0].password);
    if (!valid) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    // Update last login
    await db.query('UPDATE family_members SET last_login = NOW() WHERE user_id = $1', [user.rows[0].id]);

    const token = jwt.sign(
      { id: user.rows[0].id, role: 'family', clientId: user.rows[0].client_id, familyMemberId: user.rows[0].family_member_id },
      process.env.JWT_SECRET,
      { expiresIn: '24h' }
    );

    res.json({ token, user: { ...user.rows[0], password: undefined } });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Family middleware
const familyAuth = async (req, res, next) => {
  try {
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) return res.status(401).json({ error: 'No token' });

    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    if (decoded.role !== 'family') return res.status(403).json({ error: 'Access denied' });

    const fm = await db.query('SELECT * FROM family_members WHERE id = $1 AND is_active = true', [decoded.familyMemberId]);
    if (fm.rows.length === 0) return res.status(403).json({ error: 'Access denied' });

    req.familyMember = fm.rows[0];
    req.clientId = decoded.clientId;
    next();
  } catch (error) {
    res.status(401).json({ error: 'Invalid token' });
  }
};

// Get client info (for family)
router.get('/portal/client', familyAuth, async (req, res) => {
  try {
    const result = await db.query(`
      SELECT id, first_name, last_name, date_of_birth, address, city, state, zip, phone
      FROM clients WHERE id = $1
    `, [req.clientId]);
    res.json(result.rows[0]);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get schedule (for family)
router.get('/portal/schedule', familyAuth, async (req, res) => {
  if (!req.familyMember.can_view_schedule) {
    return res.status(403).json({ error: 'Access denied' });
  }

  try {
    const result = await db.query(`
      SELECT s.*, cp.first_name as caregiver_first, cp.last_name as caregiver_last
      FROM schedules s
      LEFT JOIN caregiver_profiles cp ON s.caregiver_id = cp.id
      WHERE s.client_id = $1 AND s.scheduled_date >= CURRENT_DATE
      ORDER BY s.scheduled_date, s.start_time
    `, [req.clientId]);
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get care plan (for family)
router.get('/portal/care-plan', familyAuth, async (req, res) => {
  if (!req.familyMember.can_view_care_plan) {
    return res.status(403).json({ error: 'Access denied' });
  }

  try {
    const result = await db.query(`
      SELECT * FROM care_plans WHERE client_id = $1 AND status = 'active'
      ORDER BY created_at DESC LIMIT 1
    `, [req.clientId]);
    res.json(result.rows[0] || null);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get medications (for family)
router.get('/portal/medications', familyAuth, async (req, res) => {
  if (!req.familyMember.can_view_medications) {
    return res.status(403).json({ error: 'Access denied' });
  }

  try {
    const result = await db.query(`
      SELECT * FROM client_medications WHERE client_id = $1 AND is_active = true
      ORDER BY medication_name
    `, [req.clientId]);
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get visit notes (for family)
router.get('/portal/notes', familyAuth, async (req, res) => {
  if (!req.familyMember.can_view_care_plan) {
    return res.status(403).json({ error: 'Access denied' });
  }

  try {
    const result = await db.query(`
      SELECT te.id, te.clock_in, te.clock_out, te.hours, te.notes,
        cp.first_name as caregiver_first, cp.last_name as caregiver_last
      FROM time_entries te
      JOIN caregiver_profiles cp ON te.caregiver_id = cp.id
      WHERE te.client_id = $1 AND te.status = 'approved'
      ORDER BY te.clock_in DESC
      LIMIT 30
    `, [req.clientId]);
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Send message to admin (family)
router.post('/portal/messages', familyAuth, async (req, res) => {
  if (!req.familyMember.can_message) {
    return res.status(403).json({ error: 'Access denied' });
  }

  const { subject, message } = req.body;
  
  try {
    const result = await db.query(`
      INSERT INTO family_messages (client_id, family_member_id, direction, subject, message)
      VALUES ($1, $2, 'inbound', $3, $4)
      RETURNING *
    `, [req.clientId, req.familyMember.id, subject, message]);
    res.json(result.rows[0]);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get messages (family)
router.get('/portal/messages', familyAuth, async (req, res) => {
  try {
    const result = await db.query(`
      SELECT * FROM family_messages
      WHERE client_id = $1 AND family_member_id = $2
      ORDER BY created_at DESC
      LIMIT 50
    `, [req.clientId, req.familyMember.id]);
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
