// routes/remittanceRoutes.js - Remittance management with free OCR
const express = require('express');
const router = express.Router();
const db = require('../db');
const auth = require('../middleware/auth');
const requireAdmin = require('../middleware/authorizeAdmin');
const { v4: uuidv4 } = require('uuid');
const multer = require('multer');
const fs = require('fs');

const upload = multer({
  dest: '/tmp/remittance-uploads/',
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    cb(null, ['image/jpeg','image/png','image/webp','application/pdf'].includes(file.mimetype));
  }
});

async function extractText(filePath) {
  try {
    const Tesseract = require('tesseract.js');
    const { data: { text } } = await Tesseract.recognize(filePath, 'eng', { logger: () => {} });
    return text || '';
  } catch (e) { return ''; }
}

function parseRemittance(text) {
  const result = { checkNumber: null, checkDate: null, payerName: null, totalAmount: null, lineItems: [] };
  if (!text) return result;
  for (const p of [/CHECK\s*(?:NO\.?|#)?\s*[:\-]?\s*(\d{4,10})/i, /CHK\s*#?\s*(\d{4,10})/i]) {
    const m = text.match(p); if (m) { result.checkNumber = m[1]; break; }
  }
  for (const p of [/(?:DATE|CHECK DATE)\s*[:\-]?\s*(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4})/i, /(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{4})/]) {
    const m = text.match(p);
    if (m) { const d = new Date(m[1]); if (!isNaN(d)) { result.checkDate = d.toISOString().split('T')[0]; break; } }
  }
  for (const p of [/(?:TOTAL|NET PAYMENT|CHECK AMOUNT)\s*[:\-\$]?\s*\$?\s*([\d,]+\.\d{2})/i, /\*+\s*\$?\s*([\d,]+\.\d{2})\s*\*+/]) {
    const m = text.match(p);
    if (m) { const a = parseFloat(m[1].replace(/,/g,'')); if (a > 0) { result.totalAmount = a; break; } }
  }
  const known = [
    {p:/forwardhealth|forward health|dhs/i, n:'Wisconsin ForwardHealth (Medicaid)'},
    {p:/my choice wisconsin/i, n:'My Choice Wisconsin'},{p:/inclusa/i, n:'Inclusa'},
    {p:/lakeland care/i, n:'Lakeland Care'},{p:/molina/i, n:'Molina Healthcare of Wisconsin'},
    {p:/veterans affairs|\bva\b/i, n:'Veterans Affairs (VA)'},{p:/medicare/i, n:'Medicare'},
  ];
  for (const k of known) { if (k.p.test(text)) { result.payerName = k.n; break; } }
  if (!result.payerName) result.payerName = text.split('\n').find(l=>l.trim())?.slice(0,80)||null;
  let m;
  const lp = /(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4}).*?\$?\s*([\d,]+\.\d{2})\s+\$?\s*([\d,]+\.\d{2})/g;
  while ((m = lp.exec(text)) !== null) {
    const paid = parseFloat(m[3].replace(/,/g,'')); if (paid>0) result.lineItems.push({serviceDate:m[1],billedAmount:parseFloat(m[2].replace(/,/g,'')),paidAmount:paid});
  }
  return result;
}

router.post('/upload', auth, requireAdmin, upload.single('remittance'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
    const text = await extractText(req.file.path);
    try { fs.unlinkSync(req.file.path); } catch(e) {}
    const parsed = parseRemittance(text);
    let suggestedPayer = null;
    if (parsed.payerName) {
      const word = parsed.payerName.toLowerCase().split(' ')[0];
      const match = await db.query(`SELECT id,name,payer_type FROM referral_sources WHERE LOWER(name) LIKE $1 LIMIT 1`,[`%${word}%`]);
      if (match.rows.length) suggestedPayer = match.rows[0];
    }
    res.json({ ocr: parsed, suggestedPayer, confidence: {checkNumber:!!parsed.checkNumber,date:!!parsed.checkDate,amount:!!parsed.totalAmount,payer:!!parsed.payerName,lineItems:parsed.lineItems.length} });
  } catch(error) { res.status(500).json({ error: error.message }); }
});

router.post('/batch', auth, requireAdmin, async (req, res) => {
  try {
    const { payerId, payerName, payerType, checkNumber, checkDate, paymentDate, totalAmount, notes, lineItems, rawOcrText } = req.body;
    if (!totalAmount || !payerName) return res.status(400).json({ error: 'Payer name and total amount required' });
    const batchId = uuidv4();
    const batch = await db.query(`
      INSERT INTO remittance_batches (id,payer_id,payer_name,payer_type,check_number,check_date,payment_date,total_amount,raw_ocr_text,notes,created_by)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *
    `,[batchId,payerId||null,payerName,payerType||'other',checkNumber||null,checkDate||null,paymentDate||new Date().toISOString().split('T')[0],totalAmount,rawOcrText||null,notes||null,req.user.id]);
    let matchedCount = 0;
    for (const item of (lineItems||[])) {
      let matchedInvoiceId=item.invoiceId||null, matchedClientId=item.clientId||null, matchedClaimId=item.claimId||null, matchStatus='unmatched';
      if (!matchedInvoiceId && matchedClientId && item.serviceDate) {
        const inv = await db.query(`SELECT id FROM invoices WHERE client_id=$1 AND billing_period_start<=$2::date AND billing_period_end>=$2::date AND payment_status!='paid' ORDER BY created_at DESC LIMIT 1`,[matchedClientId,item.serviceDate]);
        if (inv.rows.length) { matchedInvoiceId=inv.rows[0].id; matchStatus='matched'; }
      }
      if (!matchedClaimId && item.claimNumber) {
        const clm = await db.query(`SELECT id FROM claims WHERE claim_number=$1 LIMIT 1`,[item.claimNumber]);
        if (clm.rows.length) { matchedClaimId=clm.rows[0].id; matchStatus='matched'; }
      }
      if (matchStatus==='matched') matchedCount++;
      await db.query(`INSERT INTO remittance_line_items (id,batch_id,client_id,invoice_id,claim_id,claim_number,service_date_from,service_date_to,billed_amount,paid_amount,adjustment_amount,denial_code,denial_reason,match_status,matched_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
        [uuidv4(),batchId,matchedClientId,matchedInvoiceId,matchedClaimId,item.claimNumber||null,item.serviceDateFrom||item.serviceDate||null,item.serviceDateTo||null,item.billedAmount||null,item.paidAmount,item.adjustmentAmount||0,item.denialCode||null,item.denialReason||null,matchStatus,matchStatus==='matched'?new Date():null]);
      if (matchedInvoiceId && item.paidAmount>0) {
        try {
          await db.query(`INSERT INTO invoice_payments (invoice_id,amount,payment_date,payment_method,reference_number,notes) VALUES ($1,$2,$3,'check',$4,$5)`,[matchedInvoiceId,item.paidAmount,paymentDate||new Date(),checkNumber,`Remittance ${batchId.slice(0,8)}`]);
          await db.query(`UPDATE invoices SET amount_paid=COALESCE(amount_paid,0)+$1, payment_status=CASE WHEN COALESCE(amount_paid,0)+$1>=total THEN 'paid' WHEN COALESCE(amount_paid,0)+$1>0 THEN 'partial' ELSE 'pending' END WHERE id=$2`,[item.paidAmount,matchedInvoiceId]);
        } catch(e) {}
      }
      if (matchedClaimId && item.paidAmount!=null) {
        await db.query(`UPDATE claims SET paid_amount=$1,paid_date=$2,status=CASE WHEN $1>0 THEN 'paid' ELSE 'denied' END,denial_code=$3,denial_reason=$4 WHERE id=$5`,[item.paidAmount,paymentDate||new Date(),item.denialCode||null,item.denialReason||null,matchedClaimId]);
      }
    }
    const total=(lineItems||[]).length;
    await db.query(`UPDATE remittance_batches SET status=$1 WHERE id=$2`,[total===0?'pending_match':matchedCount===total?'matched':matchedCount>0?'partial':'unmatched',batchId]);
    res.json({ batch:batch.rows[0], matchedCount, totalItems:total });
  } catch(error) { res.status(500).json({ error: error.message }); }
});

router.get('/batches', auth, requireAdmin, async (req, res) => {
  try {
    const result = await db.query(`SELECT rb.*,rs.name as payer_display_name,COUNT(rli.id) as line_item_count FROM remittance_batches rb LEFT JOIN referral_sources rs ON rb.payer_id=rs.id LEFT JOIN remittance_line_items rli ON rb.id=rli.batch_id GROUP BY rb.id,rs.name ORDER BY rb.payment_date DESC LIMIT 50`);
    res.json(result.rows);
  } catch(error) { res.status(500).json({ error: error.message }); }
});

router.get('/payer-summary', auth, requireAdmin, async (req, res) => {
  try {
    const result = await db.query(`
      SELECT rs.id as payer_id, rs.name as payer_name, rs.payer_type,
        COUNT(DISTINCT i.id) as total_invoices,
        COALESCE(SUM(i.total),0) as total_billed,
        COALESCE(SUM(i.amount_paid),0) as total_paid,
        COALESCE(SUM(i.total)-SUM(COALESCE(i.amount_paid,0)),0) as total_outstanding,
        COALESCE(SUM(CASE WHEN i.payment_status='pending' AND i.payment_due_date<CURRENT_DATE-90 THEN i.total-COALESCE(i.amount_paid,0) END),0) as over_90_days,
        COALESCE(SUM(CASE WHEN i.payment_status='pending' AND i.payment_due_date BETWEEN CURRENT_DATE-90 AND CURRENT_DATE-60 THEN i.total-COALESCE(i.amount_paid,0) END),0) as days_61_90,
        COALESCE(SUM(CASE WHEN i.payment_status='pending' AND i.payment_due_date BETWEEN CURRENT_DATE-60 AND CURRENT_DATE-30 THEN i.total-COALESCE(i.amount_paid,0) END),0) as days_31_60,
        COALESCE(SUM(CASE WHEN i.payment_status='pending' AND i.payment_due_date>CURRENT_DATE-30 THEN i.total-COALESCE(i.amount_paid,0) END),0) as days_0_30,
        MAX(rb.payment_date) as last_payment_date, COALESCE(SUM(rb.total_amount),0) as total_received
      FROM referral_sources rs
      LEFT JOIN clients c ON c.referral_source_id=rs.id
      LEFT JOIN invoices i ON i.client_id=c.id
      LEFT JOIN remittance_batches rb ON rb.payer_id=rs.id
      WHERE rs.is_active_payer=true
      GROUP BY rs.id,rs.name,rs.payer_type
      ORDER BY total_outstanding DESC
    `);
    res.json(result.rows);
  } catch(error) { res.status(500).json({ error: error.message }); }
});

router.get('/payers', auth, async (req, res) => {
  try {
    const result = await db.query(`SELECT id,name,payer_type,edi_payer_id,expected_pay_days FROM referral_sources WHERE is_active_payer=true ORDER BY name ASC`);
    res.json(result.rows);
  } catch(error) { res.status(500).json({ error: error.message }); }
});

module.exports = router;
