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

// Get documents for an entity
router.get('/:entityType/:entityId', auth, async (req, res) => {
  const { entityType, entityId } = req.params;
  const { documentType } = req.query;
  
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

// Get expiring documents
router.get('/reports/expiring', auth, async (req, res) => {
  const { days = 30 } = req.query;
  try {
    const result = await db.query(`
      SELECT d.*, 
        CASE 
          WHEN d.entity_type = 'caregiver' THEN (SELECT CONCAT(first_name, ' ', last_name) FROM caregiver_profiles WHERE id = d.entity_id)
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

// Get unsigned documents for a user
router.get('/unsigned/:userId', auth, async (req, res) => {
  try {
    const result = await db.query(`
      SELECT d.* FROM documents d
      WHERE d.requires_signature = true
      AND d.signed_at IS NULL
      AND (
        (d.entity_type = 'company')
        OR (d.entity_type = 'caregiver' AND d.entity_id = (SELECT id FROM caregiver_profiles WHERE user_id = $1))
      )
      ORDER BY d.created_at DESC
    `, [req.params.userId]);
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
