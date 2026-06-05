// routes/documentsRoutes.js
// Document Storage - I-9, W-4, Policies, etc.

const express = require('express');
const router = express.Router();
const db = require('../db');
const auth = require('../middleware/auth');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

// Configure multer for file uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadDir = process.env.UPLOAD_DIR || './uploads';
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, uniqueSuffix + path.extname(file.originalname));
  }
});

const upload = multer({ 
  storage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
  fileFilter: (req, file, cb) => {
    const allowed = ['.pdf', '.doc', '.docx', '.jpg', '.jpeg', '.png', '.gif'];
    const ext = path.extname(file.originalname).toLowerCase();
    if (allowed.includes(ext)) {
      cb(null, true);
    } else {
      cb(new Error('Invalid file type'));
    }
  }
});

// Get all documents (with optional filters)
router.get('/', auth, async (req, res) => {
  const { entityType, entityId, documentType } = req.query;
  try {
    let query = `
      SELECT d.*, 
        u.first_name as uploaded_by_first, u.last_name as uploaded_by_last,
        CASE 
          WHEN d.entity_type = 'caregiver' THEN (SELECT CONCAT(first_name, ' ', last_name) FROM users WHERE id = d.entity_id)
          WHEN d.entity_type = 'client' THEN (SELECT CONCAT(first_name, ' ', last_name) FROM clients WHERE id = d.entity_id)
          ELSE 'Company'
        END as entity_name
      FROM documents d
      LEFT JOIN users u ON d.uploaded_by = u.id
      WHERE 1=1
    `;
    const params = [];

    if (entityType) {
      params.push(entityType);
      query += ` AND d.entity_type = $${params.length}`;
    }
    if (entityId) {
      params.push(entityId);
      query += ` AND d.entity_id = $${params.length}`;
    }
    if (documentType) {
      params.push(documentType);
      query += ` AND d.document_type = $${params.length}`;
    }

    query += ` ORDER BY d.created_at DESC`;
    
    const result = await db.query(query, params);
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get expiring documents (MUST be before /:entityType/:entityId)
router.get('/reports/expiring', auth, async (req, res) => {
  const { days = 30 } = req.query;
  try {
    const result = await db.query(`
      SELECT d.*,
        CASE
          WHEN d.entity_type = 'caregiver' THEN (SELECT CONCAT(first_name, ' ', last_name) FROM users WHERE id = d.entity_id)
          WHEN d.entity_type = 'client' THEN (SELECT CONCAT(first_name, ' ', last_name) FROM clients WHERE id = d.entity_id)
          ELSE 'Company'
        END as entity_name
      FROM documents d
      WHERE d.expiration_date IS NOT NULL
      AND d.expiration_date <= CURRENT_DATE + $1::integer
      AND d.expiration_date >= CURRENT_DATE
      ORDER BY d.expiration_date ASC
    `, [days]);
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get unsigned documents for a user (MUST be before /:entityType/:entityId)
router.get('/unsigned/:userId', auth, async (req, res) => {
  // IDOR fix: only the caregiver themselves or an admin may view their unsigned
  // compliance documents (HR/I-9/etc).
  if (req.user?.role !== 'admin' && req.user?.id !== req.params.userId) {
    return res.status(403).json({ error: 'Not allowed' });
  }
  try {
    const result = await db.query(`
      SELECT d.* FROM documents d
      WHERE d.requires_signature = true
      AND d.signed_at IS NULL
      AND (
        (d.entity_type = 'company')
        OR (d.entity_type = 'caregiver' AND d.entity_id = $1)
      )
      ORDER BY d.created_at DESC
    `, [req.params.userId]);
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get documents for an entity
router.get('/:entityType/:entityId', auth, async (req, res) => {
  const { entityType, entityId } = req.params;
  const { documentType } = req.query;

  // IDOR fix: admin can read anyone's, otherwise only the entity owner.
  // For 'caregiver' entity: must be the caregiver themselves.
  // For 'client' entity: not exposed to non-admin (client portal has its own route).
  // For 'company': allowed for any authenticated user (shared company docs).
  if (req.user?.role !== 'admin') {
    if (entityType === 'caregiver') {
      if (req.user?.id !== entityId) return res.status(403).json({ error: 'Not allowed' });
    } else if (entityType !== 'company') {
      return res.status(403).json({ error: 'Not allowed' });
    }
  }

  try {
    let query = `
      SELECT d.*, u.first_name as uploaded_by_name
      FROM documents d
      LEFT JOIN users u ON d.uploaded_by = u.id
      WHERE d.entity_type = $1 AND d.entity_id = $2
    `;
    const params = [entityType, entityId];

    if (documentType) {
      params.push(documentType);
      query += ` AND d.document_type = $${params.length}`;
    }

    query += ` ORDER BY d.created_at DESC`;

    const result = await db.query(query, params);
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Upload document
router.post('/upload', auth, upload.single('file'), async (req, res) => {
  const { entityType, entityId, documentType, name, description, requiresSignature, expirationDate, isConfidential } = req.body;
  
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    const fileUrl = `/uploads/${req.file.filename}`;
    const fileType = path.extname(req.file.originalname).slice(1);

    const result = await db.query(`
      INSERT INTO documents 
      (entity_type, entity_id, document_type, name, description, file_url, file_type, file_size, requires_signature, expiration_date, is_confidential, uploaded_by)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
      RETURNING *
    `, [entityType, entityId, documentType, name || req.file.originalname, description, fileUrl, fileType, req.file.size, requiresSignature === 'true', expirationDate || null, isConfidential === 'true', req.user.id]);

    res.json(result.rows[0]);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ─── eSIGNATURE ─────────────────────────────────────────────────────────────
// POST /api/documents/:id/sign
// Body: { signatureImageBase64, signerRole?, typedName? }
router.post('/:id/sign', auth, async (req, res) => {
  const { signatureImageBase64, signerRole, typedName } = req.body;
  if (!signatureImageBase64 || !signatureImageBase64.startsWith('data:image')) {
    return res.status(400).json({ error: 'signatureImageBase64 (data URI) is required' });
  }
  if (signatureImageBase64.length > 2_000_000) {
    return res.status(400).json({ error: 'Signature image too large (max ~1.5MB)' });
  }
  try {
    const doc = await db.query(
      `SELECT id, entity_type, entity_id, requires_signature FROM documents WHERE id = $1`,
      [req.params.id]
    );
    if (doc.rows.length === 0) return res.status(404).json({ error: 'Document not found' });

    // Authz: admin can sign any; the entity owner can sign their own
    const d = doc.rows[0];
    if (req.user?.role !== 'admin') {
      if (d.entity_type === 'caregiver' && d.entity_id !== req.user.id) {
        return res.status(403).json({ error: 'Not allowed to sign this document' });
      }
      if (d.entity_type !== 'caregiver' && d.entity_type !== 'company') {
        return res.status(403).json({ error: 'Not allowed to sign this document' });
      }
    }

    const ip = (req.headers['x-forwarded-for'] || req.connection?.remoteAddress || '').toString().slice(0, 45);
    const ua = (req.headers['user-agent'] || '').toString().slice(0, 300);

    // Update the document's latest-signature columns
    const updated = await db.query(
      `UPDATE documents
          SET signed_at = NOW(),
              signed_by = $2,
              signature_image_base64 = $3,
              signature_ip = $4,
              signature_user_agent = $5,
              signature_typed_name = $6,
              updated_at = NOW()
        WHERE id = $1
        RETURNING id, signed_at, signed_by, signature_typed_name`,
      [req.params.id, req.user.id, signatureImageBase64, ip, ua, typedName || null]
    );

    // Append to history table for audit
    await db.query(
      `INSERT INTO document_signatures
       (document_id, signed_by, signer_role, signer_typed_name, signature_image_base64, ip_address, user_agent)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [req.params.id, req.user.id, signerRole || null, typedName || null, signatureImageBase64, ip, ua]
    );

    res.json({ success: true, document: updated.rows[0] });
  } catch (error) {
    console.error('[documents/sign]', error);
    res.status(500).json({ error: error.message });
  }
});

// GET /api/documents/:id/signatures — list signature history
router.get('/:id/signatures', auth, async (req, res) => {
  try {
    const result = await db.query(
      `SELECT ds.id, ds.signer_role, ds.signer_typed_name, ds.signed_at, ds.ip_address,
              u.first_name, u.last_name, u.email
         FROM document_signatures ds
         LEFT JOIN users u ON ds.signed_by = u.id
        WHERE ds.document_id = $1
        ORDER BY ds.signed_at DESC`,
      [req.params.id]
    );
    res.json(result.rows);
  } catch (error) { res.status(500).json({ error: error.message }); }
});

// Delete document
router.delete('/:id', auth, async (req, res) => {
  try {
    const doc = await db.query('SELECT file_url FROM documents WHERE id = $1', [req.params.id]);
    
    if (doc.rows[0]?.file_url) {
      const filePath = path.join(process.env.UPLOAD_DIR || './uploads', path.basename(doc.rows[0].file_url));
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }
    }

    await db.query('DELETE FROM documents WHERE id = $1', [req.params.id]);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Sign/acknowledge document
router.post('/:id/acknowledge', auth, async (req, res) => {
  const { signatureData } = req.body;
  
  try {
    await db.query(`
      INSERT INTO document_acknowledgments (document_id, user_id, ip_address, signature_data)
      VALUES ($1, $2, $3, $4)
    `, [req.params.id, req.user.id, req.ip, signatureData]);

    await db.query(`
      UPDATE documents SET signed_at = NOW(), signed_by = $1
      WHERE id = $2
    `, [req.user.id, req.params.id]);

    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;