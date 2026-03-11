// routes/paymentsRoutes.js
// Payment reconciliation: AI check scanner, auto-matching, reconciliation log

const express = require('express');
const router = express.Router();
const db = require('../db');
const auth = require('../middleware/auth');
const requireAdmin = require('../middleware/authorizeAdmin');
const { v4: uuidv4 } = require('uuid');
const multer = require('multer');
const fs = require('fs');
const path = require('path');

const upload = multer({
  dest: '/tmp/check-scans/',
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    cb(null, ['image/jpeg', 'image/png', 'image/webp'].includes(file.mimetype));
  }
});

// ─── AI CHECK SCANNER ────────────────────────────────────────────────────────
// Uses Claude AI vision to extract check/remittance data from an image
router.post('/scan-check', auth, requireAdmin, upload.single('check'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No image uploaded' });

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      // Clean up temp file
      try { fs.unlinkSync(req.file.path); } catch (e) {}
      return res.status(400).json({
        error: 'ANTHROPIC_API_KEY not configured',
        setup: 'Add ANTHROPIC_API_KEY to your environment variables'
      });
    }

    // Read image as base64
    const imageBuffer = fs.readFileSync(req.file.path);
    const base64Image = imageBuffer.toString('base64');
    const mediaType = req.file.mimetype;

    // Clean up temp file
    try { fs.unlinkSync(req.file.path); } catch (e) {}

    // Call Claude Vision API
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 1024,
        messages: [{
          role: 'user',
          content: [
            {
              type: 'image',
              source: {
                type: 'base64',
                media_type: mediaType,
                data: base64Image,
              }
            },
            {
              type: 'text',
              text: `Analyze this check/remittance image. Extract the following information and return ONLY valid JSON (no markdown, no explanation):
{
  "payerName": "name of the paying organization",
  "amount": 0.00,
  "checkNumber": "check number",
  "checkDate": "YYYY-MM-DD",
  "remittanceInfo": "any EOB details, claim references, member IDs, or service dates visible",
  "confidence": "high/medium/low"
}
If a field is not visible, use null.`
            }
          ]
        }]
      })
    });

    if (!response.ok) {
      const errData = await response.json().catch(() => ({}));
      return res.status(500).json({ error: 'AI analysis failed', details: errData });
    }

    const aiResult = await response.json();
    const textContent = aiResult.content?.[0]?.text || '{}';

    // Parse the JSON from Claude's response
    let extracted;
    try {
      // Try to extract JSON from the response (handles markdown code blocks)
      const jsonMatch = textContent.match(/\{[\s\S]*\}/);
      extracted = JSON.parse(jsonMatch ? jsonMatch[0] : textContent);
    } catch (e) {
      extracted = {
        payerName: null,
        amount: null,
        checkNumber: null,
        checkDate: null,
        remittanceInfo: textContent,
        confidence: 'low'
      };
    }

    // Try to match payer
    let suggestedPayer = null;
    if (extracted.payerName) {
      const words = extracted.payerName.toLowerCase().split(/\s+/).filter(w => w.length > 2);
      for (const word of words) {
        const match = await db.query(
          `SELECT id, name, payer_type FROM referral_sources WHERE LOWER(name) LIKE $1 AND is_active_payer = true LIMIT 1`,
          [`%${word}%`]
        );
        if (match.rows.length) {
          suggestedPayer = match.rows[0];
          break;
        }
      }
    }

    // Try to auto-match claims if we have payer and amount
    let suggestedMatches = [];
    if (suggestedPayer && extracted.amount) {
      const openClaims = await db.query(`
        SELECT c.id, c.claim_number, c.charge_amount, c.service_date,
          cl.first_name as client_first, cl.last_name as client_last
        FROM claims c
        JOIN clients cl ON c.client_id = cl.id
        WHERE c.payer_id = $1
          AND c.status IN ('submitted', 'accepted')
        ORDER BY c.service_date DESC
        LIMIT 20
      `, [suggestedPayer.id]);

      // Try exact amount match
      const totalAmount = parseFloat(extracted.amount);
      let remaining = totalAmount;
      for (const claim of openClaims.rows) {
        const amt = parseFloat(claim.charge_amount);
        if (amt <= remaining + 0.01) {
          suggestedMatches.push({
            claimId: claim.id,
            claimNumber: claim.claim_number,
            chargeAmount: amt,
            clientName: `${claim.client_first} ${claim.client_last}`,
            serviceDate: claim.service_date,
          });
          remaining -= amt;
          if (remaining < 0.01) break;
        }
      }
    }

    res.json({
      extracted,
      suggestedPayer,
      suggestedMatches,
      unmatchedAmount: extracted.amount
        ? Math.max(0, parseFloat(extracted.amount) - suggestedMatches.reduce((s, m) => s + m.chargeAmount, 0))
        : null,
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ─── RECORD PAYMENT ──────────────────────────────────────────────────────────
router.post('/', auth, requireAdmin, async (req, res) => {
  try {
    const {
      payerId, payerName, checkNumber, checkDate, checkAmount,
      paymentDate, paymentMethod, notes, claimMatches
    } = req.body;

    if (!checkAmount) return res.status(400).json({ error: 'Payment amount is required' });

    const paymentId = uuidv4();
    let totalMatched = 0;
    let underpayment = 0;

    // Create payment record
    const payment = await db.query(`
      INSERT INTO payments (
        id, payer_id, payer_name, check_number, check_date,
        check_amount, payment_date, payment_method, reconciliation_notes,
        created_by
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
      RETURNING *
    `, [
      paymentId, payerId || null, payerName || 'Unknown',
      checkNumber || null, checkDate || null,
      checkAmount, paymentDate || new Date().toISOString().split('T')[0],
      paymentMethod || 'check', notes || null, req.user.id
    ]);

    // Match to claims
    if (claimMatches && claimMatches.length > 0) {
      for (const match of claimMatches) {
        const matchedAmount = parseFloat(match.amount || match.chargeAmount || 0);
        totalMatched += matchedAmount;

        // Create match record
        await db.query(`
          INSERT INTO payment_claim_matches (id, payment_id, claim_id, matched_amount, match_type)
          VALUES ($1, $2, $3, $4, $5)
        `, [uuidv4(), paymentId, match.claimId, matchedAmount, match.matchType || 'manual']);

        // Update claim status
        const claim = await db.query('SELECT charge_amount FROM claims WHERE id = $1', [match.claimId]);
        const chargeAmt = parseFloat(claim.rows[0]?.charge_amount || 0);

        if (matchedAmount < chargeAmt - 0.01) {
          // Underpayment
          await db.query(`
            UPDATE claims SET
              status = 'paid', paid_amount = $1, paid_date = $2,
              check_number = $3, eob_notes = COALESCE(eob_notes, '') || $4,
              updated_at = NOW()
            WHERE id = $5
          `, [matchedAmount, paymentDate || new Date(), checkNumber,
            `\nUnderpayment: billed $${chargeAmt.toFixed(2)}, paid $${matchedAmount.toFixed(2)}`,
            match.claimId]);
          underpayment += (chargeAmt - matchedAmount);
        } else {
          await db.query(`
            UPDATE claims SET
              status = 'paid', paid_amount = $1, paid_date = $2,
              check_number = $3, updated_at = NOW()
            WHERE id = $4
          `, [matchedAmount, paymentDate || new Date(), checkNumber, match.claimId]);
        }

        // Log status change
        await db.query(`
          INSERT INTO claim_status_history (id, claim_id, status, notes, created_by)
          VALUES ($1, $2, 'paid', $3, $4)
        `, [uuidv4(), match.claimId,
          `Payment recorded: Check #${checkNumber || 'N/A'}, Amount: $${matchedAmount.toFixed(2)}`,
          req.user.id]);
      }
    }

    // Update payment totals
    const checkAmt = parseFloat(checkAmount);
    await db.query(`
      UPDATE payments SET
        total_matched = $1,
        underpayment_amount = $2,
        overpayment_amount = $3,
        reconciliation_status = $4,
        updated_at = NOW()
      WHERE id = $5
    `, [
      totalMatched,
      underpayment,
      Math.max(0, checkAmt - totalMatched),
      totalMatched >= checkAmt - 0.01 ? 'reconciled' : 'partial',
      paymentId
    ]);

    res.json({
      payment: payment.rows[0],
      totalMatched,
      underpayment,
      unmatched: Math.max(0, checkAmt - totalMatched),
      claimsUpdated: claimMatches?.length || 0,
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ─── GET ALL PAYMENTS ────────────────────────────────────────────────────────
router.get('/', auth, requireAdmin, async (req, res) => {
  try {
    const { status, payerId, startDate, endDate } = req.query;
    let query = `
      SELECT p.*,
        rs.name as payer_display_name,
        (SELECT COUNT(*) FROM payment_claim_matches WHERE payment_id = p.id) as match_count
      FROM payments p
      LEFT JOIN referral_sources rs ON p.payer_id = rs.id
      WHERE 1=1
    `;
    const params = [];

    if (status) { params.push(status); query += ` AND p.reconciliation_status = $${params.length}`; }
    if (payerId) { params.push(payerId); query += ` AND p.payer_id = $${params.length}`; }
    if (startDate) { params.push(startDate); query += ` AND p.payment_date >= $${params.length}`; }
    if (endDate) { params.push(endDate); query += ` AND p.payment_date <= $${params.length}`; }

    query += ` ORDER BY p.payment_date DESC LIMIT 100`;
    const result = await db.query(query, params);
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ─── GET PAYMENT DETAIL WITH MATCHES ─────────────────────────────────────────
router.get('/:id', auth, requireAdmin, async (req, res) => {
  try {
    const payment = await db.query(`
      SELECT p.*, rs.name as payer_display_name
      FROM payments p
      LEFT JOIN referral_sources rs ON p.payer_id = rs.id
      WHERE p.id = $1
    `, [req.params.id]);

    if (!payment.rows.length) return res.status(404).json({ error: 'Payment not found' });

    const matches = await db.query(`
      SELECT pcm.*, c.claim_number, c.charge_amount, c.service_date,
        cl.first_name as client_first, cl.last_name as client_last
      FROM payment_claim_matches pcm
      JOIN claims c ON pcm.claim_id = c.id
      JOIN clients cl ON c.client_id = cl.id
      WHERE pcm.payment_id = $1
      ORDER BY c.service_date
    `, [req.params.id]);

    res.json({ ...payment.rows[0], matches: matches.rows });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ─── RECONCILIATION SUMMARY ─────────────────────────────────────────────────
router.get('/reports/reconciliation', auth, requireAdmin, async (req, res) => {
  try {
    const { startDate, endDate } = req.query;
    const start = startDate || new Date(Date.now() - 30 * 86400000).toISOString().split('T')[0];
    const end = endDate || new Date().toISOString().split('T')[0];

    const summary = await db.query(`
      SELECT
        COUNT(*) as total_payments,
        COALESCE(SUM(check_amount), 0) as total_received,
        COALESCE(SUM(total_matched), 0) as total_matched,
        COALESCE(SUM(underpayment_amount), 0) as total_underpayments,
        COUNT(CASE WHEN reconciliation_status = 'reconciled' THEN 1 END) as reconciled_count,
        COUNT(CASE WHEN reconciliation_status = 'partial' THEN 1 END) as partial_count,
        COUNT(CASE WHEN reconciliation_status = 'unreconciled' THEN 1 END) as unreconciled_count
      FROM payments
      WHERE payment_date BETWEEN $1 AND $2
    `, [start, end]);

    const byPayer = await db.query(`
      SELECT
        COALESCE(rs.name, p.payer_name) as payer_name,
        COUNT(*) as payment_count,
        COALESCE(SUM(p.check_amount), 0) as total_received,
        COALESCE(SUM(p.total_matched), 0) as total_matched
      FROM payments p
      LEFT JOIN referral_sources rs ON p.payer_id = rs.id
      WHERE p.payment_date BETWEEN $1 AND $2
      GROUP BY COALESCE(rs.name, p.payer_name)
      ORDER BY total_received DESC
    `, [start, end]);

    res.json({
      period: { start, end },
      summary: summary.rows[0],
      byPayer: byPayer.rows,
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
